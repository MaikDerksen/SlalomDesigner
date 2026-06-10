import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { bbox, closestPair, rotatePoint, worldPylons } from "../geometry";
import { validate } from "../validation";
import { PylonShape } from "./ObstacleGfx";
import { canvasBridge, safeCapture } from "../canvasBridge";
import type { ObstacleInstance, V2 } from "../types";

interface View {
  panX: number;
  panY: number;
  scale: number; // px pro Meter
}

type DragMode =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "move"; id: string; offX: number; offY: number }
  | { kind: "rotate"; id: string }
  | { kind: "pinch"; d0: number; scale0: number; cx: number; cy: number };

export function CanvasEditor() {
  const map = useStore((s) => s.map);
  const mapImage = useStore((s) => s.mapImage);
  const rules = useStore((s) => s.rules);
  const obstacles = useStore((s) => s.obstacles);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const moveObstacle = useStore((s) => s.moveObstacle);
  const rotateObstacle = useStore((s) => s.rotateObstacle);
  const deleteObstacle = useStore((s) => s.deleteObstacle);
  const duplicateObstacle = useStore((s) => s.duplicateObstacle);
  const pushUndo = useStore((s) => s.pushUndo);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ panX: 40, panY: 40, scale: 14 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<DragMode>({ kind: "none" });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const movedRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  /* Beim Mount und bei Map-Änderung die Fläche einpassen */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const { width: vw, height: vh } = el.getBoundingClientRect();
      const scale = Math.min((vw - 70) / map.width, (vh - 70) / map.height);
      setView({
        scale,
        panX: (vw - map.width * scale) / 2,
        panY: (vh - map.height * scale) / 2,
      });
    };
    fit();
  }, [map.width, map.height]);

  /* Bildschirm→Welt für Drag & Drop aus der Palette registrieren */
  useEffect(() => {
    canvasBridge.screenToWorld = (cx, cy) => {
      const el = svgRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
      const v = viewRef.current;
      return { x: (cx - r.left - v.panX) / v.scale, y: (cy - r.top - v.panY) / v.scale };
    };
    canvasBridge.viewCenter = () => {
      const el = svgRef.current!;
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (r.width / 2 - v.panX) / v.scale, y: (r.height / 2 - v.panY) / v.scale };
    };
    return () => {
      canvasBridge.screenToWorld = null;
      canvasBridge.viewCenter = null;
    };
  }, []);

  const toWorld = (clientX: number, clientY: number): V2 => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.panX) / v.scale, y: (clientY - r.top - v.panY) / v.scale };
  };

  /* Zoom mit Mausrad */
  const onWheel = (e: React.WheelEvent) => {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const scale = Math.min(200, Math.max(2, v.scale * factor));
      const k = scale / v.scale;
      return { scale, panX: mx - (mx - v.panX) * k, panY: my - (my - v.panY) * k };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    safeCapture(e.target as Element, e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      dragRef.current = {
        kind: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        scale0: viewRef.current.scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      return;
    }

    const target = e.target as Element;
    const obsId = target.closest("[data-obs]")?.getAttribute("data-obs");
    const isHandle = !!target.closest("[data-rotate]");

    if (isHandle && selectedId) {
      pushUndo();
      dragRef.current = { kind: "rotate", id: selectedId };
      return;
    }
    if (obsId) {
      const obs = obstacles.find((o) => o.id === obsId)!;
      const w = toWorld(e.clientX, e.clientY);
      select(obsId);
      pushUndo();
      dragRef.current = { kind: "move", id: obsId, offX: w.x - obs.x, offY: w.y - obs.y };
      setDraggingId(obsId);
      return;
    }
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      panX: viewRef.current.panX,
      panY: viewRef.current.panY,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dragRef.current;

    if (d.kind === "pinch" && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const k = dist / d.d0;
      setView((v) => {
        const scale = Math.min(200, Math.max(2, d.scale0 * k));
        const kk = scale / v.scale;
        const r = svgRef.current!.getBoundingClientRect();
        const mx = d.cx - r.left;
        const my = d.cy - r.top;
        return { scale, panX: mx - (mx - v.panX) * kk, panY: my - (my - v.panY) * kk };
      });
      return;
    }
    if (d.kind === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) > 3) movedRef.current = true;
      setView((v) => ({ ...v, panX: d.panX + dx, panY: d.panY + dy }));
      return;
    }
    if (d.kind === "move") {
      const w = toWorld(e.clientX, e.clientY);
      movedRef.current = true;
      moveObstacle(d.id, round2(w.x - d.offX), round2(w.y - d.offY));
      return;
    }
    if (d.kind === "rotate") {
      const obs = obstacles.find((o) => o.id === d.id);
      if (!obs) return;
      const w = toWorld(e.clientX, e.clientY);
      const deg = (Math.atan2(w.y - obs.y, w.x - obs.x) * 180) / Math.PI + 90;
      rotateObstacle(d.id, Math.round(deg / 5) * 5);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    const d = dragRef.current;
    if (d.kind === "pan" && !movedRef.current) select(null);
    dragRef.current = { kind: "none" };
    setDraggingId(null);
  };

  /* Validierung (Regel §7.2): zu nah → rot, außerhalb → rot, isoliert → gelb */
  const flags = useMemo(() => validate(obstacles, map, rules), [obstacles, map, rules]);

  const worldCache = useMemo(
    () => new Map(obstacles.map((o) => [o.id, worldPylons(o)])),
    [obstacles],
  );

  /* Abstandslinie zum nächsten Hindernis während des Ziehens */
  const distLine = useMemo(() => {
    if (!draggingId) return null;
    const mine = worldCache.get(draggingId);
    if (!mine) return null;
    let best: { p: V2; q: V2; d: number } | null = null;
    for (const o of obstacles) {
      if (o.id === draggingId) continue;
      const pair = closestPair(mine, worldCache.get(o.id)!);
      if (!best || pair.d < best.d) best = pair;
    }
    return best;
  }, [draggingId, obstacles, worldCache]);

  const selected = obstacles.find((o) => o.id === selectedId) ?? null;
  const selBox = selected ? bbox(worldCache.get(selected.id)!) : null;

  const gridLines = useMemo(() => {
    const lines: { x0: number; y0: number; x1: number; y1: number; major: boolean }[] = [];
    for (let x = 0; x <= Math.floor(map.width); x++)
      lines.push({ x0: x, y0: 0, x1: x, y1: map.height, major: x % 5 === 0 });
    for (let y = 0; y <= Math.floor(map.height); y++)
      lines.push({ x0: 0, y0: y, x1: map.width, y1: y, major: y % 5 === 0 });
    return lines;
  }, [map.width, map.height]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="canvas"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.scale})`}>
          {/* Fahrfläche */}
          <rect
            x={0}
            y={0}
            width={map.width}
            height={map.height}
            fill="var(--asphalt)"
            stroke="var(--asphalt-border)"
            strokeWidth={2 / view.scale}
            rx={0.3}
          />
          {/* Screenshot-Hintergrund (Map aus dem Wizard) */}
          {mapImage && (
            <image
              href={mapImage.data}
              x={0}
              y={0}
              width={map.width}
              height={map.height}
              preserveAspectRatio="none"
              opacity={0.95}
            />
          )}
          {/* Bereich außerhalb der erkannten Fahrfläche abdunkeln */}
          {map.boundary && map.boundary.length >= 3 && (
            <>
              <path
                d={`M-2 -2 H${map.width + 2} V${map.height + 2} H-2 Z M${map.boundary
                  .map((p) => `${p.x} ${p.y}`)
                  .join(" L")} Z`}
                fill="rgba(22,24,29,0.42)"
                fillRule="evenodd"
                pointerEvents="none"
              />
              <polygon
                points={map.boundary.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#22c55e"
                strokeWidth={2 / view.scale}
                pointerEvents="none"
              />
            </>
          )}
          {/* Sperrzonen */}
          {map.blocked?.map((zone, i) => (
            <polygon
              key={`bz${i}`}
              points={zone.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(217,45,32,0.32)"
              stroke="var(--danger)"
              strokeWidth={1.5 / view.scale}
              strokeDasharray={`${5 / view.scale} ${4 / view.scale}`}
              pointerEvents="none"
            />
          ))}
          {/* Sicherheits-Randabstand (nur Rechteck-Flächen) */}
          {!map.boundary && (
            <rect
              x={rules.edgeMargin}
              y={rules.edgeMargin}
              width={Math.max(0, map.width - 2 * rules.edgeMargin)}
              height={Math.max(0, map.height - 2 * rules.edgeMargin)}
              fill="none"
              stroke="var(--asphalt-border)"
              strokeWidth={1 / view.scale}
              strokeDasharray={`${6 / view.scale} ${6 / view.scale}`}
            />
          )}
          {gridLines.map((l, i) => (
            <line
              key={i}
              x1={l.x0}
              y1={l.y0}
              x2={l.x1}
              y2={l.y1}
              stroke={mapImage ? "#ffffff" : "var(--grid)"}
              strokeWidth={(l.major ? 1.4 : 0.6) / view.scale}
              opacity={mapImage ? (l.major ? 0.35 : 0.15) : l.major ? 0.8 : 0.5}
            />
          ))}

          {/* Maßangaben der Fläche */}
          <text
            x={map.width / 2}
            y={-0.6}
            textAnchor="middle"
            fontSize={Math.max(0.8, 14 / view.scale)}
            fill="var(--text-dim)"
          >
            {fmt(map.width)} m
          </text>
          <text
            x={-0.6}
            y={map.height / 2}
            textAnchor="middle"
            fontSize={Math.max(0.8, 14 / view.scale)}
            fill="var(--text-dim)"
            transform={`rotate(-90 ${-0.6} ${map.height / 2})`}
          >
            {fmt(map.height)} m
          </text>

          {/* Abstandslinie beim Ziehen */}
          {distLine && (
            <g>
              <line
                x1={distLine.p.x}
                y1={distLine.p.y}
                x2={distLine.q.x}
                y2={distLine.q.y}
                stroke={distLine.d < rules.minTaskGap ? "var(--danger)" : "var(--accent)"}
                strokeWidth={2 / view.scale}
                strokeDasharray={`${5 / view.scale} ${5 / view.scale}`}
              />
              <text
                x={(distLine.p.x + distLine.q.x) / 2}
                y={(distLine.p.y + distLine.q.y) / 2 - 8 / view.scale}
                textAnchor="middle"
                fontSize={14 / view.scale}
                fontWeight={600}
                fill={distLine.d < rules.minTaskGap ? "var(--danger)" : "var(--accent)"}
              >
                {distLine.d.toFixed(2)} m
              </text>
            </g>
          )}

          {/* Hindernisse */}
          {obstacles.map((obs, idx) => {
            const f = flags.get(obs.id);
            const invalid = !!(f && (f.tooClose || f.outOfBounds));
            const isolated = !!f?.isolated && !invalid;
            return (
              <g key={obs.id} data-obs={obs.id} style={{ cursor: "grab" }}>
                <g transform={`translate(${obs.x} ${obs.y}) rotate(${obs.rotation})`}>
                  {/* unsichtbare Trefffläche je Pylone */}
                  {obs.pylons.map((p, i) => (
                    <circle key={`hit${i}`} cx={p.x} cy={p.y} r={Math.max(0.35, rules.pylonBase)} fill="transparent" />
                  ))}
                  {obs.pylons.map((p, i) => (
                    <PylonShape key={i} p={p} base={rules.pylonBase} invalid={invalid} />
                  ))}
                </g>
                <Badge obs={obs} idx={idx} invalid={invalid} isolated={isolated} scale={view.scale} />
              </g>
            );
          })}

          {/* Auswahl */}
          {selected && selBox && (
            <g>
              <rect
                x={selBox.minX - 0.5}
                y={selBox.minY - 0.5}
                width={selBox.maxX - selBox.minX + 1}
                height={selBox.maxY - selBox.minY + 1}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.6 / view.scale}
                strokeDasharray={`${6 / view.scale} ${5 / view.scale}`}
                rx={0.3}
                pointerEvents="none"
              />
              <RotateHandle obs={selected} box={selBox} scale={view.scale} />
            </g>
          )}
        </g>
      </svg>

      {/* Aktionen für die Auswahl */}
      {selected && (
        <div className="selection-bar">
          <span className="sel-name">{selected.name}</span>
          <button onClick={() => rotateObstacle(selected.id, selected.rotation - 15)} title="15° links drehen">⟲</button>
          <button onClick={() => rotateObstacle(selected.id, selected.rotation + 15)} title="15° rechts drehen">⟳</button>
          <button onClick={() => duplicateObstacle(selected.id)} title="Duplizieren">⧉</button>
          <button className="danger" onClick={() => deleteObstacle(selected.id)} title="Löschen">✕</button>
        </div>
      )}
    </div>
  );
}

function Badge({
  obs,
  idx,
  invalid,
  isolated,
  scale,
}: {
  obs: ObstacleInstance;
  idx: number;
  invalid: boolean;
  isolated: boolean;
  scale: number;
}) {
  const r = Math.max(0.28, 13 / scale);
  const fill = invalid ? "var(--danger)" : isolated ? "var(--warn)" : "var(--ink)";
  return (
    <g pointerEvents="none">
      <circle cx={obs.x} cy={obs.y} r={r} fill={fill} opacity={0.92} />
      <text
        x={obs.x}
        y={obs.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r * 1.1}
        fontWeight={600}
        fill="#fff"
      >
        {idx + 1}
      </text>
    </g>
  );
}

function RotateHandle({
  obs,
  box,
  scale,
}: {
  obs: ObstacleInstance;
  box: { minY: number };
  scale: number;
}) {
  const hy = box.minY - 1.2;
  const r = Math.max(0.3, 12 / scale);
  // Griffpunkt oberhalb des Hindernisses, mitrotierend
  const local = rotatePoint({ x: 0, y: hy - obs.y }, 0);
  return (
    <g data-rotate style={{ cursor: "grab" }}>
      <line
        x1={obs.x}
        y1={obs.y}
        x2={obs.x + local.x}
        y2={hy}
        stroke="var(--accent)"
        strokeWidth={1.2 / scale}
        opacity={0.6}
      />
      <circle cx={obs.x} cy={hy} r={r} fill="var(--accent)" />
      <text
        x={obs.x}
        y={hy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r * 1.2}
        fill="#fff"
        pointerEvents="none"
      >
        ⟳
      </text>
    </g>
  );
}

function fmt(v: number): string {
  return v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
