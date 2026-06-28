import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Layers, List, LocateFixed, Map as MapIcon, Settings, Trash2, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error || "Fehler");
  return json;
};

const today = () => new Date().toISOString().slice(0, 10);
const DURCHHAUSEN_CENTER = [48.0392, 8.6747];

function currentTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateTimeValue(datum, uhrzeit) {
  return `${datum || today()}T${uhrzeit || "00:00"}`;
}

function splitDateTime(value) {
  const [datum, uhrzeit = ""] = String(value || "").split("T");
  return { datum: datum || today(), uhrzeit };
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

async function autofillWeather(point, signal) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "kmh",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!response.ok) return null;
  const current = (await response.json()).current || {};
  const temp = Number.isFinite(Number(current.temperature_2m)) ? `${Math.round(Number(current.temperature_2m))}°C` : "";
  const weather = WETTER_CODES[current.weather_code] || "";
  const windSpeed = Number.isFinite(Number(current.wind_speed_10m)) ? `${Math.round(Number(current.wind_speed_10m))}km/h` : "";
  const windDir = windDirection(current.wind_direction_10m);
  return {
    wetter: [temp, weather].filter(Boolean).join(", "),
    wind: [windDir, windSpeed].filter(Boolean).join(", "),
  };
}

function geschlechtValue(value) {
  if (value === "m") return "männlich";
  if (value === "w") return "weiblich";
  return value || "";
}

function markerLetter(value, fallback) {
  const first = String(value || "").trim().match(/[\p{L}\p{N}]/u)?.[0];
  return (first || fallback).toLocaleUpperCase("de-DE");
}

const markerIcon = (type, item = null, archived = false) => {
  const size = archived ? 18 : 25;
  return L.divIcon({
    className: `pin ${type} ${type === "abschuss" ? WILDART_KLASSEN[item?.wildart] || "wild-sonstiges" : ""} ${archived ? "is-archived" : ""}`,
    html: `<span>${type === "kanzel" ? markerLetter(item?.name, "K") : markerLetter(item?.wildart, "A")}</span>`,
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
  const [loginError, setLoginError] = useState("");
  const [view, setView] = useState("map");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [createAt, setCreateAt] = useState(null);
  const [form, setForm] = useState(null);
  const [originPick, setOriginPick] = useState(null);
  const [selfPos, setSelfPos] = useState(null);
  const [listTab, setListTab] = useState("kanzeln");
  const [filters, setFilters] = useState({ q: "", showArchived: false, from: "", to: "" });

  const load = async () => setData(await api("/api/map-data"));

  useEffect(() => {
    load().catch(() => setData(null));
  }, []);

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
  };

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
      await load();
    } catch (error) {
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
        <button className="quiet" onClick={async () => { await api("/api/logout", { method: "POST" }); setData(null); }}>Abmelden</button>
      </header>

      {view === "map" ? (
        <MapScreen
          data={data}
          selected={selected}
          openSelection={openSelection}
          openCreate={openCreate}
          originPick={originPick}
          setOriginPick={setOriginPick}
          selfPos={selfPos}
          setSelfPos={setSelfPos}
          openSettings={openSettings}
        />
      ) : (
        <ListScreen data={data} tab={listTab} setTab={setListTab} filters={filters} setFilters={setFilters} setView={setView} openSelection={openSelection} load={load} />
      )}

      {settingsOpen && !originPick && <SettingsPanel data={data} load={load} close={() => setSettingsOpen(false)} />}
      {activeSelected && !originPick && <DetailPanel data={data} selected={selected} item={activeSelected} close={() => setSelected(null)} load={load} openForm={openForm} />}
      {createAt && <CreateWindow point={createAt} close={() => setCreateAt(null)} openForm={openForm} />}
      {form && <ObjectForm key={formKey(form)} data={data} form={form} originPick={originPick} setOriginPick={setOriginPick} close={() => { setForm(null); setOriginPick(null); }} load={async () => { await load(); setForm(null); setOriginPick(null); }} />}

    </div>
  );
}

function Login({ error, onLogin }) {
  const [name, setName] = useState("");
  const [passwort, setPasswort] = useState("");
  return (
    <main className="login">
      <form onSubmit={(e) => { e.preventDefault(); onLogin({ name, passwort }); }}>
        <h1>Jagd</h1>
        <label>Reviername<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" /></label>
        <label>Revierpasswort<input value={passwort} onChange={(e) => setPasswort(e.target.value)} type="password" autoComplete="current-password" /></label>
        <button className="primary" type="submit">Anmelden</button>
        <p className="error">{error}</p>
      </form>
    </main>
  );
}

