// Estimates a dish's carbon footprint from what is actually in it.
//
// The split of work is the point of this file. Claude decides what a dish is
// made of — ingredients, grams, which emission category each belongs to — and
// this module does the arithmetic against a per-kg table it owns. A model that
// hands back a bare "2.1 kg" is no more defensible than the lookup table it
// replaces; one that hands back "150 g wheat noodles, 60 g pork, 400 ml broth"
// can be checked line by line, and the total is recomputed here rather than
// trusted.
//
// It is one structured call, not a tool loop. The factor table fits in the
// system prompt, so a lookup tool would only add a round trip, and live web
// grounding would make the same search score differently on different days.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';

// kg CO2e per kg of food product, farm to retail: land use, farming, feed,
// processing, transport, retail and packaging. Poore & Nemecek (2018), "Reducing
// food's environmental impacts through producers and consumers", Science 360,
// as tabulated by Our World in Data ("Greenhouse gas emissions per kilogram of
// food product", mean values). Transcribed by hand — worth a spot-check against
// the source before quoting a figure in public. Cooking energy is excluded, as
// it is in the source.
const EMISSION_FACTORS = {
  beef_beef_herd:   { label: 'Beef (beef herd)',        kgPerKg: 99.48 },
  beef_dairy_herd:  { label: 'Beef (dairy herd)',       kgPerKg: 33.30 },
  lamb_mutton:      { label: 'Lamb & mutton',           kgPerKg: 39.72 },
  pork:             { label: 'Pig meat',                kgPerKg: 12.31 },
  poultry:          { label: 'Poultry meat',            kgPerKg: 9.87 },
  shrimp_farmed:    { label: 'Shrimp (farmed)',         kgPerKg: 26.87 },
  fish_farmed:      { label: 'Fish (farmed)',           kgPerKg: 13.63 },
  cheese:           { label: 'Cheese',                  kgPerKg: 23.88 },
  milk:             { label: 'Milk',                    kgPerKg: 3.15 },
  eggs:             { label: 'Eggs',                    kgPerKg: 4.67 },
  dark_chocolate:   { label: 'Dark chocolate',          kgPerKg: 46.65 },
  coffee:           { label: 'Coffee',                  kgPerKg: 28.53 },
  rice:             { label: 'Rice',                    kgPerKg: 4.45 },
  wheat_rye:        { label: 'Wheat & rye (bread, pasta, noodles)', kgPerKg: 1.57 },
  maize:            { label: 'Maize',                   kgPerKg: 1.70 },
  oatmeal:          { label: 'Oatmeal',                 kgPerKg: 2.48 },
  barley:           { label: 'Barley',                  kgPerKg: 1.18 },
  potatoes:         { label: 'Potatoes',                kgPerKg: 0.46 },
  cassava:          { label: 'Cassava',                 kgPerKg: 1.32 },
  tofu:             { label: 'Tofu',                    kgPerKg: 3.16 },
  soy_milk:         { label: 'Soy milk',                kgPerKg: 0.98 },
  other_pulses:     { label: 'Pulses (beans, lentils, chickpeas)', kgPerKg: 1.79 },
  peas:             { label: 'Peas',                    kgPerKg: 0.98 },
  groundnuts:       { label: 'Peanuts',                 kgPerKg: 3.23 },
  nuts:             { label: 'Tree nuts',               kgPerKg: 0.43 },
  tomatoes:         { label: 'Tomatoes',                kgPerKg: 2.09 },
  root_vegetables:  { label: 'Root vegetables',         kgPerKg: 0.43 },
  brassicas:        { label: 'Brassicas',               kgPerKg: 0.51 },
  onions_leeks:     { label: 'Onions & leeks',          kgPerKg: 0.50 },
  other_vegetables: { label: 'Other vegetables',        kgPerKg: 0.53 },
  bananas:          { label: 'Bananas',                 kgPerKg: 0.86 },
  citrus:           { label: 'Citrus fruit',            kgPerKg: 0.39 },
  apples:           { label: 'Apples',                  kgPerKg: 0.43 },
  berries_grapes:   { label: 'Berries & grapes',        kgPerKg: 1.53 },
  other_fruit:      { label: 'Other fruit',             kgPerKg: 1.05 },
  cane_sugar:       { label: 'Cane sugar',              kgPerKg: 3.20 },
  beet_sugar:       { label: 'Beet sugar',              kgPerKg: 1.81 },
  olive_oil:        { label: 'Olive oil',               kgPerKg: 5.42 },
  palm_oil:         { label: 'Palm oil',                kgPerKg: 7.32 },
  soybean_oil:      { label: 'Soybean oil',             kgPerKg: 6.32 },
  rapeseed_oil:     { label: 'Rapeseed (canola) oil',   kgPerKg: 3.77 },
  sunflower_oil:    { label: 'Sunflower oil',           kgPerKg: 3.60 },
  wine:             { label: 'Wine',                    kgPerKg: 1.79 }
};

const CATEGORIES = Object.keys(EMISSION_FACTORS);

