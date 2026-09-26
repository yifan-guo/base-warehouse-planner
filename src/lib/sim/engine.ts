import {
  CIRCUITY,
  COUNTIES,
  FACTORY,
  HORIZON,
  INVERTER_KW,
  NAMEPLATE_KWH,
  PIN_MONTHLY_CAP,
  PINS,
  RESERVE_FLOOR,
  ROADS,
  TERRITORIES,
  TOWNS,
  haversineMiles,
  pinById,
  project,
  roadMiles,
  territoryById,
  townById,
} from "./geo";

export type XPct = 15 | 30 | 50;
export type SlaMiles = 45 | 75 | 120;
export type MesCap = 300 | 750 | 1200;
export type PolicyId = "reserve_hold" | "headroom_prorata" | "peak_shave_node" | "tou_follow";
export type GridDay = "summer" | "winter" | "shoulder";

export type SolveInput = {
  xPct: XPct;
  sla: SlaMiles;
  mes: MesCap;
  unlocks: Record<string, number | null>;
  policy: PolicyId;
  day: GridDay;
};

export type Lot = {
  id: string;
  townId: string;
  territoryId: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  inCohort: boolean;
  /** Month a kit is released. Null if never timed. */
  month: number | null;
  pinId: string | null;
  uncovered: boolean;
};

export type OpenPin = {
  id: string;
  openMonth: number;
  reason: string;
  lotCount: number;
  territories: string[];
};

export type Plan = {
  lots: Lot[];
  opens: OpenPin[];
  myopic: Array<{ id: string; month: number }>;
  summary: string;
  input: SolveInput;
};

export type NodeStep = {
  nonBaseKw: number;
  headroomKw: number;
  chargeKw: number;
  exportKw: number;
  homeKw: number;
  floorBinding: boolean;
  batteries: number;
};

export type GridSim = {
  nodes: Record<string, NodeStep[]>;
  batteries: Record<
    string,
    { charge: number[]; exportKw: number[]; home: number[]; soc: number[] }
  >;
};

const FLOOR_KWH = NAMEPLATE_KWH * RESERVE_FLOOR;
const DT = 0.25;
const STEPS = 96;
const MIN_PIN_LOTS = 8;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildLots(): Lot[] {
  const rng = mulberry32(42);
  const lots: Lot[] = [];
  for (const town of TOWNS) {
    const sigma = 0.012 + Math.min(0.02, town.lots / 4000);
    const axis = rng() * Math.PI;
    for (let i = 0; i < town.lots; i++) {
      const along = gauss(rng) * sigma * 1.35;
      const across = gauss(rng) * sigma * 0.55;
      const lat = town.lat + along * Math.cos(axis) + across * Math.sin(axis);
      const lon = town.lon + (along * Math.sin(axis) + across * Math.cos(axis)) * 1.15;
      const p = project(lat, lon);
      lots.push({
        id: `${town.id}-${i}`,
        townId: town.id,
        territoryId: town.territoryId,
        lat,
        lon,
        x: p.x,
        y: p.y,
        inCohort: false,
        month: null,
        pinId: null,
        uncovered: false,
      });
    }
  }
  return lots;
}

const BASE_LOTS = buildLots();

function cloneLots(): Lot[] {
  return BASE_LOTS.map((l) => ({ ...l, inCohort: false, month: null, pinId: null, uncovered: false }));
}

function within(pin: { lat: number; lon: number }, lot: Lot, sla: number): boolean {
  return roadMiles(pin.lat, pin.lon, lot.lat, lot.lon) <= sla;
}

