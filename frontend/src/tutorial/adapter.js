const COLLECTIONS = { kanzeln: "kanzeln", kameras: "kameras", abschuesse: "abschuesse" };
const clone = (value) => structuredClone(value);
const NUMERIC_FIELDS = ["position_lat", "position_lng", "schuss_lat", "schuss_lng"];
const LINKED_ID_FIELDS = ["kanzel_id", "schuss_kanzel_id"];

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeItemBody(collectionName, body) {
  const normalized = { ...body };
  for (const field of NUMERIC_FIELDS) {
    if (field in normalized) normalized[field] = optionalNumber(normalized[field]);
  }
  if (collectionName === "abschuesse") {
    for (const field of LINKED_ID_FIELDS) {
      if (field in normalized) normalized[field] = optionalId(normalized[field]);
    }
  }
  return normalized;
}

function idsEqual(left, right) {
  return left !== null && left !== undefined && String(left) === String(right);
}

function demoError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function createTutorialStorage(storage = localStorage, prefix = "jagd-tutorial:") {
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, String(value)),
    removeItem: (key) => storage.removeItem(prefix + key),
    clear() {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) storage.removeItem(key);
      }
    },
  };
}

export function createTutorialAdapter(seed, { persist } = {}) {
  const original = clone(seed);
  let state = clone(seed);
  let counter = 0;
  const save = () => persist?.(clone(state));
  const snapshot = () => clone(state);
  const reset = () => { state = clone(original); save(); return snapshot(); };

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const body = clone(options.body || {});
    if (path === "/api/map-data" && method === "GET") return snapshot();
    if (path === "/api/settings" && method === "POST") {
      state.settings = { ...state.settings, ...body }; save(); return { ok: true };
    }
    if (path === "/api/revier" && method === "GET") return { revier: clone(state.revier) };
    if (path === "/api/revier" && method === "PATCH") {
      if (body.name) state.revier.name = String(body.name);
      save(); return { ok: true, demo: true };
    }
    if (path === "/api/revier/delete-request" && method === "POST") {
      return { ok: true, demo: true, message: "Im Demo-Modus wird keine Löschanfrage versendet." };
    }
    if (path === "/api/logout" && method === "POST") return { ok: true, demo: true };

    const match = path.match(/^\/api\/(kanzeln|kameras|abschuesse)(?:\/([^/]+))?$/);
    if (!match || !COLLECTIONS[match[1]]) throw demoError("Dieser Vorgang ist im Demo-Modus nicht verfügbar.", 404);
    const collection = state[match[1]];
    const itemId = match[2];
    if (method === "POST" && !itemId) {
      const now = new Date().toISOString();
      const id = `tutorial-local-${Date.now()}-${counter += 1}`;
      const normalizedBody = normalizeItemBody(match[1], body);
      collection.push({ ...normalizedBody, id, revier_id: state.revier.id, status: body.status || "aktiv", created_at: now, updated_at: now });
      if (match[1] === "abschuesse" && body.schuetz_name && !state.schuetzen.includes(body.schuetz_name)) state.schuetzen.push(body.schuetz_name);
      save(); return { id };
    }
    const index = collection.findIndex((item) => String(item.id) === String(itemId));
    if (index < 0) throw demoError("Nicht gefunden", 404);
    if (method === "PATCH") {
      const normalizedBody = normalizeItemBody(match[1], body);
      collection[index] = { ...collection[index], ...normalizedBody, id: collection[index].id, updated_at: new Date().toISOString() };
      save(); return { ok: true };
    }
    if (method === "DELETE") {
      collection.splice(index, 1);
      if (match[1] === "kanzeln") {
        state.abschuesse = state.abschuesse.map((item) => ({
          ...item,
          kanzel_id: idsEqual(item.kanzel_id, itemId) ? null : item.kanzel_id,
          schuss_kanzel_id: idsEqual(item.schuss_kanzel_id, itemId) ? null : item.schuss_kanzel_id,
        }));
      }
      save(); return { ok: true };
    }
    throw demoError("Diese Methode ist im Demo-Modus nicht erlaubt.", 405);
  }
  return { request, reset, snapshot };
}

export async function loadTutorialSeed(fetchImpl = fetch) {
  const response = await fetchImpl("/api/tutorial/seed", { method: "GET", credentials: "omit", cache: "no-store" });
  if (!response.ok) throw demoError(response.status === 503 ? "Das Demo-Revier ist momentan nicht verfügbar." : "Demo-Daten konnten nicht geladen werden.", response.status);
  return response.json();
}
