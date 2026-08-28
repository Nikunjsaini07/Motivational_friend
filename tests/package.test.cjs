const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('manifest packages native popup and PNG icons without page scripts or remote access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.minimum_chrome_version, '127');
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions, undefined);
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, 'src/offscreen.html']) {
    assert.ok(fs.existsSync(path.join(root, file)));
  }
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = fs.readFileSync(path.join(root, file));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
});

test('every classical quote has unique identity, author, work and HTTPS source', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'src/quotes.js'), 'utf8'), context);
  const bank = context.MF_VERIFIED_QUOTES;
  assert.equal(bank.length, 16);
  assert.equal(new Set(bank.map(q => q.id)).size, bank.length);
  assert.equal(new Set(bank.map(q => q.author)).size, 5);
  bank.forEach(q => {
    assert.ok(q.text && q.author && q.work && q.sourceUrl.startsWith('https://'));
    if (['Epictetus', 'Marcus Aurelius'].includes(q.author)) assert.ok(q.translation);
  });
});

test('bundled cue files are audible PCM, not silence or clipping', () => {
  for (const name of ['taps.wav', 'gentle.wav']) {
    const data = fs.readFileSync(path.join(root, 'assets', name));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE');
    let format, samples;
    for (let i = 12; i + 8 <= data.length;) {
      const length = data.readUInt32LE(i + 4);
      const id = data.toString('ascii', i, i + 4);
      if (id === 'fmt ') format = data.subarray(i + 8, i + 8 + length);
      if (id === 'data') samples = data.subarray(i + 8, i + 8 + length);
      i += 8 + length + (length % 2);
    }
    assert.equal(format.readUInt16LE(0), 1);
    assert.equal(format.readUInt16LE(14), 16);
    const rate = format.readUInt32LE(4);
    const channels = format.readUInt16LE(2);
    const duration = samples.length / (rate * channels * 2);
    assert.ok(duration >= 1 && duration <= 3, 'Cue is short but audible.');
    let peak = 0, energy = 0;
    for (let i = 0; i < samples.length; i += 2) {
      const value = samples.readInt16LE(i) / 32768;
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
      if (i < rate * channels * 2 * .34) assert.equal(value, 0, 'Lead-in aligns the paw animation.');
    }
    assert.ok(peak > .05 && peak < .99, 'Safe non-zero peak.');
    assert.ok(Math.sqrt(energy / (samples.length / 2)) > .01, 'Not effectively silent.');
  }
});

test('compact UI keeps accessibility and removes the requested warning', () => {
  const css = fs.readFileSync(path.join(root, 'src/ui.css'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/companion.js'), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /mf-paw-tap 180ms/);
  assert.doesNotMatch(ui, /Choosing a time closes ALL|mf-close-warning|browser_unfocused/);
  assert.match(ui, /config\.playSound/);
  assert.match(fs.readFileSync(path.join(root, 'src/popup.html'), 'utf8'), /src="audio\.js"/);
  assert.match(ui, /rel="noopener noreferrer"/);
  assert.doesNotMatch(ui, /CHECK_IN_NOW|Test on this tab/);
});

test('Settings sizing is independent of popup viewport and uses one scroll surface', () => {
  const css = fs.readFileSync(path.join(root, 'src/ui.css'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/companion.js'), 'utf8');
  assert.match(css, /\.mf-widget\.mf-settings-open\s*\{[^}]*height:\s*520px;[^}]*overflow-y:\s*auto/);
  assert.doesNotMatch(css, /\b(?:dvh|vh)\b/);
  const listRule = css.match(/\.mf-domains\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(listRule, /overflow|max-height/);
  assert.match(ui, /<details class="mf-sites-details">/);
  assert.match(ui, /<section class="mf-setting-group" aria-label="Sound settings">/);
  assert.match(ui, /audioSlot.append/);
});
