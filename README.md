# SustainEat

Search a food, see its nutrition and carbon footprint, and get lower-carbon
alternatives that respect your diet and budget — each one tied to a real nearby
place that actually sells it.

Two things make the numbers honest rather than flattering: the emissions of
going to collect the food are **subtracted** from the saving, and a swap that
feeds you substantially less than what you searched for is **flagged rather
than recommended**. Both are described under "Honest accounting" below.

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
| `app.js` | Whole frontend: search, results, map, checkout, Green Points |
| `styles.css` | Cream / soft-green theme, all component styles |
| `server/server.js` | Express: serves the frontend, proxies Google Places. `POST /api/alternatives-nearby` runs one Places search per suggested food in parallel; `GET /api/place-photo` proxies venue images; `POST /api/food-photos` looks up dish photos on Pexels |
| `server/places-cache.js` | Disk-backed cache for Places responses, so repeat searches are free and offline-safe |
| `server/.env` | `GOOGLE_PLACES_API_KEY`, `PEXELS_API_KEY`,, `PORT`, and optionally `PLACES_CACHE` / `PLACES_CACHE_TTL_HOURS` (gitignored) |

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

## Honest accounting

### Net carbon, after the trip to collect it

A swap that saves 1.5 kg on the food but needs an 8-mile round trip by car to
collect has not saved anything — the drive costs 3.2 kg. Every card therefore
shows a **net** figure and the arithmetic behind it (`1.5 food − 3.2 trip`),
and the detail panel breaks it into a three-line ledger.

- Car is the EPA's 404 g CO₂/mile; transit ~180 g per passenger-mile; walking
  and cycling count as zero.
- **Round trip**, because you have to get home again.
- Distance is the straight-line haversine the backend already computes, so
  real road distance is higher. The figure understates the trip cost rather
  than inflating the saving.
- The travel-mode toggle re-runs the whole page instantly — no refetch — so
  switching from Drive to Walk on stage visibly changes every number.

When the trip costs more than the swap saves, the card turns red, reads
`costs 2.0 kg net`, and the callout says so in words. That case is not hidden:
it is the most useful thing the page can tell you, and the fix it suggests
(walk, cycle, or pick somewhere closer) is real advice.

### The nutrition guardrail

"Eat less" is the trivially correct answer to any carbon question, so a
carbon-only recommender will happily offer a 5 kcal iced tea in place of a
milkshake and call it a 1.5 kg saving. Every candidate is therefore compared
against what it replaces:

| Format | Judged on | Floor |
| --- | --- | --- |
| main, breakfast, soup | protein | 60% of the original |
| dessert, drink | calories | 40% of the original |

Protein is the point of a meal; nobody drinks a latte for the protein, so
there the floor goes on calories instead. Options that clear the floor are
badged `✓ Comparable protein — 21g vs 31g`; those that fail are badged
`⚠ 42% the protein — 13g vs 31g`, ranked last, and hidden behind the
**Nutritionally comparable only** tick-box, which is on by default.

The catalogue deliberately still *carries* two flagged options so the
guardrail is visible rather than silent — those two are exactly what a
carbon-only ranking would have put first. Searching **beef burger** hides
Mediterranean Veggie Wrap (0.5 kg) and Red Lentil Dal (0.7 kg) in favour of
Black Bean Burger (0.8 kg): a *worse* carbon number, chosen because it is the
only one of the three that still feeds you. Untick the box to see both, with
their warnings. If every option fails the floor, nothing is hidden — they are
shown flagged instead, because an empty page is not an answer.

### Places caching — the demo does not depend on the network

`/api/alternatives-nearby` fires one Places search per suggested food with
`places.reviews` in the field mask, so a single page refresh is ~8 calls on the
priciest SKU. Responses are now cached on `(query, location, radius)`:

- Location is rounded to ~110 m, so geolocation jitter between fixes still
  hits the cache.
- Entries persist to `server/.cache/` (gitignored) and survive a restart, with
  a 6-hour TTL.
- **Only successes are cached.** A failure stays a failure, so a disabled key
  keeps showing the setup help instead of pinning an empty result for 6 hours.