function selectCohort(lots: Lot[], xPct: number, unlocks: Record<string, number | null>): void {
  for (const terr of TERRITORIES) {
    if (unlocks[terr.id] === null) continue;
    const group = lots.filter((l) => l.territoryId === terr.id);
    const target = Math.round((group.length * xPct) / 100);
    const byTown = new Map<string, Lot[]>();
    for (const lot of group) {
      const town = townById(lot.townId);
      const d = haversineMiles(lot.lat, lot.lon, town.lat, town.lon);
      const arr = byTown.get(lot.townId) ?? [];
      arr.push(lot);
      byTown.set(lot.townId, arr);
      (lot as Lot & { _d?: number })._d = d;
    }
    for (const arr of byTown.values()) {
      arr.sort((a, b) => ((a as Lot & { _d?: number })._d ?? 0) - ((b as Lot & { _d?: number })._d ?? 0));
    }
    const towns = [...byTown.keys()];
    const taken = new Map<string, number>();
    let got = 0;
    let guard = 0;
    while (got < target && guard < target * 5) {
      guard++;
      towns.sort((a, b) => {
        const fa = (taken.get(a) ?? 0) / Math.max(1, byTown.get(a)!.length);
        const fb = (taken.get(b) ?? 0) / Math.max(1, byTown.get(b)!.length);
        return fa - fb;
      });
      let placed = false;
      for (const id of towns) {
        const arr = byTown.get(id)!;
        const n = taken.get(id) ?? 0;
        if (n >= arr.length) continue;
        arr[n]!.inCohort = true;
        taken.set(id, n + 1);
        got++;
        placed = true;
        break;
      }
      if (!placed) break;
    }
  }
}

function choosePins(lots: Lot[], sla: number): string[] {
  const need = lots.filter((l) => l.inCohort);
  const uncovered = new Set(need.map((l) => l.id));
  const byId = new Map(need.map((l) => [l.id, l]));
  const chosen: string[] = [];
  while (uncovered.size > 0) {
    let bestId = "";
    let bestCover: string[] = [];
    let bestTerr = 0;
    for (const pin of PINS) {
      if (chosen.includes(pin.id)) continue;
      const cover: string[] = [];
      const terrs = new Set<string>();
      for (const id of uncovered) {
        const lot = byId.get(id)!;
        if (within(pin, lot, sla)) {
          cover.push(id);
          terrs.add(lot.territoryId);
        }
      }
      if (cover.length > bestCover.length || (cover.length === bestCover.length && terrs.size > bestTerr)) {
        bestId = pin.id;
        bestCover = cover;
        bestTerr = terrs.size;
      }
    }
    if (!bestId || bestCover.length < MIN_PIN_LOTS) break;
    chosen.push(bestId);
    for (const id of bestCover) uncovered.delete(id);
  }
  return chosen;
}

function assignPins(lots: Lot[], chosen: string[], sla: number): void {
  const pins = chosen.map((id) => pinById(id));
  for (const lot of lots) {
    if (!lot.inCohort) continue;
    let best: { id: string; d: number } | null = null;
    for (const pin of pins) {
      const d = roadMiles(pin.lat, pin.lon, lot.lat, lot.lon);
      if (d <= sla && (!best || d < best.d)) best = { id: pin.id, d };
    }
    if (best) lot.pinId = best.id;
    else lot.uncovered = true;
  }
}

function timeLots(lots: Lot[], input: SolveInput): void {
  const pool = lots.filter((l) => l.inCohort && l.pinId);
  const timed = new Set<string>();
  const terrSize = new Map<string, number>();
  const townSize = new Map<string, number>();
  for (const lot of pool) {
    terrSize.set(lot.territoryId, (terrSize.get(lot.territoryId) ?? 0) + 1);
    townSize.set(lot.townId, (townSize.get(lot.townId) ?? 0) + 1);
  }
  const terrRamp = new Map<string, number>();
  for (const [id, n] of terrSize) terrRamp.set(id, Math.max(4, Math.ceil(n * 0.22)));
  const townCap = new Map<string, number>();
  for (const [id, n] of townSize) townCap.set(id, Math.max(3, Math.ceil(n * 0.45)));

  for (let m = 0; m < HORIZON; m++) {
    const openTerr = new Set(
      TERRITORIES.filter((t) => {
        const u = input.unlocks[t.id];
        return u !== null && u <= m;
      }).map((t) => t.id),
    );
    const candidates = pool.filter((l) => !timed.has(l.id) && openTerr.has(l.territoryId));
    const scored = candidates.map((lot) => {
      const town = townById(lot.townId);
      let neighbors = 0;
      for (const other of pool) {
        if (!timed.has(other.id) || other.townId !== lot.townId) continue;
        const d = haversineMiles(lot.lat, lot.lon, other.lat, other.lon);
        if (d < 1.4) neighbors++;
      }
      const center = haversineMiles(lot.lat, lot.lon, town.lat, town.lon);
      return { lot, score: neighbors * 3 - center };
    });
    scored.sort((a, b) => b.score - a.score);
    const terrN = new Map<string, number>();
    const townN = new Map<string, number>();
    const pinN = new Map<string, number>();
    let global = 0;
    for (const { lot } of scored) {
      if (global >= input.mes) break;
      const tr = terrN.get(lot.territoryId) ?? 0;
      if (tr >= (terrRamp.get(lot.territoryId) ?? 4)) continue;
      const tn = townN.get(lot.townId) ?? 0;
      if (tn >= (townCap.get(lot.townId) ?? 3)) continue;
      const pn = pinN.get(lot.pinId!) ?? 0;
      if (pn >= PIN_MONTHLY_CAP) continue;
      lot.month = m;
      timed.add(lot.id);
      terrN.set(lot.territoryId, tr + 1);
      townN.set(lot.townId, tn + 1);
      pinN.set(lot.pinId!, pn + 1);
      global++;
    }
  }
}

