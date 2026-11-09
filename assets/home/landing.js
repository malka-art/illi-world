/* illi landing, Amanda iteration 3 (2026-11-08). Design artifact, not production code.
   1. Player on the newest cut (referenced from the sibling proposal folder, not copied).
   2. Moving strip under the film: option A (gestures and effects) runs by default; ?strip=a|b|none or the ?review=1 switch flips it.
   3. Story rail arrows. 4. Conversion feedback. 5. Sticky header hairline. 6. Setup note. 7. Phone send-to-desktop (simulated). */
(function () {
  'use strict';

  // ---------- 1. player ----------
  var playerEl = document.getElementById('demo-player');
  var player = window.YTPlayerChrome.create(playerEl, { src: 'assets/home/illi-demo.mp4', poster: 'assets/home/cover.webp' });
  if (window.matchMedia('(max-width: 680px), (hover: none)').matches) player.pinControls(null); else player.pinControls(true);
  player.video.addEventListener('error', function () { document.getElementById('stage-error').hidden = false; });

  // ---------- 2. moving strip: duplicate the track once so the loop is seamless ----------
  var params = new URLSearchParams(location.search);
  var track = document.querySelector('.strip-track');
  Array.prototype.slice.call(track.children).forEach(function (li) { var c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); track.appendChild(c); });

  // ---------- 3b. feature diagrams: they play on hover (CSS); on touch screens, once when the card scrolls into view ----------
  if (window.matchMedia('(hover: none)').matches && 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var card = en.target; seen.unobserve(card);
        card.classList.add('is-playing');
        setTimeout(function () { card.classList.remove('is-playing'); }, 3600);
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

})();
