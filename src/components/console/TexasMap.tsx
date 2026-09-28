import { useEffect, useRef, useState } from "react";
import type { GeoJSON as GeoLayer, LayerGroup, Map as LeafletMap, Polygon } from "leaflet";
import type { Cell, County, Lot, Road, Yard } from "@/lib/sim/coverage";
import { tierOf, warehouseRing } from "@/lib/sim/coverage";
import "leaflet/dist/leaflet.css";

const COLORS = ["#9d1c1c", "#e08a45", "#1f7a4d", "#2f5f8a", "#8a4b2f", "#6b3fa0", "#b4532a", "#1d6a62", "#8f3d55", "#3d5a40", "#a15c2f", "#245c6b", "#6a4a2a", "#3f6f8a", "#7a3e2e", "#2e6b45"];

export function yardColor(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return COLORS[(h >>> 0) % COLORS.length]!;
}

type Props = {
  counties: County[];
  cells: Cell[];
  yards: Yard[];
  roads: Road[];
  used: [number, number][][];
  spurs: [number, number][][];
  dots: [number, number][];
  fleet: { lat: number; lon: number }[];
  onDrop: (yardId: string, countyId: string, lat: number, lon: number) => void;
  onHover: (countyId: string | null) => void;
  onPick: (countyId: string) => void;
  focusNonce: number;
  focusId: string | null;
  lots: Lot[];
  building: { lat: number; lon: number }[];
  highlight: string | null;
  movedIds: string[];
};

type Ring = [number, number][];
type Feat = { id: string; rings: Ring[] };
let countyFeats: Feat[] = [];

