import type { Pylon, Rules, V2 } from "./types";
import { laneWidth, laneCenterDist } from "./types";
import { arc, bbox, channel, round2 } from "./geometry";

/**
 * Hindernis-Vorlagen nach ADAC Kartslalom Reglement 2026, §7.3,
 * abgeglichen mit den offiziellen Skizzen (Seiten 11–16).
 *
 * Jede Vorlage liefert:
 *  – build(r): Pylonen-Anordnung (lokale Koordinaten in m)
 *  – route(r): die vorgesehene Fahrlinie durch die Aufgabe (Einfahrt → Ausfahrt),
 *    Basis für die Strecken-Route und die Einfahrts-Markierungen.
 * Pylonen und Fahrlinie werden gemeinsam zentriert, damit sie zueinander passen.
 */
export interface ObstacleTemplate {
  id: string;
  name: string;
  /** Reglement-Referenz, z. B. "§7.3.4" */
  ref: string;
  build: (r: Rules) => Pylon[];
  route: (r: Rules) => V2[];
}

interface Built {
  pylons: Pylon[];
  route: V2[];
}

const std = (x: number, y: number): Pylon => ({ x: round2(x), y: round2(y) });
const lie = (x: number, y: number, angle: number): Pylon => ({
  x: round2(x),
  y: round2(y),
  lying: true,
  angle: Math.round(angle),
});

/** Pylonen UND Fahrlinie um den Pylonen-Schwerpunkt zentrieren. */
function finalize(b: Built): Built {
  if (!b.pylons.length) return b;
  const box = bbox(b.pylons);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    pylons: b.pylons.map((p) => ({ ...p, x: round2(p.x - cx), y: round2(p.y - cy) })),
    route: b.route.map((p) => ({ x: round2(p.x - cx), y: round2(p.y - cy) })),
  };
}