function describePin(id: string, lots: Lot[], unlocks: Record<string, number | null>): OpenPin | null {
  const mine = lots.filter((l) => l.pinId === id && l.month !== null);
  if (!mine.length) return null;
  const openMonth = Math.min(...mine.map((l) => l.month!));
  const terrs = [...new Set(mine.map((l) => l.territoryId))];
  const later = terrs.filter((tid) => {
    const u = unlocks[tid];
    return u !== null && u > openMonth;
  });
  const now = terrs.filter((tid) => !later.includes(tid));
  const laterTxt = later
    .map((tid) => {
      const u = unlocks[tid];
      return `${territoryById(tid).name} (unlock M${u})`;
    })
    .join(", ");
  const nowTxt = now.map((tid) => territoryById(tid).name).join(", ");
  const reason = later.length
    ? `Opened M${openMonth} so growth in ${laterTxt} still has a warehouse. Also serves ${nowTxt || "nearby lots"} from the start.`
    : `Opened M${openMonth} to serve ${nowTxt}.`;
  return { id, openMonth, reason, lotCount: mine.length, territories: terrs };
}

function myopicPlan(lots: Lot[], sla: number): Array<{ id: string; month: number }> {
  const opened: Array<{ id: string; month: number }> = [];
  const openIds = new Set<string>();
  for (let m = 0; m < HORIZON; m++) {
    const batch = lots.filter((l) => l.inCohort && l.month === m);
    const uncovered = batch.filter((lot) => {
      for (const id of openIds) {
        const pin = pinById(id);
        if (within(pin, lot, sla)) return false;
      }
      return true;
    });
    if (!uncovered.length) continue;
    let best = "";
    let bestN = 0;
    for (const pin of PINS) {
      if (openIds.has(pin.id)) continue;
      const n = uncovered.filter((lot) => within(pin, lot, sla)).length;
      if (n > bestN) {
        bestN = n;
        best = pin.id;
      }
    }
    if (best && bestN >= MIN_PIN_LOTS) {
      opened.push({ id: best, month: m });
      openIds.add(best);
    }
  }
  return opened;
}

function summary(opens: OpenPin[], myopic: Array<{ id: string; month: number }>): string {
  const a = opens.map((p) => `${pinById(p.id).name} M${p.openMonth}`).join(", ") || "none";
  const b = myopic.map((p) => `${pinById(p.id).name} M${p.month}`).join(", ") || "none";
  if (a === b) return `Look-ahead and a month-by-month plan open the same pins: ${a}.`;
  return `Look-ahead opens ${a}. A plan that only sees the current month would open ${b}.`;
}

export function solve(input: SolveInput): Plan {
  const lots = cloneLots();
  selectCohort(lots, input.xPct, input.unlocks);
  const chosen = choosePins(lots, input.sla);
  assignPins(lots, chosen, input.sla);
  timeLots(lots, input);
  const opens = chosen
    .map((id) => describePin(id, lots, input.unlocks))
    .filter((p): p is OpenPin => p !== null)
    .sort((a, b) => a.openMonth - b.openMonth || b.lotCount - a.lotCount);
  const myopic = myopicPlan(lots, input.sla);
  return { lots, opens, myopic, summary: summary(opens, myopic), input };
}

