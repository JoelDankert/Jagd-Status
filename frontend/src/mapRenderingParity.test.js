import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Android wrapper loads the same website: do not change Leaflet's global
// positioning engine only for its user agent, since tile/marker zoom then diverges.
test('Android WebView uses the website Leaflet positioning path', () => {
  const source = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
  assert.match(source, /<MapContainer\b/);
  assert.doesNotMatch(source, /configureMapRendering|tileRendering|Browser\.any3d/);
});
