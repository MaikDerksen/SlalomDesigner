import { useEffect, useMemo } from "react";
import { useStore } from "./store";
import { Toolbar } from "./components/Toolbar";
import { CanvasEditor } from "./components/CanvasEditor";
import { Palette } from "./components/Palette";
import { GeneratorDialog, MapDialog, MapsDialog, SaveDialog, SettingsDialog, TracksDialog } from "./components/Dialogs";
import { ObstacleDesigner } from "./components/ObstacleDesigner";
import { MapWizard } from "./components/MapWizard";
import { WikiDialog } from "./components/WikiDialog";
import { LoginScreen } from "./components/LoginScreen";
import { validate } from "./validation";
import { analyzeRoute } from "./routing";

export default function App() {
  const dialog = useStore((s) => s.dialog);
  const toast = useStore((s) => s.toast);
  const undo = useStore((s) => s.undo);
  const obstacles = useStore((s) => s.obstacles);
  const map = useStore((s) => s.map);
  const rules = useStore((s) => s.rules);
  const user = useStore((s) => s.user);
  const authReady = useStore((s) => s.authReady);
  const init = useStore((s) => s.init);
  const route = useStore((s) => s.route);

  useEffect(() => {
    init();
  }, [init]);

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

  const routeInfo = useMemo(() => {
    if (!route || route.points.length < 4) return null;
    let len = 0;
    for (let i = 1; i < route.points.length; i++) {
      len += Math.hypot(
        route.points[i].x - route.points[i - 1].x,
        route.points[i].y - route.points[i - 1].y,
      );
    }
    const a = analyzeRoute(route.points, map, rules, obstacles);
    return { len, warnings: a.warnings.length };
  }, [route, map, rules, obstacles]);

  if (!authReady) {
    return <div className="login-wrap"><div className="hint">Lade…</div></div>;
  }
  if (!user) {
    return (
      <>
        <LoginScreen />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  return (
    <div className="app">
      <Toolbar />
      <main className="main">
        <CanvasEditor />
        <Palette />
      </main>

      <footer className="statusbar">
        <span className="status-pill">{obstacles.length} Aufgaben</span>
        <span className="status-pill">
          {map.name} · {fmt(map.width)} × {fmt(map.height)} m
        </span>
        {issues.tooClose > 0 && (
          <span className="status-pill bad">{issues.tooClose}× Abstand &lt; {fmt(rules.minTaskGap)} m</span>
        )}
        {issues.out > 0 && <span className="status-pill bad">{issues.out}× außerhalb der Fläche</span>}
        {issues.tooClose === 0 && issues.out === 0 && obstacles.length > 0 && (
          <span className="status-pill ok">Regelkonform (§7.2)</span>
        )}
        {routeInfo && (
          <span className={`status-pill ${routeInfo.warnings > 0 ? "bad" : "ok"}`}>
            Route {routeInfo.len.toFixed(0)} m
            {routeInfo.warnings > 0 ? ` · ${routeInfo.warnings} kritische Stellen` : " · fahrbar"}
          </span>
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
      {dialog === "wiki" && <WikiDialog />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function fmt(v: number): string {
  return v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}
