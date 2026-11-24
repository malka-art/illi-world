// illi.world page test (2026-11-11; moved into the site repo and extended 2026-11-16: the owner-locked wording (version m2), every utm_ tag carried to
// the store, and a run-wide guard that no request reached production or left this machine): page events fire once each, the privacy question behaves in every consent state,
// nothing is written to the browser before a yes, phone width works. The question is a bar across the bottom of the window
// (ask--bar, updated 2026-11-11 from the earlier corner note). Headless Chrome with a throwaway profile, against
// server.py on 127.0.0.1 (which stands in for the site-event function). Store links and the send-to-desktop endpoint are
// intercepted, so nothing leaves this machine.
//
//   PUPPETEER_PATH=<.../node_modules/puppeteer-core> CHROME=<chrome.exe> BASE=http://127.0.0.1:8765 OUT=<folder> node page-test.cjs
const puppeteer = require(process.env.PUPPETEER_PATH);
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.BASE;
const OUT = process.env.OUT;
const COLLECT = `${BASE}/collect`;
const results = [];
let failures = 0;
const prodHits = [];   // requests aimed at the production Supabase project (aborted; must stay empty)
const outside = [];    // requests to any other host that were allowed to continue (must stay empty)
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function log() { return (await fetch(`${BASE}/__log`)).json(); }
async function clearLog() { await fetch(`${BASE}/__log`, { method: 'DELETE' }); }
function events(batches) {
  const out = [];
  for (const b of batches) for (const e of b.e || []) out.push({ n: e.n, p: e.p || {}, b: b.b || null, f: b.f || null, id: b.id, u: b.u, dev: b.dev });
  return out;
}
const key = (e) => e.n + ':' + (e.p.depth ?? e.p.pct ?? e.p.which ?? e.p.result ?? e.p.id ?? e.p.from ?? '');

async function storage(page) {
  return page.evaluate(async () => {
    let idb = 0;
    try { idb = (await indexedDB.databases()).length; } catch (e) {}
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    return { local: ls, localCount: localStorage.length, session: sessionStorage.length, cookie: document.cookie, idb };
  });
}
const empty = (s) => s.localCount === 0 && s.session === 0 && s.cookie === '' && s.idb === 0;

