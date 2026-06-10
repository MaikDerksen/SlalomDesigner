import type { V2 } from "./types";

/**
 * Brücke zwischen Palette (Drag-Quelle) und Editor (Drop-Ziel):
 * Der Editor registriert hier seine Bildschirm→Welt-Transformation.
 */
export const canvasBridge: {
  screenToWorld: ((clientX: number, clientY: number) => V2 | null) | null;
  viewCenter: (() => V2) | null;
} = {
  screenToWorld: null,
  viewCenter: null,
};
