const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { PlacesCache } = require('./places-cache');
const { estimateCarbon, AgentUnavailableError } = require('./carbon-agent');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// The frontend must be served over http: Babel fetches app.js via XHR, which
// file:// blocks, and geolocation needs a secure context. Serving it from here
// means one command and one origin for the whole demo.
// The static root is the repo root, so everything beside index.html is public
// by default: server sources and .env, the dev folder, the dependency tree and
// the manifests that name it. Only three files are actually meant to be served.
//
// Vercel's CDN answers static paths before this process ever sees them, so it
// cannot enforce any of this -- vercel.json repeats the denials for that host.
for (const secret of ['/server', '/verification', '/node_modules']) {
  app.use(secret, (req, res) => res.status(404).end());
}
app.get(['/package.json', '/package-lock.json'], (req, res) => res.status(404).end());
app.use(express.static(path.join(__dirname, '..'), { dotfiles: 'deny' }));

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.error('ERROR: GOOGLE_PLACES_API_KEY not found in .env file');
  process.exit(1);
}

const MILES_PER_METER = 0.000621371;
const PRICE_LEVEL_SYMBOLS = {
  PRICE_LEVEL_FREE: '$',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'
};

// Remembers whether Places has ever answered, so we only print setup help once.
let placesWarningShown = false;

// Places returns photo *references*, not images: `places/ID/photos/REF`. The
// bytes come from a second, separately billed call that needs the API key, so
// the browser only ever gets the reference and asks /api/place-photo for it.
// Attribution is not optional - Google requires it wherever the image is shown.
function firstPhoto(photos) {
  const photo = (photos || [])[0];
  if (!photo || !photo.name) return null;
  const author = (photo.authorAttributions || [])[0] || {};
  return {
    name: photo.name,
    attribution: author.displayName || null,
    attributionUrl: author.uri || null
  };
}

// Set PLACES_CACHE=off in .env to force every search to hit Google — useful
// when you have changed a placesQuery and want to see the real result.
const placesCache = new PlacesCache({
  enabled: String(process.env.PLACES_CACHE || '').toLowerCase() !== 'off',
  ttlHours: process.env.PLACES_CACHE_TTL_HOURS
});

// No longer called by the UI — every alternative now resolves its own venue
// through /api/alternatives-nearby. Kept because the README documents it.
app.post('/api/restaurants', async (req, res) => {
  const { latitude, longitude, foodType, radiusMiles } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }

  // Places caps a bias circle at 50km; default to 3 miles when unspecified.
  const miles = Math.min(Math.max(Number(radiusMiles) || 3, 0.5), 30);
  const radiusMeters = Math.min(Math.round(miles / MILES_PER_METER), 50000);

  try {
    // searchText (not searchNearby) so "sushi" actually surfaces sushi places
    // rather than whatever restaurant happens to be closest.
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.rating',
          'places.userRatingCount',
          'places.priceLevel',
          'places.googleMapsUri',
          'places.photos'
        ].join(',')
      },
      body: JSON.stringify({
        textQuery: `${foodType || 'restaurant'} restaurant`,
        includedType: 'restaurant',
        maxResultCount: 10,
        languageCode: 'en',
        locationBias: {
          circle: {
            center: { latitude, longitude },
            radius: radiusMeters
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      logPlacesProblem(response.status, detail);
      return res.json({
        success: true,
        source: 'fallback',
        notice: 'Showing sample restaurants — the Google Places API is not enabled for this key yet.',
        restaurants: buildFallbackRestaurants(latitude, longitude, foodType, miles)
      });
    }

    const data = await response.json();

    const restaurants = (data.places || [])
      .filter((place) => place.location)
      .map((place, idx) => ({
        id: idx + 1,
        name: place.displayName?.text || 'Restaurant',
        address: place.formattedAddress || 'Address unavailable',
        lat: place.location.latitude,
        lng: place.location.longitude,
        rating: typeof place.rating === 'number' ? place.rating : null,
        reviewCount: place.userRatingCount || 0,
        priceLevel: PRICE_LEVEL_SYMBOLS[place.priceLevel] || null,
        mapsUrl: place.googleMapsUri || null,
        photo: firstPhoto(place.photos),
        distance: calculateDistance(latitude, longitude, place.location.latitude, place.location.longitude)
      }))
      .filter((r) => r.distance <= miles * 1.5)
      .sort((a, b) => a.distance - b.distance);

    if (restaurants.length === 0) {
      return res.json({
        success: true,
        source: 'fallback',
        notice: `No restaurants found within ${miles} miles — showing sample options.`,
        restaurants: buildFallbackRestaurants(latitude, longitude, foodType, miles)
      });
    }

    res.json({ success: true, source: 'google', restaurants });
  } catch (error) {
    logPlacesProblem('network', error.message);
    res.json({
      success: true,
      source: 'fallback',
      notice: 'Showing sample restaurants — could not reach Google Places.',
      restaurants: buildFallbackRestaurants(latitude, longitude, foodType, miles)
    });
  }
});

