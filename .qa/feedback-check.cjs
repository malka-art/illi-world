// Browser checks for the feedback page's dictation (/feedback/), E2E 2026-11-15 check 8.
// Runs the REAL page (feedback/index.html) from a local static server in headless Chrome.
// The browser's permission prompt can't be clicked from a script, so the Web Speech API and the
// microphone permission are replaced by a stand-in the test drives (window.__qa): it decides when
// "Allow" or "Block" happens. One extra check uses Chrome's REAL speech API with the microphone set
// to blocked through DevTools, to prove the real refusal error reaches the same message.
// SAFETY: every request that leaves 127.0.0.1 is aborted (fonts included); nothing is ever sent.
// Usage: node .qa/feedback-check.cjs   (captures go to the design folder as feedback-mic-*.png)
const puppeteer = require("C:/worktrees/illi-xbrowser-harness/node_modules/puppeteer-core");
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const CAPS =
  "C:/Users/35263/OneDrive/Documents/Vibe Coding/Malka's Software Dev/Dev Workflow/CompNy workflow/Projects/Illi/design/feedback-mic-hint-2026-11-16";
const PORT = 18787;
const base = "http://127.0.0.1:" + PORT;
const MIC_BLOCKED = "The microphone is blocked for this page. Allow it in your browser's site settings to talk, or just type your note.";
const MIC_DISMISSED = "The microphone prompt was closed. Tap to try again, or just type your note.";
const results = [];
let browser, server;

const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serve() {
  server = http.createServer((req, res) => {
    let p = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root)) return res.writeHead(403), res.end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    if (!fs.existsSync(p)) return res.writeHead(404), res.end();
    res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", r));
}

// Stand-in for SpeechRecognition + the microphone permission. initial = the permission state the
// page sees at load ('prompt' | 'granted' | 'denied'). The test calls __qa.allow() / block() /
// dismiss() / audio() to play the user's answer to the browser prompt.
function standIn(initial) {
  const qa = (window.__qa = { state: initial, recs: [], panesSeen: [] });
  const status = { onchange: null };
  Object.defineProperty(status, "state", { get: () => qa.state });
  const realQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (d) => (d && d.name === "microphone" ? Promise.resolve(status) : realQuery(d));
  class FakeSR {
    start() { qa.recs.push(this); }
    stop() { this.onend && this.onend(); }
    abort() { this.onerror && this.onerror({ error: "aborted" }); this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  const last = () => qa.recs[qa.recs.length - 1];
  qa.audio = () => last().onaudiostart && last().onaudiostart({});
  qa.allow = () => { qa.state = "granted"; status.onchange && status.onchange(); qa.audio(); };
  qa.allowPermissionOnly = () => { qa.state = "granted"; status.onchange && status.onchange(); };
  qa.block = () => { qa.state = "denied"; status.onchange && status.onchange(); const r = last(); r.onerror({ error: "not-allowed" }); r.onend && r.onend(); };
  qa.dismiss = () => { const r = last(); r.onerror({ error: "not-allowed" }); r.onend && r.onend(); };
  // record every pane that ever becomes active, so a brief flash can't hide from the test
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(() => {
      const a = document.querySelector(".voice-pane.active");
      if (a && qa.panesSeen[qa.panesSeen.length - 1] !== a.id) qa.panesSeen.push(a.id);
    }).observe(document.getElementById("voice"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
}

async function open(initial, { real = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith(base) ? r.continue() : r.abort()));
  if (!real) await page.evaluateOnNewDocument(standIn, initial);
  await page.goto(base + "/feedback/", { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 100)); // let the page's permission read settle
  return { page, errors };
}

const view = (page) =>
  page.evaluate(() => {
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
    const active = document.querySelector(".voice-pane.active");
    const toast = document.getElementById("toast");
    return {
      pane: active && active.id,
      hintVisible: vis(document.getElementById("v-waiting")) && document.getElementById("v-waiting").innerText.includes("Allow the microphone"),
      listeningVisible: vis(document.getElementById("v-listening")),
      toast: toast.classList.contains("show") ? document.getElementById("toastMsg").textContent : "",
      seen: window.__qa ? window.__qa.panesSeen.slice() : [],
      waitingText: document.getElementById("v-waiting").innerText,
    };
  });

async function capture(page, name) {
  fs.mkdirSync(CAPS, { recursive: true });
  const el = await page.$("form");
  const file = path.join(CAPS, "feedback-mic-" + name + ".png");
  await el.screenshot({ path: file });
  return file;
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, pass: false, error: String(e.message || e) });
    console.log("FAIL", name, "\n   ", e.message || e);
  }
}

