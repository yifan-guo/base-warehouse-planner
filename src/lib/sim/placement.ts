import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell } from "h3-js";

export const NAMEPLATE_KWH = 39.2;
export const RESERVE_FLOOR = 0.2;
export const INVERTER_KW = 11;
export const CREW_HOMES = 800;
export const DRIVE_MPH = 45;
export const WAVE1_MI = 30;
export const WAVE2_MI = 55;

/** Uber H3. Edge length is the center-to-corner distance. Res 4 was ~14 miles — too coarse. */
export type H3Res = 6 | 7 | 8;
export const H3_OPTIONS: { res: H3Res; miles: number; label: string }[] = [
  { res: 6, miles: 2, label: "2 mi" },
  { res: 7, miles: 0.8, label: "0.8 mi" },
  { res: 8, miles: 0.3, label: "0.3 mi" },
];

export type TargetCount = 4000 | 10000 | 25000;
export type SlaMiles = 45 | 75 | 120;
export type MesCap = 300 | 750 | 1200;
export type Regime = "choice" | "muni" | "coop" | "non_ercot" | "cbd";
export type PolicyId = "reserve_hold" | "headroom_prorata" | "peak_shave_node" | "tou_follow";
export type YardCap = 6 | 10 | 18;
export type Wave = "installed" | "wave1" | "wave2" | "wave3" | "gap" | "waiting" | "out";
export type Grade = "optimal" | "near" | "average" | "sub";

/**
 * Share of a city's sample dots treated as already having a Base battery.
 * Public record, not a customer file: Austin / Houston / San Antonio first,
 * Dallas–Fort Worth from 2025, plus announced utility programs
 * (CoServ, Guadalupe Valley, Bandera). Fleet was on the order of 25,000
 * systems by Sept 2026, Texas plus a new Illinois launch. This share is a
 * model of where that footprint sits.
 */
const INSTALLED_SHARE: Record<string, number> = {
  Austin: 0.16,
  Houston: 0.07,
  "San Antonio": 0.09,
  Dallas: 0.045,
  "Fort Worth": 0.04,
  Arlington: 0.03,
  Plano: 0.03,
  Irving: 0.025,
  Denton: 0.1,
  Lewisville: 0.05,
  "Flower Mound": 0.04,
  "New Braunfels": 0.11,
  Seguin: 0.14,
  Schertz: 0.08,
  Cibolo: 0.06,
  Bandera: 0.18,
};

const METRO = new Set([
  "Harris", "Fort Bend", "Montgomery", "Brazoria", "Galveston", "Waller", "Liberty", "Chambers",
  "Dallas", "Tarrant", "Collin", "Denton", "Rockwall", "Kaufman", "Ellis", "Johnson",
  "Travis", "Williamson", "Hays",
  "Bexar", "Guadalupe", "Comal", "Medina",
]);

const PARKS = [
  { name: "Big Bend", lat: 29.25, lon: -103.25, miles: 32 },
  { name: "Guadalupe Mountains", lat: 31.92, lon: -104.87, miles: 16 },
  { name: "Padre Island", lat: 27.0, lon: -97.38, miles: 18 },
];

export type City = {
  name: string;
  county: string;
  fips: string;
  lat: number;
  lon: number;
  pop: number;
  regime: Regime;
};

export type Site = {
  id: string;
  name: string;
  address: string;
  asked: string;
  county: string;
  regime: string;
  note: string;
  lat: number;
  lon: number;
  permitted: boolean;
  h3?: string;
  blocked?: string;
};

export type Pin = { id: string; lat: number; lon: number };

export type HexCell = {
  id: string;
  lat: number;
  lon: number;
  boundary: Array<[number, number]>;
  grade: Grade | null;
  zone: "open" | "ineligible";
  why: string | null;
  homes: number;
};

