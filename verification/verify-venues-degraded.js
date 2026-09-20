const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');

// Rewrites the /api/alternatives-nearby response so the degraded branches can
// be exercised — real Places data almost never returns zero hits.
async function run(label, mutate, shot) {
  const pageErrors = [];
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox'],
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:5000', ['geolocation']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    if (!req.url().includes('/api/alternatives-nearby')) return req.continue();
    try {
      const upstream = await fetch(req.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: req.postData(),
      });
      const body = await upstream.json();
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mutate(body)),
      });
    } catch (e) {
      req.abort();
    }
  });

  await page.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.search-input', { timeout: 45000 });
  await page.type('.search-input', 'cheesecake');
  await page.click('.hero .btn-primary');
  await page.waitForSelector('.results-page', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  const out = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.alt-card')].map((c) => ({
      name: c.querySelector('.alt-name')?.innerText,
      venue: c.querySelector('.alt-venue')?.innerText,
      unavailable: c.classList.contains('unavailable'),
      aria: c.getAttribute('aria-disabled'),
      active: c.classList.contains('active'),
    })),
    notice: [...document.querySelectorAll('.notice')].map((n) => n.innerText.trim()),
    rows: [...document.querySelectorAll('.restaurant-row .restaurant-name')].map((n) => n.innerText),
    emptyNotes: [...document.querySelectorAll('.empty-note')].map((n) => n.innerText.trim()),
    detailsPanel: document.querySelector('.details-panel h3')?.innerText || null,
    hasCheckoutBtn: !!document.querySelector('.details-panel .btn-checkout'),
  }));

  console.log(`\n===== ${label} =====`);
  for (const c of out.cards) {
    console.log(`  ${c.unavailable ? 'UNAVAIL' : 'OK     '} ${String(c.name).padEnd(30)} "${c.venue}"${c.active ? ' [selected]' : ''}${c.aria ? ' aria-disabled' : ''}`);
  }
  console.log('  "Where to get them" rows:', JSON.stringify(out.rows));
  if (out.notice.length) console.log('  notices:', JSON.stringify(out.notice));
  if (out.emptyNotes.length) console.log('  empty notes:', JSON.stringify(out.emptyNotes));
  console.log('  details panel:', out.detailsPanel, '| checkout button:', out.hasCheckoutBtn);

  // An unavailable card must not become selectable.
  const idx = out.cards.findIndex((c) => c.unavailable);
  if (idx !== -1) {
    const before = await page.evaluate(() => document.querySelector('.details-panel h3')?.innerText || null);
    await page.evaluate((i) => [...document.querySelectorAll('.alt-card')][i].click(), idx);
    await new Promise((r) => setTimeout(r, 400));
    const after = await page.evaluate(() => document.querySelector('.details-panel h3')?.innerText || null);
    console.log(`  click unavailable card -> details "${before}" => "${after}"  unchanged:`, before === after);
  }

  await page.screenshot({ path: path.join(SHOTS, shot), fullPage: true });
  console.log('  [shot]', shot, '| page errors:', pageErrors.length);
  await browser.close();
}

(async () => {
  // A. one alternative genuinely has nowhere nearby
  await run('A. one option unavailable', (body) => {
    const keys = Object.keys(body.results);
    body.results[keys[0]] = { source: 'google', venues: [] };
    return body;
  }, '19-forced-one-unavailable.png');

  // B. Places call failed -> sample locations
  await run('B. Places down (sample locations)', (body) => {
    body.source = 'fallback';
    body.notice = 'Showing sample pickup locations — the Google Places API is not enabled for this key yet.';
    for (const k of Object.keys(body.results)) {
      body.results[k] = {
        source: 'fallback',
        venues: [{ name: 'Green Fork Kitchen', address: 'Sample location', lat: 42.3631, lng: -71.0904, rating: 4.5, reviewCount: 120, priceLevel: '$$', mapsUrl: null, distance: 0.6 }],
      };
    }
    return body;
  }, '20-forced-fallback.png');

  // C. nothing nearby for anything
  await run('C. nothing available at all', (body) => {
    for (const k of Object.keys(body.results)) body.results[k] = { source: 'google', venues: [] };
    return body;
  }, '21-forced-none.png');

  console.log('\nDONE');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
