import { useMemo } from "react";
import type { MapConfig, ObstacleInstance, Rules, V2 } from "../types";
import type { RouteData } from "../routing";
import { analyzeRoute, routeEntries } from "../routing";
import { dist } from "../geometry";
import { useStore } from "../store";

/**
 * Zeichnet die Strecken-Route:
 *  – weiße Kontur + farbige Linie, Richtungspfeile alle ~6 m
 *  – Kreuzungen: der SPÄTER gefahrene Abschnitt wird als „Brücke" über den
 *    früheren gelegt (weiße Unterbrechung), damit klar ist, dass es geradeaus
 *    weitergeht und nicht abgebogen wird
 *  – Einfahrts-Pfeile an jedem Hindernis
 *  – Warnungen: zu enger Kurvenradius (Kart-Wendekreis) / Fahrfläche verlassen
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

  const d = useMemo(() => "M" + pts.map((p) => `${p.x} ${p.y}`).join(" L"), [pts]);

  /** Brücken: kurzer Abschnitt des späteren Durchgangs je Kreuzung. */
  const bridges = useMemo(() => {
    return analysis.crossings.map((c) => {
      // Indizes aller Annäherungen an den Kreuzungspunkt, in Cluster teilen
      const close: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        if (dist(pts[i], c) < 0.6) close.push(i);
      }
      const clusters: number[][] = [];
      for (const i of close) {
        const last = clusters[clusters.length - 1];
        if (last && i - last[last.length - 1] <= 3) last.push(i);
        else clusters.push([i]);
      }
      const later = clusters[clusters.length - 1];
      if (!later) return null;
      const mid = later[Math.floor(later.length / 2)];
      const from = Math.max(0, mid - 4);
      const to = Math.min(pts.length - 1, mid + 4);
      return "M" + pts.slice(from, to + 1).map((p) => `${p.x} ${p.y}`).join(" L");
    });
  }, [analysis.crossings, pts]);

  /** Richtungspfeile entlang der Route. */
  const arrows = useMemo(() => {
    const out: { p: V2; deg: number }[] = [];
    const step = 18; // ~6 m bei 0,35-m-Sampling
    for (let i = step; i < pts.length - 2; i += step) {
      const a = pts[i];
      const b = pts[i + 2];
      out.push({ p: a, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
    }
    return out;
  }, [pts]);

  const lw = 0.24;
  const casing = 0.55;
  const start = pts[0];
  const end = pts[pts.length - 1];
  const endDeg = (Math.atan2(end.y - pts[pts.length - 3].y, end.x - pts[pts.length - 3].x) * 180) / Math.PI;

  return (
    <g pointerEvents="none">
      {/* Grundlinie */}
      <path d={d} fill="none" stroke="#ffffff" strokeWidth={casing} strokeLinejoin="round" opacity={0.9} />
      <path d={d} fill="none" stroke="var(--route)" strokeWidth={lw} strokeLinejoin="round" />

      {/* Brücken über Kreuzungen: später gefahrener Abschnitt oben */}
      {bridges.map(
        (b, i) =>
          b && (
            <g key={`br${i}`}>
              <path d={b} fill="none" stroke="#ffffff" strokeWidth={casing * 1.25} strokeLinecap="round" />
              <path d={b} fill="none" stroke="var(--route)" strokeWidth={lw} strokeLinecap="round" />
            </g>
          ),
      )}

      {/* Richtungspfeile */}
      {arrows.map((a, i) => (
        <g key={`ar${i}`} transform={`translate(${a.p.x} ${a.p.y}) rotate(${a.deg})`}>
          <polygon points="0.55,0 -0.25,-0.4 -0.25,0.4" fill="var(--route)" stroke="#fff" strokeWidth={0.08} />
        </g>
      ))}

      {/* Einfahrts-Pfeile an den Hindernissen */}
      {entries.map((e) => (
        <g key={e.obstacleId} transform={`translate(${e.p.x} ${e.p.y}) rotate(${e.angleDeg})`}>
          <polygon
            points="0.95,0 -0.45,-0.7 -0.45,0.7"
            fill="var(--route-entry)"
            stroke="#fff"
            strokeWidth={0.12}
          />
        </g>
      ))}

      {/* Start und Ziel */}
      <g transform={`translate(${start.x} ${start.y})`}>
        <circle r={Math.max(0.5, 13 / scale)} fill="var(--ok)" stroke="#fff" strokeWidth={0.12} />
        <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(0.55, 13 / scale)} fill="#fff" fontWeight={700}>
          S
        </text>
      </g>
      <g transform={`translate(${end.x} ${end.y}) rotate(${endDeg})`}>
        <polygon points="1.2,0 -0.3,-0.75 -0.3,0.75" fill="var(--ink)" stroke="#fff" strokeWidth={0.12} />
      </g>

      {/* Warnungen */}
      {analysis.warnings.map((w, i) => (
        <g key={`w${i}`} transform={`translate(${w.p.x} ${w.p.y})`}>
          <circle r={Math.max(0.6, 14 / scale)} fill="var(--danger)" opacity={0.92} stroke="#fff" strokeWidth={0.1} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.max(0.7, 15 / scale)}
            fill="#fff"
            fontWeight={700}
          >
            !
          </text>
          <title>{w.msg}</title>
        </g>
      ))}
    </g>
  );
}
