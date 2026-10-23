import fs from "node:fs";
import path from "node:path";
import express from "express";

const REQUIRED_ARRAYS = ["kanzeln", "kameras", "abschuesse", "schuetzen"];
const FORBIDDEN_KEY = /passwort|password|credential|session|token|auth/i;

export function validateTutorialSeed(seed) {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) throw new Error("Seed muss ein Objekt sein");
  if (!seed.revier || seed.revier.name !== "Durchhausen · Demo") throw new Error("Demo-Reviername fehlt");
  if (!seed.settings || typeof seed.settings !== "object") throw new Error("Einstellungen fehlen");
  for (const key of REQUIRED_ARRAYS) if (!Array.isArray(seed[key])) throw new Error(`${key} fehlt`);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key) && key !== "has_viewer_passwort") throw new Error(`Unzulässiges Feld: ${key}`);
      visit(child);
    }
  };
  visit(seed);
  for (const collection of [seed.kanzeln, seed.kameras, seed.abschuesse]) {
    for (const item of collection) {
      for (const field of ["bild_data", "bild2", "bild3"]) {
        const value = item?.[field];
        if (value && (value !== path.basename(value) || value.startsWith("data:"))) throw new Error(`Ungültiger Bildname: ${field}`);
      }
    }
  }
  return seed;
}

export function createTutorialRouter({ dataDir = process.env.TUTORIAL_DATA_DIR || "/opt/jagdapp/data/tutorial" } = {}) {
  const router = express.Router();
  const seedPath = path.resolve(dataDir, "seed.json");
  const imageDir = path.resolve(dataDir, "images");

  router.get("/seed", (_req, res) => {
    try {
      if (!fs.existsSync(seedPath)) return res.status(503).json({ error: "Demo-Daten sind momentan nicht verfügbar." });
      const seed = validateTutorialSeed(JSON.parse(fs.readFileSync(seedPath, "utf8")));
      res.setHeader("Cache-Control", "no-store");
      return res.json(seed);
    } catch (error) {
      console.error("Tutorial-Seed ungültig:", error.message);
      return res.status(503).json({ error: "Demo-Daten sind momentan nicht verfügbar." });
    }
  });

  router.get("/images/:filename", (req, res) => {
    const filename = String(req.params.filename || "");
    if (!filename || filename !== path.basename(filename) || filename.includes("\0")) return res.status(404).json({ error: "Bild nicht gefunden" });
    const filePath = path.resolve(imageDir, filename);
    if (path.dirname(filePath) !== imageDir || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).json({ error: "Bild nicht gefunden" });
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.sendFile(filePath);
  });

  router.all("/seed", (_req, res) => res.status(405).json({ error: "Methode nicht erlaubt" }));
  router.all("/images/:filename", (_req, res) => res.status(405).json({ error: "Methode nicht erlaubt" }));
  router.all("*", (_req, res) => res.status(404).json({ error: "Tutorial-Ressource nicht gefunden" }));
  return router;
}
