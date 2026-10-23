# Optionale Einführung / Demo

`/tutorial` lädt dieselbe React-`App` wie `/`. Es gibt keine kopierte Karte, keine zweite Formularimplementierung und keine Demo-Zeilen in SQLite. Die kleine Integrationsgrenze besteht aus `frontend/src/runtime.js` sowie den Modulen unter `frontend/src/tutorial/`: Auf der Tutorial-Route werden API, Bildauflösung und Browser-Storage ausgetauscht. Außerhalb dieser expliziten Route bleiben Produktions-Transport, Session-Cookie und bestehende Storage-Keys unverändert.

## Daten- und Sicherheitsgrenze

Der Server stellt anonym ausschließlich `GET`/`HEAD` für `/api/tutorial/seed` und `/api/tutorial/images/:filename` bereit. Der Seed wird aus `${TUTORIAL_DATA_DIR:-/opt/jagdapp/data/tutorial}/seed.json` gelesen; Bilder liegen im Unterordner `images/`. Fehlt oder verletzt der Seed das erwartete Schema, antwortet der Server mit 503. Es gibt absichtlich keinen erfundenen Fallback. Andere Methoden auf diesen Ressourcen enden als JSON-405, unbekannte Tutorial-Pfade als JSON-404 innerhalb des Routers; beides erreicht weder Produktions-CRUD noch den SPA-HTML-Fallback.

Im Browser lädt der Adapter den Seed einmal mit `credentials: "omit"`. Alle gemeinsamen CRUD-Aufrufe, Einstellungen, Archivierung, Löschung und Data-URI-Bilder werden danach nur im Speicher verarbeitet. Unbekannte Endpunkte scheitern geschlossen. Demo-Anzeigepräferenzen verwenden ausschließlich das Präfix `jagd-tutorial:`; Reset löscht nur diesen Namensraum. Logout/Beenden führt nach `/`, ohne `/api/logout` aufzurufen. Standort wird anhand eines Beispielpunkts simuliert und Fullscreen wird nicht angefordert. Das gemeinsame Account-Panel ist verfügbar: Nur der Reviername kann im lokalen Zustand geändert werden, Passwortfelder sind deaktiviert und Löschanfragen werden mit einem Inline-Hinweis abgefangen.

## Snapshot aktualisieren

Die Datenaufbereitung erfolgt außerhalb dieses Repositories. Erwartet werden:

```text
seed.json
images/
  <nur die im Seed referenzierten, bereinigten Basenames>
```

`seed.json` hat die direkte kanonische `/api/map-data`-Form `{revier, settings, role, kanzeln, kameras, abschuesse, schuetzen}`. `revier.name` muss `Durchhausen · Demo` sein. IDs sind ausschließlich Demo-IDs; Notizen und Schützen sind anonymisiert; Zugangsdaten, Auth-/Sessiondaten und Pfade sind verboten. Bildfelder enthalten nur Basenames. Für eine lokale Prüfung kann `TUTORIAL_DATA_DIR=/tmp/jagd-tutorial-seed` gesetzt werden. Der lokale `data/tutorial/`-Pfad ist ebenfalls ignoriert.

Der Snapshot wird bewusst **nicht automatisch** aus einem privaten Revier veröffentlicht. Eine Aktualisierung ist ein separater, geprüfter Export- und Bereinigungsschritt; spätere Änderungen am echten Revier erscheinen nicht von selbst in der Demo.

## Pflege und UX

Die sechs Schritte sind deklarativ in `steps.js` beschrieben. Eine optionale, ausschließlich von `TutorialShell` gesetzte `tutorialBridge` bereitet in derselben `App` die jeweils echte Ansicht vor: Kanzel mit Foto, Kanzelliste, Abschussdetails, Erstellen-Auswahl, Kanzel-Formular und Karteneinstellungen. Sie kopiert keine Oberfläche und ist im normalen Root-Aufruf nicht vorhanden. Vorwärts und zurück schließen unvereinbare Fenster; gelöschte oder fehlende Demo-Objekte und nicht auflösbare Ziele lassen die Tour trotzdem bedienbar.

Der Startdialog setzt den Fokus, hält Tab innerhalb des modalen Dialogs und wechselt mit Escape in die freie Erkundung. Der Guide bleibt absichtlich nichtmodal, damit markierte App-Bedienelemente nutzbar sind; beim Formular kann er minimiert werden. In der freien Erkundung bleibt nur eine kompakte Demo-Steuerung unten links. Sie ist während Willkommen und Guide verborgen. Bewegtes Scrollen wird bei `prefers-reduced-motion` vermieden. Die Gestaltung folgt den NN/g-Grundsätzen zu [Onboarding Tutorials](https://www.nngroup.com/articles/onboarding-tutorials/) und [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

## Prüfung

```bash
node --test scripts/tutorial-adapter.test.mjs scripts/tutorial-routes.test.mjs
npm test
npm run build
```

Für einen lokalen Browsercheck muss ein bereinigter Seed vorhanden sein. Anschließend Backend nur auf Loopback starten, `/tutorial` prüfen und kontrollieren, dass keine mutierenden Requests außerhalb des In-Memory-Adapters erscheinen.

`scripts/tutorial-browser-check.mjs` nutzt eine bereits laufende Chrome-DevTools-Schnittstelle. Der Check erwartet den echten bereinigten Seed (8 Kanzeln, 1 Markierung, 5 Abschüsse), prüft Foto-HTTP-200, Guide-Navigation, lokales Erstellen/Reset, das Demo-Account-Verhalten, Produktions-Storage/Cookie, ausbleibende Produktions-Mutationen sowie Desktop- und 390-px-Layout. Screenshots werden nach `/tmp/jagd-tutorial-*.png` geschrieben.
