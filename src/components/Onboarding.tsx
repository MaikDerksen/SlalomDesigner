import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { placeCard, type Box, type Placement, type Size } from "../onboardingPlacement";

/**
 * Geführte Einführungs-Tour ("Onboarding"). Startet einmalig automatisch beim
 * ersten Login (Server-Flag `user.onboarded`) und kann jederzeit über das
 * Profilmenü erneut gestartet werden.
 *
 * Darstellung: der aktive Bereich wird per Spotlight hervorgehoben, der Rest
 * der Oberfläche abgedunkelt. Eine Sprechblase erklärt Schritt für Schritt,
 * wo etwas zu finden ist, was es tut und lädt zum Ausprobieren ein.
 */

interface TourStep {
  id: string;
  /** Wert des data-tour-Attributs am Zielelement. Ohne Ziel: zentrierte Karte. */
  target?: string;
  title: string;
  body: string;
  /** Optionaler "Probier's"-Hinweis (Handlungsaufforderung). */
  tryHint?: string;
  placement?: Placement;
  /** Interaktiver Schritt: springt weiter, sobald ein Hindernis platziert wurde. */
  advanceOnObstacle?: boolean;
}

const STEPS: TourStep[] = [
  {
    id: "welcome",
    placement: "center",
    title: "Willkommen bei SlalomDesigner 👋",
    body: "In einer Minute zeigen wir dir, wie du deine erste Kartslalom-Strecke nach ADAC-Reglement planst. Du kannst die Tour jederzeit überspringen.",
  },
  {
    id: "canvas",
    target: "canvas",
    placement: "right",
    title: "Hier entsteht deine Strecke",
    body: "Das ist die Fahrfläche. Mit dem Mausrad bzw. zwei Fingern zoomst du, mit gedrückter Maus/Finger verschiebst du die Ansicht.",
  },
  {
    id: "palette",
    target: "palette",
    placement: "left",
    title: "Hier findest du alle Hindernisse",
    body: "Die offiziellen Aufgaben nach Reglement §7.3 – Tore, Gassen, Wechseltore, Kreisel und die Zielgasse. Ganz unten kannst du auch eigene Hindernisse entwerfen.",
  },
  {
    id: "place",
    target: "palette",
    placement: "left",
    title: "Probieren wir es gleich aus",
    body: "Ein Hindernis landet mit einem Tipp in der Mitte der Fläche – oder du ziehst es per Drag & Drop an die gewünschte Stelle.",
    tryHint: "Tippe oder ziehe jetzt ein Hindernis auf die Fläche.",
    advanceOnObstacle: true,
  },
  {
    id: "edit-obstacle",
    target: "canvas",
    placement: "right",
    title: "Auswählen, ziehen, drehen",
    body: "Tippe ein Hindernis an, um es auszuwählen. Über die Leiste am unteren Rand drehst, duplizierst oder löschst du es – ziehen geht direkt mit der Maus.",
  },
  {
    id: "statusbar",
    target: "statusbar",
    placement: "top",
    title: "Regelkonform? Siehst du sofort",
    body: "Die Leiste zeigt live die Anzahl der Aufgaben, die Flächengröße und ob alle Mindestabstände (§7.2) eingehalten sind.",
  },
  {
    id: "generate",
    target: "generate",
    placement: "bottom",
    title: "Keine Lust auf Handarbeit?",
    body: "„Zufall“ erstellt dir auf Knopfdruck eine komplette, regelkonforme Strecke – Anzahl und erlaubte Hindernisse legst du selbst fest.",
  },
  {
    id: "route",
    target: "route",
    placement: "bottom",
    title: "Die ideale Fahrlinie",
    body: "Unter „Route“ lässt du die Linie automatisch berechnen (KI) oder zeichnest sie mit dem Finger selbst ein – die Reihenfolge der Aufgaben wird erkannt.",
  },
  {
    id: "maps",
    target: "maps",
    placement: "bottom",
    title: "Plätze & gespeicherte Strecken",
    body: "Unter „Maps“ verwaltest du deine Trainingsplätze (auch aus Luftbildern) und öffnest zuvor gespeicherte Strecken wieder.",
  },
  {
    id: "edit",
    target: "edit",
    placement: "bottom",
    title: "Sichern & rückgängig",
    body: "Im „Edit“-Menü machst du Schritte rückgängig und speicherst die Strecke benannt ab. Dein Arbeitsstand wird zusätzlich automatisch gesichert.",
  },
  {
    id: "share",
    target: "share",
    placement: "bottom",
    title: "Fertig? Teile sie!",
    body: "Mit „Senden“ exportierst du die Strecke als Bild und teilst sie direkt – ideal für den Aushang oder die Trainingsgruppe.",
  },
  {
    id: "finish",
    placement: "center",
    title: "Los geht’s! 🎉",
    body: "Das war’s. Du findest diese Tour jederzeit wieder über dein Profilmenü → „Einführung“. Viel Erfolg beim Planen!",
  },
];

