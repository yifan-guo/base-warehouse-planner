import type { PartNode } from "./mission";

/** Days of work or wait at this node after both children are finished. Planning table, not a vendor quote. */
export const LEAD_DAYS: Record<string, number> = {
  "CELL-MODULE": 45,
  "BMS-BOARD": 21,
  "INVERTER-11": 30,
  "ENCLOSURE": 28,
  "PACK-CORE": 7,
  "PACK-POWER": 7,
  "PACK-39.2": 5,
  "BREAKER-PANEL": 14,
  "CONDUIT-KIT": 10,
  "INSTALL-KIT": 3,
  "HOME-LOT": 2,
  "STEEL-BUILDING": 60,
  "SLAB": 21,
  "PALLET-RACK": 21,
  "SPRINKLER": 35,
  "YARD-SHELL": 10,
  "YARD-INTERIOR": 14,
  "YARD-COMMISSION": 5,
};

export type ScheduledNode = PartNode & {
  leadDays: number;
  start: string;
  finish: string;
  critical: boolean;
  left: ScheduledNode | null;
  right: ScheduledNode | null;
};

export type MrpRow = {
  partId: string;
  quantity: number;
  leadDays: number;
  earliestStart: string;
  latestFinish: string;
  sites: number;
  critical: boolean;
};

export type WbsRow = {
  wbs: string;
  task: string;
  partId: string;
  start: string;
  finish: string;
  leadDays: number;
  critical: boolean;
};

