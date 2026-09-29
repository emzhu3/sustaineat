# Review-verified dish matching

A card only claims a venue serves a dish when a review says so. A category
match alone ("vegan bakery") is worded as a category match. There are exactly
four claim shapes, asserted by regex in the test:

| evidence | card reads |
| --- | --- |
| a review names the dish | `Reviewers mention "veggie burger" at Audubon • 1 mi` |
| category match only | `Indian restaurant nearby — Tanjore Bar and Restaurant • 0.9 mi` |
| Places call failed | `Sample location — Green Fork Kitchen` |
| nothing nearby | `Not available nearby` |

Venue rows use the same distinction: `"veggie burger" in reviews — Black Bean
Burger` or `may serve Red Lentil Dal & Rice`. A bare `serves X` never appears.

## How it works

`places.reviews` is in the `searchText` field mask, so the single call per
alternative also returns up to five reviews per venue with no extra request.
The backend then:

1. **Normalizes** both review text and dish terms: lowercase, with `-`, `'`
   and curly apostrophes becoming spaces, so "steel-cut" matches "steel cut".
2. **Word-boundary matches** each term, so "poke" cannot match "poke around".
3. **Ranks hits** by review rating first, then by the shortest containing
   sentence, so a review that says it plainly wins over one listing nine
   dishes.
4. **Ranks venues** with evidence above venues without, even when the
   evidence-backed one is further away.
5. **Strips the raw reviews** before responding; only
   `{ term, quote, rating, mentions }` is sent.

### Quoting

The snippet is the sentence containing the mention (delimited by `.`, `!`,
`?` or newline), falling back to a ±70-character window trimmed to word
boundaries only when that sentence exceeds 200 characters. A leading run of
punctuation is stripped and the result is prefixed with an ellipsis to mark it
as an excerpt. The quote is shown on the detail panel, not the card.

## Tuning

`dishTerms` on each of the 36 items in `ALTERNATIVE_CATALOG` (`app.js`),
alongside `placesQuery`. Terms are biased toward precision — a false
"reviewers mention this" is worse than a missed match — so bare generic words
(`hash`, `peach`, `poke`, `salmon`) are left out and only two-word forms are
kept. On live data around a quarter of cards carry review evidence; most read
"<category> nearby".

## Cost

`places.reviews` moves the request to Enterprise + Atmosphere, Places' most
expensive tier, with one call per suggested food. One search is roughly
15–18x the Places cost of a single text search. Deleting `'places.reviews'`
from the field mask in `server/server.js` reverts this; everything still works
without dish verification.

## Verification (`node verification/verify-evidence.js`)

Runs five searches against live Places data and asserts:

    disallowed claim shapes                          0
    verified cards when evidence is stripped         0
    bare "serves X" without evidence anywhere        false
    exactly one of quote/caveat on the detail panel  true
    page errors                                      0

The no-evidence branch is forced by deleting `evidence` from the real API
response in the browser, so the venues stay real and only the proof is
removed.
