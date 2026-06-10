import { useRef, useState } from "react";
import { useStore } from "../store";
import { Modal } from "./Dialogs";
import { PylonShape } from "./ObstacleGfx";
import { centerPylons } from "../geometry";
import { safeCapture } from "../canvasBridge";
import type { Pylon } from "../types";

const SIZE = 12; // bearbeitbare Fläche in Metern (12 × 12)
const VIEW = 420; // px

/**
 * Designer für eigene Hindernisse: Pylonen (stehend/liegend) auf einem
 * cm-Raster platzieren, verschieben und als wiederverwendbares Objekt
 * in der Palette speichern.
 */
export function ObstacleDesigner() {
  const setDialog = useStore((s) => s.setDialog);
  const addCustomTemplate = useStore((s) => s.addCustomTemplate);
  const rules = useStore((s) => s.rules);

  const [name, setName] = useState("Mein Hindernis");
  const [pylons, setPylons] = useState<Pylon[]>([]);
  const [tool, setTool] = useState<"standing" | "lying" | "erase">("standing");
  const dragIdx = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const scale = VIEW / SIZE;

  const toLocal = (e: React.PointerEvent): Pylon => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE - SIZE / 2;
    const y = ((e.clientY - r.top) / r.height) * SIZE - SIZE / 2;
    // auf 5 cm runden
    return { x: Math.round(x * 20) / 20, y: Math.round(y * 20) / 20 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    safeCapture(e.currentTarget as Element, e.pointerId);
    const p = toLocal(e);
    // vorhandene Pylone unter dem Zeiger?
    const idx = pylons.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.35);
    if (tool === "erase") {
      if (idx >= 0) setPylons(pylons.filter((_, i) => i !== idx));
      return;
    }
    if (idx >= 0) {
      dragIdx.current = idx;
      return;
    }
    setPylons([...pylons, tool === "lying" ? { ...p, lying: true, angle: 0 } : p]);
    dragIdx.current = pylons.length;
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

  const save = () => {
    if (pylons.length < 1) return;
    addCustomTemplate(name.trim() || "Eigenes Hindernis", centerPylons(pylons));
    setDialog(null);
  };

  return (
    <Modal title="Eigenes Hindernis entwerfen" onClose={() => setDialog(null)} wide>
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
        Klicken = Pylone setzen · Ziehen = verschieben (5-cm-Raster) · Doppelklick auf liegende Pylone = drehen ·
        Raster: 1 m
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
      >
        {Array.from({ length: SIZE + 1 }, (_, i) => i - SIZE / 2).map((v) => (
          <g key={v}>
            <line x1={v} y1={-SIZE / 2} x2={v} y2={SIZE / 2} stroke="var(--grid)" strokeWidth={1.5 / scale} />
            <line x1={-SIZE / 2} y1={v} x2={SIZE / 2} y2={v} stroke="var(--grid)" strokeWidth={1.5 / scale} />
          </g>
        ))}
        <line x1={0} y1={-0.3} x2={0} y2={0.3} stroke="var(--text-dim)" strokeWidth={2 / scale} />
        <line x1={-0.3} y1={0} x2={0.3} y2={0} stroke="var(--text-dim)" strokeWidth={2 / scale} />
        {pylons.map((p, i) => (
          <g key={i} onDoubleClick={() => rotateLying(i)}>
            <PylonShape p={p} base={rules.pylonBase} invalid={false} />
          </g>
        ))}
      </svg>
      <div className="modal-actions">
        <span className="hint">{pylons.length} Pylonen</span>
        <button onClick={() => setPylons([])}>Leeren</button>
        <button className="primary" onClick={save} disabled={!pylons.length}>
          💾 Als Objekt speichern
        </button>
      </div>
    </Modal>
  );
}
