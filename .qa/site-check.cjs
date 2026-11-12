// Browser checks for the pricing page (/upgrade/), adapted from the October 29 working page's .qa/site-check.cjs.
// Runs the REAL page (upgrade/index.html, assets/offer.js, assets/upgrade.js) from a local static server in headless Chrome.
// SAFETY: checkout is live Stripe. Every request that leaves 127.0.0.1 is intercepted: stripe-checkout, checkout-redirect,
// stripe-portal, founding-renewal, upgrade-redeem, send-to-desktop and Supabase sign-in are answered by fixtures and recorded,
// Stripe and every other host are aborted. The only request ever allowed out is a GET of the public pricing-info endpoint, and only
// in the one check marked "live". The supabase-js module is replaced by a fixture, so no real sign-in can happen.
// Pricing fixtures come from the actual pricing-info handler (backend-contract.cjs); renewal fixtures from the actual
// founding-renewal handler (renewal-contract.cjs), both read from C:/worktrees/illi-cws-1.0.1-store with service doubles.
// Usage: node .qa/site-check.cjs   (captures go to the design folder as build-*.png)
const puppeteer = require("C:/worktrees/illi-xbrowser-harness/node_modules/puppeteer-core");
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const sourceFixture = require("./backend-contract.cjs");
const renewalFixture = require("./renewal-contract.cjs");

const root = path.resolve(__dirname, "..");
const CAPS =
  "C:/Users/35263/OneDrive/Documents/Vibe Coding/Malka's Software Dev/Dev Workflow/CompNy workflow/Projects/Illi/design/upgrade-page-2026-11-11/captures";
const PORT = 18786;
const base = "http://127.0.0.1:" + PORT;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FORBIDDEN = ["stripe-checkout", "checkout-redirect", "stripe-portal", "/auth/v1/", "founding-renewal", "upgrade-redeem", "send-to-desktop"];
const results = [];
const leaked = []; // any non-local request that was allowed to continue (only pricing-info GET in the live check may be here)
let browser, server, offer, closedOffer, managementOffer, canceledOffer;

const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".mp4": "video/mp4" };
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

// the human-check frame: a same-origin stand-in that speaks the /turnstile message contract (parent.QA_TS picks the behaviour)
const TURNSTILE_FIXTURE = `<!doctype html><html><body style="margin:0;font:13px sans-serif"><script>
const P = parent;
function send(type, extra) { P.postMessage(Object.assign({ source: "illi-turnstile", v: 1, type }, extra || {}), location.origin); }
let attempt = 0;
function run() {
  attempt++;
  const m = P.QA_TS || "pass";
  send("ready");
  if (m === "pass") { send("rendered", { width: 0, height: 0 }); setTimeout(() => send("token", { token: "QA-TOKEN-" + attempt }), 30); }
  else if (m === "click") { document.body.innerHTML = '<div style="box-sizing:border-box;width:300px;height:65px;border:1px solid #d0d0d0;border-radius:4px;background:#fafafa;display:flex;align-items:center;padding:0 14px;gap:10px"><span style="width:24px;height:24px;border:2px solid #555;border-radius:3px"></span>Test stand-in for the Cloudflare box</div>'; send("rendered", { width: 0, height: 65 }); }
  else if (m === "error") { send("rendered", { width: 0, height: 0 }); setTimeout(() => send("error"), 30); }
}
addEventListener("message", (e) => { if (e.data && e.data.source === "illi-auth" && (e.data.type === "init" || e.data.type === "reset")) run(); });
</script></body></html>`;

// the supabase-js stand-in: a session exists when window.QA_SIGNED; the profile is window.QA_PROFILE
const SUPABASE_FIXTURE = `export const createClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: window.QA_SIGNED ? { access_token: "TEST", user: { id: "fixture-user" } } : null } }),
    verifyOtp: async (args) => { (window.QA_CALLS = window.QA_CALLS || []).push({ verifyOtp: args }); if (args.token === "000000") return { error: { message: "bad" } }; window.QA_SIGNED = true; return { data: { session: { access_token: "TEST", user: { id: "fixture-user" } } } }; },
    signInWithOtp: async (args) => { (window.QA_CALLS = window.QA_CALLS || []).push({ signInWithOtp: args }); return {}; },
  },
  from: (table) => ({ select: (cols) => { (window.QA_CALLS = window.QA_CALLS || []).push({ select: cols }); return { eq: () => ({ single: async () => ({ data: window.QA_PROFILE, error: null }) }) }; } }),
});`;

const PROFILES = {
  trial: { tier: "trial", trial_ends_at: "2026-12-20T15:00:00Z", founding_paid_until: null, founding_years_purchased: 0, founding_billing_review: false, deletion_scheduled_at: null },
  ended: { tier: "expired", trial_ends_at: "2026-11-01T15:00:00Z", founding_paid_until: null, founding_years_purchased: 0, founding_billing_review: false, deletion_scheduled_at: null },
  paid: { tier: "paid", trial_ends_at: "2026-10-01T15:00:00Z", founding_paid_until: null, founding_years_purchased: 0, founding_billing_review: false, deletion_scheduled_at: null },
  founder: { tier: "trial", trial_ends_at: "2026-12-20T15:00:00Z", founding_paid_until: "2027-12-01T12:00:00Z", founding_years_purchased: 1, founding_billing_review: false, deletion_scheduled_at: null },
};

