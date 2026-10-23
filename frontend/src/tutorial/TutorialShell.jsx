import React, { cloneElement, useCallback, useEffect, useRef, useState } from "react";
import { configureRuntime } from "../runtime.js";
import { createTutorialAdapter, createTutorialStorage, loadTutorialSeed } from "./adapter.js";
import { TUTORIAL_STEPS } from "./steps.js";
import "./tutorial.css";

const demoStorage = createTutorialStorage();
let adapter;
const initialization = loadTutorialSeed().then((seed) => {
  adapter = createTutorialAdapter(seed);
  configureRuntime({
    mode: "tutorial",
    api: adapter.request,
    storage: demoStorage,
    imageSrc: (value) => value && (value.startsWith("data:") ? value : `/api/tutorial/images/${encodeURIComponent(value)}`),
    allowFullscreen: false,
    simulatedLocation: seed.kanzeln?.[0] ? [seed.kanzeln[0].position_lat, seed.kanzeln[0].position_lng] : null,
  });
  return seed;
});

const focusable = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export default function TutorialShell({ children }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [welcome, setWelcome] = useState(true);
  const [step, setStep] = useState(-1);
  const bridge = useRef(null);
  const welcomeRef = useRef(null);
  const priorFocus = useRef(null);
  const highlighted = useRef(null);
  const registerBridge = useCallback((next) => { bridge.current = next; }, []);

  useEffect(() => { initialization.then(() => setReady(true)).catch((err) => setError(err.message)); }, []);

  const leaveWelcome = useCallback((guided) => {
    setWelcome(false);
    setStep(guided ? 0 : -1);
    requestAnimationFrame(() => (document.querySelector("[data-tour='list-tab']") || priorFocus.current)?.focus?.());
  }, []);

  useEffect(() => {
    if (!welcome || !ready) return undefined;
    priorFocus.current = document.activeElement;
    const dialog = welcomeRef.current;
    dialog?.querySelector(".primary")?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); leaveWelcome(false); return; }
      if (event.key !== "Tab" || !dialog) return;
      const nodes = [...dialog.querySelectorAll(focusable)];
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [welcome, ready, leaveWelcome]);

  useEffect(() => {
    highlighted.current?.classList.remove("tutorial-target");
    highlighted.current = null;
    if (step < 0) return undefined;
    const definition = TUTORIAL_STEPS[step];
    bridge.current?.[definition.action]?.();
    let cancelled = false;
    let timer;
    let attempts = 0;
    const resolveTarget = () => {
      if (cancelled) return;
      const target = definition.target ? document.querySelector(definition.target) : null;
      if (!target && attempts++ < 30) { timer = setTimeout(resolveTarget, 50); return; }
      if (!target) return;
      highlighted.current = target;
      target.classList.add("tutorial-target");
      target.scrollIntoView?.({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    timer = setTimeout(resolveTarget, 0);
    const onKey = (event) => { if (event.key === "Escape") setStep(-1); };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelled = true; clearTimeout(timer); document.removeEventListener("keydown", onKey);
      highlighted.current?.classList.remove("tutorial-target"); highlighted.current = null;
    };
  }, [step]);

  if (error) return <main className="tutorial-unavailable"><section><h1>Demo nicht verfügbar</h1><p>{error}</p><a href="/">Zur Anwendung</a></section></main>;
  if (!ready) return <main className="tutorial-loading" aria-live="polite">Demo-Revier wird geladen …</main>;
  const current = TUTORIAL_STEPS[step];
  return <div className={`tutorial-root${current ? ` guide-${current.placement}` : ""}`}>
    {cloneElement(children, { tutorialBridge: registerBridge })}
    {!welcome && !current ? <details className="tutorial-badge"><summary>Demo</summary><div><button onClick={() => setStep(0)}>Einführung</button><button onClick={() => { adapter.reset(); demoStorage.clear(); location.reload(); }}>Zurücksetzen</button><a href="/">Beenden</a></div></details> : null}
    {welcome ? <div className="tutorial-welcome" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" ref={welcomeRef}>
      <section><h1 id="tutorial-title">Dein Revier. Einmal ausprobieren.</h1><p>Kanzeln, Abschüsse und Kartenfunktionen direkt mit vorbereiteten Beispielen kennenlernen – ohne Anmeldung und ohne echte Daten zu verändern.</p><div><button className="primary" onClick={() => leaveWelcome(true)}>Kurz zeigen lassen</button><button onClick={() => leaveWelcome(false)}>Selbst erkunden</button></div><a href="/">Demo verlassen</a></section>
    </div> : null}
    {current ? <section className="tutorial-guide" aria-live="polite" aria-label={`Schritt ${step + 1} von ${TUTORIAL_STEPS.length}`}>
      <small>{step + 1} / {TUTORIAL_STEPS.length}</small>
      <h2>{current.title}</h2>
      <p>{current.text}</p>
      <div className="tutorial-actions"><button disabled={step === 0} onClick={() => setStep(step - 1)}>Zurück</button><button className="primary" onClick={() => setStep(step + 1 < TUTORIAL_STEPS.length ? step + 1 : -1)}>{step + 1 < TUTORIAL_STEPS.length ? "Weiter" : "Fertig"}</button></div>
      <button className="tutorial-end" onClick={() => setStep(-1)}>Führung beenden</button>
    </section> : null}
  </div>;
}