function addDays(iso: string, days: number) {
  const t = Date.parse(iso.slice(0, 10) + "T00:00:00Z");
  const d = new Date(t + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function leadOf(partId: string) {
  if (partId.startsWith("SITE-")) return 1;
  return LEAD_DAYS[partId] ?? 7;
}

/** Site must finish on needBy. Children finish before the parent starts. */
export function scheduleTree(node: PartNode, finish: string): ScheduledNode {
  const leadDays = leadOf(node.partId);
  const start = addDays(finish, -leadDays);
  const left = node.left ? scheduleTree(node.left, start) : null;
  const right = node.right ? scheduleTree(node.right, start) : null;
  return {
    ...node,
    leadDays,
    start,
    finish,
    critical: false,
    left,
    right,
  };
}

export function markCritical(node: ScheduledNode): number {
  const leftSpan = node.left ? markCritical(node.left) : 0;
  const rightSpan = node.right ? markCritical(node.right) : 0;
  if (node.left && leftSpan >= rightSpan) node.left.critical = true;
  else if (node.right) node.right.critical = true;
  return node.leadDays + Math.max(leftSpan, rightSpan);
}

export function flatten(node: ScheduledNode, acc: ScheduledNode[] = []): ScheduledNode[] {
  if (node.left) flatten(node.left, acc);
  if (node.right) flatten(node.right, acc);
  acc.push(node);
  return acc;
}

export function explodeMrp(trees: ScheduledNode[]): MrpRow[] {
  const by = new Map<string, MrpRow>();
  for (const tree of trees) {
    for (const node of flatten(tree)) {
      const key = node.partId.startsWith("SITE-") ? "SITE" : node.partId;
      const row = by.get(key);
      if (!row) {
        by.set(key, {
          partId: key,
          quantity: node.quantity,
          leadDays: node.leadDays,
          earliestStart: node.start,
          latestFinish: node.finish,
          sites: 1,
          critical: node.critical,
        });
      } else {
        row.quantity += node.quantity;
        row.sites += 1;
        if (node.start < row.earliestStart) row.earliestStart = node.start;
        if (node.finish > row.latestFinish) row.latestFinish = node.finish;
        row.critical = row.critical || node.critical;
      }
    }
  }
  return [...by.values()].sort((a, b) => a.earliestStart.localeCompare(b.earliestStart));
}

const WBS_BIND: { wbs: string; task: string; partId: string }[] = [
  { wbs: "1", task: "Open yard", partId: "SITE" },
  { wbs: "1.1", task: "Civil and shell", partId: "YARD-SHELL" },
  { wbs: "1.1.1", task: "Slab", partId: "SLAB" },
  { wbs: "1.1.2", task: "Steel building", partId: "STEEL-BUILDING" },
  { wbs: "1.2", task: "Yard interior", partId: "YARD-INTERIOR" },
  { wbs: "1.2.1", task: "Racks", partId: "PALLET-RACK" },
  { wbs: "1.2.2", task: "Sprinkler", partId: "SPRINKLER" },
  { wbs: "1.3", task: "Commission yard", partId: "YARD-COMMISSION" },
  { wbs: "1.4", task: "Pack line", partId: "PACK-39.2" },
  { wbs: "1.4.1", task: "Import cells", partId: "CELL-MODULE" },
  { wbs: "1.4.2", task: "Inverter", partId: "INVERTER-11" },
  { wbs: "1.5", task: "Field kits", partId: "INSTALL-KIT" },
  { wbs: "1.6", task: "Home lot ready to install", partId: "HOME-LOT" },
];

export function wbsFor(tree: ScheduledNode): WbsRow[] {
  const nodes = flatten(tree);
  return WBS_BIND.map((bind) => {
    const hit =
      bind.partId === "SITE"
        ? nodes.find((n) => n.partId.startsWith("SITE-"))
        : nodes.find((n) => n.partId === bind.partId);
    return {
      wbs: bind.wbs,
      task: bind.task,
      partId: hit?.partId ?? bind.partId,
      start: hit?.start ?? "",
      finish: hit?.finish ?? "",
      leadDays: hit?.leadDays ?? leadOf(bind.partId),
      critical: hit?.critical ?? false,
    };
  });
}

/** Lot commission and fit-out days from lot-facts.json. Site lead_time is fit-out after the building is available, not a part lead. */
export const SITE_READY: Record<string, { commission: string; lead: number }> = {
  "alliance-gateway": { commission: "2025-01-15", lead: 45 },
  "hillwood-parkway": { commission: "2025-02-01", lead: 45 },
  "independence-pkwy": { commission: "2025-04-01", lead: 60 },
  jacintoport: { commission: "2024-11-01", lead: 30 },
  "greens-port": { commission: "2026-08-01", lead: 75 },
  "houston-navigation": { commission: "2027-11-01", lead: 60 },
  "regal-row": { commission: "2024-06-01", lead: 30 },
  "sh-360-grand-prairie": { commission: "2025-09-01", lead: 45 },
  "ctx-killeen": { commission: "2025-05-01", lead: 45 },
  "industrial-blvd-temple": { commission: "2025-07-01", lead: 60 },
  "loop-323-tyler": { commission: "2025-03-01", lead: 45 },
  "longview-loop": { commission: "2026-01-15", lead: 60 },
  "laredo-market": { commission: "2025-08-01", lead: 45 },
  "mcallen-expwy": { commission: "2025-06-01", lead: 30 },
  "lubbock-slaton": { commission: "2025-04-01", lead: 45 },
  "midland-wall": { commission: "2025-10-01", lead: 60 },
  "odessa-8th": { commission: "2026-02-01", lead: 45 },
  "abilene-loop": { commission: "2025-12-01", lead: 45 },
  "ben-jordan-victoria": { commission: "2025-05-01", lead: 30 },
  "kell-wichita-falls": { commission: "2025-06-01", lead: 45 },
  "sherwood-san-angelo": { commission: "2025-03-01", lead: 30 },
  "veterans-del-rio": { commission: "2025-09-01", lead: 60 },
  eisenhauer: { commission: "2025-01-01", lead: 45 },
  cornerway: { commission: "2025-01-01", lead: 45 },
  "rojas-el-paso": { commission: "2025-01-01", lead: 45 },
  "sh-21-bryan": { commission: "2025-01-01", lead: 45 },
  "i-40-amarillo": { commission: "2025-01-01", lead: 45 },
};

/** Need-by = commission + site lead_time. That is the finish date of the root, not a part start. */
export function siteNeedBy(siteId: string, commissionDate?: string, siteLeadDays?: number, fallback = "2026-11-01") {
  const known = SITE_READY[siteId];
  const commission = commissionDate ?? known?.commission;
  const lead = siteLeadDays ?? known?.lead ?? 0;
  if (!commission) return fallback;
  return addDays(commission, lead);
}

export function criticalPart(tree: ScheduledNode): ScheduledNode {
  const nodes = flatten(tree).filter((n) => n.critical);
  return nodes.sort((a, b) => b.leadDays - a.leadDays)[0] ?? tree;
}
