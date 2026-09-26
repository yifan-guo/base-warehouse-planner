#!/usr/bin/env python3
"""Build public/data/coverage.json from Census county files and local places.

Population: Census PEP co-est2024 (county).
Under construction: Census BPS 2024 units authorized, by county.
Homes: population / 2.55. Texas persons-per-household, not a roof file.
Roads: interstate and US corridors through Census place coordinates.
"""
import csv, json, math, random
from pathlib import Path

ROOT = Path("/workspace")
POP = Path("/tmp/pop.csv")
BPS = Path("/tmp/bps.txt")
PEOPLE_PER_HOME = 2.55
BASE_TEXAS = 22000
PHASE1 = {
    "48453", "48491", "48209",  # Austin
    "48201", "48157", "48339", "48039",  # Houston
    "48029", "48091", "48187",  # San Antonio
    "48113", "48439", "48085", "48121",  # DFW
}

ROUTES = [
    ("I-10", ["El Paso", "Van Horn", "Fort Stockton", "Junction", "Kerrville", "Boerne", "San Antonio", "Seguin", "Houston", "Beaumont"]),
    ("I-20", ["Pecos", "Odessa", "Midland", "Big Spring", "Sweetwater", "Abilene", "Weatherford", "Fort Worth", "Dallas", "Terrell", "Tyler", "Longview", "Marshall"]),
    ("I-27", ["Amarillo", "Plainview", "Lubbock"]),
    ("I-30", ["Fort Worth", "Dallas", "Greenville", "Mount Pleasant", "Texarkana"]),
    ("I-35", ["Laredo", "San Antonio", "New Braunfels", "San Marcos", "Austin", "Georgetown", "Temple", "Waco", "Waxahachie", "Dallas", "Denton", "Gainesville"]),
    ("I-35W", ["Hillsboro", "Burleson", "Fort Worth", "Denton"]),
    ("I-37", ["San Antonio", "Corpus Christi"]),
    ("I-45", ["Galveston", "Houston", "Huntsville", "Corsicana", "Ennis", "Dallas"]),
    ("US 59 / I-69", ["Laredo", "Victoria", "Wharton", "Houston", "Lufkin", "Nacogdoches", "Texarkana"]),
    ("US 67", ["San Angelo", "Ballinger", "Coleman", "Stephenville", "Cleburne", "Dallas"]),
    ("US 77", ["Brownsville", "Kingsville", "Victoria", "Giddings", "Waco", "Dallas"]),
    ("US 83", ["Brownsville", "Harlingen", "Edinburg", "Laredo", "Uvalde", "Junction", "Ballinger", "Abilene", "Childress"]),
    ("US 87", ["San Angelo", "Big Spring", "Lamesa", "Lubbock", "Plainview", "Amarillo"]),
    ("US 90", ["Del Rio", "Uvalde", "San Antonio", "Seguin", "Houston"]),
    ("US 281", ["Edinburg", "Alice", "San Antonio", "Lampasas", "Stephenville", "Wichita Falls"]),
    ("US 287", ["Amarillo", "Childress", "Vernon", "Wichita Falls", "Decatur", "Fort Worth"]),
]


def ring_of(geom):
    if geom["type"] == "Polygon":
        rings = geom["coordinates"]
    else:
        rings = max(geom["coordinates"], key=lambda poly: sum(len(r) for r in poly))
        rings = rings
    return max(rings, key=len)


def centroid(ring):
    # average of vertices is good enough on these simplified counties
    lon = sum(p[0] for p in ring) / len(ring)
    lat = sum(p[1] for p in ring) / len(ring)
    return lat, lon


def pip(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-15) + xi):
            inside = not inside
        j = i
    return inside


def sample(ring, n, rng):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    pts = []
    guard = 0
    while len(pts) < n and guard < n * 60 + 40:
        guard += 1
        lon = rng.random() * (maxx - minx) + minx
        lat = rng.random() * (maxy - miny) + miny
        if pip(lon, lat, ring):
            pts.append([round(lat, 4), round(lon, 4)])
    if not pts:
        lat, lon = centroid(ring)
        pts.append([round(lat, 4), round(lon, 4)])
    return pts


