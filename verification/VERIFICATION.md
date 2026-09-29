# Browser verification

The scripts in this directory drive the app in real Chrome (headless, via
`puppeteer-core`) against a running backend. jsdom applies no CSS, so layout,
overflow and pin placement can only be checked this way.

## Running

```bash
cd server && npm start          # backend on :5000
node verification/verify.js     # full demo path
```

Every script needs `puppeteer-core` (`npm i puppeteer-core`) and the Chrome
path set in the `CHROME` constant at the top of the file. Geolocation is
granted and pinned to MIT (42.3601, -71.0942) so the location fallback never
fires. Some scripts take a search term as their first argument.

| Script | Checks |
| --- | --- |
| `verify.js` | Landing → search → alternatives → detail → checkout → confirmation, vegan re-search, mobile 375px layout. Asserts zero page errors and zero React warnings. |
| `verify-chips.js` | Ingredient and format chips on the results page; classification values unchanged by the display layer. |
| `verify-evidence.js` | Review-verified dish claims (see `DISH-EVIDENCE.md`). |
| `verify-venues.js`, `verify-venues-degraded.js` | Venue matching and its degraded branches (see `VENUE-ARCHITECTURE.md`). |
| `verify-gmaps.js` | Google Maps loading, fallback and markers (see `GOOGLE-MAPS.md`). |
| `verify-map-labels.js`, `verify-map-edges.js` | Built-in map pin numbering, single-label reveal, edge anchoring. |
| `verify-photos.js` | Venue and dish photo paths, with `pexels-stub.js` for failure modes. |
| `trace-cheesecake.js` | Rule-by-rule trace of `classifyIngredient` (see `CHEESECAKE-TRACE.md`). |

## What the full path asserts

- Boot: React 18 + Babel compile in-browser, `#root` populated, `styles.css`
  applied.
- Search `beef burger` / diet None: a high-impact badge and three alternative
  cards in a three-column CSS grid with no viewport overflow.
- Map and list show the same venues, pins numbered to match rows, all pins
  inside the map bounds.
- Alternative detail panel shows nutrition; checkout carries the venue and
  computes tax and total; confirmation states the CO2e saved.
- Vegan re-search: every alternative tagged vegan and vegetarian.
- Mobile 375x812: single-column grid, 2x2 nutrition grid,
  `scrollWidth == innerWidth`, no truncated restaurant names.

Expected console output is zero page errors and zero React warnings. A
`/favicon.ico` 404 is cosmetic. USDA `429`s mean the `DEMO_KEY` rate limit is
tripped; the page then shows the "USDA rate limit reached" notice and an
`Estimated` chip.

## Map pin labels

Live Places data returns up to ten venues, several of which can cluster within
a few pixels of each other, so name labels cannot all be shown at once.

1. Map and list draw from the same venue array, so every pin has a row.
   `verify-map-labels.js` asserts that pin and row counts and numbers match.
2. Pins are numbered and the matching row carries the same badge. The name
   label is revealed by CSS only on `:hover`, `:focus-visible` or `.active`,
   and the revealed pin gets `z-index: 6` so its label sits above neighbours.
3. Labels near an edge anchor inward. `MiniMap` tags a pin `edge-left` below
   22% or `edge-right` above 78%, and the CSS re-anchors the label so the map's
   `overflow: hidden` cannot clip it.

The index comes from array position, not `restaurant.id`, so the map and the
list cannot drift apart. `verify-map-edges.js` forces pins to 10%, 50% and 90%
on both desktop and mobile widths, and tests a label at the 130px `max-width`
placed exactly on the 22% / 78% switch-over, to confirm zero overflow.
Hovering one pin while another is selected shows two labels; that is intended.

## Card photos

Two sources: the venue thumbnail in "Where to get them" comes from Google
Places, and the dish photo on each alternative card comes from Pexels.

### Google Places

`places.photos` is in both field masks. Live venues return `photo.name` in the
`places/ID/photos/REF` shape plus `photo.attribution`; fallback venues have
`photo: null`. The browser fetches `/api/place-photo`, which validates the
reference (path traversal, foreign hosts and malformed names all return 400
without an upstream call), proxies the image with
`Cache-Control: public, max-age=86400`, and returns 502 for a well-formed but
unknown reference so the client's `onError` swap fires. The API key never
appears in a client-facing payload.

Each image load is one Place Photos request, billed separately from the search
tier. The day-long cache is the mitigation; removing `'places.photos'` from the
two field masks in `server/server.js` removes the charge and drops back to
text-only rows.

### Pexels

`PEXELS_API_KEY` is optional. `/api/food-photos` takes `names[]` (required,
capped at 8) and answers every name. With no key it returns
`{ ok: false, reason: "no-key" }` and prints one start-up warning. The request
is `GET api.pexels.com/v1/search` with a bare `Authorization: <key>` header and
the query `<food name> + PHOTO_QUERY_SUFFIX` (`" food"`, `&` stripped). The
image URL is `src.original` with `auto=compress&cs=tinysrgb&fit=crop&w=400&h=260`;
those hotlinks need no key and cost no quota. The payload carries
`photographer`, `photographer_url`, `source` and `sourceUrl`, so the card can
credit the photographer and link the photo page.

Answers are cached for the process's lifetime: successes and genuine misses
are cached, failures never, so one `429` (`rate-limited`) does not blank a
food until restart. `401`/`403` map to `bad-key` and print one ACTION NEEDED
line rather than one per food.

Pexels was chosen over Unsplash because Unsplash has no keyless tier
(`source.unsplash.com` was switched off in 2024), caps new apps at 50
requests/hour, and requires a download-ping callback on use.

Stock photos are approximate: searching a library by dish name returns a
generic shot, which is why the card credits the photographer and links the
source rather than implying the photo is of that venue's dish.
`PHOTO_QUERY_SUFFIX` in `server/server.js` is the knob if a card needs
steering.

`verify-photos.js` runs against the live server; `PEXELS_STUB_MODE=flaky` and
`PEXELS_STUB_MODE=401` (with `-r ./verification/pexels-stub.js`) exercise the
failure branches, which cannot be produced on demand.