function logPlacesProblem(status, detail) {
  console.error(`Google Places request failed (${status}):`, String(detail).slice(0, 400));
  if (!placesWarningShown && /SERVICE_DISABLED|not been used|legacy API/i.test(String(detail))) {
    placesWarningShown = true;
    console.error('\n  ACTION NEEDED: enable "Places API (New)" for this API key\'s project');
    console.error('  https://console.cloud.google.com/apis/library/places.googleapis.com');
    console.error('  Billing must be on the project too. Serving sample data until then.\n');
  }
}

// Keeps the demo alive when Places is unavailable. Placed around the user's
// real coordinates so distances and the map still behave believably.
function buildFallbackRestaurants(latitude, longitude, foodType, miles) {
  const cuisine = (foodType || 'meal').split(' ').slice(-1)[0];
  const seeds = [
    { name: 'Green Fork Kitchen', rating: 4.6, priceLevel: '$$', bearing: 40 },
    { name: 'The Daily Harvest', rating: 4.4, priceLevel: '$', bearing: 130 },
    { name: `Cedar & Sage`, rating: 4.7, priceLevel: '$$', bearing: 220 },
    { name: 'Riverside Commons', rating: 4.2, priceLevel: '$', bearing: 310 },
    { name: 'Nine Acres Cafe', rating: 4.5, priceLevel: '$$', bearing: 85 }
  ];

  return seeds.map((seed, idx) => {
    const distance = Math.round((0.3 + (idx * 0.45) % Math.max(miles, 1)) * 10) / 10;
    const angle = (seed.bearing * Math.PI) / 180;
    const latOffset = (distance / 69) * Math.cos(angle);
    const lngOffset = (distance / (69 * Math.cos((latitude * Math.PI) / 180))) * Math.sin(angle);

    return {
      id: idx + 1,
      name: seed.name,
      address: `Serves ${cuisine} • sample location`,
      lat: latitude + latOffset,
      lng: longitude + lngOffset,
      rating: seed.rating,
      reviewCount: 120 + idx * 37,
      priceLevel: seed.priceLevel,
      mapsUrl: null,
      photo: null, // a sample venue has no real photo to show
      distance
    };
  }).sort((a, b) => a.distance - b.distance);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/* ------------------------------------------------- alternatives nearby --- */

// One targeted Places search per suggested food, so a card can only be shown
// as available if something nearby actually sells that kind of thing.
async function placesSearch(textQuery, latitude, longitude, miles, maxDistanceFactor) {
  const radiusMeters = Math.min(Math.round(miles / MILES_PER_METER), 50000);

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': [
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.googleMapsUri',
        // The venue's own site, which is the only per-business ordering link
        // that can be had without guessing. Pro-tier field, and this request is
        // already billed at Enterprise + Atmosphere for reviews below, so it
        // costs nothing extra.
        'places.websiteUri',
        'places.photos',
        // Enterprise + Atmosphere SKU. Drop this line to halve the bill and
        // fall back to category-only matching.
        'places.reviews'
      ].join(',')
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 8,
      languageCode: 'en',
      locationBias: { circle: { center: { latitude, longitude }, radius: radiusMeters } }
    })
  });

  if (!response.ok) {
    return { ok: false, status: response.status, detail: await response.text(), venues: [] };
  }

  const data = await response.json();
  const venues = (data.places || [])
    .filter((place) => place.location)
    .map((place) => ({
      name: place.displayName?.text || 'Restaurant',
      address: place.formattedAddress || 'Address unavailable',
      lat: place.location.latitude,
      lng: place.location.longitude,
      rating: typeof place.rating === 'number' ? place.rating : null,
      reviewCount: place.userRatingCount || 0,
      priceLevel: PRICE_LEVEL_SYMBOLS[place.priceLevel] || null,
      mapsUrl: place.googleMapsUri || null,
      // Often the venue's ordering page. Null for plenty of places, which the
      // UI treats as "no ordering link" rather than inventing one.
      website: place.websiteUri || null,
      photo: firstPhoto(place.photos),
      distance: calculateDistance(latitude, longitude, place.location.latitude, place.location.longitude),
      _reviews: (place.reviews || [])
        .map((r) => ({
          text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || '',
          rating: typeof r.rating === 'number' ? r.rating : 0
        }))
        .filter((r) => r.text)
    }))
    // Targeted queries ("vegan bakery") are much sparser than "restaurant", so
    // reach further before declaring nothing is available.
    .filter((v) => v.distance <= miles * maxDistanceFactor)
    .sort((a, b) => a.distance - b.distance);

  return { ok: true, status: 200, venues };
}