- Dish evidence is recomputed per request rather than stored, so editing
  `dishTerms` takes effect on reload without spending a call to see it.

The server logs `2 from cache, 0 billed` per request, and `/api/health` reports
hit/miss counts. Warm the cache on your demo queries before you present: the
run then costs nothing, returns instantly, and **works even if the venue wifi
dies**.

Two `.env` knobs: `PLACES_CACHE=off` forces every search to hit Google (use
after editing a `placesQuery`), and `PLACES_CACHE_TTL_HOURS` overrides the TTL.

### Green Points

Ordering a swap pays out points, and the **lower the footprint, the more you
get**. Two earners, both continuous, so there is no cliff where one more gram of
CO₂e costs you a whole tier:

| Earner | Rule |
| --- | --- |
| Low-footprint bonus | 15 pts per kg the meal comes in **under 8.0 kg CO₂e** |
| Carbon saved | 25 pts per kg avoided versus what you searched for, counted up to 12 kg |
| Streak | ×1.1 per consecutive *low*-impact order, capped at ×1.5. One medium-impact order resets it |
| Tier | ×1.0 to ×1.2, by points earned all time |

The 8.0 kg ceiling is deliberate: beef sits at 8.5 and lamb at 20, so the
meat-heavy end of the catalog earns nothing from its own footprint and has to
rely on the saving. A berry sorbet at 0.3 kg earns the near-full 116.

The 12 kg cap on savings stops a single lamb-to-sorbet swap paying out ~490
points and making every order after it feel pointless. When the cap binds, the
receipt says so (*first 12 kg of 19.5 counted*) rather than silently disagreeing
with the "19.5 kg saved" figure above it.

Points buy **discounts at checkout** ($2 / $5 / $10 / $20 off) and **perks**
redeemed from the rewards page (a plant-milk upgrade, a tree planted). Tiers —
Seedling, Sprout, Sapling, Canopy, Old Growth — are earned on *lifetime* points,
so spending your balance never demotes you.

Two rules the arithmetic depends on:

- **One formula.** `pointsForOrder` is the only place points are computed, so
  the `+301 pts` on a results card, the checkout preview and the receipt cannot
  drift apart.
- **Spend before earn.** `applyOrder` deducts the voucher first and pays out
  second, so an order can never be bought with the points it is about to
  generate.

The ledger lives in `localStorage` under `sustaineat.rewards.v1` — no account,
no backend. Every read is re-derived field by field, so a corrupt or hand-edited
entry costs you history rather than rendering `NaN pts` for the rest of the
demo, and a private window that throws on storage still works in memory.

> Because it is per-browser, clearing site data resets the balance. To demo a
> full ladder without placing a dozen orders, set the key by hand in the
> console:
> ```js
> localStorage.setItem("sustaineat.rewards.v1", JSON.stringify({
>   points: 1820, lifetimePoints: 5240, streak: 3, orders: [], redemptions: []
> }));
> ```

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
- `localStorage` blocked, full or corrupt → the points balance starts from zero
  for the session instead of throwing; nothing else on the page changes.

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
   location on the receipt is the venue from the card you chose, and the CO₂e
   on it is net of the trip to collect it.
6. Point at the notice reading *2 options hidden for giving you substantially
   less protein* and untick **Nutritionally comparable only**. Two cards appear
   with *lower* carbon numbers than the winner, both flagged — the swaps a
   carbon-only tool would have recommended.
7. Flip **Getting there** from Drive to Walk. Every net figure rises at once.
   Search a drink with the radius set wide and the nearest venue a few miles
   out and the opposite happens: the cards turn red and read *costs 2.0 kg
   net*, because the drive emits more than the swap saves.

> Before presenting, run your demo searches once with the backend up. That
> fills the Places cache, so on stage every search is instant, free, and
> independent of the venue wifi.
6. The confirmation pays out **Green Points** with the arithmetic shown — and
   the lower-carbon cards on the way in were already labelled with what each
   would earn. Place a second order and the **$2 off** reward unlocks; applying
   it drops the total on the spot and the receipt shows the new balance.
