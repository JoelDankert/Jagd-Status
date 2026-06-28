import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Layers, List, LocateFixed, Map as MapIcon, Settings, Trash2, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import "./styles.css";

let LAST_ZOOM = 14;

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(res.ok ? `Unerwartete Antwort: ${text.slice(0, 120)}` : `Fehler ${res.status}`);
  }
  if (!res.ok) throw new Error(json.error || "Fehler");
  return json;
};

const today = () => new Date().toISOString().slice(0, 10);

const DURCHHAUSEN_CENTER = [48.0392, 8.6747];
const IMAGE_MAX_ZOOM = 8;
const MAX_PULSE_BPM = 150;
const MIN_PULSE_BPM = 20;

function currentTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateTimeValue(datum, uhrzeit) {
  return uhrzeit ? `${datum || today()}T${uhrzeit}` : "";
}

function splitDateTime(value) {
  if (!value) return { datum: today(), uhrzeit: "" };
  const [datum, uhrzeit = ""] = String(value || "").split("T");
  return { datum: datum || today(), uhrzeit };
}

function hourKey(datum, uhrzeit) {
  const [hour = "00", minute = "0"] = String(uhrzeit || "00:00").split(":");
  const rounded = Math.min(23, Math.max(0, Number(hour) + (Number(minute) >= 30 ? 1 : 0)));
  return `${datum || today()}T${String(rounded).padStart(2, "0")}:00`;
}

const WILDARTEN = [
  "Rehwild",
  "Rotwild",
  "Damwild",
  "Schwarzwild",
  "Fuchs",
  "Hase",
  "Ente",
  "Gans",
  "Taube",
  "Sonstiges",
];

const WILDART_KLASSEN = {
  Reh: "wild-rehwild",
  Bock: "wild-rehwild",
  Schmalreh: "wild-rehwild",
  Kitz: "wild-rehwild",
  Rehwild: "wild-rehwild",
  Rotwild: "wild-rotwild",
  Damwild: "wild-damwild",
  Schwarzwild: "wild-schwarzwild",
  Fuchs: "wild-fuchs",
  Hase: "wild-hase",
  Ente: "wild-ente",
  Gans: "wild-gans",
  Taube: "wild-taube",
  Sonstiges: "wild-sonstiges",
};

const MARKER_TYPEN = ["Wildkamera", "Kirrung", "Salzlecke", "Futterstelle", "Wasserstelle", "Suhle", "Sonstiges"];

const KANZEL_TYPEN = ["Hochsitz", "Ansitzkanzel", "Ansitzleiter", "Drückjagdstand", "Schlafkanzel", "Fahrbare Kanzel", "Bodensitz", "Sonstiges"];

const MARKER_FARBE = {
  Wildkamera: "#2e7d32",
  Kirrung: "#ad6a18",
  Salzlecke: "#8c8c8c",
  Futterstelle: "#9e7d27",
  Wasserstelle: "#1a6d8a",
  Suhle: "#5d4037",
  Sonstiges: "#c2185b",
};

const WETTER_CODES = {
  0: "klar",
  1: "überwiegend klar",
  2: "leicht bewölkt",
  3: "bewölkt",
  45: "Nebel",
  48: "Reifnebel",
  51: "leichter Niesel",
  53: "Niesel",
  55: "starker Niesel",
  61: "leichter Regen",
  63: "Regen",
  65: "starker Regen",
  71: "leichter Schnee",
  73: "Schnee",
  75: "starker Schnee",
  80: "leichter Schauer",
  81: "Schauer",
  82: "starker Schauer",
  95: "Gewitter",
};

function windDirection(degrees) {
  if (!Number.isFinite(Number(degrees))) return "";
  const directions = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return directions[Math.round(Number(degrees) / 45) % 8];
}

function formatWind(item) {
  const speed = item?.wind_speed_kmh !== null && item?.wind_speed_kmh !== undefined && item?.wind_speed_kmh !== "" ? `${item.wind_speed_kmh}km/h` : "";
  return [item?.wind_richtung, speed].filter(Boolean).join(", ");
}

function imageSrc(value) {
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  return `/api/images/${value}`;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1280;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return resolve(String(reader.result || ""));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.onerror = () => resolve(String(reader.result || ""));
      image.src = String(reader.result || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function weatherFromHourly(hourly, datum, uhrzeit) {
  const times = hourly?.time || [];
  if (!times.length) return null;
  const wanted = hourKey(datum, uhrzeit);
  let index = times.indexOf(wanted);
  if (index < 0) {
    index = times.reduce((best, time, current) => (
      Math.abs(new Date(time) - new Date(wanted)) < Math.abs(new Date(times[best]) - new Date(wanted)) ? current : best
    ), 0);
  }
  const temp = Number.isFinite(Number(hourly.temperature_2m?.[index])) ? `${Math.round(Number(hourly.temperature_2m[index]))}°C` : "";
  const weather = WETTER_CODES[hourly.weather_code?.[index]] || "";
  const windSpeed = Number.isFinite(Number(hourly.wind_speed_10m?.[index])) ? `${Math.round(Number(hourly.wind_speed_10m[index]))}km/h` : "";
  const windDir = windDirection(hourly.wind_direction_10m?.[index]);
  return {
    wetter: [temp, weather].filter(Boolean).join(", "),
    wind: [windDir, windSpeed].filter(Boolean).join(", "),
  };
}

async function autofillWeather(point, datum = today(), uhrzeit = currentTime()) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const selectedDate = datum || today();
  const isPast = selectedDate < today();
  const endpoint = isPast ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: selectedDate,
    end_date: selectedDate,
    hourly: "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "kmh",
    timezone: "auto",
  });
  const response = await fetch(`${endpoint}?${params}`);
  if (!response.ok) return null;
  return weatherFromHourly((await response.json()).hourly, selectedDate, uhrzeit);
}

function geschlechtValue(value) {
  if (value === "m") return "männlich";
  if (value === "w") return "weiblich";
  return value || "";
}

