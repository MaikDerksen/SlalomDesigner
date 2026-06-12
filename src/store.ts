import { create } from "zustand";
import type {
  AuthUser,
  CustomTemplate,
  GeneratorOptions,
  MapConfig,
  MapImage,
  MapSummary,
  ObstacleInstance,
  Pylon,
  Rules,
  SavedMap,
  TrackSummary,
} from "./types";
import { api, ApiError } from "./api";
import { DEFAULT_RULES } from "./rules";
import { templateById } from "./templates";
import { uid } from "./geometry";
import { generateTrack } from "./generator";
import { collectLegacyData, clearLegacyData } from "./storage";
import { autoRoute, routeEntries, smoothDrawnLine, type RouteData } from "./routing";
import type { V2 } from "./types";

export type DialogKind =
  | null
  | "generator"
  | "settings"
  | "map"
  | "maps"
  | "wizard"
  | "tracks"
  | "designer"
  | "save";

/** Server-Antwortform einer Map (entspricht SavedMap). */
type MapDetail = SavedMap;

interface DraftResponse {
  name: string;
  map: MapDetail;
  obstacles: ObstacleInstance[];
  route?: RouteData | null;
}

interface AppState {
  user: AuthUser | null;
  /** true, sobald der Auth-Status geklärt ist (Login-Screen vs. App). */
  authReady: boolean;
  authError: string | null;
  busy: boolean;

  rules: Rules;
  map: MapConfig;
  mapImage: MapImage | null;
  maps: MapSummary[];
  wizardMap: SavedMap | null;
  wizardEditId: string | null;
  obstacles: ObstacleInstance[];
  selectedId: string | null;
  tracks: TrackSummary[];
  customTemplates: CustomTemplate[];
  currentTrackId: string | null;
  currentTrackName: string;
  dialog: DialogKind;
  dragTemplate: { templateId: string; name: string; pylons: Pylon[] } | null;
  undoStack: ObstacleInstance[][];
  toast: string | null;
  /** Eingezeichnete oder automatisch erzeugte Strecken-Route. */
  route: RouteData | null;
  /** Zeichenmodus für die Route aktiv? */
  drawingRoute: boolean;

  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    displayName: string;
    clubName?: string;
    inviteCode?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;

  setDialog: (d: DialogKind) => void;
  setRules: (r: Rules) => void;
  saveRectMap: (name: string, width: number, height: number) => Promise<void>;
  saveMapToLibrary: (saved: SavedMap) => Promise<void>;
  activateMap: (id: string) => Promise<void>;
  deleteMap: (id: string) => void;
  openWizard: (editId: string | null) => Promise<void>;
  select: (id: string | null) => void;
  setDragTemplate: (t: AppState["dragTemplate"]) => void;

  addObstacle: (templateId: string, x: number, y: number) => void;
  addCustomObstacle: (tpl: CustomTemplate, x: number, y: number) => void;
  moveObstacle: (id: string, x: number, y: number) => void;
  rotateObstacle: (id: string, rotation: number) => void;
  deleteObstacle: (id: string) => void;
  duplicateObstacle: (id: string) => void;
  clearTrack: () => void;
  pushUndo: () => void;
  undo: () => void;

  generate: (opts: GeneratorOptions) => boolean;

  saveCurrentTrack: (name: string) => void;
  loadTrack: (id: string) => void;
  deleteTrack: (id: string) => void;

  addCustomTemplate: (name: string, pylons: Pylon[]) => void;
  updateCustomTemplate: (id: string, name: string, pylons: Pylon[]) => void;
  deleteCustomTemplate: (id: string) => void;
  /** Designer öffnen; id = bestehendes eigenes Hindernis bearbeiten. */
  openDesigner: (editId: string | null) => void;
  designerEditId: string | null;

  makeAutoRoute: () => void;
  setDrawingRoute: (on: boolean) => void;
  applyDrawnRoute: (raw: V2[]) => void;
  clearRoute: () => void;

  theme: "light" | "dark";
  toggleTheme: () => void;