async function makePage(o = {}) {
  const opt = Object.assign(
    { data: offer, signed: false, profile: PROFILES.trial, width: 1440, height: 900, phone: false, ts: "pass", live: false,
      checkoutStatus: 200, checkoutData: { url: "https://checkout.stripe.com/c/pay/test" }, holdCheckout: false,
      portalStatus: 200, portalData: { url: "https://billing.stripe.com/p/session/test" },
      renewalData: managementOffer, renewalStatus: 200, cancelData: null, cancelStatus: 200, holdPayment: false,
      paymentUrl: "https://billing.stripe.com/p/session/test", redeemStatus: 200, sendData: { ok: true } },
    o,
  );
  const page = await browser.newPage();
  const rec = { checkout: [], portal: [], management: [], redeem: [], send: [], stripeNav: [], aborted: [], errors: [], held: [] };
  if (opt.phone) await page.setUserAgent(IPHONE_UA);
  await page.setViewport({ width: opt.width, height: opt.height, deviceScaleFactor: 1, isMobile: !!opt.phone, hasTouch: !!opt.phone });
  await page.evaluateOnNewDocument((s, p, ts) => { window.QA_SIGNED = s; window.QA_PROFILE = p; window.QA_TS = ts; }, opt.signed, opt.profile, opt.ts);
  page.on("pageerror", (e) => rec.errors.push(e.message));
  await page.setRequestInterception(true);
  const json = (req, status, body) => req.respond({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(body) });
  page.on("request", (req) => {
    const url = req.url();
    if (req.method() === "OPTIONS" && url.includes("/functions/v1/"))
      return req.respond({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
    if (url.includes("/functions/v1/pricing-info")) {
      if (opt.live && req.method() === "GET") { leaked.push(url); return req.continue(); }
      return json(req, 200, opt.data);
    }
    if (url.includes("/functions/v1/stripe-checkout")) {
      rec.checkout.push({ body: JSON.parse(req.postData() || "{}"), auth: req.headers()["authorization"] });
      if (opt.holdCheckout) return rec.held.push(req);
      return json(req, opt.checkoutStatus, opt.checkoutData);
    }
    if (url.includes("/functions/v1/stripe-portal")) {
      rec.portal.push({ auth: req.headers()["authorization"] });
      return json(req, opt.portalStatus, opt.portalData);
    }
    if (url.includes("/functions/v1/founding-renewal")) {
      const payload = JSON.parse(req.postData() || "{}");
      rec.management.push(payload);
      if (payload.action === "payment_method") {
        if (opt.holdPayment) return rec.held.push(req);
        return json(req, 200, { url: opt.paymentUrl });
      }
      if (payload.action === "cancel") return json(req, opt.cancelStatus, opt.cancelData || canceledOffer);
      return json(req, opt.renewalStatus, opt.renewalData);
    }
    if (url.includes("/functions/v1/upgrade-redeem")) {
      rec.redeem.push(JSON.parse(req.postData() || "{}"));
      return json(req, opt.redeemStatus, opt.redeemStatus === 200 ? { ok: true, auth: { token_hash: "FIXTURE", type: "magiclink" } } : { error: "bad_token" });
    }
    if (url.includes("/functions/v1/send-to-desktop")) {
      rec.send.push(JSON.parse(req.postData() || "{}"));
      return json(req, 200, opt.sendData);
    }
    if (url.includes("/assets/vendor/supabase-js-2.103.0.esm.js")) return req.respond({ status: 200, contentType: "application/javascript", body: SUPABASE_FIXTURE });
    if (url.startsWith(base + "/turnstile/")) return req.respond({ status: 200, contentType: "text/html", body: TURNSTILE_FIXTURE });
    if (url.startsWith(base + "/")) return req.continue();
    if (/^https:\/\/(checkout|billing)\.stripe\.com\//.test(url)) rec.stripeNav.push(url);
    if (FORBIDDEN.some((f) => url.includes(f))) throw new Error("unhandled forbidden request " + url);
    rec.aborted.push(url);
    return req.abort();
  });
  return Object.assign({ page }, rec);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(page) {
  await page.waitForFunction(() => window.illiOffer && document.fonts.status === "loaded", { timeout: 10000 });
  await page.evaluate(() => window.illiOffer.ready);
  await wait(250);
}
async function visit(o = {}, route = "/upgrade/") {
  const r = await makePage(o);
  await r.page.goto(base + route, { waitUntil: "load" });
  await settle(r.page);
  return r;
}
function record(name, detail) {
  results.push({ name, pass: true, detail });
  console.log("PASS " + name);
}
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    record(name);
  } catch (e) {
    failures.push({ name, error: String(e && e.message ? e.message : e).slice(0, 400) });
    results.push({ name, pass: false, error: String(e && e.message ? e.message : e).slice(0, 400) });
    console.log("FAIL " + name + "\n     " + String(e && e.message ? e.message : e).slice(0, 400));
  }
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const visible = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== "hidden");
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
async function copyRules(page) {
  const t = await bodyText(page);
  assert.doesNotMatch(t, /\u2014/, "em dash in visible copy");
  assert.doesNotMatch(t, /\bIlli\b|\bILLI\b/, "capitalised illi");
  assert.doesNotMatch(t, /full illi/i, '"full illi"');
  assert.doesNotMatch(t, /trial_active_wait|subscribe when it ends|Still trying illi|Install illi/i);
  // "Premium" as the plan's name is always "illi Premium" (the word after "illi" or in "illi Premium" only)
  const bare = t.match(/(^|[^i]\s|[^\s])Premium/gm) || [];
  const offenders = t.split(/\n/).filter((l) => /(?<!illi )Premium/.test(l));
  assert.deepEqual(offenders, [], "bare Premium in: " + offenders.join(" | "));
  void bare;
}
async function shot(page, name, mode) {
  const w = page.viewport().width;
  await page.mouse.move(2, 2); // no hover left over from a click
  await wait(450); // let the dialog's rise animation (260 ms) finish
  if (mode === "full") {
    const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    const vp = page.viewport();
    await page.setViewport(Object.assign({}, vp, { height: Math.max(vp.height, h) }));
    await wait(200);
    await page.screenshot({ path: path.join(CAPS, "build-" + name + "-" + w + ".png"), fullPage: false });
    await page.setViewport(vp);
  } else {
    await page.screenshot({ path: path.join(CAPS, "build-" + name + "-" + w + ".png") });
  }
}
const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844, phone: true },
];