// Only successful searches are cached. A failure must stay a failure, so that
// a key with Places disabled keeps showing the setup help instead of silently
// pinning an empty result for the next six hours.
async function cachedPlacesSearch(textQuery, latitude, longitude, miles, maxDistanceFactor) {
  const key = placesCache.keyFor(textQuery, latitude, longitude, miles, maxDistanceFactor);

  const cached = placesCache.get(key);
  if (cached) return { ok: true, status: 200, venues: cached, cached: true };

  const result = await placesSearch(textQuery, latitude, longitude, miles, maxDistanceFactor);
  if (result.ok) placesCache.set(key, result.venues);
  return result;
}

// Placeholder venues used ONLY when the Places call itself failed. They are
// flagged source:"fallback" so the UI can say so instead of implying a real
// pickup location. Seeded from the food name so two cards never collide.
const FALLBACK_VENUE_NAMES = [
  'Green Fork Kitchen', 'The Daily Harvest', 'Cedar & Sage', 'Riverside Commons',
  'Nine Acres Cafe', 'Field & Flour', 'The Open Pantry', 'Rosemary & Rye'
];

function buildFallbackVenues(key, label, latitude, longitude, miles) {
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const name = FALLBACK_VENUE_NAMES[hash % FALLBACK_VENUE_NAMES.length];
  const distance = Math.round((0.4 + (hash % 17) / 10) * 10) / 10;
  const angle = ((hash % 360) * Math.PI) / 180;
  const latOffset = (distance / 69) * Math.cos(angle);
  const lngOffset = (distance / (69 * Math.cos((latitude * Math.PI) / 180))) * Math.sin(angle);

  return [{
    name,
    address: `Sample location • would serve ${label || 'this'}`,
    lat: latitude + latOffset,
    lng: longitude + lngOffset,
    rating: 4.3 + (hash % 5) / 10,
    reviewCount: 90 + (hash % 200),
    priceLevel: ['$', '$$'][hash % 2],
    mapsUrl: null,
    photo: null, // a sample venue has no real photo to show
    distance: Math.min(distance, miles)
  }];
}

/* ------------------------------------------------------- dish evidence --- */

// Reviews are free text: "steel-cut" vs "steel cut", curly apostrophes, casing.
// Flatten both sides before matching so a hyphen cannot hide a real mention.
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\-'\u2019\u2018]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SENTENCE_ENDS = '.!?\n';

// The sentence the dish is actually named in. A fixed +/-70 window lands
// mid-clause on rambling reviews and reads as nonsense, so prefer the real
// sentence and only fall back to a window when that sentence is huge.
function sentenceAround(original, term) {
  const words = normalize(term).split(' ').map(escapeRegex);
  const re = new RegExp('\\b' + words.join('[\\s\\-’‘]+') + '\\b', 'i');
  const match = re.exec(original);
  if (!match) return null;

  const matchEnd = match.index + match[0].length;

  let start = 0;
  for (let k = match.index; k > 0; k--) {
    if (SENTENCE_ENDS.includes(original[k - 1])) { start = k; break; }
  }
  let end = original.length;
  for (let k = matchEnd; k < original.length; k++) {
    if (SENTENCE_ENDS.includes(original[k])) { end = k + 1; break; }
  }

  const sentence = original.slice(start, end).replace(/\\s+/g, ' ').trim();
  return { sentence, match, matchEnd };
}

