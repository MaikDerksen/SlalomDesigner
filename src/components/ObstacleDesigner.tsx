import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Modal } from "./Dialogs";
import { PylonShape } from "./ObstacleGfx";
import { bbox, dist } from "../geometry";
import { smoothDrawnLine } from "../routing";
import { templateById } from "../templates";
import { safeCapture } from "../canvasBridge";
import { Icon } from "./Icons";
import type { Pylon, V2 } from "../types";

const SIZE = 14; // bearbeitbare Fläche in Metern
const VIEW = 440; // px

/**
 * Designer für Hindernisse:
 * – 50-cm-Raster, freie Platzierung (kein Einrasten), Live-Abstandsanzeige
 * – Tabs: Pylonen | Linie 1..n | + Linie – pro Tab eine Fahrlinien-Variante
 *   freihand zeichnen; vorhandene Varianten ersetzen die KI-Berechnung
 * – Offizielle Hindernisse (§7.3) können geladen, angepasst und als
 *   Vereins-Override gespeichert werden
 */
export function ObstacleDesigner() {
  const setDialog = useStore((s) => s.setDialog);
  const addCustomTemplate = useStore((s) => s.addCustomTemplate);
  const updateCustomTemplate = useStore((s) => s.updateCustomTemplate);
  const customTemplates = useStore((s) => s.customTemplates);
  const designerEditId = useStore((s) => s.designerEditId);
  const designerBaseId = useStore((s) => s.designerBaseId);
  const rules = useStore((s) => s.rules);

  const editing = designerEditId ? customTemplates.find((t) => t.id === designerEditId) ?? null : null;
  const baseTpl = designerBaseId ? templateById(designerBaseId) ?? null : null;

  const [name, setName] = useState(editing?.name ?? baseTpl?.name ?? "Mein Hindernis");
  const [pylons, setPylons] = useState<Pylon[]>(() => {
    if (editing) return editing.pylons.map((p) => ({ ...p }));
    if (baseTpl) return baseTpl.build(rules);
    return [];
  });
  const [routes, setRoutes] = useState<V2[][]>(() => {
    if (editing) return (editing.routes ?? []).map((v) => v.map((p) => ({ ...p })));
    if (baseTpl) return [baseTpl.route(rules)];
    return [];
  });
  /** -1 = Pylonen-Modus, sonst Index der aktiven Fahrlinien-Variante. */
  const [tab, setTab] = useState(-1);
  const [tool, setTool] = useState<"standing" | "lying" | "erase">("standing");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<V2[] | null>(null);
  const dragIdx = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const toLocal = (e: React.PointerEvent): V2 => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE - SIZE / 2;
    const y = ((e.clientY - r.top) / r.height) * SIZE - SIZE / 2;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    safeCapture(e.currentTarget as Element, e.pointerId);
    const p = toLocal(e);
    if (tab >= 0) {
      setDrawing([p]);
      return;
    }
    const idx = pylons.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.32);
    if (tool === "erase") {
      if (idx >= 0) {
        setPylons(pylons.filter((_, i) => i !== idx));
        setActiveIdx(null);
      }
      return;
    }
    if (idx >= 0) {
      dragIdx.current = idx;
      setActiveIdx(idx);
      return;
    }
    setPylons([...pylons, tool === "lying" ? { ...p, lying: true, angle: 0 } : p]);
    dragIdx.current = pylons.length;
    setActiveIdx(pylons.length);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (tab >= 0) {
      if (!drawing) return;
      const p = toLocal(e);
      const last = drawing[drawing.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.07) setDrawing([...drawing, p]);
      return;
    }
    if (dragIdx.current === null) return;
    const p = toLocal(e);
    setPylons((arr) => arr.map((q, i) => (i === dragIdx.current ? { ...q, x: p.x, y: p.y } : q)));
  };

  const onPointerUp = () => {
    if (tab >= 0 && drawing) {
      if (drawing.length >= 4) {
        const smooth = smoothDrawnLine(drawing);
        setRoutes((r) => r.map((v, i) => (i === tab ? smooth : v)));
      }
      setDrawing(null);
      return;
    }
    dragIdx.current = null;
  };

  const rotateLying = (i: number) =>
    setPylons((arr) =>
      arr.map((q, k) => (k === i && q.lying ? { ...q, angle: ((q.angle ?? 0) + 45) % 360 } : q)),
    );

  const measurements = useMemo(() => {
    if (tab >= 0 || activeIdx === null || activeIdx >= pylons.length) return [];
    const a = pylons[activeIdx];
    return pylons
      .map((q, i) => ({ q, i, d: dist(a, q) }))
      .filter((x) => x.i !== activeIdx)
      .sort((x, y) => x.d - y.d)
      .slice(0, 3)
      .map((x) => ({ a, b: x.q, d: x.d }));
  }, [pylons, activeIdx, tab]);

  const addVariant = () => {
    setRoutes((r) => [...r, []]);
    setTab(routes.length);
  };

  const deleteVariant = (i: number) => {
    setRoutes((r) => r.filter((_, k) => k !== i));
    setTab(-1);
  };

  const save = () => {
    if (pylons.length < 1) return;
    // Pylonen UND Fahrlinien gemeinsam zentrieren, damit sie zueinander passen
    const box = bbox(pylons);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const centeredPylons = pylons.map((p) => ({ ...p, x: r2(p.x - cx), y: r2(p.y - cy) }));
    const centeredRoutes = routes
      .filter((v) => v.length >= 2)
      .map((v) => v.map((p) => ({ x: r2(p.x - cx), y: r2(p.y - cy) })));
    const finalName = name.trim() || "Eigenes Hindernis";
    if (editing) updateCustomTemplate(editing.id, finalName, centeredPylons, centeredRoutes);
    else addCustomTemplate(finalName, centeredPylons, centeredRoutes, designerBaseId ?? undefined);
    setDialog(null);
  };

  const scale = VIEW / SIZE;
  const gridSteps = Math.floor(SIZE) * 2;

  return (
    <Modal
      title={
        editing
          ? `Hindernis bearbeiten – ${editing.name}`
          : baseTpl
            ? `Offizielles Hindernis anpassen – ${baseTpl.name} (${baseTpl.ref})`
            : "Eigenes Hindernis entwerfen"
      }
      onClose={() => setDialog(null)}
      wide
    >
      <div className="designer-row">
        <label className="grow">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {tab < 0 && (
          <div className="tool-group">
            <button className={tool === "standing" ? "on" : ""} onClick={() => setTool("standing")}>
              <Icon name="pylon" />
              Stehend
            </button>
            <button className={tool === "lying" ? "on" : ""} onClick={() => setTool("lying")}>
              <Icon name="pylonLying" />
              Liegend
            </button>
            <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")}>
              <Icon name="eraser" />
              Löschen
            </button>
          </div>
        )}
      </div>

      {/* Tabs: Pylonen | Fahrlinien-Varianten | + */}
      <div className="designer-tabs">
        <button className={tab === -1 ? "on" : ""} onClick={() => setTab(-1)}>
          <Icon name="pylon" size={12} />
          Pylonen
        </button>
        {routes.map((v, i) => (
          <button key={i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>
            <Icon name="route" size={12} />
            Linie {i + 1}
            {!v.length && " (leer)"}
          </button>
        ))}
        <button onClick={addVariant} title="Weitere Fahrlinien-Variante">
          <Icon name="plus" size={12} />
          Linie
        </button>
        {tab >= 0 && (
          <button className="danger" onClick={() => deleteVariant(tab)} title="Diese Variante löschen">
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>

      <p className="hint">
        {tab < 0
          ? "Tippen = Pylone setzen · Ziehen = frei verschieben (kein Einrasten) · Doppeltipp auf liegende Pylone = drehen · Raster: 50 cm"
          : `Fahrlinie ${tab + 1} freihand über die Pylonen zeichnen (Einfahrt → Ausfahrt). Neu zeichnen ersetzt die Linie. Sind Linien vorhanden, nutzt die KI-Route nur noch diese.`}
      </p>

      <svg
        ref={svgRef}
        className={`designer-canvas ${tab >= 0 ? "drawing" : ""}`}
        width={VIEW}
        height={VIEW}
        viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {Array.from({ length: gridSteps + 1 }, (_, i) => i / 2 - SIZE / 2).map((v) => {
          const major = Math.abs(v % 1) < 1e-9;
          return (
            <g key={v}>
              <line x1={v} y1={-SIZE / 2} x2={v} y2={SIZE / 2} stroke="var(--grid)" strokeWidth={(major ? 1.6 : 0.8) / scale} opacity={major ? 0.9 : 0.45} />
              <line x1={-SIZE / 2} y1={v} x2={SIZE / 2} y2={v} stroke="var(--grid)" strokeWidth={(major ? 1.6 : 0.8) / scale} opacity={major ? 0.9 : 0.45} />
            </g>
          );
        })}

        {/* Fahrlinien-Varianten */}
        {routes.map((v, i) =>
          v.length >= 2 ? (
            <g key={`r${i}`} pointerEvents="none" opacity={tab === -1 ? 0.55 : tab === i ? 1 : 0.22}>
              <polyline
                points={v.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--route)"
                strokeWidth={3 / scale}
                strokeLinejoin="round"
              />
              <RouteArrow v={v} scale={scale} />
            </g>
          ) : null,
        )}
        {/* Live-Zeichnung */}
        {drawing && drawing.length > 1 && (
          <polyline
            points={drawing.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--route)"
            strokeWidth={3 / scale}
            strokeDasharray={`${6 / scale} ${4 / scale}`}
            pointerEvents="none"
          />
        )}

        {/* Abstands-Anzeige */}
        {measurements.map((m, k) => (
          <g key={k} pointerEvents="none">
            <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="var(--accent)" strokeWidth={1.6 / scale} strokeDasharray={`${5 / scale} ${4 / scale}`} />
            <text
              x={(m.a.x + m.b.x) / 2}
              y={(m.a.y + m.b.y) / 2 - 6 / scale}
              textAnchor="middle"
              fontSize={13 / scale}
              fontWeight={600}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={3 / scale}
              paintOrder="stroke"
            >
              {m.d.toFixed(2).replace(".", ",")} m
            </text>
          </g>
        ))}

        {pylons.map((p, i) => (
          <g key={i} onDoubleClick={() => tab < 0 && rotateLying(i)}>
            {i === activeIdx && tab < 0 && (
              <circle cx={p.x} cy={p.y} r={0.32} fill="none" stroke="var(--accent)" strokeWidth={2 / scale} />
            )}
            <PylonShape p={p} base={rules.pylonBase} invalid={false} />
          </g>
        ))}
      </svg>
      <div className="modal-actions">
        <span className="hint">
          {pylons.length} Pylonen · {routes.filter((v) => v.length >= 2).length} Fahrlinie(n)
        </span>
        <button onClick={() => { setPylons([]); setRoutes([]); setActiveIdx(null); setTab(-1); }}>Leeren</button>
        <button className="primary" onClick={save} disabled={!pylons.length}>
          <Icon name="save" />
          {editing ? "Aktualisieren" : baseTpl ? "Als Anpassung speichern" : "Als Objekt speichern"}
        </button>
      </div>
    </Modal>
  );
}

function RouteArrow({ v, scale }: { v: V2[]; scale: number }) {
  const a = v[v.length - 2];
  const b = v[v.length - 1];
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return (
    <g transform={`translate(${b.x} ${b.y}) rotate(${deg})`}>
      <polygon points={`${10 / scale},0 ${-5 / scale},${-6 / scale} ${-5 / scale},${6 / scale}`} fill="var(--route)" />
    </g>
  );
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
