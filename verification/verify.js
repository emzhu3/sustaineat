const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5000';
const SHOTS = path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

const consoleMsgs = [];
const pageErrors = [];
const failedReqs = [];

function log(...a) { console.log(...a); }

async function shot(page, name) {
  const p = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: p, fullPage: true });
  log(`  [shot] ${name}.png`);
}

// Wait for any one of several selectors; returns the one that matched.
async function waitAny(page, selectors, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const s of selectors) {
      if (await page.$(s)) return s;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('none of these appeared: ' + selectors.join(', '));
}

async function textOf(page, sel) {
  const el = await page.$(sel);
  if (!el) return null;
  return (await page.evaluate((e) => e.innerText, el)).trim();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ['geolocation']);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });

  page.on('console', (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('requestfailed', (r) =>
    failedReqs.push(`${r.url().slice(0, 100)} — ${r.failure()?.errorText}`)
  );

  log('\n=== STAGE 1: load landing page (1280x800) ===');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });

  // Gate: did React + Babel actually boot? Everything downstream depends on this.
  await page.waitForFunction(
    () => window.React && document.getElementById('root') && document.getElementById('root').children.length > 0,
    { timeout: 45000 }
  );
  const boot = await page.evaluate(() => ({
    react: !!window.React,
    reactVersion: window.React ? window.React.version : null,
    babel: !!window.Babel,
    rootChildren: document.getElementById('root').children.length,
  }));
  log('  boot:', JSON.stringify(boot));

  await page.waitForSelector('.search-input', { timeout: 20000 });
  log('  landing heading:', await textOf(page, '.hero h2'));
  await shot(page, '01-landing-desktop');

  // Does the cream/green theme actually apply, or is styles.css missing?
  const theme = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    const btn = document.querySelector('.btn-primary');
    return {
      bodyBg: b.backgroundColor,
      bodyFont: b.fontFamily.slice(0, 40),
      btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
      styleSheets: document.styleSheets.length,
    };
  });
  log('  theme:', JSON.stringify(theme));

  log('\n=== STAGE 2: search "beef burger", diet None ===');
  await page.type('.search-input', 'beef burger');
  await page.click('.btn-primary');

  const landed = await waitAny(page, ['.alt-grid', '.empty-note', '.results-page'], 45000);
  log('  results matched on:', landed);
  await page.waitForSelector('.savings-hero, .badge-value, .panel', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500)); // let restaurants + map settle

  const badge = await textOf(page, '.badge-value').catch(() => null);
  const mealTitle = await textOf(page, '.meal-title').catch(() => null);
  log('  meal:', mealTitle, '| badge:', badge);

  const altInfo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.alt-card')];
    return cards.map((c) => ({
      name: c.querySelector('.alt-name')?.innerText,
      carbon: c.querySelector('.alt-carbon')?.innerText,
      save: c.querySelector('.alt-save')?.innerText,
      price: c.querySelector('.alt-price')?.innerText,
      w: Math.round(c.getBoundingClientRect().width),
      h: Math.round(c.getBoundingClientRect().height),
    }));
  });
  log('  alternatives:', JSON.stringify(altInfo, null, 1));

  // Grid layout: are cards in a real multi-column grid, or stacked/overflowing?
  const gridInfo = await page.evaluate(() => {
    const g = document.querySelector('.alt-grid');
    if (!g) return null;
    const cs = getComputedStyle(g);
    const cards = [...g.querySelectorAll('.alt-card')].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    });
    const rows = new Set(cards.map((c) => c.y));
    return {
      display: cs.display,
      cols: cs.gridTemplateColumns,
      cardCount: cards.length,
      distinctRows: rows.size,
      gridWidth: Math.round(g.getBoundingClientRect().width),
      overflowsViewport: g.getBoundingClientRect().right > window.innerWidth + 1,
    };
  });
  log('  alt-grid:', JSON.stringify(gridInfo));

  // Map pins: separation and bounds under real CSS (jsdom applies none).
  const pinInfo = await page.evaluate(() => {
    const map = document.querySelector('.mini-map');
    if (!map) return null;
    const mr = map.getBoundingClientRect();
    const pins = [...map.querySelectorAll('.pin-dot')].map((p) => {
      const r = p.getBoundingClientRect();
      return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
    });
    let minDist = Infinity;
    for (let i = 0; i < pins.length; i++)
      for (let j = i + 1; j < pins.length; j++)
        minDist = Math.min(minDist, Math.hypot(pins[i].cx - pins[j].cx, pins[i].cy - pins[j].cy));
    const inside = pins.every((p) => p.cx >= mr.x - 2 && p.cx <= mr.right + 2 && p.cy >= mr.y - 2 && p.cy <= mr.bottom + 2);
    return {
      mapW: Math.round(mr.width), mapH: Math.round(mr.height),
      pinCount: pins.length,
      minPinSeparationPx: pins.length > 1 ? Math.round(minDist) : null,
      allPinsInsideMap: inside,
    };
  });
  log('  mini-map:', JSON.stringify(pinInfo));

  const notices = await page.evaluate(() =>
    [...document.querySelectorAll('.notice')].map((n) => n.innerText.trim())
  );
  log('  notices:', JSON.stringify(notices));

  await shot(page, '02-results-desktop');

  log('\n=== STAGE 3: pick restaurant + alternative ===');
  if (await page.$('.restaurant-row')) {
    await page.click('.restaurant-row');
    log('  picked restaurant:', await textOf(page, '.restaurant-row.active .restaurant-name'));
  }
  await page.click('.alt-card');
  await page.waitForSelector('.details-panel', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 900)); // slide-in animation
  log('  details panel:', await textOf(page, '.details-panel h3'));
  const nutrition = await page.evaluate(() =>
    [...document.querySelectorAll('.details-panel .nutrition-item')].map((n) => n.innerText.replace(/\n/g, ' '))
  );
  log('  nutrition:', JSON.stringify(nutrition));
  await shot(page, '03-alt-selected-desktop');

  log('\n=== STAGE 4: checkout ===');
  await page.click('.details-panel .btn-checkout');
  await page.waitForSelector('.checkout-page', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  const orderLines = await page.evaluate(() =>
    [...document.querySelectorAll('.order-line')].map((l) => l.innerText.replace(/\n/g, ' | '))
  );
  log('  order lines:', JSON.stringify(orderLines, null, 1));
  log('  savings banner:', await textOf(page, '.savings-banner'));
  await shot(page, '04-checkout-desktop');

  log('\n=== STAGE 5: place order ===');
  await page.click('.checkout-page .btn-checkout');
  await page.waitForSelector('.confirm-card', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  log('  confirm:', await textOf(page, '.confirm-card h2'));
  log('  sub:', await textOf(page, '.confirm-sub'));
  log('  saved:', await textOf(page, '.savings-hero'));
  log('  equiv:', await textOf(page, '.confirm-equiv'));
  await shot(page, '05-confirmation-desktop');

  log('\n=== STAGE 6: back home, re-search as Vegan ===');
  await page.click('.confirm-card .btn-primary');
  await page.waitForSelector('.search-input', { timeout: 15000 });
  await page.select('.customization select', 'vegan');
  await page.type('.search-input', 'beef burger');
  await page.click('.hero .btn-primary');
  await waitAny(page, ['.alt-grid', '.empty-note'], 45000);
  await new Promise((r) => setTimeout(r, 2500));
  const veganAlts = await page.evaluate(() =>
    [...document.querySelectorAll('.alt-card')].map((c) => ({
      name: c.querySelector('.alt-name')?.innerText,
      tags: [...c.querySelectorAll('.tag')].map((t) => t.innerText),
    }))
  );
  log('  vegan alternatives:', JSON.stringify(veganAlts));
  const meaty = veganAlts.filter((a) =>
    /\b(beef|chicken|pork|bacon|cheese|dairy|eggs?|fish|salmon|tuna|turkey|lamb|milk)\b/i.test(a.name)
  );
  log('  MEAT/DAIRY LEAKING INTO VEGAN:', meaty.length === 0 ? 'none ✓' : JSON.stringify(meaty));
  await shot(page, '06-vegan-results-desktop');

  log('\n=== STAGE 7: mobile 375x812 ===');
  const m = await browser.newPage();
  await m.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });
  m.on('pageerror', (e) => pageErrors.push('[mobile] ' + String(e.message || e)));
  await m.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await m.waitForSelector('.search-input', { timeout: 45000 });
  await shot(m, '07-landing-mobile');

  await m.type('.search-input', 'beef burger');
  await m.click('.hero .btn-primary');
  await waitAny(m, ['.alt-grid', '.empty-note'], 45000);
  await new Promise((r) => setTimeout(r, 2500));

  const mobileLayout = await m.evaluate(() => {
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    const offenders = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > winW + 2) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && el.className.toString().slice(0, 45)) || '',
          right: Math.round(r.right),
        });
      }
    });
    const g = document.querySelector('.alt-grid');
    return {
      docScrollWidth: docW,
      windowWidth: winW,
      horizontalOverflow: docW > winW + 2,
      offenders: offenders.slice(0, 8),
      altGridCols: g ? getComputedStyle(g).gridTemplateColumns : null,
    };
  });
  log('  mobile layout:', JSON.stringify(mobileLayout, null, 1));
  await shot(m, '08-results-mobile');

  log('\n=== CONSOLE / ERRORS ===');
  const errs = consoleMsgs.filter((c) => c.startsWith('error'));
  const warns = consoleMsgs.filter((c) => c.startsWith('warning'));
  log('  console errors:', errs.length, errs.length ? JSON.stringify(errs.slice(0, 10), null, 1) : '');
  log('  console warnings:', warns.length, warns.length ? JSON.stringify(warns.slice(0, 10), null, 1) : '');
  log('  page errors:', pageErrors.length, pageErrors.length ? JSON.stringify(pageErrors.slice(0, 10), null, 1) : '');
  log('  failed requests:', failedReqs.length, failedReqs.length ? JSON.stringify(failedReqs.slice(0, 10), null, 1) : '');

  await browser.close();
  log('\nDONE');
})().catch(async (e) => {
  console.error('\n!!! VERIFY FAILED:', e.message);
  console.error('console tail:', JSON.stringify(consoleMsgs.slice(-15), null, 1));
  console.error('pageErrors:', JSON.stringify(pageErrors.slice(-10), null, 1));
  console.error('failedReqs:', JSON.stringify(failedReqs.slice(-10), null, 1));
  process.exit(1);
});
