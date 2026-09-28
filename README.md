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
| Scenario | Baseline, yard outage (Jacintoport cannot ship for 90 days — the building stays, other yards absorb demand), neighborhoods commissioned (2024 permits become homes), REP pullout (Abilene Loop cancelled, Taylor County not zoned). |

Press **Solve**. Edits do not run the solver until then. Dragging a warehouse does: it solves again and the other yards move to fit miles, staffing, and separation.

Each run is a row. Solve from a historic run, or drag a yard while that run is active, and the new run stores `parentId`. The RUNS list draws a colored branch from parent to child even when they are not next to each other in time. **Download history** writes every run plus those edges.

The approvals and sites boxes accept JSON with `//` comments. Cmd+/ comments or uncomments the line. Comment out a site, or set `"status": "outage"`, to take it off the candidate list.

`forced: false` on a yard means the solver opened it. `forced: true` means a drag pinned it.

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
- An outage is modeled as "this yard cannot take counties on this run." The building is not relocated. Ninety days is a planning window, not a construction schedule.
- Technician and engineer counts are not a labor-market file. They are ratios: 1 technician per 5,000 residents in the territory, 1 engineer per 40,000. That is a planning cap, not BLS data.
- Site addresses are industrial lots collected for this repo (Alliance, Jacintoport, Regal Row, and the rest in `public/data/sites.json`). They are not Base's lease book.

Rebuild county data after editing the raw inputs:

```bash
python3 scripts/build-coverage.py
```

## Stack

TanStack Start, React 19, Vite, Tailwind 4, Leaflet, Esri World Topo tiles (no API key).

# Recording
https://www.loom.com/share/c363d811179e416ab06ba233c62f605c


# Definitions
Highway corridor - a designed strip of land that includes the roads / acreage around the land that is influenced by traffic flows and regional development. Planners use highway corridors to accomomodate future population growth. Treat as an interconnected system rather than isolated intersection.
BPS - In the Census Bureau, the annual BPS stands for Building Permits Survey - it measures the number of newly developed privately-owned housing units authorized by building permits.
MRP - Material Resource Planning - computers predict the timing and quantity of materials used to complete a production process (e.g build a warehouse).


# Challenges Solved
What kinds of flexibility would an end user like to see? 
- User research; study on self. Hate seeing dragged sites get reset by the solver. Build a glowing border and a forced flag to pin inputs.
What information can the solver output to act on?
- BOM tree for building a rocket, back calculate timing and quantity of components informed a BOM tree for warehouses
- drew on past interview experience at SpaceX; just focus on warehouses for now. MES is another data type that can be added later.
- remember SoW from somewhere 
What algorithm should the solver use?
- Greedy, rule-based. Why not an optimization one like A*?