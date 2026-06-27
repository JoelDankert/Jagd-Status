import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Crosshair, Eye, Layers, List, LocateFixed, Map as MapIcon, Plus, Settings, Trash2, X } from "lucide-react";
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
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};
const seasonStart = () => {
  const d = new Date();
  return `${d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1}-04-01`;
};

const icon = (kind, archived = false) => L.divIcon({
  className: `pin ${kind} ${archived ? "is-archived" : ""}`,
  html: `<span>${kind === "standort" ? "S" : kind === "kanzel" ? "K" : "A"}</span>`,
  iconSize: [34, 42],
  iconAnchor: [17, 40],
});

function App() {
  const [data, setData] = useState(null);
  const [loginError, setLoginError] = useState("");
  const [view, setView] = useState("map");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [createAt, setCreateAt] = useState(null);
  const [form, setForm] = useState(null);
  const [selfPos, setSelfPos] = useState(null);
  const [listTab, setListTab] = useState("standorte");
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
        <button className="icon-button" onClick={() => setSettingsOpen((v) => !v)} title="Settings"><Settings size={18} /></button>
        <button className="quiet" onClick={async () => { await api("/api/logout", { method: "POST" }); setData(null); }}>Logout</button>
      </header>

      {view === "map" ? (
        <MapScreen
          data={data}
          selected={selected}
          setSelected={setSelected}
          setCreateAt={setCreateAt}
          settingsOpen={settingsOpen}
          load={load}
          selfPos={selfPos}
          setSelfPos={setSelfPos}
        />
      ) : (
        <ListScreen data={data} tab={listTab} setTab={setListTab} filters={filters} setFilters={setFilters} setView={setView} setSelected={setSelected} />
      )}

      {settingsOpen && <SettingsPanel data={data} load={load} />}
      {activeSelected && <DetailPanel data={data} selected={selected} item={activeSelected} close={() => setSelected(null)} load={load} openForm={setForm} />}
      {createAt && <CreateWindow data={data} point={createAt} selected={selected} close={() => setCreateAt(null)} openForm={(next) => { setCreateAt(null); setForm(next); }} />}
      {form && <ObjectForm data={data} form={form} close={() => setForm(null)} load={async () => { await load(); setForm(null); }} />}
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
        <button className="primary">Anmelden</button>
        <p className="error">{error}</p>
      </form>
    </main>
  );
}

function MapScreen({ data, selected, setSelected, setCreateAt, selfPos, setSelfPos }) {
  const visible = useVisibleData(data);
  const center = visible.standorte[0] ? [visible.standorte[0].position_lat, visible.standorte[0].position_lng] : [51.1657, 10.4515];
  return (
    <main className="map-shell">
      <MapContainer center={center} zoom={14} zoomControl={false} className="map">
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapEvents setCreateAt={setCreateAt} />
        <MapTools selfPos={selfPos} setSelfPos={setSelfPos} />
        {Number(data.settings.show_standorte) ? visible.standorte.map((s) => (
          <Marker key={s.id} position={[s.position_lat, s.position_lng]} icon={icon("standort", s.status === "archiviert")} eventHandlers={{ click: () => setSelected({ type: "standort", id: s.id }) }} />
        )) : null}
        {Number(data.settings.show_kanzeln) ? visible.kanzeln.map((k) => {
          const s = data.standorte.find((x) => x.id === k.standort_id);
          if (!s) return null;
          return <Marker key={k.id} position={[s.position_lat, s.position_lng]} icon={icon("kanzel", k.status === "archiviert")} eventHandlers={{ click: () => setSelected({ type: "kanzel", id: k.id }) }} />;
        }) : null}
        {Number(data.settings.show_abschuesse) ? visible.abschuesse.map((a) => (
          <Marker key={a.id} position={[a.position_lat, a.position_lng]} icon={icon("abschuss", a.status === "archiviert")} eventHandlers={{ click: () => setSelected({ type: "abschuss", id: a.id }) }} />
        )) : null}
        {selfPos && Number(data.settings.show_self_location) ? <Marker position={selfPos} icon={L.divIcon({ className: "self-marker", html: "", iconSize: [18, 18] })} /> : null}
        {selected && <FlyToSelection data={data} selected={selected} />}
      </MapContainer>
      <button className="fab" onClick={() => setCreateAt({ lat: center[0], lng: center[1] })}><Plus size={22} /></button>
    </main>
  );
}

