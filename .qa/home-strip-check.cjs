// Home page moving strip, with and without reduced motion (regression guard added 2026-11-25).
// The bug it guards: landing.js copies the strip's items (marked aria-hidden) so the marquee loops; the reduced-motion rules stopped and
// wrapped the strip but left the copies showing, so for 16 days (6f0803d to 48f3292) reduced-motion visitors saw every gesture twice.
// handoff-check.cjs missed it because it only compares with origin/main; site-check.cjs only covers /upgrade/.
// This check stands alone (no comparison branch): it loads the real home page from this repo at 1440, 768 and 375 wide, once with
// prefers-reduced-motion: reduce and once without, and checks the strip and any other "copy the children to loop" group it finds
// (a parent holding aria-hidden children whose text repeats a visible sibling's). Every request leaving 127.0.0.1 is aborted, and so
// are film files (.mp4): the film is not what this checks.
//   [OUT=<captures folder>] node .qa/home-strip-check.cjs      (exit code 0 = all pass, 1 = a failure)
const puppeteer = require("C:/worktrees/illi-xbrowser-harness/node_modules/puppeteer-core");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "..");
const OUT = process.env.OUT || null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp4": "video/mp4", ".gif": "image/gif", ".ico": "image/x-icon" };
function serve(root, port) {
  const s = http.createServer((req, res) => {
    let p = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(path.resolve(root))) return res.writeHead(403), res.end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    if (!fs.existsSync(p)) return res.writeHead(404), res.end();
    res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => s.listen(port, "127.0.0.1", () => r(s)));
}
const PORT = 18935, B = "http://127.0.0.1:" + PORT;
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidTab: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
const SIZES = [
  { name: "1440", w: 1440, h: 900, ua: UA.win, mobile: false, touch: 0 },
  { name: "768", w: 768, h: 1024, ua: UA.androidTab, mobile: true, touch: 10 },
  { name: "375", w: 375, h: 812, ua: UA.iphone, mobile: true, touch: 5, noUad: true },
];
const results = []; let browser;
async function check(name, fn) { try { await fn(); results.push({ name, ok: true }); console.log("PASS", name); } catch (e) { results.push({ name, ok: false, err: String(e && e.stack || e) }); console.log("FAIL", name, "\n   ", String(e && e.message || e).slice(0, 600)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(dev, reduce) {
  const page = await browser.newPage();
  const rec = { errors: [] };
  await page.setUserAgent(dev.ua);
  await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: 1, isMobile: dev.mobile, hasTouch: dev.touch > 0 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }]);
  await page.evaluateOnNewDocument((d) => {
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => d.touch });
    if (d.noUad) Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  }, dev);
  await page.setRequestInterception(true);
  page.on("request", (req) => { const u = req.url(); if (u.startsWith(B + "/") && !/\.mp4/.test(u)) return req.continue(); req.abort(); });
  page.on("pageerror", (e) => rec.errors.push(String(e)));
  await page.goto(B + "/", { waitUntil: "load" });
  await page.mouse.move(dev.w - 1, 1); // away from the strip: hovering it pauses the marquee
  await wait(600);
  return { page, rec };
}

// everything the checks need, read in the page: the strip and every looped-copy group
const inspect = (page) => page.evaluate(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const rendered = (e) => {
    if (!e.getClientRects().length) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.visibility === "hidden" || c.display === "none" || parseFloat(c.opacity) === 0) return false; }
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  };
  // looped-copy groups: a parent with aria-hidden children whose text equals a visible (not aria-hidden) sibling's text
  const groups = [];
  for (const parent of document.body.querySelectorAll("*")) {
    const kids = [...parent.children];
    const orig = kids.filter((k) => k.getAttribute("aria-hidden") !== "true");
    const copies = kids.filter((k) => k.getAttribute("aria-hidden") === "true" && norm(k.textContent));
    if (!copies.length) continue;
    const origText = new Set(orig.map((k) => norm(k.textContent)));
    if (!copies.some((k) => origText.has(norm(k.textContent)))) continue;
    groups.push(parent);
  }
  const anims = (root) => document.getAnimations().filter((a) => a.effect && a.effect.target && (root === a.effect.target || root.contains(a.effect.target)) && a.playState === "running")
    .map((a) => (a.animationName || a.constructor.name) + " on " + a.effect.target.className);
  const label = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "");
  const strip = document.querySelector("#strip");
  const track = strip && strip.querySelector(".strip-track");
  return {
    hasStrip: !!strip, hasTrack: !!track,
    trackIsGroup: !!track && groups.includes(track),
    groups: groups.map((g) => {
      const kids = [...g.children];
      const orig = kids.filter((k) => k.getAttribute("aria-hidden") !== "true");
      const copies = kids.filter((k) => k.getAttribute("aria-hidden") === "true");
      const shown = kids.filter(rendered).map((k) => norm(k.textContent));
      return {
        label: label(g),
        origTexts: orig.map((k) => norm(k.textContent)),
        copyTexts: copies.map((k) => norm(k.textContent)),
        copiesShown: copies.filter(rendered).length,
        repeatsShown: [...new Set(shown)].filter((t) => shown.filter((x) => x === t).length > 1),
        running: anims(g.parentElement || g),
      };
    }),
    // the strip on its own: aria-hidden things carrying text that are drawn, and each gesture's name as it reads on screen
    hiddenShownInStrip: strip ? [...strip.querySelectorAll('[aria-hidden="true"]')].filter((e) => norm(e.textContent) && rendered(e)).length : -1,
    stripNames: track ? [...track.querySelectorAll(':scope > li:not([aria-hidden="true"]) .do')].map((e) => norm(e.textContent)) : [],
    stripText: strip ? strip.innerText : "",
    stripRunning: strip ? anims(strip) : [],
    trackX: track ? track.getBoundingClientRect().x : null,
    sideScroll: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, innerWidth: innerWidth },
  };
});
const countIn = (hay, needle) => hay.split(needle).length - 1;