(async () => {
  offer = await sourceFixture("active");
  closedOffer = await sourceFixture("not_started");
  managementOffer = await renewalFixture();
  canceledOffer = await renewalFixture("scheduled", "cancel");
  assert.equal(offer.offer_version, "broad-2026-10-renewing", "Tests must consume the revised backend implementation");
  await serve();
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-first-run", "--disable-background-networking", "--hide-scrollbars", "--host-resolver-rules=MAP chromewebstore.google.com ~NOTFOUND, MAP *.stripe.com ~NOTFOUND, MAP checkout.stripe.com ~NOTFOUND, MAP billing.stripe.com ~NOTFOUND"] });

  /* ---------------- every page state, both sizes: layout, copy rules, captures ---------------- */
  const STATES = [
    ["01-visitor", { data: closedOffer }, "/upgrade/", "Try illi free for 45 days.", true],
    ["03-banner-visitor", { data: offer }, "/upgrade/", "Try illi free for 45 days.", true],
    ["04-banner-trial", { data: offer, signed: true }, "/upgrade/", "Keep illi Premium for 27\u00a0cents a day.", true],
    ["05-trial", { data: closedOffer, signed: true }, "/upgrade/", "Keep illi Premium for 27\u00a0cents a day.", true],
    ["06-trial-ended", { data: closedOffer, signed: true, profile: PROFILES.ended }, "/upgrade/", "Get illi Premium back for 27\u00a0cents a day.", true],
    ["07-premium", { data: closedOffer, signed: true, profile: PROFILES.paid }, "/upgrade/", "You have illi Premium.", true],
    ["08-founding-buyer", { data: offer, signed: true, profile: PROFILES.founder }, "/upgrade/", "You have illi Premium.", true],
    ["09-left-checkout", { data: closedOffer, signed: true }, "/upgrade/?status=cancelled", "Keep illi Premium for 27\u00a0cents a day.", false],
    ["13-founding-step", { data: offer, signed: true }, "/upgrade/?offer=founding", "Choose your founding term.", false],
    ["15-founding-step-visitor", { data: offer }, "/upgrade/?offer=founding", "Choose your founding term.", false],
    ["30-manage-signed-out", { data: closedOffer }, "/upgrade/?manage=founding", "Your founding plan.", false],
    ["31-manage-scheduled", { data: closedOffer, signed: true, profile: PROFILES.founder }, "/upgrade/?manage=founding", "Your founding plan.", false],
    ["32-manage-cancel-requested", { data: closedOffer, signed: true, profile: PROFILES.founder, renewal: "cancel_requested" }, "/upgrade/?manage=founding", "Your founding plan.", false],
    ["33-manage-canceled", { data: closedOffer, signed: true, profile: PROFILES.founder, renewal: "canceled" }, "/upgrade/?manage=founding", "Your founding plan.", false],
    ["35-manage-needs-check", { data: closedOffer, signed: true, profile: PROFILES.founder, renewal: "review" }, "/upgrade/?manage=founding", "Your founding plan.", false],
  ];
  for (const size of SIZES) {
    for (const [name, o, route, heading, firstScreen] of STATES) {
      await check("State " + name + " " + size.width + "px: heading, no sideways scroll, no errors, copy rules", async () => {
        const opts = Object.assign({}, o, size);
        if (o.renewal) opts.renewalData = await renewalFixture(o.renewal);
        const r = await visit(opts, route);
        assert.equal(await text(r.page, "#page-title"), heading.replace(/\u00a0/g, " "));
        assert.equal(await noOverflow(r.page), true, "sideways overflow");
        assert.deepEqual(r.errors, []);
        await copyRules(r.page);
        const mode = /^(09)/.test(name) ? "view" : "full";
        await shot(r.page, name, mode);
        if (firstScreen) await shot(r.page, name + "-first-screen", "view");
        await r.page.close();
      });
    }
  }
  // the laptop case (1280): three cards keep one-line names and buttons
  for (const [name, o] of [["01-visitor", { data: closedOffer }], ["05-trial", { data: closedOffer, signed: true }]]) {
    await check("Laptop 1280px " + name + ": three cards in a row, names and buttons on one line", async () => {
      const r = await visit(Object.assign({ width: 1280, height: 800 }, o));
      assert.equal(await noOverflow(r.page), true);
      const rows = await r.page.$$eval("#plans > .plan", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      assert.equal(new Set(rows).size, 1, "cards not in one row");
      const lines = await r.page.$$eval("#plans .plan h2, #plans .txt .do, #plans [data-buy]", (els) => els.map((e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set(Array.from(g.getClientRects()).map((x) => Math.round(x.top))).size; }));
      assert.ok(lines.every((n) => n === 1), "a name or button wraps: " + lines);
      assert.ok(await r.page.$$eval("#plans [data-buy]", (els) => els.every((b) => b.scrollWidth <= b.clientWidth)), "button text clipped");
      await shot(r.page, name, "full");
      await r.page.close();
    });
  }

  /* ---------------- visitor ---------------- */
  await check("Visitor: one red action (install), both plan buttons outlined, no account status", async () => {
    const r = await visit({ data: closedOffer });
    const reds = await r.page.$$eval(".hero .button:not(.secondary), #plans .button:not(.secondary)", (els) => els.filter((e) => e.offsetWidth).map((e) => e.textContent.trim()));
    assert.deepEqual(reds, ["Try illi free"]);
    assert.equal(await r.page.$eval("#heroInstall", (a) => a.href), "https://chromewebstore.google.com/detail/hocdlcekmbokkepblkopcefmenhnincg");
    assert.equal(await visible(r.page, "#accountBlock"), false);
    assert.equal(await visible(r.page, "#plansPath"), true);
    assert.equal(await visible(r.page, "#foundingBanner"), false, "banner shown while closed");
    assert.doesNotMatch(await bodyText(r.page), /[Ff]ounding/, "founding mentioned while closed");
    await r.page.close();
  });
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 390, height: 844, phone: true }]) {
    await check("Visitor " + size.width + "px: Free card has 'Get illi free' (outlined, named for page events) lined up with the paid buttons", async () => {
      for (const data of [closedOffer, offer]) {
        const r = await visit(Object.assign({ data }, size));
        assert.equal(await visible(r.page, "#freeInstall"), true);
        assert.equal(await text(r.page, "#freeInstall"), "Get illi free");
        assert.equal(await r.page.$eval("#freeInstall", (a) => a.classList.contains("secondary") && a.dataset.cta), "free_card");
        assert.equal(await visible(r.page, "#stayLine"), false);
        assert.equal(await text(r.page, "#freeNote"), "Do nothing and you move to Free.");
        const reds = await r.page.$$eval(".button", (els) => els.filter((e) => e.offsetWidth && !e.closest("#foundingBanner") && getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)").map((e) => e.textContent.trim()));
        assert.deepEqual(reds, size.phone ? ["Try illi free", "Send it to my computer"] : ["Try illi free", "Try illi free"], "red buttons: " + reds);
        if (!size.phone) {
          const tops = await r.page.$$eval("#freeInstall, #plans [data-buy]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
          if (size.width >= 1280) assert.equal(new Set(tops).size, 1, "buttons do not line up: " + tops);
          // desktop: the same store link as the main button (the store host does not resolve in tests)
          assert.equal(await r.page.$eval("#freeInstall", (a) => a.href + "|" + a.target), await r.page.$eval("#heroInstall", (a) => a.href + "|" + a.target));
          const opened = new Promise((res) => browser.once("targetcreated", (t) => res(t)));
          await r.page.click("#freeInstall");
          const t = await opened;
          assert.equal(t.url(), "https://chromewebstore.google.com/detail/hocdlcekmbokkepblkopcefmenhnincg");
          const p2 = await t.page();
          if (p2) await p2.close();
        } else {
          await r.page.click("#freeInstall");
          await r.page.waitForSelector("#sendForm:not([hidden])");
          assert.equal(r.page.url(), base + "/upgrade/");
          assert.equal(await r.page.evaluate(() => document.activeElement.id), "sendEmail");
        }
        assert.ok(!r.aborted.some((u) => u.includes("chromewebstore")) && r.stripeNav.length === 0);
        await r.page.close();
      }
    });
  }
  await check("Signed in: no 'Get illi free'; trial keeps the tick row and 'Nothing to cancel.', ended keeps 'Your plan now'", async () => {
    for (const [profile, line] of [[PROFILES.trial, "Do nothing and you move to Free."], [PROFILES.ended, "You are on Free. Nothing to do."]]) {
      for (const size of SIZES) {
        const r = await visit(Object.assign({ data: closedOffer, signed: true, profile }, size));
        assert.equal(await visible(r.page, "#freeInstall"), false);
        assert.equal(await visible(r.page, "#stayLine"), true);
        assert.equal(await text(r.page, "#stayLine"), line);
        assert.equal(await text(r.page, "#freeNote"), "Nothing to cancel.");
        await r.page.close();
      }
    }
  });
  await check("Visitor: plan button opens sign-in, never checkout", async () => {
    const r = await visit({ data: closedOffer });
    await r.page.click('[data-buy="standard"][data-interval="annual"]');
    await r.page.waitForSelector("#signupModal:not([hidden])");
    assert.equal(r.checkout.length, 0);
    await r.page.keyboard.press("Escape");
    assert.equal(await r.page.$eval("#signupModal", (e) => e.hidden), true);
    await r.page.close();
  });
  await check("Phone visitor: install buttons open the send form in place; send posts email and honeypot to send-to-desktop (stubbed)", async () => {
    const r = await visit({ data: closedOffer, width: 390, height: 844, phone: true });
    assert.equal(await text(r.page, "#heroInstall"), "Send it to my computer");
    await r.page.click("#heroInstall");
    await r.page.waitForSelector("#sendForm:not([hidden])");
    assert.equal(await visible(r.page, "#heroInstall"), false);
    assert.equal(await r.page.evaluate(() => document.activeElement.id), "sendEmail");
    await r.page.type("#sendEmail", "sam@example.com");
    await r.page.evaluate(() => window.scrollTo(0, 0));
    await shot(r.page, "02-visitor-phone-send", "view");
    await r.page.click('#sendForm button[type="submit"]');
    await wait(200);
    assert.deepEqual(r.send, [{ email: "sam@example.com", website: "" }]);
    assert.match(await text(r.page, "#sendStatus"), /^Sent\./);
    assert.equal(await noOverflow(r.page), true);
    // the header pill also opens the form, never the store
    const r2 = await visit({ data: closedOffer, width: 390, height: 844, phone: true });
    await r2.page.click(".site-head [data-install]");
    await r2.page.waitForSelector("#sendForm:not([hidden])");
    assert.equal(r2.page.url(), base + "/upgrade/");
    await r.page.close();
    await r2.page.close();
  });

  /* ---------------- signed in: trial, ended ---------------- */
  for (const interval of ["monthly", "annual"]) {
    await check("Trial: " + interval + " button sends the standard checkout contract with the session", async () => {
      const r = await visit({ data: closedOffer, signed: true });
      await r.page.click('[data-buy="standard"][data-interval="' + interval + '"]');
      await wait(400);
      assert.deepEqual(r.checkout.map((c) => c.body), [{ tier: "standard", interval, offer_version: "broad-2026-10-renewing" }]);
      assert.equal(r.checkout[0].auth, "Bearer TEST");
      assert.deepEqual(r.stripeNav, ["https://checkout.stripe.com/c/pay/test"]);
      await r.page.close();
    });
  }
  await check("Trial: status beside the claim from trial_ends_at; annual is the one red button; profile select reads trial_ends_at", async () => {
    const r = await visit({ data: closedOffer, signed: true });
    assert.equal(await text(r.page, "#customerStatus strong"), "Your free trial runs until December 20, 2026.");
    assert.equal(await text(r.page, "#customerStatus span"), "You won’t be charged until your free trial ends.");
    const reds = await r.page.$$eval("#plans .button:not(.secondary)", (els) => els.map((e) => e.dataset.interval));
    assert.deepEqual(reds, ["annual"]);
    assert.equal(await visible(r.page, ".visitor-act"), false, "install prompt shown to a signed-in person");
    assert.equal(await visible(r.page, "#signedInState"), true);
    assert.equal(await visible(r.page, "#signInButton"), false);
    assert.ok((await r.page.evaluate(() => window.QA_CALLS)).some((c) => c.select && c.select.includes("trial_ends_at")));
    await r.page.close();
  });
  await check("Choose illi Premium is always available: last day of the trial still opens checkout", async () => {
    const lastDay = Object.assign({}, PROFILES.trial, { trial_ends_at: new Date(Date.now() + 20 * 3600e3).toISOString() });
    const r = await visit({ data: closedOffer, signed: true, profile: lastDay });
    assert.equal(await r.page.$eval('[data-interval="annual"]', (b) => b.disabled), false);
    await r.page.click('[data-buy="standard"][data-interval="annual"]');
    await wait(400);
    assert.equal(r.checkout.length, 1);
    assert.equal(r.stripeNav.length, 1);
    await r.page.close();
  });
  await check("Removed: a 409 trial_active_wait (old server) shows no 'wait until it ends' message", async () => {
    const r = await visit({ data: closedOffer, signed: true, checkoutStatus: 409, checkoutData: { error: "trial_active_wait", trial_ends_at: new Date(Date.now() + 86400e3).toISOString() } });
    await r.page.click('[data-buy="standard"][data-interval="annual"]');
    await wait(400);
    const t = await text(r.page, "#checkoutStub");
    assert.doesNotMatch(t, /subscribe when it ends|charge you early/);
    assert.match(t, /Refresh this page/);
    await r.page.close();
  });
  await check("Trial ended: Free card says 'Your plan now' and 'You are on Free. Nothing to do.'", async () => {
    const r = await visit({ data: closedOffer, signed: true, profile: PROFILES.ended });
    assert.equal(await visible(r.page, "#hereFree"), true);
    assert.equal(await text(r.page, "#stayLine"), "You are on Free. Nothing to do.");
    assert.equal(await text(r.page, "#customerStatus strong"), "Your free trial has ended.");
    assert.equal(await text(r.page, "#customerStatus span"), "Basic speed control stays free. illi Premium brings the rest back.");
    await r.page.close();
  });
  for (const size of SIZES) await check("Checkout busy state " + size.width + "px: pressed button pulses, others are not greyed, the bottom note says so", async () => {
    const r = await visit(Object.assign({ data: closedOffer, signed: true, holdCheckout: true }, size));
    await r.page.click('[data-buy="standard"][data-interval="annual"]');
    await r.page.waitForFunction(() => document.getElementById("checkoutStub").textContent.includes("Opening secure checkout"));
    assert.equal(await r.page.$eval('[data-interval="annual"]', (b) => b.getAttribute("aria-busy")), "true");
    assert.equal(await r.page.$eval('[data-interval="monthly"]', (b) => b.disabled), false);
    await r.page.click('[data-buy="standard"][data-interval="monthly"]'); // a second press while busy does nothing
    await wait(150);
    assert.equal(r.checkout.length, 1);
    await shot(r.page, "11-checkout-opening", "view");
    r.held.forEach((q) => q.respond({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }));
    await wait(300);
    assert.match(await text(r.page, "#checkoutStub"), /couldn’t open checkout/);
    assert.equal(await r.page.$eval("#checkoutStub", (e) => e.dataset.kind), "error");
    await shot(r.page, "12-checkout-error", "view");
    await r.page.close();
  });
  for (const [error, expected] of [
    ["checkout_plan_changed", /earlier checkout has been canceled/],
    ["payment_processing", /payment is being confirmed/],
    ["checkout_in_progress", /still being prepared/],
    ["checkout_requires_review", /check your earlier checkout/],
    ["existing_access", /Refresh this page/],
  ]) {
    await check("Checkout state " + error, async () => {
      const r = await visit({ data: closedOffer, signed: true, checkoutStatus: 409, checkoutData: { error } });
      await r.page.click('[data-buy="standard"][data-interval="monthly"]');
      await wait(300);
      assert.match(await text(r.page, "#checkoutStub"), expected);
      assert.equal(r.checkout.length, 1);
      await r.page.close();
    });
  }
  for (const [url, flag, allowed] of [
    ["https://example.com/not-stripe", false, false],
    ["https://billing.stripe.com/p/session/test", false, false],
    ["https://billing.stripe.com/p/session/test", true, true],
    ["http://checkout.stripe.com/c/pay/test", false, false],
  ]) {
    await check("Checkout redirect protection " + url + " / portal flag " + flag, async () => {
      const r = await visit({ data: closedOffer, signed: true, checkoutData: { url, redirected_to_portal: flag } });
      await r.page.click('[data-buy="standard"][data-interval="monthly"]');
      await wait(300);
      assert.equal(r.stripeNav.length > 0 || r.aborted.includes(url), allowed);
      if (!allowed) assert.match(r.page.url(), /127\.0\.0\.1/);
      await r.page.close();
    });
  }
  await check("Previous non-renewing pricing contract cannot start checkout", async () => {
    const data = structuredClone(closedOffer);
    data.offer_version = "broad-2026-10";
    const r = await visit({ data, signed: true });
    await r.page.click('[data-buy="standard"][data-interval="annual"]');
    await wait(200);
    assert.equal(r.checkout.length, 0);
    assert.match(await text(r.page, "#checkoutStub"), /temporarily unavailable/);
    await r.page.close();
  });

  /* ---------------- people who pay ---------------- */
  await check("illi Premium customer: no plan cards, no founding, one billing button to stripe-portal (stubbed), Stripe-only redirect", async () => {
    const r = await visit({ data: offer, signed: true, profile: PROFILES.paid });
    assert.equal(await visible(r.page, "#plans"), false);
    assert.equal(await visible(r.page, "#foundingBanner"), false);
    assert.equal(await visible(r.page, "#includes"), true);
    assert.equal(await text(r.page, "#pageIntro"), "Change your plan, update your card or cancel, all from your billing page.");
    await r.page.click("#manageBilling");
    await wait(300);
    assert.deepEqual(r.portal, [{ auth: "Bearer TEST" }]);
    assert.deepEqual(r.stripeNav, ["https://billing.stripe.com/p/session/test"]);
    assert.equal(r.checkout.length, 0);
    const bad = await visit({ data: closedOffer, signed: true, profile: PROFILES.paid, portalData: { url: "https://example.com/x" } });
    await bad.page.click("#manageBilling");
    await wait(300);
    assert.match(bad.page.url(), /127\.0\.0\.1/);
    assert.match(await text(bad.page, "#checkoutStub"), /billing page/);
    await r.page.close();
    await bad.page.close();
  });
  await check("Founding buyer: header with the paid-through date, founding plan panel, no banner or founding form, no plan cards", async () => {
    const r = await visit({ data: offer, signed: true, profile: PROFILES.founder });
    assert.equal(await text(r.page, "#pageIntro"), "Your founding plan is paid through December 1, 2027.");
    assert.equal(await visible(r.page, "#foundingManagement"), true);
    assert.equal(await r.page.$eval("#foundingBanner", (e) => e.hidden), true);
    assert.equal(await r.page.$eval("#foundingChoice", (e) => e.hidden), true);
    assert.equal(await visible(r.page, "#plans"), false);
    await r.page.close();
  });
  for (const profile of [PROFILES.founder, Object.assign({}, PROFILES.founder, { founding_paid_until: "2020-01-01T00:00:00Z" }), Object.assign({}, PROFILES.founder, { founding_years_purchased: 2 })]) {
    await check("Existing founding purchase never offers another: " + profile.founding_years_purchased + " / " + profile.founding_paid_until, async () => {
      const r = await visit({ data: offer, signed: true, profile });
      assert.equal(await r.page.$eval("#foundingChoice", (e) => e.hidden), true);
      assert.equal(await r.page.$eval("#foundingBanner", (e) => e.hidden), true);
      await r.page.close();
    });
  }

  /* ---------------- founding banner and step: every campaign state ---------------- */
  for (const state of ["not_started", "scheduled", "active", "closing", "ended", "sold_out"]) {
    await check("Actual pricing source -> page, campaign " + state + ": banner and ?offer=founding follow the service", async () => {
      const data = await sourceFixture(state);
      const r = await visit({ data });
      assert.equal(await r.page.$eval("#foundingBanner", (e) => e.hidden), state !== "active");
      const s = await visit({ data, signed: true }, "/upgrade/?offer=founding");
      const view = await s.page.evaluate(() => document.body.dataset.view || null);
      assert.equal(view, state === "active" ? "founding" : null);
      if (state !== "active") {
        assert.equal(await visible(s.page, "#plans"), true, "closed founding step must fall back to the plans");
        assert.doesNotMatch(await bodyText(s.page), /[Ff]ounding/);
      } else {
        assert.match(await text(s.page, "#foundingIntro"), /of 1,000 places currently available/);
        assert.equal(await visible(s.page, "#pageIntro"), false);
      }
      await r.page.close();
      await s.page.close();
    });
  }
  await check("Banner: 'Choose your term' leads to the founding step; close hides it for the visit", async () => {
    const r = await visit({ data: offer, signed: true });
    assert.equal(await r.page.$eval("#bannerGo", (a) => a.getAttribute("href")), "/upgrade/?offer=founding");
    await r.page.click("#bannerClose");
    assert.equal(await r.page.$eval("#foundingBanner", (e) => e.hidden), true);
    await r.page.evaluate(() => window.illiOffer.refresh());
    await wait(100);
    assert.equal(await r.page.$eval("#foundingBanner", (e) => e.hidden), true, "banner came back after a refresh");
    await r.page.close();
  });
  for (const years of [1, 2]) {
    await check("Founding step: explicit " + years + "-year choice and consent send the founding contract", async () => {
      const r = await visit({ data: offer, signed: true }, "/upgrade/?offer=founding");
      await r.page.click('[name="foundingYears"][value="' + years + '"]');
      assert.equal(await r.page.$eval('[data-buy="founding"]', (e) => e.disabled), true);
      await r.page.click("#renewalConsent");
      assert.equal(await text(r.page, '[data-buy="founding"]'), "Review US$" + (years === 1 ? 40 : 80) + " plus applicable tax and renewal");
      if (years === 1) await shot(r.page, "14-founding-step-chosen", "full");
      await r.page.click('[data-buy="founding"]');
      await wait(400);
      assert.deepEqual(r.checkout.map((c) => c.body), [{ tier: "founding", interval: "annual", offer_version: "broad-2026-10-renewing", founding_years: years, renewal_consent: true }]);
      await r.page.close();
    });
  }
  await check("Founding step: nothing preselected; removing consent or changing the term disables the button", async () => {
    const r = await visit({ data: offer, signed: true }, "/upgrade/?offer=founding");
    assert.equal(await r.page.$$eval('[name="foundingYears"]:checked', (e) => e.length), 0);
    assert.equal(await r.page.$eval("#renewalConsent", (e) => e.checked), false);
    await r.page.click('[name="foundingYears"][value="1"]');
    await r.page.click("#renewalConsent");
    await r.page.click('[name="foundingYears"][value="2"]');
    assert.equal(await r.page.$eval("#renewalConsent", (e) => e.checked), false);
    assert.equal(await r.page.$eval('[data-buy="founding"]', (e) => e.disabled), true);
    await r.page.click("#renewalConsent");
    await r.page.click("#renewalConsent");
    assert.equal(await r.page.$eval('[data-buy="founding"]', (e) => e.disabled), true);
    await r.page.close();
  });
  await check("Founding step 390px: chosen and agreed (capture)", async () => {
    const r = await visit({ data: offer, signed: true, width: 390, height: 844, phone: true }, "/upgrade/?offer=founding");
    await r.page.click('[name="foundingYears"][value="1"]');
    await r.page.click("#renewalConsent");
    assert.equal(await r.page.$eval('[data-buy="founding"]', (e) => e.disabled), false);
    assert.equal(await noOverflow(r.page), true);
    await shot(r.page, "14-founding-step-chosen", "full");
    await r.page.close();
  });
  await check("Founding step, visitor: buying asks to sign in, no checkout", async () => {
    const r = await visit({ data: offer }, "/upgrade/?offer=founding");
    await r.page.click('[name="foundingYears"][value="1"]');
    await r.page.click("#renewalConsent");
    await r.page.click('[data-buy="founding"]');
    await r.page.waitForSelector("#signupModal:not([hidden])");
    assert.equal(r.checkout.length, 0);
    await r.page.close();
  });

  /* ---------------- founding plan management (?manage=founding) ---------------- */
  await check("Signed extension link: token redeemed and stripped, management route kept, server date shown", async () => {
    const r = await visit({ data: closedOffer, signed: true, profile: PROFILES.founder }, "/upgrade/?manage=founding&token=fixture");
    assert.equal(new URL(r.page.url()).searchParams.get("token"), null);
    assert.equal(new URL(r.page.url()).searchParams.get("manage"), "founding");
    assert.deepEqual(r.redeem, [{ token: "fixture" }]);
    assert.match(await text(r.page, "#renewalStatus"), /December 1, 2027/);
    assert.ok(r.management.some((x) => x.action === "status"));
    await r.page.close();
  });
  await check("Signed link that fails: visitor header comes back, error in the bottom note", async () => {
    const r = await visit({ data: closedOffer, signed: false, redeemStatus: 401 }, "/upgrade/?token=expired");
    assert.equal(await text(r.page, "#page-title"), "Try illi free for 45 days.");
    assert.match(await text(r.page, "#checkoutStub"), /invalid or has expired/);
    await r.page.close();
  });
  await check("Email management link prompts sign-in", async () => {
    const r = await visit({ data: closedOffer }, "/upgrade/?manage=founding");
    await r.page.click("#manageSignIn");
    assert.equal(await r.page.$eval("#signupModal", (e) => e.hidden), false);
    await r.page.close();
  });
  for (const size of SIZES) {
    await check("Verified cancellation keeps paid access " + size.width + "px", async () => {
      const r = await visit(Object.assign({ data: closedOffer, signed: true, profile: PROFILES.founder }, size), "/upgrade/?manage=founding");
      await r.page.click("#cancelRenewal");
      await wait(250);
      assert.match(await text(r.page, "#renewalStatus"), /Automatic renewal is cancelled/);
      assert.equal(await r.page.$eval("#cancelRenewal", (e) => e.hidden), true);
      assert.match(await text(r.page, "#renewalAccess"), /December 1, 2027/);
      assert.deepEqual(r.management.filter((x) => x.action === "cancel"), [{ action: "cancel" }]);
      await r.page.close();
    });
  }
  for (const error of ["cancellation_pending", "renewal_requires_review"]) {
    await check("Unconfirmed cancellation stays unconfirmed: " + error, async () => {
      const r = await visit({ data: closedOffer, signed: true, profile: PROFILES.founder, cancelStatus: 409, cancelData: { error } }, "/upgrade/?manage=founding");
      await r.page.click("#cancelRenewal");
      await wait(250);
      assert.doesNotMatch(await text(r.page, "#renewalStatus"), /is cancelled/);
      await r.page.close();
    });
  }
  for (const state of ["pending", "scheduled", "active", "cancel_requested", "canceled", "review"]) {
    await check("Authoritative renewal state " + state, async () => {
      const r = await visit({ data: closedOffer, signed: true, profile: PROFILES.founder, renewalData: await renewalFixture(state) }, "/upgrade/?manage=founding");
      assert.equal(await r.page.$eval("#cancelRenewal", (e) => e.hidden), !["pending", "scheduled", "active"].includes(state));
      if (state === "active") assert.match(await text(r.page, "#renewalStatus"), /December 1, 2028/);
      await r.page.close();
    });
  }
  await check("Wrong account does not expose cancellation", async () => {
    const r = await visit({ data: closedOffer, signed: true, profile: PROFILES.trial, renewalStatus: 404, renewalData: { error: "no_founding_purchase" } }, "/upgrade/?manage=founding");
    assert.match(await text(r.page, "#renewalStatus"), /no founding purchase/);
    assert.equal(await r.page.$eval("#cancelRenewal", (e) => e.hidden), true);
    await r.page.close();
  });
  await check("Payment method: only the Stripe billing host; capture while opening", async () => {
    let r;
    for (const size of SIZES) {
      r = await visit(Object.assign({ data: closedOffer, signed: true, profile: PROFILES.founder, holdPayment: true }, size), "/upgrade/?manage=founding");
      await r.page.click("#managePayment");
      await wait(150);
      assert.match(await text(r.page, "#renewalStatus"), /Opening payment settings/);
      await shot(r.page, "34-manage-payment-method", "full");
      if (size.width !== 390) await r.page.close();
    }
    r.held.forEach((q) => q.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ url: "https://billing.stripe.com/p/session/test" }) }));
    await wait(300);
    assert.deepEqual(r.stripeNav, ["https://billing.stripe.com/p/session/test"]);
    const bad = await visit({ data: closedOffer, signed: true, profile: PROFILES.founder, paymentUrl: "https://example.com/not-stripe" }, "/upgrade/?manage=founding");
    await bad.page.click("#managePayment");
    await wait(250);
    assert.match(bad.page.url(), /127\.0\.0\.1/);
    await r.page.close();
    await bad.page.close();
  });

  /* ---------------- sign-in dialog and the human check ---------------- */
  for (const size of SIZES) {
    const W = size.width;
    await check("Dialog " + W + "px: check passes, Continue enabled, real code flow signs in and repaints", async () => {
      const r = await visit(Object.assign({ data: closedOffer }, size));
      await r.page.click("#haveSignIn");
      await r.page.waitForFunction(() => document.getElementById("turnstileSlot").dataset.check === "ok");
      assert.equal(await r.page.$eval("#otpSubmit", (b) => b.disabled), false);
      await r.page.type("#otpEmail", "sam@example.com");
      await shot(r.page, "20-dialog-email", "view");
      await r.page.click("#otpSubmit");
      await r.page.waitForSelector("#otpCodeStep:not([hidden])");
      assert.equal(await visible(r.page, "#otpVerify"), true);
      assert.equal(await visible(r.page, "#otpSubmit"), false);
      assert.equal(await visible(r.page, "#otpLinks"), true);
      const calls = await r.page.evaluate(() => window.QA_CALLS);
      assert.ok(calls.some((c) => c.signInWithOtp && c.signInWithOtp.email === "sam@example.com" && /^QA-TOKEN/.test(c.signInWithOtp.options.captchaToken)));
      await r.page.type("#otpCode", "4821");
      await shot(r.page, "26-dialog-code", "view");
      await r.page.click("#otpVerify");
      await wait(150);
      assert.equal(await r.page.$eval("#otpCode", (e) => e.getAttribute("aria-invalid")), "true");
      await shot(r.page, "27-dialog-code-error", "view");
      await r.page.type("#otpCode", "93");
      await r.page.click("#otpVerify");
      await r.page.waitForFunction(() => document.getElementById("signupModal").hidden);
      await wait(300);
      assert.equal(await text(r.page, "#page-title"), "Keep illi Premium for 27 cents a day.");
      assert.equal(await r.page.evaluate(() => document.body.dataset.tier), "trial");
      await shot(r.page, "10-just-signed-in", "view");
      assert.equal(r.checkout.length, 0, "sign-in must never start checkout");
      await r.page.close();
    });
    await check("Dialog " + W + "px: invalid email shows an error tied to the field", async () => {
      const r = await visit(Object.assign({ data: closedOffer }, size));
      await r.page.click("#haveSignIn");
      await r.page.waitForFunction(() => document.getElementById("turnstileSlot").dataset.check === "ok");
      await r.page.type("#otpEmail", "sam@example");
      await r.page.click("#otpSubmit");
      assert.equal(await text(r.page, "#otpEmailError"), "Enter a valid email address.");
      assert.equal(await r.page.$eval("#otpEmail", (e) => e.getAttribute("aria-invalid")), "true");
      await shot(r.page, "25-dialog-email-error", "view");
      await r.page.close();
    });
    await check("Dialog " + W + "px: human check needs a click: frame keeps its full 300 px width (74fe57f) even when 0 is reported", async () => {
      const r = await visit(Object.assign({ data: closedOffer, ts: "click" }, size));
      await r.page.click("#haveSignIn");
      await r.page.waitForFunction(() => document.getElementById("turnstileSlot").dataset.check === "click");
      const box = await r.page.$eval("#tsFrame", (f) => { const b = f.getBoundingClientRect(); const d = f.closest(".sm-dialog").getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), left: b.left, right: b.right, dl: d.left, dr: d.right, display: getComputedStyle(f).display }; });
      assert.equal(box.w, 300);
      assert.equal(box.h, 65);
      assert.ok(box.left >= box.dl && box.right <= box.dr, "frame overflows the dialog");
      assert.equal(await text(r.page, ".check-hint"), "One quick check, then you’re in.");
      assert.equal(await r.page.$eval("#otpSubmit", (b) => b.disabled), true);
      assert.equal(await noOverflow(r.page), true);
      await r.page.type("#otpEmail", "sam@example.com");
      await shot(r.page, "22-dialog-check-click", "view");
      await r.page.close();
    });
    await check("Dialog " + W + "px: check pending is said in words; the frame is laid out, never display:none", async () => {
      const r = await visit(Object.assign({ data: closedOffer, ts: "silent" }, size));
      await r.page.click("#haveSignIn");
      await r.page.waitForSelector("#tsFrame");
      assert.equal(await r.page.$eval("#turnstileSlot", (e) => e.dataset.check), "pending");
      assert.equal(await visible(r.page, ".check-pending"), true);
      assert.equal(await r.page.$eval("#tsFrame", (f) => getComputedStyle(f).display !== "none" && f.getBoundingClientRect().width === 300), true);
      await r.page.type("#otpEmail", "sam@example.com");
      await shot(r.page, "21-dialog-check-pending", "view");
      await r.page.close();
    });
    await check("Dialog " + W + "px: check fails, then fails again: Try again, then a way forward", async () => {
      const r = await visit(Object.assign({ data: closedOffer, ts: "error" }, size));
      await r.page.click("#haveSignIn");
      await r.page.waitForFunction(() => document.getElementById("turnstileSlot").dataset.check === "failed");
      await r.page.type("#otpEmail", "sam@example.com");
      assert.equal(await visible(r.page, "#checkRetry"), true);
      assert.equal(await visible(r.page, ".check-way"), false);
      await shot(r.page, "23-dialog-check-failed", "view");
      await r.page.click("#checkRetry");
      await r.page.waitForFunction(() => document.getElementById("turnstileSlot").dataset.check === "failed2");
      assert.equal(await visible(r.page, ".check-way"), true);
      await shot(r.page, "24-dialog-check-failed-twice", "view");
      await r.page.close();
    });
  }

  /* ---------------- keyboard and screen-reader basics ---------------- */
  async function tabStops(page, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      await page.keyboard.press("Tab");
      out.push(await page.evaluate(() => {
        const e = document.activeElement;
        const cs = getComputedStyle(e);
        return { id: e.id, interval: e.dataset.interval || null, name: (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim(), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 };
      }));
    }
    return out;
  }
  await check("Keyboard 1440, signed in: focus order header, then monthly before annual; every stop shows a 2 px outline", async () => {
    const r = await visit({ data: closedOffer, signed: true });
    const stops = await tabStops(r.page, 9);
    const buys = stops.filter((s) => s.interval).map((s) => s.interval);
    assert.deepEqual(buys, ["monthly", "annual"]);
    assert.ok(stops.every((s) => s.outline), "missing visible focus: " + JSON.stringify(stops.filter((s) => !s.outline)));
    await r.page.close();
  });
  await check("Keyboard 390, signed in: focus meets annual before monthly, as the cards are seen", async () => {
    const r = await visit({ data: closedOffer, signed: true, width: 390, height: 844, phone: true });
    const order = await r.page.$$eval("#plans > .plan", (els) => els.map((e) => e.id));
    assert.deepEqual(order, ["planAnnual", "planMonthly", "planFree"]);
    const stops = await tabStops(r.page, 8);
    assert.deepEqual(stops.filter((s) => s.interval).map((s) => s.interval), ["annual", "monthly"]);
    await r.page.close();
  });
  await check("Keyboard 1440, visitor: Get illi free, then monthly, then annual, each with a visible outline", async () => {
    const r = await visit({ data: closedOffer });
    const stops = await tabStops(r.page, 14);
    const cards = stops.filter((s) => s.id === "freeInstall" || s.interval).map((s) => s.id || s.interval);
    assert.deepEqual(cards, ["freeInstall", "monthly", "annual"]);
    assert.ok(stops.every((s) => s.outline));
    await r.page.close();
  });
  await check("Keyboard 390, visitor: Free first, then annual, then monthly (markup order matches the stack)", async () => {
    const r = await visit({ data: closedOffer, width: 390, height: 844, phone: true });
    assert.deepEqual(await r.page.$$eval("#plans > .plan", (els) => els.map((e) => e.id)), ["planFree", "planAnnual", "planMonthly"]);
    const stops = await tabStops(r.page, 12);
    assert.deepEqual(stops.filter((s) => s.id === "freeInstall" || s.interval).map((s) => s.id || s.interval), ["freeInstall", "annual", "monthly"]);
    assert.equal(stops.find((s) => s.id === "freeInstall").name, "Get illi free");
    await r.page.close();
  });
  await check("Names: every button and link has a name; plan cards are labelled; the dialog is a labelled modal", async () => {
    const r = await visit({ data: offer });
    const unnamed = await r.page.$$eval("button, a[href]", (els) => els.filter((e) => e.offsetWidth || e.closest("#signupModal")).filter((e) => !(e.getAttribute("aria-label") || e.textContent.trim())).map((e) => e.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, []);
    assert.deepEqual(await r.page.$$eval("#plans > .plan", (els) => els.map((e) => e.getAttribute("aria-label")).sort()), ["Free", "illi Premium, annual", "illi Premium, monthly"]);
    assert.equal(await r.page.$eval("#signupModal", (e) => e.getAttribute("role") + "/" + e.getAttribute("aria-modal") + "/" + !!document.getElementById(e.getAttribute("aria-labelledby"))), "dialog/true/true");
    assert.deepEqual(await r.page.$$eval("#otpEmail, #otpCode, #sendEmail", (els) => els.map((e) => !!document.querySelector('label[for="' + e.id + '"]'))), [true, true, true]);
    await r.page.close();
  });
  await check("Dialog: focus moves in, stays in (Tab wraps), returns to the opener on Escape; page behind is inert", async () => {
    const r = await visit({ data: closedOffer });
    await r.page.focus("#haveSignIn");
    await r.page.keyboard.press("Enter");
    await r.page.waitForFunction(() => document.activeElement && document.activeElement.id === "otpEmail");
    assert.equal(await r.page.evaluate(() => document.getElementById("main").inert && document.getElementById("siteHead").inert), true);
    for (let i = 0; i < 8; i++) await r.page.keyboard.press("Tab");
    assert.equal(await r.page.evaluate(() => !!document.activeElement.closest("#signupModal")), true);
    await r.page.keyboard.press("Escape");
    assert.equal(await r.page.evaluate(() => document.activeElement.id), "haveSignIn");
    await r.page.close();
  });

  /* ---------------- the live public pricing service (read only) ---------------- */
  await check("Live pricing-info (public GET, read only): valid contract, page renders its campaign state, no errors", async () => {
    const r = await visit({ live: true });
    const live = await r.page.evaluate(() => window.illiOffer.data);
    assert.ok(live, "live pricing-info failed the page's contract check");
    assert.equal(live.offer_version, "broad-2026-10-renewing");
    const open = await r.page.evaluate(() => window.illiOffer.campaignOpen(window.illiOffer.data));
    assert.equal(await r.page.$eval("#foundingBanner", (e) => e.hidden), !open);
    assert.deepEqual(r.errors, []);
    console.log("     live campaign status: " + live.founding.status + ", banner " + (open ? "shown" : "hidden"));
    await r.page.close();
  });

  /* ---------------- nothing left the machine except the public pricing GET ---------------- */
  await check("Safety: no request reached production other than GET pricing-info", async () => {
    assert.ok(leaked.every((u) => /\/functions\/v1\/pricing-info$/.test(u)), leaked.join(", "));
  });

  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify({ testedAt: new Date().toISOString(), scope: "Real page from a local server; every authentication, checkout, billing, renewal and email request answered by fixtures; actual pricing-info and founding-renewal handlers with service doubles; one read-only GET of the public pricing-info.", passed: results.filter((r) => r.pass).length, failed: failures.length, results }, null, 2));
  console.log("\n" + results.filter((r) => r.pass).length + " passed, " + failures.length + " failed");
  if (failures.length) process.exitCode = 1;
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });
