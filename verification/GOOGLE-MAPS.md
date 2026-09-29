# Google Maps integration

The results page renders a Maps JavaScript API map when the key allows it:
real tiles, a marker for the user, one numbered marker per venue at its Places
lat/lng, and an InfoWindow on click that drives the same details panel the rows
drive. When the map cannot load, the built-in CSS map (`MiniMap`) is shown
instead with a notice.

## Requirements

The API key's project must have the **Maps JavaScript API** enabled. With the
API disabled the library still loads, then `gm_authFailure` fires and the map
area reads "Oops! Something went wrong." The app catches that and falls back,
so the page keeps working; enabling the API needs no code change.

## Loading and fallback

`index.html` runs a small inline script before the Maps script, so
`gm_authFailure` already exists when Google calls it. Three signals reach the
fallback, one reaches the map:

| signal | result |
| --- | --- |
| `initGoogleMaps()` callback | `ready` → real map |
| `gm_authFailure` (bad key, API off, blocked referrer) | `failed` → built-in map |
| `<script onerror>` | `failed` → built-in map |
| 15 s with no answer (timeout in `useGoogleMapsState`) | `failed` → built-in map |

`gm_authFailure` can arrive after the ready callback — that is what a disabled
API does — so `failed` may override `ready` at any time and the component
re-renders into the fallback. `useGoogleMapsState` must be called before any
early return in `ResultsPage`, or the hook count changes between renders and
React throws error #310.

## Markers

- Classic `google.maps.Marker`. `AdvancedMarkerElement` needs a `mapId`, so
  the option with fewer moving parts is used.
- User marker: green `SymbolPath.CIRCLE` with a white ring, no label.
- Venue markers: labelled `1..n`, matching the numbered rows beside the map.
- `fitBounds` over the user plus every venue, clamped to zoom 16 on first
  `idle`, so three venues 400 m apart do not land at street level.
- InfoWindow content is built as DOM, never an HTML string: venue names come
  from Google and a `<` must not become markup. It reuses the same two
  wordings as the cards (`"term" in reviews - Dish` / `may serve Dish`).
- The marker effect depends on a stable signature string and reads live props
  from refs. Depending on the `groups` array or the `onSelect` closure — both
  new objects every render — tears down and rebuilds every marker on each
  render and calls `fitBounds` twice.

## Verification (`node verification/verify-gmaps.js`)

The success path is driven by a stubbed `google.maps` plus a fake Maps script
that calls `initGoogleMaps()`: real app code, fake Google. Google's own
rendering is not covered; everything the app does around it is.

    fallback    gmapsState=failed, built-in map shown, google map absent,
                notice names "Maps JavaScript API", pin click still selects
    stub        .google-map rendered, CSS map gone, 1 Map constructed
                user marker at 42.3601,-71.0942, icon, no label
                3 venue markers labelled 1,2,3 == 3 venue rows
                real Places lat/lng used, fitBounds once
                marker click -> details panel changes, row activates,
                InfoWindow opens (name + address + food line), panTo
    sizing      mobile 305x305, desktop 598x598, map fills its container,
                no horizontal overflow at 375px
    page errors 0 in every mode