export function TexasMap({ counties, cells, yards, roads, used, spurs, dots, fleet, onDrop, onHover, onPick, focusNonce, focusId, lots, building, highlight, movedIds }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const countyLayer = useRef<GeoLayer | null>(null);
  const roadLayer = useRef<LayerGroup | null>(null);
  const usedLayer = useRef<LayerGroup | null>(null);
  const hullLayer = useRef<LayerGroup | null>(null);
  const pinLayer = useRef<LayerGroup | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [ready, setReady] = useState(false);
  const cellsRef = useRef(cells);
  const hoverRef = useRef<string | null>(null);
  const dropRef = useRef(onDrop);
  const hoverCb = useRef(onHover);
  const pickRef = useRef(onPick);
  const dragLock = useRef(false);
  const countiesRef = useRef(counties);
  const dotsRef = useRef(dots);
  const fleetRef = useRef(fleet);
  const buildRef = useRef(building);
  const highlightRef = useRef(highlight);
  cellsRef.current = cells;
  dropRef.current = onDrop;
  hoverCb.current = onHover;
  pickRef.current = onPick;
  countiesRef.current = counties;
  dotsRef.current = dots;
  fleetRef.current = fleet;
  buildRef.current = building;
  highlightRef.current = highlight;

  useEffect(() => {
    if (!host.current || mapRef.current) return;
    let cancelled = false;
    let map: LeafletMap | null = null;
    let observer: ResizeObserver | null = null;
    void import("leaflet").then((L) => {
      if (cancelled || !host.current) return;
      map = L.map(host.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 5,
        maxZoom: 14,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
      }).setView([31.2, -99.2], 6);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles &copy; Esri, USGS, NOAA",
        maxZoom: 19,
      }).addTo(map);
      map.setMaxBounds(L.latLngBounds([24.8, -107.4], [37.2, -92.6]));
      countyLayer.current = L.geoJSON(undefined, {
        interactive: false,
        style: () => ({ color: "#5c6a72", weight: 0.6, fillColor: "#c4b49a", fillOpacity: 0.25 }),
      }).addTo(map);
      fetch("/data/tx-counties.geojson")
        .then((r) => r.json())
        .then((geo: { features: { properties: { id: string }; geometry: { type: string; coordinates: Ring[] | Ring[][] } }[] }) => {
          if (!countyLayer.current) return;
          countyLayer.current.addData(geo as never);
          countyFeats = geo.features.map((f) => {
            const rings: Ring[] = [];
            if (f.geometry.type === "Polygon") {
              rings.push((f.geometry.coordinates as Ring[])[0] ?? []);
            } else {
              for (const poly of f.geometry.coordinates as Ring[][]) rings.push(poly[0] ?? []);
            }
            return { id: f.properties.id, rings };
          });
          paintCounties();
        })
        .catch(() => undefined);
      roadLayer.current = L.layerGroup().addTo(map);
      usedLayer.current = L.layerGroup().addTo(map);
      hullLayer.current = L.layerGroup().addTo(map);
      pinLayer.current = L.layerGroup().addTo(map);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "dot-sheet");
      svg.style.pointerEvents = "none";
      map.getPane("overlayPane")?.appendChild(svg);
      svgRef.current = svg;
      const redraw = () => {
        if (svgRef.current && mapRef.current) {
          paintDots(L, mapRef.current, svgRef.current, dotsRef.current, fleetRef.current, buildRef.current, highlightRef.current);
        }
      };
      map.on("zoomend moveend viewreset", redraw);
      map.on("mousemove", (e) => {
        const id = hit(e.latlng.lat, e.latlng.lng);
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          hoverCb.current(id);
          paintCounties();
        }
      });
      map.on("click", (e) => {
        if (dragLock.current) return;
        const id = hit(e.latlng.lat, e.latlng.lng);
        if (id) pickRef.current(id);
      });
      mapRef.current = map;
      observer = new ResizeObserver(() => map?.invalidateSize());
      observer.observe(host.current);
      requestAnimationFrame(() => map?.invalidateSize());
      setReady(true);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      svgRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  const paintCounties = () => {
    const layer = countyLayer.current;
    if (!layer) return;
    const byId = new Map(cellsRef.current.map((c) => [c.id, c]));
    const list = countiesRef.current;
    const metros = list.filter((c) => c.phase1);
    const tierFill = { metro: "#c4963a", suburb: "#6e90aa", rural: "#5d8a52" };
    layer.eachLayer((raw) => {
      const feature = (raw as { feature?: { properties?: { id?: string } } }).feature;
      const id = feature?.properties?.id;
      if (!id) return;
      const county = list.find((c) => c.id === id);
      const tier = county ? tierOf(county, metros) : "rural";
      const cell = byId.get(id);
      const hot = id === hoverRef.current;
      let fill: string = tierFill[tier];
      let fillOpacity = tier === "metro" ? 0.5 : tier === "suburb" ? 0.38 : 0.26;
      let color = tier === "metro" ? "#6a4a12" : tier === "suburb" ? "#31485a" : "#2c4a28";
      let dash: string | undefined = tier === "suburb" ? "7 5" : tier === "rural" ? "1 4" : undefined;
      let weight = hot ? 2.8 : tier === "metro" ? 1.5 : 1;
      if (cell?.offLimits) {
        fill = "#5c6762";
        fillOpacity = 0.58;
        color = "#2e3834";
        dash = undefined;
      } else if (cell?.yardId && cell.covered > 0) {
        fill = yardColor(cell.yardId);
        fillOpacity = hot ? 0.7 : tier === "metro" ? 0.55 : tier === "suburb" ? 0.4 : 0.28;
        color = fill;
      }
      if (cell && cell.underConstruction > 0 && !cell.offLimits) color = "#c9842a";
      const hi = highlightRef.current;
      if (hi === "zoned" && cell?.offLimits) {
        fill = "#3d4441";
        fillOpacity = 0.85;
        weight = 2.4;
      } else if (hi === "metro" && tier !== "metro") fillOpacity *= 0.15;
      else if (hi === "suburb" && tier !== "suburb") fillOpacity *= 0.15;
      else if (hi === "rural" && tier !== "rural") fillOpacity *= 0.15;
      else if (hi === "build" && cell && cell.underConstruction > 0) {
        fill = "#c9842a";
        fillOpacity = 0.7;
        weight = 2.6;
      } else if (hi === "zoned" && !cell?.offLimits) fillOpacity *= 0.12;
      (raw as Polygon).setStyle({ color, weight, fillColor: fill, fillOpacity, dashArray: dash ?? "" });
    });
  };

  useEffect(() => {
    if (!ready) return;
    paintCounties();
    void import("leaflet").then((L) => {
      if (!mapRef.current || !svgRef.current) return;
      paintDots(L, mapRef.current, svgRef.current, dots, fleet, building, highlight);
    });
  }, [ready, cells, dots, fleet, building, highlight]);

  useEffect(() => {
    if (!ready || focusNonce === 0 || !focusId || !mapRef.current) return;
    const county = counties.find((c) => c.id === focusId);
    if (!county) return;
    const map = mapRef.current;
    map.panTo([county.lat, county.lon], { animate: true, duration: 0.35 });
  }, [ready, focusId, focusNonce, counties]);

  useEffect(() => {
    if (!ready || !roadLayer.current || !usedLayer.current) return;
    const roadsGroup = roadLayer.current;
    const usedGroup = usedLayer.current;
    void import("leaflet").then((L) => {
      roadsGroup.clearLayers();
      usedGroup.clearLayers();
      for (const road of roads) {
        L.polyline(road.points, { color: "#4a3b30", weight: 2.5, opacity: 0.55, interactive: false }).addTo(roadsGroup);
      }
      for (const seg of used) {
        L.polyline(seg, { color: "#f6ecdf", weight: 7, opacity: 0.85, interactive: false }).addTo(usedGroup);
        L.polyline(seg, { color: "#e08a45", weight: 3.2, opacity: 0.95, interactive: false }).addTo(usedGroup);
      }
      for (const spur of spurs) {
        L.polyline(spur, { color: "#1f7a4d", weight: 1.2, opacity: 0.55, dashArray: "3 4", interactive: false }).addTo(usedGroup);
      }
    });
  }, [ready, roads, used, spurs]);

  useEffect(() => {
    if (!ready || !hullLayer.current || !pinLayer.current || !mapRef.current) return;
    const hulls = hullLayer.current;
    const pins = pinLayer.current;
    const map = mapRef.current;
    void import("leaflet").then((L) => {
      hulls.clearLayers();
      pins.clearLayers();
      const open = new Set(yards.map((yard) => yard.id));
      if (highlight === "sites" || highlight === "yards" || !highlight) {
        for (const lot of lots.filter((lot) => lot.permitted && !open.has(lot.id))) {
          const ring = warehouseRing(lot.lat, lot.lon, lot.id, lot.sqft);
          L.polygon(ring, {
            color: "#5c6a72",
            weight: 1.1,
            dashArray: "4 3",
            fillColor: "#8aa0b0",
            fillOpacity: highlight === "sites" ? 0.55 : 0.18,
            interactive: false,
          }).addTo(hulls);
        }
      }
      for (const yard of yards) {
        const color = yardColor(yard.id);
        const ring = warehouseRing(yard.lat, yard.lon, yard.id, yard.sqft);
        const moved = movedIds.includes(yard.id);
        const footprint = L.polygon(ring, {
          color: moved ? "#f3d27a" : "#0c1210",
          weight: moved ? 3.4 : 1.6,
          fillColor: color,
          fillOpacity: highlight && highlight !== "yards" && highlight !== "sites" ? 0.25 : 0.92,
          interactive: false,
        });
        footprint.addTo(pins);
        const icon = L.divIcon({
          className: "site-icon",
          html: `<svg width="28" height="28" viewBox="0 0 36 36" aria-hidden="true"><path d="M4 22 L11 5 L18 12 L28 4 L33 16 L29 29 L16 33 L7 26 Z" fill="${color}" stroke="#0c1210" stroke-width="2"/></svg>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const marker = L.marker([yard.lat, yard.lon], { icon, draggable: true, zIndexOffset: 800 });
        marker.bindTooltip(yard.name, { direction: "top" });
        marker.on("dragstart", () => {
          dragLock.current = true;
        });
        marker.on("drag", () => {
          const ll = marker.getLatLng();
          const dLat = ll.lat - yard.lat;
          const dLon = ll.lng - yard.lon;
          footprint.setLatLngs(ring.map(([lat, lon]) => [lat + dLat, lon + dLon]));
        });
        marker.on("dragend", () => {
          const ll = marker.getLatLng();
          const countyId = hit(ll.lat, ll.lng);
          window.setTimeout(() => {
            dragLock.current = false;
          }, 0);
          if (!countyId) {
            marker.setLatLng([yard.lat, yard.lon]);
            footprint.setLatLngs(ring);
            return;
          }
          dropRef.current(yard.id, countyId, ll.lat, ll.lng);
        });
        marker.addTo(pins);
      }
      void map;
    });
  }, [ready, yards, cells, counties, lots, highlight, movedIds]);

  return <div ref={host} className="absolute inset-0" />;
}

function hit(lat: number, lon: number) {
  for (const feat of countyFeats) {
    for (const ring of feat.rings) {
      if (inside(lon, lat, ring)) return feat.id;
    }
  }
  return null;
}

function inside(lon: number, lat: number, ring: Ring) {
  let on = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) on = !on;
  }
  return on;
}

function paintDots(
  L: typeof import("leaflet"),
  map: LeafletMap,
  svg: SVGSVGElement,
  dots: [number, number][],
  fleet: { lat: number; lon: number }[],
  building: { lat: number; lon: number }[],
  highlight: string | null,
) {
  const bounds = map.getBounds().pad(0.2);
  const origin = map.latLngToLayerPoint(bounds.getNorthWest());
  L.DomUtil.setPosition(svg as unknown as HTMLElement, origin);
  const size = map.getSize();
  svg.setAttribute("width", String(size.x + 40));
  svg.setAttribute("height", String(size.y + 40));
  const r = Math.max(1.3, (map.getZoom() - 5) * 0.9);
  let homes = "";
  for (const [lat, lon] of dots) {
    if (!bounds.contains([lat, lon])) continue;
    const pt = map.latLngToLayerPoint([lat, lon]);
    const x = pt.x - origin.x;
    const y = pt.y - origin.y;
    homes += `M${x.toFixed(1)} ${y.toFixed(1)}m${-r},0a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
  }
  const fr = Math.max(2.2, r * 1.35);
  let rings = "";
  for (const dot of fleet) {
    if (!bounds.contains([dot.lat, dot.lon])) continue;
    const pt = map.latLngToLayerPoint([dot.lat, dot.lon]);
    const x = pt.x - origin.x;
    const y = pt.y - origin.y;
    rings += `M${x.toFixed(1)} ${y.toFixed(1)}m${-fr},0a${fr},${fr} 0 1,0 ${fr * 2},0a${fr},${fr} 0 1,0 ${-fr * 2},0`;
  }
  const br = Math.max(1.6, r * 1.05);
  let builds = "";
  for (const dot of building) {
    if (!bounds.contains([dot.lat, dot.lon])) continue;
    const pt = map.latLngToLayerPoint([dot.lat, dot.lon]);
    const x = pt.x - origin.x;
    const y = pt.y - origin.y;
    builds += `M${x.toFixed(1)} ${y.toFixed(1)}m${-br},0a${br},${br} 0 1,0 ${br * 2},0a${br},${br} 0 1,0 ${-br * 2},0`;
  }
  svg.replaceChildren();
  const showHomes = !highlight || highlight === "homes";
  const showFleet = !highlight || highlight === "fleet";
  const showBuild = !highlight || highlight === "build";
  if (homes && showHomes) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", homes);
    path.setAttribute("fill", "#1a2420");
    path.setAttribute("fill-opacity", highlight === "homes" ? "0.95" : "0.72");
    svg.appendChild(path);
  }
  if (rings && showFleet) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", rings);
    path.setAttribute("fill", "#9d1c1c");
    path.setAttribute("fill-opacity", "0.95");
    svg.appendChild(path);
  }
  if (builds && showBuild) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", builds);
    path.setAttribute("fill", "#c9842a");
    path.setAttribute("fill-opacity", highlight === "build" ? "0.95" : "0.8");
    svg.appendChild(path);
  }
}
