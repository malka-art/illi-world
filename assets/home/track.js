/* illi.world first-party page events (2026-11-11). No cookies, no fingerprinting, and this file writes nothing to the browser.
   One random visit id per page load, kept in memory only. Sends nothing when Global Privacy Control or Do Not Track is on,
   or when the visitor chose "Stop counting my visits" under Privacy choices (illi.nocount, written by assets/consent/consent.js).
   If the visitor said yes to the corner question, each batch also carries the remembered random code and the campaign tags
   of the visit on which they said yes (illi.note), so a return visit can be told from a new one. Nobody else's batch does.
   Events go to illi's own database through the site-event Edge Function (sendBeacon, text/plain JSON, batches of 20).
   Local testing only: on localhost, ?track_endpoint=<url> points it at a mock server. */
(function () {
  'use strict';
  var N = navigator, W = window, D = document, L = location;
  function read(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function stopped() { return !!read('illi.nocount'); }
  function note() {   // a yes younger than 13 months (consent.js deletes an older one)
    var n = read('illi.note'), d;
    if (!n || !n.id || !n.at) return null;
    d = new Date(n.at); d.setMonth(d.getMonth() + 13);
    return Date.now() < d.getTime() ? n : null;
  }
  if (N.globalPrivacyControl || N.doNotTrack == '1' || !crypto.randomUUID || stopped()) return;
  var q = new URLSearchParams(L.search);
  var END = (/^(localhost|127\.0\.0\.1)$/.test(L.hostname) && q.get('track_endpoint')) || 'https://wbobpjzkasbnkxbiiioe.supabase.co/functions/v1/site-event';
  var ua = N.userAgent, uad = N.userAgentData;
  var dev = /iPad/.test(ua) || (/Mac/.test(ua) && N.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : (uad && uad.mobile) || /Mobi|iPhone|Android/.test(ua) ? 'phone' : 'desktop';
  var ci = dev == 'desktop' && (uad ? uad.brands.some(function (b) { return b.brand == 'Chromium'; }) : /Chrome\/|Edg\//.test(ua) && !/Firefox/.test(ua));
  var utm = {}, keys = { s: 'utm_source', m: 'utm_medium', c: 'utm_campaign', ct: 'utm_content', id: 'utm_id' }, k, v;
  for (k in keys) if ((v = q.get(keys[k]))) utm[k] = v.slice(0, 80);
  var ref = '';
  try { ref = new URL(D.referrer).hostname; } catch (e) {}
  if (ref == L.hostname) ref = '';
  var base = { v: 1, id: crypto.randomUUID(), page: L.pathname, ref: ref, dev: dev, ci: ci, u: utm }, queue = [], timer = 0, once = {}, off = false;

  function send() {
    clearTimeout(timer); timer = 0;
    if (off || stopped()) { off = true; queue.length = 0; return; }
    var n = note();
    if (n) { base.b = n.id; base.f = n.f || {}; } else { delete base.b; delete base.f; }
    while (queue.length) { base.e = queue.splice(0, 20); N.sendBeacon(END, JSON.stringify(base)); }
  }
  function track(n, p, key) {
    if (off) return;
    if (key) { if (once[key]) return; once[key] = 1; }
    queue.push(p ? { n: n, p: p } : { n: n });
    if (queue.length > 19) send(); else timer = timer || setTimeout(send, 3000);
  }
  W.illiTrack = track;                                                 // landing.js and consent.js report through this
  W.illiTrackStop = function () { off = true; queue.length = 0; clearTimeout(timer); };   // "Stop counting my visits"
  track('page_view', 0, 'pv');

  // campaign tags ride along to the Chrome Web Store, which reads utm_source / utm_medium / utm_campaign
  function tag(a) {
    if (a.hostname != 'chromewebstore.google.com') return;
    var u = new URL(a.href);
    'smc'.split('').forEach(function (k) { if (utm[k]) u.searchParams.set(keys[k], utm[k]); });
    a.href = u;
  }
  D.querySelectorAll('a[href*="chromewebstore"]').forEach(tag);
  D.addEventListener('click', function (e) {
    var a = e.target.closest('[data-cta]');
    if (a) { tag(a); track('cta_click', { which: a.dataset.cta }, 'c' + a.dataset.cta); send(); }
  }, true);

  function marks(n, r, pre, prop) {   // 25/50/75/100 milestones, each once
    [25, 50, 75, 100].forEach(function (d) { var p = {}; p[prop] = d; if (r >= d / 100 - (d > 75 ? 0.01 : 0)) track(n, p, pre + d); });
  }
  function depth() { marks('scroll', (scrollY + innerHeight) / D.documentElement.scrollHeight, 's', 'depth'); }
  W.addEventListener('scroll', depth, { passive: true }); depth();

  // named sections: seen once the section reaches the middle line of the screen
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      var t = en.target;
      if (en.isIntersecting) { track('section_seen', { id: t.dataset.section || t.id }); io.unobserve(t); }
    });
  }, { rootMargin: '-50% 0px' });
  D.querySelectorAll('main>section').forEach(function (s) { io.observe(s); });

  // the film
  var f = D.querySelector('#demo-player video'), maxT = 0;
  if (f) {
    f.addEventListener('play', function () { track('film_play', 0, 'fp'); });
    f.addEventListener('timeupdate', function () {
      if (!f.paused && f.currentTime > maxT) maxT = f.currentTime;
      if (f.duration) marks('film_progress', maxT / f.duration, 'f', 'pct');
    });
    f.addEventListener('ended', function () { maxT = f.duration; marks('film_progress', 1, 'f', 'pct'); track('film_end', 0, 'fe'); });
  }

  // answers: a row opens on hover or focus; count it once it has stayed open a moment
  D.querySelectorAll('[data-faq]').forEach(function (it) {
    var t, id = it.dataset.faq;
    function open() { track('faq_open', { id: id }, 'q' + id); }
    it.addEventListener('focusin', open);
    it.addEventListener('pointerenter', function (e) { if (e.pointerType == 'mouse') t = setTimeout(open, 600); });
    it.addEventListener('pointerleave', function () { clearTimeout(t); });
  });

  // visible time and the furthest point in the film: running totals, sent each time the page is hidden
  var shown = D.hidden ? 0 : Date.now(), total = 0, sentT = -1, sentMax = -1;
  function leave() {
    if (off) return;
    if (shown) { total += Date.now() - shown; shown = 0; }
    var s = Math.round(total / 1000), m = Math.round(maxT);
    if (s != sentT) queue.push({ n: 'engaged_time', p: { seconds: (sentT = s) } });
    if (once.fp && m != sentMax) queue.push({ n: 'film_max', p: { seconds: (sentMax = m) } });
    send();
  }
  D.addEventListener('visibilitychange', function () { if (D.hidden) leave(); else shown = Date.now(); });
  W.addEventListener('pagehide', leave);
})();