(async () => {
  const s = await serve(ROOT, PORT);
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-first-run", "--disable-background-networking", "--hide-scrollbars", "--host-resolver-rules=MAP chromewebstore.google.com ~NOTFOUND"] });
  const groupsSeen = new Set();

  for (const dev of SIZES) {
    // ---------- reduced motion: the strip stands still, wraps, and shows each gesture once ----------
    await check(dev.name + "px reduced motion: strip still, each gesture shown once, copies hidden, no sideways scroll", async () => {
      const { page, rec } = await open(dev, true);
      const d = await inspect(page);
      if (OUT) await page.screenshot({ path: path.join(OUT, "home-strip-" + dev.name + "-reduced.png"), fullPage: true });
      d.groups.forEach((g) => groupsSeen.add(g.label));
      assert.ok(d.hasStrip && d.hasTrack, "no #strip .strip-track on the home page");
      assert.ok(d.stripNames.length >= 1, "no gestures found in the strip");
      const twice = d.stripNames.filter((n) => countIn(d.stripText, n) > 1);
      assert.deepEqual(twice, [], "gesture shown more than once in the strip: " + twice.map((n) => n + " x" + countIn(d.stripText, n)).join(", "));
      assert.equal(d.hiddenShownInStrip, 0, "aria-hidden copies drawn in the strip: " + d.hiddenShownInStrip);
      for (const g of d.groups) {
        assert.equal(g.copiesShown, 0, g.label + ": " + g.copiesShown + " aria-hidden copies drawn");
        assert.deepEqual(g.repeatsShown, [], g.label + ": items shown more than once: " + g.repeatsShown.join(" | "));
        assert.deepEqual(g.running, [], g.label + ": animation still running: " + g.running.join(", "));
      }
      assert.deepEqual(d.stripRunning, [], "animation still running on the strip: " + d.stripRunning.join(", "));
      const x1 = d.trackX; await wait(700); const x2 = (await inspect(page)).trackX;
      assert.equal(Math.round(x1), Math.round(x2), "strip moved with reduced motion on: " + x1 + " -> " + x2);
      assert.ok(d.sideScroll.scrollWidth <= d.sideScroll.innerWidth, "sideways scroll: " + JSON.stringify(d.sideScroll));
      assert.deepEqual(rec.errors, []);
      await page.close();
    });

    // ---------- motion on: the marquee runs and has its looped copies (so a future fix cannot break the normal strip) ----------
    await check(dev.name + "px motion on: strip animates and carries one looped copy of every gesture, no sideways scroll", async () => {
      const { page, rec } = await open(dev, false);
      const d = await inspect(page);
      if (OUT) await page.screenshot({ path: path.join(OUT, "home-strip-" + dev.name + "-motion.png") });
      d.groups.forEach((g) => groupsSeen.add(g.label));
      assert.ok(d.trackIsGroup, "the strip track has no aria-hidden looped copies");
      for (const g of d.groups) {
        assert.ok(g.origTexts.length >= 1, g.label + ": no original items");
        assert.deepEqual(g.copyTexts, g.origTexts, g.label + ": the looped copies do not match the items one for one");
        assert.equal(g.copiesShown, g.copyTexts.length, g.label + ": looped copies not drawn (" + g.copiesShown + " of " + g.copyTexts.length + "), the loop would show a gap");
        assert.ok(g.running.length >= 1, g.label + ": no running animation");
      }
      assert.ok(d.stripRunning.length >= 1, "no running animation on the strip");
      const x1 = d.trackX; await wait(800); const x2 = (await inspect(page)).trackX;
      assert.ok(Math.abs(x2 - x1) >= 1, "the strip did not move in 0.8 s: " + x1 + " -> " + x2);
      assert.ok(d.sideScroll.scrollWidth <= d.sideScroll.innerWidth, "sideways scroll: " + JSON.stringify(d.sideScroll));
      assert.deepEqual(rec.errors, []);
      await page.close();
    });
  }
  console.log("     looped-copy groups found on the home page: " + ([...groupsSeen].join(", ") || "none"));

  const failed = results.filter((r) => !r.ok).length;
  if (OUT) fs.writeFileSync(path.join(OUT, "home-strip-results.json"), JSON.stringify({ when: new Date().toISOString(), groups: [...groupsSeen], results }, null, 2));
  console.log("\n" + (results.length - failed) + "/" + results.length + " pass");
  await browser.close(); s.close();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); if (browser) await browser.close(); process.exit(1); });