function MapScreen({ data, selected, openSelection, openCreate, originPick, setOriginPick, selfPos, setSelfPos, openSettings }) {
  const visible = useVisibleData(data);
  const center = markerCenter([...visible.kanzeln, ...visible.abschuesse]);
  return (
    <main className="map-shell">
      <MapContainer center={center} zoom={14} zoomControl={false} className="map">
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapEvents openCreate={openCreate} originPick={originPick} setOriginPick={setOriginPick} />
        <MapTools setSelfPos={setSelfPos} />
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
        {Number(data.settings.show_abschuesse) ? visible.abschuesse.map((abschuss) => (
          <Marker
            key={abschuss.id}
            position={[abschuss.position_lat, abschuss.position_lng]}
            icon={markerIcon("abschuss", abschuss, abschuss.status === "archiviert")}
            eventHandlers={{ click: () => openSelection({ type: "abschuss", id: abschuss.id }) }}
          />
        )) : null}
        {originPick?.origin?.lat ? <Marker position={[originPick.origin.lat, originPick.origin.lng]} icon={originIcon} /> : null}
        {selfPos && Number(data.settings.show_self_location) ? <Marker position={selfPos} icon={L.divIcon({ className: "self-marker", html: "", iconSize: [18, 18], iconAnchor: [9, 9] })} /> : null}
      </MapContainer>
      <button className="map-settings icon-button" type="button" onClick={openSettings} title="Einstellungen"><Settings size={18} /></button>
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
        const secureError = /secure|https|http/i.test(err.message || "");
        setError(secureError ? "Browser blockiert Position über HTTP" : err.code === 1 ? "Erlaubnis fehlt" : "Position nicht gefunden");
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
  return <Polyline positions={[[origin.lat, origin.lng], [target.lat, target.lng]]} pathOptions={{ color: "#8f2f2f", weight: 3, opacity: 0.78, dashArray: "7 7", lineCap: "round" }} />;
}

function PickTarget({ originPick }) {
  const target = originPick.target;
  const origin = originPick.origin;
  return (
    <>
      <Marker position={[target.lat, target.lng]} icon={markerIcon("abschuss")} />
      {origin ? <Polyline positions={[[Number(origin.lat), Number(origin.lng)], [Number(target.lat), Number(target.lng)]]} pathOptions={{ color: "#8f2f2f", weight: 3, opacity: 0.9, dashArray: "7 7", lineCap: "round" }} /> : null}
    </>
  );
}

function FlyToSelection({ data, selected }) {
  const map = useMap();
  useEffect(() => {
    const item = findObject(data, selected);
    if (item) map.flyTo([item.position_lat, item.position_lng], Math.max(map.getZoom(), 15), { duration: 0.35 });
  }, [selected?.id]);
  return null;
}

function SettingsPanel({ data, load, close }) {
  const save = async (key, value) => {
    await api("/api/settings", { method: "POST", body: { [key]: value } });
    await load();
  };
  const s = data.settings;
  const clearFrom = useLongPressClear(() => save("map_date_filter_from", ""));
  const clearTo = useLongPressClear(() => save("map_date_filter_to", ""));
  return (
    <div className="overlay">
      <section className="modal small">
        <header><h2><Layers size={18} /> Einstellungen</h2><button type="button" onClick={close}><X size={18} /></button></header>
        {[
          ["show_self_location", "Eigene Position"],
          ["show_kanzeln", "Kanzeln"],
          ["show_abschuesse", "Abschüsse"],
          ["show_archived", "Archivierte"],
        ].map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(Number(s[key]))} onChange={(e) => save(key, e.target.checked)} />{label}</label>)}
        <div className="two">
          <label>Von<input type="date" value={s.map_date_filter_from || ""} onChange={(e) => save("map_date_filter_from", e.target.value)} {...clearFrom} /></label>
          <label>Bis<input type="date" value={s.map_date_filter_to || ""} onChange={(e) => save("map_date_filter_to", e.target.value)} {...clearTo} /></label>
        </div>
      </section>
    </div>
  );
}

function CreateWindow({ point, close, openForm }) {
  return (
    <div className="overlay">
      <section className="modal small">
        <header><h2>Erstellen</h2><button type="button" onClick={close}><X size={18} /></button></header>
        <button type="button" className="choice" onClick={() => openForm({ type: "kanzel", point })}>Kanzel</button>
        <button type="button" className="choice" onClick={() => openForm({ type: "abschuss", point })}>Abschuss</button>
      </section>
    </div>
  );
}

