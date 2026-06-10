import { useRef, useState } from "react";
import { TEMPLATES } from "../templates";
import { useStore } from "../store";
import { ObstaclePreview } from "./ObstacleGfx";
import { canvasBridge } from "../canvasBridge";
import type { Pylon } from "../types";

/**
 * Rechte Scroll-Leiste mit allen Hindernis-Modellen (§7.3) und eigenen
 * Hindernissen. Modelle lassen sich per Drag & Drop auf die Fläche ziehen;
 * ein Tipp/Klick platziert sie in der Mitte der aktuellen Ansicht.
 */
export function Palette() {
  const rules = useStore((s) => s.rules);
  const customTemplates = useStore((s) => s.customTemplates);
  const addObstacle = useStore((s) => s.addObstacle);
  const addCustomObstacle = useStore((s) => s.addCustomObstacle);
  const deleteCustomTemplate = useStore((s) => s.deleteCustomTemplate);
  const setDialog = useStore((s) => s.setDialog);

  const [ghost, setGhost] = useState<{ x: number; y: number; pylons: Pylon[] } | null>(null);
  const dragInfo = useRef<{
    kind: "builtin" | "custom";
    id: string;
    pylons: Pylon[];
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const startDrag = (
    e: React.PointerEvent,
    kind: "builtin" | "custom",
    id: string,
    pylons: Pylon[],
  ) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragInfo.current = { kind, id, pylons, startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragInfo.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true;
    if (d.moved) setGhost({ x: e.clientX, y: e.clientY, pylons: d.pylons });
  };

  const drop = (clientX: number, clientY: number) => {
    const d = dragInfo.current;
    if (!d) return;
    const place = (x: number, y: number) => {
      if (d.kind === "builtin") addObstacle(d.id, x, y);
      else {
        const tpl = customTemplates.find((t) => t.id === d.id);
        if (tpl) addCustomObstacle(tpl, x, y);
      }
    };
    if (d.moved) {
      const w = canvasBridge.screenToWorld?.(clientX, clientY);
      if (w) place(round2(w.x), round2(w.y));
    } else {
      // Tipp/Klick: in der Mitte der Ansicht platzieren
      const c = canvasBridge.viewCenter?.();
      if (c) place(round2(c.x), round2(c.y));
    }
    dragInfo.current = null;
    setGhost(null);
  };

  return (
    <aside className="palette">
      <div className="palette-head">Hindernisse</div>
      <div className="palette-scroll">
        {TEMPLATES.map((t) => {
          const pylons = t.build(rules);
          return (
            <div
              key={t.id}
              className="palette-item"
              onPointerDown={(e) => startDrag(e, "builtin", t.id, pylons)}
              onPointerMove={onMove}
              onPointerUp={(e) => drop(e.clientX, e.clientY)}
              onPointerCancel={() => {
                dragInfo.current = null;
                setGhost(null);
              }}
            >
              <ObstaclePreview pylons={pylons} base={rules.pylonBase} size={74} />
              <div className="palette-label">
                <span>{t.name}</span>
                <small>{t.ref}</small>
              </div>
            </div>
          );
        })}

        <div className="palette-section">
          Eigene Hindernisse
          <button className="mini-btn" onClick={() => setDialog("designer")} title="Neues Hindernis entwerfen">
            +
          </button>
        </div>
        {customTemplates.length === 0 && (
          <div className="palette-empty">Noch keine – mit „+" eigene Hindernisse als Objekt anlegen.</div>
        )}
        {customTemplates.map((t) => (
          <div
            key={t.id}
            className="palette-item"
            onPointerDown={(e) => startDrag(e, "custom", t.id, t.pylons)}
            onPointerMove={onMove}
            onPointerUp={(e) => drop(e.clientX, e.clientY)}
            onPointerCancel={() => {
              dragInfo.current = null;
              setGhost(null);
            }}
          >
            <ObstaclePreview pylons={t.pylons} base={rules.pylonBase} size={74} />
            <div className="palette-label">
              <span>{t.name}</span>
              <small>eigenes</small>
            </div>
            <button
              className="mini-btn danger"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => deleteCustomTemplate(t.id)}
              title="Vorlage löschen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Drag-Geist folgt dem Zeiger */}
      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          <ObstaclePreview pylons={ghost.pylons} base={0.28} size={70} />
        </div>
      )}
    </aside>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
