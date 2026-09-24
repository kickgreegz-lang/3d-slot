import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on('console', m => logs.push(m.type()+': '+m.text()));
await page.goto('http://localhost:5203/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__slot?.ready === true, null, { timeout: 90000 });
const t = await page.evaluate(async () => {
  const { createArt } = await import('/src/assets/loader.ts');
  const t0 = performance.now();
  await createArt(window.__slot.ctx.app);
  const t1 = performance.now();
  return { ready: t0, bake: t1 - t0 };
});
console.log(JSON.stringify(t));
console.log(logs.filter(l => !l.includes('THREE')).join('\n'));
await browser.close();