export type Dot = {
  id: string;
  lat: number;
  lon: number;
  city: string;
  county: string;
  regime: Regime;
  inPlan: boolean;
  homesBehind: number;
  installed: boolean;
  yardId: string | null;
  miles: number | null;
  wave: Wave;
};

export type PlaceInput = {
  target: TargetCount;
  sla: SlaMiles;
  mes: MesCap;
  unlockMuni: boolean;
  unlockCoop: boolean;
  lookAhead: boolean;
  yardCap: YardCap;
};

export type CityCount = { name: string; count: number };

export type ChosenSite = Site & {
  installs: number;
  remaining: number;
  installed: number;
  later: number;
  fresh: number;
  cities: CityCount[];
  counties: CityCount[];
  medianMiles: number;
  maxMiles: number;
  medianMinutes: number;
  waves: { wave1: number; wave2: number; wave3: number };
  monthsTo25: number;
  monthsTo100: number;
  grade: Grade;
  why: string[];
  moved: boolean;
  originLat: number;
  originLon: number;
  crew: "short" | "ok";
  crewNote: string;
};

export type Spoke = {
  siteId: string;
  from: [number, number];
  to: [number, number];
  installs: number;
};

export type Milestone = { pct: number; homes: number; months: number };

export type Placement = {
  dots: Dot[];
  chosen: ChosenSite[];
  dropped: string[];
  added: string[];
  headline: string;
  summary: string;
  inPlan: number;
  reached: number;
  uncovered: number;
  waiting: number;
  outside: number;
  installedDots: number;
  remaining: number;
  outsideMetroReached: number;
  milestones: Milestone[];
  areas: CityCount[];
  spokes: Spoke[];
};

export const POLICIES: Record<PolicyId, { name: string; short: string; body: string }> = {
  reserve_hold: {
    name: "Reserve hold",
    short: "Hold the 20% reserve. Do not use the transformer.",
    body: "Each pack stays at least 20% full and does nothing else. No cheap-hour fill, no peak help. Use it when the cell is already tight. Packs do not charge each other.",
  },
  headroom_prorata: {
    name: "Headroom pro-rata",
    short: "Share whatever pipe the neighbors are not using.",
    body: "Spare transformer capacity is split across the Base packs in this cell. Each pack is still capped at 11 kW. Nothing goes below 20%. Packs do not feed each other — each one only talks to this transformer.",
  },
  peak_shave_node: {
    name: "Peak shave",
    short: "Charge the quiet hours. Cover the house on the peak.",
    body: "At 2am the packs fill from spare pipe. At 5pm they cover the house from the battery. They do not push power back onto the transformer. The 20% floor and the 11 kW inverter still apply. Packs do not share energy with each other.",
  },
  tou_follow: {
    name: "TOU follow",
    short: "Charge the cheap hours. Send power back on the dear hours.",
    body: "2am charges from spare pipe. 5pm tries to push power back into the transformer, and stops when the pipe is full or the 11 kW inverter is maxed. The 20% reserve stays in the pack. Packs still do not feed each other.",
  },
};

export const GRADE_LABEL: Record<Grade, string> = {
  optimal: "Optimal",
  near: "Near optimal",
  average: "Average",
  sub: "Sub-prime",
};

