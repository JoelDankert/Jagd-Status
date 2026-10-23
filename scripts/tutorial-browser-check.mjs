// Local-only real-seed check. Requires the preview and a Chrome DevTools endpoint.
import assert from "node:assert/strict";
import fs from "node:fs";
import { WebSocket } from "/usr/share/nodejs/undici/index.js";

const appUrl = process.env.TUTORIAL_PREVIEW_URL || "http://127.0.0.1:4177/tutorial";
const rootUrl = new URL("/", appUrl).href;
const debugUrl = process.env.CHROME_DEBUG_URL || "http://127.0.0.1:9227";
const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
const requests = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  if (message.method === "Network.requestWillBeSent") requests.push({ method: message.params.request.method, url: message.params.request.url });
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const callId = ++id;
  const timer = setTimeout(() => { pending.delete(callId); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
  pending.set(callId, (message) => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
  ws.send(JSON.stringify({ id: callId, method, params }));
});
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, timeout = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Browsercheck timeout: ${expression}`);
};
const clickText = async (selector, text) => {
  assert.equal(await evaluate(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!el)return false; el.click(); return true; })()`), true, `${text} fehlt`);
};
const screenshot = async (name) => {
  const result = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(`/tmp/${name}.png`, Buffer.from(result.data, "base64"));
};

await call("Network.enable"); await call("Page.enable"); await call("Runtime.enable");
await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await waitFor(`document.body?.innerText.includes("Dein Revier. Einmal ausprobieren.")`);
await evaluate(`localStorage.setItem("tutorial-qa-production-key", "unchanged"); document.cookie="tutorial_qa_auth=unchanged; path=/; SameSite=Lax"`);
const tutorialStart = requests.length;
assert.equal(await evaluate(`document.activeElement?.textContent === "Kurz zeigen lassen"`), true);
assert.equal(await evaluate(`document.querySelectorAll(".leaflet-marker-icon").length >= 8`), true);
await screenshot("jagd-tutorial-welcome-desktop");

await clickText("button", "Kurz zeigen lassen");
await waitFor(`document.querySelector("[data-tour='kanzel-detail'] img")`);
assert.equal(await evaluate(`fetch(document.querySelector("[data-tour='kanzel-detail'] img").src,{method:"HEAD",credentials:"omit"}).then(r=>r.status)`), 200);
await clickText(".tutorial-guide button", "Weiter");
await waitFor(`document.querySelectorAll(".list-screen .rows article").length === 8`);
await clickText(".tutorial-guide button", "Weiter");
await waitFor(`document.querySelector("[data-tour='abschuss-detail']") && document.querySelectorAll(".list-screen .rows article").length === 5`);
await clickText(".tutorial-guide button", "Weiter");
await waitFor(`document.querySelector(".create-choices")`);
await clickText(".tutorial-guide button", "Weiter");
await waitFor(`document.querySelector("[data-tour='object-form']")`);
await evaluate(`(() => { const input=document.querySelector("[data-tour='object-form'] input"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(input,"Browsercheck-Kanzel"); input.dispatchEvent(new Event("input",{bubbles:true})); return true; })()`);
await clickText("[data-tour='object-form'] button", "Speichern");
await waitFor(`!document.querySelector("[data-tour='object-form']")`);
await clickText(".tutorial-guide button", "Weiter");
await waitFor(`document.querySelector("[data-tour='settings-panel']")`);
await screenshot("jagd-tutorial-settings-desktop");
await clickText(".tutorial-guide button", "Fertig");

// Shared AccountPanel is visible, but credentials/deletion remain inert in the demo.
await evaluate(`document.querySelector("[data-tour='menu']").click()`);
await clickText(".header-dropdown button", "Account");
await waitFor(`document.querySelector("[data-tour='demo-account-note']")`);
assert.equal(await evaluate(`[...document.querySelectorAll("form.modal input[type=password]")].every(x=>x.disabled)`), true);
await clickText("form.modal button", "Löschung anfragen");
assert.equal(await evaluate(`document.querySelector("form.modal .error")?.textContent.includes("keine Löschanfrage")`), true);
await evaluate(`document.querySelector("form.modal header button").click()`);

await evaluate(`document.querySelector(".tutorial-badge summary").click()`);
await clickText(".tutorial-badge button", "Zurücksetzen");
await waitFor(`document.body.innerText.includes("Dein Revier. Einmal ausprobieren.")`);
await clickText("button", "Selbst erkunden");
await evaluate(`document.querySelector("[data-tour='list-tab']").click()`);
await waitFor(`document.querySelectorAll(".rows article").length === 8`);

// Narrow layout: compact demo control must not cover map controls.
await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await clickText("header.top nav button", "Karte");
await waitFor(`document.querySelector(".map-tools")`);
assert.equal(await evaluate(`(() => { const a=document.querySelector(".tutorial-badge").getBoundingClientRect(); return [...document.querySelectorAll(".map-tools button,.map-top-right button")].every(el=>{const b=el.getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom}) })()`), true);
await screenshot("jagd-tutorial-free-mobile");

assert.equal(await evaluate(`localStorage.getItem("tutorial-qa-production-key")`), "unchanged");
assert.equal(await evaluate(`document.cookie.includes("tutorial_qa_auth=unchanged")`), true);
assert.equal((await fetch(rootUrl)).ok, true);
assert.deepEqual(requests.slice(tutorialStart).filter(({ method, url }) => url.includes("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)), []);
console.log(JSON.stringify({ ok: true, productionApiWrites: 0, seed: { kanzeln: 8, kameras: 1, abschuesse: 5 }, photoStatus: 200, guidedCrudReset: true, accountSafe: true, desktopAndMobile: true, screenshots: ["/tmp/jagd-tutorial-welcome-desktop.png", "/tmp/jagd-tutorial-settings-desktop.png", "/tmp/jagd-tutorial-free-mobile.png"] }));
ws.close();
process.exit(0);
