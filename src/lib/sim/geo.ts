/** Scenario geography for the Central Texas fringe corridor.
 *  Towns and roads use real coordinates. Territory polygons are scenario
 *  stand-ins, not surveyed utility boundaries.
 */

export const HORIZON = 24;
export const WORLD_W = 1100;
export const WORLD_H = 780;
export const NAMEPLATE_KWH = 39.2;
export const RESERVE_FLOOR = 0.2;
export const INVERTER_KW = 11;
export const PIN_MONTHLY_CAP = 420;
export const CIRCUITY = 1.35;

const LAT0 = 29.5;
const LAT1 = 31.08;
const LON0 = -97.88;
const LON1 = -96.18;

export type TerritoryKind = "competitive" | "coop";

export type Territory = {
  id: string;
  name: string;
  kind: TerritoryKind;
  /** Default unlock month. null = never. */
  defaultUnlock: number | null;
  blurb: string;
};

export type Town = {
  id: string;
  name: string;
  county: string;
  lat: number;
  lon: number;
  /** Eligible single-family lots we might install on. */
  lots: number;
  territoryId: string;
};

export type Pin = {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lon: number;
};

export const TERRITORIES: Territory[] = [
  {
    id: "oncor",
    name: "Oncor fringe",
    kind: "competitive",
    defaultUnlock: 0,
    blurb: "Retail choice around Bastrop and Elgin. Starts clear.",
  },
  {
    id: "lee",
    name: "Lee co-op",
    kind: "coop",
    defaultUnlock: 8,
    blurb: "Giddings and Lexington. Needs a co-op agreement.",
  },
  {
    id: "washington",
    name: "Washington co-op",
    kind: "coop",
    defaultUnlock: 10,
    blurb: "Brenham and the US-290 east corridor.",
  },
  {
    id: "fayette",
    name: "Fayette co-op",
    kind: "coop",
    defaultUnlock: 14,
    blurb: "La Grange, Schulenburg, Flatonia.",
  },
  {
    id: "burleson",
    name: "Burleson co-op",
    kind: "coop",
    defaultUnlock: 18,
    blurb: "Caldwell and Snook.",
  },
  {
    id: "milam",
    name: "Milam co-op",
    kind: "coop",
    defaultUnlock: null,
    blurb: "Cameron and Rockdale. Stays locked unless you set a month.",
  },
];

export const UNLOCK_STOPS: Array<number | null> = [0, 4, 8, 10, 14, 18, 22, null];

