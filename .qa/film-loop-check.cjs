// illi.world home page: the silent preview loop and the film behind it (task 928, 2026-11-22).
// Headless Chrome with Chrome's DEFAULT autoplay policy (no --autoplay-policy flag), against .qa/consent/server.py on 127.0.0.1,
// which also stands in for the site-event function. Every request off this machine is aborted and counted.
//
//   PUPPETEER_PATH=<.../puppeteer-core> CHROME=<chrome.exe> BASE=http://127.0.0.1:8766 OUT=<folder> node .qa/film-loop-check.cjs
const puppeteer = require(process.env.PUPPETEER_PATH);
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE, OUT = process.env.OUT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; let failures = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : detail }); if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
const log = async () => (await fetch(`${BASE}/__log`)).json();
const clearLog = () => fetch(`${BASE}/__log`, { method: 'DELETE' });
const events = (bs) => bs.flatMap((b) => (b.e || []).map((e) => e.n + ':' + (e.p ? (e.p.pct ?? e.p.which ?? '') : '')));
const flush = async (page) => { await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); }); await sleep(500); };
const state = (page) => page.evaluate(() => {
  const film = document.querySelector('#demo-player video'), loop = document.querySelector('#demo-player video.fp-loop');
  const w = document.querySelector('.fp-watch'), h = document.querySelector('.fp-hold');
  return {
    film: { paused: film.paused, muted: film.muted, volume: film.volume, t: film.currentTime, preload: film.preload, poster: film.poster.replace(location.origin, ''), audioBytes: film.webkitAudioDecodedByteCount || 0, ready: film.readyState },
    loop: loop && { d: loop.duration, paused: loop.paused, muted: loop.muted, loop: loop.loop, playsinline: loop.hasAttribute('playsinline'), t: loop.currentTime },
    watch: w && { text: w.textContent, h: w.getBoundingClientRect().height, w: w.getBoundingClientRect().width },
    hold: h && h.getAttribute('aria-label'),
    big: getComputedStyle(document.querySelector('.fp-big')).display,
    looping: document.getElementById('demo-player').classList.contains('looping'),
  };
});

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  const outside = [];
  async function open(dev, reduce) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    if (dev === 'phone') {
      await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36');
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    } else await page.setViewport({ width: 1440, height: 900 });
    if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname === '127.0.0.1' || u.protocol === 'data:') r.continue(); else { outside.push(r.url()); r.abort(); } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await clearLog();
    await page.goto(`${BASE}/?track_endpoint=${encodeURIComponent(BASE + '/collect')}`, { waitUntil: 'load' });
    return { ctx, page, errors };
  }

  try {
    for (const dev of ['desktop', 'phone']) {
      const { ctx, page, errors } = await open(dev);
      // the answer bar would sit over the film on a phone; answer nothing, just let it settle
      await sleep(2500);
      let s = await state(page);
      check(`${dev}: the loop plays by itself, muted, looping, inline`, s.loop && !s.loop.paused && s.loop.muted && s.loop.loop && s.loop.playsinline && s.loop.t > 0.3, s.loop);
      check(`${dev}: the film waits (paused, preload none, poster = the loop's first frame)`, s.film.paused && s.film.preload === 'none' && /illi-demo-loop-poster\.webp/.test(s.film.poster) && s.film.ready === 0, s.film);
      check(`${dev}: "Watch the demo (2 min)" is shown, at least 40 px tall; the old play button is hidden`, s.watch && s.watch.text === 'Watch the demo (2 min)' && s.watch.h >= 40 && s.big === 'none', { watch: s.watch, big: s.big });
      await sleep(8000);
      s = await state(page);
      check(`${dev}: after 10 s the loop has wrapped round and is still playing`, s.loop && !s.loop.paused && s.loop.t < s.loop.d, s.loop);
      await page.screenshot({ path: path.join(OUT, `${dev}-1-loop.png`) });
      // pause button
      if (dev === 'phone') await page.tap('.fp-hold'); else await page.click('.fp-hold');
      await sleep(400); const p1 = await state(page);
      if (dev === 'phone') await page.tap('.fp-hold'); else await page.click('.fp-hold');
      await sleep(600); const p2 = await state(page);
      check(`${dev}: the loop's pause button pauses it and plays it again`, p1.loop.paused && p1.hold === 'Play the preview' && !p2.loop.paused && p2.hold === 'Pause the preview', { p1: p1.hold, p2: p2.hold });
      // out of view: paused; back: plays
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(600);
      const off = await state(page);
      await page.evaluate(() => window.scrollTo(0, 0)); await sleep(800);
      const on = await state(page);
      check(`${dev}: the loop pauses when scrolled off screen and resumes when back`, off.loop.paused && !on.loop.paused, { off: off.loop.paused, on: on.loop.paused });
      // nothing counted as a film play yet
      await flush(page);
      check(`${dev}: the loop is not counted as a film play`, !events(await log()).some((e) => e.startsWith('film_')), events(await log()));
      // click the play control: the film plays with sound from 0:00
      if (dev === 'phone') await page.tap('.fp-watch'); else await page.click('.fp-watch');
      await page.waitForFunction(() => { const v = document.querySelector('#demo-player video'); return v.currentTime > 1.5 && !v.paused; }, { timeout: 20000 });
      s = await state(page);
      check(`${dev}: one click on "Watch the demo" plays the full film with sound (unmuted, volume 1, audio decoded)`, !s.film.paused && !s.film.muted && s.film.volume === 1 && s.film.audioBytes > 0, s.film);
      check(`${dev}: the loop and its buttons are gone once the film plays`, !s.loop && !s.watch && !s.hold && !s.looping, s);
      await page.screenshot({ path: path.join(OUT, `${dev}-2-film-playing.png`) });
      // to the end: plays-to-end still counted
      const dur = await page.evaluate(() => document.querySelector('#demo-player video').duration);
      for (const f of [0.3, 0.55, 0.8]) { await page.evaluate((t) => { document.querySelector('#demo-player video').currentTime = t; }, dur * f); await sleep(900); }
      await page.evaluate((t) => { document.querySelector('#demo-player video').currentTime = t; }, dur - 1.2);
      await page.waitForFunction(() => document.querySelector('#demo-player video').ended, { timeout: 15000 });
      await page.waitForSelector('.fp-cta.on a', { timeout: 5000 });
      await page.screenshot({ path: path.join(OUT, `${dev}-3-film-end.png`) });
      await flush(page);
      const ev = events(await log()), count = (k) => ev.filter((e) => e === k).length;
      const want = ['film_play:', 'film_progress:25', 'film_progress:50', 'film_progress:75', 'film_progress:100', 'film_end:'];
      check(`${dev}: plays and plays-to-end still counted, once each`, want.every((k) => count(k) === 1) && ev.includes('film_max:'), want.map((k) => k + count(k)));
      check(`${dev}: no page errors`, errors.length === 0, errors);
      await ctx.close();
    }
    // desktop: a click on the picture (not the button) also opens the film
    {
      const { ctx, page, errors } = await open('desktop');
      await sleep(1500);
      const box = await (await page.$('#demo-player')).boundingBox();
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.waitForFunction(() => { const v = document.querySelector('#demo-player video'); return v.currentTime > 0.5 && !v.paused; }, { timeout: 20000 });
      const s = await state(page);
      check('desktop: a click on the loop picture also opens the film, with sound', !s.film.muted && !s.loop, s.film);
      // keyboard: space on the focused player pauses the film (the film's own controls work as before)
      await page.keyboard.press('Space'); await sleep(300);
      check('desktop: after the switch the film\'s own keys work (Space pauses)', (await state(page)).film.paused);
      check('desktop (picture click): no page errors', errors.length === 0, errors);
      await ctx.close();
    }
    // reduced motion: no loop, the cover and the old play button
    for (const dev of ['desktop', 'phone']) {
      const { ctx, page, errors } = await open(dev, true);
      await sleep(1500);
      const s = await state(page);
      check(`${dev} reduced motion: no loop, the film shows the cover, the play button is there`, !s.loop && !s.watch && /cover\.webp/.test(s.film.poster) && s.big !== 'none' && s.film.paused, s);
      await page.screenshot({ path: path.join(OUT, `${dev}-4-reduced-motion.png`) });
      if (dev === 'phone') await page.tap('.fp-big'); else await page.click('.fp-big');
      await page.waitForFunction(() => { const v = document.querySelector('#demo-player video'); return v.currentTime > 0.5 && !v.paused; }, { timeout: 20000 });
      check(`${dev} reduced motion: the play button plays the film with sound`, !(await state(page)).film.muted);
      check(`${dev} reduced motion: no page errors`, errors.length === 0, errors);
      await ctx.close();
    }
  } catch (e) { check('run finished without an exception', false, String(e && e.stack || e)); }
  check('no request left this machine', outside.length === 0, outside.slice(0, 5));
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'film-loop-results.json'), JSON.stringify({ when: new Date().toISOString(), failures, results }, null, 1));
  console.log(failures ? `${failures} FAILED` : `ALL ${results.length} PASSED`);
  process.exit(failures ? 1 : 0);
})();
