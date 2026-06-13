import { useMemo } from "react";
import type { MapConfig, ObstacleInstance, Rules, V2 } from "../types";
import type { RouteData } from "../routing";
import { analyzeRoute, routeEntries } from "../routing";
import { dist } from "../geometry";
import { useStore } from "../store";

/**
 * Zeichnet die Strecken-Route wie eine Navigations-Route:
 *  – 3-lagige Linie: Schatten-Halo + weißes Casing + farbiger Kern (runde Enden),
 *    geglättet (Catmull-Rom) statt facettierter Polyline
 *  – Chevron-Pfeile, bildschirm-konstant groß und in echten Metern beabstandet,
 *    ausgedünnt rund um Marker/Kreuzungen
 *  – Kreuzungen als „Brücke": der später gefahrene Abschnitt liegt mit breiterem
 *    Casing klar oben → kein Verwechseln von Geradeaus und Abbiegen
 *  – Start-Puck, Ziel als Schachflagge, Einfahrts-Pfeile je Hindernis
 *  – Warnungen: zu enger Radius / Fläche verlassen / durch Pylonen
 *  Alle Farben theme-sicher (eigene Tokens, kein --ink).
 */
export function RouteLayer({
  route,
  obstacles,
  map,
  rules,
  scale,
}: {
  route: RouteData;
  obstacles: ObstacleInstance[];
  map: MapConfig;
  rules: Rules;
  scale: number;
}) {
  const pts = route.points;
  const customTemplates = useStore((s) => s.customTemplates);

  const analysis = useMemo(() => analyzeRoute(pts, map, rules, obstacles), [pts, map, rules, obstacles]);
  const entries = useMemo(
    () => routeEntries(pts, obstacles, rules, customTemplates),
    [pts, obstacles, rules, customTemplates],
  );

  /** Geglättete Linie (Catmull-Rom → Bézier) für einen flüssigen Fahrlinien-Look. */
  const d = useMemo(() => smoothPath(pts), [pts]);

  /** Brücken: kurzer Abschnitt des späteren Durchgangs je Kreuzung (geglättet). */
  const bridges = useMemo(() => {
    return analysis.crossings
      .map((c) => {
        const close: number[] = [];
        for (let i = 0; i < pts.length; i++) if (dist(pts[i], c) < 0.6) close.push(i);
        const clusters: number[][] = [];
        for (const i of close) {
          const last = clusters[clusters.length - 1];
          if (last && i - last[last.length - 1] <= 3) last.push(i);
          else clusters.push([i]);
        }
        const later = clusters[clusters.length - 1];
        if (!later) return null;
        const mid = later[Math.floor(later.length / 2)];
        const from = Math.max(0, mid - 5);
        const to = Math.min(pts.length - 1, mid + 5);
        return smoothPath(pts.slice(from, to + 1));
      })
      .filter((b): b is string => !!b);
  }, [analysis.crossings, pts]);

  // Bildschirm-konstante Größen (px → Weltmeter), mit sinnvollen Grenzen
  const px = (v: number) => v / scale;
  const lw = clamp(px(7), 0.16, 0.4); // Kern
  const casing = lw * 2.1; // weißer Rand
  const halo = casing * 1.35; // Schatten
  const markerR = clamp(px(13), 0.45, 1.4);

  // Punkte, an denen Chevrons ausgedünnt werden (Marker brauchen Platz)
  const declutter = useMemo<V2[]>(
    () => [pts[0], pts[pts.length - 1], ...analysis.crossings, ...entries.map((e) => e.p)],
    [pts, analysis.crossings, entries],
  );

  /** Chevron-Pfeile, alle ~7 m entlang der Bogenlänge, de-jittert und ausgedünnt. */
  const chevrons = useMemo(() => {
    const out: { p: V2; deg: number }[] = [];
    if (pts.length < 6) return out;
    const stepM = 7;
    let acc = 0;
    for (let i = 2; i < pts.length - 2; i++) {
      acc += dist(pts[i - 1], pts[i]);
      if (acc < stepM) continue;
      acc = 0;
      const a = pts[i - 2];
      const b = pts[i + 2];
      const p = pts[i];
      if (declutter.some((m) => m && dist(m, p) < 2)) continue;
      out.push({ p, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
    }
    return out;
  }, [pts, declutter]);

  const start = pts[0];
  const end = pts[pts.length - 1];
  const startDeg = (Math.atan2(pts[2].y - start.y, pts[2].x - start.x) * 180) / Math.PI;
  const ch = clamp(px(7), 0.18, 0.5); // Chevron-Halbgröße

  return (
    <g pointerEvents="none">
      {/* 3-lagige Grundlinie */}
      <path d={d} fill="none" stroke="var(--route-halo)" strokeWidth={halo} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--route-casing)" strokeWidth={casing} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--route)" strokeWidth={lw} strokeLinejoin="round" strokeLinecap="round" />

      {/* Sanfte Fluss-Animation (respektiert prefers-reduced-motion via CSS) */}
      <path
        className="route-flow"
        d={d}
        fill="none"
        stroke="var(--route-casing)"
        strokeWidth={lw * 0.5}
        strokeLinecap="round"
        strokeDasharray={`${lw * 1.2} ${lw * 5}`}
        opacity={0.5}
      />

      {/* Brücken über Kreuzungen */}
      {bridges.map((b, i) => (
        <g key={`br${i}`}>
          <path d={b} fill="none" stroke="var(--route-halo)" strokeWidth={halo * 1.5} strokeLinecap="round" />
          <path d={b} fill="none" stroke="var(--route-casing)" strokeWidth={casing * 1.7} strokeLinecap="round" />
          <path d={b} fill="none" stroke="var(--route)" strokeWidth={lw} strokeLinecap="round" />
        </g>
      ))}

      {/* Richtungs-Chevrons (weiß, im Kern liegend) */}
      {chevrons.map((a, i) => (
        <g key={`ch${i}`} transform={`translate(${a.p.x} ${a.p.y}) rotate(${a.deg})`}>
          <path
            d={`M${-ch * 0.6} ${-ch} L${ch * 0.5} 0 L${-ch * 0.6} ${ch}`}
            fill="none"
            stroke="var(--route-casing)"
            strokeWidth={ch * 0.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ))}

      {/* Einfahrts-Pfeile an den Hindernissen */}
      {entries.map((e) => {
        const a = clamp(px(11), 0.4, 1.1);
        return (
          <g key={e.obstacleId} transform={`translate(${e.p.x} ${e.p.y}) rotate(${e.angleDeg})`}>
            <polygon
              points={`${a},0 ${-a * 0.7},${-a * 0.72} ${-a * 0.7},${a * 0.72}`}
              fill="var(--route-entry)"
              stroke="var(--route-casing)"
              strokeWidth={a * 0.16}
              strokeLinejoin="round"
            />
          </g>
        );
      })}

      {/* Start-Puck mit Abschuss-Chevron */}
      <g transform={`translate(${start.x} ${start.y})`}>
        <circle r={markerR * 1.18} fill="var(--route-casing)" opacity={0.95} />
        <circle r={markerR} fill="var(--ok)" />
        <text textAnchor="middle" dominantBaseline="central" fontSize={markerR * 1.1} fill="#fff" fontWeight={800}>
          S
        </text>
      </g>
      <g transform={`translate(${start.x} ${start.y}) rotate(${startDeg})`}>
        <path
          d={`M${markerR * 1.4} 0 L${markerR * 0.7} ${-markerR * 0.5} L${markerR * 0.7} ${markerR * 0.5} Z`}
          fill="var(--ok)"
          stroke="var(--route-casing)"
          strokeWidth={markerR * 0.12}
        />
      </g>

      {/* Ziel: Schachflaggen-Puck */}
      <FinishMarker x={end.x} y={end.y} r={markerR} />

      {/* Warnungen */}
      {analysis.warnings.map((w, i) => (
        <g key={`w${i}`} transform={`translate(${w.p.x} ${w.p.y})`}>
          <circle r={clamp(px(14), 0.5, 1.4)} fill="var(--danger)" opacity={0.95} stroke="var(--route-casing)" strokeWidth={px(1.2)} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={clamp(px(15), 0.55, 1.5)} fill="#fff" fontWeight={800}>
            !
          </text>
          <title>{w.msg}</title>
        </g>
      ))}
    </g>
  );
}

/** Schachflaggen-Zielmarker (theme-sicher, immer dunkel/weiß). */
function FinishMarker({ x, y, r }: { x: number; y: number; r: number }) {
  const clipId = `finish-clip-${Math.round(x * 100)}-${Math.round(y * 100)}`;
  const q = r; // halbe Kantenlänge eines Schachfeldes
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r * 1.2} fill="var(--route-casing)" />
      <circle r={r} fill="var(--badge)" />
      <clipPath id={clipId}>
        <circle r={r} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x={-q} y={-q} width={q} height={q} fill="#fff" />
        <rect x={0} y={0} width={q} height={q} fill="#fff" />
      </g>
      <circle r={r} fill="none" stroke="var(--route-casing)" strokeWidth={r * 0.14} />
    </g>
  );
}

/** Catmull-Rom durch (dezimierte) Punkte → glatte kubische Bézier-Kurve. */
function smoothPath(points: V2[]): string {
  if (points.length < 3) return "M" + points.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L");
  // Dezimieren (Stützpunkte ~ jeder 4.), Endpunkte erhalten
  const ctrl: V2[] = [points[0]];
  for (let i = 4; i < points.length - 1; i += 4) ctrl.push(points[i]);
  ctrl.push(points[points.length - 1]);
  if (ctrl.length < 3) return "M" + points.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L");

  let d = `M${r2(ctrl[0].x)} ${r2(ctrl[0].y)}`;
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[i - 1] ?? ctrl[i];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function r2(v: number): number {
  return Math.round(v * 1000) / 1000;
}
