// Preload that answers api.unsplash.com from a fixture, so the Unsplash branch
// of /api/food-photos can be exercised without an Access Key:
//
//   UNSPLASH_ACCESS_KEY=fixture node -r ./verification/unsplash-stub.js server/server.js
//
// Everything else — including the real Google Places calls — passes straight
// through. The image URLs in the fixture are genuine images.unsplash.com
// hotlinks, which need no key, so a browser really does render the photos.
//
// UNSPLASH_STUB_MODE picks the branch to exercise:
//   ok (default) | empty (nothing matched) | 403 (hourly limit) | 500
//   flaky — 403 the first time each query is asked, then ok, to prove a
//           rate-limit blip is not cached and the food recovers on retry

const MODE = process.env.UNSPLASH_STUB_MODE || 'ok';

const IMAGE_IDS = [
  'photo-1568901346375-23c9450c58cd',
  'photo-1550547660-d9450f859349',
  'photo-1512621776951-a57141f2eefd'
];

const PHOTOGRAPHERS = ['Ada Fixture', 'Bo Stubbs', 'Cy Placeholder'];

let served = 0;
const downloadPings = [];
const seenQueries = new Set();

function fixtureFor(query) {
  const i = served++ % IMAGE_IDS.length;
  const slug = PHOTOGRAPHERS[i].toLowerCase().replace(/\s+/g, '');
  return {
    total: 42,
    results: [{
      id: `stub-${i}`,
      alt_description: `stub photo for ${query}`,
      urls: {
        // Real Unsplash URLs carry an ixid query string; keeping one here means
        // the server's URL building is tested against the shape it will meet.
        raw: `https://images.unsplash.com/${IMAGE_IDS[i]}?ixid=stub&ixlib=rb-4.0.3`
      },
      links: {
        download_location: `https://api.unsplash.com/photos/stub-${i}/download?ixid=stub`
      },
      user: {
        name: PHOTOGRAPHERS[i],
        links: { html: `https://unsplash.com/@${slug}` }
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

  if (href.includes('api.unsplash.com/photos/') && href.includes('/download')) {
    downloadPings.push(href);
    console.log(`[stub] download ping (${downloadPings.length} total)`);
    return jsonResponse(200, { url: 'https://example.invalid/tracked' });
  }

  if (href.startsWith('https://api.unsplash.com/search/photos')) {
    const auth = (options && options.headers && options.headers.Authorization) || '';
    const version = (options && options.headers && options.headers['Accept-Version']) || '';
    const query = new URL(href).searchParams.get('query');
    console.log(`[stub] search "${query}" auth="${auth}" Accept-Version="${version}"`);

    if (MODE === 'flaky' && !seenQueries.has(query)) {
      seenQueries.add(query);
      return jsonResponse(403, { errors: ['Rate Limit Exceeded'] });
    }
    if (MODE === 'empty') return jsonResponse(200, { total: 0, results: [] });
    if (MODE === '403') return jsonResponse(403, { errors: ['Rate Limit Exceeded'] });
    if (MODE === '500') return jsonResponse(500, { errors: ['oops'] });
    return jsonResponse(200, fixtureFor(query));
  }

  return realFetch(url, options);
};

console.log(`[stub] Unsplash stubbed, mode="${MODE}"`);
