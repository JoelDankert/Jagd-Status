import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationHistory, createImageHistory } from './historyNavigation.js';

function browser() {
  const entries = [{ state: null }];
  let index = 0;
  const events = new EventTarget();
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state) { entries.splice(++index); entries.push({ state }); },
    replaceState(state) { entries[index] = { state }; },
    back() { if (index > 0) { index--; events.dispatchEvent(Object.assign(new Event('popstate'), { state: entries[index].state })); } },
    forward() { if (index < entries.length - 1) { index++; events.dispatchEvent(Object.assign(new Event('popstate'), { state: entries[index].state })); } },
  };
  return { history, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
}

test('each submenu is a real browser history entry and back restores the previous submenu', () => {
  const win = browser();
  const restored = [];
  const nav = createNavigationHistory(win, (state) => restored.push(state));
  const root = { view: 'map', settingsOpen: false, selected: null };
  const list = { ...root, view: 'list' };
  const detail = { ...list, selected: { type: 'kanzel', id: 42 } };
  nav.record(root);
  nav.record(list);
  nav.record(detail);
  assert.equal(win.history.length, 3);
  win.history.back();
  assert.equal(restored.at(-1), list);
  nav.record(list);
  assert.equal(win.history.length, 3, 'restoration must not create a fresh entry');
  win.history.back();
  assert.equal(restored.at(-1), root);
  win.history.forward();
  assert.equal(restored.at(-1), list);
  nav.dispose();
});

test('image back closes only the image; the next back restores the previous page', () => {
  const win = browser();
  let page;
  let imageOpen = false;
  const nav = createNavigationHistory(win, (state) => { page = state; });
  const root = { view: 'map' };
  const detail = { view: 'list', selected: 42 };
  nav.record(root);
  nav.record(detail);
  const image = createImageHistory(win, (open) => { imageOpen = open; });
  image.open();
  assert.equal(imageOpen, true);
  assert.equal(win.history.length, 3);
  win.history.back();
  assert.equal(imageOpen, false);
  assert.equal(page, detail);
  win.history.back();
  assert.equal(page, root);
  image.dispose();
  nav.dispose();
});

test('old history entries after a reload do not collide with the current session', () => {
  const win = browser();
  win.history.pushState({ jagdNav: 'previous-session:1' }, '');
  win.history.pushState({ jagdNav: 'previous-session:2' }, '');
  let restored = null;
  const nav = createNavigationHistory(win, (state) => { restored = state; });
  const root = { view: 'map' };
  const list = { view: 'list' };
  nav.record(root);
  nav.record(list);
  win.history.back();
  assert.equal(restored, root);
  restored = null;
  win.history.back();
  assert.equal(restored, root, 'unknown history from before a reload falls back to the root view');
  nav.dispose();
});

test('a modal adds history, and returning to its prior frame restores the prior state', () => {
  const win = browser();
  let restored;
  const nav = createNavigationHistory(win, (state) => { restored = state; });
  const root = { view: 'map', settingsOpen: false };
  nav.record(root);
  nav.record({ ...root, settingsOpen: true });
  win.history.back();
  assert.equal(restored.settingsOpen, false);
  nav.dispose();
});