function MapEvents({ setCreateAt }) {
  const timer = React.useRef(null);
  useMapEvents({
    contextmenu(e) {
      setCreateAt(e.latlng);
    },
    mousedown(e) {
      timer.current = setTimeout(() => setCreateAt(e.latlng), 650);
    },
    mouseup() {
      clearTimeout(timer.current);
    },
    dragstart() {
      clearTimeout(timer.current);
    },
    touchstart(e) {
      timer.current = setTimeout(() => setCreateAt(e.latlng), 700);
    },
    touchend() {
      clearTimeout(timer.current);
    },
    zoomstart() {
      clearTimeout(timer.current);
    },
    movestart() {
      clearTimeout(timer.current);
    },
  });
  return null;
}

function MapTools({ selfPos, setSelfPos }) {
  const map = useMap();
  return (
    <div className="map-tools">
      <button onClick={() => map.zoomIn()} title="Vergrößern">+</button>
      <button onClick={() => map.zoomOut()} title="Verkleinern">-</button>
      <button onClick={() => navigator.geolocation?.getCurrentPosition((p) => {
        const next = [p.coords.latitude, p.coords.longitude];
        setSelfPos(next);
        map.flyTo(next, Math.max(map.getZoom(), 15));
      })} title="Position"><LocateFixed size={17} /></button>
      {selfPos ? <button onClick={() => map.flyTo(selfPos, 15)} title="Zentrieren"><Crosshair size={17} /></button> : null}
    </div>
  );
}

function FlyToSelection({ data, selected }) {
  const map = useMap();
  useEffect(() => {
    const item = findObject(data, selected);
    if (!item) return;
    let point = item;
    if (selected.type === "kanzel") point = data.standorte.find((s) => s.id === item.standort_id);
    if (point) map.flyTo([point.position_lat, point.position_lng], Math.max(map.getZoom(), 15), { duration: 0.4 });
  }, [selected?.id]);
  return null;
}

function SettingsPanel({ data, load }) {
  const save = async (key, value) => {
    await api("/api/settings", { method: "POST", body: { [key]: value } });
    await load();
  };
  const range = async (kind) => {
    const body = kind === "today" ? { map_date_filter_from: today(), map_date_filter_to: today() }
      : kind === "week" ? { map_date_filter_from: shift(-6), map_date_filter_to: today() }
      : kind === "month" ? { map_date_filter_from: monthStart(), map_date_filter_to: today() }
      : kind === "season" ? { map_date_filter_from: seasonStart(), map_date_filter_to: today() }
      : { map_date_filter_from: "", map_date_filter_to: "" };
    await api("/api/settings", { method: "POST", body });
    await load();
  };
  const s = data.settings;
  return (
    <aside className="settings-panel">
      <h2><Layers size={18} /> Settings</h2>
      {[
        ["show_self_location", "Position"],
        ["show_standorte", "Standorte"],
        ["show_kanzeln", "Kanzeln"],
        ["show_abschuesse", "Abschüsse"],
        ["show_archived", "Archiv"],
        ["show_reviergrenze", "Grenze"],
      ].map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(Number(s[key]))} onChange={(e) => save(key, e.target.checked)} />{label}</label>)}
      <div className="chips">
        <button onClick={() => range("today")}>Heute</button>
        <button onClick={() => range("week")}>7 Tage</button>
        <button onClick={() => range("month")}>Monat</button>
        <button onClick={() => range("season")}>Saison</button>
        <button onClick={() => range("all")}>Alle</button>
      </div>
      <div className="two">
        <label>Von<input type="date" value={s.map_date_filter_from || ""} onChange={(e) => save("map_date_filter_from", e.target.value)} /></label>
        <label>Bis<input type="date" value={s.map_date_filter_to || ""} onChange={(e) => save("map_date_filter_to", e.target.value)} /></label>
      </div>
    </aside>
  );
}

