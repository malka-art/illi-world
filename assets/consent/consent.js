/* illi.world privacy choices (2026-11-11): the privacy question on the home page and the Privacy choices panel.
   Wording (owner-locked 2026-11-11, AUDIT-LOG): "Mind if illi remembers this browser?" / "Remember it" / "Don't remember it".
   Design: a bar across the bottom of the window, placed and laid out after Superhuman's banner (owner request 2026-11-11);
   the panel is Amanda's (design/consent-prompt-2026-11-11). Wording: Malka's locked body line (2026-11-11),
   Melody's anti-slop pass for the rest (marketing/consent-prompt-2026-11-11/RESEARCH-AND-WORDING.md).

   What this file may write to the browser, and ONLY after the visitor clicks something:
     illi.note     after "Remember it" (or "Remember this browser"): { id: random code, f: the campaign tags of that visit, at: time of the yes,
                   v: the wording version the visitor said yes to (task 304, 2026-11-16; a note written before then has no v) }
                   It expires 13 months after the yes; later visits do not extend it; then the question comes back.
     illi.answer   after "Don't remember it" (or "Forget this browser"): { a: 'no', at, v }. Never asked again.
     illi.nocount  after "Stop counting my visits": { at }. assets/home/track.js sends nothing while it is there.
   An ignored question writes nothing and is asked again on the next load. Phones, tablets, narrow windows and browsers that
   send Global Privacy Control or Do Not Track are never asked; under a privacy signal nothing is counted either.

   The panel works on every page that has a footer button .foot-choice and the panel markup #choices (home, privacy, terms).
   The question needs the #ask markup (home page only). */