function markerLetter(value, fallback) {
  const letters = String(value || "")
    .trim()
    .split(" ")
    .map((part) => part.match(/[\p{L}\p{N}]/u)?.[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return letters || fallback;
}

function shotPulseTiming(item) {
  if (!item || item.status === "archiviert") return null;
  const date = String(item.datum || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = /^\d{2}:\d{2}$/.test(String(item.uhrzeit || "")) ? item.uhrzeit : "18:00";
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  const shotTime = new Date(year, month - 1, day, hour, minute).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const age = Math.max(0, Date.now() - shotTime);
  if (age > dayMs) return null;
  const progress = age / dayMs;
  const bpm = MIN_PULSE_BPM + (MAX_PULSE_BPM - MIN_PULSE_BPM) * Math.pow(1 - progress, 1.25);
  const beatMs = Math.round(60000 / bpm);
  return {
    cycleMs: beatMs + 180,
    lifeMs: 1040,
  };
}

const markerIcon = (type, item = null, archived = false, pulse = null) => {
  const kameraSize = archived ? 9 : 12;
  const otherSize = archived ? 18 : 25;
  const size = type === "kamera" ? kameraSize : otherSize;
  const pulseName = pulse ? `shot-pulse-${String(item?.id || "x").replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  const pulseCount = 8;
  const loopMs = pulse ? pulse.cycleMs * pulseCount : 0;
  const pulseEnd = pulse ? Math.min(92, Math.max(4, Math.round((pulse.lifeMs / loopMs) * 1000) / 10)) : 0;
  const pulsePeak = pulse ? Math.min(4, Math.max(1.5, Math.round(pulseEnd * 0.18 * 10) / 10)) : 0;
  const pulseStyle = pulse ? `<style>@keyframes ${pulseName}{0%{opacity:0;transform:scale(.7)}${pulsePeak}%{opacity:1;transform:scale(.75)}${pulseEnd}%{opacity:0;transform:scale(3.5)}100%{opacity:0;transform:scale(3.5)}}</style>` : "";
  const pulseHtml = pulse ? `${pulseStyle}${Array.from({ length: pulseCount }, (_, index) => {
    const start = index * pulse.cycleMs;
    return `<i class="pin-pulse" style="animation:${pulseName} ${loopMs}ms linear infinite;animation-delay:${start}ms"></i>`;
  }).join("")}` : "";
  const markerColor = type === "kamera" && item?.typ ? (MARKER_FARBE[item.typ] || "#546e7a") : "";
  const styleAttr = markerColor ? `--pin-bg:${markerColor}` : "";
  return L.divIcon({
    className: `pin ${type} ${type === "abschuss" ? WILDART_KLASSEN[item?.wildart] || "wild-sonstiges" : ""} ${archived ? "is-archived" : ""}`,
    html: `${pulseHtml}<span style="${styleAttr}">${type === "kanzel" ? markerLetter(item?.name, "K") : type === "kamera" ? "" : markerLetter(item?.wildart, "A")}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const originIcon = L.divIcon({
  className: "origin-pin",
  html: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function localId() {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestFullscreen() {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}

function useLongPressClear(clear) {
  const timer = useRef(null);
  const start = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(clear, 650);
  };
  const stop = () => clearTimeout(timer.current);
  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  };
}

function App() {
  const [data, setData] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("jagd-theme") || "light");
  const [loginError, setLoginError] = useState("");
  const [view, setView] = useState("map");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [createAt, setCreateAt] = useState(null);
  const [form, setForm] = useState(null);
  const [originPick, setOriginPick] = useState(null);
  const [selfPos, setSelfPos] = useState(null);
  const [listTab, setListTab] = useState("kanzeln");
  const [filters, setFilters] = useState({ q: "", showArchived: true, from: "", to: "" });
  const [accountOpen, setAccountOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [mapLayer, setMapLayer] = useState(() => localStorage.getItem("jagd-layer") || "sat");

  const load = async () => setData(await api("/api/map-data"));

  useEffect(() => {
    load().catch(() => setData(null));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("jagd-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("jagd-layer", mapLayer);
  }, [mapLayer]);

  useEffect(() => {
    if (!data) return undefined;
    const timer = setInterval(() => load().catch(() => {}), 20000);
    return () => clearInterval(timer);
  }, [data]);

  const activeSelected = selected ? findObject(data, selected) : null;

  const closeWindows = () => {
    setSettingsOpen(false);
    setSelected(null);
    setCreateAt(null);
    setForm(null);
    setOriginPick(null);
    setAccountOpen(false);
  };

  const isViewer = data?.role === "viewer";

  const showView = (next) => {
    closeWindows();
    setView(next);
  };

  const openSettings = () => {
    const next = !settingsOpen;
    closeWindows();
    setSettingsOpen(next);
  };

  const openSelection = (next) => {
    setSettingsOpen(false);
    setCreateAt(null);
    setForm(null);
    setOriginPick(null);
    setSelected(next);
  };

  const openCreate = (point) => {
    setSettingsOpen(false);
    setSelected(null);
    setForm(null);
    setOriginPick(null);
    setCreateAt(point);
  };

  const openForm = (next) => {
    setSettingsOpen(false);
    setSelected(null);
    setCreateAt(null);
    setOriginPick(null);
    setForm(next);
  };

  if (!data) return <Login error={loginError} onLogin={async (body) => {
    try {
      await api("/api/login", { method: "POST", body });
      setLoginError("");
      localStorage.setItem("jagd-credentials", JSON.stringify(body));
      await load();
    } catch (error) {
      localStorage.removeItem("jagd-credentials");
      setLoginError(error.message);
    }
  }} />;

  return (
    <div className="app" onPointerDown={requestFullscreen} onClick={requestFullscreen}>
      <header className="top">
        <strong>{data.revier.name}</strong>
        <nav className="tabs">
          <button className={view === "map" ? "active" : ""} onClick={() => showView("map")}><MapIcon size={17} />Karte</button>
          <button className={view === "list" ? "active" : ""} onClick={() => showView("list")}><List size={17} />Liste</button>
        </nav>
        <HeaderMenu onLogout={async () => { await api("/api/logout", { method: "POST" }); localStorage.removeItem("jagd-credentials"); setData(null); }} onAccount={() => { closeWindows(); setAccountOpen(true); }} isViewer={isViewer} theme={theme} setTheme={setTheme} />
      </header>

      {view === "map" ? (
        <MapScreen
          data={data}
          selected={selected}
          openSelection={openSelection}
          openCreate={isViewer ? () => {} : openCreate}
          originPick={originPick}
          setOriginPick={setOriginPick}
          selfPos={selfPos}
          setSelfPos={setSelfPos}
          openSettings={openSettings}
          isViewer={isViewer}
          mapLayer={mapLayer}
          setMapLayer={setMapLayer}
        />
      ) : (
        <ListScreen data={data} tab={listTab} setTab={setListTab} filters={filters} setFilters={setFilters} setView={setView} openSelection={openSelection} load={load} setConfirmAction={setConfirmAction} />
      )}

      {settingsOpen && !originPick && <SettingsPanel data={data} load={load} close={() => setSettingsOpen(false)} isViewer={isViewer} />}
      {activeSelected && !originPick && <DetailPanel data={data} selected={selected} item={activeSelected} close={() => setSelected(null)} load={load} openForm={isViewer ? () => {} : openForm} isViewer={isViewer} setConfirmAction={setConfirmAction} />}
      {createAt && !isViewer && <CreateWindow point={createAt} close={() => setCreateAt(null)} openForm={openForm} />}
      {form && !isViewer && <ObjectForm key={formKey(form)} data={data} form={form} originPick={originPick} setOriginPick={setOriginPick} close={() => { setForm(null); setOriginPick(null); }} load={async () => { await load(); setForm(null); setOriginPick(null); }} />}

      {accountOpen && <AccountPanel data={data} load={load} close={() => setAccountOpen(false)} setConfirmAction={setConfirmAction} />}
      {confirmAction && <ConfirmDialog message={confirmAction.message} hint={confirmAction.hint} onConfirm={() => { confirmAction.action(); setConfirmAction(null); }} onCancel={() => setConfirmAction(null)} />}

    </div>
  );
}

function Login({ error, onLogin }) {
  const [name, setName] = useState("");
  const [passwort, setPasswort] = useState("");
  const [loading, setLoading] = useState(true);
  const tried = useRef(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin({ name, passwort });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const saved = (() => { try { return JSON.parse(localStorage.getItem("jagd-credentials")); } catch { return null; } })();
    if (saved?.name && saved?.passwort) {
      setName(saved.name);
      setPasswort(saved.passwort);
      onLogin({ name: saved.name, passwort: saved.passwort })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);
  return (
    <main className="login">
      <form onSubmit={submit}>
        <div className="login-head">
          <span className="login-badge">{name.charAt(0).toUpperCase() || "J"}</span>
          <h1>{name || "Jagd"}</h1>
          <p>Revierverwaltung</p>
        </div>
        <label>Reviername<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" placeholder="Name des Reviers" disabled={loading} /></label>
        <label>Revierpasswort<input value={passwort} onChange={(e) => setPasswort(e.target.value)} type="password" autoComplete="current-password" placeholder="Passwort" disabled={loading} /></label>
        <button className={`primary ${loading ? "is-loading" : ""}`} type="submit" disabled={loading}>Anmelden</button>
        <p className="error">{error}</p>
      </form>
    </main>
  );
}

function HeaderMenu({ onLogout, onAccount, isViewer, theme, setTheme }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="header-menu">
      <button type="button" className="quiet" ref={btnRef} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>...</button>
      {open ? createPortal((
        <div className="header-dropdown" style={{ position: "fixed", top: (btnRef.current?.getBoundingClientRect().bottom ?? 0) + 4, right: window.innerWidth - (btnRef.current?.getBoundingClientRect().right ?? 0) }}>
          <button type="button" onClick={() => { setOpen(false); setTheme(theme === "light" ? "dark" : "light"); }}>{theme === "light" ? "Dunkel" : "Hell"}</button>
          {!isViewer ? <button type="button" onClick={() => { setOpen(false); onAccount(); }}>Account</button> : null}
          <button type="button" onClick={() => { setOpen(false); onLogout(); }}>Abmelden</button>
        </div>
      ), document.body) : null}
    </div>
  );
}

function AccountPanel({ data, load, close, setConfirmAction }) {
  const [name, setName] = useState(data.revier.name);
  const [passwort, setPasswort] = useState("••••••••");
  const [viewerPasswort, setViewerPasswort] = useState(data.revier.has_viewer_passwort ? "••••••••" : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const viewerTouched = useRef(false);
  const adminTouched = useRef(false);
  const submit = () => {
    setSaving(true);
    setError("");
    const body = { name };
    if (adminTouched.current && passwort) body.passwort = passwort;
    if (viewerTouched.current) body.viewer_passwort = viewerPasswort;
    api("/api/revier", { method: "PATCH", body })
      .then(() => { load(); close(); })
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  };
  return (
    <div className="overlay">
      <form className="modal small" onSubmit={(e) => { e.preventDefault(); setConfirmAction({ message: "Account-Daten ändern?", action: submit }); }}>
        <header><h2>Account-Daten ändern</h2><button type="button" onClick={close}><X size={18} /></button></header>
        <label>Reviername<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Revierpasswort<input type="password" value={passwort} onChange={(e) => { setPasswort(e.target.value); adminTouched.current = true; }} /></label>
        <label>Gast-Passwort<input type="password" value={viewerPasswort} onChange={(e) => { setViewerPasswort(e.target.value); viewerTouched.current = true; }} /></label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className={`primary ${saving ? "is-loading" : ""}`} disabled={saving}>Speichern</button>
      </form>
    </div>
  );
}

function ConfirmDialog({ message, hint, onConfirm, onCancel }) {
  return (
    <div className="overlay">
      <section className="modal small">
        <header><h2>Bestätigen</h2></header>
        <p className="confirm-text">{hint ? `${message} ${hint}` : message}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>Abbrechen</button>
          <button type="button" className="primary" onClick={onConfirm}>Ja</button>
        </div>
      </section>
    </div>
  );
}

function MapInit({ center, mapLayer }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!done.current) {
      done.current = true;
      map.setView(center, LAST_ZOOM, { animate: false });
    }
    const onZoom = () => { LAST_ZOOM = map.getZoom(); };
    map.on("zoomend", onZoom);
    return () => map.off("zoomend", onZoom);
  }, []);
  useEffect(() => {
    if (!done.current) return;
    const timer = setTimeout(() => {
      const z = map.getZoom();
      map.invalidateSize({ animate: false });
      map.setZoom(z === 22 ? z - 1 : z + 1, { animate: false });
      requestAnimationFrame(() => map.setZoom(z, { animate: false }));
    }, 80);
    return () => clearTimeout(timer);
  }, [mapLayer]);
  return null;
}

function MapScreen({ data, selected, openSelection, openCreate, originPick, setOriginPick, selfPos, setSelfPos, openSettings, isViewer, mapLayer, setMapLayer }) {
  const visible = useVisibleData(data);
  const center = markerCenter([...visible.kanzeln, ...visible.kameras, ...visible.abschuesse]);
  const toggleLayer = () => setMapLayer(mapLayer === "osm" ? "sat" : "osm");
  return (
    <main className="map-shell" data-layer={mapLayer}>
      <MapContainer zoomControl={false} zoomSnap={0} zoomDelta={0.25} wheelPxPerZoomLevel={90} maxZoom={22} className="map">
        <MapInit center={center} mapLayer={mapLayer} />
        {mapLayer === "osm" ? (
          <TileLayer key="osm" attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={22} />
        ) : (
          <TileLayer key="sat" attribution="&copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={21} maxZoom={22} />
        )}
        <MapEvents openCreate={openCreate} originPick={originPick} setOriginPick={setOriginPick} />
        <MapTools setSelfPos={setSelfPos} />
        <FlyToSelection data={data} selected={selected} />
        {visible.abschuesse.map((abschuss) => <ShotLine key={`line-${abschuss.id}`} abschuss={abschuss} data={data} />)}
        {originPick ? <PickTarget originPick={originPick} /> : null}
        {Number(data.settings.show_kanzeln) ? visible.kanzeln.map((kanzel) => (
          <Marker
            key={kanzel.id}
            position={[kanzel.position_lat, kanzel.position_lng]}
            icon={markerIcon("kanzel", kanzel, kanzel.status === "archiviert")}
            eventHandlers={{
              click: (event) => {
                if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
                if (originPick) setOriginPick({ ...originPick, origin: { type: "kanzel", id: kanzel.id, lat: kanzel.position_lat, lng: kanzel.position_lng } });
                else openSelection({ type: "kanzel", id: kanzel.id });
              },
            }}
          />
        )) : null}
        {Number(data.settings.show_kameras) ? visible.kameras.map((kamera) => (
          <Marker
            key={kamera.id}
            position={[kamera.position_lat, kamera.position_lng]}
            icon={markerIcon("kamera", kamera, kamera.status === "archiviert")}
            eventHandlers={{
              click: (event) => {
                if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
                openSelection({ type: "kamera", id: kamera.id });
              },
            }}
          />
        )) : null}
        {Number(data.settings.show_abschuesse) ? visible.abschuesse.map((abschuss) => (
          <Marker
            key={abschuss.id}
            position={[abschuss.position_lat, abschuss.position_lng]}
            icon={markerIcon("abschuss", abschuss, abschuss.status === "archiviert", shotPulseTiming(abschuss))}
            eventHandlers={{ click: () => openSelection({ type: "abschuss", id: abschuss.id }) }}
          />
        )) : null}
        {originPick?.origin?.lat ? <Marker position={[originPick.origin.lat, originPick.origin.lng]} icon={originIcon} /> : null}
        {selfPos && Number(data.settings.show_self_location) ? <Marker position={selfPos} icon={L.divIcon({ className: "self-marker", html: "", iconSize: [18, 18], iconAnchor: [9, 9] })} /> : null}
      </MapContainer>
      <div className="map-top-right">
        <button className="icon-button" type="button" onClick={openSettings} title="Einstellungen"><Settings size={18} /></button>
        <button className="icon-button" type="button" onClick={toggleLayer} title={mapLayer === "osm" ? "Satellit" : "Karte"}><MapIcon size={18} /></button>
      </div>
    </main>
  );
}

function MapEvents({ openCreate, originPick, setOriginPick }) {
  const timer = useRef(null);
  const setOrigin = (next) => {
    setOriginPick({ ...originPick, origin: { type: "point", lat: next.lat, lng: next.lng } });
  };
  useMapEvents({
    contextmenu(e) {
      if (originPick) setOrigin(e.latlng);
      else openCreate(e.latlng);
    },
    click(e) {
      if (originPick) setOrigin(e.latlng);
    },
    mousedown(e) {
      if (originPick) return;
      timer.current = setTimeout(() => openCreate(e.latlng), 700);
    },
    mouseup() {
      clearTimeout(timer.current);
    },
    dragstart() {
      clearTimeout(timer.current);
    },
    zoomstart() {
      clearTimeout(timer.current);
    },
  });
  return null;
}

function MapTools({ setSelfPos }) {
  const map = useMap();
  const ref = useRef(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current);
    L.DomEvent.disableScrollPropagation(ref.current);
  }, []);
  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(""), 4500);
    return () => clearTimeout(timer);
  }, [error]);
  const locate = () => {
    setError("");
    if (!navigator.geolocation) {
      setError("Position nicht verfügbar");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const next = [p.coords.latitude, p.coords.longitude];
        setSelfPos(next);
        map.flyTo(next, Math.max(map.getZoom(), 16));
        setLocating(false);
      },
      (err) => {
        const blocked = !window.isSecureContext || /secure|https|http/i.test(err.message || "");
        setError(blocked ? "Position nur über HTTPS" : err.code === 1 ? "Erlaubnis fehlt" : "Position nicht gefunden");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  };
  return (
    <div className="map-tools" ref={ref}>
      <button type="button" onClick={() => map.zoomIn()} title="Vergrößern">+</button>
      <button type="button" onClick={() => map.zoomOut()} title="Verkleinern">-</button>
      <button type="button" onClick={locate} title="Position" className={locating ? "loading" : ""}><LocateFixed size={17} /></button>
      {locating ? <span className="map-status">Sucht...</span> : null}
      {error ? <button type="button" className="map-status error-status" onClick={() => setError("")}>{error}</button> : null}
    </div>
  );
}

