/* Phones and tablets (task 933, 2026-11-22). Chrome on a phone or tablet does not run extensions: the Chrome Web Store says
   "added" and nothing happens. This file decides, once per page, whether the visitor is on a phone or tablet, and if so:
     - sets window.illiHandheld = true (landing.js and upgrade.js read it to turn install buttons into "Remind me on my computer"),
     - adds the class "is-handheld" to <html>,
     - shows every element marked data-handheld-note (the short "illi works in Chrome on a computer" notes beside store links).
   On a computer nothing happens: the notes stay hidden and every store link is untouched.

   How it decides, feature checks first, the browser's name second:
     1. A touch screen with no precise pointer at all (no mouse, no trackpad): (pointer: coarse) and not (any-pointer: fine).
        This catches Android tablets in Chrome's "desktop site" mode, which introduce themselves as a Linux computer.
        Not applied to Windows or ChromeOS, where Chrome runs extensions even on a touch-only screen (a Surface without its
        keyboard, a Chromebook folded into a tablet).
     2. The browser says it is mobile (navigator.userAgentData.mobile) or names a phone or tablet (Android, iPhone, iPad, iPod).
     3. An iPad introduces itself as a Mac. It has a touch screen and its browsers are never Chromium ones (only Chromium
        has navigator.userAgentData), so a Mac with touch points and no userAgentData is an iPad, even with a trackpad attached.
   ChromeOS (CrOS) is always a computer. ?device=mobile or ?device=desktop forces the answer, for testing. */
(function () {
  'use strict';
  var W = window, N = navigator, ua = N.userAgent || '', uad = N.userAgentData;
  function mq(q) { try { return !!(W.matchMedia && W.matchMedia(q).matches); } catch (e) { return false; } }
  var forced = null;
  try { forced = new URLSearchParams(location.search).get('device'); } catch (e) {}

  var chromeOS = /CrOS/.test(ua);
  var windows = /Windows/.test(ua);
  var touch = (N.maxTouchPoints || 0) > 0 || 'ontouchstart' in W;
  var touchOnly = touch && mq('(pointer: coarse)') && !mq('(any-pointer: fine)') && !windows;
  var named = !!(uad && (uad.mobile || uad.platform === 'Android')) || /Android|iPhone|iPad|iPod/i.test(ua);
  var ipadAsMac = /Macintosh/i.test(ua) && (N.maxTouchPoints || 0) > 1 && !uad;

  var handheld = !chromeOS && (touchOnly || named || ipadAsMac);
  if (forced === 'mobile') handheld = true;
  if (forced === 'desktop') handheld = false;
  W.illiHandheld = handheld;
  if (!handheld) return;

  document.documentElement.classList.add('is-handheld');
  function reveal() {
    var notes = document.querySelectorAll('[data-handheld-note]');
    for (var i = 0; i < notes.length; i++) notes[i].hidden = false;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal); else reveal();
})();