(function () {
  'use strict';

  /* Owner ruling 2026-11-16 (Malka): "Stop counting my visits" never deletes what the visitor agreed to (the note stays). */

  var W = window, D = document, N = navigator, root = D.documentElement;
  var VERSION = 'm3';                       // wording version, sent with every answer: m2 = the owner-locked ask, body line and answers (2026-11-11);
                                            // m3 = m2 plus the partner payment wording (published 2026-11-17)
  // Partner links (task 304): only a yes given on a wording that says the partner is attached to a payment lets /upgrade carry
  // the partner into checkout (assets/upgrade.js, PAYMENT_WORDING). m2 does not say so; m3 does, published
  // in the same commit as this change (home page "What gets saved?" note and privacy policy 1.3, 1.10 and section 4).
  var MONTHS = 13, HOLD = 6000, LEAVE = 260, ARRIVE = 600, GAP = 12;
  var K = { note: 'illi.note', answer: 'illi.answer', nocount: 'illi.nocount' };
  var FR = /^fr/i.test(root.lang || '');
  var signal = !!(N.globalPrivacyControl || N.doNotTrack == '1');   // the same test as track.js

  var T = FR ? {
    noteOn: 'illi se souvient de ce navigateur jusqu’au {date}. Nous y avons enregistré un code aléatoire et l’étiquette de campagne du lien que vous avez suivi pour arriver ici.',
    forget: 'Oublier ce navigateur',
    noteOff: 'illi ne se souvient pas de ce navigateur. Si vous le souhaitez, nous y enregistrerons un code aléatoire et l’étiquette de campagne du lien que vous avez suivi pour arriver ici, afin de savoir quand vous revenez et quel lien vous a amené la première fois. Ces données expirent après 13 mois.',
    remember: 'Se souvenir de ce navigateur',
    count: 'Nous comptons aussi chaque visite sans rien enregistrer dans votre navigateur, par exemple jusqu’où vous avez fait défiler la page, quelle part du film vous avez regardée et sur quels boutons vous avez cliqué. Ces données ne nous permettent pas de savoir qui vous êtes, et la politique de confidentialité en donne la liste complète.',
    stop: 'Ne plus compter mes visites',
    stopped: 'Ce navigateur n’enverra plus de données de visite. Nous y avons enregistré un seul réglage pour nous souvenir de votre choix.',
    off: 'Ce navigateur n’envoie pas de données de visite, parce que vous avez désactivé le comptage.',
    again: 'Compter de nouveau mes visites',
    signal: 'Votre navigateur demande aux sites de ne pas vous suivre : illi ne compte donc pas cette visite et ne se souvient pas de ce navigateur.',
    locale: 'fr-CA'
  } : {
    noteOn: 'illi remembers this browser until {date}. We’ve saved a random code and the campaign label from the link that brought you.',
    forget: 'Forget this browser',
    noteOff: 'illi doesn’t remember this browser. If you’d like it to, we’ll save a random code and the campaign label from the link that brought you, so we can tell when you come back and which link first sent you. It expires after 13 months.',
    remember: 'Remember this browser',
    count: 'We also count each visit without saving anything in your browser, for example how far you scrolled, how much of the film you watched, and which buttons you clicked. These counts don’t tell us who you are, and the privacy policy lists everything they include.',
    stop: 'Stop counting my visits',
    stopped: 'This browser won’t send visit counts anymore. We saved one setting in it so we remember your choice.',
    off: 'This browser doesn’t send visit counts, because you turned them off.',
    again: 'Count my visits again',
    signal: 'Your browser asks sites not to track you, so illi isn’t counting this visit or remembering this browser.',
    locale: 'en-US'
  };

  /* ---------- storage: every access guarded; nothing is written unless a button was clicked ---------- */
  function get(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function expiry(n) { var d = new Date(n.at); d.setMonth(d.getMonth() + MONTHS); return d; }
  function liveNote() { var n = get(K.note); return n && n.id && n.at && Date.now() < expiry(n).getTime() ? n : null; }
  function counting() { return !signal && !get(K.nocount); }
  function ev(name, props) { if (W.illiTrack) W.illiTrack(name, props); }   // page events (track.js, home page); absent elsewhere
  function tags() {
    var q = new URLSearchParams(location.search), f = {}, map = { s: 'utm_source', m: 'utm_medium', c: 'utm_campaign', ct: 'utm_content', id: 'utm_id' };
    for (var k in map) { var v = q.get(map[k]); if (v) f[k] = v.slice(0, 80); }
    return f;
  }

  function sayYes(from) {
    put(K.note, { id: crypto.randomUUID(), f: tags(), at: new Date().toISOString(), v: VERSION });
    del(K.answer);
    ev('consent_yes', { v: VERSION, from: from });   // after the write, so this event already carries the code
  }
  function sayNo(from) {
    del(K.note);
    put(K.answer, { a: 'no', at: new Date().toISOString(), v: VERSION });
    ev('consent_no', { v: VERSION, from: from });
  }
  function stopCounting() {
    if (W.illiTrackStop) W.illiTrackStop();          // drop anything queued in this page, send nothing more
    put(K.nocount, { at: new Date().toISOString() });
    if (ask && !ask.hidden && !answered) leave();     // the question is about counting; with counting off it has no purpose
  }
  function countAgain() { del(K.nocount); }

  /* ---------- the Privacy choices panel ---------- */
  var panel = D.getElementById('choices'), bodyEl = panel && panel.querySelector('.choices-body'), opener = null, justStopped = false;
  function row(text, label, act) {
    var r = D.createElement('div'); r.className = 'choices-row';
    var p = D.createElement('p'); p.textContent = text; r.appendChild(p);
    if (label) { var b = D.createElement('button'); b.className = 'ask-btn'; b.type = 'button'; b.setAttribute('data-choice', act); b.textContent = label; r.appendChild(b); }
    return r;
  }
  function day(d) {   // French typography: the first of a month is « 1er » (fr-CA prints « 1 décembre 2027 »)
    var s = d.toLocaleDateString(T.locale, { year: 'numeric', month: 'long', day: 'numeric' });
    return FR && d.getDate() === 1 ? s.replace(/^1(?=\s)/, '1er') : s;
  }
  function render() {
    if (!bodyEl) return;
    bodyEl.textContent = '';
    if (signal) { bodyEl.appendChild(row(T.signal)); return; }
    var n = liveNote();
    bodyEl.appendChild(n ? row(T.noteOn.replace('{date}', day(expiry(n))), T.forget, 'forget')
                         : row(T.noteOff, T.remember, 'remember'));
    bodyEl.appendChild(counting() ? row(T.count, T.stop, 'stop')
                                  : row(justStopped ? T.stopped : T.off, T.again, 'count'));
  }
  function seatPanel() {   // desktop: just above the footer when it is on screen, so it never hides the link that opened it
    if (!panel || panel.hidden) return;
    var foot = D.querySelector('[data-choices-foot]'), gap = foot ? W.innerHeight - foot.getBoundingClientRect().top : 0;
    // never lifted so far that its top (title and close button) leaves the window: the footer is taller while the bar is up
    panel.style.bottom = (W.matchMedia('(max-width:680px)').matches || gap <= 0) ? '' : Math.max(0, Math.min(gap + GAP, W.innerHeight * 0.5, W.innerHeight - panel.offsetHeight - GAP)) + 'px';
  }
  function openPanel(from) {
    if (!panel) return;
    opener = from || null; justStopped = false; render(); panel.hidden = false; seatPanel();
    D.querySelectorAll('.foot-choice').forEach(function (b) { b.setAttribute('aria-expanded', 'true'); });
    D.getElementById('choices-title').focus();       // the visitor asked for it, so focus may move here
  }
  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    D.querySelectorAll('.foot-choice').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    if (opener && opener.isConnected && opener.offsetParent) opener.focus();
  }
  if (panel) {
    W.addEventListener('scroll', seatPanel, { passive: true });
    W.addEventListener('resize', function () { setTimeout(seatPanel, 0); });
    D.addEventListener('click', function (e) {
      var o = e.target.closest('.foot-choice, [data-open-choices]');
      if (o) { e.preventDefault(); if (panel.hidden) openPanel(o); else closePanel(); return; }
      if (e.target.closest('.choices-close')) { closePanel(); return; }
      var b = e.target.closest('[data-choice]');
      if (b) {
        var a = b.getAttribute('data-choice');
        if (a === 'forget') sayNo('panel');
        if (a === 'remember') { sayYes('panel'); if (ask && !ask.hidden && !answered) leave(); }
        if (a === 'stop') { stopCounting(); justStopped = true; }
        if (a === 'count') { countAgain(); justStopped = false; }
        render();
        var nb = bodyEl.querySelector('[data-choice="' + ({ forget: 'remember', remember: 'forget', stop: 'count', count: 'stop' })[a] + '"]');
        if (nb) nb.focus();
        return;
      }
      if (!panel.hidden && !e.target.closest('.choices')) closePanel();   // a click elsewhere closes it; closing means nothing
    });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) closePanel(); });
  }

  /* ---------- the question: a bar across the bottom of the window (home page only) ---------- */
  var ask = D.getElementById('ask'), answered = false, shown = false, sentShown = false, gone = false, holdTimer = 0;
  W.illiPrivacy = { version: VERSION, signal: signal, counting: counting, note: liveNote, open: openPanel };
  if (!ask) return;

  var ua = N.userAgent, uad = N.userAgentData;
  var desktop = !(/iPad/.test(ua) || (/Mac/.test(ua) && N.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua)) || (uad && uad.mobile) || /Mobi|iPhone|Android/.test(ua));
  var stage = D.getElementById('stage'), film = D.getElementById('demo-player'), video = film && film.querySelector('video');
  var reduced = W.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hit(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
  function footRoom(h) { root.style.setProperty('--ask-h', h + 'px'); }   // the footer grows by the bar's height (consent.css)
  // The bar sits at the bottom of the window, like the banner it is modelled on. Two exceptions, both about the film, and
  // in both the bar steps aside (fades, cannot be clicked or focused) and returns when it is clear:
  //   1. the film is playing and the bar would lie over it;
  //   2. the film has not been played and the bar would cover its play button (narrow windows, where the film sits low).
  //      Not while "What gets saved?" is open or the keyboard focus is inside the bar: the visitor is using the bar, so
  //      it must not vanish under them (it is re-checked when focus leaves).
  // The bar's box is taken from its layout (pinned to the bottom, full width), not from where the arrival animation has
  // drawn it at this instant, so the answer is the same during the rise as after it.
  function seat() {
    if (ask.hidden || gone) return;   // once it is leaving, nothing re-seats it or gives the footer its room back
    var h = ask.offsetHeight, r = { left: 0, right: root.clientWidth, top: W.innerHeight - h, bottom: W.innerHeight, height: h };
    var playing = !!(video && !video.paused && !video.ended);
    var big = film && !film.classList.contains('played') && !playing ? film.querySelector('.fp-big') : null, b = big && big.getBoundingClientRect();
    var bigR = b && b.width ? { left: b.left - GAP, right: b.right + GAP, top: b.top - GAP, bottom: b.bottom + GAP } : null;   // a little air around the play button
    var more = ask.querySelector('.ask-more'), using = !!((more && more.getAttribute('aria-expanded') === 'true') || ask.contains(D.activeElement));
    var aside = !!((playing && stage && hit(r, stage.getBoundingClientRect())) || (bigR && !using && !answered && hit(r, bigR)));
    ask.classList.toggle('is-aside', aside); ask.inert = aside; ask.setAttribute('data-seat', aside ? 'aside' : 'home');
    footRoom(aside ? 0 : Math.round(r.height));
    if (!aside && !sentShown && !answered) { sentShown = true; ev('consent_shown', { v: VERSION }); }   // once per page load, when really visible
  }
  function leave() {   // gone for this page load; an unanswered leave saves nothing and sends nothing
    clearTimeout(holdTimer);
    if (ask.hidden) return;
    gone = true;
    footRoom(0);
    if (reduced) { ask.hidden = true; return; }
    ask.classList.add('is-out');
    setTimeout(function () { ask.hidden = true; ask.classList.remove('is-out'); }, LEAVE);
  }
  function answer(which) {
    answered = true;
    if (which === 'yes') sayYes('note'); else sayNo('note');
    ask.setAttribute('data-state', which);
    var done = ask.querySelector('.ask-done');
    done.querySelector('[data-when="yes"]').hidden = which !== 'yes';
    done.querySelector('[data-when="no"]').hidden = which !== 'no';
    seat();
    holdTimer = setTimeout(leave, HOLD);
  }
  function arrive() {
    if (shown || answered) return;
    shown = true; ask.hidden = false; ask.setAttribute('data-state', 'ask');
    if (!reduced) { ask.classList.add('is-out'); void ask.offsetWidth; ask.classList.remove('is-out'); }
    var live = D.getElementById('ask-live'); if (live) live.textContent = live.getAttribute('data-text');   // polite announcement; focus never moves
    seat();
  }

  // Who is asked: a desktop browser, wide enough for the note, no privacy signal, counting on, no clicked no, no live yes.
  var n = get(K.note);
  if (n && !liveNote()) del(K.note);              // a yes older than 13 months: delete it, then ask again
  var eligible = desktop && !W.matchMedia('(max-width:680px)').matches && !signal && !get(K.nocount) && !get(K.answer) && !liveNote();
  if (!eligible) return;

  ask.addEventListener('click', function (e) {
    var b = e.target.closest('[data-answer]');
    if (b) { answer(b.getAttribute('data-answer')); return; }
    var m = e.target.closest('.ask-more');
    if (m) { var open = m.getAttribute('aria-expanded') !== 'true'; m.setAttribute('aria-expanded', String(open)); D.getElementById('ask-note').hidden = !open; seat(); }
  });
  ask.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !answered) leave(); });
  ['pointerenter', 'focusin'].forEach(function (t) { ask.addEventListener(t, function () { clearTimeout(holdTimer); }); });
  ['pointerleave', 'focusout'].forEach(function (t) { ask.addEventListener(t, function () { if (answered && !ask.hidden) { clearTimeout(holdTimer); holdTimer = setTimeout(leave, HOLD); } }); });
  ask.addEventListener('focusout', function () { setTimeout(function () { if (shown && !ask.hidden) seat(); }, 0); });   // focus has left: the play-button rule applies again
  D.addEventListener('click', function (e) {     // an install click ends the question for this page load, unanswered
    if (e.target.closest('[data-cta]') && !answered) { if (shown) leave(); else answered = true; }
  }, true);
  function tick() { if (shown && !ask.hidden) seat(); }
  W.addEventListener('scroll', tick, { passive: true });
  W.addEventListener('resize', tick);
  if (video) ['play', 'pause', 'ended', 'timeupdate'].forEach(function (t) { video.addEventListener(t, tick); });
  function go() { setTimeout(arrive, ARRIVE); }
  if (D.fonts && D.fonts.ready) D.fonts.ready.then(go); else W.addEventListener('load', go);
})();
