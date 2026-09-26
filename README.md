# Base warehouse planner

Constraint solver for Base home-battery yards in Texas. It chooses which yards open and which counties each yard covers. Road miles, local technicians and engineers, lot size, and separation are the constraints. Penetration is an output.

The result is a site list plus a binary part tree. An MES or an outside contractor can walk that tree: build the left child, then the right child, then the node. Lead time is not in the file. The downstream tool owns lead time by part id.

## Run it

Node 22+.

```bash
git clone git@github.com:yifan-guo/base-warehouse-planner.git
cd base-warehouse-planner
npm install
npm run dev
```

Open http://localhost:8080

Auth is off. No database is required for the map. The dev server uses port 8080.

```bash
npm run typecheck
npm run build
npm run preview
```

`npm run preview` serves the production build (port 8081 in this repo's preview script).

## Inputs

| Input | Where |
| --- | --- |
| Counties, homes, 2024 permits, corridors | `public/data/coverage.json` (built by `scripts/build-coverage.py`) |
| County shapes | `public/data/tx-counties.geojson` |
| Phase 1 or Phase 2 | Phase buttons. Phase 1 is Austin, Houston, San Antonio, and Dallas–Fort Worth. Phase 2 adds every county a truck corridor can reach. |
| Homes one technician can carry | Number field |
| Max road miles | Number field |
| Approvals | JSON array: `id`, `name`, `lat`, `lon`, `radius_miles`, `install_sites`, `min_kwh_usage`, `max_kwh_usage`, `start_date`. Example: `public/examples/approvals-baseline.json`. Counties outside every radius are not zoned, and demand inside a radius is capped at `install_sites`. |
| Sites | JSON array: `id`, `name`, `address`, `lat`, `lon`, `sq_ft`, `status` (`leased`, `candidate`, `outage`, `cancelled`), optional `outage_days`, `commission_date`, `lead_time_days`. Example: `public/examples/sites-baseline.json`. `lead_time_days` is recorded on the site file only. It is not copied onto part nodes. |
| Scenario | Baseline, yard outage (Jacintoport down 14 days), neighborhoods commissioned (2024 permits become homes), REP pullout (Abilene Loop cancelled, Taylor County not zoned). |

Press **Solve**. Edits do not run the solver until then. Dragging a warehouse does: it solves again and the other yards move to fit miles, staffing, and separation.

Each run is a row. The row keeps the inputs you can edit, links for that run's approvals file and sites file, and a **Results** button. Results are the yard list, county totals, and the part tree. History is stored in the browser.

## Outputs

A solved run reports:

- Yards that open, with address, road, technicians, engineers, and covered homes
- Per county: covered homes, total homes, not zoned, under construction
- Truck-route segments the open yards actually use
- `mission` in the results JSON. Each site has a binary tree. Every node has `partId`, `costCenter`, `costPerUnit`, and `quantity`. `costPerUnit` is a planning rate, not a quote. Parent cost is only that step, not the sum of the children.

County polygons are the site shape (metro, suburb, and rural are drawn differently). Warehouse marks are irregular footprints at the lot coordinate, exaggerated so the plan is visible. They are not rectangles.

## Data limits

- There is no public address file of Base batteries. Homes with Base are a statewide estimate placed in the four named Texas metros. Homes without Base are Census 2024 population ÷ 2.55 (1 dot = 6,000 homes).
- Under construction is 2024 units authorized (Census BPS).
- Truck lines are interstate and US corridors through Census places, not turn-by-turn traffic.
- Leased sites come from the lot file. Other pins are Census places, not signed leases.
- An outage is modeled as "this yard cannot take counties on this run," not as a day-by-day replay.

Rebuild county data after editing the raw inputs:

```bash
python3 scripts/build-coverage.py
```

## Stack

TanStack Start, React 19, Vite, Tailwind 4, Leaflet, Esri World Topo tiles (no API key).
