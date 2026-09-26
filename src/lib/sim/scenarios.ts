import type { CoverageData, County, Drag, Lot } from "./coverage";
import { miles } from "./coverage";

export type ScenarioId = "baseline" | "outage" | "commissioned" | "pullout";

export type Approval = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_miles: number;
  install_sites: number;
  min_kwh_usage: number;
  max_kwh_usage: number;
  start_date: string;
};

export type SiteStatus = "leased" | "candidate" | "outage" | "cancelled";

export type SiteRecord = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  sq_ft: number;
  county?: string;
  commission_date?: string;
  lead_time_days?: number;
  outage_days?: number;
  status: SiteStatus;
};

export type RunInputs = {
  phase: 1 | 2;
  maxMiles: number;
  homesPerTech: number;
  scenario: ScenarioId;
  approvals: Approval[] | null;
  sites: SiteRecord[] | null;
  drag: Drag | null;
};

export const SCENARIOS: { id: ScenarioId; name: string; detail: string }[] = [
  {
    id: "baseline",
    name: "Baseline",
    detail: "Every permitted lot stays open. Demand is finished homes. Permits stay under construction.",
  },
  {
    id: "outage",
    name: "Yard outage",
    detail: "Jacintoport is down for 14 days. It drops out of the candidate list. Other yards take the counties they can still staff.",
  },
  {
    id: "commissioned",
    name: "Neighborhoods commissioned",
    detail: "2024 permits become finished homes. Under construction goes to zero and those homes join demand.",
  },
  {
    id: "pullout",
    name: "REP pullout",
    detail: "Abilene Loop started before the approval. The REP cancelled. That lot closes and Taylor County is not zoned.",
  },
];

const OUTAGE_ID = "jacintoport";
const PULLOUT_ID = "abilene-loop";

export function lotsToSites(lots: Lot[]): SiteRecord[] {
  return lots
    .filter((lot) => lot.permitted)
    .map((lot) => ({
      id: lot.id,
      name: lot.name,
      address: lot.address,
      lat: lot.lat,
      lon: lot.lon,
      sq_ft: lot.sqft,
      county: lot.county,
      status: "leased" as const,
    }));
}

export function parseApprovals(raw: unknown): Approval[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { approvals?: unknown }).approvals) ? (raw as { approvals: unknown[] }).approvals : null;
  if (!list) throw new Error("Approvals file must be a JSON array.");
  return list.map((row, i) => {
    const item = row as Partial<Approval>;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const radius = Number(item.radius_miles);
    const installs = Number(item.install_sites);
    if (!item.id || !item.name || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius) || !Number.isFinite(installs)) {
      throw new Error(`Approval row ${i + 1} needs id, name, lat, lon, radius_miles, install_sites.`);
    }
    return {
      id: String(item.id),
      name: String(item.name),
      lat,
      lon,
      radius_miles: radius,
      install_sites: installs,
      min_kwh_usage: Number(item.min_kwh_usage ?? 39.2),
      max_kwh_usage: Number(item.max_kwh_usage ?? 39.2),
      start_date: String(item.start_date ?? ""),
    };
  });
}

export function parseSites(raw: unknown): SiteRecord[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { sites?: unknown }).sites) ? (raw as { sites: unknown[] }).sites : null;
  if (!list) throw new Error("Sites file must be a JSON array.");
  return list.map((row, i) => {
    const item = row as Partial<SiteRecord>;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const sqft = Number(item.sq_ft);
    if (!item.id || !item.name || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(sqft)) {
      throw new Error(`Site row ${i + 1} needs id, name, lat, lon, sq_ft.`);
    }
    const status: SiteStatus =
      item.status === "outage" || item.status === "cancelled" || item.status === "candidate" || item.status === "leased" ? item.status : "leased";
    return {
      id: String(item.id),
      name: String(item.name),
      address: String(item.address ?? ""),
      lat,
      lon,
      sq_ft: sqft,
      county: item.county ? String(item.county) : undefined,
      commission_date: item.commission_date ? String(item.commission_date) : undefined,
      lead_time_days: item.lead_time_days == null ? undefined : Number(item.lead_time_days),
      outage_days: item.outage_days == null ? undefined : Number(item.outage_days),
      status,
    };
  });
}

function nearestCounty(counties: County[], lat: number, lon: number) {
  let best: County | null = null;
  let bestD = Infinity;
  for (const county of counties) {
    const d = miles(county.lat, county.lon, lat, lon);
    if (d < bestD) {
      bestD = d;
      best = county;
    }
  }
  return bestD <= 80 ? best : null;
}

