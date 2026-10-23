const normalStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

async function productionApi(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; }
  catch { throw new Error(res.ok ? `Unerwartete Antwort: ${text.slice(0, 120)}` : `Fehler ${res.status}`); }
  if (!res.ok) {
    const error = new Error(json.error || "Fehler");
    error.status = res.status;
    error.code = json.code;
    throw error;
  }
  return json;
}

const productionRuntime = {
  mode: "production",
  api: productionApi,
  storage: normalStorage,
  imageSrc: (value) => value && (value.startsWith("data:") ? value : `/api/images/${value}`),
  allowFullscreen: true,
  simulatedLocation: null,
};

let current = productionRuntime;

export function configureRuntime(runtime) {
  current = { ...productionRuntime, ...runtime };
}

export const api = (...args) => current.api(...args);
export const storage = {
  getItem: (...args) => current.storage.getItem(...args),
  setItem: (...args) => current.storage.setItem(...args),
  removeItem: (...args) => current.storage.removeItem(...args),
};
export const runtime = {
  get mode() { return current.mode; },
  get allowFullscreen() { return current.allowFullscreen; },
  get simulatedLocation() { return current.simulatedLocation; },
  imageSrc: (value) => current.imageSrc(value),
};
