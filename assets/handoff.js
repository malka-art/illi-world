/* The handoff sheet, phones and tablets only (task 933, Amanda's recommended design, owner approved 2026-11-24).
   Design record: Projects/Illi/design/mobile-install-933/board.html. Shared by the home page and /upgrade.

   A phone or tablet cannot run a Chrome extension. On those devices (window.illiHandheld, set by assets/handheld.js) every install
   button opens this sheet instead of the store. The sheet holds both routes: the Chrome Web Store first (its "Add to Desktop"
   installs illi in Chrome on the computer), with two steps and the sign-in condition, then "Or email me the link", which posts to
   the live send-to-desktop Edge Function (B14: one email per address per day; "website" is a honeypot, a filled value means a bot).
   The store opens in a new tab; when the visitor comes back, the sheet has moved on to the computer step, with a way out to the email.

   What opens it: any element with data-handoff, or a link to #handoff. An element with data-handoff-label is relabelled on
   phones and tablets. On a computer this file does nothing: no sheet is built, every store link stays a store link. */
(function () {
  'use strict';
  if (!window.illiHandheld) return;

  var STORE = 'https://chromewebstore.google.com/detail/hocdlcekmbokkepblkopcefmenhnincg';
  var SEND_ENDPOINT = 'https://wbobpjzkasbnkxbiiioe.supabase.co/functions/v1/send-to-desktop';
  // B14 page messages, word for word as on the live page (COPY-INVENTORY B14)
  var SEND_MESSAGES = {
    sent: 'Sent. Open the email on your computer and you’re one click from installing.',
    invalid_email: 'That doesn’t look like an email address. Check it and try again.',
    disposable_email: 'That address looks temporary. Use one you’ll open at your computer.',
    already_sent: 'We already sent the link to that address today. Check your inbox, and the spam folder just in case.',
    rate_limited: 'Too many requests from this connection for now. Please try again in an hour.',
    busy: 'The form is busy right now. Please try again later.',
    failed: 'The email didn’t go out. Please try again in a minute.'
  };
  var CLOSE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="m3.5 3.5 9 9m0-9-9 9" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';

  // Copy exactly as on the approved board. Melody has not passed the new lines yet (COPY-INVENTORY, task 933: PENDING MELODY).
  var HTML =
    '<button class="handoff-close" id="handoff-close" type="button" aria-label="Close">' + CLOSE_ICON + '</button>' +
    '<div class="handoff-view" data-view="choose">' +
      '<p class="handoff-title" id="handoff-title" tabindex="-1">Send illi to your computer.</p>' +
      '<p class="handoff-why">It works in Chrome on a desktop or laptop.</p>' +
      '<div class="handoff-routes">' +
        '<section class="handoff-route" aria-labelledby="handoff-route-store">' +
          '<p class="handoff-route-name" id="handoff-route-store">Add it from the Chrome Web Store</p>' +
          '<ol class="handoff-steps">' +
            '<li><span>Tap <b>Add to Desktop</b>, then confirm.</span></li>' +
            '<li><span>Open Chrome on your computer. illi is waiting there.</span></li>' +
          '</ol>' +
          '<a class="handoff-btn" id="handoff-store" href="' + STORE + '" target="_blank" rel="noopener">Open the Chrome Web Store</a>' +
          '<p class="handoff-cond">Works when you’re signed in to Chrome with the same Google account on both.</p>' +
        '</section>' +
        '<form class="handoff-route" id="handoff-form" novalidate>' +
          '<label class="handoff-route-name" for="handoff-email">Or email me the link</label>' +
          '<p class="handoff-cond" id="handoff-email-why">Open it at your computer. It’s the only email this form sends.</p>' +
          '<div class="handoff-row">' +
            '<input class="handoff-input" id="handoff-email" type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="Your email" required aria-describedby="handoff-email-why handoff-status">' +
            '<button class="handoff-btn is-outline" type="submit">Send me the link</button>' +
          '</div>' +
          '<div class="handoff-trap" aria-hidden="true"><label for="handoff-website">Website</label><input id="handoff-website" type="text" name="website" tabindex="-1" autocomplete="off"></div>' +
          '<p class="handoff-status" id="handoff-status" role="status" aria-live="polite"></p>' +
        '</form>' +
      '</div>' +
    '</div>' +
    '<div class="handoff-view" data-view="store" hidden>' +
      '<p class="handoff-title" tabindex="-1">Now open Chrome on your computer.</p>' +
      '<p class="handoff-why">Chrome will tell you illi was added. Choose <b>Enable extension</b> and your videos start listening.</p>' +
      '<p class="handoff-cond">45 days of Premium free · No card required</p>' +
      '<button class="handoff-textlink" type="button" id="handoff-fallback">No Add to Desktop? Email me the link instead</button>' +
    '</div>' +
    '<div class="handoff-view" data-view="sent" hidden>' +
      '<p class="handoff-title" tabindex="-1">Sent.</p>' +
      '<p class="handoff-why">Open the email on your computer and you’re one click from installing.</p>' +
      '<p class="handoff-cond">45 days of Premium free · No card required</p>' +
    '</div>';

  function build() {
    var sheet = document.createElement('dialog');
    sheet.className = 'handoff'; sheet.id = 'handoff';
    sheet.setAttribute('aria-labelledby', 'handoff-title');
    sheet.innerHTML = HTML;
    document.body.appendChild(sheet);

    var form = sheet.querySelector('#handoff-form'), email = sheet.querySelector('#handoff-email'),
        status = sheet.querySelector('#handoff-status'), submit = form.querySelector('button[type="submit"]'),
        trap = sheet.querySelector('#handoff-website'), sent = false;

    function view(name, focus) {
      var shown = null;
      sheet.querySelectorAll('.handoff-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== name; if (!v.hidden) shown = v; });
      sheet.setAttribute('aria-labelledby', 'handoff-title');
      if (focus !== false && shown && name !== 'choose') shown.querySelector('.handoff-title').focus();
    }
    function open() {
      view(sent ? 'sent' : 'choose', false);
      if (!sheet.open) { if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', ''); }
      // land on the title, not the store button or the field: the steps are read first, and no keyboard jumps up on a phone
      var t = sheet.querySelector('.handoff-view:not([hidden]) .handoff-title'); if (t) t.focus();
    }
    function close() { if (sheet.close) sheet.close(); else sheet.removeAttribute('open'); }

    sheet.querySelector('#handoff-close').addEventListener('click', close);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });   // a tap outside the sheet closes it
    // the store opens in a new tab; this is what they come back to
    sheet.querySelector('#handoff-store').addEventListener('click', function () { setTimeout(function () { view('store'); }, 400); });
    sheet.querySelector('#handoff-fallback').addEventListener('click', function () { view('choose', false); email.focus(); });

    function report(result) { if (window.illiTrack) window.illiTrack('send_form_submit', { result: result }); }   // page events (track.js, home page)
    function setStatus(text, isError) { status.textContent = text; status.classList.toggle('is-error', !!isError); email.setAttribute('aria-invalid', isError ? 'true' : 'false'); }
    email.addEventListener('input', function () { if (email.getAttribute('aria-invalid') === 'true' && email.validity.valid) setStatus('', false); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var address = email.value.trim();
      if (!email.validity.valid || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) { setStatus(SEND_MESSAGES.invalid_email, true); email.focus(); return; }
      submit.disabled = true; setStatus('Sending…', false);
      fetch(SEND_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: address, website: trap.value }) })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok && data.ok === true, error: data.error }; }); })
        .then(function (r) {
          report(r.ok ? 'sent' : r.error === 'already_sent' ? 'already_sent' : 'error');
          submit.disabled = false;
          if (r.ok) { sent = true; setStatus('', false); view('sent'); return; }
          setStatus(SEND_MESSAGES[r.error] || SEND_MESSAGES.failed, r.error === 'invalid_email' || r.error === 'disposable_email');
        })
        .catch(function () { report('error'); submit.disabled = false; setStatus(SEND_MESSAGES.failed, false); });
    });

    return { open: open, close: close, view: view, el: sheet };
  }

  function init() {
    var api = build();
    window.illiHandoff = api;
    // every install button says where illi is going and opens the sheet, never the store
    document.querySelectorAll('[data-handoff-label]').forEach(function (a) {
      a.textContent = a.getAttribute('data-handoff-label');
      a.classList.remove('cta');   // the home page's "Opened the Chrome Web Store" note belongs to the store path only
    });
    document.querySelectorAll('[data-handoff], [data-handoff-label]').forEach(function (a) {
      if (a.tagName === 'A') { a.setAttribute('href', '#handoff'); a.removeAttribute('target'); a.removeAttribute('rel'); }
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-handoff], [data-handoff-label], a[href="#handoff"]');
      if (!a || api.el.contains(a)) return;
      e.preventDefault(); api.open();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
