(() => {
  "use strict";

  const IMPORTANT_NOTE_KEY = "bachtransbo.beta.important-note.v2";

  function addBetaBadge() {
    const brand = document.querySelector(".brand");
    if (!brand || brand.querySelector(".beta-build-badge")) return;
    const badge = document.createElement("span");
    badge.className = "beta-build-badge";
    badge.textContent = "BETA";
    brand.appendChild(badge);
  }

  function flashNoteStatus(message) {
    const status = document.getElementById("betaImportantNoteStatus");
    if (!status) return;
    const previous = status.textContent;
    status.textContent = message;
    window.setTimeout(() => {
      if (status.isConnected) status.textContent = previous || "Helyileg mentve ezen a böngészőn.";
    }, 1200);
  }

  function readImportantNote() {
    try {
      return window.localStorage.getItem(IMPORTANT_NOTE_KEY) || "";
    } catch {
      return "";
    }
  }

  function writeImportantNote(value) {
    try {
      window.localStorage.setItem(IMPORTANT_NOTE_KEY, String(value || ""));
      return true;
    } catch {
      return false;
    }
  }

  function setupImportantNote() {
    const textarea = document.getElementById("betaImportantNote");
    const copyButton = document.getElementById("betaImportantNoteCopy");
    const clearButton = document.getElementById("betaImportantNoteClear");
    if (!textarea || textarea.dataset.bound === "true") return;

    textarea.dataset.bound = "true";
    textarea.value = readImportantNote();

    textarea.addEventListener("input", () => {
      const ok = writeImportantNote(textarea.value);
      const status = document.getElementById("betaImportantNoteStatus");
      if (status) {
        status.textContent = ok
          ? "Helyileg mentve ezen a böngészőn."
          : "A böngésző nem engedélyezi a helyi mentést.";
      }
    });

    copyButton?.addEventListener("click", async () => {
      const text = textarea.value.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        flashNoteStatus("MÁSOLVA ✓");
      } catch {
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        textarea.setSelectionRange(0, 0);
        flashNoteStatus("MÁSOLVA ✓");
      }
    });

    clearButton?.addEventListener("click", () => {
      textarea.value = "";
      writeImportantNote("");
      textarea.focus();
      flashNoteStatus("TÖRÖLVE");
    });
  }

  function refreshBetaFeatures() {
    addBetaBadge();
    setupImportantNote();
  }

  document.addEventListener("bachsbo:ui-rendered", () => {
    window.setTimeout(refreshBetaFeatures, 0);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshBetaFeatures, { once: true });
  } else {
    refreshBetaFeatures();
  }
})();
