/* illi partner links (task 304, 2026-11-16). THE ONE LIST: every name here is a working partner link, illi.world/<name>.
   To add a creator, add their short name as one more line below, then publish the site as usual. Nothing else changes.
   Rules for a name: lowercase letters, digits and hyphens only, 2 to 40 characters, starting and ending with a letter or digit,
   never changed once given out, and never the name of an existing page or folder (upgrade, pricing, welcome, feedback, fr, ...),
   because those pages answer first. .qa/partners-check.cjs checks these rules.

   What a partner link does (404.html reads this list):
     illi.world/<name>          -> illi.world/?utm_source=<name>&utm_medium=partner&utm_campaign=partners
     illi.world/<name>/<label>  -> the same, plus utm_content=<label> (which video or post; any short label, no list needed)
   Any utm_campaign, utm_content or utm_id already on the link is kept. The home page then counts the visit (track.js) and copies
   the tags onto the Chrome Web Store link, exactly as for any tagged link, and only without Global Privacy Control, Do Not Track
   or "Stop counting my visits". /upgrade passes <name> into checkout only if this browser said yes to being remembered on a
   visit that came through a partner link (assets/upgrade.js), and only if <name> is still on this list.
   Removing a name stops its link (it shows the not-found page) and stops new checkouts carrying it. */
window.ILLI_PARTNERS = [
];