function CreateWindow({ data, point, selected, close, openForm }) {
  const standort = selected?.type === "standort" ? findObject(data, selected) : null;
  return (
    <div className="overlay">
      <section className="modal small">
        <header><h2>Erstellen</h2><button onClick={close}><X size={18} /></button></header>
        <button className="choice" onClick={() => openForm({ type: "standort", point })}>Standort</button>
        <button className="choice" onClick={() => openForm({ type: "abschuss", point, standortId: standort?.id || "" })}>Abschuss</button>
        {standort ? <button className="choice" onClick={() => openForm({ type: "kanzel", point, standortId: standort.id })}>Kanzel</button> : null}
      </section>
    </div>
  );
}

function ObjectForm({ data, form, close, load }) {
  const [error, setError] = useState("");
  const [values, setValues] = useState(() => ({
    datum: today(),
    standort_id: form.standortId || "",
    kanzel_id: "",
  }));
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { ...values, position_lat: form.point.lat, position_lng: form.point.lng };
      const path = form.type === "standort" ? "/api/standorte" : form.type === "kanzel" ? "/api/kanzeln" : "/api/abschuesse";
      await api(path, { method: "POST", body });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="overlay">
      <form className="modal" onSubmit={submit}>
        <header><h2>{form.type === "standort" ? "Standort" : form.type === "kanzel" ? "Kanzel" : "Abschuss"}</h2><button type="button" onClick={close}><X size={18} /></button></header>
        {form.type === "standort" && <>
          <label>Name<input required onChange={(e) => set("name", e.target.value)} /></label>
          <label>Notiz<textarea onChange={(e) => set("notiz", e.target.value)} /></label>
        </>}
        {form.type === "kanzel" && <>
          <label>Standort<SelectStandort data={data} value={values.standort_id} onChange={(v) => set("standort_id", v)} required /></label>
          <label>Name<input required onChange={(e) => set("name", e.target.value)} /></label>
          <label>Notiz<textarea onChange={(e) => set("notiz", e.target.value)} /></label>
        </>}
        {form.type === "abschuss" && <>
          <div className="two">
            <label>Datum<input required type="date" value={values.datum} onChange={(e) => set("datum", e.target.value)} /></label>
            <label>Wildart<input required onChange={(e) => set("wildart", e.target.value)} /></label>
          </div>
          <label>Schütze<input required list="schuetzen" onChange={(e) => set("schuetz_name", e.target.value)} /></label>
          <datalist id="schuetzen">{data.schuetzen.map((n) => <option key={n} value={n} />)}</datalist>
          <label>Standort<SelectStandort data={data} value={values.standort_id} onChange={(v) => set("standort_id", v)} /></label>
          <label>Kanzel<SelectKanzel data={data} standortId={values.standort_id} value={values.kanzel_id} onChange={(v) => set("kanzel_id", v)} /></label>
          <label>Notiz<textarea onChange={(e) => set("notiz", e.target.value)} /></label>
        </>}
        <p className="error">{error}</p>
        <button className="primary">Speichern</button>
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
  const standort = selected.type === "standort" ? item : data.standorte.find((s) => s.id === item.standort_id);
  return (
    <aside className="detail">
      <header><h2>{item.name || item.wildart}</h2><button onClick={close}><X size={18} /></button></header>
      <p className="muted">{item.status === "archiviert" ? "Archiviert" : "Aktiv"}</p>
      <Rows selected={selected} item={item} data={data} />
      {item.notiz ? <p>{item.notiz}</p> : null}
      <div className="actions">
        {selected.type === "standort" ? <>
          <button onClick={() => openForm({ type: "kanzel", point: { lat: item.position_lat, lng: item.position_lng }, standortId: item.id })}>Kanzel</button>
          <button onClick={() => openForm({ type: "abschuss", point: { lat: item.position_lat, lng: item.position_lng }, standortId: item.id })}>Abschuss</button>
        </> : null}
        <button onClick={archive}>{item.status === "archiviert" ? "Aktivieren" : "Archivieren"}</button>
        {selected.type !== "standort" ? <button className="danger" onClick={del}><Trash2 size={16} />Löschen</button> : null}
      </div>
      {selected.type === "standort" ? <Related data={data} standort={standort} /> : null}
    </aside>
  );
}