function quoteAround(original, term) {
  const found = sentenceAround(original, term);
  if (!found) return null;

  // A tidy sentence is the best quote there is - but a stray ? or ! inside
  // brackets ("the katsu (so?) was great") can start us mid-clause, so drop any
  // leading punctuation and mark it as an excerpt rather than a full sentence.
  if (found.sentence && found.sentence.length <= 200) {
    const trimmed = found.sentence.replace(/^[^A-Za-z0-9]+/, '');
    const isFragment = trimmed !== found.sentence || /^[a-z]/.test(trimmed);
    return (isFragment ? '… ' : '') + trimmed;
  }

  const { match, matchEnd } = found;
  const start = Math.max(0, match.index - 70);
  const end = Math.min(original.length, matchEnd + 70);
  let quote = original.slice(start, end).replace(/\\s+/g, ' ').trim();
  if (start > 0) quote = '… ' + quote.replace(/^\\S+\\s/, '');
  if (end < original.length) quote = quote.replace(/\\s\\S+$/, '') + ' …';
  return quote.length > 200 ? quote.slice(0, 197).trim() + '…' : quote;
}

// Best evidence for one venue: any review mentioning any of the dish terms.
// Prefer the happiest reviewer, then the review that says it most plainly
// (shortest containing sentence), then the most specific term.
function findDishEvidence(venue, dishTerms) {
  if (!Array.isArray(dishTerms) || !dishTerms.length) return null;

  const hits = [];
  for (const review of venue._reviews || []) {
    const haystack = normalize(review.text);
    for (const term of dishTerms) {
      const needle = normalize(term);
      if (!needle) continue;
      const re = new RegExp('\\b' + escapeRegex(needle).split(' ').join('[\\s]+') + '\\b');
      if (!re.test(haystack)) continue;
      const found = sentenceAround(review.text, term);
      hits.push({
        term,
        rating: review.rating,
        text: review.text,
        sentenceLen: found && found.sentence ? found.sentence.length : 9999
      });
    }
  }
  if (!hits.length) return null;

  hits.sort((a, b) =>
    (b.rating - a.rating) ||
    (a.sentenceLen - b.sentenceLen) ||
    (b.term.length - a.term.length)
  );
  const best = hits[0];
  return {
    term: best.term,
    rating: best.rating,
    quote: quoteAround(best.text, best.term),
    mentions: new Set(hits.map((h) => h.term)).size
  };
}

app.post('/api/alternatives-nearby', async (req, res) => {
  const { latitude, longitude, radiusMiles, queries } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }
  if (!Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: 'queries[] required' });
  }

  const miles = Math.min(Math.max(Number(radiusMiles) || 3, 0.5), 30);
  const capped = queries.slice(0, 8);

  // allSettled: one query failing must not blank the other cards.
  const settled = await Promise.allSettled(
    capped.map((q) => cachedPlacesSearch(q.query, latitude, longitude, miles, 2))
  );

  const results = {};
  let failed = 0;
  let servedFromCache = 0;

  capped.forEach((q, i) => {
    const outcome = settled[i];

    // A successful search that found nothing is a real answer: not available.
    // Only a failed CALL falls back to a placeholder.
    if (outcome.status === 'fulfilled' && outcome.value.ok) {
      if (outcome.value.cached) servedFromCache += 1;

      const scored = outcome.value.venues.map((venue) => {
        const evidence = findDishEvidence(venue, q.dishTerms);
        const { _reviews, ...rest } = venue; // never ship the raw reviews
        return { ...rest, evidence };
      });

      // A place someone actually named the dish at beats a merely plausible
      // category match, however close that one is.
      scored.sort((a, b) => {
        if (!!b.evidence !== !!a.evidence) return b.evidence ? 1 : -1;
        return a.distance - b.distance;
      });

      results[q.key] = { source: 'google', venues: scored.slice(0, 3) };
      return;
    }

    failed += 1;
    if (outcome.status === 'fulfilled') logPlacesProblem(outcome.value.status, outcome.value.detail);
    else logPlacesProblem('network', outcome.reason && outcome.reason.message);

    results[q.key] = {
      source: 'fallback',
      venues: buildFallbackVenues(q.key, q.label, latitude, longitude, miles)
    };
  });

  // Dish evidence is recomputed on every request rather than cached alongside
  // the venues, so editing `dishTerms` in app.js takes effect on the next
  // reload without spending a Places call to see it.
  console.log(
    `alternatives-nearby: ${capped.length} quer${capped.length === 1 ? 'y' : 'ies'}, ` +
    `${servedFromCache} from cache, ${capped.length - servedFromCache - failed} billed, ${failed} failed`
  );

  res.json({
    success: true,
    cache: { served: servedFromCache, of: capped.length },
    source: failed === 0 ? 'google' : failed === capped.length ? 'fallback' : 'mixed',
    notice: failed === 0
      ? null
      : failed === capped.length
        ? 'Showing sample pickup locations — the Google Places API is not enabled for this key yet.'
        : 'Some pickup locations are samples — the Google Places API did not answer for every option.',
    results
  });
});

