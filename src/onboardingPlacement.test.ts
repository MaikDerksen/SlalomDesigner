import { describe, it, expect } from "vitest";
import { placeCard } from "./onboardingPlacement";

const VP = { width: 1000, height: 700 };
const CARD = { width: 340, height: 200 };

describe("placeCard", () => {
  it("zentriert die Karte ohne Ziel", () => {
    const p = placeCard(null, CARD, VP, "bottom");
    expect(p.placement).toBe("center");
    expect(p.left).toBe((1000 - 340) / 2);
    expect(p.top).toBe((700 - 200) / 2);
  });

  it("zentriert bei bevorzugter Platzierung center – unabhängig vom Ziel", () => {
    const target = { left: 400, top: 100, width: 120, height: 40 };
    const p = placeCard(target, CARD, VP, "center");
    expect(p.placement).toBe("center");
  });

  it("platziert unterhalb, wenn dort Platz ist", () => {
    const target = { left: 400, top: 100, width: 120, height: 40 };
    const p = placeCard(target, CARD, VP, "bottom");
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(100 + 40 + 14);
    // horizontal am Ziel zentriert
    expect(p.left).toBe(460 - 170);
    // Spitze zeigt auf die Ziel-Mitte
    expect(p.caret).toBe(170);
  });

  it("kippt nach oben, wenn unten kein Platz ist", () => {
    const target = { left: 400, top: 640, width: 120, height: 40 };
    const p = placeCard(target, CARD, VP, "bottom");
    expect(p.placement).toBe("top");
    expect(p.top).toBe(640 - 14 - 200);
  });

  it("hält die Karte am rechten Rand im sichtbaren Bereich", () => {
    const target = { left: 950, top: 100, width: 40, height: 40 };
    const p = placeCard(target, CARD, VP, "bottom");
    expect(p.left + CARD.width).toBeLessThanOrEqual(VP.width - 12);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it("weicht von links nach rechts aus, wenn links kein Platz ist", () => {
    const target = { left: 0, top: 300, width: 120, height: 40 };
    const p = placeCard(target, CARD, VP, "left");
    expect(p.placement).toBe("right");
    expect(p.left).toBe(0 + 120 + 14);
  });

  it("begrenzt die Spitze auf die Kartenbreite", () => {
    const target = { left: 950, top: 100, width: 40, height: 40 };
    const p = placeCard(target, CARD, VP, "bottom");
    expect(p.caret).toBeGreaterThanOrEqual(18);
    expect(p.caret).toBeLessThanOrEqual(CARD.width - 18);
  });
});
