import { create } from "zustand";
import type {
  CustomTemplate,
  GeneratorOptions,
  MapConfig,
  ObstacleInstance,
  Pylon,
  Rules,
  Track,
} from "./types";
import { storage } from "./storage";
import { templateById } from "./templates";
import { uid } from "./geometry";
import { generateTrack } from "./generator";

export type DialogKind =
  | null
  | "generator"
  | "settings"
  | "map"
  | "tracks"
  | "designer"
  | "save";

interface AppState {
  rules: Rules;
  map: MapConfig;
  obstacles: ObstacleInstance[];
  selectedId: string | null;
  tracks: Track[];
  customTemplates: CustomTemplate[];
  currentTrackId: string | null;
  currentTrackName: string;
  dialog: DialogKind;
  /** Vorlage, die gerade per Drag & Drop aus der Palette gezogen wird. */
  dragTemplate: { templateId: string; name: string; pylons: Pylon[] } | null;
  undoStack: ObstacleInstance[][];
  toast: string | null;

  setDialog: (d: DialogKind) => void;
  setRules: (r: Rules) => void;
  setMap: (m: MapConfig) => void;
  select: (id: string | null) => void;
  setDragTemplate: (t: AppState["dragTemplate"]) => void;

  addObstacle: (templateId: string, x: number, y: number) => void;
  addCustomObstacle: (tpl: CustomTemplate, x: number, y: number) => void;
  moveObstacle: (id: string, x: number, y: number, recordUndo?: boolean) => void;
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
  deleteCustomTemplate: (id: string) => void;

  showToast: (msg: string) => void;
}

function persistSession(s: { obstacles: ObstacleInstance[]; currentTrackId: string | null; currentTrackName: string }) {
  storage.saveSession({
    obstacles: s.obstacles,
    trackId: s.currentTrackId,
    trackName: s.currentTrackName,
  });
}

const session = storage.loadSession();

export const useStore = create<AppState>((set, get) => ({
  rules: storage.loadRules(),
  map: storage.loadMap(),
  obstacles: (session?.obstacles as ObstacleInstance[]) ?? [],
  selectedId: null,
  tracks: storage.loadTracks(),
  customTemplates: storage.loadCustomTemplates(),
  currentTrackId: session?.trackId ?? null,
  currentTrackName: session?.trackName ?? "Neue Strecke",
  dialog: null,
  dragTemplate: null,
  undoStack: [],
  toast: null,

  setDialog: (d) => set({ dialog: d }),

  setRules: (r) => {
    storage.saveRules(r);
    set({ rules: r });
  },

  setMap: (m) => {
    storage.saveMap(m);
    set({ map: m });
  },

  select: (id) => set({ selectedId: id }),
  setDragTemplate: (t) => set({ dragTemplate: t }),

  pushUndo: () => {
    const { obstacles, undoStack } = get();
    const next = [...undoStack.slice(-49), obstacles.map((o) => ({ ...o, pylons: o.pylons }))];
    set({ undoStack: next });
  },

  undo: () => {
    const { undoStack } = get();
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    set({ undoStack: undoStack.slice(0, -1), obstacles: prev, selectedId: null });
    persistSession({ ...get(), obstacles: prev });
  },

  addObstacle: (templateId, x, y) => {
    const { rules } = get();
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
      pylons: tpl.build(rules),
    };
    const obstacles = [...get().obstacles, inst];
    set({ obstacles, selectedId: inst.id });
    persistSession({ ...get(), obstacles });
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
    const obstacles = [...get().obstacles, inst];
    set({ obstacles, selectedId: inst.id });
    persistSession({ ...get(), obstacles });
  },

  moveObstacle: (id, x, y, recordUndo = false) => {
    if (recordUndo) get().pushUndo();
    const obstacles = get().obstacles.map((o) => (o.id === id ? { ...o, x, y } : o));
    set({ obstacles });
    persistSession({ ...get(), obstacles });
  },

  rotateObstacle: (id, rotation) => {
    const obstacles = get().obstacles.map((o) => (o.id === id ? { ...o, rotation } : o));
    set({ obstacles });
    persistSession({ ...get(), obstacles });
  },

  deleteObstacle: (id) => {
    get().pushUndo();
    const obstacles = get().obstacles.filter((o) => o.id !== id);
    set({ obstacles, selectedId: null });
    persistSession({ ...get(), obstacles });
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
    const obstacles = [...get().obstacles, copy];
    set({ obstacles, selectedId: copy.id });
    persistSession({ ...get(), obstacles });
  },

  clearTrack: () => {
    get().pushUndo();
    set({ obstacles: [], selectedId: null, currentTrackId: null, currentTrackName: "Neue Strecke" });
    persistSession({ ...get(), obstacles: [] });
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
    });
    persistSession({ ...get(), obstacles: result });
    return true;
  },

  saveCurrentTrack: (name) => {
    const { obstacles, map, tracks, currentTrackId } = get();
    const now = Date.now();
    let next: Track[];
    let id = currentTrackId;
    const existing = tracks.find((t) => t.id === currentTrackId);
    if (existing) {
      next = tracks.map((t) =>
        t.id === currentTrackId
          ? { ...t, name, map: { ...map }, obstacles: obstacles.map((o) => ({ ...o })), updatedAt: now }
          : t,
      );
    } else {
      id = uid("trk");
      next = [
        ...tracks,
        {
          id,
          name,
          createdAt: now,
          updatedAt: now,
          map: { ...map },
          obstacles: obstacles.map((o) => ({ ...o })),
        },
      ];
    }
    storage.saveTracks(next);
    set({ tracks: next, currentTrackId: id, currentTrackName: name });
    persistSession({ ...get() });
    get().showToast(`„${name}" gespeichert`);
  },

  loadTrack: (id) => {
    const t = get().tracks.find((x) => x.id === id);
    if (!t) return;
    storage.saveMap(t.map);
    set({
      obstacles: t.obstacles.map((o) => ({ ...o, pylons: o.pylons.map((p) => ({ ...p })) })),
      map: { ...t.map },
      currentTrackId: t.id,
      currentTrackName: t.name,
      selectedId: null,
      dialog: null,
      undoStack: [],
    });
    persistSession({ ...get() });
  },

  deleteTrack: (id) => {
    const next = get().tracks.filter((t) => t.id !== id);
    storage.saveTracks(next);
    const cur = get().currentTrackId === id ? null : get().currentTrackId;
    set({ tracks: next, currentTrackId: cur });
  },

  addCustomTemplate: (name, pylons) => {
    const tpl: CustomTemplate = { id: uid("ctpl"), name, pylons };
    const next = [...get().customTemplates, tpl];
    storage.saveCustomTemplates(next);
    set({ customTemplates: next });
    get().showToast(`Hindernis „${name}" gespeichert`);
  },

  deleteCustomTemplate: (id) => {
    const next = get().customTemplates.filter((t) => t.id !== id);
    storage.saveCustomTemplates(next);
    set({ customTemplates: next });
  },

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 2600);
  },
}));
