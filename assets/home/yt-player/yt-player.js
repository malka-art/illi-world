/*
 * yt-player.js: a standalone replica of YouTube's current desktop ("delhi modern") player chrome
 * over an HTML5 <video>. Vanilla JS, no framework, no build step.
 *
 * The DOM below mirrors the class structure YouTube's own player builds (built from player 67288f35, re-verified against the live watch player build 55de7e60 on
 * 2026-10-21; its stylesheet is byte-identical), so YouTube's own stylesheet rules (yt-player.css, pruned from www-player.css) apply
 * unchanged. Icons come verbatim from yt-player-icons.js. Load order:
 *   <link rel="stylesheet" href="yt-player.css">
 *   <script src="yt-player-icons.js"></script>
 *   <script src="yt-player.js"></script>
 *
 *   const player = YTPlayerChrome.create(containerEl, { src: 'film.mp4', chapters: [...], ... });
 *
 * See README.md for the full option list and the scripting API.
 */
(function () {
  'use strict';
  var I = window.YTP_ICONS || {};

  var DEFAULTS = {
    src: '',                 // video URL
    poster: '',
    duration: null,          // seconds; overrides the video's own duration for the time readout and timeline maths
    chapters: null,          // [{start: 0, title: 'Intro'}, ...]; null = unchaptered timeline
    loadedFraction: null,    // fixed buffered fraction 0..1 (null = from the video's buffered ranges)
    hdBadge: true,           // red HD badge on the settings gear
    autonav: true,           // autoplay toggle present
    autonavOn: true,         // its state
    subtitles: 'unavailable',// 'unavailable' | 'off' | 'on'
    miniplayer: false,       // the captured player has no miniplayer button at this size; true adds YouTube's
    theaterButton: true,
    fullscreenButton: true,
    autohideDelay: 3000,     // ms of mouse inactivity before the controls fade (measured live 2026-10-21: 3014-3027 ms, playing and paused)
    autohideWhenPaused: true, // live watch player (2026-10-21) autohides when paused too, even with the pointer on the controls
    seekHint: true,          // "Pull up for precise seeking"
    thumbnail: 'video',      // 'video' (live frame from a muted clone of the video) | 'none' (transparent window) | function(t) -> {url,x,y,w,h,sheetW,sheetH}
    thumbnailHeight: 136,    // CSS px, as captured
    thumbnailWidth: 240.366, // CSS px: live 2026-10-21 on a 1920x1080 video gave 240.366 (headless) and 241.683 (another browser, other storyboard level); the 2026-10-19 capture gave 240.366
    // 'premium' = the owner's view in the 2026-10-19 captures (0.25-4x, no badges);
    // 'free' = a signed-out viewer, checked live 2026-10-21 (0.25-2x, a 1.75 chip hidden at this width, 'P' upsell on 3.0)
    account: 'premium',
    speedPresets: null,      // default per account
    speedMin: 0.25,
    speedMax: null,          // default per account
    menu: {
      stableVolume: { checked: false, disabled: true },
      voiceBoost: { checked: true },
      annotations: { checked: true },
      audioTrack: 'English (US) original',
      subtitlesCC: 'Off',
      sleepTimer: 'Off',
      quality: { auto: true, label: '1080p', badge: 'HD' }
    },
    keyboard: true
  };

  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in b || {}) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && typeof b[k] !== 'function' && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) o[k] = merge(a[k], b[k]);
      else o[k] = b[k];
    }
    return o;
  }
  function el(tag, cls, attrs, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function fmt(t) {
    t = Math.max(0, Math.floor(t + 1e-6));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var ss = (s < 10 ? '0' : '') + s;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
  }
  function speedText(r) { return r.toFixed(2) + 'x'; }
  function presetLabel(r) { var s = String(r); return s.indexOf('.') < 0 ? s + '.0' : s; }
  var uid = 0;

  function create(container, options) {
    var o = merge(DEFAULTS, options || {});
    var free = o.account === 'free';
    if (!o.speedPresets) o.speedPresets = free ? [1, 1.25, 1.5, 1.75, 2, 3] : [1, 1.25, 1.5, 2, 3];
    if (o.speedMax == null) o.speedMax = free ? 2 : 4;
    var id = ++uid;

    // ---------------------------------------------------------------- DOM
    var root = el('div', 'html5-video-player ytp-exp-bottom-control-flexbox ytp-modern-caption ytp-exp-ppp-update ytp-livebadge-color ytp-grid-scrollable ytp-delhi-modern ytp-delhi-modern-icons ytp-delhi-horizontal-volume-controls ytp-cards-teaser-dismissible ytp-hide-info-bar ytp-disable-bottom-gradient ytp-delhi-modern-compact-controls ytp-large-width-mode ytp-fine-scrubbing-exp ytp-fit-cover-video ytp-hide-fullscreen-title ytp-fullscreen-metadata-top paused-mode ytpc-root',
      { tabindex: '-1', 'aria-label': 'YouTube Video Player', 'data-ytpc': String(id) });
    // values YouTube's player writes on its root for the compact control set used on the watch page (pill 40, top 8, bar 56)
    root.style.cssText = '--yt-delhi-pill-height: 40px; --yt-delhi-pill-top-height: 8px; --yt-delhi-bottom-controls-height: 56px; --yt-delhi-bottom-controls-height-xsmall-width-mode: 56px; --yt-delhi-big-mode-pill-height: 48px; --yt-delhi-big-mode-pill-top-height: 12px; --yt-delhi-big-mode-bottom-controls-height: 72px; --yt-frosted-glass-backdrop-filter-override: none;';

    var vc = el('div', 'html5-video-container', { 'data-layer': '0' });
    var video = el('video', 'video-stream html5-main-video', { playsinline: '', 'webkit-playsinline': '', preload: 'auto', tabindex: '-1' });
    if (o.src) video.src = o.src;
    if (o.poster) video.poster = o.poster;
    vc.appendChild(video);
    root.appendChild(vc);

    // seek preview tooltip (structure as captured from the live watch player)
    var tip = el('div', 'ytp-tooltip ytp-bottom ytp-tooltip-progress-bar-style ytp-preview', { 'data-layer': '4', 'aria-live': 'polite', 'aria-hidden': 'true' });
    tip.style.cssText = 'max-width: 300px; display: none;';
    tip.innerHTML =
      '<div class="ytp-tooltip-text-wrapper" aria-hidden="true">' +
        '<div class="ytp-tooltip-edu">' + (I.tooltipEdu || '') + '<span>Pull up for precise seeking</span></div>' +
        '<div class="ytp-tooltip-image"></div>' +
        '<div class="ytp-tooltip-title"><span></span><div class="ytp-tooltip-keyboard-shortcut"></div></div>' +
        '<div class="ytp-tooltip-bottom-text"><span class="ytp-tooltip-text"></span><div class="ytp-tooltip-keyboard-shortcut"></div></div>' +
        '<div class="ytp-tooltip-progress-bar-pill"><div class="ytp-tooltip-progress-bar-pill-time-stamp"></div><div class="ytp-tooltip-progress-bar-pill-title"></div></div>' +
      '</div>' +
      '<div class="ytp-tooltip-bg"><div class="ytp-tooltip-duration"></div></div>';
    root.appendChild(tip);
    var tipBg = tip.querySelector('.ytp-tooltip-bg');
    var tipEdu = tip.querySelector('.ytp-tooltip-edu');
    var tipTime = tip.querySelector('.ytp-tooltip-progress-bar-pill-time-stamp');
    var tipTitle = tip.querySelector('.ytp-tooltip-progress-bar-pill-title');
    var tipText = tip.querySelector('.ytp-tooltip-text');
    if (!o.seekHint) tipEdu.style.display = 'none';
    var thumbCanvas = null, thumbVideo = null;

    // settings popup
    var menu = el('div', 'ytp-popup ytp-settings-menu', { 'data-layer': '6', id: 'ytp-id-' + (100 + id), 'aria-hidden': 'true' });
    menu.style.display = 'none';
    menu.innerHTML = '<div class="ytp-focus-trap-before" tabindex="0"></div><div class="ytp-popup-content"></div><div class="ytp-focus-trap-after" tabindex="0"></div>';
    var menuContent = menu.querySelector('.ytp-popup-content');
    root.appendChild(menu);

    root.appendChild(el('div', 'ytp-gradient-bottom', { 'data-layer': '9' }));

    var cb = el('div', 'ytp-chrome-bottom', { 'data-layer': '9' });
    cb.innerHTML =
      '<div class="ytp-progress-bar-container">' +
        '<div class="ytp-heat-map-container"><div class="ytp-heat-map-edu"></div></div>' +
        '<div class="ytp-progress-bar" tabindex="0" role="slider" aria-label="Seek slider" aria-valuemin="0" draggable="true" style="touch-action: none;">' +
          '<div class="ytp-chapters-container"></div>' +
          '<div class="ytp-timed-markers-container"></div>' +
          '<div class="ytp-scrubber-container"><div class="ytp-scrubber-button ytp-swatch-background-color"><div class="ytp-scrubber-pull-indicator"></div>' +
            '<div class="ytp-unified-seek-wrapper" aria-hidden="true"><div class="ytp-unified-seek-content"><span class="ytp-unified-seek-icon-left-wrapper"></span><span class="ytp-unified-seek-text"></span><span class="ytp-unified-seek-icon-right-wrapper"></span></div></div></div></div>' +
        '</div>' +
        '<div class="ytp-fine-scrubbing-container"></div>' +
      '</div>' +
      '<div class="ytp-chrome-controls">' +
        '<div class="ytp-left-controls">' +
          '<button class="ytp-play-button ytp-button" aria-keyshortcuts="k" data-title-no-tooltip="Play" data-tooltip-title="Play (k)" aria-label="Play (k)">' + I.play + '</button>' +
          '<span class="ytp-volume-area">' +
            '<div class="ytp-mute-button"><button class="ytp-volume-icon ytp-button" aria-keyshortcuts="m" data-tooltip-offset-y="0" data-tooltip-title="Mute (m)" aria-label="Mute (m)" data-title-no-tooltip="Mute">' + I.volume + '</button></div>' +
            '<div class="ytp-volume-panel" data-tooltip-title="Volume" role="slider" aria-valuemin="0" aria-valuemax="100" tabindex="0" aria-valuenow="100" aria-valuetext="100% volume" aria-label="Volume">' +
              '<div class="ytp-volume-slider" draggable="true" style="touch-action: none;"><div class="ytp-volume-slider-handle" style="left: 40px;"></div></div>' +
            '</div>' +
          '</span>' +
          '<div class="ytp-time-display notranslate"><div class="ytp-time-wrapper ytp-time-wrapper-delhi"><div class="ytp-time-contents" role="button" tabindex="0">' +
            '<span class="ytp-time-current">0:00</span><span class="ytp-time-separator"> / </span><span class="ytp-time-duration">0:00</span>' +
          '</div></div></div>' +
          '<div class="ytp-chapter-container" style="max-width: 460px; display: none;"><button class="ytp-chapter-title ytp-button" title="View chapter">' +
            '<span class="ytp-chapter-title-prefix" aria-hidden="true">•</span>' +
            '<div class="ytp-chapter-title-content" aria-live="polite" data-tooltip-title="View chapter" aria-label="View chapter"></div>' +
            '<div class="ytp-chapter-title-chevron">' + I.chapterChevron + '</div>' +
          '</button></div>' +
        '</div>' +
        '<div class="ytp-right-controls">' +
          '<div class="ytp-right-controls-left">' +
            (o.autonav ? '<button class="ytp-button ytp-autonav-toggle delhi-fast-follow-autonav-toggle" data-priority="3" data-tooltip-target-id="ytp-autonav-toggle-button"><div class="ytp-autonav-toggle-button-container"><div class="ytp-autonav-toggle-button" aria-checked="true"></div></div></button>' : '') +
            '<button class="ytp-subtitles-button ytp-button" aria-keyshortcuts="c" data-priority="5" aria-pressed="false"><div class="ytp-subtitles-button-icon">' + I.subtitles + '</div></button>' +
            '<button class="ytp-button ytp-settings-button" aria-expanded="false" aria-haspopup="true" aria-controls="ytp-id-' + (100 + id) + '" data-tooltip-title="Settings" data-tooltip-target-id="ytp-settings-button" aria-label="Settings">' + I.settings + '</button>' +
          '</div>' +
          '<div class="ytp-right-controls-right">' +
            (o.miniplayer ? '<button class="ytp-miniplayer-button ytp-button" aria-keyshortcuts="i" data-priority="7" data-title-no-tooltip="Miniplayer" data-tooltip-title="Miniplayer (i)" data-tooltip-target-id="ytp-miniplayer-button" aria-label="Miniplayer (i)">' + I.miniplayer + '</button>' : '') +
            (o.theaterButton ? '<button class="ytp-size-button ytp-button" aria-keyshortcuts="t" data-priority="9" data-title-no-tooltip="Theater mode" data-tooltip-title="Theater mode (t)" aria-label="Theater mode (t)">' + I.theater + '</button>' : '') +
            (o.fullscreenButton ? '<button class="ytp-fullscreen-button ytp-button" aria-keyshortcuts="f" data-priority="12" data-title-no-tooltip="Full screen" data-tooltip-title="Full screen (f)" aria-label="Full screen keyboard shortcut f">' + I.fullscreen + '</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    root.appendChild(cb);
    container.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    var pbc = q('.ytp-progress-bar-container'), pbar = q('.ytp-progress-bar'), chaptersEl = q('.ytp-chapters-container');
    var scrubber = q('.ytp-scrubber-container');
    var playBtn = q('.ytp-play-button'), volArea = q('.ytp-volume-area'), volBtn = q('.ytp-volume-icon'), volPanel = q('.ytp-volume-panel'), volHandle = q('.ytp-volume-slider-handle');
    var tCur = q('.ytp-time-current'), tDur = q('.ytp-time-duration'), timeContents = q('.ytp-time-contents');
    var chapCont = q('.ytp-chapter-container'), chapTitle = q('.ytp-chapter-title-content');
    var autonavBtn = q('.ytp-autonav-toggle'), subsBtn = q('.ytp-subtitles-button'), gear = q('.ytp-settings-button');
    var sizeBtn = q('.ytp-size-button'), fsBtn = q('.ytp-fullscreen-button');

    // ---------------------------------------------------------------- state
    var st = {
      time: 0, speed: 1, volume: 1, muted: false, playing: false,
      hoverX: null, dragging: false, settingsOpen: false, panel: 'main',
      autonavOn: !!o.autonavOn, theater: false, pinnedControls: null, pinnedTime: null
    };
    var segs = [];   // chapter segments: {start, end, el, play, load, hover}
    var W = 0, H = 0;

    function dur() { return o.duration != null ? o.duration : (isFinite(video.duration) ? video.duration : 0); }
    function now() { return st.pinnedTime != null ? st.pinnedTime : (video.currentTime || 0); }

    // ---------------------------------------------------------------- layout
    function buildChapters() {
      chaptersEl.innerHTML = '';
      segs = [];
      var d = dur() || 1;
      var list = (o.chapters && o.chapters.length) ? o.chapters.slice().sort(function (a, b) { return a.start - b.start; }) : [{ start: 0, title: '' }];
      for (var i = 0; i < list.length; i++) {
        var s = { start: list[i].start, end: i + 1 < list.length ? list[i + 1].start : d, title: list[i].title || '' };
        var h = el('div', 'ytp-chapter-hover-container ytp-exp-chapter-hover-container');
        h.innerHTML = '<div class="ytp-progress-bar-padding"></div><div class="ytp-progress-list"><div class="ytp-play-progress ytp-swatch-background-color"></div><div class="ytp-load-progress"></div><div class="ytp-hover-progress"></div></div>';
        var pl = h.querySelector('.ytp-progress-list');
        if (i === 0) pl.classList.add('ytp-progress-bar-start');
        if (i === list.length - 1) pl.classList.add('ytp-progress-bar-end');
        s.el = h; s.play = h.querySelector('.ytp-play-progress'); s.load = h.querySelector('.ytp-load-progress'); s.hover = h.querySelector('.ytp-hover-progress');
        chaptersEl.appendChild(h);
        segs.push(s);
      }
      layout();
    }
    function layout() {
      var r = root.getBoundingClientRect();
      W = r.width; H = r.height;
      var bw = W - 24;
      cb.style.width = bw + 'px'; cb.style.left = '12px';
      var d = dur() || 1;
      var multi = segs.length > 1;
      var x = 0;
      // live (build 55de7e60): chapters are whole-pixel wide with a 4px gap (margin-right) after each but the last
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        var last = i === segs.length - 1;
        var gap = multi && !last ? 4 : 0;
        var end = multi && !last ? Math.round(s.end / d * bw) : bw;
        var w = end - x;
        s.x = x; s.w = w; s.el.style.width = Math.max(0, w - gap) + 'px'; if (gap) s.el.style.marginRight = gap + 'px'; else s.el.style.removeProperty('margin-right');
        x = end;
      }
      chapCont.style.display = multi ? '' : 'none';
      update();
    }

    // ---------------------------------------------------------------- render state into DOM
    function update() {
      var d = dur() || 1, t = now(), bw = W - 24;
      var px = Math.max(0, Math.min(1, t / d)) * bw;
      var loaded = o.loadedFraction != null ? o.loadedFraction : bufferedFraction();
      var lpx = loaded * bw;
      var hx = st.hoverX;
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i], sw = parseFloat(s.el.style.width) || s.w;
        var f = sw > 0 ? Math.max(0, Math.min(1, (px - s.x) / sw)) : 0;
        s.play.style.left = '0px';
        s.play.style.transform = 'scaleX(' + f + ')';
        // live: the red-to-pink gradient is sized to each chapter, not to the whole bar
        s.play.style.backgroundSize = sw + 'px auto';
        s.play.style.backgroundPositionX = '0px';
        var lf = sw > 0 ? Math.max(0, Math.min(1, (lpx - s.x) / sw)) : 0;
        s.load.style.left = '0px'; s.load.style.transform = 'scaleX(' + lf + ')';
        // hover fill runs from the playhead to the cursor
        var hf = 0, hl = 0;
        if (hx != null && hx > px) {
          var a = Math.max(px, s.x), b = Math.min(hx, s.x + sw);
          if (b > a && sw > 0) { hl = a - s.x; hf = (b - a) / sw; }
        }
        s.hover.style.left = hl + 'px'; s.hover.style.transform = 'scaleX(' + hf + ')';
        // as YouTube: chapters between the playhead and the cursor get the light hover fill when the cursor is ahead
        s.hover.classList.toggle('ytp-hover-progress-light', hx != null && hx > px && s.x + sw > px && s.x <= hx);
      }
      var sb = scrubber.firstChild, hc = hx != null && segs.length > 1 ? segIndexAt(hx) : -1;
      sb.classList.toggle('ytp-scrubber-button-hover', hc >= 0 && hc === segIndexAt(px));
      scrubber.style.transform = 'translateX(' + px + 'px)';
      tCur.textContent = fmt(t);
      tDur.textContent = fmt(d);
      timeContents.setAttribute('aria-label', fmt(t) + ' of ' + fmt(d));
      pbar.setAttribute('aria-valuemax', String(Math.round(d)));
      pbar.setAttribute('aria-valuenow', String(Math.round(t)));
      if (segs.length > 1) chapTitle.textContent = chapterAt(t).title;
    }
    function bufferedFraction() {
      var d = dur(); if (!d || !video.buffered || !video.buffered.length) return 0;
      var t = video.currentTime, e = 0;
      for (var i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 0.5) e = Math.max(e, video.buffered.end(i));
      return Math.min(1, e / d);
    }
    function segIndexAt(x) { for (var i = segs.length - 1; i >= 0; i--) if (x >= segs[i].x) return i; return 0; }
    function chapterAt(t) { for (var i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start) return segs[i]; return segs[0]; }

    // ---------------------------------------------------------------- play state
    function setPlayingUI(p) {
      st.playing = p;
      root.classList.toggle('playing-mode', p);
      root.classList.toggle('paused-mode', !p);
      playBtn.innerHTML = p ? I.pause : I.play;
      var lbl = p ? 'Pause' : 'Play';
      playBtn.setAttribute('data-title-no-tooltip', lbl); playBtn.setAttribute('data-tooltip-title', lbl + ' (k)'); playBtn.setAttribute('aria-label', lbl + ' (k)');
      if (!p) showControls(); else armAutohide();
    }
    video.addEventListener('play', function () { setPlayingUI(true); });
    video.addEventListener('pause', function () { setPlayingUI(false); });
    video.addEventListener('timeupdate', function () { if (!st.dragging) update(); });
    video.addEventListener('progress', update);
    video.addEventListener('loadedmetadata', function () { buildChapters(); });
    video.addEventListener('ratechange', function () { st.speed = video.playbackRate; refreshSpeedPanel(); });
    video.addEventListener('volumechange', function () { st.volume = video.volume; st.muted = video.muted; renderVolume(); });

    function togglePlay() { if (video.paused) { st.pinnedTime = null; var pr = video.play(); if (pr && pr.catch) pr.catch(function () {}); } else video.pause(); }
    playBtn.addEventListener('click', togglePlay);
    vc.addEventListener('click', function () { if (st.settingsOpen) closeSettings(); else togglePlay(); });

    // ---------------------------------------------------------------- autohide
    var hideTimer = 0, inside = false;
    function showControls() {
      clearTimeout(hideTimer);
      if (root.classList.contains('ytp-autohide')) {
        root.classList.remove('ytp-autohide');
        root.classList.add('ytp-autohide-active');
        setTimeout(function () { root.classList.remove('ytp-autohide-active'); }, 100);
      }
    }
    function hideControls() {
      if (st.pinnedControls === true) return;
      if (st.settingsOpen || st.dragging) return;
      if (!root.classList.contains('ytp-autohide')) {
        root.classList.add('ytp-autohide', 'ytp-autohide-active');
        setTimeout(function () { root.classList.remove('ytp-autohide-active'); }, 250);
      }
    }
    function armAutohide() {
      clearTimeout(hideTimer);
      if (st.pinnedControls != null) return;
      if (!st.playing && !o.autohideWhenPaused) return;
      hideTimer = setTimeout(hideControls, o.autohideDelay);
    }
    root.addEventListener('mousemove', function () { inside = true; if (st.pinnedControls == null) { showControls(); armAutohide(); } });
    root.addEventListener('mouseenter', function () { inside = true; if (st.pinnedControls == null) { showControls(); armAutohide(); } });
    root.addEventListener('mouseleave', function () {
      inside = false;
      // live: the controls fade the moment the pointer leaves the player (measured 7 ms after mouseleave)
      if (st.pinnedControls == null && (st.playing || o.autohideWhenPaused)) { clearTimeout(hideTimer); hideControls(); }
      endHover();
    });

    // ---------------------------------------------------------------- volume
    function renderVolume() {
      var v = st.muted ? 0 : st.volume;
      volHandle.style.left = (v * 40) + 'px';
      volPanel.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      volPanel.setAttribute('aria-valuetext', Math.round(v * 100) + '% volume' + (st.muted ? ' muted' : ''));
      var lbl = st.muted ? 'Unmute' : 'Mute';
      volBtn.setAttribute('aria-label', lbl + ' (m)'); volBtn.setAttribute('data-tooltip-title', lbl + ' (m)'); volBtn.setAttribute('data-title-no-tooltip', lbl);
      // YouTube animates the speaker ripples; muted shows the speaker without ripples
      var small = volBtn.querySelector('.ytp-svg-volume-animation-small-ripple'), big = volBtn.querySelector('.ytp-svg-volume-animation-big-ripple');
      if (small) small.style.display = v === 0 ? 'none' : '';
      if (big) big.style.display = v === 0 || v < 0.5 ? 'none' : '';
    }
    var volHoverTimer = 0;
    function setVolumeActive(on) {
      clearTimeout(volHoverTimer);
      cb.classList.toggle('ytp-volume-slider-active', !!on);
    }
    volArea.addEventListener('mouseenter', function () { setVolumeActive(true); });
    volArea.addEventListener('mouseleave', function () { if (!volDrag) volHoverTimer = setTimeout(function () { setVolumeActive(false); }, 0); });
    volBtn.addEventListener('click', function () { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 1; });
    var volDrag = false;
    function volFromEvent(e) {
      var r = q('.ytp-volume-slider').getBoundingClientRect();
      var v = Math.max(0, Math.min(1, (e.clientX - r.left - 6) / (r.width - 12)));
      video.volume = v; video.muted = v === 0;
    }
    volPanel.addEventListener('mousedown', function (e) { volDrag = true; volFromEvent(e); e.preventDefault(); });
    window.addEventListener('mousemove', function (e) { if (volDrag) volFromEvent(e); });
    window.addEventListener('mouseup', function () { if (volDrag) { volDrag = false; if (!volArea.matches(':hover')) setVolumeActive(false); } });

    // ---------------------------------------------------------------- timeline hover, seek preview, drag
    function xToTime(xInBar) { var bw = W - 24; return Math.max(0, Math.min(1, xInBar / bw)) * (dur() || 0); }
    function showPreview(xInBar, timeOverride) {
      var d = dur() || 0, bw = W - 24;
      xInBar = Math.max(0, Math.min(bw, xInBar));
      st.hoverX = xInBar;
      // live player (build 55de7e60, 2026-10-21): the pill shows the hover time rounded UP to the second
      var t = timeOverride != null ? timeOverride : Math.ceil(xToTime(xInBar) - 1e-9);
      root.classList.add('ytp-progress-bar-hover');
      tip.style.display = '';
      tip.removeAttribute('aria-hidden');
      var ch = segs.length > 1 ? chapterAt(t) : null;
      tipTime.textContent = fmt(t);
      tipTitle.textContent = ch ? ch.title : '';
      tipText.textContent = fmt(t);
      tipBg.style.width = o.thumbnailWidth + 'px';
      tipBg.style.height = o.thumbnailHeight + 'px';
      paintThumb(t);
      // position: centred on the cursor, clamped 12px inside the player; bottom edge 137px above the player bottom
      var tw = o.thumbnailWidth + 2, th = o.thumbnailHeight + 2;
      var cx = 12 + xInBar;
      // live: card left = pointer x - ceil(card width / 2) (measured 122 px for widths 242.36 and 243.68)
      var left = Math.max(12, Math.min(W - 12 - tw, cx - Math.ceil(tw / 2)));
      tip.style.left = left + 'px';
      tip.style.top = (H - 137 - th) + 'px';
      tipEdu.style.bottom = (th) + 'px';
      update();
    }
    function endHover() {
      if (st.dragging) return;
      st.hoverX = null;
      root.classList.remove('ytp-progress-bar-hover');
      tip.setAttribute('aria-hidden', 'true');
      tip.style.display = 'none';
      update();
    }
    function paintThumb(t) {
      if (o.thumbnail === 'none') { tip.classList.add('ytpc-window'); return; } // transparent window for compositing
      if (typeof o.thumbnail === 'function') {
        var s = o.thumbnail(t);
        if (s && s.url) tipBg.style.background = 'url("' + s.url + '") ' + (-s.x) + 'px ' + (-s.y) + 'px / ' + s.sheetW + 'px ' + s.sheetH + 'px';
        return;
      }
      // 'video': a muted clone of the main video, seeked to t, drawn into the card
      if (!thumbVideo) {
        thumbVideo = document.createElement('video');
        thumbVideo.muted = true; thumbVideo.preload = 'auto'; thumbVideo.src = video.currentSrc || video.src;
        thumbCanvas = document.createElement('canvas');
        thumbCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:inherit';
        tipBg.appendChild(thumbCanvas);
        thumbVideo.addEventListener('seeked', function () {
          var c = thumbCanvas, r = tipBg.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
          c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
          try { c.getContext('2d').drawImage(thumbVideo, 0, 0, c.width, c.height); } catch (e) {}
        });
      }
      if (thumbVideo.readyState >= 1 && Math.abs(thumbVideo.currentTime - t) > 0.05) thumbVideo.currentTime = t;
      else if (thumbVideo.readyState < 1) thumbVideo.addEventListener('loadedmetadata', function f() { thumbVideo.removeEventListener('loadedmetadata', f); thumbVideo.currentTime = t; });
    }
    function barX(e) { return e.clientX - pbar.getBoundingClientRect().left; }
    pbc.addEventListener('mousemove', function (e) { if (!st.dragging) showPreview(barX(e)); });
    pbc.addEventListener('mouseleave', function () { if (!st.dragging) endHover(); });
    pbc.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      st.dragging = true; pbc.classList.add('ytp-drag'); cb.classList.add('ytp-drag');
      var x = barX(e); showPreview(x); seekTo(xToTime(x));
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) { if (st.dragging) { var x = barX(e); showPreview(x); seekTo(xToTime(x)); } });
    window.addEventListener('mouseup', function (e) {
      if (!st.dragging) return;
      st.dragging = false; pbc.classList.remove('ytp-drag'); cb.classList.remove('ytp-drag');
      if (!pbc.matches(':hover')) endHover();
    });
    function seekTo(t) { st.pinnedTime = null; try { video.currentTime = t; } catch (e) {} if (o.duration != null && !(video.duration > 0)) st.pinnedTime = t; update(); }

    // ---------------------------------------------------------------- settings menu
    function toggleItem(cls, label, icon, cfg) {
      return '<div class="ytp-menuitem' + (cls ? ' ' + cls : '') + '" role="menuitemcheckbox" aria-checked="' + (!!cfg.checked) + '" tabindex="0" aria-label="' + label + '"' + (cfg.disabled ? ' aria-disabled="true"' : '') + '>' +
        '<div class="ytp-menuitem-icon">' + icon + '</div><div class="ytp-menuitem-label">' + label + '</div><div class="ytp-menuitem-content"><div class="ytp-menuitem-toggle-checkbox"></div></div></div>';
    }
    function subItem(cls, labelHtml, icon, contentHtml, key) {
      return '<div class="ytp-menuitem' + (cls ? ' ' + cls : '') + '" aria-haspopup="true" role="menuitem" tabindex="0" data-ytpc-row="' + key + '">' +
        '<div class="ytp-menuitem-icon">' + icon + '</div><div class="ytp-menuitem-label">' + labelHtml + '</div><div class="ytp-menuitem-content">' + contentHtml + '</div></div>';
    }
    function qualityHtml() {
      var qq = o.menu.quality;
      var badge = qq.badge ? ' <sup class="ytp-swatch-color-white">' + qq.badge + '</sup>' : '';
      if (qq.auto) return '<div><span>Auto</span> <span class="ytp-menu-label-secondary">(' + qq.label + badge + ')</span></div>';
      return '<div><span>' + qq.label + badge + '</span></div>';
    }
    function speedLabel() { return st.speed === 1 ? 'Normal' : String(st.speed); }
    function mainPanelHtml() {
      var m = o.menu;
      return '<div class="ytp-panel"><div class="ytp-panel-menu" role="menu">' +
        (m.stableVolume ? toggleItem('ytp-drc-menu-item', 'Stable Volume', I.menuStableVolume, m.stableVolume) : '') +
        (m.voiceBoost ? toggleItem('', 'Voice boost', I.menuVoiceBoost, m.voiceBoost) : '') +
        (m.annotations ? toggleItem('', 'Annotations', I.menuAnnotations, m.annotations) : '') +
        (m.audioTrack ? subItem('ytp-audio-menu-item', 'Audio track', I.menuAudioTrack, m.audioTrack, 'audio') : '') +
        (m.subtitlesCC ? subItem('', 'Subtitles/CC', I.menuSubtitles, m.subtitlesCC, 'subtitles') : '') +
        (m.sleepTimer ? subItem('', 'Sleep timer', I.menuSleepTimer, m.sleepTimer, 'sleep') : '') +
        subItem('', 'Playback speed', I.menuPlaybackSpeed, speedLabel(), 'speed') +
        (m.quality ? subItem('', 'Quality', I.menuQuality, qualityHtml(), 'quality') : '') +
        '</div></div>';
    }
    function speedPanelHtml() {
      var pct = (st.speed - o.speedMin) / (o.speedMax - o.speedMin) * 100;
      var chips = '';
      for (var i = 0; i < o.speedPresets.length; i++) {
        var r = o.speedPresets[i];
        var upsell = free && r > o.speedMax, hidden = free && r === 1.75;
        chips += '<div class="ytp-variable-speed-panel-preset-button-wrapper" data-priority="0"' + (hidden ? ' aria-hidden="true" style="display: none;"' : '') + '><button class="ytp-button ytp-variable-speed-panel-preset-button ytp-variable-speed-panel-button" data-ytpc-speed="' + r + '">' + (upsell ? '<div class="ytp-variable-speed-panel-premium-upsell-icon"></div>' : '') + '<span>' + presetLabel(r) + '</span></button>' +
          (r === 1 ? '<div class="ytp-variable-speed-panel-preset-button-label-text">Normal</div>' : '') + '</div>';
      }
      return '<div class="ytp-panel">' +
        '<div class="ytp-panel-header"><div class="ytp-panel-back-button-container"><button class="ytp-button ytp-panel-back-button" aria-label="Back to previous menu"></button></div><span class="ytp-panel-title" role="heading" aria-level="2">Playback speed</span></div>' +
        '<div class="ytp-variable-speed-panel-content" tabindex="0">' +
          '<div class="ytp-speed-display-container"><div class="ytp-variable-speed-panel-display" aria-live="polite">' + (free ? '<div class="ytp-variable-speed-panel-premium-badge" tabindex="-1"><div class="ytp-variable-speed-panel-badge"></div></div>' : '') + '<span>' + speedText(st.speed) + '</span></div></div>' +
          '<div class="ytp-variable-speed-panel-slider-container">' +
            '<button class="ytp-button ytp-variable-speed-panel-button ytp-variable-speed-panel-increment-button" aria-label="Decrease playback speed 0.05" data-ytpc-step="-0.05"><span>-</span></button>' +
            '<div class="ytp-input-slider-section"><div class="ytp-speedslider-indicator-container"><div class="ytp-speedslider-badge" aria-label=""></div><p class="ytp-speedslider-text">' + speedText(st.speed) + '</p></div>' +
              '<input class="ytp-input-slider ytp-speedslider ytp-varispeed-input-slider" role="slider" tabindex="0" type="range" min="' + o.speedMin + '" max="' + o.speedMax + '" step="0.05" value="' + st.speed + '" aria-valuenow="' + st.speed + '" aria-valuemin="' + o.speedMin + '" aria-valuemax="' + o.speedMax + '" aria-valuetext="' + st.speed.toFixed(2) + '" style="--yt-slider-shape-gradient-percent: ' + pct + '%;"></div>' +
            '<button class="ytp-button ytp-variable-speed-panel-button ytp-variable-speed-panel-increment-button" aria-label="Increase playback speed 0.05" data-ytpc-step="0.05"><span>+</span></button>' +
          '</div>' +
          '<div class="ytp-variable-speed-panel-chips">' + chips + '</div>' +
        '</div></div>';
    }
    // YouTube's own sizing (player JS I7a): let the popup grow to the player size, clear the panel's inline size,
    // measure the panel, add 1px each way, write it on the panel, its content (minus header) and the popup.
    function sizePanel(panel) {
      menu.style.width = '100%'; menu.style.height = '100%';
      panel.style.width = ''; panel.style.height = ''; panel.style.maxWidth = '100%'; panel.style.maxHeight = '100%';
      var content = panel.querySelector('.ytp-panel-menu, .ytp-variable-speed-panel-content');
      if (content) content.style.height = '';
      var w = panel.offsetWidth + 1, h = panel.offsetHeight + 1;
      panel.style.width = w + 'px'; panel.style.height = h + 'px'; panel.style.maxWidth = ''; panel.style.maxHeight = '';
      var hdr = panel.querySelector('.ytp-panel-header');
      if (content) content.style.height = (h - (hdr ? hdr.offsetHeight : 0)) + 'px';
      var ex = panel.scrollWidth - panel.clientWidth;
      if (panel.offsetWidth - panel.clientWidth > 0 && ex > 0) { w += ex; panel.style.width = w + 'px'; }
      return { w: w, h: h };
    }
    function setPopupSize(sz) { menu.style.width = sz.w + 'px'; menu.style.height = sz.h + 'px'; }
    function renderPanel(which, animate) {
      var old = menuContent.firstChild;
      var tmp = el('div'); tmp.innerHTML = which === 'speed' ? speedPanelHtml() : mainPanelHtml();
      var panel = tmp.firstChild;
      if (!animate || !old) {
        menuContent.innerHTML = ''; menuContent.appendChild(panel);
        setPopupSize(sizePanel(panel));
      } else {
        // as YouTube: new panel enters from the side, popup animates from the old size to the new (250ms)
        var from = { w: menu.offsetWidth, h: menu.offsetHeight };
        panel.classList.add(which === 'speed' ? 'ytp-panel-animate-forward' : 'ytp-panel-animate-back');
        menuContent.appendChild(panel);
        var sz = sizePanel(panel);
        setPopupSize(from);
        setTimeout(function () {
          menu.classList.add('ytp-popup-animating');
          old.classList.add(which === 'speed' ? 'ytp-panel-animate-back' : 'ytp-panel-animate-forward');
          panel.classList.remove('ytp-panel-animate-forward', 'ytp-panel-animate-back');
          setPopupSize(sz);
          setTimeout(function () { menu.classList.remove('ytp-popup-animating'); if (old.parentNode) old.parentNode.removeChild(old); }, 250);
        }, 20);
      }
      st.panel = which;
      wirePanel(panel);
    }
    function wirePanel(panel) {
      var rows = panel.querySelectorAll('.ytp-menuitem');
      for (var i = 0; i < rows.length; i++) (function (row) {
        row.addEventListener('click', function () {
          if (row.getAttribute('aria-disabled') === 'true') return;
          var k = row.getAttribute('data-ytpc-row');
          if (k === 'speed') { renderPanel('speed', true); return; }
          if (row.getAttribute('role') === 'menuitemcheckbox') row.setAttribute('aria-checked', String(row.getAttribute('aria-checked') !== 'true'));
        });
      })(rows[i]);
      var back = panel.querySelector('.ytp-panel-back-button');
      if (back) back.addEventListener('click', function () { renderPanel('main', true); });
      var chips = panel.querySelectorAll('[data-ytpc-speed]');
      for (var j = 0; j < chips.length; j++) chips[j].addEventListener('click', function () { if (this.querySelector('.ytp-variable-speed-panel-premium-upsell-icon')) return; setSpeed(parseFloat(this.getAttribute('data-ytpc-speed'))); });
      var steps = panel.querySelectorAll('[data-ytpc-step]');
      for (var k2 = 0; k2 < steps.length; k2++) steps[k2].addEventListener('click', function () { setSpeed(Math.round((st.speed + parseFloat(this.getAttribute('data-ytpc-step'))) * 100) / 100); });
      var inp = panel.querySelector('.ytp-speedslider');
      if (inp) inp.addEventListener('input', function () { setSpeed(parseFloat(inp.value)); });
    }
    function refreshSpeedPanel() {
      if (st.panel !== 'speed') return;
      var p = menuContent.lastChild;
      var t = speedText(st.speed);
      var d1 = p.querySelector('.ytp-variable-speed-panel-display span'); if (d1) d1.textContent = t;
      var d2 = p.querySelector('.ytp-speedslider-text'); if (d2) d2.textContent = t;
      var inp = p.querySelector('.ytp-speedslider');
      if (inp) { inp.value = st.speed; inp.setAttribute('aria-valuenow', st.speed); inp.setAttribute('aria-valuetext', st.speed.toFixed(2)); inp.style.setProperty('--yt-slider-shape-gradient-percent', ((st.speed - o.speedMin) / (o.speedMax - o.speedMin) * 100) + '%'); }
    }
    function setSpeed(r) {
      r = Math.max(o.speedMin, Math.min(o.speedMax, r));
      st.speed = r; video.playbackRate = r; refreshSpeedPanel();
    }
    function openSettings() {
      if (st.settingsOpen) return;
      st.settingsOpen = true;
      showControls(); clearTimeout(hideTimer);
      menu.style.display = '';
      renderPanel('main', false);
      void menu.offsetWidth;
      menu.removeAttribute('aria-hidden');
      root.classList.add('ytp-settings-shown', 'ytp-menu-shown');
      gear.setAttribute('aria-expanded', 'true');
    }
    function closeSettings() {
      if (!st.settingsOpen) return;
      st.settingsOpen = false;
      menu.setAttribute('aria-hidden', 'true');
      root.classList.remove('ytp-settings-shown', 'ytp-menu-shown');
      gear.setAttribute('aria-expanded', 'false');
      setTimeout(function () { if (!st.settingsOpen) { menu.style.display = 'none'; st.panel = 'main'; } }, 100);
      armAutohide();
    }
    gear.addEventListener('click', function (e) { e.stopPropagation(); st.settingsOpen ? closeSettings() : openSettings(); });
    document.addEventListener('mousedown', function (e) { if (st.settingsOpen && !menu.contains(e.target) && !gear.contains(e.target)) closeSettings(); });

    // ---------------------------------------------------------------- right-hand buttons
    function renderSubs() {
      if (!subsBtn) return;
      var label = o.subtitles === 'unavailable' ? 'Subtitles/closed captions unavailable' : 'Subtitles/closed captions (c)';
      subsBtn.setAttribute('aria-label', label); subsBtn.setAttribute('data-tooltip-title', label);
      subsBtn.setAttribute('aria-pressed', String(o.subtitles === 'on'));
      subsBtn.querySelector('.ytp-subtitles-button-icon').innerHTML = o.subtitles === 'on' && I.subtitlesOn ? I.subtitlesOn : I.subtitles;
    }
    function renderAutonav() {
      if (!autonavBtn) return;
      var lbl = st.autonavOn ? 'Autoplay is on' : 'Autoplay is off';
      autonavBtn.querySelector('.ytp-autonav-toggle-button').setAttribute('aria-checked', String(st.autonavOn));
      autonavBtn.setAttribute('aria-label', lbl); autonavBtn.setAttribute('data-tooltip-title', lbl);
    }
    if (autonavBtn) autonavBtn.addEventListener('click', function () { st.autonavOn = !st.autonavOn; renderAutonav(); });
    if (subsBtn) subsBtn.addEventListener('click', function () { if (o.subtitles === 'unavailable') return; o.subtitles = o.subtitles === 'on' ? 'off' : 'on'; renderSubs(); });
    if (o.hdBadge) gear.classList.add('ytp-hd-quality-badge');
    if (sizeBtn) sizeBtn.addEventListener('click', function () {
      st.theater = !st.theater;
      sizeBtn.innerHTML = st.theater ? I.theaterExit : I.theater;
      var l = st.theater ? 'Default view' : 'Theater mode';
      sizeBtn.setAttribute('aria-label', l + ' (t)'); sizeBtn.setAttribute('data-title-no-tooltip', l); sizeBtn.setAttribute('data-tooltip-title', l + ' (t)');
      root.dispatchEvent(new CustomEvent('ytpc-theater', { detail: { theater: st.theater }, bubbles: true }));
    });
    function isFs() { return document.fullscreenElement === root || document.webkitFullscreenElement === root; }
    if (fsBtn) fsBtn.addEventListener('click', function () {
      if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    });
    document.addEventListener('fullscreenchange', function () {
      if (!fsBtn) return;
      var on = isFs();
      fsBtn.innerHTML = on ? I.fullscreenExit : I.fullscreen;
      root.classList.toggle('ytp-fullscreen', on);
      setTimeout(layout, 50);
    });

    // ---------------------------------------------------------------- keyboard
    if (o.keyboard) root.addEventListener('keydown', function (e) {
      if (e.target && /input/i.test(e.target.tagName)) return;
      var k = e.key.toLowerCase();
      if (k === 'k' || k === ' ') { togglePlay(); e.preventDefault(); }
      else if (k === 'm') video.muted = !video.muted;
      else if (k === 'f' && fsBtn) fsBtn.click();
      else if (k === 't' && sizeBtn) sizeBtn.click();
      else if (k === 'arrowleft' || k === 'j') seekTo(Math.max(0, now() - (k === 'j' ? 10 : 5)));
      else if (k === 'arrowright' || k === 'l') seekTo(Math.min(dur(), now() + (k === 'l' ? 10 : 5)));
      else if (k === 'escape') closeSettings();
    });

    // ---------------------------------------------------------------- resize
    var ro = window.ResizeObserver ? new ResizeObserver(function () { layout(); }) : null;
    if (ro) ro.observe(root); else window.addEventListener('resize', layout);

    // ---------------------------------------------------------------- deterministic states (scripting API)
    var simHovered = [];
    function clearSim() { simHovered.forEach(function (e) { e.classList.remove('ytpc-hover'); }); simHovered = []; }
    function simHover(e) { if (e) { e.classList.add('ytpc-hover'); simHovered.push(e); } }
    function rowByLabel(label) {
      var rows = menu.querySelectorAll('.ytp-menuitem');
      for (var i = 0; i < rows.length; i++) { var l = rows[i].querySelector('.ytp-menuitem-label'); if (l && l.textContent.trim() === label) return rows[i]; }
      return null;
    }
    var api = {
      root: root, video: video, options: o,
      play: function () { st.pinnedTime = null; return video.play(); },
      pause: function () { video.pause(); },
      /** Jump the playhead (and time readout) to t seconds. Works before the video has loaded when options.duration is set. */
      setTime: function (t) { seekTo(t); if (!(video.duration > 0)) st.pinnedTime = t; update(); },
      /** Show the timeline hover state with the seek card at time t (or at x px along the bar with {x: px}). null hides it. */
      seekPreview: function (t, opts) {
        clearSim();
        if (t == null) { st.hoverX = null; endHover(); return; }
        var bw = W - 24, x = opts && opts.x != null ? opts.x : t / (dur() || 1) * bw;
        showControls(); clearTimeout(hideTimer);
        // the real bar is in its CSS :hover state while the pointer is on it
        simHover(pbc);
        for (var i = 0; i < segs.length; i++) if (x >= segs[i].x && x < segs[i].x + segs[i].w) simHover(segs[i].el);
        showPreview(x, opts && opts.label != null ? opts.label : (opts && opts.x != null ? null : t));
        if (opts && opts.pillText != null) tipTime.textContent = opts.pillText;
      },
      openSettings: function () { openSettings(); },
      closeSettings: function () { clearSim(); closeSettings(); },
      /** Put a settings row (by its label, e.g. 'Playback speed') into its real :hover appearance; null clears. */
      hoverSettingsRow: function (label) { clearSim(); if (label) simHover(rowByLabel(label)); },
      /** Open settings straight on the playback speed panel (no slide animation, as a still). */
      showSpeedPanel: function () { if (!st.settingsOpen) openSettings(); clearSim(); renderPanel('speed', false); },
      showMainMenu: function () { if (!st.settingsOpen) openSettings(); clearSim(); renderPanel('main', false); },
      setSpeed: setSpeed,
      /** Put any element into its real :hover appearance (selector or element); hover(null) clears. */
      hover: function (target) { clearSim(); if (!target) return; simHover(typeof target === 'string' ? root.querySelector(target) : target); },
      hoverVolume: function (on) { setVolumeActive(on); },
      setVolume: function (v, muted) { video.volume = v; video.muted = !!muted; st.volume = v; st.muted = !!muted; renderVolume(); },
      /** true = controls always shown, false = always hidden (autohidden look), null = normal autohide behaviour. */
      pinControls: function (v) { st.pinnedControls = v; if (v === true) showControls(); else if (v === false) { st.pinnedControls = null; hideControls(); st.pinnedControls = false; } else armAutohide(); },
      showControls: showControls,
      hideControls: function () { var p = st.pinnedControls; st.pinnedControls = null; hideControls(); st.pinnedControls = p; },
      setAutonav: function (on) { st.autonavOn = !!on; renderAutonav(); },
      setSubtitles: function (mode) { o.subtitles = mode; renderSubs(); },
      setChapters: function (list) { o.chapters = list; buildChapters(); },
      setDuration: function (d) { o.duration = d; buildChapters(); },
      /** Bounding boxes (player-relative CSS px) of every clickable control and open popup element. */
      rects: function () { return measure(root); },
      layout: layout,
      destroy: function () { if (ro) ro.disconnect(); root.remove(); }
    };
    renderVolume(); renderSubs(); renderAutonav();
    buildChapters();
    root.ytpc = api;
    return api;
  }

  function measure(root) {
    var pr = root.getBoundingClientRect();
    var out = {};
    function box(e) { var r = e.getBoundingClientRect(); return { x: r.left - pr.left, y: r.top - pr.top, width: r.width, height: r.height }; }
    function add(name, e) { if (e && e.getClientRects().length && getComputedStyle(e).display !== 'none') out[name] = box(e); }
    var sel = {
      player: null,
      timeline: '.ytp-progress-bar',
      play_button: '.ytp-play-button', volume_button: '.ytp-volume-icon', volume_panel: '.ytp-volume-panel', time_display: '.ytp-time-display',
      chapter_title: '.ytp-chapter-title', autonav_toggle: '.ytp-autonav-toggle', subtitles_button: '.ytp-subtitles-button',
      settings_gear: '.ytp-settings-button', miniplayer_button: '.ytp-miniplayer-button', theater_button: '.ytp-size-button', fullscreen_button: '.ytp-fullscreen-button',
      scrubber: '.ytp-scrubber-button',
      settings_menu: '.ytp-settings-menu:not([aria-hidden=true])',
      seek_card: '.ytp-tooltip.ytp-preview:not([aria-hidden=true])', seek_card_thumbnail: '.ytp-tooltip.ytp-preview:not([aria-hidden=true]) .ytp-tooltip-bg',
      seek_card_time_pill: '.ytp-tooltip.ytp-preview:not([aria-hidden=true]) .ytp-tooltip-progress-bar-pill',
      seek_card_hint: '.ytp-tooltip.ytp-preview:not([aria-hidden=true]) .ytp-tooltip-edu',
      speed_back_button: '.ytp-settings-menu .ytp-panel-back-button', speed_minus: '.ytp-settings-menu [data-ytpc-step="-0.05"]', speed_plus: '.ytp-settings-menu [data-ytpc-step="0.05"]',
      speed_slider: '.ytp-settings-menu .ytp-speedslider'
    };
    out.player = { x: 0, y: 0, width: pr.width, height: pr.height };
    for (var k in sel) if (sel[k]) add(k, root.querySelector(sel[k]));
    var rows = root.querySelectorAll('.ytp-settings-menu:not([aria-hidden=true]) .ytp-panel-menu > .ytp-menuitem');
    for (var i = 0; i < rows.length; i++) { var l = rows[i].querySelector('.ytp-menuitem-label'); add('settings_row_' + l.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), rows[i]); }
    var chips = root.querySelectorAll('.ytp-settings-menu:not([aria-hidden=true]) .ytp-variable-speed-panel-preset-button');
    for (var j = 0; j < chips.length; j++) add('speed_preset_' + chips[j].textContent.trim().replace('.', '_'), chips[j]);
    return out;
  }

  window.YTPlayerChrome = { create: create, measure: measure, defaults: DEFAULTS };
})();
