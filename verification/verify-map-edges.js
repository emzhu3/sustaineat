const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
  const ctx = b.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:5000', ['geolocation']);
  for (const vp of [{ w: 1280, h: 900, name: 'desktop' }, { w: 375, h: 812, name: 'mobile' }]) {
    const p = await b.newPage();
    await p.setViewport({ width: vp.w, height: vp.h, isMobile: vp.name === 'mobile' });
    await p.setGeolocation({ latitude: 42.3601, longitude: -71.0942 });
    await p.setCacheEnabled(false);
    await p.goto('http://localhost:5000', { waitUntil: 'networkidle2' });
    await p.waitForSelector('.search-input', { timeout: 45000 });
    await p.type('.search-input', 'beef burger');
    await p.click('.hero .btn-primary');
    await p.waitForSelector('.map-and-list', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));
    const res = await p.evaluate(() => {
      const map = document.querySelector('.mini-map').getBoundingClientRect();
      const pin = document.querySelector('.mini-map-pin');
      const label = pin.querySelector('.pin-label');
      const out = {};
      for (const [name, left, cls] of [['edge-right@90%', '90%', 'edge-right'], ['edge-left@10%', '10%', 'edge-left'], ['centred@50%', '50%', '']]) {
        pin.className = 'mini-map-pin ' + cls + ' active';
        pin.style.left = left;
        const lr = label.getBoundingClientRect();
        out[name] = {
          mapW: Math.round(map.width),
          labelW: Math.round(lr.width),
          overflowRight: Math.round(Math.max(0, lr.right - map.right)),
          overflowLeft: Math.round(Math.max(0, map.left - lr.left)),
          ok: lr.right <= map.right + 0.5 && lr.left >= map.left - 0.5,
        };
      }
      return out;
    });
    console.log('--- ' + vp.name + ' ---');
    for (const [k, v] of Object.entries(res)) console.log('  ' + (v.ok ? 'OK  ' : 'FAIL') + ' ' + k.padEnd(16) + ' mapW=' + v.mapW + ' labelW=' + v.labelW + ' overflowR=' + v.overflowRight + ' overflowL=' + v.overflowLeft);
    await p.close();
  }
  await b.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
