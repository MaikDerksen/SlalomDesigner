/** Alle Koordinaten und Maße in Metern (Weltkoordinaten), Winkel in Grad. */

export interface V2 {
  x: number;
  y: number;
}

/** Eine einzelne Pylone, Position relativ zum Hindernis-Anker. */
export interface Pylon {
  x: number;
  y: number;
  /** Liegende Pylone (Richtungsanzeiger). */
  lying?: boolean;
  /** Richtung der Spitze einer liegenden Pylone in Grad (lokal). */
  angle?: number;
}

/** Ein platziertes Hindernis (eine Parcours-Aufgabe). */
export interface ObstacleInstance {
  id: string;
  templateId: string;
  name: string;
  /** Anker-Position in Weltkoordinaten (m). */
  x: number;
  y: number;
  /** Rotation um den Anker in Grad. */
  rotation: number;
  /** Pylonen in lokalen Koordinaten (beim Einfügen aus dem Regelwerk erzeugt). */
  pylons: Pylon[];
}

/** Hintergrundbild einer Fahrfläche (z. B. Apple-Maps-Screenshot). */
export interface MapImage {
  /** JPEG-DataURL (verkleinert). */
  data: string;
  pxWidth: number;
  pxHeight: number;
}

/** Konfiguration der Fahrfläche (Map Designer). */
export interface MapConfig {
  name: string;
  /** Breite in Metern (cm-genau). */
  width: number;
  /** Länge/Höhe in Metern (cm-genau). */
  height: number;
  /** Referenz auf eine gespeicherte Map (für das Hintergrundbild). */
  mapId?: string;
  /** Befahrbarer Bereich als Polygon (m). Ohne: gesamte Rechteckfläche. */
  boundary?: V2[];
  /** Sperrzonen (Hindernisse auf der Fläche), Polygone in m. */
  blocked?: V2[][];
}

/** In der Bibliothek gespeicherte Fahrfläche. */
export interface SavedMap {
  id: string;
  name: string;
  createdAt: number;
  config: MapConfig;
  image?: MapImage;
  /** Maßstab-Kalibrierung (Bild-px), damit sie beim Bearbeiten erhalten bleibt. */
  calibration?: { a: V2; b: V2; refLen: number };
}

export interface Track {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  map: MapConfig;
  obstacles: ObstacleInstance[];
}

/** Eigenes, vom Nutzer entworfenes Hindernis. */
export interface CustomTemplate {
  id: string;
  name: string;
  pylons: Pylon[];
}

/**
 * Konfigurierbare Regeln nach ADAC Kartslalom Reglement 2026, §7.
 * Alle Maße werden von Fuß zu Fuß der Pylonen gemessen.
 */
export interface Rules {
  /** Pylonenhöhe in m (Reglement: 0,50 m ± 3 cm). */
  pylonHeight: number;
  /** Kantenlänge der Pylonen-Bodenplatte in m (für die Darstellung/Torberechnung). */
  pylonBase: number;
  /** Mindestabstand zwischen zwei Aufgaben in m (Reglement: 4 m). */
  minTaskGap: number;
  /** Maximalabstand zwischen zwei Aufgaben in m (Reglement: 10 m). */
  maxTaskGap: number;
  /** Maximale Spurbreite des Karts in m (Reglement: 1,25 m hinten, Slick). */
  trackWidth: number;
  /** Zuschlag zur Spurbreite für die lichte Torbreite in m (Reglement: 0,40 m). */
  gateExtra: number;
  /** Pylonenabstand innerhalb von Gassen in m (Reglement: 0,50 m). */
  laneGap: number;
  /** Wechseltor: minimaler Torabstand in m (Reglement: 1,5 m). */
  wechselGapMin: number;
  /** Wechseltor: maximaler Torabstand in m (Reglement: 4 m). */
  wechselGapMax: number;
  /** Kreisel: Innendurchmesser in m (Reglement: 10 m). */
  kreiselInnerD: number;
  /** Kreisel: Pylonenabstand in m (Reglement: 1,0 m). */
  kreiselGap: number;
  /** Kreisel: Breite der Einfahrt in m (Reglement: 3 m). */
  kreiselEntry: number;
  /** Zielgasse: Breite in m (Reglement: 2,5 m). */
  zielWidth: number;
  /** Zielgasse: Länge in m (Reglement: 8–10 m). */
  zielLength: number;
  /** Mindestabstand der Strecke zum Rand der Fahrfläche in m (Reglement: 2–3 m zu festen Hindernissen). */
  edgeMargin: number;
}

/** Lichte Fahrspur-/Torbreite = Spurbreite + Zuschlag (Reglement: 1,65 m). */
export function laneWidth(r: Rules): number {
  return r.trackWidth + r.gateExtra;
}

/** Abstand der Pylonen-Mittelpunkte quer zur Fahrspur (lichte Breite + Bodenplatte). */
export function laneCenterDist(r: Rules): number {
  return laneWidth(r) + r.pylonBase;
}

export interface ValidationFlags {
  /** Näher als minTaskGap an einer anderen Aufgabe. */
  tooClose: boolean;
  /** Ragt über die Fahrfläche (inkl. Randabstand) hinaus. */
  outOfBounds: boolean;
  /** Weiter als maxTaskGap von der nächsten Aufgabe entfernt (nur Hinweis). */
  isolated: boolean;
  /** Abstand zur nächsten Aufgabe in m (Infinity, wenn keine andere existiert). */
  nearestDist: number;
}

export interface GeneratorOptions {
  mode: "exact" | "range";
  exact: number;
  min: number;
  max: number;
  /** IDs der erlaubten Vorlagen. */
  allowed: string[];
  /** Zielgasse als letzte Aufgabe anhängen. */
  withZielgasse: boolean;
}