export const WAVE_LABEL: Record<Wave, string> = {
  installed: "Already has a battery",
  wave1: "Wave 1 — closest, first kits",
  wave2: "Wave 2 — next band",
  wave3: "Wave 3 — out to the truck limit",
  gap: "No warehouse reaches it",
  waiting: "Waiting on an agreement",
  out: "Outside ERCOT",
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roadMiles(aLat: number, aLon: number, bLat: number, bLon: number) {
  return haversineMiles(aLat, aLon, bLat, bLon) * 1.35;
}

export function driveMinutes(miles: number) {
  return Math.round((miles / DRIVE_MPH) * 60);
}

export function demandOn(regime: Regime, input: PlaceInput) {
  if (regime === "choice") return true;
  if (regime === "muni") return input.unlockMuni;
  if (regime === "coop") return input.unlockCoop;
  return false;
}

export function siteUsable(site: Site, input: PlaceInput) {
  if (!site.permitted) return false;
  if (site.regime === "cbd" || site.regime === "non_ercot") return false;
  if (site.regime === "muni") return input.unlockMuni;
  if (site.regime === "coop") return input.unlockCoop;
  return site.regime === "choice";
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function topCounts(rows: Dot[], key: "city" | "county", n: number): CityCount[] {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row[key], (map.get(row[key]) ?? 0) + 1);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function inDemand(dot: Dot, input: PlaceInput) {
  if (dot.installed) return true;
  if (dot.inPlan) return true;
  return input.lookAhead && (dot.regime === "muni" || dot.regime === "coop");
}

function waveFor(dot: Dot, miles: number | null, sla: number): Wave {
  if (dot.installed) return "installed";
  if (dot.regime === "non_ercot" || dot.regime === "cbd") return "out";
  if (!dot.inPlan) return "waiting";
  if (miles == null || miles > sla) return "gap";
  if (miles <= WAVE1_MI) return "wave1";
  if (miles <= WAVE2_MI) return "wave2";
  return "wave3";
}

export function buildDots(cities: City[], input: PlaceInput): Dot[] {
  const rng = mulberry32(42 + input.target);
  const weight = cities.reduce((s, c) => s + c.pop, 0);
  const counts = cities.map((c) => Math.floor((input.target * c.pop) / weight));
  let used = counts.reduce((s, n) => s + n, 0);
  const order = cities
    .map((c, i) => ({ i, frac: ((input.target * c.pop) / weight) % 1 }))
    .sort((a, b) => b.frac - a.frac);
  for (const row of order) {
    if (used >= input.target) break;
    counts[row.i] += 1;
    used += 1;
  }
  const dots: Dot[] = [];
  cities.forEach((city, idx) => {
    const n = counts[idx] ?? 0;
    if (n <= 0) return;
    const lobes = 2 + (idx % 3);
    const sigma = 0.012 + Math.min(0.07, Math.sqrt(city.pop) / 7000);
    const homesEach = Math.max(1, Math.round(city.pop / 2.55 / n));
    const inPlan = demandOn(city.regime, input);
    const share = INSTALLED_SHARE[city.name] ?? 0;
    const cosLat = Math.cos((city.lat * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
      const lobe = i % lobes;
      const axis = (idx * 0.55 + lobe * 2.1) % Math.PI;
      const ribbon = i % 11 === 0;
      const along = gauss(rng) * sigma * (ribbon ? 3.1 : 0.85);
      const across = gauss(rng) * sigma * (ribbon ? 0.16 : 0.4);
      const off = sigma * (0.55 + lobe * 0.28);
      const lat = city.lat + Math.cos(axis) * off + along * Math.cos(axis) + across * Math.sin(axis);
      const lon = city.lon + (Math.sin(axis) * off + along * Math.sin(axis) + across * Math.cos(axis)) / cosLat;
      dots.push({
        id: `${city.fips}-${idx}-${i}`,
        lat,
        lon,
        city: city.name,
        county: city.county,
        regime: city.regime,
        inPlan,
        homesBehind: homesEach,
        installed: share > 0 && rng() < share,
        yardId: null,
        miles: null,
        wave: "gap",
      });
    }
  });
  return dots;
}

function indexReach(sites: Site[], dots: Dot[], sla: number) {
  return sites.map((site) => {
    const hit: number[] = [];
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i]!;
      if (roadMiles(site.lat, site.lon, d.lat, d.lon) <= sla) hit.push(i);
    }
    return hit;
  });
}

function greedy(
  sites: Site[],
  reach: number[][],
  dots: Dot[],
  input: PlaceInput,
  forceIds: string[],
) {
  const taken = new Uint8Array(dots.length);
  const used = new Set<string>();
  const picks: Array<{ site: Site; fresh: number }> = [];
  const accept = (d: Dot) => inDemand(d, input);

  function take(i: number) {
    const members: number[] = [];
    for (const di of reach[i]!) {
      if (taken[di] || !accept(dots[di]!)) continue;
      members.push(di);
    }
    for (const di of members) taken[di] = 1;
    used.add(sites[i]!.id);
    picks.push({ site: sites[i]!, fresh: members.length });
  }

  for (const id of forceIds) {
    if (picks.length >= input.yardCap) break;
    const i = sites.findIndex((s) => s.id === id);
    if (i < 0 || used.has(id)) continue;
    take(i);
  }

  while (picks.length < input.yardCap) {
    let bestI = -1;
    let bestN = 0;
    let bestMembers: number[] = [];
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i]!;
      if (used.has(site.id)) continue;
      const members: number[] = [];
      for (const di of reach[i]!) {
        if (taken[di] || !accept(dots[di]!)) continue;
        members.push(di);
      }
      if (members.length > bestN) {
        bestN = members.length;
        bestI = i;
        bestMembers = members;
      }
    }
    if (bestI < 0 || bestN < 25) break;
    used.add(sites[bestI]!.id);
    for (const di of bestMembers) taken[di] = 1;
    picks.push({ site: sites[bestI]!, fresh: bestN });
  }
  return picks;
}

