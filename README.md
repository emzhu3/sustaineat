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
>
> Venue photos add a second, separate charge: every image the browser loads is
> one **Place Photos** request. `/api/place-photo` sends
> `Cache-Control: public, max-age=86400`, so a reloaded demo re-uses the
> browser's copy instead of paying again. To revert: delete `'places.photos'`
> from both field masks in `server/server.js` — the cards fall back to their
> plain tiles.

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

### 4. Pexels key — done ✅

Each alternative card shows a photo of the dish, searched on Pexels by food
name. The key is in `server/.env` as `PEXELS_API_KEY` and is returning live
photos. Get a replacement free at https://www.pexels.com/api/ if it ever needs
rotating.

The key is optional in the sense that nothing crashes without it: those cards
fall back to a plain placeholder tile and the server says so once at start-up.
A key Pexels *rejects* is called out loudly in the log rather than failing
quietly.

> **Quota.** Pexels answers with its own limits in the response headers — this
> key reports **25,000 requests, resetting monthly** (next reset 2026-10-20),
> with one request per distinct food. Their docs also quote a 200/hour ceiling
> for free keys, which the headers do not surface. Either way there is a lot of
> room: the server caches every answer by food name for its lifetime, so
> repeating a search costs nothing.
>
> Loading the images themselves is free and unmetered: they are hotlinked
> straight from `images.pexels.com`, which needs no key at all.

> **This used to be Unsplash.** Swapped on 2026-09-20 because Unsplash was
> unreachable. Pexels is the simpler dependency of the two — a bare
> `Authorization: <key>` header, no UTM parameters, and no download-ping
> callback to fire. `verification/*.pre-pexels.bak` has the previous version.

## How it fits together

| File | Role |
| --- | --- |
| `index.html` | Entry point, loads React + Babel from CDN, and the Google Maps JS API |
| `app.js` | Whole frontend: search, results, map, checkout |
| `styles.css` | Cream / soft-green theme, all component styles |
| `server/server.js` | Express: serves the frontend, proxies Google Places. `POST /api/alternatives-nearby` runs one Places search per suggested food in parallel; `GET /api/place-photo` proxies venue images; `POST /api/food-photos` looks up dish photos on Pexels |
| `server/.env` | `GOOGLE_PLACES_API_KEY`, `PEXELS_API_KEY`, and `PORT` (gitignored) |

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
- **Venue photos** — Google Places, `places.photos` in the same search that
  already fetches the venue. Places returns a photo *reference*, not an image,
  and the image call needs the API key — so the browser only ever gets the
  reference and asks the backend's `/api/place-photo` for the bytes. The key
  never leaves the server. Google's author attribution is printed under each
  thumbnail, which their terms require.
- **Dish photos** — Pexels `GET /v1/search`, one lookup per alternative,
  batched into a single `POST /api/food-photos` call from the page. The search
  phrase is the food's name plus `PHOTO_QUERY_SUFFIX` in `server/server.js`
  (` food` — it biases hard towards a plated dish rather than a styled product
  shot). That constant is the knob to turn if a card gets a photo that looks
  nothing like the dish, the way `placesQuery` is the knob for venues. Stock
  search is approximate by nature: "Black Bean Burger" can return a generic
  burger. The card is honest about this — it credits the photographer and links
  the source, and never claims the photo is of that restaurant's dish.
  The response the page receives is provider-neutral (`source`, `sourceUrl`),
  so swapping photo provider again is a server-side change only.
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
- No `PEXELS_API_KEY`, a key Pexels rejects, nothing matched, or the quota hit →
  that card shows a plain placeholder tile. A rate-limit blip is never cached,
  so the photo comes back on the next search rather than staying blank until
  restart. A rejected key also prints an ACTION NEEDED line, once.
- A venue has no photo, or the Place Photos call fails → the row shows its text
  only, never a broken image.
- USDA rate-limited or no match → estimated nutrition for that food.
- Backend not running → the results page says exactly how to start it.

## Demo path that shows the most

1. Search **beef burger** with diet **None** — high-impact badge, 8.5 kg CO₂e.
2. Switch diet to **Vegan** and search again — alternatives change to
   plant-based only.
3. Cards where a real review names the dish read *Reviewers mention "veggie
   burger" at Audubon*; the rest fall back to *Indian restaurant nearby — …*.
   Selecting a verified one quotes the review underneath.
4. Every card carries a photo of the dish and every shop row a photo of the
   shop, both credited to their source.
5. Every alternative card names the shop you can collect it from, and
   **Where to get them** maps those shops (grouped, so one shop serving two
   options is one pin).
6. Pick an alternative → **Proceed to Checkout** → **Place order**. The pickup
   location on the receipt is the venue from the card you chose.
