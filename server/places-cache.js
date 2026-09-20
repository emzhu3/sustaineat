// Disk-backed cache for Google Places responses.
//
// Why this exists: /api/alternatives-nearby fires one Places search per
// suggested food, and the field mask asks for `places.reviews`, which puts
// every one of those on the Enterprise + Atmosphere SKU. A single page refresh
// is therefore ~8 billable calls on the priciest tier. Rehearsing a demo twenty
// times costs real money, and a quota trip or dead venue wifi mid-presentation
// looks like a broken product.
//
// Caching on (query, rounded location, radius) makes repeat searches free,
// instant, and survivable offline. Entries persist to disk so restarting the
// server between rehearsals does not re-buy everything.

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'places.json');

// ~3 decimal places of latitude is about 110 m. Rounding to that means the
// browser handing us slightly different coordinates on each geolocation fix
// does not miss the cache. The stored per-venue `distance` was measured from
// the first caller's exact position, so it can be off by up to ~0.07 mi for a
// later caller — far below the precision the UI shows (0.1 mi).
const COORD_PRECISION = 3;

const DEFAULT_TTL_HOURS = 6;

// Disk writes are debounced: a burst of 8 parallel searches should produce one
// write, not eight.
const FLUSH_DELAY_MS = 2000;

class PlacesCache {
  constructor({ enabled = true, ttlHours } = {}) {
    this.enabled = enabled;
    // `|| DEFAULT` would quietly turn an explicit 0 into six hours, so a
    // PLACES_CACHE_TTL_HOURS=0 meant to bypass the cache would do the opposite
    // of what it says. Only a genuinely unusable value falls back.
    const ttl = Number(ttlHours);
    this.ttlMs = (Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
    this.entries = new Map();
    this.stats = { hits: 0, misses: 0, writes: 0, expired: 0 };
    this.flushTimer = null;

    if (this.enabled) this.load();
  }

  keyFor(textQuery, latitude, longitude, miles, maxDistanceFactor) {
    const q = String(textQuery || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const lat = Number(latitude).toFixed(COORD_PRECISION);
    const lng = Number(longitude).toFixed(COORD_PRECISION);
    return `${q}|${lat}|${lng}|${miles}|${maxDistanceFactor}`;
  }

  // Fresh means strictly younger than the TTL, so a TTL of 0 expires
  // everything immediately rather than keeping it for one more millisecond.
  isFresh(entry) {
    return Date.now() - entry.storedAt < this.ttlMs;
  }

  get(key) {
    if (!this.enabled) return null;

    const entry = this.entries.get(key);
    if (!entry) {
      this.stats.misses += 1;
      return null;
    }

    if (!this.isFresh(entry)) {
      this.entries.delete(key);
      this.stats.expired += 1;
      this.stats.misses += 1;
      this.scheduleFlush();
      return null;
    }

    this.stats.hits += 1;
    // Returned by reference. Callers only read and spread these venues — they
    // never mutate them — so a clone per hit would be wasted work.
    return entry.venues;
  }

  set(key, venues) {
    if (!this.enabled) return;
    this.entries.set(key, { storedAt: Date.now(), venues });
    this.stats.writes += 1;
    this.scheduleFlush();
  }

  load() {
    try {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      let kept = 0;
      let dropped = 0;

      for (const [key, entry] of Object.entries(parsed.entries || {})) {
        if (!entry || typeof entry.storedAt !== 'number' || !Array.isArray(entry.venues)) continue;
        if (!this.isFresh(entry)) { dropped += 1; continue; }
        this.entries.set(key, entry);
        kept += 1;
      }

      if (kept || dropped) {
        console.log(`Places cache: loaded ${kept} entr${kept === 1 ? 'y' : 'ies'} from disk` +
          (dropped ? `, dropped ${dropped} stale` : ''));
      }
    } catch (err) {
      // No cache file yet is the normal first-run case, not a problem. Anything
      // else (corrupt JSON, unreadable file) also just means starting empty.
      if (err.code !== 'ENOENT') {
        console.warn('Places cache: could not read cache file, starting empty —', err.message);
      }
    }
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DELAY_MS);
    // Never hold the process open just to write a cache file.
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  flush() {
    if (!this.enabled) return;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const entries = {};
      for (const [key, entry] of this.entries) entries[key] = entry;
      // Write-then-rename, so a crash mid-write cannot leave truncated JSON
      // that would fail to parse on the next start.
      const tmp = `${CACHE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }), 'utf8');
      fs.renameSync(tmp, CACHE_FILE);
    } catch (err) {
      console.warn('Places cache: could not write cache file —', err.message);
    }
  }

  // Calls not made to Google because a cached answer existed.
  summary() {
    return {
      enabled: this.enabled,
      entries: this.entries.size,
      ttlHours: this.ttlMs / (60 * 60 * 1000),
      ...this.stats,
      callsAvoided: this.stats.hits
    };
  }
}

module.exports = { PlacesCache };