async function newPage(browser, { width = 1440, height = 900, phone = false, gpc = false, seed = null } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (phone) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  } else {
    // a normal desktop Chrome user agent (headless Chrome says "HeadlessChrome", which the real function treats as a bot)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width, height });
  }
  // the site scrolls smoothly; the test needs scripted scrolls to land at once (this changes nothing else)
  await page.evaluateOnNewDocument(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'html{scroll-behavior:auto!important}'; document.head.appendChild(s); }));
  if (gpc) await page.evaluateOnNewDocument(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  if (seed) await page.evaluateOnNewDocument((s) => { if (location.hostname === '127.0.0.1') for (const k in s) localStorage.setItem(k, s[k]); }, seed);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('chromewebstore.google.com')) return r.respond({ status: 204, body: '' });
    if (u.includes('/functions/v1/send-to-desktop')) return r.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: r.method() === 'OPTIONS' ? '' : '{"ok":true}' });
    if (u.includes('supabase.co')) { prodHits.push(r.method() + ' ' + u.split('?')[0]); return r.abort(); }     // nothing may reach production
    if (!/^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:)/.test(u)) { outside.push(u.split('?')[0]); return r.abort(); }
    return r.continue();
  });
  page.on('popup', (p) => p.close().catch(() => {}));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
}
const url = (extra = '') => `${BASE}/?track_endpoint=${encodeURIComponent(COLLECT)}${extra}`;
async function waitAsk(page, ms = 2500) {
  try { await page.waitForFunction(() => { const a = document.getElementById('ask'); return a && !a.hidden && !a.classList.contains('is-aside'); }, { timeout: ms }); return true; } catch (e) { return false; }
}
const askVisible = (page) => page.evaluate(() => { const a = document.getElementById('ask'); return !!a && !a.hidden && !a.classList.contains('is-aside'); });
// visible and touching the film's box = bad (since the side-by-side hero the note usually sits clear of the film)
const offFilm = (page) => page.evaluate(() => {
  const a = document.getElementById('ask'), s = document.getElementById('stage').getBoundingClientRect();
  if (a.hidden || a.classList.contains('is-aside')) return true;
  const r = a.getBoundingClientRect();
  return !(r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top);
});
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// the room the footer keeps for the bar: --ask-h on the html element and the footer's ::after height
const askH = (page) => page.evaluate(() => ({
  v: getComputedStyle(document.documentElement).getPropertyValue('--ask-h').trim(),
  after: parseFloat(getComputedStyle(document.querySelector('[data-choices-foot]'), '::after').height) || 0,
}));
const noRoom = (a) => (a.v === '' || parseFloat(a.v) === 0) && a.after === 0;
async function flush(page) { await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); }); await sleep(400); }

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'illi-pagetest-'));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, userDataDir: profile, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'] });
  try {
    // ---------- 1. events fire once each (desktop, ignore the question) ----------
    await clearLog();
    {
      const { ctx, page, errors } = await newPage(browser);
      await page.goto(url('&utm_source=test&utm_medium=email&utm_campaign=t1&utm_content=lesson3&utm_term=gestures&other=x'), { waitUntil: 'load' });
      check('before anything: nothing written to the browser', empty(await storage(page)), await storage(page));
      check('question appears on arrival (desktop 1440x900)', await waitAsk(page));
      await sleep(600);   // let the arrival rise finish, so the capture shows the bar at rest
      await page.screenshot({ path: path.join(OUT, 'd-arrival-1440.png') });
      check('question shown: still nothing written to the browser', empty(await storage(page)));
      // the store links carry the campaign tags
      const href = await page.$eval('[data-cta="hero"]', (a) => a.href);
      check('install links carry the campaign tags to the store', /utm_source=test/.test(href) && /utm_campaign=t1/.test(href), href);
      check('every utm_ tag rides along (utm_content, utm_term too), and nothing else from the address', /utm_medium=email/.test(href) && /utm_content=lesson3/.test(href) && /utm_term=gestures/.test(href) && !/other=x/.test(href) && !/track_endpoint/.test(href), href);
      const words = await page.evaluate(() => ({ q: document.getElementById('ask-q').textContent, why: document.querySelector('#ask .ask-why').textContent, b: [...document.querySelectorAll('#ask [data-answer]')].map((x) => x.textContent), sz: [...document.querySelectorAll('#ask [data-answer]')].map((x) => { const r = x.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }) }));
      check('locked wording on the bar: the ask, the body line and the two answers', words.q === 'Mind if illi remembers this browser?' && words.why === 'It’s how a small site like ours learns which links work. The note is a random code, with no name or email in it.' && words.b[0] === 'Remember it' && words.b[1] === 'Don’t remember it', words);
      check('the two answers are the same size', words.sz.length === 2 && words.sz[0] === words.sz[1], words.sz);
      const paint = await page.evaluate(() => [...document.querySelectorAll('#ask [data-answer]')].map((x) => { const c = getComputedStyle(x); return { bg: c.backgroundColor, fg: c.color, weight: c.fontWeight, size: c.fontSize }; }));
      check('the two answers have the same computed background and text colour (and weight and size)', paint.length === 2 && JSON.stringify(paint[0]) === JSON.stringify(paint[1]), paint);
      check('the fill is bone-950 (#7B6D5D) with white (#FFFFFF) text', paint[0].bg === 'rgb(123, 109, 93)' && paint[0].fg === 'rgb(255, 255, 255)', paint[0]);
      const lum = (rgb) => { const c = rgb.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      check('text contrast on the answers is at least 4.5:1', ratio(paint[0].bg, paint[0].fg) >= 4.5, ratio(paint[0].bg, paint[0].fg).toFixed(2));
      // FAQ: hover each row long enough to open
      for (const id of ['learn', 'setup', 'after45']) {
        await page.$eval(`[data-faq="${id}"]`, (el) => el.scrollIntoView({ block: 'center' }));
        const b = await (await page.$(`[data-faq="${id}"]`)).boundingBox();
        await page.mouse.move(b.x + 20, b.y + 10); await sleep(750); await page.mouse.move(5, 5); await sleep(100);
      }
      // scroll the whole page in steps (scroll depth and sections)
      await page.evaluate(() => window.scrollTo(0, 0));
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= H; y += 300) { await page.evaluate((y) => window.scrollTo(0, y), y); await sleep(60); }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
      // the film: play, then jump through it while it plays
      await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
      await page.click('.fp-watch');
      await page.waitForFunction(() => { const v = document.querySelector('#demo-player video'); return v && v.duration > 0 && !v.paused && v.currentTime > 0.2; }, { timeout: 20000 });
      check('while the film plays, the question is never over the film', await offFilm(page));
      const dur = await page.evaluate(() => document.querySelector('#demo-player video').duration);
      for (const f of [0.3, 0.55, 0.8]) { await page.evaluate((t) => { document.querySelector('#demo-player video').currentTime = t; }, dur * f); await sleep(900); }
      await page.evaluate((t) => { document.querySelector('#demo-player video').currentTime = t; }, dur - 1.2);
      await page.waitForFunction(() => document.querySelector('#demo-player video').ended, { timeout: 15000 });
      await page.waitForSelector('.fp-cta.on a', { timeout: 5000 });
      check('at the film end button, the question is never over the film', await offFilm(page));
      await page.screenshot({ path: path.join(OUT, 'd-film-end-1440.png') });
      // every install button, once (the film's end button first, while it is showing)
      await page.click('.fp-cta.on a'); await sleep(150);
      check('an install click removes the unanswered question for this page load', await page.evaluate(() => document.getElementById('ask').hidden || document.getElementById('ask').classList.contains('is-out')));
      await sleep(300);
      const room1 = await askH(page);
      check('after an ignored leave (install click): --ask-h is 0 and the footer has no extra space', noRoom(room1), room1);
      for (const w of ['header', 'hero']) { await page.evaluate(() => window.scrollTo(0, 0)); await page.click(`[data-cta="${w}"]`); await sleep(150); }
      for (const w of ['close', 'footer_store']) { await page.$eval(`[data-cta="${w}"]`, (el) => el.scrollIntoView({ block: 'center' })); await sleep(150); await page.click(`[data-cta="${w}"]`); await sleep(150); }
      // a second click on the same button counts once
      await page.click('[data-cta="footer_store"]'); await sleep(100);
      await flush(page);
      const ev = events(await log());
      const counts = {};
      for (const e of ev) counts[key(e)] = (counts[key(e)] || 0) + 1;
      const once = ['page_view:', 'scroll:25', 'scroll:50', 'scroll:75', 'scroll:100', 'section_seen:hero', 'section_seen:how', 'section_seen:where', 'section_seen:answers', 'section_seen:close',
        'film_play:', 'film_progress:25', 'film_progress:50', 'film_progress:75', 'film_progress:100', 'film_end:',
        'cta_click:film_end', 'cta_click:header', 'cta_click:hero', 'cta_click:close', 'cta_click:footer_store',
        'faq_open:learn', 'faq_open:setup', 'faq_open:after45', 'consent_shown:'];
      const wrong = once.filter((k) => counts[k] !== 1).map((k) => `${k}=${counts[k] || 0}`);
      check('every expected event fired exactly once', wrong.length === 0, wrong.length ? wrong : once.length + ' events');
      const allowed = new Set([...once, 'engaged_time:', 'film_max:']);
      const extra = Object.keys(counts).filter((k) => !allowed.has(k));
      check('no unexpected events (no consent answer was sent)', extra.length === 0, extra);
      const fm = ev.filter((e) => e.n === 'film_max').map((e) => e.p.seconds);
      check('film_max reports the furthest second', fm.length >= 1 && Math.max(...fm) >= Math.floor(dur) - 1, fm);
      check('engaged_time sent', ev.some((e) => e.n === 'engaged_time'));
      check('one visit id per page load, campaign tags in the envelope', new Set(ev.map((e) => e.id)).size === 1 && ev[0].u.s === 'test' && ev[0].u.c === 't1', ev[0] && ev[0].u);
      check('no browser code sent without a yes', ev.every((e) => !e.b && !e.f));
      check('desktop device and can_install', ev.every((e) => e.dev === 'desktop'));
      check('ignored question: still nothing written to the browser', empty(await storage(page)), await storage(page));
      check('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    // ---------- 2. the question: the bottom bar at five window sizes ----------
    // The bar is full width at the bottom of the window from arrival until answered. It steps aside in two cases: the film
    // is playing under it, or the film is unplayed and the bar would cover its play button (not while "What gets saved?" is
    // open, not after an answer). While it is up, the footer grows by its height (--ask-h), so the footer stays reachable.
    const barState = (page) => page.evaluate(() => {
      const a = document.getElementById('ask'), r = a.getBoundingClientRect(), b = (document.querySelector('.fp-watch') || document.querySelector('.fp-big')).getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect();
      const hit = (p, q) => p.left < q.right && p.right > q.left && p.top < q.bottom && p.bottom > q.top;
      return { hidden: a.hidden, aside: a.classList.contains('is-aside'), inert: a.inert, vis: getComputedStyle(a).visibility, askH: getComputedStyle(document.documentElement).getPropertyValue('--ask-h').trim(),
        coversBig: !!(b.width && hit(r, { left: b.left - 12, right: b.right + 12, top: b.top - 12, bottom: b.bottom + 12 })), overStage: hit(r, s), played: document.getElementById('demo-player').classList.contains('played'), y: Math.round(scrollY), top: Math.round(r.top), bigBottom: Math.round(b.bottom) };
    });
    // scroll down in small steps, from where the page is, until the bar's box no longer covers the play button
    const scrollClear = (page) => page.evaluate(() => {
      const a = document.getElementById('ask'), big = (document.querySelector('.fp-watch') || document.querySelector('.fp-big'));
      const hit = (p, q) => p.left < q.right && p.right > q.left && p.top < q.bottom && p.bottom > q.top;
      for (let y = scrollY; y < scrollY + 1200; y += 4) { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); if (!hit(a.getBoundingClientRect(), ((q) => ({ left: q.left - 12, right: q.right + 12, top: q.top - 12, bottom: q.bottom + 12 }))(big.getBoundingClientRect()))) return Math.round(scrollY); }
      return -1;
    });
    const shownCount = async (page) => { await flush(page); return events(await log()).filter((e) => e.n === 'consent_shown').length; };
    for (const [w, h] of [[1440, 900], [1280, 720], [1100, 700], [1920, 1080], [820, 900]]) {
      await sleep(1500); await clearLog();   // beacons from the pages closed above arrive first
      const { ctx, page, errors } = await newPage(browser, { width: w, height: h });
      await page.goto(url(), { waitUntil: 'load' });
      let up = true;
      try { await page.waitForFunction(() => !document.getElementById('ask').hidden, { timeout: 2500 }); } catch (e) { up = false; }
      await sleep(900);   // the arrival rise has settled
      check(`${w}x${h}: the bar arrives`, up);
      const a0 = await barState(page);
      const coveredOnArrival = a0.coversBig;   // detected from geometry, not from the window size
      let where = 'on arrival', startY = 0;
      if (coveredOnArrival) {
        // the bar would cover the unplayed film's play button: aside and inert, nothing saved, nothing announced yet
        check(`${w}x${h}: bar would cover the play button on arrival: aside, inert, --ask-h 0`, a0.aside && a0.inert && a0.vis === 'hidden' && parseFloat(a0.askH) === 0, a0);
        check(`${w}x${h}: aside on arrival: nothing in storage`, empty(await storage(page)));
        check(`${w}x${h}: aside on arrival: no consent_shown yet`, (await shownCount(page)) === 0);
        await page.screenshot({ path: path.join(OUT, `d-arrival-${w}.png`) });
        startY = await scrollClear(page); await sleep(400);
        where = `scrolled to ${startY}px, play button clear`;
        const a1 = await barState(page);
        check(`${w}x${h}: after a small scroll the play button is clear and the bar is back`, startY > 0 && !a1.coversBig && !a1.aside && !a1.inert && a1.vis === 'visible', a1);
        check(`${w}x${h}: consent_shown fires exactly once, when the bar is really visible`, (await shownCount(page)) === 1);
        await page.screenshot({ path: path.join(OUT, `d-scrolled-${w}.png`) });
      } else {
        check(`${w}x${h}: bar visible on arrival, not aside`, !a0.aside && !a0.inert && a0.vis === 'visible', a0);
        check(`${w}x${h}: consent_shown fires exactly once on arrival`, (await shownCount(page)) === 1);
        if (w !== 1440) await page.screenshot({ path: path.join(OUT, `d-arrival-${w}.png`) });
      }
      // (1) placement, from here (on arrival, or after the small scroll)
      const arr = await page.evaluate(() => {
        const ask = document.getElementById('ask'), r = ask.getBoundingClientRect(), cw = document.documentElement.clientWidth;
        const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const over = [];
        for (const [n, sel] of [['hero install', '.hero-action .button'], ['header install', '.site-head .cta'], ['play', '.fp-watch']]) {
          const el = document.querySelector(sel); if (!el) { over.push(n + ' missing'); continue; }
          const b = el.getBoundingClientRect(); if (b.width && b.height && hit(r, b)) over.push(n);
        }
        return { left: r.left, right: r.right, cw, bottom: r.bottom, ih: innerHeight, top: Math.round(r.top), height: Math.round(r.height), over, seat: ask.getAttribute('data-seat'), focusInside: ask.contains(document.activeElement), overflow: getComputedStyle(document.documentElement).overflowY };
      });
      check(`${w}x${h}: ${where}: the bar is full width and flush with the bottom`, Math.abs(arr.left) < 0.5 && Math.abs(arr.right - arr.cw) < 0.5 && Math.abs(arr.bottom - arr.ih) < 0.5, { left: arr.left, right: arr.right, width: arr.cw, bottom: arr.bottom, window: arr.ih });
      check(`${w}x${h}: ${where}: the bar is clear of the hero install, header install and play buttons`, arr.over.length === 0, arr.over.length ? arr.over : { top: arr.top, height: arr.height });
      check(`${w}x${h}: focus never taken, scrolling never locked`, !arr.focusInside && arr.overflow !== 'hidden');
      const askH0 = await askH(page);
      check(`${w}x${h}: while the bar is up, --ask-h matches its height and the footer grows by it`, parseFloat(askH0.v) === arr.height && Math.abs(askH0.after - arr.height) <= 1, { askH: askH0, bar: arr.height });
      // (2) the two answers: identical computed styles and sizes; stacked at 960 and up, side by side under it
      const ans = await page.evaluate(() => {
        const [a, b] = document.querySelectorAll('#ask .ask-btn'), ca = getComputedStyle(a), cb = getComputedStyle(b), diff = [];
        for (let i = 0; i < ca.length; i++) { const p = ca[i]; if (ca.getPropertyValue(p) !== cb.getPropertyValue(p)) diff.push(p + ': ' + ca.getPropertyValue(p) + ' vs ' + cb.getPropertyValue(p)); }
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return { diff, sa: [ra.width, ra.height], sb: [rb.width, rb.height], sameClass: a.className === b.className && a.className === 'ask-btn', stacked: Math.abs(ra.left - rb.left) < 0.5 && rb.top >= ra.bottom, side: Math.abs(ra.top - rb.top) < 0.5 && rb.left >= ra.right };
      });
      check(`${w}x${h}: the two answers share one class and have identical computed styles`, ans.sameClass && ans.diff.length === 0, ans.diff.slice(0, 6));
      check(`${w}x${h}: the two answers are the same size`, Math.abs(ans.sa[0] - ans.sb[0]) < 0.5 && Math.abs(ans.sa[1] - ans.sb[1]) < 0.5, { yes: ans.sa, no: ans.sb });
      check(`${w}x${h}: answers ${w >= 960 ? 'stacked' : 'side by side'}`, w >= 960 ? ans.stacked : ans.side, ans);
      // (6) no sideways scroll on arrival
      let wide = await noSideScroll(page);
      check(`${w}x${h}: no horizontal scrollbar ${where}`, wide <= 0, wide);
      // (2b) the whole scroll range, note closed, film unplayed: whenever the bar is visible it is clear of the play button;
      // whenever it is aside, it is because it would cover it (never stuck aside); a second scroll event at the same
      // position never changes the answer (no flicker)
      const sw = await page.evaluate(() => {
        const a = document.getElementById('ask'), big = (document.querySelector('.fp-watch') || document.querySelector('.fp-big'));
        const hit = (p, q) => p.left < q.right && p.right > q.left && p.top < q.bottom && p.bottom > q.top;
        const max = document.documentElement.scrollHeight - innerHeight, over = [], stuck = [], flicker = [];
        let steps = 0, asideSteps = 0, minClear = null;
        for (let y = 0; y <= max; y += 4) {
          window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); steps++;
          const covers = hit(a.getBoundingClientRect(), ((q) => ({ left: q.left - 12, right: q.right + 12, top: q.top - 12, bottom: q.bottom + 12 }))(big.getBoundingClientRect())), aside = a.classList.contains('is-aside');
          if (aside) asideSteps++;
          const bb = big.getBoundingClientRect();
          if (!aside && bb.bottom > 0 && bb.top < innerHeight) { const c = a.getBoundingClientRect().top - bb.bottom; if (minClear === null || c < minClear) minClear = Math.round(c * 10) / 10; }
          if (!aside && covers) over.push(y);
          if (aside && !covers) stuck.push(y);
          window.dispatchEvent(new Event('scroll'));
          if (a.classList.contains('is-aside') !== aside) flicker.push(y);
        }
        return { steps, asideSteps, minClear, over: over.slice(0, 6), stuck: stuck.slice(0, 6), flicker: flicker.slice(0, 6), played: document.getElementById('demo-player').classList.contains('played') };
      });
      check(`${w}x${h}: scroll sweep, note closed: the visible bar never covers the unplayed film's play button`, !sw.played && sw.over.length === 0, sw);
      check(`${w}x${h}: scroll sweep: whenever the visible bar and the play button share the screen, at least 12px of air (1px rounding)`, sw.minClear === null || sw.minClear >= 11, { minClear: sw.minClear });
      check(`${w}x${h}: scroll sweep: never aside without a reason, no flicker`, sw.stuck.length === 0 && sw.flicker.length === 0, sw);
      await page.evaluate((y) => { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); }, startY); await sleep(300);
      // "What gets saved?" open: the bar stays flush, under the header, answers in view, still no sideways scroll
      await page.click('#ask .ask-more'); await sleep(200);
      const open = await page.evaluate(() => {
        const ask = document.getElementById('ask'), r = ask.getBoundingClientRect(), head = document.querySelector('.site-head').getBoundingClientRect();
        const bs = [...ask.querySelectorAll('.ask-btn')].map((b) => b.getBoundingClientRect());
        return { top: Math.round(r.top), bottom: r.bottom, ih: innerHeight, head: Math.round(head.bottom), answersIn: bs.every((b) => b.top >= r.top && b.bottom <= r.bottom && b.bottom <= innerHeight), noteShown: !document.getElementById('ask-note').hidden, askH: getComputedStyle(document.documentElement).getPropertyValue('--ask-h').trim(), h: Math.round(r.height) };
      });
      check(`${w}x${h}: "What gets saved?" open: bar stays flush, under the header, answers in view`, open.noteShown && Math.abs(open.bottom - open.ih) < 0.5 && open.top >= open.head && open.answersIn, open);
      check(`${w}x${h}: "What gets saved?" open: --ask-h follows the taller bar`, parseFloat(open.askH) === open.h, { askH: open.askH, bar: open.h });
      wide = await noSideScroll(page);
      check(`${w}x${h}: no horizontal scrollbar with the note open`, wide <= 0, wide);
      await page.screenshot({ path: path.join(OUT, `d-open-${w}.png`) });
      // (3b) note open over the play button: the bar stays (the visitor is reading it); closing the note re-applies the rule.
      // Find such a position: here, or anywhere higher up the page.
      let o = await barState(page);
      if (!o.coversBig) {
        const y = await page.evaluate(() => {
          const a = document.getElementById('ask'), big = (document.querySelector('.fp-watch') || document.querySelector('.fp-big'));
          const hit = (p, q) => p.left < q.right && p.right > q.left && p.top < q.bottom && p.bottom > q.top;
          for (let y = scrollY; y >= 0; y -= 8) { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); if (hit(a.getBoundingClientRect(), ((q) => ({ left: q.left - 12, right: q.right + 12, top: q.top - 12, bottom: q.bottom + 12 }))(big.getBoundingClientRect()))) return y; }
          return -1;
        });
        await sleep(250); o = await barState(page);
        if (y < 0) console.log(`INFO ${w}x${h}: with the note open the bar never reaches the play button, so the note-open override is not exercised at this size`);
      }
      if (o.coversBig) {
        // prefer a position where the bar would still cover the button after the note closes, so the re-apply is exercised
        await page.evaluate((closedH) => {
          const big = (document.querySelector('.fp-watch') || document.querySelector('.fp-big'));
          for (let y = scrollY; y >= 0; y -= 4) { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); const b = big.getBoundingClientRect(); if (b.bottom + 12 > innerHeight - closedH && b.top < innerHeight) return; }
        }, arr.height);
        await sleep(250); o = await barState(page);
        check(`${w}x${h}: note open and the bar over the play button: the bar stays visible`, o.coversBig && !o.aside && !o.inert && o.vis === 'visible', o);
        await page.screenshot({ path: path.join(OUT, `d-open-over-play-${w}.png`) });
        // close it the way a keyboard user would: Enter on the focused expander
        await page.focus('#ask .ask-more'); await page.keyboard.press('Enter'); await sleep(300);
        const c = await barState(page);
        const f = await page.evaluate(() => { const e = document.activeElement; return e === document.body ? 'body' : (e.className || e.tagName); });
        // the closed bar is shorter: where it no longer reaches the play button (e.g. the lower "Watch the demo" button of the
        // preview loop, task 928, at 1280x720 and 1100x700) the bar simply stays, and the focus-leaves re-apply cannot be exercised
        const reach = c.coversBig;
        if (!reach) console.log(`INFO ${w}x${h}: the closed bar does not reach the play button, so the focus-leaves re-apply is not exercised at this size`);
        check(`${w}x${h}: note closed by keyboard over the play button: the bar stays while focus is inside it`, !c.aside && !c.inert && c.vis === 'visible', c);
        check(`${w}x${h}: closing the note by keyboard keeps focus on "What gets saved?"`, f === 'ask-more', f);
        // focus leaves the bar (Shift+Tab back to the header): the play-button rule applies again
        await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await sleep(300);
        const g = await barState(page);
        const fe = await page.evaluate(() => { const e = document.activeElement; return { inBar: !!e.closest('#ask'), what: e === document.body ? 'body' : (e.className || e.tagName) }; });
        if (reach) check(`${w}x${h}: focus has left the bar and it still covers the padded play button: aside and inert`, !fe.inBar && g.coversBig && g.aside && g.inert && parseFloat(g.askH) === 0, { g, focus: fe.what });
        else check(`${w}x${h}: focus has left the bar, which is clear of the play button: it stays, clickable`, !fe.inBar && !g.coversBig && !g.aside && !g.inert && g.vis === 'visible', { g, focus: fe.what });
        await scrollClear(page); await sleep(300);
      } else {
        await page.click('#ask .ask-more'); await sleep(200);
      }
      await page.evaluate((y) => { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); }, startY); await sleep(250);
      // (4) scrolled to the very bottom: Privacy choices is fully above the bar and really clickable; the panel opens
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
      const foot = await page.evaluate(() => {
        const ask = document.getElementById('ask'), r = ask.getBoundingClientRect(), b = document.querySelector('.foot-choice').getBoundingClientRect();
        const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { btnTop: Math.round(b.top), btnBottom: Math.round(b.bottom), barTop: Math.round(r.top), visible: !ask.hidden && !ask.classList.contains('is-aside'), hitsButton: !!at && at.closest('.foot-choice') !== null, x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      check(`${w}x${h}: at the very bottom, Privacy choices is fully above the bar and clickable`, foot.visible && foot.btnTop >= 0 && foot.btnBottom <= foot.barTop && foot.hitsButton, foot);
      wide = await noSideScroll(page);
      check(`${w}x${h}: no horizontal scrollbar at the bottom of the page`, wide <= 0, wide);
      await page.screenshot({ path: path.join(OUT, `d-bottom-${w}.png`) });
      await page.mouse.click(foot.x, foot.y); await sleep(250);
      const pnl = await page.evaluate(() => {
        const p = document.getElementById('choices'); if (p.hidden) return { open: false };
        const r = p.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { open: true, onTop: !!at && p.contains(at), inWindow: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= document.documentElement.clientWidth };
      });
      check(`${w}x${h}: clicking Privacy choices above the bar opens the panel, on top and in the window`, pnl.open && pnl.onTop && pnl.inWindow, pnl);
      if (w === 1440) await page.screenshot({ path: path.join(OUT, 'd-bottom-panel-1440.png') });
      await page.keyboard.press('Escape'); await sleep(150);
      check(`${w}x${h}: panel closed by Escape, bar still waiting, nothing saved`, (await page.evaluate(() => document.getElementById('choices').hidden && !document.getElementById('ask').hidden)) && empty(await storage(page)));
      await page.evaluate((y) => { window.scrollTo(0, y); window.dispatchEvent(new Event('scroll')); }, startY); await sleep(250);
      if (w === 1440 || coveredOnArrival) {
        // (3) the film plays under the bar: aside and inert; paused: back. At 1440x900 the stage sits at the top of the page,
        // above the bar, and no scroll can bring them together (scrolling only moves the stage up, away from the bar), and
        // even with "What gets saved?" open the bar stays below the stage. So at 1440 wide: first prove the bar stays while
        // the film plays clear of it, then shorten the window to 1440x620, where the bar lies over the stage on arrival.
        // Where the bar would cover the play button on arrival (820x900 today), this starts from the small scroll that clears
        // the button; the bar still lies over the lower part of the stage there.
        const overlapNow = () => page.evaluate(() => { const s = document.getElementById('stage').getBoundingClientRect(), r = document.getElementById('ask').getBoundingClientRect(); return r.top < s.bottom && r.bottom > s.top; });
        let how = 'on arrival';
        if (!(await overlapNow())) {
          await page.click('.fp-watch');
          await page.waitForFunction(() => { const v = document.querySelector('#demo-player video'); return v && !v.paused && v.currentTime > 0.2; }, { timeout: 20000 });
          await sleep(300);
          const stay = await page.evaluate(() => { const a = document.getElementById('ask'); return { aside: a.classList.contains('is-aside'), inert: a.inert }; });
          check(`${w}x${h}: film playing clear of the bar: the bar stays`, !(await overlapNow()) && !stay.aside && !stay.inert, stay);
          await page.click('#ask .ask-more'); await sleep(250);
          check(`${w}x${h}: film playing, "What gets saved?" open: still clear of the stage, the bar stays`, !(await overlapNow()) && !(await page.evaluate(() => document.getElementById('ask').classList.contains('is-aside'))));
          await page.click('#ask .ask-more'); await sleep(150);
          await page.evaluate(() => document.querySelector('#demo-player video').pause()); await sleep(200);
          await page.setViewport({ width: w, height: 620 }); await sleep(400);
          how = 'window shortened to 620 tall';
        }
        const before = await page.evaluate(() => { const a = document.getElementById('ask'); return { aside: a.classList.contains('is-aside'), inert: a.inert }; });
        check(`${w}x${h}: film not playing, bar over the stage (${how}): the bar stays`, (await overlapNow()) && !before.aside && !before.inert, before);
        const pb = await page.evaluate(() => { const b = (document.querySelector('.fp-watch') || document.querySelector('.fp-big')).getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { x: b.left + b.width / 2, y: b.top + b.height / 2, free: !!at && !at.closest('#ask') }; });
        const started = await page.evaluate(() => document.querySelector('#demo-player video').currentTime > 0);
        if (started) await page.evaluate(() => document.querySelector('#demo-player video').play());   // resume, as the player's own control would
        else if (pb.free) await page.mouse.click(pb.x, pb.y); else await page.evaluate(() => (document.querySelector('.fp-watch') || document.querySelector('.fp-big')).click());
        await page.waitForFunction(() => { const v = document.querySelector('#demo-player video'); return v && !v.paused && v.currentTime > 0.2; }, { timeout: 20000 });
        await sleep(300);
        const under = await page.evaluate(() => {
          const a = document.getElementById('ask'), v = document.querySelector('#demo-player video'), s = document.getElementById('stage').getBoundingClientRect(), r = a.getBoundingClientRect();
          return { overlap: r.top < s.bottom && r.bottom > s.top, playing: !v.paused, aside: a.classList.contains('is-aside'), inert: a.inert, vis: getComputedStyle(a).visibility, askH: getComputedStyle(document.documentElement).getPropertyValue('--ask-h').trim() };
        });
        check(`${w}x${h}: film playing under the bar: the bar is aside and inert`, under.overlap && under.playing && under.aside && under.inert && under.vis === 'hidden', under);
        await page.screenshot({ path: path.join(OUT, `d-film-aside-${w}.png`) });
        await page.evaluate(() => document.querySelector('#demo-player video').pause()); await sleep(400);
        const back = await page.evaluate(() => { const a = document.getElementById('ask'); return { aside: a.classList.contains('is-aside'), inert: a.inert, hidden: a.hidden, vis: getComputedStyle(a).visibility }; });
        check(`${w}x${h}: film paused: the bar returns, clickable`, !back.aside && !back.inert && !back.hidden && back.vis === 'visible', back);
        await page.screenshot({ path: path.join(OUT, `d-film-paused-${w}.png`) });
        if (how !== 'on arrival') { await page.setViewport({ width: w, height: h }); await sleep(300); }
        await page.evaluate(() => window.scrollTo(0, 0)); await sleep(250);
      }
      if (w === 1440) {
        // (7) keyboard: Tab from the top of the page reaches the expander, the policy link and both answers; Escape dismisses
        // move the sequential focus starting point back to the top of the page (earlier clicks left it inside the bar)
        await page.evaluate(() => { const b = document.body; b.tabIndex = -1; b.focus(); b.removeAttribute('tabindex'); window.scrollTo(0, 0); });
        const reached = new Set();
        for (let i = 0; i < 25 && !['expander', 'policy', 'yes', 'no'].every((k) => reached.has(k)); i++) {
          await page.keyboard.press('Tab');
          const k = await page.evaluate(() => { const e = document.activeElement; if (!e || !e.closest('#ask')) return null; return e.matches('.ask-more') ? 'expander' : e.matches('.ask-policy') ? 'policy' : e.matches('[data-answer="yes"]') ? 'yes' : e.matches('[data-answer="no"]') ? 'no' : e.tagName; });
          if (k) reached.add(k);
        }
        check('keyboard: Tab reaches "What gets saved?", the policy link and both answers', ['expander', 'policy', 'yes', 'no'].every((k) => reached.has(k)), [...reached]);
        await page.keyboard.press('Escape'); await sleep(400);
        check('keyboard: Escape dismisses the bar without saving', (await page.evaluate(() => document.getElementById('ask').hidden)) && empty(await storage(page)));
        // (5) after an ignored leave the footer has no extra room
        const left = await askH(page);
        check('after an ignored leave (Escape): --ask-h is 0 and the footer has no extra space', noRoom(left), left);
        check('1440x900: no page errors in the bar checks', errors.length === 0, errors);
      }
      await ctx.close();
    }

    // ---------- 3. consent states ----------
    // 3a ignore -> asked again next visit
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(url(), { waitUntil: 'load' });
      await waitAsk(page);
      await page.reload({ waitUntil: 'load' });
      check('ignore: asked again on the next load, nothing saved', (await waitAsk(page)) && empty(await storage(page)));
      await ctx.close();
    }
    // 3b yes
    {
      await clearLog();
      const { ctx, page } = await newPage(browser);
      await page.goto(url('&utm_source=partner&utm_campaign=nov'), { waitUntil: 'load' });
      await waitAsk(page);
      check('before the yes: nothing written', empty(await storage(page)));
      await page.click('#ask [data-answer="yes"]'); await sleep(200);
      const s = await storage(page);
      const note = s.local['illi.note'] && JSON.parse(s.local['illi.note']);
      check('yes: the note holds only a random code, the first tags, the time of the yes and the wording version (task 304)', note && /^[0-9a-f-]{36}$/.test(note.id) && note.f.s === 'partner' && note.f.c === 'nov' && note.v === 'm3' && Object.keys(note).sort().join() === 'at,f,id,v' && s.localCount === 1, note);
      check('yes: confirmation shown', await page.$eval('#ask [data-when="yes"]', (e) => !e.hidden && e.offsetParent !== null));
      await page.screenshot({ path: path.join(OUT, 'd-yes.png') });
      await page.mouse.move(5, 5); await sleep(6600);
      const room = await askH(page);
      check('after a yes: the confirmation leaves, --ask-h is 0 and the footer has no extra space', (await page.evaluate(() => document.getElementById('ask').hidden)) && noRoom(room), room);
      await flush(page);
      let ev = events(await log());
      const yes = ev.filter((e) => e.n === 'consent_yes');
      check('yes: one consent_yes with the wording version, carrying the code', yes.length === 1 && yes[0].p.v === 'm3' && yes[0].p.from === 'note' && yes[0].b === note.id && yes[0].f.s === 'partner', yes);
      await clearLog();
      await page.goto(url(), { waitUntil: 'load' }); await sleep(1600);
      check('yes: not asked again', !(await askVisible(page)));
      await flush(page);
      ev = events(await log());
      check('yes: later visits carry the code and the first tags, not the new visit tags', ev.length > 0 && ev.every((e) => e.b === note.id && e.f.s === 'partner'), ev.length);
      check('yes: no consent_shown on a later visit', !ev.some((e) => e.n === 'consent_shown'));
      // the panel shows the expiry date and Forget this browser
      await page.$eval('.foot-choice', (b) => b.scrollIntoView()); await page.click('.foot-choice'); await sleep(200);
      const txt = await page.$eval('#choices', (e) => e.innerText);
      check('panel (remembered): expiry date and "Forget this browser"', /remembers this browser until \w+ \d+, \d{4}/.test(txt) && /Forget this browser/.test(txt), txt.split('\n').slice(0, 3));
      await page.screenshot({ path: path.join(OUT, 'panel-note-on-1440.png') });
      await clearLog();
      await page.click('[data-choice="forget"]'); await sleep(150);
      const s2 = await storage(page);
      check('Forget this browser: note deleted, a no remembered', !s2.local['illi.note'] && /"a":"no"/.test(s2.local['illi.answer'] || ''), s2.local);
      await flush(page);
      ev = events(await log());
      check('Forget: one consent_no from the panel, without the code', ev.filter((e) => e.n === 'consent_no' && e.p.from === 'panel').length === 1 && ev.every((e) => !e.b), ev.map(key));
      await ctx.close();
    }
    // 3c no
    {
      await clearLog();
      const { ctx, page } = await newPage(browser);
      await page.goto(url(), { waitUntil: 'load' });
      await waitAsk(page);
      await page.click('#ask [data-answer="no"]'); await sleep(200);
      const s = await storage(page);
      check('no: only the no is saved', s.localCount === 1 && /"a":"no"/.test(s.local['illi.answer'] || '') && !s.local['illi.note'], s.local);
      await page.screenshot({ path: path.join(OUT, 'd-no.png') });
      await sleep(6600);
      check('no: confirmation leaves after about six seconds', await page.evaluate(() => document.getElementById('ask').hidden));
      const room = await askH(page);
      check('after a no: --ask-h is 0 and the footer has no extra space', noRoom(room), room);
      await flush(page);
      const ev = events(await log());
      check('no: one consent_no from the note, no code', ev.filter((e) => e.n === 'consent_no' && e.p.from === 'note').length === 1 && ev.every((e) => !e.b));
      await page.reload({ waitUntil: 'load' }); await sleep(1600);
      check('no: never asked again', !(await askVisible(page)));
      await ctx.close();
    }
    // 3d expired yes
    {
      const old = new Date(); old.setMonth(old.getMonth() - 14);
      const { ctx, page } = await newPage(browser, { seed: { 'illi.note': JSON.stringify({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', f: {}, at: old.toISOString() }) } });
      await page.goto(url(), { waitUntil: 'load' });
      // the seed runs on every navigation, so read the state right after the page's own scripts ran
      const shown = await waitAsk(page);
      check('expired yes (14 months): asked again', shown);
      await ctx.close();
      const fresh = new Date(); fresh.setMonth(fresh.getMonth() - 12);
      const b = await newPage(browser, { seed: { 'illi.note': JSON.stringify({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', f: {}, at: fresh.toISOString() }) } });
      await b.page.goto(url(), { waitUntil: 'load' }); await sleep(1600);
      check('live yes (12 months): not asked', !(await askVisible(b.page)));
      await b.ctx.close();
      // expiry deletes the old note: check without re-seeding
      const c = await newPage(browser);
      await c.page.goto(`${BASE}/robots.txt`);
      await c.page.evaluate((v) => localStorage.setItem('illi.note', v), JSON.stringify({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', f: {}, at: old.toISOString() }));
      await c.page.goto(url(), { waitUntil: 'load' }); await waitAsk(c.page);
      check('expired yes: the old note is deleted before asking', !(await storage(c.page)).local['illi.note']);
      await c.ctx.close();
    }
    // 3e Global Privacy Control
    {
      await sleep(1500);   // let beacons from the closed pages above arrive first
      await clearLog();
      const { ctx, page } = await newPage(browser, { gpc: true });
      await page.goto(url(), { waitUntil: 'load' }); await sleep(1600);
      check('GPC: no question', !(await askVisible(page)));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
      await page.click('.foot-choice'); await sleep(200);
      const txt = await page.$eval('#choices', (e) => e.innerText);
      check('GPC: panel shows the privacy-signal line only', /asks sites not to track you/.test(txt) && !/Stop counting/.test(txt), txt.split('\n').slice(0, 3));
      await page.screenshot({ path: path.join(OUT, 'panel-gpc-1440.png') });
      await flush(page); await sleep(3200);
      check('GPC: nothing sent at all', (await log()).length === 0, events(await log()).map(key));
      check('GPC: nothing written', empty(await storage(page)));
      await ctx.close();
    }
    // 3f stop counting (after a yes, so switch (b) is exercised: off since the owner's ruling 2026-11-16, so the note must survive)
    {
      await clearLog();
      const { ctx, page } = await newPage(browser);
      await page.goto(url(), { waitUntil: 'load' }); await waitAsk(page);
      await page.click('#ask [data-answer="yes"]'); await sleep(200);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
      await page.click('.foot-choice'); await sleep(200);
      await flush(page); await clearLog();
      await page.click('[data-choice="stop"]'); await sleep(150);
      const s = await storage(page);
      check('stop counting: one setting saved; the note the visitor agreed to is kept (switch off, owner 2026-11-16)', !!s.local['illi.nocount'] && !!s.local['illi.note'], Object.keys(s.local));
      const txt = await page.$eval('#choices', (e) => e.innerText);
      check('stop counting: the panel says so, says nothing about deleting the code, and still shows the browser remembered', /won’t send visit counts anymore/.test(txt) && !/deleted the random code too/.test(txt) && /remembers this browser until/.test(txt));
      await page.screenshot({ path: path.join(OUT, 'panel-stopped-1440.png') });
      await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(400, 400); await sleep(100);
      await flush(page); await sleep(3200);
      check('stop counting: nothing more is sent from this page', (await log()).length === 0, (await log()).length);
      await page.reload({ waitUntil: 'load' }); await sleep(1600);
      await page.evaluate(() => window.scrollTo(0, 2000)); await flush(page); await sleep(3200);
      check('stop counting: next load sends nothing and asks nothing', (await log()).length === 0 && !(await askVisible(page)));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
      await page.click('.foot-choice'); await sleep(200);
      const txt2 = await page.$eval('#choices', (e) => e.innerText);
      check('stop counting at rest: "because you turned them off"', /because you turned them off/.test(txt2));
      await page.click('[data-choice="count"]'); await sleep(150);
      check('Count my visits again removes the setting', !(await storage(page)).local['illi.nocount']);
      await page.reload({ waitUntil: 'load' }); await sleep(800); await flush(page);
      check('counting again on the next load', events(await log()).some((e) => e.n === 'page_view'));
      await ctx.close();
    }

    // ---------- 4. phone width ----------
    {
      await sleep(1500);
      await clearLog();
      const { ctx, page, errors } = await newPage(browser, { phone: true });
      await page.goto(url(), { waitUntil: 'load' }); await sleep(1600);
      check('phone: no question', !(await askVisible(page)));
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check('phone: no sideways scroll', wide <= 0, wide);
      // task 933: the phone's install buttons say "Send illi to my computer" and open the handoff sheet (store route, then the email)
      await page.click('.hero-action a[href="#handoff"]'); await sleep(300);
      check('phone: the hero button opens the handoff sheet', await page.evaluate(() => document.getElementById('handoff').open));
      await page.type('#handoff-email', 'test@example.com');
      await page.click('#handoff-form button[type="submit"]'); await sleep(600);
      await page.click('#handoff-close'); await sleep(200);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
      await page.screenshot({ path: path.join(OUT, 'phone-390-footer.png') });
      await page.click('.foot-choice'); await sleep(250);
      const r = await page.$eval('#choices', (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: innerWidth, h: innerHeight }; });
      check('phone: the panel fits the screen', r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h, r);
      await page.screenshot({ path: path.join(OUT, 'phone-390-panel.png') });
      await page.keyboard.press('Escape');
      await flush(page);
      const ev = events(await log());
      check('phone: send form result counted once, as sent, never the address', ev.filter((e) => e.n === 'send_form_submit' && e.p.result === 'sent').length === 1 && !JSON.stringify(await log()).includes('example.com'), ev.filter((e) => e.n === 'send_form_submit').map(key));
      check('phone: device phone, no consent events', ev.every((e) => e.dev === 'phone') && !ev.some((e) => /^consent/.test(e.n)));
      check('phone: nothing written', empty(await storage(page)));
      check('phone: no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    // ---------- 5. the panel on the policy pages ----------
    for (const p of ['/privacy.html', '/terms.html', '/fr/privacy.html', '/fr/terms.html']) {
      const { ctx, page, errors } = await newPage(browser);
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(150);
      await page.click('.foot-choice'); await sleep(200);
      const txt = await page.$eval('#choices', (e) => e.innerText);
      const ok = p.startsWith('/fr') ? /Choix de confidentialité/.test(txt) && /Ne plus compter mes visites/.test(txt) : /Privacy choices/.test(txt) && /Stop counting my visits/.test(txt);
      check(`${p}: footer link opens the panel`, ok && errors.length === 0, errors);
      check(`${p}: opening the panel writes nothing`, empty(await storage(page)));
      await page.screenshot({ path: path.join(OUT, 'panel' + p.replace(/[\/.]/g, '-') + '.png') });
      await ctx.close();
    }
    // ---------- 6. run-wide: nothing reached production, nothing left this machine ----------
    check('nothing reached production: no request to the Supabase project left the browser', prodHits.length === 0, prodHits.slice(0, 5));
    check('no request to any other outside host either (store links and the send form are answered locally)', outside.length === 0, outside.slice(0, 5));
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), failures, results }, null, 2));
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