/* --------------------------------------------------------- place photos --- */

// Photo names are Google-issued and go straight into an upstream URL, so they
// are matched against the documented shape rather than trusted - anything else
// would let a caller point this proxy wherever it liked.
const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

// Proxied rather than handed to the browser as a URL, because the media call
// carries GOOGLE_PLACES_API_KEY and that key is also on the priciest Places
// tier. Every hit here is a billable Place Photos request - the day-long
// Cache-Control is what keeps a demo from paying for the same image repeatedly.
app.get('/api/place-photo', async (req, res) => {
  const name = String(req.query.name || '');
  if (!PHOTO_NAME_PATTERN.test(name)) {
    return res.status(400).json({ error: 'Invalid photo name' });
  }

  // Google accepts 1-4800; 400px is plenty for a card thumbnail.
  const maxWidth = Math.min(Math.max(parseInt(req.query.maxWidth, 10) || 400, 1), 4800);
  const url = `https://places.googleapis.com/v1/${name}/media` +
    `?maxWidthPx=${maxWidth}&key=${GOOGLE_PLACES_API_KEY}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      logPlacesProblem(upstream.status, await upstream.text());
      // The <img> onError handler swaps in a placeholder tile.
      return res.status(502).end();
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(body);
  } catch (error) {
    logPlacesProblem('network', error.message);
    res.status(502).end();
  }
});

/* ---------------------------------------------------------- food photos --- */

// Pexels needs a free API key, sent as a bare Authorization header - no
// "Bearer" prefix. Missing key is not fatal: the cards fall back to a plain
// tile, like every other degradation here.
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

if (!PEXELS_API_KEY) {
  console.warn('NOTE: PEXELS_API_KEY not set — alternative cards will show a placeholder tile instead of a photo.');
}

// Searching the bare dish name pulls in styled product shots and the odd
// unrelated scene; " food" biases hard towards a plated dish. This is the knob
// to turn if a particular card gets a photo that looks nothing like the dish.
const PHOTO_QUERY_SUFFIX = ' food';

// Holds successes AND honest "nothing matched" answers, so a repeated search
// costs nothing - but never a transport error or a rate-limit blip, or one bad
// minute would blank that food until the server restarted.
const foodPhotoCache = new Map();

// Printed at most once: a rejected key looks exactly like a quiet feature until
// someone reads the logs.
let photoKeyWarningShown = false;

function photoQuery(foodName) {
  return String(foodName || '')
    .replace(/&/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + PHOTO_QUERY_SUFFIX;
}

async function fetchFoodPhoto(foodName) {
  const key = photoQuery(foodName).toLowerCase();
  if (foodPhotoCache.has(key)) return foodPhotoCache.get(key);
  if (!PEXELS_API_KEY) return { ok: false, reason: 'no-key' };

  const url = 'https://api.pexels.com/v1/search' +
    `?query=${encodeURIComponent(photoQuery(foodName))}` +
    '&per_page=1&orientation=landscape';

  // Bare key, no scheme prefix - that is what Pexels expects.
  const response = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });

  if (!response.ok) {
    const reason = response.status === 429
      ? 'rate-limited'
      : (response.status === 401 || response.status === 403) ? 'bad-key' : 'error';

    console.error(`Pexels search failed (${response.status}) for "${foodName}"`);
    if (reason === 'bad-key' && !photoKeyWarningShown) {
      photoKeyWarningShown = true;
      console.error('\n  ACTION NEEDED: Pexels rejected PEXELS_API_KEY — check server/.env');
      console.error('  https://www.pexels.com/api/  Cards show placeholder tiles until then.\n');
    }
    return { ok: false, reason }; // deliberately not cached
  }

  const data = await response.json();
  const photo = (data.photos || [])[0];
  if (!photo) {
    const miss = { ok: false, reason: 'no-match' };
    foodPhotoCache.set(key, miss);
    return miss;
  }

  // Hotlinked straight from images.pexels.com: those requests need no key and
  // do not count against the API quota. Sizing params on the original get
  // exactly the crop a card needs instead of shipping a 4000px original.
  const image = new URL(photo.src.original);
  image.searchParams.set('auto', 'compress');
  image.searchParams.set('cs', 'tinysrgb');
  image.searchParams.set('fit', 'crop');
  image.searchParams.set('w', '400');
  image.searchParams.set('h', '260');

  // Provider-neutral shape: the card renders "Photo: <photographer> on
  // <source>", so swapping provider again stays a server-side change.
  const result = {
    ok: true,
    url: image.toString(),
    alt: photo.alt || foodName,
    photographer: photo.photographer || 'Pexels',
    photographerUrl: photo.photographer_url || 'https://www.pexels.com/',
    source: 'Pexels',
    // Pexels asks for a prominent link back; the photo's own page is the one
    // they prefer.
    sourceUrl: photo.url || 'https://www.pexels.com/'
  };

  foodPhotoCache.set(key, result);
  return result;
}

// One round trip for the whole card grid instead of one per card, so a slow
// photo provider costs the page one wait rather than eight.
app.post('/api/food-photos', async (req, res) => {
  const { names } = req.body;

  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'names[] required' });
  }

  const capped = names.slice(0, 8).map(String);
  const settled = await Promise.allSettled(capped.map((name) => fetchFoodPhoto(name)));

  const photos = {};
  capped.forEach((name, i) => {
    const outcome = settled[i];
    photos[name] = outcome.status === 'fulfilled'
      ? outcome.value
      : { ok: false, reason: 'error' };
  });

  res.json({
    success: true,
    configured: Boolean(PEXELS_API_KEY),
    photos
  });
});

/* ------------------------------------------------------ carbon estimate --- */

// Optional, like Pexels: without a key the frontend keeps its ingredient-table
// estimate, so a missing key degrades the numbers rather than the app.
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('NOTE: ANTHROPIC_API_KEY not set — carbon figures will use the built-in ingredient table instead of the ingredient-level estimate.');
}

// Scores the searched food and its candidate swaps in one call, so every
// number on the results page comes from the same method.
app.post('/api/carbon-estimate', async (req, res) => {
  const { dishes, latitude, longitude } = req.body || {};
  if (!Array.isArray(dishes) || dishes.length === 0) {
    return res.status(400).json({ error: 'dishes[] required' });
  }

  try {
    const estimate = await estimateCarbon({ dishes, latitude, longitude });
    res.json({ ok: true, source: 'agent', ...estimate });
  } catch (err) {
    // Always a 200: the page has a working fallback, and a failed estimate is
    // an expected state rather than a broken request.
    if (err instanceof AgentUnavailableError) {
      return res.json({ ok: false, reason: err.reason });
    }
    console.error('Carbon estimate failed:', err.message);
    res.json({ ok: false, reason: 'agent-failed', detail: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running', placesCache: placesCache.summary() });
});

// Bind a port only when this file is the program. A serverless host (Vercel)
// imports the module instead and owns the lifecycle itself: there is no port to
// listen on, and a stray listen() would hold the invocation open. `node
// server.js` locally and `npm start` on a long-lived host are unaffected.
if (require.main === module) {
  app.listen(PORT, () => {
    // PORT is injected by the host in production, where "localhost" would be a
    // lie in the logs. Only claim a browsable URL when we picked the port.
    console.log(process.env.PORT
      ? `SustainEat backend listening on port ${PORT}`
      : `SustainEat backend running on http://localhost:${PORT}`);
    const cache = placesCache.summary();
    console.log(cache.enabled
      ? `Places cache on — ${cache.entries} entries, ${cache.ttlHours}h TTL (PLACES_CACHE=off to disable)`
      : 'Places cache OFF — every search will be billed');
  });

  // Debounced writes mean the last few searches may not be on disk yet. Flush on
  // the way out so a Ctrl+C between rehearsals does not throw them away.
  // Serverless has no such shutdown to hook, which is why this lives in here.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      placesCache.flush();
      process.exit(0);
    });
  }
}

// The handler Vercel's api/index.js re-exports. An Express app is already a
// (req, res) function, so it needs no adapter.
module.exports = app;
