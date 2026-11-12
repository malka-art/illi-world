// Executes the actual pending pricing handler with isolated service doubles.
// No production network, credentials, accounts or payments are used.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("C:/worktrees/illi-cws-1.0.1-store/node_modules/typescript");
const sourceRoot =
  "C:/worktrees/illi-cws-1.0.1-store/supabase/functions";
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const shared = { exports: {}, Date };
vm.runInNewContext(
  transpile(
    fs.readFileSync(path.join(sourceRoot, "_shared/founding-offer.ts"), "utf8"),
  ),
  shared,
);
const source = fs
  .readFileSync(path.join(sourceRoot, "pricing-info/index.ts"), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "");
async function fixture(status) {
  const now = Date.now();
  const campaign = {
    starts_at: new Date(now - 86400000).toISOString(),
    ends_at: new Date(now + 86400000 * 44).toISOString(),
    cap: 1000,
  };
  if (status === "not_started") campaign.starts_at = campaign.ends_at = null;
  if (status === "closing")
    campaign.ends_at = new Date(now + 15 * 60000).toISOString();
  if (status === "ended")
    campaign.ends_at = new Date(now - 60000).toISOString();
  if (status === "scheduled")
    campaign.starts_at = new Date(now + 86400000).toISOString();
  let handler;
  const context = {
    ...shared.exports,
    Date,
    Response,
    console,
    Deno: { env: { get: () => "fixture-only" } },
    serve: (fn) => (handler = fn),
    createClient: () => ({
      from: (table) => ({
        select: () => {
          const query = {
            eq: () => query,
            single: async () => ({ data: campaign, error: null }),
            neq: async () => ({
              count: status === "sold_out" ? 1000 : 3,
              error: null,
            }),
          };
          return query;
        },
      }),
    }),
    Stripe: class {
      prices = {
        list: async ({ lookup_keys: [key] }) => ({
          data: [
            {
              currency: "usd",
              unit_amount: key === "illi_annual" ? 10000 : 1000,
              recurring: {
                interval: key === "illi_annual" ? "year" : "month",
                interval_count: 1,
              },
            },
          ],
        }),
      };
    },
  };
  vm.runInNewContext(transpile(source), context);
  const response = await handler(new Request("https://fixture/pricing-info"));
  if (response.status !== 200)
    throw new Error("Source fixture failed " + response.status);
  const data = await response.json();
  if (data.founding.status !== status)
    throw new Error("Source status mismatch " + data.founding.status);
  return data;
}
module.exports = fixture;
if (require.main === module)
  (async () => {
    const output = {};
    for (const state of [
      "not_started",
      "scheduled",
      "active",
      "closing",
      "ended",
      "sold_out",
    ])
      output[state] = await fixture(state);
    // printed, not written: the browser checks build their fixtures in memory, so nothing is left in the repo
    console.log(JSON.stringify(output, null, 2));
    console.error("Actual pricing handler: all six campaign states generated.");
  })();