def main():
    pop = {}
    with POP.open(encoding="latin1") as f:
        for row in csv.DictReader(f):
            if row["STATE"] == "48" and row["SUMLEV"] == "050":
                pop[row["STATE"] + row["COUNTY"]] = int(row["POPESTIMATE2024"])
    permits = {}
    for ln in BPS.read_text().splitlines():
        if not ln.startswith("2024,48,"):
            continue
        p = ln.split(",")
        units = int(p[7] or 0) + int(p[10] or 0) + int(p[13] or 0) + int(p[16] or 0)
        permits[p[1] + p[2]] = units

    geo = json.loads((ROOT / "public/data/tx-counties.geojson").read_text())
    places = json.loads((ROOT / "public/data/places.json").read_text())["cities"]
    by_name = {}
    for c in places:
        by_name.setdefault(c["name"].lower(), []).append(c)
    # A place listed in several counties keeps only the county it actually sits in.
    centroids = {}
    for feat in json.loads((ROOT / "public/data/tx-counties.geojson").read_text())["features"]:
        ring = ring_of(feat["geometry"])
        centroids[feat["properties"]["id"]] = centroid(ring)

    def dist2(a, b):
        return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

    named = {}
    for c in places:
        named.setdefault(c["name"].lower(), []).append(c)
    kept = []
    for group in named.values():
        if len(group) == 1:
            kept.append(group[0])
            continue
        best = min(group, key=lambda c: dist2((c["lat"], c["lon"]), centroids.get(c["fips"], (c["lat"], c["lon"]))))
        kept.append(best)
    towns = {}
    for c in kept:
        cur = towns.get(c["fips"])
        if cur is None or c["pop"] > cur["pop"]:
            towns[c["fips"]] = c

    counties = []
    rings = {}
    for feat in geo["features"]:
        fid = feat["properties"]["id"]
        ring = ring_of(feat["geometry"])
        rings[fid] = ring
        lat, lon = centroid(ring)
        people = pop[fid]
        homes = int(round(people / PEOPLE_PER_HOME))
        town = towns.get(fid)
        counties.append({
            "id": fid,
            "name": feat["properties"]["name"],
            "pop": people,
            "homes": homes,
            "permits": permits.get(fid, 0),
            "base": 0,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "phase1": fid in PHASE1,
            "town": None if not town else {
                "name": town["name"],
                "lat": round(town["lat"], 4),
                "lon": round(town["lon"], 4),
            },
        })
    p1 = [c for c in counties if c["phase1"]]
    share = sum(c["homes"] for c in p1)
    allocated = 0
    for c in p1:
        c["base"] = int(round(BASE_TEXAS * c["homes"] / share))
        allocated += c["base"]
    # push the rounding remainder onto the largest phase-1 county
    p1.sort(key=lambda c: -c["homes"])
    p1[0]["base"] += BASE_TEXAS - allocated

    sites = json.loads((ROOT / "public/data/sites.json").read_text())
    facts = json.loads((ROOT / "public/data/lot-facts.json").read_text())["lots"]
    name_to_id = {c["name"].lower(): c["id"] for c in counties}
    lots = []
    for s in sites:
        fact = facts.get(s["id"], {})
        lots.append({
            "id": s["id"],
            "name": s["name"],
            "address": s["address"],
            "lat": s["lat"],
            "lon": s["lon"],
            "county": s["county"],
            "countyId": name_to_id.get(s["county"].lower()),
            "sqft": fact.get("sq_ft", 0),
            "permitted": bool(s["permitted"]),
        })
    missing_lots = [l for l in lots if not l["countyId"]]
    if missing_lots:
        raise SystemExit(f"lot county unmatched: {missing_lots}")

    roads = []
    missing = []
    for name, stops in ROUTES:
        pts = []
        for stop in stops:
            hits = by_name.get(stop.lower())
            if not hits:
                missing.append(f"{name}: {stop}")
                continue
            hit = max(hits, key=lambda c: c["pop"])
            pts.append([round(hit["lat"], 4), round(hit["lon"], 4)])
        roads.append({"name": name, "points": pts})
    if missing:
        print("MISSING STOPS")
        for m in missing:
            print(" ", m)

    rng = random.Random(7)
    dots = []
    for c in counties:
        n = int(round(c["homes"] / 6000))
        dots.extend(sample(rings[c["id"]], n, rng))

    out = {
        "peoplePerHome": PEOPLE_PER_HOME,
        "baseTexasEstimate": BASE_TEXAS,
        "permitYear": 2024,
        "counties": counties,
        "lots": lots,
        "roads": roads,
        "dots": dots,
    }
    dest = ROOT / "public/data/coverage.json"
    dest.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"counties {len(counties)} homes {sum(c['homes'] for c in counties):,} "
        f"permits {sum(c['permits'] for c in counties):,} base {sum(c['base'] for c in counties)} "
        f"dots {len(dots)} bytes {dest.stat().st_size:,} roads {len(roads)}"
    )


if __name__ == "__main__":
    main()
