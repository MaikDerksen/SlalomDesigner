# SlalomDesigner

Streckenplaner für ADAC Kartslalom-Training – Web, iOS und Android (eine Codebasis).
Regelbasis: **Offizielles ADAC Kartslalom Reglement 2026** (§7 Parcoursaufbau, §7.3 Parcoursaufgaben).

## Features

- ⚡ **Zufallsgenerator** – Strecken mit min/max oder exakter Aufgabenzahl, optional mit Zielgasse
- 💾 **Speichern & Laden** – beliebig viele Strecken lokal speichern, wieder öffnen und weiterbearbeiten
- ✋ **Drag & Drop** – alle Hindernis-Modelle (§7.3) aus der rechten Scroll-Leiste auf die Fläche ziehen
- 🧲 **Hindernis = Einheit** – eine Pylone anfassen verschiebt die ganze Aufgabe; Rotation über Griff oder ±15°-Buttons
- 🔴 **Regelprüfung live** – Aufgaben näher als 4 m aneinander oder außerhalb der Fläche werden rot markiert,
  isolierte Aufgaben (> 10 m) gelb; beim Ziehen wird der Abstand zur nächsten Aufgabe eingeblendet
- 📐 **Map Designer** – Fahrfläche cm-genau konfigurieren (z. B. 62,35 × 41,20 m), 1-m-/5-m-Raster
- 🛰 **Map aus Screenshot** – Apple-Maps-/Satelliten-Screenshot hochladen; der Maßstab wird über ein
  bekanntes Objekt bestimmt (Auto antippen → Algorithmus vermisst es per Blob-Segmentierung + PCA,
  oder Linie manuell ziehen), die Fahrfläche wird per Flutfüllung automatisch maskiert und als Polygon
  mit verschiebbaren Punkten editierbar (Punkte hinzufügen/löschen). Sperrzonen für Hindernisse
  (Laternen, Inseln …) lassen sich einzeichnen. Die Map wird unter einem Titel gespeichert; beim
  Generieren dient der Screenshot als Hintergrund, Aufgaben landen nur in der Maske und nie in Sperrzonen
- 🛠 **Eigene Hindernisse** – im Designer Pylonen (stehend/liegend) frei setzen (50-cm-Raster als
  Orientierung, Live-Abstandsanzeige) und als wiederverwendbares Objekt in der Palette speichern
