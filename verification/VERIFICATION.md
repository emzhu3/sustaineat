# SustainEat — visual browser verification

Run on **2026-09-17** against `http://localhost:5000` in **real Chrome**
(headless, your installed `chrome.exe`), driven by `verify.js` via
`puppeteer-core`. Geolocation was granted and pinned to MIT
(42.3601, -71.0942) so the 8-second location fallback never fired.

This closes the gap left by the earlier jsdom run: **jsdom applies no CSS**, so
until now nobody had actually seen the page render.

## Verdict

The full README demo path works, and it looks right — on desktop and on a
phone. **Zero page errors, zero React warnings.** No blocking issues.

## What was checked, and what was seen

| Stage | Result |
| --- | --- |
| Boot | React 18 + Babel compile in-browser, `#root` populated. `styles.css` applied (1 stylesheet, body `rgb(250,245,240)` cream, primary button `rgb(107,168,127)` green) |
| Landing | Logo, search field, green CTA, cream preferences card — `01`, `07` |
| Search `beef burger` / diet None | `8.5 kg CO2e`, red **HIGH IMPACT** badge — `02` |
| Alternatives grid | 3 cards, real CSS grid, 3 equal columns (397px each), single row, no viewport overflow — `02` |
| Mini-map | 5 pins, **min separation 101px**, all pins inside map bounds. The pin-stacking risk flagged earlier **is not present** under real CSS — `09` |
| Restaurant list | 5 rows with distance / rating / price; selected row highlights green — `09` |
| Alternative detail | Slide-in panel, nutrition 430 cal / 21g protein / 52g carbs / 14g fat — `03` |
| Checkout | Item $11.00, pickup "Green Fork Kitchen - 0.3 mi", tax $0.91, **total $11.91** — `04` |
| Confirmation | "Order confirmed", **7.7 kg CO2e saved**, "~19.1 miles of driving avoided" — `05` |
| Vegan re-search | 3 alternatives, every one tagged `VEGAN` + `VEGETARIAN`; no meat or dairy — `06` |
| Mobile 375x812 | Single-column grid (305px), 2x2 nutrition grid, **no horizontal overflow** (`scrollWidth 375 == innerWidth 375`, zero overflowing elements) — `07`, `08` |

## Console output

- **0** page errors
- **0** React warnings
- **3** console errors, all explained:
  - `404` — `/favicon.ico`. Cosmetic; there is no favicon file.
  - `429` x2 — USDA `DEMO_KEY` rate limit. See below.

## Two things that will affect a live demo

### 1. The USDA key is *currently* rate-limited — confirmed, not hypothetical

The run hit real `429`s. The results page showed the yellow notice
"USDA rate limit reached" and an `Estimated` chip instead of live USDA data.
The app degrades exactly as designed — but a judge sees estimated nutrition,
not the real thing.