function initialFormValues(form) {
  const item = form.item || {};
  if (form.type === "kanzel") {
    return {
      name: item.name || "",
      typ: item.typ || "",
      notiz: item.notiz || "",
    };
  }
  return {
    datum: item.datum || today(),
    uhrzeit: item.uhrzeit || (form.item ? "" : currentTime()),
    wildart: item.wildart || "",
    geschlecht: geschlechtValue(item.geschlecht),
    alter_text: item.alter_text || "",
    schuetz_name: item.schuetz_name || "",
    gewicht_kg: item.gewicht_kg ?? "",
    wetter: item.wetter || "",
    wind: item.wind || formatWind(item),
    schuss_lat: item.schuss_lat ?? "",
    schuss_lng: item.schuss_lng ?? "",
    schuss_kanzel_id: item.schuss_kanzel_id || "",
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
  const formId = useRef(form.id || localId()).current;
  const autofillStarted = useRef(false);
  const [originLabel, setOriginLabel] = useState(() => initialOriginLabel(form.item));
  const [values, setValues] = useState(() => initialFormValues(form));
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const origin = originPick?.formId === formId ? originPick.origin : null;
  const picking = originPick?.formId === formId && !originPick.origin;
  const editing = form.mode === "edit";

  useEffect(() => {
    if (form.type !== "abschuss" || editing || autofillStarted.current) return undefined;
    autofillStarted.current = true;
    setValues((current) => ({
      ...current,
      datum: current.datum || today(),
      uhrzeit: current.uhrzeit || currentTime(),
    }));
    const controller = new AbortController();
    autofillWeather(form.point, controller.signal)
      .then((next) => {
        if (!next) return;
        setValues((current) => ({
          ...current,
          wetter: current.wetter || next.wetter,
          wind: current.wind || next.wind,
        }));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [editing, form.point, form.type]);

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
      const path = form.type === "kanzel" ? "/api/kanzeln" : "/api/abschuesse";
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
        <header><h2>{form.type === "kanzel" ? "Kanzel" : "Abschuss"}{editing ? " bearbeiten" : ""}</h2><button type="button" onClick={close}><X size={18} /></button></header>
        {form.type === "kanzel" ? (
          <>
            <label>Name<input required value={values.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label>Typ<input value={values.typ} onChange={(e) => set("typ", e.target.value)} /></label>
            <label>Bemerkungen<textarea value={values.notiz} onChange={(e) => set("notiz", e.target.value)} /></label>
          </>
        ) : (
          <>
            <div className="two">
              <label>Wildart<select required value={values.wildart} onChange={(e) => set("wildart", e.target.value)}><option value="">Auswählen</option>{WILDARTEN.map((wildart) => <option key={wildart} value={wildart}>{wildart}</option>)}</select></label>
              <label>Geschlecht<select value={values.geschlecht} onChange={(e) => set("geschlecht", e.target.value)}><option value="">offen</option><option value="männlich">männlich</option><option value="weiblich">weiblich</option></select></label>
            </div>
            <div className="two">
              <label>Alter (Jahre)<input inputMode="decimal" value={values.alter_text} onChange={(e) => set("alter_text", e.target.value)} /></label>
              <label>Gewicht (kg)<input inputMode="decimal" value={values.gewicht_kg} onChange={(e) => set("gewicht_kg", e.target.value)} /></label>
            </div>
            <div className="two">
              <label>Zeitpunkt<input type="datetime-local" value={dateTimeValue(values.datum, values.uhrzeit)} onChange={(e) => setValues((current) => ({ ...current, ...splitDateTime(e.target.value) }))} /></label>
              <label>Schütze<input list="schuetzen" value={values.schuetz_name} onChange={(e) => set("schuetz_name", e.target.value)} /></label>
            </div>
            <datalist id="schuetzen">{data.schuetzen.map((name) => <option key={name} value={name} />)}</datalist>
            <div className="two">
              <label>Wetter<input value={values.wetter} onChange={(e) => set("wetter", e.target.value)} /></label>
              <label>Wind<input value={values.wind} onChange={(e) => set("wind", e.target.value)} /></label>
            </div>
            <label>Schussort<select value="" onChange={(e) => {
              const kanzel = data.kanzeln.find((item) => item.id === e.target.value);
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
              <button type="button" className={originLabel === "Punkt gewählt" ? "chosen" : ""} onClick={() => setOriginPick({ formId, target: form.point, origin: null })}>Schussursprung frei wählen</button>
            </div>
            <label>Bemerkungen<textarea value={values.notiz} onChange={(e) => set("notiz", e.target.value)} /></label>
          </>
        )}
        <p className="error">{error}</p>
        <button className="primary" type="submit" disabled={saving}>{saving ? "Speichert..." : "Speichern"}</button>
      </form>
    </div>
  );
}

function DetailPanel({ data, selected, item, close, load, openForm }) {
  const archive = async () => {
    await api(`/api/${apiName(selected.type)}/${item.id}`, { method: "PATCH", body: { status: item.status === "archiviert" ? "aktiv" : "archiviert" } });
    await load();
  };
  const del = async () => {
    await api(`/api/${apiName(selected.type)}/${item.id}`, { method: "DELETE" });
    close();
    await load();
  };
  return (
    <aside className="detail">
      <header><h2>{item.name || item.wildart}</h2><button type="button" onClick={close}><X size={18} /></button></header>
      {item.status === "archiviert" ? <p className="muted">Archiviert</p> : null}
      <Rows selected={selected} item={item} data={data} />
      {item.notiz ? <p>{item.notiz}</p> : null}
      <div className="actions">
        <button type="button" onClick={() => openForm({ type: selected.type, mode: "edit", item, point: { lat: item.position_lat, lng: item.position_lng } })}>Bearbeiten</button>
        <button type="button" onClick={archive}>{item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button>
        <button type="button" className="danger" onClick={del}><Trash2 size={16} />Löschen</button>
      </div>
    </aside>
  );
}

function Rows({ selected, item, data }) {
  const origin = selected.type === "abschuss" ? shotOrigin(item, data) : null;
  const distance = selected.type === "abschuss" ? shotDistance(item, data) : null;
  if (selected.type === "abschuss") {
    return (
      <dl>
        <dt>Wildart</dt><dd>{item.wildart}</dd>
        <dt>Geschlecht</dt><dd>{geschlechtValue(item.geschlecht) || "-"}</dd>
        <dt>Alter</dt><dd>{item.alter_text ? `${item.alter_text} Jahre` : "-"}</dd>
        <dt>Gewicht</dt><dd>{item.gewicht_kg !== null && item.gewicht_kg !== undefined ? `${item.gewicht_kg} kg` : "-"}</dd>
        <dt>Zeitpunkt</dt><dd>{dateTimeText(item)}</dd>
        <dt>Schütze</dt><dd>{item.schuetz_name || "-"}</dd>
        <dt>Wetter</dt><dd>{item.wetter || "-"}</dd>
        <dt>Wind</dt><dd>{item.wind || formatWind(item) || "-"}</dd>
        <dt>Schuss</dt><dd>{origin ? `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)} (${distance} m)` : "-"}</dd>
        <dt>Position</dt><dd>{positionText(item)}</dd>
      </dl>
    );
  }
  return <dl><dt>Name</dt><dd>{item.name}</dd><dt>Typ</dt><dd>{item.typ || "-"}</dd><dt>Position</dt><dd>{positionText(item)}</dd></dl>;
}

function ListScreen({ data, tab, setTab, filters, setFilters, setView, openSelection, load }) {
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
  const toggleArchive = async (item) => {
    await api(`/api/${tab}/${item.id}`, { method: "PATCH", body: { status: item.status === "archiviert" ? "aktiv" : "archiviert" } });
    await load();
  };
  return (
    <main className="list-screen">
      <nav className="tabs wide">{["kanzeln", "abschuesse"].map((t) => <button type="button" key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{label(t)}</button>)}</nav>
      <div className="filters">
        <label>Suchen<input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
        <label className="check list-toggle"><input type="checkbox" checked={filters.showArchived} onChange={(e) => setFilters({ ...filters, showArchived: e.target.checked })} />Archivierte anzeigen</label>
        {tab === "abschuesse" ? <label>Von<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} {...clearFrom} /></label> : null}
        {tab === "abschuesse" ? <label>Bis<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} {...clearTo} /></label> : null}
      </div>
      <section className="rows">{items.map((item) => <article key={item.id} className={item.status === "archiviert" ? "is-archived" : ""}>
        <div><strong>{item.name || item.wildart}{item.status === "archiviert" ? <em>Archiviert</em> : null}</strong><span>{rowMeta(tab, item, data)}</span></div>
        <div className="row-actions">
          <button type="button" onClick={() => { openSelection({ type: singular(tab), id: item.id }); setView("map"); }}>Karte</button>
          <button type="button" onClick={() => toggleArchive(item)}>{item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button>
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
  return type === "kanzel" ? "kanzeln" : "abschuesse";
}

function formKey(form) {
  const point = form.point ? `${form.point.lat}:${form.point.lng}` : "nopoint";
  return `${form.mode || "neu"}:${form.type}:${form.item?.id || point}`;
}

function singular(tab) {
  return tab === "kanzeln" ? "kanzel" : "abschuss";
}

function label(tab) {
  return tab === "kanzeln" ? "Kanzeln" : "Abschüsse";
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
