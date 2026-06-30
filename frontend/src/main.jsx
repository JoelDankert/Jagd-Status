import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { MapContainer, Marker, Pane, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Layers, List, LocateFixed, Map as MapIcon, Search, Settings, Trash2, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import "./styles.css";

let LAST_ZOOM = null;

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
  if (!res.ok) {
    const error = new Error(json.error || "Fehler");
    error.status = res.status;
    error.code = json.code;
    throw error;
  }
  return json;
};

const today = () => new Date().toISOString().slice(0, 10);

const DEFAULT_MAP_CENTER = [51.1657, 10.4515];
const DEFAULT_MAP_ZOOM = 6;
const MARKER_MAP_ZOOM = 14;
const IMAGE_MAX_ZOOM = 8;
const MAX_PULSE_BPM = 150;
const MIN_PULSE_BPM = 20;
const ACTIVITY_PULSE_COUNT = 8;
const ACTIVITY_BASE_ZOOM = 14;
const ACTIVITY_BASE_DIAMETER_PX = 60;
const ACTIVITY_MAX_DIAMETER_PX = 420;
const ACTIVITY_HITBOX_PX = 48;
const EARTH_CIRCUMFERENCE_METERS = 40075016.686;
const ACTIVITY_PING_RADIUS_METERS = Math.round(
  (ACTIVITY_BASE_DIAMETER_PX / 2) * (EARTH_CIRCUMFERENCE_METERS * Math.cos((DEFAULT_MAP_CENTER[0] * Math.PI) / 180)) / (256 * 2 ** ACTIVITY_BASE_ZOOM)
);

const MAP_PANES = {
  lines: "jagd-lines",
  kanzeln: "jagd-kanzeln",
  kameras: "jagd-kameras",
  abschuesse: "jagd-abschuesse",
  aktivitaeten: "jagd-aktivitaeten",
  pick: "jagd-pick",
  self: "jagd-self",
};
const MAP_PANE_STYLES = {
  [MAP_PANES.lines]: { zIndex: 430, overflow: "visible" },
  [MAP_PANES.kanzeln]: { zIndex: 610, overflow: "visible" },
  [MAP_PANES.kameras]: { zIndex: 620, overflow: "visible" },
  [MAP_PANES.abschuesse]: { zIndex: 630, overflow: "visible" },
  [MAP_PANES.aktivitaeten]: { zIndex: 600, overflow: "visible" },
  [MAP_PANES.pick]: { zIndex: 700, overflow: "visible" },
  [MAP_PANES.self]: { zIndex: 710, overflow: "visible" },
};

function dateTimeLocal(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("de", { dateStyle: "short", timeStyle: "short" });
}

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
    if (file.type === "image/heic" || file.type === "image/heif" || file.type === "image/heif-sequence") {
      return reject(new Error("HEIC/HEIF nicht unterstützt – bitte als JPEG aufnehmen"));
    }
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
        if (!context) return reject(new Error("Canvas nicht verfügbar"));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
      image.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
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

function markerInitial(value, fallback) {
  return String(value || "").trim().match(/[\p{L}\p{N}]/u)?.[0]?.toLocaleUpperCase("de") || fallback;
}

