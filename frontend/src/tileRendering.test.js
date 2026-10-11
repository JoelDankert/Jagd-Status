import test from 'node:test';
import assert from 'node:assert/strict';
import { configureMapRendering } from './tileRendering.js';

const webViewUA = 'Mozilla/5.0 (Linux; Android 15; Pixel Build/XYZ; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36';

test('Android WebView uses seam-free non-3D tile positioning', () => {
  const leaflet = { Browser: { any3d: true } };
  configureMapRendering(leaflet, webViewUA);
  assert.equal(leaflet.Browser.any3d, false);
});

test('ordinary Android Chrome and desktop browser keep accelerated maps', () => {
  for (const userAgent of [
    'Mozilla/5.0 (Linux; Android 15; Pixel Build/XYZ) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/152.0 Safari/537.36',
  ]) {
    const leaflet = { Browser: { any3d: true } };
    configureMapRendering(leaflet, userAgent);
    assert.equal(leaflet.Browser.any3d, true);
  }
});
