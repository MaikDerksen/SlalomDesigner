import type { MapImage, V2 } from "./types";
import { rdpSimplify } from "./geometry";

/**
 * Bildverarbeitung für den Map-Wizard:
 * – Screenshot verkleinern und als JPEG-DataURL speichern
 * – Fahrfläche per Flutfüllung (Farbähnlichkeit) ab einem Tipp-Punkt maskieren
 * – Außenkontur der Maske verfolgen und zu einem editierbaren Polygon vereinfachen
 * – Objektlänge (z. B. Auto) per Blob-Analyse für die Maßstab-Schätzung messen
 */

const MAX_STORE_PX = 1280; // gespeicherte Bildgröße (localStorage-Budget)
const MAX_PROC_PX = 640; // Auflösung für die Segmentierung

export async function fileToMapImage(file: File): Promise<MapImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, MAX_STORE_PX / Math.max(img.width, img.height));
    const w = Math.round(img.width * k);
    const h = Math.round(img.height * k);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL("image/jpeg", 0.78), pxWidth: w, pxHeight: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

interface ProcImage {
  data: ImageData;
  /** Faktor Verarbeitungs-px → Anzeige-px. */
  scale: number;
}

export async function toProcImage(image: MapImage): Promise<ProcImage> {
  const img = await loadImage(image.data);
  const k = Math.min(1, MAX_PROC_PX / Math.max(image.pxWidth, image.pxHeight));
  const w = Math.round(image.pxWidth * k);
  const h = Math.round(image.pxHeight * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h), scale: image.pxWidth / w };
}

/** Flutfüllung ab Saatpunkt: alle zusammenhängenden Pixel mit ähnlicher Farbe. */
export function floodMask(
  proc: ImageData,
  seed: V2,
  tolerance: number,
): Uint8Array | null {
  const { width: w, height: h, data } = proc;
  const sx = Math.round(seed.x);
  const sy = Math.round(seed.y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  // Referenzfarbe: Mittel über 3×3 um den Saatpunkt
  let r0 = 0, g0 = 0, b0 = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      r0 += data[i];
      g0 += data[i + 1];
      b0 += data[i + 2];
      n++;
    }
  }
  r0 /= n; g0 /= n; b0 /= n;

  const tol2 = tolerance * tolerance;
  const mask = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];
  mask[stack[0]] = 1;
  let count = 0;

  while (stack.length) {
    const idx = stack.pop()!;
    count++;
    const x = idx % w;
    const y = (idx / w) | 0;
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
    ];
    for (const nIdx of neighbors) {
      if (nIdx < 0 || mask[nIdx]) continue;
      const i = nIdx * 4;
      const dr = data[i] - r0;
      const dg = data[i + 1] - g0;
      const db = data[i + 2] - b0;
      if (dr * dr + dg * dg + db * db <= tol2 * 3) {
        mask[nIdx] = 1;
        stack.push(nIdx);
      }
    }
  }
  return count > 30 ? mask : null;
}

/** Kleine Löcher schließen (1 Dilatations- + 1 Erosionsschritt). */
export function closeMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (
        mask[i] ||
        (x > 0 && mask[i - 1]) ||
        (x < w - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - w]) ||
        (y < h - 1 && mask[i + w])
      )
        dil[i] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (
        dil[i] &&
        (x === 0 || dil[i - 1]) &&
        (x === w - 1 || dil[i + 1]) &&
        (y === 0 || dil[i - w]) &&
        (y === h - 1 || dil[i + w])
      )
        out[i] = 1;
    }
  }
  return out;
}

/**
 * Außenkontur der Maske per Moore-Nachbar-Verfolgung,
 * anschließend RDP-Vereinfachung auf max. ~45 Punkte.
 */
export function traceContour(mask: Uint8Array, w: number, h: number): V2[] {
  // Startpixel: erstes gesetztes Pixel (zeilenweise)
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Moore-Nachbarschaft im Uhrzeigersinn, Start oben
  const DIRS = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];

  const sx = start % w;
  const sy = (start / w) | 0;
  const contour: V2[] = [{ x: sx, y: sy }];
  let cx = sx, cy = sy;
  let backtrack = 6; // wir kamen von links (Scanrichtung)

  for (let steps = 0; steps < mask.length * 4; steps++) {
    let found = false;
    // ab dem Backtrack-Nachbarn im Uhrzeigersinn suchen
    for (let k = 0; k < 8; k++) {
      const dirIdx = (backtrack + 1 + k) % 8;
      const nx = cx + DIRS[dirIdx][0];
      const ny = cy + DIRS[dirIdx][1];
      if (at(nx, ny)) {
        backtrack = (dirIdx + 4) % 8;
        cx = nx;
        cy = ny;
        contour.push({ x: cx, y: cy });
        found = true;
        break;
      }
    }
    if (!found) break; // isoliertes Pixel
    if (cx === sx && cy === sy && contour.length > 2) break;
  }

  // Vereinfachen: Epsilon erhöhen, bis die Punktzahl handhabbar ist
  let eps = 1.5;
  let poly = rdpSimplify(contour, eps);
  while (poly.length > 45 && eps < 24) {
    eps *= 1.5;
    poly = rdpSimplify(contour, eps);
  }
  return poly;
}

/**
 * Objektlänge für die Maßstab-Schätzung: Blob um den Tipp-Punkt segmentieren
 * und die Länge entlang der Hauptachse (PCA) messen.
 * Liefert die beiden Endpunkte der Hauptachse in Verarbeitungs-px.
 */
export function measureObject(
  proc: ImageData,
  seed: V2,
  tolerance = 42,
): { a: V2; b: V2; lengthPx: number } | null {
  const mask = floodMask(proc, seed, tolerance);
  if (!mask) return null;
  const { width: w, height: h } = proc;

  // Blob-Pixel sammeln; abbrechen, wenn die "Fläche" gefüllt wurde (kein Objekt)
  const pts: V2[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) pts.push({ x: i % w, y: (i / w) | 0 });
  }
  if (pts.length < 20 || pts.length > w * h * 0.2) return null;

  // PCA: Hauptachse des Blobs
  let mx = 0, my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = l1 - sxx;
  const norm = Math.hypot(ax, ay);
  if (norm < 1e-6) {
    ax = 1;
    ay = 0;
  } else {
    ax /= norm;
    ay /= norm;
  }

  // Projektion auf die Hauptachse → Länge
  let tMin = Infinity, tMax = -Infinity;
  for (const p of pts) {
    const t = (p.x - mx) * ax + (p.y - my) * ay;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  return {
    a: { x: mx + ax * tMin, y: my + ay * tMin },
    b: { x: mx + ax * tMax, y: my + ay * tMax },
    lengthPx: tMax - tMin,
  };
}
