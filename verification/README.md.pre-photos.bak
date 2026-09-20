# SustainEat

Search a food, see its nutrition and carbon footprint, and get lower-carbon
alternatives that respect your diet and budget — each one tied to a real nearby
place that actually sells it.

## Running it

```bash
cd server
npm install
npm start
```

Then open **http://localhost:5000**

The backend serves the frontend too, so that is the only command you need.

> Do not open `index.html` by double-clicking it. Babel fetches `app.js` over
> XHR, which `file://` blocks, and geolocation requires a secure context — you
> would get a blank page. Always go through `http://localhost:5000`.

## Set-up

> **Cost warning.** Asking for reviews puts these calls on Places' most
> expensive tier (Enterprise + Atmosphere), and there is one call per suggested
> food — roughly 15-18x the Places cost of the original single search. Fine on a
> hackathon key with the free monthly credit; **do not leave this key live on a
> public URL.** To revert: delete `'places.reviews'` from the field mask in
> `server/server.js`. Everything still works, just without dish verification.

### 1. Places API — done ✅

**Places API (New)** is enabled and returning live data: `/api/alternatives-nearby`
answers with `source: "google"` and real venues. If it ever flips back to
`fallback`, re-check
https://console.cloud.google.com/apis/library/places.googleapis.com?project=739001161925
and that billing is still on.

### 2. Enable the Maps JavaScript API  ← the one thing still to do

The results page draws a real Google map: your location, one numbered marker per
venue, and a pop-up on click. The key in `index.html` does **not** have
**Maps JavaScript API** switched on, so `gm_authFailure` fires and the page
falls back to the built-in CSS map with a notice saying so.

1. https://console.cloud.google.com/apis/library/maps-backend.googleapis.com?project=739001161925
2. Click **Enable**.
3. Reload. No code changes — the real map appears on its own.

> The Maps key sits in client-side HTML (unavoidable for the Maps JavaScript
> API) and it is the same key the backend uses for Places on the priciest tier.
> Add an **HTTP referrer restriction** (`localhost:5000/*`, plus wherever you
> demo from) so a scraped key cannot be billed to you:
> https://console.cloud.google.com/apis/credentials?project=739001161925

### 3. USDA key — done ✅

`app.js` uses a personal FoodData Central key (1,000 requests/hour), not the
shared `DEMO_KEY` that caps at ~30/hour per IP. Nothing to do here.

Note that `app.js` is served to the browser, so this key is visible in page
source. That is fine for a demo — a USDA key is free and only gates rate limits
— but do not reuse the pattern for a secret that matters. Those belong in
`server/.env`, like the Google key.

## How it fits together

| File | Role |
| --- | --- |
| `index.html` | Entry point, loads React + Babel from CDN, and the Google Maps JS API |
| `app.js` | Whole frontend: search, results, map, checkout |
| `styles.css` | Cream / soft-green theme, all component styles |
| `server/server.js` | Express: serves the frontend, proxies Google Places. `POST /api/alternatives-nearby` runs one Places search per suggested food in parallel |
| `server/.env` | `GOOGLE_PLACES_API_KEY` and `PORT` (gitignored) |

### Food formats

A swap is only useful if it is the same *kind* of thing, so every search is
classified into a format — `main`, `dessert`, `breakfast`, `soup`, `drink` —
and alternatives are drawn only from that format. Searching "cheesecake"
returns sorbet and cashew cheesecake, not a lentil bowl.

Two ordering rules in `app.js` are load-bearing; read the comments before
reordering `INGREDIENT_RULES` or `FORMAT_OVERRIDES`:

- **Rule order.** `cheese` precedes `pastry` so "cheesecake" is dairy, not
  generic baking. `pastry` precedes `nuts` so "doughnut" is not a nut dish.
  `nuts` precedes `dairy` so "peanut butter" is not butter.
- **Word boundaries.** Terms of four characters or fewer only match on a word
  boundary, because plain substring matching silently mis-fires: "chocolate"
  contains "cola", "steak" contains "tea", "eggplant" contains "egg". Longer
  terms stay substrings so compounds like "cheesecake" still match "cheese".

### Data sources

- **Nutrition** — USDA FoodData Central. Values are per 100g, scaled to a real
  portion using the `foodMeasures` gram weight when available.
- **Carbon** — per-serving kg CO₂e derived from Poore & Nemecek (2018).
- **Driving equivalent** — EPA figure of ~404 g CO₂ per mile.
- **Restaurants** — Google Places API (New), `places:searchText`. One targeted
  search **per suggested food** (a vegan cheesecake looks for a vegan bakery, a
  sorbet looks for a gelato shop), so a suggestion is only offered if somewhere
  nearby actually sells that kind of thing. The search phrase for each catalog
  item is its `placesQuery` field in `app.js` — that is the knob to tune if
  something reports "not available nearby" too often.
- **Dish evidence** — each place's Google reviews are searched for the dish
  itself (`dishTerms` in `app.js`: "cashew cheesecake", "vegan cheesecake",
  "cheesecake"). A hit gets the confident wording, *Reviewers mention
  "cheesecake" at X*; a miss falls back to the category claim only, *Vegan
  bakery nearby — X*. Venues with evidence are ranked above closer ones
  without it, and the matching review is quoted on the detail panel.

### Things that degrade instead of breaking

Each of these shows a visible notice rather than an error screen, so a demo
never dies on stage:

- Location denied or slow → falls back to MIT campus coordinates (8s timeout).
- Maps JavaScript API off, key rejected, script blocked, or no answer in 15s →
  the built-in CSS map, with a notice explaining which API to enable.
- Places API down or disabled → each card falls back to a clearly labelled
  "Sample location", never a real-looking pickup point.
- A search that legitimately finds nothing → that option is labelled
  "Not available nearby", greyed out and cannot be ordered.
- USDA rate-limited or no match → estimated nutrition for that food.
- Backend not running → the results page says exactly how to start it.

## Demo path that shows the most

1. Search **beef burger** with diet **None** — high-impact badge, 8.5 kg CO₂e.
2. Switch diet to **Vegan** and search again — alternatives change to
   plant-based only.
3. Cards where a real review names the dish read *Reviewers mention "veggie
   burger" at Audubon*; the rest fall back to *Indian restaurant nearby — …*.
   Selecting a verified one quotes the review underneath.
4. Every alternative card names the shop you can collect it from, and
   **Where to get them** maps those shops (grouped, so one shop serving two
   options is one pin).
5. Pick an alternative → **Proceed to Checkout** → **Place order**. The pickup
   location on the receipt is the venue from the card you chose.
