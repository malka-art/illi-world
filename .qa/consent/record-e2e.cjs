// illi.world page events, end to end on a local stand-in for production (2026-11-16).
//
// The chain under test is the real one, start to finish, with nothing from production:
//   the real home page (this repo) -> assets/home/track.js -> the REAL site-event Edge Function source, run locally by Deno
//   -> a local stand-in for the Supabase REST endpoint -> record_site_events() from the REAL migration 044, on PostgreSQL
//   (PGlite, in this process), called as service_role exactly as production would.
// It proves three things:
//   1. a visit is recorded: rows land in public.site_events, with the campaign tags and, after "Yes, remember me", the code;
//   2. after "Stop counting my visits" nothing more is recorded, on that page or on the next load;
//   3. nothing reaches production: every request the browser makes to *.supabase.co, or to any host that is not this
//      machine, is aborted and listed, and the list must stay empty. The function itself is pointed at the local stand-in.
//
// Run (from the site repo root):
//   CODE_DIR=<code worktree with supabase/functions/site-event>  PGLITE=<.../@electric-sql/pglite/dist/index.js>
//   PUPPETEER_PATH=<.../puppeteer-core>  CHROME=<chrome.exe>  [OUT=<captures folder>]  node .qa/consent/record-e2e.cjs
// The function's Deno modules must already be in the Deno cache (it is started with --cached-only, so nothing is downloaded).
// Ports: 18790 (site), 18791 (REST stand-in), 8000 (the function: std serve's fixed default).
const puppeteer = require(process.env.PUPPETEER_PATH);
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CODE = process.env.CODE_DIR;
const SITE_PORT = 18790, REST_PORT = 18791, FN = 'http://localhost:8000/';
const OUT = process.env.OUT || '';
const results = [];
let failures = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };
function siteServer() {
  return http.createServer((req, res) => {
    let p = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT)) return res.writeHead(403), res.end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) return res.writeHead(404), res.end();
    res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
    if (path.extname(p) === '.mp4') return res.writeHead(204), res.end();   // the film is not needed here
    fs.createReadStream(p).pipe(res);
  });
}