function ShotLine({ abschuss, data }) {
  const origin = shotOrigin(abschuss, data);
  if (!origin) return null;
  const target = pointOf(abschuss);
  return <Polyline positions={[[origin.lat, origin.lng], [target.lat, target.lng]]} pathOptions={{ color: "#8f2f2f", weight: 3, opacity: 1, dashArray: "7 7", lineCap: "round" }} />;
}

function PickTarget({ originPick }) {
  const target = originPick.target;
  const origin = originPick.origin;
  return (
    <>
      <Marker position={[target.lat, target.lng]} icon={markerIcon("abschuss")} />
      {origin ? <Polyline positions={[[Number(origin.lat), Number(origin.lng)], [Number(target.lat), Number(target.lng)]]} pathOptions={{ color: "#8f2f2f", weight: 3, opacity: 1, dashArray: "7 7", lineCap: "round" }} /> : null}
    </>
  );
}

function FlyToSelection({ data, selected }) {
  const map = useMap();
  useEffect(() => {
    const item = findObject(data, selected);
    if (!item) return;
    const size = map.getSize();
    const target = map.latLngToContainerPoint([item.position_lat, item.position_lng]);
    const center = map.containerPointToLatLng([target.x, target.y + size.y / 4]);
    map.setView(center, map.getZoom(), { animate: false });
  }, [selected?.id]);
  return null;
}

