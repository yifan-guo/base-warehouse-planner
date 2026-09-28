export type Phase = 1 | 2;

export type County = {
  id: string;
  name: string;
  pop: number;
  homes: number;
  permits: number;
  base: number;
  lat: number;
  lon: number;
  phase1: boolean;
  town: { name: string; lat: number; lon: number } | null;
  /** Null means the solver uses every finished home. A number caps demand at that many installs. */
  campaign?: number | null;
  /** False when an approval file or a cancelled REP leaves the county out of the run. */
  zoned?: boolean;
};

export type Lot = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  county: string;
  countyId: string | null;
  sqft: number;
  permitted: boolean;
};

export type Road = { name: string; points: [number, number][] };

export type CoverageData = {
  peoplePerHome: number;
  baseTexasEstimate: number;
  permitYear: number;
  counties: County[];
  lots: Lot[];
  roads: Road[];
  dots: [number, number][];
};

export type Spec = {
  phase: Phase;
  maxMiles: number;
  spur: number;
  homesPerTech: number;
  residentsPerTech: number;
  residentsPerEngineer: number;
  minHomes: number;
  separation: number;
  minSqft: number;
  /** When a yard is down, only open a replacement that can reach this point. */
  preferNear?: { lat: number; lon: number } | null;
};

export type Drag = {
  toCountyId: string;
  lat: number;
  lon: number;
  moveYardId: string | null;
  lotId: string | null;
  steal: boolean;
};

export type Yard = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  countyId: string;
  kind: "leased" | "town" | "dropped";
  sqft: number | null;
  techs: number;
  engineers: number;
  homes: number;
  cap: number;
  counties: number;
  road: string;
  note: string;
  forced: boolean;
};

export type Cell = {
  id: string;
  name: string;
  covered: number;
  total: number;
  offLimits: number;
  underConstruction: number;
  gap: number;
  yardId: string | null;
  miles: number | null;
  techs: number;
  engineers: number;
  base: number;
  why: string;
};

export type Plan = {
  yards: Yard[];
  cells: Cell[];
  byId: Record<string, Cell>;
  used: [number, number][][];
  spurs: [number, number][][];
  totals: {
    covered: number;
    total: number;
    offLimits: number;
    underConstruction: number;
    gap: number;
    techs: number;
    engineers: number;
    yards: number;
  };
  headline: string;
};

type Cand = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  countyId: string;
  kind: "leased" | "town" | "dropped";
  sqft: number | null;
  node: number;
  approach: number;
};

type Graph = {
  nodes: { lat: number; lon: number; road: string }[];
  adj: [number, number][][];
};

export const DEFAULT_SPEC: Spec = {
  phase: 2,
  maxMiles: 80,
  spur: 40,
  homesPerTech: 120000,
  residentsPerTech: 5000,
  residentsPerEngineer: 40000,
  minHomes: 8000,
  separation: 70,
  minSqft: 40000,
  preferNear: null,
};

export function miles(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Finished homes the yard is allowed to cover. Permits stay out until a scenario commissions them. */
export function demandOf(county: County) {
  if (county.zoned === false) return 0;
  const finished = Math.max(0, county.homes - county.permits);
  if (county.campaign == null) return finished;
  return Math.min(finished, Math.max(0, county.campaign));
}

export type Tier = "metro" | "suburb" | "rural";

export function tierOf(county: County, metros: County[]): Tier {
  if (county.phase1) return "metro";
  let near = Infinity;
  for (const metro of metros) near = Math.min(near, miles(county.lat, county.lon, metro.lat, metro.lon));
  return near < 42 ? "suburb" : "rural";
}

/** Irregular yard footprint in lat/lon. Size is exaggerated so the plan reads on a county zoom. Not a rectangle. */
export function warehouseRing(lat: number, lon: number, id: string, sqft: number | null): [number, number][] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const rot = (((h >>> 0) % 360) * Math.PI) / 180;
  const stretch = 0.82 + ((h >>> 8) % 50) / 100;
  const span = 0.11 + Math.min(0.05, Math.sqrt(Math.max(sqft ?? 80000, 20000)) / 9000);
  const local: [number, number][] = [
    [0.02, 0.04],
    [1.2 * stretch, 0.0],
    [1.14 * stretch, 0.28],
    [0.86 * stretch, 0.22],
    [0.9 * stretch, 0.46],
    [1.18 * stretch, 0.5],
    [1.1 * stretch, 0.74],
    [0.62 * stretch, 0.68],
    [0.5 * stretch, 1.08],
    [0.22, 0.98],
    [0.28, 0.62],
    [0.0, 0.7],
  ];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const mlat = span;
  const mlon = span / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  return local.map(([x, y]) => {
    const xr = x * cos - y * sin;
    const yr = x * sin + y * cos;
    return [lat + yr * mlat, lon + xr * mlon] as [number, number];
  });
}

