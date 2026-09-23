(() => {
  "use strict";

  const LEGACY_IMPORTANT_NOTE_KEY = "bachtransbo.beta.important-note.v2";
  const saveTimers = new Map();
  let notesLoaded = false;
  let notesLoading = false;

  function addBetaBadge() {
    const brand = document.querySelector(".brand");
    if (!brand || brand.querySelector(".beta-build-badge")) return;
    const badge = document.createElement("span");
    badge.className = "beta-build-badge";
    badge.textContent = "BETA";
    brand.appendChild(badge);
  }

  function backend() {
    return window.BachSBOBackend;
  }

  function setNotesStatus(message, isError = false) {
    const status = document.getElementById("betaNotesStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", Boolean(isError));
  }

  async function copyText(text, fallbackInput) {
    const value = String(text || "").trim();
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      if (fallbackInput) {
        fallbackInput.focus();
        fallbackInput.select();
        document.execCommand("copy");
        fallbackInput.setSelectionRange(0, 0);
        return true;
      }
      return false;
    }
  }

  function noteCard(note) {
    const card = document.createElement("div");
    card.className = "beta-note-snippet beta-note-editable";
    card.dataset.noteId = note.id;

    const head = document.createElement("div");
    head.className = "beta-note-snippet-head";

    const title = document.createElement("input");
    title.className = "beta-note-title";
    title.type = "text";
    title.maxLength = 200;
    title.placeholder = "Jegyzet címe";
    title.value = note.title || "";

    const actions = document.createElement("div");
    actions.className = "toolbar beta-note-card-actions";

    const copy = document.createElement("button");
    copy.className = "btn small";
    copy.type = "button";
    copy.textContent = "MÁSOLÁS";

    const remove = document.createElement("button");
    remove.className = "btn small beta-note-delete";
    remove.type = "button";
    remove.textContent = "TÖRLÉS";

    actions.append(copy, remove);
    head.append(title, actions);

    const content = document.createElement("textarea");
    content.className = "beta-note-content";
    content.maxLength = 50000;
    content.placeholder = "Jegyzet…";
    content.value = note.content || "";

    const footer = document.createElement("div");
    footer.className = "beta-note-item-footer";
    const itemStatus = document.createElement("span");
    itemStatus.className = "subtle beta-note-item-status";
    itemStatus.textContent = "Mentve";
    footer.append(itemStatus);

    card.append(head, content, footer);

    const queueSave = () => {
      const existing = saveTimers.get(note.id);
      if (existing) window.clearTimeout(existing);
      itemStatus.textContent = "Mentés…";
      const timer = window.setTimeout(() => {
        saveTimers.delete(note.id);
        void saveCard(card);
      }, 550);
      saveTimers.set(note.id, timer);
    };

    const flushSave = () => {
      const existing = saveTimers.get(note.id);
      if (!existing) return;
      window.clearTimeout(existing);
      saveTimers.delete(note.id);
      void saveCard(card);
    };

    title.addEventListener("input", queueSave);
    content.addEventListener("input", queueSave);
    title.addEventListener("blur", flushSave);
    content.addEventListener("blur", flushSave);

    copy.addEventListener("click", async () => {
      const ok = await copyText(content.value, content);
      itemStatus.textContent = ok ? "MÁSOLVA ✓" : "Nem másolható";
      window.setTimeout(() => {
        if (card.isConnected) itemStatus.textContent = "Mentve";
      }, 1000);
    });

    remove.addEventListener("click", async () => {
      if (!window.confirm("Törlöd ezt a jegyzetet?")) return;
      const existing = saveTimers.get(note.id);
      if (existing) window.clearTimeout(existing);
      saveTimers.delete(note.id);
      remove.disabled = true;
      itemStatus.textContent = "Törlés…";
      try {
        await backend().deleteNote(note.id);
        card.remove();
        updateEmptyState();
        setNotesStatus("Jegyzet törölve.");
      } catch (error) {
        remove.disabled = false;
        itemStatus.textContent = "Törlési hiba";
        setNotesStatus(error?.message || "A jegyzet törlése sikertelen.", true);
      }
    });

    return card;
  }

  async function saveCard(card) {
    if (!card?.isConnected) return;
    const noteId = card.dataset.noteId;
    const title = card.querySelector(".beta-note-title");
    const content = card.querySelector(".beta-note-content");
    const itemStatus = card.querySelector(".beta-note-item-status");
    if (!noteId || !title || !content) return;

    if (itemStatus) itemStatus.textContent = "Mentés…";
    try {
      await backend().updateNote(noteId, {
        title: title.value,
        content: content.value
      });
      if (itemStatus) itemStatus.textContent = "Mentve";
    } catch (error) {
      if (itemStatus) itemStatus.textContent = "Mentési hiba";
      setNotesStatus(error?.message || "A jegyzet mentése sikertelen.", true);
    }
  }

  function updateEmptyState() {
    const list = document.getElementById("betaNotesList");
    const empty = document.getElementById("betaNotesEmpty");
    if (!list || !empty) return;
    empty.classList.toggle("hidden", Boolean(list.querySelector("[data-note-id]")));
  }

  function renderNotes(notes) {
    const list = document.getElementById("betaNotesList");
    if (!list) return;
    list.innerHTML = "";
    for (const note of notes || []) {
      if (!note?.id) continue;
      list.appendChild(noteCard(note));
    }
    updateEmptyState();
  }

  function readLegacyImportantNote() {
    try {
      return String(window.localStorage.getItem(LEGACY_IMPORTANT_NOTE_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function clearLegacyImportantNote() {
    try {
      window.localStorage.removeItem(LEGACY_IMPORTANT_NOTE_KEY);
    } catch {
      // Ignore unavailable local storage.
    }
  }

  async function migrateLegacyImportantNote(notes) {
    const legacy = readLegacyImportantNote();
    if (!legacy) return notes;

    const existing = (notes || []).find((note) =>
      String(note?.title || "").trim() === "Important note" &&
      String(note?.content || "").trim() === legacy
    );
    if (existing) {
      clearLegacyImportantNote();
      return notes;
    }

    const created = await backend().createNote({
      title: "Important note",
      content: legacy
    });
    clearLegacyImportantNote();
    return created?.note ? [created.note, ...(notes || [])] : notes;
  }

  async function loadNotes(force = false) {
    if (notesLoading || (notesLoaded && !force)) return;
    const api = backend();
    if (!api?.listNotes) return;

    let session = null;
    try {
      session = await api.getSession?.();
    } catch {
      session = null;
    }
    if (!session) return;

    notesLoading = true;
    setNotesStatus("Betöltés…");
    try {
      const result = await api.listNotes();
      const notes = await migrateLegacyImportantNote(result?.notes || []);
      renderNotes(notes);
      notesLoaded = true;
      setNotesStatus(notes.length ? "Automatikus mentés aktív." : "Még nincs jegyzet.");
    } catch (error) {
      setNotesStatus(error?.message || "A jegyzetek betöltése sikertelen.", true);
    } finally {
      notesLoading = false;
    }
  }

  function setupNotes() {
    const addButton = document.getElementById("betaAddNoteBtn");
    const notesNav = document.getElementById("notesNav");

    if (addButton && addButton.dataset.bound !== "true") {
      addButton.dataset.bound = "true";
      addButton.addEventListener("click", async () => {
        addButton.disabled = true;
        setNotesStatus("Új jegyzet létrehozása…");
        try {
          const result = await backend().createNote({
            title: "Új jegyzet",
            content: ""
          });
          const list = document.getElementById("betaNotesList");
          if (list && result?.note) {
            const card = noteCard(result.note);
            list.prepend(card);
            updateEmptyState();
            const title = card.querySelector(".beta-note-title");
            title?.focus();
            title?.select();
          }
          notesLoaded = true;
          setNotesStatus("Automatikus mentés aktív.");
        } catch (error) {
          setNotesStatus(error?.message || "Az új jegyzet létrehozása sikertelen.", true);
        } finally {
          addButton.disabled = false;
        }
      });
    }

    if (notesNav && notesNav.dataset.notesBound !== "true") {
      notesNav.dataset.notesBound = "true";
      notesNav.addEventListener("click", () => {
        window.setTimeout(() => void loadNotes(true), 0);
      });
    }

    void loadNotes();
  }

  function refreshBetaFeatures() {
    addBetaBadge();
    setupNotes();
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