export function applyRun(base: CoverageData, inputs: RunInputs): { data: CoverageData; note: string } {
  let counties: County[] = base.counties.map((county) => ({ ...county }));
  let lots: Lot[] = base.lots.map((lot) => ({ ...lot }));
  const notes: string[] = [];

  if (inputs.scenario === "commissioned") {
    counties = counties.map((county) => ({ ...county, homes: county.homes + county.permits, permits: 0 }));
    notes.push("2024 permits are now finished homes. Under construction is zero.");
  }

  if (inputs.sites) {
    lots = inputs.sites.map((site) => {
      const prior = base.lots.find((lot) => lot.id === site.id);
      const county =
        (site.county ? counties.find((c) => c.name === site.county || c.id === site.county) : null) ??
        (prior?.countyId ? counties.find((c) => c.id === prior.countyId) : null) ??
        nearestCounty(counties, site.lat, site.lon);
      const open = site.status === "leased" || site.status === "candidate";
      return {
        id: site.id,
        name: site.name,
        address: site.address,
        lat: site.lat,
        lon: site.lon,
        county: county?.name ?? site.county ?? "",
        countyId: county?.id ?? null,
        sqft: site.sq_ft,
        permitted: open,
      };
    });
    const down = inputs.sites.filter((site) => site.status === "outage" || site.status === "cancelled");
    if (down.length) {
      notes.push(
        down
          .map((site) =>
            site.status === "outage"
              ? `${site.name} is out for ${site.outage_days ?? 14} days`
              : `${site.name} is cancelled`,
          )
          .join(". ") + ".",
      );
    }
    for (const site of inputs.sites) {
      if (site.status !== "cancelled") continue;
      const county = nearestCounty(counties, site.lat, site.lon);
      if (!county) continue;
      counties = counties.map((item) => (item.id === county.id ? { ...item, zoned: false, campaign: 0 } : item));
    }
  }

  if (inputs.scenario === "outage") {
    lots = lots.map((lot) => (lot.id === OUTAGE_ID ? { ...lot, permitted: false } : lot));
    const already = inputs.sites?.some((site) => site.id === OUTAGE_ID && site.status === "outage");
    if (!already) notes.push("Jacintoport is out for 14 days and is not a candidate. Remaining yards take what their crews can carry.");
  }

  if (inputs.scenario === "pullout") {
    lots = lots.map((lot) => (lot.id === PULLOUT_ID ? { ...lot, permitted: false } : lot));
    const lot = base.lots.find((item) => item.id === PULLOUT_ID);
    const countyId = lot?.countyId;
    if (countyId) counties = counties.map((county) => (county.id === countyId ? { ...county, zoned: false, campaign: 0 } : county));
    const already = inputs.sites?.some((site) => site.id === PULLOUT_ID && site.status === "cancelled");
    if (!already) notes.push("Abilene Loop is cancelled. Work started before approval and the REP pulled out. Taylor County is not zoned.");
    else notes.push("Work had started before approval. The REP pulled out, so Taylor County is not zoned and that yard cannot open.");
  }

  if (inputs.approvals && inputs.approvals.length) {
    const add = new Map<string, number>();
    const touched = new Set<string>();
    for (const approval of inputs.approvals) {
      const inside = counties.filter((county) => miles(county.lat, county.lon, approval.lat, approval.lon) <= approval.radius_miles);
      const weight = inside.reduce((sum, county) => sum + county.homes, 0);
      for (const county of inside) {
        touched.add(county.id);
        const share = weight > 0 ? Math.round((approval.install_sites * county.homes) / weight) : 0;
        add.set(county.id, (add.get(county.id) ?? 0) + share);
      }
    }
    counties = counties.map((county) => {
      if (county.zoned === false) return { ...county, campaign: 0 };
      if (!touched.has(county.id)) return { ...county, zoned: false, campaign: 0 };
      return { ...county, zoned: true, campaign: add.get(county.id) ?? 0 };
    });
    const installs = inputs.approvals.reduce((sum, approval) => sum + approval.install_sites, 0);
    notes.push(`${inputs.approvals.length} approvals cap demand at ${installs.toLocaleString()} install sites. Counties outside those radii are not zoned.`);
  }

  if (!notes.length) notes.push("Baseline. No approval cap. Every finished home on a corridor is demand.");

  return {
    data: { ...base, counties, lots },
    note: notes.join(" "),
  };
}
