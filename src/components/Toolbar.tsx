import { useState } from "react";
import { useStore } from "../store";
import { exportAndShare } from "../export";
import { Icon } from "./Icons";

export function Toolbar() {
  const setDialog = useStore((s) => s.setDialog);
  const clearTrack = useStore((s) => s.clearTrack);
  const undo = useStore((s) => s.undo);
  const undoStack = useStore((s) => s.undoStack);
  const currentTrackName = useStore((s) => s.currentTrackName);
  const map = useStore((s) => s.map);
  const mapImage = useStore((s) => s.mapImage);
  const obstacles = useStore((s) => s.obstacles);
  const rules = useStore((s) => s.rules);
  const showToast = useStore((s) => s.showToast);
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const route = useStore((s) => s.route);
  const drawingRoute = useStore((s) => s.drawingRoute);
  const makeAutoRoute = useStore((s) => s.makeAutoRoute);
  const setDrawingRoute = useStore((s) => s.setDrawingRoute);
  const clearRoute = useStore((s) => s.clearRoute);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const onShare = async () => {
    if (!obstacles.length) {
      showToast("Keine Hindernisse auf der Strecke");
      return;
    }
    setSharing(true);
    try {
      const res = await exportAndShare(map, obstacles, rules, currentTrackName, mapImage, route);
      showToast(res === "shared" ? "Bild geteilt" : "Bild gespeichert (Download)");
    } finally {
      setSharing(false);
    }
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-dot" />
        <div>
          <div className="brand-name">Kart Slalom Planner</div>
          <div className="brand-track">{currentTrackName}</div>
        </div>
      </div>
      <div className="toolbar-actions">
        <button onClick={() => setDialog("generator")} className="primary">
          <Icon name="zap" />
          Zufall
        </button>
        <div className="tb-group" title="Strecken-Route">
          <button onClick={makeAutoRoute} title="Route automatisch berechnen">
            <Icon name="route" />
            Route
          </button>
          <button
            onClick={() => setDrawingRoute(!drawingRoute)}
            className={drawingRoute ? "accent" : ""}
            title="Fahrlinie von Hand zeichnen – Reihenfolge und Einfahrten werden erkannt"
          >
            <Icon name="pencil" />
            {drawingRoute ? "Zeichnen…" : "Zeichnen"}
          </button>
          {route && (
            <button onClick={clearRoute} title="Route entfernen">
              <Icon name="eraser" />
            </button>
          )}
        </div>
        <div className="tb-group" title="Bearbeiten">
          <button onClick={undo} disabled={!undoStack.length} title="Rückgängig (Strg+Z)">
            <Icon name="undo" />
          </button>
          <button
            onClick={() => {
              if (confirm("Strecke wirklich leeren?")) clearTrack();
            }}
            title="Strecke leeren"
          >
            <Icon name="trash" />
          </button>
        </div>
        <div className="tb-group" title="Bibliothek">
          <button onClick={() => setDialog("save")}>
            <Icon name="save" />
            Speichern
          </button>
          <button onClick={() => setDialog("tracks")}>
            <Icon name="folder" />
            Strecken
          </button>
          <button onClick={() => setDialog("maps")}>
            <Icon name="map" />
            Fläche
          </button>
          <button onClick={() => setDialog("settings")} title="Regeln (ADAC 2026)">
            <Icon name="settings" />
          </button>
        </div>
        <button onClick={toggleTheme} title={theme === "dark" ? "Heller Modus" : "Dunkler Modus"}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button onClick={onShare} disabled={sharing} className="accent">
          <Icon name="share" />
          {sharing ? "…" : "Senden"}
        </button>
        {user && (
          <div className="user-menu-wrap">
            <button onClick={() => setMenuOpen((o) => !o)} title={user.email}>
              <Icon name="user" />
              {user.displayName}
            </button>
            {menuOpen && (
              <div className="user-menu" onPointerLeave={() => setMenuOpen(false)}>
                <div className="user-menu-club">
                  <strong>{user.clubName}</strong>
                  <small>{user.email}</small>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(user.inviteCode);
                    showToast(`Einladungscode kopiert: ${user.inviteCode}`);
                    setMenuOpen(false);
                  }}
                >
                  <Icon name="link" />
                  Einladungscode: {user.inviteCode}
                </button>
                <button onClick={logout}>
                  <Icon name="logout" />
                  Abmelden
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
