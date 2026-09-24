// Reads a restaurant's menu off its own website.
//
// Three stages, and the honesty of the result rests on the third. The site is
// fetched and its menu page found; the visible text is handed to Claude to
// turn into items; and then every item Claude returns is checked against the
// fetched text and dropped if its name is not actually there. So the model can
// misread a menu, but it cannot invent one: an item that is not on the page
// never reaches the screen, and a page with no menu on it comes back as
// "menu not available" rather than as a plausible-looking list.
//
// Plain fetch only, by decision. Tested on five real sites it reads three;
// the other two are a JavaScript-rendered page and PDF downloads, and both
// surface here as an unavailable menu with a reason, not as a guess.

const { MODEL, createWithFallbacks, parseStructuredReply, logUsage } = require('./llm');

const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 1000000;
const MAX_TEXT_CHARS = 15000;
const MIN_TEXT_CHARS = 200;
const MAX_ITEMS = 60;
const LLM_TIMEOUT_MS = 25000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Identifies as a browser, since the request is made on behalf of a person
// reading a public menu — and robots.txt is honoured, so a site that does not
// want automated readers is not read.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 SustainEat/1.0';

/* --------------------------------------------------------------- fetch ---- */

// Reads at most MAX_HTML_BYTES, then stops: a menu is in the first megabyte or
// it is not on the page.
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal
    });
    const type = String(response.headers.get('content-type') || '');
    if (!response.ok) return { ok: false, reason: `http-${response.status}`, finalUrl: response.url };
    if (/application\/pdf/i.test(type)) return { ok: false, reason: 'pdf-menu', finalUrl: response.url };
    if (type && !/html|xml|text\/plain/i.test(type)) return { ok: false, reason: 'not-html', finalUrl: response.url };

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString('utf8');
    return { ok: true, html, finalUrl: response.url || url };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : 'unreachable', detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// The smallest useful reading of robots.txt: the User-agent: * group's
// Disallow lines. A site that cannot be asked is assumed to allow.
async function robotsAllows(url) {
  let rules;
  try {
    const target = new URL(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${target.origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT }, signal: controller.signal
    }).finally(() => clearTimeout(timer));
    if (!response.ok) return true;
    rules = parseRobots(await response.text());
    const path = target.pathname || '/';
    return !rules.some((rule) => rule && path.startsWith(rule));
  } catch (err) {
    return true;
  }
}

function parseRobots(text) {
  const disallows = [];
  let applies = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (/^user-agent$/i.test(field)) applies = value === '*';
    else if (applies && /^disallow$/i.test(field)) disallows.push(value);
  }
  return disallows;
}

/* ------------------------------------------------------------ extract ---- */

// The first same-site link that looks like a menu. Anchors, PDFs and third
// party ordering platforms are skipped: a PDF cannot be read here, and an
// ordering platform's page is a different problem from the restaurant's own.
function findMenuLink(html, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = match[1].trim();
    const label = stripTags(match[2]).toLowerCase();
    if (!/menu/i.test(href) && !/\bmenu\b/.test(label)) continue;
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let resolved;
    try { resolved = new URL(href, base); } catch (err) { continue; }
    if (resolved.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (/\.pdf($|\?)/i.test(resolved.pathname)) continue;
    if (/catering|menu\.css|menu\.js/i.test(resolved.pathname)) continue;
    resolved.hash = '';
    const key = resolved.href;
    if (seen.has(key)) continue;
    seen.add(key);
    return key;
  }
  return null;
}

const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ');

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)));
}

// Visible text, one line per block, chrome removed. Menus are line-structured
// — name, then price, then description — so the newlines are kept.
function extractText(html) {
  let s = String(html);
  s = s.replace(/<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Both edges of a block break the line, so "<h3>Bao</h3><span>5.99</span><p>…"
  // reads as three lines, the way the menu is laid out.
  s = s.replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|section|article|dt|dd|td|th|blockquote)\b[^>]*>/gi, '\n');
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return s.slice(0, MAX_TEXT_CHARS);
}

/* --------------------------------------------------------------- model ---- */