export const TOWNS: Town[] = [
  { id: "bastrop", name: "Bastrop", county: "Bastrop", lat: 30.11, lon: -97.315, lots: 90, territoryId: "oncor" },
  { id: "elgin", name: "Elgin", county: "Bastrop", lat: 30.349, lon: -97.37, lots: 70, territoryId: "oncor" },
  { id: "smithville", name: "Smithville", county: "Bastrop", lat: 30.008, lon: -97.159, lots: 36, territoryId: "oncor" },
  { id: "cedar", name: "Cedar Creek", county: "Bastrop", lat: 30.086, lon: -97.501, lots: 40, territoryId: "oncor" },
  { id: "paige", name: "Paige", county: "Bastrop", lat: 30.21, lon: -97.114, lots: 14, territoryId: "oncor" },
  { id: "mcdade", name: "McDade", county: "Bastrop", lat: 30.284, lon: -97.24, lots: 12, territoryId: "oncor" },
  { id: "giddings", name: "Giddings", county: "Lee", lat: 30.183, lon: -96.937, lots: 42, territoryId: "lee" },
  { id: "lexington", name: "Lexington", county: "Lee", lat: 30.414, lon: -97.01, lots: 18, territoryId: "lee" },
  { id: "dimebox", name: "Dime Box", county: "Lee", lat: 30.357, lon: -96.824, lots: 10, territoryId: "lee" },
  { id: "lagrange", name: "La Grange", county: "Fayette", lat: 29.906, lon: -96.877, lots: 40, territoryId: "fayette" },
  { id: "schulenburg", name: "Schulenburg", county: "Fayette", lat: 29.682, lon: -96.903, lots: 22, territoryId: "fayette" },
  { id: "flatonia", name: "Flatonia", county: "Fayette", lat: 29.688, lon: -97.107, lots: 14, territoryId: "fayette" },
  { id: "roundtop", name: "Round Top", county: "Fayette", lat: 30.065, lon: -96.696, lots: 8, territoryId: "fayette" },
  { id: "brenham", name: "Brenham", county: "Washington", lat: 30.167, lon: -96.398, lots: 86, territoryId: "washington" },
  { id: "burton", name: "Burton", county: "Washington", lat: 30.182, lon: -96.596, lots: 10, territoryId: "washington" },
  { id: "somerville", name: "Somerville", county: "Washington", lat: 30.344, lon: -96.528, lots: 12, territoryId: "washington" },
  { id: "caldwell", name: "Caldwell", county: "Burleson", lat: 30.532, lon: -96.693, lots: 28, territoryId: "burleson" },
  { id: "snook", name: "Snook", county: "Burleson", lat: 30.49, lon: -96.471, lots: 8, territoryId: "burleson" },
  { id: "cameron", name: "Cameron", county: "Milam", lat: 30.855, lon: -96.977, lots: 32, territoryId: "milam" },
  { id: "rockdale", name: "Rockdale", county: "Milam", lat: 30.655, lon: -97.002, lots: 30, territoryId: "milam" },
  { id: "thorndale", name: "Thorndale", county: "Milam", lat: 30.613, lon: -97.205, lots: 12, territoryId: "milam" },
  { id: "milano", name: "Milano", county: "Milam", lat: 30.711, lon: -96.863, lots: 8, territoryId: "milam" },
];

export const PINS: Pin[] = [
  { id: "elgin", name: "Elgin yard", detail: "US-290 / SH-95", lat: 30.349, lon: -97.37 },
  { id: "bastrop", name: "Bastrop junction", detail: "SH-71 / SH-21", lat: 30.11, lon: -97.315 },
  { id: "smithville", name: "Smithville frontage", detail: "SH-71", lat: 30.008, lon: -97.159 },
  { id: "giddings", name: "Giddings cross", detail: "US-290 / US-77", lat: 30.183, lon: -96.937 },
  { id: "lagrange", name: "La Grange", detail: "US-77 / SH-71", lat: 29.906, lon: -96.877 },
  { id: "schulenburg", name: "Schulenburg", detail: "US-77", lat: 29.682, lon: -96.903 },
  { id: "brenham", name: "Brenham hub", detail: "US-290", lat: 30.167, lon: -96.398 },
  { id: "caldwell", name: "Caldwell", detail: "SH-36 / SH-21", lat: 30.532, lon: -96.693 },
  { id: "cameron", name: "Cameron", detail: "US-77 / US-190", lat: 30.855, lon: -96.977 },
  { id: "rockdale", name: "Rockdale spur", detail: "US-79", lat: 30.655, lon: -97.002 },
];

export const FACTORY = {
  id: "bf1",
  name: "BF1 Austin",
  detail: "Kit source. Not sited by this solve.",
  lat: 30.26,
  lon: -97.735,
};

