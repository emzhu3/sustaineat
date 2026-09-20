const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox'],
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:5000', ['geolocation']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });

  // Cache-bust hard, so this can never be a stale-asset story.
  await page.setCacheEnabled(false);
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.search-input', { timeout: 45000 });

  console.log('=== A. Are the classifier functions reachable in page scope? ===');
  const globals = await page.evaluate(() => ({
    classifyIngredient: typeof classifyIngredient,
    classifyFormat: typeof classifyFormat,
    termMatches: typeof termMatches,
    INGREDIENT_RULES: typeof INGREDIENT_RULES,
    PLANT_OVERRIDES: typeof PLANT_OVERRIDES,
  }));
  console.log(JSON.stringify(globals));

  console.log('\n=== B. Direct call on the LIVE code ===');
  const direct = await page.evaluate(() => ({
    ingredient: classifyIngredient('cheesecake'),
    format: classifyFormat('cheesecake'),
  }));
  console.log(JSON.stringify(direct));

  console.log('\n=== C. Rule-by-rule trace for "cheesecake" ===');
  const trace = await page.evaluate(() => {
    const value = 'cheesecake';
    const steps = [];
    for (const rule of PLANT_OVERRIDES) {
      const hits = rule.match.filter((t) => termMatches(value, t));
      steps.push({ table: 'PLANT_OVERRIDES', ingredient: rule.ingredient, hit: hits.length > 0, via: hits });
      if (hits.length) return { steps, winner: rule.ingredient };
    }
    for (const rule of INGREDIENT_RULES) {
      const hits = rule.match.filter((t) => termMatches(value, t));
      steps.push({ table: 'INGREDIENT_RULES', ingredient: rule.ingredient, hit: hits.length > 0, via: hits });
      if (hits.length) return { steps, winner: rule.ingredient };
    }
    return { steps, winner: 'vegetable (fallthrough)' };
  });
  for (const s of trace.steps) {
    console.log(`  ${s.hit ? 'HIT →' : '  miss'} ${s.ingredient.padEnd(10)} ${s.hit ? 'matched term: ' + JSON.stringify(s.via) : ''}`);
  }
  console.log('  WINNER:', trace.winner);

  console.log('\n=== D. Why "cheese" fires: termMatches internals ===');
  const why = await page.evaluate(() => ({
    term: 'cheese',
    length: 'cheese'.length,
    takesSubstringBranch: 'cheese'.length > 4,
    substringResult: 'cheesecake'.includes('cheese'),
    // what a word-boundary check would have said instead
    wordBoundaryResult: new RegExp('\\bcheese(s|es)?\\b').test('cheesecake'),
    pastryCakeWouldMatch: termMatches('cheesecake', 'cake'),
  }));
  console.log(JSON.stringify(why, null, 1));

  console.log('\n=== E. Carbon consequence ===');
  const carbon = await page.evaluate(() => ({
    cheese: getCarbonScore('cheese'),
    pastry: getCarbonScore('pastry'),
    dairy: getCarbonScore('dairy'),
  }));
  console.log(JSON.stringify(carbon));

  console.log('\n=== F. End-to-end: actually search "cheesecake" in the UI ===');
  await page.type('.search-input', 'cheesecake');
  await page.click('.hero .btn-primary');
  await page.waitForSelector('.results-page', { timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3000));

  const ui = await page.evaluate(() => ({
    title: document.querySelector('.meal-title')?.innerText,
    chips: [...document.querySelectorAll('.chip')].map((c) => c.innerText),
    badge: document.querySelector('.badge-value')?.innerText,
    badgeLabel: document.querySelector('.badge-label')?.innerText,
    alternatives: [...document.querySelectorAll('.alt-card .alt-name')].map((n) => n.innerText),
  }));
  console.log(JSON.stringify(ui, null, 1));

  await page.screenshot({ path: path.join(SHOTS, '10-cheesecake-search.png'), fullPage: true });
  console.log('[shot] 10-cheesecake-search.png');

  await browser.close();
})().catch((e) => { console.error('TRACE FAILED:', e.message); process.exit(1); });
