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
