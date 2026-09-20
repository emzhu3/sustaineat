# Alternatives are now tied to real venues (2026-09-17)

## The problem

`generateAlternatives()` picked foods from a static catalog. Separately, one
Places search for the ORIGINAL query filled a "Near you" list. Nothing joined
them. The app could suggest a Vegan Cashew Cheesecake next to a burger joint,
and checkout would put that cheesecake's pickup at whichever restaurant happened
to be selected in an unrelated list.

## The shape now

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
                 +-- checkout pickup = the venue on the card you chose

## Backend

`POST /api/alternatives-nearby`

    { latitude, longitude, radiusMiles,
      queries: [ { key, label, query }, ... ] }   // max 8

    -> { success, source: "google"|"mixed"|"fallback", notice,
         results: { <key>: { source, venues: [...] } } }

- `Promise.allSettled`, so one failing query cannot blank the other cards.
- **A successful search returning zero results is a real answer** ("not
  available"), NOT a fallback. Only a failed CALL produces a placeholder.
- Placeholders are seeded from the food name, so two cards never collide, and
  are flagged `source: "fallback"` so the UI can say "Sample location".
- Targeted queries are sparse, so the batch endpoint reaches to `radius x 2`
  before giving up. `/api/restaurants` is unchanged and kept for the README.

## Where to tune

`placesQuery` on each of the 36 items in `ALTERNATIVE_CATALOG` (`app.js`).
That string is what gets sent to Places.

## Verified (`node verification/verify-venues.js [food]`)

Real Places data, from MIT:

    cheesecake   Vegan Cashew Cheesecake -> Verveine Cafe & Bakery   0.3 mi
                 Fresh Berry Sorbet      -> New City Microcreamery   0.4 mi
                 Oat Milk Soft Serve     -> New City Microcreamery   0.4 mi
    beef burger  Black Bean Burger       -> Veggie Galaxy            0.4 mi
                 Mediterranean Wrap      -> NAYA                     0.4 mi
                 Red Lentil Dal & Rice   -> Tanjore Bar & Restaurant 0.9 mi
    latte        Oat Milk Latte          -> Jaho Coffee Roaster      0.4 mi
                 Iced Green Tea          -> Broken Cup Teahouse      0.5 mi
    pancakes     Steel-Cut Oatmeal       -> Flour Bakery + Cafe      0.1 mi
                 Sweet Potato Hash       -> Cafe Luna                0.6 mi

    every available card traceable to a listed venue    true
    pins == venue rows                                  true
    clicking a pin selects a food that venue serves     true
    checkout + confirmation name the CARD's venue       true
    page errors                                         0

## Degraded branches (`node verification/verify-venues-degraded.js`)

Real Places is fuzzy and almost never returns zero, so these are forced by
rewriting the API response in the browser:

| branch | result |
| --- | --- |
| one option has no venue | greyed, "Not available nearby", aria-disabled, sorted last, excluded from the map, clicking it does not select it |
| Places call failed | every card reads "Sample location — <name>", notice shown |
| nothing available at all | all cards greyed, empty-note explains, **no details panel and no checkout button** |
| food has no alternatives (e.g. ramen) | "Where to get them" is hidden entirely; only "Nice pick — already lowest-carbon" shows |

## Regression

`node verification/verify.js`: alt-grid 3 columns, all pins inside the map,
checkout -> confirmation 7.7 kg, vegan filter clean, mobile 375px zero
horizontal overflow, 0 page errors.

Backups: `app.js.pre-venues.bak`, `styles.css.pre-venues.bak`,
`server.js.pre-venues.bak`, `README.md.pre-venues.bak`.
