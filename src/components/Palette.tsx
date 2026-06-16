import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TEMPLATES } from "../templates";
import { useStore } from "../store";
import { ObstaclePreview } from "./ObstacleGfx";
import { canvasBridge, safeCapture } from "../canvasBridge";
import { Icon } from "./Icons";
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
  const openDesigner = useStore((s) => s.openDesigner);

  const [ghost, setGhost] = useState<{ x: number; y: number; pylons: Pylon[]; name: string } | null>(null);
  const dragInfo = useRef<{
    kind: "builtin" | "custom";
    id: string;
    pylons: Pylon[];
    name: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const startDrag = (
    e: React.PointerEvent,
    kind: "builtin" | "custom",
    id: string,
    pylons: Pylon[],
    name: string,
  ) => {
    e.preventDefault();
    safeCapture(e.currentTarget as Element, e.pointerId);
    dragInfo.current = { kind, id, pylons, name, startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragInfo.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true;
    if (d.moved) setGhost({ x: e.clientX, y: e.clientY, pylons: d.pylons, name: d.name });
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
    <aside className="palette" data-tour="palette">
      <div className="palette-head">Hindernisse</div>
      <div className="palette-scroll">
        {TEMPLATES.map((t) => {
          // Vereins-Override ersetzt das offizielle Hindernis
          const override = customTemplates.find((c) => c.baseTemplateId === t.id);
          const pylons = override ? override.pylons : t.build(rules);
          return (
            <div
              key={t.id}
              className="palette-item"
              onPointerDown={(e) =>
                override
                  ? startDrag(e, "custom", override.id, pylons, t.name)
                  : startDrag(e, "builtin", t.id, pylons, t.name)
              }
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
                <small>{override ? `${t.ref} · angepasst` : t.ref}</small>
              </div>
              <button
                className="mini-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => (override ? openDesigner(override.id) : openDesigner(null, t.id))}
                title={override ? "Anpassung bearbeiten" : "Offizielles Hindernis anpassen (Pylonen + Fahrlinien)"}
              >
                <Icon name="pencil" size={12} />
              </button>
              {override && (
                <button
                  className="mini-btn danger"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (confirm(`Anpassung von „${t.name}" entfernen und das Original wiederherstellen?`))
                      deleteCustomTemplate(override.id);
                  }}
                  title="Original wiederherstellen"
                >
                  <Icon name="undo" size={12} />
                </button>
              )}
            </div>
          );
        })}

        <div className="palette-section">
          Eigene Hindernisse
          <button className="mini-btn" onClick={() => openDesigner(null)} title="Neues Hindernis entwerfen">
            <Icon name="plus" size={13} />
          </button>
        </div>
        {customTemplates.filter((t) => !t.baseTemplateId).length === 0 && (
          <div className="palette-empty">Noch keine – mit „+" eigene Hindernisse als Objekt anlegen.</div>
        )}
        {customTemplates.filter((t) => !t.baseTemplateId).map((t) => (
          <div
            key={t.id}
            className="palette-item"
            onPointerDown={(e) => startDrag(e, "custom", t.id, t.pylons, t.name)}
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
              className="mini-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => openDesigner(t.id)}
              title="Bearbeiten"
            >
              <Icon name="pencil" size={12} />
            </button>
            <button
              className="mini-btn danger"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => deleteCustomTemplate(t.id)}
              title="Vorlage löschen"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Drag-Geist folgt dem Zeiger – per Portal an <body>, damit position:fixed
          nicht vom backdrop-filter der Palette als Containing-Block gekapert wird */}
      {ghost &&
        createPortal(
          <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
            <div className="drag-ghost-card">
              <ObstaclePreview pylons={ghost.pylons} base={0.28} size={64} />
              <span>{ghost.name}</span>
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
