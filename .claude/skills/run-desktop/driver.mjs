// REPL driver for the HanCode Electron desktop app (Windows).
// Launch with: node .claude/skills/run-desktop/driver.mjs
// Wrap in tmux or run in background; send commands on stdin.
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(process.env.TEMP || '/tmp', 'hancode-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let app = null;
let page = null;

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      // electron-vite build output: main is out/main/index.cjs
      args: [path.join(APP_DIR, 'out/main/index.cjs')],
      timeout: 30_000,
    });
    page = await app.firstWindow();
    // Wait for the renderer to actually mount React.
    await page.waitForSelector('.app-shell', { timeout: 15_000 });
    console.log('launched. url:', page.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  // Click via evaluate(), NOT locator.click() — DOM click bypasses
  // coordinate math and always hits the right element.
  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK';
    }, sel);
    console.log('click', sel, '->', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(t => {
      const els = [...document.querySelectorAll('button, a, [role="button"], option')];
      const el = els.find(e => e.textContent?.trim() === t)
              ?? els.find(e => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK: ' + el.tagName + '.' + (el.className || '');
    }, text);
    console.log('click-text', JSON.stringify(text), '->', r);
  },

  async 'set-value'(sel, value) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(([s, v]) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    }, [sel, value]);
    console.log('set-value', sel, '->', r);
  },

  async type(text)  { if (page) await page.keyboard.type(text, { delay: 20 }); },
  async press(key)  { if (page) await page.keyboard.press(key); },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try { await page.waitForSelector(sel, { timeout: 10_000 }); console.log('found:', sel); }
    catch { console.log('TIMEOUT:', sel); }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(
      s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null));
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(()=>{}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' });
rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return rl.prompt();
  // commands take the rest of the line as a single argument; set-value splits on '||'
  let [cmd, ...rest] = trimmed.split(/\s+/);
  let arg = rest.join(' ');
  if (cmd === 'set-value') arg = trimmed.slice('set-value '.length).split('||').map(s => s.trim());
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, ' - try: help'); return rl.prompt(); }
  try { await fn(arg); } catch (e) { console.log('ERROR:', e.message); }
  if (cmd === 'quit') { rl.close(); process.exit(0); }
  rl.prompt();
});
rl.on('close', async () => { await COMMANDS.quit(); process.exit(0); });

console.log('HanCode desktop driver - "help" for commands, "launch" to start');
rl.prompt();
