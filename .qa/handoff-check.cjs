// Task 933 handoff sheet (2026-11-24): phones and tablets get one line and one button, and every install button opens the handoff
// sheet; desktop must not change at all. Serves this repo and a copy of the comparison branch (origin/main) side by side.
// Every request leaving 127.0.0.1 is aborted, except send-to-desktop, which is answered by a fixture (no email is ever sent).
// Film files (.mp4) are aborted, so "The demo didn't load" in the captures is a test artifact. Desktop pages are compared with the
// comparison copy: every visible link and button, the page text, and the pixels (film and moving strip masked: they animate, and
// differ between two loads of the same page; 1 to 2 levels of anti-aliasing noise tolerated).
//   MAIN_DIR=<export of origin/main without .mp4> OUT=<captures folder> node .qa/handoff-check.cjs
//   (make the export with: git archive origin/main | tar -x -C <dir> --exclude='*.mp4')
const puppeteer = require("C:/worktrees/illi-xbrowser-harness/node_modules/puppeteer-core");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const BRANCH = path.resolve(__dirname, "..");
const MAIN = process.env.MAIN_DIR;
const OUT = process.env.OUT;
if (!MAIN || !OUT) { console.error("set MAIN_DIR and OUT"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp4": "video/mp4", ".gif": "image/gif" };
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
const B = "http://127.0.0.1:18933", M = "http://127.0.0.1:18934";
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidPhone: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidTab: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
// name, viewport, ua, handheld expected, init (navigator overrides)
const DEVICES = [
  { name: "phone-375-iphone", w: 375, h: 812, ua: UA.iphone, mobile: true, hand: true, noUad: true, touch: 5 },
  { name: "phone-375x700", w: 375, h: 700, ua: UA.iphone, mobile: true, hand: true, noUad: true, touch: 5 },
  { name: "phone-412-android", w: 412, h: 915, ua: UA.androidPhone, mobile: true, hand: true, touch: 5 },
  { name: "tablet-768-android", w: 768, h: 1024, ua: UA.androidTab, mobile: true, hand: true, touch: 10 },
  { name: "tablet-1280-android-desktop-site", w: 1280, h: 800, ua: UA.linux, mobile: false, hand: true, touch: 10, coarseOnly: true },
  { name: "tablet-820-ipad", w: 820, h: 1180, ua: UA.ipad, mobile: true, hand: true, noUad: true, touch: 5 },
  { name: "desktop-1440", w: 1440, h: 900, ua: UA.win, mobile: false, hand: false, touch: 0 },
  { name: "desktop-1440-touch-windows", w: 1440, h: 900, ua: UA.win, mobile: false, hand: false, touch: 10 },
];
const results = []; let browser;
async function check(name, fn) { try { await fn(); results.push({ name, ok: true }); console.log("PASS", name); } catch (e) { results.push({ name, ok: false, err: String(e && e.stack || e) }); console.log("FAIL", name, "\n   ", String(e && e.message || e).slice(0, 400)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(dev, url, opts = {}) {
  const page = await browser.newPage();
  const rec = { send: [], aborted: [], errors: [] };
  await page.setUserAgent(dev.ua);
  await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: 1, isMobile: dev.mobile, hasTouch: dev.touch > 0 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument((d) => {
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => d.touch });
    if (d.noUad) Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
    if (d.coarseOnly) {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => { if (/any-pointer:\s*fine/.test(q)) return { matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; if (/pointer:\s*coarse/.test(q)) return { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; return mm(q); };
    }
    if (!d.touch) { try { delete window.ontouchstart; } catch (e) {} }
  }, dev);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith("http://127.0.0.1")) { if (/\.mp4/.test(u)) return req.abort(); return req.continue(); }
    if (u.includes("send-to-desktop")) {
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" } });
      rec.send.push(JSON.parse(req.postData() || "{}"));
      const body = opts.sendReply || { ok: true };
      return req.respond({ status: body.ok ? 200 : 429, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    }
    rec.aborted.push(u); req.abort();
  });
  page.on("pageerror", (e) => rec.errors.push(String(e)));
  await page.goto(url, { waitUntil: "load" });
  await wait(500);
  return { page, rec };
}
const txt = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const vis = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== "hidden").catch(() => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function shot(page, name, full) { await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: !!full }); }
async function scrollTo(page, sel, block) { await page.evaluate((s, b) => { document.documentElement.style.scrollBehavior = "auto"; document.querySelector(s).scrollIntoView({ block: b }); }, sel, block); await wait(200); }

// decode both PNGs in the browser and count pixels that differ by more than 2 levels in any channel (-1: sizes differ)
async function pixelDiff(x, y) {
  const page = await browser.newPage();
  const n = await page.evaluate(async (a, b) => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + src; });
    const [i1, i2] = await Promise.all([load(a), load(b)]);
    if (i1.width !== i2.width || i1.height !== i2.height) return -1;
    const data = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const d1 = data(i1), d2 = data(i2); let k = 0;
    for (let j = 0; j < d1.length; j += 4) if (Math.abs(d1[j] - d2[j]) > 2 || Math.abs(d1[j + 1] - d2[j + 1]) > 2 || Math.abs(d1[j + 2] - d2[j + 2]) > 2) k++;
    return k;
  }, x.toString("base64"), y.toString("base64"));
  await page.close();
  return n;
}

