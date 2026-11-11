/* illi film player (owner rulings 2026-11-09 and 2026-11-10). See film-player.css for the idea.
   FilmPlayer.create(el, { src, poster, base, cta: { href, label, target, start } }) -> { video, el }
   The install button: at film frame cta.start the film's hub has started sliding right; the page lays a real link where the
   burned-in version draws its button, fading in, then pulsing twice (swell plus a spreading halo), then staying on.
   Timings match marketing/demo-video/clips-v2/batches/v4/ui-overlay/cta-slide.py (APPEAR, PULSES, PULSE_LEN, ...). */
(function () {
  'use strict';
  var FPS = 24, TL = { x: 12.522, w: 1894.957 }, HIDE_AFTER = 1000;
  var APPEAR = [8, 12], PULSES = [22, 48], PULSE_LEN = 24, PULSE_SCALE = 0.06, RING_PX = 20, RING_A = 0.5;
  // the ending (owner 2026-11-10): the film holds its last frame one extra second; on that still the button slides over his fingertip
  // and dips as if he pressed it, then stays. Absolute film frames and film px, as in cta-slide.py.
  var MOVE = [2955, 14], TARGET = [915, 700], TARGET_SCALE = 1.75, PRESS = [2967, 8], PRESS_DIP = 0.07, ZOOM = 1.5;

  function bezier(x1, y1, x2, y2) {
    return function (t) {
      var lo = 0, hi = 1, m, x;
      for (var i = 0; i < 30; i++) { m = (lo + hi) / 2; x = 3 * m * (1 - m) * (1 - m) * x1 + 3 * m * m * (1 - m) * x2 + m * m * m; if (x < t) lo = m; else hi = m; }
      m = (lo + hi) / 2; return 3 * m * (1 - m) * (1 - m) * y1 + 3 * m * m * (1 - m) * y2 + m * m * m;
    };
  }
  var EASE_OUT = bezier(0.45, 0, 0.25, 1), EASE = bezier(0.42, 0, 0.58, 1);
  var fmt = function (t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  function create(root, opt) {
    var B = opt.base || '';
    root.classList.add('fp'); root.tabIndex = 0;
    root.innerHTML =
      '<video playsinline preload="metadata"></video>' +
      '<div class="fp-layer">' +
        '<div class="fp-cta"><a class="button cta" tabindex="-1"></a></div>' +
        '<div class="fp-ui">' +
          '<img class="fp-gradient" src="' + B + 'controls-gradient.png" alt="">' +
          '<div class="fp-cover"></div>' +
          '<div class="fp-tl"><div class="fp-track"></div><div class="fp-buf"></div><div class="fp-hov"></div><div class="fp-played"></div></div>' +
          '<div class="fp-knob"></div><div class="fp-tip">0:00</div>' +
          '<div class="fp-hit fp-tlhit" role="slider" aria-label="Seek" aria-valuemin="0" tabindex="-1"></div>' +
          '<div class="fp-pill" style="left:13px;top:1030px;width:42px;height:42px"></div>' +
          '<img class="fp-hit fp-btn fp-play" src="' + B + 'pill-play.png" style="left:12px;top:1029px;width:44px;height:44px" alt="Play" role="button">' +
          '<div class="fp-pill" style="left:67px;top:1030px;width:42px;height:42px"></div>' +
          '<img class="fp-hit fp-btn fp-vol" src="' + B + 'pill-volume.png" style="left:66px;top:1029px;width:44px;height:44px" alt="Mute" role="button">' +
          '<div class="fp-time"><b class="fp-cur">0:00</b><span class="fp-dur">/ 0:00</span></div>' +
          '<div class="fp-pill" style="left:1649px;top:1030px;width:259px;height:42px"></div>' +
          '<img src="' + B + 'pill-right.png" style="left:1648px;top:1029px;width:261px;height:44px" alt="">' +
          '<div class="fp-hit fp-btn fp-fs" style="left:1858px;top:1030px;width:50px;height:42px" role="button" aria-label="Full screen"></div>' +
        '</div>' +
        '<button class="fp-big" type="button" aria-label="Play the demo"></button>' +
      '</div>';
    var q = function (s) { return root.querySelector(s); };
    var v = q('video'), layer = q('.fp-layer'), hit = q('.fp-tlhit'), play = q('.fp-play'), vol = q('.fp-vol');
    v.src = opt.src; if (opt.poster) v.poster = opt.poster;

    // ---- keep the 1920x1080 layer glued to the picture's displayed rectangle (letterboxing in fullscreen) ----
    function fit() {
      var r = root.getBoundingClientRect();
      var ar = (v.videoWidth && v.videoHeight) ? v.videoWidth / v.videoHeight : 16 / 9;
      var w = r.width, h = r.width / ar;
      if (h > r.height) { h = r.height; w = h * ar; }
      layer.style.transform = 'translate(' + (r.width - w) / 2 + 'px,' + (r.height - h) / 2 + 'px) scale(' + w / 1920 + ')';
    }
    new ResizeObserver(fit).observe(root);
    v.addEventListener('loadedmetadata', function () { fit(); render(); });

    // ---- visibility: show on activity, fade 1 s after it stops; a paused film keeps its controls up ----
    var timer = 0, scrubbing = false, overHit = false;
    function show() { root.classList.add('show'); root.classList.remove('idle'); clearTimeout(timer); timer = setTimeout(maybeHide, HIDE_AFTER); }
    function maybeHide() {
      if (scrubbing || overHit || v.paused) { timer = setTimeout(maybeHide, 250); return; }
      root.classList.remove('show', 'tl-hover');
      if (!v.paused) root.classList.add('idle');
    }
    function hideSoon() { clearTimeout(timer); timer = setTimeout(maybeHide, HIDE_AFTER); }
    root.addEventListener('pointermove', show);
    root.addEventListener('pointerdown', show);
    root.addEventListener('pointerleave', function () { overHit = false; hideSoon(); });

    // ---- time and timeline ----
    var shownTime = 0;
    function setBar(t) {
      var d = v.duration || 0, f = d ? Math.min(1, Math.max(0, t / d)) : 0;
      q('.fp-played').style.width = (f * 100) + '%';
      q('.fp-knob').style.left = (TL.x + f * TL.w) + 'px';
      q('.fp-cur').textContent = fmt(t);
      hit.setAttribute('aria-valuenow', Math.round(t));
      shownTime = t;
    }
    function render() {
      if (!scrubbing) setBar(v.currentTime);
      q('.fp-dur').textContent = '/ ' + fmt(v.duration);
      hit.setAttribute('aria-valuemax', Math.round(v.duration || 0));
      var b = v.buffered, end = 0;
      for (var i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5) end = Math.max(end, b.end(i));
      q('.fp-buf').style.width = (v.duration ? Math.min(1, end / v.duration) * 100 : 0) + '%';
      cta(v.currentTime);
    }
    (function loop() { render(); requestAnimationFrame(loop); })();

    function timeAt(x) { var r = hit.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)) * (v.duration || 0); }
    function hoverAt(x) {
      var t = timeAt(x), d = v.duration || 1, f = t / d, tip = q('.fp-tip');
      tip.style.left = Math.min(1860, Math.max(60, TL.x + f * TL.w)) + 'px'; tip.textContent = fmt(t);
      var p = shownTime / d, hov = q('.fp-hov');
      hov.style.left = (Math.min(p, f) * 100) + '%'; hov.style.width = (Math.abs(f - p) * 100) + '%';
    }
    hit.addEventListener('pointerenter', function (e) { overHit = true; root.classList.add('tl-hover'); hoverAt(e.clientX); });
    hit.addEventListener('pointerleave', function () { overHit = false; if (!scrubbing) root.classList.remove('tl-hover'); });
    hit.addEventListener('pointermove', function (e) { hoverAt(e.clientX); });
    var wasPlaying = false, pending = null, seeking = false;
    function seekTo(t, precise) {
      pending = t; if (seeking && !precise) return; seeking = true;
      if (!precise && v.fastSeek) v.fastSeek(t); else v.currentTime = t;
    }
    v.addEventListener('seeked', function () { seeking = false; if (pending !== null && Math.abs(v.currentTime - pending) > 0.05 && scrubbing) seekTo(pending); });
    hit.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      scrubbing = true; root.classList.add('scrubbing'); hit.setPointerCapture(e.pointerId);
      wasPlaying = !v.paused; v.pause();
      var t = timeAt(e.clientX); setBar(t); hoverAt(e.clientX); seekTo(t); show();
    });
    hit.addEventListener('pointermove', function (e) { if (!scrubbing) return; var t = timeAt(e.clientX); setBar(t); hoverAt(e.clientX); seekTo(t); show(); });
    function endScrub(e) {
      if (!scrubbing) return;
      scrubbing = false; root.classList.remove('scrubbing');
      var t = timeAt(e.clientX); setBar(t); seekTo(t, true); pending = null;
      if (wasPlaying) v.play();
      if (!hit.matches(':hover')) root.classList.remove('tl-hover');
      hideSoon();
    }
    hit.addEventListener('pointerup', endScrub); hit.addEventListener('pointercancel', endScrub);

    // ---- buttons ----
    function toggle() { if (v.paused) v.play(); else v.pause(); show(); }
    function syncPlay() { play.src = B + (v.paused ? 'pill-play.png' : 'pill-pause.png'); play.alt = v.paused ? 'Play' : 'Pause'; }
    v.addEventListener('play', function () { root.classList.add('played'); syncPlay(); });
    v.addEventListener('pause', function () { syncPlay(); show(); });
    v.addEventListener('ended', show);
    play.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    function mute() { v.muted = !v.muted; vol.src = B + (v.muted ? 'pill-muted.png' : 'pill-volume.png'); vol.alt = v.muted ? 'Unmute' : 'Mute'; show(); }
    vol.addEventListener('click', function (e) { e.stopPropagation(); mute(); });
    function fs() { if (document.fullscreenElement) document.exitFullscreen(); else if (root.requestFullscreen) root.requestFullscreen(); else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
    q('.fp-fs').addEventListener('click', function (e) { e.stopPropagation(); fs(); });
    document.addEventListener('fullscreenchange', function () { setTimeout(fit, 50); });
    q('.fp-big').addEventListener('click', function (e) { e.stopPropagation(); v.play(); show(); });

    // click on the picture: on a touch screen the first tap only reveals the controls; with a mouse a click plays/pauses
    root.addEventListener('click', function (e) {
      if (e.target.closest('.fp-hit, .fp-cta, .fp-big')) return;
      if (e.pointerType === 'touch' && !root.classList.contains('show')) { show(); return; }
      toggle();
    });
    root.addEventListener('dblclick', function (e) { if (!e.target.closest('.fp-hit, .fp-cta, .fp-big')) fs(); });
    root.addEventListener('keydown', function (e) {
      if (e.target !== root) return;
      var k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
      else if (k === 'm') mute();
      else if (k === 'f') fs();
      else if (k === 'arrowleft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); show(); }
      else if (k === 'arrowright') { e.preventDefault(); v.currentTime = Math.min(v.duration, v.currentTime + 5); show(); }
    });

    // ---- the install button, in step with the film ----
    var C = opt.cta, wrap = q('.fp-cta'), link = wrap.firstChild, ctaOn = false;
    if (C) {
      link.textContent = C.label; link.href = C.href;
      if (C.target) { link.target = C.target; link.rel = 'noopener'; }
      link.addEventListener('click', function () { if (document.fullscreenElement) document.exitFullscreen(); });
    } else wrap.remove();
    function cta(t) {
      if (!C) return;
      var k = t * FPS - C.start, u = (k - APPEAR[0] + 1) / APPEAR[1];
      var a = u <= 0 ? 0 : u >= 1 ? 1 : EASE(u);
      var on = a > 0;
      if (on !== ctaOn) { ctaOn = on; wrap.classList.toggle('on', on); link.tabIndex = on ? 0 : -1; }
      if (!on) return;
      var sc = 1, r = 0, ra = 0, n = C.start + k;
      for (var i = 0; i < PULSES.length; i++) {
        var p = (k - PULSES[i]) / PULSE_LEN;
        if (p >= 0 && p < 1) { var s = Math.sin(Math.PI * p); sc = 1 + PULSE_SCALE * s * s; r = RING_PX * EASE_OUT(p); ra = RING_A * Math.pow(1 - p, 1.6); }
      }
      var mu = Math.min(1, Math.max(0, (n - MOVE[0] + 1) / MOVE[1])), e = mu > 0 && mu < 1 ? EASE(mu) : mu;
      var grow = 1 + (TARGET_SCALE - 1) * e, pv = (n - PRESS[0]) / PRESS[1];
      if (pv >= 0 && pv < 1) { sc *= 1 - PRESS_DIP * Math.sin(Math.PI * pv); r = RING_PX * EASE_OUT(pv); ra = RING_A * Math.pow(1 - pv, 1.6); }
      var S = sc * grow, w = link.offsetWidth * ZOOM, cx = 34 + w / 2;      // the button's centre in film px before it moves
      var dx = (TARGET[0] - cx) * e / ZOOM, dy = (TARGET[1] - 825) * e / ZOOM; // in the wrapper's own (unzoomed) px
      link.style.opacity = a;
      link.style.transform = (S === 1 && e === 0) ? '' : 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) scale(' + S.toFixed(4) + ')';
      link.style.boxShadow = ra > 0 ? '0 0 0 ' + (r * grow / (S * ZOOM)).toFixed(2) + 'px rgba(220,38,38,' + ra.toFixed(3) + ')' : '';
    }

    syncPlay(); show();
    return { video: v, el: root };
  }
  window.FilmPlayer = { create: create };
})();
