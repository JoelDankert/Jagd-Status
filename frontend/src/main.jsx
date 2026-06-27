import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Layers, List, LocateFixed, Map as MapIcon, Plus, Settings, Trash2, X } from "lucide-react";
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
const WILDARTEN = [
  "Reh",
  "Bock",
  "Schmalreh",
  "Kitz",
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

function geschlechtValue(value) {
  if (value === "m") return "männlich";
  if (value === "w") return "weiblich";
  return value || "";
}

function markerLetter(value, fallback) {
  const first = String(value || "").trim().match(/[\p{L}\p{N}]/u)?.[0];
  return (first || fallback).toLocaleUpperCase("de-DE");
}

const markerIcon = (type, item = null, archived = false) => L.divIcon({
  className: `pin ${type} ${archived ? "is-archived" : ""}`,
  html: `<span>${type === "kanzel" ? markerLetter(item?.typ, "K") : markerLetter(item?.wildart, "A")}</span>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const originIcon = L.divIcon({
  className: "origin-pin",
  html: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function localId() {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const [filters, setFilters] = useState({ q: "", status: "alle", from: "", to: "" });

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
    <div className="app">
      <header className="top">
        <strong>{data.revier.name}</strong>
        <nav className="tabs">
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><MapIcon size={17} />Karte</button>
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={17} />Liste</button>
        </nav>
        <button className="icon-button" onClick={() => setSettingsOpen((v) => !v)} title="Einstellungen"><Settings size={18} /></button>
        <button className="quiet" onClick={async () => { await api("/api/logout", { method: "POST" }); setData(null); }}>Abmelden</button>
      </header>

      {view === "map" ? (
        <MapScreen
          data={data}
          selected={selected}
          setSelected={setSelected}
          setCreateAt={setCreateAt}
          originPick={originPick}
          setOriginPick={setOriginPick}
          selfPos={selfPos}
          setSelfPos={setSelfPos}
        />
      ) : (
        <ListScreen data={data} tab={listTab} setTab={setListTab} filters={filters} setFilters={setFilters} setView={setView} setSelected={setSelected} />
      )}

      {settingsOpen && !originPick && <SettingsPanel data={data} load={load} />}
      {activeSelected && !originPick && <DetailPanel data={data} selected={selected} item={activeSelected} close={() => setSelected(null)} load={load} openForm={setForm} />}
      {createAt && <CreateWindow point={createAt} close={() => setCreateAt(null)} openForm={(next) => { setCreateAt(null); setForm(next); }} />}
      {form && <ObjectForm key={formKey(form)} data={data} form={form} originPick={originPick} setOriginPick={setOriginPick} close={() => { setForm(null); setOriginPick(null); }} load={async () => { await load(); setForm(null); setOriginPick(null); }} />}
      {originPick && <div className="pick-hint">Schussursprung wählen</div>}
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

function MapScreen({ data, selected, setSelected, setCreateAt, originPick, setOriginPick, selfPos, setSelfPos }) {
  const visible = useVisibleData(data);
  const first = visible.kanzeln[0] || visible.abschuesse[0];
  const center = first ? [first.position_lat, first.position_lng] : [51.1657, 10.4515];
  return (
    <main className="map-shell">
      <MapContainer center={center} zoom={14} zoomControl={false} className="map">
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapEvents setCreateAt={setCreateAt} originPick={originPick} setOriginPick={setOriginPick} />
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
                else setSelected({ type: "kanzel", id: kanzel.id });
              },
            }}
          />
        )) : null}
        {Number(data.settings.show_abschuesse) ? visible.abschuesse.map((abschuss) => (
          <Marker
            key={abschuss.id}
            position={[abschuss.position_lat, abschuss.position_lng]}
            icon={markerIcon("abschuss", abschuss, abschuss.status === "archiviert")}
            eventHandlers={{ click: () => setSelected({ type: "abschuss", id: abschuss.id }) }}
          />
        )) : null}
        {originPick?.origin?.lat ? <Marker position={[originPick.origin.lat, originPick.origin.lng]} icon={originIcon} /> : null}
        {selfPos && Number(data.settings.show_self_location) ? <Marker position={selfPos} icon={L.divIcon({ className: "self-marker", html: "", iconSize: [18, 18], iconAnchor: [9, 9] })} /> : null}
        {selected && <FlyToSelection data={data} selected={selected} />}
      </MapContainer>
      <button className="fab" type="button" onClick={() => setCreateAt({ lat: center[0], lng: center[1] })}><Plus size={22} /></button>
    </main>
  );
}

function MapEvents({ setCreateAt, originPick, setOriginPick }) {
  const timer = useRef(null);
  useMapEvents({
    contextmenu(e) {
      if (originPick) setOriginPick({ ...originPick, origin: { type: "point", lat: e.latlng.lat, lng: e.latlng.lng } });
      else setCreateAt(e.latlng);
    },
    click(e) {
      if (originPick) setOriginPick({ ...originPick, origin: { type: "point", lat: e.latlng.lat, lng: e.latlng.lng } });
    },
    mousedown(e) {
      if (originPick) return;
      timer.current = setTimeout(() => setCreateAt(e.latlng), 700);
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
  return <Polyline positions={[[origin.lat, origin.lng], [abschuss.position_lat, abschuss.position_lng]]} pathOptions={{ color: "#8f2f2f", weight: 3, opacity: 0.78, dashArray: "7 7" }} />;
}

function PickTarget({ originPick }) {
  const target = originPick.target;
  const origin = originPick.origin;
  return (
    <>
      <Marker position={[target.lat, target.lng]} icon={markerIcon("abschuss")} />
      {origin ? <Polyline positions={[[origin.lat, origin.lng], [target.lat, target.lng]]} pathOptions={{ color: "#8f2f2f", weight: 3, opacity: 0.9, dashArray: "7 7" }} /> : null}
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

function SettingsPanel({ data, load }) {
  const save = async (key, value) => {
    await api("/api/settings", { method: "POST", body: { [key]: value } });
    await load();
  };
  const s = data.settings;
  return (
    <aside className="settings-panel">
      <h2><Layers size={18} /> Einstellungen</h2>
      {[
        ["show_self_location", "Eigene Position"],
        ["show_kanzeln", "Kanzeln"],
        ["show_abschuesse", "Abschüsse"],
        ["show_archived", "Archivierte"],
        ["show_reviergrenze", "Grenze"],
      ].map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(Number(s[key]))} onChange={(e) => save(key, e.target.checked)} />{label}</label>)}
      <div className="two">
        <label>Von<input type="date" value={s.map_date_filter_from || ""} onChange={(e) => save("map_date_filter_from", e.target.value)} /></label>
        <label>Bis<input type="date" value={s.map_date_filter_to || ""} onChange={(e) => save("map_date_filter_to", e.target.value)} /></label>
      </div>
    </aside>
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
    wildart: item.wildart || "",
    geschlecht: geschlechtValue(item.geschlecht),
    schuetz_name: item.schuetz_name || "",
    gewicht_kg: item.gewicht_kg ?? "",
    kanzel_id: item.kanzel_id || "",
    schuss_lat: item.schuss_lat ?? "",
    schuss_lng: item.schuss_lng ?? "",
    schuss_kanzel_id: item.schuss_kanzel_id || "",
    notiz: item.notiz || "",
  };
}

function initialOriginLabel(item) {
  if (!item) return "";
  if (item.schuss_kanzel_id) return "Kanzel gewählt";
  if (item.schuss_lat !== null && item.schuss_lng !== null && item.schuss_lat !== undefined && item.schuss_lng !== undefined) return "Punkt gewählt";
  return "";
}

function ObjectForm({ data, form, originPick, setOriginPick, close, load }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const formId = useRef(form.id || localId()).current;
  const [originLabel, setOriginLabel] = useState(() => initialOriginLabel(form.item));
  const [values, setValues] = useState(() => initialFormValues(form));
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const origin = originPick?.formId === formId ? originPick.origin : null;
  const picking = originPick?.formId === formId && !originPick.origin;
  const editing = form.mode === "edit";

  useEffect(() => {
    if (!origin) return;
    setOriginLabel(origin.type === "kanzel" ? "Kanzel gewählt" : "Punkt gewählt");
    setValues((current) => ({
      ...current,
      schuss_lat: origin.lat ?? "",
      schuss_lng: origin.lng ?? "",
      schuss_kanzel_id: origin.type === "kanzel" ? origin.id : "",
    }));
    setOriginPick(null);
  }, [origin?.lat, origin?.lng, origin?.id, origin?.type, setOriginPick]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = { ...values, position_lat: form.point.lat, position_lng: form.point.lng };
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
            <label>Notiz<textarea value={values.notiz} onChange={(e) => set("notiz", e.target.value)} /></label>
          </>
        ) : (
          <>
            <label>Datum<input required type="date" value={values.datum} onChange={(e) => set("datum", e.target.value)} /></label>
            <div className="two">
              <label>Wildart<select required value={values.wildart} onChange={(e) => set("wildart", e.target.value)}><option value="">Auswählen</option>{WILDARTEN.map((wildart) => <option key={wildart} value={wildart}>{wildart}</option>)}</select></label>
              <label>Geschlecht<select value={values.geschlecht} onChange={(e) => set("geschlecht", e.target.value)}><option value="">Offen</option><option value="männlich">männlich</option><option value="weiblich">weiblich</option></select></label>
            </div>
            <div className="two">
              <label>Schütze<input required list="schuetzen" value={values.schuetz_name} onChange={(e) => set("schuetz_name", e.target.value)} /></label>
              <label>Gewicht (kg)<input type="number" min="0" step="0.1" inputMode="decimal" value={values.gewicht_kg} onChange={(e) => set("gewicht_kg", e.target.value)} /></label>
            </div>
            <datalist id="schuetzen">{data.schuetzen.map((name) => <option key={name} value={name} />)}</datalist>
            <label>Kanzel<select value={values.kanzel_id} onChange={(e) => set("kanzel_id", e.target.value)}><option value="">Keine</option>{data.kanzeln.map((kanzel) => <option key={kanzel.id} value={kanzel.id}>{kanzel.name}</option>)}</select></label>
            <div className="origin-row">
              <button type="button" onClick={() => setOriginPick({ formId, target: form.point, origin: null })}>Schussursprung wählen</button>
              <span>{originLabel || "frei"}</span>
            </div>
            <label>Notiz<textarea value={values.notiz} onChange={(e) => set("notiz", e.target.value)} /></label>
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
      <p className="muted">{item.status === "archiviert" ? "Archiviert" : "Aktiv"}</p>
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
  const kanzel = item.kanzel_id ? data.kanzeln.find((k) => k.id === item.kanzel_id) : null;
  const origin = selected.type === "abschuss" ? shotOrigin(item, data) : null;
  if (selected.type === "abschuss") {
    return (
      <dl>
        <dt>Datum</dt><dd>{item.datum}</dd>
        <dt>Wildart</dt><dd>{item.wildart}</dd>
        <dt>Geschlecht</dt><dd>{geschlechtValue(item.geschlecht) || "-"}</dd>
        <dt>Schütze</dt><dd>{item.schuetz_name}</dd>
        <dt>Gewicht</dt><dd>{item.gewicht_kg !== null && item.gewicht_kg !== undefined ? `${item.gewicht_kg} kg` : "-"}</dd>
        <dt>Kanzel</dt><dd>{kanzel?.name || "-"}</dd>
        <dt>Schuss</dt><dd>{origin ? `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}` : "-"}</dd>
      </dl>
    );
  }
  return <dl><dt>Typ</dt><dd>{item.typ || "-"}</dd><dt>Position</dt><dd>{Number(item.position_lat).toFixed(5)}, {Number(item.position_lng).toFixed(5)}</dd></dl>;
}

function ListScreen({ data, tab, setTab, filters, setFilters, setView, setSelected }) {
  const items = data[tab].filter((item) => {
    const q = filters.q.toLowerCase();
    const statusOk = filters.status === "alle" || item.status === filters.status;
    const dateOk = tab !== "abschuesse" || ((!filters.from || item.datum >= filters.from) && (!filters.to || item.datum <= filters.to));
    return statusOk && dateOk && (!q || JSON.stringify(item).toLowerCase().includes(q));
  });
  return (
    <main className="list-screen">
      <nav className="tabs wide">{["kanzeln", "abschuesse"].map((t) => <button type="button" key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{label(t)}</button>)}</nav>
      <div className="filters">
        <input placeholder="Suchen" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="alle">Alle</option><option value="aktiv">Aktiv</option><option value="archiviert">Archiviert</option></select>
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>
      <section className="rows">{items.map((item) => <article key={item.id}>
        <div><strong>{item.name || item.wildart}</strong><span>{rowMeta(tab, item)}</span></div>
        <button type="button" onClick={() => { setSelected({ type: singular(tab), id: item.id }); setView("map"); }}>Karte</button>
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

function rowMeta(tab, item) {
  if (tab === "abschuesse") return `${item.datum} · ${item.wildart}${item.geschlecht ? ` · ${geschlechtValue(item.geschlecht)}` : ""} · ${item.schuetz_name}${item.gewicht_kg !== null && item.gewicht_kg !== undefined ? ` · ${item.gewicht_kg} kg` : ""}`;
  return item.typ || `${Number(item.position_lat).toFixed(5)}, ${Number(item.position_lng).toFixed(5)}`;
}

function Root() {
  return <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
