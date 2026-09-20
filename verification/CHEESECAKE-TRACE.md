# cheesecake -> "cheese": trace result (2026-09-17)

Traced against the LIVE served code in real Chrome with `setCacheEnabled(false)`.
Reproduce: `node verification/trace-cheesecake.js`

## Not a cache problem

Served `app.js` and disk `app.js` have identical MD5 `a0a9338424ccc7eceaaa3ee9c69291d9`.

## classifyIngredient("cheesecake") -> "cheese"

Rule-by-rule: misses tofu, lentils, beans, soy, vegetable (PLANT_OVERRIDES),
then lamb, beef, shrimp, fish, pork, turkey, chicken -- then HITS `cheese`
on the term `"cheese"`.

Mechanism, from `termMatches` (app.js ~line 84):

    if (term.length > 4 || /[\s-]/.test(term)) return value.includes(term);
    return new RegExp(`\b${term}(s|es)?\b`).test(value);

- `"cheese".length === 6` -> takes the SUBSTRING branch
- `"cheesecake".includes("cheese")` -> true
- a word-boundary test would have returned FALSE

## The comment at line 53 is incorrect

    //   "cheesecake"    -> cheese, because cheese precedes pastry

`pastry` would NOT catch cheesecake. Its term is `"cake"` (4 chars), which
takes the word-boundary branch, and `\bcake\b` does not match inside
"cheesecake". Verified live: `termMatches("cheesecake","cake") === false`.

Consequence: removing or reordering the `cheese` rule does NOT hand cheesecake
to `pastry`. It falls through every rule to the default `return "vegetable"`
-> 0.5 kg CO2e, which is worse than the current 2.2 kg.

## classifyFormat("cheesecake") -> "dessert"  (this part works)

The dessert-format fix is applied and working. Alternatives are desserts:
Vegan Cashew Cheesecake / Fresh Berry Sorbet / Oat Milk Soft Serve, under a
"Lower-carbon desserts" header. See `screenshots/10-cheesecake-search.png`.

Full category sweep (ingredient / format / carbon):

    cheesecake              cheese      dessert     2.2
    brownie                 chocolate   dessert     1.9
    ice cream               dairy       dessert     1.8
    apple pie               pastry      dessert     1.4
    chocolate chip cookie   chocolate   dessert     1.9
    coffee cake             pastry      dessert     1.4
    doughnut                pastry      dessert     1.4
    pancakes                pastry      breakfast   1.4
    oatmeal                 oat         breakfast   0.6
    ramen                   vegetable   soup        0.5
    tomato soup             vegetable   soup        0.5
    latte                   dairy       drink       1.8
    iced coffee             beverage    drink       0.3
    beef burger             beef        main        8.5
    pizza                   cheese      main        2.2
    crab cake               shrimp      main        5
    pot pie                 pastry      main        1.4
    peanut butter sandwich  nuts        main        0.6
    eggplant parmesan       vegetable   main        0.5
    egg salad               eggs        main        1.1

Tricky overrides all hold: crab cake/pot pie -> main (not dessert),
coffee cake -> dessert (not drink), eggplant -> vegetable (not eggs),
doughnut -> pastry (not nuts), peanut butter -> nuts (not dairy).

## If you want the ingredient label changed

Add an explicit rule BEFORE the `cheese` rule (line 64). Do not remove
"cheese" from the substring branch -- `cheeseburger` -> beef depends on
current ordering.

    { ingredient: "dairy", match: ["cheesecake"] },

---

# UPDATE: chip label change applied (2026-09-17, later)

Requested: keep the classification logic, change what the chip reads.
Chosen: ingredient label + a second format chip.

    Cheesecake  -> [USDA FoodData Central] [per 142g serving] [cream cheese] [dessert]
    Pizza       -> [USDA FoodData Central] [per 147g serving] [cheese]       [meal]
    Beef burger -> [USDA FoodData Central] [per 270g serving] [beef]         [meal]

## What changed (6 edits, display only)

1. `INGREDIENT_LABEL_RULES` + `ingredientLabelFor()` -- new display layer after
   `classifyIngredient`. Currently one rule: cheesecake -> "cream cheese".
2. `FORMAT_CHIP_LABELS` -- singular labels for the chip (FORMAT_LABELS stays
   plural for the "Lower-carbon desserts" heading).
3. `searchUSDANutrition` result carries `ingredientLabel`.
4. `estimateNutrition` result carries `ingredientLabel`.
5. `ResultsPage` copies `ingredientLabel` onto `original`. NOTE: this object is
   built by copying named fields, so any new field must be added here too --
   this was missed on the first pass and the chip silently fell back.
6. Chip row renders `ingredientLabel || ingredient` plus the format chip.

## Logic verified unchanged

`classifyIngredient` and `getCarbonScore` return identical values before and
after:

    cheesecake  cheese     2.2      ice cream  dairy      1.8
    pizza       cheese     2.2      apple pie  pastry     1.4
    beef burger beef       8.5      ramen      vegetable  0.5
    latte       dairy      1.8      pancakes   pastry     1.4

Full regression re-run after the change: alt-grid 3 columns, map pins all
inside bounds, checkout -> confirmation 7.7 kg, vegan filter clean, mobile
375px has ZERO horizontal overflow (the 4th chip wraps), 0 page errors.

Backup of the pre-change file: `verification/app.js.pre-chip-change.bak`
Re-run this check: `node verification/verify-chips.js`

## To add more label overrides

    const INGREDIENT_LABEL_RULES = [
      { label: "cream cheese", match: ["cheesecake"] }
    ];
