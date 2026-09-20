const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');

const pageErrors = [];
const consoleErrors = [];

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
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.search-input', { timeout: 45000 });

  console.log('=== Babel compiled the edited file? ===');
  console.log(JSON.stringify(await page.evaluate(() => ({
    react: !!window.React,
    rootChildren: document.getElementById('root').children.length,
    ingredientLabelFor: typeof ingredientLabelFor,
    FORMAT_CHIP_LABELS: typeof FORMAT_CHIP_LABELS,
  }))));

  console.log('\n=== Logic unchanged? (ingredient key + carbon) ===');
  const logic = await page.evaluate(() => {
    const foods = ['cheesecake', 'pizza', 'beef burger', 'latte', 'ice cream', 'apple pie', 'ramen', 'pancakes'];
    return foods.map((f) => ({
      food: f,
      ingredient: classifyIngredient(f),
      carbon: getCarbonScore(classifyIngredient(f)),
      format: classifyFormat(f),
      chipLabel: ingredientLabelFor(f, classifyIngredient(f)),
      formatChip: FORMAT_CHIP_LABELS[classifyFormat(f)],
    }));
  });
  console.log('food'.padEnd(14) + 'ingredient'.padEnd(12) + 'carbon'.padEnd(8) + 'chip1'.padEnd(14) + 'chip2');
  console.log('-'.repeat(62));
  for (const r of logic) {
    console.log(String(r.food).padEnd(14) + String(r.ingredient).padEnd(12) + String(r.carbon).padEnd(8) + String(r.chipLabel).padEnd(14) + r.formatChip);
  }

  // End-to-end through the real UI for three representative foods.
  for (const [food, file] of [['cheesecake', '11-chips-cheesecake'], ['pizza', '12-chips-pizza'], ['beef burger', '13-chips-beefburger']]) {
    console.log(`\n=== UI: search "${food}" ===`);
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });
    await p.setCacheEnabled(false);
    p.on('pageerror', (e) => pageErrors.push(`[${food}] ` + String(e.message || e)));
    await p.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
    await p.waitForSelector('.search-input', { timeout: 45000 });
    await p.type('.search-input', food);
    await p.click('.hero .btn-primary');
    await p.waitForSelector('.results-page', { timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));
    const ui = await p.evaluate(() => ({
      title: document.querySelector('.meal-title')?.innerText,
      chips: [...document.querySelectorAll('.meta-row .chip')].map((c) => c.innerText),
      badge: document.querySelector('.badge-value')?.innerText,
      heading: document.querySelector('.panel-header h3')?.innerText,
    }));
    console.log('  ' + JSON.stringify(ui));
    await p.screenshot({ path: path.join(SHOTS, file + '.png'), fullPage: true });
    console.log('  [shot]', file + '.png');
    await p.close();
  }

  console.log('\n=== errors ===');
  console.log('  page errors:', pageErrors.length, pageErrors.slice(0, 5));
  console.log('  console errors:', consoleErrors.filter((e) => !/favicon|429/.test(e)).length,
    consoleErrors.filter((e) => !/favicon|429/.test(e)).slice(0, 5));

  await browser.close();
  console.log('\nDONE');
})().catch((e) => {
  console.error('FAILED:', e.message);
  console.error('pageErrors:', pageErrors.slice(0, 5));
  process.exit(1);
});