(async () => {
  const s1 = await serve(BRANCH, 18933), s2 = await serve(MAIN, 18934);
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-first-run", "--disable-background-networking", "--hide-scrollbars", "--host-resolver-rules=MAP chromewebstore.google.com ~NOTFOUND"] });

  for (const dev of DEVICES.filter((d) => d.hand)) {
    await check(dev.name + ": home: one line, one button, sheet from every install button, never the store", async () => {
      const { page, rec } = await open(dev, B + "/");
      assert.equal(await page.evaluate(() => window.illiHandheld), true, "not detected as handheld");
      assert.equal(await vis(page, "#device-note"), true);
      assert.equal(await txt(page, "#device-note"), "illi works in Chrome on a desktop or laptop.");
      assert.equal(await txt(page, ".hero-action a[data-cta=hero]"), "Send illi to my computer");
      assert.equal(await txt(page, ".site-head a[data-cta=header]"), "Get illi now");
      assert.equal(await txt(page, ".close a[data-cta=close]"), "Send illi to my computer");
      assert.equal(await page.$eval(".fp-cta a", (a) => a.textContent.trim() + "|" + a.getAttribute("href")), "Send illi to my computer|#handoff");
      // one red button in the hero action area
      const reds = await page.$$eval(".hero-action a, .hero-action button", (els) => els.filter((e) => e.offsetWidth).map((e) => e.textContent.trim()));
      assert.deepEqual(reds, ["Send illi to my computer"]);
      assert.equal(await page.$("#send-dialog"), null, "old send popup still present");
      assert.equal(await noSideScroll(page), true, "sideways scroll");
      await scrollTo(page, ".hero-action", "end");
      await shot(page, dev.name + "__home__1-hero");
      for (const sel of [".hero-action a[data-cta=hero]", ".site-head a[data-cta=header]", ".close a[data-cta=close]", "a[data-cta=footer_store]", ".fp-cta a"]) {
        await page.evaluate((s) => { const a = document.querySelector(s); a.style.visibility = "visible"; a.click(); }, sel);
        await wait(350);
        assert.equal(await page.$eval("#handoff", (d) => d.open), true, sel + " did not open the sheet");
        assert.equal(page.url(), B + "/", sel + " navigated");
        await page.keyboard.press("Escape"); await wait(150);
        assert.equal(await page.$eval("#handoff", (d) => d.open), false, "Escape did not close");
      }
      assert.equal(rec.aborted.filter((u) => u.includes("chromewebstore")).length, 0, "store was opened");
      assert.equal(await page.$eval("#cta-note", (n) => n.hidden), true, "store note shown on the handheld path");
      // the closing band
      await scrollTo(page, ".close", "center");
      await shot(page, dev.name + "__home__6-closing-band");
      // the sheet
      await scrollTo(page, ".hero-action", "end");
      await page.click(".hero-action a[data-cta=hero]"); await wait(400);
      const t = await page.evaluate(() => {
        const d = document.getElementById("handoff"), r = d.getBoundingClientRect();
        return { title: d.querySelector(".handoff-view:not([hidden]) .handoff-title").textContent, active: document.activeElement.className, top: r.top, bottom: r.bottom, h: innerHeight, w: r.width,
          text: d.querySelector('[data-view="choose"]').innerText,
          store: d.querySelector("#handoff-store").href + "|" + d.querySelector("#handoff-store").target,
          tap: [...d.querySelectorAll(".handoff-btn,.handoff-input,.handoff-close")].map((e) => Math.round(e.getBoundingClientRect().height)) };
      });
      assert.equal(t.title, "Send illi to your computer.");
      assert.equal(t.active, "handoff-title", "focus did not land on the title");
      assert.equal(t.store, "https://chromewebstore.google.com/detail/hocdlcekmbokkepblkopcefmenhnincg|_blank");
      for (const line of ["It works in Chrome on a desktop or laptop.", "Add it from the Chrome Web Store", "Tap Add to Desktop, then confirm.", "Open Chrome on your computer. illi is waiting there.", "Open the Chrome Web Store", "Works when you’re signed in to Chrome with the same Google account on both.", "Or email me the link", "Open it at your computer. It’s the only email this form sends.", "Send me the link"]) assert.ok(t.text.includes(line), "missing: " + line);
      assert.ok(t.text.indexOf("Open the Chrome Web Store") < t.text.indexOf("Or email me the link"), "store route not first");
      assert.ok(t.tap.every((h) => h >= 48), "touch target under 48: " + t.tap);
      assert.ok(t.top >= 0 && t.bottom <= t.h + 1, "sheet does not fit the screen: " + JSON.stringify(t));
      if (dev.w < 600) assert.ok(Math.abs(t.bottom - t.h) <= 1 && t.w === dev.w, "phone sheet not on the bottom edge");
      else { const side = await page.$$eval(".handoff-route", (r) => r.map((e) => Math.round(e.getBoundingClientRect().top))); assert.equal(side[0], side[1], "tablet routes not side by side"); }
      await shot(page, dev.name + "__home__2-sheet");
      // error, beside the field
      await page.type("#handoff-email", "dana@gmail");
      await page.click("#handoff-form button[type=submit]"); await wait(200);
      assert.equal(await txt(page, "#handoff-status"), "That doesn’t look like an email address. Check it and try again.");
      assert.equal(await page.$eval("#handoff-email", (e) => e.getAttribute("aria-invalid")), "true");
      assert.equal(rec.send.length, 0, "invalid address was sent");
      await page.evaluate(() => document.activeElement.blur());
      await shot(page, dev.name + "__home__5-email-error");
      // store route: opens the store in a new tab, then the return state
      const opened = new Promise((res) => browser.once("targetcreated", res));
      await page.click("#handoff-store");
      const tgt = await opened; assert.equal(tgt.url(), "https://chromewebstore.google.com/detail/hocdlcekmbokkepblkopcefmenhnincg");
      const p2 = await tgt.page(); if (p2) await p2.close();
      await page.bringToFront(); await wait(600);
      const st = await page.$eval('#handoff [data-view="store"]', (v) => !v.hidden && v.innerText);
      for (const line of ["Now open Chrome on your computer.", "Chrome will tell you illi was added. Choose Enable extension and your videos start listening.", "45 days of Premium free · No card required", "No Add to Desktop? Email me the link instead"]) assert.ok(st && st.includes(line), "return state missing: " + line);
      await shot(page, dev.name + "__home__3-back-from-store");
      await page.click("#handoff-fallback"); await wait(200);
      assert.equal(await page.evaluate(() => document.activeElement.id), "handoff-email");
      // email route: posts address + honeypot, then the sent state
      await page.$eval("#handoff-email", (e) => { e.value = ""; });
      await page.type("#handoff-email", "sam@example.com");
      await page.click("#handoff-form button[type=submit]"); await wait(400);
      assert.deepEqual(rec.send, [{ email: "sam@example.com", website: "" }]);
      const sent = await page.$eval('#handoff [data-view="sent"]', (v) => !v.hidden && v.innerText);
      assert.ok(sent && sent.includes("Sent.") && sent.includes("Open the email on your computer and you’re one click from installing.") && sent.includes("45 days of Premium free · No card required"), "sent state: " + sent);
      await shot(page, dev.name + "__home__4-email-sent");
      assert.deepEqual(rec.errors, []);
      await page.close();
    });
    await check(dev.name + ": home: server refusals show the approved B14 messages", async () => {
      for (const [err, msg] of [["already_sent", "We already sent the link to that address today. Check your inbox, and the spam folder just in case."], ["busy", "The form is busy right now. Please try again later."], ["nope", "The email didn’t go out. Please try again in a minute."]]) {
        const { page } = await open(dev, B + "/", { sendReply: { ok: false, error: err } });
        await page.click(".hero-action a[data-cta=hero]"); await wait(300);
        await page.type("#handoff-email", "sam@example.com");
        await page.click("#handoff-form button[type=submit]"); await wait(400);
        assert.equal(await txt(page, "#handoff-status"), msg);
        assert.equal(await page.$eval('#handoff [data-view="choose"]', (v) => v.hidden), false);
        await page.close();
      }
    });
    await check(dev.name + ": /upgrade: hero and Free card relabel and open the same sheet; header 'Get illi now'; footer store link opens it", async () => {
      const { page, rec } = await open(dev, B + "/upgrade/");
      await wait(500);
      assert.equal(await txt(page, "#heroInstall"), "Send illi to my computer");
      assert.equal(await txt(page, "#freeInstall"), "Send illi to my computer");
      assert.equal(await txt(page, ".site-head [data-install]"), "Get illi now");
      assert.equal(await page.$("#sendForm"), null);
      assert.equal(await noSideScroll(page), true);
      await shot(page, dev.name + "__upgrade__1-hero");
      for (const sel of ["#heroInstall", "#freeInstall", ".site-head [data-install]", ".site-foot a[data-handoff]"]) {
        await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(300);
        assert.equal(await page.$eval("#handoff", (d) => d.open), true, sel);
        assert.equal(page.url(), B + "/upgrade/");
        await page.keyboard.press("Escape"); await wait(150);
      }
      await page.click("#heroInstall"); await wait(400);
      await shot(page, dev.name + "__upgrade__2-sheet");
      await page.type("#handoff-email", "sam@example.com");
      await page.click("#handoff-form button[type=submit]"); await wait(400);
      assert.deepEqual(rec.send, [{ email: "sam@example.com", website: "" }]);
      assert.equal(await page.$eval('#handoff [data-view="sent"]', (v) => v.hidden), false);
      assert.equal(rec.aborted.filter((u) => u.includes("chromewebstore")).length, 0);
      assert.deepEqual(rec.errors, []);
      await page.close();
    });
    await check(dev.name + ": legal pages show the footer note", async () => {
      for (const [p, line] of [["/privacy.html", "illi works in Chrome on a computer or laptop. Open illi.world there to install."], ["/fr/terms.html", "illi fonctionne dans Chrome sur un ordinateur de bureau ou un portable. Ouvrez illi.world sur votre ordinateur pour installer l’extension."]]) {
        const { page } = await open(dev, B + p);
        assert.equal(await vis(page, ".handheld-note"), true, p);
        assert.equal(await txt(page, ".handheld-note"), line);
        assert.equal(await noSideScroll(page), true);
        if (dev.name === "phone-375-iphone") { await scrollTo(page, ".handheld-note", "center"); await shot(page, dev.name + "__" + p.replace(/\W/g, "") + "__footer"); }
        await page.close();
      }
    });
  }

  // desktop: nothing changes. Compare the branch with origin/main: every link and button (text, href, target), and the pixels.
  for (const dev of DEVICES.filter((d) => !d.hand)) {
    for (const p of ["/", "/upgrade/", "/privacy.html", "/terms.html", "/fr/privacy.html"]) {
      await check(dev.name + ": " + p + " identical to origin/main (links, text, pixels), no sheet", async () => {
        const snap = async (base) => {
          const { page, rec } = await open(dev, base + p);
          await wait(400);
          const dom = await page.evaluate(() => ({
            handheld: window.illiHandheld, sheet: !!document.getElementById("handoff"),
            links: [...document.querySelectorAll("a,button")].filter((e) => e.offsetWidth || e.offsetHeight).map((e) => [e.textContent.trim(), e.getAttribute("href"), e.getAttribute("target")].join("|")),
            text: document.body.innerText,
          }));
          if (base === B) await page.screenshot({ path: path.join(OUT, dev.name + "__" + (p.replace(/\W/g, "") || "home") + "__full.png"), fullPage: true });
          // the film area plays a loop and is not deterministic between two loads of the same page (checked main against main): masked
          await page.evaluate(() => { document.querySelectorAll("#stage, .strip").forEach((s) => { s.style.visibility = "hidden"; }); });
          const img = await page.screenshot({ fullPage: true });
          if (base === B) await page.screenshot({ path: path.join(OUT, dev.name + "__" + (p.replace(/\W/g, "") || "home") + "__top.png") });
          await page.close();
          return { dom, img, rec };
        };
        const a = await snap(B), b = await snap(M);
        assert.equal(a.dom.sheet, false, "sheet built on desktop");
        assert.notEqual(a.dom.handheld, true);
        assert.deepEqual(a.dom.links, b.dom.links);
        assert.equal(a.dom.text, b.dom.text);
        assert.deepEqual(a.rec.errors, []);
        const px = await pixelDiff(a.img, b.img);
        assert.equal(px, 0, px + " pixels differ from origin/main by more than 2 levels");
      });
    }
  }

  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " pass");
  await browser.close(); s1.close(); s2.close();
  process.exit(failed ? 1 : 0);
})();