- 🧭 **Fahrlinien-Varianten** – im Designer pro Hindernis optional mehrere Fahrlinien zeichnen
  (Tabs „Linie 1..n"); sind welche vorhanden, nutzt die KI-Route ausschließlich diese und wählt
  die beste Variante/Richtung statt eigener Berechnung. Auch **offizielle Hindernisse sind
  anpassbar**: ✎ in der Palette öffnet sie im Designer (Pylonen + offizielle Fahrlinie vorbefüllt),
  Speichern erzeugt einen Vereins-Override, der das Original in Palette und Generator ersetzt –
  jederzeit per Reset auf das Original zurücksetzbar
- ⚙ **Regeln als Variablen** – alle Reglement-Maße (Abstände, Torbreite, Pylonenmaße …) in den
  Einstellungen änderbar, falls sich das Reglement ändert
- 📖 **Wissensdatenbank** (im Regeln-Dialog) – Schnellübersicht der wichtigsten Reglement-Punkte
  (§7 Aufbau, §7.3 Aufgaben, §9.1 Wertung, Technik) mit den live konfigurierten Werten, das
  Reglement-PDF je Verein (ansehen, herunterladen, durch neue Version ersetzen – wird beim ersten
  Start automatisch hinterlegt) und Link zur offiziellen ADAC-Reglement-Seite
- 📤 **Senden** – erstellt ein PNG des Streckenplans (mit Datum, Maßstab, Legende, Route) und teilt es
  über den System-Share-Dialog (Mobile) bzw. lädt es herunter (Desktop)
- 🛣 **Strecken-Route** – zwei Wege: „Route" berechnet automatisch die Fahrlinie durch alle Aufgaben
  (Richtung je Aufgabe per Optimierung, weiche Übergänge), „Zeichnen" übernimmt eine freihand
  gezeichnete Linie und erkennt daraus Reihenfolge + Einfahrtsseite (Aufgaben werden umnummeriert).
  Kreuzende Wege – im Kartslalom üblich – werden als **Brücke** dargestellt (der später gefahrene
  Abschnitt liegt sichtbar oben) plus Richtungspfeile alle ~6 m, sodass Geradeaus und Abbiegen nie
  verwechselt werden. Kritische Stellen werden markiert: zu enger Kurvenradius am Exit (gegen den
  konfigurierbaren Kart-Wendekreis, §7.1 „mit vollem Lenkeinschlag fahrbar") und Verlassen der
  Fahrfläche/Sperrzonen

## Hinterlegte Reglement-Defaults (konfigurierbar)

| Regel | Wert | Quelle |
| --- | --- | --- |
| Pylonenhöhe | 50 cm ± 3 cm | §7.2 |
| Abstand zwischen Aufgaben | min. 4 m, max. 10 m | §7.2 |
| Lichte Torbreite | Spurbreite (1,25 m) + 40 cm = 1,65 m | §7.2 |
| Pylonenabstand in Gassen | 50 cm | §7.3 |
| Wechseltor-Torabstand | 1,5 – 4 m | §7.3.5 |
| Kreisel | Innen-Ø 10 m, Abstand 1 m, Einfahrt 3 m | §7.3.3 |
| Zielgasse | 2,5 m breit, 8–10 m lang | §7.3.16 |
| Maße | von Fuß zu Fuß der Pylonen | §7.2 |

Alle 17 Aufgabentypen aus §7.3 sind als Vorlagen enthalten: Pylonentor, Einzelpylone, Wechseltor,
Spurgasse (gerade/gebogen), Schweizer Slalom, Kreisel, Wende, Ypsilon, S-Spurgasse, Z-Gasse, Kasten,
Schneckenhaus, Kreuz, Brezel/Knoten, Deutsches Eck, Schikane, Zielgasse.

## Login, Vereine & Datenbank

Die App ist mandantenfähig: Jeder **Verein** hat eigene Maps, Strecken, Hindernisse und
Regel-Einstellungen. Registrierung gründet einen neuen Verein (Ersteller = Admin) oder tritt per
**Einladungscode** einem bestehenden bei. Auth läuft über bcrypt-gehashte Passwörter und ein
JWT im httpOnly-Cookie — **kein localStorage**. Der Arbeitsstand wird als Entwurf automatisch
(debounced) in der Datenbank gesichert und beim nächsten Login wiederhergestellt.

Persistenz: **PostgreSQL 16 im Docker-Container**, Schema in 3. Normalform
([server/schema.sql](server/schema.sql)): `clubs → users`, `club_rules` (Regelwerk als
Schlüssel/Wert je Verein), `maps` mit `map_images`, `map_boundary_points`,
`map_blocked_zones(_points)`, `custom_obstacles(_pylons)`, `tracks` mit
`track_obstacles` und `track_obstacle_pylons` (Pylonen als Schnappschuss, da das Regelwerk
sich ändern kann). Punkte/Pylonen liegen als einzelne Zeilen mit Index vor — keine Arrays/JSON.

**Seed:** Beim ersten Start mit leerer DB wird ein Verein samt Admin angelegt
(`SEED_EMAIL`/`SEED_PASSWORD`, Default `admin@kartslalom.local` / `kart2026`) inkl.
Reglement-Defaults und Standard-Fläche. Bestehende **Browser-Daten der alten Version werden
beim ersten Login automatisch migriert** (POST `/api/import`) und danach aus dem localStorage
entfernt — es geht nichts verloren.

## Entwicklung (Web)

```bash
npm install
npm run db:up    # PostgreSQL im Docker-Container (Port 5433)
npm run server   # API auf http://localhost:3001 (legt Schema an + seedet)
npm run dev      # Frontend auf http://localhost:5173 (proxyt /api)
npm run build    # Produktions-Build nach dist/
```

## Produktion (Docker Compose)

```bash
JWT_SECRET=<zufälliger-wert> docker compose up -d   # db + app (API + Frontend) auf :3001
```

## iOS / Android (Capacitor)

```bash
npm install @capacitor/core @capacitor/cli
npm run build
npx cap add android   # bzw. ios (nur auf macOS)
npx cap sync
npx cap open android  # öffnet Android Studio / Xcode
```

Das Teilen nutzt die Web Share API, die in der Capacitor-WebView und auf modernen mobilen
Browsern den nativen Share-Dialog öffnet. Die mobile App spricht dieselbe API wie das Web.

## Architektur

- **React 18 + TypeScript + Vite** (Frontend), Zustand für State
- **Express 5 + PostgreSQL** ([server/](server/)): Auth (bcrypt + JWT-Cookie), REST-API,
  Schema-Migration und Seed beim Start
- `src/templates.ts` – parametrische Hindernis-Vorlagen: erzeugen die Pylonen-Anordnung aus dem aktuellen Regelwerk
- `src/validation.ts` – Regelprüfung (Fuß-zu-Fuß-Abstände, Flächengrenzen)
- `src/generator.ts` – sequentielle Zufallsplatzierung mit 4–10-m-Kette und Rückweisungs-Sampling
- `src/components/CanvasEditor.tsx` – SVG-Editor in Weltkoordinaten (Meter), Pan/Zoom/Pinch, Drag, Rotation
- `src/export.ts` – PNG-Rendering (Canvas 2D) + Web Share API