function buildGraph(roads: Road[]): Graph {
  const nodes: Graph["nodes"] = [];
  const raw: [number, number, number][] = [];
  for (const road of roads) {
    let prev = -1;
    for (const [lat, lon] of road.points) {
      if (prev < 0) {
        prev = nodes.length;
        nodes.push({ lat, lon, road: road.name });
        continue;
      }
      const from = nodes[prev]!;
      const d = miles(from.lat, from.lon, lat, lon);
      const steps = Math.max(1, Math.round(d / 12));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const nlat = from.lat + (lat - from.lat) * t;
        const nlon = from.lon + (lon - from.lon) * t;
        const id = nodes.length;
        nodes.push({ lat: nlat, lon: nlon, road: road.name });
        raw.push([prev, id, miles(nodes[prev]!.lat, nodes[prev]!.lon, nlat, nlon)]);
        prev = id;
      }
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i]!.road === nodes[j]!.road) continue;
      const d = miles(nodes[i]!.lat, nodes[i]!.lon, nodes[j]!.lat, nodes[j]!.lon);
      if (d <= 8) raw.push([i, j, d]);
    }
  }
  const adj: [number, number][][] = nodes.map(() => []);
  for (const [a, b, w] of raw) {
    adj[a]!.push([b, w]);
    adj[b]!.push([a, w]);
  }
  return { nodes, adj };
}

function nearestNode(graph: Graph, lat: number, lon: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i]!;
    const d = miles(lat, lon, n.lat, n.lon);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distance: bestD };
}

function dijkstra(adj: [number, number][][], start: number) {
  const n = adj.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const used = new Uint8Array(n);
  dist[start] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!used[i] && dist[i]! < best) {
        best = dist[i]!;
        u = i;
      }
    }
    if (u < 0 || best === Infinity) break;
    used[u] = 1;
    for (const [v, w] of adj[u]!) {
      const nd = dist[u]! + w;
      if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
      }
    }
  }
  return { dist, prev };
}

function asCand(graph: Graph, cand: Omit<Cand, "node" | "approach">): Cand {
  const near = nearestNode(graph, cand.lat, cand.lon);
  return { ...cand, node: near.index, approach: near.distance };
}

function candidatesFor(data: CoverageData, spec: Spec, graph: Graph): Cand[] {
  const eligible = data.lots.filter((l) => l.permitted && l.sqft >= spec.minSqft && l.countyId);
  const leasedCounties = new Set(eligible.map((l) => l.countyId));
  const out: Cand[] = [];
  for (const lot of eligible) {
    out.push(
      asCand(graph, {
        id: lot.id,
        name: lot.name,
        address: lot.address,
        lat: lot.lat,
        lon: lot.lon,
        countyId: lot.countyId!,
        kind: "leased",
        sqft: lot.sqft,
      }),
    );
  }
  for (const county of data.counties) {
    if (leasedCounties.has(county.id) || !county.town) continue;
    out.push(
      asCand(graph, {
        id: `town-${county.id}`,
        name: county.town.name,
        address: `Unleased. Census place for ${county.town.name}, not a yard in the lot file.`,
        lat: county.town.lat,
        lon: county.town.lon,
        countyId: county.id,
        kind: "town",
        sqft: null,
      }),
    );
  }
  return out;
}