function hourShape(day: GridDay, hour: number): number {
  if (day === "summer") {
    if (hour < 6) return 0.62;
    if (hour < 10) return 0.8;
    if (hour < 14) return 1.05;
    if (hour < 16) return 1.35;
    if (hour < 21) return 1.72;
    return 1.02;
  }
  if (day === "winter") {
    if (hour < 5) return 0.7;
    if (hour < 9) return 1.48;
    if (hour < 16) return 0.84;
    if (hour < 21) return 1.42;
    return 0.9;
  }
  if (hour < 6) return 0.72;
  if (hour < 9) return 1.08;
  if (hour < 17) return 0.95;
  if (hour < 21) return 1.22;
  return 0.84;
}

export function dayProfile(day: GridDay): number[] {
  const raw = Array.from({ length: STEPS }, (_, i) => hourShape(day, Math.floor(i / 4)));
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  return raw.map((v) => v / mean);
}

function chargeShare(
  soc: number[],
  headroom: number,
  into: number[][],
  step: number,
): { kw: number; soc: number[] } {
  const rooms = soc.map((s) => Math.max(0, NAMEPLATE_KWH - s));
  const total = rooms.reduce((s, v) => s + v, 0);
  let kwSum = 0;
  const next = soc.slice();
  if (total <= 0 || headroom <= 0) return { kw: 0, soc: next };
  for (let j = 0; j < soc.length; j++) {
    const kw = Math.min(INVERTER_KW, (headroom * rooms[j]!) / total, rooms[j]! / DT);
    next[j] = soc[j]! + kw * DT;
    into[j]![step] = kw;
    kwSum += kw;
  }
  return { kw: kwSum, soc: next };
}

function dischargeShare(
  soc: number[],
  into: number[][],
  step: number,
): { kw: number; soc: number[]; binding: boolean } {
  const above = soc.map((s) => Math.max(0, s - FLOOR_KWH));
  const next = soc.slice();
  let kwSum = 0;
  let binding = false;
  for (let j = 0; j < soc.length; j++) {
    const availableKw = above[j]! / DT;
    const want = Math.min(INVERTER_KW, availableKw);
    if (want + 0.05 < INVERTER_KW && soc[j]! - FLOOR_KWH < INVERTER_KW * DT) binding = true;
    next[j] = Math.max(FLOOR_KWH, soc[j]! - want * DT);
    into[j]![step] = want;
    kwSum += want;
    if (next[j]! <= FLOOR_KWH + 0.08) binding = true;
  }
  return { kw: kwSum, soc: next, binding };
}

export function simulateGrid(plan: Plan, month: number, policy: PolicyId, day: GridDay): GridSim {
  const shape = dayProfile(day);
  const active = plan.lots.filter((l) => l.pinId && l.month !== null && l.month <= month);
  const byTown = new Map<string, Lot[]>();
  for (const lot of active) {
    const arr = byTown.get(lot.townId) ?? [];
    arr.push(lot);
    byTown.set(lot.townId, arr);
  }
  const order = shape
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v);
  const peak = new Set(order.slice(0, 16).map((o) => o.i));
  const valley = new Set(order.slice(-16).map((o) => o.i));

  const nodes: Record<string, NodeStep[]> = {};
  const batteries: GridSim["batteries"] = {};

  for (const town of TOWNS) {
    const bats = byTown.get(town.id) ?? [];
    const households = Math.round(town.lots / 0.4);
    const nonBaseHomes = Math.max(0, households - bats.length);
    const rating = nonBaseHomes * 1.5 * 1.28 + 40;
    const soc = bats.map(() => NAMEPLATE_KWH * 0.58);
    const charge = bats.map(() => Array(STEPS).fill(0) as number[]);
    const exp = bats.map(() => Array(STEPS).fill(0) as number[]);
    const home = bats.map(() => Array(STEPS).fill(0) as number[]);
    const socTrace = bats.map(() => Array(STEPS).fill(0) as number[]);
    const steps: NodeStep[] = [];

    for (let i = 0; i < STEPS; i++) {
      const nonBaseKw = nonBaseHomes * 1.5 * shape[i]!;
      const headroomKw = Math.max(0, rating - nonBaseKw);
      let chargeKw = 0;
      let exportKw = 0;
      let homeKw = 0;
      let floorBinding = false;
      const hour = Math.floor(i / 4);

      if (policy === "headroom_prorata") {
        const r = chargeShare(soc, headroomKw, charge, i);
        for (let j = 0; j < soc.length; j++) soc[j] = r.soc[j]!;
        chargeKw = r.kw;
      } else if (policy === "peak_shave_node") {
        if (valley.has(i)) {
          const r = chargeShare(soc, headroomKw, charge, i);
          for (let j = 0; j < soc.length; j++) soc[j] = r.soc[j]!;
          chargeKw = r.kw;
        } else if (peak.has(i)) {
          const r = dischargeShare(soc, home, i);
          for (let j = 0; j < soc.length; j++) soc[j] = r.soc[j]!;
          homeKw = r.kw;
          floorBinding = r.binding;
        }
      } else if (policy === "tou_follow") {
        if (hour < 4) {
          const r = chargeShare(soc, headroomKw, charge, i);
          for (let j = 0; j < soc.length; j++) soc[j] = r.soc[j]!;
          chargeKw = r.kw;
        } else if (hour >= 16 && hour < 20) {
          const r = dischargeShare(soc, exp, i);
          for (let j = 0; j < soc.length; j++) soc[j] = r.soc[j]!;
          exportKw = r.kw;
          floorBinding = r.binding;
        }
      }

      for (let j = 0; j < bats.length; j++) socTrace[j]![i] = soc[j]!;
      steps.push({
        nonBaseKw,
        headroomKw,
        chargeKw,
        exportKw,
        homeKw,
        floorBinding,
        batteries: bats.length,
      });
    }

    nodes[town.id] = steps;
    for (let j = 0; j < bats.length; j++) {
      batteries[bats[j]!.id] = {
        charge: charge[j]!,
        exportKw: exp[j]!,
        home: home[j]!,
        soc: socTrace[j]!,
      };
    }
  }

  return { nodes, batteries };
}

