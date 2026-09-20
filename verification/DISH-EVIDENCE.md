# Review-verified dish matching (2026-09-17)

## Before / after

Before, a card claimed a shop could serve a dish purely because the shop's
CATEGORY matched ("vegan bakery" -> "we suggest Vegan Cashew Cheesecake there").
Now the claim is graded by whether anyone actually said so.

| evidence | card reads |
| --- | --- |
| a review names the dish | `Reviewers mention "veggie burger" at Audubon • 1 mi` |
| category match only | `Indian restaurant nearby — Tanjore Bar and Restaurant • 0.9 mi` |
| Places call failed | `Sample location — Green Fork Kitchen` |
| nothing nearby | `Not available nearby` |

Those are the ONLY four shapes, asserted by regex in the test. The old
unsupported `serves X` wording is gone from the venue rows too: a row now reads
`"veggie burger" in reviews — Black Bean Burger` or `may serve Red Lentil Dal & Rice`.

## How it works

`places.reviews` is added to the `searchText` field mask, so the existing
single call per alternative also returns up to 5 reviews per venue. No extra
request. The backend then:

1. **Normalizes** both review text and dish terms - lowercase, and `-`, `'`,
   curly apostrophes all become spaces. Without this "steel-cut" never matches
   "steel cut".
2. **Word-boundary matches** each term, so "poke" cannot match "poke around".
3. **Ranks hits** by review rating first, then term length, so the snippet comes
   from the happiest reviewer and names the most specific dish.
4. **Ranks venues** with evidence above venues without, even when the
   evidence-backed one is further away (Audubon at 1 mi beats Tanjore at 0.9).
5. **Strips the raw reviews** before responding — only
   `{ term, quote, rating, mentions }` is sent.

The quote is pulled from the ORIGINAL text (+/-70 chars, trimmed to word
boundaries, capped at 160) and shown on the detail panel, not the card.

## Tuning

`dishTerms` on each of the 36 items in `ALTERNATIVE_CATALOG` (`app.js`),
alongside `placesQuery`. Terms are biased toward precision — a false
"reviewers mention this" is a worse lie than a missed match — so bare generic
words (`hash`, `peach`, `poke`, `salmon`) were deliberately left out and only
the two-word forms kept.

## Cost

`places.reviews` moves the request to **Enterprise + Atmosphere**, Places' most
expensive tier, and there is one call per suggested food. One user search is
roughly **15-18x** the Places cost of the app's original single search.
Deleting `'places.reviews'` from the field mask in `server/server.js` reverts
this; everything still works, just without dish verification.

## Verified (`node verification/verify-evidence.js`)

Real evidence found with live data from MIT:

    "veggie burger"  at Audubon                      (5 stars)  Black Bean Burger
    "falafel wrap"   at Anoush'ella                             Mediterranean Veggie Wrap
    "potato hash"    at Buttermilk & Bourbon                    Sweet Potato Hash
    "sorbet"         at Van Leeuwen Ice Cream         (5 stars)  Fresh Berry Sorbet

    disallowed claim shapes across 5 searches        0
    evidence-backed cards seen with real data        4
    verified cards when evidence is stripped         0
    bare "serves X" without evidence anywhere        false
    exactly one of quote/caveat on the detail panel  true
    page errors                                      0

The no-evidence branch is forced by deleting `evidence` from the real API
response in the browser, so the venues stay real and only the proof is removed.

## Regression

Venue suite, degraded-branch suite and `verify.js` all still pass: pins == venue
rows, checkout and confirmation name the selected card's venue, unavailable
options unorderable, mobile 375px zero horizontal overflow, 0 page errors.

Backups: `app.js.pre-reviews.bak`, `styles.css.pre-reviews.bak`,
`server.js.pre-reviews.bak`, `README.md.pre-reviews.bak`.

## Quoting: sentence-aware, not a fixed window

The first version took a fixed +/-70 characters around the match. On rambling
reviews that lands mid-clause and reads as nonsense — the literal first result
was:

    "… we ordered the Chicken katszu (so?) gigantic and delicious And veggie
     burger Expresso martini superb! All around excellent experience and …"

Now the snippet is the SENTENCE containing the mention (`.`, `!`, `?`, newline),
falling back to the window only when that sentence exceeds 200 chars. A stray
`?` inside brackets can still start the slice mid-clause, so a leading run of
punctuation is stripped and the result is prefixed with an ellipsis to mark it
as an excerpt. Hits are also ranked by rating, then by SHORTEST containing
sentence, so a review that says it plainly wins over one that lists nine dishes.

Result on live data:

    "Try the passion fruit sorbet if you like sour/tart."          (clean sentence)
    "Avocado toast was avocado toast, a nice light bite."          (clean sentence)
    "… gigantic and delicious And veggie burger Expresso martini superb!"

## Hit rate — what the demo will actually look like

Across five real searches, **4 of 15 cards (~27%)** carried review evidence.
That is the intended trade: precision over recall, because a false "reviewers
mention this" is worse than a missed match. Most cards will read
"<category> nearby", not "Reviewers mention".

Best search to demo: **beef burger** — 2 of 3 cards verified
("veggie burger" at Audubon, "falafel wrap" at Anoush'ella).
Worst: **ice cream** — 0 of 3, all category-only.