(async () => {
  // ---------- PostgreSQL with migration 044, as production has it (roles and default grants like a Supabase project) ----------
  const { PGlite } = await import('file:///' + process.env.PGLITE.replace(/\\/g, '/').replace(/^\//, ''));
  const db = new PGlite();
  await db.exec(`
    create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema cron; create table cron.job(jobname text primary key, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as
      $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = s, command = c; select 1::bigint $$;`);
  const sql = fs.readFileSync(path.join(CODE, 'supabase/migrations/044_site_events.sql'), 'utf8');
  const cronLine = 'create extension if not exists pg_cron;';
  if (!sql.includes(cronLine)) throw new Error('migration 044 no longer has the pg_cron line this harness stubs');
  await db.exec(sql.replace(cronLine, '-- pg_cron stubbed'));
  const count = async () => Number((await db.query('select count(*)::int as n from public.site_events')).rows[0].n);

  // ---------- the stand-in for the Supabase REST endpoint: only POST /rest/v1/rpc/record_site_events ----------
  const restCalls = [];
  const rest = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      restCalls.push(req.method + ' ' + req.url);
      if (req.method !== 'POST' || !req.url.startsWith('/rest/v1/rpc/record_site_events')) { res.writeHead(404); return res.end('{}'); }
      try {
        const { p_rows } = JSON.parse(body);
        await db.exec('begin; set local role service_role;');
        const r = await db.query('select public.record_site_events($1::jsonb) as n', [JSON.stringify(p_rows)]);
        await db.exec('commit');
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.rows[0].n));
      } catch (e) {
        await db.exec('rollback').catch(() => {});
        console.log('REST stand-in error:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: e.message }));
      }
    });
  });
  const site = siteServer();
  await new Promise((r) => rest.listen(REST_PORT, '127.0.0.1', r));
  await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

  // ---------- the real site-event function, run by Deno, pointed at the stand-in ----------
  const fn = spawn('deno', ['run', '--cached-only', '--allow-net', '--allow-env', path.join(CODE, 'supabase/functions/site-event/index.ts')], {
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${REST_PORT}`, SUPABASE_SERVICE_ROLE_KEY: 'local-stand-in-not-a-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let fnOut = '';
  fn.stdout.on('data', (d) => (fnOut += d)); fn.stderr.on('data', (d) => (fnOut += d));
  for (let i = 0; i < 100 && !/Listening/.test(fnOut); i++) await sleep(100);
  check('the real site-event function runs locally against the stand-in', /Listening/.test(fnOut), fnOut.trim().split('\n').slice(-2));

  const prodHits = [], outside = [];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'illi-e2e-'));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, userDataDir: profile, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });
    // store links must not open: keep the click (track.js and consent.js see it first, in the capture phase), drop the navigation
    await page.evaluateOnNewDocument(() => window.addEventListener('click', (e) => { if (e.target.closest('a[href*="chromewebstore"]')) e.preventDefault(); }));
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (/supabase\.co/.test(u)) { prodHits.push(r.method() + ' ' + u.split('?')[0]); return r.abort(); }
      if (!/^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:)/.test(u)) { outside.push(u.split('?')[0]); return r.abort(); }
      return r.continue();
    });
    const flush = async () => { await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); }); await sleep(1500); };
    const tags = '&utm_source=rock&utm_medium=partner&utm_campaign=lesson-links&utm_content=lesson3';
    await page.goto(`http://127.0.0.1:${SITE_PORT}/?track_endpoint=${encodeURIComponent(FN)}${tags}`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.getElementById('ask'); return a && !a.hidden && !a.classList.contains('is-aside'); }, { timeout: 4000 });
    await sleep(900);
    if (OUT) await page.screenshot({ path: path.join(OUT, 'e2e-bar-1440x900.png') });
    const href = await page.$eval('[data-cta="hero"]', (a) => a.href);
    check('the "Try illi free" store link carries every utm_ tag of the visit', /utm_source=rock/.test(href) && /utm_medium=partner/.test(href) && /utm_campaign=lesson-links/.test(href) && /utm_content=lesson3/.test(href), href);

    // 1. a visit is recorded
    await page.click('#ask [data-answer="yes"]'); await sleep(200);
    await page.click('[data-cta="hero"]'); await sleep(200);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
    await flush();
    const rows = (await db.query('select event, props, utm_source, utm_content, browser_id, first_utm_source, device, page from public.site_events order by id')).rows;
    const names = rows.map((r) => r.event);
    check('events are recorded in site_events (page_view, consent_shown, consent_yes, cta_click)', ['page_view', 'consent_shown', 'consent_yes', 'cta_click'].every((n) => names.includes(n)), names);
    const yes = rows.find((r) => r.event === 'consent_yes');
    check('the yes is recorded with wording version a1, from the bar', yes && yes.props.v === 'a1' && yes.props.from === 'note', yes && yes.props);
    check('the visit\'s campaign tags are recorded', rows.every((r) => r.utm_source === 'rock' && r.utm_content === 'lesson3'), rows.slice(0, 1));
    const cta = rows.find((r) => r.event === 'cta_click');
    check('after the yes, rows carry the remembered code and the first visit\'s tags', !!cta && !!cta.browser_id && cta.first_utm_source === 'rock', cta);
    const note = await page.evaluate(() => JSON.parse(localStorage.getItem('illi.note') || 'null'));
    check('the recorded code is the one saved in the browser', !!note && cta && cta.browser_id === note.id);

    // 2. stop counting: nothing more is recorded
    const before = await count();
    await page.click('.foot-choice'); await sleep(250);
    await page.click('[data-choice="stop"]'); await sleep(200);
    if (OUT) await page.screenshot({ path: path.join(OUT, 'e2e-panel-stopped-1440x900.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
    await page.click('[data-cta="header"]'); await sleep(100);
    await flush(); await sleep(3200);
    check('after "Stop counting my visits": nothing more recorded from this page', (await count()) === before, { before, after: await count() });
    await page.reload({ waitUntil: 'load' }); await sleep(1200);
    await page.evaluate(() => window.scrollTo(0, 2000)); await sleep(200);
    await page.click('[data-cta="header"]').catch(() => {});
    await flush(); await sleep(3200);
    check('after "Stop counting my visits": nothing recorded on the next load either', (await count()) === before, { before, after: await count() });
    const hrefOff = await page.$eval('[data-cta="hero"]', (a) => a.href);
    check('with counting off, the store link is left untagged', !/utm_/.test(hrefOff), hrefOff);
    await ctx.close();

    // 3. nothing reached production
    check('nothing reached production: no request to the Supabase project left the browser', prodHits.length === 0, prodHits);
    check('no request to any other outside host', outside.length === 0, outside.slice(0, 5));
    check('the function only ever called the local stand-in, and only the record_site_events RPC', restCalls.length > 0 && restCalls.every((c) => c.startsWith('POST /rest/v1/rpc/record_site_events')), restCalls.slice(0, 3));
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fn.kill();
    site.close(); rest.close();
  }
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
