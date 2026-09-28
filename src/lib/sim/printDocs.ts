import type { MissionFile } from "./mission";
import type { ScheduledNode, WbsRow, MrpRow } from "./mrp";
import { criticalPart, explodeMrp, flatten, markCritical, scheduleTree, wbsFor } from "./mrp";

export type SiteDoc = {
  siteId: string;
  name: string;
  address: string;
  needBy: string;
  tree: ScheduledNode;
  spanDays: number;
  critical: ScheduledNode;
  wbs: WbsRow[];
};

export function docsForMission(mission: MissionFile, needByOf: (siteId: string) => string): { sites: SiteDoc[]; mrp: MrpRow[] } {
  const sites = mission.sites.map((site) => {
    const needBy = needByOf(site.siteId);
    const tree = scheduleTree(site.tree, needBy);
    tree.critical = true;
    const spanDays = markCritical(tree);
    return {
      siteId: site.siteId,
      name: site.name,
      address: site.address,
      needBy,
      tree,
      spanDays,
      critical: criticalPart(tree),
      wbs: wbsFor(tree),
    };
  });
  return { sites, mrp: explodeMrp(sites.map((s) => s.tree)) };
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function treeHtml(node: ScheduledNode, depth = 0): string {
  const color = node.critical ? "#9d1c1c" : "#0c1210";
  const tag = node.critical ? " CRITICAL" : "";
  const kids = [node.left, node.right].filter(Boolean) as ScheduledNode[];
  return `<div style="margin-left:${depth * 16}px;color:${color};font-family:ui-monospace,monospace;font-size:12px;line-height:1.45">
    <strong>${esc(node.partId)}</strong>${tag} · ${node.leadDays}d · ${node.start} → ${node.finish} · qty ${node.quantity}
    ${kids.map((k) => treeHtml(k, depth + 1)).join("")}
  </div>`;
}

const PAGE = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:Georgia,serif;color:#0c1210;margin:32px;max-width:880px}
  h1{font-size:22px;margin:0 0 8px}
  h2{font-size:16px;margin:24px 0 8px}
  p,li{font-size:13px;line-height:1.45}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
  th{background:#0c1210;color:#fff}
  .crit{color:#9d1c1c;font-weight:700}
  .hint{color:#555;font-size:12px}
</style></head><body>
${body}
<p class="hint">Print this page to PDF. Need-by is the site finish date (commission + site lead_time). Part dates walk backward from that finish. Red is the critical path — the longest chain of lead times.</p>
</body></html>`;

export function bomHtml(doc: SiteDoc) {
  const body = `
    <h1>BOM tree · ${esc(doc.name)}</h1>
    <p>${esc(doc.address)}</p>
    <p>Root must finish <strong>${doc.needBy}</strong>. Critical path ${doc.spanDays} days. Longest single lead: <span class="crit">${esc(doc.critical.partId)} (${doc.critical.leadDays}d)</span>.</p>
    <h2>Tree (children before parent)</h2>
    ${treeHtml(doc.tree)}
    <h2>Nodes</h2>
    <table><tr><th>Part</th><th>Lead</th><th>Start</th><th>Finish</th><th>Qty</th><th>Path</th></tr>
    ${flatten(doc.tree).map((n) => `<tr class="${n.critical ? "crit" : ""}"><td>${esc(n.partId)}</td><td>${n.leadDays}</td><td>${n.start}</td><td>${n.finish}</td><td>${n.quantity}</td><td>${n.critical ? "critical" : ""}</td></tr>`).join("")}
    </table>`;
  return PAGE(`BOM ${doc.name}`, body);
}

export function wbsHtml(doc: SiteDoc) {
  const body = `
    <h1>WBS · ${esc(doc.name)}</h1>
    <p>Work packages for the contractor. Dates come from the bound BOM node. Finish of the parent is the site need-by ${doc.needBy}.</p>
    <table><tr><th>WBS</th><th>Task</th><th>Part</th><th>Lead</th><th>Start</th><th>Finish</th><th>Path</th></tr>
    ${doc.wbs.map((r) => `<tr class="${r.critical ? "crit" : ""}"><td>${r.wbs}</td><td>${esc(r.task)}</td><td>${esc(r.partId)}</td><td>${r.leadDays}</td><td>${r.start}</td><td>${r.finish}</td><td>${r.critical ? "critical" : ""}</td></tr>`).join("")}
    </table>`;
  return PAGE(`WBS ${doc.name}`, body);
}

export function sowHtml(docs: SiteDoc[], mrp: MrpRow[]) {
  const body = `
    <h1>Statement of Work</h1>
    <p>Each selected yard must be finished by its need-by. Need-by is commission date plus the site lead_time (fit-out days). The BOM does not move that finish date. It sets the start date of every child so the finish still hits need-by. If today is later than a start date, that line is late.</p>
    <h2>Sites</h2>
    <table><tr><th>Yard</th><th>Need-by (finish)</th><th>Critical start</th><th>Critical part</th><th>Path days</th></tr>
    ${docs.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.needBy}</td><td class="crit">${d.critical.start}</td><td class="crit">${esc(d.critical.partId)}</td><td>${d.spanDays}</td></tr>`).join("")}
    </table>
    <h2>MRP explosion</h2>
    <p>Same part number across yards uses the <em>earliest</em> start. That is when work on that part must begin for the whole program.</p>
    <table><tr><th>Part</th><th>Qty</th><th>Lead</th><th>Earliest start</th><th>Latest finish</th><th>Yards</th></tr>
    ${mrp.map((r) => `<tr class="${r.critical ? "crit" : ""}"><td>${esc(r.partId)}</td><td>${r.quantity}</td><td>${r.leadDays}</td><td>${r.earliestStart}</td><td>${r.latestFinish}</td><td>${r.sites}</td></tr>`).join("")}
    </table>`;
  return PAGE("Statement of Work", body);
}

export function downloadHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