const SYSTEM_PROMPT = `You estimate what restaurant and takeout dishes are made of, so their carbon footprint can be computed from their ingredients.

For each dish you are given, list the ingredients that go into one typical portion from a US restaurant or takeout counter — or into the stated serving size, when one is given. For each ingredient give a short name, its grams, and the emission category it belongs to, chosen from the category list below.

The number is computed from your breakdown, so the breakdown is what matters:
- Include everything that moves the total: meat and fish, dairy, eggs, cooking oil, sugar, and what a broth or sauce is made from (a pork-bone ramen broth contributes pork; a cream sauce contributes milk or cheese).
- Give grams as the product is bought, not as it is served, because the emission factors are per kg of retail product: dry weight for pasta, noodles, rice, grains and pulses (cooked lentils or rice are roughly 60-70% absorbed water); raw weight for meat and fish. Name the ingredient accordingly, e.g. "dry lentils".
- For a broth or stock, count the ingredients that go into the pot per portion, not the water, and count bones at a fraction of their weight: bones carry little of the animal's footprint compared with meat.
- serving_grams is the plated portion. It will not equal the sum of the purchase weights, and does not need to.
- Pick the closest category. Use beef_beef_herd for burgers, steak and ground beef unless the dish is clearly from dairy cattle. Spices, herbs and water can be left out.
- Do not calculate a total. Do not add a margin.

You are also given the diner's approximate location and the month. Use them only as context for what the dish most plausibly contains where they are — the usual preparation of that dish in that region, or which seafood is typically farmed. Note anything relevant in location_note, or leave it empty. Location never changes grams, and there is no adjustment for transport: in the source data transport is a small share of food emissions.

Set confidence to low when the dish name is ambiguous or could describe very different recipes.

Categories:
${CATEGORIES.map((key) => `${key}: ${EMISSION_FACTORS[key].label}`).join('\n')}`;

// Structured output keeps the reply parseable. Numeric bounds are enforced in
// validate(), not in the schema.
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dishes'],
  properties: {
    dishes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'serving_grams', 'ingredients', 'confidence', 'location_note'],
        properties: {
          id: { type: 'string' },
          serving_grams: { type: 'number' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'category', 'grams'],
              properties: {
                name: { type: 'string' },
                category: { type: 'string', enum: CATEGORIES },
                grams: { type: 'number' }
              }
            }
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          location_note: { type: 'string' }
        }
      }
    }
  }
};

// Stays under Vercel's 30 s function limit with room to answer.
const REQUEST_TIMEOUT_MS = 25000;
const MAX_DISHES_PER_REQUEST = 16;
// Measured live: one dish takes ~4-7 s, and 7 in one request ~17 s.
const DISHES_PER_BATCH = 3;
const MAX_INGREDIENT_GRAMS = 2000;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

class AgentUnavailableError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

/* --------------------------------------------------------------- cache ---- */

// A dish's breakdown depends on what it is and roughly where, not on who asked,
// so results are shared across searches. Coordinates are rounded to whole
// degrees (~100 km): enough to keep regional context, coarse enough that one
// city shares entries. In memory only — on Vercel that means per warm instance.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

const normalizeName = (text) => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');

function cacheKey(dish, latitude, longitude) {
  const region = `${Math.round(Number(latitude) || 0)},${Math.round(Number(longitude) || 0)}`;
  return [normalizeName(dish.query || dish.name), Math.round(Number(dish.servingGrams) || 0), region].join('|');
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt >= CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.result;
}

/* ---------------------------------------------------------- arithmetic ---- */

// The total comes from here, never from the model.
function scoreBreakdown(raw) {
  const breakdown = [];
  for (const item of raw.ingredients || []) {
    const factor = EMISSION_FACTORS[item.category];
    const grams = Number(item.grams);
    if (!factor || !Number.isFinite(grams) || grams <= 0) continue;
    const counted = Math.min(grams, MAX_INGREDIENT_GRAMS);
    breakdown.push({
      name: String(item.name || factor.label).slice(0, 60),
      category: item.category,
      label: factor.label,
      grams: Math.round(counted),
      kgPerKg: factor.kgPerKg,
      kg: Math.round((counted / 1000) * factor.kgPerKg * 100) / 100
    });
  }
  breakdown.sort((a, b) => b.kg - a.kg);
  const carbonKg = breakdown.reduce((sum, row) => sum + (row.grams / 1000) * row.kgPerKg, 0);
  return {
    carbonKg: Math.round(carbonKg * 100) / 100,
    servingGrams: Math.round(Number(raw.serving_grams) || breakdown.reduce((s, r) => s + r.grams, 0)),
    breakdown,
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
    locationNote: String(raw.location_note || '').slice(0, 240)
  };
}

