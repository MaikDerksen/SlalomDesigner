import { useRef, useState } from "react";
import type { V2 } from "../types";
import { safeCapture } from "../canvasBridge";

/**
 * Editierbares Polygon innerhalb eines SVG (Koordinaten = Bild-px):
 * – Eckpunkte ziehen
 * – Mittelpunkte ziehen/antippen → neuer Punkt
 * – Punkt antippen → auswählen, ✕ daneben löscht (min. 3 Punkte bleiben)
 */
export function PolygonEditor({
  points,
  onChange,
  color,
  handleR,
  fill = "transparent",
}: {
  points: V2[];
  onChange: (pts: V2[]) => void;
  color: string;
  handleR: number;
  fill?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const drag = useRef<{ idx: number; svg: SVGSVGElement } | null>(null);

  const toSvg = (svg: SVGSVGElement, e: React.PointerEvent): V2 => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: pt.x, y: pt.y };
  };

  const startDrag = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    const svg = (e.target as Element).closest("svg") as SVGSVGElement;
    safeCapture(e.target as Element, e.pointerId);
    drag.current = { idx, svg };
    setSelected(idx);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    e.stopPropagation();
    const p = toSvg(drag.current.svg, e);
    onChange(points.map((q, i) => (i === drag.current!.idx ? p : q)));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) e.stopPropagation();
    drag.current = null;
  };

  const insertAt = (e: React.PointerEvent, after: number) => {
    e.stopPropagation();
    const svg = (e.target as Element).closest("svg") as SVGSVGElement;
    const p = toSvg(svg, e);
    const next = [...points.slice(0, after + 1), p, ...points.slice(after + 1)];
    onChange(next);
    safeCapture(e.target as Element, e.pointerId);
    drag.current = { idx: after + 1, svg };
    setSelected(after + 1);
  };

  const deleteSelected = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
    if (selected === null || points.length <= 3) return;
    onChange(points.filter((_, i) => i !== selected));
    setSelected(null);
  };

  const sel = selected !== null && selected < points.length ? points[selected] : null;

  return (
    <g>
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill={fill}
        stroke={color}
        strokeWidth={handleR * 0.35}
        strokeLinejoin="round"
      />
      {/* Mittelpunkte zum Einfügen */}
      {points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        return (
          <circle
            key={`m${i}`}
            cx={(p.x + q.x) / 2}
            cy={(p.y + q.y) / 2}
            r={handleR * 0.55}
            fill="#fff"
            stroke={color}
            strokeWidth={handleR * 0.18}
            opacity={0.75}
            style={{ cursor: "copy" }}
            onPointerDown={(e) => insertAt(e, i)}
            onPointerMove={onMove}
            onPointerUp={endDrag}
          />
        );
      })}
      {/* Eckpunkte */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={handleR * (selected === i ? 1.25 : 1)}
          fill={selected === i ? color : "#fff"}
          stroke={color}
          strokeWidth={handleR * 0.3}
          style={{ cursor: "grab" }}
          onPointerDown={(e) => startDrag(e, i)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (points.length > 3) {
              onChange(points.filter((_, k) => k !== i));
              setSelected(null);
            }
          }}
        />
      ))}
      {/* Löschen-Knopf neben dem ausgewählten Punkt */}
      {sel && points.length > 3 && (
        <g
          transform={`translate(${sel.x + handleR * 2.4} ${sel.y - handleR * 2.4})`}
          style={{ cursor: "pointer" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={deleteSelected}
        >
          <circle r={handleR * 1.1} fill="var(--danger)" />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={handleR * 1.3}
            fill="#fff"
            pointerEvents="none"
          >
            ×
          </text>
        </g>
      )}
    </g>
  );
}
