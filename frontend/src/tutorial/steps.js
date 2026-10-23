export const TUTORIAL_STEPS = [
  {
    action: "showKanzel",
    target: "[data-tour='kanzel-detail']",
    title: "Eine echte Kanzel öffnen",
    text: "Fotos, Bauart, Notiz und Position stehen gemeinsam in der Detailansicht.",
    placement: "detail",
  },
  {
    action: "showKanzelList",
    target: ".list-screen .rows",
    title: "Kanzeln als Liste vergleichen",
    text: "Hier kannst du Kanzeln suchen, filtern und direkt auf der Karte anzeigen.",
    placement: "list",
  },
  {
    action: "showAbschuss",
    target: "[data-tour='abschuss-detail']",
    title: "Einen Abschuss nachvollziehen",
    text: "Datum, Schütze, Wetter, Entfernung und Bilder stehen in einer Ansicht.",
    placement: "detail",
  },
  {
    action: "showCreate",
    target: ".create-choices",
    title: "Am Ort erfassen",
    text: "Doppelklick oder langes Drücken öffnet am gewählten Ort diese Auswahl.",
    placement: "overlay",
  },
  {
    action: "showCreateForm",
    target: "[data-tour='object-form']",
    title: "Eine Kanzel selbst anlegen",
    text: "Du kannst die Kanzel speichern; sie bleibt ausschließlich in dieser lokalen Demo.",
    placement: "overlay",
  },
  {
    action: "showSettings",
    target: "[data-tour='settings-panel']",
    title: "Die Karte passend einstellen",
    text: "Hier steuerst du sichtbare Ebenen, archivierte Einträge und den Zeitraum.",
    placement: "overlay",
  },
];
