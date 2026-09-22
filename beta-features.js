(() => {
  "use strict";

  function addBetaBadge() {
    const brand = document.querySelector(".brand");
    if (!brand || brand.querySelector(".beta-build-badge")) return;
    const badge = document.createElement("span");
    badge.className = "beta-build-badge";
    badge.textContent = "BETA";
    brand.appendChild(badge);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addBetaBadge, { once: true });
  } else {
    addBetaBadge();
  }
})();
