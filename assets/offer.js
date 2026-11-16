(function () {
  "use strict";
  const endpoint =
    "https://wbobpjzkasbnkxbiiioe.supabase.co/functions/v1/pricing-info";
  function validOffer(data) {
    return (
      data?.offer_version === "broad-2026-10-renewing" &&
      data.currency === "usd" &&
      data.trial_days === 45 &&
      Array.isArray(data.free_features) &&
      data.free_features.length === 1 &&
      data.free_features[0] === "speed" &&
      data.prices?.standard?.monthly === 10 &&
      data.prices?.standard?.annual === 100 &&
      data.prices?.founding?.annual === 40 &&
      data.prices?.founding?.two_year === 80 &&
      data.prices?.founding?.renewal_annual === 100 &&
      data.renewal?.automatic === true &&
      data.renewal?.annual === 100 &&
      data.renewal?.currency === "usd"
    );
  }
  function campaignOpen(data, now = Date.now()) {
    const f = data?.founding;
    const start = Date.parse(f?.starts_at),
      end = Date.parse(f?.ends_at),
      cutoff = Date.parse(f?.checkout_closes_at);
    return (
      validOffer(data) &&
      f?.status === "active" &&
      Number.isInteger(f.remaining) &&
      f.remaining > 0 &&
      f.remaining <= 1000 &&
      f.cap === 1000 &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      Number.isFinite(cutoff) &&
      start <= now &&
      cutoff > now &&
      cutoff <= end - 30 * 60000 &&
      end > start
    );
  }
  function paintCampaign(data) {
    const open = campaignOpen(data),
      f = data?.founding;
    document.querySelectorAll("[data-founding-action]").forEach((el) => {
      el.hidden = !open;
      if ("disabled" in el) el.disabled = !open;
    });
    let label =
      "The founding offer is not open yet. You can start your free trial without reserving a place.";
    if (open) {
      const date = new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(f.checkout_closes_at));
      label = `${f.remaining.toLocaleString("en-US")} of 1,000 places currently available. Start checkout by ${date} UTC, while places remain. Checkout holds a place briefly.`;
    } else if (f?.status === "sold_out")
      label =
        "No founding places are currently available. Standard illi Premium plans remain available.";
    else if (f?.status === "ended")
      label =
        "The founding campaign has ended. Standard illi Premium plans remain available.";
    else if (f?.status === "closing")
      label =
        "New founding checkouts have closed. If you already opened checkout, complete it before the campaign deadline shown there.";
    else if (f?.status === "scheduled")
      label =
        "The founding offer has not started yet. You can start your trial now; a trial does not reserve a place.";
    else if (!data)
      label =
        "We couldn’t check founding availability. Refresh to try again; no purchase has been started.";
    document.querySelectorAll("[data-campaign-status]").forEach((el) => {
      el.textContent = label;
    });
    document.dispatchEvent(new Event("illi-offer-updated"));
    return data;
  }
  const api = {
    validOffer,
    campaignOpen,
    data: null,
    async refresh() {
      try {
        const response = await fetch(endpoint, {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("pricing unavailable");
        const data = await response.json();
        api.data = validOffer(data) ? data : null;
        paintCampaign(api.data);
        return api.data;
      } catch (_) {
        api.data = null;
        paintCampaign(null);
        return null;
      }
    },
  };
  window.illiOffer = api;
  api.ready = api.refresh();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) api.refresh();
  });
  // Phones and tablets: the pricing page handles its own install buttons (upgrade.js opens the send-to-desktop form in place).
})();
