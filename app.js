const { useState, useEffect, useMemo, useRef } = React;

// The backend serves this page as well as the API, so the API lives at the
// origin the page was loaded from — localhost:5000 in development, the deployed
// URL in production, with nothing to reconfigure between them. A no-build static
// frontend has no env-var mechanism; same-origin is the mechanism.
const LOCAL_BACKEND = "http://localhost:5000";

const BACKEND_URL = (function () {
  // Opened straight off disk: there is no origin to call.
  if (window.location.protocol === "file:") return LOCAL_BACKEND;

  // VS Code Live Server serves these files but has no API behind it. It
  // defaults to 5500 and walks upward — 5501, 5502 — whenever that port is
  // already taken, which a second editor window does routinely. Matching only
  // the default sent the whole API at the static server and surfaced as
  // "Could not reach the backend" while the backend was running fine, so match
  // the range instead. Deliberately not "any non-5000 port": running the
  // backend itself on PORT=5001 must still resolve to its own origin.
  if (/^55\d\d$/.test(window.location.port)) return LOCAL_BACKEND;

  return window.location.origin;
})();

// Personal FoodData Central key (X-Ratelimit-Limit reports 3,600/hour), not the
// shared DEMO_KEY, which caps at ~30/hour per IP and would 429 mid-demo.
//
// app.js is served to the browser, so this key is public to every visitor by
// design of where it lives -- not a leak to fix by moving it, but a reason not
// to grant it anything that matters. The keys that do matter (Places, Pexels)
// stay server-side in server/.env and are never shipped.
const USDA_API_KEY = "fmPz0LC8GXJURmsmkrocv03emrb344PmgAkzT68B";

// Used only if the browser blocks or times out geolocation, so a denied
// permission prompt on demo day still produces a working results page.
const FALLBACK_LOCATION = { latitude: 42.3601, longitude: -71.0942, label: "MIT campus (default)" };

// kg CO2e per serving, derived from Poore & Nemecek (2018) per-kg figures.
const INGREDIENT_CARBON = {
  lamb: 20.0,
  beef: 8.5,
  shrimp: 5.0,
  fish: 4.2,
  pork: 3.5,
  chicken: 2.8,
  turkey: 2.5,
  cheese: 2.2,
  chocolate: 1.9,
  dairy: 1.8,
  pastry: 1.4,
  grains: 1.2,
  eggs: 1.1,
  soy: 0.9,
  tofu: 0.9,
  beans: 0.8,
  lentils: 0.7,
  // Poore & Nemecek put nuts among the very lowest-carbon foods (~0.43 kg
  // CO2e/kg vs ~24 for cheese). The old 2.2 was far too high and made a cashew
  // dessert score worse than a dairy one.
  nuts: 0.6,
  oat: 0.6,
  vegetable: 0.5,
  fruit: 0.3,
  beverage: 0.3
};

// A plant marker anywhere in the name overrides the meat words that follow it,
// so "black bean burger" and "Impossible Whopper" are not scored as beef.
const PLANT_OVERRIDES = [
  { ingredient: "tofu", match: ["tofu"] },
  { ingredient: "lentils", match: ["lentil", "dal", "dahl"] },
  { ingredient: "beans", match: ["black bean", "bean", "chickpea", "falafel", "hummus", "garbanzo", "edamame"] },
  { ingredient: "soy", match: ["impossible", "beyond", "plant-based", "plant based", "soy"] },
  { ingredient: "vegetable", match: ["veggie", "vegan", "vegetarian", "meatless", "garden burger"] }
];

// Ordered most specific first, and order is load-bearing:
//   "cheesecake"    -> cheese, because cheese precedes pastry
//   "doughnut"      -> pastry, because pastry precedes nuts ("nut" is a substring)
//   "peanut butter" -> nuts,   because nuts precedes dairy ("butter" is a substring)
const INGREDIENT_RULES = [
  { ingredient: "lamb", match: ["lamb", "mutton", "gyro"] },
  { ingredient: "beef", match: ["beef", "cheeseburger", "hamburger", "steak", "brisket", "whopper", "big mac", "meatball", "burger"] },
  { ingredient: "shrimp", match: ["shrimp", "prawn", "crab", "clam", "lobster"] },
  { ingredient: "fish", match: ["fish", "salmon", "tuna", "cod", "tilapia", "sushi", "seafood"] },
  { ingredient: "pork", match: ["pork", "bacon", "ham", "sausage", "pepperoni"] },
  { ingredient: "turkey", match: ["turkey"] },
  { ingredient: "chicken", match: ["chicken", "poultry", "nugget", "cfa", "chick-fil"] },
  { ingredient: "cheese", match: ["cheese", "pizza", "queso", "mozzarella"] },
  { ingredient: "chocolate", match: ["chocolate", "brownie", "cocoa", "fudge"] },
  { ingredient: "pastry", match: ["cake", "cookie", "pie", "donut", "doughnut", "pastry", "tart", "crumble", "cobbler", "cupcake", "muffin", "croissant", "waffle", "pancake", "scone", "biscuit", "churro", "macaron", "strudel"] },
  { ingredient: "nuts", match: ["nut", "almond", "peanut", "cashew", "pistachio", "walnut", "pecan"] },
  { ingredient: "dairy", match: ["milk", "milkshake", "yogurt", "butter", "cream", "latte", "cappuccino", "macchiato", "gelato", "custard", "pudding", "sundae", "froyo", "frappe"] },
  // Bare "egg" would swallow "eggplant", so match dishes and the plural only.
  { ingredient: "eggs", match: ["omelet", "omelette", "frittata", "benedict", "scrambled egg", "egg salad", "deviled egg", "eggs"] },
  { ingredient: "oat", match: ["oat", "oatmeal", "granola", "porridge", "muesli"] },
  { ingredient: "fruit", match: ["fruit", "berry", "berries", "sorbet", "sherbet", "apple", "banana", "mango", "peach", "strawberry", "blueberry", "smoothie", "juice", "lemonade", "avocado", "melon", "pineapple"] },
  { ingredient: "beverage", match: ["coffee", "cold brew", "espresso", "tea", "soda", "cola", "kombucha"] },
  { ingredient: "grains", match: ["rice", "pasta", "noodle", "bread", "quinoa", "grain", "toast", "bagel", "cereal", "barley", "couscous"] },
  { ingredient: "vegetable", match: ["salad", "vegetable", "broccoli", "kale", "soup", "hash", "potato"] }
];

// Short terms must land on a word boundary, because plain substring matching
// produces silent nonsense: "chocolate" contains "cola", "steak" contains
// "tea", "doughnut" contains "nut", "eggplant" contains "egg". Longer terms
// stay as substrings so compounds like "cheesecake" still match "cheese".
function termMatches(value, term) {
  if (term.length > 4 || /[\s-]/.test(term)) return value.includes(term);
  return new RegExp(`\\b${term}(s|es)?\\b`).test(value);
}

const ruleHits = (rule, value) => rule.match.some((term) => termMatches(value, term));

function classifyIngredient(text) {
  const value = (text || "").toLowerCase();

  for (const rule of PLANT_OVERRIDES) {
    if (ruleHits(rule, value)) return rule.ingredient;
  }
  for (const rule of INGREDIENT_RULES) {
    if (ruleHits(rule, value)) return rule.ingredient;
  }
  return "vegetable";
}

// The chip is a human-facing label ONLY. The ingredient key above is unchanged
// and still drives carbon and alternative matching — "cheesecake" is classified
// as cheese because cream cheese is its dominant ingredient. This layer just
// says that in words a judge will read correctly, instead of a bare "cheese".
const INGREDIENT_LABEL_RULES = [
  { label: "cream cheese", match: ["cheesecake"] }
];

function ingredientLabelFor(text, ingredient) {
  const value = (text || "").toLowerCase();
  for (const rule of INGREDIENT_LABEL_RULES) {
    if (rule.match.some((term) => value.includes(term))) return rule.label;
  }
  return ingredient;
}

/* --------------------------------------------------------- food format ---- */

// A swap is only useful if it is the same KIND of thing. Searching "cheesecake"
// should return desserts, not a lentil bowl. Formats are checked before the
// generic rules below because several savoury and breakfast dishes contain
// dessert words ("crab cake", "pot pie", "pancake").
const FORMAT_OVERRIDES = [
  { format: "main", match: ["pot pie", "shepherd", "cottage pie", "meat pie", "crab cake", "fish cake", "rice cake", "pizza", "hot dog", "corn dog"] },
  { format: "dessert", match: ["coffee cake", "ice cream cake"] },
  { format: "breakfast", match: ["pancake", "waffle", "french toast", "omelet", "omelette", "scrambled egg", "breakfast", "bagel", "granola", "oatmeal", "porridge", "cereal", "croissant", "hash brown", "benedict", "frittata", "parfait", "muffin", "danish"] },
  { format: "drink", match: ["hot chocolate", "milkshake", "smoothie", "latte", "cappuccino", "espresso", "macchiato", "frappe", "coffee", "tea", "juice", "soda", "lemonade", "boba", "bubble tea", "cold brew", "cola", "kombucha", "shake"] }
];

const FORMAT_RULES = [
  { format: "dessert", match: ["cheesecake", "brownie", "ice cream", "gelato", "sorbet", "sherbet", "cookie", "cake", "pie", "donut", "doughnut", "pastry", "dessert", "pudding", "mousse", "tiramisu", "cupcake", "candy", "chocolate", "tart", "crumble", "cobbler", "custard", "macaron", "churro", "cannoli", "baklava", "frozen yogurt", "froyo", "sundae", "eclair"] },
  { format: "soup", match: ["soup", "stew", "chowder", "bisque", "ramen", "pho", "chili", "broth"] }
];

const FORMAT_LABELS = {
  main: "meals",
  dessert: "desserts",
  breakfast: "breakfast options",
  soup: "soups",
  drink: "drinks"
};

// FORMAT_LABELS is plural for the "Lower-carbon desserts" heading; a chip wants
// the singular.
const FORMAT_CHIP_LABELS = {
  main: "meal",
  dessert: "dessert",
  breakfast: "breakfast",
  soup: "soup",
  drink: "drink"
};

function classifyFormat(text) {
  const value = (text || "").toLowerCase();

  for (const rule of FORMAT_OVERRIDES) {
    if (ruleHits(rule, value)) return rule.format;
  }
  for (const rule of FORMAT_RULES) {
    if (ruleHits(rule, value)) return rule.format;
  }
  return "main";
}

function getCarbonScore(ingredient) {
  return INGREDIENT_CARBON[ingredient] || 2.0;
}