function assignYards(dots: Dot[], chosen: Site[], reach: number[][], sites: Site[], sla: number) {
  const byId = new Map(sites.map((s, i) => [s.id, reach[i]!]));
  const yardId = new Array<string | null>(dots.length).fill(null);
  const best = new Array<number>(dots.length).fill(Infinity);
  for (const site of chosen) {
    const hit = byId.get(site.id);
    if (!hit) continue;
    for (const di of hit) {
      const d = dots[di]!;
      if (d.regime === "non_ercot" || d.regime === "cbd") continue;
      const dist = roadMiles(site.lat, site.lon, d.lat, d.lon);
      if (dist > sla) continue;
      if (dist < best[di]!) {
        best[di] = dist;
        yardId[di] = site.id;
      }
    }
  }
  return { yardId, best };
}

function applyPins(sites: Site[], pins: Pin[]) {
  if (!pins.length) return sites;
  const byId = new Map(pins.map((p) => [p.id, p]));
  return sites.map((s) => {
    const pin = byId.get(s.id);
    return pin ? { ...s, lat: pin.lat, lon: pin.lon } : s;
  });
}

function gradeSite(installs: number, medianMiles: number, moved: number, fresh: number): Grade {
  if (moved && fresh < 30) return "sub";
  if (medianMiles <= 38 && installs >= 180) return "optimal";
  if (medianMiles <= 55 && installs >= 70) return "near";
  if (installs >= 35) return "average";
  return "sub";
}

function milestonesFor(remaining: number, mes: number): Milestone[] {
  return [10, 25, 50, 100].map((pct) => {
    const homes = Math.ceil((remaining * pct) / 100);
    return { pct, homes, months: Math.max(1, Math.ceil(homes / mes)) };
  });
}

