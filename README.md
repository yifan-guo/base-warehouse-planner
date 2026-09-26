# Base warehouse planner

Constraint solver for Base home-battery yards in Texas. It places warehouses on permitted lots and highway towns, assigns counties along truck corridors, and stops when local technicians and engineers run out.

This is a planning model on public data, not a roster of signed leases or a customer file of installed batteries.

## Run it

Node 22+.

```bash
git clone git@github.com:yifan-guo/base-warehouse-planner.git
cd base-warehouse-planner
npm install
npm run dev
```

Open http://localhost:8080

The dev server listens on port 8080. Auth is off (`VITE_AUTH_ENABLED=false` in `.grok/app-env.json`). No database is required for the map.

Typecheck and production build:

```bash
npm run typecheck
npm run build
npm run preview
```

`npm run preview` serves the production build. The preview script in this repo defaults to port 8081.

## What the solver does

Inputs (already loaded from `public/data/`):

| File | Role |
| --- | --- |
| `public/data/coverage.json` | 254 Texas counties (Census 2024 population ÷ 2.55 = homes), 2024 building-permit units, leased lots, interstate and US corridor polylines, sampled home dots |
| `public/data/tx-counties.geojson` | TIGER county polygons drawn on the map |
| `public/data/sites.json`, `lot-facts.json`, `places.json` | Sources used by `scripts/build-coverage.py` to rebuild `coverage.json` |

Operator inputs in the panel:

- Phase 1 (Austin, Houston, San Antonio, Dallas–Fort Worth only) or Phase 2 (any county a corridor can reach)
- Homes one technician can carry
- Max road miles from a yard to a county

Outputs on the map and in the panel:

- Which yards open, and which counties each one covers
- Covered homes, total homes, off-limits homes, homes under construction
- Truck-route segments actually used
- Technicians and engineers implied by population inside each territory (1 tech / 5,000 residents, 1 engineer / 40,000). This is not a Base headcount.

Drag a yard onto another county. The solver runs again and other yards move if the separation and staffing constraints say so.

Rebuild the county file after editing the raw inputs:

```bash
python3 scripts/build-coverage.py
```

## Data limits

- Address-level Base installs are not public. The map uses a statewide estimate allocated to the four named Texas metros and draws those marks large enough to see. Every other dot is homes without a Base battery (1 dot = 6,000 homes).
- Under construction is 2024 units authorized (Census BPS), not a live jobsite feed.
- Truck lines are corridor geometry through Census places, not live traffic or turn-by-turn routes.
- Leased pins come from the lot file. Other pins are Census places, not signed leases.

## Stack

TanStack Start, React 19, Vite, Tailwind 4, Leaflet, Esri World Topo tiles (no API key).