const SYSTEM_PROMPT = `You read the text of a restaurant's web page and list the menu items on it.

Rules:
- List only dishes and drinks that are actually named in the text. Never add an item the text does not name, never complete a menu that looks short, and never guess at what a restaurant of this kind would serve.
- Copy each item's name as it appears. Give its price only if the text shows one next to it; leave price empty when there is none — many restaurant sites do not show prices. Give a short description only from words the text uses for that item; leave it empty otherwise.
- Use section for the heading the item sits under (Small Plates, Ramen, Drinks), or leave it empty.
- Skip navigation, headings with no items, catering forms, hours, addresses and marketing copy.
- List at most 60 items. If the menu is longer, take them in the order they appear and stop: a long deli menu read in full would take longer than the caller waits.
- If the text does not contain a menu — a homepage, a locations page, an order-online splash — set menuFound to false and return no items.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['menuFound', 'items'],
  properties: {
    menuFound: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'price', 'description', 'section'],
        properties: {
          name: { type: 'string' },
          // Strings rather than nullable numbers, so the schema stays inside
          // what structured outputs accept; normalised in groundItems().
          price: { type: 'string' },
          description: { type: 'string' },
          section: { type: 'string' }
        }
      }
    }
  }
};

async function parseWithModel(text, venueName) {
  const response = await createWithFallbacks({
    model: MODEL,
    max_tokens: 6000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages: [{
      role: 'user',
      content: `Restaurant: ${venueName}\n\nPage text:\n${text}`
    }]
  }, { timeout: LLM_TIMEOUT_MS, maxRetries: 0 });
  logUsage('menu agent', response);
  return parseStructuredReply(response, 'menu');
}

/* ---------------------------------------------------------- grounding ---- */

const normalize = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function parsePrice(raw) {
  const m = String(raw || '').replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
}

// Keeps an item only if its name is in the page. This is the line between
// reading a menu and writing one.
function groundItems(items, pageText) {
  const haystack = ' ' + normalize(pageText) + ' ';
  const kept = [];
  const seen = new Set();
  for (const item of items || []) {
    const name = String(item.name || '').trim().slice(0, 80);
    const needle = normalize(name);
    if (needle.length < 2 || !haystack.includes(' ' + needle + ' ') && !haystack.includes(needle)) continue;
    if (seen.has(needle)) continue;
    seen.add(needle);
    kept.push({
      name,
      price: parsePrice(item.price),
      description: String(item.description || '').trim().slice(0, 200) || null,
      section: String(item.section || '').trim().slice(0, 40) || null
    });
    if (kept.length === MAX_ITEMS) break;
  }
  return kept;
}

/* --------------------------------------------------------------- cache ---- */

const cache = new Map();

function cacheKeyFor(website) {
  try {
    const u = new URL(website);
    u.hash = '';
    return u.href.toLowerCase().replace(/\/$/, '');
  } catch (err) {
    return String(website).toLowerCase();
  }
}

/* --------------------------------------------------------------- entry ---- */

// Every outcome is a 200 with ok:true and a status. "unavailable" is a real
// answer about the restaurant, not an error, and the UI treats it as one.
async function lookupMenu({ website, venueName }) {
  if (!website || !/^https?:\/\//i.test(String(website))) {
    return { ok: true, status: 'unavailable', reason: 'no-website' };
  }

  const key = cacheKeyFor(website);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return { ...hit.result, cached: true };

  const result = await lookupUncached(website, venueName);
  // Only settled answers are cached. A site that was unreachable tonight may
  // answer tomorrow, and a missing key is not a fact about the restaurant.
  if (result.ok && (result.status === 'ok' || ['no-menu-page', 'not-a-menu', 'pdf-menu', 'nothing-grounded'].includes(result.reason))) {
    cache.set(key, { storedAt: Date.now(), result });
  }
  return { ...result, cached: false };
}

async function lookupUncached(website, venueName) {
  if (!(await robotsAllows(website))) {
    return { ok: true, status: 'unavailable', reason: 'blocked-by-robots' };
  }

  const home = await fetchPage(website);
  if (!home.ok) return { ok: true, status: 'unavailable', reason: home.reason, fetchedUrl: website };

  // Prefer a dedicated menu page. A linked one first; failing that, the
  // conventional /menu path, which exists on sites whose navigation is drawn
  // by script and so has no link to find. The homepage is the last resort —
  // on small sites it often is the menu.
  let page = home;
  let fetchedUrl = home.finalUrl;
  const linked = findMenuLink(home.html, home.finalUrl);
  const candidates = [linked, new URL('/menu', home.finalUrl).href].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === home.finalUrl) continue;
    if (!(await robotsAllows(candidate))) continue;
    const menuPage = await fetchPage(candidate);
    if (menuPage.ok) { page = menuPage; fetchedUrl = menuPage.finalUrl; break; }
    if (menuPage.reason === 'pdf-menu') return { ok: true, status: 'unavailable', reason: 'pdf-menu', fetchedUrl: candidate };
  }

  const text = extractText(page.html);
  if (text.length < MIN_TEXT_CHARS) {
    return { ok: true, status: 'unavailable', reason: 'no-text', fetchedUrl, textChars: text.length };
  }

  const parsed = await parseWithModel(text, venueName || '');
  if (!parsed.menuFound) return { ok: true, status: 'unavailable', reason: 'not-a-menu', fetchedUrl };

  const items = groundItems(parsed.items, text);
  if (!items.length) return { ok: true, status: 'unavailable', reason: 'nothing-grounded', fetchedUrl };

  const withPrices = items.filter((i) => i.price != null).length;
  return { ok: true, status: 'ok', items, fetchedUrl, itemCount: items.length, withPrices };
}

module.exports = {
  lookupMenu,
  _internal: { fetchPage, findMenuLink, extractText, groundItems, parseRobots, parsePrice, cacheKeyFor, OUTPUT_SCHEMA, SYSTEM_PROMPT }
};
