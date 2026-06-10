# Kart Slalom Planner

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
- 🛠 **Eigene Hindernisse** – im Designer Pylonen (stehend/liegend) auf 5-cm-Raster setzen und als
  wiederverwendbares Objekt in der Palette speichern
- ⚙ **Regeln als Variablen** – alle Reglement-Maße (Abstände, Torbreite, Pylonenmaße …) in den
  Einstellungen änderbar, falls sich das Reglement ändert
- 📤 **Senden** – erstellt ein PNG des Streckenplans (mit Datum, Maßstab, Legende) und teilt es über
  den System-Share-Dialog (Mobile) bzw. lädt es herunter (Desktop)

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

## Entwicklung (Web)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Produktions-Build nach dist/
```

## iOS / Android (Capacitor)

```bash
npm install @capacitor/core @capacitor/cli
npm run build
npx cap add android   # bzw. ios (nur auf macOS)
npx cap sync
npx cap open android  # öffnet Android Studio / Xcode
```

Die App ist eine reine Client-App ohne Backend: Strecken, eigene Hindernisse und Regel-Einstellungen
liegen im lokalen Speicher des Geräts. Das Teilen nutzt die Web Share API, die in der Capacitor-WebView
und auf modernen mobilen Browsern den nativen Share-Dialog öffnet.

## Architektur

- **React 18 + TypeScript + Vite**, Zustand für State, kein Backend
- `src/templates.ts` – parametrische Hindernis-Vorlagen: erzeugen die Pylonen-Anordnung aus dem aktuellen Regelwerk
- `src/validation.ts` – Regelprüfung (Fuß-zu-Fuß-Abstände, Flächengrenzen)
- `src/generator.ts` – sequentielle Zufallsplatzierung mit 4–10-m-Kette und Rückweisungs-Sampling
- `src/components/CanvasEditor.tsx` – SVG-Editor in Weltkoordinaten (Meter), Pan/Zoom/Pinch, Drag, Rotation
- `src/export.ts` – PNG-Rendering (Canvas 2D) + Web Share API
