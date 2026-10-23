import test from "node:test";
import assert from "node:assert/strict";
import { createTutorialAdapter, createTutorialStorage, loadTutorialSeed } from "../frontend/src/tutorial/adapter.js";

const seed = () => ({
  revier: { id: "demo-r", name: "Durchhausen · Demo", has_viewer_passwort: true },
  settings: { show_kanzeln: 1, show_kameras: 1, show_abschuesse: 1 }, role: "admin",
  kanzeln: [{ id: "k1", name: "Kanzel", position_lat: 1, position_lng: 2 }], kameras: [],
  abschuesse: [{ id: "a1", kanzel_id: "k1", schuss_kanzel_id: "k1", position_lat: 1, position_lng: 2 }],
  schuetzen: ["Alex"],
});

test("CRUD bleibt lokal, erhält Antwortformen und Reset stellt Seed wieder her", async () => {
  const adapter = createTutorialAdapter(seed());
  const created = await adapter.request("/api/kanzeln", { method: "POST", body: { name: "Neu", position_lat: 3, position_lng: 4 } });
  assert.match(created.id, /^tutorial-local-/);
  await adapter.request(`/api/kanzeln/${created.id}`, { method: "PATCH", body: { status: "archiviert" } });
  assert.equal((await adapter.request("/api/map-data")).kanzeln.at(-1).status, "archiviert");
  await adapter.request("/api/kanzeln/k1", { method: "DELETE" });
  assert.equal((await adapter.request("/api/map-data")).abschuesse[0].kanzel_id, null);
  assert.equal(adapter.reset().kanzeln[0].id, "k1");
});

test("Abschuss-Koordinaten und Verknüpfungen folgen der Backend-Normalisierung", async () => {
  const data = seed();
  data.kanzeln[0].id = 1;
  data.abschuesse[0].kanzel_id = "1";
  const adapter = createTutorialAdapter(data);
  const created = await adapter.request("/api/abschuesse", {
    method: "POST",
    body: { wildart: "Reh", position_lat: "47,5", position_lng: "", schuss_lat: "", schuss_lng: "", kanzel_id: "", schuss_kanzel_id: " 1 " },
  });
  let item = adapter.snapshot().abschuesse.find((entry) => entry.id === created.id);
  assert.deepEqual(
    [item.position_lat, item.position_lng, item.schuss_lat, item.schuss_lng, item.kanzel_id, item.schuss_kanzel_id],
    [47.5, null, null, null, null, "1"],
  );
  await adapter.request(`/api/abschuesse/${created.id}`, { method: "PATCH", body: { schuss_lat: "48,25", schuss_lng: "" } });
  item = adapter.snapshot().abschuesse.find((entry) => entry.id === created.id);
  assert.deepEqual([item.schuss_lat, item.schuss_lng], [48.25, null]);
  await adapter.request("/api/kanzeln/1", { method: "DELETE" });
  assert.equal(adapter.snapshot().abschuesse[0].kanzel_id, null);
});

test("unbekannte Endpunkte und Methoden werden fail-closed abgewiesen", async () => {
  const adapter = createTutorialAdapter(seed());
  await assert.rejects(adapter.request("/api/admin/data", { method: "POST" }), (error) => error.status === 404);
  await assert.rejects(adapter.request("/api/kanzeln/k1", { method: "PUT" }), (error) => error.status === 405);
});

test("Account-Änderung speichert nur den Demo-Namen, nie Passwörter", async () => {
  const adapter = createTutorialAdapter(seed());
  await adapter.request("/api/revier", { method: "PATCH", body: { name: "Lokaler Name", passwort: "nicht-speichern", viewer_passwort: "auch-nicht" } });
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.revier.name, "Lokaler Name");
  assert.equal(JSON.stringify(snapshot).includes("nicht-speichern"), false);
  assert.equal(JSON.stringify(snapshot).includes("auch-nicht"), false);
});

test("Demo-Storage berührt Produktivschlüssel nicht", () => {
  const values = new Map([["jagd-theme", "dark"], ["jagd-credentials", "legacy"]]);
  const fake = { get length() { return values.size; }, key: (i) => [...values.keys()][i], getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  const storage = createTutorialStorage(fake);
  storage.setItem("jagd-theme", "light");
  assert.equal(values.get("jagd-theme"), "dark");
  assert.equal(storage.getItem("jagd-theme"), "light");
  storage.clear();
  assert.equal(values.get("jagd-credentials"), "legacy");
});

test("Seed-Abruf sendet ausdrücklich keine Credentials und meldet 503 ehrlich", async () => {
  let options;
  await assert.rejects(loadTutorialSeed(async (_url, next) => { options = next; return { ok: false, status: 503 }; }), /momentan nicht verfügbar/);
  assert.equal(options.credentials, "omit");
});