function applyDrag(cands: Cand[], data: CoverageData, graph: Graph, drag: Drag | null) {
  if (!drag) return { cands, forced: null as Cand | null };
  const county = data.counties.find((c) => c.id === drag.toCountyId);
  const previous = cands.find((c) => c.id === drag.moveYardId);
  let forced: Cand;
  if (drag.lotId) {
    const lot = data.lots.find((l) => l.id === drag.lotId);
    if (!lot) return { cands, forced: null };
    forced = asCand(graph, {
      id: lot.id,
      name: lot.name,
      address: lot.address,
      lat: lot.lat,
      lon: lot.lon,
      countyId: lot.countyId ?? drag.toCountyId,
      kind: "leased",
      sqft: lot.sqft,
    });
  } else {
    const place = county?.town?.name ?? county?.name ?? "Dropped pin";
    const same = previous && previous.countyId === drag.toCountyId;
    forced = asCand(graph, {
      id: drag.moveYardId ?? `dropped-${drag.toCountyId}`,
      name: same ? previous.name : place,
      address: same
        ? previous.address
        : `Dropped in ${county?.name ?? "this county"}. ${previous ? `Moved from ${previous.name}. ` : ""}Not a signed lease.`,
      lat: drag.lat,
      lon: drag.lon,
      countyId: drag.toCountyId,
      kind: same && previous.kind === "leased" ? "leased" : "dropped",
      sqft: previous?.sqft ?? null,
    });
  }
  const next = cands.filter((c) => c.id !== forced.id && c.id !== drag.moveYardId);
  next.push(forced);
  return { cands: next, forced };
}

