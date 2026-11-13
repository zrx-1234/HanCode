// One-shot interactive smoke test for the HanCode desktop app.
// Usage: env -u ELECTRON_RUN_AS_NODE node .claude/skills/run-desktop/smoke.mjs
// Drives the real UI through the 5 changes: side panel collapse, settings
// modal (gear icon, vision fields, profiles), and screenshots each step.
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(process.env.TEMP || '/tmp', 'hancode-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
  args: [APP_DIR],
  timeout: 30_000,
});
const page = await app.firstWindow();
await page.waitForSelector('.app-shell', { timeout: 15_000 });

const shot = name => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

// DOM click — bypasses coordinate math.
const click = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return 'NOT_FOUND';
  el.click();
  return 'OK';
}, sel);

const clickText = text => page.evaluate(t => {
  const els = [...document.querySelectorAll('button, a, [role="button"]')];
  const el = els.find(e => e.textContent?.includes(t));
  if (!el) return 'NOT_FOUND';
  el.click();
  return `OK(${el.className || el.tagName})`;
}, text);

// React-controlled input: set via native setter + input event.
const setValue = (sel, value) => page.evaluate(([s, v]) => {
  const el = document.querySelector(s);
  if (!el) return 'NOT_FOUND';
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'OK';
}, [sel, value]);

try {
  // 1. Initial layout: side panel visible.
  await shot('01-main');
  const hasSidePanel = await page.evaluate(() => Boolean(document.querySelector('.side-panel')));
  console.log('step1 side-panel present:', hasSidePanel);

  // 2. Collapse the side panel via its corner button.
  console.log('step2 click collapse:', await click('.side-collapse-button'));
  await page.waitForSelector('.side-rail', { timeout: 5_000 });
  await shot('02-collapsed');
  const railVisible = await page.evaluate(() => Boolean(document.querySelector('.side-rail')));
  console.log('step2 rail present:', railVisible);

  // 3. Expand again.
  console.log('step3 click expand:', await click('.side-rail .icon-button'));
  await page.waitForSelector('.side-panel', { timeout: 5_000 });
  await shot('03-expanded');

  // 4. Open settings (gear button is the 6th icon-button in the topbar; use title).
  console.log('step4 open settings:', await page.evaluate(() => {
    const btn = document.querySelector('button[title="设置"]') || document.querySelector('button[title="Settings"]');
    if (!btn) return 'NOT_FOUND';
    btn.click();
    return 'OK';
  }));
  await page.waitForSelector('.settings-modal', { timeout: 5_000 });
  await shot('04-settings');
  const fieldLabels = await page.evaluate(() =>
    [...document.querySelectorAll('.settings-field > span')].map(s => s.textContent));
  console.log('step4 fields:', JSON.stringify(fieldLabels));
  const hasProfileRow = await page.evaluate(() => Boolean(document.querySelector('.profile-row select')));
  console.log('step4 profile select present:', hasProfileRow);

  // 5. Fill a vision model + save-as new profile.
  const visionInput = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.settings-field > span')];
    const zh = spans.find(s => s.textContent === '视觉模型') || spans.find(s => s.textContent === 'Vision model');
    if (!zh) return 'NOT_FOUND';
    return 'OK';
  });
  console.log('step5 vision label:', visionInput);
  // type into vision model field (last text input before hint)
  console.log('step5 set vision model:', await setValue('.settings-modal input[placeholder="doubao-seed-2.1-pro"]', 'doubao-seed-2.1-pro'));

  // open save-as, name it, confirm
  console.log('step5 open save-as:', await clickText('另存为方案') || await clickText('Save as profile'));
  await shot('05-save-as');
  console.log('step5 set name:', await setValue('.profile-row input[placeholder="新方案名称"]', 'smoke-test'));
  console.log('step5 confirm:', await clickText('保存并切换') || await clickText('Save & switch'));
  await page.waitForTimeout(800);
  await shot('06-profile-saved');
  const activeOption = await page.evaluate(() => document.querySelector('.profile-row select')?.value);
  console.log('step5 active profile now:', activeOption);

  // 6. Switch back to default profile via the dropdown.
  await page.evaluate(() => {
    const select = document.querySelector('.profile-row select');
    if (!select) return 'NOT_FOUND';
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'default');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'OK';
  });
  await page.waitForTimeout(800);
  await shot('07-back-to-default');
  const activeAfter = await page.evaluate(() => document.querySelector('.profile-row select')?.value);
  console.log('step6 active profile after switch:', activeAfter);

  // 7. Close settings.
  console.log('step7 cancel:', await clickText('取消') || await clickText('Cancel'));
  await page.waitForTimeout(300);
  await shot('08-closed');

  console.log('SMOKE OK');
} catch (e) {
  await shot('99-failure');
  console.log('SMOKE FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await app.close();
}