function Rows({ selected, item, data }) {
  const standort = item.standort_id ? data.standorte.find((s) => s.id === item.standort_id) : null;
  const kanzel = item.kanzel_id ? data.kanzeln.find((k) => k.id === item.kanzel_id) : null;
  if (selected.type === "abschuss") return <dl><dt>Datum</dt><dd>{item.datum}</dd><dt>Schütze</dt><dd>{item.schuetz_name}</dd><dt>Standort</dt><dd>{standort?.name || "-"}</dd><dt>Kanzel</dt><dd>{kanzel?.name || "-"}</dd></dl>;
  if (selected.type === "kanzel") return <dl><dt>Standort</dt><dd>{standort?.name || "-"}</dd></dl>;
  return <dl><dt>Position</dt><dd>{Number(item.position_lat).toFixed(5)}, {Number(item.position_lng).toFixed(5)}</dd></dl>;
}

function Related({ data, standort }) {
  const kanzeln = data.kanzeln.filter((k) => k.standort_id === standort.id);
  const abschuesse = data.abschuesse.filter((a) => a.standort_id === standort.id);
  return <div className="related">
    {kanzeln.length ? <><h3>Kanzeln</h3>{kanzeln.map((k) => <span key={k.id}>{k.name}</span>)}</> : null}
    {abschuesse.length ? <><h3>Abschüsse</h3>{abschuesse.map((a) => <span key={a.id}>{a.datum} · {a.wildart}</span>)}</> : null}
  </div>;
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
      <nav className="tabs wide">{["standorte", "kanzeln", "abschuesse"].map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{label(t)}</button>)}</nav>
      <div className="filters">
        <input placeholder="Suchen" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="alle">Alle</option><option value="aktiv">Aktiv</option><option value="archiviert">Archiviert</option></select>
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>
      <section className="rows">{items.map((item) => <article key={item.id}>
        <div><strong>{item.name || item.wildart}</strong><span>{rowMeta(tab, item, data)}</span></div>
        <button onClick={() => { setSelected({ type: singular(tab), id: item.id }); setView("map"); }}>Karte</button>
      </article>)}</section>
    </main>
  );
}

function SelectStandort({ data, value, onChange, required }) {
  return <select required={required} value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">Keiner</option>{data.standorte.filter((s) => s.status !== "archiviert").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
}

function SelectKanzel({ data, standortId, value, onChange }) {
  return <select value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">Keine</option>{data.kanzeln.filter((k) => !standortId || k.standort_id === standortId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>;
}

function useVisibleData(data) {
  return useMemo(() => {
    const archived = Number(data.settings.show_archived);
    const active = (item) => archived || item.status !== "archiviert";
    const date = (item) => (!data.settings.map_date_filter_from || item.datum >= data.settings.map_date_filter_from) && (!data.settings.map_date_filter_to || item.datum <= data.settings.map_date_filter_to);
    return {
      standorte: data.standorte.filter(active),
      kanzeln: data.kanzeln.filter(active),
      abschuesse: data.abschuesse.filter((a) => active(a) && date(a)),
    };
  }, [data]);
}

function findObject(data, selected) {
  if (!data || !selected) return null;
  return data[apiName(selected.type)].find((item) => item.id === selected.id) || null;
}
function apiName(type) { return type === "standort" ? "standorte" : type === "kanzel" ? "kanzeln" : "abschuesse"; }
function singular(tab) { return tab === "standorte" ? "standort" : tab === "kanzeln" ? "kanzel" : "abschuss"; }
function label(tab) { return tab === "standorte" ? "Standorte" : tab === "kanzeln" ? "Kanzeln" : "Abschüsse"; }
function rowMeta(tab, item, data) {
  if (tab === "abschuesse") return `${item.datum} · ${item.schuetz_name}`;
  if (tab === "kanzeln") return data.standorte.find((s) => s.id === item.standort_id)?.name || "-";
  return `${Number(item.position_lat).toFixed(5)}, ${Number(item.position_lng).toFixed(5)}`;
}

createRoot(document.getElementById("root")).render(<App />);
