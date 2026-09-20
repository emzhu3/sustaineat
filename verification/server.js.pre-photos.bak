const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// The frontend must be served over http: Babel fetches app.js via XHR, which
// file:// blocks, and geolocation needs a secure context. Serving it from here
// means one command and one origin for the whole demo.
app.use('/server', (req, res) => res.status(404).end()); // never expose .env
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
          'places.googleMapsUri'
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
    capped.map((q) => placesSearch(q.query, latitude, longitude, miles, 2))
  );

  const results = {};
  let failed = 0;

  capped.forEach((q, i) => {
    const outcome = settled[i];

    // A successful search that found nothing is a real answer: not available.
    // Only a failed CALL falls back to a placeholder.
    if (outcome.status === 'fulfilled' && outcome.value.ok) {
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

  res.json({
    success: true,
    source: failed === 0 ? 'google' : failed === capped.length ? 'fallback' : 'mixed',
    notice: failed === 0
      ? null
      : failed === capped.length
        ? 'Showing sample pickup locations — the Google Places API is not enabled for this key yet.'
        : 'Some pickup locations are samples — the Google Places API did not answer for every option.',
    results
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running' });
});

app.listen(PORT, () => {
  console.log(`SustainEat backend running on http://localhost:${PORT}`);
});
