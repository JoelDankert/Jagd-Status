import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('viewport exposes safe-area insets to browser and WebView', () => {
  assert.match(html, /name="viewport"[^>]+viewport-fit=cover/);
});

test('landscape header encloses tabs with zero and simulated notch insets', () => {
  const chrome = process.env.CHROME || '/usr/bin/google-chrome';
  const dir = mkdtempSync(join(tmpdir(), 'jagd-header-'));
  try {
    for (const inset of [0, 32]) {
      // Chrome on a desktop has zero real safe-area insets. Replace only env() in
      // the fixture so the same production CSS is measured with a notch value.
      const fixtureCSS = css.replace(/env\(safe-area-inset-(top|right|left),\s*0px\)/g,
        (_, side) => `${side === 'top' ? inset : 12}px`);
      const fixture = join(dir, `landscape-${inset}.html`);
      writeFileSync(fixture, `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${fixtureCSS}</style><div id="root"><div class="app"><header class="top"><strong>Revier</strong><nav class="tabs"><button>Karte</button><button>Liste</button></nav><div class="header-menu">Menü</div></header><div class="map-shell"><div class="map"></div></div></div></div><pre id="result"></pre><script>onload = () => { const h = document.querySelector('.top').getBoundingClientRect(), t = document.querySelector('.tabs').getBoundingClientRect(), m = document.querySelector('.map-shell').getBoundingClientRect(); document.querySelector('#result').textContent = 'METRICS:' + JSON.stringify({top:h.top,bottom:h.bottom,tabsTop:t.top,tabsBottom:t.bottom,mapTop:m.top,mapBottom:m.bottom,viewport:innerHeight,paddingTop:parseFloat(getComputedStyle(document.querySelector('.top')).paddingTop)}); }</script>`);
      const run = spawnSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=844,390', '--dump-dom', `file://${fixture}`], { encoding: 'utf8', timeout: 20000 });
      assert.equal(run.status, 0, run.stderr);
      const match = run.stdout.match(/METRICS:(\{[^<]+\})/);
      assert.ok(match, run.stdout);
      const box = JSON.parse(match[1]);
      assert.ok(box.tabsTop >= box.top + inset + 9, JSON.stringify(box));
      assert.ok(box.tabsBottom <= box.bottom - 9, JSON.stringify(box));
      assert.equal(box.mapTop, box.bottom);
      assert.equal(box.mapBottom, box.viewport);
      assert.equal(box.paddingTop, inset + 9);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