export function Onboarding() {
  const authReady = useStore((s) => s.authReady);
  const user = useStore((s) => s.user);
  const dialog = useStore((s) => s.dialog);
  const tourActive = useStore((s) => s.tourActive);
  const tourStep = useStore((s) => s.tourStep);
  const obstacleCount = useStore((s) => s.obstacles.length);
  const nextStep = useStore((s) => s.nextStep);
  const prevStep = useStore((s) => s.prevStep);
  const completeTour = useStore((s) => s.completeTour);

  const [rect, setRect] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState<Size>({ width: 340, height: 220 });
  // Erzwingt eine Neuberechnung der Position bei Fenster-Resize – nötig für
  // zentrierte Schritte, deren rect (null) sich sonst nie ändert.
  const [, bumpViewport] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const obstacleBaseline = useRef(0);

  const step = STEPS[tourStep];
  const isFirst = tourStep === 0;
  const isLast = tourStep === STEPS.length - 1;

  /* Auto-Start beim ersten Login (Server-Flag). Reset bei Nutzerwechsel. */
  useEffect(() => {
    if (!user) {
      startedRef.current = false;
      return;
    }
    if (authReady && !user.onboarded && !tourActive && !dialog && !startedRef.current) {
      // Kurze Verzögerung, damit das Layout steht. Der Guard wird erst gesetzt,
      // wenn der Timer wirklich feuert (nicht schon beim Planen) – sonst räumt
      // das Doppel-Mount im React-StrictMode den Timer ab, bevor er auslöst,
      // und der zweite Lauf wäre fälschlich durch den Guard blockiert.
      const t = setTimeout(() => {
        startedRef.current = true;
        useStore.getState().startTour();
      }, 450);
      return () => clearTimeout(t);
    }
  }, [authReady, user, tourActive, dialog]);

  /* Position des Zielelements ermitteln und der Oberfläche folgen. */
  const measure = useCallback(() => {
    const s = STEPS[useStore.getState().tourStep];
    if (!s?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${s.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  }, []);

  useEffect(() => {
    if (!tourActive) return;
    measure();
    const onChange = () => {
      measure();
      bumpViewport((n) => n + 1);
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    // Folgt auch dynamischen Layout-Änderungen (z. B. Auswahl-Leiste, Umbruch).
    const id = window.setInterval(measure, 250);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      window.clearInterval(id);
    };
  }, [tourActive, tourStep, measure]);

  /* Basiswert für den interaktiven Platzieren-Schritt beim Betreten merken. */
  useEffect(() => {
    obstacleBaseline.current = useStore.getState().obstacles.length;
  }, [tourStep, tourActive]);

  /* Interaktiver Schritt: weiter, sobald wirklich ein Hindernis platziert wurde. */
  useEffect(() => {
    if (!tourActive || !step?.advanceOnObstacle) return;
    if (obstacleCount > obstacleBaseline.current) {
      const t = setTimeout(() => useStore.getState().nextStep(), 650);
      return () => clearTimeout(t);
    }
  }, [tourActive, tourStep, obstacleCount, step]);

  /* Tastatursteuerung. */
  useEffect(() => {
    if (!tourActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        completeTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        isLast ? completeTour() : nextStep();
      } else if (e.key === "Enter") {
        // Ist ein Button fokussiert, übernimmt dessen onClick – nicht doppelt auslösen.
        if ((document.activeElement as HTMLElement | null)?.tagName === "BUTTON") return;
        e.preventDefault();
        isLast ? completeTour() : nextStep();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!isFirst) prevStep();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourActive, isFirst, isLast, nextStep, prevStep, completeTour]);

  /* Tatsächliche Kartengröße messen, sobald sichtbar. */
  useLayoutEffect(() => {
    if (!tourActive || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    if (Math.abs(r.width - cardSize.width) > 1 || Math.abs(r.height - cardSize.height) > 1) {
      setCardSize({ width: r.width, height: r.height });
    }
  }, [tourActive, tourStep, rect, cardSize.width, cardSize.height]);

  if (!tourActive || !step) return null;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const placed = placeCard(rect, cardSize, viewport, step.placement ?? "bottom");

  const pad = 6;
  const spotlight = rect
    ? {
        left: rect.left - pad,
        top: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        borderRadius: Math.min(18, rect.height / 2 + pad),
      }
    : null;

  const onPrimary = () => (isLast ? completeTour() : nextStep());

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Einführungs-Tour">
      {spotlight ? (
        <div className="tour-spotlight" style={spotlight} />
      ) : (
        <div className="tour-backdrop" />
      )}

      <div
        ref={cardRef}
        className={`tour-card tour-${placed.placement}`}
        style={{ left: placed.left, top: placed.top }}
      >
        {placed.placement !== "center" && (
          <span
            className={`tour-caret tour-caret-${placed.placement}`}
            style={
              placed.placement === "top" || placed.placement === "bottom"
                ? { left: placed.caret }
                : { top: placed.caret }
            }
          />
        )}

        <div className="tour-card-head">
          <span className="tour-step-count">
            Schritt {tourStep + 1} von {STEPS.length}
          </span>
          <button className="mini-btn" onClick={completeTour} aria-label="Tour schließen">
            <Icon name="x" size={13} />
          </button>
        </div>

        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        {step.tryHint && (
          <p className="tour-try">
            <Icon name="zap" size={13} />
            {step.tryHint}
          </p>
        )}

        <div className="tour-dots">
          {STEPS.map((s, i) => (
            <span key={s.id} className={`tour-dot ${i === tourStep ? "on" : ""}`} />
          ))}
        </div>

        <div className="tour-actions">
          {isLast ? (
            <span />
          ) : (
            <button className="tour-skip" onClick={completeTour}>
              Überspringen
            </button>
          )}
          <div className="tour-nav">
            {!isFirst && <button onClick={prevStep}>Zurück</button>}
            <button className="primary" onClick={onPrimary}>
              {isFirst ? "Tour starten" : isLast ? "Fertig" : "Weiter"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
