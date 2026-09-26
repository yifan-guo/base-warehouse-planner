export type Approval = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  install_sites: number;
  min_kwh_usage: number;
  max_kwh_usage: number;
  start_date: string;
  /** Share of the circle that is occupied homes. The rest is unfinished development and counts less. */
  build_out: number;
};

export type Lot = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  sq_ft: number;
  commission_date: string;
  lead_time: number;
  permitted: boolean;
  county: string;
};

export type Spec = {
  sqft: number;
  storageKwh: number;
  maxMiles: number;
  /** Upper bound. Null means open only as many as the constraints justify. */
  maxWarehouses: number | null;
};

export type InstallPoint = {
  id: string;
  approvalId: string;
  approvalName: string;
  lat: number;
  lon: number;
  kwh: number;
  weight: number;
  kind: "home" | "development";
  start: string;
  warehouseId: string | null;
};

export type CitySeed = { name: string; lat: number; lon: number; pop: number };

export type OpenWarehouse = {
  lot: Lot;
  homes: number;
  development: number;
  kwh: number;
  weighted: number;
  ready: string;
  forced: boolean;
};

export type LotNote = { id: string; name: string; address: string; lat: number; lon: number; why: string };

export type ApprovalResult = {
  id: string;
  name: string;
  installs: number;
  covered: number;
  penetration: number;
  weightedPenetration: number;
  kwhRequired: number;
  kwhCovered: number;
  homes: number;
  development: number;
  note: string;
};

export type SolveResult = {
  points: InstallPoint[];
  warehouses: OpenWarehouse[];
  rejected: LotNote[];
  ghosts: LotNote[];
  approvals: ApprovalResult[];
  overlapPoints: number;
  headline: string;
  blocks: string[];
};

const DEV_WEIGHT = 0.35;
const SEPARATION = 15;

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

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function miles(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function addDays(iso: string, days: number) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

export function readyDate(lot: Lot) {
  return addDays(lot.commission_date, lot.lead_time);
}

function kwhEach(a: Approval) {
  return (a.min_kwh_usage + a.max_kwh_usage) / 2;
}

export function parseApprovals(text: string): { approvals: Approval[]; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { approvals: [], error: "That file is not valid JSON." };
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { approvals?: unknown }).approvals) ? (raw as { approvals: unknown[] }).approvals : null;
  if (!list) return { approvals: [], error: "The file needs an array of permits, or { approvals: [...] }." };
  const approvals: Approval[] = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i] as Record<string, unknown>;
    if (!row || typeof row !== "object") return { approvals: [], error: `Permit ${i + 1} is not an object.` };
    const lat = Number(row.lat);
    const lon = Number(row.lon ?? row.long ?? row.lng);
    const radius = Number(row.radius);
    const installs = Number(row.install_sites ?? row.homes);
    const minK = Number(row.min_kwh_usage);
    const maxK = Number(row.max_kwh_usage);
    const start = String(row.start_date ?? "");
    if (![lat, lon, radius, installs, minK, maxK].every((n) => Number.isFinite(n))) {
      return { approvals: [], error: `Permit ${i + 1} needs lat, long, radius, install_sites, min_kwh_usage, max_kwh_usage.` };
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return { approvals: [], error: `Permit ${i + 1} needs start_date as YYYY-MM-DD.` };
    const build = Number(row.build_out ?? 1);
    approvals.push({
      id: String(row.id ?? `permit-${i + 1}`),
      name: String(row.name ?? `Permit ${i + 1}`),
      lat,
      lon,
      radius,
      install_sites: Math.max(0, Math.round(installs)),
      min_kwh_usage: minK,
      max_kwh_usage: maxK,
      start_date: start.slice(0, 10),
      build_out: Math.min(1, Math.max(0, Number.isFinite(build) ? build : 1)),
    });
  }
  return { approvals, error: null };
}

