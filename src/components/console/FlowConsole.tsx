import { useCallback, useEffect, useMemo, useState } from "react";
import type { CoverageData, Drag, Plan } from "@/lib/sim/coverage";
import { DEFAULT_SPEC, describeMove, fleetDots, solve, tierOf } from "@/lib/sim/coverage";
import type { MissionFile } from "@/lib/sim/mission";
import { buildMission } from "@/lib/sim/mission";
import type { RunInputs, ScenarioId } from "@/lib/sim/scenarios";
import { SCENARIOS, applyRun, parseApprovals, parseSites } from "@/lib/sim/scenarios";
import { TexasMap } from "./TexasMap";

const STORE = "base-warehouse-runs-v1";

type Row = {
  id: string;
  at: string;
  inputs: RunInputs;
  note: string;
  plan: Plan;
  mission: MissionFile;
  edit: RunInputs | null;
};

const INITIAL: RunInputs = {
  phase: 2,
  maxMiles: DEFAULT_SPEC.maxMiles,
  homesPerTech: DEFAULT_SPEC.homesPerTech,
  scenario: "baseline",
  approvals: null,
  sites: null,
  drag: null,
};

export function FlowConsole() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RunInputs>(INITIAL);
  const [rows, setRows] = useState<Row[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [banner, setBanner] = useState("Press Solve. The map stays on counties until a run exists.");
  const [picked, setPicked] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focus, setFocus] = useState({ id: null as string | null, nonce: 0 });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    fetch("/data/coverage.json")
      .then((r) => r.json())
      .then((json: CoverageData) => setData(json))
      .catch(() => setError("County, permit, and road files did not load."));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const parsed = JSON.parse(raw) as Row[];
        if (Array.isArray(parsed) && parsed.length && parsed[0]?.plan) {
          setRows(parsed.map((row) => ({ ...row, edit: null })));
          setActiveId(parsed[0].id);
          setBanner(parsed[0].plan.headline);
        }
      }
    } catch {
      /* ignore a bad local history */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const stored = rows.map(({ edit: _edit, ...row }) => row);
      localStorage.setItem(STORE, JSON.stringify(stored));
    } catch {
      /* quota */
    }
  }, [rows, hydrated]);

  const active = rows.find((row) => row.id === activeId) ?? null;
  const plan = active?.plan ?? null;
  const fleet = useMemo(() => (data ? fleetDots(data.counties) : []), [data]);
  const metros = useMemo(() => data?.counties.filter((county) => county.phase1) ?? [], [data]);
  const focusId = picked ?? hoverId;
  const focusCell = focusId && plan ? plan.byId[focusId] : null;
  const focusCounty = focusId && data ? data.counties.find((county) => county.id === focusId) : null;

  const commit = useCallback(
    (inputs: RunInputs, before: Plan | null) => {
      if (!data) return;
      const applied = applyRun(data, inputs);
      const spec = {
        ...DEFAULT_SPEC,
        phase: inputs.phase,
        maxMiles: Math.max(20, inputs.maxMiles || 0),
        homesPerTech: Math.max(100, inputs.homesPerTech || 0),
      };
      const next = solve(applied.data, spec, inputs.drag);
      const mission = buildMission(next);
      const row: Row = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        inputs,
        note: applied.note,
        plan: next,
        mission,
        edit: null,
      };
      setRows((prev) => [row, ...prev].slice(0, 12));
      setActiveId(row.id);
      setBanner(before ? describeMove(before, next) : `${next.headline} ${applied.note}`);
    },
    [data],
  );

  const onDrop = useCallback(
    (yardId: string, countyId: string, lat: number, lon: number) => {
      if (!data || !plan || !active) return;
      const same = plan.byId[countyId]?.yardId === yardId;
      const lot = data.lots
        .filter((item) => item.permitted && milesSafe(item.lat, item.lon, lat, lon) <= 18 && item.id !== yardId)
        .sort((a, b) => milesSafe(a.lat, a.lon, lat, lon) - milesSafe(b.lat, b.lon, lat, lon))[0];
      const drag: Drag = {
        toCountyId: lot?.countyId ?? countyId,
        lat: lot ? lot.lat : lat,
        lon: lot ? lot.lon : lon,
        moveYardId: yardId,
        lotId: lot ? lot.id : null,
        steal: Boolean(same && !lot),
      };
      commit({ ...active.inputs, drag }, plan);
      setPicked(countyId);
      setFocus((item) => ({ id: countyId, nonce: item.nonce + 1 }));
    },
    [data, plan, active, commit],
  );

  const onPick = useCallback((id: string) => {
    setPicked(id);
    setFocus((item) => ({ id, nonce: item.nonce + 1 }));
  }, []);

  const loadScenario = async (id: ScenarioId) => {
    setError(null);
    try {
      if (id === "baseline") {
        setDraft((item) => ({ ...item, scenario: id, approvals: null, sites: null, drag: null }));
        return;
      }
      if (id === "outage") {
        const sites = parseSites(await fetchJson("/examples/sites-outage.json"));
        setDraft((item) => ({ ...item, scenario: id, sites, approvals: null, drag: null }));
        return;
      }
      if (id === "commissioned") {
        setDraft((item) => ({ ...item, scenario: id, approvals: null, drag: null }));
        return;
      }
      const sites = parseSites(await fetchJson("/examples/sites-pullout.json"));
      setDraft((item) => ({ ...item, scenario: id, sites, approvals: null, drag: null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Example file failed.");
    }
  };

  const onUpload = async (kind: "approvals" | "sites", file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const json = JSON.parse(await file.text()) as unknown;
      if (kind === "approvals") setDraft((item) => ({ ...item, approvals: parseApprovals(json), drag: null }));
      else setDraft((item) => ({ ...item, sites: parseSites(json), drag: null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file did not parse.");
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-ink text-paper">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="font-mono text-xs tracking-widest text-copper">BASE</p>
          <h1 className="text-lg leading-tight font-medium">Warehouse planner</h1>
        </div>
        <button type="button" className="h-11 shrink-0 bg-copper px-4 font-medium text-ink" onClick={() => commit(draft, plan)} disabled={!data}>
          Solve
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[48vh] flex-1 lg:min-h-0">
          {error ? <p className="absolute top-14 right-3 left-3 z-[500] bg-ink/90 px-3 py-2 text-sm">{error}</p> : null}
          {!data ? <p className="p-6 font-mono text-xs text-muted">Loading Texas…</p> : null}
          {data ? (
            <TexasMap
              counties={data.counties}
              cells={plan?.cells ?? []}
              yards={plan?.yards ?? []}
              roads={data.roads}
              used={plan?.used ?? []}
              spurs={plan?.spurs ?? []}
              dots={data.dots}
              fleet={fleet}
              onDrop={onDrop}
              onHover={setHoverId}
              onPick={onPick}
              focusId={focus.id}
              focusNonce={focus.nonce}
            />
          ) : null}
          <p className="pointer-events-none absolute top-3 right-3 left-3 z-[500] bg-ink/90 px-3 py-2 text-sm lg:right-auto lg:max-w-md">{banner}</p>
          <Legend />
        </div>
        <aside className="flex max-h-[52vh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-line bg-panel p-4 lg:max-h-none lg:w-[28rem] lg:border-t-0 lg:border-l">
          <section>
            <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">SOLVE FOR</h2>
            <p className="text-sm">
              Which yards open, and which counties each yard covers. Road miles, staffing, and separation are the constraints. The result is a site list and a binary part tree an MES or a contractor can walk. Children are built before the parent. Lead time is not in the file.
            </p>
          </section>
          <InputBlock
            title="Next run"
            inputs={draft}
            onChange={(patch) => setDraft((item) => ({ ...item, ...patch, drag: null }))}
            onScenario={(id) => void loadScenario(id)}
            onSolve={() => commit(draft, plan)}
            solved={false}
          />
          <div className="flex flex-wrap gap-2">
            <FileButton label="Example approvals" onPick={() => void loadExample("approvals", setDraft, setError)} />
            <FileButton label="Example sites" onPick={() => void loadExample("sites", setDraft, setError)} />
            <UploadButton label="Upload approvals" onFile={(file) => void onUpload("approvals", file)} />
            <UploadButton label="Upload sites" onFile={(file) => void onUpload("sites", file)} />
          </div>
          <p className="text-xs text-muted">
            {draft.approvals ? `${draft.approvals.length} approvals loaded.` : "No approvals file. Demand is every finished home."}{" "}
            {draft.sites ? `${draft.sites.length} sites loaded.` : "Sites default to the lot file."} {SCENARIOS.find((item) => item.id === draft.scenario)?.detail}
          </p>
          {plan ? (
            <section>
              <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">TEXAS</h2>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Covered homes" value={plan.totals.covered} />
                <Stat label="Total homes" value={plan.totals.total} />
                <Stat label="Not zoned" value={plan.totals.offLimits} />
                <Stat label="Under construction" value={plan.totals.underConstruction} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {plan.totals.techs.toLocaleString()} technicians and {plan.totals.engineers.toLocaleString()} engineers inside open territories. Planning pool from population, not a Base roster.
              </p>
            </section>
          ) : null}
          <section>
            <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">COUNTY</h2>
            {focusCounty ? (
              <div className="text-sm">
                <p className="font-medium">
                  {focusCounty.name} · {tierWord(tierOf(focusCounty, metros))}
                </p>
                {focusCell ? (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Stat label="Covered homes" value={focusCell.covered} />
                      <Stat label="Total homes" value={focusCell.total} />
                      <Stat label="Not zoned" value={focusCell.offLimits} />
                      <Stat label="Under construction" value={focusCell.underConstruction} />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      Homes with Base {focusCell.base.toLocaleString()} · Homes without Base {Math.max(0, focusCell.total - focusCell.base).toLocaleString()} · {focusCell.techs} technicians · {focusCell.engineers} engineers
                    </p>
                    <p className="mt-2 text-sm">{focusCell.why}</p>
                  </>
                ) : (
                  <p className="mt-2 text-muted">Solve to assign warehouses. Drag a footprint after that and the other yards move.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Click a county to fly there. Drag a warehouse footprint and the other yards are solved again.</p>
            )}
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-xs tracking-widest text-muted">RUNS</h2>
            {rows.length === 0 ? <p className="text-sm text-muted">No runs yet.</p> : null}
            {rows.map((row, index) => (
              <RunRow
                key={row.id}
                index={rows.length - index}
                row={row}
                active={row.id === activeId}
                onShow={() => {
                  setActiveId(row.id);
                  setBanner(row.plan.headline);
                }}
                onChange={(patch) =>
                  setRows((prev) =>
                    prev.map((item) =>
                      item.id === row.id ? { ...item, edit: { ...(item.edit ?? item.inputs), ...patch, drag: item.inputs.drag } } : item,
                    ),
                  )
                }
                onSolve={() => {
                  commit(row.edit ?? row.inputs, row.plan);
                  setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, edit: null } : item)));
                }}
              />
            ))}
          </section>
          <p className="text-xs text-muted">
            Homes are Census 2024 county population ÷ 2.55. Under construction is 2024 units authorized. Homes with Base are a statewide estimate drawn in the four metros Base has named, not an address file. Warehouse footprints are the real lot location with an exaggerated irregular plan so the shape reads. County polygons are the site shape. Truck routes are interstate and US corridors.
          </p>
        </aside>
      </div>
    </div>
  );
}

function RunRow({
  row,
  index,
  active,
  onShow,
  onChange,
  onSolve,
}: {
  row: Row;
  index: number;
  active: boolean;
  onShow: () => void;
  onChange: (patch: Partial<RunInputs>) => void;
  onSolve: () => void;
}) {
  const inputs = row.edit ?? row.inputs;
  const dirty = row.edit !== null;
  return (
    <section className={`border ${active ? "border-copper" : "border-line"}`}>
      <div className="flex items-stretch">
        <button type="button" className="flex-1 px-3 py-2 text-left" onClick={onShow}>
          <span className="font-mono text-xs text-copper">Run {index}</span>
          <span className="mt-1 block text-sm">{scenarioName(inputs.scenario)} · Phase {inputs.phase}</span>
          <span className="mt-1 block font-mono text-xs text-muted">{new Date(row.at).toLocaleString()}</span>
        </button>
        <button type="button" className="w-24 shrink-0 border-l border-line bg-panel-2 text-sm" onClick={() => download(`run-${index}-results.json`, resultsOf(row))}>
          Results
        </button>
      </div>
      <div className="border-t border-line px-3 py-3">
        <InputBlock title="" inputs={inputs} onChange={onChange} onScenario={(id) => onChange({ scenario: id })} onSolve={onSolve} solved />
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <button type="button" className="text-copper" onClick={() => download(`run-${index}-approvals.json`, inputs.approvals ?? { approvals: null, meaning: "No approval file. Demand is every finished home." })}>
            Approvals
          </button>
          <button type="button" className="text-copper" onClick={() => download(`run-${index}-sites.json`, inputs.sites ?? { sites: null, meaning: "Lot file defaults. No sites file on this run." })}>
            Sites
          </button>
          <span className="text-muted">{dirty ? "Edited. Solve to keep a new run." : row.note}</span>
        </div>
      </div>
    </section>
  );
}

function InputBlock({
  title,
  inputs,
  onChange,
  onScenario,
  onSolve,
  solved,
}: {
  title: string;
  inputs: RunInputs;
  onChange: (patch: Partial<RunInputs>) => void;
  onScenario: (id: ScenarioId) => void;
  onSolve: () => void;
  solved: boolean;
}) {
  return (
    <section>
      {title ? <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">{title.toUpperCase()}</h2> : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`h-11 ${inputs.phase === 1 ? "bg-copper text-ink" : "bg-panel-2"}`} onClick={() => onChange({ phase: 1 })}>
          Phase 1
        </button>
        <button type="button" className={`h-11 ${inputs.phase === 2 ? "bg-copper text-ink" : "bg-panel-2"}`} onClick={() => onChange({ phase: 2 })}>
          Phase 2
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {SCENARIOS.map((item) => (
          <button key={item.id} type="button" className={`h-11 px-2 text-left text-sm ${inputs.scenario === item.id ? "bg-copper text-ink" : "bg-panel-2"}`} onClick={() => onScenario(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Num label="Homes one tech can carry" value={inputs.homesPerTech} onChange={(homesPerTech) => onChange({ homesPerTech })} />
        <Num label="Max road miles" value={inputs.maxMiles} onChange={(maxMiles) => onChange({ maxMiles })} />
      </div>
      {solved ? (
        <button type="button" className="mt-2 h-11 w-full bg-copper font-medium text-ink" onClick={onSolve}>
          Solve
        </button>
      ) : null}
    </section>
  );
}

function Legend() {
  return (
    <ul className="pointer-events-none absolute bottom-3 left-3 z-[500] grid grid-cols-2 gap-x-3 gap-y-1 bg-ink/90 px-3 py-2 text-xs">
      <li className="flex items-center gap-2"><Dot color="#9d1c1c" /> Homes with Base</li>
      <li className="flex items-center gap-2"><Dot color="#1a2420" /> Homes without Base</li>
      <li className="flex items-center gap-2"><Swatch color="#c9842a" /> Under construction</li>
      <li className="flex items-center gap-2"><Swatch color="#5c6762" /> Not zoned</li>
      <li className="flex items-center gap-2"><Swatch color="#c4963a" /> Metro</li>
      <li className="flex items-center gap-2"><Swatch color="#6e90aa" dash /> Suburb</li>
      <li className="flex items-center gap-2"><Swatch color="#5d8a52" dash /> Rural</li>
      <li className="flex items-center gap-2"><i className="inline-block h-0.5 w-4 bg-copper" /> Truck route</li>
      <li className="flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 36 36" aria-hidden="true"><path d="M4 22 L11 5 L18 12 L28 4 L33 16 L29 29 L16 33 L7 26 Z" fill="#e08a45" /></svg>
        Warehouse
      </li>
    </ul>
  );
}

function Dot({ color }: { color: string }) {
  return <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}

function Swatch({ color, dash }: { color: string; dash?: boolean }) {
  return <i className="inline-block h-2.5 w-4" style={{ background: color, outline: dash ? "1px dashed #0c1210" : undefined }} />;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-ink px-2 py-2">
      <p className="font-mono text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-sm">{value.toLocaleString()}</p>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-11 w-full border border-line bg-ink px-2 font-mono text-sm text-paper"
      />
    </label>
  );
}

function FileButton({ label, onPick }: { label: string; onPick: () => void }) {
  return (
    <button type="button" className="h-11 bg-panel-2 px-3 text-sm" onClick={onPick}>
      {label}
    </button>
  );
}

function UploadButton({ label, onFile }: { label: string; onFile: (file: File | undefined) => void }) {
  return (
    <label className="flex h-11 cursor-pointer items-center bg-panel-2 px-3 text-sm">
      {label}
      <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
    </label>
  );
}

function scenarioName(id: ScenarioId) {
  return SCENARIOS.find((item) => item.id === id)?.name ?? id;
}

function tierWord(tier: "metro" | "suburb" | "rural") {
  if (tier === "metro") return "Metro";
  if (tier === "suburb") return "Suburb";
  return "Rural";
}

function resultsOf(row: Row) {
  return {
    note: row.note,
    headline: row.plan.headline,
    totals: row.plan.totals,
    yards: row.plan.yards,
    counties: row.plan.cells,
    mission: row.mission,
  };
}

function download(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchJson(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json() as Promise<unknown>;
}

async function loadExample(kind: "approvals" | "sites", setDraft: (fn: (item: RunInputs) => RunInputs) => void, setError: (msg: string | null) => void) {
  setError(null);
  try {
    if (kind === "approvals") {
      const approvals = parseApprovals(await fetchJson("/examples/approvals-baseline.json"));
      setDraft((item) => ({ ...item, approvals, drag: null }));
    } else {
      const sites = parseSites(await fetchJson("/examples/sites-baseline.json"));
      setDraft((item) => ({ ...item, sites, drag: null }));
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : "Example file failed.");
  }
}

function milesSafe(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
