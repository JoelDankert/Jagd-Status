# Server-Releases verwalten

Diese lokale CLI ist ausschließlich für Joel mit `root`/`sudo`-SSH-Zugriff gedacht. Sie besitzt keine HTTP-API und ist unabhängig von App-Accounts.

Auf dem VPS aus `/opt/jagdapp`:

```sh
sudo python3 scripts/release_versions.py list
sudo python3 scripts/release_versions.py show v20260102T030405Z-1234abcd
sudo python3 scripts/release_versions.py snapshot
sudo python3 scripts/release_versions.py revert v20260102T030405Z-1234abcd
```

Snapshots liegen privat (Verzeichnisse `0700`, Dateien `0600`) unter `/opt/jagdapp/data/versions`. Erfasst werden der zur Snapshot-Zeit ausgecheckte Git-Commit (aus `.main.git`, sofern lesbar), Zeitpunkt, Anlass, Dateigrößen und SHA-256-Prüfsummen für `backend/server.js` und `frontend/dist`. Nach einem Runtime-Revert bleibt Git HEAD unverändert; die Prüfsummen und die gewählte Versions-ID identifizieren den tatsächlich wiederhergestellten Code, während Git HEAD dann nicht mehr den aktiven Stand beschreibt.

`revert` erstellt zuerst automatisch einen Sicherheitssnapshot des laufenden Codes. Anschließend werden nur die Runtime-App-Dateien über Staging-Pfade auf demselben Dateisystem ausgetauscht, `jagdapp` neu gestartet und `http://127.0.0.1:3067/` geprüft. Bei Fehler werden die zuvor aktiven App-Dateien zurückgetauscht und der Dienst erneut gestartet. `data/jagdapp.sqlite`, SQLite-Nebendateien und `data/images` werden weder snapshotiert noch überschrieben.

Neue Runtime-Codepfade müssen bewusst zu `RUNTIME_ASSETS` in `scripts/release_versions.py` ergänzt und getestet werden. Abhängigkeiten (`node_modules`) und Konfiguration sind bewusst kein Release-Inhalt.
