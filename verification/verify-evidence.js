const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');

// Exactly two honest shapes are allowed on an available card (plus the sample
// fallback). Anything else means a claim crept back in.
const EVIDENCE_RE = /^Reviewers mention \u201c.+\u201d at .+ \u2022 [\d.]+ mi$/;
const CATEGORY_RE = /^.+ nearby \u2014 .+ \u2022 [\d.]+ mi$/;
const SAMPLE_RE = /^Sample location \u2014 .+$/;
const NONE_RE = /^Not available nearby$/;

async function check(browser, food, strip) {
  const pageErrors = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

  if (strip) {
    // Force the no-evidence branch by deleting evidence from the real response,
    // rather than inventing venues.
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      if (!req.url().includes('/api/alternatives-nearby')) return req.continue();
      try {
        const up = await fetch(req.url(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: req.postData(),
        });
        const body = await up.json();
        for (const k of Object.keys(body.results || {})) {
          body.results[k].venues = (body.results[k].venues || []).map((v) => ({ ...v, evidence: null }));
        }
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      } catch (e) { req.abort(); }
    });
  }

  await page.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.search-input', { timeout: 45000 });
  await page.type('.search-input', food);
  await page.click('.hero .btn-primary');
  await page.waitForSelector('.results-page', { timeout: 60000 });
  await page.waitForSelector('.alt-card', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  const out = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.alt-card')].map((c) => ({
      name: c.querySelector('.alt-name')?.innerText,
      venue: c.querySelector('.alt-venue')?.innerText || '',
      verified: c.querySelector('.alt-venue')?.classList.contains('alt-venue-verified') || false,
    })),
    rows: [...document.querySelectorAll('.restaurant-row')].map((r) => ({
      venue: r.querySelector('.restaurant-name')?.innerText,
      claims: [...r.querySelectorAll('.restaurant-serves > div')].map((d) => ({
        text: d.innerText, verified: d.classList.contains('serves-verified'),
      })),
    })),
    quote: document.querySelector('.venue-quote')?.innerText || null,
    caveat: document.querySelector('.venue-caveat')?.innerText || null,
    venueLine: document.querySelector('.venue-line')?.innerText || null,
  }));

  console.log(`\n===== "${food}"${strip ? '  [evidence stripped]' : ''} =====`);
  let bad = 0;
  for (const c of out.cards) {
    const ok = EVIDENCE_RE.test(c.venue) || CATEGORY_RE.test(c.venue) || SAMPLE_RE.test(c.venue) || NONE_RE.test(c.venue);
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'OK  ' : 'BAD '} ${c.verified ? 'VERIFIED ' : '         '}${String(c.name).padEnd(30)} "${c.venue}"`);
  }
  console.log('  cards with a disallowed claim shape:', bad, '(want 0)');
  console.log('  evidence-backed cards:', out.cards.filter((c) => c.verified).length, '/', out.cards.length);

  for (const r of out.rows) {
    console.log(`  row: ${r.venue}`);
    for (const cl of r.claims) console.log(`        ${cl.verified ? 'VERIFIED' : 'maybe   '} ${cl.text}`);
  }
  const unsupportedServes = out.rows.some((r) => r.claims.some((c) => !c.verified && /^serves /.test(c.text)));
  console.log('  any bare "serves X" without evidence:', unsupportedServes, '(want false)');

  console.log('  details venue line:', out.venueLine);
  if (out.quote) console.log('  QUOTE:', out.quote.replace(/\n/g, ' | '));
  if (out.caveat) console.log('  CAVEAT:', out.caveat.replace(/\n/g, ' '));
  console.log('  exactly one of quote/caveat shown:', !!out.quote !== !!out.caveat);
  console.log('  page errors:', pageErrors.length);

  await page.screenshot({ path: path.join(SHOTS, `${strip ? '24-no-evidence' : '23-evidence'}-${food.replace(/\s+/g, '-')}.png`), fullPage: true });
  await page.close();
  return { bad, verified: out.cards.filter((c) => c.verified).length, unsupportedServes };
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--no-sandbox'],
  });
  await browser.defaultBrowserContext().overridePermissions('http://localhost:5000', ['geolocation']);

  let totalBad = 0, totalVerified = 0, anyUnsupported = false;
  for (const food of ['ice cream', 'cheesecake', 'pancakes', 'beef burger']) {
    const r = await check(browser, food, false);
    totalBad += r.bad; totalVerified += r.verified; anyUnsupported = anyUnsupported || r.unsupportedServes;
  }
  // And the honest fallback when no review names the dish.
  const stripped = await check(browser, 'ice cream', true);
  totalBad += stripped.bad;

  console.log('\n========== SUMMARY ==========');
  console.log('  disallowed claim shapes across all searches:', totalBad, '(want 0)');
  console.log('  evidence-backed cards seen with real data:', totalVerified, '(want >0)');
  console.log('  verified cards when evidence stripped:', stripped.verified, '(want 0)');
  console.log('  bare "serves X" without evidence anywhere:', anyUnsupported, '(want false)');
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