export function householdCount(townId: string): number {
  return Math.round(townById(townId).lots / 0.4);
}

export function lotRoadMiles(lot: Lot, pinId: string): number {
  const pin = pinById(pinId);
  return roadMiles(pin.lat, pin.lon, lot.lat, lot.lon);
}

export const POLICY_COPY: Record<
  PolicyId,
  { name: string; short: string; body: string }
> = {
  reserve_hold: {
    name: "Reserve hold",
    short: "Keep the 20% reserve. Do not charge or discharge for the grid.",
    body: "Each pack must stay at least 20% full. This policy does nothing else — no cheap-hour fill, no peak help. Use it for a storm watch or a node that is already tight. Pulses stay off.",
  },
  headroom_prorata: {
    name: "Headroom pro-rata",
    short: "Share whatever pipe the neighbors are not using.",
    body: "Leftover transformer capacity is split across Base packs in proportion to how empty each one is. Everyday default. Packs still cannot pull more than 11 kW each, and nothing goes below 20%.",
  },
  peak_shave_node: {
    name: "Peak shave",
    short: "Charge the quiet hours. Cover the house on the local peak.",
    body: "Uses the weather-zone shape, not the statewide price. Bottom load hours: charge from spare pipe. Top load hours: the pack covers the house (a glow, not a grid export). Other hours sit still.",
  },
  tou_follow: {
    name: "TOU follow",
    short: "Charge the cheap hours. Send power back on the dear hours.",
    body: "Time-of-use. Midnight to 4am charges. 4pm to 8pm pushes power back into the transformer — the reverse arrow, which is the sellback preview. Still clipped by the 20% floor and the 11 kW inverter.",
  },
};

export function planJson(plan: Plan) {
  return {
    horizon_months: HORIZON,
    x_pct: plan.input.xPct,
    sla_miles: plan.input.sla,
    mes_monthly_cap: plan.input.mes,
    reserve_floor: RESERVE_FLOOR,
    circuity: CIRCUITY,
    summary: plan.summary,
    factory: FACTORY,
    unlocks: plan.input.unlocks,
    warehouses: plan.opens.map((o) => ({
      pin_id: o.id,
      name: pinById(o.id).name,
      detail: pinById(o.id).detail,
      open_month: o.openMonth,
      reason: o.reason,
      lots: o.lotCount,
      lat: pinById(o.id).lat,
      lon: pinById(o.id).lon,
    })),
    myopic: plan.myopic.map((m) => ({
      pin_id: m.id,
      name: pinById(m.id).name,
      open_month: m.month,
    })),
    months: Array.from({ length: HORIZON }, (_, m) => ({
      month: m,
      kits: plan.lots.filter((l) => l.month === m).length,
    })),
  };
}

export { COUNTIES, FACTORY, HORIZON, PINS, ROADS, TERRITORIES, TOWNS, project };
