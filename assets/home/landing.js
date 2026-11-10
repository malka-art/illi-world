/* illi landing, Amanda iteration 3 (2026-11-08). Design artifact, not production code.
   1. Player on the newest cut (referenced from the sibling proposal folder, not copied).
   2. Moving strip under the film: option A (gestures and effects) runs by default; ?strip=a|b|none or the ?review=1 switch flips it.
   3. Story rail arrows. 4. Conversion feedback. 5. Sticky header hairline. 6. Phone detection.
   7. Phone send-to-desktop: real since 2026-11-10, posts to the send-to-desktop Edge Function (one email per address per day, B14). */
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

  // ---------- 6. phone detection for the send form (the browser notice was removed by the owner, 2026-11-09) ----------
  var ua = navigator.userAgent || '';
  var isMobile = (navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod/i.test(ua) || params.get('device') === 'mobile';

  // ---------- 7. send-to-desktop (phones): posts to the send-to-desktop Edge Function, which emails the install link once per address per day (B14) ----------
  var SEND_ENDPOINT = 'https://wbobpjzkasbnkxbiiioe.supabase.co/functions/v1/send-to-desktop';
  var SEND_MESSAGES = {
    sent: 'Sent. Open the email on your computer and you’re one click from installing.',
    invalid_email: 'That doesn’t look like an email address. Check it and try again.',
    disposable_email: 'That address looks temporary. Use one you’ll open at your computer.',
    already_sent: 'We already sent the link to that address today. Check your inbox, and the spam folder just in case.',
    rate_limited: 'Too many requests from this connection for now. Please try again in an hour.',
    busy: 'The form is busy right now. Please try again later.',
    failed: 'The email didn’t go out. Please try again in a minute.'
  };
  var form = document.getElementById('send-form');
  if (isMobile && form) {
    form.hidden = false;
    var input = document.getElementById('send-email'); var status = document.getElementById('send-status'); var button = form.querySelector('button');
    var trap = document.getElementById('send-website');
    function setStatus(text, isError) { status.textContent = text; status.classList.toggle('is-error', !!isError); input.setAttribute('aria-invalid', isError ? 'true' : 'false'); }
    input.addEventListener('input', function () { if (input.getAttribute('aria-invalid') === 'true' && input.validity.valid) setStatus('', false); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!input.validity.valid || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setStatus(SEND_MESSAGES.invalid_email, true); input.focus(); return; }
      button.disabled = true; setStatus('Sending…', false);
      fetch(SEND_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, website: trap ? trap.value : '' }) })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok && data.ok === true, error: data.error }; }); })
        .then(function (r) {
          if (r.ok) { form.classList.add('is-sent'); setStatus(SEND_MESSAGES.sent, false); return; }
          button.disabled = false;
          setStatus(SEND_MESSAGES[r.error] || SEND_MESSAGES.failed, r.error === 'invalid_email' || r.error === 'disposable_email');
        })
        .catch(function () { button.disabled = false; setStatus(SEND_MESSAGES.failed, false); });
    });
  }

})();
