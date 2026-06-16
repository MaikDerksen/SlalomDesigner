/**
 * Reine Positionierungslogik der Einführungs-Tour (ohne React/DOM), damit sie
 * unabhängig testbar ist. Berechnet, wo die Sprechblase relativ zum
 * hervorgehobenen Zielelement sitzt.
 */

export type Placement = "top" | "bottom" | "left" | "right" | "center";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlacedCard {
  left: number;
  top: number;
  placement: Placement;
  /** Position der Sprechblasen-Spitze relativ zur Karte (px). */
  caret: number;
}

/**
 * Positioniert die Sprechblase relativ zum hervorgehobenen Ziel. Bevorzugt die
 * gewünschte Seite, weicht aber aus, wenn die Karte sonst aus dem sichtbaren
 * Bereich ragen würde, und zwängt sie notfalls hinein.
 */
export function placeCard(
  target: Box | null,
  card: Size,
  viewport: Size,
  preferred: Placement,
  gap = 14,
  margin = 12,
): PlacedCard {
  if (!target || preferred === "center") {
    return {
      left: Math.round((viewport.width - card.width) / 2),
      top: Math.round((viewport.height - card.height) / 2),
      placement: "center",
      caret: 0,
    };
  }

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const tcx = target.left + target.width / 2;
  const tcy = target.top + target.height / 2;

  const candidate = (side: Placement) => {
    let left = 0;
    let top = 0;
    if (side === "bottom") {
      top = target.top + target.height + gap;
      left = clamp(tcx - card.width / 2, margin, viewport.width - card.width - margin);
    } else if (side === "top") {
      top = target.top - gap - card.height;
      left = clamp(tcx - card.width / 2, margin, viewport.width - card.width - margin);
    } else if (side === "right") {
      left = target.left + target.width + gap;
      top = clamp(tcy - card.height / 2, margin, viewport.height - card.height - margin);
    } else {
      // left
      left = target.left - gap - card.width;
      top = clamp(tcy - card.height / 2, margin, viewport.height - card.height - margin);
    }
    const fits =
      left >= margin &&
      top >= margin &&
      left + card.width <= viewport.width - margin &&
      top + card.height <= viewport.height - margin;
    return { left, top, fits, side };
  };

  const opposite: Record<Placement, Placement> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
    center: "center",
  };
  const order: Placement[] = [preferred, opposite[preferred], "bottom", "top", "right", "left"];

  let chosen = candidate(preferred);
  for (const side of order) {
    const c = candidate(side);
    if (c.fits) {
      chosen = c;
      break;
    }
  }

  // Auch wenn keine Seite perfekt passt: in den sichtbaren Bereich zwängen.
  const left = clamp(chosen.left, margin, Math.max(margin, viewport.width - card.width - margin));
  const top = clamp(chosen.top, margin, Math.max(margin, viewport.height - card.height - margin));

  const caret =
    chosen.side === "top" || chosen.side === "bottom"
      ? clamp(tcx - left, 18, card.width - 18)
      : clamp(tcy - top, 18, card.height - 18);

  return { left, top, placement: chosen.side, caret };
}
