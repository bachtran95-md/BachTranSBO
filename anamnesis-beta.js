(() => {
  "use strict";

  const STORAGE_PREFIX = "bachtransbo_beta_anamnesis_case_v1:";
  const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const $ = (id) => document.getElementById(id);
  const shortHyphens = (value) => {
    const shared = window.BachSBOShortHyphens;
    return typeof shared === "function"
      ? shared(value)
      : String(value ?? "").replace(/[\u2013\u2014]/g, "-");
  };
  const esc = (value) => shortHyphens(value).replace(/[&<>"']/g, (c) => ({
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
      mode: "balanced",
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

  let activeCaseId = "";
  let activeShiftId = "";
  let state = emptyState();

  function activePatient() {
    return window.BachSBOClinicalUi?.getPatientSnapshot?.() || null;
  }

  function storageKey(caseId = activeCaseId, shiftId = activeShiftId) {
    if (!caseId || !shiftId) return "";
    return STORAGE_PREFIX + String(shiftId) + ":" + String(caseId);
  }

  function hydrateCaseDefaults(nextState, patient) {
    const result = nextState || emptyState();
    if (!patient) return result;
    if (!String(result.label || "").trim()) result.label = String(patient.localId || "");
    if (!String(result.complaint || "").trim()) {
      result.complaint = String(patient.mainComplaint || patient.complaint || "").trim();
    }
    if (!String(result.final?.diseases || "").trim()) {
      result.final.diseases = String(patient.history || "").trim();
    }
    return result;
  }

  function loadStateForCase(patient) {
    if (!patient?.id || !patient?.shiftId) return emptyState();
    activeCaseId = String(patient.id);
    activeShiftId = String(patient.shiftId);
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return hydrateCaseDefaults(emptyState(), patient);
      const parsed = JSON.parse(raw);
      return hydrateCaseDefaults({
        ...emptyState(),
        ...parsed,
        final: { ...emptyState().final, ...(parsed.final || {}) },
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        meds: Array.isArray(parsed.meds) ? parsed.meds : []
      }, patient);
    } catch {
      return hydrateCaseDefaults(emptyState(), patient);
    }
  }

  function saveState() {
    const key = storageKey();
    if (!key) return;
    const persisted = structuredClone(state);
    persisted.sources = (persisted.sources || []).map((source) => {
      delete source.previewUrl;
      delete source.imageDataUrl;
      return source;
    });
    localStorage.setItem(key, JSON.stringify(persisted));
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

  function localDeidentify(input) {
    let text = String(input ?? "");
    const counts = { taj:0, dob:0, email:0, phone:0, address:0, labelledName:0, externalId:0 };
    const replace = (regex, replacement, key) => {
      text = text.replace(regex, () => {
        counts[key] += 1;
        return replacement;
      });
    };

    replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]", "email");
    replace(/\bTAJ(?:\s*(?:sz[aá]m|azonos[ií]t[oó]))?\s*[:#-]?\s*\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/gi, "TAJ: [TAJ]", "taj");
    replace(/(?<!\d)\d{3}[\s-]\d{3}[\s-]\d{3}(?!\d)/g, "[TAJ]", "taj");
    replace(/\b(?:sz[uü]l(?:etett|et[eé]si\s*(?:id[oő]|d[aá]tum))?|DOB|date\s+of\s+birth|birth\s+date)[\s:.-]*(?:19|20)\d{2}\s*[.\/-]\s*(?:0?[1-9]|1[0-2])\s*[.\/-]\s*(?:0?[1-9]|[12]\d|3[01])\.?/gi, "[DOB]", "dob");
    replace(/\b(?:tel(?:efon)?|mobil|phone)\s*[:#-]?\s*(?:\+?\d[\d\s()\/-]{6,}\d)\b/gi, "phone: [PHONE]", "phone");
    replace(/\b(?:beteg\s+neve|p[aá]ciens\s+neve|patient\s+name|name|n[eé]v)\s*[:#-]\s*[^\n;,]{2,80}/gi, "name: [PERSON]", "labelledName");
    replace(/\b(?:lakc[ií]m|address|patient\s+address)\s*[:#-]\s*[^\n;]{4,140}/gi, "address: [ADDRESS]", "address");
    replace(/\b(?:MRN|patient\s*ID|betegazonos[ií]t[oó]|t[oö]rzssz[aá]m|esetsz[aá]m)\s*[:#-]?\s*[A-Z0-9][A-Z0-9._\/-]{3,}\b/gi, "[EXTERNAL_ID]", "externalId");

    return {
      text,
      count: Object.values(counts).reduce((sum, value) => sum + value, 0),
      counts
    };
  }

  function sanitizeSourceTextLocally(source) {
    const result = localDeidentify(source?.text || "");
    return {
      ...source,
      text: result.text,
      localDeidCount: result.count
    };
  }

  async function readPdfAsSanitizedText(file) {
    if (!file || !/pdf/i.test(file.type || "") && !/\.pdf$/i.test(file.name || "")) {
      throw new Error("Csak PDF fájl támogatott.");
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new Error("A PDF túl nagy. Maximum 15 MB.");
    }
    const pdfjs = window.pdfjsLib;
    if (!pdfjs?.getDocument) {
      throw new Error("A PDF-olvasó nem töltődött be. Frissítsd a Beta oldalt.");
    }
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 120) {
      await loadingTask.destroy?.();
      throw new Error("A PDF túl hosszú. Maximum 120 oldal dolgozható fel egyszerre.");
    }

    const pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const pageText = (content.items || []).map((item) => {
        const value = String(item?.str || "");
        return value + (item?.hasEOL ? "\n" : " ");
      }).join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (pageText) pages.push("- " + pageNo + ". oldal -\n" + pageText);
    }
    await loadingTask.destroy?.();

    const rawText = pages.join("\n\n").trim();
    if (!rawText) {
      throw new Error("A PDF-ből nem nyerhető ki szöveg. Szkennelt dokumentumnál használd a KÉPERNYŐKÉP forrást.");
    }
    if (rawText.length > 120000) {
      throw new Error("A PDF kinyert szövege túl hosszú. Bontsd kisebb PDF-re (max. 120 000 karakter / forrás).");
    }

    const deid = localDeidentify(rawText);
    return {
      text: deid.text,
      removedCount: deid.count,
      pageCount: pdf.numPages
    };
  }

  function sourceHeading(s) {
    const date = s.date || "Dátum nincs megadva";
    const name = s.name || s.kind || "Forrás";
    return date + " · " + name;
  }

  function eventHeading(e) {
    const date = e.date || "Dátum?";
    const place = e.place || "Intézmény / osztály?";
    return e.doctor ? date + " - " + e.doctor + ", " + place + " -" : date + " - " + place + " -";
  }

  function highlightedText(text, highlights) {
    const raw = String(text || "");
    const terms = [...new Set((Array.isArray(highlights) ? highlights : [])
      .map((x) => String(x || "").trim())
      .filter((x) => x && raw.includes(x)))]
      .sort((a,b) => b.length - a.length);
    if (!terms.length) return esc(raw);

    const ranges = [];
    for (const term of terms) {
      let start = 0;
      while (start < raw.length) {
        const index = raw.indexOf(term, start);
        if (index < 0) break;
        const end = index + term.length;
        if (!ranges.some((r) => index < r.end && end > r.start)) {
          ranges.push({start:index, end});
        }
        start = end;
      }
    }
    ranges.sort((a,b) => a.start - b.start);
    if (!ranges.length) return esc(raw);

    let html = "";
    let cursor = 0;
    for (const range of ranges) {
      html += esc(raw.slice(cursor, range.start));
      html += '<strong class="an-clinical-anchor">' + esc(raw.slice(range.start, range.end)) + '</strong>';
      cursor = range.end;
    }
    html += esc(raw.slice(cursor));
    return html;
  }

  function caseBindingLabel() {
    const patient = activePatient();
    if (!patient) return "Nincs aktív eset";
    const age = window.BachSBOClinicalUi?.ageFromYob?.(patient.yob);
    const sex = patient.sex === "M" ? "Férfi" : patient.sex === "F" ? "Nő" : patient.sex === "O" ? "Egyéb" : "";
    return [
      patient.localId ? "Eset " + patient.localId : "",
      sex,
      age ? age + " év" : "",
      String(patient.mainComplaint || "").trim()
    ].filter(Boolean).join(" - ");
  }

  function renderShell() {
    const root = $("anamnesisView");
    if (!root) return;
    root.classList.add("anamnesis-module");
    root.innerHTML = `
      <div class="an-shell">
        <div class="an-head">
          <div>
            <div class="an-kicker">BachTranSBO Beta - Anamnézis Audit</div>
            <h1>Longitudinális anamnézis összeállítása</h1>
            <div class="an-subtle">Források -> események -> szerkeszthető végleges anamnézis</div>
          </div>
          <div class="an-pilot"><b>Opcionális eszköz.</b> Bezáráskor csak az <b>Ismert betegségek</b> rövid anamnézis kerül vissza az aktív eset Anamnézis mezőjébe a Summary számára. A részletes anamnézis csak a vágólapra kerül.</div>
        </div>

        <div class="an-patient">
          <div class="an-case-binding">
            <label class="an-caption">Aktív eset</label>
            <div class="an-case-binding-value" id="anamnesisCaseBinding">${esc(caseBindingLabel())}</div>
          </div>
          <div>
            <label class="an-caption">Aktuális panasz / felvétel oka</label>
            <input id="anamnesisComplaint" value="${esc(state.complaint)}" placeholder="Pl. dyspnoe, oedema" />
          </div>
          <div class="an-patient-actions">
            <div class="an-save"><span class="an-save-dot"></span><span id="anamnesisSaveState">Helyi autosave - ehhez az esethez</span></div>
          </div>
        </div>

        <div class="an-grid">
          <section class="an-panel">
            <div class="an-panel-h">
              <div><div class="an-step">1. LÉPÉS</div><div class="an-title">Források</div><div class="an-subtle">PDF / szöveg / képernyőkép, akár vágólapról</div></div>
              <span class="an-chip blue" id="anamnesisSourceCount"></span>
            </div>
            <div class="an-panel-b">
              <div class="an-hint">Ha egy feltöltött PDF-ben az anamnézis már nagyon jó, jelöld azon a dokumentumon a <b>MEGŐRZÉS / MIN. VÁLTOZTATÁS</b> módot. Egyszerre egy referenciaforrás aktív.</div>
              <div class="an-mode-box">
                <label class="an-caption" for="anamnesisMode">Anamnézis részletessége</label>
                <select id="anamnesisMode">
                  <option value="relevant" ${state.mode === "relevant" ? "selected" : ""}>Aktuális panaszhoz releváns</option>
                  <option value="concise" ${state.mode === "concise" ? "selected" : ""}>Rövid</option>
                  <option value="balanced" ${state.mode === "balanced" ? "selected" : ""}>Standard</option>
                  <option value="detailed" ${state.mode === "detailed" ? "selected" : ""}>Részletes</option>
                </select>
                <div class="an-subtle" id="anamnesisModeHint">
                  ${state.mode === "relevant"
                    ? "Az aktuális panaszhoz kapcsolódó előzményeket priorizálja; a fontos biztonsági háttér megmarad."
                    : state.mode === "concise"
                    ? "Tömör anamnézis, de a nagy beavatkozások és objektív klinikai kulcsadatok megmaradnak."
                    : state.mode === "detailed"
                    ? "Több klinikailag hasznos kontextus, vizsgálat, terápia és kimenetel."
                    : "Kiegyensúlyozott belgyógyászati részletesség."}
                </div>
              </div>
              <div class="an-source-actions">
                <button class="btn small" id="anamnesisUploadBtn" type="button">+ PDF</button>
                <button class="btn small" id="anamnesisScreenshotBtn" type="button">+ KÉPERNYŐKÉP</button>
                <button class="btn small" id="anamnesisClipboardImageBtn" type="button">📋 KÉP VÁGÓLAPRÓL</button>
                <button class="btn small" id="anamnesisTextSourceBtn" type="button">+ SZÖVEG</button>
                <button class="btn small" id="anamnesisClipboardBtn" type="button">📋 VÁGÓLAP SZÖVEG</button>
                <input class="hidden" id="anamnesisFileInput" type="file" accept=".pdf,application/pdf" multiple />
                <input class="hidden" id="anamnesisScreenshotInput" type="file" accept="image/png,image/jpeg,image/webp" multiple />
              </div>
              <div class="an-source-list" id="anamnesisSourceList"></div>
              <div class="an-ai-row">
                <button class="an-ai" id="anamnesisExtractBtn" type="button">${aiIcon}<span>AI KINYERÉS</span></button>
                <span class="an-subtle">Minden szöveges forrás helyi de-ID szűrőn megy át, majd a szerver újra privacy-checkeli. PDF-ből csak kinyert, tisztított szöveg kerül AI-ba. Screenshot beillesztés: Ctrl+V / ⌘V.</span>
              </div>
            </div>
          </section>

          <section class="an-panel">
            <div class="an-panel-h">
              <div><div class="an-step">2. LÉPÉS</div><div class="an-title">Események és kivonatok</div><div class="an-subtle">Munkanézet: újabb → régebbi</div></div>
              <span class="an-chip green" id="anamnesisEventCount"></span>
            </div>
            <div class="an-panel-b">
              <div class="an-hint">Az AI KINYERÉS minden eseményhez előre elkészít egy <b>RÖVID / NORMÁL / RÉSZLETES</b> változatot. Itt a hosszváltás és a végleges összeállítás már <b>JavaScript, új AI-hívás nélkül</b>. AI ÁTÍRÁS csak saját utasítás esetén szükséges.</div>
              <div class="an-event-list" id="anamnesisEventList"></div>
            </div>
            <div class="an-panel-footer an-compile-footer">
              <button class="btn" id="anamnesisCompileBtn" type="button">ÖSSZEÁLLÍTÁS →</button>
              <span class="an-subtle">Csak rendezés + formázás JavaScripttel, nincs API-hívás.</span>
            </div>
          </section>

          <section class="an-panel an-sticky">
            <div class="an-panel-h">
              <div><div class="an-step">3. LÉPÉS</div><div class="an-title">Végleges anamnézis</div><div class="an-subtle">Kézzel szerkeszthető · régebbi → újabb</div></div>
              <span class="an-chip purple">DRAFT</span>
            </div>
            <div class="an-panel-b">
              <div class="an-final-note"><b>V1:</b> a végleges Anamnézis a 2. lépésben jóváhagyott eseményekből készül régebbi → újabb sorrendben, AI-hívás nélkül. Az ismert betegségek és a gyógyszerlista az 1. lépésből érkeznek és kézzel tovább szerkeszthetők.</div>

              <div class="an-final-section">
                <div class="an-final-title"><span>Ismert betegségek</span><span class="an-chip an-summary-chip">RÖVID - SUMMARY</span></div>
                <textarea id="anamnesisDiseases"></textarea>
              </div>
              <div class="an-final-section">
                <div class="an-final-title"><span>Részletes anamnézis</span><span class="an-chip an-clipboard-chip">CSAK CLIPBOARD</span></div>
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
                <div class="an-internal-only-note">Belső QC mező - nem kerül a vágólapra és nem kerül az eset Anamnézis mezőjébe.</div>
              </div>
            </div>
            <div class="an-panel-footer an-final-actions">
              <span class="an-subtle">A részletes Anamnézis + gyógyszerelés + Allergiák / CAVE kerül a vágólapra. Az Ellenőrizendő eltérések kimarad.</span>
              <button class="btn an-close-footer" id="anamnesisCloseFooterBtn" type="button">BEZÁRÁS</button>
              <button class="btn" id="anamnesisCopyBtn" type="button" title="A részletes anamnézis másolása formázással">MÁSOLÁS</button>
            </div>
          </section>
        </div>
      </div>
    `;

    bindStaticControls();
    renderSources();
    renderEvents();
    renderFinal();
    requestAnimationFrame(updateAnamnesisPanelHeight);
  }

  function updateAnamnesisPanelHeight() {
    const grid = document.querySelector("#anamnesisView .an-grid");
    if (!grid) return;

    if (window.matchMedia("(max-width: 1280px)").matches) {
      grid.style.removeProperty("--an-grid-height");
      return;
    }

    const rect = grid.getBoundingClientRect();
    const available = Math.max(420, Math.floor(window.innerHeight - rect.top - 12));
    grid.style.setProperty("--an-grid-height", available + "px");
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
          ${s.kind === "Képernyőkép"
            ? ((s.previewUrl || s.imageDataUrl)
              ? '<img class="an-screenshot-preview" src="' + esc(s.previewUrl || s.imageDataUrl) + '" alt="Képernyőkép előnézet" />'
              : '<div class="an-screenshot-missing">A képernyőkép képi tartalma frissítés után nem marad helyben. Illeszd vagy töltsd fel újra az AI feldolgozáshoz.</div>')
            : ""}
          ${s.kind === "Képernyőkép"
            ? '<label class="an-image-confirm"><input type="checkbox" data-an-image-confirm ' + (s.imageConfirmed ? 'checked' : '') + ' /> <span>Nincs betegazonosító / személyes adat ezen a képen - AI-ba küldhető</span></label>'
            : ""}
          <textarea data-an-source-text placeholder="${s.kind === "PDF"
            ? "A PDF kinyert és deazonosított szövege jelenik meg itt. Szükség esetén kézzel szerkeszthető."
            : s.kind === "Képernyőkép"
            ? "Opcionális megjegyzés a screenshothoz."
            : "Forrásszöveg / epikrízis..."}">${esc(s.text || "")}</textarea>
          ${s.kind === "PDF"
            ? '<div class="an-privacy-note"><b>De-ID:</b> ' +
              (s.pdfReady
                ? esc(String(s.pdfPages || "?")) + ' oldal · ' + esc(String(s.localDeidCount || 0)) + ' azonosító eltávolítva. Az eredeti PDF nem kerül AI-ba; csak a kinyert, tisztított szöveg.'
                : 'PDF feldolgozásra vár.') +
              '</div>' +
              (s.pdfReady
                ? '<label class="an-image-confirm"><input type="checkbox" data-an-pdf-confirm ' + (s.pdfConfirmed ? 'checked' : '') + ' /> <span>De-ID ellenőrizve - ez a tisztított PDF-szöveg AI-ba küldhető</span></label>'
                : '')
            : ""}
          ${s.kind === "Képernyőkép" ? '<div class="an-subtle" style="margin-top:5px">A screenshot csak az AI KINYERÉS megnyomásakor kerül a szerveroldali OpenAI Responses API-hoz, és csak a fenti jelölés után.</div>' : ""}
          ${s.preserve ? '<div class="an-preserve-note"><b>Referencia anamnézis.</b> A későbbi AI-feldolgozás ennek jó megfogalmazását, kronológiáját és relatív részletességét tartja meg; főként formátumot egységesít és szükséges tényekkel egészít ki.</div>' : ""}
        </div>
      </div>
    `).join("");

    list.querySelectorAll("[data-an-preserve]").forEach((button) => {
      button.addEventListener("click", () => {
        const sourceCard = button.closest("[data-an-source]");
        const id = sourceCard?.dataset?.anSource;
        if (!id) return;
        const src = state.sources.find((x) => x.id === id);
        if (!src) return;

        const next = !Boolean(src.preserve);
        state.sources.forEach((x) => { x.preserve = false; });
        src.preserve = next;

        state.events.forEach((ev) => {
          const linked = ev.sourceId === id || (Array.isArray(ev.sourceIds) && ev.sourceIds.includes(id));
          ev.preserve = next && linked;
        });

        saveState();
        renderSources();
        renderEvents();
        toast(next ? "MEGŐRZÉS / MIN. VÁLTOZTATÁS bekapcsolva." : "Megőrzési mód kikapcsolva.");
      });
    });
  }

  function eventVersionKey(event) {
    if (["short", "normal", "detailed"].includes(event?.selectedVersion)) return event.selectedVersion;
    if (event?.detail === "minimal" || event?.detail === "shorter") return "short";
    if (event?.detail === "detailed") return "detailed";
    return "normal";
  }

  function ensureEventVersions(event) {
    const fallbackText = String(event?.text || "");
    const fallbackHighlights = Array.isArray(event?.highlights) ? event.highlights : [];
    if (!event.versions || typeof event.versions !== "object") event.versions = {};
    for (const key of ["short", "normal", "detailed"]) {
      const version = event.versions[key];
      if (!version || typeof version !== "object") {
        event.versions[key] = { text: fallbackText, highlights: [...fallbackHighlights] };
      } else {
        version.text = String(version.text || fallbackText);
        version.highlights = Array.isArray(version.highlights) ? version.highlights : [...fallbackHighlights];
      }
    }
    event.selectedVersion = eventVersionKey(event);
    return event.versions[event.selectedVersion];
  }

  function activeEventVersion(event) {
    return ensureEventVersions(event);
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
      const modes = [["short","RÖVID"],["normal","NORMÁL"],["detailed","RÉSZLETES"]];
      const active = activeEventVersion(e);
      return `
        <div class="an-card ${e.preserve ? "reference" : ""}" data-an-event="${esc(e.id)}">
          <div class="an-card-h">
            <div><div class="an-card-title">${esc(eventHeading(e))}</div><div class="an-card-meta">${e.preserve ? "Referenciaforrásból" : "Normál esemény"} · 3 előre generált hossz</div></div>
            <div class="an-card-actions">${e.preserve ? '<span class="an-chip purple">MEGŐRZÉS</span>' : '<span class="an-chip">ESEMÉNY</span>'}<button class="an-delete" type="button" data-an-delete-event title="Esemény törlése">×</button></div>
          </div>
          <div class="an-card-b">
            <textarea data-an-event-text>${esc(active.text || "")}</textarea>
            ${Array.isArray(active.highlights) && active.highlights.length
              ? '<div class="an-highlight-preview" data-an-highlight-preview>' + highlightedText(active.text, active.highlights) + '</div>'
              : '<div class="an-highlight-preview hidden" data-an-highlight-preview></div>'}
            <div class="an-segmented">
              ${modes.map(([key,label]) => '<button class="an-seg '+(e.selectedVersion===key?"active":"")+'" type="button" data-an-detail="'+key+'">'+label+'</button>').join("")}
            </div>
            <div class="an-subtle" style="margin:5px 0 8px">A RÖVID / NORMÁL / RÉSZLETES váltás csak JavaScript: nincs új API-hívás.</div>
            <label class="an-caption">Saját utasítás · csak ehhez az eseményhez</label>
            <input data-an-instruction value="${esc(e.instruction || "")}" placeholder="Pl. Emeld ki jobban a kardiológiai előzményt." />
            <div class="an-inline-actions">
              <span class="an-subtle">AI csak akkor szükséges, ha saját utasítást adsz.</span>
              <button class="an-ai" type="button" data-an-rewrite ${String(e.instruction || "").trim() ? "" : "disabled"}>${aiIcon}<span>AI ÁTÍRÁS</span></button>
            </div>
          </div>
        </div>`;
    }).join("");
  }

  function renderFinal() {
    const diseases = $("anamnesisDiseases");
    const history = $("anamnesisHistoryEditor");
    const allergies = $("anamnesisAllergies");
    const discrepancies = $("anamnesisDiscrepancies");
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
      const version = activeEventVersion(e);
      return '<span class="an-history-line"><strong>' + esc(heading) + '</strong> ' + highlightedText(version.text || "", version.highlights || []) + '</span>';
    }).join("");
  }

  async function extractWithAi(button) {
    const unconfirmedImages = state.sources.filter(
      (s) => s.kind === "Képernyőkép" && s.imageDataUrl && !s.imageConfirmed
    );
    if (unconfirmedImages.length) {
      toast("Jelöld a screenshoton, hogy nincs rajta betegazonosító / személyes adat.");
      return;
    }
    const unconfirmedPdfs = state.sources.filter(
      (s) => s.kind === "PDF" && String(s.text || "").trim() && !s.pdfConfirmed
    );
    if (unconfirmedPdfs.length) {
      toast("Ellenőrizd a PDF de-ID szövegét, majd jelöld, hogy AI-ba küldhető.");
      return;
    }

    const locallySanitizedSources = state.sources.map(sanitizeSourceTextLocally);
    const usable = locallySanitizedSources.filter((s) =>
      String(s.text || "").trim() ||
      (s.kind === "Képernyőkép" && Boolean(s.imageDataUrl) && Boolean(s.imageConfirmed))
    );
    if (!usable.length) {
      const hasPdf = state.sources.some((s) => s.kind === "PDF");
      const hasScreenshot = state.sources.some((s) => s.kind === "Képernyőkép");
      toast(hasScreenshot
        ? "A screenshot képi tartalma hiányzik vagy nincs AI-küldésre jóváhagyva."
        : hasPdf
        ? "A PDF-kártyába még nincs forrásszöveg beillesztve."
        : "Nincs feldolgozható forrás.");
      return;
    }

    await runAiButton(button, "FELDOLGOZÁS…", async () => {
      const api = requireAnamnesisBackend();
      const result = await api({
        action: "extract",
        complaint: localDeidentify(state.complaint || "").text,
        mode: state.mode || "balanced",
        sources: usable.map((s) => ({
          id: s.id,
          kind: s.kind || "",
          name: s.kind === "PDF" ? "PDF dokumentum" : s.kind === "Képernyőkép" ? "Képernyőkép" : localDeidentify(s.name || "").text,
          date: s.date || "",
          place: localDeidentify(s.place || "").text,
          preserve: Boolean(s.preserve),
          text: s.text || "",
          imageDataUrl: s.kind === "Képernyőkép" ? (s.imageDataUrl || "") : "",
          imageConfirmedNoIdentifiers: s.kind === "Képernyőkép" ? Boolean(s.imageConfirmed) : false
        }))
      });

      const sourceById = new Map(state.sources.map((s) => [s.id, s]));
      state.events = (Array.isArray(result?.events) ? result.events : []).map((e) => {
        const sourceIds = Array.isArray(e.source_ids) ? e.source_ids : [];
        const sourceId = sourceIds[0] || "";
        const preserve = sourceIds.some((id) => Boolean(sourceById.get(id)?.preserve));
        const versions = e?.versions || {};
        const cleanVersion = (key) => ({
          text: String(versions?.[key]?.text || ""),
          highlights: Array.isArray(versions?.[key]?.highlights)
            ? versions[key].highlights.map((x) => String(x || "")).filter(Boolean)
            : []
        });
        const selectedVersion =
          state.mode === "concise" ? "short" :
          state.mode === "detailed" ? "detailed" :
          "normal";
        return {
          id: uid("event"),
          sourceId,
          sourceIds,
          date: String(e.date || ""),
          place: String(e.place || ""),
          doctor: String(e.doctor || ""),
          preserve,
          selectedVersion,
          instruction: "",
          versions: {
            short: cleanVersion("short"),
            normal: cleanVersion("normal"),
            detailed: cleanVersion("detailed")
          }
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

  function assembleFinalFromEvents() {
    if (!state.events.length) {
      toast("Nincs összeállítható esemény.");
      return;
    }

    // Step 2 is the source of truth for the Anamnézis in V1.
    // No AI call: only deterministic chronology + formatting.
    const sorted = [...state.events].sort(
      (a,b) => String(a.date || "").localeCompare(String(b.date || ""))
    );

    state.final.historyHtml = finalHistoryHtml(sorted);

    renderFinal();
    saveState();
    toast("Végleges anamnézis összeállítva AI nélkül.");
  }

  async function rewriteEventWithAi(eventCard, button) {
    const ev = state.events.find((x) => x.id === eventCard?.dataset?.anEvent);
    if (!ev) return;
    if (!String(ev.instruction || "").trim()) {
      toast("AI átíráshoz írj saját utasítást.");
      return;
    }
    const version = activeEventVersion(ev);

    await runAiButton(button, "ÁTÍRÁS…", async () => {
      const api = requireAnamnesisBackend();
      const result = await api({
        action: "rewrite_event",
        event: {
          date:ev.date || "",
          place:ev.place || "",
          doctor:ev.doctor || "",
          text:version.text || "",
          preserve:Boolean(ev.preserve),
          detail:ev.selectedVersion || "normal",
          instruction:ev.instruction || "",
          highlights:Array.isArray(version.highlights) ? version.highlights : []
        }
      });
      version.text = String(result?.text || version.text || "");
      version.highlights = Array.isArray(result?.highlights)
        ? result.highlights.map((x) => String(x || "")).filter(Boolean)
        : [];
      renderEvents();
      saveState();
      toast("A kiválasztott verzió AI-átírása elkészült.");
    });
  }

  function currentMedicationText() {
    const rows = [...document.querySelectorAll("#anamnesisMedList [data-an-med]")];
    if (rows.length) {
      return rows.map((row) => {
        const name = String(row.querySelector("[data-an-med-name]")?.value || "").trim();
        const dose = String(row.querySelector("[data-an-med-dose]")?.value || "").trim();
        return name ? name + (dose ? " " + dose : "") : "";
      }).filter(Boolean).join(", ");
    }
    return state.meds
      .filter((m) => String(m.name || "").trim())
      .map((m) => String(m.name || "").trim() + (String(m.dose || "").trim() ? " " + String(m.dose).trim() : ""))
      .join(", ");
  }

  function clipboardSafeHistoryHtml() {
    const editor = $("anamnesisHistoryEditor");
    const container = document.createElement("div");
    container.innerHTML = editor?.innerHTML || state.final.historyHtml || "";

    container.querySelectorAll(".an-history-line").forEach((node) => {
      const block = document.createElement("div");
      block.innerHTML = node.innerHTML;
      node.replaceWith(block);
    });

    const allowed = new Set(["STRONG","B","BR","DIV","P","SPAN"]);
    [...container.querySelectorAll("*")].forEach((node) => {
      if (!allowed.has(node.tagName)) {
        node.replaceWith(document.createTextNode(node.textContent || ""));
        return;
      }
      [...node.attributes].forEach((attr) => node.removeAttribute(attr.name));
      if (node.tagName === "STRONG" || node.tagName === "B") {
        const bold = document.createElement("b");
        bold.setAttribute("style", "font-weight:700;");
        bold.innerHTML = node.innerHTML;
        node.replaceWith(bold);
      }
    });
    return '<div>' + container.innerHTML + '</div>';
  }

  function finalClipboardPayload() {
    const diseases = String($("anamnesisDiseases")?.value || state.final.diseases || "").trim();
    const historyEditor = $("anamnesisHistoryEditor");
    const historyText = String(historyEditor?.innerText || "").trim();
    const historyHtml = clipboardSafeHistoryHtml();
    const meds = currentMedicationText();
    const allergies = String($("anamnesisAllergies")?.value || state.final.allergies || "").trim();

    // Detailed ambulatory-note output for clipboard only.
    // The internal "Ellenőrizendő eltérések" QC field is intentionally excluded.
    const text = [
      "Ismert betegségek", diseases, "",
      "Anamnézis", historyText, "",
      "Gyógyszerelés", meds || "-", "",
      "Allergiák / CAVE", allergies
    ].filter((x,idx,arr) => !(x === "" && arr[idx-1] === "")).join("\n");

    const textHtml = (value) => esc(value).replace(/\n/g, "<br>");
    const section = (title, bodyHtml) =>
      '<div><b style="font-weight:700;">' + esc(title) + '</b><br>' + (bodyHtml || "-") + '</div>';

    const html = [
      section("Ismert betegségek", textHtml(diseases)),
      section("Anamnézis", historyHtml || "-"),
      section("Gyógyszerelés", textHtml(meds || "-")),
      section("Allergiák / CAVE", textHtml(allergies))
    ].filter(Boolean).join("<br>");

    return { text: shortHyphens(text), html: shortHyphens(html) };
  }

  async function copyFinalStep3() {
    const payload = finalClipboardPayload();
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([payload.text], { type:"text/plain" }),
            "text/html": new Blob([payload.html], { type:"text/html" })
          })
        ]);
        return "rich";
      } catch (error) {
        console.warn("Rich clipboard copy failed, using plain text fallback:", error);
      }
    }
    await navigator.clipboard.writeText(payload.text);
    return "plain";
  }

  function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type || "")) {
        reject(new Error("Csak PNG, JPEG vagy WebP képernyőkép támogatott."));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error("A képernyőkép túl nagy. Maximum 5 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("A képernyőkép nem olvasható."));
      reader.readAsDataURL(file);
    });
  }

  async function addScreenshotFile(file, sourceLabel = "Képernyőkép") {
    const imageDataUrl = await readImageAsDataUrl(file);
    const id = uid("source");
    state.sources.unshift({
      id,
      kind: "Képernyőkép",
      name: sourceLabel,
      fileName: "Képernyőkép",
      date: "",
      place: "",
      doctor: "",
      preserve: false,
      text: "",
      previewUrl: imageDataUrl,
      imageDataUrl,
      imageConfirmed: false
    });
    renderSources();
    saveState();
    toast("Képernyőkép hozzáadva. Jelöld az azonosítómentességet, majd AI KINYERÉS.");
  }

  function isAnamnesisVisible() {
    const modal = $("anamnesisModal");
    return Boolean(modal && !modal.classList.contains("hidden"));
  }

  async function addClipboardScreenshotFromEvent(event) {
    const items = [...(event?.clipboardData?.items || [])];
    const imageItem = items.find((item) => item?.kind === "file" && /^image\//i.test(item.type || ""));
    if (!imageItem) return false;
    const blob = imageItem.getAsFile();
    if (!blob) return false;
    await addScreenshotFile(blob, "Vágólapról beillesztett képernyőkép");
    return true;
  }

  async function addClipboardScreenshotWithApi() {
    if (!navigator.clipboard?.read) {
      throw new Error("A böngésző nem támogatja a közvetlen képolvasást. Nyomj Ctrl+V / ⌘V-t az Anamnézis oldalon.");
    }
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = (item.types || []).find((type) => /^image\/(png|jpeg|webp)$/i.test(type));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const file = new File([blob], "clipboard-screenshot", { type: imageType });
      await addScreenshotFile(file, "Vágólapról beillesztett képernyőkép");
      return true;
    }
    throw new Error("A vágólapon nincs támogatott PNG/JPEG/WebP kép.");
  }

  async function handleGlobalScreenshotPaste(event) {
    if (!isAnamnesisVisible()) return;
    try {
      const added = await addClipboardScreenshotFromEvent(event);
      if (!added) return;
      event.preventDefault();
    } catch (error) {
      console.error("Anamnesis screenshot paste:", error);
      toast(error?.message || "A vágólap képe nem adható hozzá.");
    }
  }

  function bindStaticControls() {
    $("anamnesisMode")?.addEventListener("change", (e) => {
      state.mode = e.target.value;
      const hint = $("anamnesisModeHint");
      if (hint) {
        hint.textContent =
          state.mode === "relevant"
            ? "Az aktuális panaszhoz kapcsolódó előzményeket priorizálja; a fontos biztonsági háttér megmarad."
            : state.mode === "concise"
            ? "Tömör anamnézis, de a nagy beavatkozások és objektív klinikai kulcsadatok megmaradnak."
            : state.mode === "detailed"
            ? "Több klinikailag hasznos kontextus, vizsgálat, terápia és kimenetel."
            : "Kiegyensúlyozott belgyógyászati részletesség.";
      }
      saveState();
    });
    $("anamnesisComplaint")?.addEventListener("input", (e) => {
      state.complaint = e.target.value;
      saveState();
    });

    $("anamnesisUploadBtn")?.addEventListener("click", () => $("anamnesisFileInput")?.click());
    $("anamnesisFileInput")?.addEventListener("change", async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      for (const file of files) {
        const pending = {
          id: uid("source"),
          kind: "PDF",
          name: "PDF dokumentum",
          fileName: "PDF dokumentum",
          date: "",
          place: "",
          doctor: "",
          preserve: false,
          text: "",
          pdfReady: false,
          pdfPages: 0,
          pdfConfirmed: false,
          localDeidCount: 0
        };
        state.sources.unshift(pending);
        renderSources();
        toast("PDF szöveg kinyerése és helyi de-ID folyamatban…");
        try {
          const parsed = await readPdfAsSanitizedText(file);
          pending.text = parsed.text;
          pending.pdfReady = true;
          pending.pdfPages = parsed.pageCount;
          pending.localDeidCount = parsed.removedCount;
          pending.pdfConfirmed = false;
          renderSources();
          saveState();
          toast("PDF hozzáadva és deazonosítva. Ellenőrizd a kinyert szöveget.");
        } catch (error) {
          state.sources = state.sources.filter((s) => s.id !== pending.id);
          renderSources();
          saveState();
          toast(error?.message || "A PDF nem dolgozható fel.");
        }
      }
    });

    $("anamnesisScreenshotBtn")?.addEventListener("click", () => $("anamnesisScreenshotInput")?.click());
    $("anamnesisScreenshotInput")?.addEventListener("change", async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      for (const file of files) {
        try {
          await addScreenshotFile(file, file.name || "Képernyőkép");
        } catch (error) {
          toast(error?.message || "Képernyőkép hozzáadási hiba.");
        }
      }
    });

    $("anamnesisClipboardImageBtn")?.addEventListener("click", async () => {
      try {
        await addClipboardScreenshotWithApi();
      } catch (error) {
        toast(error?.message || "A vágólap képe nem olvasható.");
      }
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
        toast("A vágólap szövege nem olvasható. Screenshotot közvetlenül Ctrl+V / ⌘V-vel illessz be az Anamnézis nézetben.");
      }
    });

    $("anamnesisExtractBtn")?.addEventListener("click", (e) => void extractWithAi(e.currentTarget));
    $("anamnesisCompileBtn")?.addEventListener("click", assembleFinalFromEvents);

    $("anamnesisAddMedBtn")?.addEventListener("click", () => {
      state.meds.push({name:"",dose:""}); renderMeds(); saveState();
      document.querySelector('[data-an-med="'+(state.meds.length-1)+'"] [data-an-med-name]')?.focus();
    });

    $("anamnesisCopyBtn")?.addEventListener("click", async () => {
      try {
        const mode = await copyFinalStep3();
        toast(mode === "rich"
          ? "A részletes anamnézis formázással a vágólapra másolva."
          : "A részletes anamnézis másolva; ez a böngésző csak egyszerű szöveget engedett.");
      } catch {
        toast("A böngésző nem engedte a vágólap írását.");
      }
    });
    $("anamnesisCloseFooterBtn")?.addEventListener("click", () => void closeAuditModal());

    ["anamnesisDiseases","anamnesisAllergies","anamnesisDiscrepancies"].forEach((id) => {
      $(id)?.addEventListener("input", (e) => {
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
        if (e.target.matches("[data-an-source-text]")) {
          s.text = e.target.value;
          if (s.kind === "PDF") {
            s.pdfConfirmed = false;
            const confirm = sourceCard.querySelector("[data-an-pdf-confirm]");
            if (confirm) confirm.checked = false;
          }
        }
        if (e.target.matches("[data-an-image-confirm]")) s.imageConfirmed = Boolean(e.target.checked);
        if (e.target.matches("[data-an-pdf-confirm]")) s.pdfConfirmed = Boolean(e.target.checked);
        saveState();
        return;
      }
      const eventCard = e.target.closest?.("[data-an-event]");
      if (eventCard) {
        const ev = state.events.find((x) => x.id === eventCard.dataset.anEvent);
        if (!ev) return;
        if (e.target.matches("[data-an-event-text]")) {
          const version = activeEventVersion(ev);
          version.text = e.target.value;
          version.highlights = (Array.isArray(version.highlights) ? version.highlights : []).filter((x) => version.text.includes(x));
          const preview = eventCard.querySelector("[data-an-highlight-preview]");
          if (preview) {
            preview.innerHTML = highlightedText(version.text, version.highlights);
            preview.classList.toggle("hidden", !version.highlights.length);
          }
        }
        if (e.target.matches("[data-an-instruction]")) {
          ev.instruction = e.target.value;
          const rewrite = eventCard.querySelector("[data-an-rewrite]");
          if (rewrite) rewrite.disabled = !String(ev.instruction || "").trim();
        }
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
        ev.selectedVersion = e.target.closest("[data-an-detail]").dataset.anDetail;
        ensureEventVersions(ev);
        renderEvents(); saveState();
        toast("Verzió váltva JavaScripttel - nincs API-hívás.");
        return;
      }
      if (eventCard && e.target.closest("[data-an-delete-event]")) {
        const id = eventCard.dataset.anEvent;
        state.events = state.events.filter((x) => x.id !== id);
        renderEvents();
        saveState();
        toast("Esemény törölve a 2. lépésből.");
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

  async function syncShortHistoryToCase() {
    if (!activeCaseId) return;
    const patient = activePatient();
    if (!patient || String(patient.id) !== activeCaseId) return;

    const field = $("fHistory");
    if (!field) return;
    const shortHistory = shortHyphens(String($("anamnesisDiseases")?.value || state.final.diseases || "").trim());

    field.value = shortHistory;
    field.dispatchEvent(new Event("input", { bubbles:true }));
    field.dispatchEvent(new Event("change", { bubbles:true }));
    window.BachSBOClinicalUi?.commitCurrentDraft?.();
    try {
      await window.BachSBOClinicalUi?.autosaveCurrentCase?.();
    } catch (error) {
      console.warn("Anamnesis short history autosave failed:", error);
      toast("A rövid anamnézis a mezőbe került, de az autosave nem igazolható.");
    }
  }

  function setModalOpen(open) {
    const modal = $("anamnesisModal");
    if (!modal) return;
    modal.classList.toggle("hidden", !open);
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle("anamnesis-modal-open", open);
  }

  function openAuditModal() {
    const patient = activePatient();
    if (!patient?.id || !patient?.shiftId) {
      toast("Előbb válassz aktív esetet.");
      return;
    }
    if (patient.summaryFinalizedAt) {
      toast("Lezárt esetnél előbb nyisd újra az esetet.");
      return;
    }

    state = loadStateForCase(patient);
    state.complaint = String(patient.mainComplaint || patient.complaint || state.complaint || "").trim();
    const caseLabel = $("anamnesisModalCase");
    if (caseLabel) caseLabel.textContent = caseBindingLabel();
    renderShell();
    setModalOpen(true);
    requestAnimationFrame(updateAnamnesisPanelHeight);
  }

  async function closeAuditModal() {
    if (!isAnamnesisVisible()) return;
    saveState();
    await syncShortHistoryToCase();
    setModalOpen(false);
    toast("Rövid anamnézis frissítve az esetben. A részletes anamnézis csak clipboard.");
  }

  function init() {
    document.addEventListener("paste", handleGlobalScreenshotPaste);
    window.addEventListener("resize", updateAnamnesisPanelHeight, { passive: true });
    $("anamnesisAuditBtn")?.addEventListener("click", openAuditModal);
    $("anamnesisModalCloseBtn")?.addEventListener("click", () => void closeAuditModal());
    $("anamnesisModal")?.addEventListener("click", (event) => {
      if (event.target === $("anamnesisModal")) void closeAuditModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isAnamnesisVisible()) {
        event.preventDefault();
        void closeAuditModal();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();