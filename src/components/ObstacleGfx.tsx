import type { Pylon } from "../types";

/** SVG-Darstellung einer Pylonengruppe (Einheiten = Meter). */
export function PylonShape({ p, base, invalid }: { p: Pylon; base: number; invalid: boolean }) {
  const color = invalid ? "var(--danger)" : "var(--pylon)";
  if (p.lying) {
    const a = p.angle ?? 0;
    return (
      <g transform={`translate(${p.x} ${p.y}) rotate(${a})`}>
        <polygon
          points={`${base * 1.6},0 ${-base * 0.5},${-base * 0.5} ${-base * 0.5},${base * 0.5}`}
          fill={color}
          opacity={0.9}
        />
      </g>
    );
  }
  return (
    <g transform={`translate(${p.x} ${p.y})`}>
      <rect x={-base / 2} y={-base / 2} width={base} height={base} fill={color} rx={base * 0.12} />
      <circle r={base * 0.22} fill="#fff" />
    </g>
  );
}

export function ObstaclePreview({
  pylons,
  base,
  size = 84,
}: {
  pylons: Pylon[];
  base: number;
  size?: number;
}) {
  if (!pylons.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pylons) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 0.6;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const span = Math.max(w, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${cx - span / 2} ${cy - span / 2} ${span} ${span}`}
      style={{ display: "block" }}
    >
      {pylons.map((p, i) => (
        <PylonShape key={i} p={p} base={Math.max(base, span * 0.025)} invalid={false} />
      ))}
    </svg>
  );
}
