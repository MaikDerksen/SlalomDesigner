import type { Pylon, Rules } from "./types";
import { laneWidth, laneCenterDist } from "./types";
import { arc, centerPylons, channel, round2 } from "./geometry";

/**
 * Hindernis-Vorlagen nach ADAC Kartslalom Reglement 2026, §7.3.
 * Jede Vorlage erzeugt aus dem aktuellen Regelwerk die Pylonen-Anordnung
 * (lokale Koordinaten in m, Anker = Mittelpunkt).
 */
export interface ObstacleTemplate {
  id: string;
  name: string;
  /** Reglement-Referenz, z. B. "§7.3.4" */
  ref: string;
  build: (r: Rules) => Pylon[];
}

const std = (x: number, y: number): Pylon => ({ x: round2(x), y: round2(y) });
const lie = (x: number, y: number, angle: number): Pylon => ({
  x: round2(x),
  y: round2(y),
  lying: true,
  angle,
});

export const TEMPLATES: ObstacleTemplate[] = [
  {
    id: "tor",
    name: "Pylonentor",
    ref: "§7.3.4",
    build: (r) => {
      const w = laneCenterDist(r);
      return [std(-w / 2, 0), std(w / 2, 0)];
    },
  },
  {
    id: "einzelpylone",
    name: "Einzelpylone",
    ref: "§7.2",
    build: (r) => {
      // Liegende Pylone zeigt mit der Spitze auf den Fuß der stehenden,
      // Abstand = eine Pylonenhöhe.
      const d = r.pylonHeight + r.pylonBase;
      return centerPylons([std(0, 0), lie(0, d, -90)]);
    },
  },
  {
    id: "wechseltor",
    name: "Wechseltor",
    ref: "§7.3.5",
    build: (r) => {
      // Zwei Tore in einer geraden Linie, Torabstand 1,5–4 m.
      const w = laneCenterDist(r);
      const gap = (r.wechselGapMin + r.wechselGapMax) / 2;
      const x0 = -(w + gap / 2);
      return centerPylons([
        std(x0, 0),
        std(x0 + w, 0),
        std(x0 + w + gap, 0),
        std(x0 + 2 * w + gap, 0),
      ]);
    },
  },
  {
    id: "spurgasse",
    name: "Spurgasse (gerade)",
    ref: "§7.3.1",
    build: (r) => {
      // 3–5 Pylonen pro Seite, gesamtheitlich markiert.
      const half = laneCenterDist(r) / 2;
      const n = 4;
      const len = 4.5;
      const out: Pylon[] = [];
      for (let i = 0; i < n; i++) {
        const y = -len / 2 + (len * i) / (n - 1);
        out.push(std(-half, y), std(half, y));
      }
      return out;
    },
  },
  {
    id: "spurgasse-gebogen",
    name: "Spurgasse (gebogen)",
    ref: "§7.3.1",
    build: (r) => {
      // 5–10 Pylonen pro Seite, Pylonenabstand 50 cm, 90°-Bogen.
      const w = laneWidth(r);
      const rIn = 1.6;
      const center = arc(0, 0, rIn + w / 2, 180, 270);
      return centerPylons(limitPerSide(channel(center, w, r.laneGap, r.pylonBase), 10));
    },
  },
  {
    id: "schweizer",
    name: "Schweizer Slalom",
    ref: "§7.3.2",
    build: (r) => {
      // Einzelne stehende Pylonen in einer Linie, wechselseitig zu umfahren.
      const d = r.pylonHeight + r.pylonBase;
      const gap = Math.max(r.minTaskGap, 4);
      const out: Pylon[] = [];
      for (let i = 0; i < 3; i++) {
        const y = i * gap;
        const side = i % 2 === 0 ? 1 : -1;
        out.push(std(0, y), lie(side * d, y, side > 0 ? 180 : 0));
      }
      return centerPylons(out);
    },
  },
  {
    id: "kreisel",
    name: "Kreisel",
    ref: "§7.3.3",
    build: (r) => {
      const rIn = r.kreiselInnerD / 2;
      const rOut = rIn + laneWidth(r) + r.pylonBase;
      const out: Pylon[] = [];
      // Innenring komplett
      ringPylons(out, rIn, r.kreiselGap, []);
      // Außenring mit Lücken für Ein- (3 m) und Ausfahrt (Spurbreite + 40 cm)
      const entryHalf = ((r.kreiselEntry / 2 + r.pylonBase) / rOut) * (180 / Math.PI);
      const exitHalf = (((laneWidth(r) + r.pylonBase) / 2) / rOut) * (180 / Math.PI);
      ringPylons(out, rOut, r.kreiselGap, [
        { center: 90, half: entryHalf },
        { center: 0, half: exitHalf },
      ]);
      // Liegende Pylonen markieren Ein- und Ausfahrt
      out.push(lie(0, rOut + 0.4, -90), lie(rOut + 0.4, 0, 180));
      return out;
    },
  },
  {
    id: "wende",
    name: "Wende 90–180°",
    ref: "§7.3.6",
    build: (r) => {
      // Drei Pylonen im Dreieck, gesamtheitlich markiert.
      const s = r.laneGap;
      return centerPylons([std(-s / 2, 0), std(s / 2, 0), std(0, -s * 0.87)]);
    },
  },
  {
    id: "ypsilon",
    name: "Ypsilon",
    ref: "§7.3.7",
    build: (r) => {
      const w = laneWidth(r);
      const armLen = 2.6;
      const out: Pylon[] = [];
      // Drei Arme, 120° versetzt; jeder Arm ist eine kurze Gasse nach außen.
      for (let k = 0; k < 3; k++) {
        const a = (90 + k * 120) * (Math.PI / 180);
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        const inner = w / 2 + 0.45;
        const arm = channel(
          [
            { x: dir.x * inner, y: dir.y * inner },
            { x: dir.x * (inner + armLen), y: dir.y * (inner + armLen) },
          ],
          w,
          r.laneGap,
          r.pylonBase,
        );
        out.push(...arm);
      }
      return centerPylons(out);
    },
  },
  {
    id: "s-gasse",
    name: "S-Spurgasse",
    ref: "§7.3.8",
    build: (r) => {
      // S-förmige Gasse als Sinuslinie.
      const w = laneWidth(r);
      const len = 6;
      const amp = 1.3;
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const y = -len / 2 + (len * i) / 60;
        pts.push({ x: amp * Math.sin((y / len) * 2 * Math.PI), y });
      }
      return centerPylons(channel(pts, w, r.laneGap, r.pylonBase));
    },
  },
  {
    id: "z-gasse",
    name: "Z-Gasse",
    ref: "§7.3.9",
    build: (r) => {
      // Parallele Gassen, Abstand > 2 m (>4 m wäre eine neue Aufgabe).
      const w = laneWidth(r);
      const len = 4;
      const gap = 2.2;
      const out: Pylon[] = [];
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * gap;
        const seg = channel(
          [
            { x, y: -len / 2 },
            { x, y: len / 2 },
          ],
          w,
          r.laneGap,
          r.pylonBase,
        );
        out.push(...seg);
      }
      return centerPylons(out);
    },
  },
  {
    id: "kasten",
    name: "Kasten",
    ref: "§7.3.10",
    build: (r) => {
      // Rechteckige Aufgabe; Ein- und Ausfahrt = Spurbreite + 40 cm.
      const w = laneWidth(r);
      const size = 2 * w + 1.2;
      const half = size / 2;
      const gapHalf = (w + r.pylonBase) / 2;
      const out: Pylon[] = [];
      const edge = (x0: number, y0: number, x1: number, y1: number, holes: { at: number; half: number }[] = []) => {
        const L = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.floor(L / r.laneGap);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const pos = t * L;
          if (holes.some((h) => Math.abs(pos - h.at) < h.half)) continue;
          out.push(std(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
        }
      };
      // Unterkante mit Ein- und Ausfahrt-Lücken
      edge(-half, half, half, half, [
        { at: size * 0.25, half: gapHalf },
        { at: size * 0.75, half: gapHalf },
      ]);
      edge(-half, -half, half, -half);
      edge(-half, -half, -half, half);
      edge(half, -half, half, half);
      // Trennwand in der Mitte (erzwingt die Schleife im Kasten)
      edge(0, half - 0.01, 0, -half + w + r.pylonBase);
      return out;
    },
  },
  {
    id: "schneckenhaus",
    name: "Schneckenhaus",
    ref: "§7.3.11",
    build: (r) => {
      // Spiralförmige Gasse, von innen nach außen befahrbar.
      const w = laneWidth(r);
      const pitch = w + r.pylonBase + 0.25;
      const pts = [];
      const turns = 1.9;
      for (let i = 0; i <= 140; i++) {
        const t = (i / 140) * turns * 2 * Math.PI;
        const rad = 0.9 + (pitch * t) / (2 * Math.PI);
        pts.push({ x: rad * Math.cos(t), y: rad * Math.sin(t) });
      }
      return centerPylons(channel(pts, w, r.laneGap, r.pylonBase));
    },
  },
  {
    id: "kreuz",
    name: "Kreuz",
    ref: "§7.3.12",
    build: (r) => {
      const w = laneWidth(r);
      const armLen = 2.4;
      const inner = w / 2 + 0.45;
      const out: Pylon[] = [];
      for (let k = 0; k < 4; k++) {
        const a = (k * 90) * (Math.PI / 180);
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        out.push(
          ...channel(
            [
              { x: dir.x * inner, y: dir.y * inner },
              { x: dir.x * (inner + armLen), y: dir.y * (inner + armLen) },
            ],
            w,
            r.laneGap,
            r.pylonBase,
          ),
        );
      }
      return centerPylons(out);
    },
  },
  {
    id: "brezel",
    name: "Brezel / Knoten",
    ref: "§7.3.13",
    build: (r) => {
      // Zwei Schleifen; kann auch mit nur einer Schleife gefahren werden.
      const w = laneWidth(r);
      const rad = 1.4 + w / 2;
      const cx = rad + 0.6;
      const loopL = arc(-cx, 0, rad, -60, 240);
      const loopR = arc(cx, 0, rad, 120, 420);
      return centerPylons([
        ...channel(loopL, w, r.laneGap, r.pylonBase),
        ...channel(loopR, w, r.laneGap, r.pylonBase),
      ]);
    },
  },
  {
    id: "deutsches-eck",
    name: "Deutsches Eck",
    ref: "§7.3.14",
    build: (r) => {
      // 90°-Ecke; Ein- und Ausfahrt = Spurbreite + 40 cm.
      const w = laneWidth(r);
      const leg = 2.8;
      const center = [
        { x: -leg, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: -leg },
      ];
      return centerPylons(channel(center, w, r.laneGap, r.pylonBase));
    },
  },
  {
    id: "schikane",
    name: "Schikane",
    ref: "§7.3.17",
    build: (r) => {
      const w = laneWidth(r);
      const center = [
        { x: 0, y: 2.4 },
        { x: 0, y: 1.0 },
        { x: 1.4, y: 0.2 },
        { x: 1.4, y: -1.2 },
      ];
      return centerPylons(channel(center, w, r.laneGap, r.pylonBase));
    },
  },
  {
    id: "zielgasse",
    name: "Zielgasse",
    ref: "§7.3.16",
    build: (r) => {
      // Breite 2,5 m, Länge 8–10 m, Pylonen einzeln gewertet.
      const len = r.zielLength;
      return centerPylons(
        channel(
          [
            { x: 0, y: -len / 2 },
            { x: 0, y: len / 2 },
          ],
          r.zielWidth,
          r.laneGap,
          r.pylonBase,
        ),
      );
    },
  },
];

