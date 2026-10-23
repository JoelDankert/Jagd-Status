import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../frontend/src/main.jsx", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../frontend/src/tutorial/TutorialShell.jsx", import.meta.url), "utf8");
const steps = fs.readFileSync(new URL("../frontend/src/tutorial/steps.js", import.meta.url), "utf8");

test("Tutorial wird nur auf dem exakten Pfad lazy geladen", () => {
  assert.match(source, /lazy\(\(\) => import\("\.\/tutorial\/TutorialShell\.jsx"\)\)/);
  assert.ok(source.includes('/^\\/tutorial\\/?$/.test(window.location.pathname)'));
});

test("Einführung steht direkt nach Rechtliches in Login und Menü", () => {
  assert.match(source, /href="\/rechtliches">Rechtliches<\/a>\s*<a className="legal-link" href="\/tutorial">Einführung/);
  assert.match(source, />Rechtliches<\/button>\s*<button[\s\S]{0,220}>Einführung<\/button>/);
});

test("Tutorial-Exit umgeht Produktions-Logout", () => {
  assert.match(source, /runtime\.mode === "tutorial"\) \{ window\.location\.href = "\/"; return; \}\s*await api\("\/api\/logout"/);
});

test("frühes Theme-Bootstrapping nutzt im Tutorial den Demo-Namensraum", () => {
  assert.match(html, /demo \? "jagd-tutorial:" : ""/);
});

test("optionale Bridge steuert echte App-Ansichten ohne Root-Chrome", () => {
  assert.match(source, /export function App\(\{ tutorialBridge \} = \{\}\)/);
  assert.match(shell, /cloneElement\(children, \{ tutorialBridge: registerBridge \}\)/);
  assert.doesNotMatch(source, /window\.alert/);
  for (const action of ["showKanzel", "showKanzelList", "showAbschuss", "showCreate", "showCreateForm", "showSettings"]) {
    assert.match(steps, new RegExp(`action: "${action}"`));
  }
});
