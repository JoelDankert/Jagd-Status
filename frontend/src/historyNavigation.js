export function createImageHistory(win, setOpen) {
  let token = null;
  const onPop = (event) => setOpen(Boolean(token && event.state?.jagdImage === token));
  win.addEventListener('popstate', onPop);
  return {
    open() {
      if (token && win.history.state?.jagdImage === token) return;
      token = `image-${Date.now()}-${Math.random()}`;
      win.history.pushState({ ...(win.history.state || {}), jagdImage: token }, '');
      setOpen(true);
    },
    close() {
      if (token && win.history.state?.jagdImage === token) win.history.back();
      else setOpen(false);
    },
    dispose() { win.removeEventListener('popstate', onPop); },
  };
}

// Rich React state stays in memory; no form data or callbacks are serialized into URLs.
export function createNavigationHistory(win, onRestore) {
  const frames = new Map();
  const session = `${Date.now()}-${Math.random()}`;
  let serial = 0;
  let current = null;
  let root = null;
  const same = (a, b) => Boolean(a && b)
    && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((key) => a[key] === b[key]);

  const onPop = (event) => {
    if (!event.state?.jagdNav) return;
    const snapshot = frames.get(event.state.jagdNav) || root;
    if (!snapshot) return;
    current = snapshot;
    onRestore(snapshot);
  };
  win.addEventListener('popstate', onPop);

  return {
    record(snapshot) {
      if (same(current, snapshot)) return;
      const id = `${session}:${++serial}`;
      frames.set(id, snapshot);
      if (current === null) {
        root = snapshot;
        win.history.replaceState({ ...(win.history.state || {}), jagdNav: id }, '');
      } else {
        win.history.pushState({ ...(win.history.state || {}), jagdNav: id }, '');
      }
      current = snapshot;
    },
    dispose() { win.removeEventListener('popstate', onPop); },
  };
}
