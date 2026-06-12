import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Modal } from "./Dialogs";
import { Icon } from "./Icons";
import { api } from "../api";
import { laneWidth } from "../types";

const ADAC_URL = "https://www.adac-motorsport.de/deutsche-kart-slalom-meisterschaft/reglement-und-info/";

interface WikiMeta {
  filename: string;
  uploadedAt: number;
  sizeBytes: number;
}

/**
 * Wissensdatenbank: Schnellübersicht der wichtigsten Reglement-Regeln
 * (mit den aktuell konfigurierten Werten des Vereins), das Reglement-PDF
 * (ansehen / herunterladen / ersetzen) und der Link zur offiziellen
 * ADAC-Seite.
 */
export function WikiDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const rules = useStore((s) => s.rules);
  const showToast = useStore((s) => s.showToast);
  const [meta, setMeta] = useState<WikiMeta | null | "laden">("laden");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMeta = () => {
    api
      .get<WikiMeta | null>("/wiki")
      .then(setMeta)
      .catch(() => setMeta(null));
  };
  useEffect(loadMeta, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      showToast("Bitte eine PDF-Datei wählen");
      return;
    }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.put("/wiki/pdf", { filename: file.name, data: base64 });
      showToast("Reglement-PDF ersetzt");
      loadMeta();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const lane = laneWidth(rules).toFixed(2).replace(".", ",");
  const f = (v: number, d = 1) => v.toFixed(d).replace(".", ",");

  return (
    <Modal title="Wissensdatenbank – ADAC Kartslalom" onClose={() => setDialog(null)} wide>
      {/* Offizielle Quelle + PDF */}
      <div className="wiki-doc">
        <div className="wiki-doc-info">
          <Icon name="book" size={20} />
          <div>
            {meta === "laden" ? (
              <strong>Lade…</strong>
            ) : meta ? (
              <>
                <strong>{meta.filename}</strong>
                <small>
                  Stand {new Date(meta.uploadedAt).toLocaleDateString("de-DE")} ·{" "}
                  {(meta.sizeBytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB
                </small>
              </>
            ) : (
              <>
                <strong>Kein PDF hinterlegt</strong>
                <small>Lade das aktuelle Reglement hoch</small>
              </>
            )}
          </div>
        </div>
        <div className="wiki-doc-actions">
          {meta && meta !== "laden" && (
            <>
              <button onClick={() => window.open("/api/wiki/pdf", "_blank")}>
                <Icon name="book" />
                Ansehen
              </button>
              <a className="btn-like" href="/api/wiki/pdf?download=1">
                <Icon name="download" />
                Herunterladen
              </a>
            </>
          )}
          <button onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="share" />
            {busy ? "Lädt…" : meta && meta !== "laden" ? "Ersetzen" : "Hochladen"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => upload(e.target.files?.[0] ?? undefined)}
          />
        </div>
      </div>
      <a className="wiki-source" href={ADAC_URL} target="_blank" rel="noreferrer">
        <Icon name="externalLink" size={13} />
        Offizielle Reglement-Seite des ADAC öffnen
      </a>

      {/* Schnellübersicht */}
      <div className="section-label">Aufbau &amp; Pylonen (§7) – aktuelle Werte</div>
      <ul className="wiki-list">
        <li>Pylonenhöhe <strong>{(rules.pylonHeight * 100).toFixed(0)} cm ± 3 cm</strong>; alle Maße von Fuß zu Fuß der Pylonen</li>
        <li>Abstand zwischen Aufgaben <strong>{f(rules.minTaskGap)}–{f(rules.maxTaskGap)} m</strong></li>
        <li>Lichte Torbreite = Spurbreite ({f(rules.trackWidth, 2)} m) + {(rules.gateExtra * 100).toFixed(0)} cm = <strong>{lane} m</strong></li>
        <li>Pylonenabstand in Gassen <strong>{(rules.laneGap * 100).toFixed(0)} cm</strong></li>
        <li>Einzelpylone: liegende Pylone zeigt mit der Spitze auf den Fuß, Abstand = eine Pylonenhöhe</li>
        <li>Parcours muss mit vollem Lenkeinschlag im Schritttempo fahrbar sein (§7.1)</li>
      </ul>

      <div className="section-label">Aufgaben (§7.3)</div>
      <table className="wiki-table">
        <tbody>
          <tr><td>Pylonentor / Wechseltor</td><td>2 Pylonen / 2 Tore in Linie, Torabstand {f(rules.wechselGapMin)}–{f(rules.wechselGapMax)} m</td></tr>
          <tr><td>Spurgasse gerade</td><td>3–5 Pylonen je Seite, gesamtheitlich markiert</td></tr>
          <tr><td>Spurgasse gebogen</td><td>5–10 Pylonen je Seite, Abstand 50 cm (jede Pylone zählt)</td></tr>
          <tr><td>Schweizer Slalom</td><td>Einzelpylonen in Linie, wechselseitig; falsche Anfahrseite = ausgelassen</td></tr>
          <tr><td>Kreisel</td><td>Innen-Ø {f(rules.kreiselInnerD, 0)} m, Pylonen alle {f(rules.kreiselGap)} m, Einfahrt {f(rules.kreiselEntry)} m, min. 360°</td></tr>
          <tr><td>Wende 90–180°</td><td>3 Pylonen im Dreieck, gesamtheitlich markiert</td></tr>
          <tr><td>Ypsilon / Kreuz</td><td>jedes Hindernisteil mindestens einmal durchfahren</td></tr>
          <tr><td>Z-Gasse</td><td>Gassenabstand &gt; 2 m (&gt; 4 m = neue Aufgabe)</td></tr>
          <tr><td>Schneckenhaus</td><td>Kastenbreite ca. 3 m, innen↔außen beliebig</td></tr>
          <tr><td>Zielgasse</td><td>Breite {f(rules.zielWidth)} m, Länge 8–10 m, endet mit Stillstand an der Haltelinie</td></tr>
        </tbody>
      </table>

      <div className="section-label">Wertung (§9.1)</div>
      <ul className="wiki-list">
        <li>Pylone umgeworfen/verschoben: <strong>2 Strafsekunden</strong> (max. 10 s je Aufgabe)</li>
        <li>Aufgabe ausgelassen oder falsch befahren: <strong>10 Strafsekunden</strong></li>
        <li>Haltelinie überfahren: <strong>2 Strafsekunden</strong></li>
        <li>Gerade Spurgasse: je Seite nur 1 Fehler; gebogene: jede Pylone zählt</li>
        <li>Nachholen/Korrigieren nur bis zum Beginn der nächsten Aufgabe</li>
      </ul>

      <div className="section-label">Karts (Technik)</div>
      <ul className="wiki-list">
        <li>4-Takt max. <strong>6,5 PS</strong> · Elektro max. <strong>3,3 kW</strong></li>
        <li>Spurbreite hinten (Slick) <strong>1,25 m</strong>, vorne 1,11 m ± 2 cm</li>
        <li>Sicherheitsabstand zu festen Hindernissen/Zuschauern: 3 m (min. 2 m mit Absicherung, §8)</li>
      </ul>
      <p className="hint">
        Schnellübersicht aus dem offiziellen Reglement; verbindlich ist das PDF. Geänderte Werte aus den
        Einstellungen werden hier live angezeigt.
      </p>
    </Modal>
  );
}
