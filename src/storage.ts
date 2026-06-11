import type { CustomTemplate, Rules, SavedMap, Track } from "./types";

/**
 * Einmalige Migration: Die App speicherte früher in localStorage.
 * Beim ersten Login werden vorhandene Browser-Daten eingesammelt, per
 * POST /api/import in die Datenbank übernommen und danach gelöscht.
 * Neue Daten landen ausschließlich in der Datenbank.
 */

const LEGACY_KEYS = {
  rules: "ksp.rules.v1",
  tracks: "ksp.tracks.v1",
  custom: "ksp.customTemplates.v1",
  map: "ksp.map.v1",
  maps: "ksp.maps.v1",
  session: "ksp.session.v1",
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export interface LegacyData {
  rules: Partial<Rules> | null;
  maps: SavedMap[];
  tracks: Track[];
  customTemplates: CustomTemplate[];
}

/** Vorhandene Altdaten einsammeln (null, wenn nichts zu migrieren ist). */
export function collectLegacyData(): LegacyData | null {
  const maps = read<SavedMap[]>(LEGACY_KEYS.maps) ?? [];
  const tracks = read<Track[]>(LEGACY_KEYS.tracks) ?? [];
  const customTemplates = read<CustomTemplate[]>(LEGACY_KEYS.custom) ?? [];
  const rules = read<Partial<Rules>>(LEGACY_KEYS.rules);
  if (!maps.length && !tracks.length && !customTemplates.length && !rules) return null;
  return { rules, maps, tracks, customTemplates };
}

/** Altdaten nach erfolgreichem Import entfernen. */
export function clearLegacyData(): void {
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // privater Modus o. Ä. – ignorieren
    }
  }
}