function sample(approval: Approval, cities: CitySeed[]): InstallPoint[] {
  const rng = mulberry32(hash(approval.id + String(approval.install_sites)));
  const kwh = kwhEach(approval);
  const homesN = Math.round(approval.install_sites * approval.build_out);
  const inside = cities.filter((c) => miles(c.lat, c.lon, approval.lat, approval.lon) <= approval.radius && c.pop > 0);
  const pop = inside.reduce((s, c) => s + c.pop, 0);
  const points: InstallPoint[] = [];
  const place = (i: number, kind: "home" | "development") => {
    let lat = approval.lat;
    let lon = approval.lon;
    if (inside.length && pop > 0 && rng() < 0.82) {
      let ticket = rng() * pop;
      let city = inside[0]!;
      for (const c of inside) {
        ticket -= c.pop;
        if (ticket <= 0) {
          city = c;
          break;
        }
      }
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * Math.min(approval.radius * 0.35, 4);
      lat = city.lat + (rad / 69) * Math.cos(ang);
      lon = city.lon + (rad / (69 * Math.cos((city.lat * Math.PI) / 180))) * Math.sin(ang);
    } else {
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * approval.radius;
      lat = approval.lat + (rad / 69) * Math.cos(ang);
      lon = approval.lon + (rad / (69 * Math.cos((approval.lat * Math.PI) / 180))) * Math.sin(ang);
    }
    points.push({
      id: `${approval.id}-${i}`,
      approvalId: approval.id,
      approvalName: approval.name,
      lat,
      lon,
      kwh,
      weight: kind === "home" ? 1 : DEV_WEIGHT,
      kind,
      start: approval.start_date,
      warehouseId: null,
    });
  };
  for (let i = 0; i < homesN; i++) place(i, "home");
  for (let i = homesN; i < approval.install_sites; i++) place(i, "development");
  return points;
}

function canReach(lot: Lot, point: InstallPoint, maxMiles: number) {
  return miles(lot.lat, lot.lon, point.lat, point.lon) <= maxMiles && readyDate(lot) < point.start;
}

