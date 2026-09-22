// Compatibility shim for older cached pages that still request cockpit-beta.js.
// Production implementation lives in cockpit.js.
(() => {
  "use strict";

  if (window.__bachSboCockpitInstalled) return;
  if (document.querySelector('script[data-bach-cockpit-compat]')) return;

  const script = document.createElement("script");
  script.src = "cockpit.js?v=stable-cockpit-20260922-1";
  script.async = false;
  script.dataset.bachCockpitCompat = "true";
  document.head.appendChild(script);
})();