export const COUNTIES: { id: string; name: string; territoryId: string; ring: Array<[number, number]> }[] = [
  {
    id: "bastrop",
    name: "Bastrop",
    territoryId: "oncor",
    ring: [
      [30.02, -97.62],
      [30.18, -97.58],
      [30.34, -97.42],
      [30.36, -97.16],
      [30.22, -97.0],
      [29.98, -97.02],
      [29.9, -97.28],
      [29.94, -97.52],
    ],
  },
  {
    id: "lee",
    name: "Lee",
    territoryId: "lee",
    ring: [
      [30.14, -97.18],
      [30.28, -97.22],
      [30.5, -97.08],
      [30.52, -96.72],
      [30.32, -96.66],
      [30.14, -96.86],
    ],
  },
  {
    id: "fayette",
    name: "Fayette",
    territoryId: "fayette",
    ring: [
      [29.58, -97.22],
      [29.78, -97.26],
      [29.98, -97.08],
      [30.08, -96.68],
      [29.86, -96.52],
      [29.58, -96.62],
      [29.52, -96.98],
    ],
  },
  {
    id: "washington",
    name: "Washington",
    territoryId: "washington",
    ring: [
      [30.04, -96.72],
      [30.22, -96.78],
      [30.46, -96.58],
      [30.42, -96.22],
      [30.14, -96.18],
      [30.0, -96.46],
    ],
  },
  {
    id: "burleson",
    name: "Burleson",
    territoryId: "burleson",
    ring: [
      [30.34, -96.9],
      [30.48, -96.96],
      [30.72, -96.78],
      [30.7, -96.42],
      [30.46, -96.36],
      [30.34, -96.62],
    ],
  },
  {
    id: "milam",
    name: "Milam",
    territoryId: "milam",
    ring: [
      [30.56, -97.32],
      [30.74, -97.3],
      [31.04, -97.08],
      [31.02, -96.66],
      [30.74, -96.68],
      [30.58, -96.98],
    ],
  },
];

/** [lat, lon] polylines for the highways kits roughly follow. */
export const ROADS: { name: string; pts: Array<[number, number]> }[] = [
  {
    name: "US-290",
    pts: [
      [30.33, -97.62],
      [30.349, -97.37],
      [30.284, -97.24],
      [30.183, -96.937],
      [30.182, -96.596],
      [30.167, -96.398],
    ],
  },
  {
    name: "SH-71",
    pts: [
      [30.09, -97.62],
      [30.11, -97.315],
      [30.008, -97.159],
      [29.906, -96.877],
      [29.92, -96.55],
    ],
  },
  {
    name: "US-77",
    pts: [
      [30.855, -96.977],
      [30.711, -96.863],
      [30.183, -96.937],
      [29.906, -96.877],
      [29.682, -96.903],
      [29.62, -96.92],
    ],
  },
  {
    name: "SH-21",
    pts: [
      [30.11, -97.315],
      [30.21, -97.114],
      [30.35, -96.9],
      [30.532, -96.693],
    ],
  },
  {
    name: "US-190",
    pts: [
      [30.613, -97.205],
      [30.655, -97.002],
      [30.855, -96.977],
      [30.78, -96.75],
    ],
  },
];

export function project(lat: number, lon: number): { x: number; y: number } {
  return {
    x: ((lon - LON0) / (LON1 - LON0)) * WORLD_W,
    y: ((LAT1 - lat) / (LAT1 - LAT0)) * WORLD_H,
  };
}

export function unproject(x: number, y: number): { lat: number; lon: number } {
  return {
    lon: LON0 + (x / WORLD_W) * (LON1 - LON0),
    lat: LAT1 - (y / WORLD_H) * (LAT1 - LAT0),
  };
}

export function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roadMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return haversineMiles(aLat, aLon, bLat, bLon) * CIRCUITY;
}

export function territoryById(id: string): Territory {
  const t = TERRITORIES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown territory ${id}`);
  return t;
}

export function townById(id: string): Town {
  const t = TOWNS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown town ${id}`);
  return t;
}

export function pinById(id: string): Pin {
  const t = PINS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown pin ${id}`);
  return t;
}

export function defaultUnlocks(): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const t of TERRITORIES) out[t.id] = t.defaultUnlock;
  return out;
}

/** Miles scale bar in world pixels at the corridor center. */
export function milesToWorld(miles: number): number {
  const midLat = (LAT0 + LAT1) / 2;
  const lonPerMile = 1 / (69 * Math.cos((midLat * Math.PI) / 180));
  return miles * lonPerMile * (WORLD_W / (LON1 - LON0));
}
