# Real Google map (2026-09-18)

The CSS placeholder (dashed rings, "You" pill, numbered circles) is replaced by
a Maps JavaScript API map: real tiles, a marker for the user, one numbered
marker per venue at its real Places lat/lng, and an InfoWindow on click that
drives the same details panel the rows already drove.

## ONE API STILL NEEDS ENABLING

The key works, but **Maps JavaScript API is not enabled** on its project. The
library loads, then `gm_authFailure` fires and the map area would read
"Oops! Something went wrong."

    https://console.cloud.google.com/apis/library/maps-backend.googleapis.com?project=739001161925

Click Enable, reload — the real map appears with no code change. Until then the
page falls back to the built-in CSS map with a notice saying exactly this, which
is what is on screen today.

## Loading and fallback

`index.html` runs a small inline script BEFORE the Maps script, so
`gm_authFailure` already exists when Google calls it. Three ways to reach the
fallback, one way to reach the map:

| signal | result |
| --- | --- |
| `initGoogleMaps()` callback | `ready` -> real map |
| `gm_authFailure` (bad key, API off, blocked referrer) | `failed` -> built-in map |
| `<script onerror>` | `failed` -> built-in map |
| 15s with no answer (timeout in `useGoogleMapsState`) | `failed` -> built-in map |

`gm_authFailure` can arrive AFTER the ready callback — that is precisely what an
un-enabled API does — so `failed` may override `ready` at any time and the
component re-renders into the fallback.

## Markers

- Classic `google.maps.Marker`. `AdvancedMarkerElement` needs a `mapId`, and
  neither could be checked against live tiles from here, so the option with
  fewer moving parts wins.
- User marker: green `SymbolPath.CIRCLE` with a white ring, no label.
- Venue markers: labelled `1..n`, matching the numbered rows beside the map.
- `fitBounds` over the user plus every venue, clamped to zoom 16 on first
  `idle` — three venues 400m apart would otherwise land on street level.
- InfoWindow content is built as DOM, never an HTML string: venue names come
  from Google and one `<` should not become markup. It reuses the SAME two
  honest wordings as the cards (`"term" in reviews - Dish` / `may serve Dish`).

## Three bugs this caught

1. **`useRef` was never destructured** from React — `app.js` line 1 had only
   `useState, useEffect, useMemo` — so the component threw on first render.
2. **React error #310.** `useGoogleMapsState()` had been placed after
   `ResultsPage`'s `if (state.loading) return ...`, so the hook count changed
   between renders and the entire app blanked.
3. **Marker churn.** The marker effect depended on the `groups` array and the
   `onSelect` closure, both new objects every render, so every marker was torn
   down and rebuilt each time (6 markers for 3 venues, `fitBounds` twice). It
   now depends on a stable signature string and reads live props from refs.

The first two blanked the page completely and neither was visible without
running it in a browser.

## Verified (`node verification/verify-gmaps.js`)

The success path cannot be exercised against live tiles with this key, so it is
driven by a stubbed `google.maps` plus a fake Maps script that calls
`initGoogleMaps()` — real app code, fake Google. **Google's own rendering is
therefore unverified; everything the app does around it is.**

    fallback    gmapsState=failed, built-in map shown, google map absent,
                notice names "Maps JavaScript API", pin click still selects
    stub        .google-map rendered, CSS map gone, 1 Map constructed
                user marker at 42.3601,-71.0942, icon, no label
                3 venue markers labelled 1,2,3 == 3 venue rows
                real Places lat/lng used, fitBounds once
                marker click -> details panel changes, row activates,
                InfoWindow opens (name + address + honest food line), panTo
    sizing      mobile 305x305, desktop 598x598, map fills its container,
                no horizontal overflow at 375px
    page errors 0 in every mode

Regression: alt-grid, checkout -> confirmation, vegan filter, dish evidence
(0 disallowed claim shapes) and the degraded venue branches all still pass.

Backups: `index.html.pre-gmaps.bak`, `app.js.pre-gmaps.bak`,
`styles.css.pre-gmaps.bak`, `README.md.pre-gmaps.bak`.
