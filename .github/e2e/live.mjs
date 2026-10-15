import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Los_Angeles' });
const page = await ctx.newPage();
const reqs = [];
page.on('request', (r) => { if (r.url().includes('thredds')) reqs.push(r.url()); });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const st of ['100p1', '153p1', '201p1', '220p1', '191p1']) {
  reqs.length = 0;
  await page.goto(`http://localhost:8000/?station=${st}`);
  try {
    await page.waitForFunction(() => document.getElementById('hs').textContent !== '—' || document.querySelector('.status.error'), null, { timeout: 20000 });
  } catch (e) { console.log(st, 'TIMEOUT'); }
  console.log(`== ${st}`);
  console.log((await page.locator('#summary').innerText()).replace(/\n+/g, ' | '));
  console.log('status:', await page.locator('#status').innerText(), '| cbar:', (await page.locator('.cbar-labels').innerText()).replace(/\n/g, ' '));
  for (const u of reqs) console.log('  GET', u.length > 160 ? u.slice(0, 160) + '…' : u);
  if (st === '100p1') {
    const buf = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: true });
    console.log('SCREENSHOT_BEGIN'); console.log(buf.toString('base64').replace(/(.{1000})/g, '$1\n')); console.log('SCREENSHOT_END');
  }
}
await browser.close();
