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

  const food = process.argv[2] || 'cheesecake';
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.search-input', { timeout: 45000 });
  await page.type('.search-input', food);
  await page.click('.hero .btn-primary');
  await page.waitForSelector('.results-page', { timeout: 60000 });
  await page.waitForSelector('.alt-card', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  console.log('=== search: "' + food + '" ===');

  console.log('\n--- 1. every alternative card carries a venue verdict ---');
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.alt-card')].map((c) => ({
      name: c.querySelector('.alt-name')?.innerText,
      venueLine: c.querySelector('.alt-venue')?.innerText || '(MISSING)',
      unavailable: c.classList.contains('unavailable'),
      ariaDisabled: c.getAttribute('aria-disabled'),
      active: c.classList.contains('active'),
    }))
  );
  for (const c of cards) {
    console.log('  ' + (c.unavailable ? 'UNAVAIL' : 'OK     ') + ' ' +
      String(c.name).padEnd(32) + '"' + c.venueLine + '"' + (c.active ? '  [selected]' : ''));
  }
  console.log('  cards with no venue verdict:', cards.filter((c) => c.venueLine === '(MISSING)').length, '(want 0)');
  console.log('  unavailable cards carry aria-disabled:',
    cards.filter((c) => c.unavailable).every((c) => c.ariaDisabled === 'true'));

  console.log('\n--- 2. "Where to get them" is grouped by venue ---');
  const section = await page.evaluate(() => ({
    headings: [...document.querySelectorAll('.panel-header h3')].map((h) => h.innerText),
    pins: document.querySelectorAll('.mini-map-pin').length,
    rows: [...document.querySelectorAll('.restaurant-row')].map((r) => ({
      n: r.querySelector('.restaurant-index')?.innerText,
      venue: r.querySelector('.restaurant-name')?.innerText,
      serves: r.querySelector('.restaurant-serves')?.innerText,
    })),
  }));
  console.log('  headings:', JSON.stringify(section.headings));
  console.log('  pins:', section.pins, '| venue rows:', section.rows.length);
  for (const r of section.rows) console.log('    ' + r.n + '. ' + r.venue + '  —  ' + r.serves);
  console.log('  pins == rows:', section.pins === section.rows.length);

  console.log('\n--- 3. every available card resolves to a listed venue ---');
  const crossCheck = await page.evaluate(() => {
    const avail = [...document.querySelectorAll('.alt-card')].filter((c) => !c.classList.contains('unavailable'));
    const rows = [...document.querySelectorAll('.restaurant-row')].map((r) => ({
      venue: r.querySelector('.restaurant-name')?.innerText || '',
      serves: r.querySelector('.restaurant-serves')?.innerText || '',
    }));
    return avail.map((c) => {
      const foodName = c.querySelector('.alt-name')?.innerText || '';
      const cardVenue = (c.querySelector('.alt-venue')?.innerText || '')
        .replace(/ \u2022 [\d.]+ mi$/, '').replace(/^Reviewers mention \u201c.*\u201d at /, '').replace(/^.* nearby \u2014 /, '').replace(/^Sample location \u2014 /, '').replace(/^Available at /, '');
      // Rows are grouped by venue now, so find this card's venue wherever it is.
      const row = rows.find((r) => r.venue === cardVenue);
      return { food: foodName, cardVenue, found: !!row, servesMatch: !!row && row.serves.includes(foodName) };
    });
  });
  for (const c of crossCheck) {
    console.log('  ' + (c.found && c.servesMatch ? 'OK  ' : 'FAIL') + ' ' +
      String(c.food).padEnd(30) + 'venue="' + c.cardVenue + '" listed=' + c.found + ' rowNamesThisFood=' + c.servesMatch);
  }
  console.log('  all available cards traceable to a venue row:',
    crossCheck.every((c) => c.found && c.servesMatch));

  console.log('\n--- 4. selecting a venue pin selects a food it actually serves ---');
  const pinSync = await page.evaluate(() => {
    const pins = [...document.querySelectorAll('.mini-map-pin')];
    if (pins.length < 2) return null;
    pins[1].click();
    return null;
  });
  await new Promise((r) => setTimeout(r, 400));
  const afterPin = await page.evaluate(() => {
    const activeRow = document.querySelector('.restaurant-row.active');
    return {
      detailsPanel: document.querySelector('.details-panel h3')?.innerText,
      activeRowVenue: activeRow?.querySelector('.restaurant-name')?.innerText,
      activeRowServes: activeRow?.querySelector('.restaurant-serves')?.innerText,
      activeCard: document.querySelector('.alt-card.active .alt-name')?.innerText,
    };
  });
  console.log('  ' + JSON.stringify(afterPin));
  console.log('  selected food is served by the selected venue:',
    !!afterPin.activeRowServes && !!afterPin.detailsPanel && afterPin.activeRowServes.includes(afterPin.detailsPanel));

  console.log('\n--- 5. checkout names the venue from the SELECTED card ---');
  const chosen = await page.evaluate(() => {
    const c = document.querySelector('.alt-card.active');
    return { food: c?.querySelector('.alt-name')?.innerText, venueLine: c?.querySelector('.alt-venue')?.innerText };
  });
  console.log('  selected card:', JSON.stringify(chosen));
  await page.click('.details-panel .btn-checkout');
  await page.waitForSelector('.checkout-page', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 600));
  const checkout = await page.evaluate(() =>
    [...document.querySelectorAll('.order-line')].map((l) => l.innerText.replace(/\n/g, ' | '))
  );
  console.log('  order lines:', JSON.stringify(checkout, null, 1));
  await page.screenshot({ path: path.join(SHOTS, '18-checkout-venue.png'), fullPage: true });

  await page.click('.checkout-page .btn-checkout');
  await page.waitForSelector('.confirm-card', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  const confirm = await page.evaluate(() => document.querySelector('.confirm-sub')?.innerText);
  console.log('  confirmation:', confirm);
  const venueName = (chosen.venueLine || '')
    .replace(/ \u2022 [\d.]+ mi$/, '').replace(/^Reviewers mention \u201c.*\u201d at /, '').replace(/^.* nearby \u2014 /, '').replace(/^Sample location \u2014 /, '').replace(/^Available at /, '');
  console.log('  confirmation names the selected card venue:', confirm?.includes(venueName), '("' + venueName + '")');

  console.log('\npage errors:', pageErrors.length, pageErrors.slice(0, 4));
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAILED:', e.message); console.error(pageErrors.slice(0, 4)); process.exit(1); });
