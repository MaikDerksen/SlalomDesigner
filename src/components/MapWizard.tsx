import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Modal } from "./Dialogs";
import { PolygonEditor } from "./PolygonEditor";
import { dist, uid } from "../geometry";
import { safeCapture } from "../canvasBridge";
import { fileToMapImage, floodMask, closeMask, measureObject, toProcImage, traceContour } from "../imageProc";
import type { MapImage, SavedMap, V2 } from "../types";

type Step = 0 | 1 | 2 | 3 | 4;

const STEP_TITLES = ["Screenshot", "Maßstab", "Fahrfläche", "Sperrzonen", "Speichern"];

const REF_PRESETS = [
  { label: "PKW (4,50 m)", len: 4.5 },
  { label: "Kleinwagen (4,00 m)", len: 4.0 },
  { label: "Stellplatz Länge (5,00 m)", len: 5.0 },
  { label: "Stellplatz Breite (2,50 m)", len: 2.5 },
  { label: "LKW/Bus (12,00 m)", len: 12.0 },
];

/**
 * Wizard: Apple-Maps-Screenshot → Maßstab (über ein bekanntes Objekt, z. B.
 * ein Auto) → automatische Fahrflächen-Maske mit editierbaren Punkten →
 * Sperrzonen → als benannte Map speichern.
 */
