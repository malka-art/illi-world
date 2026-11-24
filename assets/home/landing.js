/* illi landing, Amanda iteration 3 (2026-11-08). Design artifact, not production code.
   1. illi's own film player on the final cut, with the end install button (phones and tablets: the handoff sheet).
   2. Moving strip under the film: option A (gestures and effects) runs by default; ?strip=a|b|none or the ?review=1 switch flips it.
   3. Story rail arrows. 4. Conversion feedback. 5. Sticky header hairline. 6. Phone detection.
   8. A phone turned sideways: the film fills the screen.
   7. Phones and tablets: the handoff sheet (assets/handoff.js, task 933) holds the store route and the send-to-desktop email. */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var ua = navigator.userAgent || '';
  // An iPad introduces itself as a Mac. What gives it away: it has a touch screen and its browser is never a Chromium one
  // (only Chromium browsers have navigator.userAgentData). A touch-screen MacBook running Chrome or Edge therefore stays a computer.
  var isIpadAsMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1 && !navigator.userAgentData;
  // assets/handheld.js decides (task 933: it also catches an Android tablet asking for the desktop site); the old test stays as a fallback
  var isMobile = typeof window.illiHandheld === 'boolean' ? window.illiHandheld
    : (navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod/i.test(ua) || isIpadAsMac || params.get('device') === 'mobile';

  // ---------- 1. player: illi's own film player; on phones and tablets the install button at the end opens the handoff sheet ----------
  var CWS = 'https://chromewebstore.google.com/detail/hocdlcekmbokkepblkopcefmenhnincg';
  var player = window.FilmPlayer.create(document.getElementById('demo-player'), {
    src: 'assets/home/illi-demo.mp4?v=3', poster: 'assets/home/cover.webp', base: 'assets/home/film-player/',
    // at rest: a 7.5 s silent loop of the film's opening (0:00.4 to 0:07.5, joined to its start by a 0.4 s crossfade, task 928)
    loop: { src: 'assets/home/illi-demo-loop.mp4?v=5', poster: 'assets/home/illi-demo-loop-poster.webp?v=5', label: 'Watch the demo (2 min)' },
    cta: isMobile ? { href: '#handoff', label: 'Send illi to my computer', start: 2602, id: 'film_end_send' }
                  : { href: CWS, label: 'Try illi free for 45 days', target: '_blank', start: 2602, id: 'film_end' }
  });
  if (isMobile) player.el.querySelector('.fp-cta a').classList.remove('cta');   // no "opened the store" note for the phone path

  // ---------- 1b. phones and tablets cannot install a Chrome extension (task 933): assets/handoff.js relabels every install button
  //             and opens the handoff sheet from it. This page only reorders the hero for them (style.css, .is-phone). ----------
  if (isMobile) {
    document.documentElement.classList.add('is-phone');
    // before section 4 wires the "Opened the Chrome Web Store" note: these buttons open the sheet there, never the store
    document.querySelectorAll('[data-handoff-label]').forEach(function (a) { a.classList.remove('cta'); });
  }
  player.video.addEventListener('error', function () { document.getElementById('stage-error').hidden = false; });

  // ---------- 2. moving strip: duplicate the track once so the loop is seamless ----------
  var track = document.querySelector('.strip-track');
  Array.prototype.slice.call(track.children).forEach(function (li) { var c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); track.appendChild(c); });

  // ---------- 3b. feature diagrams: they play on hover (CSS); on touch screens, once when the card scrolls into view ----------
  if (window.matchMedia('(hover: none)').matches && 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var card = en.target; seen.unobserve(card);
        card.classList.add('is-playing');
        setTimeout(function () { card.classList.remove('is-playing'); }, 5000);   // one full loop of --p-anim (4.6s) plus a margin
      });
    }, { threshold: 0.6 });
    document.querySelectorAll('.card').forEach(function (card) { seen.observe(card); });
  }

  // ---------- 4. conversion feedback ----------
  var note = document.getElementById('cta-note'); var noteTimer = null;
  document.querySelectorAll('a.cta').forEach(function (a) {
    a.addEventListener('click', function () {
      clearTimeout(noteTimer);
      if (note.hidden) { note.hidden = false; void note.offsetWidth; }
      note.classList.add('is-on');
      noteTimer = setTimeout(function () { note.classList.remove('is-on'); setTimeout(function () { note.hidden = true; }, 300); }, 4000);
    });
  });

  // ---------- 5. sticky header hairline ----------
  var head = document.querySelector('.site-head');
  function syncHead() { head.classList.toggle('is-stuck', window.scrollY > 1); }
  window.addEventListener('scroll', syncHead, { passive: true }); syncHead();

  // ---------- 6 and 7. phone detection and the send-to-desktop form moved to assets/handheld.js and assets/handoff.js (task 933) ----------

  // ---------- 8. a phone turned sideways: if the film was on screen, or is playing, bring it up so it fills the screen
  //             (the layout for this lives in style.css, "a phone turned sideways"; the media query here must match that one) ----------
  var turned = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (max-width: 1024px)');
  var stageEl = document.getElementById('stage'); var filmOnScreen = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { if (!turned.matches) filmOnScreen = entries[entries.length - 1].intersectionRatio >= 0.5; }, { threshold: [0, 0.5, 1] }).observe(stageEl);
  }
  var broughtUp = false;
  function onTurn() {
    var up = turned.matches && (filmOnScreen || !player.video.paused);
    if (!up && !broughtUp) return;
    broughtUp = up;   // turned back upright after we brought the film up: keep the film in the middle of the screen, clear of the header
    setTimeout(function () { stageEl.scrollIntoView({ block: up ? 'start' : 'center' }); }, 300);   // after the browser has laid the turned page out
  }
  if (turned.addEventListener) turned.addEventListener('change', onTurn); else if (turned.addListener) turned.addListener(onTurn);

})();