function SettingsPanel({ data, load, close }) {
  const [local, setLocal] = useState({ ...data.settings });
  const [saving, setSaving] = useState(false);
  const s = data.settings;
  const dirty = Object.keys(local).some((k) => local[k] !== s[k]);
  const apply = async () => {
    setSaving(true);
    try {
      const body = {};
      for (const key of Object.keys(local)) {
        if (local[key] !== s[key]) body[key] = local[key];
      }
      if (Object.keys(body).length) await api("/api/settings", { method: "POST", body });
      await load();
      close();
    } catch {
      await load().catch(() => {});
      setSaving(false);
    }
  };
  const toggle = (key) => setLocal((prev) => ({ ...prev, [key]: prev[key] ? 0 : 1 }));
  const clearFrom = useLongPressClear(() => { setLocal((prev) => ({ ...prev, map_date_filter_from: "" })); });
  const clearTo = useLongPressClear(() => { setLocal((prev) => ({ ...prev, map_date_filter_to: "" })); });
  return (
    <div className="overlay">
      <section className="modal small">
        <header><h2><Layers size={18} /> Einstellungen</h2><button type="button" onClick={close}><X size={18} /></button></header>
        {[
          ["show_self_location", "Eigene Position"],
          ["show_kanzeln", "Kanzeln"],
          ["show_kameras", "Kameras"],
          ["show_abschuesse", "Abschüsse"],
          ["show_archived", "Archivierte"],
        ].map(([key, label]) => <label className="check setting-row" key={key}><input type="checkbox" disabled={saving} checked={Boolean(Number(local[key]))} onChange={() => toggle(key)} />{label}</label>)}
        <div className="two">
          <label>Von<input type="date" disabled={saving} value={local.map_date_filter_from || ""} onChange={(e) => setLocal((prev) => ({ ...prev, map_date_filter_from: e.target.value }))} {...clearFrom} /></label>
          <label>Bis<input type="date" disabled={saving} value={local.map_date_filter_to || ""} onChange={(e) => setLocal((prev) => ({ ...prev, map_date_filter_to: e.target.value }))} {...clearTo} /></label>
        </div>
        <button className={`primary ${saving ? "is-loading" : ""}`} type="button" disabled={!dirty || saving} onClick={apply}>
          {saving ? "Speichert" : "Übernehmen"}
        </button>
      </section>
    </div>
  );
}

