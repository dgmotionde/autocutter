# Auto Cutter

Dieses Repository ist ein clientseitiger "Auto Cutter" Video-Editor, der FFmpeg.wasm und die WebAudio API verwendet.

Änderungen
- Index.html wurde modularisiert: CSS und JavaScript sind in `assets/` ausgelagert.
- Ein dynamischer FFmpeg-Loader (`assets/js/ffmpeg-loader.js`) lädt das UMD-Bundle bei Bedarf und hat ein Fallback-CDN.
- Hauptlogik wurde in `assets/js/app.js` verschoben, Fehlerbehandlung und Statusanzeigen verbessert.

Nutzung
1. Local testen: Starte einen einfachen Webserver im Repo-Root (z. B. `python -m http.server 8080` oder `npx http-server`).
2. Öffne http://localhost:8080 im Browser.
3. Wähle Videos und optional Audio/LUT/Referenzbild, klicke auf "Video mit Auto Cutter generieren".

Hinweise
- FFmpeg.wasm lädt zusätzlich zum UMD-Bundle ein `ffmpeg-core.js` — dies kann je nach Host langsam sein.
- Adblocker/CSP/Netzwerk können das Laden von Unpkg/JsDelivr verhindern. Falls Probleme auftreten, lade die benötigten Dateien lokal oder passe `ffmpeg-loader.js` an.

Verbesserungsmöglichkeiten
- WebWorker-Auslagerung der FFmpeg-Interaktionen für UI-Responsiveness.
- Fortschritt detaillierter auslesen und dem Nutzer visualisieren.
- Optional: Service Worker für Caching großer Artifacts.

