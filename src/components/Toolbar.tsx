import { useEffect, useState } from "react";
import { useStore } from "../store";
import { exportAndShare } from "../export";
import { Icon } from "./Icons";

type MenuId = "route" | "edit" | "maps" | "user" | null;

export function Toolbar() {
  const setDialog = useStore((s) => s.setDialog);
  const clearTrack = useStore((s) => s.clearTrack);
  const undo = useStore((s) => s.undo);
  const undoStack = useStore((s) => s.undoStack);
  const setShowBare = useStore((s) => s.setShowBare);
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
  const startTour = useStore((s) => s.startTour);
  const [sharing, setSharing] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuId>(null);

  /* Klick außerhalb schließt das offene Menü */
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openMenu]);

  const toggleMenu = (id: Exclude<MenuId, null>) => setOpenMenu((m) => (m === id ? null : id));

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
        <img src="/icon-192.png" alt="" className="brand-icon" />
        <div>
          <div className="brand-name">SlalomDesigner</div>
          <div className="brand-track">{currentTrackName}</div>
        </div>
      </div>
      <div className="toolbar-actions">
        <button onClick={() => setDialog("generator")} className="primary" data-tour="generate">
          <Icon name="zap" />
          Zufall
        </button>

        {/* Route */}
        <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
          <button data-tour="route" className={openMenu === "route" || drawingRoute ? "menu-open" : ""} onClick={() => toggleMenu("route")}>
            <Icon name="route" />
            Route
            <span className="chevron">⌄</span>
          </button>
          {openMenu === "route" && (
            <div className="dropdown">
              <button
                onClick={() => {
                  makeAutoRoute();
                  setOpenMenu(null);
                }}
                title="Route automatisch berechnen"
              >
                <Icon name="zap" />
                KI
              </button>
              <button
                className={drawingRoute ? "active" : ""}
                onClick={() => {
                  setDrawingRoute(!drawingRoute);
                  setOpenMenu(null);
                }}
                title="Fahrlinie von Hand zeichnen – Reihenfolge und Einfahrten werden erkannt"
              >
                <Icon name="pencil" />
                {drawingRoute ? "Zeichnen beenden" : "Zeichnen"}
              </button>
              {route && (
                <button
                  onClick={() => {
                    clearRoute();
                    setOpenMenu(null);
                  }}
                >
                  <Icon name="eraser" />
                  Route löschen
                </button>
              )}
            </div>
          )}
        </div>

        {/* Edit – bleibt offen für mehrfaches Undo/Redo */}
        <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
          <button data-tour="edit" className={openMenu === "edit" ? "menu-open" : ""} onClick={() => toggleMenu("edit")}>
            <Icon name="pencil" />
            Edit
            <span className="chevron">⌄</span>
          </button>
          {openMenu === "edit" && (
            <div className="dropdown">
              <button onClick={undo} disabled={!undoStack.length} title="Strg+Z">
                <Icon name="undo" />
                Undo
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm("Strecke wirklich leeren?")) clearTrack();
                }}
              >
                <Icon name="trash" />
                Delete
              </button>
              <button
                onClick={() => {
                  setDialog("save");
                  setOpenMenu(null);
                }}
              >
                <Icon name="save" />
                Save
              </button>
            </div>
          )}
        </div>

        {/* Maps */}
        <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
          <button data-tour="maps" className={openMenu === "maps" ? "menu-open" : ""} onClick={() => toggleMenu("maps")}>
            <Icon name="map" />
            Maps
            <span className="chevron">⌄</span>
          </button>
          {openMenu === "maps" && (
            <div className="dropdown">
              <button
                onClick={() => {
                  setDialog("tracks");
                  setOpenMenu(null);
                }}
              >
                <Icon name="folder" />
                Strecken
              </button>
              <button
                onClick={() => {
                  setDialog("maps");
                  setOpenMenu(null);
                }}
              >
                <Icon name="image" />
                Trainingsplätze
              </button>
            </div>
          )}
        </div>

        {/* Halten zum Peek: blendet Nummern + Route aus → nackte Hindernisse */}
        <button
          className="peek-btn"
          title="Gedrückt halten: nur die Hindernisse anzeigen (Nummern & Route ausblenden)"
          onPointerDown={(e) => {
            e.preventDefault();
            setShowBare(true);
          }}
          onPointerUp={() => setShowBare(false)}
          onPointerLeave={() => setShowBare(false)}
          onPointerCancel={() => setShowBare(false)}
        >
          <Icon name="eye" />
          Ansicht
        </button>

        <button onClick={onShare} disabled={sharing} className="accent" data-tour="share">
          <Icon name="share" />
          {sharing ? "…" : "Senden"}
        </button>

        {/* User */}
        {user && (
          <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
            <button data-tour="user" className={openMenu === "user" ? "menu-open" : ""} onClick={() => toggleMenu("user")} title={user.email}>
              <Icon name="user" />
              {user.displayName}
              <span className="chevron">⌄</span>
            </button>
            {openMenu === "user" && (
              <div className="dropdown dropdown-right">
                <div className="user-menu-club">
                  <strong>{user.clubName}</strong>
                  <small>{user.email}</small>
                </div>
                <button
                  onClick={() => {
                    setDialog("settings");
                    setOpenMenu(null);
                  }}
                >
                  <Icon name="settings" />
                  Settings
                </button>
                <button
                  onClick={() => {
                    startTour();
                    setOpenMenu(null);
                  }}
                >
                  <Icon name="help" />
                  Einführung
                </button>
                <button onClick={toggleTheme}>
                  <Icon name={theme === "dark" ? "sun" : "moon"} />
                  {theme === "dark" ? "Heller Modus" : "Dark Mode"}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(user.inviteCode);
                    showToast(`Einladungscode kopiert: ${user.inviteCode}`);
                    setOpenMenu(null);
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
