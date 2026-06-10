import type { CustomTemplate, MapConfig, Rules, Track } from "./types";
import { DEFAULT_RULES } from "./rules";

/** Persistenz über localStorage (funktioniert im Web und in der Capacitor-WebView). */

const KEYS = {
  rules: "ksp.rules.v1",
  tracks: "ksp.tracks.v1",
  custom: "ksp.customTemplates.v1",
  map: "ksp.map.v1",
  session: "ksp.session.v1",
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Speicher voll / privater Modus – still ignorieren
  }
}

export const storage = {
  loadRules: (): Rules => ({ ...DEFAULT_RULES, ...load<Partial<Rules>>(KEYS.rules, {}) }),
  saveRules: (r: Rules) => save(KEYS.rules, r),

  loadTracks: (): Track[] => load<Track[]>(KEYS.tracks, []),
  saveTracks: (t: Track[]) => save(KEYS.tracks, t),

  loadCustomTemplates: (): CustomTemplate[] => load<CustomTemplate[]>(KEYS.custom, []),
  saveCustomTemplates: (t: CustomTemplate[]) => save(KEYS.custom, t),

  loadMap: (): MapConfig => load<MapConfig>(KEYS.map, { name: "Trainingsplatz", width: 60, height: 40 }),
  saveMap: (m: MapConfig) => save(KEYS.map, m),

  loadSession: () => load<{ obstacles: unknown[]; trackId: string | null; trackName: string } | null>(KEYS.session, null),
  saveSession: (s: { obstacles: unknown[]; trackId: string | null; trackName: string }) => save(KEYS.session, s),
};