function CreateWindow({ point, close, openForm }) {
  return (
    <div className="overlay">
      <section className="modal small">
        <header><h2>Erstellen</h2><button type="button" onClick={close}><X size={18} /></button></header>
        <div className="two">
          <button type="button" className="choice" onClick={() => openForm({ type: "kanzel", point })}>Kanzel</button>
          <button type="button" className="choice" onClick={() => openForm({ type: "kamera", point })}>Markierung</button>
        </div>
        <button type="button" className="choice" onClick={() => openForm({ type: "abschuss", point })}>Abschuss</button>
      </section>
    </div>
  );
}

function initialFormValues(form) {
  const item = form.item || {};
  if (form.type === "kanzel") {
    const typ = item.typ || "";
    const isBuiltin = KANZEL_TYPEN.includes(typ);
    return {
      name: item.name || "",
      typ: isBuiltin ? typ : (typ ? "Sonstiges" : ""),
      typ_sonstiges: isBuiltin ? "" : (typ || ""),
      bild_data: item.bild_data || "",
      bild2: item.bild2 || "",
      bild3: item.bild3 || "",
      notiz: item.notiz || "",
    };
  }
  if (form.type === "kamera") {
    const typ = item.typ || "";
    const isBuiltin = MARKER_TYPEN.includes(typ);
    return {
      name: item.name || "",
      typ: isBuiltin ? typ : (typ ? "Sonstiges" : ""),
      typ_sonstiges: isBuiltin ? "" : (typ || ""),
      bild_data: item.bild_data || "",
      bild2: item.bild2 || "",
      bild3: item.bild3 || "",
      notiz: item.notiz || "",
    };
  }
  const wildart = item.wildart || "";
  const isBuiltinWild = WILDARTEN.includes(wildart);
  return {
    datum: item.datum || today(),
    uhrzeit: item.uhrzeit || (form.item ? "" : currentTime()),
    wildart: isBuiltinWild ? wildart : (wildart ? "Sonstiges" : ""),
    wildart_sonstiges: isBuiltinWild ? "" : (wildart || ""),
    geschlecht: geschlechtValue(item.geschlecht),
    alter_text: item.alter_text || "",
    schuetz_name: item.schuetz_name || "",
    gewicht_kg: item.gewicht_kg ?? "",
    wetter: item.wetter || "",
    wind: item.wind || formatWind(item),
    schuss_lat: item.schuss_lat ?? "",
    schuss_lng: item.schuss_lng ?? "",
    schuss_kanzel_id: item.schuss_kanzel_id || "",
    bild_data: item.bild_data || "",
    bild2: item.bild2 || "",
    bild3: item.bild3 || "",
    notiz: item.notiz || "",
  };
}

function initialOriginLabel(item) {
  if (!item) return "";
  if (item.schuss_lat !== null && item.schuss_lng !== null && item.schuss_lat !== undefined && item.schuss_lng !== undefined) return "Punkt gewählt";
  return "";
}

