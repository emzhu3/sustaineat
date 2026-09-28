# SustainEat

SustainEat shows the carbon footprint of food choices in real time, compares nutrition information side by side, and rewards lower-impact choices with points. When a food is already low-carbon, the app surfaces real nearby restaurants where it can be ordered or picked up.

Built for HackMIT.

## Features

- **Carbon footprint per food choice.** Every food searched returns an estimated kg CO2e figure alongside an impact rating (e.g. Low / Moderate / High Impact).
- **Nutrition comparison.** Calories, protein, carbs, and fat are pulled from the USDA FoodData Central API and displayed together for easy comparison.
- **Points for lower-impact choices.** Users earn points for choosing lower-carbon foods, tracked and displayed in the app.
- **Real pickup and ordering locations.** For low-carbon foods, the app uses the Google Places API to surface nearby restaurants that may serve that dish, with distance, rating, and price level.
- **Map-based discovery.** Restaurant results update as the map is panned, re-querying based on the visible area.

## Tech stack

- **Backend:** Node.js / Express
- **Nutrition data:** [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide.html)
- **Restaurant/location data:** Google Places API
- **Deployment:** Vercel (frontend), with the backend server running under Node

## Project structure

```
Food App/
├── server/           # Express backend
│   ├── server.js     # Main server entry point
│   └── package.json
└── ...                # Frontend
```

## Running locally

1. Clone the repository and install dependencies:
   ```
   cd server
   npm install
   ```
2. Create a `.env` file in `server/` with the required API keys:
   ```
   USDA_API_KEY=your_usda_api_key
   GOOGLE_PLACES_API_KEY=your_google_places_api_key
   ```
3. Start the server:
   ```
   npm start
   ```
4. The backend runs on `http://localhost:5000` by default.

## Data sources and estimates

Carbon footprint figures are category-level estimates based on a food's main ingredient, not a full recipe breakdown. Nutrition figures come directly from USDA FoodData Central for the closest matching food entry. Restaurant "may serve" suggestions are inferred matches based on cuisine and menu likelihood, not a confirmed live menu, unless otherwise noted.

## Team

Built by [team members] for HackMIT.