export function solve(data: CoverageData, spec: Spec, drag: Drag | null): Plan {
  spec = {
    ...spec,
    separation: Math.min(spec.separation, Math.max(18, spec.maxMiles * 0.7)),
    minHomes: Math.min(spec.minHomes, Math.max(3000, Math.round(spec.homesPerTech * 0.08))),
  };
  const graph = buildGraph(data.roads);
  const { cands, forced } = applyDrag(candidatesFor(data, spec, graph), data, graph, drag);
  const countyNode = data.counties.map((c) => nearestNode(graph, c.lat, c.lon));
  const cache = new Map<number, { dist: number[]; prev: number[] }>();
  const from = (node: number) => {
    let hit = cache.get(node);
    if (!hit) {
      hit = dijkstra(graph.adj, node);
      cache.set(node, hit);
    }
    return hit;
  };
  const roadMiles = (cand: Cand, countyIndex: number) => {
    const hop = from(cand.node).dist[countyNode[countyIndex]!.index] ?? Infinity;
    if (!Number.isFinite(hop)) return Infinity;
    return cand.approach + hop + countyNode[countyIndex]!.distance;
  };
  const spurOk = countyNode.map((n) => n.distance <= spec.spur);
  const phaseOk = data.counties.map((c) => spec.phase === 2 || c.phase1);
  const forcedIds = new Set<string>(forced ? [forced.id] : []);

  const reachable = (cand: Cand, i: number) => {
    const county = data.counties[i]!;
    const d = roadMiles(cand, i);
    const forcedHome = forcedIds.has(cand.id) && county.id === cand.countyId;
    if (county.zoned === false && !forcedHome) return Infinity;
    if (forcedIds.has(cand.id)) {
      if (forcedHome) return Math.min(d, spec.maxMiles);
      if (spurOk[i] && d <= spec.maxMiles) return d;
      return Infinity;
    }
    if (!(phaseOk[i] && spurOk[i])) return Infinity;
    return d;
  };

  const open: Cand[] = [];
  if (forced) open.push(forced);

  const assign = (yardsOpen: Cand[], bias: Map<number, number>) => {
    const owner = new Array<number>(data.counties.length).fill(-1);
    const dist = new Array<number>(data.counties.length).fill(Infinity);
    for (let i = 0; i < data.counties.length; i++) {
      for (let y = 0; y < yardsOpen.length; y++) {
        const d = reachable(yardsOpen[y]!, i);
        if (d <= spec.maxMiles && d < dist[i]!) {
          dist[i] = d;
          owner[i] = y;
        }
      }
    }
    for (const [i, y] of bias) {
      if (y < 0 || y >= yardsOpen.length) continue;
      owner[i] = y;
      dist[i] = 0.1;
    }
    const groups = yardsOpen.map(() => [] as number[]);
    const pop = yardsOpen.map(() => 0);
    for (let i = 0; i < data.counties.length; i++) {
      const y = owner[i]!;
      if (y < 0) continue;
      groups[y]!.push(i);
      pop[y]! += data.counties[i]!.pop;
    }
    const covered = new Array<number>(data.counties.length).fill(0);
    const meta = yardsOpen.map((_, y) => {
      const people = pop[y]!;
      const techs = Math.max(people >= 8000 ? 1 : 0, Math.floor(people / spec.residentsPerTech));
      const engineers = Math.max(people >= 20000 ? 1 : 0, Math.floor(people / spec.residentsPerEngineer));
      const cap = engineers < 1 || techs < 1 ? 0 : spec.homesPerTech;
      const members = groups[y]!.slice().sort((a, b) => dist[a]! - dist[b]!);
      let room = cap;
      for (const i of members) {
        const take = Math.min(room, demandOf(data.counties[i]!));
        const keepForced = forcedIds.has(yardsOpen[y]!.id) && data.counties[i]!.id === yardsOpen[y]!.countyId;
        if (take <= 0 && !keepForced) {
          owner[i] = -1;
          continue;
        }
        covered[i] = take;
        room -= take;
      }
      return { techs, engineers, cap, people };
    });
    return { owner, dist, covered, meta };
  };

  const scoreOf = (cand: Cand, held: ReturnType<typeof assign>) => {
    if (spec.preferNear && miles(cand.lat, cand.lon, spec.preferNear.lat, spec.preferNear.lon) > spec.maxMiles + 10) return 0;
    if (spec.phase === 1 && !data.counties.find((c) => c.id === cand.countyId)?.phase1) return 0;
    for (const other of open) {
      const hop = from(cand.node).dist[other.node] ?? Infinity;
      const apart = cand.approach + hop + other.approach;
      if (apart < spec.separation) return 0;
    }
    let homes = 0;
    let people = 0;
    for (let i = 0; i < data.counties.length; i++) {
      const d = reachable(cand, i);
      if (d > spec.maxMiles) continue;
      const y = held.owner[i]!;
      if (y >= 0 && held.dist[i]! <= d) continue;
      const county = data.counties[i]!;
      homes += demandOf(county);
      people += county.pop;
    }
    const techs = Math.max(people >= 8000 ? 1 : 0, Math.floor(people / spec.residentsPerTech));
    const engineers = Math.max(people >= 20000 ? 1 : 0, Math.floor(people / spec.residentsPerEngineer));
    if (engineers < 1 || techs < 1) return 0;
    return Math.min(homes, spec.homesPerTech);
  };

  const pool = cands.filter((c) => c.id !== forced?.id);
  for (let guard = 0; guard < 28; guard++) {
    const heldNow = assign(open, new Map());
    let best: Cand | null = null;
    let bestScore = 0;
    for (const cand of pool) {
      if (open.some((o) => o.id === cand.id)) continue;
      if (spec.preferNear && miles(cand.lat, cand.lon, spec.preferNear.lat, spec.preferNear.lon) > spec.maxMiles + 10) continue;
      if (spec.phase === 1 && !data.counties.find((c) => c.id === cand.countyId)?.phase1) continue;
      const score = scoreOf(cand, heldNow);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (!best || bestScore < spec.minHomes) break;
    open.push(best);
    const check = assign(open, new Map());
    const alive = new Set(check.owner.filter((y) => y >= 0));
    for (let y = open.length - 1; y >= 0; y--) {
      if (alive.has(y) || forcedIds.has(open[y]!.id)) continue;
      open.splice(y, 1);
    }
  }

  // A town pin that only won because it sat on the corridor should yield to a
  // leased yard already inside the territory it claimed.
  {
    const preview = assign(open, new Map());
    for (let y = 0; y < open.length; y++) {
      if (open[y]!.kind === "leased" || forcedIds.has(open[y]!.id)) continue;
      let bestLot: Cand | null = null;
      let bestHomes = 0;
      for (let i = 0; i < data.counties.length; i++) {
        if (preview.owner[i] !== y) continue;
        const lot = pool.find((c) => c.kind === "leased" && c.countyId === data.counties[i]!.id);
        if (lot && data.counties[i]!.homes > bestHomes) {
          bestHomes = data.counties[i]!.homes;
          bestLot = lot;
        }
      }
      if (bestLot && !open.some((o) => o.id === bestLot!.id)) open[y] = bestLot;
    }
  }

  const bias = new Map<number, number>();
  if (drag?.steal && drag.moveYardId) {
    const yi = open.findIndex((o) => o.id === drag.moveYardId);
    if (yi >= 0) {
      const preview = assign(open, new Map());
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < data.counties.length; i++) {
        if (preview.owner[i] === yi) continue;
        const d = reachable(open[yi]!, i);
        if (d < bestD && d <= spec.maxMiles + 20) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) bias.set(best, yi);
    }
  }

  const held = assign(open, bias);
  const cells: Cell[] = data.counties.map((county, i) => {
    const y = held.owner[i]!;
    const yard = y >= 0 ? open[y]! : null;
    const forcedHere = Boolean(yard && forcedIds.has(yard.id) && yard.countyId === county.id);
    const notZoned = county.zoned === false && !forcedHere;
    const off = notZoned || ((!phaseOk[i] || !spurOk[i]) && !forcedHere && held.covered[i] === 0);
    const offLimits = off ? county.homes : 0;
    const got = off ? 0 : held.covered[i]!;
    const gap = off ? 0 : Math.max(0, demandOf(county) - got);
    let why: string;
    if (notZoned) {
      why = "Not zoned. No approval covers this county, or the REP pulled the territory.";
    } else if (!spurOk[i] && !forcedHere) {
      why = `No major truck route within ${spec.spur} miles. The corridors on this map do not reach the county.`;
    } else if (off) {
      why = "Off limits in phase 1. Only Austin, Houston, San Antonio, and Dallas–Fort Worth are unlocked. Drag a territory onto this county to force a yard.";
    } else if (!yard) {
      why = "On a truck route, but a yard here would not cover enough new homes without stacking on another yard.";
    } else if (held.meta[y]!.cap === 0) {
      why = `${yard.name} is in range, but there is not an engineer and a technician in the territory.`;
    } else if (got + county.permits < county.homes) {
      why = `${yard.name} is ${held.dist[i]!.toFixed(0)} road miles out. Closer counties take the crew first, so this county is only partly covered.`;
    } else {
      why = `${yard.name}, ${held.dist[i]!.toFixed(0)} road miles on ${graph.nodes[yard.node]?.road ?? "a corridor"}.`;
    }
    return {
      id: county.id,
      name: county.name,
      covered: got,
      total: county.homes,
      offLimits,
      underConstruction: county.permits,
      gap,
      yardId: off ? null : (yard?.id ?? null),
      miles: yard && !off && Number.isFinite(held.dist[i]!) ? held.dist[i]! : null,
      techs: Math.max(county.pop >= 8000 ? 1 : 0, Math.floor(county.pop / spec.residentsPerTech)),
      engineers: Math.max(county.pop >= 20000 ? 1 : 0, Math.floor(county.pop / spec.residentsPerEngineer)),
      base: county.base,
      why,
    };
  });

  const yards: Yard[] = open.map((cand, y) => {
    const meta = held.meta[y]!;
    const mine = cells.filter((c) => c.yardId === cand.id);
    const homes = mine.reduce((s, c) => s + c.covered, 0);
    const finished = mine.reduce((s, c) => s + Math.max(0, c.total - c.underConstruction), 0);
    const kindNote =
      cand.kind === "leased"
        ? "Leased address in the lot file."
        : cand.kind === "town"
          ? "No permitted lot of at least 40,000 sq ft in this county. The pin is the Census place, not a signed lease."
          : "Moved by a drag. Not a signed lease.";
    const crew =
      meta.cap === 0
        ? "The territory cannot staff both an engineer and a technician, so covered homes stay at zero."
        : `${meta.techs} technicians and ${meta.engineers} engineer${meta.engineers === 1 ? "" : "s"} from the counties in range (1 technician per ${spec.residentsPerTech.toLocaleString()} residents, 1 engineer per ${spec.residentsPerEngineer.toLocaleString()}). The crew can carry ${meta.cap.toLocaleString()} homes. Finished homes in the territory: ${finished.toLocaleString()}.`;
    const countyName = data.counties.find((c) => c.id === cand.countyId)?.name ?? "";
    const label = cand.kind === "leased" ? cand.name : `${cand.name} · ${countyName}`;
    return {
      id: cand.id,
      name: label,
      address: cand.address,
      lat: cand.lat,
      lon: cand.lon,
      countyId: cand.countyId,
      kind: cand.kind,
      sqft: cand.sqft,
      techs: meta.techs,
      engineers: meta.engineers,
      homes,
      cap: meta.cap,
      counties: mine.length,
      road: graph.nodes[cand.node]?.road ?? "",
      note: `${kindNote} On ${graph.nodes[cand.node]?.road ?? "a corridor"}. ${crew}`,
      forced: forcedIds.has(cand.id),
    };
  });

  const usedKeys = new Set<string>();
  const used: [number, number][][] = [];
  const spurs: [number, number][][] = [];
  for (let y = 0; y < open.length; y++) {
    const cand = open[y]!;
    const access = graph.nodes[cand.node]!;
    spurs.push([
      [cand.lat, cand.lon],
      [access.lat, access.lon],
    ]);
    const tree = from(cand.node);
    for (let i = 0; i < data.counties.length; i++) {
      if (held.owner[i] !== y || held.covered[i]! <= 0) continue;
      const end = countyNode[i]!.index;
      const county = data.counties[i]!;
      spurs.push([
        [county.lat, county.lon],
        [graph.nodes[end]!.lat, graph.nodes[end]!.lon],
      ]);
      const chain: number[] = [];
      let cursor = end;
      let guard = 0;
      while (cursor >= 0 && cursor !== cand.node && guard < 500) {
        chain.push(cursor);
        cursor = tree.prev[cursor] ?? -1;
        guard += 1;
      }
      chain.push(cand.node);
      chain.reverse();
      for (let k = 1; k < chain.length; k++) {
        const a = chain[k - 1]!;
        const b = chain[k]!;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        used.push([
          [graph.nodes[a]!.lat, graph.nodes[a]!.lon],
          [graph.nodes[b]!.lat, graph.nodes[b]!.lon],
        ]);
      }
    }
  }

  const totals = cells.reduce(
    (s, c) => {
      s.covered += c.covered;
      s.total += c.total;
      s.offLimits += c.offLimits;
      s.underConstruction += c.underConstruction;
      s.gap += c.gap;
      return s;
    },
    { covered: 0, total: 0, offLimits: 0, underConstruction: 0, gap: 0, techs: 0, engineers: 0, yards: yards.length },
  );
  totals.techs = yards.reduce((s, y) => s + y.techs, 0);
  totals.engineers = yards.reduce((s, y) => s + y.engineers, 0);
  const byId: Record<string, Cell> = {};
  for (const cell of cells) byId[cell.id] = cell;
  const zonedOut = cells.reduce((s, c) => s + (c.why.startsWith("Not zoned") ? c.offLimits : 0), 0);
  const headline =
    spec.phase === 1
      ? `Phase 1 covers ${totals.covered.toLocaleString()} of ${totals.total.toLocaleString()} homes with ${yards.length} yards. ${totals.offLimits.toLocaleString()} homes are not zoned for this run.`
      : `Phase 2 covers ${totals.covered.toLocaleString()} of ${totals.total.toLocaleString()} homes with ${yards.length} yards. ${zonedOut.toLocaleString()} homes are not zoned. ${totals.gap.toLocaleString()} finished homes sit on a route with no crew left.`;
  return { yards, cells, byId, used, spurs, totals, headline };
}