export function placeWarehouses(dots: Dot[], sites: Site[], input: PlaceInput, pins: Pin[] = []): Placement {
  const origin = new Map(sites.map((s) => [s.id, s]));
  const placedSites = applyPins(sites, pins);
  const usable = placedSites.filter((s) => siteUsable(s, input));
  const pinIds = pins.map((p) => p.id).filter((id) => usable.some((s) => s.id === id));
  const reach = indexReach(usable, dots, input.sla);
  const picks = greedy(usable, reach, dots, input, pinIds);

  const bareUsable = sites.filter((s) => siteUsable(s, input));
  const bareReach = indexReach(bareUsable, dots, input.sla);
  const bareNames = greedy(bareUsable, bareReach, dots, input, []).map((p) => p.site.name);
  const names = picks.map((p) => p.site.name);
  const dropped = bareNames.filter((n) => !names.includes(n));
  const added = names.filter((n) => !bareNames.includes(n));

  const assigned = assignYards(dots, picks.map((p) => p.site), reach, usable, input.sla);
  const withWave: Dot[] = dots.map((d, i) => {
    const yardId = assigned.yardId[i] ?? null;
    const miles = yardId ? assigned.best[i]! : null;
    return { ...d, yardId, miles, wave: waveFor(d, miles, input.sla) };
  });

  const chosen: ChosenSite[] = picks.map((p) => {
    const mine = withWave.filter((d) => d.yardId === p.site.id);
    const sellable = mine.filter((d) => d.inPlan || d.installed);
    const installs = sellable.length;
    const installed = mine.filter((d) => d.installed).length;
    const remaining = mine.filter((d) => !d.installed && d.inPlan).length;
    const later = mine.filter((d) => d.wave === "waiting").length;
    const miles = mine.map((d) => d.miles).filter((m): m is number => m != null);
    const med = median(miles);
    const maxMiles = miles.length ? Math.max(...miles) : 0;
    const waves = {
      wave1: mine.filter((d) => d.wave === "wave1").length,
      wave2: mine.filter((d) => d.wave === "wave2").length,
      wave3: mine.filter((d) => d.wave === "wave3").length,
    };
    const cities = topCounts(mine, "city", 5);
    const counties = topCounts(mine, "county", 4);
    const o = origin.get(p.site.id) ?? p.site;
    const movedMiles = roadMiles(o.lat, o.lon, p.site.lat, p.site.lon);
    const moved = movedMiles > 0.4;
    const grade = gradeSite(installs, med, moved ? movedMiles : 0, p.fresh);
    const crewShort = installs > CREW_HOMES;
    const monthsTo25 = Math.max(1, Math.ceil((remaining * 0.25) / input.mes));
    const monthsTo100 = Math.max(1, Math.ceil(remaining / input.mes));
    const townList = cities.map((c) => `${c.name} (${c.count.toLocaleString()})`).join(", ") || "no clustered towns";
    const why = [
      `${moved ? "Hand-placed" : "Surveyed address"} ${p.site.lat.toFixed(5)}, ${p.site.lon.toFixed(5)}. ${moved ? `Dragged ${movedMiles.toFixed(0)} miles off ${o.address}.` : p.site.address + "."}`,
      moved
        ? "You moved this pin. The other sites were solved again around the new point. It is no longer sitting on the Census address."
        : `Census-matched ${p.site.county} County address. Zoning in this model allows a warehouse here (${p.site.note}).`,
      `Ranked by homes inside ${input.sla} road miles that a higher site does not already cover. This one still adds ${p.fresh.toLocaleString()} of those. Total in its drive radius: ${installs.toLocaleString()}.`,
      `Towns it actually serves: ${townList}.`,
      `Typical drive ${med.toFixed(0)} miles (${driveMinutes(med)} min at ${DRIVE_MPH} mph). Farthest home in range: ${maxMiles.toFixed(0)} miles (${driveMinutes(maxMiles)} min).`,
      `${remaining.toLocaleString()} of those homes do not have a battery yet (${installed.toLocaleString()} in this picture already do). The penetration table is the shared factory clock. If every kit went only to this site, 25% would take ${monthsTo25} ${monthsTo25 === 1 ? "month" : "months"} and the rest ${monthsTo100} ${monthsTo100 === 1 ? "month" : "months"} at ${input.mes} kits/month.`,
      crewShort
        ? `Crew flag: short. ${installs.toLocaleString()} homes on one yard, above ${CREW_HOMES}. This does not hire anyone.`
        : `Crew flag: covered. ${installs.toLocaleString()} homes, within ${CREW_HOMES} for one crew. This does not hire anyone.`,
    ];
    return {
      ...p.site,
      installs,
      remaining,
      installed,
      later,
      fresh: p.fresh,
      cities,
      counties,
      medianMiles: med,
      maxMiles,
      medianMinutes: driveMinutes(med),
      waves,
      monthsTo25,
      monthsTo100,
      grade,
      why,
      moved,
      originLat: o.lat,
      originLon: o.lon,
      crew: crewShort ? "short" : "ok",
      crewNote: why[6] ?? "",
    };
  });

  const spokes: Spoke[] = [];
  const buckets = new Map<string, { lat: number; lon: number; n: number; siteId: string; slat: number; slon: number }>();
  const siteById = new Map(chosen.map((s) => [s.id, s]));
  for (const d of withWave) {
    if (!d.yardId || d.wave === "out") continue;
    const site = siteById.get(d.yardId);
    if (!site) continue;
    const key = `${d.yardId}|${d.city}`;
    const row = buckets.get(key);
    if (row) {
      row.lat += d.lat;
      row.lon += d.lon;
      row.n += 1;
    } else buckets.set(key, { lat: d.lat, lon: d.lon, n: 1, siteId: d.yardId, slat: site.lat, slon: site.lon });
  }
  const bySite = new Map<string, Array<{ n: number; spoke: Spoke }>>();
  for (const row of buckets.values()) {
    const list = bySite.get(row.siteId) ?? [];
    list.push({
      n: row.n,
      spoke: {
        siteId: row.siteId,
        from: [row.slat, row.slon],
        to: [row.lat / row.n, row.lon / row.n],
        installs: row.n,
      },
    });
    bySite.set(row.siteId, list);
  }
  for (const list of bySite.values()) {
    list.sort((a, b) => b.n - a.n);
    for (const row of list.slice(0, 6)) spokes.push(row.spoke);
  }

  let inPlan = 0;
  let reached = 0;
  let waiting = 0;
  let outside = 0;
  let installedDots = 0;
  let remaining = 0;
  let outsideMetroReached = 0;
  for (const d of withWave) {
    if (d.installed) installedDots += 1;
    if (d.regime === "non_ercot") outside += 1;
    if (d.wave === "waiting") waiting += 1;
    if (!d.inPlan) continue;
    inPlan += 1;
    if (d.yardId) {
      reached += 1;
      if (!METRO.has(d.county)) outsideMetroReached += 1;
      if (!d.installed) remaining += 1;
    }
  }
  const uncovered = inPlan - reached;
  const milestones = milestonesFor(remaining, input.mes);
  const areas = topCounts(withWave.filter((d) => d.yardId && (d.inPlan || d.installed)), "county", 8);
  const m25 = milestones.find((m) => m.pct === 25)!;
  const m100 = milestones.find((m) => m.pct === 100)!;
  const headline = `${chosen.length} potential sites reach ${reached.toLocaleString()} of ${inPlan.toLocaleString()} sellable homes. ${remaining.toLocaleString()} of those still need a battery. At ${input.mes} kits/month that is ${m25.months} months to 25% and ${m100.months} months to all of them.`;
  const drag = pins.length
    ? dropped.length || added.length
      ? `A pin was dragged. Dropped ${dropped.join(", ") || "nothing"}. Added ${added.join(", ") || "nothing"}.`
      : "A pin was dragged. The other sites on the shortlist did not change."
    : "Drag any copper square. The other sites are solved again around where you drop it.";
  const summary = `Each site is a real street address with coordinates, unless you have dragged it. Shortlist order is greedy: the next site is the permitted address that still covers the most homes inside ${input.sla} road miles. ${outsideMetroReached.toLocaleString()} of the reached homes are outside Houston, Dallas–Fort Worth, Austin, and San Antonio — that is why a place like Abilene can beat another Houston building. ${drag}`;

  return {
    dots: withWave,
    chosen,
    dropped,
    added,
    headline,
    summary,
    inPlan,
    reached,
    uncovered,
    waiting,
    outside,
    installedDots,
    remaining,
    outsideMetroReached,
    milestones,
    areas,
    spokes,
  };
}

