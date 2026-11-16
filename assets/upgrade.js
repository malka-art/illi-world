/* illi pricing page (/upgrade/). Live logic from the October 29 working page (sign-in with a one-time code and the human check,
   the single-use extension-to-web bridge, pricing-info through offer.js, stripe-checkout, founding renewal at ?manage=founding),
   presented in Amanda's revision 6 design. The stylesheet keys off four body attributes set here from real account facts:
   data-auth (in, out), data-tier (trial, ended, paid, founder), data-paying, data-view (founding, manage). */
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var SUPABASE_URL = "https://wbobpjzkasbnkxbiiioe.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_nj-_J2qmR2VT45qqSesaTg_rvZcXr1j";
  var SUPABASE_JS = "/assets/vendor/supabase-js-2.103.0.esm.js";
  var SEND_ENDPOINT = SUPABASE_URL + "/functions/v1/send-to-desktop";
  var $ = function (id) {
    return document.getElementById(id);
  };
  var body = document.body;

  // A phone or tablet cannot install a Chrome extension (same test as the home page's landing.js). An iPad introduces itself as a
  // Mac: it has a touch screen and its browser is never a Chromium one, so a touch-screen MacBook in Chrome stays a computer.
  var ua = navigator.userAgent || "";
  var isIpadAsMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1 && !navigator.userAgentData;
  var isMobile =
    (navigator.userAgentData && navigator.userAgentData.mobile) ||
    /Android|iPhone|iPad|iPod/i.test(ua) ||
    isIpadAsMac ||
    params.get("device") === "mobile";

  /* ---------- the bottom note (the working page's status region) ---------- */
  var stub = $("checkoutStub");
  var stubTimer = null;
  // kind: "busy" (pulsing dot), "error" (an icon as well as the words), or none. lasts: ms before it goes, for good news only.
  function showStub(html, kind, lasts) {
    clearTimeout(stubTimer);
    stub.innerHTML = html;
    if (kind) stub.setAttribute("data-kind", kind);
    else stub.removeAttribute("data-kind");
    if (lasts) stubTimer = setTimeout(hideStub, lasts);
  }
  function hideStub() {
    clearTimeout(stubTimer);
    stub.innerHTML = "";
    stub.removeAttribute("data-kind");
  }

  /* ---------- left checkout (Stripe cancel_url -> ?status=cancelled) ---------- */
  if (params.get("status") === "cancelled" || params.get("status") === "canceled") $("returnBanner").hidden = false;
  $("returnClose").addEventListener("click", function () {
    $("returnBanner").hidden = true;
  });

  /* ---------- header hairline once the page has moved (as on the home page) ---------- */
  var head = $("siteHead");
  function syncHead() {
    head.classList.toggle("is-stuck", window.scrollY > 4);
  }
  window.addEventListener("scroll", syncHead, { passive: true });
  syncHead();

  /* one lazily-created supabase-js client; persistSession carries the web session across the Stripe round-trip */
  var _sbClient = null;
  function getSupabase() {
    if (_sbClient) return Promise.resolve(_sbClient);
    return import(SUPABASE_JS).then(function (m) {
      _sbClient = m.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "illi-web-auth" },
      });
      return _sbClient;
    });
  }
  async function currentSession() {
    var sb = await getSupabase();
    var out = await sb.auth.getSession();
    return { sb: sb, session: out && out.data && out.data.session };
  }

  /* drop ?token from the address bar without reloading (token is single-use + 30-min) */
  function stripToken() {
    params.delete("token");
    var qs = params.toString();
    history.replaceState({}, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    identityToken = null;
  }

  /* ?token -> upgrade-redeem -> verifyOtp (silent sign-in). Resolves to true when signed in. */
  function redeemUpgradeToken(token) {
    showStub("Signing you in…", "busy");
    return fetch(SUPABASE_URL + "/functions/v1/upgrade-redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ token: token }),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { status: res.status, data: data };
          });
      })
      .then(function (r) {
        if (r.status === 200 && r.data && r.data.ok && r.data.auth) {
          return getSupabase()
            .then(function (sb) {
              return sb.auth.verifyOtp({ token_hash: r.data.auth.token_hash, type: r.data.auth.type });
            })
            .then(function (out) {
              stripToken(); // token is consumed server-side; clean the URL either way
              if (out && out.error) {
                showStub(
                  "We couldn’t finish signing you in. Open the illi extension and click <strong>Upgrade</strong> to try again.",
                  "error",
                );
                return false;
              }
              hideStub();
              return true;
            });
        }
        // error contract: 400 missing_token / 401 bad_token / 404 no_user / 500 session_mint_failed|internal_error
        if (r.status === 500) {
          showStub("Something went wrong on our end. Please refresh to try again in a moment.", "error");
        } else {
          stripToken(); // permanent failure: don't loop on a dead link
          if (r.status === 401)
            showStub(
              "That upgrade link is invalid or has expired. Links last 30 minutes. Open the illi extension and click <strong>Upgrade</strong> for a fresh one.",
              "error",
            );
          else if (r.status === 404)
            showStub(
              "We couldn’t find your account from that link. Open the illi extension and click <strong>Upgrade</strong>, or sign in there.",
              "error",
            );
          else
            showStub(
              "That upgrade link looks incomplete. Open the illi extension and click <strong>Upgrade</strong> to get a new one.",
              "error",
            );
        }
        return false;
      })
      .catch(function () {
        showStub("We couldn’t reach the server to sign you in. Check your connection and refresh to try again.", "error");
        return false;
      });
  }

  /* ---------- the pressed button shows it is working, where the finger is. The other buttons are blocked by the busy flag, not
     disabled: a disabled button is drawn as "not yet", so disabling them all would flash every plan button grey. ---------- */
  function press(button) {
    if (!button) return;
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    if (!button.querySelector(".busy")) button.insertAdjacentHTML("afterbegin", '<span class="busy" aria-hidden="true"></span>');
  }
  function release(button) {
    if (!button) return;
    button.classList.remove("is-busy");
    button.removeAttribute("aria-busy");
    var dot = button.querySelector(".busy");
    if (dot) dot.remove();
  }
  // leave the page only for an allowed HTTPS host ("self" allows this page's own /upgrade/ path, where stripe-portal sends founders)
  function safeRedirect(href, allowed) {
    var url = new URL(href, location.href);
    var ok =
      !url.username &&
      !url.password &&
      ((url.protocol === "https:" && allowed.indexOf(url.hostname) !== -1) ||
        (allowed.indexOf("self") !== -1 && url.origin === location.origin && /^\/upgrade\/?$/.test(url.pathname)));
    if (!ok) throw new Error("invalid destination");
    window.location.assign(url.href);
  }

  /* plan button -> Stripe Checkout, authed with the web session.
     stripe-checkout v17 opens checkout during a trial (the remaining trial comes first), so there is no "wait until it ends" branch. */
  var checkoutBusy = false;
  async function startCheckout(tier, interval, button) {
    if (checkoutBusy) return;
    var selectedTerm = document.querySelector('[name="foundingYears"]:checked');
    var foundingYears = selectedTerm ? Number(selectedTerm.value) : null;
    var consent = $("renewalConsent").checked;
    if (tier === "founding" && (![1, 2].includes(foundingYears) || !consent)) {
      showStub("Choose one or two years and agree to the automatic annual renewal before continuing.", "error");
      return;
    }
    checkoutBusy = true;
    press(button);
    try {
      showStub("Checking your plan…", "busy");
      await window.illiOffer.ready;
      var offer = await window.illiOffer.refresh();
      if (!window.illiOffer.validOffer(offer)) {
        showStub(
          "Pricing is temporarily unavailable. Please refresh or contact hey@illi.world. No payment has been started.",
          "error",
        );
        return;
      }
      if (redeemPromise) await redeemPromise;
      var cs = await currentSession();
      if (!cs.session) {
        hideStub();
        openSignup();
        return;
      }
      await readCustomerProfile(cs.sb, cs.session.user.id);
      if (tier === "standard" && isPrepaid()) {
        showStub(
          "Your founding term is already paid for. Manage its future annual renewal above; no additional plan is needed.",
          "error",
        );
        return;
      }
      if (tier === "founding" && !window.illiOffer.campaignOpen(offer)) {
        showStub("The founding offer is not available. You can keep using your trial or choose a standard plan.", "error");
        return;
      }
      showStub("Opening secure checkout…", "busy");
      var response = await fetch(SUPABASE_URL + "/functions/v1/stripe-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + cs.session.access_token,
        },
        body: JSON.stringify({
          tier: tier,
          interval: interval,
          offer_version: "broad-2026-10-renewing",
          ...(tier === "founding" ? { founding_years: foundingYears, renewal_consent: true } : {}),
        }),
      });
      var data = await response.json().catch(function () {
        return {};
      });
      if (response.ok && data.url) {
        // an existing subscriber is sent to their Stripe billing page instead of a second checkout
        safeRedirect(data.url, [data.redirected_to_portal === true ? "billing.stripe.com" : "checkout.stripe.com"]);
        return;
      }
      if (response.status === 409 && data.error === "checkout_window_closed")
        showStub(
          "There is no longer enough time to open a new founding checkout before the deadline. Your existing access is unchanged.",
          "error",
        );
      else if (response.status === 409 && data.error === "checkout_plan_changed")
        showStub("Your earlier checkout has been canceled. Choose your new plan again to continue.", "error");
      else if (response.status === 409 && data.error === "checkout_in_progress")
        showStub("Your earlier checkout is still being prepared. Please wait a moment and try again.", "error");
      else if (response.status === 409 && data.error === "payment_processing")
        showStub("Your earlier payment is being confirmed. Please wait before buying again.", "error");
      else if (response.status === 409 && data.error === "checkout_requires_review")
        showStub("We need to check your earlier checkout. Email hey@illi.world before trying another payment.", "error");
      else if (response.status === 409)
        showStub(
          "Your plan or founding availability has changed. Refresh this page to see your current options. No new checkout was opened.",
          "error",
        );
      else showStub("We couldn’t open checkout. Please try again or email hey@illi.world.", "error");
    } catch (_) {
      showStub("We couldn’t reach checkout. Check your connection and try again.", "error");
    } finally {
      checkoutBusy = false;
      release(button);
      paintCustomer();
    }
  }

  /* ---------- people who already pay: their Stripe billing page (stripe-portal; it sends a founding buyer to ?manage=founding) ---------- */
  var billingBusy = false;
  async function openBilling() {
    if (billingBusy) return;
    var button = $("manageBilling");
    billingBusy = true;
    press(button);
    showStub("Opening your billing page…", "busy");
    try {
      var cs = await currentSession();
      if (!cs.session) {
        hideStub();
        openSignup();
        return;
      }
      var response = await fetch(SUPABASE_URL + "/functions/v1/stripe-portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + cs.session.access_token,
        },
        body: "{}",
      });
      var data = await response.json().catch(function () {
        return {};
      });
      if (response.ok && data.url) {
        safeRedirect(data.url, ["billing.stripe.com", "self"]);
        return;
      }
      showStub("We couldn’t open your billing page. Please try again or email hey@illi.world.", "error");
    } catch (_) {
      showStub("We couldn’t open your billing page. Check your connection and try again.", "error");
    } finally {
      billingBusy = false;
      release(button);
    }
  }

  /* ---------- the account ---------- */
  var signedIn = false;
  var customerProfile = null;
  async function readCustomerProfile(sb, userId) {
    var result = await sb
      .from("profiles")
      .select("founding_paid_until,founding_years_purchased,founding_billing_review,tier,trial_ends_at,deletion_scheduled_at")
      .eq("id", userId)
      .single();
    if (result.error) throw result.error;
    customerProfile = result.data;
    paintCustomer();
    await loadRenewalStatus().catch(function () {
      paintRenewal(null);
      $("renewalStatus").textContent = "We couldn’t check your renewal. Please refresh or email hey@illi.world.";
    });
  }
  function isPrepaid() {
    return !!customerProfile && Date.parse(customerProfile.founding_paid_until) > Date.now();
  }
  // trial / ended / paid / founder, from the profile. tier in the database: trial, expired, paid, founders (legacy paid plan).
  function accountTier() {
    var p = customerProfile;
    if (!p) return null;
    if (isPrepaid()) return "founder";
    if (p.tier === "paid" || p.tier === "founders") return "paid";
    var trialEnd = Date.parse(p.trial_ends_at);
    if (p.tier === "trial" && (!Number.isFinite(trialEnd) || trialEnd > Date.now())) return "trial";
    return "ended";
  }
  function dateOnly(value, utc) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", utc ? { dateStyle: "long", timeZone: "UTC" } : { dateStyle: "long" }).format(date);
  }
  function displayDate(value) {
    var date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC"
      : "a date we’re confirming";
  }

  var title = $("page-title"),
    intro = $("pageIntro"),
    foundingIntro = $("foundingIntro");
  var VISITOR_TITLE = title.textContent,
    VISITOR_INTRO = intro.textContent;
  var bannerDismissed = false;
  var wantFoundingView = params.get("offer") === "founding";
  var directManagement = params.get("manage") === "founding";

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }
  function paintCustomer() {
    var tier = signedIn ? accountTier() : null;
    var prepaid = isPrepaid();
    var hasFounding = !!customerProfile && customerProfile.founding_years_purchased > 0;
    var paying = tier === "paid" || tier === "founder";
    body.setAttribute("data-auth", signedIn ? "in" : "out");
    if (tier) body.setAttribute("data-tier", tier);
    else body.removeAttribute("data-tier");
    body.toggleAttribute("data-paying", paying);

    // header: signed in, the sign-in button becomes a small "Account signed in" chip (there is no sign-out on this page)
    $("signInButton").hidden = signedIn;
    $("signedInState").hidden = !signedIn;

    // two headers: a visitor, or someone with an account (a session, or a signed link from the extension or an email)
    if (!signedIn) {
      setText(title, VISITOR_TITLE);
      setText(intro, VISITOR_INTRO);
    } else if (tier === "paid") {
      setText(title, "You have illi Premium.");
      setText(intro, "Change your plan, update your card or cancel, all from your billing page.");
    } else if (tier === "founder") {
      setText(title, "You have illi Premium.");
      setText(intro, "Your founding plan is paid through " + dateOnly(customerProfile.founding_paid_until, true) + ".");
    } else {
      // a no-break space keeps "27" with "cents" at a line end
      setText(title, tier === "ended" ? "Get illi Premium back for 27 cents a day." : "Keep illi Premium for 27 cents a day.");
      setText(intro, "US$100 a year, or US$10 a month.");
    }

    // where the account stands, beside the claim
    var status = $("customerStatus");
    var lines = null;
    if (tier === "trial") {
      var end = dateOnly(customerProfile.trial_ends_at);
      lines = [
        end ? "Your free trial runs until " + end + "." : "Your free trial is running.",
        "You won’t be charged until your free trial ends.",
      ];
    } else if (tier === "ended")
      lines = ["Your free trial has ended.", "Basic speed control stays free. illi Premium brings the rest back."];
    var key = lines ? lines.join("|") : "";
    if (status.dataset.key !== key) {
      status.dataset.key = key;
      status.textContent = "";
      if (lines) {
        var a = document.createElement("strong");
        a.textContent = lines[0];
        var b = document.createElement("span");
        b.textContent = lines[1];
        status.append(a, b);
      }
    }
    $("accountBlock").hidden = !lines;
    $("hereFree").hidden = tier !== "ended";
    // the Free card: a visitor gets "Get illi free" with "Do nothing..." under it; signed in, the tick row and "Nothing to cancel."
    $("stayLine").hidden = !signedIn;
    setText($("stayLine"), tier === "ended" ? "You are on Free. Nothing to do." : "Do nothing and you move to Free.");
    setText($("freeNote"), signedIn ? "Nothing to cancel." : "Do nothing and you move to Free.");

    // one red action: a visitor's is "Try illi free" (both plan buttons step back); signed in, annual is the one red button
    var monthlyBuy = document.querySelector('[data-buy="standard"][data-interval="monthly"]');
    var annualBuy = document.querySelector('[data-buy="standard"][data-interval="annual"]');
    monthlyBuy.classList.add("secondary");
    annualBuy.classList.toggle("secondary", !signedIn);
    document.querySelectorAll('[data-buy="standard"]').forEach(function (button) {
      button.disabled = prepaid;
    });

    // founding: nothing to buy for an existing founding buyer, a paying subscriber, or an account being deleted
    var noFounding =
      !!customerProfile &&
      (hasFounding ||
        paying ||
        customerProfile.tier === "founders" ||
        !!customerProfile.founding_billing_review ||
        !!customerProfile.deletion_scheduled_at);
    var open = !!(window.illiOffer && window.illiOffer.campaignOpen(window.illiOffer.data));
    $("foundingChoice").hidden = !open || noFounding;
    $("foundingBanner").hidden = !open || noFounding || bannerDismissed;
    var form = $("foundingChoice");
    var choice = form.querySelector('[name="foundingYears"]:checked');
    var consent = $("renewalConsent").checked;
    var buy = form.querySelector('[data-buy="founding"]');
    buy.disabled = !choice || !consent;
    if (!buy.classList.contains("is-busy"))
      setText(
        buy,
        choice
          ? "Review US$" + (Number(choice.value) === 1 ? "40" : "80") + " plus applicable tax and renewal"
          : "Choose a term and agree to continue",
      );

    // views: the founding step only while the campaign is open (closed: the plans, with no mention of founding)
    var view = directManagement ? "manage" : wantFoundingView && open && !noFounding ? "founding" : null;
    if (view) body.setAttribute("data-view", view);
    else body.removeAttribute("data-view");
    foundingIntro.hidden = view !== "founding";
    intro.hidden = view === "founding";
    if (view === "founding") setText(title, "Choose your founding term.");
    if (view === "manage") {
      setText(title, "Your founding plan.");
      setText(
        intro,
        "See your renewal date, update your payment method or stop future renewal charges. Your purchased access stays yours.",
      );
      setText($("management-title"), "Renewal and payment");
    }
    $("foundingManagement").hidden = !(hasFounding || prepaid || directManagement);
    $("manageSignIn").hidden = signedIn;
    orderCards();
  }

  /* ---------- the order of the three cards follows the layout IN THE MARKUP, so keyboard and screen-reader order match what is seen.
     Wide: Free, monthly, annual. Narrower: a visitor reads Free first; someone signed in came to choose, so the illi Premium cards
     come first and Free last; once the cards stack, annual (the recommended one) comes before monthly. ---------- */
  var mqStack = window.matchMedia("(max-width: 780px)");
  var mqTwo = window.matchMedia("(max-width: 1220px)");
  function orderCards() {
    var plans = $("plans");
    var free = $("planFree"),
      monthly = $("planMonthly"),
      annual = $("planAnnual");
    var paid = mqStack.matches ? [annual, monthly] : [monthly, annual];
    var order = signedIn && mqTwo.matches ? paid.concat([free]) : [free].concat(paid);
    var current = Array.prototype.slice.call(plans.children);
    if (
      order.every(function (el, i) {
        return current[i] === el;
      })
    )
      return;
    var focused = document.activeElement;
    order.forEach(function (el) {
      plans.appendChild(el);
    });
    if (focused && plans.contains(focused)) focused.focus();
  }
  [mqStack, mqTwo].forEach(function (mq) {
    if (mq.addEventListener) mq.addEventListener("change", orderCards);
    else if (mq.addListener) mq.addListener(orderCards);
  });

  /* ---------- founding renewal (unchanged behaviour) ---------- */
  var renewalBusy = false;
  var renewalState = null;
  function paintRenewal(data) {
    renewalState = data;
    var status = $("renewalStatus");
    var access = $("renewalAccess");
    var cancel = $("cancelRenewal");
    var payment = $("managePayment");
    cancel.hidden = true;
    payment.hidden = true;
    if (!data) return;
    if (data.renewal_amount !== 100 || data.currency !== "usd") {
      status.textContent = "We couldn’t verify your renewal terms. Email hey@illi.world before making a payment.";
      return;
    }
    access.textContent = data.paid_until
      ? "Your purchased access is paid through " + displayDate(data.paid_until) + "."
      : "We’re confirming your purchased access dates.";
    var state = data.renewal_status;
    if (state === "canceled") status.textContent = "Automatic renewal is cancelled. No future renewal is scheduled.";
    else if (state === "cancel_requested")
      status.textContent =
        "Your cancellation is being confirmed. Refresh shortly to check its status; we’ll show confirmation once billing has stopped.";
    else if (state === "review" || !state)
      status.textContent = "We need to check your renewal details. Please email hey@illi.world for help.";
    else if (state === "pending") {
      status.textContent =
        "We’re setting up your renewal at US$100 a year plus applicable tax" +
        (data.renewal_at ? " for " + displayDate(data.renewal_at) : "") +
        ". Check back for confirmation.";
      cancel.hidden = false;
      payment.hidden = false;
    } else if (["scheduled", "active"].includes(state)) {
      status.textContent = data.renewal_at
        ? "Renews automatically for US$100 a year plus applicable tax. Next renewal: " + displayDate(data.renewal_at) + "."
        : "Your US$100 annual renewal, plus applicable tax, is being set up. We’re confirming the date.";
      cancel.hidden = false;
      payment.hidden = false;
    } else status.textContent = "We couldn’t verify your renewal status. Please refresh or email hey@illi.world.";
    cancel.disabled = renewalBusy;
    payment.disabled = renewalBusy;
  }
  async function renewalRequest(action) {
    var cs = await currentSession();
    if (!cs.session) {
      openSignup();
      return null;
    }
    var response = await fetch(SUPABASE_URL + "/functions/v1/founding-renewal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + cs.session.access_token,
      },
      body: JSON.stringify({ action: action }),
    });
    return {
      response: response,
      data: await response.json().catch(function () {
        return {};
      }),
    };
  }
  async function loadRenewalStatus() {
    if (!customerProfile || !(customerProfile.founding_years_purchased > 0 || directManagement)) return;
    var result = await renewalRequest("status");
    if (!result) return;
    if (result.response.ok) paintRenewal(result.data);
    else {
      paintRenewal(null);
      $("renewalStatus").textContent =
        result.response.status === 404
          ? "This account has no founding purchase. Check that you signed in with the email used at checkout."
          : "We couldn’t check your renewal. Please refresh or email hey@illi.world.";
    }
  }
  async function manageRenewal(action) {
    if (renewalBusy) return;
    renewalBusy = true;
    paintRenewal(renewalState);
    var status = $("renewalStatus");
    status.textContent = action === "cancel" ? "Confirming cancellation with billing…" : "Opening payment settings…";
    try {
      var result = await renewalRequest(action);
      if (!result) return;
      if (result.response.ok && action === "payment_method" && result.data.url) {
        safeRedirect(result.data.url, ["billing.stripe.com"]);
        return;
      }
      if (result.response.ok) {
        paintRenewal(result.data);
        return;
      }
      if (result.data.error === "cancellation_pending")
        status.textContent = "Your cancellation is being confirmed. Refresh shortly to check its status.";
      else
        status.textContent =
          "We couldn’t confirm this billing change. Please refresh or email hey@illi.world. Your purchased access is unchanged.";
    } catch (_) {
      status.textContent = "We couldn’t confirm this billing change. Check your connection and refresh to see the current status.";
    } finally {
      renewalBusy = false;
      $("cancelRenewal").disabled = false;
      $("managePayment").disabled = false;
    }
  }

  /* ---------- signed identity token (web-extension bridge): redeem on arrival for a silent web session ---------- */
  var identityToken = params.get("token") || null;
  var redeemPromise = identityToken ? redeemUpgradeToken(identityToken) : null;
  // a signed link means an account: show the account header at once instead of flashing the visitor one
  if (identityToken) signedIn = true;

  /* ---------- sign-in dialog ---------- */
  var modal = $("signupModal");
  var lastFocus = null;
  function setInert(on) {
    ["siteHead", "main", "foundingBanner"].forEach(function (id) {
      $(id).inert = on;
    });
    document.querySelector(".site-foot").inert = on;
  }
  function openSignup() {
    ensureTurnstile();
    lastFocus = document.activeElement;
    modal.hidden = false;
    setInert(true);
    document.body.style.overflow = "hidden";
    var target = otpCodeStep.hidden ? otpEmail : otpCode;
    setTimeout(function () {
      try {
        target.focus();
      } catch (e) {}
    }, 40);
  }
  function closeSignup() {
    modal.hidden = true;
    setInert(false);
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) {
      try {
        lastFocus.focus();
      } catch (e) {}
    }
  }

  /* ---------- the human check (Turnstile, I-133 contract): a same-origin frame of /turnstile ----------
     The 74fe57f fix is kept: the frame is never narrower than Cloudflare's 300 px widget (copying a reported 0 hid the checkbox),
     and its height follows. It is never display:none while the dialog is open. Every state is said in words, through
     #turnstileSlot[data-check]: pending while it runs, click when Cloudflare draws a box, failed after an error, a timeout
     (20 s with nothing drawn) or an expiry, failed2 after a second failed attempt, ok once there is a token. */
  var TS_IN = "illi-auth",
    TS_OUT = "illi-turnstile",
    TS_V = 1;
  var TS_MIN_W = 300;
  var TS_SILENT_MS = 20000;
  var tsFrame = null,
    tsReady = false,
    tsTimer = null,
    captchaToken = "";
  var tsState = { phase: "checking", failures: 0, visible: false };
  var slot = $("turnstileSlot");
  var otpSubmit = $("otpSubmit");
  function setSubmitEnabled(on) {
    otpSubmit.disabled = !on;
  }
  function tsRender() {
    var s = tsState;
    var v =
      s.phase === "passed" ? "ok" : s.phase === "checking" ? (s.visible ? "click" : "pending") : s.failures >= 2 ? "failed2" : "failed";
    if (slot.dataset.check !== v) slot.dataset.check = v;
  }
  function tsEvent(type, height) {
    var s = tsState;
    if (type === "retry") {
      s.phase = "checking";
      if (tsTimer) {
        clearTimeout(tsTimer);
        tsTimer = null;
      }
    } else if (type === "token") s.phase = "passed";
    else if (type === "error" || type === "timeout") {
      // once per attempt (Cloudflare auto-retries)
      if (s.phase !== "failed") {
        s.phase = "failed";
        s.failures++;
      }
    } else if (type === "expired") {
      // asks for a retry, not counted
      if (s.phase !== "failed") s.phase = "failed";
    } else if (type === "rendered") s.visible = height > 0;
    if (s.phase === "checking" && !s.visible) {
      if (!tsTimer)
        tsTimer = setTimeout(function () {
          tsTimer = null;
          captchaToken = "";
          setSubmitEnabled(false);
          tsEvent("timeout");
        }, TS_SILENT_MS);
    } else if (tsTimer) {
      // a visible checkbox waits for the visitor; Cloudflare's own timeout applies
      clearTimeout(tsTimer);
      tsTimer = null;
    }
    tsRender();
  }
  function ensureTurnstile() {
    if (tsFrame) return;
    var holder = $("tsFrameSlot");
    var iframe = document.createElement("iframe");
    iframe.id = "tsFrame";
    iframe.src = "/turnstile/?chromeless=1&action=web_signup&theme=light";
    iframe.title = "Security check";
    iframe.setAttribute("scrolling", "no");
    iframe.style.width = TS_MIN_W + "px";
    iframe.style.height = "0px";
    function post(type, extra) {
      var win = iframe.contentWindow;
      if (!win) return;
      var msg = { source: TS_IN, v: TS_V, type: type };
      if (extra) for (var k in extra) msg[k] = extra[k];
      win.postMessage(msg, location.origin); // same-origin (illi.world -> illi.world)
    }
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;
      if (e.source !== iframe.contentWindow) return;
      var d = e.data;
      if (!d || d.source !== TS_OUT || d.v !== TS_V) return;
      if (d.type === "ready") tsReady = true;
      else if (d.type === "rendered") {
        // never narrower than the widget; height follows
        iframe.style.width = Math.max(TS_MIN_W, typeof d.width === "number" && isFinite(d.width) ? Math.ceil(d.width) : 0) + "px";
        if (typeof d.height === "number" && isFinite(d.height)) {
          var h = Math.max(0, Math.ceil(d.height));
          iframe.style.height = h + "px";
          tsEvent("rendered", h);
        }
      } else if (d.type === "token") {
        if (typeof d.token === "string") {
          captchaToken = d.token;
          setSubmitEnabled(true);
          tsEvent("token");
        }
      } else if (d.type === "expired" || d.type === "error" || d.type === "timeout") {
        captchaToken = "";
        setSubmitEnabled(false);
        tsEvent(d.type);
      }
    });
    iframe.addEventListener("load", function () {
      post("init", { theme: "light", action: "web_signup", chromeless: true });
    });
    holder.appendChild(iframe);
    tsFrame = {
      reset: function () {
        post("reset");
        tsEvent("retry");
      },
      // the visitor's "Try again": reload the frame if it never came up, else re-run the live widget
      retry: function () {
        if (!tsReady) iframe.src = iframe.src;
        else post("reset");
        tsEvent("retry");
      },
    };
    tsEvent("retry"); // first check: the pending line and the silent-timeout clock
  }
  function resetTurnstile() {
    captchaToken = "";
    setSubmitEnabled(false);
    if (tsFrame) tsFrame.reset();
  }
  $("checkRetry").addEventListener("click", function () {
    captchaToken = "";
    setSubmitEnabled(false);
    if (tsFrame) tsFrame.retry();
  });

  /* ---------- one-time code: the email step, then the code step ---------- */
  var otpEmail = $("otpEmail"),
    otpCode = $("otpCode"),
    otpVerify = $("otpVerify"),
    otpEmailStep = $("otpEmailStep"),
    otpCodeStep = $("otpCodeStep"),
    otpEmailError = $("otpEmailError"),
    otpCodeError = $("otpCodeError"),
    otpEmailEcho = $("otpEmailEcho"),
    otpLinks = $("otpLinks");
  var otpEmailValue = "",
    otpBusy = false;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function showErr(el, field, m) {
    el.textContent = m || "";
    el.hidden = !m;
    field.setAttribute("aria-invalid", m ? "true" : "false");
  }
  function showEmailErr(m) {
    showErr(otpEmailError, otpEmail, m);
  }
  function showCodeErr(m) {
    showErr(otpCodeError, otpCode, m);
  }
  function goCodeStep() {
    otpEmailStep.hidden = true;
    otpCodeStep.hidden = false;
    otpSubmit.hidden = true;
    otpVerify.hidden = false;
    otpLinks.hidden = false;
    modal.setAttribute("aria-labelledby", "smCodeHeading");
    otpEmailEcho.textContent = otpEmailValue;
    otpCode.value = "";
    setTimeout(function () {
      try {
        otpCode.focus();
      } catch (e) {}
    }, 60);
  }
  function goEmailStep() {
    otpCodeStep.hidden = true;
    otpEmailStep.hidden = false;
    otpVerify.hidden = true;
    otpLinks.hidden = true;
    otpSubmit.hidden = false;
    modal.setAttribute("aria-labelledby", "smHeading");
    showCodeErr("");
    setTimeout(function () {
      try {
        otpEmail.focus();
        otpEmail.select();
      } catch (e) {}
    }, 60);
    resetTurnstile(); // mint a fresh token for the next send
  }
  function sendOtp() {
    if (otpBusy) return;
    var email = (otpEmail.value || "").trim();
    if (!EMAIL_RE.test(email)) {
      showEmailErr("Enter a valid email address.");
      otpEmail.focus();
      return;
    }
    if (!captchaToken) {
      showEmailErr("Just a moment, finishing the security check.");
      return;
    }
    showEmailErr("");
    otpBusy = true;
    setSubmitEnabled(false);
    var prev = otpSubmit.textContent;
    otpSubmit.textContent = "Sending…";
    getSupabase()
      .then(function (sb) {
        return sb.auth.signInWithOtp({ email: email, options: { captchaToken: captchaToken } });
      })
      .then(function (out) {
        otpBusy = false;
        otpSubmit.textContent = prev || "Continue";
        captchaToken = ""; // consumed by the send (single-use)
        if (out && out.error) {
          showEmailErr("Something went wrong. Try again.");
          resetTurnstile();
          return;
        }
        otpEmailValue = email;
        goCodeStep();
        if (tsFrame) tsFrame.reset(); // pre-mint a fresh token for a possible Resend
      })
      .catch(function () {
        otpBusy = false;
        otpSubmit.textContent = prev || "Continue";
        showEmailErr("Something went wrong. Try again.");
        resetTurnstile();
      });
  }
  function verifyOtp() {
    if (otpBusy) return;
    var code = (otpCode.value || "").trim();
    if (!/^\d{6}$/.test(code)) {
      showCodeErr("Invalid code. Try again.");
      otpCode.focus();
      return;
    }
    showCodeErr("");
    otpBusy = true;
    var prev = otpVerify.textContent;
    otpVerify.disabled = true;
    otpVerify.textContent = "Verifying…";
    getSupabase()
      .then(function (sb) {
        return sb.auth.verifyOtp({ email: otpEmailValue, token: code, type: "email" });
      })
      .then(function (out) {
        otpBusy = false;
        otpVerify.disabled = false;
        otpVerify.textContent = prev || "Verify";
        if (out && out.error) {
          showCodeErr("Invalid code. Try again.");
          otpCode.focus();
          otpCode.select();
          return;
        }
        if (!(out && out.data && out.data.session)) {
          showCodeErr("Something went wrong. Try again.");
          return;
        }
        onSignedIn();
      })
      .catch(function () {
        otpBusy = false;
        otpVerify.disabled = false;
        otpVerify.textContent = prev || "Verify";
        showCodeErr("Something went wrong. Try again.");
      });
  }
  function resendOtp() {
    var email = otpEmailValue;
    if (!email) {
      goEmailStep();
      return;
    }
    if (!captchaToken) {
      showCodeErr("Just a moment, finishing the security check.");
      return;
    }
    showCodeErr("");
    getSupabase()
      .then(function (sb) {
        return sb.auth.signInWithOtp({ email: email, options: { captchaToken: captchaToken } });
      })
      .then(function (out) {
        captchaToken = "";
        resetTurnstile();
        if (out && out.error) showCodeErr("Could not resend. Try again.");
      })
      .catch(function () {
        showCodeErr("Could not resend. Try again.");
        resetTurnstile();
      });
  }
  /* signed in on this page: close the dialog, load the account, repaint */
  function onSignedIn() {
    signedIn = true;
    closeSignup();
    paintCustomer();
    showStub("You’re signed in. Pick a plan below.", null, 6000);
    currentSession()
      .then(function (cs) {
        if (cs.session) return readCustomerProfile(cs.sb, cs.session.user.id);
      })
      .catch(function () {
        showStub("You’re signed in, but we couldn’t load your plan. Refresh before choosing a payment option.", "error");
      });
  }
  $("otpForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!otpCodeStep.hidden) verifyOtp();
    else sendOtp();
  });
  $("otpDiff").addEventListener("click", goEmailStep);
  $("otpResend").addEventListener("click", resendOtp);
  otpEmail.addEventListener("input", function () {
    showEmailErr("");
  });
  otpCode.addEventListener("input", function () {
    otpCode.value = otpCode.value.replace(/\D/g, "").slice(0, 6);
    showCodeErr("");
  });
  $("smClose").addEventListener("click", closeSignup);
  $("smScrim").addEventListener("click", closeSignup);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closeSignup();
  });
  // keep focus inside the dialog
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || modal.hidden) return;
    var nodes = Array.from(modal.querySelectorAll("button:not(:disabled),input:not(:disabled),a[href],iframe")).filter(function (n) {
      return n.getClientRects().length && n.offsetHeight > 0;
    });
    if (!nodes.length) return;
    if (e.shiftKey && document.activeElement === nodes[0]) {
      e.preventDefault();
      nodes[nodes.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) {
      e.preventDefault();
      nodes[0].focus();
    }
  });

  /* ---------- install: the store link on a computer. A phone or tablet cannot install a Chrome extension, so there every install
     button opens the send-to-computer form in place (the live send-to-desktop function and the home page's messages). ---------- */
  var sendForm = $("sendForm"),
    sendEmail = $("sendEmail"),
    sendStatus = $("sendStatus"),
    heroInstall = $("heroInstall");
  var SEND_MESSAGES = {
    sent: "Sent. Open the email on your computer and you’re one click from installing.",
    invalid_email: "That doesn’t look like an email address. Check it and try again.",
    disposable_email: "That address looks temporary. Use one you’ll open at your computer.",
    already_sent: "We already sent the link to that address today. Check your inbox, and the spam folder just in case.",
    rate_limited: "Too many requests from this connection for now. Please try again in an hour.",
    busy: "The form is busy right now. Please try again later.",
    failed: "The email didn’t go out. Please try again in a minute.",
  };
  if (isMobile) {
    body.setAttribute("data-device", "phone");
    document.querySelectorAll("[data-install-label-phone]").forEach(function (a) {
      a.textContent = a.getAttribute("data-install-label-phone");
    });
    document.querySelectorAll("[data-install]").forEach(function (a) {
      a.removeAttribute("target");
      a.addEventListener("click", function (e) {
        e.preventDefault();
        sendForm.hidden = false;
        heroInstall.hidden = true;
        sendForm.scrollIntoView({ block: "center" });
        sendEmail.focus({ preventScroll: true });
      });
    });
  }
  function setSendStatus(text, isError) {
    sendStatus.textContent = text;
    sendStatus.classList.toggle("is-error", !!isError);
    sendEmail.setAttribute("aria-invalid", isError ? "true" : "false");
  }
  sendForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var button = sendForm.querySelector('button[type="submit"]');
    var email = sendEmail.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setSendStatus(SEND_MESSAGES.invalid_email, true);
      sendEmail.focus();
      return;
    }
    button.disabled = true;
    setSendStatus("Sending…", false);
    fetch(SEND_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, website: $("sendWebsite").value }),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { ok: res.ok && data.ok === true, error: data.error };
          });
      })
      .then(function (r) {
        if (r.ok) {
          sendForm.classList.add("is-sent");
          setSendStatus(SEND_MESSAGES.sent, false);
          return;
        }
        button.disabled = false;
        setSendStatus(SEND_MESSAGES[r.error] || SEND_MESSAGES.failed, r.error === "invalid_email" || r.error === "disposable_email");
      })
      .catch(function () {
        button.disabled = false;
        setSendStatus(SEND_MESSAGES.failed, false);
      });
  });

  /* ---------- wiring ---------- */
  document.querySelectorAll("[data-buy]").forEach(function (button) {
    button.addEventListener("click", function () {
      startCheckout(button.dataset.buy, button.dataset.interval, button);
    });
  });
  $("manageBilling").addEventListener("click", openBilling);
  $("signInButton").addEventListener("click", openSignup);
  $("haveSignIn").addEventListener("click", openSignup);
  $("manageSignIn").addEventListener("click", openSignup);
  $("bannerClose").addEventListener("click", function () {
    bannerDismissed = true; // hidden for this visit
    $("foundingBanner").hidden = true;
  });
  $("foundingChoice").addEventListener("change", function (event) {
    if (event.target.name === "foundingYears") $("renewalConsent").checked = false;
    paintCustomer();
  });
  $("foundingChoice").addEventListener("submit", function (e) {
    e.preventDefault();
  });
  $("cancelRenewal").addEventListener("click", function () {
    manageRenewal("cancel");
  });
  $("managePayment").addEventListener("click", function () {
    manageRenewal("payment_method");
  });

  paintCustomer();
  Promise.resolve(redeemPromise)
    .then(getSupabase)
    .then(function (sb) {
      return sb.auth.getSession().then(function (out) {
        signedIn = !!out.data.session;
        paintCustomer();
        if (out.data.session) return readCustomerProfile(sb, out.data.session.user.id);
      });
    })
    .catch(function () {
      signedIn = false;
      paintCustomer();
      showStub("We couldn’t restore your account. Sign in again before choosing a plan.", "error");
    });
  window.illiOffer.ready.then(paintCustomer);
  document.addEventListener("illi-offer-updated", paintCustomer);
})();
