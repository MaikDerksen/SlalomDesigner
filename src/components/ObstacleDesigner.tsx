import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Modal } from "./Dialogs";
import { PylonShape } from "./ObstacleGfx";
import { centerPylons, dist } from "../geometry";
import { safeCapture } from "../canvasBridge";
import type { Pylon } from "../types";

const SIZE = 12; // bearbeitbare Fläche in Metern (12 × 12)
const VIEW = 440; // px

/**
 * Designer für eigene Hindernisse:
 * – 50-cm-Raster als Orientierung, Platzierung komplett frei (kein Einrasten)
 * – Live-Abstandsanzeige der aktiven Pylone zu den nächsten Nachbarn
 * – bestehende eigene Hindernisse können geladen und bearbeitet werden
 */
export function ObstacleDesigner() {
  const setDialog = useStore((s) => s.setDialog);
  const addCustomTemplate = useStore((s) => s.addCustomTemplate);
  const updateCustomTemplate = useStore((s) => s.updateCustomTemplate);
  const customTemplates = useStore((s) => s.customTemplates);
  const designerEditId = useStore((s) => s.designerEditId);
  const rules = useStore((s) => s.rules);

  const editing = designerEditId ? customTemplates.find((t) => t.id === designerEditId) ?? null : null;

  const [name, setName] = useState(editing?.name ?? "Mein Hindernis");
  const [pylons, setPylons] = useState<Pylon[]>(editing ? editing.pylons.map((p) => ({ ...p })) : []);
  const [tool, setTool] = useState<"standing" | "lying" | "erase">("standing");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const toLocal = (e: React.PointerEvent): Pylon => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE - SIZE / 2;
    const y = ((e.clientY - r.top) / r.height) * SIZE - SIZE / 2;
    // frei platzierbar – nur auf cm gerundet (kein Raster-Einrasten)
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    safeCapture(e.currentTarget as Element, e.pointerId);
    const p = toLocal(e);
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
    if (dragIdx.current === null) return;
    const p = toLocal(e);
    setPylons((arr) => arr.map((q, i) => (i === dragIdx.current ? { ...q, x: p.x, y: p.y } : q)));
  };

  const onPointerUp = () => (dragIdx.current = null);

  const rotateLying = (i: number) =>
    setPylons((arr) =>
      arr.map((q, k) => (k === i && q.lying ? { ...q, angle: ((q.angle ?? 0) + 45) % 360 } : q)),
    );

  /** Abstände der aktiven Pylone zu ihren bis zu 3 nächsten Nachbarn. */
  const measurements = useMemo(() => {
    if (activeIdx === null || activeIdx >= pylons.length) return [];
    const a = pylons[activeIdx];
    return pylons
      .map((q, i) => ({ q, i, d: dist(a, q) }))
      .filter((x) => x.i !== activeIdx)
      .sort((x, y) => x.d - y.d)
      .slice(0, 3)
      .map((x) => ({ a, b: x.q, d: x.d }));
  }, [pylons, activeIdx]);

  const save = () => {
    if (pylons.length < 1) return;
    const centered = centerPylons(pylons);
    const finalName = name.trim() || "Eigenes Hindernis";
    if (editing) updateCustomTemplate(editing.id, finalName, centered);
    else addCustomTemplate(finalName, centered);
    setDialog(null);
  };

  const scale = VIEW / SIZE;
  const gridHalf = Math.floor(SIZE); // 0,5-m-Schritte über die ganze Fläche

  return (
    <Modal
      title={editing ? `Hindernis bearbeiten – ${editing.name}` : "Eigenes Hindernis entwerfen"}
      onClose={() => setDialog(null)}
      wide
    >
      <div className="designer-row">
        <label className="grow">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="tool-group">
          <button className={tool === "standing" ? "on" : ""} onClick={() => setTool("standing")}>
            ▲ Stehend
          </button>
          <button className={tool === "lying" ? "on" : ""} onClick={() => setTool("lying")}>
            ▶ Liegend
          </button>
          <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")}>
            ⌫ Löschen
          </button>
        </div>
      </div>
      <p className="hint">
        Tippen = Pylone setzen · Ziehen = frei verschieben (kein Einrasten) · Doppeltipp auf liegende
        Pylone = drehen · Raster: 50 cm · Abstände zur Auswahl werden live angezeigt
      </p>
      <svg
        ref={svgRef}
        className="designer-canvas"
        width={VIEW}
        height={VIEW}
        viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* 50-cm-Raster (Meter-Linien kräftiger) */}
        {Array.from({ length: gridHalf * 2 + 1 }, (_, i) => i / 2 - SIZE / 2).map((v) => {
          const major = Math.abs(v % 1) < 1e-9;
          return (
            <g key={v}>
              <line
                x1={v} y1={-SIZE / 2} x2={v} y2={SIZE / 2}
                stroke="var(--grid)" strokeWidth={(major ? 1.6 : 0.8) / scale}
                opacity={major ? 0.9 : 0.45}
              />
              <line
                x1={-SIZE / 2} y1={v} x2={SIZE / 2} y2={v}
                stroke="var(--grid)" strokeWidth={(major ? 1.6 : 0.8) / scale}
                opacity={major ? 0.9 : 0.45}
              />
            </g>
          );
        })}
        <line x1={0} y1={-0.3} x2={0} y2={0.3} stroke="var(--text-dim)" strokeWidth={2 / scale} />
        <line x1={-0.3} y1={0} x2={0.3} y2={0} stroke="var(--text-dim)" strokeWidth={2 / scale} />

        {/* Abstands-Anzeige */}
        {measurements.map((m, k) => (
          <g key={k} pointerEvents="none">
            <line
              x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y}
              stroke="var(--accent)" strokeWidth={1.6 / scale}
              strokeDasharray={`${5 / scale} ${4 / scale}`}
            />
            <text
              x={(m.a.x + m.b.x) / 2}
              y={(m.a.y + m.b.y) / 2 - 6 / scale}
              textAnchor="middle"
              fontSize={13 / scale}
              fontWeight={600}
              fill="var(--accent)"
              stroke="#fff"
              strokeWidth={3 / scale}
              paintOrder="stroke"
            >
              {m.d.toFixed(2).replace(".", ",")} m
            </text>
          </g>
        ))}

        {pylons.map((p, i) => (
          <g key={i} onDoubleClick={() => rotateLying(i)}>
            {i === activeIdx && (
              <circle cx={p.x} cy={p.y} r={0.32} fill="none" stroke="var(--accent)" strokeWidth={2 / scale} />
            )}
            <PylonShape p={p} base={rules.pylonBase} invalid={false} />
          </g>
        ))}
      </svg>
      <div className="modal-actions">
        <span className="hint">{pylons.length} Pylonen</span>
        <button onClick={() => { setPylons([]); setActiveIdx(null); }}>Leeren</button>
        <button className="primary" onClick={save} disabled={!pylons.length}>
          {editing ? "💾 Aktualisieren" : "💾 Als Objekt speichern"}
        </button>
      </div>
    </Modal>
  );
}
