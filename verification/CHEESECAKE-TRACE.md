# Ingredient classification: the cheesecake case

`node verification/trace-cheesecake.js` traces `classifyIngredient` rule by
rule in real Chrome with the cache disabled. Cheesecake is the worked example
because it exercises the substring-versus-word-boundary rule.

## Mechanism

`termMatches` in `app.js`:

    if (term.length > 4 || /[\s-]/.test(term)) return value.includes(term);
    return new RegExp(`\b${term}(s|es)?\b`).test(value);

Terms longer than four characters, or containing a space or hyphen, match as
substrings so compounds like "cheesecake" still match "cheese". Shorter terms
must land on a word boundary, because plain substring matching produces silent
nonsense ("chocolate" contains "cola", "doughnut" contains "nut").

`classifyIngredient("cheesecake")` misses every `PLANT_OVERRIDES` rule, then
lamb, beef, shrimp, fish, pork, turkey and chicken, and hits `cheese` on the
term `"cheese"` (6 characters → substring branch).

The `pastry` rule would not catch it. Its term is `"cake"` (4 characters →
word-boundary branch), and `\bcake\b` does not match inside "cheesecake".
Removing or reordering the `cheese` rule therefore does not hand cheesecake to
`pastry`; it falls through to the default `"vegetable"` (0.5 kg CO2e), which is
further from the truth than cheese. Do not remove `"cheese"` from the substring
branch either: `cheeseburger → beef` depends on the current ordering.

`classifyFormat("cheesecake")` is `dessert`, so its alternatives are desserts
under a "Lower-carbon desserts" heading.

## Expected classifications (ingredient / format / kg CO2e)

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

Overrides that must hold: crab cake and pot pie → main (not dessert), coffee
cake → dessert (not drink), eggplant → vegetable (not eggs), doughnut → pastry
(not nuts), peanut butter → nuts (not dairy).

## Display labels

Classification drives carbon and alternative matching and is not changed for
presentation. A separate display layer decides what the chip reads:

- `INGREDIENT_LABEL_RULES` + `ingredientLabelFor()` run after
  `classifyIngredient`. One rule at present: cheesecake → "cream cheese".
- `FORMAT_CHIP_LABELS` holds singular labels for the format chip;
  `FORMAT_LABELS` stays plural for headings.
- `searchUSDANutrition` and `estimateNutrition` both carry `ingredientLabel`,
  and `ResultsPage` copies it onto `original`. That object is built by copying
  named fields, so any new field must be added there too or the chip silently
  falls back to the raw ingredient.
- The chip row renders `ingredientLabel || ingredient` plus the format chip.

    Cheesecake  -> [USDA FoodData Central] [per 142g serving] [cream cheese] [dessert]
    Pizza       -> [USDA FoodData Central] [per 147g serving] [cheese]       [meal]
    Beef burger -> [USDA FoodData Central] [per 270g serving] [beef]         [meal]

To add a label override without touching classification:

    const INGREDIENT_LABEL_RULES = [
      { label: "cream cheese", match: ["cheesecake"] }
    ];

`node verification/verify-chips.js` checks the chips and that
`classifyIngredient` and `getCarbonScore` return the same values with the
display layer in place.
