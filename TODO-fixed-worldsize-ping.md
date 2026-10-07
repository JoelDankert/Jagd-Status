# TODO: Aktivität-Ping mit fixer Welt-Größe (unabhängig von Zoom)

## Ziel
Ping soll eine feste geographische Fläche abdecken (z.B. ~100m Radius), unabhängig vom Zoom-Level.
Bei Zoom-Stufe 14: ~60px. Bei Zoom 15: ~120px. Bei Zoom 13: ~30px.

## Dateien
- `frontend/src/main.jsx`
  - `markerIcon()` (Zeile ~260): berechnet iconSize, muss Zoom-abhängig werden
  - `MapScreen` (Zeile ~595): muss `mapZoom` State führen und an Marker-Icons weitergeben
  - `MapInit` (Zeile ~585): muss `setMapZoom` auf zoomend aufrufen
  - Aktivität-Marker-Rendering (Zeile ~650): aktuell `<Marker icon={markerIcon(...)}>`
- `frontend/src/styles.css`
  - `.pin.aktivitaet`: muss ggf. overflow:visible setzen

## Gescheiterte Ansätze
1. **CSS `transform: scale(var(--ping-zoom))`**: Skalierung kollidiert mit Leaflets Marker-Positionierung (`translate3d`). Icon springt.
2. **`querySelectorAll` + JS `style.transform`**: Gleiches Problem, springt nach Zoom-Ende.
3. **Dynamisches `iconSize` über React State + `key={id-zoom}`**: React-Leaflets `<Marker>` remountet nicht sauber bei Key-Änderung.
4. **Native `L.marker` + `setIcon()` im `ActivityMarker` Component**: Größe ändert sich nicht (setIcon wird scheinbar nicht korrekt aufgerufen oder Leaflet cached die alte Größe).

## Empfohlener Ansatz (nicht getestet)
- Native Leaflet `L.circle` oder `L.circleMarker` verwenden — diese sind nativ in Metern skaliert
- CSS-Animation auf den Circle via `className` + `@keyframes` anwenden
- Alternativ: React-Overlay-Komponente die bei jedem Zoom/Move `map.latLngToContainerPoint()` berechnet und absolute Divs rendert
