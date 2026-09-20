const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');

const FAKE = `
window.__fake = { maps: 0, markers: [], infoWindows: 0, infoOpen: 0, infoClose: 0, fitBounds: 0, panTo: 0, infoContent: null, zoomSet: [] };
window.google = { maps: {
  Map: class {
    constructor(el, opts) { this.el = el; this._zoom = opts.zoom; el.setAttribute("data-fake-map", "1"); window.__fake.maps++; this.center = opts.center; }
    fitBounds() { window.__fake.fitBounds++; }
    getZoom() { return this._zoom; }
    setZoom(z) { this._zoom = z; window.__fake.zoomSet.push(z); }
    panTo() { window.__fake.panTo++; }
  },
  Marker: class {
    constructor(o) { this.o = o; this._l = {}; window.__fake.markers.push({ label: o.label, title: o.title, position: o.position, hasIcon: !!o.icon }); }
    addListener(ev, fn) { this._l[ev] = fn; }
    setMap() {}
    getPosition() { return this.o.position; }
  },
  InfoWindow: class {
    constructor() { window.__fake.infoWindows++; }
    setContent(c) { window.__fake.infoContent = c && c.innerText ? c.innerText : String(c); }
    open() { window.__fake.infoOpen++; }
    close() { window.__fake.infoClose++; }
  },
  LatLngBounds: class { extend() {} },
  SymbolPath: { CIRCLE: 0 },
  event: {
    addListenerOnce: (m, e, fn) => setTimeout(fn, 0),
    trigger: (m, e) => { if (m && m._l && m._l[e]) m._l[e](); }
  }
}};
`;

async function run(mode) {
  const pageErrors = [];
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--no-sandbox'],
  });
  await browser.defaultBrowserContext().overridePermissions('http://localhost:5000', ['geolocation']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

  // Never let the real Maps script run in either mode: in "stub" it would
  // clobber the fake, in "fallback" it just wastes time and 403s.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('maps.googleapis.com/maps/api/js')) {
      // In stub mode play the part of a healthy Maps script: the fake google
      // object is already installed, so just fire the callback the loader
      // registered. In fallback mode fail it, which is what an unusable key
      // effectively does.
      if (mode === 'stub') {
        return req.respond({ status: 200, contentType: 'application/javascript', body: 'initGoogleMaps();' });
      }
      return req.abort();
    }
    req.continue();
  });

  if (mode === 'stub') await page.evaluateOnNewDocument(FAKE);

  await page.goto('http://localhost:5000', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.search-input', { timeout: 45000 });
  await page.type('.search-input', 'beef burger');
  await page.click('.hero .btn-primary');
  await page.waitForSelector('.alt-card', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));

  console.log(`\n========== mode: ${mode} ==========`);

  if (mode === 'fallback') {
    const out = await page.evaluate(() => ({
      gmapsState: window.__gmapsState,
      hasGoogleMap: !!document.querySelector('.google-map'),
      hasCssMap: !!document.querySelector('.mini-map:not(.is-google)'),
      cssPins: document.querySelectorAll('.mini-map-pin').length,
      rows: document.querySelectorAll('.restaurant-row').length,
      notice: [...document.querySelectorAll('.notice')].map((n) => n.innerText.trim()),
      details: document.querySelector('.details-panel h3')?.innerText,
    }));
    console.log('  gmapsState:', out.gmapsState);
    console.log('  google map rendered:', out.hasGoogleMap, '(want false)');
    console.log('  built-in map rendered:', out.hasCssMap, '(want true) pins:', out.cssPins, 'rows:', out.rows);
    const hasNotice = out.notice.some((n) => /Maps JavaScript API/i.test(n));
    console.log('  fallback notice shown:', hasNotice);
    console.log('  notice:', out.notice.find((n) => /Maps JavaScript API/i.test(n)) || '(none)');

    // Selection must still work through the built-in map.
    await page.evaluate(() => [...document.querySelectorAll('.mini-map-pin')][1].click());
    await new Promise((r) => setTimeout(r, 400));
    const after = await page.evaluate(() => document.querySelector('.details-panel h3')?.innerText);
    console.log(`  clicking built-in pin 2: "${out.details}" -> "${after}"  changed:`, out.details !== after);
    await page.screenshot({ path: path.join(SHOTS, '27-gmaps-fallback.png'), fullPage: true });
  }

  if (mode === 'stub') {
    const built = await page.evaluate(() => ({
      hasGoogleMap: !!document.querySelector('.google-map'),
      fakeMapEl: !!document.querySelector('[data-fake-map]'),
      maps: window.__fake.maps,
      markers: window.__fake.markers,
      infoWindows: window.__fake.infoWindows,
      fitBounds: window.__fake.fitBounds,
      zoomSet: window.__fake.zoomSet,
      debugCount: window.__mapDebug && window.__mapDebug.markerCount,
      rows: document.querySelectorAll('.restaurant-row').length,
      cssMapStillThere: !!document.querySelector('.mini-map:not(.is-google)'),
    }));
    const venueMarkers = built.markers.filter((m) => m.label);
    const userMarker = built.markers.find((m) => !m.label && m.hasIcon);
    console.log('  .google-map rendered:', built.hasGoogleMap, '| Map constructed:', built.maps);
    console.log('  built-in CSS map still present:', built.cssMapStillThere, '(want false)');
    console.log('  user marker (icon, no label):', !!userMarker, userMarker ? JSON.stringify(userMarker.position) : '');
    console.log('  venue markers:', venueMarkers.length, '| labels:', JSON.stringify(venueMarkers.map((m) => m.label.text)));
    console.log('  venue marker titles:', JSON.stringify(venueMarkers.map((m) => m.title)));
    console.log('  markers match venue rows:', venueMarkers.length === built.rows);
    console.log('  fitBounds called:', built.fitBounds, '| zoom clamped to:', JSON.stringify(built.zoomSet));
    console.log('  real lat/lng used:', JSON.stringify(venueMarkers.map((m) => m.position)).slice(0, 160));

    // Clicking a marker must drive the same selection the rows do.
    const before = await page.evaluate(() => document.querySelector('.details-panel h3')?.innerText);
    await page.evaluate(() => window.__mapDebug.click(1));
    await new Promise((r) => setTimeout(r, 500));
    const after = await page.evaluate(() => ({
      details: document.querySelector('.details-panel h3')?.innerText,
      activeRow: document.querySelector('.restaurant-row.active .restaurant-name')?.innerText,
      infoOpen: window.__fake.infoOpen,
      infoContent: window.__fake.infoContent,
      panTo: window.__fake.panTo,
    }));
    console.log(`\n  marker 2 clicked: details "${before}" -> "${after.details}"  changed:`, before !== after.details);
    console.log('  active row now:', after.activeRow);
    console.log('  InfoWindow opened:', after.infoOpen > 0, '| panTo:', after.panTo);
    console.log('  InfoWindow content:');
    String(after.infoContent || '').split('\n').forEach((l) => l.trim() && console.log('      ' + l.trim()));

    const c = String(after.infoContent || '');
    console.log('  info names the venue:', c.includes(after.activeRow || '@@'));
    console.log('  info has an address:', /\d|Ave|St|Rd|Boston|Cambridge/i.test(c));
    console.log('  info uses only the two honest shapes:',
      c.split('\n').filter((l) => /in reviews|may serve/.test(l)).length > 0);
  }

  console.log('  page errors:', pageErrors.length, pageErrors.slice(0, 3));
  await browser.close();
}

(async () => {
  await run('fallback');
  await run('stub');
  console.log('\nDONE');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
