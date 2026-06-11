import type { Rules } from "./types";

/**
 * Default-Werte nach offiziellem ADAC Kartslalom Reglement 2026 (§7).
 * Alle Werte sind in den Einstellungen änderbar, falls sich das Reglement ändert.
 */
export const DEFAULT_RULES: Rules = {
  pylonHeight: 0.5, // §7.2: 50 cm ± 3 cm
  pylonBase: 0.28, // Bodenplatte einer 50-cm-Pylone (Darstellung)
  minTaskGap: 4, // §7.2: Abstände zwischen Aufgaben min. 4 m
  maxTaskGap: 10, // §7.2: ... max. 10 m
  trackWidth: 1.25, // Techn. Bestimmungen: Spurbreite hinten (Slick) 1250 mm
  gateExtra: 0.4, // §7.2: lichte Torbreite = Spurbreite + 40 cm
  laneGap: 0.5, // §7.3: Pylonenabstand in Gassen 50 cm
  wechselGapMin: 1.5, // §7.3.5
  wechselGapMax: 4, // §7.3.5
  kreiselInnerD: 10, // §7.3.3
  kreiselGap: 1.0, // §7.3.3
  kreiselEntry: 3, // §7.3.3
  zielWidth: 2.5, // §7.3.16
  zielLength: 8, // §7.3.16: 8–10 m
  edgeMargin: 1, // Abstand der Aufgaben zum Platzrand (Empfehlung)
  // §7.1: fahrbar mit vollem Lenkeinschlag. Das Reglement selbst verlangt
  // U-Turns mit ~1,1 m Radius (Z-Gasse), also liegt der Kart-Wendekreis darunter.
  kartTurnRadius: 1.0,
};

/** Beschriftung + Einheit für den Einstellungsdialog. */
export const RULE_FIELDS: {
  key: keyof Rules;
  label: string;
  unit: string;
  step: number;
  hint?: string;
}[] = [
  { key: "minTaskGap", label: "Min. Abstand zwischen Aufgaben", unit: "m", step: 0.1, hint: "§7.2 – Reglement: 4 m" },
  { key: "maxTaskGap", label: "Max. Abstand zwischen Aufgaben", unit: "m", step: 0.1, hint: "§7.2 – Reglement: 10 m" },
  { key: "trackWidth", label: "Spurbreite Kart (hinten, Slick)", unit: "m", step: 0.01, hint: "Techn. Best.: 1,25 m" },
  { key: "gateExtra", label: "Zuschlag lichte Torbreite", unit: "m", step: 0.01, hint: "§7.2 – Spurbreite + 40 cm" },
  { key: "laneGap", label: "Pylonenabstand in Gassen", unit: "m", step: 0.05, hint: "§7.3 – 50 cm" },
  { key: "pylonHeight", label: "Pylonenhöhe", unit: "m", step: 0.01, hint: "§7.2 – 50 cm ± 3 cm" },
  { key: "pylonBase", label: "Pylonen-Bodenplatte", unit: "m", step: 0.01 },
  { key: "wechselGapMin", label: "Wechseltor: min. Torabstand", unit: "m", step: 0.1, hint: "§7.3.5 – 1,5 m" },
  { key: "wechselGapMax", label: "Wechseltor: max. Torabstand", unit: "m", step: 0.1, hint: "§7.3.5 – 4 m" },
  { key: "kreiselInnerD", label: "Kreisel: Innendurchmesser", unit: "m", step: 0.5, hint: "§7.3.3 – 10 m" },
  { key: "kreiselGap", label: "Kreisel: Pylonenabstand", unit: "m", step: 0.1, hint: "§7.3.3 – 1,0 m" },
  { key: "kreiselEntry", label: "Kreisel: Einfahrtbreite", unit: "m", step: 0.1, hint: "§7.3.3 – 3 m" },
  { key: "zielWidth", label: "Zielgasse: Breite", unit: "m", step: 0.1, hint: "§7.3.16 – 2,5 m" },
  { key: "zielLength", label: "Zielgasse: Länge", unit: "m", step: 0.5, hint: "§7.3.16 – 8–10 m" },
  { key: "edgeMargin", label: "Randabstand zur Fahrflächengrenze", unit: "m", step: 0.5, hint: "§8 – Sicherheitsabstand" },
  { key: "kartTurnRadius", label: "Kart-Wendekreis (Radius)", unit: "m", step: 0.1, hint: "§7.1 – fahrbar mit vollem Lenkeinschlag" },
];
