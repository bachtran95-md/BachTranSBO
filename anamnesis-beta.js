(() => {
  "use strict";

  const STORAGE_KEY = "bachtransbo_beta_anamnesis_v1";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));

  const aiIcon = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      <rect x="10.4" y="2.6" width="3.2" height="9.2" rx="1.6"/>
      <rect x="10.4" y="12.2" width="3.2" height="9.2" rx="1.6"/>
      <rect x="10.4" y="2.6" width="3.2" height="9.2" rx="1.6" transform="rotate(60 12 12)"/>
      <rect x="10.4" y="12.2" width="3.2" height="9.2" rx="1.6" transform="rotate(60 12 12)"/>
      <rect x="10.4" y="2.6" width="3.2" height="9.2" rx="1.6" transform="rotate(120 12 12)"/>
      <rect x="10.4" y="12.2" width="3.2" height="9.2" rx="1.6" transform="rotate(120 12 12)"/>
    </g>
  </svg>`;

  function emptyState() {
    return {
      label: "",
      complaint: "",
      sources: [],
      events: [],
      final: {
        complaint: "",
        diseases: "",
        historyHtml: "",
        allergies: "Gyógyszerallergia: dokumentációból nem megállapítható.",
        discrepancies: ""
      },
      meds: []
    };
  }

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return {
        ...emptyState(),
        ...parsed,
        final: { ...emptyState().final, ...(parsed.final || {}) },
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        meds: Array.isArray(parsed.meds) ? parsed.meds : []
      };
    } catch {
      return emptyState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const status = $("anamnesisSaveState");
    if (status) {
      status.textContent = "Helyben mentve " + new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    }
  }

  function toast(message) {
    let el = document.querySelector(".anamnesis-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "anamnesis-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(window.__anamnesisToast);
    window.__anamnesisToast = setTimeout(() => el.classList.remove("show"), 1900);
  }

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  }

  function sourceHeading(s) {
    const date = s.date || "Dátum nincs megadva";
    const name = s.name || s.kind || "Forrás";
    return date + " · " + name;
  }

  function eventHeading(e) {
    const date = e.date || "Dátum?";
    const place = e.place || "Intézmény / osztály?";
    return e.doctor ? date + " — " + e.doctor + ", " + place + " —" : date + " — " + place + " —";
  }

  function renderShell() {
    const root = $("anamnesisView");
    if (!root) return;
    root.classList.add("anamnesis-module");
    root.innerHTML = `
      <div class="an-shell">
        <div class="an-head">
          <div>
            <div class="an-kicker">BachTranSBO Beta · Anamnézis</div>
            <h1>Longitudinális anamnézis összeállítása</h1>
            <div class="an-subtle">Források → események → szerkeszthető végleges anamnézis</div>
          </div>
          <div class="an-pilot"><b>Beta teszt.</b> Az Anamnézis AI gombok az autentikált szerveroldali OpenAI API-t használják. A munkalap tartós Supabase-mentése külön következő lépés.</div>
        </div>

        <div class="an-patient">
          <div>
            <label class="an-caption">Munkalap neve</label>
            <input id="anamnesisLabel" value="${esc(state.label)}" placeholder="Pl. 04 – belgyógyászat" />
          </div>
          <div>
            <label class="an-caption">Aktuális panasz / felvétel oka</label>
            <input id="anamnesisComplaint" value="${esc(state.complaint)}" placeholder="Pl. dyspnoe, oedema" />
          </div>
          <div class="an-save"><span class="an-save-dot"></span><span id="anamnesisSaveState">Helyi autosave</span></div>
        </div>

        <div class="an-grid">
          <section class="an-panel">
            <div class="an-panel-h">
              <div><div class="an-step">1. LÉPÉS</div><div class="an-title">Források</div><div class="an-subtle">PDF / dokumentum / beillesztett szöveg</div></div>
              <span class="an-chip blue" id="anamnesisSourceCount"></span>
            </div>
            <div class="an-panel-b">
              <div class="an-hint">Ha egy feltöltött PDF-ben az anamnézis már nagyon jó, jelöld azon a dokumentumon a <b>MEGŐRZÉS / MIN. VÁLTOZTATÁS</b> módot. Egyszerre egy referenciaforrás aktív.</div>
              <div class="an-source-actions">
                <button class="btn small" id="anamnesisUploadBtn" type="button">+ PDF / KÉP</button>
                <button class="btn small" id="anamnesisTextSourceBtn" type="button">+ SZÖVEG</button>
                <button class="btn small" id="anamnesisClipboardBtn" type="button">📋 VÁGÓLAP</button>
                <input class="hidden" id="anamnesisFileInput" type="file" accept=".pdf,image/*" multiple />
              </div>
              <div class="an-source-list" id="anamnesisSourceList"></div>
              <div class="an-ai-row">
                <button class="an-ai" id="anamnesisExtractBtn" type="button">${aiIcon}<span>AI KINYERÉS</span></button>
                <span class="an-subtle">Valódi API-hívás. Jelenleg a forráskártyába beírt / beillesztett szöveget dolgozza fel.</span>
              </div>
            </div>
          </section>

          <section class="an-panel">
            <div class="an-panel-h">
              <div><div class="an-step">2. LÉPÉS</div><div class="an-title">Események és kivonatok</div><div class="an-subtle">Munkanézet: újabb → régebbi</div></div>
              <span class="an-chip green" id="anamnesisEventCount"></span>
            </div>
            <div class="an-panel-b">
              <div class="an-hint">A részletességi gomb és a saját utasítás <b>csak az adott eseményre</b> vonatkozik. Gépelés közben nincs API-hívás.</div>
              <div class="an-event-list" id="anamnesisEventList"></div>
              <div class="an-ai-row">
                <button class="an-ai" id="anamnesisCompileBtn" type="button">${aiIcon}<span>AI ÖSSZEÁLLÍTÁS</span></button>
              </div>
            </div>
          </section>

          <section class="an-panel an-sticky">
            <div class="an-panel-h">
              <div><div class="an-step">3. LÉPÉS</div><div class="an-title">Végleges anamnézis</div><div class="an-subtle">Kézzel szerkeszthető · régebbi → újabb</div></div>
              <span class="an-chip purple">DRAFT</span>
            </div>
            <div class="an-panel-b">
              <div class="an-final-note">A kézi módosítások a jelenlegi draftban elsőbbséget élveznek. <b>AI FRISSÍTÉS</b> csak explicit megerősítés után építi újra az Anamnézis részt.</div>

              <div class="an-final-section">
                <div class="an-final-title">Aktuális panasz / felvétel oka</div>
                <textarea id="anamnesisFinalComplaint"></textarea>
              </div>
              <div class="an-final-section">
                <div class="an-final-title">Ismert betegségek</div>
                <textarea id="anamnesisDiseases"></textarea>
              </div>
              <div class="an-final-section">
                <div class="an-final-title"><span>Anamnézis</span><span class="an-chip green">régebbi → újabb</span></div>
                <div class="an-history-editor" id="anamnesisHistoryEditor" contenteditable="true" spellcheck="false"></div>
              </div>
              <div class="an-final-section">
                <div class="an-final-title"><span>Gyógyszerelés</span><button class="btn small" id="anamnesisAddMedBtn" type="button">+ GYÓGYSZER</button></div>
                <div class="an-med-list" id="anamnesisMedList"></div>
                <div class="an-subtle" style="margin-top:5px">Csak gyógyszer neve + dózis. Másoláskor egy sorba kerülnek.</div>
              </div>
              <div class="an-final-section">
                <div class="an-final-title">Allergiák / CAVE</div>
                <textarea id="anamnesisAllergies"></textarea>
              </div>
              <div class="an-final-section">
                <div class="an-final-title">Ellenőrizendő eltérések</div>
                <textarea id="anamnesisDiscrepancies" placeholder="Pl. eltérő EF, gyógyszerlista, dátum..."></textarea>
              </div>
              <div class="an-final-actions">
                <button class="btn" id="anamnesisCopyBtn" type="button">MÁSOLÁS</button>
                <button class="an-ai" id="anamnesisRefreshFinalBtn" type="button">${aiIcon}<span>AI FRISSÍTÉS</span></button>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    bindStaticControls();
    renderSources();
    renderEvents();
    renderFinal();
  }

  function renderSources() {
    const list = $("anamnesisSourceList");
    if (!list) return;
    $("anamnesisSourceCount").textContent = state.sources.length + " forrás";
    if (!state.sources.length) {
      list.innerHTML = '<div class="an-empty">Még nincs forrás. Tölts fel PDF-et/képet vagy adj hozzá szöveget.</div>';
      return;
    }
    list.innerHTML = state.sources.map((s) => `
      <div class="an-card ${s.preserve ? "reference" : ""}" data-an-source="${esc(s.id)}">
        <div class="an-card-h">
          <div>
            <div class="an-card-title">${esc(sourceHeading(s))}</div>
            <div class="an-card-meta">${esc(s.kind || "Forrás")}${s.fileName ? " · " + esc(s.fileName) : ""}</div>
          </div>
          <div class="an-card-actions">
            <button class="an-preserve ${s.preserve ? "active" : ""}" type="button" data-an-preserve>${s.preserve ? "✓ MEGŐRZÉS AKTÍV" : "MEGŐRZÉS / MIN. VÁLTOZTATÁS"}</button>
            <button class="an-delete" type="button" data-an-delete-source title="Forrás törlése">×</button>
          </div>
        </div>
        <div class="an-card-b">
          <div class="an-source-fields">
            <input data-an-source-date value="${esc(s.date || "")}" placeholder="YYYY.MM.DD" />
            <input data-an-source-place value="${esc(s.place || "")}" placeholder="Intézmény / osztály" />
          </div>
          <textarea data-an-source-text placeholder="${s.kind === "PDF" ? "PDF feltöltve. Ebben a Beta-körben illeszd ide a PDF releváns szövegét / epikrízisét; a közvetlen PDF-text extraction külön bekötés alatt." : "Forrásszöveg / epikrízis..."}">${esc(s.text || "")}</textarea>
          ${s.preserve ? '<div class="an-preserve-note"><b>Referencia anamnézis.</b> A későbbi AI-feldolgozás ennek jó megfogalmazását, kronológiáját és relatív részletességét tartja meg; főként formátumot egységesít és szükséges tényekkel egészít ki.</div>' : ""}
        </div>
      </div>
    `).join("");
  }

  function renderEvents() {
    const list = $("anamnesisEventList");
    if (!list) return;
    $("anamnesisEventCount").textContent = state.events.length + " esemény";
    if (!state.events.length) {
      list.innerHTML = '<div class="an-empty">Még nincs esemény. Adj hozzá forrásszöveget, majd nyomd meg az AI KINYERÉS gombot.</div>';
      return;
    }
    list.innerHTML = state.events.map((e) => {
      const modes = [["minimal","MINIMÁL"],["shorter","RÖVIDEBB"],["longer","HOSSZABB"],["detailed","RÉSZLETES"]];
      return `
        <div class="an-card ${e.preserve ? "reference" : ""}" data-an-event="${esc(e.id)}">
          <div class="an-card-h">
            <div><div class="an-card-title">${esc(eventHeading(e))}</div><div class="an-card-meta">${e.preserve ? "Referenciaforrásból" : "Normál esemény"}</div></div>
            ${e.preserve ? '<span class="an-chip purple">MEGŐRZÉS</span>' : '<span class="an-chip">ESEMÉNY</span>'}
          </div>
          <div class="an-card-b">
            <textarea data-an-event-text>${esc(e.text || "")}</textarea>
            <div class="an-segmented">
              ${modes.map(([key,label]) => '<button class="an-seg '+(e.detail===key?"active":"")+'" type="button" data-an-detail="'+key+'">'+label+'</button>').join("")}
            </div>
            <label class="an-caption">Saját utasítás · csak ehhez az eseményhez</label>
            <input data-an-instruction value="${esc(e.instruction || "")}" placeholder="Pl. Ezt rövidítsd 2 mondatra." />
            <div class="an-inline-actions">
              <span class="an-subtle">Nincs automatikus API-hívás.</span>
              <button class="an-ai" type="button" data-an-rewrite>${aiIcon}<span>AI ÁTÍRÁS</span></button>
            </div>
          </div>
        </div>`;
    }).join("");
  }

  function renderFinal() {
    const complaint = $("anamnesisFinalComplaint");
    const diseases = $("anamnesisDiseases");
    const history = $("anamnesisHistoryEditor");
    const allergies = $("anamnesisAllergies");
    const discrepancies = $("anamnesisDiscrepancies");
    if (complaint) complaint.value = state.final.complaint || state.complaint || "";
    if (diseases) diseases.value = state.final.diseases || "";
    if (history) history.innerHTML = state.final.historyHtml || "";
    if (allergies) allergies.value = state.final.allergies || "";
    if (discrepancies) discrepancies.value = state.final.discrepancies || "";
    renderMeds();
  }

  function renderMeds() {
    const list = $("anamnesisMedList");
    if (!list) return;
    if (!state.meds.length) {
      list.innerHTML = '<div class="an-empty">Nincs gyógyszer hozzáadva.</div>';
      return;
    }
    list.innerHTML = state.meds.map((m,i) => `
      <div class="an-med-row" data-an-med="${i}">
        <input data-an-med-name value="${esc(m.name || "")}" placeholder="Gyógyszer neve" />
        <input data-an-med-dose value="${esc(m.dose || "")}" placeholder="Dózis" />
        <button class="an-delete" type="button" data-an-delete-med title="Törlés">×</button>
      </div>
    `).join("");
  }

  async function runAiButton(button, busyLabel, work) {
    if (!button || button.disabled) return;
    const label = button.querySelector("span");
    const original = label?.textContent || "";
    button.disabled = true;
    if (label) label.textContent = busyLabel;
    try {
      return await work();
    } catch (error) {
      console.error("Anamnesis AI:", error);
      toast(error?.message || "Anamnézis AI hiba.");
      return null;
    } finally {
      button.disabled = false;
      if (label) label.textContent = original;
    }
  }

  function requireAnamnesisBackend() {
    const api = window.BachSBOBackend?.anamnesisAi;
    if (typeof api !== "function") {
      throw new Error("Az Anamnézis AI backend nem érhető el. Frissítsd az oldalt.");
    }
    return api;
  }

  function finalHistoryHtml(events) {
    return (events || []).map((e) => {
      const heading = eventHeading(e);
      return '<span class="an-history-line"><strong>' + esc(heading) + '</strong> ' + esc(e.text || "") + '</span>';
    }).join("");
  }

  async function extractWithAi(button) {
    const usable = state.sources.filter((s) => String(s.text || "").trim());
    if (!usable.length) {
      const hasPdf = state.sources.some((s) => s.kind === "PDF");
      toast(hasPdf
        ? "A PDF-kártyába még nincs forrásszöveg beillesztve."
        : "Nincs feldolgozható forrásszöveg.");
      return;
    }

    await runAiButton(button, "FELDOLGOZÁS…", async () => {
      const api = requireAnamnesisBackend();
      const result = await api({
        action: "extract",
        complaint: state.complaint || "",
        sources: usable.map((s) => ({
          id: s.id,
          kind: s.kind || "",
          name: s.name || "",
          date: s.date || "",
          place: s.place || "",
          preserve: Boolean(s.preserve),
          text: s.text || ""
        }))
      });

      const sourceById = new Map(state.sources.map((s) => [s.id, s]));
      state.events = (Array.isArray(result?.events) ? result.events : []).map((e) => {
        const sourceIds = Array.isArray(e.source_ids) ? e.source_ids : [];
        const sourceId = sourceIds[0] || "";
        const preserve = sourceIds.some((id) => Boolean(sourceById.get(id)?.preserve));
        return {
          id: uid("event"),
          sourceId,
          sourceIds,
          date: String(e.date || ""),
          place: String(e.place || ""),
          doctor: String(e.doctor || ""),
          preserve,
          detail: ["minimal","shorter","longer","detailed"].includes(e.detail) ? e.detail : (preserve ? "longer" : "shorter"),
          instruction: "",
          text: String(e.text || "")
        };
      }).sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")));

      const diseases = Array.isArray(result?.known_diseases) ? result.known_diseases.filter(Boolean) : [];
      if (diseases.length) state.final.diseases = diseases.join(". ");
      if (Array.isArray(result?.medications) && result.medications.length) {
        state.meds = result.medications
          .filter((m) => String(m?.name || "").trim())
          .map((m) => ({ name:String(m.name || ""), dose:String(m.dose || "") }));
      }
      if (String(result?.allergies_cave || "").trim()) {
        state.final.allergies = String(result.allergies_cave).trim();
      }
      if (Array.isArray(result?.discrepancies)) {
        state.final.discrepancies = result.discrepancies.filter(Boolean).join("\n");
      }

      renderEvents();
      renderFinal();
      saveState();
      toast("AI kinyerés elkészült.");
    });
  }

  function currentFinalPayload() {
    return {
      complaint: $("anamnesisFinalComplaint")?.value || state.final.complaint || state.complaint || "",
      known_diseases: $("anamnesisDiseases")?.value || state.final.diseases || "",
      history: $("anamnesisHistoryEditor")?.innerText || "",
      allergies_cave: $("anamnesisAllergies")?.value || state.final.allergies || "",
      discrepancies: $("anamnesisDiscrepancies")?.value || state.final.discrepancies || ""
    };
  }

  async function compileWithAi(button, mode = "compile") {
    if (!state.events.length) {
      toast("Nincs összeállítható esemény.");
      return;
    }
    if (mode === "refresh" && state.final.historyHtml) {
      const ok = window.confirm("Az AI a jelenlegi kézi szerkesztéseket figyelembe véve frissíti a végleges draftot. Folytatod?");
      if (!ok) return;
    }

    await runAiButton(button, mode === "refresh" ? "FRISSÍTÉS…" : "ÖSSZEÁLLÍTÁS…", async () => {
      const api = requireAnamnesisBackend();
      const result = await api({
        action: mode,
        complaint: state.complaint || "",
        events: state.events.map((e) => ({
          date:e.date || "",
          place:e.place || "",
          doctor:e.doctor || "",
          text:e.text || "",
          preserve:Boolean(e.preserve),
          detail:e.detail || "shorter",
          instruction:e.instruction || ""
        })),
        medications: state.meds.map((m) => ({name:m.name || "", dose:m.dose || ""})),
        currentFinal: currentFinalPayload()
      });

      state.final.complaint = String(result?.complaint || state.complaint || "");
      state.final.diseases = String(result?.known_diseases || "");
      const finalEvents = Array.isArray(result?.history_events) ? result.history_events.map((e) => ({
        date:String(e.date || ""),
        place:String(e.place || ""),
        doctor:String(e.doctor || ""),
        text:String(e.text || "")
      })) : [];
      state.final.historyHtml = finalHistoryHtml(finalEvents);
      if (Array.isArray(result?.medications)) {
        state.meds = result.medications
          .filter((m) => String(m?.name || "").trim())
          .map((m) => ({name:String(m.name || ""), dose:String(m.dose || "")}));
      }
      state.final.allergies = String(result?.allergies_cave || state.final.allergies || "");
      state.final.discrepancies = String(result?.discrepancies || "");

      renderFinal();
      saveState();
      toast(mode === "refresh" ? "AI frissítés elkészült." : "AI összeállítás elkészült.");
    });
  }

  async function rewriteEventWithAi(eventCard, button) {
    const ev = state.events.find((x) => x.id === eventCard?.dataset?.anEvent);
    if (!ev) return;

    await runAiButton(button, "ÁTÍRÁS…", async () => {
      const api = requireAnamnesisBackend();
      const result = await api({
        action: "rewrite_event",
        event: {
          date:ev.date || "",
          place:ev.place || "",
          doctor:ev.doctor || "",
          text:ev.text || "",
          preserve:Boolean(ev.preserve),
          detail:ev.detail || "shorter",
          instruction:ev.instruction || ""
        }
      });
      ev.text = String(result?.text || ev.text || "");
      renderEvents();
      saveState();
      toast("Esemény AI-átírás elkészült.");
    });
  }

  function clipboardText() {
    const historyText = [...state.events]
      .sort((a,b) => String(a.date || "").localeCompare(String(b.date || "")))
      .map((e) => eventHeading(e) + " " + String(e.text || "").trim())
      .join("\n");
    const meds = state.meds.filter((m) => String(m.name || "").trim()).map((m) => (m.name || "").trim() + ((m.dose || "").trim() ? " " + m.dose.trim() : "")).join(", ");
    return [
      "Aktuális panasz / felvétel oka", state.final.complaint || state.complaint || "", "",
      "Ismert betegségek", state.final.diseases || "", "",
      "Anamnézis", historyText, "",
      "Gyógyszerelés", meds || "—", "",
      "Allergiák / CAVE", state.final.allergies || "", "",
      state.final.discrepancies ? "Ellenőrizendő eltérések\n" + state.final.discrepancies : ""
    ].filter((x,idx,arr) => !(x === "" && arr[idx-1] === "")).join("\n");
  }

  function bindStaticControls() {
    $("anamnesisLabel")?.addEventListener("input", (e) => { state.label = e.target.value; saveState(); });
    $("anamnesisComplaint")?.addEventListener("input", (e) => {
      state.complaint = e.target.value;
      if (!state.final.complaint) $("anamnesisFinalComplaint").value = e.target.value;
      saveState();
    });

    $("anamnesisUploadBtn")?.addEventListener("click", () => $("anamnesisFileInput")?.click());
    $("anamnesisFileInput")?.addEventListener("change", (e) => {
      [...(e.target.files || [])].forEach((file) => {
        state.sources.unshift({
          id: uid("source"),
          kind: file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "PDF" : "Kép",
          name: file.name,
          fileName: file.name,
          date: "",
          place: "",
          doctor: "",
          preserve: false,
          text: ""
        });
      });
      e.target.value = "";
      renderSources();
      saveState();
    });

    $("anamnesisTextSourceBtn")?.addEventListener("click", () => {
      state.sources.unshift({id:uid("source"),kind:"Szöveg",name:"Új szöveges forrás",date:"",place:"",doctor:"",preserve:false,text:""});
      renderSources(); saveState();
    });

    $("anamnesisClipboardBtn")?.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) throw new Error("empty");
        state.sources.unshift({id:uid("source"),kind:"Vágólap",name:"Beillesztett szöveg",date:"",place:"",doctor:"",preserve:false,text});
        renderSources(); saveState(); toast("Vágólapszöveg hozzáadva.");
      } catch {
        toast("A böngésző nem engedte a vágólap olvasását.");
      }
    });

    $("anamnesisExtractBtn")?.addEventListener("click", (e) => void extractWithAi(e.currentTarget));
    $("anamnesisCompileBtn")?.addEventListener("click", (e) => void compileWithAi(e.currentTarget, "compile"));
    $("anamnesisRefreshFinalBtn")?.addEventListener("click", (e) => void compileWithAi(e.currentTarget, "refresh"));

    $("anamnesisAddMedBtn")?.addEventListener("click", () => {
      state.meds.push({name:"",dose:""}); renderMeds(); saveState();
      document.querySelector('[data-an-med="'+(state.meds.length-1)+'"] [data-an-med-name]')?.focus();
    });

    $("anamnesisCopyBtn")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(clipboardText()); toast("Anamnézis a vágólapra másolva."); }
      catch { toast("A böngésző nem engedte a vágólap írását."); }
    });

    ["anamnesisFinalComplaint","anamnesisDiseases","anamnesisAllergies","anamnesisDiscrepancies"].forEach((id) => {
      $(id)?.addEventListener("input", (e) => {
        if (id === "anamnesisFinalComplaint") state.final.complaint = e.target.value;
        if (id === "anamnesisDiseases") state.final.diseases = e.target.value;
        if (id === "anamnesisAllergies") state.final.allergies = e.target.value;
        if (id === "anamnesisDiscrepancies") state.final.discrepancies = e.target.value;
        saveState();
      });
    });
    $("anamnesisHistoryEditor")?.addEventListener("input", (e) => { state.final.historyHtml = e.currentTarget.innerHTML; saveState(); });

    $("anamnesisView")?.addEventListener("input", (e) => {
      const sourceCard = e.target.closest?.("[data-an-source]");
      if (sourceCard) {
        const s = state.sources.find((x) => x.id === sourceCard.dataset.anSource);
        if (!s) return;
        if (e.target.matches("[data-an-source-date]")) s.date = e.target.value;
        if (e.target.matches("[data-an-source-place]")) s.place = e.target.value;
        if (e.target.matches("[data-an-source-text]")) s.text = e.target.value;
        saveState();
        return;
      }
      const eventCard = e.target.closest?.("[data-an-event]");
      if (eventCard) {
        const ev = state.events.find((x) => x.id === eventCard.dataset.anEvent);
        if (!ev) return;
        if (e.target.matches("[data-an-event-text]")) ev.text = e.target.value;
        if (e.target.matches("[data-an-instruction]")) ev.instruction = e.target.value;
        saveState();
        return;
      }
      const medRow = e.target.closest?.("[data-an-med]");
      if (medRow) {
        const m = state.meds[Number(medRow.dataset.anMed)];
        if (!m) return;
        if (e.target.matches("[data-an-med-name]")) m.name = e.target.value;
        if (e.target.matches("[data-an-med-dose]")) m.dose = e.target.value;
        saveState();
      }
    });

    $("anamnesisView")?.addEventListener("click", (e) => {
      const sourceCard = e.target.closest?.("[data-an-source]");
      if (sourceCard && e.target.closest("[data-an-preserve]")) {
        const id = sourceCard.dataset.anSource;
        const src = state.sources.find((x) => x.id === id);
        if (!src) return;
        const next = !src.preserve;
        state.sources.forEach((x) => x.preserve = false);
        src.preserve = next;
        state.events.forEach((ev) => ev.preserve = next && ev.sourceId === id);
        renderSources(); renderEvents(); saveState();
        toast(next ? "Referencia anamnézis kijelölve." : "Megőrzési mód kikapcsolva.");
        return;
      }
      if (sourceCard && e.target.closest("[data-an-delete-source]")) {
        const id = sourceCard.dataset.anSource;
        state.sources = state.sources.filter((x) => x.id !== id);
        state.events = state.events.filter((x) => x.sourceId !== id);
        renderSources(); renderEvents(); saveState(); return;
      }

      const eventCard = e.target.closest?.("[data-an-event]");
      if (eventCard && e.target.closest("[data-an-detail]")) {
        const ev = state.events.find((x) => x.id === eventCard.dataset.anEvent);
        if (!ev) return;
        ev.detail = e.target.closest("[data-an-detail]").dataset.anDetail;
        renderEvents(); saveState();
        toast("Részletesség beállítva. Nincs API-hívás.");
        return;
      }
      if (eventCard && e.target.closest("[data-an-rewrite]")) {
        const button = e.target.closest("[data-an-rewrite]");
        void rewriteEventWithAi(eventCard, button);
        return;
      }

      const medRow = e.target.closest?.("[data-an-med]");
      if (medRow && e.target.closest("[data-an-delete-med]")) {
        state.meds.splice(Number(medRow.dataset.anMed),1);
        renderMeds(); saveState();
      }
    });
  }

  function init() {
    if ($("anamnesisView")) renderShell();
    document.addEventListener("bachsbo:ui-rendered", (event) => {
      if (event?.detail?.view === "anamnesis" && $("anamnesisView") && !$("anamnesisView").innerHTML.trim()) {
        renderShell();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();