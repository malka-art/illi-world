// Partner links, end to end (task 304, 2026-11-16).
// The chain under test, with nothing from production:
//   illi.world/<name> (no page, so 404.html answers, exactly as GitHub Pages does) -> the home page with the partner's tags
//   -> track.js counts the visit (beacons to a local stand-in) and tags the Chrome Web Store links -> "Remember it" keeps the
//   tags in illi.note -> /upgrade -> the stripe-checkout request body (intercepted) -> the REAL stripe-checkout handler from
//   CODE_DIR, run with doubles of the offer ledger and of Stripe -> the Checkout Session metadata.
// And every way it must NOT carry the partner: no answer, "Don't remember it", Global Privacy Control, Do Not Track,
// "Stop counting my visits", a yes older than 13 months, a non-partner link, a name no longer on the list.
// "Adding a creator" is tested the way it will be done: the real assets/partners.js with one more name added to its list.
// SAFETY: every request to *.supabase.co is aborted and listed (the list must stay empty); every request to any host that is
// not this machine is aborted and listed (must stay empty). The supabase-js module is a fixture, so no real sign-in happens.
//
//   CODE_DIR=<backend worktree with supabase/functions/stripe-checkout>  node .qa/partners-check.cjs
//   (puppeteer-core and Chrome as in site-check.cjs; pricing fixtures from backend-contract.cjs)
const puppeteer = require("C:/worktrees/illi-xbrowser-harness/node_modules/puppeteer-core");
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const { stripTypeScriptTypes } = require("node:module");
const sourceFixture = require("./backend-contract.cjs");

const root = path.resolve(__dirname, "..");
const CODE = process.env.CODE_DIR;
if (!CODE) throw new Error("set CODE_DIR to the backend worktree");
const PORT = 18792;
const base = "http://127.0.0.1:" + PORT;
const COLLECT = base + "/collect";
const TEST_PARTNER = "testpartner";
const results = [];
const failures = [];
const prodHits = [];
const outside = [];
let beacons = [];
let browser, server, closedOffer;

