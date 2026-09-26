import { useCallback, useEffect, useMemo, useState } from "react";
import type { CoverageData, Drag, Spec } from "@/lib/sim/coverage";
import { DEFAULT_SPEC, describeMove, fleetDots, miles, solve } from "@/lib/sim/coverage";
import { TexasMap, yardColor } from "./TexasMap";

export function FlowConsole() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<1 | 2>(2);
  const [maxMiles, setMaxMiles] = useState(DEFAULT_SPEC.maxMiles);
  const [homesPerTech, setHomesPerTech] = useState(DEFAULT_SPEC.homesPerTech);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/coverage.json")
      .then((r) => r.json())
      .then((json: CoverageData) => setData(json))
      .catch(() => setError("County, permit, and road files did not load."));
  }, []);

  const spec: Spec = { ...DEFAULT_SPEC, phase, maxMiles: Math.max(20, maxMiles), homesPerTech: Math.max(100, homesPerTech) };
  const phase1 = useMemo(() => (data ? solve(data, { ...spec, phase: 1 }, null) : null), [data, spec.maxMiles, spec.homesPerTech]);
  const phase2 = useMemo(() => (data ? solve(data, { ...spec, phase: 2 }, null) : null), [data, spec.maxMiles, spec.homesPerTech]);
  const plan = useMemo(() => {
    if (!data) return null;
    const base = phase === 1 ? phase1 : phase2;
    if (!drag || !base) return base;
    return solve(data, spec, drag);
  }, [data, phase, phase1, phase2, drag, spec.maxMiles, spec.homesPerTech]);

  const move = plan && phase1 && phase2 ? (drag ? describeMove(phase === 1 ? phase1 : phase2, plan) : phaseLine(phase1, phase2, phase)) : "";
  const focusId = picked ?? hoverId;
  const focus = focusId && plan ? plan.byId[focusId] : null;
  const fleet = useMemo(() => (data ? fleetDots(data.counties) : []), [data]);

  const onDrop = useCallback(
    (yardId: string, countyId: string, lat: number, lon: number) => {
      if (!data || !plan) return;
      const same = plan.byId[countyId]?.yardId === yardId;
      const lot = data.lots
        .filter((l) => l.permitted && miles(l.lat, l.lon, lat, lon) <= 18 && l.id !== yardId)
        .sort((a, b) => miles(a.lat, a.lon, lat, lon) - miles(b.lat, b.lon, lat, lon))[0];
      setDrag({
        toCountyId: lot?.countyId ?? countyId,
        lat: lot ? lot.lat : lat,
        lon: lot ? lot.lon : lon,
        moveYardId: yardId,
        lotId: lot ? lot.id : null,
        steal: Boolean(same && !lot),
      });
      setPicked(countyId);
    },
    [data, plan],
  );
  const onHover = useCallback((id: string | null) => setHoverId(id), []);

  return (
    <div className="flex h-dvh flex-col bg-ink text-paper">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <p className="font-mono text-xs tracking-widest text-copper">BASE FLOW</p>
        <h1 className="text-lg leading-tight font-medium">Rural yards, not another Houston pin</h1>
        <p className="mt-2 max-w-3xl text-sm">{plan ? plan.headline : "Reading counties, permits, and truck corridors…"}</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[48vh] flex-1 lg:min-h-0">
          {error ? <p className="p-6 text-sm">{error}</p> : null}
          {!plan || !data ? <p className="p-6 font-mono text-xs text-muted">Loading Texas…</p> : null}
          {plan && data ? (
            <TexasMap
              counties={data.counties}
              cells={plan.cells}
              yards={plan.yards}
              roads={data.roads}
              used={plan.used}
              spurs={plan.spurs}
              dots={data.dots}
              fleet={fleet}
              onDrop={onDrop}
              onHover={onHover}
            />
          ) : null}
          <div className="pointer-events-none absolute top-3 right-3 left-3 z-[500] flex flex-col gap-2 lg:right-auto lg:max-w-md">
            <p className="bg-ink/90 px-3 py-2 text-sm">{move}</p>
          </div>
          <ul className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-col gap-1 bg-ink/90 px-3 py-2 text-xs">
            <li className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 bg-[#14201c]" /> 6,000 homes, no Base battery</li>
            <li className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 border border-[#9d1c1c]" /> 400 estimated Base systems, exaggerated</li>
            <li className="flex items-center gap-2"><i className="inline-block h-2.5 w-4 bg-[#6d7c76]" /> Off limits</li>
            <li className="flex items-center gap-2"><i className="inline-block h-2.5 w-4 bg-[#e0c48a]" /> On a route, crew ran out</li>
            <li className="flex items-center gap-2"><i className="inline-block h-1 w-4 bg-[#e08a45]" /> Truck route in use</li>
          </ul>
        </div>
        <aside className="flex max-h-[48vh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-line bg-panel p-4 lg:max-h-none lg:w-[26rem] lg:border-t-0 lg:border-l">
          <section>
            <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">PHASE</h2>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`h-11 ${phase === 1 ? "bg-copper text-ink" : "bg-panel-2"}`} onClick={() => { setPhase(1); setDrag(null); }}>
                Phase 1 metros
              </button>
              <button type="button" className={`h-11 ${phase === 2 ? "bg-copper text-ink" : "bg-panel-2"}`} onClick={() => { setPhase(2); setDrag(null); }}>
                Phase 2 rural
              </button>
            </div>
            <p className="mt-2 text-sm text-muted">
              Phase 1 only unlocks Austin, Houston, San Antonio, and Dallas–Fort Worth. That placement is obvious. Phase 2 unlocks every county a truck corridor can reach, and stops where the local technicians and engineers run out.
            </p>
          </section>
          {plan ? (
            <section>
              <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">TEXAS</h2>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Covered homes" value={plan.totals.covered} />
                <Stat label="Total homes" value={plan.totals.total} />
                <Stat label="Off limits" value={plan.totals.offLimits} />
                <Stat label="Under construction" value={plan.totals.underConstruction} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {plan.totals.gap.toLocaleString()} finished homes sit on a corridor but no crew is left. {plan.totals.techs.toLocaleString()} technicians and {plan.totals.engineers.toLocaleString()} engineers are the planning pool inside open territories, not a Base roster.
              </p>
            </section>
          ) : null}
          <section>
            <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">THIS COUNTY</h2>
            {focus ? (
              <div className="text-sm">
                <p className="font-medium">{focus.name}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Stat label="Covered" value={focus.covered} />
                  <Stat label="Total homes" value={focus.total} />
                  <Stat label="Off limits" value={focus.offLimits} />
                  <Stat label="Under construction" value={focus.underConstruction} />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {focus.techs} technicians · {focus.engineers} engineer{focus.engineers === 1 ? "" : "s"} in the county. Estimated Base systems here: {focus.base.toLocaleString()}.
                </p>
                <p className="mt-2 text-sm">{focus.why}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">Hover a county. Almost every home on this map does not have a Base battery. The red rings are the estimated fleet, drawn large enough to see.</p>
            )}
          </section>
          <section>
            <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">CREW AND REACH</h2>
            <div className="grid grid-cols-2 gap-2">
              <Num label="Homes one tech can carry" value={homesPerTech} onChange={setHomesPerTech} />
              <Num label="Max road miles" value={maxMiles} onChange={setMaxMiles} />
            </div>
            <p className="mt-2 text-xs text-muted">1 technician per 5,000 residents. 1 engineer per 40,000. A yard inside 70 road miles of another one does not open unless you drag it there.</p>
            {drag ? (
              <button type="button" className="mt-2 font-mono text-xs text-copper" onClick={() => setDrag(null)}>
                Put the yards back
              </button>
            ) : null}
          </section>
          {plan ? (
            <section>
              <h2 className="mb-2 font-mono text-xs tracking-widest text-muted">YARDS</h2>
              <ul className="flex flex-col gap-2">
                {plan.yards.map((yard) => (
                  <li key={yard.id}>
                    <button type="button" className="w-full bg-panel-2 px-3 py-2 text-left" onClick={() => setPicked(yard.countyId)}>
                      <span className="font-mono text-xs" style={{ color: yardColor(yard.id) }}>{yard.forced ? "MOVED" : yard.kind === "leased" ? "LEASED" : "UNLEASED"} · {yard.road}</span>
                      <span className="mt-1 block text-sm">{yard.name}</span>
                      <span className="mt-1 block font-mono text-xs text-muted">{yard.lat.toFixed(5)}, {yard.lon.toFixed(5)}</span>
                      <span className="mt-1 block text-xs text-muted">{yard.address}</span>
                      <span className="mt-1 block text-xs">
                        {yard.counties} counties · {yard.homes.toLocaleString()} covered · {yard.techs} techs · {yard.engineers} engineers
                      </span>
                    </button>
                    <p className="mt-1 text-xs text-muted">{yard.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-xs text-muted">
            There is no public address file of Base batteries. About 25,000 systems were reported across Texas and Illinois by September 2026. This map puts 22,000 of them in the four Texas metros Base has named, split by housing, and draws them about 15 times too large. Every other mark is a home without one: 1 dot is 6,000 homes, from Census 2024 county population divided by 2.55. Under construction is 2024 building permits, units authorized. Truck lines are the interstate and US corridors through Census places, not turn-by-turn traffic. Leased pins use the lot file. Other pins are Census places, not signed leases. Drag an irregular pin onto another county and the territories are solved again.
          </p>
        </aside>
      </div>
    </div>
  );
}

function phaseLine(phase1: { totals: { covered: number }; yards: { name: string }[] }, phase2: { totals: { covered: number }; yards: { name: string }[] }, phase: 1 | 2) {
  const added = phase2.yards.filter((y) => !phase1.yards.some((p) => p.name === y.name)).map((y) => y.name);
  const delta = phase2.totals.covered - phase1.totals.covered;
  if (phase === 1) return `Phase 1 is the metros only. Phase 2 adds ${added.slice(0, 6).join(", ")}${added.length > 6 ? ` and ${added.length - 6} more` : ""} and ${delta.toLocaleString()} covered homes.`;
  return `Against phase 1, this adds ${added.slice(0, 6).join(", ")}${added.length > 6 ? ` and ${added.length - 6} more` : ""}. Covered homes +${delta.toLocaleString()}. Drag a pin into a gray county to move that territory.`;
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
