// Executes the current renewal HTTP handler with isolated identity/ledger/Stripe doubles.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ts = require("C:/worktrees/illi-cws-1.0.1-store/node_modules/typescript");
const sourceRoot =
  "C:/worktrees/illi-cws-1.0.1-store/supabase/functions";
const source = fs
  .readFileSync(path.join(sourceRoot, "founding-renewal/index.ts"), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "");
module.exports = async function renewalFixture(
  state = "scheduled",
  action = "status",
) {
  let handler;
  const attempt = {
    renewal_state: state,
    renewal_quote_at: "2027-12-01T12:00:00Z",
    paid_period_end: "2027-12-01T12:00:00Z",
    founding_years: 1,
    state: "paid",
    stripe_customer_id: "fixture-customer",
    stripe_subscription_id: state === "active" ? "fixture-subscription" : null,
  };
  const context = {
    Response,
    Date,
    console,
    Deno: { env: { get: () => "fixture-only" } },
    serve: (fn) => (handler = fn),
    createClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "fixture-user" } },
          error: null,
        }),
      },
      from: () => ({
        select: () => {
          const query = {
            eq: () => query,
            maybeSingle: async () => ({
              data: {
                current_period_end: "2028-12-01T12:00:00Z",
                status: "active",
              },
              error: null,
            }),
          };
          return query;
        },
      }),
    }),
    Stripe: class {
      subscriptions = {
        retrieve: async () => ({
          current_period_end: Date.parse("2028-12-01T12:00:00Z") / 1000,
        }),
      };
      billingPortal = {
        sessions: {
          create: async () => ({
            url: "https://billing.stripe.com/p/session/test",
          }),
        },
      };
    },
    foundingAttemptForUser: async () => attempt,
    readFoundingRenewal: async () => attempt,
    cancelFoundingRenewal: async () => ({
      ...attempt,
      renewal_state: "canceled",
    }),
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    context,
  );
  const response = await handler(
    new Request("https://fixture/founding-renewal", {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    }),
  );
  if (!response.ok)
    throw new Error("Source renewal fixture failed " + response.status);
  return response.json();
};
