import type { ScheduledNode, WbsRow } from "./mrp";

type Laid = {
  id: string;
  label: string;
  sub: string;
  critical: boolean;
  side: "" | "L" | "R";
  x: number;
  y: number;
  w: number;
  children: Laid[];
};

const BOX_W = 118;
const BOX_H = 42;
const ROW = 78;
const GAP = 16;

function measure(node: Laid): number {
  if (!node.children.length) {
    node.w = BOX_W;
    return node.w;
  }
  let span = 0;
  for (const child of node.children) {
    if (span) span += GAP;
    span += measure(child);
  }
  node.w = Math.max(BOX_W, span);
  return node.w;
}

function place(node: Laid, left: number, top: number) {
  node.x = left + node.w / 2;
  node.y = top;
  let cursor = left + (node.w - childSpan(node)) / 2;
  for (const child of node.children) {
    place(child, cursor, top + ROW);
    cursor += child.w + GAP;
  }
}

function childSpan(node: Laid) {
  if (!node.children.length) return BOX_W;
  return node.children.reduce((s, c, i) => s + c.w + (i ? GAP : 0), 0);
}

function fromBom(node: ScheduledNode, side: "" | "L" | "R" = ""): Laid {
  const children: Laid[] = [];
  if (node.left) children.push(fromBom(node.left, "L"));
  if (node.right) children.push(fromBom(node.right, "R"));
  return {
    id: node.partId,
    label: node.partId,
    sub: `${node.leadDays}d  ${node.start} → ${node.finish}`,
    critical: node.critical,
    side,
    x: 0,
    y: 0,
    w: 0,
    children,
  };
}

function fromWbs(rows: WbsRow[]): Laid {
  const map = new Map<string, Laid & { wbs: string }>();
  for (const row of rows) {
    map.set(row.wbs, {
      id: row.wbs,
      wbs: row.wbs,
      label: `${row.wbs}  ${row.task}`,
      sub: `${row.leadDays}d  ${row.start} → ${row.finish}`,
      critical: row.critical,
      side: "",
      x: 0,
      y: 0,
      w: 0,
      children: [],
    });
  }
  let root: Laid | null = null;
  for (const row of rows) {
    const node = map.get(row.wbs)!;
    const parentCode = row.wbs.includes(".") ? row.wbs.slice(0, row.wbs.lastIndexOf(".")) : "";
    const parent = parentCode ? map.get(parentCode) : null;
    if (parent) parent.children.push(node);
    else root = node;
  }
  return root ?? { id: "1", label: "WBS", sub: "", critical: false, side: "", x: 0, y: 0, w: BOX_W, children: [] };
}

function flatten(node: Laid, acc: Laid[] = []): Laid[] {
  acc.push(node);
  for (const child of node.children) flatten(child, acc);
  return acc;
}

function pdfEscape(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function streamFor(title: string, root: Laid, pageW: number, pageH: number) {
  const cmds: string[] = [];
  const push = (s: string) => cmds.push(s);
  push("0.05 0.07 0.06 rg");
  push("BT /F1 11 Tf 36  " + (pageH - 28) + " Td (" + pdfEscape(title) + ") Tj ET");
  push("BT /F2 8 Tf 36 " + (pageH - 42) + " Td (Left / right children. Red = critical path. Start is backward from the root finish.) Tj ET");

  const nodes = flatten(root);
  for (const node of nodes) {
    for (const child of node.children) {
      const x1 = node.x;
      const y1 = pageH - node.y - BOX_H;
      const x2 = child.x;
      const y2 = pageH - child.y;
      if (child.critical && node.critical) push("0.62 0.11 0.11 RG 1.4 w");
      else push("0.45 0.5 0.48 RG 0.8 w");
      push(`${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`);
    }
  }
  for (const node of nodes) {
    const x = node.x - BOX_W / 2;
    const y = pageH - node.y - BOX_H;
    if (node.critical) {
      push("0.98 0.92 0.92 rg");
      push("0.62 0.11 0.11 RG 1.3 w");
    } else {
      push("0.96 0.97 0.96 rg");
      push("0.12 0.16 0.14 RG 0.8 w");
    }
    push(`${x.toFixed(1)} ${y.toFixed(1)} ${BOX_W} ${BOX_H} re B`);
    if (node.side) {
      push("BT /F2 7 Tf " + (x + 4).toFixed(1) + " " + (y + BOX_H - 10).toFixed(1) + " Td (" + node.side + ") Tj ET");
    }
    const ink = node.critical ? "0.62 0.11 0.11 rg" : "0.05 0.07 0.06 rg";
    push(ink);
    const label = node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label;
    push("BT /F1 7.5 Tf " + (x + 14).toFixed(1) + " " + (y + 24).toFixed(1) + " Td (" + pdfEscape(label) + ") Tj ET");
    push("BT /F2 6.5 Tf " + (x + 6).toFixed(1) + " " + (y + 10).toFixed(1) + " Td (" + pdfEscape(node.sub) + ") Tj ET");
  }
  return cmds.join("\n");
}

function wrapPdf(stream: string, pageW: number, pageH: number) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}

function layoutPage(root: Laid) {
  measure(root);
  const margin = 48;
  place(root, margin, 56);
  const depth = maxDepth(root);
  const pageW = Math.max(1100, Math.ceil(root.w + margin * 2));
  const pageH = Math.max(700, 56 + depth * ROW + BOX_H + 40);
  return { pageW, pageH };
}

function maxDepth(node: Laid): number {
  if (!node.children.length) return 1;
  return 1 + Math.max(...node.children.map(maxDepth));
}

export function bomTreePdf(title: string, tree: ScheduledNode): Uint8Array {
  const root = fromBom(tree);
  const { pageW, pageH } = layoutPage(root);
  return wrapPdf(streamFor(title, root, pageW, pageH), pageW, pageH);
}

export function wbsTreePdf(title: string, rows: WbsRow[]): Uint8Array {
  const root = fromWbs(rows);
  const { pageW, pageH } = layoutPage(root);
  return wrapPdf(streamFor(title, root, pageW, pageH), pageW, pageH);
}

function crc32(data: Uint8Array) {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function dosTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | (d.getDate() & 31);
  return { time, date };
}

function u16(n: number) {
  return new Uint8Array([n & 255, (n >>> 8) & 255]);
}
function u32(n: number) {
  return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Blob {
  const { time, date } = dosTime();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = concat(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0]),
      u16(time),
      u16(date),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    );
    const central = concat(
      new Uint8Array([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0]),
      u16(time),
      u16(date),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    );
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const center = concat(...centrals);
  const end = concat(
    new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]),
    u16(files.length),
    u16(files.length),
    u32(center.length),
    u32(offset),
    u16(0),
  );
  return new Blob([concat(...locals, center, end)], { type: "application/zip" });
}

function concat(...parts: Uint8Array[]) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
