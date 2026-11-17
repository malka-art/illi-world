/* illi partner links (task 304, 2026-11-16). THE ONE LIST: every name here is a partner link, illi.world/<name>.
   To add a creator: add their short name as one more line below, run   node .tools/partner-pages.cjs   (it makes <name>.html,
   the page that answers illi.world/<name> with status 200 and illi's link-preview card), then publish the site as usual.
   To remove one: delete the line and run the same command (it deletes that page).
   Rules for a name: lowercase letters, digits and hyphens only, 2 to 40 characters, starting and ending with a letter or digit,
   never changed once given out, and never the name of an existing page or folder (upgrade, pricing, welcome, feedback, fr, ...).
   The command refuses a name that breaks them, and .qa/partners-check.cjs checks the pages match this list.

   What a partner link does:
     illi.world/<name>                       -> illi.world/?utm_source=<name>&utm_medium=partner&utm_campaign=partners
     illi.world/<name>?utm_content=film30    -> the same, plus which video or post it was
   Any utm_campaign, utm_content or utm_id already on the link is kept. If <name>.html is missing (the command was not run), or
   the address has capitals or a trailing slash, 404.html still sends a listed name on the same way, with status 404.
   The home page then counts the visit (track.js) and copies the tags onto the Chrome Web Store link, exactly as for any tagged
   link, and only without Global Privacy Control, Do Not Track or "Stop counting my visits". /upgrade passes <name> into checkout
   only if this browser said yes to being remembered, on a wording that mentions payment, on a visit that came through a partner
   link (assets/upgrade.js), and only if <name> is still on this list. */
window.ILLI_PARTNERS = [
];