export function describeMove(before: Plan, after: Plan) {
  const prev = new Set(before.yards.map((y) => y.id));
  const next = new Set(after.yards.map((y) => y.id));
  const opened = after.yards.filter((y) => !prev.has(y.id)).map((y) => y.name);
  const closed = before.yards.filter((y) => !next.has(y.id)).map((y) => y.name);
  let flipped = 0;
  for (const cell of after.cells) {
    const old = before.byId[cell.id];
    if (!old || old.yardId !== cell.yardId || old.covered !== cell.covered || old.offLimits !== cell.offLimits) flipped += 1;
  }
  const moved = after.yards.filter((y) => {
    const old = before.yards.find((o) => o.id === y.id);
    return old && miles(old.lat, old.lon, y.lat, y.lon) > 1;
  });
  if (!opened.length && !closed.length && flipped === 0 && !moved.length) {
    return "Nothing moved. Drop the shape on a gray county, or on a county that belongs to a different yard.";
  }
  const dHomes = after.totals.covered - before.totals.covered;
  const sign = dHomes >= 0 ? "+" : "";
  const movedNote = moved.length ? ` Moved ${moved.map((y) => y.name).join(", ")}.` : "";
  return `Opened ${opened.join(", ") || "nothing"}. Closed ${closed.join(", ") || "nothing"}.${movedNote} ${flipped} counties changed. Covered homes ${sign}${dHomes.toLocaleString()}.`;
}

