import type { Plan, Yard } from "./coverage";

/** One node in a site part tree. Left and right must be built before this node. */
export type PartNode = {
  partId: string;
  costCenter: string;
  costPerUnit: number;
  quantity: number;
  left: PartNode | null;
  right: PartNode | null;
};

export type MissionFile = {
  consumer: string;
  order: string;
  lead_time: string;
  costs: string;
  sites: {
    siteId: string;
    name: string;
    address: string;
    homes: number;
    sqft: number | null;
    tree: PartNode;
  }[];
};

function part(
  partId: string,
  costCenter: string,
  costPerUnit: number,
  quantity: number,
  left: PartNode | null,
  right: PartNode | null,
): PartNode {
  return { partId, costCenter, costPerUnit, quantity, left, right };
}

function treeFor(yard: Yard): PartNode {
  const packs = Math.max(0, Math.round(yard.homes));
  const sqft = yard.sqft ?? 80000;
  const cells = part("CELL-MODULE", "CC-CELL-IMPORT", 390, packs * 8, null, null);
  const bms = part("BMS-BOARD", "CC-AUSTIN-MES", 160, packs, null, null);
  const inverter = part("INVERTER-11", "CC-INVERTER", 980, packs, null, null);
  const enclosure = part("ENCLOSURE", "CC-AUSTIN-MES", 240, packs, null, null);
  const packCore = part("PACK-CORE", "CC-AUSTIN-MES", 70, packs, cells, bms);
  const packPower = part("PACK-POWER", "CC-AUSTIN-MES", 40, packs, inverter, enclosure);
  const pack = part("PACK-39.2", "CC-AUSTIN-MES", 120, packs, packCore, packPower);
  const breaker = part("BREAKER-PANEL", "CC-ELECTRICAL", 85, packs, null, null);
  const conduit = part("CONDUIT-KIT", "CC-ELECTRICAL", 45, packs, null, null);
  const install = part("INSTALL-KIT", "CC-FIELD", 210, packs, breaker, conduit);
  const homeLot = part("HOME-LOT", "CC-FIELD", 0, packs, pack, install);
  const steel = part("STEEL-BUILDING", "CC-GC", Math.round(sqft * 78), 1, null, null);
  const slab = part("SLAB", "CC-GC", Math.round(sqft * 14), 1, null, null);
  const rack = part("PALLET-RACK", "CC-YARD", 190, Math.max(1, Math.round(sqft / 500)), null, null);
  const sprinkler = part("SPRINKLER", "CC-GC", 32000, 1, null, null);
  const shell = part("YARD-SHELL", "CC-GC", 0, 1, steel, slab);
  const interior = part("YARD-INTERIOR", "CC-YARD", 0, 1, rack, sprinkler);
  const yardNode = part("YARD-COMMISSION", "CC-YARD", 0, 1, shell, interior);
  return part(`SITE-${yard.id}`, "CC-PROGRAM", 0, 1, yardNode, homeLot);
}

export function buildMission(plan: Plan): MissionFile {
  return {
    consumer:
      "MES or an external contractor. Each open yard is one site. The tree is the buy, make, and assemble list for that site.",
    order:
      "Post-order binary tree. Build the left child, then the right child, then the node. A node cannot start until both children are done.",
    lead_time: "Not in this file. The orchestration tool looks up lead time by partId.",
    costs: "costPerUnit is a planning rate in dollars, not a quote. Parent cost is only the step at that node, not the sum of the children.",
    sites: plan.yards.map((yard) => ({
      siteId: yard.id,
      name: yard.name,
      address: yard.address,
      homes: yard.homes,
      sqft: yard.sqft,
      tree: treeFor(yard),
    })),
  };
}