(async () => {
  await serve();
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-first-run", "--disable-background-networking", "--hide-scrollbars"] });
  const captures = {};

  await check("Before permission: tapping Talk it out shows the Allow-the-microphone hint, not Listening", async () => {
    const { page, errors } = await open("prompt");
    await page.click("#startRec");
    const v = await view(page);
    assert.equal(v.pane, "v-waiting");
    assert.ok(v.hintVisible, "hint not visible");
    assert.ok(!v.listeningVisible, "Listening shown before permission");
    assert.ok(!v.waitingText.includes("\u2014"), "em dash in hint");
    assert.ok(!/Illi|ILLI/.test(v.waitingText), "product name not lowercase");
    captures.waiting = await capture(page, "1-waiting");
    await page.evaluate(() => window.__qa.allow());
    const after = await view(page);
    assert.equal(after.pane, "v-listening", "did not switch to listening after Allow");
    assert.ok(!after.hintVisible, "hint still visible after Allow");
    captures.allowed = await capture(page, "2-allowed-listening");
    assert.deepEqual(errors, []);
    await page.close();
  });

  await check("Allow seen only through the permission change (no audio event yet) also clears the hint", async () => {
    const { page } = await open("prompt");
    await page.click("#startRec");
    await page.evaluate(() => window.__qa.allowPermissionOnly());
    await new Promise((r) => setTimeout(r, 50));
    const v = await view(page);
    assert.equal(v.pane, "v-listening");
    await page.close();
  });

  await check("Mic already allowed: goes straight to Listening, the hint never flashes", async () => {
    const { page } = await open("granted");
    await page.click("#startRec");
    const v = await view(page);
    assert.equal(v.pane, "v-listening");
    assert.ok(!v.seen.includes("v-waiting"), "hint flashed: " + v.seen.join(","));
    await page.close();
  });

  await check("Refused (Block): back to idle, the blocked message explains how to fix it and stays put", async () => {
    const { page } = await open("prompt");
    await page.click("#startRec");
    await page.evaluate(() => window.__qa.block());
    await new Promise((r) => setTimeout(r, 100));
    let v = await view(page);
    assert.equal(v.pane, "v-idle");
    assert.equal(v.toast, MIC_BLOCKED);
    captures.refused = await capture(page, "3-refused");
    await new Promise((r) => setTimeout(r, 5600)); // longer than the ordinary toast's 5.2s
    v = await view(page);
    assert.equal(v.toast, MIC_BLOCKED, "refusal message disappeared on its own");
    await page.close();
  });

  await check("Prompt closed without answering: says so and invites another tap", async () => {
    const { page } = await open("prompt");
    await page.click("#startRec");
    await page.evaluate(() => window.__qa.dismiss());
    await new Promise((r) => setTimeout(r, 100));
    const v = await view(page);
    assert.equal(v.pane, "v-idle");
    assert.equal(v.toast, MIC_DISMISSED);
    captures.dismissed = await capture(page, "4-dismissed");
    await page.click("#startRec"); // trying again hides the old message and shows the hint again
    const again = await view(page);
    assert.equal(again.pane, "v-waiting");
    assert.equal(again.toast, "");
    await page.close();
  });

  await check("Mic already blocked: tapping explains at once, no hint and no Listening", async () => {
    const { page } = await open("denied");
    await page.click("#startRec");
    const v = await view(page);
    assert.equal(v.pane, "v-idle");
    assert.equal(v.toast, MIC_BLOCKED);
    assert.ok(!v.seen.includes("v-waiting") && !v.seen.includes("v-listening"), "flashed: " + v.seen.join(","));
    await page.close();
  });

  await check("Dictated words still land in the message field", async () => {
    const { page } = await open("granted");
    await page.click("#startRec");
    await page.evaluate(() => {
      const r = window.__qa.recs[0];
      const res = [{ 0: { transcript: "hello illi" }, isFinal: true, length: 1 }];
      r.onresult({ resultIndex: 0, results: res });
    });
    assert.equal(await page.$eval("#msg", (el) => el.value), "hello illi");
    await page.close();
  });

  await check("REAL Chrome speech API with the microphone blocked: same blocked message", async () => {
    const { page, errors } = await open(null, { real: true });
    const hasSR = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
    if (!hasSR) throw new Error("this Chrome build has no speech API; real check not possible here");
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setPermission", { origin: base, permission: { name: "microphone" }, setting: "denied" });
    await page.reload({ waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 200));
    await page.click("#startRec");
    await new Promise((r) => setTimeout(r, 1500));
    const v = await view(page);
    assert.equal(v.pane, "v-idle");
    assert.equal(v.toast, MIC_BLOCKED);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await check("REAL Chrome speech API refusal error (page's early check bypassed): same blocked message", async () => {
    const { page, errors } = await open(null, { real: true });
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setPermission", { origin: base, permission: { name: "microphone" }, setting: "denied" });
    await page.reload({ waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 200));
    // Forget the permission the page read at load, so the click reaches real recognition and the
    // refusal arrives as Chrome's own 'not-allowed' error, the path a user who clicks Block takes.
    await page.evaluate(() => { window.micState = null; });
    await page.click("#startRec");
    await new Promise((r) => setTimeout(r, 1500));
    const v = await view(page);
    assert.equal(v.pane, "v-idle");
    assert.equal(v.toast, MIC_BLOCKED);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await browser.close();
  server.close();
  const failures = results.filter((r) => !r.pass);
  fs.writeFileSync(path.join(__dirname, "feedback-results.json"), JSON.stringify({ testedAt: new Date().toISOString(), scope: "Real feedback page from a local server; speech API and microphone permission replaced by a test stand-in, plus one check on Chrome's real speech API with the microphone blocked. No request leaves 127.0.0.1.", passed: results.length - failures.length, failed: failures.length, captures, results }, null, 2));
  console.log(`\n${results.length - failures.length} passed, ${failures.length} failed`);
  for (const [k, f] of Object.entries(captures)) console.log(k + ": " + f);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
