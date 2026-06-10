import type { MapConfig, ObstacleInstance, Rules } from "./types";
import { deg2rad } from "./geometry";
import { validate } from "./validation";

/**
 * Rendert die Strecke als PNG (Canvas 2D) und teilt sie über die
 * Web Share API (Mobile/Capacitor) oder lädt sie herunter (Desktop).
 */
export async function exportAndShare(
  map: MapConfig,
  obstacles: ObstacleInstance[],
  rules: Rules,
  trackName: string,
): Promise<"shared" | "downloaded"> {
  const blob = await renderPng(map, obstacles, rules, trackName);
  const fileName = `${sanitize(trackName)}_${new Date().toISOString().slice(0, 10)}.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: trackName, text: `Streckenplan: ${trackName}` });
      return "shared";
    } catch (e) {
      // Nutzer hat abgebrochen oder Teilen nicht möglich → Download als Fallback
      if ((e as Error).name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

function sanitize(s: string): string {
  return s.replace(/[^\wäöüÄÖÜß\- ]/g, "").replace(/\s+/g, "_") || "Strecke";
}

export async function renderPng(
  map: MapConfig,
  obstacles: ObstacleInstance[],
  rules: Rules,
  trackName: string,
): Promise<Blob> {
  // Maßstab so wählen, dass die längere Seite ~2400 px hat
  const headerH = 140;
  const pad = 40;
  const scale = Math.min(2400 / Math.max(map.width, map.height), 80);
  const w = Math.round(map.width * scale) + pad * 2;
  const h = Math.round(map.height * scale) + pad * 2 + headerH;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Hintergrund + Kopfzeile
  ctx.fillStyle = "#f5f6f8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#16181d";
  ctx.font = `600 ${Math.round(headerH * 0.3)}px system-ui, sans-serif`;
  ctx.fillText(trackName, pad, headerH * 0.42);
  ctx.fillStyle = "#5c6470";
  ctx.font = `400 ${Math.round(headerH * 0.17)}px system-ui, sans-serif`;
  const date = new Date().toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  ctx.fillText(
    `${date}  ·  ${map.name}: ${fmt(map.width)} × ${fmt(map.height)} m  ·  ${obstacles.length} Aufgaben  ·  ADAC Kartslalom Reglement 2026`,
    pad,
    headerH * 0.72,
  );

  const ox = pad;
  const oy = headerH + pad;

  // Fahrfläche
  ctx.fillStyle = "#dfe3e8";
  ctx.fillRect(ox, oy, map.width * scale, map.height * scale);
  ctx.strokeStyle = "#9aa3ad";
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, map.width * scale, map.height * scale);

  // Raster: 1 m fein, 5 m kräftig
  for (let x = 0; x <= map.width; x++) {
    ctx.strokeStyle = x % 5 === 0 ? "#c2c9d1" : "#d4d9df";
    ctx.lineWidth = x % 5 === 0 ? 1.5 : 0.75;
    line(ctx, ox + x * scale, oy, ox + x * scale, oy + map.height * scale);
  }
  for (let y = 0; y <= map.height; y++) {
    ctx.strokeStyle = y % 5 === 0 ? "#c2c9d1" : "#d4d9df";
    ctx.lineWidth = y % 5 === 0 ? 1.5 : 0.75;
    line(ctx, ox, oy + y * scale, ox + map.width * scale, oy + y * scale);
  }

  // Maßstabsbalken (5 m)
  const barY = oy + map.height * scale + pad * 0.55;
  ctx.strokeStyle = "#16181d";
  ctx.lineWidth = 3;
  line(ctx, ox, barY, ox + 5 * scale, barY);
  line(ctx, ox, barY - 6, ox, barY + 6);
  line(ctx, ox + 5 * scale, barY - 6, ox + 5 * scale, barY + 6);
  ctx.fillStyle = "#16181d";
  ctx.font = `500 ${Math.max(14, scale * 0.45)}px system-ui, sans-serif`;
  ctx.fillText("5 m", ox + 5 * scale + 10, barY + 5);

  // Hindernisse
  const flags = validate(obstacles, map, rules);
  obstacles.forEach((obs, idx) => {
    const f = flags.get(obs.id);
    const invalid = !!(f && (f.tooClose || f.outOfBounds));
    ctx.save();
    ctx.translate(ox + obs.x * scale, oy + obs.y * scale);
    ctx.rotate(deg2rad(obs.rotation));
    for (const p of obs.pylons) {
      drawPylon(ctx, p.x * scale, p.y * scale, rules.pylonBase * scale, invalid, p.lying, p.angle ?? 0);
    }
    ctx.restore();

    // Nummern-Badge am Anker
    const bx = ox + obs.x * scale;
    const by = oy + obs.y * scale;
    ctx.fillStyle = invalid ? "#d92d20" : "#16181d";
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(11, scale * 0.32), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${Math.max(12, scale * 0.36)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(idx + 1), bx, by + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  });

  // Legende (Nummer → Name)
  ctx.fillStyle = "#5c6470";
  ctx.font = `400 ${Math.round(headerH * 0.15)}px system-ui, sans-serif`;
  const legend = obstacles.map((o, i) => `${i + 1} ${o.name}`).join("   ·   ");
  ctx.fillText(legend.slice(0, 220), pad, h - 14);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

function drawPylon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  base: number,
  invalid: boolean,
  lying?: boolean,
  angle = 0,
) {
  const color = invalid ? "#d92d20" : "#f97316";
  if (lying) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(deg2rad(angle));
    ctx.fillStyle = color;
    ctx.beginPath();
    // Liegende Pylone: Dreieck, Spitze in Pfeilrichtung
    ctx.moveTo(base * 1.6, 0);
    ctx.lineTo(-base * 0.5, -base * 0.5);
    ctx.lineTo(-base * 0.5, base * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }
  const s = Math.max(base, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function fmt(v: number): string {
  return v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}