/** Begrenzung der Pylonenanzahl pro Seite (Reglement-Obergrenzen). */
function limitPerSide(pylons: Pylon[], maxPerSide: number): Pylon[] {
  const half = Math.ceil(pylons.length / 2);
  if (half <= maxPerSide) return pylons;
  const a = pylons.slice(0, half);
  const b = pylons.slice(half);
  const thin = (arr: Pylon[]) => {
    const keep = Math.min(arr.length, maxPerSide);
    const out: Pylon[] = [];
    for (let i = 0; i < keep; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (keep - 1))]);
    return out;
  };
  return [...thin(a), ...thin(b)];
}

/** Ring aus Pylonen mit optionalen Lücken (Winkel in Grad). */
function ringPylons(
  out: Pylon[],
  radius: number,
  gap: number,
  holes: { center: number; half: number }[],
) {
  const n = Math.max(8, Math.round((2 * Math.PI * radius) / gap));
  for (let i = 0; i < n; i++) {
    const aDeg = (360 * i) / n;
    const inHole = holes.some((h) => {
      const diff = Math.abs(((aDeg - h.center + 540) % 360) - 180);
      return diff < h.half;
    });
    if (inHole) continue;
    const a = (aDeg * Math.PI) / 180;
    out.push(std(radius * Math.cos(a), radius * Math.sin(a)));
  }
}

export function templateById(id: string): ObstacleTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
