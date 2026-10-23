import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createTutorialRouter, validateTutorialSeed } from "../backend/tutorialRoutes.js";

const validSeed = { revier: { id: "r", name: "Durchhausen · Demo", has_viewer_passwort: false }, settings: {}, role: "admin", kanzeln: [], kameras: [], abschuesse: [], schuetzen: [] };

test("Seed-Validierung verweigert Credentials", () => {
  assert.throws(() => validateTutorialSeed({ ...validSeed, session_token: "secret" }), /Unzulässiges Feld/);
});

test("Tutorial-Routen liefern Seed/Bild read-only und fallen nie auf HTML zurück", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jagd-tutorial-test-"));
  fs.mkdirSync(path.join(dir, "images"));
  fs.writeFileSync(path.join(dir, "seed.json"), JSON.stringify(validSeed));
  fs.writeFileSync(path.join(dir, "images", "demo.jpg"), "demo");
  const app = express(); app.use("/api/tutorial", createTutorialRouter({ dataDir: dir }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const seedResponse = await fetch(`${base}/api/tutorial/seed`);
  assert.equal(seedResponse.status, 200); assert.equal((await seedResponse.json()).revier.name, "Durchhausen · Demo");
  assert.equal((await fetch(`${base}/api/tutorial/images/demo.jpg`, { method: "HEAD" })).status, 200);
  const denied = await fetch(`${base}/api/tutorial/seed`, { method: "POST" });
  assert.equal(denied.status, 405); assert.match(denied.headers.get("content-type"), /json/);
  assert.equal((await fetch(`${base}/api/tutorial/unknown`)).status, 404);
});

test("fehlender Seed ergibt 503 statt erfundener Daten", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jagd-tutorial-empty-"));
  const app = express(); app.use("/api/tutorial", createTutorialRouter({ dataDir: dir }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/tutorial/seed`)).status, 503);
});
