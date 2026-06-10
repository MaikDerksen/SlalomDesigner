import { useEffect, useMemo } from "react";
import { useStore } from "./store";
import { Toolbar } from "./components/Toolbar";
import { CanvasEditor } from "./components/CanvasEditor";
import { Palette } from "./components/Palette";
import { GeneratorDialog, MapDialog, MapsDialog, SaveDialog, SettingsDialog, TracksDialog } from "./components/Dialogs";
import { ObstacleDesigner } from "./components/ObstacleDesigner";
import { MapWizard } from "./components/MapWizard";
import { validate } from "./validation";

export default function App() {
  const dialog = useStore((s) => s.dialog);
  const toast = useStore((s) => s.toast);
  const undo = useStore((s) => s.undo);
  const obstacles = useStore((s) => s.obstacles);
  const map = useStore((s) => s.map);
  const rules = useStore((s) => s.rules);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const issues = useMemo(() => {
    const flags = validate(obstacles, map, rules);
    let tooClose = 0, out = 0;
    flags.forEach((f) => {
      if (f.tooClose) tooClose++;
      if (f.outOfBounds) out++;
    });
    return { tooClose, out };
  }, [obstacles, map, rules]);

  return (
    <div className="app">
      <Toolbar />
      <main className="main">
        <CanvasEditor />
        <Palette />
      </main>

      <footer className="statusbar">
        <span>{obstacles.length} Aufgaben</span>
        <span>
          {map.name}: {fmt(map.width)} × {fmt(map.height)} m
        </span>
        {issues.tooClose > 0 && (
          <span className="status-bad">⚠ {issues.tooClose}× Abstand &lt; {fmt(rules.minTaskGap)} m</span>
        )}
        {issues.out > 0 && <span className="status-bad">⚠ {issues.out}× außerhalb der Fläche</span>}
        {issues.tooClose === 0 && issues.out === 0 && obstacles.length > 0 && (
          <span className="status-ok">✓ regelkonform (§7.2)</span>
        )}
      </footer>

      {dialog === "generator" && <GeneratorDialog />}
      {dialog === "settings" && <SettingsDialog />}
      {dialog === "map" && <MapDialog />}
      {dialog === "maps" && <MapsDialog />}
      {dialog === "wizard" && <MapWizard />}
      {dialog === "tracks" && <TracksDialog />}
      {dialog === "save" && <SaveDialog />}
      {dialog === "designer" && <ObstacleDesigner />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function fmt(v: number): string {
  return v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}