export function solve(approvals: Approval[], lots: Lot[], cities: CitySeed[], spec: Spec, forcedIds: string[]): SolveResult {
  const points = approvals.flatMap((a) => sample(a, cities));
  const fit = lots.filter((l) => l.permitted && l.sq_ft + 0.5 >= spec.sqft);
  const rejected: LotNote[] = [];
  for (const lot of lots) {
    if (!lot.permitted) {
      rejected.push({ id: lot.id, name: lot.name, address: lot.address, lat: lot.lat, lon: lot.lon, why: "Not a warehouse lot." });
    } else if (lot.sq_ft + 0.5 < spec.sqft) {
      rejected.push({
        id: lot.id,
        name: lot.name,
        address: lot.address,
        lat: lot.lat,
        lon: lot.lon,
        why: `${lot.sq_ft.toLocaleString()} sq ft is smaller than the ${Math.round(spec.sqft).toLocaleString()} sq ft building.`,
      });
    }
  }

  const reach: number[][] = fit.map((lot) => {
    const hit: number[] = [];
    for (let i = 0; i < points.length; i++) if (canReach(lot, points[i]!, spec.maxMiles)) hit.push(i);
    return hit;
  });

  const assigned = new Int16Array(points.length).fill(-1);
  const openIdx: number[] = [];
  const forced = new Set(forcedIds);

  function take(lotIndex: number, isForced: boolean) {
    const lot = fit[lotIndex]!;
    let room = spec.storageKwh;
    const order = reach[lotIndex]!.filter((i) => assigned[i] < 0).sort((a, b) => points[b]!.weight - points[a]!.weight || miles(lot.lat, lot.lon, points[a]!.lat, points[a]!.lon) - miles(lot.lat, lot.lon, points[b]!.lat, points[b]!.lon));
    for (const i of order) {
      const p = points[i]!;
      if (p.kwh > room) continue;
      assigned[i] = lotIndex;
      room -= p.kwh;
    }
    openIdx.push(lotIndex);
    return isForced;
  }

  for (const id of forced) {
    const i = fit.findIndex((l) => l.id === id);
    if (i >= 0 && !openIdx.includes(i)) take(i, true);
  }

  const cap = spec.maxWarehouses ?? fit.length;
  while (openIdx.length < cap) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < fit.length; i++) {
      if (openIdx.includes(i)) continue;
      const lot = fit[i]!;
      let tooClose = false;
      for (const oi of openIdx) {
        if (miles(lot.lat, lot.lon, fit[oi]!.lat, fit[oi]!.lon) < SEPARATION) tooClose = true;
      }
      if (tooClose) continue;
      let room = spec.storageKwh;
      let score = 0;
      const order = reach[i]!.filter((pi) => assigned[pi] < 0).sort((a, b) => points[b]!.weight - points[a]!.weight);
      for (const pi of order) {
        if (points[pi]!.kwh > room) continue;
        score += points[pi]!.weight;
        room -= points[pi]!.kwh;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore < 1) break;
    take(best, false);
  }

  assigned.fill(-1);
  const room = openIdx.map(() => spec.storageKwh);
  const options: number[][] = points.map(() => []);
  for (const li of openIdx) {
    for (const pi of reach[li]!) options[pi]!.push(li);
  }
  const order = points
    .map((_, i) => i)
    .sort((a, b) => points[b]!.weight - points[a]!.weight || options[a]!.length - options[b]!.length);
  for (const pi of order) {
    let best = -1;
    let bestD = Infinity;
    for (const li of options[pi]!) {
      const k = openIdx.indexOf(li);
      if (k < 0 || points[pi]!.kwh > room[k]!) continue;
      const d = miles(fit[li]!.lat, fit[li]!.lon, points[pi]!.lat, points[pi]!.lon);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      assigned[pi] = openIdx[best]!;
      room[best]! -= points[pi]!.kwh;
    }
  }

  const placed = points.map((p, i) => ({ ...p, warehouseId: assigned[i] >= 0 ? fit[assigned[i]!]!.id : null }));
  const warehouses: OpenWarehouse[] = openIdx.map((li) => {
    const lot = fit[li]!;
    const mine = placed.filter((p) => p.warehouseId === lot.id);
    return {
      lot,
      homes: mine.filter((p) => p.kind === "home").length,
      development: mine.filter((p) => p.kind === "development").length,
      kwh: mine.reduce((s, p) => s + p.kwh, 0),
      weighted: mine.reduce((s, p) => s + p.weight, 0),
      ready: readyDate(lot),
      forced: forced.has(lot.id),
    };
  });

  let overlapPoints = 0;
  for (const p of placed) {
    if (!p.warehouseId) continue;
    let n = 0;
    for (const w of warehouses) if (miles(w.lot.lat, w.lot.lon, p.lat, p.lon) <= spec.maxMiles) n += 1;
    if (n > 1) overlapPoints += 1;
  }

  const ghosts: LotNote[] = [];
  const approvalResults: ApprovalResult[] = approvals.map((a) => {
    const mine = placed.filter((p) => p.approvalId === a.id);
    const covered = mine.filter((p) => p.warehouseId);
    const wSum = mine.reduce((s, p) => s + p.weight, 0);
    const wCov = covered.reduce((s, p) => s + p.weight, 0);
    const kwhRequired = mine.reduce((s, p) => s + p.kwh, 0);
    const kwhCovered = covered.reduce((s, p) => s + p.kwh, 0);
    const uncovered = mine.filter((p) => !p.warehouseId);
    const reasons: string[] = [];
    if (uncovered.length) {
      const openNear = new Set(
        uncovered
          .filter((p) => warehouses.some((w) => miles(w.lot.lat, w.lot.lon, p.lat, p.lon) <= spec.maxMiles && readyDate(w.lot) < p.start))
          .map((p) => p.id),
      );
      if (openNear.size) {
        const held = warehouses
          .filter((w) => uncovered.some((p) => openNear.has(p.id) && miles(w.lot.lat, w.lot.lon, p.lat, p.lon) <= spec.maxMiles))
          .map((w) => w.lot.name);
        const be = held.length > 1 ? "are" : "is";
        reasons.push(
          `${openNear.size.toLocaleString()} installs sit inside ${held.join(" and ") || "an open warehouse"}, which ${be} already at the ${Math.round(spec.storageKwh).toLocaleString()} kWh limit (${Math.round(kwhCovered).toLocaleString()} of ${Math.round(kwhRequired).toLocaleString()} kWh on this permit).`,
        );
      }
      let bestLot: Lot | null = null;
      let bestN = 0;
      let bestWhy = "";
      for (const lot of lots) {
        if (warehouses.some((w) => w.lot.id === lot.id)) continue;
        const n = uncovered.filter((p) => miles(lot.lat, lot.lon, p.lat, p.lon) <= spec.maxMiles).length;
        if (n <= bestN) continue;
        bestN = n;
        bestLot = lot;
        const whys: string[] = [];
        if (!lot.permitted) whys.push("not a warehouse lot");
        if (lot.sq_ft + 0.5 < spec.sqft) whys.push(`${lot.sq_ft.toLocaleString()} sq ft is under the ${Math.round(spec.sqft).toLocaleString()} sq ft building`);
        const ready = readyDate(lot);
        if (!(ready < a.start_date)) whys.push(`ready ${ready}, after the permit starts ${a.start_date}`);
        const near = warehouses.find((w) => miles(w.lot.lat, w.lot.lon, lot.lat, lot.lon) < SEPARATION);
        if (near && lot.permitted && lot.sq_ft + 0.5 >= spec.sqft && ready < a.start_date) {
          whys.push(`${miles(near.lot.lat, near.lot.lon, lot.lat, lot.lon).toFixed(0)} miles from ${near.lot.name}, so a second building would cover the same homes`);
        }
        bestWhy = whys.join("; ") || "not selected";
      }
      const stranded = uncovered.filter((p) => !openNear.has(p.id));
      if (bestLot && bestN > 0 && stranded.length) {
        reasons.push(`${stranded.length.toLocaleString()} more have no open warehouse. Nearest candidate ${bestLot.name} was not opened: ${bestWhy}.`);
        if (!ghosts.some((g) => g.id === bestLot!.id)) {
          ghosts.push({ id: bestLot.id, name: bestLot.name, address: bestLot.address, lat: bestLot.lat, lon: bestLot.lon, why: bestWhy });
        }
      } else if (bestLot && bestN > 0) {
        reasons.push(`Nearest other lot, ${bestLot.name}, was not opened: ${bestWhy}.`);
        if (!ghosts.some((g) => g.id === bestLot!.id)) {
          ghosts.push({ id: bestLot.id, name: bestLot.name, address: bestLot.address, lat: bestLot.lat, lon: bestLot.lon, why: bestWhy });
        }
      } else if (stranded.length) {
        reasons.push(`${stranded.length.toLocaleString()} installs have no lot within ${spec.maxMiles} miles.`);
      }
    }
    return {
      id: a.id,
      name: a.name,
      installs: mine.length,
      covered: covered.length,
      penetration: mine.length ? covered.length / mine.length : 0,
      weightedPenetration: wSum ? wCov / wSum : 0,
      kwhRequired,
      kwhCovered,
      homes: mine.filter((p) => p.kind === "home").length,
      development: mine.filter((p) => p.kind === "development").length,
      note: reasons.join(" ") || "Every install in this permit is inside a warehouse that is large enough, commissioned in time, and not stacked on another.",
    };
  });

  const coveredN = placed.filter((p) => p.warehouseId).length;
  const blocks = approvalResults.filter((a) => a.note && a.covered < a.installs).map((a) => `${a.name}: ${a.note}`);
  const headline = `${warehouses.length} warehouse${warehouses.length === 1 ? "" : "s"} cover ${coveredN.toLocaleString()} of ${placed.length.toLocaleString()} installs (${placed.length ? Math.round((coveredN / placed.length) * 100) : 0}%). Penetration is the output.`;

  return { points: placed, warehouses, rejected, ghosts, approvals: approvalResults, overlapPoints, headline, blocks };
}

export function snapLot(lat: number, lon: number, lots: Lot[], spec: Spec, taken: Set<string>) {
  let best: Lot | null = null;
  let bestD = 30;
  for (const lot of lots) {
    if (taken.has(lot.id) || !lot.permitted || lot.sq_ft + 0.5 < spec.sqft) continue;
    const d = miles(lat, lon, lot.lat, lot.lon);
    if (d < bestD) {
      bestD = d;
      best = lot;
    }
  }
  return best;
}
