import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import {
  COUNTIES,
  FACTORY,
  PINS,
  ROADS,
  WORLD_H,
  WORLD_W,
  milesToWorld,
  pinById,
  project,
  townById,
} from "@/lib/sim/geo";
import type { GridSim, Lot, Plan } from "@/lib/sim/engine";

export type Selection =
  | { kind: "pin"; id: string }
  | { kind: "node"; id: string }
  | { kind: "lot"; id: string }
  | { kind: "factory" };

type View = { x: number; y: number; w: number; h: number };

const START: View = { x: 0, y: 0, w: WORLD_W, h: WORLD_H };

function unlocked(plan: Plan, territoryId: string, month: number): boolean {
  const u = plan.input.unlocks[territoryId];
  return u !== null && u <= month;
}

export function MapStage({
  plan,
  month,
  step,
  grid,
  animateFlows,
  selection,
  onSelect,
}: {
  plan: Plan;
  month: number;
  step: number;
  grid: GridSim;
  animateFlows: boolean;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<View>(START);
  const [view, setView] = useState<View>(START);
  const [phase, setPhase] = useState(1);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (!animateFlows) {
      setPhase(1);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setPhase(1);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const t = Math.min(1, (now - t0) / 1500);
      setPhase(t);
      if (t < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animateFlows, month, plan]);

  const flows = useMemo(
    () => plan.lots.filter((l) => l.month === month && l.pinId),
    [plan, month],
  );

  const visibleLots = useMemo(
    () => plan.lots.filter((l) => l.inCohort && unlocked(plan, l.territoryId, month)),
    [plan, month],
  );

  function toWorld(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const vb = viewRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    return { x: vb.x + nx * vb.w, y: vb.y + ny * vb.h };
  }

  function screenPerWorld() {
    const svg = svgRef.current;
    if (!svg) return 1;
    return svg.getBoundingClientRect().width / viewRef.current.w;
  }

  function pick(wx: number, wy: number): Selection | null {
    const s = screenPerWorld();
    const hit = (dx: number, dy: number, px: number) => Math.hypot(dx, dy) * s < px;
    const factory = project(FACTORY.lat, FACTORY.lon);
    if (hit(wx - factory.x, wy - factory.y, 18)) return { kind: "factory" };
    for (const open of plan.opens) {
      const pin = pinById(open.id);
      const p = project(pin.lat, pin.lon);
      if (hit(wx - p.x, wy - p.y, 18)) return { kind: "pin", id: open.id };
    }
    for (const town of new Set(visibleLots.map((l) => l.townId))) {
      const t = townById(town);
      const p = project(t.lat + 0.015, t.lon - 0.01);
      if (hit(wx - p.x, wy - p.y, 14)) return { kind: "node", id: town };
    }
    let best: Lot | null = null;
    let bestD = 12 / Math.max(s, 0.2);
    for (const lot of visibleLots) {
      const d = Math.hypot(wx - lot.x, wy - lot.y);
      if (d < bestD) {
        best = lot;
        bestD = d;
      }
    }
    return best ? { kind: "lot", id: best.id } : null;
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    const w = toWorld(e.clientX, e.clientY);
    drag.current = { x: e.clientX, y: e.clientY, vx: w.x, vy: w.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    if (!d.moved) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vb = viewRef.current;
    const dx = ((e.clientX - d.x) / rect.width) * vb.w;
    const dy = ((e.clientY - d.y) / rect.height) * vb.h;
    const next = clampView({ ...vb, x: vb.x - dx, y: vb.y - dy });
    d.x = e.clientX;
    d.y = e.clientY;
    viewRef.current = next;
    setView(next);
  }
  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const w = toWorld(e.clientX, e.clientY);
    onSelect(pick(w.x, w.y));
  }
  function onWheel(e: WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const vb = viewRef.current;
    const wx = vb.x + nx * vb.w;
    const wy = vb.y + ny * vb.h;
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const w = clamp(vb.w * factor, WORLD_W / 5.5, WORLD_W * 1.15);
    const h = w * (WORLD_H / WORLD_W);
    const next = clampView({ x: wx - nx * w, y: wy - ny * h, w, h });
    viewRef.current = next;
    setView(next);
  }

  function zoom(dir: number) {
    const vb = viewRef.current;
    const factor = dir > 0 ? 0.8 : 1.25;
    const w = clamp(vb.w * factor, WORLD_W / 5.5, WORLD_W * 1.15);
    const h = w * (WORLD_H / WORLD_W);
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    const next = clampView({ x: cx - w / 2, y: cy - h / 2, w, h });
    viewRef.current = next;
    setView(next);
  }

  const scalePx = milesToWorld(10);
  const hoverNode = selection?.kind === "node" ? selection.id : null;
  const hoverPin = selection?.kind === "pin" ? selection.id : null;

  return (
    <div className="relative h-full min-h-0 w-full bg-ink">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onWheel={onWheel}
        role="img"
        aria-label="Corridor map of warehouses, install sites, and transformer flows"
      >
        <defs>
          <pattern id="lockhatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--color-locked)" strokeWidth="1" opacity="0.35" />
          </pattern>
        </defs>
        <rect x={-200} y={-200} width={WORLD_W + 400} height={WORLD_H + 400} fill="var(--color-ink)" />
        {COUNTIES.map((c) => {
          const open = unlocked(plan, c.territoryId, month);
          const d = c.ring
            .map(([lat, lon], i) => {
              const p = project(lat, lon);
              return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(" ") + " Z";
          return (
            <path
              key={c.id}
              d={d}
              fill={open ? "var(--color-panel)" : "url(#lockhatch)"}
              stroke="var(--color-line)"
              strokeWidth={1.2}
            />
          );
        })}
        {COUNTIES.map((c) => {
          const pts = c.ring.map(([lat, lon]) => project(lat, lon));
          const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
          const open = unlocked(plan, c.territoryId, month);
          return (
            <text
              key={`${c.id}-label`}
              x={x}
              y={y}
              textAnchor="middle"
              fill={open ? "var(--color-muted)" : "var(--color-locked)"}
              fontSize={15}
              fontFamily="var(--font-mono), monospace"
            >
              {c.name.toUpperCase()}
              {open ? "" : "  LOCKED"}
            </text>
          );
        })}
        {ROADS.map((road) => {
          const d = road.pts
            .map(([lat, lon], i) => {
              const p = project(lat, lon);
              return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(" ");
          return (
            <path key={road.name} d={d} fill="none" stroke="var(--color-line)" strokeWidth={3.2} />
          );
        })}
        {flows.map((lot) => {
          const pin = pinById(lot.pinId!);
          const a = project(pin.lat, pin.lon);
          const mx = (a.x + lot.x) / 2;
          const my = (a.y + lot.y) / 2 - 10;
          return (
            <path
              key={`line-${lot.id}`}
              d={`M${a.x},${a.y} Q${mx},${my} ${lot.x},${lot.y}`}
              fill="none"
              stroke="var(--color-copper)"
              strokeWidth={0.7}
              opacity={0.28}
            />
          );
        })}
        {visibleLots.map((lot) => {
          if (!lot.pinId || lot.month === null || lot.month > month) return null;
          const trace = grid.batteries[lot.id];
          const charge = trace?.charge[step] ?? 0;
          const exp = trace?.exportKw[step] ?? 0;
          if (charge < 0.35 && exp < 0.35) return null;
          const town = townById(lot.townId);
          const node = project(town.lat + 0.015, town.lon - 0.01);
          const emphasize = hoverNode === lot.townId;
          const hot = charge >= exp;
          return (
            <line
              key={`pulse-${lot.id}`}
              x1={hot ? node.x : lot.x}
              y1={hot ? node.y : lot.y}
              x2={hot ? lot.x : node.x}
              y2={hot ? lot.y : node.y}
              stroke={hot ? "var(--color-copper)" : "var(--color-flow)"}
              strokeWidth={emphasize ? 2.4 : 1.1 + (Math.max(charge, exp) / 11) * 1.6}
              opacity={emphasize ? 0.95 : 0.62}
            />
          );
        })}
        {visibleLots.map((lot) => {
          const solid = lot.month !== null && lot.month <= month && !!lot.pinId;
          const home = grid.batteries[lot.id]?.home[step] ?? 0;
          const selected = selection?.kind === "lot" && selection.id === lot.id;
          const size = solid ? 7.2 : 6.4;
          return (
            <rect
              key={lot.id}
              x={lot.x - size / 2}
              y={lot.y - size / 2}
              width={size}
              height={size}
              fill={solid ? "var(--color-signal)" : "var(--color-signal)"}
              fillOpacity={solid ? 0.95 : 0.18}
              stroke="var(--color-signal)"
              strokeWidth={solid ? (home > 0.4 ? 2.2 : 0.6) : 1.1}
              opacity={lot.uncovered ? 0.55 : 1}
              strokeDasharray={lot.uncovered ? "1.4 1.2" : undefined}
            >
              {selected ? <title>{lot.id}</title> : null}
            </rect>
          );
        })}
        {animateFlows && phase < 1
          ? flows.map((lot, i) => {
              const pin = pinById(lot.pinId!);
              const a = project(pin.lat, pin.lon);
              const stagger = (i % 8) * 0.045;
              const t = clamp((phase - stagger) / 0.82, 0, 1);
              if (t <= 0) return null;
              const mx = (a.x + lot.x) / 2;
              const my = (a.y + lot.y) / 2 - 10;
              const u = 1 - t;
              const x = u * u * a.x + 2 * u * t * mx + t * t * lot.x;
              const y = u * u * a.y + 2 * u * t * my + t * t * lot.y;
              return <circle key={`dot-${lot.id}`} cx={x} cy={y} r={2.3} fill="var(--color-copper)" />;
            })
          : null}
        {Array.from(new Set(visibleLots.map((l) => l.townId))).map((id) => {
          const town = townById(id);
          const p = project(town.lat + 0.015, town.lon - 0.01);
          const node = grid.nodes[id];
          const binding = node?.[step]?.floorBinding;
          const selected = hoverNode === id;
          return (
            <g key={`node-${id}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={selected ? 7 : 4.5}
                fill="var(--color-node)"
                stroke={binding ? "var(--color-signal)" : "var(--color-ink)"}
                strokeWidth={binding ? 1.6 : 0.8}
              />
            </g>
          );
        })}
        {plan.opens.map((open) => {
          const pin = pinById(open.id);
          const p = project(pin.lat, pin.lon);
          const live = open.openMonth <= month;
          const selected = hoverPin === open.id;
          return (
            <g key={open.id} transform={`translate(${p.x} ${p.y})`}>
              <polygon
                points="0,-18 15,-7 15,10 -15,10 -15,-7"
                fill={live ? "var(--color-copper)" : "none"}
                stroke="var(--color-copper)"
                strokeWidth={selected ? 2.6 : 1.6}
                strokeDasharray={live ? undefined : "3 2"}
              />
              <text
                y={26}
                textAnchor="middle"
                fill="var(--color-paper)"
                fontSize={13}
                fontFamily="var(--font-mono), monospace"
              >
                {pin.name}
                {live ? "" : `  M${open.openMonth}`}
              </text>
            </g>
          );
        })}
        {(() => {
          const p = project(FACTORY.lat, FACTORY.lon);
          const selected = selection?.kind === "factory";
          return (
            <g transform={`translate(${p.x} ${p.y})`}>
              <rect
                x={-16}
                y={-10}
                width={32}
                height={18}
                fill="var(--color-panel-2)"
                stroke={selected ? "var(--color-copper)" : "var(--color-muted)"}
                strokeWidth={1.2}
              />
              <text
                y={3}
                textAnchor="middle"
                fill="var(--color-paper)"
                fontSize={9}
                fontFamily="var(--font-mono), monospace"
              >
                BF1
              </text>
            </g>
          );
        })()}
      </svg>
      <div className="pointer-events-none absolute top-3 left-3 flex flex-col gap-1 font-mono text-xs text-muted">
        <span>Scroll to zoom · drag to pan · tap a box, warehouse, or node</span>
        <span className="text-paper">
          Solid red installed · hollow waiting · violet node · copper kits · teal sellback
        </span>
      </div>
      <div className="absolute right-3 bottom-3 flex gap-2">
        <button type="button" className="h-11 w-11 bg-panel text-paper" onClick={() => zoom(1)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="h-11 w-11 bg-panel text-paper" onClick={() => zoom(-1)} aria-label="Zoom out">
          −
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-xs text-muted">
        <div className="mb-1 h-px bg-paper" style={{ width: `${Math.max(24, (scalePx * (svgRef.current?.getBoundingClientRect().width ?? 800)) / view.w)}px` }} />
        10 mi
      </div>
    </div>
  );
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function clampView(v: View): View {
  const w = clamp(v.w, WORLD_W / 5.5, WORLD_W * 1.15);
  const h = w * (WORLD_H / WORLD_W);
  return {
    w,
    h,
    x: clamp(v.x, -w * 0.25, WORLD_W - w * 0.75),
    y: clamp(v.y, -h * 0.25, WORLD_H - h * 0.75),
  };
}
