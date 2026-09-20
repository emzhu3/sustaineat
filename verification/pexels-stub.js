// Preload that answers api.pexels.com from a fixture, so the degraded branches
// of /api/food-photos can be exercised on demand:
//
//   PEXELS_API_KEY=fixture node -r ./verification/pexels-stub.js server/server.js
//
// Everything else — including the real Google Places calls — passes straight
// through. The happy path no longer needs this stub (there is a real key now),
// but the failure branches cannot be produced on demand any other way.
//
// PEXELS_STUB_MODE picks the branch to exercise:
//   ok (default) | empty (nothing matched) | 429 (rate limited) | 401 (bad key)
//   flaky — 429 the first time each query is asked, then ok, to prove a
//           rate-limit blip is not cached and the food recovers on retry

const MODE = process.env.PEXELS_STUB_MODE || 'ok';

// Genuine images.pexels.com photo ids: those need no key, so a browser really
// does render the photos when this stub is in place.
const PHOTO_IDS = ['31242123', '1639557', '1279330'];
const PHOTOGRAPHERS = ['Ada Fixture', 'Bo Stubbs', 'Cy Placeholder'];

let served = 0;
const seenQueries = new Set();

function fixtureFor(query) {
  const i = served++ % PHOTO_IDS.length;
  const id = PHOTO_IDS[i];
  const slug = PHOTOGRAPHERS[i].toLowerCase().replace(/\s+/g, '-');
  return {
    page: 1,
    per_page: 1,
    total_results: 42,
    photos: [{
      id: Number(id),
      width: 4380,
      height: 3504,
      url: `https://www.pexels.com/photo/stub-${id}/`,
      photographer: PHOTOGRAPHERS[i],
      photographer_url: `https://www.pexels.com/@${slug}`,
      photographer_id: 1000 + i,
      avg_color: '#B5B09D',
      alt: `stub photo for ${query}`,
      src: {
        original: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`,
        large: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&h=650&w=940`,
        medium: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&h=350`,
        landscape: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`
      }
    }]
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function (url, options) {
  const href = typeof url === 'string' ? url : String(url);

  if (href.startsWith('https://api.pexels.com/v1/search')) {
    const auth = (options && options.headers && options.headers.Authorization) || '';
    const query = new URL(href).searchParams.get('query');
    console.log(`[stub] search "${query}" auth="${auth}"`);

    if (MODE === 'flaky' && !seenQueries.has(query)) {
      seenQueries.add(query);
      return jsonResponse(429, { error: 'Rate limit exceeded' });
    }
    if (MODE === 'empty') return jsonResponse(200, { total_results: 0, photos: [] });
    if (MODE === '429') return jsonResponse(429, { error: 'Rate limit exceeded' });
    if (MODE === '401') return jsonResponse(401, { error: 'Unauthorized' });
    return jsonResponse(200, fixtureFor(query));
  }

  return realFetch(url, options);
};

console.log(`[stub] Pexels stubbed, mode="${MODE}"`);