// Every requested dish has to come back scored. A partial answer would leave
// some dishes on this scale and the rest on the fallback table, and a swap
// compared across two scales is not a comparison.
function validate(parsed, requested) {
  if (!parsed || !Array.isArray(parsed.dishes)) throw new Error('reply had no dishes array');
  const byId = new Map(parsed.dishes.map((dish) => [String(dish.id), dish]));
  const results = {};
  for (const dish of requested) {
    const raw = byId.get(dish.id);
    if (!raw) throw new Error(`reply skipped dish ${dish.id}`);
    const scored = scoreBreakdown(raw);
    if (!scored.breakdown.length) throw new Error(`dish ${dish.id} came back with no usable ingredients`);
    results[dish.id] = scored;
  }
  return results;
}

/* --------------------------------------------------------------- agent ---- */

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AgentUnavailableError('no-key', 'ANTHROPIC_API_KEY is not set');
  }
  if (!client) client = new Anthropic({ maxRetries: 0 });
  return client;
}

function buildRequest(dishes, latitude, longitude, withFallbacks) {
  const month = MONTHS[new Date().getMonth()];
  const location = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    ? `approximately ${Number(latitude).toFixed(1)}, ${Number(longitude).toFixed(1)}`
    : 'unknown';

  const payload = {
    diner_location: location,
    month,
    dishes: dishes.map((dish) => ({
      id: dish.id,
      name: dish.name,
      ...(dish.query && normalizeName(dish.query) !== normalizeName(dish.name)
        ? { what_the_diner_typed: dish.query } : {}),
      ...(dish.servingGrams ? { serving_grams: Math.round(dish.servingGrams) } : {}),
      ...(dish.format ? { course: dish.format } : {})
    }))
  };

  return {
    model: MODEL,
    max_tokens: 8000,
    // The same prompt opens every call, so cache it.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA }
    },
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    // Re-runs a declined request on Anthropic's recommended fallback model
    // instead of returning a refusal. Food is unlikely to trip a classifier,
    // but a declined call would otherwise surface as a failed estimate.
    ...(withFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {})
  };
}

async function callModel(dishes, latitude, longitude) {
  const anthropic = getClient();
  const options = { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 };

  let response;
  try {
    response = await anthropic.beta.messages.create(buildRequest(dishes, latitude, longitude, true), options);
  } catch (err) {
    // If this account or request shape does not accept the fallback beta, a
    // plain call is still better than no estimate.
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(String(err.message))) {
      console.warn('Carbon agent: fallbacks rejected, retrying without them —', err.message);
      response = await anthropic.messages.create(buildRequest(dishes, latitude, longitude, false), options);
    } else {
      throw err;
    }
  }

  if (response.stop_reason === 'refusal') throw new Error('the model declined the request');
  if (response.stop_reason === 'max_tokens') throw new Error('the reply was cut off at max_tokens');

  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  const u = response.usage || {};
  console.log(`carbon agent: ${dishes.length} dish${dishes.length === 1 ? '' : 'es'}, ` +
    `${u.input_tokens || 0} in / ${u.output_tokens || 0} out, ` +
    `${u.cache_read_input_tokens || 0} cached, served by ${response.model}`);
  return { parsed: JSON.parse(text), model: response.model };
}

// dishes: [{ id, name, query?, servingGrams?, format? }]
async function estimateCarbon({ dishes, latitude, longitude }) {
  const requested = (dishes || [])
    .filter((dish) => dish && dish.id != null && dish.name)
    .slice(0, MAX_DISHES_PER_REQUEST)
    .map((dish) => ({ ...dish, id: String(dish.id) }));
  if (!requested.length) throw new Error('no dishes to estimate');

  const results = {};
  const missing = [];
  for (const dish of requested) {
    const hit = cacheGet(cacheKey(dish, latitude, longitude));
    if (hit) results[dish.id] = { ...hit, cached: true };
    else missing.push(dish);
  }

  let model = null;
  if (missing.length) {
    // Small batches in parallel rather than one long call. Output time grows
    // with the number of dishes, and a 13-dish main-course catalog in a single
    // request ran past the 25 s limit; in parallel the wall clock is roughly
    // one small call. Still all-or-nothing: any batch failing fails the lot,
    // so nothing is cached and nothing is returned on a mixed scale.
    const batches = [];
    for (let i = 0; i < missing.length; i += DISHES_PER_BATCH) {
      batches.push(missing.slice(i, i + DISHES_PER_BATCH));
    }
    const replies = await Promise.all(batches.map((batch) => callModel(batch, latitude, longitude)));
    const fresh = {};
    replies.forEach((reply, idx) => Object.assign(fresh, validate(reply.parsed, batches[idx])));
    model = replies[0].model;
    for (const dish of missing) {
      cache.set(cacheKey(dish, latitude, longitude), { storedAt: Date.now(), result: fresh[dish.id] });
      results[dish.id] = { ...fresh[dish.id], cached: false };
    }
  }

  return { results, model: model || MODEL, fromCache: requested.length - missing.length, called: missing.length };
}

module.exports = {
  estimateCarbon,
  AgentUnavailableError,
  EMISSION_FACTORS,
  // Exported for tests.
  _internal: { scoreBreakdown, validate, buildRequest, cacheKey, OUTPUT_SCHEMA, SYSTEM_PROMPT }
};
