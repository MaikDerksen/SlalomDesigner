import { useState } from "react";
import { useStore } from "../store";
import { RULE_FIELDS, DEFAULT_RULES } from "../rules";
import { TEMPLATES } from "../templates";
import { Icon } from "./Icons";
import type { GeneratorOptions, Rules } from "../types";

export function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="mini-btn" onClick={onClose}>
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Zufallsgenerator ---------- */

export function GeneratorDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const generate = useStore((s) => s.generate);
  const customTemplates = useStore((s) => s.customTemplates);
  const showToast = useStore((s) => s.showToast);

  const allIds = [...TEMPLATES.filter((t) => t.id !== "zielgasse").map((t) => t.id), ...customTemplates.map((t) => t.id)];
  const [mode, setMode] = useState<GeneratorOptions["mode"]>("range");
  const [exact, setExact] = useState(8);
  const [min, setMin] = useState(6);
  const [max, setMax] = useState(10);
  const [withZiel, setWithZiel] = useState(true);
  const [allowed, setAllowed] = useState<string[]>(allIds);

  const toggle = (id: string) =>
    setAllowed((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const run = () => {
    const ok = generate({ mode, exact, min: Math.min(min, max), max: Math.max(min, max), allowed, withZielgasse: withZiel });
    if (ok) setDialog(null);
    else showToast("Keine gültige Anordnung gefunden – Fläche vergrößern oder weniger Aufgaben wählen.");
  };

  return (
    <Modal title="Zufallsstrecke erstellen" onClose={() => setDialog(null)}>
      <div className="field-row">
        <label className="radio">
          <input type="radio" checked={mode === "range"} onChange={() => setMode("range")} />
          Min/Max
        </label>
        <label className="radio">
          <input type="radio" checked={mode === "exact"} onChange={() => setMode("exact")} />
          Genau
        </label>
      </div>
      {mode === "range" ? (
        <div className="field-row">
          <label>
            Min. Aufgaben
            <input type="number" min={1} max={30} value={min} onChange={(e) => setMin(+e.target.value)} />
          </label>
          <label>
            Max. Aufgaben
            <input type="number" min={1} max={30} value={max} onChange={(e) => setMax(+e.target.value)} />
          </label>
        </div>
      ) : (
        <div className="field-row">
          <label>
            Anzahl Aufgaben
            <input type="number" min={1} max={30} value={exact} onChange={(e) => setExact(+e.target.value)} />
          </label>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={withZiel} onChange={(e) => setWithZiel(e.target.checked)} />
        Zielgasse als letzte Aufgabe
      </label>

      <div className="section-label">Erlaubte Hindernisse</div>
      <div className="chip-grid">
        {TEMPLATES.filter((t) => t.id !== "zielgasse").map((t) => (
          <button
            key={t.id}
            className={`chip ${allowed.includes(t.id) ? "on" : ""}`}
            onClick={() => toggle(t.id)}
          >
            {t.name}
          </button>
        ))}
        {customTemplates.map((t) => (
          <button
            key={t.id}
            className={`chip ${allowed.includes(t.id) ? "on" : ""}`}
            onClick={() => toggle(t.id)}
          >
            {t.name} ★
          </button>
        ))}
      </div>

      <div className="modal-actions">
        <button className="primary" onClick={run} disabled={!allowed.length}>
          <Icon name="zap" />
          Generieren
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Regel-Einstellungen ---------- */

export function SettingsDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const rules = useStore((s) => s.rules);
  const setRules = useStore((s) => s.setRules);
  const [draft, setDraft] = useState<Rules>({ ...rules });

  const apply = () => {
    setRules(draft);
    setDialog(null);
  };

  return (
    <Modal title="Regeln (ADAC Kartslalom 2026)" onClose={() => setDialog(null)} wide>
      <p className="hint">
        Default-Werte nach offiziellem Reglement §7/§8. Alle Maße von Fuß zu Fuß der Pylonen.
        Änderbar, falls sich das Reglement ändert.
      </p>
      <div className="settings-grid">
        {RULE_FIELDS.map((f) => (
          <label key={f.key} className="setting">
            <span>
              {f.label}
              {f.hint && <small>{f.hint}</small>}
            </span>
            <span className="unit-input">
              <input
                type="number"
                step={f.step}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: +e.target.value })}
              />
              <em>{f.unit}</em>
            </span>
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={() => setDraft({ ...DEFAULT_RULES })}>Reglement-Defaults</button>
        <button className="primary" onClick={apply}>Übernehmen</button>
      </div>
    </Modal>
  );
}

/* ---------- Map Designer ---------- */

export function MapDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const map = useStore((s) => s.map);
  const saveRectMap = useStore((s) => s.saveRectMap);
  const [name, setName] = useState(map.name);
  const [w, setW] = useState(map.width);
  const [h, setH] = useState(map.height);

  const apply = () => {
    saveRectMap(name.trim() || "Trainingsplatz", clamp(w), clamp(h));
  };

  return (
    <Modal title="Map Designer – Fahrfläche" onClose={() => setDialog(null)}>
      <p className="hint">Maße cm-genau in Metern (z. B. 62,35). Reglement: befestigte, ebene Fläche.</p>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Vereinsparkplatz" />
      </label>
      <div className="field-row">
        <label>
          Breite (m)
          <input type="number" step={0.01} min={5} max={500} value={w} onChange={(e) => setW(+e.target.value)} />
        </label>
        <label>
          Länge (m)
          <input type="number" step={0.01} min={5} max={500} value={h} onChange={(e) => setH(+e.target.value)} />
        </label>
      </div>
      <div className="map-preview">
        <div
          className="map-preview-rect"
          style={{ aspectRatio: `${clamp(w)} / ${clamp(h)}` }}
        >
          {fmtM(w)} × {fmtM(h)} m
        </div>
      </div>
      <div className="modal-actions">
        <button className="primary" onClick={apply}>Übernehmen</button>
      </div>
    </Modal>
  );
}

function clamp(v: number): number {
  return Math.round(Math.min(500, Math.max(5, v || 5)) * 100) / 100;
}

function fmtM(v: number): string {
  return clamp(v).toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

/* ---------- Map-Bibliothek ---------- */

export function MapsDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const maps = useStore((s) => s.maps);
  const map = useStore((s) => s.map);
  const activateMap = useStore((s) => s.activateMap);
  const deleteMap = useStore((s) => s.deleteMap);
  const openWizard = useStore((s) => s.openWizard);

  return (
    <Modal title="Fahrflächen" onClose={() => setDialog(null)}>
      <div className="field-row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={() => openWizard(null)}>
          <Icon name="image" />
          Aus Screenshot
        </button>
        <button onClick={() => setDialog("map")}>
          <Icon name="ruler" />
          Rechteck-Fläche
        </button>
      </div>
      {!maps.length && (
        <p className="hint">
          Noch keine Maps gespeichert. Lade einen Apple-Maps-Screenshot hoch – der Maßstab wird über
          ein bekanntes Objekt (z. B. ein Auto) bestimmt, die Fahrfläche automatisch maskiert.
        </p>
      )}
      <div className="track-list">
        {maps.map((m) => (
          <div key={m.id} className={`track-item ${map.mapId === m.id ? "active" : ""}`}>
            <div className="track-info" onClick={() => activateMap(m.id)}>
              <strong className="with-icon">
                <Icon name={m.hasImage ? "image" : "ruler"} size={13} />
                {m.name}
                {map.mapId === m.id && <span className="badge-active"> aktiv</span>}
              </strong>
              <small>
                {m.width.toFixed(1)} × {m.height.toFixed(1)} m
                {m.boundaryCount ? ` · Maske: ${m.boundaryCount} Punkte` : ""}
                {m.blockedCount ? ` · ${m.blockedCount} Sperrzone(n)` : ""}
              </small>
            </div>
            <button className="primary" onClick={() => activateMap(m.id)}>Wählen</button>
            {m.hasImage && (
              <button className="mini-btn" onClick={() => openWizard(m.id)} title="Bearbeiten">
                <Icon name="pencil" size={12} />
              </button>
            )}
            <button
              className="mini-btn danger"
              onClick={() => {
                if (confirm(`Map „${m.name}" löschen? Strecken auf dieser Fläche werden mitgelöscht.`))
                  deleteMap(m.id);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- Strecke speichern ---------- */

export function SaveDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const saveCurrentTrack = useStore((s) => s.saveCurrentTrack);
  const currentTrackName = useStore((s) => s.currentTrackName);
  const [name, setName] = useState(currentTrackName);

  return (
    <Modal title="Strecke speichern" onClose={() => setDialog(null)}>
      <label>
        Name der Strecke
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="modal-actions">
        <button
          className="primary"
          onClick={() => {
            saveCurrentTrack(name.trim() || "Strecke");
            setDialog(null);
          }}
        >
          <Icon name="save" />
          Speichern
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Gespeicherte Strecken ---------- */

export function TracksDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const tracks = useStore((s) => s.tracks);
  const loadTrack = useStore((s) => s.loadTrack);
  const deleteTrack = useStore((s) => s.deleteTrack);

  return (
    <Modal title="Gespeicherte Strecken" onClose={() => setDialog(null)}>
      {!tracks.length && <p className="hint">Noch keine Strecken gespeichert.</p>}
      <div className="track-list">
        {[...tracks]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((t) => (
            <div key={t.id} className="track-item">
              <div className="track-info" onClick={() => loadTrack(t.id)}>
                <strong>{t.name}</strong>
                <small>
                  {t.obstacleCount} Aufgaben · {t.mapName} ({t.mapWidth.toFixed(0)}×{t.mapHeight.toFixed(0)} m) ·{" "}
                  {new Date(t.updatedAt).toLocaleDateString("de-DE")}
                </small>
              </div>
              <button className="primary" onClick={() => loadTrack(t.id)}>Öffnen</button>
              <button
                className="mini-btn danger"
                onClick={() => {
                  if (confirm(`„${t.name}" löschen?`)) deleteTrack(t.id);
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
      </div>
    </Modal>
  );
}
