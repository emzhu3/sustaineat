const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');
const pageErrors = [];

(async () => {
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

  await page.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.search-input', { timeout: 45000 });
  await page.type('.search-input', 'beef burger');
  await page.click('.hero .btn-primary');
  await page.waitForSelector('.map-and-list', { timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3000));

  console.log('=== 1. map / list parity ===');
  const parity = await page.evaluate(() => ({
    pins: document.querySelectorAll('.mini-map-pin').length,
    rows: document.querySelectorAll('.restaurant-row').length,
    pinNumbers: [...document.querySelectorAll('.pin-dot')].map((d) => d.innerText.trim()),
    rowNumbers: [...document.querySelectorAll('.restaurant-index')].map((d) => d.innerText.trim()),
    rowNames: [...document.querySelectorAll('.restaurant-name')].map((d) => d.innerText.trim()),
  }));
  console.log(JSON.stringify(parity, null, 1));
  console.log('  parity OK:', parity.pins === parity.rows && JSON.stringify(parity.pinNumbers) === JSON.stringify(parity.rowNumbers));

  console.log('\n=== 2. how many labels are visible at rest? ===');
  const atRest = await page.evaluate(() =>
    [...document.querySelectorAll('.mini-map-pin')].map((p) => ({
      n: p.querySelector('.pin-dot').innerText.trim(),
      active: p.classList.contains('active'),
      opacity: getComputedStyle(p.querySelector('.pin-label')).opacity,
    }))
  );
  const visible = atRest.filter((l) => Number(l.opacity) > 0.01);
  console.log('  ' + JSON.stringify(atRest));
  console.log('  visible labels:', visible.length, '(want exactly 1, the selected pin)');

  console.log('\n=== 3. click each pin: label shows, and stays inside the map ===');
  const n = parity.pins;
  for (let i = 1; i <= n; i++) {
    const r = await page.evaluate((idx) => {
      const pins = [...document.querySelectorAll('.mini-map-pin')];
      const pin = pins[idx - 1];
      pin.click();
      return null;
    }, i);
    await new Promise((res) => setTimeout(res, 250));
    const check = await page.evaluate((idx) => {
      const map = document.querySelector('.mini-map').getBoundingClientRect();
      const pin = [...document.querySelectorAll('.mini-map-pin')][idx - 1];
      const label = pin.querySelector('.pin-label');
      const lr = label.getBoundingClientRect();
      const visibleCount = [...document.querySelectorAll('.pin-label')]
        .filter((l) => Number(getComputedStyle(l).opacity) > 0.01).length;
      return {
        active: pin.classList.contains('active'),
        edgeClass: [...pin.classList].filter((c) => c.startsWith('edge-')).join('') || '-',
        opacity: getComputedStyle(label).opacity,
        insideLeft: lr.left >= map.left - 0.5,
        insideRight: lr.right <= map.right + 0.5,
        insideBottom: lr.bottom <= map.bottom + 0.5,
        text: label.innerText.trim().slice(0, 34),
        visibleCount,
      };
    }, i);
    const ok = check.active && Number(check.opacity) > 0.9 && check.insideLeft && check.insideRight && check.insideBottom && check.visibleCount === 1;
    console.log(`  pin ${i}: ${ok ? 'OK ' : 'FAIL'} edge=${check.edgeClass} op=${check.opacity} inside=[L${check.insideLeft?'y':'N'} R${check.insideRight?'y':'N'} B${check.insideBottom?'y':'N'}] visible=${check.visibleCount} "${check.text}"`);
  }

  console.log('\n=== 4. selecting a pin selects the matching row ===');
  const sync = await page.evaluate(() => {
    const activeRow = document.querySelector('.restaurant-row.active');
    const activePin = document.querySelector('.mini-map-pin.active');
    return {
      rowNumber: activeRow?.querySelector('.restaurant-index')?.innerText.trim(),
      pinNumber: activePin?.querySelector('.pin-dot')?.innerText.trim(),
      rowName: activeRow?.querySelector('.restaurant-name')?.innerText.trim(),
    };
  });
  console.log('  ' + JSON.stringify(sync), '=> match:', sync.rowNumber === sync.pinNumber);

  const el = await page.$('.map-and-list');
  await el.screenshot({ path: path.join(SHOTS, '14-map-fixed.png') });
  console.log('\n[shot] 14-map-fixed.png');

  // Hover-only reveal, with nothing selected nearby.
  await page.hover('.mini-map-pin:nth-of-type(4)');
  await new Promise((r) => setTimeout(r, 300));
  await el.screenshot({ path: path.join(SHOTS, '15-map-hover.png') });
  console.log('[shot] 15-map-hover.png');

  console.log('\npage errors:', pageErrors.length, pageErrors.slice(0, 4));
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAILED:', e.message); console.error(pageErrors.slice(0, 4)); process.exit(1); });