export function MapWizard() {
  const setDialog = useStore((s) => s.setDialog);
  const maps = useStore((s) => s.maps);
  const wizardEditId = useStore((s) => s.wizardEditId);
  const saveMapToLibrary = useStore((s) => s.saveMapToLibrary);
  const showToast = useStore((s) => s.showToast);

  const editing = wizardEditId ? maps.find((m) => m.id === wizardEditId) ?? null : null;

  const [step, setStep] = useState<Step>(editing ? 1 : 0);
  const [image, setImage] = useState<MapImage | null>(editing?.image ?? null);
  const [proc, setProc] = useState<{ data: ImageData; scale: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Schritt 1: Kalibrierung (Bild-px)
  const initCal = () => {
    if (editing?.calibration) return editing.calibration;
    const w = editing?.image?.pxWidth ?? 1000;
    const h = editing?.image?.pxHeight ?? 1000;
    return { a: { x: w * 0.38, y: h * 0.5 }, b: { x: w * 0.62, y: h * 0.5 }, refLen: 4.5 };
  };
  const [cal, setCal] = useState(initCal);
  const [calMode, setCalMode] = useState<"auto" | "manual">("auto");

  // Schritt 2/3: Polygone (Bild-px)
  const pxFromM = editing && editing.image ? editing.image.pxWidth / editing.config.width : 1;
  const [boundary, setBoundary] = useState<V2[]>(
    editing?.config.boundary?.map((p) => ({ x: p.x * pxFromM, y: p.y * pxFromM })) ?? [],
  );
  const [blocked, setBlocked] = useState<V2[][]>(
    editing?.config.blocked?.map((z) => z.map((p) => ({ x: p.x * pxFromM, y: p.y * pxFromM }))) ?? [],
  );
  const [draft, setDraft] = useState<V2[] | null>(null);
  const [tolerance, setTolerance] = useState(34);
  const lastSeed = useRef<V2 | null>(null);

  const [title, setTitle] = useState(editing?.name ?? "Mein Platz");

  /* Verarbeitungs-Bild vorbereiten, sobald ein Bild da ist */
  useEffect(() => {
    if (!image) return;
    let alive = true;
    toProcImage(image).then((p) => alive && setProc(p));
    return () => {
      alive = false;
    };
  }, [image]);

  const scaleMPerPx = cal.refLen / Math.max(1e-6, dist(cal.a, cal.b));
  const mapW = image ? image.pxWidth * scaleMPerPx : 0;
  const mapH = image ? image.pxHeight * scaleMPerPx : 0;

  /* ---------- Aktionen ---------- */

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const img = await fileToMapImage(file);
      setImage(img);
      setProc(null);
      setBoundary([]);
      setBlocked([]);
      setCal({
        a: { x: img.pxWidth * 0.38, y: img.pxHeight * 0.5 },
        b: { x: img.pxWidth * 0.62, y: img.pxHeight * 0.5 },
        refLen: 4.5,
      });
      setStep(1);
    } catch {
      showToast("Bild konnte nicht geladen werden");
    } finally {
      setBusy(false);
    }
  };

  /** Schritt 1, Auto-Modus: Objekt (Auto) antippen → Hauptachse messen. */
  const autoMeasure = (p: V2) => {
    if (!proc) return;
    const seed = { x: p.x / proc.scale, y: p.y / proc.scale };
    const res = measureObject(proc.data, seed, 42);
    if (!res) {
      showToast("Kein Objekt erkannt – näher zoomen oder Linie manuell ziehen");
      return;
    }
    setCal((c) => ({
      ...c,
      a: { x: res.a.x * proc.scale, y: res.a.y * proc.scale },
      b: { x: res.b.x * proc.scale, y: res.b.y * proc.scale },
    }));
    showToast("Objekt vermessen – Endpunkte bei Bedarf fein justieren");
  };

  /** Schritt 2: Fahrfläche antippen → Maske → Polygon. */
  const detectArea = (p: V2) => {
    if (!proc) return;
    lastSeed.current = p;
    runDetect(p, tolerance);
  };

  const runDetect = (p: V2, tol: number) => {
    if (!proc) return;
    const seed = { x: p.x / proc.scale, y: p.y / proc.scale };
    const mask = floodMask(proc.data, seed, tol);
    if (!mask) {
      showToast("Keine Fläche erkannt – Toleranz erhöhen");
      return;
    }
    const closed = closeMask(mask, proc.data.width, proc.data.height);
    const contour = traceContour(closed, proc.data.width, proc.data.height);
    if (contour.length < 3) {
      showToast("Kontur zu klein – anderen Punkt antippen");
      return;
    }
    setBoundary(contour.map((q) => ({ x: q.x * proc.scale, y: q.y * proc.scale })));
  };

  /** Klick auf den Wizard-Canvas, je nach Schritt. */
  const onCanvasClick = (p: V2) => {
    if (step === 1 && calMode === "auto") autoMeasure(p);
    else if (step === 2) detectArea(p);
    else if (step === 3 && draft) setDraft([...draft, p]);
  };

  const finishZone = () => {
    if (draft && draft.length >= 3) setBlocked([...blocked, draft]);
    setDraft(null);
  };

  const save = () => {
    if (!image) return;
    const id = editing?.id ?? uid("map");
    const k = scaleMPerPx;
    const toM = (p: V2) => ({ x: r2(p.x * k), y: r2(p.y * k) });
    const saved: SavedMap = {
      id,
      name: title.trim() || "Platz",
      createdAt: editing?.createdAt ?? Date.now(),
      image,
      calibration: cal,
      config: {
        name: title.trim() || "Platz",
        width: r2(mapW),
        height: r2(mapH),
        mapId: id,
        boundary: boundary.length >= 3 ? boundary.map(toM) : undefined,
        blocked: blocked.length ? blocked.map((z) => z.map(toM)) : undefined,
      },
    };
    saveMapToLibrary(saved);
    setDialog(null);
  };

  /* ---------- Render ---------- */

  const canNext =
    (step === 0 && !!image) ||
    (step === 1 && scaleMPerPx > 0 && isFinite(scaleMPerPx) && cal.refLen > 0) ||
    (step === 2 && boundary.length >= 3) ||
    step === 3;

  return (
    <Modal title={`Map aus Screenshot – ${STEP_TITLES[step]}`} onClose={() => setDialog(null)} wide>
      <div className="wizard-steps">
        {STEP_TITLES.map((t, i) => (
          <span key={t} className={`wstep ${i === step ? "on" : ""} ${i < step ? "done" : ""}`}>
            {i + 1}. {t}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <p>Apple-Maps-/Satelliten-Screenshot hierher ziehen oder auswählen.</p>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
          />
          {busy && <p className="hint">Wird geladen…</p>}
        </div>
      )}

      {step >= 1 && image && (
        <>
          {step === 1 && (
            <div className="wizard-controls">
              <div className="tool-group">
                <button className={calMode === "auto" ? "on" : ""} onClick={() => setCalMode("auto")}>
                  🚗 Objekt antippen
                </button>
                <button className={calMode === "manual" ? "on" : ""} onClick={() => setCalMode("manual")}>
                  📏 Linie ziehen
                </button>
              </div>
              <label className="inline">
                Referenzlänge
                <select
                  value={String(cal.refLen)}
                  onChange={(e) => setCal({ ...cal, refLen: +e.target.value })}
                >
                  {REF_PRESETS.map((p) => (
                    <option key={p.label} value={p.len}>
                      {p.label}
                    </option>
                  ))}
                  {!REF_PRESETS.some((p) => p.len === cal.refLen) && (
                    <option value={cal.refLen}>{cal.refLen} m (eigen)</option>
                  )}
                </select>
                <input
                  type="number"
                  step={0.1}
                  min={0.5}
                  value={cal.refLen}
                  onChange={(e) => setCal({ ...cal, refLen: +e.target.value })}
                  style={{ width: 70 }}
                />
                m
              </label>
              <span className="hint">
                {calMode === "auto"
                  ? "Tippe auf ein Auto – der Algorithmus misst es und setzt die Linie. Endpunkte danach fein justierbar."
                  : "Ziehe die beiden Endpunkte exakt über das bekannte Objekt."}
                {"  →  "}
                <strong>
                  Fläche: {mapW.toFixed(1)} × {mapH.toFixed(1)} m ({(scaleMPerPx * 100).toFixed(1)} cm/px)
                </strong>
              </span>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-controls">
              <span className="hint">
                Tippe auf die Fahrfläche – die Maske wird automatisch erkannt. Punkte: ziehen ·
                Mittelpunkt = neuer Punkt · Punkt antippen + ✕ = löschen.
              </span>
              <label className="inline">
                Toleranz
                <input
                  type="range"
                  min={12}
                  max={80}
                  value={tolerance}
                  onChange={(e) => {
                    const t = +e.target.value;
                    setTolerance(t);
                    if (lastSeed.current) runDetect(lastSeed.current, t);
                  }}
                />
                {tolerance}
              </label>
              {boundary.length > 0 && (
                <span className="hint">
                  {boundary.length} Punkte · <button className="mini-btn" onClick={() => setBoundary([])}>Zurücksetzen</button>
                </span>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="wizard-controls">
              <span className="hint">
                Markiere Bereiche, die wegen Hindernissen (Laternen, Inseln, Container …) gesperrt sind.
              </span>
              {!draft ? (
                <button className="primary" onClick={() => setDraft([])}>⬛ Neue Sperrzone</button>
              ) : (
                <>
                  <span className="hint">{draft.length} Punkte gesetzt – tippe auf die Karte</span>
                  <button className="primary" onClick={finishZone} disabled={draft.length < 3}>
                    ✓ Zone schließen
                  </button>
                  <button onClick={() => setDraft(null)}>Abbrechen</button>
                </>
              )}
              {blocked.length > 0 && <span className="hint">{blocked.length} Zone(n)</span>}
            </div>
          )}

          {step === 4 && (
            <div className="wizard-controls">
              <label className="grow">
                Titel der Map
                <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
              </label>
              <span className="hint">
                {mapW.toFixed(1)} × {mapH.toFixed(1)} m · Maske: {boundary.length} Punkte ·{" "}
                {blocked.length} Sperrzone(n)
              </span>
            </div>
          )}

          <WizardCanvas
            image={image}
            onCanvasClick={onCanvasClick}
            interactive={step === 1 ? "cal" : step === 2 ? "mask" : step === 3 ? "blocked" : "view"}
            cal={cal}
            onCalChange={(a, b) => setCal((c) => ({ ...c, a, b }))}
            boundary={boundary}
            onBoundaryChange={setBoundary}
            blocked={blocked}
            onBlockedChange={setBlocked}
            draft={draft}
            showCal={step === 1}
          />
        </>
      )}

      <div className="modal-actions">
        {step > (editing ? 1 : 0) && (
          <button onClick={() => setStep((s) => (s - 1) as Step)}>← Zurück</button>
        )}
        {step < 4 ? (
          <button className="primary" disabled={!canNext} onClick={() => setStep((s) => (s + 1) as Step)}>
            Weiter →
          </button>
        ) : (
          <button className="primary" onClick={save} disabled={!title.trim()}>
            💾 Map speichern
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Zoombarer Bild-Canvas mit Overlays ---------- */

function WizardCanvas({
  image,
  onCanvasClick,
  interactive,
  cal,
  onCalChange,
  boundary,
  onBoundaryChange,
  blocked,
  onBlockedChange,
  draft,
  showCal,
}: {
  image: MapImage;
  onCanvasClick: (p: V2) => void;
  interactive: "cal" | "mask" | "blocked" | "view";
  cal: { a: V2; b: V2; refLen: number };
  onCalChange: (a: V2, b: V2) => void;
  boundary: V2[];
  onBoundaryChange: (p: V2[]) => void;
  blocked: V2[][];
  onBlockedChange: (z: V2[][]) => void;
  draft: V2[] | null;
  showCal: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: image.pxWidth, h: image.pxHeight });
  useEffect(() => setVb({ x: 0, y: 0, w: image.pxWidth, h: image.pxHeight }), [image]);

  const pan = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const calDrag = useRef<"a" | "b" | null>(null);

  const toSvg = (e: React.PointerEvent | React.WheelEvent): V2 => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svgRef.current!.getScreenCTM()!.inverse(),
    );
    return { x: pt.x, y: pt.y };
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = toSvg(e);
    const k = e.deltaY < 0 ? 1 / 1.15 : 1.15;
    setVb((v) => {
      const w = Math.min(image.pxWidth * 2, Math.max(40, v.w * k));
      const h = (w / v.w) * v.h;
      return { x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    safeCapture(e.currentTarget as Element, e.pointerId);
    const p = toSvg(e);
    pan.current = { x: p.x, y: p.y, vx: vb.x, vy: vb.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (calDrag.current) {
      const p = toSvg(e);
      if (calDrag.current === "a") onCalChange(p, cal.b);
      else onCalChange(cal.a, p);
      return;
    }
    if (!pan.current) return;
    const p = toSvg(e);
    const dx = p.x - pan.current.x;
    const dy = p.y - pan.current.y;
    if (Math.hypot(dx, dy) > vb.w * 0.008) pan.current.moved = true;
    if (pan.current.moved) {
      setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (calDrag.current) {
      calDrag.current = null;
      return;
    }
    if (pan.current && !pan.current.moved) onCanvasClick(toSvg(e));
    pan.current = null;
  };

  const hr = vb.w / 55; // Handle-Radius, zoom-unabhängig

  return (
    <svg
      ref={svgRef}
      className="wizard-canvas"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (pan.current = null)}
    >
      <image href={image.data} x={0} y={0} width={image.pxWidth} height={image.pxHeight} />

      {/* Fahrflächen-Maske */}
      {boundary.length >= 3 && (
        <>
          <path
            d={`M${vb.x - 50} ${vb.y - 50} h${vb.w + 100} v${vb.h + 100} h-${vb.w + 100} Z M${boundary
              .map((p) => `${p.x} ${p.y}`)
              .join(" L")} Z`}
            fill="rgba(20,24,32,0.45)"
            fillRule="evenodd"
            pointerEvents="none"
          />
          <PolygonEditor
            points={boundary}
            onChange={interactive === "mask" ? onBoundaryChange : () => {}}
            color="#22c55e"
            handleR={interactive === "mask" ? hr : hr * 0.4}
            fill="rgba(34,197,94,0.08)"
          />
        </>
      )}

      {/* Sperrzonen */}
      {blocked.map((zone, zi) => (
        <g key={zi}>
          <PolygonEditor
            points={zone}
            onChange={
              interactive === "blocked"
                ? (pts) => onBlockedChange(blocked.map((z, k) => (k === zi ? pts : z)))
                : () => {}
            }
            color="var(--danger)"
            handleR={interactive === "blocked" ? hr : hr * 0.4}
            fill="rgba(217,45,32,0.30)"
          />
          {interactive === "blocked" && (
            <g
              transform={`translate(${centroid(zone).x} ${centroid(zone).y})`}
              style={{ cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onBlockedChange(blocked.filter((_, k) => k !== zi))}
            >
              <circle r={hr * 1.3} fill="var(--danger)" />
              <text textAnchor="middle" dominantBaseline="central" fontSize={hr * 1.5} fill="#fff" pointerEvents="none">
                🗑
              </text>
            </g>
          )}
        </g>
      ))}

      {/* Sperrzonen-Entwurf */}
      {draft && draft.length > 0 && (
        <g pointerEvents="none">
          <polyline
            points={draft.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="rgba(217,45,32,0.18)"
            stroke="var(--danger)"
            strokeWidth={hr * 0.3}
            strokeDasharray={`${hr} ${hr * 0.6}`}
          />
          {draft.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={hr * 0.7} fill="var(--danger)" />
          ))}
        </g>
      )}

      {/* Kalibrierungs-Linie */}
      {showCal && (
        <g>
          <line
            x1={cal.a.x}
            y1={cal.a.y}
            x2={cal.b.x}
            y2={cal.b.y}
            stroke="#2563eb"
            strokeWidth={hr * 0.4}
          />
          {(["a", "b"] as const).map((k) => (
            <circle
              key={k}
              cx={cal[k].x}
              cy={cal[k].y}
              r={hr * 1.2}
              fill="#fff"
              stroke="#2563eb"
              strokeWidth={hr * 0.35}
              style={{ cursor: "grab" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                safeCapture(e.target as Element, e.pointerId);
                calDrag.current = k;
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          ))}
          <text
            x={(cal.a.x + cal.b.x) / 2}
            y={(cal.a.y + cal.b.y) / 2 - hr * 1.6}
            textAnchor="middle"
            fontSize={hr * 1.8}
            fontWeight={700}
            fill="#2563eb"
            stroke="#fff"
            strokeWidth={hr * 0.25}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {cal.refLen.toLocaleString("de-DE")} m
          </text>
        </g>
      )}
    </svg>
  );
}

function centroid(pts: V2[]): V2 {
  let x = 0, y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