/* ---------- a local stand-in for GitHub Pages: files, folder index.html, and 404.html (status 404) for anything else ---------- */
const realList = fs.readFileSync(path.join(root, "assets/partners.js"), "utf8");
// adding a creator = one more line in the list; nothing else changes
const listWithTest = realList.replace(/window\.ILLI_PARTNERS = \[\r?\n/, "window.ILLI_PARTNERS = [\n  '" + TEST_PARTNER + "',\n");
assert.notEqual(listWithTest, realList, "could not add a name to assets/partners.js the documented way");
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".mp4": "video/mp4", ".json": "application/json" };
const statuses = {};
function serve() {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (req.method === "POST" && u.pathname === "/collect") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => { try { beacons.push(JSON.parse(b)); } catch (e) { beacons.push({ bad: b.slice(0, 200) }); } res.writeHead(204, { "access-control-allow-origin": "*" }); res.end(); });
      return;
    }
    if (u.pathname === "/assets/partners.js") { res.writeHead(200, { "content-type": types[".js"], "cache-control": "no-store" }); return res.end(listWithTest); }
    let p = path.resolve(root, "." + decodeURIComponent(u.pathname));
    if (!p.startsWith(root)) return res.writeHead(403), res.end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    let status = 200;
    if (!fs.existsSync(p)) { p = path.join(root, "404.html"); status = 404; }
    statuses[u.pathname] = status;
    const size = fs.statSync(p).size, range = req.headers.range;
    const head = { "content-type": types[path.extname(p)] || "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-store" };
    if (range && status === 200) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = Number(s) || 0, end = Math.min(e ? Number(e) : size - 1, size - 1);
      res.writeHead(206, Object.assign(head, { "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 }));
      return fs.createReadStream(p, { start, end }).pipe(res);
    }
    res.writeHead(status, head);
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", r));
}

/* ---------- the /upgrade fixtures (as site-check.cjs): a signed-in trial user; pricing from the real pricing-info handler ---------- */
const SUPABASE_FIXTURE = `export const createClient = () => ({
  auth: { getSession: async () => ({ data: { session: { access_token: "TEST", user: { id: "fixture-user" } } } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: window.QA_PROFILE, error: null }) }) }) }),
});`;
const TRIAL = { tier: "trial", trial_ends_at: "2026-12-20T15:00:00Z", founding_paid_until: null, founding_years_purchased: 0, founding_billing_review: false, deletion_scheduled_at: null };

async function newContext({ gpc = false, dnt = false, seed = null, phone = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const rec = { checkout: [], stripeNav: [], errors: [] };
  if (phone) {
    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  } else {
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1440, height: 900 });
  }
  await page.evaluateOnNewDocument((p) => { window.QA_PROFILE = p; }, TRIAL);
  if (gpc) await page.evaluateOnNewDocument(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  if (dnt) await page.evaluateOnNewDocument(() => Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1" }));
  if (seed) await page.evaluateOnNewDocument((s) => { if (location.hostname === "127.0.0.1" && !sessionStorage.getItem("qa-seeded")) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem("qa-seeded", "1"); } }, seed);
  await page.setRequestInterception(true);
  const json = (req, status, body) => req.respond({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" }, body: req.method() === "OPTIONS" ? "" : JSON.stringify(body) });
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith(base + "/assets/vendor/supabase-js-2.103.0.esm.js")) return req.respond({ status: 200, contentType: "application/javascript", body: SUPABASE_FIXTURE });
    if (u.startsWith(base + "/")) return req.continue();
    if (/^(data:|blob:)/.test(u)) return req.continue();
    if (u.includes("/functions/v1/pricing-info")) return json(req, 200, closedOffer);
    if (u.includes("/functions/v1/stripe-checkout")) {
      if (req.method() !== "OPTIONS") rec.checkout.push(JSON.parse(req.postData() || "{}"));
      return json(req, 200, { url: "https://checkout.stripe.com/c/pay/test" });
    }
    if (/^https:\/\/checkout\.stripe\.com\//.test(u)) { rec.stripeNav.push(u); return req.respond({ status: 204, body: "" }); }   // 204: the page stays on /upgrade
    if (u.includes("chromewebstore.google.com")) return req.abort();
    if (u.includes("supabase.co")) { prodHits.push(req.method() + " " + u.split("?")[0]); return req.abort(); }
    outside.push(u.split("?")[0]);
    return req.abort();
  });
  page.on("pageerror", (e) => rec.errors.push(String(e)));
  page.on("popup", (p) => p.close().catch(() => {}));
  return Object.assign({ ctx, page }, rec);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function storage(page) {
  return page.evaluate(() => {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    return { ls, n: localStorage.length, session: Object.keys(sessionStorage).filter((k) => k !== "qa-seeded").length, cookie: document.cookie };
  });
}
const nothingStored = (s) => s.n === 0 && s.session === 0 && s.cookie === "";
async function flush(page) { await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pagehide")); }); await wait(500); }
async function waitAsk(page) {
  try { await page.waitForFunction(() => { const a = document.getElementById("ask"); return a && !a.hidden && !a.classList.contains("is-aside"); }, { timeout: 3000 }); return true; } catch (e) { return false; }
}
const partnerLink = (p, q = "") => base + p + "?track_endpoint=" + encodeURIComponent(COLLECT) + q;
async function arrive(page, p, q) {
  const first = await page.goto(partnerLink(p, q), { waitUntil: "load" });
  await page.waitForFunction(() => location.pathname === "/" || document.title.startsWith("Page not found"), { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => document.readyState === "complete");
  return first;
}
const params = (page) => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
const storeLinks = (page) => page.$$eval('a[href*="chromewebstore"]', (as) => as.map((a) => a.href));
async function buyMonthly(r) {
  await r.page.goto(base + "/upgrade/", { waitUntil: "load" });
  await r.page.waitForFunction(() => window.illiOffer && document.fonts.status === "loaded", { timeout: 10000 });
  await r.page.evaluate(() => window.illiOffer.ready);
  await wait(300);
  await r.page.click('[data-buy="standard"][data-interval="monthly"]');
  for (let i = 0; i < 40 && !r.checkout.length; i++) await wait(100);
  await wait(200);
  return r.checkout[r.checkout.length - 1];
}

/* ---------- the REAL stripe-checkout handler, with doubles (as scripts/checkout-partner-test.mjs) ---------- */
const handlerCode = stripTypeScriptTypes(fs.readFileSync(path.join(CODE, "supabase/functions/stripe-checkout/index.ts"), "utf8").replace(/^import[\s\S]*?;\r?\n/gm, ""));
async function realCheckout(body) {
  const created = [];
  const attempt = { id: "att_1", user_id: "test-user", buyer_key: "test-user", kind: "standard", cadence: body.interval, founding_years: null, renewal_quote_at: new Date(Date.now() + 365 * 864e5).toISOString(), state: "creating", stripe_session_id: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 36e5).toISOString() };
  const q = { select: () => q, eq: () => q, in: () => q, limit: () => q, upsert: async () => ({}), single: async () => ({ data: { stripe_customer_id: "cus_test", tier: "trial", trial_ends_at: new Date(Date.now() + 20 * 864e5).toISOString() } }), maybeSingle: async () => ({ data: null }) };
  const db = { rpc: async (n) => (n === "reserve_offer_checkout" ? { data: { ...attempt } } : { data: null }), auth: { getUser: async () => ({ data: { user: { id: "test-user", email: "test@example.com" } } }) }, from: () => q };
  const stripe = {
    prices: { list: async (a) => ({ data: [{ id: "price_" + a.lookup_keys[0], currency: "usd", unit_amount: a.lookup_keys[0] === "illi_annual" ? 10000 : 1000, recurring: { interval: a.lookup_keys[0] === "illi_annual" ? "year" : "month", interval_count: 1 } }] }) },
    charges: { list: async () => ({ data: [] }) },
    subscriptions: { list: async () => ({ data: [], has_more: false }) },
    checkout: { sessions: { list: async () => ({ data: [], has_more: false }), create: async (p) => { created.push(p); return { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1", status: "open", metadata: p.metadata }; } } },
    billingPortal: { configurations: { list: async () => ({ data: [] }) }, sessions: { create: async () => ({ url: "x" }) } },
  };
  let handler;
  vm.runInNewContext(handlerCode, { OFFER_VERSION: "broad-2026-10-renewing", serve: (f) => (handler = f), createClient: () => db, Stripe: class { constructor() { Object.assign(this, stripe); } }, Deno: { env: { get: () => undefined } }, Response, Request, console });
  const res = await handler(new Request("https://example.test", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify(body) }));
  return { status: res.status, session: created[0] };
}

function record(name) { results.push({ name, pass: true }); console.log("PASS " + name); }
async function check(name, fn) {
  try { await fn(); record(name); } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 400);
    failures.push({ name, error: msg }); results.push({ name, pass: false, error: msg }); console.log("FAIL " + name + "\n     " + msg);
  }
}
const note = (f, at = new Date().toISOString()) => JSON.stringify({ id: "11111111-2222-4333-8444-555555555555", f, at });
const partnerTags = { s: TEST_PARTNER, m: "partner", c: "partners" };

(async () => {
  closedOffer = await sourceFixture("not_started");
  await serve();
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-first-run", "--disable-background-networking", "--host-resolver-rules=MAP chromewebstore.google.com ~NOTFOUND, MAP *.stripe.com ~NOTFOUND"] });

  /* ---------------- the list itself ---------------- */
  await check("The shipped list parses, and every name follows the rules and is not an existing page or folder", async () => {
    const box = { window: {} };
    vm.runInNewContext(realList, box);
    const list = box.window.ILLI_PARTNERS;
    assert.ok(Array.isArray(list), "window.ILLI_PARTNERS is not a list");
    const taken = new Set(fs.readdirSync(root).map((f) => f.replace(/\.html$/, "").toLowerCase()));
    for (const name of list) {
      assert.match(name, /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/, "bad name " + name);
      assert.ok(!taken.has(name), name + " is already a page or folder, so its link would never reach 404.html");
    }
    assert.equal(new Set(list).size, list.length, "a name is listed twice");
    console.log("     names on the shipped list: " + list.length);
  });
  await check("The checkout function accepts every name the list rules allow (same pattern on both sides)", async () => {
    const fn = fs.readFileSync(path.join(CODE, "supabase/functions/stripe-checkout/index.ts"), "utf8");
    assert.ok(fn.includes("const PARTNER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;"), "the function's name pattern changed");
  });

  /* ---------------- 1. the full chain: partner link, count, store tag, yes, pay ---------------- */
  await check("Chain: link -> visit counted -> store link tagged -> Remember it -> checkout -> Stripe metadata carries the partner", async () => {
    beacons = [];
    const r = await newContext();
    await arrive(r.page, "/" + TEST_PARTNER + "/film30");
    assert.equal(statuses["/" + TEST_PARTNER + "/film30"], 404, "the partner address is answered by 404.html, as on GitHub Pages");
    assert.equal(await r.page.evaluate(() => location.pathname), "/", "sent on to the home page");
    const p = await params(r.page);
    assert.equal(p.utm_source, TEST_PARTNER);
    assert.equal(p.utm_medium, "partner");
    assert.equal(p.utm_campaign, "partners");
    assert.equal(p.utm_content, "film30");
    assert.equal(await r.page.evaluate(() => history.length), 2, "replace, not push: Back leaves the site instead of bouncing");
    assert.ok(nothingStored(await storage(r.page)), "something was stored before any answer");
    // 2. the store link carries the partner's tags
    const links = await storeLinks(r.page);
    assert.ok(links.length >= 4);
    for (const h of links) {
      const s = new URL(h).searchParams;
      assert.equal(s.get("utm_source"), TEST_PARTNER, h);
      assert.equal(s.get("utm_medium"), "partner", h);
      assert.equal(s.get("utm_campaign"), "partners", h);
      assert.equal(s.get("utm_content"), "film30", h);
      assert.equal(s.get("track_endpoint"), null, h);
    }
    // 1. the visit is counted with the partner's tags
    assert.ok(await waitAsk(r.page), "the privacy question did not appear");
    await r.page.click('#ask [data-answer="yes"]');
    await wait(200);
    await flush(r.page);
    const pv = beacons.find((b) => (b.e || []).some((e) => e.n === "page_view"));
    assert.ok(pv, "no page_view reached the stand-in");
    assert.deepEqual(pv.u, { s: TEST_PARTNER, m: "partner", c: "partners", ct: "film30" });
    assert.equal(pv.page, "/");
    const yes = beacons.find((b) => (b.e || []).some((e) => e.n === "consent_yes"));
    assert.ok(yes && yes.b, "the yes was not sent with the code");
    assert.deepEqual(yes.f, { s: TEST_PARTNER, m: "partner", c: "partners", ct: "film30" });
    const kept = JSON.parse((await storage(r.page)).ls["illi.note"]);
    assert.deepEqual(kept.f, { s: TEST_PARTNER, m: "partner", c: "partners", ct: "film30" });
    // 3. later, the same browser pays
    const before = await storage(r.page);
    const body = await buyMonthly(r);
    assert.deepEqual(body, { tier: "standard", interval: "monthly", offer_version: "broad-2026-10-renewing", partner: TEST_PARTNER });
    assert.deepEqual(r.stripeNav, ["https://checkout.stripe.com/c/pay/test"]);
    assert.deepEqual((await storage(r.page)).ls, before.ls, "/upgrade wrote to the browser");
    assert.deepEqual(r.errors, []);
    const out = await realCheckout(body);
    assert.equal(out.status, 200);
    assert.equal(out.session.metadata.partner, TEST_PARTNER);
    assert.equal(out.session.metadata.partner_via, "remembered_browser");
    assert.equal(out.session.subscription_data.metadata.partner, TEST_PARTNER);
    await r.ctx.close();
  });

  /* ---------------- the store tag: links keep what the partner already put on them ---------------- */
  await check("Link with its own tags: utm_campaign / utm_id kept, utm_source and utm_medium always the partner's", async () => {
    const r = await newContext();
    await arrive(r.page, "/" + TEST_PARTNER, "&utm_campaign=educators-2026-11&utm_id=educator01-p1&utm_source=someoneelse&utm_medium=email");
    const p = await params(r.page);
    assert.deepEqual([p.utm_source, p.utm_medium, p.utm_campaign, p.utm_id, p.utm_content], [TEST_PARTNER, "partner", "educators-2026-11", "educator01-p1", undefined]);
    const s = new URL((await storeLinks(r.page))[0]).searchParams;
    assert.deepEqual([s.get("utm_source"), s.get("utm_campaign"), s.get("utm_id")], [TEST_PARTNER, "educators-2026-11", "educator01-p1"]);
    await r.ctx.close();
  });
  await check("Capitals and a trailing slash still work: /TestPartner/ goes to the same partner", async () => {
    const r = await newContext();
    await arrive(r.page, "/TestPartner/");
    assert.equal((await params(r.page)).utm_source, TEST_PARTNER);
    await r.ctx.close();
  });

  /* ---------------- not a partner: the plain not-found page ---------------- */
  for (const [p, why] of [["/nobody", "a name not on the list"], ["/" + TEST_PARTNER + "/a/b", "three parts"], ["/assets/nothing.js", "a missing file"]]) {
    await check("Not found (" + why + "): 404 page shown, no redirect, nothing stored", async () => {
      const r = await newContext();
      const res = await r.page.goto(base + p, { waitUntil: "load" });
      await wait(300);
      assert.equal(res.status(), 404);
      assert.equal(statuses[p], 404);
      assert.equal(await r.page.evaluate(() => location.pathname), p);
      assert.equal(await r.page.$eval("h1", (h) => h.textContent), "This page isn’t here.");
      assert.equal(await r.page.evaluate(() => getComputedStyle(document.body).visibility), "visible");
      assert.ok(nothingStored(await storage(r.page)));
      assert.deepEqual(r.errors, []);
      await r.ctx.close();
    });
  }
  await check("A bad label is dropped, the partner still counts: /testpartner/<script>", async () => {
    const r = await newContext();
    await arrive(r.page, "/" + TEST_PARTNER + "/%3Cscript%3E");
    const p = await params(r.page);
    assert.equal(p.utm_source, TEST_PARTNER);
    assert.equal(p.utm_content, undefined);
    await r.ctx.close();
  });

  /* ---------------- nothing carried without a yes ---------------- */
  await check("No answer: nothing stored, checkout carries no partner", async () => {
    const r = await newContext();
    await arrive(r.page, "/" + TEST_PARTNER);
    assert.ok(await waitAsk(r.page));
    await wait(300);
    assert.ok(nothingStored(await storage(r.page)));
    const body = await buyMonthly(r);
    assert.deepEqual(body, { tier: "standard", interval: "monthly", offer_version: "broad-2026-10-renewing" });
    assert.ok(nothingStored(await storage(r.page)));
    assert.equal("partner" in (await realCheckout(body)).session.metadata, false);
    await r.ctx.close();
  });
  await check("Don't remember it: only the no is stored, checkout carries no partner", async () => {
    const r = await newContext();
    await arrive(r.page, "/" + TEST_PARTNER);
    assert.ok(await waitAsk(r.page));
    await r.page.click('#ask [data-answer="no"]');
    await wait(200);
    assert.deepEqual(Object.keys((await storage(r.page)).ls), ["illi.answer"]);
    const body = await buyMonthly(r);
    assert.equal("partner" in body, false);
    await r.ctx.close();
  });
  await check("Global Privacy Control: link still opens the home page; no question, nothing counted, store link untagged, nothing stored", async () => {
    beacons = [];
    const r = await newContext({ gpc: true });
    await arrive(r.page, "/" + TEST_PARTNER);
    assert.equal((await params(r.page)).utm_source, TEST_PARTNER);
    assert.equal(await waitAsk(r.page), false);
    await flush(r.page);
    assert.equal(beacons.length, 0, "a beacon was sent under GPC");
    assert.equal(new URL((await storeLinks(r.page))[0]).searchParams.get("utm_source"), null, "the existing site sends no tags to the store under a privacy signal");
    assert.ok(nothingStored(await storage(r.page)));
    await r.ctx.close();
  });
  await check("Do Not Track: same as Global Privacy Control", async () => {
    beacons = [];
    const r = await newContext({ dnt: true });
    await arrive(r.page, "/" + TEST_PARTNER);
    assert.equal(await waitAsk(r.page), false);
    await flush(r.page);
    assert.equal(beacons.length, 0);
    assert.ok(nothingStored(await storage(r.page)));
    await r.ctx.close();
  });
  const SEEDED = [
    ["a yes, then Global Privacy Control turned on", { gpc: true, seed: { "illi.note": note(partnerTags) } }],
    ["a yes, then Do Not Track turned on", { dnt: true, seed: { "illi.note": note(partnerTags) } }],
    ["a yes, then Stop counting my visits", { seed: { "illi.note": note(partnerTags), "illi.nocount": JSON.stringify({ at: new Date().toISOString() }) } }],
    ["a yes older than 13 months", { seed: { "illi.note": note(partnerTags, new Date(Date.now() - 14 * 30 * 864e5).toISOString()) } }],
    ["a yes on a visit that was not a partner link", { seed: { "illi.note": note({ s: TEST_PARTNER, m: "email" }) } }],
    ["a yes from a partner since removed from the list", { seed: { "illi.note": note({ s: "gonepartner", m: "partner" }) } }],
    ["a yes with no campaign tags at all", { seed: { "illi.note": note({}) } }],
    ["a damaged note", { seed: { "illi.note": "{not json" } }],
  ];
  for (const [why, opt] of SEEDED) {
    await check("No partner at checkout after " + why, async () => {
      const r = await newContext(opt);
      const before = await (async () => { await r.page.goto(base + "/upgrade/", { waitUntil: "load" }); return storage(r.page); })();
      const body = await buyMonthly(r);
      assert.ok(body, "no checkout request");
      assert.equal("partner" in body, false, JSON.stringify(body));
      assert.deepEqual((await storage(r.page)).ls, before.ls, "/upgrade changed the browser's storage");
      assert.deepEqual(r.errors, []);
      await r.ctx.close();
    });
  }
  await check("Control: the same seeded yes with no signal does carry the partner (so the cases above test the rule, not the seed)", async () => {
    const r = await newContext({ seed: { "illi.note": note(partnerTags) } });
    const body = await buyMonthly(r);
    assert.equal(body.partner, TEST_PARTNER);
    await r.ctx.close();
  });
  await check("Phone: the link opens the home page with the tags; no question, nothing stored", async () => {
    const r = await newContext({ phone: true });
    await arrive(r.page, "/" + TEST_PARTNER);
    assert.equal((await params(r.page)).utm_source, TEST_PARTNER);
    assert.equal(await waitAsk(r.page), false);
    assert.ok(nothingStored(await storage(r.page)));
    assert.equal(await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await r.ctx.close();
  });

  await check("Safety: no request reached production or left this machine", async () => {
    assert.deepEqual(prodHits, []);
    assert.deepEqual(outside.filter((u) => !/^https:\/\/(chromewebstore\.google\.com|checkout\.stripe\.com)\//.test(u)), []);
  });

  console.log("\n" + results.filter((r) => r.pass).length + " passed, " + failures.length + " failed");
  if (failures.length) process.exitCode = 1;
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); if (server) server.close(); });