This is README setup item #2, and it is already tripped. Get a free key
(https://fdc.nal.usda.gov/api-key-signup.html) and set `USDA_API_KEY` in
`app.js` before demoing.

### 2. Google Places is still disabled

Restaurants come back as the five sample locations ("Green Fork Kitchen",
"The Daily Harvest", ...) with `source: "fallback"`. README setup item #1.
The map and distances still behave correctly, so this degrades gracefully.

## Minor cosmetic notes (no action required)

1. **Map label clipped at the right edge** — the "Nine Acres Cafe" pin sits near
   the map's right boundary and its label runs flush to the edge. Only affects
   pins that land far east.
2. **Label overlap near the center** — "Green Fork Kit..." label and the green
   "You" badge nearly touch when a restaurant is very close to you (0.3 mi).
3. **Map bottom is empty** — the mini-map is a 598x598 square, but pins cluster
   in the upper two-thirds, leaving visible dead space.
4. **No favicon** — one 404 in the console if a judge opens devtools.

## Reproducing this

```bash
cd server && npm start          # backend on :5000
node verification/verify.js     # needs puppeteer-core installed
```

`verify.js` expects `puppeteer-core` (`npm i puppeteer-core`) and the Chrome
path at the top of the file. It writes PNGs to `shots/`.

---

## UPDATE (later, 2026-09-17): map pin labels collide with LIVE Places data

Both README setup items are now done — nutrition reads "USDA FoodData Central"
and Places returns real restaurants. That changed the map's behaviour:

| | sample data | live Places data |
| --- | --- | --- |
| pins | 5 | 10 |
| min pin separation | 101px | 25px |
| labels | readable | **overlapping** |

See `screenshots/09-map-and-list-live.png`. Searching "beef burger" from MIT
returns 10 real burger places, and six of them land in a tight cluster where
the labels ("The Kenmore", "7th Street Burg...", "Boston Burger ...",
"Tasty Burger", "The Burger Room") sit on top of each other and are not
readable. "FRIES B4 GUYS" on the west edge is clipped by the map boundary.

Pin DOTS are still fine — 25px apart with ~10px dots, none outside the map.
It is only the text labels that collide.

NOT introduced by the chip-label change; caused by Places going live. Found
while regressing that change.

Options if you want it fixed before judging: cap pins at ~5
(`restaurants.slice(0, 5)`), show the label only for the selected/hovered pin,
or drop labels and rely on the numbered list beside the map.

### FIXED (2026-09-17)

Three changes, no new dependencies:

1. **Map and list now show the SAME six places.** `ResultsPage` computes
   `visibleRestaurants = restaurants.slice(0, 6)` once and passes it to both.
   Previously the list sliced to 6 while the map plotted all 10, so four pins
   had no row at all. Pins dropped 10 -> 6, min separation 25px -> 62px.
2. **Pins are numbered; only one label shows at a time.** Each dot carries its
   number (1-6) and the matching row carries the same badge, so you can read
   the map against the list at a glance. The name label is revealed by CSS only
   on `:hover`, `:focus-visible`, or `.active` -- never ten at once. The
   revealed pin gets `z-index: 6` so its label sits above its neighbours.
3. **Labels near an edge anchor inward.** The label is absolutely positioned
   and centred by default; `MiniMap` tags a pin `edge-left` below 22% or
   `edge-right` above 78%, and the CSS re-anchors it so it cannot be clipped by
   the map's `overflow: hidden`. ("FRIES B4 GUYS" was clipped before.)

The index comes from array position, not `restaurant.id`, so the map and the
list cannot drift apart.

Verified (`node verification/verify-map-labels.js`):

    pins 6 == rows 6, numbers match                      OK
    labels visible at rest                               1 (the selected pin)
    pin 1..6 clicked: label shown, 1 visible, inside map OK  (pin 6 = edge-left)
    clicking a pin selects the matching row              OK
    page errors                                          0

Regression (`node verification/verify.js`): alt-grid 3 columns, all pins inside
map, checkout -> confirmation 7.7 kg, vegan filter clean, mobile 375px zero
horizontal overflow and no truncated restaurant names, 0 page errors.

Screenshots: `14-map-fixed.png` (desktop, pin 6 selected),
`15-map-hover.png` (hover reveal), `16-map-mobile.png` (375px).
Backups: `app.js.pre-map-labels.bak`, `styles.css.pre-map-labels.bak`.

#### Edge-anchoring coverage

Real Boston data only ever exercised `edge-left` (pin 6), so both edges were
also driven synthetically (`node verification/verify-map-edges.js`) by forcing
a pin's position and class:

    desktop (map 598px)   edge-right@90%  edge-left@10%  centred@50%   all inside
    mobile  (map 305px)   edge-right@90%  edge-left@10%  centred@50%   all inside

Worst case re-tested with a label long enough to hit the 130px `max-width`,
placed exactly on the 22% / 78% switch-over points where the label is still
centred rather than anchored:

    desktop  centred@22% / @78% / @21.9% / @78.1%   0px overflow
    mobile   centred@22% / @78% / @21.9% / @78.1%   0px overflow

Hovering a pin while another is selected shows two labels (hovered + selected).
That is intended and they do not collide -- see `15-map-hover.png`.

---

## Card photos — 2026-09-20

Two sources, added together: the venue thumbnail in **Where to get them** comes
from Google Places, the dish photo on each alternative card comes from Unsplash.

Driven by `node verification/verify-photos.js` against a live backend, plus a
real-Chrome pass at `http://localhost:5000` with geolocation pinned to MIT
(42.3601, -71.0942) and the search `beef burger`, diet None.

### Verdict

Both photo paths work. **Zero page errors, zero broken images**, and every
degraded branch renders as a deliberate tile rather than a broken `<img>`.

### Unsplash needed a key, contrary to the original plan

The feature was specified as "free, no key required for basic use". That is not
the case, and the difference is load-bearing for a demo:

- The Unsplash API has never had a keyless tier — every call needs
  `Authorization: Client-ID <access key>`.
- The keyless thing people remember is `source.unsplash.com`, deprecated in
  November 2021 and switched off in June 2024. It now returns 503.
- A new app is in **Demo** mode: **50 requests/hour**. One per distinct food,
  up to 8 per results page — about six fresh searches before the hour is spent.
  Production mode raises it to 1,000/hour.

So the server treats the key as optional and caches every answer for the
process's lifetime. `UNSPLASH_ACCESS_KEY` was **not set** at the time of this
run, so the real Unsplash branch was exercised through
`verification/unsplash-stub.js` — a `-r` preload that answers
`api.unsplash.com` from a fixture while every other call, including the real
Google Places ones, passes straight through. The fixture's image URLs are
genuine `images.unsplash.com` hotlinks (those need no key), so the browser
really did load and render photos.

### What was checked, and what was seen

| Stage | Result |
| --- | --- |
| `places.photos` in both field masks | Live venues return `photo.name` in the documented `places/ID/photos/REF` shape; `photo.attribution` present (e.g. Audubon → "Alyssa Holmes") |
| Fallback venues | `photo: null` — a sample location never shows a real photo |
| `/api/place-photo` happy path | 200, `image/jpeg`, 51,671 bytes, `Cache-Control: public, max-age=86400` |
| Key containment | `key=` appears nowhere in any client-facing payload; the browser only ever sees the photo reference |
| `/api/place-photo` validation | `../../etc/passwd`, `https://evil.example.com/x`, `places/x/photos/y/../z` and an empty name all → **400**, upstream never called |
| `/api/place-photo` unknown reference | Well-formed but bogus → **502**, which is what the client's `onError` swap expects |
| `/api/food-photos` no key | `{ok: false, reason: "no-key"}` — no invented URL, no error, one start-up warning |
| `/api/food-photos` shape | `names[]` required (400), batch capped at 8, every requested name answered |
| Unsplash request | `Authorization: Client-ID …`, `Accept-Version: v1`, query = food name + `" food"` (`&` stripped: "Falafel & Hummus Bowl" → `Falafel Hummus Bowl food`) |
| Unsplash response handling | Hotlinked `images.unsplash.com`, `w=400&h=260&fit=crop`, original `ixid` preserved, photographer named, both links carry `utm_source=SustainEat&utm_medium=referral`, `alt` text set |
| Download ping | Fired once per cache fill, never on a cache hit, failures swallowed |
| Cache | A repeat search returns a byte-identical payload and spends no quota |
| Rate-limit blip (`UNSPLASH_STUB_MODE=flaky`) | First ask → `reason: "rate-limited"`; **the very next ask succeeds** — the failure is not cached, so one 403 cannot blank a food until restart. The success then is cached |
| Browser, photos on | 3 alt cards each with a full-bleed dish photo and a credit line linking photographer + Unsplash; 3 venue thumbnails with Google's author attribution beneath; 0 broken images |
| Browser, no key | Same 3 cards with the plain 🍽️ tile, no credit lines, card geometry unchanged, 0 broken images |
| Phone width (400px) | Grid collapses to one 315px column, `scrollWidth 385 < 400` — no horizontal overflow |

`node verification/verify-photos.js`: **30/30 passed** with the stub, **22/22**
against the real no-key server, **23/23** in flaky mode.

Backups: `server.js.pre-photos.bak`, `app.js.pre-photos.bak`,
`styles.css.pre-photos.bak`, `README.md.pre-photos.bak`.

### Cost note

Photos are not free. Each image the browser loads is one **Place Photos**
request, billed separately from the search tier this app already sits on. The
day-long `Cache-Control` on `/api/place-photo` is the mitigation; removing
`'places.photos'` from the two field masks in `server/server.js` removes the
charge entirely and drops the app back to text-only rows.

---

## Dish photos moved from Unsplash to Pexels — 2026-09-20

The Unsplash section above is left as written; it records what was true when the
feature was built. This section records the swap.

### Why

Unsplash was unreachable. Both hosts were probed directly and **both timed out
at 12s with no response** (`api.unsplash.com` and `images.unsplash.com`),
corroborating the report. The switch was made to Pexels rather than waiting.

Pexels is the smaller dependency: a bare `Authorization: <key>` header — no
`Bearer`, no `Accept-Version` — no UTM parameters to thread through the links,
and no download-ping callback to fire when a photo is used.

### What changed

| Before (Unsplash) | After (Pexels) |
| --- | --- |
| `UNSPLASH_ACCESS_KEY` | `PEXELS_API_KEY` |
| `GET api.unsplash.com/search/photos`, `Authorization: Client-ID <key>`, `Accept-Version: v1` | `GET api.pexels.com/v1/search`, `Authorization: <key>` |
| `data.results[0]`, image from `urls.raw` + sizing params | `data.photos[0]`, image from `src.original` + sizing params |
| 403 → `rate-limited` | **429 → `rate-limited`; 401/403 → `bad-key`** (new: prints one ACTION NEEDED line) |
| Download ping required on use | No equivalent; removed |
| Payload field `unsplashUrl` | Payload fields `source` + `sourceUrl` — provider-neutral, so the next swap is server-side only |

`PHOTO_QUERY_SUFFIX` (` food`) and the cache — successes and honest misses
cached, failures never — carry over unchanged.

### What was checked, and what was seen

The happy path was run against the **real Pexels API with the real key**, not a
stub. The stub (`verification/pexels-stub.js`, replacing `unsplash-stub.js`) is
now only needed for the failure branches, which cannot be produced on demand.

| Stage | Result |
| --- | --- |
| Live key probe | 200, `x-ratelimit-limit: 25000`, `x-ratelimit-remaining: 24999`, reset 2026-10-20 (monthly). Pexels' docs also cite 200/hour; the headers do not surface that |
| `node verification/verify-photos.js`, live | **29/29 passed** — including Google's venue photos, which were untouched |
| Photo payload, live | `Black Bean Burger` → Omair Tabikh; `Red Lentil Dal & Rice` → Thomas Nahar (a khichdi dish); `Sorbet Cup` → Valeria Boltneva (gelato). Real `alt` text on all three |
| Image URL | `images.pexels.com/...?auto=compress&cs=tinysrgb&fit=crop&w=400&h=260` — 21KB JPEG, fetched with no key and no quota cost |
| Attribution | `photographer` + `photographer_url` (profile), `source: "Pexels"` + `sourceUrl` (the photo's own page, which is the link Pexels prefers) |
| Cache | Repeat request byte-identical, no second API call |
| `PEXELS_STUB_MODE=flaky` | **23/23 passed.** First ask → `rate-limited`, the very next ask succeeds — a 429 blip is still not cached |
| `PEXELS_STUB_MODE=401` | `reason: "bad-key"` per card; the ACTION NEEDED block printed **once**, not once per food, with the per-request 401 logged each time |
| Browser, real photos | 3 alt cards, 3 `<img>` all from `images.pexels.com`, 0 placeholder tiles, 0 broken images. Credits read "Photo: Omair Tabikh on Pexels" / "Kritsana (Kid) Takhai" / "Thomas Nahar", each with two links — photographer profile and photo page. 3 Google venue thumbnails still present |

Backups: `server.js.pre-pexels.bak`, `app.js.pre-pexels.bak`,
`styles.css.pre-pexels.bak`, `README.md.pre-pexels.bak`.

### Noticed while verifying, not fixed

**USDA is also unreachable right now**, and `app.js` puts no timeout on that
fetch. In the browser the call sat for **40 seconds** before throwing, and the
results page held its spinner that whole time before falling back to estimated
nutrition. The fallback works — it is only the wait that is bad, and on a demo
40 seconds of spinner reads as a hang. Everything else on the page (Google
Places, Pexels, the backend) answered normally throughout; the backend itself
replied in 19ms.

This is pre-existing and unrelated to the photo work, so it was left alone. The
fix, if wanted, is an `AbortController` on the USDA fetch in `app.js` with the
same ~8s budget the geolocation call already uses.

### Stock photos are approximate

"Black Bean Burger" returned a generic burger-and-fries shot. That is inherent
to searching a stock library by dish name — Unsplash did the same — and it is
why the card credits the photographer and links the source rather than implying
the photo is of that restaurant's actual dish. `PHOTO_QUERY_SUFFIX` in
`server/server.js` is the knob if a particular card needs steering.