export function buildCells(dots: Dot[], chosen: Array<{ lat: number; lon: number }>, res: H3Res, sla: number) {
  const weight = new Map<string, number>();
  for (const d of dots) {
    if (d.wave === "out") continue;
    const id = latLngToCell(d.lat, d.lon, res);
    weight.set(id, (weight.get(id) ?? 0) + 1);
  }
  const keep = new Set<string>();
  for (const s of chosen) {
    for (const id of gridDisk(latLngToCell(s.lat, s.lon, res), 1)) {
      if (!weight.has(id)) weight.set(id, 0);
      keep.add(id);
    }
  }
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]);
  for (const [id] of ranked) {
    if (keep.size >= 1400) break;
    keep.add(id);
  }
  const cells: HexCell[] = [];
  for (const id of keep) {
    const [lat, lon] = cellToLatLng(id);
    let nearest = Infinity;
    for (const s of chosen) nearest = Math.min(nearest, roadMiles(lat, lon, s.lat, s.lon));
    let grade: Grade | null = null;
    if (chosen.length && Number.isFinite(nearest)) {
      if (nearest <= 20) grade = "optimal";
      else if (nearest <= 40) grade = "near";
      else if (nearest <= sla) grade = "average";
      else grade = "sub";
    }
    let zone: HexCell["zone"] = "open";
    let why: string | null = null;
    for (const park of PARKS) {
      if (haversineMiles(lat, lon, park.lat, park.lon) <= park.miles) {
        zone = "ineligible";
        why = park.name;
        grade = null;
        break;
      }
    }
    const boundary = cellToBoundary(id) as Array<[number, number]>;
    cells.push({ id, lat, lon, boundary, grade, zone, why, homes: weight.get(id) ?? 0 });
  }
  return { cells, total: weight.size, capped: weight.size > cells.length };
}