function ObjectForm({ data, form, originPick, setOriginPick, close, load }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState("");
  const [imageLoading, setImageLoading] = useState(null);
  const formId = useRef(form.id || localId()).current;
  const datePickerRef = useRef(null);
  const timePickerRef = useRef(null);
  const [originLabel, setOriginLabel] = useState(() => initialOriginLabel(form.item));
  const [values, setValues] = useState(() => initialFormValues(form));
  const [selectedKanzelId, setSelectedKanzelId] = useState(() => {
    if (!form.item) return "";
    return form.item.schuss_kanzel_id || "";
  });
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const setImage = async (index, file) => {
    if (!file) return;
    setImageLoading(index);
    try {
      const key = index === 0 ? "bild_data" : `bild${index + 1}`;
      set(key, await readImage(file));
    } finally {
      setImageLoading(null);
    }
  };
  const clearImage = (index) => {
    const key = index === 0 ? "bild_data" : `bild${index + 1}`;
    set(key, "");
  };
  const origin = originPick?.formId === formId ? originPick.origin : null;
  const picking = originPick?.formId === formId && !originPick.origin;
  const editing = form.mode === "edit";
  const fillWeather = (target) => {
    if (form.type !== "abschuss") return;
    setWeatherLoading(target);
    autofillWeather(form.point, values.datum || today(), values.uhrzeit || currentTime())
      .then((next) => {
        if (!next) return;
        setValues((current) => ({
          ...current,
          ...(target === "wetter" ? { wetter: next.wetter } : {}),
          ...(target === "wind" ? { wind: next.wind } : {}),
        }));
      })
      .catch(() => {})
      .finally(() => setWeatherLoading(""));
  };
  const openNativePicker = (input) => {
    if (!input) return;
    try {
      if (input.showPicker) input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  };
  const activateTimePicker = () => {
    if (!timePickerRef.current) return;
    timePickerRef.current.value = "";
    openNativePicker(timePickerRef.current);
  };
  useEffect(() => {
    if (!origin) return;
    setOriginLabel("Punkt gewählt");
    setValues((current) => ({
      ...current,
      schuss_lat: origin.lat ?? "",
      schuss_lng: origin.lng ?? "",
      schuss_kanzel_id: "",
    }));
    setOriginPick(null);
  }, [origin?.lat, origin?.lng, origin?.id, origin?.type, setOriginPick]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = { ...values, kanzel_id: "", schuss_kanzel_id: "", position_lat: form.point.lat, position_lng: form.point.lng };
      if (body.typ === "Sonstiges" && body.typ_sonstiges) body.typ = body.typ_sonstiges;
      delete body.typ_sonstiges;
      if (body.wildart === "Sonstiges" && body.wildart_sonstiges) body.wildart = body.wildart_sonstiges;
      delete body.wildart_sonstiges;
      const path = form.type === "kanzel" ? "/api/kanzeln" : form.type === "kamera" ? "/api/kameras" : "/api/abschuesse";
      await api(editing ? `${path}/${form.item.id}` : path, { method: editing ? "PATCH" : "POST", body });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`overlay ${picking ? "is-picking" : ""}`}>
      <form className="modal" onSubmit={submit}>
        <header><h2>{form.type === "kanzel" ? "Kanzel" : form.type === "kamera" ? "Markierung" : "Abschuss"}{editing ? " bearbeiten" : ""}</h2><button type="button" onClick={close}><X size={18} /></button></header>
        <ImageSlots images={[values.bild_data, values.bild2, values.bild3]} setImage={setImage} clearImage={clearImage} loading={imageLoading} />
        {form.type === "kanzel" || form.type === "kamera" ? (
          <>
            <label>Name<input required value={values.name} onChange={(e) => set("name", e.target.value)} /></label>
            {form.type === "kamera" ? (
              <>
                <label>Typ<select value={values.typ} onChange={(e) => set("typ", e.target.value)}><option value="">Auswählen</option>{MARKER_TYPEN.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                {values.typ === "Sonstiges" ? <label><input value={values.typ_sonstiges || ""} onChange={(e) => set("typ_sonstiges", e.target.value)} placeholder="Eintippen" /></label> : null}
              </>
            ) : (
              <>
                <label>Typ<select value={values.typ} onChange={(e) => set("typ", e.target.value)}><option value="">Auswählen</option>{KANZEL_TYPEN.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                {values.typ === "Sonstiges" ? <label><input value={values.typ_sonstiges || ""} onChange={(e) => set("typ_sonstiges", e.target.value)} placeholder="Eintippen" /></label> : null}
              </>
            )}
            <label>Bemerkungen<textarea value={values.notiz} onChange={(e) => set("notiz", e.target.value)} /></label>
          </>
        ) : (
          <>
            <label>Wildart<select required value={values.wildart} onChange={(e) => set("wildart", e.target.value)}><option value="">Auswählen</option>{WILDARTEN.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
            {values.wildart === "Sonstiges" ? <label><input value={values.wildart_sonstiges || ""} onChange={(e) => set("wildart_sonstiges", e.target.value)} placeholder="Eintippen" /></label> : null}
            <label>Geschlecht<select value={values.geschlecht} onChange={(e) => set("geschlecht", e.target.value)}><option value="">offen</option><option value="männlich">männlich</option><option value="weiblich">weiblich</option></select></label>
            <label>Alter (Jahre)<input inputMode="decimal" value={values.alter_text} onChange={(e) => set("alter_text", e.target.value)} /></label>
            <label>Gewicht (kg)<input inputMode="decimal" value={values.gewicht_kg} onChange={(e) => set("gewicht_kg", e.target.value)} /></label>
            <label>Zeitpunkt<span className="native-date-time date-time-split">
              <span className="date-time-pair">
                <button type="button" className="date-time-trigger" onClick={() => {
                  if (datePickerRef.current) datePickerRef.current.value = values.datum || today();
                  openNativePicker(datePickerRef.current);
                }}>{values.datum || today()}</button>
                <input ref={datePickerRef} className="native-picker" type="date" onChange={(e) => set("datum", e.target.value)} />
              </span>
              <span className="date-time-pair">
                <button type="button" className="date-time-trigger" onContextMenu={(e) => { e.preventDefault(); set("uhrzeit", ""); }} onClick={() => activateTimePicker()}>{values.uhrzeit || "--:--"}</button>
                <input ref={timePickerRef} className="native-picker" type="time" onChange={(e) => set("uhrzeit", e.target.value)} />
              </span>
            </span></label>
            <label>Schütze<input list="schuetzen" value={values.schuetz_name} onChange={(e) => set("schuetz_name", e.target.value)} /></label>
            <datalist id="schuetzen">{data.schuetzen.map((name) => <option key={name} value={name} />)}</datalist>
            <label>Wetter<span className="field-with-button"><input value={values.wetter} onChange={(e) => set("wetter", e.target.value)} /><button type="button" disabled={weatherLoading === "wetter"} className={`image-remove autofill-button ${weatherLoading === "wetter" ? "is-loading" : ""}`} onClick={() => fillWeather("wetter")} aria-label="Wetter automatisch füllen">A</button></span></label>
            <label>Wind<span className="field-with-button"><input value={values.wind} onChange={(e) => set("wind", e.target.value)} /><button type="button" disabled={weatherLoading === "wind"} className={`image-remove autofill-button ${weatherLoading === "wind" ? "is-loading" : ""}`} onClick={() => fillWeather("wind")} aria-label="Wind automatisch füllen">A</button></span></label>
            <label>Schussort<select value={selectedKanzelId} onChange={(e) => {
              const id = e.target.value;
              setSelectedKanzelId(id);
              const kanzel = data.kanzeln.find((item) => item.id === id);
              if (!kanzel) return;
              setValues((current) => ({
                ...current,
                schuss_lat: kanzel.position_lat,
                schuss_lng: kanzel.position_lng,
                schuss_kanzel_id: "",
              }));
              setOriginLabel("Punkt gewählt");
            }}><option value="">Kanzel</option>{data.kanzeln.map((kanzel) => <option key={kanzel.id} value={kanzel.id}>{kanzel.name}</option>)}</select></label>
            <div className="origin-row">
              {originLabel === "Punkt gewählt" ? (
                <button type="button" className="origin-remove" onClick={() => {
                  setValues((current) => ({ ...current, schuss_lat: "", schuss_lng: "", schuss_kanzel_id: "" }));
                  setOriginLabel("");
                  setSelectedKanzelId("");
                }}><Trash2 size={16} /></button>
              ) : (
                <button type="button" onClick={() => setOriginPick({ formId, target: form.point, origin: null })}>Schussursprung frei wählen</button>
              )}
            </div>
            <label>Bemerkungen<textarea value={values.notiz} onChange={(e) => set("notiz", e.target.value)} /></label>
          </>
        )}
        <p className="error">{error}</p>
        <button className={`primary ${saving ? "is-loading" : ""}`} type="submit" disabled={saving}>{saving ? "Speichert" : "Speichern"}</button>
      </form>
    </div>
  );
}

function ImageSlots({ images, setImage, clearImage, loading }) {
  return (
    <div className="image-slots">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`image-slot ${images[i] ? "filled" : ""} ${loading === i ? "loading" : ""}`}>
          {images[i] ? (
            <button type="button" className="image-remove" onClick={() => clearImage(i)} aria-label="Bild entfernen"><Trash2 size={16} /></button>
          ) : (
            <label className={`upload-button ${loading === i ? "is-loading" : ""}`}>
              {loading === i ? "Lädt" : <>+ Bild {i + 1}</>}
              <input type="file" accept="image/*" disabled={loading === i} onChange={(e) => setImage(i, e.target.files?.[0])} />
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

function DetailPanel({ data, selected, item, close, load, openForm, isViewer, setConfirmAction }) {
  const [imageOpen, setImageOpen] = useState(false);
  const [imageIdx, setImageIdx] = useState(0);
  const [actionLoading, setActionLoading] = useState("");
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const frameRef = useRef(null);
  const pinchRef = useRef(null);
  const dragRef = useRef(null);
  const applyImageTransform = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (!imageRef.current) return;
      const { scale, x, y } = transformRef.current;
      imageRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    });
  };
  const setImageTransform = (next) => {
    transformRef.current = next.scale <= 1 ? { scale: 1, x: 0, y: 0 } : next;
    applyImageTransform();
  };
  const stageCenter = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const zoomImageAt = (clientX, clientY, nextScale, base = transformRef.current, basePoint = { x: clientX, y: clientY }) => {
    const scale = Math.min(IMAGE_MAX_ZOOM, Math.max(1, nextScale));
    const center = stageCenter();
    const startX = basePoint.x - center.x;
    const startY = basePoint.y - center.y;
    const focalX = clientX - center.x;
    const focalY = clientY - center.y;
    const ratio = scale / base.scale;
    setImageTransform({
      scale,
      x: focalX - ratio * (startX - base.x),
      y: focalY - ratio * (startY - base.y),
    });
  };
  const openImage = () => {
    transformRef.current = { scale: 1, x: 0, y: 0 };
    setImageOpen(true);
  };
  const startImageDrag = (clientX, clientY) => {
    if (transformRef.current.scale <= 1) return;
    dragRef.current = { clientX, clientY, x: transformRef.current.x, y: transformRef.current.y };
  };
  const moveImageDrag = (clientX, clientY) => {
    if (!dragRef.current) return;
    setImageTransform({
      scale: transformRef.current.scale,
      x: dragRef.current.x + clientX - dragRef.current.clientX,
      y: dragRef.current.y + clientY - dragRef.current.clientY,
    });
  };
  const setPinchZoom = (event) => {
    if (event.touches.length !== 2 || !pinchRef.current) return;
    event.preventDefault();
    const [a, b] = event.touches;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const midpoint = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    const next = pinchRef.current.base.scale * (distance / pinchRef.current.distance);
    zoomImageAt(midpoint.x, midpoint.y, next, pinchRef.current.base, pinchRef.current.midpoint);
  };
  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);
  const archive = async () => {
    setActionLoading("archive");
    try {
      await api(`/api/${apiName(selected.type)}/${item.id}`, { method: "PATCH", body: { status: item.status === "archiviert" ? "aktiv" : "archiviert" } });
      await load();
    } finally {
      setActionLoading("");
    }
  };
  const del = async () => {
    setActionLoading("delete");
    try {
      await api(`/api/${apiName(selected.type)}/${item.id}`, { method: "DELETE" });
      close();
      await load();
    } finally {
      setActionLoading("");
    }
  };
  const detailImages = [item.bild_data, item.bild2, item.bild3].map(imageSrc).filter(Boolean);
  return (
    <aside className="detail">
      <header>
        <div className="detail-title">
          {detailImages.length ? (
            <div className="detail-thumbs">
              {detailImages.map((src, i) => (
                <button key={i} type="button" className="image-thumb" onClick={() => { transformRef.current = { scale: 1, x: 0, y: 0 }; setImageIdx(i); setImageOpen(true); }}><img src={src} alt="" /></button>
              ))}
            </div>
          ) : null}
          <div className="detail-heading">
            <h2>{item.name || item.wildart}</h2>
            {item.status === "archiviert" ? <p className="muted">Archiviert</p> : null}
          </div>
        </div>
        <button type="button" onClick={close}><X size={18} /></button>
      </header>
      <Rows selected={selected} item={item} data={data} />
      {item.notiz ? <p>{item.notiz}</p> : null}
      {!isViewer ? (
        <div className="actions">
          <button type="button" disabled={Boolean(actionLoading)} onClick={() => openForm({ type: selected.type, mode: "edit", item, point: { lat: item.position_lat, lng: item.position_lng } })}>Bearbeiten</button>
          <button type="button" disabled={Boolean(actionLoading)} className={actionLoading === "archive" ? "is-loading" : ""} onClick={archive}>{item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button>
          <button type="button" disabled={Boolean(actionLoading)} className={`danger ${actionLoading === "delete" ? "is-loading" : ""}`} onClick={() => setConfirmAction({ message: "Sicher, dass du löschen willst?", hint: "Oft ist es besser, das Element zu archivieren.", action: del })}><Trash2 size={16} />Löschen</button>
        </div>
      ) : null}
      {imageOpen ? createPortal((
        <div className="image-lightbox" onClick={() => setImageOpen(false)}>
          <button type="button" className="image-close" onClick={() => setImageOpen(false)} aria-label="Schließen"><X size={20} /></button>
          <div
            className="image-stage"
            ref={stageRef}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => {
              event.preventDefault();
              zoomImageAt(event.clientX, event.clientY, transformRef.current.scale + (event.deltaY < 0 ? 0.45 : -0.45));
            }}
            onDoubleClick={(event) => {
              if (transformRef.current.scale > 1) setImageTransform({ scale: 1, x: 0, y: 0 });
              else zoomImageAt(event.clientX, event.clientY, 2);
            }}
            onMouseDown={(event) => startImageDrag(event.clientX, event.clientY)}
            onMouseMove={(event) => moveImageDrag(event.clientX, event.clientY)}
            onMouseUp={() => {
              dragRef.current = null;
            }}
            onMouseLeave={() => {
              dragRef.current = null;
            }}
            onTouchStart={(event) => {
              if (event.touches.length === 1) {
                startImageDrag(event.touches[0].clientX, event.touches[0].clientY);
                return;
              }
              if (event.touches.length !== 2) return;
              const [a, b] = event.touches;
              dragRef.current = null;
              const midpoint = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
              pinchRef.current = {
                distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                midpoint,
                base: { ...transformRef.current },
              };
            }}
            onTouchMove={(event) => {
              if (event.touches.length === 2) {
                setPinchZoom(event);
                return;
              }
              if (event.touches.length === 1 && dragRef.current) {
                event.preventDefault();
                moveImageDrag(event.touches[0].clientX, event.touches[0].clientY);
              }
            }}
            onTouchEnd={() => {
              pinchRef.current = null;
              dragRef.current = null;
            }}
          >
            <img ref={imageRef} src={detailImages[imageIdx]} alt="" style={{ transform: "translate3d(0, 0, 0) scale(1)" }} />
          </div>
        </div>
      ), document.body) : null}
    </aside>
  );
}

function Rows({ selected, item, data }) {
  const origin = selected.type === "abschuss" ? shotOrigin(item, data) : null;
  const distance = selected.type === "abschuss" ? shotDistance(item, data) : null;
  const windText = item.wind || formatWind(item);
  if (selected.type === "abschuss") {
    return (
      <dl>
        {geschlechtValue(item.geschlecht) ? <><dt>Geschlecht</dt><dd>{geschlechtValue(item.geschlecht)}</dd></> : null}
        {item.alter_text ? <><dt>Alter</dt><dd>{item.alter_text} Jahre</dd></> : null}
        {item.gewicht_kg !== null && item.gewicht_kg !== undefined ? <><dt>Gewicht</dt><dd>{item.gewicht_kg} kg</dd></> : null}
        {item.datum ? <><dt>Zeitpunkt</dt><dd>{dateTimeText(item)}</dd></> : null}
        {item.schuetz_name ? <><dt>Schütze</dt><dd>{item.schuetz_name}</dd></> : null}
        {item.wetter ? <><dt>Wetter</dt><dd>{item.wetter}</dd></> : null}
        {windText ? <><dt>Wind</dt><dd>{windText}</dd></> : null}
        {origin ? <><dt>Schuss</dt><dd>{origin.lat.toFixed(5)}, {origin.lng.toFixed(5)} ({distance} m)</dd></> : null}
        <dt>Position</dt><dd>{positionText(item)}</dd>
      </dl>
    );
  }
  return <dl><dt>Name</dt><dd>{item.name}</dd>{item.typ ? <><dt>Typ</dt><dd>{item.typ}</dd></> : null}<dt>Position</dt><dd>{positionText(item)}</dd></dl>;
}

function ListScreen({ data, tab, setTab, filters, setFilters, setView, openSelection, load, setConfirmAction }) {
  const clearFrom = useLongPressClear(() => setFilters((current) => ({ ...current, from: "" })));
  const clearTo = useLongPressClear(() => setFilters((current) => ({ ...current, to: "" })));
  const items = data[tab]
    .filter((item) => {
      const q = filters.q.toLowerCase();
      const statusOk = filters.showArchived || item.status !== "archiviert";
      const dateOk = tab !== "abschuesse" || ((!filters.from || item.datum >= filters.from) && (!filters.to || item.datum <= filters.to));
      return statusOk && dateOk && (!q || JSON.stringify(item).toLowerCase().includes(q));
    })
    .sort((a, b) => tab === "abschuesse"
      ? compareAbschuss(b, a)
      : String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" }));
  return (
    <main className="list-screen">
      <nav className="tabs wide">{["kanzeln", "kameras", "abschuesse"].map((t) => <button type="button" key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{label(t)}</button>)}</nav>
      <div className="filters">
        <label>Suchen<input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
        <label className="check list-toggle"><input type="checkbox" checked={filters.showArchived} onChange={(e) => setFilters({ ...filters, showArchived: e.target.checked })} />Archivierte anzeigen</label>
        {tab === "abschuesse" ? <label>Von<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} {...clearFrom} /></label> : null}
        {tab === "abschuesse" ? <label>Bis<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} {...clearTo} /></label> : null}
      </div>
      <section className="rows">{items.map((item) => <article key={item.id} className={item.status === "archiviert" ? "is-archived" : ""}>
        <div><strong>{item.name || item.wildart}{item.status === "archiviert" ? <em>Archiviert</em> : null}</strong><span>{rowMeta(tab, item, data)}</span></div>
        <div className="row-actions">
          <button type="button" onClick={() => { openSelection({ type: singular(tab), id: item.id }); setView("map"); }}>Anzeigen</button>
        </div>
      </article>)}</section>
    </main>
  );
}

function useVisibleData(data) {
  return useMemo(() => {
    const archived = Number(data.settings.show_archived);
    const active = (item) => archived || item.status !== "archiviert";
    const date = (item) => (!data.settings.map_date_filter_from || item.datum >= data.settings.map_date_filter_from) && (!data.settings.map_date_filter_to || item.datum <= data.settings.map_date_filter_to);
    return {
      kanzeln: data.kanzeln.filter(active),
      kameras: data.kameras.filter(active),
      abschuesse: data.abschuesse.filter((a) => active(a) && date(a)),
    };
  }, [data]);
}

function markerCenter(items) {
  if (!items.length) return DURCHHAUSEN_CENTER;
  const sum = items.reduce((acc, item) => ({
    lat: acc.lat + Number(item.position_lat),
    lng: acc.lng + Number(item.position_lng),
  }), { lat: 0, lng: 0 });
  return [sum.lat / items.length, sum.lng / items.length];
}

function pointOf(item) {
  return { lat: Number(item.position_lat), lng: Number(item.position_lng) };
}

function positionText(item) {
  const point = pointOf(item);
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function dateTimeText(item) {
  return `${item.datum || "-"}${item.uhrzeit ? ` ${item.uhrzeit}` : ""}`;
}

function shotOrigin(abschuss, data) {
  if (abschuss.schuss_kanzel_id) {
    const kanzel = data.kanzeln.find((item) => item.id === abschuss.schuss_kanzel_id);
    if (kanzel) return { lat: Number(kanzel.position_lat), lng: Number(kanzel.position_lng) };
  }
  if (abschuss.schuss_lat !== null && abschuss.schuss_lng !== null && abschuss.schuss_lat !== undefined && abschuss.schuss_lng !== undefined) {
    return { lat: Number(abschuss.schuss_lat), lng: Number(abschuss.schuss_lng) };
  }
  return null;
}

function shotDistance(abschuss, data) {
  const origin = shotOrigin(abschuss, data);
  if (!origin) return null;
  const toRad = (value) => Number(value) * Math.PI / 180;
  const lat1 = toRad(origin.lat);
  const lat2 = toRad(abschuss.position_lat);
  const dLat = toRad(Number(abschuss.position_lat) - origin.lat);
  const dLng = toRad(Number(abschuss.position_lng) - origin.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function findObject(data, selected) {
  if (!data || !selected) return null;
  return data[apiName(selected.type)].find((item) => item.id === selected.id) || null;
}

function apiName(type) {
  if (type === "kanzel") return "kanzeln";
  if (type === "kamera") return "kameras";
  return "abschuesse";
}

function formKey(form) {
  const point = form.point ? `${form.point.lat}:${form.point.lng}` : "nopoint";
  return `${form.mode || "neu"}:${form.type}:${form.item?.id || point}`;
}

function singular(tab) {
  if (tab === "kanzeln") return "kanzel";
  if (tab === "kameras") return "kamera";
  return "abschuss";
}

function label(tab) {
  if (tab === "kanzeln") return "Kanzeln";
  if (tab === "kameras") return "Markierungen";
  return "Abschüsse";
}

function compareAbschuss(a, b) {
  return String(a.datum || "").localeCompare(String(b.datum || ""))
    || String(a.uhrzeit || "").localeCompare(String(b.uhrzeit || ""))
    || String(a.updated_at || "").localeCompare(String(b.updated_at || ""))
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.wildart || "").localeCompare(String(b.wildart || ""), "de", { sensitivity: "base" });
}

function rowMeta(tab, item, data) {
  if (tab === "abschuesse") {
    const distance = shotDistance(item, data);
    return `${dateTimeText(item)} · ${item.wildart}${distance !== null ? ` (${distance} m)` : ""}${item.geschlecht ? ` · ${geschlechtValue(item.geschlecht)}` : ""}${item.alter_text ? ` · ${item.alter_text} Jahre` : ""}${item.schuetz_name ? ` · ${item.schuetz_name}` : ""}${item.gewicht_kg !== null && item.gewicht_kg !== undefined ? ` · ${item.gewicht_kg} kg` : ""}`;
  }
  return item.typ || `${Number(item.position_lat).toFixed(5)}, ${Number(item.position_lng).toFixed(5)}`;
}

function Root() {
  return <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