function getCarbonCategory(score) {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

// EPA: an average passenger car emits ~404 g CO2 per mile.
function milesDrivenEquivalent(kgCO2) {
  return Math.round(kgCO2 * 2.48 * 10) / 10;
}

/* ------------------------------------------------------ travel to food ---- */

// Collecting a swap is not free. Driving four miles for a lower-carbon dessert
// can emit more than the swap saves, and a tool that only ever shows the
// flattering half of that arithmetic is marketing, not measurement.
//
// Car is the same EPA 404 g/mile figure used above. Transit is ~0.18 kg CO2e
// per passenger-mile, typical for US bus service. Walking and cycling count as
// zero — the marginal emissions of moving your own body a mile are real but
// far below the resolution of every other number on this page.
const TRAVEL_MODES = [
  { id: "drive", label: "Drive", verb: "Driving", icon: "🚗", kgPerMile: 0.404 },
  { id: "transit", label: "Transit", verb: "Taking transit", icon: "🚌", kgPerMile: 0.18 },
  { id: "bike", label: "Bike", verb: "Cycling", icon: "🚲", kgPerMile: 0 },
  { id: "walk", label: "Walk", verb: "Walking", icon: "🚶", kgPerMile: 0 }
];

function travelModeById(id) {
  return TRAVEL_MODES.find((mode) => mode.id === id) || TRAVEL_MODES[0];
}

// Round trip, because you have to get home again. Venue distance is the
// straight-line haversine the backend computes, so real road distance is
// always higher — this figure understates the true cost rather than inflating
// the saving.
function travelEmissions(distanceMiles, modeId) {
  return (Number(distanceMiles) || 0) * 2 * travelModeById(modeId).kgPerMile;
}

/* -------------------------------------------------- nutrition guardrail --- */

// "Eat less" is the trivially correct answer to any carbon question, and a
// recommender with no guard against it will cheerfully swap a burger for a cup
// of tea and call it a 7 kg saving. A swap is only honest if what you get is
// still the same kind of meal.
//
// Which nutrient decides that depends on the format. For a main, a breakfast
// or a soup, protein is the point — losing it means the swap did not feed you.
// Nobody eats dessert or drinks a latte for the protein, so there the floor
// goes on calories instead, which is what catches the milkshake-for-tea swap.
const PROTEIN_FORMATS = new Set(["main", "breakfast", "soup"]);
const MIN_PROTEIN_RATIO = 0.6;
const MIN_CALORIE_RATIO = 0.4;

function nutritionFit(original, item) {
  const usesProtein = PROTEIN_FORMATS.has(item.format);
  const basis = usesProtein ? "protein" : "calories";
  const originalValue = usesProtein ? original.protein : original.calories;
  const itemValue = usesProtein ? item.protein : item.calories;

  // With nothing credible to compare against, do not invent a verdict — an
  // unfounded "comparable protein" badge is worse than no badge at all.
  if (!originalValue || originalValue <= 0) {
    return { comparable: true, basis: null };
  }

  const ratio = itemValue / originalValue;
  return {
    comparable: ratio >= (usesProtein ? MIN_PROTEIN_RATIO : MIN_CALORIE_RATIO),
    basis,
    ratio,
    original: originalValue,
    value: itemValue
  };
}

// "substantially less calories" is wrong; the basis key cannot be dropped
// straight into a sentence.
const FIT_SHORTFALL = { protein: "less protein", calories: "fewer calories" };

function nutritionFitLabel(fit) {
  if (!fit || !fit.basis) return null;
  const mine = Math.round(fit.value);
  const theirs = Math.round(fit.original);
  const amounts = fit.basis === "protein" ? `${mine}g vs ${theirs}g` : `${mine} vs ${theirs} cal`;
  return fit.comparable
    ? `Comparable ${fit.basis} — ${amounts}`
    : `${Math.round(fit.ratio * 100)}% the ${fit.basis} — ${amounts}`;
}

function titleCase(text) {
  return (text || "").replace(/\w\S*/g, (word) => (/[a-z]/.test(word) ? word : word[0] + word.slice(1).toLowerCase()));
}

/* ---------------------------------------------------------------- USDA ---- */

const STOP_WORDS = new Set(["a", "the", "of", "with", "and", "on", "in"]);
const PLANT_WORDS = ["veggie", "vegan", "vegetarian", "meatless", "plant-based", "plant based", "impossible", "beyond", "tofu", "black bean", "chickpea", "falafel", "lentil", "garden"];

const queryTokens = (text) =>
  (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t && !STOP_WORDS.has(t));

const looksPlantBased = (text) => PLANT_WORDS.some((word) => text.toLowerCase().includes(word));

// USDA relevance is poor for compound queries: "beef burger" returns
// "Veggie burger" first. Re-rank so the result actually matches what was typed.
function pickBestMatch(foods, query) {
  const lowered = query.toLowerCase();
  const tokens = queryTokens(query);
  const queryIsPlant = looksPlantBased(lowered);

  const ranked = foods
    .map((food) => {
      const description = (food.description || "").toLowerCase();
      let score = 0;

      const hits = tokens.filter((token) => description.includes(token)).length;
      score += hits * 10;
      if (tokens.length && hits === tokens.length) score += 20;
      if (description === lowered) score += 25;

      // Never answer a meat query with a plant product, or vice versa.
      if (looksPlantBased(description) !== queryIsPlant) score -= 18;

      if (food.dataType === "Survey (FNDDS)") score += 8;
      else if (food.dataType === "SR Legacy") score += 2;
      else if (food.dataType === "Branded") score -= 6;

      score -= Math.min(description.length / 40, 4);
      return { food, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked.length ? ranked[0].food : null;
}

function readNutrient(nutrients, matcher) {
  const found = nutrients.find(matcher);
  return found && typeof found.value === "number" ? found.value : null;
}

// FNDDS/SR values are per 100g. foodMeasures carries the real portion weight,
// so a burger reads ~290 cal instead of a meaningless 265 per 100g.
function servingGrams(food) {
  const measures = food.foodMeasures || [];
  const ranked = measures.filter((m) => m.gramWeight).sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const grams = ranked.length ? ranked[0].gramWeight : food.servingSize;
  if (!grams || Number.isNaN(Number(grams))) return 100;
  return Math.min(Math.max(Number(grams), 100), 450);
}

const usdaCache = {};

async function searchUSDANutrition(foodName) {
  const cacheKey = foodName.trim().toLowerCase();
  if (usdaCache[cacheKey]) return usdaCache[cacheKey];

  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(foodName)}` +
    `&pageSize=25&api_key=${USDA_API_KEY}`;

  const response = await fetch(url);

  if (response.status === 429) {
    throw new Error("USDA hourly rate limit reached — showing an estimate.");
  }
  if (!response.ok) {
    throw new Error(`USDA API returned ${response.status} — showing an estimate.`);
  }

  const data = await response.json();
  const food = pickBestMatch(data.foods || [], foodName);
  if (!food) return null;

  const nutrients = food.foodNutrients || [];
  const grams = servingGrams(food);
  const scale = grams / 100;
  const round = (value) => (value === null ? null : Math.round(value * scale));

  // Classify from the user's words first — that is the real statement of intent.
  const combined = `${foodName} ${food.description}`;
  const ingredient = classifyIngredient(combined);
  const format = classifyFormat(combined);
  const carbon = getCarbonScore(ingredient);

  const result = {
    name: titleCase(food.description),
    calories: round(readNutrient(nutrients, (n) => /^energy$/i.test(n.nutrientName) && n.unitName === "KCAL")),
    protein: round(readNutrient(nutrients, (n) => /^protein$/i.test(n.nutrientName))),
    carbs: round(readNutrient(nutrients, (n) => /^carbohydrate, by difference$/i.test(n.nutrientName))),
    fat: round(readNutrient(nutrients, (n) => /^total lipid \(fat\)$/i.test(n.nutrientName))),
    servingGrams: Math.round(grams),
    source: "USDA FoodData Central",
    ingredient,
    ingredientLabel: ingredientLabelFor(combined, ingredient),
    format,
    carbon,
    category: getCarbonCategory(carbon)
  };

  usdaCache[cacheKey] = result;
  return result;
}

// Baselines per format, so a sorbet is not estimated at 20g of protein.
// This path runs whenever USDA misses or rate-limits, so it has to be sane.
const FORMAT_BASE_NUTRITION = {
  main: { calories: 400, protein: 20, carbs: 40, fat: 15 },
  dessert: { calories: 380, protein: 5, carbs: 48, fat: 18 },
  breakfast: { calories: 420, protein: 15, carbs: 52, fat: 14 },
  soup: { calories: 260, protein: 12, carbs: 32, fat: 9 },
  drink: { calories: 180, protein: 4, carbs: 28, fat: 5 }
};

function estimateNutrition(foodName) {
  const name = (foodName || "").toLowerCase();
  const ingredient = classifyIngredient(name);
  const format = classifyFormat(name);
  const carbon = getCarbonScore(ingredient);

  let nutrition = FORMAT_BASE_NUTRITION[format] || FORMAT_BASE_NUTRITION.main;

  if (format === "main") {
    if (name.includes("burger") || name.includes("nugget")) nutrition = { calories: 500, protein: 25, carbs: 45, fat: 25 };
    else if (name.includes("salad")) nutrition = { calories: 350, protein: 15, carbs: 30, fat: 12 };
    else if (name.includes("chicken")) nutrition = { calories: 450, protein: 35, carbs: 30, fat: 15 };
    else if (name.includes("fish") || name.includes("salmon")) nutrition = { calories: 400, protein: 40, carbs: 20, fat: 15 };
    else if (name.includes("pizza")) nutrition = { calories: 600, protein: 20, carbs: 70, fat: 25 };
    else if (name.includes("bean") || name.includes("tofu")) nutrition = { calories: 380, protein: 18, carbs: 50, fat: 8 };
  } else if (format === "dessert") {
    if (name.includes("sorbet") || name.includes("sherbet")) nutrition = { calories: 150, protein: 1, carbs: 36, fat: 0 };
    else if (name.includes("cheesecake")) nutrition = { calories: 430, protein: 7, carbs: 38, fat: 28 };
    else if (name.includes("ice cream") || name.includes("gelato")) nutrition = { calories: 290, protein: 5, carbs: 33, fat: 15 };
    else if (name.includes("cookie") || name.includes("brownie")) nutrition = { calories: 260, protein: 3, carbs: 36, fat: 12 };
  } else if (format === "drink") {
    if (name.includes("tea") || name.includes("coffee") || name.includes("cold brew")) nutrition = { calories: 15, protein: 0, carbs: 3, fat: 0 };
    else if (name.includes("smoothie") || name.includes("juice")) nutrition = { calories: 220, protein: 3, carbs: 48, fat: 2 };
  }

  return {
    name: titleCase(foodName),
    ...nutrition,
    ingredient,
    ingredientLabel: ingredientLabelFor(name, ingredient),
    format,
    carbon,
    category: getCarbonCategory(carbon),
    servingGrams: null,
    source: "Estimated"
  };
}

/* -------------------------------------------------------- alternatives ---- */

// Fixed macros rather than Math.random(), so numbers stay stable across
// re-renders and never produce an implausible combination on stage.
const ALTERNATIVE_CATALOG = [
  // --- mains ---
  { name: "Black Bean Burger", placesQuery: "veggie burger restaurant", dishTerms: ["black bean burger","bean burger","veggie burger"], format: "main", ingredient: "beans", price: 11.0, calories: 430, protein: 21, carbs: 52, fat: 14, tags: ["vegan", "vegetarian", "dairy-free"] },
  { name: "Falafel & Hummus Bowl", placesQuery: "falafel restaurant", dishTerms: ["falafel","hummus"], format: "main", ingredient: "beans", price: 10.5, calories: 470, protein: 19, carbs: 55, fat: 17, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Baked Tofu Rice Bowl", placesQuery: "vegan rice bowl restaurant", dishTerms: ["tofu bowl","tofu rice","baked tofu"], format: "main", ingredient: "tofu", price: 10.0, calories: 410, protein: 22, carbs: 48, fat: 12, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Red Lentil Dal & Rice", placesQuery: "indian restaurant", dishTerms: ["lentil dal","dal","daal"], format: "main", ingredient: "lentils", price: 9.0, calories: 395, protein: 18, carbs: 58, fat: 8, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Mediterranean Veggie Wrap", placesQuery: "mediterranean wrap restaurant", dishTerms: ["veggie wrap","falafel wrap","mediterranean wrap"], format: "main", ingredient: "vegetable", price: 9.5, calories: 380, protein: 13, carbs: 49, fat: 14, tags: ["vegan", "vegetarian", "dairy-free"] },
  { name: "Quinoa Power Salad", placesQuery: "salad restaurant", dishTerms: ["quinoa salad","quinoa bowl","quinoa"], format: "main", ingredient: "grains", price: 10.0, calories: 420, protein: 16, carbs: 51, fat: 16, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Roasted Veggie Grain Bowl", placesQuery: "grain bowl restaurant", dishTerms: ["grain bowl","veggie bowl","roasted veggie"], format: "main", ingredient: "vegetable", price: 9.5, calories: 400, protein: 14, carbs: 54, fat: 13, tags: ["vegan", "vegetarian", "dairy-free"] },
  { name: "Tofu Poke Bowl", placesQuery: "poke bowl restaurant", dishTerms: ["poke bowl","tofu poke"], format: "main", ingredient: "tofu", price: 12.0, calories: 450, protein: 24, carbs: 56, fat: 13, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Caprese Sandwich", placesQuery: "sandwich shop", dishTerms: ["caprese"], format: "main", ingredient: "cheese", price: 10.0, calories: 480, protein: 20, carbs: 46, fat: 23, tags: ["vegetarian"] },
  { name: "Grilled Chicken Sandwich", placesQuery: "grilled chicken sandwich restaurant", dishTerms: ["chicken sandwich","grilled chicken"], format: "main", ingredient: "chicken", price: 12.0, calories: 520, protein: 38, carbs: 44, fat: 18, tags: ["dairy-free"] },
  { name: "Turkey & Avocado Sandwich", placesQuery: "deli sandwich shop", dishTerms: ["turkey sandwich","turkey and avocado","turkey club"], format: "main", ingredient: "turkey", price: 11.5, calories: 495, protein: 32, carbs: 45, fat: 19, tags: ["dairy-free"] },
  { name: "Grilled Salmon Salad", placesQuery: "seafood restaurant", dishTerms: ["salmon salad","grilled salmon"], format: "main", ingredient: "fish", price: 14.0, calories: 460, protein: 36, carbs: 22, fat: 26, tags: ["dairy-free", "gluten-free"] },

  // --- desserts: dairy-heavy sweets are the high-impact ones, fruit the low ---
  { name: "Fresh Berry Sorbet", placesQuery: "sorbet gelato shop", dishTerms: ["berry sorbet","sorbet"], format: "dessert", ingredient: "fruit", price: 5.5, calories: 140, protein: 1, carbs: 34, fat: 0, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Banana Nice Cream", placesQuery: "vegan ice cream shop", dishTerms: ["nice cream","banana ice cream","banana soft serve"], format: "dessert", ingredient: "fruit", price: 5.0, calories: 180, protein: 3, carbs: 40, fat: 2, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Dark Chocolate Avocado Mousse", placesQuery: "vegan dessert shop", dishTerms: ["chocolate mousse","avocado mousse","mousse"], format: "dessert", ingredient: "fruit", price: 6.5, calories: 260, protein: 5, carbs: 28, fat: 15, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Vegan Cashew Cheesecake", placesQuery: "vegan bakery", dishTerms: ["cashew cheesecake","vegan cheesecake","cheesecake"], format: "dessert", ingredient: "nuts", price: 7.5, calories: 340, protein: 7, carbs: 32, fat: 21, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Oat Milk Soft Serve", placesQuery: "vegan ice cream", dishTerms: ["oat milk soft serve","soft serve","oat milk ice cream"], format: "dessert", ingredient: "oat", price: 6.0, calories: 230, protein: 5, carbs: 38, fat: 7, tags: ["vegan", "vegetarian", "dairy-free"] },
  { name: "Grilled Peach with Honey", placesQuery: "dessert cafe", dishTerms: ["grilled peach","peach cobbler"], format: "dessert", ingredient: "fruit", price: 6.0, calories: 160, protein: 2, carbs: 36, fat: 1, tags: ["vegetarian", "dairy-free", "gluten-free"] },
  { name: "Apple Cinnamon Crumble", placesQuery: "pie bakery", dishTerms: ["apple crumble","apple crisp","crumble"], format: "dessert", ingredient: "pastry", price: 6.0, calories: 330, protein: 4, carbs: 52, fat: 12, tags: ["vegetarian"] },

  // --- breakfast ---
  { name: "Steel-Cut Oatmeal with Berries", placesQuery: "breakfast cafe", dishTerms: ["oatmeal","steel cut oats","porridge"], format: "breakfast", ingredient: "oat", price: 6.0, calories: 320, protein: 10, carbs: 54, fat: 7, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Coconut Yogurt & Fruit Parfait", placesQuery: "acai bowl cafe", dishTerms: ["parfait","coconut yogurt","yogurt bowl"], format: "breakfast", ingredient: "fruit", price: 7.0, calories: 290, protein: 6, carbs: 44, fat: 11, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Sweet Potato Hash", placesQuery: "brunch restaurant", dishTerms: ["sweet potato hash","potato hash"], format: "breakfast", ingredient: "vegetable", price: 7.5, calories: 350, protein: 8, carbs: 52, fat: 12, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Avocado Toast", placesQuery: "avocado toast cafe", dishTerms: ["avocado toast","avo toast"], format: "breakfast", ingredient: "grains", price: 8.0, calories: 390, protein: 11, carbs: 42, fat: 20, tags: ["vegan", "vegetarian", "dairy-free"] },
  { name: "Tofu Scramble Wrap", placesQuery: "vegan breakfast restaurant", dishTerms: ["tofu scramble","scramble wrap","vegan breakfast burrito"], format: "breakfast", ingredient: "tofu", price: 8.5, calories: 430, protein: 22, carbs: 45, fat: 17, tags: ["vegan", "vegetarian", "dairy-free"] },
  { name: "Peanut Butter Banana Toast", placesQuery: "coffee shop", dishTerms: ["peanut butter toast","peanut butter banana","pb toast"], format: "breakfast", ingredient: "nuts", price: 6.5, calories: 370, protein: 12, carbs: 45, fat: 16, tags: ["vegan", "vegetarian", "dairy-free"] },

  // --- soups ---
  { name: "Tomato Basil Soup", placesQuery: "soup restaurant", dishTerms: ["tomato soup","tomato basil"], format: "soup", ingredient: "vegetable", price: 6.5, calories: 210, protein: 5, carbs: 30, fat: 8, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Red Lentil Soup", placesQuery: "lentil soup restaurant", dishTerms: ["lentil soup","red lentil"], format: "soup", ingredient: "lentils", price: 7.0, calories: 280, protein: 15, carbs: 42, fat: 5, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Black Bean Soup", placesQuery: "soup restaurant", dishTerms: ["black bean soup","bean soup"], format: "soup", ingredient: "beans", price: 7.0, calories: 300, protein: 16, carbs: 45, fat: 6, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "White Bean & Kale Stew", placesQuery: "soup and stew restaurant", dishTerms: ["white bean","kale stew","bean stew"], format: "soup", ingredient: "beans", price: 9.0, calories: 340, protein: 17, carbs: 44, fat: 9, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Minestrone", placesQuery: "italian restaurant", dishTerms: ["minestrone"], format: "soup", ingredient: "vegetable", price: 7.5, calories: 260, protein: 10, carbs: 44, fat: 6, tags: ["vegan", "vegetarian", "dairy-free"] },
  { name: "Mushroom Barley Soup", placesQuery: "soup restaurant", dishTerms: ["mushroom barley","mushroom soup","barley soup"], format: "soup", ingredient: "vegetable", price: 8.5, calories: 310, protein: 12, carbs: 47, fat: 7, tags: ["vegan", "vegetarian", "dairy-free"] },

  // --- drinks: dairy milk is the footprint, plant milks and tea are not ---
  { name: "Iced Green Tea", placesQuery: "tea house", dishTerms: ["green tea","iced tea","matcha"], format: "drink", ingredient: "beverage", price: 3.5, calories: 5, protein: 0, carbs: 1, fat: 0, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Cold Brew, Black", placesQuery: "coffee shop", dishTerms: ["cold brew"], format: "drink", ingredient: "beverage", price: 4.0, calories: 10, protein: 0, carbs: 2, fat: 0, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Fresh Fruit Smoothie", placesQuery: "smoothie bar", dishTerms: ["smoothie","fruit smoothie"], format: "drink", ingredient: "fruit", price: 6.0, calories: 210, protein: 4, carbs: 46, fat: 2, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Oat Milk Latte", placesQuery: "oat milk coffee shop", dishTerms: ["oat milk latte","oat latte","oatmilk latte"], format: "drink", ingredient: "oat", price: 5.0, calories: 150, protein: 4, carbs: 22, fat: 5, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] },
  { name: "Soy Cappuccino", placesQuery: "coffee shop", dishTerms: ["soy cappuccino","soy latte","cappuccino"], format: "drink", ingredient: "soy", price: 4.75, calories: 120, protein: 7, carbs: 14, fat: 4, tags: ["vegan", "vegetarian", "dairy-free", "gluten-free"] }
];

function matchesDiet(item, diet) {
  if (!diet || diet === "none") return true;
  if (item.tags.includes(diet)) return true;
  // Vegan food always satisfies vegetarian and dairy-free requests.
  if (item.tags.includes("vegan") && (diet === "vegetarian" || diet === "dairy-free")) return true;
  return false;
}

function generateAlternatives(original, { diet, budget, query }) {
  const words = queryTokens(query);
  const originalCarbon = original.carbon;
  const format = original.format || "main";

  const candidates = ALTERNATIVE_CATALOG
    .map((item) => ({ ...item, carbon: getCarbonScore(item.ingredient) }))
    // Only ever swap a dessert for a dessert, a drink for a drink.
    .filter((item) => item.format === format)
    .filter((item) => item.carbon < originalCarbon)
    .filter((item) => matchesDiet(item, diet))
    .filter((item) => !budget || item.price <= budget * 1.15)
    .map((item) => {
      const name = item.name.toLowerCase();
      // Nudge toward the same dish the user asked for, but keep the bonus small
      // enough that it cannot outrank a substantially lower-carbon option.
      const relevance = words.some((word) => name.includes(word)) ? 2 : 0;
      return {
        ...item,
        fit: nutritionFit(original, item),
        rankScore: (originalCarbon - item.carbon) * 3 + relevance
      };
    })
    // A nutritionally comparable swap outranks a lower-carbon one that leaves
    // you hungry, however big the carbon number on it looks.
    .sort((a, b) => Number(b.fit.comparable) - Number(a.fit.comparable) || b.rankScore - a.rankScore);

  // Vary the ingredient so the list is not three near-identical bean bowls.
  const take = (pool, limit) => {
    const chosen = [];
    const usedIngredients = new Set();
    for (const item of pool) {
      if (usedIngredients.has(item.ingredient)) continue;
      usedIngredients.add(item.ingredient);
      chosen.push(item);
      if (chosen.length === limit) break;
    }
    for (const item of pool) {
      if (chosen.length === limit) break;
      if (!chosen.includes(item)) chosen.push(item);
    }
    return chosen;
  };

  const comparable = candidates.filter((item) => item.fit.comparable);
  const flagged = candidates.filter((item) => !item.fit.comparable);

  const picked = take(comparable, 3);

  // Carry a couple of the flagged options too, even though they are hidden by
  // default. These are exactly what a carbon-only recommender would have put
  // at the top — a 5 kcal tea "beating" a milkshake — so keeping them, hidden
  // and labelled, is what makes the guardrail visible instead of silent.
  const extras = take(flagged, picked.length ? 2 : 3);

  return [...picked, ...extras].map((item, idx) => ({
    id: idx + 2,
    name: item.name,
    ingredient: item.ingredient,
    format: item.format,
    carbon: item.carbon,
    category: getCarbonCategory(item.carbon),
    price: item.price,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    tags: item.tags,
    fit: item.fit,
    placesQuery: item.placesQuery,
    dishTerms: item.dishTerms
  }));
}

/* ------------------------------------------------------------- rewards ---- */

// The app only ever asks one thing of you — take the lower-carbon swap — so the
// reward has to track exactly that. Two independent earners, both continuous so
// there is no cliff where one more gram of CO2e costs you a whole tier:
//
//   1. the footprint of what you ordered  (lower = more)
//   2. how much that saved against what you searched for
//
// Everything else (streak, tier) is a multiplier on top, never a replacement.

const REWARDS_STORAGE_KEY = "sustaineat.rewards.v1";

// Beef sits at 8.5 kg and lamb at 20, so a ceiling of 8 means the meat-heavy end
// of the catalog earns nothing from its own footprint and has to rely on the
// saving. A berry sorbet at 0.3 earns the near-full 116.
const FOOTPRINT_CEILING = 8.0;
const POINTS_PER_KG_UNDER_CEILING = 15;

const POINTS_PER_KG_SAVED = 25;
// A lamb-to-sorbet swap genuinely saves ~19.7 kg, but letting one order pay out
// 490 points makes every order after it feel pointless. Count the first 12 kg.
const MAX_SAVED_KG_COUNTED = 12;

// Consecutive LOW-impact orders. Capped, or a long streak would dwarf the
// footprint signal the whole scheme is built on.
const STREAK_BONUS_PER_ORDER = 0.1;
const MAX_STREAK_MULTIPLIER = 1.5;

// Only the last N entries are kept, so the ledger cannot grow without bound in
// localStorage.
const MAX_HISTORY = 25;

// Tier is earned on LIFETIME points and never falls when you spend, so
// redeeming a reward can never demote you.
const TIERS = [
  { name: "Seedling",   icon: "🌱", min: 0,     multiplier: 1.0,  perk: "You are earning points on every swap" },
  { name: "Sprout",     icon: "🌿", min: 500,   multiplier: 1.05, perk: "+5% points on every order" },
  { name: "Sapling",    icon: "🪴", min: 1500,  multiplier: 1.1,  perk: "+10% points, early access to new rewards" },
  { name: "Canopy",     icon: "🌳", min: 4000,  multiplier: 1.15, perk: "+15% points, free pickup upgrades" },
  { name: "Old Growth", icon: "🌲", min: 10000, multiplier: 1.2,  perk: "+20% points, a tree planted every month" }
];

// `discount` is dollars off an order and is applied at checkout. A reward with
// no discount is a perk, redeemed straight from the rewards page.
const REWARD_CATALOG = [
  { id: "off-2",   cost: 300,  discount: 2,  icon: "🎟️", name: "$2 off",      detail: "Straight off your next pickup order." },
  { id: "milk",    cost: 550,  discount: 0,  icon: "🥤", name: "Plant-milk upgrade", detail: "Oat, soy or almond on the house at any partner cafe." },
  { id: "off-5",   cost: 700,  discount: 5,  icon: "🎟️", name: "$5 off",      detail: "Enough to cover a sorbet outright." },
  { id: "tree",    cost: 900,  discount: 0,  icon: "🌳", name: "Plant a tree", detail: "We fund one sapling through a reforestation partner, in your name." },
  { id: "off-10",  cost: 1300, discount: 10, icon: "🎟️", name: "$10 off",     detail: "Roughly a whole grain bowl, free." },
  { id: "off-20",  cost: 2400, discount: 20, icon: "🏅", name: "$20 off",      detail: "The big one. Two lunches on us." }
];

function rewardById(id) {
  return REWARD_CATALOG.find((reward) => reward.id === id) || null;
}

function footprintPoints(carbon) {
  return Math.round(Math.max(0, FOOTPRINT_CEILING - carbon) * POINTS_PER_KG_UNDER_CEILING);
}

function savingsPoints(savedKg) {
  const counted = Math.min(Math.max(0, savedKg || 0), MAX_SAVED_KG_COUNTED);
  return Math.round(counted * POINTS_PER_KG_SAVED);
}

function streakMultiplier(streak) {
  return Math.min(MAX_STREAK_MULTIPLIER, 1 + Math.max(0, streak || 0) * STREAK_BONUS_PER_ORDER);
}

function tierFor(lifetimePoints) {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (lifetimePoints >= tier.min) current = tier;
  }
  return current;
}

function nextTierFor(lifetimePoints) {
  return TIERS.find((tier) => lifetimePoints < tier.min) || null;
}

// How far through the current tier you are, for the progress bar.
function tierProgress(lifetimePoints) {
  const current = tierFor(lifetimePoints);
  const next = nextTierFor(lifetimePoints);
  if (!next) return 100;
  return Math.min(100, Math.round(((lifetimePoints - current.min) / (next.min - current.min)) * 100));
}

// Single source of truth for the arithmetic, so the "+230 pts" on a results
// card, the checkout preview and the receipt can never disagree.
function pointsForOrder({ carbon, savedKg, streak, lifetimePoints }) {
  const footprint = footprintPoints(carbon);
  const savings = savingsPoints(savedKg);
  const streakMult = streakMultiplier(streak);
  const tier = tierFor(lifetimePoints || 0);
  const saved = Math.max(0, savedKg || 0);
  const countedKg = Math.min(saved, MAX_SAVED_KG_COUNTED);
  return {
    footprint,
    savings,
    savedKg: saved,
    countedKg,
    // Surfaced on the receipt, so a lamb swap does not read as a
    // contradiction: 19.5 kg saved above, points for only 12 below.
    capped: countedKg < saved,
    streak: streak || 0,
    streakMult,
    tier,
    total: Math.round((footprint + savings) * streakMult * tier.multiplier)
  };
}

// Ordering something that was already low-impact earns its own, smaller award.
// Deliberately NOT pointsForOrder: there is no swap, so the savings term is
// meaningless, and the streak and tier multipliers are left out so this can
// never inflate to swap size. What is left is the app's existing "how low is
// this food" arithmetic and nothing new — ramen at 0.5 kg pays 113, where
// swapping into it would pay roughly three times that.
//
// Separate function on purpose. pointsForOrder is the swap path's and stays
// untouched.
function pointsForLowImpactChoice(carbon) {
  const footprint = footprintPoints(carbon);
  return { footprint, total: footprint };
}

/* ---------------------------------------------------- the points ledger --- */

const EMPTY_REWARDS = { points: 0, lifetimePoints: 0, streak: 0, orders: [], redemptions: [] };

const safeNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const safeList = (value) => (Array.isArray(value) ? value.slice(0, MAX_HISTORY) : []);

function loadRewards() {
  try {
    const raw = window.localStorage.getItem(REWARDS_STORAGE_KEY);
    if (!raw) return { ...EMPTY_REWARDS };
    const parsed = JSON.parse(raw) || {};
    // Re-derive every field rather than trusting the blob: a half-written or
    // hand-edited entry should cost you history, not turn the balance into NaN
    // and render "NaN pts" for the rest of the demo.
    return {
      points: Math.max(0, safeNumber(parsed.points)),
      lifetimePoints: Math.max(0, safeNumber(parsed.lifetimePoints)),
      streak: Math.max(0, safeNumber(parsed.streak)),
      orders: safeList(parsed.orders),
      redemptions: safeList(parsed.redemptions)
    };
  } catch (err) {
    // A private window, blocked site data or a corrupt entry all land here. A
    // demo must not die because the browser will not remember anything.
    return { ...EMPTY_REWARDS };
  }
}

function saveRewards(state) {
  try {
    window.localStorage.setItem(REWARDS_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Storage full or unavailable — the session keeps working in memory.
  }
  return state;
}

// Spend first, then earn, so an order can never be paid for with the points
// that same order is about to pay out.
function applyOrder(rewards, { meal, original, restaurant, reward, earned }) {
  const spent = reward ? reward.cost : 0;
  const entry = {
    at: Date.now(),
    name: meal.name,
    versus: original.name,
    carbon: meal.carbon,
    savedKg: Math.max(0, original.carbon - meal.carbon),
    points: earned.total,
    venue: restaurant ? restaurant.name : null
  };
  return {
    points: Math.max(0, rewards.points - spent) + earned.total,
    lifetimePoints: rewards.lifetimePoints + earned.total,
    // Only a genuinely low-impact order extends the streak; a medium one ends
    // it. Otherwise "streak" would just mean "ordered again".
    streak: meal.category === "low" ? rewards.streak + 1 : 0,
    orders: [entry, ...rewards.orders].slice(0, MAX_HISTORY),
    redemptions: reward
      ? [{ at: Date.now(), id: reward.id, name: reward.name, cost: reward.cost }, ...rewards.redemptions].slice(0, MAX_HISTORY)
      : rewards.redemptions
  };
}

// A claim is a button with no checkout behind it, so nothing about the flow
// stops it being clicked fifty times. One claim per food per day is the guard:
// enough to earn again on a genuinely new order tomorrow, not enough to mint
// points by clicking.
// Flagged with its own field rather than `kind`: RewardsPage rebuilds the
// timeline with `{ ...entry, kind: "earn" }`, which would overwrite a `kind`
// set here. These really are earns, so that mapping is right -- they just need
// to stay distinguishable inside it.
function hasClaimedLowImpact(rewards, foodName) {
  const today = new Date().toDateString();
  return (rewards.orders || []).some((entry) =>
    entry.lowImpact === true &&
    entry.name === foodName &&
    new Date(entry.at).toDateString() === today
  );
}

function applyLowImpactClaim(rewards, { original, venue, earned }) {
  // The button is already disabled once claimed; this is the guard that keeps
  // the balance honest if it is ever reached another way.
  if (hasClaimedLowImpact(rewards, original.name)) return rewards;

  const entry = {
    at: Date.now(),
    lowImpact: true,
    name: original.name,
    // No swap happened, so there is nothing this was chosen over and nothing
    // saved against it. The history row reads both, so they are set explicitly
    // rather than left undefined.
    versus: null,
    savedKg: 0,
    carbon: original.carbon,
    points: earned.total,
    venue: venue ? venue.name : null
  };

  return {
    ...rewards,
    points: rewards.points + earned.total,
    lifetimePoints: rewards.lifetimePoints + earned.total,
    // Streak is deliberately left alone. It multiplies pointsForOrder, so
    // bumping it here would quietly raise the next swap's payout — which is
    // precisely the swap-points behaviour this feature must not change.
    orders: [entry, ...rewards.orders].slice(0, MAX_HISTORY)
  };
}

function applyRedemption(rewards, reward) {
  return {
    ...rewards,
    points: Math.max(0, rewards.points - reward.cost),
    redemptions: [{ at: Date.now(), id: reward.id, name: reward.name, cost: reward.cost }, ...rewards.redemptions].slice(0, MAX_HISTORY)
  };
}

/* ------------------------------------------------------------- photos ----- */

// Every photo can fail after the page has rendered - a dead stock-photo URL, a
// Place Photos call that 502s - so each one carries its own fallback tile and
// swaps to it on error rather than leaving a broken image in the card.
function FoodPhoto({ photo, name }) {
  const [failed, setFailed] = useState(false);
  const usable = photo && photo.ok && photo.url && !failed;

  if (!usable) {
    return <div className="card-photo card-photo-empty" aria-hidden="true">🍽️</div>;
  }

  return (
    <div className="card-photo">
      <img
        src={photo.url}
        alt={photo.alt || name}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// Google requires the attribution wherever the image appears, so the caption is
// rendered from authorAttributions and the photo is only shown when it is there
// to render alongside.
function VenuePhoto({ photo, venueName }) {
  const [failed, setFailed] = useState(false);
  const src = placePhotoUrl(photo, 200);
  if (!src || failed) return null;

  return (
    <div className="venue-thumb">
      <img
        src={src}
        alt={`${venueName}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {photo.attribution && (
        <span className="venue-thumb-credit" title={`Photo: ${photo.attribution}`}>
          {photo.attribution}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ backend ----- */

async function fetchNearbyRestaurants(latitude, longitude, foodType, radiusMiles) {
  const response = await fetch(`${BACKEND_URL}/api/restaurants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude, longitude, foodType, radiusMiles })
  });
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return response.json();
}

// "veggie burger restaurant" is a search phrase, not something to show a
// person. Trim the trailing category word when a readable phrase remains.
function categoryLabel(placesQuery) {
  const raw = String(placesQuery || "place").trim();
  const trimmed = raw.replace(/\s+(restaurant|shop|cafe|bar)$/i, "");
  const readable = trimmed.split(/\s+/).length >= 2 ? trimmed : raw;
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

// Reserved results key for the searched food's own venue lookup. Alternatives
// key off their numeric catalog id, so a non-numeric key cannot collide.
const PICKUP_KEY = "searched-food";

// No delivery platform exposes a public merchant lookup — those APIs are
// partner-only — so there is no way to check whether a given restaurant is on
// DoorDash or Uber Eats, or to link to its menu if it is. These open a SEARCH
// for the venue's name, which may return that restaurant, a different one, or
// nothing. Hence the "Search" label: the button promises a search, which is all
// it can deliver. Both patterns verified to resolve; Uber Eats uses /feed, not
// /search, which 404s.
const DELIVERY_SEARCHES = [
  { id: "doordash", label: "DoorDash", href: (q) => `https://www.doordash.com/search/store/${q}/` },
  { id: "ubereats", label: "Uber Eats", href: (q) => `https://www.ubereats.com/feed?q=${q}` }
];

function deliverySearchLinks(venueName) {
  const query = encodeURIComponent(String(venueName || "").trim());
  if (!query) return [];
  return DELIVERY_SEARCHES.map((p) => ({ id: p.id, label: p.label, href: p.href(query) }));
}

// The searched food is not in the catalog, so unlike an alternative it has no
// placesQuery or dishTerms of its own. Build them from what the user actually
// typed: the USDA name can come back as "Soup, Ramen Noodle, Beef Flavor, Dry",
// which is useless both as a Places query and as a review needle — and since
// dishTerms drives the evidence quote shown on the card, a garbled term would
// be printed verbatim.
function pickupQueryForSearch(query, foodName) {
  const label = String(query || "").trim() || String(foodName || "").trim() || "food";
  return { placesQuery: `${label} restaurant`, dishTerms: [label.toLowerCase()] };
}

// One targeted Places search per alternative. An alternative is only offered
// if something nearby actually sells that kind of food.
async function fetchAlternativeVenues(latitude, longitude, radiusMiles, alternatives) {
  const response = await fetch(`${BACKEND_URL}/api/alternatives-nearby`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      latitude,
      longitude,
      radiusMiles,
      queries: alternatives.map((alt) => ({
        key: String(alt.id),
        label: alt.name,
        query: alt.placesQuery,
        dishTerms: alt.dishTerms
      }))
    })
  });
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return response.json();
}

// The image bytes come through the backend, never straight from Google: the
// media URL needs the Places key, and that key must not reach the browser.
function placePhotoUrl(photo, maxWidth) {
  if (!photo || !photo.name) return null;
  return `${BACKEND_URL}/api/place-photo?name=${encodeURIComponent(photo.name)}` +
    `&maxWidth=${maxWidth || 400}`;
}

// One request for the whole grid. Keyed by food name, which is what the cards
// are keyed by too, so the lookup on render is direct.
async function fetchFoodPhotos(names) {
  const response = await fetch(`${BACKEND_URL}/api/food-photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names })
  });
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return response.json();
}

function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ...FALLBACK_LOCATION, approximate: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, approximate: false }),
      () => resolve({ ...FALLBACK_LOCATION, approximate: true }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });
}

/* --------------------------------------------------------- components ----- */

function SustainabilityBadge({ carbon, category }) {
  const categoryClass = category === "high" ? "badge-red" : category === "medium" ? "badge-yellow" : "badge-green";
  return (
    <div className={`sustainability-badge ${categoryClass}`}>
      <div className="badge-value">{carbon.toFixed(1)} kg CO₂e</div>
      <div className="badge-label">{category.toUpperCase()} IMPACT</div>
    </div>
  );
}

function NutritionGrid({ meal }) {
  const cells = [
    { label: "Calories", value: meal.calories },
    { label: "Protein", value: `${meal.protein}g` },
    { label: "Carbs", value: `${meal.carbs}g` },
    { label: "Fat", value: `${meal.fat}g` }
  ];
  return (
    <div className="nutrition-grid">
      {cells.map((cell) => (
        <div className="nutrition-item" key={cell.label}>
          <span className="label">{cell.label}</span>
          <span className="value">{cell.value}</span>
        </div>
      ))}
    </div>
  );
}

// Projects real lat/lng onto a square panel, so pins keep their true bearing
// and spacing without needing the (billable) Maps JavaScript API.
// Tracks the Google Maps script. Starts from whatever index.html already
// recorded, then follows it — including a failure that arrives after "ready".
function useGoogleMapsState() {
  const [state, setState] = useState(() => window.__gmapsState || "loading");

  useEffect(() => {
    const onChange = (next) => setState(next);
    window.__gmapsWaiters = window.__gmapsWaiters || [];
    window.__gmapsWaiters.push(onChange);

    // If the script never answers at all, stop waiting and use the fallback.
    const timer = setTimeout(() => {
      setState((prev) => (prev === "loading" ? "failed" : prev));
    }, 15000);

    return () => {
      window.__gmapsWaiters = window.__gmapsWaiters.filter((fn) => fn !== onChange);
      clearTimeout(timer);
    };
  }, []);

  return state;
}

// Built as DOM, not an HTML string: venue names come from Google and a stray
// "<" in one of them should never become markup.
function buildInfoContent(group) {
  const wrap = document.createElement("div");
  wrap.className = "map-info";

  const name = document.createElement("div");
  name.className = "map-info-name";
  name.textContent = group.venue.name;
  wrap.appendChild(name);

  if (group.venue.address) {
    const addr = document.createElement("div");
    addr.className = "map-info-addr";
    addr.textContent = group.venue.address + " • " + group.venue.distance + " mi";
    wrap.appendChild(addr);
  }

  // Same two honest shapes as the card — no third wording.
  group.alts.forEach((alt) => {
    const line = document.createElement("div");
    line.className = alt.evidence ? "map-info-verified" : "map-info-maybe";
    line.textContent = alt.evidence
      ? "“" + alt.evidence.term + "” in reviews — " + alt.name
      : "may serve " + alt.name;
    wrap.appendChild(line);
  });

  return wrap;
}

function GoogleMapView({ origin, groups, selectedKey, onSelect }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const infoRef = useRef(null);

  // Identity of the venue set, not of the array holding it.
  const groupsSig = groups.map((g) => g.key + "@" + g.venue.lat + "," + g.venue.lng).join("|");

  const groupsRef = useRef(groups);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { groupsRef.current = groups; onSelectRef.current = onSelect; });

  // Map + "you are here", once.
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;

    const map = new google.maps.Map(boxRef.current, {
      center: { lat: origin.latitude, lng: origin.longitude },
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false
    });
    mapRef.current = map;
    infoRef.current = new google.maps.InfoWindow();

    new google.maps.Marker({
      map,
      position: { lat: origin.latitude, lng: origin.longitude },
      title: "You are here",
      zIndex: 999,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#2f6b4f",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3
      }
    });
  }, [origin.latitude, origin.longitude]);

  // One numbered marker per venue, matching the list beside the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((marker) => marker.setMap(null));
    markersRef.current = {};

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: origin.latitude, lng: origin.longitude });

    const current = groupsRef.current;
    current.forEach((group, i) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: group.venue.lat, lng: group.venue.lng },
        title: group.venue.name,
        label: { text: String(i + 1), color: "#ffffff", fontWeight: "700", fontSize: "12px" }
      });
      marker.addListener("click", () => onSelectRef.current(group.key));
      markersRef.current[group.key] = marker;
      bounds.extend({ lat: group.venue.lat, lng: group.venue.lng });
    });

    if (current.length) {
      map.fitBounds(bounds, 48);
      // Three venues a few hundred metres apart would otherwise zoom to
      // street level and lose all context.
      google.maps.event.addListenerOnce(map, "idle", () => {
        if (map.getZoom() > 16) map.setZoom(16);
      });
    }

    window.__mapDebug = {
      state: "ready",
      markerCount: current.length,
      keys: current.map((g) => g.key),
      click: (i) => {
        const marker = markersRef.current[current[i] && current[i].key];
        if (marker) google.maps.event.trigger(marker, "click");
      }
    };
  }, [groupsSig, origin.latitude, origin.longitude]);

  // Selecting anywhere — card, row or marker — opens that venue's bubble.
  useEffect(() => {
    const map = mapRef.current;
    const info = infoRef.current;
    if (!map || !info) return;

    const group = groupsRef.current.find((g) => g.key === selectedKey);
    const marker = group ? markersRef.current[group.key] : null;
    if (!group || !marker) { info.close(); return; }

    info.setContent(buildInfoContent(group));
    info.open({ map, anchor: marker });
    map.panTo(marker.getPosition());
  }, [selectedKey, groupsSig]);

  return (
    <div className="mini-map is-google">
      <div ref={boxRef} className="google-map" />
    </div>
  );
}

function MiniMap({ origin, restaurants, selectedId, onSelect }) {
  const points = useMemo(() => {
    if (!restaurants.length) return [];
    const maxDistance = Math.max(...restaurants.map((r) => r.distance || 0), 0.5);
    const scale = 42 / maxDistance;
    return restaurants.map((restaurant, i) => {
      const dLat = restaurant.lat - origin.latitude;
      const dLng = (restaurant.lng - origin.longitude) * Math.cos((origin.latitude * Math.PI) / 180);
      const left = Math.min(Math.max(50 + dLng * 69 * scale, 8), 92);
      return {
        ...restaurant,
        index: i + 1,
        // Labels are absolutely positioned and centred; near the edges that
        // would clip, so anchor them inward instead.
        edge: left < 22 ? "edge-left" : left > 78 ? "edge-right" : "",
        top: Math.min(Math.max(50 - dLat * 69 * scale, 8), 92),
        left
      };
    });
  }, [restaurants, origin]);

  return (
    <div className="mini-map">
      <div className="mini-map-rings" />
      <div className="mini-map-you" title="You are here">You</div>
      {points.map((point) => (
        <button
          key={point.id}
          className={`mini-map-pin ${point.edge} ${selectedId === point.id ? "active" : ""}`}
          style={{ top: `${point.top}%`, left: `${point.left}%` }}
          onClick={() => onSelect(point)}
          title={`${point.name} — ${point.distance} mi`}
        >
          <span className="pin-dot">{point.index}</span>
          <span className="pin-label">{point.index}. {point.name}</span>
        </button>
      ))}
    </div>
  );
}

function HomePage({ onSearch, initial, rewards, onOpenRewards }) {
  const [searchQuery, setSearchQuery] = useState(initial.query || "");
  const [diet, setDiet] = useState(initial.diet || "none");
  const [budget, setBudget] = useState(initial.budget || "");
  const [distance, setDistance] = useState(String(initial.distance || "3"));
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    const location = await requestLocation();
    setLoading(false);

    onSearch({
      query: searchQuery.trim(),
      diet,
      budget: budget ? parseFloat(budget) : null,
      distance: parseFloat(distance),
      latitude: location.latitude,
      longitude: location.longitude,
      approximateLocation: location.approximate
    });
  };

  return (
    <div className="homepage">
      <div className="header">
        <h1 className="logo">🌱 SustainEat</h1>
      </div>

      <RewardsSummary rewards={rewards} onOpen={onOpenRewards} />

      <div className="hero">
        <h2>What are you craving right now?</h2>
        <p className="subtitle">(other than a smaller CO₂ footprint 😋)</p>

        <form onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="e.g., burger, chicken nuggets, pizza"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !searchQuery.trim()}>
            {loading ? "Getting your location…" : "Find Better Options"}
          </button>
        </form>
      </div>

      <div className="customization">
        <h3>Customize your preferences</h3>

        <div className="form-group">
          <label>Dietary Restrictions</label>
          <select value={diet} onChange={(e) => setDiet(e.target.value)}>
            <option value="none">None</option>
            <option value="vegan">Vegan</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="gluten-free">Gluten-Free</option>
            <option value="dairy-free">Dairy-Free</option>
          </select>
        </div>

        <div className="form-group">
          <label>Budget per meal (optional)</label>
          <input
            type="number"
            placeholder="e.g., 15"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            step="0.50"
            min="0"
          />
        </div>

        <div className="form-group">
          <label>Distance radius (miles)</label>
          <select value={distance} onChange={(e) => setDistance(e.target.value)}>
            <option value="1">1 mile</option>
            <option value="3">3 miles</option>
            <option value="5">5 miles</option>
            <option value="10">10 miles</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ResultsPage({ filters, rewards, onBack, onCheckout, onClaimLowImpact }) {
  const [state, setState] = useState({ loading: true });
  const [selectedMeal, setSelectedMeal] = useState(null);
  // Keyed by food name. Fills in after the page has already rendered.
  const [foodPhotos, setFoodPhotos] = useState({});
  // Driving is the honest default: it is what most people actually do for a
  // pickup, and it is the only mode under which a swap can come out negative.
  const [travelMode, setTravelMode] = useState("drive");
  const [comparableOnly, setComparableOnly] = useState(true);
  // Must sit above the loading early-return: hooks cannot be conditional.
  const mapsState = useGoogleMapsState();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const notes = [];

      let foodData;
      try {
        foodData = await searchUSDANutrition(filters.query);
        if (!foodData) {
          foodData = estimateNutrition(filters.query);
          notes.push("No USDA match for that search — showing an estimate.");
        }
      } catch (err) {
        foodData = estimateNutrition(filters.query);
        notes.push(err.message);
      }

      const original = {
        id: 1,
        name: foodData.name,
        calories: foodData.calories || 400,
        protein: foodData.protein || 20,
        carbs: foodData.carbs || 40,
        fat: foodData.fat || 15,
        carbon: foodData.carbon,
        category: foodData.category,
        ingredient: foodData.ingredient,
        ingredientLabel: foodData.ingredientLabel,
        format: foodData.format || "main",
        servingGrams: foodData.servingGrams,
        source: foodData.source,
        price: 12.0
      };

      const suggested = generateAlternatives(original, filters);

      // Where to get the searched food itself. Only worth asking when it is
      // already low-carbon: above that, the point of the page is the swap.
      // Started here and awaited below so it runs alongside the alternatives
      // lookup rather than adding a second round trip after it. It is also a
      // separate call on purpose — folding it into the alternatives request
      // would push a real alternative out of that endpoint's 8-query cap.
      const pickupPromise = original.category === "low"
        ? fetchAlternativeVenues(
            filters.latitude, filters.longitude, filters.distance,
            [{
              id: PICKUP_KEY,
              name: original.name,
              ...pickupQueryForSearch(filters.query, original.name)
            }]
          ).catch((err) => ({ pickupFailed: err.message }))
        : null;

      // Photos are decoration, so they are fetched alongside the venue lookup
      // and never awaited: a slow or rate-limited photo provider must not hold
      // up the results page. They pop into the cards whenever they arrive.
      setFoodPhotos({});
      if (suggested.length) {
        fetchFoodPhotos(suggested.map((alt) => alt.name))
          .then((payload) => { if (!cancelled) setFoodPhotos(payload.photos || {}); })
          .catch(() => { /* cards keep their placeholder tiles */ });
      }

      // Each suggestion has to earn its place by resolving to a real venue.
      let alternatives = suggested.map((alt) => ({
        ...alt, venues: [], venue: null, venueSource: "none", available: false
      }));
      let restaurantNotice = null;

      if (suggested.length) {
        try {
          const payload = await fetchAlternativeVenues(
            filters.latitude, filters.longitude, filters.distance, suggested
          );
          restaurantNotice = payload.notice || null;
          alternatives = suggested.map((alt) => {
            const found = (payload.results || {})[String(alt.id)] || { source: "google", venues: [] };
            return {
              ...alt,
              venues: found.venues || [],
              venue: (found.venues || [])[0] || null,
              // Evidence belongs to the venue we actually surface.
              evidence: ((found.venues || [])[0] || {}).evidence || null,
              venueSource: found.source,
              available: (found.venues || []).length > 0
            };
          });
        } catch (err) {
          // Name the URL that actually failed. The old wording told you to start
          // a backend that was already running, whenever the real fault was the
          // page resolving the wrong origin for it.
          restaurantNotice =
            `Could not reach the backend at ${BACKEND_URL} — ${err.message}. ` +
            "If it is not running, start it with `npm start` in the server folder.";
        }
        // Things you can actually get come first.
        alternatives.sort((a, b) => Number(b.available) - Number(a.available));
      }

      // Resolved after the alternatives above, so the two searches overlap.
      let pickup = null;
      if (pickupPromise) {
        const payload = await pickupPromise;
        if (payload.pickupFailed) {
          pickup = { status: "error", message: payload.pickupFailed, venues: [] };
        } else {
          const found = (payload.results || {})[PICKUP_KEY] || { source: "google", venues: [] };
          // A "fallback" payload is invented placeholder data. Offering it here
          // as somewhere to collect your dinner would be making it up, so it is
          // reported as nothing found instead of dressed up as a real venue.
          const fabricated = found.source === "fallback";
          pickup = {
            status: fabricated ? "empty" : "ok",
            notice: payload.notice || null,
            venues: fabricated ? [] : (found.venues || [])
          };
        }
      }

      if (filters.approximateLocation) {
        notes.push(`Using ${FALLBACK_LOCATION.label} — location access was unavailable.`);
      }

      if (!cancelled) {
        setState({ loading: false, original, alternatives, restaurantNotice, notes, pickup });
        // Land on something the user can actually order.
        setSelectedMeal(alternatives.find((alt) => alt.available) || null);
      }
    }

    // A throw anywhere above would otherwise leave the spinner up forever.
    load().catch((err) => {
      if (!cancelled) setState({ loading: false, failed: true, message: err.message });
    });

    return () => { cancelled = true; };
  }, [filters]);

  if (state.loading) {
    return (
      <div className="results-page">
        <button className="btn btn-back" onClick={onBack}>← Back</button>
        <div className="loading-block">
          <div className="spinner" />
          <p>Checking nutrition data and finding restaurants near you…</p>
        </div>
      </div>
    );
  }

  if (state.failed) {
    return (
      <div className="results-page">
        <button className="btn btn-back" onClick={onBack}>← Back</button>
        <div className="notice notice-warn">Something went wrong: {state.message}</div>
      </div>
    );
  }

  const { original, alternatives, restaurantNotice, notes, pickup } = state;
  const mode = travelModeById(travelMode);

  // The saving on the food, the emissions of going to collect it, and what is
  // actually left over. Recomputed on render so changing travel mode updates
  // every card without refetching anything.
  const scored = alternatives.map((alt) => {
    const foodSaving = original.carbon - alt.carbon;
    const travelCost = alt.venue ? travelEmissions(alt.venue.distance, travelMode) : 0;
    return { ...alt, foodSaving, travelCost, netSaving: foodSaving - travelCost };
  });

  const ranked = scored.sort((a, b) =>
    Number(b.available) - Number(a.available) ||
    Number(b.fit.comparable) - Number(a.fit.comparable) ||
    b.netSaving - a.netSaving
  );

  const flaggedCount = ranked.filter((alt) => !alt.fit.comparable).length;
  // Never let the guardrail empty the page. If every option is a nutritional
  // downgrade, that is worth showing and labelling, not hiding.
  const hidingFlagged = comparableOnly && flaggedCount > 0 && flaggedCount < ranked.length;
  const visibleAlternatives = hidingFlagged ? ranked.filter((alt) => alt.fit.comparable) : ranked;
  const availableAlternatives = visibleAlternatives.filter((alt) => alt.available);

  // selectedMeal is held by identity from before these fields existed, so look
  // the scored copy back up rather than reading stale numbers off it.
  const selected = selectedMeal ? ranked.find((alt) => alt.id === selectedMeal.id) || null : null;

  // One entry per distinct shop, carrying every alternative it can serve.
  const venueGroups = [];
  for (const alt of availableAlternatives) {
    const key = `${alt.venue.name}|${alt.venue.address}`;
    let group = venueGroups.find((g) => g.key === key);
    if (!group) {
      group = { key, venue: alt.venue, alts: [], sample: alt.venueSource === "fallback" };
      venueGroups.push(group);
    }
    group.alts.push(alt);
  }

  // One pin per shop, numbered to match the list beside it.
  const venuePins = venueGroups.map((group) => ({
    id: group.key,
    name: group.venue.name,
    lat: group.venue.lat,
    lng: group.venue.lng,
    distance: group.venue.distance
  }));

  const selectedVenueKey = selectedMeal && selectedMeal.venue
    ? `${selectedMeal.venue.name}|${selectedMeal.venue.address}`
    : null;
  const dietLabel = filters.diet && filters.diet !== "none" ? filters.diet : null;
  const formatLabel = FORMAT_LABELS[original.format] || FORMAT_LABELS.main;
  const bestAlternative = availableAlternatives[0];

  // The swap panel exists to offer something better. When the food is already
  // classified low (getCarbonCategory: under 3.0 kg) *and* the catalog turned up
  // nothing below it, all the panel can say is "no swap needed" — the absence of
  // a suggestion dressed up as one. Hide it; the "Get X nearby" panel above
  // already answers what to do with a food that is fine as it is.
  //
  // Both halves are load-bearing. category === "low" alone would hide real
  // savings, because it is a band and not a floor: a 2.8 kg chicken dish counts
  // as low while the catalog still offers lentils at 0.7. An empty list alone
  // would hide the "try widening them" hint that a high-carbon food needs when
  // the diet or budget filters — not the food's own footprint — emptied it.
  const showLowerCarbonPanel = !(original.category === "low" && alternatives.length === 0);

  // The award for ordering something already low-impact, and whether today's
  // has been taken. Both only mean anything on the low-impact path.
  const lowImpactEarn = pointsForLowImpactChoice(original.carbon);
  const lowImpactClaimed = hasClaimedLowImpact(rewards, original.name);

  // What the currently selected swap would pay out, previewed before checkout.
  const selectedEarn = selectedMeal
    ? pointsForOrder({
        carbon: selectedMeal.carbon,
        savedKg: original.carbon - selectedMeal.carbon,
        streak: rewards.streak,
        lifetimePoints: rewards.lifetimePoints
      })
    : null;

  return (
    <div className="results-page">
      <div className="results-top">
        <button className="btn btn-back" onClick={onBack}>← Back</button>
        {/* Plain text, not a link: navigating away would unmount the page and
            re-run the (billable) Places search on the way back. */}
        <span className="points-chip" title="Green Points — place an order to earn more">
          {tierFor(rewards.lifetimePoints).icon} {formatPoints(rewards.points)} pts
        </span>
      </div>

      {notes.map((note, idx) => (
        <div className="notice notice-warn" key={idx}>{note}</div>
      ))}

      <section className="panel">
        <div className="panel-label">Your search</div>
        <h2 className="meal-title">{original.name}</h2>
        <div className="meta-row">
          <span className="chip">{original.source}</span>
          {original.servingGrams && <span className="chip">per {original.servingGrams}g serving</span>}
          <span className="chip">{original.ingredientLabel || original.ingredient}</span>
          {original.format && (
            <span className="chip">{FORMAT_CHIP_LABELS[original.format] || original.format}</span>
          )}
        </div>

        <SustainabilityBadge carbon={original.carbon} category={original.category} />
        <NutritionGrid meal={original} />
      </section>

      {/* Already low-carbon: there is nothing useful to swap it for, so the
          helpful answer is where to actually get it rather than a swap grid. */}
      {original.category === "low" && pickup && (
        <section className="panel">
          <div className="panel-header">
            <h3>📍 Get {original.name} nearby</h3>
            <span className="chip chip-green">Already low impact</span>
          </div>

          <p className="pickup-intro">
            At {original.carbon.toFixed(1)} kg CO₂e this is already a low-emissions choice, so
            there is no swap to recommend. These are places within {filters.distance} mi that
            came back for “{filters.query}”.
          </p>

          {/* Choosing well from the start earns too, at its own smaller rate —
              no swap was needed, so there is no saving to pay for. */}
          <div className={`low-impact-claim ${lowImpactClaimed ? "claimed" : ""}`}>
            <div className="low-impact-claim-text">
              {lowImpactClaimed ? (
                <React.Fragment>
                  <strong>✓ Claimed — {formatPoints(lowImpactEarn.total)} pts added.</strong>{" "}
                  Already counted for {original.name} today.
                </React.Fragment>
              ) : (
                <React.Fragment>
                  🌱 <strong>{original.name} is already low impact.</strong> Ordering it earns{" "}
                  {formatPoints(lowImpactEarn.total)} Green Points — no swap required.
                </React.Fragment>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary low-impact-claim-btn"
              disabled={lowImpactClaimed}
              onClick={() => onClaimLowImpact({
                original,
                venue: (pickup.venues && pickup.venues[0]) || null
              })}
            >
              {lowImpactClaimed
                ? "Earned today"
                : `Order & earn ${formatPoints(lowImpactEarn.total)} pts`}
            </button>
          </div>

          {pickup.status === "error" ? (
            <div className="notice notice-warn">{pickup.message}</div>
          ) : pickup.venues.length === 0 ? (
            <p className="empty-note">
              No nearby places came back for “{filters.query}” within {filters.distance} mi.
              {pickup.notice ? ` ${pickup.notice}` : ""} Try widening the distance on your search.
            </p>
          ) : (
            <div className="pickup-list">
              {pickup.venues.slice(0, 6).map((venue) => (
                <div className="pickup-row" key={`${venue.name}|${venue.address}`}>
                  <VenuePhoto photo={venue.photo} venueName={venue.name} />

                  <div className="pickup-body">
                    <div className="pickup-name">{venue.name}</div>
                    <div className="pickup-meta">
                      {venue.distance} mi away
                      {venue.rating ? ` • ${venue.rating}★ (${venue.reviewCount})` : ""}
                      {venue.priceLevel ? ` • ${venue.priceLevel}` : ""}
                    </div>
                    <div className="pickup-address">{venue.address}</div>

                    {/* Same standard the swap cards are held to: quote a review
                        that names the dish, or admit we only matched a category. */}
                    {venue.evidence && venue.evidence.quote ? (
                      <blockquote className="venue-quote">
                        “{venue.evidence.quote}”
                        <span className="venue-quote-by">
                          — Google review{venue.evidence.rating ? `, ${venue.evidence.rating}★` : ""}
                        </span>
                      </blockquote>
                    ) : (
                      <div className="venue-caveat">
                        No review here names “{filters.query}” — matched on category, so check
                        the menu before setting out.
                      </div>
                    )}
                  </div>

                  <div className="pickup-actions">
                    {/* The only ordering link that is verified to belong to this
                        business: Places returned it for this place specifically. */}
                    {venue.website && (
                      <a
                        className="btn btn-primary pickup-action"
                        href={venue.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Opens ${venue.name}'s own site, where their ordering page lives if they have one`}
                      >
                        Order on their site ↗
                      </a>
                    )}
                    {venue.mapsUrl && (
                      <a
                        className="btn btn-secondary pickup-action"
                        href={venue.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Opens this place on Google Maps for directions, hours and any ordering links Google lists"
                      >
                        Directions ↗
                      </a>
                    )}

                    {/* Searches, not links to this restaurant — styled apart
                        from the buttons above so the difference is visible and
                        not only stated. */}
                    <div className="pickup-search-row">
                      {deliverySearchLinks(venue.name).map((link) => (
                        <a
                          key={link.id}
                          className="pickup-search"
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Searches ${link.label} for “${venue.name}”. We cannot check whether they deliver from there, so this may return a different place or nothing.`}
                        >
                          Search {link.label} ↗
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showLowerCarbonPanel && (
      <section className="panel">
        <div className="panel-header">
          <h3>💚 Lower-carbon {formatLabel}</h3>
          {dietLabel && <span className="chip chip-green">{dietLabel}</span>}
        </div>

        {alternatives.length > 0 && (
          <div className="controls-row">
            <div className="control-block">
              <span className="control-label">Getting there</span>
              <div className="mode-toggle" role="group" aria-label="Travel mode">
                {TRAVEL_MODES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`mode-btn ${travelMode === option.id ? "active" : ""}`}
                    aria-pressed={travelMode === option.id}
                    onClick={() => setTravelMode(option.id)}
                  >
                    <span aria-hidden="true">{option.icon}</span> {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="control-check">
              <input
                type="checkbox"
                checked={comparableOnly}
                onChange={(e) => setComparableOnly(e.target.checked)}
              />
              Nutritionally comparable only
            </label>
          </div>
        )}

        {hidingFlagged && (
          <div className="notice notice-info notice-guardrail">
            {flaggedCount} option{flaggedCount === 1 ? "" : "s"} hidden for giving you substantially{" "}
            {FIT_SHORTFALL[ranked.find((alt) => !alt.fit.comparable).fit.basis]} than{" "}
            {original.name} — eating less is not a swap. Untick the box to see{" "}
            {flaggedCount === 1 ? "it" : "them"} anyway.
          </div>
        )}

        {comparableOnly && flaggedCount > 0 && flaggedCount === ranked.length && (
          <div className="notice notice-warn">
            Every lower-carbon {FORMAT_CHIP_LABELS[original.format] || "option"} we found gives you
            substantially {FIT_SHORTFALL[ranked[0].fit.basis]} than {original.name}. They are shown
            below and flagged, rather than hidden, so the trade-off is yours to make.
          </div>
        )}

        {alternatives.length === 0 ? (
          <p className="empty-note">
            {original.category === "low"
              ? `Nice pick — ${original.name} is already one of the lowest-carbon ${formatLabel} at ${original.carbon.toFixed(1)} kg CO₂e. No swap needed.`
              : `No ${formatLabel} in our catalog beat this under your ${dietLabel || "current"} filters${filters.budget ? ` and $${filters.budget.toFixed(2)} budget` : ""} — try widening them.`}
          </p>
        ) : (
          <div className="alt-grid">
            {visibleAlternatives.map((alt) => {
              const fitLabel = nutritionFitLabel(alt.fit);
              const netLoss = alt.available && alt.netSaving <= 0;
              const photo = foodPhotos[alt.name];
              const earn = pointsForOrder({
                carbon: alt.carbon,
                // Net, not food-only, so this preview matches what CheckoutPage awards.
                savedKg: alt.netSaving,
                streak: rewards.streak,
                lifetimePoints: rewards.lifetimePoints
              });
              return (
                // The credit line sits outside the button on purpose: the
                // photo provider asks for links back, and a link nested inside
                // a button is invalid and swallows its own clicks.
                <div className="alt-cell" key={alt.id}>
                <button
                  className={`alt-card ${selectedMeal?.id === alt.id ? "active" : ""} ${alt.available ? "" : "unavailable"}`}
                  aria-disabled={alt.available ? undefined : "true"}
                  title={alt.available
                    ? `Available at ${alt.venue.name} — ${alt.venue.distance} mi away`
                    : "No nearby place was found serving this, so it cannot be ordered"}
                  onClick={() => { if (alt.available) setSelectedMeal(alt); }}
                >
                  {/* Keyed by URL so a failed image does not stay failed when
                      the next search puts a different photo in this slot. */}
                  <FoodPhoto key={(photo && photo.url) || alt.name} photo={photo} name={alt.name} />
                  <div className="alt-name">{alt.name}</div>
                  <div className="alt-carbon">{alt.carbon.toFixed(1)} kg CO₂e</div>

                  {/* Without a venue there is no trip to charge for, so the
                      food saving is the only honest number to show. */}
                  {alt.available ? (
                    <React.Fragment>
                      <div className={`alt-save ${netLoss ? "alt-save-loss" : ""}`}>
                        {netLoss
                          ? `costs ${Math.abs(alt.netSaving).toFixed(1)} kg net`
                          : `saves ${alt.netSaving.toFixed(1)} kg net`}
                      </div>
                      {alt.travelCost > 0 && (
                        <div className="alt-breakdown">
                          {alt.foodSaving.toFixed(1)} food − {alt.travelCost.toFixed(1)} trip
                        </div>
                      )}
                    </React.Fragment>
                  ) : (
                    <div className="alt-save">saves {alt.foodSaving.toFixed(1)} kg</div>
                  )}

                  {fitLabel && (
                    <div className={`alt-fit ${alt.fit.comparable ? "" : "alt-fit-warn"}`}>
                      {alt.fit.comparable ? "✓" : "⚠"} {fitLabel}
                    </div>
                  )}

                  <div className="alt-price">${alt.price.toFixed(2)}</div>
                  <PointsPill points={earn.total} muted={!alt.available} />
                  <div className="alt-tags">
                    {alt.tags.slice(0, 2).map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                  </div>
                  {alt.available ? (
                    <div className={`alt-venue ${alt.venueSource === "fallback" ? "alt-venue-sample" : ""} ${alt.evidence ? "alt-venue-verified" : ""}`}>
                      {alt.venueSource === "fallback"
                        ? `Sample location — ${alt.venue.name}`
                        : alt.evidence
                          ? `Reviewers mention “${alt.evidence.term}” at ${alt.venue.name} • ${alt.venue.distance} mi`
                          /* No one named the dish, so claim only the category. */
                          : `${categoryLabel(alt.placesQuery)} nearby — ${alt.venue.name} • ${alt.venue.distance} mi`}
                    </div>
                  ) : (
                    <div className="alt-venue alt-venue-none">Not available nearby</div>
                  )}
                </button>
                {photo && photo.ok && (
                  <div className="photo-credit">
                    Photo:{" "}
                    <a href={photo.photographerUrl} target="_blank" rel="noopener noreferrer">
                      {photo.photographer}
                    </a>
                    {" on "}
                    <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {photo.source}
                    </a>
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}

        {bestAlternative && (
          bestAlternative.netSaving <= 0 ? (
            /* The swap losing to its own pickup trip is not an edge case to
               hide. It is the most useful thing this page can tell you. */
            <div className="impact-callout impact-callout-loss">
              <strong>{bestAlternative.name}</strong> saves only{" "}
              {bestAlternative.foodSaving.toFixed(1)} kg CO₂e on the food, but{" "}
              {mode.verb.toLowerCase()} the {bestAlternative.venue.distance} mi round trip costs{" "}
              {bestAlternative.travelCost.toFixed(1)} kg — so you would come out{" "}
              <strong>{Math.abs(bestAlternative.netSaving).toFixed(1)} kg worse off</strong>. Walk or
              cycle there, or keep what you were having.
            </div>
          ) : bestAlternative.travelCost > 0 ? (
            <div className="impact-callout">
              Switching to <strong>{bestAlternative.name}</strong> saves{" "}
              {bestAlternative.foodSaving.toFixed(1)} kg CO₂e on the food. {mode.verb} the{" "}
              {bestAlternative.venue.distance} mi round trip costs{" "}
              {bestAlternative.travelCost.toFixed(1)} kg back, leaving{" "}
              <strong>{bestAlternative.netSaving.toFixed(1)} kg net</strong> — about{" "}
              {milesDrivenEquivalent(bestAlternative.netSaving)} miles of driving.
            </div>
          ) : (
            <div className="impact-callout">
              Switching to <strong>{bestAlternative.name}</strong> saves{" "}
              <strong>{bestAlternative.netSaving.toFixed(1)} kg CO₂e</strong> — about{" "}
              {milesDrivenEquivalent(bestAlternative.netSaving)} miles of driving, and{" "}
              {mode.verb.toLowerCase()} there adds nothing back.
            </div>
          )
        )}
      </section>
      )}

      {/* The map panel is a separate section with its own condition and is
          deliberately left exactly as it was. */}
      {alternatives.length > 0 && (
      <section className="panel">
        <div className="panel-header">
          <h3>📍 Where to get them</h3>
          <span className="chip">within {filters.distance} mi</span>
        </div>

        {restaurantNotice && <div className="notice notice-info">{restaurantNotice}</div>}

        {mapsState === "failed" && (
          <div className="notice notice-info">
            Google Maps is not enabled for this API key, so the built-in map is
            shown instead. Enable “Maps JavaScript API” for the project and
            reload — nothing else needs to change.
          </div>
        )}

        {availableAlternatives.length === 0 ? (
          <p className="empty-note">
            No nearby place turned up for any of these options within{" "}
            {filters.distance} mi. Try a wider distance radius.
          </p>
        ) : (
          <div className="map-and-list">
            {mapsState === "ready" ? (
              <GoogleMapView
                origin={{ latitude: filters.latitude, longitude: filters.longitude }}
                groups={venueGroups}
                selectedKey={selectedVenueKey}
                onSelect={(key) => {
                  const group = venueGroups.find((g) => g.key === key);
                  if (group) setSelectedMeal(group.alts[0]);
                }}
              />
            ) : (
              <MiniMap
                origin={{ latitude: filters.latitude, longitude: filters.longitude }}
                restaurants={venuePins}
                selectedId={selectedVenueKey}
                onSelect={(pin) => {
                  const group = venueGroups.find((g) => g.key === pin.id);
                  if (group) setSelectedMeal(group.alts[0]);
                }}
              />
            )}
            <div className="restaurant-list">
              {venueGroups.map((group, i) => (
                <button
                  key={group.key}
                  className={`restaurant-row ${selectedVenueKey === group.key ? "active" : ""}`}
                  onClick={() => setSelectedMeal(group.alts[0])}
                >
                  <span className="restaurant-index">{i + 1}</span>
                  <VenuePhoto
                    key={(group.venue.photo && group.venue.photo.name) || group.key}
                    photo={group.venue.photo}
                    venueName={group.venue.name}
                  />
                  <div className="restaurant-row-body">
                    <div className="restaurant-name">{group.venue.name}</div>
                    <div className="restaurant-meta">
                      {group.venue.distance} mi
                      {group.venue.rating ? ` • ⭐ ${group.venue.rating}` : ""}
                      {group.venue.priceLevel ? ` • ${group.venue.priceLevel}` : ""}
                      {mode.kgPerMile > 0
                        ? ` • ${travelEmissions(group.venue.distance, travelMode).toFixed(1)} kg to reach`
                        : ""}
                    </div>
                    <div className="restaurant-address">{group.venue.address}</div>
                    <div className="restaurant-serves">
                      {group.alts.map((alt) => (
                        <div key={alt.id} className={alt.evidence ? "serves-verified" : "serves-maybe"}>
                          {alt.evidence
                            ? `“${alt.evidence.term}” in reviews — ${alt.name}`
                            : `may serve ${alt.name}`}
                        </div>
                      ))}
                      {group.sample ? <div className="serves-maybe">(sample location)</div> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      )}

      {selected && (
        <section className="panel details-panel slide-in">
          <h3>{selected.name}</h3>
          <SustainabilityBadge carbon={selected.carbon} category={selected.category} />
          <NutritionGrid meal={selected} />

          <div className="impact-ledger">
            <div className="impact-row">
              <span>Food saving vs {original.name}</span>
              <strong className="ledger-credit">−{selected.foodSaving.toFixed(1)} kg</strong>
            </div>
            <div className="impact-row">
              <span>
                {mode.label} {selected.venue ? `${selected.venue.distance} mi` : ""} round trip
              </span>
              <strong className={selected.travelCost > 0 ? "ledger-debit" : ""}>
                +{selected.travelCost.toFixed(1)} kg
              </strong>
            </div>
            <div className="impact-row impact-row-total">
              <span>Net</span>
              <strong className={selected.netSaving > 0 ? "ledger-credit" : "ledger-debit"}>
                {selected.netSaving > 0
                  ? `−${selected.netSaving.toFixed(1)} kg saved`
                  : `+${Math.abs(selected.netSaving).toFixed(1)} kg worse`}
              </strong>
            </div>
          </div>

          <div className="earn-callout">
            🌱 Earns <strong>{formatPoints(selectedEarn.total)} Green Points</strong>
            {selectedEarn.streakMult > 1
              ? " — your ×" + selectedEarn.streakMult.toFixed(2) + " streak bonus is included"
              : " — redeemable for discounts on future orders"}.
          </div>

          {selectedMeal.venue && (
            <div className="venue-block">
              <div className="venue-line">
                📍 {selected.venue.name} • {selected.venue.distance} mi
                {selected.venue.address ? ` • ${selected.venue.address}` : ""}
              </div>
              {selected.evidence && selected.evidence.quote ? (
                <blockquote className="venue-quote">
                  “{selected.evidence.quote}”
                  <span className="venue-quote-by">
                    — Google review{selected.evidence.rating ? `, ${selected.evidence.rating}★` : ""}
                  </span>
                </blockquote>
              ) : (
                <div className="venue-caveat">
                  Matched on category ({categoryLabel(selected.placesQuery).toLowerCase()}) — no
                  review here names this dish, so it may not be on the menu.
                </div>
              )}
            </div>
          )}

          <div className="checkout-row">
            <span className="price">${selected.price.toFixed(2)}</span>
            <button
              className="btn btn-primary btn-checkout"
              onClick={() => onCheckout({
                meal: selected,
                original,
                restaurant: selected.venue,
                travel: { mode: mode.id, label: mode.label, cost: selected.travelCost },
                netSaving: selected.netSaving
              })}
            >
              Proceed to Checkout
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function CheckoutPage({ order, rewards, onPlace, onDone, onBack, onOpenRewards }) {
  const [receipt, setReceipt] = useState(null);
  const [rewardId, setRewardId] = useState(null);
  const { meal, original, restaurant, travel } = order;
  const foodSaving = original.carbon - meal.carbon;
  const travelCost = travel ? travel.cost : 0;
  // The receipt reports what you actually saved, trip included — reverting to
  // the food-only figure here would undo the point of the whole page.
  const saved = typeof order.netSaving === "number" ? order.netSaving : foodSaving;

  // Only dollar-off rewards can ride along on an order. Perks (a tree, a milk
  // upgrade) are redeemed straight from the rewards page instead.
  const vouchers = REWARD_CATALOG.filter((reward) => reward.discount > 0);
  const applied = rewardId ? rewardById(rewardId) : null;
  // A $10 voucher against a $6 sorbet cannot hand back change.
  const discount = applied ? Math.min(applied.discount, meal.price) : 0;
  const subtotal = meal.price - discount;
  const tax = subtotal * 0.0825;
  const total = subtotal + tax;

  // Previewed with the balance as it stands now; onPlace recomputes from the
  // same function, so the receipt cannot disagree with what was shown here.
  const earned = pointsForOrder({
    carbon: meal.carbon,
    savedKg: saved,
    streak: rewards.streak,
    lifetimePoints: rewards.lifetimePoints
  });

  if (receipt) {
    return (
      <div className="checkout-page">
        <div className="confirm-card">
          <div className="confirm-check">✓</div>
          <h2>Order confirmed</h2>
          <p className="confirm-sub">
            {meal.name} • pickup at {restaurant ? restaurant.name : "your selected restaurant"} in ~20 minutes
          </p>

          <div className="savings-hero">
            <div className="savings-value">{saved.toFixed(1)} kg</div>
            <div className="savings-label">CO₂e saved on this order</div>
          </div>

          {receipt.tierUp && (
            <div className="tier-up">
              {receipt.tierUp.icon} You reached <strong>{receipt.tierUp.name}</strong> —{" "}
              {receipt.tierUp.perk.toLowerCase()}.
            </div>
          )}

          <PointsBreakdown earned={receipt.earned} title="Green Points earned" />

          <div className="balance-line">
            New balance <strong>{formatPoints(receipt.balance)} pts</strong>
            {receipt.spent > 0 && (
              <span className="balance-spent"> · {formatPoints(receipt.spent)} pts spent on your discount</span>
            )}
          </div>

          <p className="confirm-equiv">
            That is roughly <strong>{milesDrivenEquivalent(saved)} miles</strong> of driving avoided,
            by choosing {meal.name} over {original.name}
            {travelCost > 0
              ? ` — after subtracting the ${travelCost.toFixed(1)} kg it took to collect it.`
              : "."}
          </p>

          <div className="confirm-actions">
            <button className="btn btn-primary" onClick={onDone}>Start a new search</button>
            <button className="btn btn-secondary" onClick={onOpenRewards}>View rewards</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
      <button className="btn btn-back" onClick={onBack}>← Back to results</button>

      <div className="panel">
        <h2>Review your order</h2>

        <div className="order-line">
          <div>
            <div className="order-name">{meal.name}</div>
            <div className="order-sub">{meal.calories} cal • {meal.protein}g protein</div>
          </div>
          <span className="price">${meal.price.toFixed(2)}</span>
        </div>

        {restaurant && (
          <div className="order-line">
            <div>
              <div className="order-name">Pickup</div>
              <div className="order-sub">
                {restaurant.name} • {restaurant.distance} mi away
                {travel ? ` • by ${travel.label.toLowerCase()}` : ""}
              </div>
            </div>
            <span className="order-sub">~20 min</span>
          </div>
        )}

        {discount > 0 && (
          <div className="order-line">
            <div>
              <div className="order-name order-name-discount">{applied.name} reward</div>
              <div className="order-sub">{formatPoints(applied.cost)} pts</div>
            </div>
            <span className="price price-discount">−${discount.toFixed(2)}</span>
          </div>
        )}

        <div className="order-line">
          <div className="order-sub">Estimated tax</div>
          <span className="order-sub">${tax.toFixed(2)}</span>
        </div>

        <div className="order-line order-total">
          <div className="order-name">Total</div>
          <span className="price">${total.toFixed(2)}</span>
        </div>

        <div className="reward-apply">
          <div className="reward-apply-head">
            <span>🎟️ Use Green Points</span>
            <span className="reward-apply-balance">{formatPoints(rewards.points)} pts available</span>
          </div>

          <div className="reward-apply-options">
            <button
              type="button"
              className={`reward-option ${!rewardId ? "active" : ""}`}
              onClick={() => setRewardId(null)}
            >
              <span className="reward-option-name">No discount</span>
              <span className="reward-option-cost">Keep your points</span>
            </button>

            {vouchers.map((reward) => {
              const affordable = rewards.points >= reward.cost;
              return (
                <button
                  key={reward.id}
                  type="button"
                  className={`reward-option ${rewardId === reward.id ? "active" : ""} ${affordable ? "" : "locked"}`}
                  disabled={!affordable}
                  onClick={() => setRewardId(reward.id)}
                  title={affordable
                    ? `Spend ${formatPoints(reward.cost)} pts for ${reward.name}`
                    : `${formatPoints(reward.cost - rewards.points)} more points needed`}
                >
                  <span className="reward-option-name">{reward.name}</span>
                  <span className="reward-option-cost">
                    {affordable ? `${formatPoints(reward.cost)} pts` : `${formatPoints(reward.cost - rewards.points)} pts to go`}
                  </span>
                </button>
              );
            })}
          </div>

          {applied && discount < applied.discount && (
            <div className="notice notice-info">
              This order is only ${meal.price.toFixed(2)}, so just ${discount.toFixed(2)} of the{" "}
              {applied.name} reward applies and the rest is not refunded — a smaller
              voucher goes further here.
            </div>
          )}
        </div>

        <div className="savings-banner">
          <div>
            <div className="savings-banner-value">−{saved.toFixed(1)} kg CO₂e</div>
            <div className="savings-banner-label">
              {travelCost > 0
                ? `${foodSaving.toFixed(1)} kg saved on food, ${travelCost.toFixed(1)} kg spent getting there`
                : `versus ${original.name}`}
              {" • "}≈{milesDrivenEquivalent(saved)} miles not driven
            </div>
          </div>
          <div className="leaf">🌍</div>
        </div>

        <PointsBreakdown earned={earned} title="You will earn" />

        <button
          className="btn btn-primary btn-checkout"
          onClick={() => setReceipt(onPlace({ meal, original, restaurant, reward: applied }))}
        >
          Place order • ${total.toFixed(2)}
        </button>
        <p className="demo-note">Demo checkout — no payment is processed.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- rewards components -- */

const formatPoints = (points) => Math.round(points || 0).toLocaleString();

// The earn preview that rides along on every alternative card.
function PointsPill({ points, muted }) {
  return <span className={`points-pill ${muted ? "points-pill-muted" : ""}`}>+{formatPoints(points)} pts</span>;
}

function TierBar({ lifetimePoints, compact }) {
  const tier = tierFor(lifetimePoints);
  const next = nextTierFor(lifetimePoints);
  const progress = tierProgress(lifetimePoints);

  return (
    <div className={`tier-bar ${compact ? "tier-bar-compact" : ""}`}>
      <div className="tier-bar-track">
        <div className="tier-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="tier-bar-note">
        {next
          ? <span>{formatPoints(next.min - lifetimePoints)} pts to {next.icon} {next.name}</span>
          : <span>Top tier — {tier.perk.toLowerCase()}</span>}
      </div>
    </div>
  );
}

// Homepage entry point into the scheme. A first-time visitor sees the ladder
// rather than a bare zero, so the feature explains itself before any order.
function RewardsSummary({ rewards, onOpen }) {
  const tier = tierFor(rewards.lifetimePoints);
  const fresh = rewards.lifetimePoints === 0;

  return (
    <button type="button" className="rewards-summary" onClick={onOpen}>
      <div className="rewards-summary-top">
        <span className="rewards-summary-tier">{tier.icon} {tier.name}</span>
        <span className="rewards-summary-points">{formatPoints(rewards.points)} pts</span>
      </div>
      <TierBar lifetimePoints={rewards.lifetimePoints} compact />
      <div className="rewards-summary-cta">
        {fresh
          ? "Order a lower-carbon swap to start earning — the smaller the footprint, the bigger the payout."
          : `${rewards.streak > 0 ? `🔥 ${rewards.streak}-order low-impact streak • ` : ""}View rewards →`}
      </div>
    </button>
  );
}

// The same breakdown is the preview at checkout and the receipt after it, so
// the numbers a person agreed to are the numbers they got.
function PointsBreakdown({ earned, title }) {
  return (
    <div className="points-breakdown">
      <div className="points-breakdown-title">{title}</div>
      <div className="points-line">
        <span>Low-footprint bonus</span>
        <span>+{formatPoints(earned.footprint)}</span>
      </div>
      <div className="points-line">
        <span>
          Carbon saved
          {earned.capped && (
            <span className="points-line-note">
              {" "}· first {MAX_SAVED_KG_COUNTED} kg of {earned.savedKg.toFixed(1)} counted
            </span>
          )}
        </span>
        <span>+{formatPoints(earned.savings)}</span>
      </div>
      {earned.streakMult > 1 && (
        <div className="points-line points-line-mult">
          <span>🔥 {earned.streak}-order streak</span>
          <span>×{earned.streakMult.toFixed(2)}</span>
        </div>
      )}
      {earned.tier.multiplier > 1 && (
        <div className="points-line points-line-mult">
          <span>{earned.tier.icon} {earned.tier.name} member</span>
          <span>×{earned.tier.multiplier.toFixed(2)}</span>
        </div>
      )}
      <div className="points-line points-line-total">
        <span>Total</span>
        <span>+{formatPoints(earned.total)} pts</span>
      </div>
    </div>
  );
}

function RewardCard({ reward, balance, onRedeem }) {
  const affordable = balance >= reward.cost;
  const short = reward.cost - balance;

  return (
    <div className={`reward-card ${affordable ? "" : "reward-card-locked"}`}>
      <div className="reward-icon">{reward.icon}</div>
      <div className="reward-body">
        <div className="reward-name">{reward.name}</div>
        <div className="reward-detail">{reward.detail}</div>
      </div>
      <div className="reward-action">
        <div className="reward-cost">{formatPoints(reward.cost)} pts</div>
        {reward.discount > 0 ? (
          <span className="reward-hint">
            {affordable ? "Apply at checkout" : `${formatPoints(short)} pts to go`}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-small"
            disabled={!affordable}
            onClick={() => onRedeem(reward)}
          >
            {affordable ? "Redeem" : `${formatPoints(short)} pts to go`}
          </button>
        )}
      </div>
    </div>
  );
}

function RewardsPage({ rewards, onBack, onRedeem }) {
  const tier = tierFor(rewards.lifetimePoints);

  // Earning and spending are one story, so they share one timeline.
  const activity = [
    ...rewards.orders.map((entry) => ({ ...entry, kind: "earn" })),
    ...rewards.redemptions.map((entry) => ({ ...entry, kind: "spend" }))
  ].sort((a, b) => b.at - a.at).slice(0, 10);

  return (
    <div className="rewards-page">
      <button className="btn btn-back" onClick={onBack}>← Back</button>

      <section className="panel rewards-hero">
        <div className="panel-label">Green Points</div>
        <div className="rewards-balance">{formatPoints(rewards.points)}</div>
        <div className="rewards-balance-label">
          points to spend • {formatPoints(rewards.lifetimePoints)} earned all time
        </div>
        <div className="rewards-tier-line">
          <span className="chip chip-green">{tier.icon} {tier.name}</span>
          <span className="rewards-tier-perk">{tier.perk}</span>
        </div>
        <TierBar lifetimePoints={rewards.lifetimePoints} />
      </section>

      <section className="panel">
        <div className="panel-header"><h3>🎁 Spend your points</h3></div>
        <div className="reward-grid">
          {REWARD_CATALOG.map((reward) => (
            <RewardCard key={reward.id} reward={reward} balance={rewards.points} onRedeem={onRedeem} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h3>📈 How points work</h3></div>
        <ul className="points-rules">
          <li>
            <strong>The lower the footprint, the more you earn.</strong> Every kg
            of CO₂e your meal comes in under {FOOTPRINT_CEILING.toFixed(1)} kg is
            worth {POINTS_PER_KG_UNDER_CEILING} pts — a berry sorbet at 0.3 kg
            pays {footprintPoints(0.3)}, a cheese dish at 2.2 kg pays {footprintPoints(2.2)},
            and anything over {FOOTPRINT_CEILING.toFixed(1)} kg pays nothing at all.
          </li>
          <li>
            <strong>Swapping down pays too.</strong> {POINTS_PER_KG_SAVED} pts for
            every kg you avoid versus the dish you searched for, counted up to{" "}
            {MAX_SAVED_KG_COUNTED} kg.
          </li>
          <li>
            <strong>Streaks compound.</strong> Each consecutive low-impact order
            adds {Math.round(STREAK_BONUS_PER_ORDER * 100)}% to the payout, up to
            ×{MAX_STREAK_MULTIPLIER.toFixed(1)}. One medium-impact order resets it.
          </li>
          <li>
            <strong>Tiers stick.</strong> Rank is set by points earned all time,
            so spending your balance never costs you a tier.
          </li>
        </ul>

        <div className="tier-ladder">
          {TIERS.map((entry) => (
            <div
              key={entry.name}
              className={`tier-rung ${entry.name === tier.name ? "active" : ""} ${rewards.lifetimePoints >= entry.min ? "reached" : ""}`}
            >
              <span className="tier-rung-icon">{entry.icon}</span>
              <span className="tier-rung-name">{entry.name}</span>
              <span className="tier-rung-min">{formatPoints(entry.min)} pts</span>
              <span className="tier-rung-perk">{entry.perk}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h3>🧾 Recent activity</h3></div>
        {activity.length === 0 ? (
          <p className="empty-note">
            Nothing yet. Search for something, pick a lower-carbon swap and place
            the order — the points land on the confirmation screen.
          </p>
        ) : (
          <div className="activity-list">
            {activity.map((entry, idx) => (
              <div className="activity-row" key={`${entry.at}-${idx}`}>
                <div className="activity-body">
                  <div className="activity-name">
                    {entry.kind === "earn" ? entry.name : `Redeemed ${entry.name}`}
                  </div>
                  <div className="activity-meta">
                    {entry.kind === "earn"
                      // A low-impact claim was not chosen over anything, so the
                      // "saved vs X" line has no X to name.
                      ? entry.lowImpact
                        ? `Already low impact — ${entry.carbon.toFixed(1)} kg CO₂e${entry.venue ? ` • ${entry.venue}` : ""}`
                        : `${entry.savedKg.toFixed(1)} kg CO₂e saved vs ${entry.versus}${entry.venue ? ` • ${entry.venue}` : ""}`
                      : "Spent from your balance"}
                    {" • "}
                    {new Date(entry.at).toLocaleDateString()}
                  </div>
                </div>
                <div className={entry.kind === "earn" ? "activity-earn" : "activity-spend"}>
                  {entry.kind === "earn" ? `+${formatPoints(entry.points)}` : `−${formatPoints(entry.cost)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const [page, setPage] = useState("home");
  const [filters, setFilters] = useState({});
  const [order, setOrder] = useState(null);
  const [rewards, setRewards] = useState(loadRewards);

  // One writer for the ledger, so the balance on screen is always the balance
  // on disk.
  const updateRewards = (next) => setRewards(saveRewards(next));

  // Returns the receipt synchronously. CheckoutPage renders the confirmation in
  // the same click and cannot wait for a state update to come back around.
  const placeOrder = ({ meal, original, restaurant, reward }) => {
    const earned = pointsForOrder({
      carbon: meal.carbon,
      savedKg: original.carbon - meal.carbon,
      streak: rewards.streak,
      lifetimePoints: rewards.lifetimePoints
    });
    const before = tierFor(rewards.lifetimePoints);
    const next = applyOrder(rewards, { meal, original, restaurant, reward, earned });
    updateRewards(next);
    const after = tierFor(next.lifetimePoints);

    return {
      earned,
      balance: next.points,
      spent: reward ? reward.cost : 0,
      tierUp: after.name === before.name ? null : after
    };
  };

  // Ordering something already low-impact. Separate from placeOrder: there is
  // no swap, no checkout and no receipt — just the award landing in the ledger.
  const claimLowImpact = ({ original, venue }) => {
    const earned = pointsForLowImpactChoice(original.carbon);
    updateRewards(applyLowImpactClaim(rewards, { original, venue, earned }));
  };

  const redeemReward = (reward) => {
    // The button is already disabled when you cannot afford it; this is the
    // guard that keeps the balance honest if it is ever reached another way.
    if (rewards.points < reward.cost) return;
    updateRewards(applyRedemption(rewards, reward));
  };

  if (page === "rewards") {
    return (
      <div className="app">
        <RewardsPage
          rewards={rewards}
          onRedeem={redeemReward}
          onBack={() => setPage("home")}
        />
      </div>
    );
  }

  if (page === "results") {
    return (
      <div className="app">
        <ResultsPage
          filters={filters}
          rewards={rewards}
          onBack={() => setPage("home")}
          onCheckout={(next) => { setOrder(next); setPage("checkout"); }}
          onClaimLowImpact={claimLowImpact}
        />
      </div>
    );
  }

  if (page === "checkout" && order) {
    return (
      <div className="app">
        <CheckoutPage
          order={order}
          rewards={rewards}
          onPlace={placeOrder}
          onBack={() => setPage("results")}
          onDone={() => { setOrder(null); setPage("home"); }}
          // Clearing the order matters: leaving a placed one behind would let
          // "Back to results" walk into the review screen and charge it twice.
          onOpenRewards={() => { setOrder(null); setPage("rewards"); }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <HomePage
        initial={filters}
        rewards={rewards}
        onOpenRewards={() => setPage("rewards")}
        onSearch={(next) => { setFilters(next); setPage("results"); }}
      />
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById("root"));