export function fleetDots(counties: County[]) {
  const dots: { lat: number; lon: number }[] = [];
  let n = 0;
  for (const county of counties) {
    const marks = Math.round(county.base / 400);
    for (let i = 0; i < marks; i++) {
      const ang = n * 2.399;
      const rad = 0.08 + (n % 6) * 0.045;
      dots.push({
        lat: county.lat + Math.cos(ang) * rad,
        lon: county.lon + Math.sin(ang) * rad * 1.15,
      });
      n += 1;
    }
  }
  return dots;
}

export function buildDots(counties: County[]) {
  const dots: { lat: number; lon: number }[] = [];
  let n = 0;
  for (const county of counties) {
    const marks = Math.max(0, Math.round(county.permits / 2500));
    for (let i = 0; i < marks; i++) {
      const ang = n * 2.399 + 0.7;
      const rad = 0.04 + (n % 5) * 0.028;
      dots.push({
        lat: county.lat + Math.cos(ang) * rad,
        lon: county.lon + Math.sin(ang) * rad * 1.15,
      });
      n += 1;
    }
  }
  return dots;
}

export function territoryRing(yard: Yard, cells: Cell[], counties: County[]): [number, number][] {
  const owned = cells.filter((c) => c.yardId === yard.id);
  const pts = owned.map((c) => {
    const county = counties.find((x) => x.id === c.id)!;
    return [county.lat, county.lon] as [number, number];
  });
  pts.push([yard.lat, yard.lon]);
  if (pts.length < 3) {
    const [lat, lon] = pts[0] ?? [yard.lat, yard.lon];
    const wobble = [0.18, 0.28, 0.16, 0.34, 0.22];
    return wobble.map((r, i) => {
      const ang = (i / wobble.length) * Math.PI * 2 + 0.4;
      return [lat + Math.cos(ang) * r, lon + Math.sin(ang) * r * 1.2] as [number, number];
    });
  }
  const hull = convex(pts);
  return hull.length >= 3 ? hull : pts;
}

function convex(points: [number, number][]) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
