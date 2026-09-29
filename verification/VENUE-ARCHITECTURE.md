# Venue matching architecture

Each suggested alternative is tied to a real venue found for that dish. A
catalog pick with no venue nearby is shown as unavailable rather than attached
to whichever restaurant happens to be selected elsewhere on the page.

## Shape

    search -> alternatives (catalog)
                 |
                 +-- for EACH alternative: one targeted Places search
                 |      "Vegan Cashew Cheesecake" -> "vegan bakery"
                 |      "Fresh Berry Sorbet"      -> "sorbet gelato shop"
                 |
                 +-- venues found?  yes -> card shows "Available at X, N mi"
                                    no  -> card shows "Not available nearby",
                                           greyed, aria-disabled, sorted last,
                                           cannot be selected or ordered
                 |
                 +-- "Where to get them" maps ONLY those matched venues,
                     grouped so one shop serving two options is one pin
                 |
                 +-- checkout pickup = the venue on the chosen card

## Backend

`POST /api/alternatives-nearby`

    { latitude, longitude, radiusMiles,
      queries: [ { key, label, query }, ... ] }   // max 8

    -> { success, source: "google"|"mixed"|"fallback", notice,
         results: { <key>: { source, venues: [...] } } }

- `Promise.allSettled`, so one failing query cannot blank the other cards.
- A successful search returning zero results is a real answer ("not
  available"), not a fallback. Only a failed call produces a placeholder.
- Placeholders are seeded from the food name so two cards never collide, and
  are flagged `source: "fallback"` so the UI can say "Sample location".
- Targeted queries are sparse, so the batch endpoint widens to `radius x 2`
  before giving up. `/api/restaurants` remains for the single-query list.

## Tuning

`placesQuery` on each of the 36 items in `ALTERNATIVE_CATALOG` (`app.js`) is
the string sent to Places.

## Verification (`node verification/verify-venues.js [food]`)

Against live Places data the script asserts:

    every available card traceable to a listed venue    true
    pins == venue rows                                  true
    clicking a pin selects a food that venue serves     true
    checkout + confirmation name the CARD's venue       true
    page errors                                         0

### Degraded branches (`node verification/verify-venues-degraded.js`)

Live Places is fuzzy and almost never returns zero, so these are forced by
rewriting the API response in the browser:

| branch | result |
| --- | --- |
| one option has no venue | greyed, "Not available nearby", aria-disabled, sorted last, excluded from the map, clicking does not select |
| Places call failed | every card reads "Sample location — <name>", notice shown |
| nothing available at all | all cards greyed, empty-note explains, no details panel and no checkout button |
| food has no alternatives (e.g. ramen) | "Where to get them" hidden; only "Nice pick — already lowest-carbon" shows |
