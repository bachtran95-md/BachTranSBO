// Production recovery stub.
// The compact cockpit UI is intentionally disabled after the 2026-09-20 regression.
// Keep this file side-effect free so older cached index.html versions that still load
// cockpit.js cannot enter the previous MutationObserver feedback loop.
(() => {
  "use strict";
  window.BACH_SBO_COCKPIT_DISABLED = true;
})();