function customWildartValue(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.charAt(0).toLocaleUpperCase("de") + text.slice(1).toLocaleLowerCase("de");
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

function aktivitaetPulseTiming(item) {
  if (!item) return null;
  const created = new Date(item.created_at).getTime();
  const durationMs = (Number(item.dauer_stunden) || 24) * 3600000;
  const age = Math.max(0, Date.now() - created);
  const remainingMs = Math.max(0, durationMs - age);
  if (remainingMs <= 0) return null;
  const progress = age / durationMs;
  const bpm = 40 + 80 * Math.pow(1 - progress, 1.25);
  const cycleMs = Math.round(60000 / bpm);
  const fixedAnimMs = 4000;
  return {
    cycleMs,
    pulseCount: Math.max(1, Math.round(fixedAnimMs / cycleMs)),
  };
}

function destinationPoint(lat, lng, meters, bearingDegrees) {
  const radius = 6371008.8;
  const angularDistance = meters / radius;
  const bearing = (Number(bearingDegrees) * Math.PI) / 180;
  const lat1 = (Number(lat) * Math.PI) / 180;
  const lng1 = (Number(lng) * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [(lat2 * 180) / Math.PI, (((lng2 * 180) / Math.PI + 540) % 360) - 180];
}

const markerIcon = (type, item = null, archived = false, pulse = null) => {
  const isActivity = type === "aktivitaet";
  const kameraSize = archived ? 9 : 12;
  const otherSize = archived ? 18 : 25;
  const size = type === "kamera" ? kameraSize : isActivity ? ACTIVITY_HITBOX_PX : otherSize;
  const pulseName = pulse ? `${isActivity ? "act" : "shot"}-pulse-${String(item?.id || "x").replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  const pulseCount = isActivity && pulse?.pulseCount ? pulse.pulseCount : 8;
  const loopMs = pulse ? (isActivity ? pulse.cycleMs * pulseCount : pulse.cycleMs * pulseCount) : 0;
  const pulseScale = isActivity ? "1.4" : "3.5";
  const pulseEnd = !isActivity && pulse ? Math.min(92, Math.max(4, Math.round((pulse.lifeMs / loopMs) * 1000) / 10)) : 0;
  const pulsePeak = !isActivity && pulse ? Math.min(4, Math.max(1.5, Math.round(pulseEnd * 0.18 * 10) / 10)) : 0;
  const hasDir = isActivity && item?.richtung_grad != null;
  const pulseKeyframes = isActivity
    ? (hasDir
      ? `@keyframes ${pulseName}{0%{opacity:0;transform:scale(0)}10%{opacity:1;transform:scale(.1)}100%{opacity:0;transform:scale(${pulseScale})}}`
      : `@keyframes ${pulseName}{0%{opacity:0;transform:scale(0)}10%{opacity:1;transform:scale(.1)}50%{opacity:0;transform:scale(.7)}100%{opacity:0;transform:scale(${pulseScale})}}`)
    : pulse ? `@keyframes ${pulseName}{0%{opacity:0;transform:scale(.7)}${pulsePeak}%{opacity:1;transform:scale(.75)}${pulseEnd}%{opacity:0;transform:scale(${pulseScale})}100%{opacity:0;transform:scale(${pulseScale})}}` : "";
  const pulseStyle = pulse ? `<style>${pulseKeyframes}</style>` : "";
  const dirStyle = isActivity && item?.richtung_grad != null ? `--activity-rotation:rotate(${Number(item.richtung_grad) - 90}deg)` : "";
  const pulseIcons = pulse ? Array.from({ length: pulseCount }, (_, index) => {
    const start = index * pulse.cycleMs;
    const dirMask = hasDir
      ? `;-webkit-mask-image:conic-gradient(rgba(0,0,0,0) 0deg,rgba(0,0,0,0) 40deg,rgba(0,0,0,1) 90deg,rgba(0,0,0,0) 140deg,rgba(0,0,0,0) 360deg);mask-image:conic-gradient(rgba(0,0,0,0) 0deg,rgba(0,0,0,0) 40deg,rgba(0,0,0,1) 90deg,rgba(0,0,0,0) 140deg,rgba(0,0,0,0) 360deg)`
      : "";
    const animStyle = isActivity
      ? `animation:${pulseName} ${loopMs}ms linear infinite backwards;animation-delay:${start}ms${dirMask}`
      : `opacity:0;animation:${pulseName} ${loopMs}ms linear infinite;animation-delay:${start}ms`;
    return `<i class="pin-pulse" style="${animStyle}"></i>`;
  }).join("") : "";
  const pulseHtml = pulse ? `${pulseStyle}${isActivity ? `<div class="activity-pulse-layer" style="${dirStyle}">${pulseIcons}</div>` : pulseIcons}` : "";
  const markerColor = type === "kamera" ? (item?.typ ? (MARKER_FARBE[item.typ] || "#546e7a") : "#c2185b") : "";
  const styleAttr = markerColor ? `--pin-bg:${markerColor}` : "";
  const labelHtml = "";
  return L.divIcon({
    className: `pin ${type} ${type === "abschuss" ? WILDART_KLASSEN[item?.wildart] || "wild-sonstiges" : ""} ${archived ? "is-archived" : ""}`,
    html: isActivity ? `${pulseHtml}${labelHtml}` : `${pulseHtml}<span style="${styleAttr}">${type === "kanzel" ? markerLetter(item?.name, "K") : type === "kamera" ? "" : markerInitial(item?.wildart, "A")}</span>`,
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
  const [animateMove, setAnimateMove] = useState(true);
  const [createAt, setCreateAt] = useState(null);
  const [form, setForm] = useState(null);
  const [originPick, setOriginPick] = useState(null);
  const [selfPos, setSelfPos] = useState(null);
  const [listTab, setListTab] = useState("kanzeln");
  const [filters, setFilters] = useState({
    q: "",
    showArchived: true,
    from: localStorage.getItem("jagd-date-from") || "",
    to: localStorage.getItem("jagd-date-to") || "",
  });
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
      throw error;
    }
  }} onRequestRegistration={async (body) => {
    try {
      await api("/api/revier-requests", { method: "POST", body });
      setLoginError("Registrierung angefordert.");
    } catch (error) {
      setLoginError(error.message);
      throw error;
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
          animateMove={animateMove}
          setAnimateMove={setAnimateMove}
        />
      ) : (
        <ListScreen data={data} tab={listTab} setTab={setListTab} filters={filters} setFilters={setFilters} setView={setView} openSelection={openSelection} load={load} setConfirmAction={setConfirmAction} setAnimateMove={setAnimateMove} />
      )}

      {settingsOpen && !originPick && <SettingsPanel data={data} load={load} close={() => setSettingsOpen(false)} isViewer={isViewer} />}
      {activeSelected && !originPick && <DetailPanel data={data} selected={selected} item={activeSelected} close={() => setSelected(null)} load={load} openForm={isViewer ? () => {} : openForm} isViewer={isViewer} setConfirmAction={setConfirmAction} />}
      {createAt && !isViewer && <CreateWindow point={createAt} close={() => setCreateAt(null)} openForm={openForm} />}
      {form && !isViewer && <ObjectForm key={formKey(form)} data={data} form={form} originPick={originPick} setOriginPick={setOriginPick} close={() => { setForm(null); setOriginPick(null); }} load={async () => { await load(); setForm(null); setOriginPick(null); }} />}

      {accountOpen && <AccountPanel data={data} load={load} close={() => setAccountOpen(false)} setConfirmAction={setConfirmAction} />}
      {confirmAction && <ConfirmDialog title={confirmAction.title} message={confirmAction.message} hint={confirmAction.hint} confirmLabel={confirmAction.confirmLabel} confirmClass={confirmAction.confirmClass} onConfirm={() => { confirmAction.action(); setConfirmAction(null); }} onCancel={() => setConfirmAction(null)} />}

    </div>
  );
}

function Login({ error, onLogin, onRequestRegistration }) {
  const [name, setName] = useState("");
  const [passwort, setPasswort] = useState("");
  const [loading, setLoading] = useState(true);
  const [registrationConfirm, setRegistrationConfirm] = useState(false);
  const tried = useRef(false);
  const requestRegistration = async () => {
    setRegistrationConfirm(false);
    setLoading(true);
    try {
      await onRequestRegistration({ name, passwort });
    } finally {
      setLoading(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin({ name, passwort });
    } catch (error) {
      if (error.status === 404 && name && passwort) {
        setRegistrationConfirm(true);
      }
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
      {registrationConfirm ? (
        <ConfirmDialog
          title="Registrierung"
          message="Account nicht vorhanden, Registrierung anfordern?"
          confirmLabel="Anfordern"
          onConfirm={requestRegistration}
          onCancel={() => setRegistrationConfirm(false)}
        />
      ) : null}
    </main>
  );
}

function AdminPage() {
  const [passwort, setPasswort] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteRequestConfirm, setDeleteRequestConfirm] = useState(null);

  const loadAdmin = async (adminPasswort = passwort) => {
    setLoading(true);
    setError("");
    try {
      const next = await api("/api/admin/data", { method: "POST", body: { passwort: adminPasswort } });
      setData(next);
      setPasswort(adminPasswort);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const approve = async (requestId) => {
    setLoading(true);
    setError("");
    try {
      setData(await api(`/api/admin/requests/${requestId}/approve`, { method: "POST", body: { passwort } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reject = async (requestId) => {
    setLoading(true);
    setError("");
    try {
      setData(await api(`/api/admin/requests/${requestId}`, { method: "DELETE", body: { passwort } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteRevier = async () => {
    if (!deleteConfirm) return;
    setLoading(true);
    setError("");
    try {
      setData(await api(`/api/admin/reviere/${deleteConfirm.id}`, { method: "DELETE", body: { passwort } }));
      setDeleteConfirm(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const approveDeleteRequest = async () => {
    if (!deleteRequestConfirm) return;
    setLoading(true);
    setError("");
    try {
      setData(await api(`/api/admin/delete-requests/${deleteRequestConfirm.id}/approve`, { method: "POST", body: { passwort } }));
      setDeleteRequestConfirm(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const rejectDeleteRequest = async (requestId) => {
    setLoading(true);
    setError("");
    try {
      setData(await api(`/api/admin/delete-requests/${requestId}`, { method: "DELETE", body: { passwort } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <main className="login">
        <form onSubmit={(e) => { e.preventDefault(); loadAdmin(); }}>
          <div className="login-head">
            <span className="login-badge">A</span>
            <h1>Admin</h1>
            <p>Gebiete verwalten</p>
          </div>
          <label>Admin-Passwort<input value={passwort} onChange={(e) => setPasswort(e.target.value)} type="password" autoComplete="current-password" disabled={loading} /></label>
          <button className={`primary ${loading ? "is-loading" : ""}`} type="submit" disabled={loading}>Öffnen</button>
          <p className="error">{error}</p>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-screen">
      <div className="admin-shell">
        <header className="admin-top">
          <div>
            <h1>Admin</h1>
            <p>Gebiete und Registrierungen</p>
          </div>
          <button type="button" className="quiet" onClick={() => loadAdmin()} disabled={loading}>Aktualisieren</button>
        </header>
        {error ? <p className="error">{error}</p> : null}

        <section className="admin-section">
          <h2>Neue Gebiete</h2>
          <div className="admin-list">
            {data.requests.length ? data.requests.map((request) => (
              <article className="admin-card pending" key={request.id}>
                <div>
                  <strong>{request.name}</strong>
                  <span>{dateTimeLocal(request.created_at)}</span>
                </div>
                <div className="admin-actions">
                  <button type="button" className="primary" onClick={() => approve(request.id)} disabled={loading}>Annehmen</button>
                  <button type="button" className="quiet" onClick={() => reject(request.id)} disabled={loading}>Ablehnen</button>
                </div>
              </article>
            )) : <p className="empty">Keine offenen Registrierungen</p>}
          </div>
        </section>

        <section className="admin-section">
          <h2>Löschanfragen</h2>
          <div className="admin-list">
            {data.deleteRequests?.length ? data.deleteRequests.map((request) => (
              <article className="admin-card pending" key={request.id}>
                <div>
                  <strong>{request.name}</strong>
                  <span>{dateTimeLocal(request.created_at)}</span>
                </div>
                <div className="admin-actions">
                  <button type="button" className="danger" onClick={() => setDeleteRequestConfirm(request)} disabled={loading}>Löschen</button>
                  <button type="button" className="quiet" onClick={() => rejectDeleteRequest(request.id)} disabled={loading}>Ablehnen</button>
                </div>
              </article>
            )) : <p className="empty">Keine offenen Löschanfragen</p>}
          </div>
        </section>

        <section className="admin-section">
          <h2>Alle Gebiete</h2>
          <div className="admin-list">
            {data.reviere.map((revier) => (
              <article className="admin-card" key={revier.id}>
                <div>
                  <strong>{revier.name}</strong>
                  <span>Erstellt {dateTimeLocal(revier.created_at)}</span>
                </div>
                <div className="admin-actions">
                  <button type="button" className="danger" onClick={() => setDeleteConfirm(revier)} disabled={loading}>Löschen</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      {deleteRequestConfirm ? (
        <ConfirmDialog
          title="Löschanfrage bestätigen"
          message={deleteRequestConfirm.name + " wirklich löschen?"}
          confirmLabel="Löschen"
          confirmClass="danger"
          onConfirm={approveDeleteRequest}
          onCancel={() => setDeleteRequestConfirm(null)}
        />
      ) : null}
      {deleteConfirm ? (
        <ConfirmDialog
          title="Gebiet löschen"
          message={deleteConfirm.name + " wirklich löschen?"}
          confirmLabel="Löschen"
          confirmClass="danger"
          onConfirm={deleteRevier}
          onCancel={() => setDeleteConfirm(null)}
        />
      ) : null}
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
      <button type="button" className="quiet header-menu-btn" ref={btnRef} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><circle cx="4" cy="9" r="2"/><circle cx="9" cy="9" r="2"/><circle cx="14" cy="9" r="2"/></svg></button>
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
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
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
  const requestDelete = () => {
    setDeleteSaving(true);
    setError("");
    api("/api/revier/delete-request", { method: "POST" })
      .then(() => setError("Löschung angefragt."))
      .catch((err) => setError(err.message))
      .finally(() => setDeleteSaving(false));
  };
  const requestSave = () => {
    if (!name.trim()) {
      setError("Name fehlt");
      return;
    }
    if (adminTouched.current && !passwort.trim()) {
      setError("Passwort fehlt");
      return;
    }
    setError("");
    setConfirmAction({ message: "Account-Daten ändern?", action: submit });
  };
  return (
    <div className="overlay">
      <form className="modal small" noValidate onSubmit={(e) => { e.preventDefault(); requestSave(); }}>
        <header><h2>Account-Daten ändern</h2><button type="button" onClick={close}><X size={18} /></button></header>
        <label>Reviername<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Revierpasswort<input type="password" value={passwort} onChange={(e) => { setPasswort(e.target.value); adminTouched.current = true; }} /></label>
        <label>Gast-Passwort<input type="password" value={viewerPasswort} onChange={(e) => { setViewerPasswort(e.target.value); viewerTouched.current = true; }} /></label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className={`primary ${saving ? "is-loading" : ""}`} disabled={saving}>Speichern</button>
        <button type="button" className={"danger account-delete-button " + (deleteSaving ? "is-loading" : "")} disabled={saving || deleteSaving} onClick={() => setDeleteConfirm(true)}>Löschung anfragen</button>
      </form>
      {deleteConfirm ? (
        <ConfirmDialog
          title="Löschung anfragen"
          message="Account-Löschung beim Admin anfragen?"
          confirmLabel="Anfragen"
          confirmClass="danger"
          onConfirm={() => { setDeleteConfirm(false); requestDelete(); }}
          onCancel={() => setDeleteConfirm(false)}
        />
      ) : null}
    </div>
  );
}

function ConfirmDialog({ title = "Bestätigen", message, hint, confirmLabel = "Ja", confirmClass = "primary", onConfirm, onCancel }) {
  const dialog = (
    <dialog className="native-dialog modal small" open>
      <header><h2>{title}</h2></header>
      <p className="confirm-text">{hint ? `${message} ${hint}` : message}</p>
      <div className="confirm-actions">
        <button type="button" onClick={onCancel}>Abbrechen</button>
        <button type="button" className={confirmClass} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
  return createPortal(dialog, document.body);
}

function MapInit({ center, defaultZoom, mapLayer }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!done.current) {
      done.current = true;
      map.setView(center, LAST_ZOOM ?? defaultZoom, { animate: false });
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
      map.setZoom(z === map.options.maxZoom ? z - 1 : z + 1, { animate: false });
      requestAnimationFrame(() => map.setZoom(z, { animate: false }));
    }, 80);
    return () => clearTimeout(timer);
  }, [mapLayer]);
  return null;
}

function MapInteractionVisibility() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let settleTimer = 0;
    const showLess = () => {
      clearTimeout(settleTimer);
      container.classList.add("is-map-interacting");
    };
    const showAll = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => container.classList.remove("is-map-interacting"), 80);
    };
    const pausePulses = () => container.classList.add("is-map-panning");
    const resumePulses = () => container.classList.remove("is-map-panning");

    map.on("zoomstart", showLess);
    map.on("zoomend", showAll);
    map.on("movestart", pausePulses);
    map.on("moveend", resumePulses);
    return () => {
      clearTimeout(settleTimer);
      container.classList.remove("is-map-interacting");
      container.classList.remove("is-map-panning");
      map.off("zoomstart", showLess);
      map.off("zoomend", showAll);
      map.off("movestart", pausePulses);
      map.off("moveend", resumePulses);
    };
  }, [map]);
  return null;
}

function MapScreen({ data, selected, openSelection, openCreate, originPick, setOriginPick, selfPos, setSelfPos, openSettings, isViewer, mapLayer, setMapLayer, animateMove, setAnimateMove }) {
  const visible = useVisibleData(data);
  const mapItems = [...visible.kanzeln, ...visible.kameras, ...visible.abschuesse];
  const center = markerCenter(mapItems);
  const defaultZoom = mapItems.length ? MARKER_MAP_ZOOM : DEFAULT_MAP_ZOOM;
  const toggleLayer = () => setMapLayer(mapLayer === "osm" ? "sat" : "osm");
  const flyToSelection = (sel) => { setAnimateMove(true); openSelection(sel); };
  return (
    <main className="map-shell" data-layer={mapLayer}>
      <MapContainer zoomControl={false} zoomSnap={0} zoomDelta={0.25} wheelPxPerZoomLevel={90} maxZoom={20} doubleClickZoom={false} attributionControl={false} className="map">
        <MapInit center={center} defaultZoom={defaultZoom} mapLayer={mapLayer} />
        <MapInteractionVisibility />
        {mapLayer === "osm" ? (
          <TileLayer key="osm" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={22} />
        ) : (
          <TileLayer key="sat" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={21} maxZoom={22} />
        )}
        <MapEvents openCreate={openCreate} originPick={originPick} setOriginPick={setOriginPick} />
        <MapTools setSelfPos={setSelfPos} />
        {Object.entries(MAP_PANE_STYLES).map(([name, style]) => <Pane key={name} name={name} style={style} />)}
        <FlyToSelection data={data} selected={selected} animate={animateMove} />
        {visible.abschuesse.map((abschuss) => <ShotLine key={`line-${abschuss.id}`} abschuss={abschuss} data={data} pane={MAP_PANES.lines} />)}
        {originPick ? <PickTarget originPick={originPick} /> : null}
        {Number(data.settings.show_kanzeln) ? visible.kanzeln.map((kanzel) => (
          <Marker
            key={kanzel.id}
            pane={MAP_PANES.kanzeln}
            position={[kanzel.position_lat, kanzel.position_lng]}
            icon={markerIcon("kanzel", kanzel, kanzel.status === "archiviert")}
            eventHandlers={{
              click: (event) => {
                if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
                if (originPick) setOriginPick({ ...originPick, origin: { type: "kanzel", id: kanzel.id, lat: kanzel.position_lat, lng: kanzel.position_lng } });
                else flyToSelection({ type: "kanzel", id: kanzel.id });
              },
            }}
          />
        )) : null}
        {Number(data.settings.show_kameras) ? visible.kameras.map((kamera) => (
          <Marker
            key={kamera.id}
            pane={MAP_PANES.kameras}
            position={[kamera.position_lat, kamera.position_lng]}
            icon={markerIcon("kamera", kamera, kamera.status === "archiviert")}
            eventHandlers={{
              click: (event) => {
                if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
                flyToSelection({ type: "kamera", id: kamera.id });
              },
            }}
          />
        )) : null}
        {Number(data.settings.show_abschuesse) ? visible.abschuesse.map((abschuss) => (
          <ShotMarker key={abschuss.id} abschuss={abschuss} openSelection={openSelection} setAnimateMove={setAnimateMove} pane={MAP_PANES.abschuesse} />
        )) : null}
        {data.aktivitaeten?.map((aktivitaet) => (
          <ActivityMarker
            key={aktivitaet.id}
            aktivitaet={aktivitaet}
            pane={MAP_PANES.aktivitaeten}
            openSelection={openSelection}
            setAnimateMove={setAnimateMove}
          />
        ))}
        {originPick?.origin?.lat ? <Marker pane={MAP_PANES.pick} position={[originPick.origin.lat, originPick.origin.lng]} icon={originIcon} /> : null}
        {selfPos && Number(data.settings.show_self_location) ? <Marker pane={MAP_PANES.self} position={selfPos} icon={L.divIcon({ className: "self-marker", html: "", iconSize: [18, 18], iconAnchor: [9, 9] })} /> : null}
      </MapContainer>
      <div className="map-top-right">
        <button className="icon-button" type="button" onClick={openSettings} title="Einstellungen"><Settings size={18} /></button>
        <button className="icon-button" type="button" onClick={toggleLayer} title={mapLayer === "osm" ? "Satellit" : "Karte"}><MapIcon size={18} /></button>
      </div>
      <div className="map-attribution">{mapLayer === "osm" ? '\u00a9 OpenStreetMap' : '\u00a9 Esri'}</div>
    </main>
  );
}

const ShotMarker = React.memo(function ShotMarker({ abschuss, openSelection, setAnimateMove, pane }) {
  const icon = useMemo(
    () => markerIcon("abschuss", abschuss, abschuss.status === "archiviert", shotPulseTiming(abschuss)),
    [
      abschuss.id,
      abschuss.status,
      abschuss.wildart,
      abschuss.datum,
      abschuss.uhrzeit,
      abschuss.created_at,
      abschuss.updated_at,
    ]
  );
  const eventHandlers = useMemo(() => ({
    click: () => {
      setAnimateMove(true);
      openSelection({ type: "abschuss", id: abschuss.id });
    },
  }), [abschuss.id, openSelection, setAnimateMove]);

  return (
    <Marker
      pane={pane}
      position={[abschuss.position_lat, abschuss.position_lng]}
      icon={icon}
      eventHandlers={eventHandlers}
    />
  );
});

const ActivityMarker = React.memo(function ActivityMarker({ aktivitaet, pane, openSelection, setAnimateMove }) {
  const map = useMap();
  const markerRef = useRef(null);
  const clickRef = useRef(null);
  const pulse = useMemo(
    () => aktivitaetPulseTiming(aktivitaet),
    [aktivitaet.created_at, aktivitaet.dauer_stunden]
  );

  useEffect(() => {
    clickRef.current = () => {
      setAnimateMove(true);
      openSelection({ type: "aktivitaet", id: aktivitaet.id });
    };
  }, [aktivitaet.id, openSelection, setAnimateMove]);

  useEffect(() => {
    const lat = Number(aktivitaet.position_lat);
    const lng = Number(aktivitaet.position_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

    const marker = L.marker([lat, lng], {
      icon: markerIcon("aktivitaet", aktivitaet, false, pulse),
      pane,
      zIndexOffset: 1000,
    });
    const handleClick = () => clickRef.current?.();
    marker.on("click", handleClick);
    marker.addTo(map);
    markerRef.current = marker;
    let frame = 0;

    const setSize = () => {
      const icon = marker.getElement();
      if (!icon) return;
      const center = map.latLngToLayerPoint([lat, lng]);
      const east = map.latLngToLayerPoint(destinationPoint(lat, lng, ACTIVITY_PING_RADIUS_METERS, 90));
      const size = Math.min(ACTIVITY_MAX_DIAMETER_PX, Math.max(12, center.distanceTo(east) * 2));
      const layer = icon.querySelector(".activity-pulse-layer");
      if (!layer) return;
      layer.style.width = `${size}px`;
      layer.style.height = `${size}px`;
    };

    const updateSize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setSize();
      });
    };

    setSize();
    map.on("zoomend viewreset resize", updateSize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      map.off("zoomend viewreset resize", updateSize);
      marker.off("click", handleClick);
      marker.remove();
      if (markerRef.current === marker) markerRef.current = null;
    };
  }, [
    aktivitaet.id,
    aktivitaet.position_lat,
    aktivitaet.position_lng,
    aktivitaet.status,
    aktivitaet.name,
    aktivitaet.richtung_grad,
    map,
    pulse,
    pane,
  ]);

  return null;
});

function MapEvents({ openCreate, originPick, setOriginPick }) {
  const timer = useRef(null);
  const setOrigin = (next) => {
    setOriginPick({ ...originPick, origin: { type: "point", lat: next.lat, lng: next.lng } });
  };
  useMapEvents({
    dblclick(e) {
      if (originPick) setOrigin(e.latlng);
      else openCreate(e.latlng);
    },
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
  const lastSelfPos = useRef(null);
  const locationWatch = useRef(null);
  const centerOnNextLocation = useRef(false);
  const [locating, setLocating] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);
  const doSearch = (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&accept-language=de`);
        if (r.ok) setSearchResults(await r.json());
        else setSearchResults([]);
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 350);
  };
  const selectResult = (item) => {
    map.flyTo([Number(item.lat), Number(item.lon)], Math.max(map.getZoom(), 14));
    setSearchOpen(false);
    setSearchQ("");
  };
  useEffect(() => () => {
    if (locationWatch.current !== null) navigator.geolocation.clearWatch(locationWatch.current);
  }, []);

  const startLocationWatch = () => {
    if (!navigator.geolocation) {
      setError("Position nicht verfügbar");
      return;
    }
    if (locationWatch.current !== null) return;
    locationWatch.current = navigator.geolocation.watchPosition(
      (p) => {
        const next = [p.coords.latitude, p.coords.longitude];
        lastSelfPos.current = next;
        setSelfPos(next);
        setTracking(true);
        setLocating(false);
        setError("");
        if (centerOnNextLocation.current) {
          centerOnNextLocation.current = false;
          map.flyTo(next, Math.max(map.getZoom(), 16));
        }
      },
      (err) => {
        const blocked = !window.isSecureContext || /secure|https|http/i.test(err.message || "");
        setError(blocked ? "Position nur über HTTPS" : err.code === 1 ? "Erlaubnis fehlt" : "Position nicht gefunden");
        setTracking(false);
        setLocating(false);
        locationWatch.current = null;
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 2000 }
    );
  };

  const locate = () => {
    setError("");
    const current = lastSelfPos.current;
    if (current) {
      map.flyTo(current, Math.max(map.getZoom(), 16));
      startLocationWatch();
      return;
    }
    centerOnNextLocation.current = true;
    setLocating(true);
    startLocationWatch();
  };
  return (
    <div className="map-tools" ref={ref}>
      <button type="button" onClick={() => setSearchOpen(true)} title="Ort suchen"><Search size={17} /></button>
      <button type="button" onClick={locate} title="Position" className={locating ? "loading" : ""}><LocateFixed size={17} /></button>
      {error ? <button type="button" className="map-status error-status" onClick={() => setError("")}>{error}</button> : null}
      {searchOpen ? createPortal(
        <div className="overlay" onClick={() => { setSearchOpen(false); setSearchQ(""); }}>
          <section className="modal small" onClick={(e) => e.stopPropagation()}>
            <header><h2>Ort suchen</h2><button type="button" onClick={() => { setSearchOpen(false); setSearchQ(""); }}><X size={18} /></button></header>
            <input autoFocus placeholder="Ortschaft..." value={searchQ} onChange={(e) => { setSearchQ(e.target.value); doSearch(e.target.value); }} />
            {searchResults.length ? (
              <div className="search-results">
                {searchResults.map((r, i) => <button key={i} type="button" onClick={() => selectResult(r)}>{r.display_name}</button>)}
              </div>
            ) : null}
            {searching ? <span className="mini-loader" /> : null}
          </section>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function ShotLine({ abschuss, data, pane }) {
  const origin = shotOrigin(abschuss, data);
  if (!origin) return null;
  const target = pointOf(abschuss);
  return <Polyline pane={pane} className="shot-line" positions={[[origin.lat, origin.lng], [target.lat, target.lng]]} pathOptions={{ color: "#d32f2f", weight: 3, opacity: 1, dashArray: "7 7", lineCap: "round" }} />;
}

function PickTarget({ originPick }) {
  const target = originPick.target;
  const origin = originPick.origin;
  return (
    <>
      <Marker pane={MAP_PANES.pick} position={[target.lat, target.lng]} icon={markerIcon("abschuss")} />
      {origin ? <Polyline pane={MAP_PANES.lines} className="shot-line" positions={[[Number(origin.lat), Number(origin.lng)], [Number(target.lat), Number(target.lng)]]} pathOptions={{ color: "#d32f2f", weight: 3, opacity: 1, dashArray: "7 7", lineCap: "round" }} /> : null}
    </>
  );
}

function FlyToSelection({ data, selected, animate }) {
  const map = useMap();
  useEffect(() => {
    const item = findObject(data, selected);
    if (!item) return;
    const size = map.getSize();
    const target = map.latLngToContainerPoint([item.position_lat, item.position_lng]);
    const center = map.containerPointToLatLng([target.x, target.y + size.y / 4]);
    if (animate) map.flyTo(center, map.getZoom(), { duration: 0.8 });
    else map.setView(center, map.getZoom(), { animate: false });
  }, [selected?.id]);
  return null;
}

function SettingsPanel({ data, load, close }) {
  const [local, setLocal] = useState({
    ...data.settings,
    map_date_filter_from: localStorage.getItem("jagd-date-from") || data.settings.map_date_filter_from || "",
    map_date_filter_to: localStorage.getItem("jagd-date-to") || data.settings.map_date_filter_to || "",
  });
  const [saving, setSaving] = useState(false);
  const s = data.settings;
  const effFrom = localStorage.getItem("jagd-date-from") || s.map_date_filter_from || "";
  const effTo = localStorage.getItem("jagd-date-to") || s.map_date_filter_to || "";
  const dirty = Object.keys(local).some((k) => {
    if (k === "map_date_filter_from") return local.map_date_filter_from !== effFrom;
    if (k === "map_date_filter_to") return local.map_date_filter_to !== effTo;
    return local[k] !== s[k];
  });
  const apply = async () => {
    setSaving(true);
    try {
      const body = {};
      for (const key of Object.keys(local)) {
        if (key === "map_date_filter_from" || key === "map_date_filter_to") {
          localStorage.setItem(`jagd-date-${key.replace("map_date_filter_", "")}`, local[key] || "");
          if (local[key] !== s[key]) body[key] = local[key];
        } else if (local[key] !== s[key]) {
          body[key] = local[key];
        }
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
        <div className="two">
          <button type="button" className="choice" onClick={() => openForm({ type: "abschuss", point })}>Abschuss</button>
          <button type="button" className="choice" onClick={() => openForm({ type: "aktivitaet", point })}>Aktivität</button>
        </div>
      </section>
    </div>
  );
}


function activityTotalHours(item) {
  return Number(item.dauer_stunden) || 24;
}

function activityRemainingHours(item) {
  const created = new Date(item.created_at).getTime();
  if (!Number.isFinite(created)) return activityTotalHours(item);
  const remainingMs = Math.max(0, activityTotalHours(item) * 3600000 - (Date.now() - created));
  return remainingMs / 3600000;
}

function formatActivityHours(hours) {
  return Number(hours).toLocaleString("de", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (form.type === "aktivitaet") {
    return {
      name: item.name || "",
      dauer_stunden: form.item ? Math.max(0.01, Math.round(activityRemainingHours(item) * 100) / 100) : (item.dauer_stunden ?? 24),
      richtung_grad: item.richtung_grad ?? "",
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
    } catch (err) {
      setError(err.message);
    } finally {
      setImageLoading(null);
    }
  };
  const clearImage = (index) => {
    const key = index === 0 ? "bild_data" : `bild${index + 1}`;
    set(key, "");
  };
  const origin = originPick?.formId === formId ? originPick.origin : null;
  const picking = originPick?.formId === formId && !originPick.origin && originPick.mode !== "richtung";
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
    const o = originPick?.formId === formId ? originPick?.origin : null;
    if (!o || o.type === "richtung") return;
    setOriginLabel("Punkt gewählt");
    setValues((current) => ({
      ...current,
      schuss_lat: o.lat ?? "",
      schuss_lng: o.lng ?? "",
      schuss_kanzel_id: "",
    }));
    setOriginPick(null);
  }, [originPick, formId, setOriginPick]);

  const submit = async (e) => {
    e.preventDefault();
    if (form.type === "kanzel" || form.type === "kamera") {
      if (!values.name.trim()) { setError("Name fehlt"); return; }
    } else if (form.type === "aktivitaet") {
      if (!values.name.trim()) { setError("Name fehlt"); return; }
      if (!values.dauer_stunden) { setError("Dauer fehlt"); return; }
    } else if (form.type === "abschuss") {
      if (!values.wildart) { setError("Wildart fehlt"); return; }
    }
    setSaving(true);
    setError("");
    try {
      const body = { ...values, kanzel_id: "", schuss_kanzel_id: "", position_lat: form.point.lat, position_lng: form.point.lng };
      if (body.typ === "Sonstiges" && body.typ_sonstiges) body.typ = body.typ_sonstiges;
      delete body.typ_sonstiges;
      if (body.wildart === "Sonstiges" && body.wildart_sonstiges) body.wildart = customWildartValue(body.wildart_sonstiges);
      delete body.wildart_sonstiges;
      const path = form.type === "kanzel" ? "/api/kanzeln" : form.type === "kamera" ? "/api/kameras" : form.type === "aktivitaet" ? "/api/aktivitaeten" : "/api/abschuesse";
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
      <form className="modal" noValidate onSubmit={submit}>
        <header><h2>{form.type === "kanzel" ? "Kanzel" : form.type === "kamera" ? "Markierung" : form.type === "aktivitaet" ? "Aktivität" : "Abschuss"}{editing ? " bearbeiten" : ""}</h2><button type="button" onClick={close}><X size={18} /></button></header>
        {form.type !== "aktivitaet" ? <ImageSlots images={[values.bild_data, values.bild2, values.bild3]} setImage={setImage} clearImage={clearImage} loading={imageLoading} /> : null}
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
            <NoteField value={values.notiz} onChange={(v) => set("notiz", v)} />
          </>
        ) : form.type === "aktivitaet" ? (
          <>
            <label>Name<input required value={values.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label>Dauer (Stunden)<input type="number" min="0.01" max="720" step="0.01" inputMode="decimal" value={values.dauer_stunden} onChange={(e) => set("dauer_stunden", e.target.value === "" ? "" : Number(e.target.value))} /></label>
            <label>Richtung<select value={values.richtung_grad !== "" && values.richtung_grad !== null && values.richtung_grad !== undefined ? values.richtung_grad : ""} onChange={(e) => set("richtung_grad", e.target.value ? Number(e.target.value) : "")}>
              <option value="">Keine</option>
              <option value="0">N</option>
              <option value="45">NO</option>
              <option value="90">O</option>
              <option value="135">SO</option>
              <option value="180">S</option>
              <option value="225">SW</option>
              <option value="270">W</option>
              <option value="315">NW</option>
            </select></label>
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
            <NoteField value={values.notiz} onChange={(v) => set("notiz", v)} />
          </>
        )}
        <p className="error">{error}</p>
        <button className={`primary ${saving ? "is-loading" : ""}`} type="submit" disabled={saving || imageLoading !== null}>{saving ? "Speichert" : "Speichern"}</button>
      </form>
    </div>
  );
}

function NoteField({ value, onChange }) {
  const [fullscreen, setFullscreen] = useState(false);
  const isMobile = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const [localValue, setLocalValue] = useState("");
  const openFullscreen = () => {
    if (!isMobile) return;
    setLocalValue(value);
    setFullscreen(true);
  };
  const closeFullscreen = () => {
    onChange(localValue);
    setFullscreen(false);
  };
  return (
    <>
      <label>Bemerkungen<textarea value={value} onChange={(e) => onChange(e.target.value)} onFocus={openFullscreen} /></label>
      {fullscreen ? createPortal(
        <div className="overlay" onClick={closeFullscreen}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <header><h2>Bemerkungen</h2><button type="button" onClick={closeFullscreen}><X size={18} /></button></header>
            <textarea autoFocus value={localValue} onChange={(e) => setLocalValue(e.target.value)} style={{ minHeight: "30vh" }} />
          </div>
        </div>,
        document.body
      ) : null}
    </>
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
          {selected.type !== "aktivitaet" ? <button type="button" disabled={Boolean(actionLoading)} className={actionLoading === "archive" ? "is-loading" : ""} onClick={archive}>{item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button> : null}
          <button type="button" disabled={Boolean(actionLoading)} className={`danger ${actionLoading === "delete" ? "is-loading" : ""}`} onClick={() => setConfirmAction({ message: "Sicher, dass du löschen willst?", hint: "Oft ist es besser, das Element zu archivieren.", action: del })}><Trash2 size={16} />Löschen</button>
        </div>
      ) : null}
      {imageOpen ? createPortal((
        <div className="image-lightbox" onClick={() => setImageOpen(false)}>
          <button type="button" className="image-close" onClick={() => setImageOpen(false)} aria-label="Schließen"><X size={20} /></button>
          <div
            className="image-stage"
            ref={stageRef}
            onClick={(event) => { event.stopPropagation(); if (transformRef.current.scale <= 1) setImageOpen(false); }}
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
  if (selected.type === "aktivitaet") {
    const remainingH = activityRemainingHours(item);
    return (
      <dl>
        <dt>Dauer</dt><dd>{remainingH <= 0 ? "abgelaufen" : `${formatActivityHours(remainingH)} Stunden`}</dd>
        {item.richtung_grad !== null && item.richtung_grad !== undefined ? <><dt>Richtung</dt><dd>{windDirection(Number(item.richtung_grad))}</dd></> : null}
        <dt>Position</dt><dd>{positionText(item)}</dd>
        <dt>Erstellt</dt><dd>{new Date(item.created_at).toLocaleString("de")}</dd>
      </dl>
    );
  }
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
  return <dl>{item.typ ? <><dt>Typ</dt><dd>{item.typ}</dd></> : null}<dt>Position</dt><dd>{positionText(item)}</dd></dl>;
}

function ListScreen({ data, tab, setTab, filters, setFilters, setView, openSelection, load, setConfirmAction, setAnimateMove }) {
  const [sortBy, setSortBy] = useState("datum");
  const [sortDir, setSortDir] = useState("desc");
  const clearFrom = useLongPressClear(() => { setFilters((current) => ({ ...current, from: "" })); localStorage.removeItem("jagd-date-from"); });
  const clearTo = useLongPressClear(() => { setFilters((current) => ({ ...current, to: "" })); localStorage.removeItem("jagd-date-to"); });
  const sortOptions = [{ key: "datum", label: "Datum" }, { key: "gewicht_kg", label: "Gewicht" }, { key: "alter_text", label: "Alter" }];
  useEffect(() => {
    if (tab === "abschuesse") { setSortBy("datum"); setSortDir("desc"); }
  }, [tab]);
  const items = data[tab]
    .filter((item) => {
      const q = filters.q.toLowerCase();
      const statusOk = filters.showArchived || item.status !== "archiviert";
      const dateOk = tab !== "abschuesse" || ((!filters.from || item.datum >= filters.from) && (!filters.to || item.datum <= filters.to));
      return statusOk && dateOk && (!q || JSON.stringify(item).toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sortBy === "datum") return (sortDir === "desc" ? 1 : -1) * compareAbschuss(b, a);
      const va = a[sortBy] ?? "";
      const vb = b[sortBy] ?? "";
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "de", { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
  return (
    <main className="list-screen">
      <nav className="tabs wide">{["kanzeln", "kameras", "abschuesse"].map((t) => <button type="button" key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{label(t)}</button>)}</nav>
      <div className="filters">
        <label>Suchen<input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
        <label className="check list-toggle"><input type="checkbox" checked={filters.showArchived} onChange={(e) => setFilters({ ...filters, showArchived: e.target.checked })} />Archivierte anzeigen</label>
        {tab === "abschuesse" ? <label>Von<input type="date" value={filters.from} onChange={(e) => { const v = e.target.value; localStorage.setItem("jagd-date-from", v); setFilters({ ...filters, from: v }); }} {...clearFrom} /></label> : null}
        {tab === "abschuesse" ? <label>Bis<input type="date" value={filters.to} onChange={(e) => { const v = e.target.value; localStorage.setItem("jagd-date-to", v); setFilters({ ...filters, to: v }); }} {...clearTo} /></label> : null}
      </div>
      {tab === "abschuesse" ? (
        <label className="sort-label">Sortierung
        <div className="sort-row">
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          {sortOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button type="button" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} title={sortDir === "asc" ? "Aufsteigend" : "Absteigend"}>
          {sortDir === "asc" ? "\u2191" : "\u2193"}
        </button>
      </div>
      </label>) : null}
      <section className="rows">{items.map((item) => <article key={item.id} className={item.status === "archiviert" ? "is-archived" : ""}>
        <div><strong>{item.name || item.wildart}{item.status === "archiviert" ? <em>Archiviert</em> : null}</strong><span>{rowMeta(tab, item, data)}</span></div>
        <div className="row-actions">
          <button type="button" onClick={() => { setAnimateMove(false); openSelection({ type: singular(tab), id: item.id }); setView("map"); }}>Anzeigen</button>
        </div>
      </article>)}</section>
    </main>
  );
}

function useVisibleData(data) {
  return useMemo(() => {
    const archived = Number(data.settings.show_archived);
    const active = (item) => archived || item.status !== "archiviert";
    const from = localStorage.getItem("jagd-date-from") || data.settings.map_date_filter_from;
    const to = localStorage.getItem("jagd-date-to") || data.settings.map_date_filter_to;
    const date = (item) => (!from || item.datum >= from) && (!to || item.datum <= to);
    return {
      kanzeln: data.kanzeln.filter(active),
      kameras: data.kameras.filter(active),
      abschuesse: data.abschuesse.filter((a) => active(a) && date(a)),
    };
  }, [data]);
}

function markerCenter(items) {
  if (!items.length) return DEFAULT_MAP_CENTER;
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
  if (type === "aktivitaet") return "aktivitaeten";
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
  if (window.location.pathname === "/admin") return <AdminPage />;
  return <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