  showToast: (msg: string) => void;
}

/**
 * Theme ist eine Geräte-Einstellung (kein Vereinsdatum) – sie folgt dem
 * System und wird nur bei manueller Wahl lokal gemerkt.
 */
function initialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("ksp.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // privater Modus
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
}

const startTheme = initialTheme();
applyTheme(startTheme);

/* Entwurf (Arbeitsstand) verzögert zum Server schreiben */
let draftTimer: ReturnType<typeof setTimeout> | null = null;

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Verbindung zum Server fehlgeschlagen";
}

export const useStore = create<AppState>((set, get) => {
  const scheduleDraftSave = () => {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      const { user, map, obstacles, currentTrackName, route } = get();
      if (!user || !map.mapId) return;
      try {
        await api.put("/draft", { mapId: map.mapId, name: currentTrackName, obstacles, route });
      } catch {
        // Autosave still fehlschlagen lassen – nächste Änderung versucht es erneut
      }
    }, 1200);
  };

  const applyMapDetail = (detail: MapDetail) => {
    set({ map: detail.config, mapImage: detail.image ?? null });
  };

  /** Nach Login/Registrierung: Altdaten migrieren, dann alles laden. */
  const loadAll = async () => {
    // Einmalige Übernahme der bisherigen localStorage-Daten
    const legacy = collectLegacyData();
    if (legacy) {
      try {
        const counts = await api.post<{ maps: number; tracks: number; customTemplates: number }>(
          "/import",
          legacy,
        );
        clearLegacyData();
        get().showToast(
          `Lokale Daten übernommen: ${counts.maps} Maps, ${counts.tracks} Strecken, ${counts.customTemplates} Hindernisse`,
        );
      } catch (e) {
        get().showToast(`Migration fehlgeschlagen: ${errMsg(e)}`);
      }
    }

    const [rules, maps, tracks, customTemplates, draft] = await Promise.all([
      api.get<Partial<Rules>>("/rules"),
      api.get<MapSummary[]>("/maps"),
      api.get<TrackSummary[]>("/tracks"),
      api.get<CustomTemplate[]>("/custom-obstacles"),
      api.get<DraftResponse | null>("/draft"),
    ]);

    set({ rules: { ...DEFAULT_RULES, ...rules }, maps, tracks, customTemplates });

    if (draft) {
      applyMapDetail(draft.map);
      set({
        obstacles: draft.obstacles,
        currentTrackName: draft.name,
        currentTrackId: null,
        route: draft.route ?? null,
      });
    } else if (maps.length) {
      const detail = await api.get<MapDetail>(`/maps/${maps[0].id}`);
      applyMapDetail(detail);
      set({ obstacles: [], currentTrackName: "Neue Strecke" });
    }
  };

  return {
    user: null,
    authReady: false,
    authError: null,
    busy: false,

    rules: { ...DEFAULT_RULES },
    map: { name: "Trainingsplatz", width: 60, height: 40 },
    mapImage: null,
    maps: [],
    wizardMap: null,
    wizardEditId: null,
    obstacles: [],
    selectedId: null,
    tracks: [],
    customTemplates: [],
    currentTrackId: null,
    currentTrackName: "Neue Strecke",
    dialog: null,
    dragTemplate: null,
    undoStack: [],
    toast: null,
    route: null,
    drawingRoute: false,
    designerEditId: null,
    theme: startTheme,

    toggleTheme: () => {
      const theme = get().theme === "dark" ? "light" : "dark";
      applyTheme(theme);
      try {
        localStorage.setItem("ksp.theme", theme);
      } catch {
        // privater Modus – Theme gilt dann nur für die Sitzung
      }
      set({ theme });
    },

    init: async () => {
      try {
        const user = await api.get<AuthUser>("/auth/me");
        set({ user });
        await loadAll();
      } catch {
        // nicht angemeldet
      } finally {
        set({ authReady: true });
      }
    },

    login: async (email, password) => {
      set({ busy: true, authError: null });
      try {
        const user = await api.post<AuthUser>("/auth/login", { email, password });
        set({ user });
        await loadAll();
      } catch (e) {
        set({ authError: errMsg(e) });
      } finally {
        set({ busy: false });
      }
    },

    register: async (data) => {
      set({ busy: true, authError: null });
      try {
        const user = await api.post<AuthUser>("/auth/register", data);
        set({ user });
        await loadAll();
      } catch (e) {
        set({ authError: errMsg(e) });
      } finally {
        set({ busy: false });
      }
    },

    logout: async () => {
      try {
        await api.post("/auth/logout");
      } catch {
        // Cookie ist clientseitig ohnehin weg, wenn der Server nicht antwortet
      }
      set({
        user: null,
        obstacles: [],
        tracks: [],
        maps: [],
        customTemplates: [],
        mapImage: null,
        currentTrackId: null,
        currentTrackName: "Neue Strecke",
        undoStack: [],
        dialog: null,
        route: null,
        drawingRoute: false,
      });
    },

    setDialog: (d) => set({ dialog: d }),

    setRules: (r) => {
      set({ rules: r });
      api.put("/rules", r).catch((e) => get().showToast(errMsg(e)));
    },

    saveRectMap: async (name, width, height) => {
      try {
        const detail = await api.post<MapDetail>("/maps", { name, width, height });
        applyMapDetail(detail);
        set({
          maps: [...get().maps, summaryOf(detail)],
          dialog: null,
        });
        scheduleDraftSave();
      } catch (e) {
        get().showToast(errMsg(e));
      }
    },

    saveMapToLibrary: async (saved) => {
      const payload = {
        name: saved.name,
        width: saved.config.width,
        height: saved.config.height,
        boundary: saved.config.boundary,
        blocked: saved.config.blocked,
        image: saved.image,
        calibration: saved.calibration,
      };
      try {
        const detail = saved.id
          ? await api.put<MapDetail>(`/maps/${saved.id}`, payload)
          : await api.post<MapDetail>("/maps", payload);
        applyMapDetail(detail);
        const maps = get().maps.some((m) => m.id === detail.id)
          ? get().maps.map((m) => (m.id === detail.id ? summaryOf(detail) : m))
          : [...get().maps, summaryOf(detail)];
        set({ maps, wizardMap: null, wizardEditId: null, dialog: null });
        scheduleDraftSave();
        get().showToast(`Fläche „${detail.name}" gespeichert`);
      } catch (e) {
        get().showToast(errMsg(e));
      }
    },

    activateMap: async (id) => {
      try {
        const detail = await api.get<MapDetail>(`/maps/${id}`);
        applyMapDetail(detail);
        set({ dialog: null });
        scheduleDraftSave();
      } catch (e) {
        get().showToast(errMsg(e));
      }
    },

    deleteMap: (id) => {
      api
        .del(`/maps/${id}`)
        .then(() => {
          set({ maps: get().maps.filter((m) => m.id !== id) });
          // Strecken auf dieser Map wurden serverseitig mitgelöscht
          api.get<TrackSummary[]>("/tracks").then((tracks) => set({ tracks }));
          if (get().map.mapId === id) set({ mapImage: null });
        })
        .catch((e) => get().showToast(errMsg(e)));
    },

    openWizard: async (editId) => {
      if (!editId) {
        set({ wizardMap: null, wizardEditId: null, dialog: "wizard" });
        return;
      }
      try {
        const detail = await api.get<MapDetail>(`/maps/${editId}`);
        set({ wizardMap: detail, wizardEditId: editId, dialog: "wizard" });
      } catch (e) {
        get().showToast(errMsg(e));
      }
    },

    select: (id) => set({ selectedId: id }),
    setDragTemplate: (t) => set({ dragTemplate: t }),

    pushUndo: () => {
      const { obstacles, undoStack } = get();
      set({ undoStack: [...undoStack.slice(-49), obstacles] });
    },

    undo: () => {
      const { undoStack } = get();
      if (!undoStack.length) return;
      set({
        undoStack: undoStack.slice(0, -1),
        obstacles: undoStack[undoStack.length - 1],
        selectedId: null,
      });
      scheduleDraftSave();
    },

    addObstacle: (templateId, x, y) => {
      const tpl = templateById(templateId);
      if (!tpl) return;
      get().pushUndo();
      const inst: ObstacleInstance = {
        id: uid("obs"),
        templateId,
        name: tpl.name,
        x,
        y,
        rotation: 0,
        pylons: tpl.build(get().rules),
      };
      set({ obstacles: [...get().obstacles, inst], selectedId: inst.id });
      scheduleDraftSave();
    },

    addCustomObstacle: (tpl, x, y) => {
      get().pushUndo();
      const inst: ObstacleInstance = {
        id: uid("obs"),
        templateId: tpl.id,
        name: tpl.name,
        x,
        y,
        rotation: 0,
        pylons: tpl.pylons.map((p) => ({ ...p })),
      };
      set({ obstacles: [...get().obstacles, inst], selectedId: inst.id });
      scheduleDraftSave();
    },

    moveObstacle: (id, x, y) => {
      set({ obstacles: get().obstacles.map((o) => (o.id === id ? { ...o, x, y } : o)) });
      scheduleDraftSave();
    },

    rotateObstacle: (id, rotation) => {
      set({ obstacles: get().obstacles.map((o) => (o.id === id ? { ...o, rotation } : o)) });
      scheduleDraftSave();
    },

    deleteObstacle: (id) => {
      get().pushUndo();
      set({ obstacles: get().obstacles.filter((o) => o.id !== id), selectedId: null });
      scheduleDraftSave();
    },

    duplicateObstacle: (id) => {
      const src = get().obstacles.find((o) => o.id === id);
      if (!src) return;
      get().pushUndo();
      const copy: ObstacleInstance = {
        ...src,
        id: uid("obs"),
        x: src.x + 2,
        y: src.y + 2,
        pylons: src.pylons.map((p) => ({ ...p })),
      };
      set({ obstacles: [...get().obstacles, copy], selectedId: copy.id });
      scheduleDraftSave();
    },

    clearTrack: () => {
      get().pushUndo();
      set({
        obstacles: [],
        selectedId: null,
        currentTrackId: null,
        currentTrackName: "Neue Strecke",
        route: null,
      });
      scheduleDraftSave();
    },

    generate: (opts) => {
      const { map, rules, customTemplates } = get();
      const result = generateTrack(map, rules, opts, customTemplates);
      if (!result) return false;
      get().pushUndo();
      set({
        obstacles: result,
        selectedId: null,
        currentTrackId: null,
        currentTrackName: "Zufallsstrecke",
        route: null,
      });
      scheduleDraftSave();
      return true;
    },

    makeAutoRoute: () => {
      const { obstacles, map, rules } = get();
      if (obstacles.length < 2) {
        get().showToast("Mindestens 2 Aufgaben für eine Route nötig");
        return;
      }
      const route = autoRoute(obstacles, map, rules);
      if (!route) {
        get().showToast("Route konnte nicht berechnet werden");
        return;
      }
      set({ route, drawingRoute: false });
      scheduleDraftSave();
    },

    setDrawingRoute: (on) => {
      set({ drawingRoute: on, selectedId: null });
      if (on) get().showToast("Fahrlinie mit dem Finger/der Maus über die Aufgaben zeichnen");
    },

    applyDrawnRoute: (raw) => {
      const { obstacles, rules } = get();
      const points = smoothDrawnLine(raw);
      if (points.length < 10) {
        set({ drawingRoute: false });
        get().showToast("Linie zu kurz – Route nicht übernommen");
        return;
      }
      const entries = routeEntries(points, obstacles, rules);
      const visited = entries
        .map((e) => obstacles.find((o) => o.id === e.obstacleId))
        .filter((o): o is ObstacleInstance => !!o);
      const rest = obstacles.filter((o) => !entries.some((e) => e.obstacleId === o.id));
      get().pushUndo();
      set({
        obstacles: [...visited, ...rest],
        route: { source: "drawn", points },
        drawingRoute: false,
      });
      scheduleDraftSave();
      get().showToast(
        `Route übernommen: ${visited.length} Aufgaben in Fahr-Reihenfolge${rest.length ? `, ${rest.length} nicht getroffen` : ""}`,
      );
    },

    clearRoute: () => {
      set({ route: null, drawingRoute: false });
      scheduleDraftSave();
    },

    saveCurrentTrack: (name) => {
      const { map, obstacles, currentTrackId, route } = get();
      if (!map.mapId) {
        get().showToast("Keine Fläche aktiv");
        return;
      }
      api
        .post<{ id: string }>("/tracks", {
          id: currentTrackId ?? undefined,
          name,
          mapId: map.mapId,
          obstacles,
          route,
        })
        .then(async ({ id }) => {
          set({
            currentTrackId: id,
            currentTrackName: name,
            tracks: await api.get<TrackSummary[]>("/tracks"),
          });
          scheduleDraftSave(); // Entwurf übernimmt den neuen Namen
          get().showToast(`„${name}" gespeichert`);
        })
        .catch((e) => get().showToast(errMsg(e)));
    },

    loadTrack: (id) => {
      api
        .get<{ id: string; name: string; map: MapDetail; obstacles: ObstacleInstance[]; route?: RouteData | null }>(
          `/tracks/${id}`,
        )
        .then((t) => {
          applyMapDetail(t.map);
          set({
            obstacles: t.obstacles,
            currentTrackId: t.id,
            currentTrackName: t.name,
            selectedId: null,
            dialog: null,
            undoStack: [],
            route: t.route ?? null,
          });
          scheduleDraftSave();
        })
        .catch((e) => get().showToast(errMsg(e)));
    },

    deleteTrack: (id) => {
      api
        .del(`/tracks/${id}`)
        .then(() => {
          set({
            tracks: get().tracks.filter((t) => t.id !== id),
            currentTrackId: get().currentTrackId === id ? null : get().currentTrackId,
          });
        })
        .catch((e) => get().showToast(errMsg(e)));
    },

    addCustomTemplate: (name, pylons) => {
      api
        .post<CustomTemplate>("/custom-obstacles", { name, pylons })
        .then((tpl) => {
          set({ customTemplates: [...get().customTemplates, tpl] });
          get().showToast(`Hindernis „${name}" gespeichert`);
        })
        .catch((e) => get().showToast(errMsg(e)));
    },

    updateCustomTemplate: (id, name, pylons) => {
      api
        .put<CustomTemplate>(`/custom-obstacles/${id}`, { name, pylons })
        .then((tpl) => {
          set({ customTemplates: get().customTemplates.map((t) => (t.id === id ? tpl : t)) });
          get().showToast(`Hindernis „${name}" aktualisiert`);
        })
        .catch((e) => get().showToast(errMsg(e)));
    },

    openDesigner: (editId) => set({ designerEditId: editId, dialog: "designer" }),

    deleteCustomTemplate: (id) => {
      api
        .del(`/custom-obstacles/${id}`)
        .then(() => set({ customTemplates: get().customTemplates.filter((t) => t.id !== id) }))
        .catch((e) => get().showToast(errMsg(e)));
    },

    showToast: (msg) => {
      set({ toast: msg });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null });
      }, 3200);
    },
  };
});

// Dev-Hook für Tests (nicht im Produktions-Build)
if (import.meta.env.DEV) {
  (window as unknown as { __store?: typeof useStore }).__store = useStore;
}

function summaryOf(detail: SavedMap): MapSummary {
  return {
    id: detail.id,
    name: detail.name,
    width: detail.config.width,
    height: detail.config.height,
    hasImage: !!detail.image,
    boundaryCount: detail.config.boundary?.length ?? 0,
    blockedCount: detail.config.blocked?.length ?? 0,
  };
}
