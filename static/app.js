const TILE_SIZE = 256;
const state = {
  data: null,
  view: "map",
  listTab: "standorte",
  selected: null,
  settingsOpen: false,
  modal: null,
  map: { lat: 51.1657, lng: 10.4515, zoom: 15 },
  self: null,
  list: { q: "", status: "alle", from: "", to: "" },
  drag: null,
  longPress: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function seasonStart() {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error || "Fehler");
  return json;
}

async function loadData() {
  try {
    state.data = await api("/api/map-data");
    render();
  } catch {
    renderLogin();
  }
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="login">
      <form id="loginForm">
        <h1>Jagd</h1>
        <label>Reviername<input name="name" autocomplete="username" required></label>
        <label>Revierpasswort<input name="passwort" type="password" autocomplete="current-password" required></label>
        <button class="primary" type="submit">Anmelden</button>
        <div class="error">${esc(error)}</div>
      </form>
    </section>
  `;
  $("#loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    try {
      await api("/api/login", { method: "POST", body: { name: form.get("name"), passwort: form.get("passwort") } });
      await loadData();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

function render() {
  if (!state.data) return renderLogin();
  app.innerHTML = `
    <section class="app">
      <header class="topbar">
        <div class="brand">${esc(state.data.revier.name)}</div>
        <div class="segmented">
          <button data-view="map" class="${state.view === "map" ? "active" : ""}">Karte</button>
          <button data-view="list" class="${state.view === "list" ? "active" : ""}">Übersicht</button>
        </div>
        <div class="spacer"></div>
        <button class="icon-btn" data-action="settings" title="Settings">⚙</button>
        <button class="ghost" data-action="logout">Logout</button>
      </header>
      <div class="main">${state.view === "map" ? mapView() : listView()}</div>
      ${state.modal ? modalView() : ""}
    </section>
  `;
  bindCommon();
  state.view === "map" ? bindMap() : bindList();
  if (state.modal) bindModal();
}

function bindCommon() {
  document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => {
    state.view = btn.dataset.view;
    render();
  }));
  $("[data-action=settings]").addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    render();
  });
  $("[data-action=logout]").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.data = null;
    renderLogin();
  });
}

function mapView() {
  return `
    <section class="map-view">
      <div class="map" id="map">
        <div id="tiles"></div>
        <div id="markers"></div>
        ${mapControls()}
        ${state.settingsOpen ? settingsView() : ""}
        ${state.selected ? detailPanel() : ""}
      </div>
    </section>
  `;
}

function mapControls() {
  return `
    <div class="map-tools">
      <button class="icon-btn" data-map="plus" title="Vergrößern">+</button>
      <button class="icon-btn" data-map="minus" title="Verkleinern">−</button>
      <button class="icon-btn" data-map="locate" title="Position">⌖</button>
    </div>
  `;
}

function settingsView() {
  const s = state.data.settings;
  const checked = key => Number(s[key]) ? "checked" : "";
  return `
    <aside class="settings">
      <h2>Settings</h2>
      <div class="settings-grid">
        ${toggle("show_self_location", "Position", checked)}
        ${toggle("show_standorte", "Standorte", checked)}
        ${toggle("show_kanzeln", "Kanzeln", checked)}
        ${toggle("show_abschuesse", "Abschüsse", checked)}
        ${toggle("show_archived", "Archiv", checked)}
        ${toggle("show_reviergrenze", "Grenze", checked)}
      </div>
      <div class="quick-row">
        <button data-range="today">Heute</button>
        <button data-range="7">7 Tage</button>
        <button data-range="month">Monat</button>
        <button data-range="season">Saison</button>
        <button data-range="all">Alle</button>
      </div>
      <div class="date-row">
        <label>Von<input data-setting="map_date_filter_from" type="date" value="${esc(s.map_date_filter_from || "")}"></label>
        <label>Bis<input data-setting="map_date_filter_to" type="date" value="${esc(s.map_date_filter_to || "")}"></label>
      </div>
    </aside>
  `;
}

function toggle(key, label, checked) {
  return `<label class="toggle"><input data-setting="${key}" type="checkbox" ${checked(key)}> ${label}</label>`;
}

function bindMap() {
  const map = $("#map");
  renderTiles();
  renderMarkers();
  $("[data-map=plus]").addEventListener("click", () => setZoom(state.map.zoom + 1));
  $("[data-map=minus]").addEventListener("click", () => setZoom(state.map.zoom - 1));
  $("[data-map=locate]").addEventListener("click", locate);

  map.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openCreate(screenToLatLng(ev.clientX, ev.clientY));
  });
  map.addEventListener("pointerdown", onPointerDown);
  map.addEventListener("pointermove", onPointerMove);
  map.addEventListener("pointerup", onPointerUp);
  map.addEventListener("pointercancel", onPointerUp);
  map.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    setZoom(state.map.zoom + (ev.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  document.querySelectorAll("[data-setting]").forEach(el => el.addEventListener("change", async () => {
    await saveSetting(el.dataset.setting, el.type === "checkbox" ? el.checked : el.value);
  }));
  document.querySelectorAll("[data-range]").forEach(btn => btn.addEventListener("click", () => setDateRange(btn.dataset.range)));
  document.querySelectorAll("[data-select]").forEach(btn => btn.addEventListener("click", () => {
    const [type, id] = btn.dataset.select.split(":");
    state.selected = { type, id };
    render();
  }));
  document.querySelectorAll("[data-action-panel]").forEach(btn => btn.addEventListener("click", () => panelAction(btn.dataset.actionPanel)));
}

function onPointerDown(ev) {
  if (ev.target.closest("button, input, aside, .panel")) return;
  const start = { x: ev.clientX, y: ev.clientY, lat: state.map.lat, lng: state.map.lng, moved: false };
  state.drag = start;
  state.longPress = setTimeout(() => {
    if (!start.moved) {
      state.drag = null;
      openCreate(screenToLatLng(start.x, start.y));
    }
  }, 650);
}

function onPointerMove(ev) {
  if (!state.drag) return;
  const dx = ev.clientX - state.drag.x;
  const dy = ev.clientY - state.drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 8) {
    state.drag.moved = true;
    clearTimeout(state.longPress);
  }
  const center = latLngToWorld(state.drag.lat, state.drag.lng, state.map.zoom);
  const next = worldToLatLng(center.x - dx, center.y - dy, state.map.zoom);
  state.map.lat = next.lat;
  state.map.lng = next.lng;
  renderTiles();
  renderMarkers();
}

function onPointerUp() {
  clearTimeout(state.longPress);
  state.drag = null;
}

function latLngToWorld(lat, lng, zoom) {
  const sin = Math.sin(lat * Math.PI / 180);
  const scale = TILE_SIZE * Math.pow(2, zoom);
  return {
    x: (lng + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function worldToLatLng(x, y, zoom) {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const lng = x / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / scale;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function screenToLatLng(clientX, clientY) {
  const rect = $("#map").getBoundingClientRect();
  const center = latLngToWorld(state.map.lat, state.map.lng, state.map.zoom);
  return worldToLatLng(center.x + clientX - rect.left - rect.width / 2, center.y + clientY - rect.top - rect.height / 2, state.map.zoom);
}

function latLngToScreen(lat, lng) {
  const rect = $("#map").getBoundingClientRect();
  const center = latLngToWorld(state.map.lat, state.map.lng, state.map.zoom);
  const point = latLngToWorld(lat, lng, state.map.zoom);
  return { x: point.x - center.x + rect.width / 2, y: point.y - center.y + rect.height / 2 };
}

function renderTiles() {
  const map = $("#map");
  const root = $("#tiles");
  if (!map || !root) return;
  const rect = map.getBoundingClientRect();
  let html = "";
  for (let x = 24; x < rect.width; x += 192) {
    const pos = screenToLatLng(rect.left + x, rect.top + 24);
    html += `<div class="grid-label" style="left:${x}px;top:24px">${pos.lng.toFixed(4)}</div>`;
  }
  for (let y = 72; y < rect.height; y += 160) {
    const pos = screenToLatLng(rect.left + 24, rect.top + y);
    html += `<div class="grid-label" style="left:24px;top:${y}px">${pos.lat.toFixed(4)}</div>`;
  }
  root.innerHTML = html;
}

function visibleActive(item) {
  return Number(state.data.settings.show_archived) || item.status !== "archiviert";
}

function dateVisible(item) {
  const from = state.data.settings.map_date_filter_from;
  const to = state.data.settings.map_date_filter_to;
  return (!from || item.datum >= from) && (!to || item.datum <= to);
}

function renderMarkers() {
  const root = $("#markers");
  if (!root) return;
  const s = state.data.settings;
  let html = "";
  if (Number(s.show_standorte)) {
    state.data.standorte.filter(visibleActive).forEach(item => html += markerHtml("standort", item, item.position_lat, item.position_lng, "S"));
  }
  if (Number(s.show_kanzeln)) {
    state.data.kanzeln.filter(visibleActive).forEach(item => {
      const standort = byId("standorte", item.standort_id);
      if (standort && visibleActive(standort)) html += markerHtml("kanzel", item, standort.position_lat, standort.position_lng, "K");
    });
  }
  if (Number(s.show_abschuesse)) {
    state.data.abschuesse.filter(item => visibleActive(item) && dateVisible(item)).forEach(item => {
      html += markerHtml("abschuss", item, item.position_lat, item.position_lng, "A");
    });
  }
  if (state.self && Number(s.show_self_location)) {
    const p = latLngToScreen(state.self.lat, state.self.lng);
    html += `<div class="self-dot" style="left:${p.x}px;top:${p.y}px"></div>`;
  }
  root.innerHTML = html;
}

function markerHtml(type, item, lat, lng, label) {
  const p = latLngToScreen(Number(lat), Number(lng));
  const archived = item.status === "archiviert" ? " archived" : "";
  return `<button class="marker ${type}${archived}" data-select="${type}:${item.id}" style="left:${p.x}px;top:${p.y}px" title="${esc(item.name || item.wildart)}"><span>${label}</span></button>`;
}

function setZoom(zoom) {
  state.map.zoom = Math.max(3, Math.min(19, zoom));
  renderTiles();
  renderMarkers();
}

function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    state.self = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    state.map.lat = state.self.lat;
    state.map.lng = state.self.lng;
    renderTiles();
    renderMarkers();
  });
}

async function saveSetting(key, value) {
  await api("/api/settings", { method: "POST", body: { [key]: value } });
  await loadData();
}

async function setDateRange(range) {
  const body = {};
  if (range === "today") Object.assign(body, { map_date_filter_from: today(), map_date_filter_to: today() });
  if (range === "7") Object.assign(body, { map_date_filter_from: addDays(-6), map_date_filter_to: today() });
  if (range === "month") Object.assign(body, { map_date_filter_from: monthStart(), map_date_filter_to: today() });
  if (range === "season") Object.assign(body, { map_date_filter_from: seasonStart(), map_date_filter_to: today() });
  if (range === "all") Object.assign(body, { map_date_filter_from: "", map_date_filter_to: "" });
  await api("/api/settings", { method: "POST", body });
  await loadData();
}

function openCreate(pos, preset = null) {
  state.modal = { kind: "choice", pos, preset };
  render();
}

function selectedStandortId() {
  if (state.selected?.type === "standort") return state.selected.id;
  if (state.selected?.type === "kanzel") return byId("kanzeln", state.selected.id)?.standort_id || "";
  return "";
}

function modalView() {
  if (state.modal.kind === "choice") {
    const standortId = selectedStandortId();
    return `
      <div class="overlay">
        <div class="modal">
          <h2>Erstellen</h2>
          <div class="choice-grid">
            <button class="ghost" data-create="standort">Standort</button>
            <button class="ghost" data-create="abschuss">Abschuss</button>
            ${standortId ? `<button class="ghost" data-create="kanzel">Kanzel</button><button class="ghost" data-create="abschuss-standort">Abschuss am Standort</button>` : ""}
          </div>
          <div class="modal-actions"><button class="ghost" data-close>Schließen</button></div>
        </div>
      </div>
    `;
  }
  return formModal();
}

function formModal() {
  const m = state.modal;
  const standortId = m.standortId || selectedStandortId();
  const pos = m.pos;
  if (m.kind === "standort") {
    return modalShell("Standort", `
      <label>Name<input name="name" required></label>
      <textarea name="notiz" placeholder="Notiz"></textarea>
    `);
  }
  if (m.kind === "kanzel") {
    return modalShell("Kanzel", `
      <label>Standort${standortSelect(standortId, true)}</label>
      <label>Name<input name="name" required></label>
      <label>Typ<input name="typ" placeholder="fahrbar"></label>
      <textarea name="notiz" placeholder="Notiz"></textarea>
    `);
  }
  return modalShell("Abschuss", `
    <div class="two">
      <label>Datum<input name="datum" type="date" value="${today()}" required></label>
      <label>Wildart<input name="wildart" required></label>
    </div>
    <label>Schütze<input name="schuetz_name" required></label>
    <label>Standort${standortSelect(standortId, false)}</label>
    <label>Kanzel<select name="kanzel_id"><option value="">Keine</option>${state.data.kanzeln.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></label>
    <textarea name="notiz" placeholder="Notiz"></textarea>
    <input type="hidden" name="position_lat" value="${pos.lat}">
    <input type="hidden" name="position_lng" value="${pos.lng}">
  `);
}

function modalShell(title, fields) {
  return `
    <div class="overlay">
      <form class="modal form-grid" id="modalForm">
        <h2>${title}</h2>
        ${fields}
        <div class="error"></div>
        <div class="modal-actions">
          <button class="ghost" type="button" data-close>Abbrechen</button>
          <button class="primary" type="submit">Speichern</button>
        </div>
      </form>
    </div>
  `;
}

function standortSelect(selected = "", required = false) {
  const req = required ? "required" : "";
  return `<select name="standort_id" ${req}><option value="">Keiner</option>${state.data.standorte.filter(visibleActive).map(s => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>`;
}

function bindModal() {
  document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => {
    state.modal = null;
    render();
  }));
  document.querySelectorAll("[data-create]").forEach(btn => btn.addEventListener("click", () => {
    const type = btn.dataset.create;
    state.modal = {
      kind: type === "abschuss-standort" ? "abschuss" : type,
      pos: state.modal.pos,
      standortId: selectedStandortId(),
    };
    render();
  }));
  const form = $("#modalForm");
  if (form) form.addEventListener("submit", submitModal);
}

async function submitModal(ev) {
  ev.preventDefault();
  const form = new FormData(ev.currentTarget);
  const body = Object.fromEntries(form.entries());
  const kind = state.modal.kind;
  if (kind === "standort") {
    body.position_lat = state.modal.pos.lat;
    body.position_lng = state.modal.pos.lng;
  }
  try {
    const endpoint = kind === "standort" ? "/api/standorte" : kind === "kanzel" ? "/api/kanzeln" : "/api/abschuesse";
    await api(endpoint, { method: "POST", body });
    state.modal = null;
    await loadData();
  } catch (err) {
    $(".modal .error").textContent = err.message;
  }
}

function detailPanel() {
  const obj = selectedObject();
  if (!obj) return "";
  const className = state.settingsOpen ? "panel with-settings" : "panel";
  if (state.selected.type === "standort") return standortPanel(obj, className);
  if (state.selected.type === "kanzel") return kanzelPanel(obj, className);
  return abschussPanel(obj, className);
}

function standortPanel(item, className) {
  const kanzeln = state.data.kanzeln.filter(k => k.standort_id === item.id && visibleActive(k));
  const abschuesse = state.data.abschuesse.filter(a => a.standort_id === item.id && visibleActive(a));
  return `
    <aside class="${className}">
      ${panelHead(item.name)}
      <div class="meta">${statusText(item)}</div>
      <div class="kv"><div><span>Position</span><span>${fmtPos(item.position_lat, item.position_lng)}</span></div></div>
      ${item.notiz ? `<p>${esc(item.notiz)}</p>` : ""}
      <div class="actions">
        <button class="ghost" data-action-panel="add-kanzel">Kanzel</button>
        <button class="ghost" data-action-panel="add-abschuss">Abschuss</button>
        <button class="danger" data-action-panel="archive">${item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button>
      </div>
      ${sublist("Kanzeln", kanzeln, k => `${esc(k.name)} · ${esc(k.typ || "Typ offen")}`)}
      ${sublist("Abschüsse", abschuesse, a => `${esc(a.datum)} · ${esc(a.wildart)}`)}
    </aside>
  `;
}

function kanzelPanel(item, className) {
  const standort = byId("standorte", item.standort_id);
  return `
    <aside class="${className}">
      ${panelHead(item.name)}
      <div class="meta">${statusText(item)}</div>
      <div class="kv">
        <div><span>Typ</span><span>${esc(item.typ || "offen")}</span></div>
        <div><span>Standort</span><span>${esc(standort?.name || "-")}</span></div>
      </div>
      ${item.notiz ? `<p>${esc(item.notiz)}</p>` : ""}
      <div class="actions"><button class="danger" data-action-panel="archive">${item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button></div>
    </aside>
  `;
}

function abschussPanel(item, className) {
  const standort = item.standort_id ? byId("standorte", item.standort_id) : null;
  const kanzel = item.kanzel_id ? byId("kanzeln", item.kanzel_id) : null;
  return `
    <aside class="${className}">
      ${panelHead(item.wildart)}
      <div class="meta">${statusText(item)}</div>
      <div class="kv">
        <div><span>Datum</span><span>${esc(item.datum)}</span></div>
        <div><span>Schütze</span><span>${esc(item.schuetz_name)}</span></div>
        <div><span>Standort</span><span>${esc(standort?.name || "-")}</span></div>
        <div><span>Kanzel</span><span>${esc(kanzel?.name || "-")}</span></div>
      </div>
      ${item.notiz ? `<p>${esc(item.notiz)}</p>` : ""}
      <div class="actions"><button class="danger" data-action-panel="archive">${item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button></div>
    </aside>
  `;
}

function panelHead(title) {
  return `<div class="panel-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action-panel="close" title="Schließen">×</button></div>`;
}

function sublist(title, items, renderItem) {
  if (!items.length) return "";
  return `<div class="sublist"><h3>${title}</h3>${items.map(i => `<div class="subitem">${renderItem(i)}</div>`).join("")}</div>`;
}

function statusText(item) {
  return item.status === "archiviert" ? "Archiviert" : "Aktiv";
}

function fmtPos(lat, lng) {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function selectedObject() {
  if (!state.selected) return null;
  const key = state.selected.type === "standort" ? "standorte" : state.selected.type === "kanzel" ? "kanzeln" : "abschuesse";
  return byId(key, state.selected.id);
}

function byId(key, id) {
  return state.data[key].find(item => item.id === id);
}

async function panelAction(action) {
  const obj = selectedObject();
  if (!obj) return;
  if (action === "close") {
    state.selected = null;
    render();
    return;
  }
  if (action === "add-kanzel") {
    openCreate({ lat: obj.position_lat, lng: obj.position_lng }, "kanzel");
    state.modal = { kind: "kanzel", pos: { lat: obj.position_lat, lng: obj.position_lng }, standortId: obj.id };
    render();
    return;
  }
  if (action === "add-abschuss") {
    state.modal = { kind: "abschuss", pos: { lat: obj.position_lat, lng: obj.position_lng }, standortId: obj.id };
    render();
    return;
  }
  if (action === "archive") {
    const endpoint = state.selected.type === "standort" ? "standorte" : state.selected.type === "kanzel" ? "kanzeln" : "abschuesse";
    await api(`/api/${endpoint}/${obj.id}`, { method: "PATCH", body: { status: obj.status === "archiviert" ? "aktiv" : "archiviert" } });
    await loadData();
  }
}

function listView() {
  const tabs = ["standorte", "kanzeln", "abschuesse"];
  return `
    <section class="list-view">
      <div class="list-shell">
        <div class="segmented">${tabs.map(t => `<button data-tab="${t}" class="${state.listTab === t ? "active" : ""}">${labelPlural(t)}</button>`).join("")}</div>
        <div class="filters">
          <input data-list="q" placeholder="Suchen" value="${esc(state.list.q)}">
          <select data-list="status">
            <option value="alle" ${state.list.status === "alle" ? "selected" : ""}>Alle</option>
            <option value="aktiv" ${state.list.status === "aktiv" ? "selected" : ""}>Aktiv</option>
            <option value="archiviert" ${state.list.status === "archiviert" ? "selected" : ""}>Archiviert</option>
          </select>
          <input data-list="from" type="date" value="${esc(state.list.from)}">
          <input data-list="to" type="date" value="${esc(state.list.to)}">
        </div>
        <div class="list">${listItems()}</div>
      </div>
    </section>
  `;
}

function bindList() {
  document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
    state.listTab = btn.dataset.tab;
    render();
  }));
  document.querySelectorAll("[data-list]").forEach(el => el.addEventListener("input", () => {
    state.list[el.dataset.list] = el.value;
    render();
  }));
  document.querySelectorAll("[data-open]").forEach(btn => btn.addEventListener("click", () => {
    const [type, id] = btn.dataset.open.split(":");
    const obj = byId(type === "standort" ? "standorte" : type === "kanzel" ? "kanzeln" : "abschuesse", id);
    const pos = type === "abschuss" ? { lat: obj.position_lat, lng: obj.position_lng } : type === "kanzel" ? byId("standorte", obj.standort_id) : obj;
    if (pos) {
      state.map.lat = Number(pos.position_lat || pos.lat);
      state.map.lng = Number(pos.position_lng || pos.lng);
    }
    state.selected = { type, id };
    state.view = "map";
    render();
  }));
}

function labelPlural(key) {
  return key === "standorte" ? "Standorte" : key === "kanzeln" ? "Kanzeln" : "Abschüsse";
}

function listItems() {
  const q = state.list.q.toLowerCase().trim();
  const status = state.list.status;
  const items = state.data[state.listTab].filter(item => {
    const hay = JSON.stringify(item).toLowerCase();
    const statusOk = status === "alle" || item.status === status;
    const dateOk = state.listTab !== "abschuesse" || ((!state.list.from || item.datum >= state.list.from) && (!state.list.to || item.datum <= state.list.to));
    return statusOk && dateOk && (!q || hay.includes(q));
  });
  if (!items.length) return `<div class="muted">Keine Einträge</div>`;
  return items.map(item => {
    const type = state.listTab === "standorte" ? "standort" : state.listTab === "kanzeln" ? "kanzel" : "abschuss";
    const title = item.name || item.wildart;
    const meta = type === "abschuss" ? `${item.datum} · ${item.schuetz_name}` : type === "kanzel" ? `${item.typ || "Typ offen"} · ${standortName(item.standort_id)}` : fmtPos(item.position_lat, item.position_lng);
    return `
      <div class="row-card">
        <div><strong>${esc(title)}</strong><span class="muted">${esc(meta)} · ${statusText(item)}</span></div>
        <button class="ghost" data-open="${type}:${item.id}">Karte</button>
      </div>
    `;
  }).join("");
}

function standortName(id) {
  return byId("standorte", id)?.name || "-";
}

window.addEventListener("resize", () => {
  if (state.view === "map") {
    renderTiles();
    renderMarkers();
  }
});

setInterval(() => {
  if (state.data) loadData();
}, 20000);

loadData();