export function dotsInCell(dots: Dot[], id: string, res: H3Res) {
  return dots.filter((d) => latLngToCell(d.lat, d.lon, res) === id);
}

const SUMMER = [0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.8, 0.8, 0.8, 0.8, 1.05, 1.05, 1.05, 1.05, 1.35, 1.35, 1.72, 1.72, 1.72, 1.72, 1.72, 1.02, 1.02, 1.02];

export function hexSnapshot(dots: Dot[], hour: number, policy: PolicyId) {
  const planned = dots.filter((d) => d.inPlan && !d.installed);
  const n = planned.length;
  const nonBaseHomes = dots.reduce((s, d) => s + d.homesBehind, 0);
  const shape = SUMMER[Math.min(23, Math.max(0, hour))] ?? 1;
  const mean = SUMMER.reduce((s, v) => s + v, 0) / SUMMER.length;
  const factor = shape / mean;
  const nonBaseKw = nonBaseHomes * 1.5 * factor;
  const rating = nonBaseHomes * 1.5 * 1.28 + 40;
  const headroom = Math.max(0, rating - nonBaseKw);
  const pipe = Math.min(n * INVERTER_KW, headroom);
  const reserveKwh = n * NAMEPLATE_KWH * RESERVE_FLOOR;
  let chargeKw = 0;
  let exportKw = 0;
  let houseKw = 0;
  if (policy === "headroom_prorata") chargeKw = pipe;
  else if (policy === "peak_shave_node") {
    if (hour < 12) chargeKw = pipe;
    else houseKw = Math.min(n * INVERTER_KW, n * 1.5 * factor);
  } else if (policy === "tou_follow") {
    if (hour < 12) chargeKw = pipe;
    else exportKw = pipe;
  }
  const installed = dots.filter((d) => d.installed).length;
  return { planned: n, installed, nonBaseHomes, nonBaseKw, headroom, chargeKw, exportKw, houseKw, reserveKwh, hour, policy };
}
