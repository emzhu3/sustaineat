// Checks the two photo paths added for the card images, against whatever
// backend is listening on :5000.
//
//   node verification/verify-photos.js
//
// Adapts to the server it finds: with no UNSPLASH_ACCESS_KEY it asserts the
// placeholder path, and with a key (real or the stub) it asserts a usable photo
// plus attribution. Run it both ways.

const BASE = process.env.BASE || 'http://localhost:5000';
const ORIGIN = { latitude: 42.3601, longitude: -71.0942 };

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function postJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  console.log('\n=== Google Places photo references ===');

  const nearby = await postJson('/api/alternatives-nearby', {
    ...ORIGIN,
    radiusMiles: 3,
    queries: [
      { key: '1', label: 'Black Bean Burger', query: 'veggie burger restaurant', dishTerms: ['veggie burger'] },
      { key: '2', label: 'Falafel & Hummus Bowl', query: 'falafel restaurant', dishTerms: ['falafel'] }
    ]
  });

  check('alternatives-nearby answers 200', nearby.status === 200, `got ${nearby.status}`);

  const venues = Object.values(nearby.body.results || {}).flatMap((r) => r.venues || []);
  check('venues came back', venues.length > 0, `got ${venues.length}`);

  const live = nearby.body.source === 'google';
  console.log(`  (source: ${nearby.body.source})`);

  const withPhoto = venues.filter((v) => v.photo && v.photo.name);
  if (live) {
    check('live venues carry a photo reference', withPhoto.length > 0,
      'no venue had photo.name — is places.photos in the field mask?');
    check('photo references match the documented shape',
      withPhoto.every((v) => /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(v.photo.name)),
      'a name would be rejected by the proxy');
    check('at least one photo carries an author attribution',
      withPhoto.some((v) => v.photo.attribution),
      'Google requires attribution wherever the image is shown');
  } else {
    check('sample venues carry no photo', venues.every((v) => v.photo === null),
      'a fallback venue must not show a real photo');
  }

  check('raw reviews are still stripped from the response',
    venues.every((v) => v._reviews === undefined));

  console.log('\n=== /api/place-photo proxy ===');

  if (withPhoto.length) {
    const name = withPhoto[0].photo.name;
    const image = await fetch(`${BASE}/api/place-photo?name=${encodeURIComponent(name)}&maxWidth=400`);
    const bytes = Buffer.from(await image.arrayBuffer());
    check('a real reference returns an image', image.status === 200, `got ${image.status}`);
    check('content type is an image', String(image.headers.get('content-type')).startsWith('image/'),
      String(image.headers.get('content-type')));
    check('body looks like a JPEG/PNG', bytes.length > 1000 &&
      (bytes[0] === 0xff || bytes[0] === 0x89), `${bytes.length} bytes`);
    check('cached for a day (every hit is a billable Place Photos call)',
      /max-age=86400/.test(String(image.headers.get('cache-control'))),
      String(image.headers.get('cache-control')));
    check('the API key never appears in a client-facing URL',
      !JSON.stringify(nearby.body).includes('key='));
  } else {
    console.log('  SKIP  no live photo reference to fetch');
  }

  // Anything that is not a Google-issued reference must not reach the upstream.
  for (const bad of ['../../etc/passwd', 'https://evil.example.com/x', 'places/x/photos/y/../z', '']) {
    const response = await fetch(`${BASE}/api/place-photo?name=${encodeURIComponent(bad)}`);
    check(`rejects name "${bad || '(empty)'}" with 400`, response.status === 400, `got ${response.status}`);
  }

  const bogus = await fetch(`${BASE}/api/place-photo?name=places/AAA/photos/BBB`);
  check('well-formed but unknown reference returns 502 (client swaps in a tile)',
    bogus.status === 502, `got ${bogus.status}`);

  console.log('\n=== /api/food-photos (Unsplash) ===');

  const missing = await postJson('/api/food-photos', {});
  check('names[] is required', missing.status === 400, `got ${missing.status}`);

  const capped = await postJson('/api/food-photos', {
    names: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
  });
  check('caps the batch at 8', Object.keys(capped.body.photos).length === 8,
    `got ${Object.keys(capped.body.photos).length}`);

  const names = ['Black Bean Burger', 'Falafel & Hummus Bowl'];
  const photos = await postJson('/api/food-photos', { names });
  check('food-photos answers 200', photos.status === 200, `got ${photos.status}`);
  check('every requested name is answered',
    names.every((n) => photos.body.photos[n]),
    Object.keys(photos.body.photos).join(', '));

  console.log(`  (configured: ${photos.body.configured})`);

  // In "flaky" mode the first ask for every food is a 403 on purpose, so the
  // success assertions below would be measuring the stub, not the server.
  if (process.env.EXPECT_FLAKY) {
    console.log('  SKIP  success-path assertions (stub is in flaky mode)');
  } else if (!photos.body.configured) {
    check('unconfigured key reports reason "no-key", not an error',
      names.every((n) => photos.body.photos[n].reason === 'no-key'));
    check('no photo URL is invented when there is no key',
      names.every((n) => !photos.body.photos[n].url));
  } else {
    const first = photos.body.photos[names[0]];
    const usable = Object.values(photos.body.photos).filter((p) => p.ok);
    check('a photo came back', usable.length > 0, JSON.stringify(first).slice(0, 200));

    if (usable.length) {
      check('images are hotlinked from images.unsplash.com, as Unsplash requires',
        usable.every((p) => p.url.startsWith('https://images.unsplash.com/')),
        usable[0].url);
      check('the size the card needs is requested, not the full-size original',
        usable.every((p) => p.url.includes('w=400') && p.url.includes('fit=crop')),
        usable[0].url);
      check('the original ixid is preserved',
        usable.every((p) => p.url.includes('ixid=')), usable[0].url);
      check('photographer is named', usable.every((p) => p.photographer), usable[0].photographer);
      check('photographer link carries the referral UTM',
        usable.every((p) => /utm_source=SustainEat&utm_medium=referral/.test(p.photographerUrl)),
        usable[0].photographerUrl);
      check('Unsplash itself is linked with the UTM',
        usable.every((p) => /unsplash\.com\/\?utm_source=SustainEat/.test(p.unsplashUrl)),
        usable[0].unsplashUrl);
      check('alt text is present for screen readers', usable.every((p) => p.alt));
      // Not an assertion against the real API: two dishes can legitimately
      // share a top result there. It is worth seeing, not worth failing on.
      if (new Set(usable.map((p) => p.url)).size !== usable.length) {
        console.log('  NOTE  two foods resolved to the same photo (fine against the real API)');
      }
    }

    // The hourly demo limit is 50 requests, so a repeat search must not spend
    // more of it. A cached answer is identical and costs nothing.
    const again = await postJson('/api/food-photos', { names });
    check('a repeat request is served from cache (identical payload)',
      JSON.stringify(again.body.photos) === JSON.stringify(photos.body.photos),
      'cache miss would burn the 50/hour demo limit');
  }

  // Run with the stub in "flaky" mode: the first ask for each food is a 403.
  // A cached failure would blank that food until the server restarted, which on
  // a 50/hour demo limit is exactly how this feature would die on stage.
  if (process.env.EXPECT_FLAKY) {
    console.log('=== a rate-limit blip must not be cached ===');
    const food = ['Sorbet Cup'];
    const first = await postJson('/api/food-photos', { names: food });
    check('first ask reports the limit rather than pretending',
      first.body.photos[food[0]].reason === 'rate-limited',
      JSON.stringify(first.body.photos[food[0]]));

    const retry = await postJson('/api/food-photos', { names: food });
    check('the very next ask succeeds — the failure was not cached',
      retry.body.photos[food[0]].ok === true,
      JSON.stringify(retry.body.photos[food[0]]));

    const third = await postJson('/api/food-photos', { names: food });
    check('and the success is cached',
      JSON.stringify(third.body.photos) === JSON.stringify(retry.body.photos));
  }

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nverify-photos could not run:', err.message);
  console.error('Is the backend up? cd server && npm start\n');
  process.exit(1);
});