/** Gerade Pylonen-Reihe von a nach b, Abstand gap. */
function row(a: V2, b: V2, gap: number): Pylon[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.floor(len / gap));
  const out: Pylon[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(std(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
  }
  return out;
}

type Builder = (r: Rules) => Built;

const BUILDERS: { id: string; name: string; ref: string; make: Builder }[] = [
  {
    id: "tor",
    name: "Pylonentor",
    ref: "§7.3.4",
    make: (r) => {
      const s = laneCenterDist(r);
      return {
        pylons: [std(-s / 2, 0), std(s / 2, 0)],
        route: [
          { x: 0, y: -1.8 },
          { x: 0, y: 1.8 },
        ],
      };
    },
  },
  {
    id: "einzelpylone",
    name: "Einzelpylone",
    ref: "§7.2",
    make: (r) => {
      // Liegende Pylone zeigt mit der Spitze auf den Fuß der stehenden,
      // Abstand = eine Pylonenhöhe; sie gibt die Umfahr-Richtung an.
      const d = r.pylonHeight + r.pylonBase;
      return {
        pylons: [std(0, 0), lie(0, d, -90)],
        // U-förmig um die stehende Pylone herum
        route: [{ x: -1.1, y: 2.2 }, { x: -1.1, y: 0.4 }, ...arc(0, 0, 1.1, 180, 360, 16), { x: 1.1, y: 2.2 }],
      };
    },
  },
  {
    id: "wechseltor",
    name: "Wechseltor",
    ref: "§7.3.5",
    make: (r) => {
      // Zwei Tore in einer geraden Linie, Torabstand 1,5–4 m,
      // unmittelbar nacheinander in Gegenrichtung zu durchfahren.
      const s = laneCenterDist(r);
      const gap = (r.wechselGapMin + r.wechselGapMax) / 2;
      const x0 = -(s + gap / 2);
      const g1 = x0 + s / 2;
      const g2 = x0 + 1.5 * s + gap;
      const rad = (g2 - g1) / 2;
      return {
        pylons: [std(x0, 0), std(x0 + s, 0), std(x0 + s + gap, 0), std(x0 + 2 * s + gap, 0)],
        route: [
          { x: g1, y: 2.6 },
          { x: g1, y: -0.9 },
          ...arc((g1 + g2) / 2, -0.9, rad, 180, 360, 18),
          { x: g2, y: 2.6 },
        ],
      };
    },
  },
  {
    id: "spurgasse",
    name: "Spurgasse (gerade)",
    ref: "§7.3.1",
    make: (r) => {
      // 3–5 Pylonen pro Seite, gesamtheitlich markiert.
      const half = laneCenterDist(r) / 2;
      const n = 4;
      const len = 4.5;
      const pylons: Pylon[] = [];
      for (let i = 0; i < n; i++) {
        const y = -len / 2 + (len * i) / (n - 1);
        pylons.push(std(-half, y), std(half, y));
      }
      return {
        pylons,
        route: [
          { x: 0, y: -len / 2 - 1.5 },
          { x: 0, y: len / 2 + 1.5 },
        ],
      };
    },
  },
  {
    id: "spurgasse-gebogen",
    name: "Spurgasse (gebogen)",
    ref: "§7.3.1",
    make: (r) => {
      // 5–10 Pylonen pro Seite bei exakt 50 cm Abstand → 80°-Bogen,
      // Innenradius so, dass beide Seiten im Limit bleiben.
      const w = laneWidth(r);
      const rc = 1.6 + (w + r.pylonBase) / 2;
      const center = arc(0, 0, rc, 150, 230, 40);
      const route = arc(0, 0, rc, 138, 242, 44);
      return { pylons: channel(center, w, r.laneGap, r.pylonBase), route };
    },
  },
  {
    id: "schweizer",
    name: "Schweizer Slalom",
    ref: "§7.3.2",
    make: (r) => {
      // Einzelne stehende Pylonen in einer Linie, wechselseitig zu umfahren.
      const d = r.pylonHeight + r.pylonBase;
      const gap = Math.max(r.minTaskGap, 4);
      const pylons: Pylon[] = [];
      const route: V2[] = [{ x: 0, y: -3 }];
      for (let i = 0; i < 3; i++) {
        const y = i * gap;
        const side = i % 2 === 0 ? 1 : -1;
        pylons.push(std(0, y), lie(side * d, y, side > 0 ? 180 : 0));
        route.push({ x: -side * 1.2, y });
        route.push({ x: 0, y: y + gap / 2 });
      }
      route[route.length - 1] = { x: 0, y: 2 * gap + 3 };
      return { pylons, route };
    },
  },
  {
    id: "kreisel",
    name: "Kreisel",
    ref: "§7.3.3",
    make: (r) => {
      // Skizze S. 11: zwei Ringe; Ein- (3 m) und Ausfahrt (Spurbreite + 40 cm)
      // liegen nebeneinander auf derselben Seite, mit liegenden Pylonen markiert.
      const w = laneWidth(r);
      const rIn = r.kreiselInnerD / 2;
      const rOut = rIn + w + r.pylonBase;
      const entryDeg = 210; // oben links (y zeigt nach unten)
      const exitDeg = 150; // unten links
      const pylons: Pylon[] = [];
      ringPylons(pylons, rIn, r.kreiselGap, []);
      const entryHalf = (((r.kreiselEntry + r.pylonBase) / 2) / rOut) * (180 / Math.PI);
      const exitHalf = (((w + r.pylonBase) / 2) / rOut) * (180 / Math.PI);
      ringPylons(pylons, rOut, r.kreiselGap, [
        { center: entryDeg, half: entryHalf },
        { center: exitDeg, half: exitHalf },
      ]);
      // Liegende Pylonen markieren Ein- und Ausfahrt (Spitze in Fahrtrichtung)
      for (const [deg, inward] of [
        [entryDeg, true],
        [exitDeg, false],
      ] as [number, boolean][]) {
        const rad = (deg * Math.PI) / 180;
        const px = Math.cos(rad) * (rOut + 0.55);
        const py = Math.sin(rad) * (rOut + 0.55);
        pylons.push(lie(px, py, deg + (inward ? 180 : 0)));
      }
      // Route: einfahren, 360° + Versatz zwischen den Ringen, ausfahren
      const rMid = (rIn + rOut) / 2;
      const route: V2[] = [];
      const entryRad = (entryDeg * Math.PI) / 180;
      route.push({ x: Math.cos(entryRad) * (rOut + 2.2), y: Math.sin(entryRad) * (rOut + 2.2) });
      route.push(...arc(0, 0, rMid, entryDeg, entryDeg - 420, 96));
      const exitRad = (exitDeg * Math.PI) / 180;
      route.push({ x: Math.cos(exitRad) * (rOut + 2.2), y: Math.sin(exitRad) * (rOut + 2.2) });
      return { pylons, route };
    },
  },
  {
    id: "wende",
    name: "Wende 90–180°",
    ref: "§7.3.6",
    make: (r) => {
      // Drei Pylonen im Dreieck, gesamtheitlich markiert; wird umfahren (U-Turn).
      const s = r.laneGap;
      return {
        pylons: [std(-s / 2, 0.22), std(s / 2, 0.22), std(0, -0.21)],
        route: [{ x: -1.1, y: 2.4 }, { x: -1.1, y: 0.5 }, ...arc(0, 0, 1.1, 180, 360, 16), { x: 1.1, y: 2.4 }],
      };
    },
  },
  {
    id: "ypsilon",
    name: "Ypsilon",
    ref: "§7.3.7",
    make: (r) => {
      // Skizze S. 12: echtes Y – Stamm und zwei Gabeläste (~±35°).
      // Jedes Teil ist mindestens einmal zu durchfahren.
      const w = laneWidth(r);
      const armLen = 2.6;
      const a = (35 * Math.PI) / 180;
      const dirs: V2[] = [
        { x: 0, y: 1 }, // Stamm nach unten
        { x: -Math.sin(a), y: -Math.cos(a) }, // Ast oben links
        { x: Math.sin(a), y: -Math.cos(a) }, // Ast oben rechts
      ];
      const inner = w / 2 + 0.5;
      const pylons: Pylon[] = [];
      for (const d of dirs) {
        pylons.push(
          ...channel(
            [
              { x: d.x * inner, y: d.y * inner },
              { x: d.x * (inner + armLen), y: d.y * (inner + armLen) },
            ],
            w,
            r.laneGap,
            r.pylonBase,
          ),
        );
      }
      // Route: Stamm hoch → Ast links raus → außen wenden → zurück → Ast rechts raus
      const out = inner + armLen + 1.2;
      const tipL = { x: dirs[1].x * out, y: dirs[1].y * out };
      const tipR = { x: dirs[2].x * out, y: dirs[2].y * out };
      const route: V2[] = [
        { x: 0, y: out + 1 },
        { x: 0, y: inner },
        { x: dirs[1].x * inner, y: dirs[1].y * inner },
        tipL,
        ...arc(tipL.x - 0.9, tipL.y - 0.6, 1.0, -35, -395, 20),
        tipL,
        { x: dirs[1].x * inner, y: dirs[1].y * inner },
        { x: 0, y: inner * 0.4 },
        { x: dirs[2].x * inner, y: dirs[2].y * inner },
        tipR,
      ];
      return { pylons, route };
    },
  },
  {
    id: "s-gasse",
    name: "S-Spurgasse",
    ref: "§7.3.8",
    make: (r) => {
      // S-förmige Gasse als Sinuslinie.
      const w = laneWidth(r);
      const len = 6;
      const amp = 1.3;
      const pts: V2[] = [];
      for (let i = 0; i <= 60; i++) {
        const y = -len / 2 + (len * i) / 60;
        pts.push({ x: amp * Math.sin((y / len) * 2 * Math.PI), y });
      }
      const route = [{ x: pts[0].x, y: pts[0].y - 1.5 }, ...pts, { x: pts[59].x, y: pts[60].y + 1.5 }];
      return { pylons: channel(pts, w, r.laneGap, r.pylonBase), route };
    },
  },
  {
    id: "z-gasse",
    name: "Z-Gasse",
    ref: "§7.3.9",
    make: (r) => {
      // Drei parallele Gassen (Abstand > 2 m), mit Wenden verbunden.
      const w = laneWidth(r);
      const len = 4;
      const gap = 2.2;
      const pylons: Pylon[] = [];
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * gap;
        pylons.push(
          ...channel(
            [
              { x, y: -len / 2 },
              { x, y: len / 2 },
            ],
            w,
            r.laneGap,
            r.pylonBase,
          ),
        );
      }
      const h = len / 2;
      const route: V2[] = [
        { x: -gap, y: h + 2.4 },
        { x: -gap, y: -h },
        ...arc(-gap / 2, -h - 0.4, gap / 2, 180, 360, 16),
        { x: 0, y: h },
        ...arc(gap / 2, h + 0.4, gap / 2, 180, 0, 16),
        { x: gap, y: -h - 2.4 },
      ];
      return { pylons, route };
    },
  },
  {
    id: "kasten",
    name: "Kasten",
    ref: "§7.3.10",
    make: (r) => {
      // Rechteck mit Mittelwand: unten ein- und ausfahren, innen um die Wand herum.
      const w = laneWidth(r);
      const size = 2 * w + 1.6;
      const half = size / 2;
      const q = size / 4;
      const gapHalf = (w + r.pylonBase) / 2;
      const pylons: Pylon[] = [];
      const edge = (x0: number, y0: number, x1: number, y1: number, holes: { at: number; half: number }[] = []) => {
        const L = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.floor(L / r.laneGap);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const pos = t * L;
          if (holes.some((hl) => Math.abs(pos - hl.at) < hl.half)) continue;
          pylons.push(std(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
        }
      };
      edge(-half, half, half, half, [
        { at: half - q, half: gapHalf },
        { at: half + q, half: gapHalf },
      ]);
      edge(-half, -half, half, -half);
      edge(-half, -half, -half, half);
      edge(half, -half, half, half);
      // Mittelwand von unten, oben bleibt eine Fahrspur frei
      edge(0, half, 0, -half + w + r.pylonBase);
      const top = -half + (w + r.pylonBase) / 2;
      const route: V2[] = [
        { x: -q, y: half + 1.6 },
        { x: -q, y: top + 0.3 },
        ...arc(0, top + 0.3, q, 180, 360, 14),
        { x: q, y: half + 1.6 },
      ];
      return { pylons, route };
    },
  },
  {
    id: "schneckenhaus",
    name: "Schneckenhaus",
    ref: "§7.3.11",
    make: (r) => {
      // Skizze S. 14: rechteckige Spirale um einen Kasten (~3 m).
      const w = laneWidth(r);
      const p = w + r.pylonBase; // Wandabstand
      const b = 1.5; // halber Innenkasten
      const o = b + p; // halbe Außenwand
      const gapHalf = (w + r.pylonBase) / 2;
      const pylons: Pylon[] = [];
      // Innenkasten komplett
      pylons.push(...row({ x: -b, y: -b }, { x: b, y: -b }, r.laneGap));
      pylons.push(...row({ x: b, y: -b }, { x: b, y: b }, r.laneGap));
      pylons.push(...row({ x: b, y: b }, { x: -b, y: b }, r.laneGap));
      pylons.push(...row({ x: -b, y: b }, { x: -b, y: -b }, r.laneGap));
      // Außenwand mit Öffnung in der Mitte der linken Seite
      pylons.push(...row({ x: -o, y: -o }, { x: o, y: -o }, r.laneGap));
      pylons.push(...row({ x: o, y: -o }, { x: o, y: o }, r.laneGap));
      pylons.push(...row({ x: o, y: o }, { x: -o, y: o }, r.laneGap));
      const sideLen = 2 * o;
      const holes = [{ at: sideLen / 2, half: gapHalf }];
      const left = row({ x: -o, y: o }, { x: -o, y: -o }, r.laneGap).filter((pt) => {
        const pos = o - pt.y;
        return !holes.some((hl) => Math.abs(pos - hl.at) < hl.half);
      });
      pylons.push(...left);
      // Route: links rein, einmal um den Kasten, links wieder raus
      const m = b + p / 2;
      const route: V2[] = [
        { x: -o - 2, y: -0.45 },
        { x: -m, y: -0.45 },
        { x: -m, y: -m },
        { x: m, y: -m },
        { x: m, y: m },
        { x: -m, y: m },
        { x: -m, y: 0.45 },
        { x: -o - 2, y: 0.45 },
      ];
      return { pylons, route };
    },
  },
  {
    id: "kreuz",
    name: "Kreuz",
    ref: "§7.3.12",
    make: (r) => {
      // Skizze S. 14: Kreuz wird einmal senkrecht und einmal waagerecht durchfahren.
      const w = laneWidth(r);
      const armLen = 2.4;
      const inner = w / 2 + 0.5;
      const pylons: Pylon[] = [];
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const d = { x: Math.cos(a), y: Math.sin(a) };
        pylons.push(
          ...channel(
            [
              { x: d.x * inner, y: d.y * inner },
              { x: d.x * (inner + armLen), y: d.y * (inner + armLen) },
            ],
            w,
            r.laneGap,
            r.pylonBase,
          ),
        );
      }
      const c = inner + armLen + 1.2;
      const route: V2[] = [
        { x: 0, y: -c - 1 },
        { x: 0, y: c },
        ...arc(0, 0, c, 90, 180, 22),
        { x: -c, y: 0 },
        { x: c + 1.5, y: 0 },
      ];
      return { pylons, route };
    },
  },
  {
    id: "brezel",
    name: "Brezel / Schwammerl",
    ref: "§7.3.13",
    make: (r) => {
      // Skizze S. 15 („Schwammerl"): Deckel-Reihe oben, zwei Reihen in der Mitte,
      // gespreizte Stempel-Spalten – die Fahrwege kreuzen sich im Stempel.
      const g = r.laneGap;
      const pylons: Pylon[] = [];
      pylons.push(...row({ x: -3.5, y: -2 }, { x: 3.5, y: -2 }, g)); // Deckel
      pylons.push(...row({ x: -3.5, y: 0 }, { x: -1.6, y: 0 }, g)); // Mitte links
      pylons.push(...row({ x: 1.6, y: 0 }, { x: 3.5, y: 0 }, g)); // Mitte rechts
      pylons.push(...row({ x: -0.85, y: 0.5 }, { x: -1.35, y: 2.5 }, g)); // Stempel links
      pylons.push(...row({ x: 0.85, y: 0.5 }, { x: 1.35, y: 2.5 }, g)); // Stempel rechts
      // Route: unter dem Deckel nach rechts → rechts wenden → diagonal durch den
      // Stempel nach unten links → wenden → diagonal zurück nach unten rechts (Kreuzung!)
      const route: V2[] = [
        { x: -5.2, y: -1 },
        { x: 3.6, y: -1 },
        ...arc(3.6, -0.2, 0.85, 270, 450, 14),
        { x: 3.0, y: 0.62 },
        { x: -1.4, y: 3.0 },
        ...arc(-1.9, 3.85, 1.0, 60, -120, 16),
        { x: -1.2, y: 3.6 },
        { x: 3.0, y: 1.05 },
        { x: 4.6, y: 0.5 },
      ];
      return { pylons, route };
    },
  },
  {
    id: "deutsches-eck",
    name: "Deutsches Eck",
    ref: "§7.3.14",
    make: (r) => {
      // 90°-Ecke mit eckiger Außenwand.
      const w = laneWidth(r);
      const leg = 2.8;
      const center: V2[] = [
        { x: -leg, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: -leg },
      ];
      const route: V2[] = [
        { x: -leg - 1.5, y: 0 },
        { x: -0.3, y: 0 },
        { x: 0, y: -0.3 },
        { x: 0, y: -leg - 1.5 },
      ];
      return { pylons: channel(center, w, r.laneGap, r.pylonBase), route };
    },
  },
  {
    id: "schikane",
    name: "Schikane",
    ref: "§7.3.17",
    make: (r) => {
      // Skizze S. 16: gerader Korridor mit V-Versatz in der Mitte.
      const w = laneWidth(r);
      const center: V2[] = [
        { x: -4, y: 0 },
        { x: -1.7, y: 0 },
        { x: 0, y: 1.3 },
        { x: 1.7, y: 0 },
        { x: 4, y: 0 },
      ];
      const route = [{ x: -5.5, y: 0 }, ...center.slice(1, 4), { x: 5.5, y: 0 }];
      return { pylons: channel(center, w, r.laneGap, r.pylonBase), route };
    },
  },
  {
    id: "zielgasse",
    name: "Zielgasse",
    ref: "§7.3.16",
    make: (r) => {
      // Breite 2,5 m, Länge 8–10 m, endet an der Haltelinie (Stillstand).
      const len = r.zielLength;
      return {
        pylons: channel(
          [
            { x: 0, y: -len / 2 },
            { x: 0, y: len / 2 },
          ],
          r.zielWidth,
          r.laneGap,
          r.pylonBase,
        ),
        route: [
          { x: 0, y: -len / 2 - 1.8 },
          { x: 0, y: len / 2 + 0.6 },
        ],
      };
    },
  },
];

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

export const TEMPLATES: ObstacleTemplate[] = BUILDERS.map((b) => ({
  id: b.id,
  name: b.name,
  ref: b.ref,
  build: (r) => finalize(b.make(r)).pylons,
  route: (r) => finalize(b.make(r)).route,
}));

export function templateById(id: string): ObstacleTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
