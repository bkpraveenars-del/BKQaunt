/* BKQuant (offline) single-page dashboard.
   - Login gate (localStorage)
   - "Windows icon" style tiles
   - Each analysis renders: input (where simple), results table, chart(s), interpretation
   - Export to Word (.mht MHTML with CID image parts) / XLS: tables + rasterized figures; optional Python matplotlib script for print figures
*/

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const STORAGE_KEY = "bkq_authed_v1";
  const PREV_KEY_PREFIX = "bkq_prev_module_v1:";
  const META_KEY = "bkq_report_meta_v1";
  const BKQUANT_VERSION = "1.0";

  const qs = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function downloadBlob(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function parseCsv(text) {
    // Lightweight CSV parser supporting quoted fields and commas.
    const rows = [];
    let i = 0;
    let field = "";
    let row = [];
    let inQuotes = false;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        const hasContent = row.some((c) => String(c).trim().length > 0);
        if (hasContent) rows.push(row);
        row = [];
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    row.push(field);
    if (row.some((c) => String(c).trim().length > 0)) rows.push(row);
    return rows;
  }

  function parseNumericCsvMatrix(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    return rows
      .map((r) => r.map((x) => Number(String(x).trim())))
      .filter((r) => r.some((x) => Number.isFinite(x)));
  }

  const SESSION_UPLOAD_KEY = "bkq_session_upload_v1";

  function getSessionUpload() {
    try {
      const raw = sessionStorage.getItem(SESSION_UPLOAD_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setSessionUpload(obj) {
    try {
      sessionStorage.setItem(SESSION_UPLOAD_KEY, JSON.stringify(obj));
    } catch {
      /* quota / private mode */
    }
  }

  function clearSessionUpload() {
    sessionStorage.removeItem(SESSION_UPLOAD_KEY);
  }

  const BKQ_DATA_FILE_ACCEPT =
    ".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  /** Wire Import button + file input; onText receives CSV string (Excel first sheet). */
  function bindCsvExcelFileImport(importBtnId, fileInputId, onText) {
    const btn = document.getElementById(importBtnId);
    const inp = document.getElementById(fileInputId);
    if (!btn || !inp) return;
    btn.addEventListener("click", () => inp.click());
    inp.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      inp.value = "";
      if (!f) return;
      try {
        const txt = await fileToCsvText(f);
        await onText(txt);
      } catch (err) {
        alert(err?.message || String(err));
      }
    });
  }

  function bindCsvExcelToTextarea(importBtnId, fileInputId, textareaId) {
    bindCsvExcelFileImport(importBtnId, fileInputId, async (txt) => {
      const ta = document.getElementById(textareaId);
      if (!ta) return;
      ta.value = txt;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** Optional first column labels; remaining columns = numeric grid (CRD/RBD-style). */
  function parseRectDataGridCsv(txt) {
    const raw = parseCsv(txt)
      .map((r) => r.map((c) => String(c).trim()))
      .filter((r) => r.some((c) => c !== ""));
    if (!raw.length) return null;
    const first = raw[0];
    const numericFirst = Number.isFinite(Number(first[0]));
    let startCol = 0;
    if (!numericFirst && first.length >= 2 && first.slice(1).every((c) => Number.isFinite(Number(c)))) startCol = 1;
    const r = Math.max(0, ...raw.map((row) => row.length - startCol));
    if (r < 2 || raw.length < 2) return null;
    const t = raw.length;
    const matrix = [];
    for (let i = 0; i < t; i++) {
      const row = [];
      for (let j = 0; j < r; j++) {
        const v = Number(raw[i][startCol + j]);
        if (!Number.isFinite(v)) return null;
        row.push(v);
      }
      matrix.push(row);
    }
    return { matrix, t, r };
  }

  async function fileToCsvText(file) {
    const name = (file.name || "").toLowerCase();
    const mime = file.type || "";
    if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv") || mime.includes("csv") || mime === "text/plain") {
      return await file.text();
    }
    if (
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".ods") ||
      mime.includes("spreadsheet") ||
      mime.includes("excel") ||
      mime.includes("ms-excel")
    ) {
      if (typeof XLSX === "undefined") {
        throw new Error(
          "Excel files need the SheetJS library. Load BKQuant online once, or save your sheet as CSV (Excel: Save As → CSV UTF-8)."
        );
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sn = wb.SheetNames[0];
      if (!sn) throw new Error("Workbook has no sheets.");
      return XLSX.utils.sheet_to_csv(wb.Sheets[sn], { FS: ",", RS: "\n" });
    }
    return await file.text();
  }

  /** Textarea IDs that accept a pasted session CSV block (module id → element id). */
  const MODULE_SESSION_TEXTAREA = {
    dataInsights: "diCsv",
    biometric: "bioMulti",
    pca: "pcaMatrix",
    correlation: "corMatrix",
    mlr: "mlrData",
    corpath: "cpaData",
  };

  function injectSessionUploadBanner(moduleId) {
    const u = getSessionUpload();
    const tid = MODULE_SESSION_TEXTAREA[moduleId];
    if (!u?.text || !tid) return;
    const ta = document.getElementById(tid);
    const host = $("#contentBody .section");
    if (!ta || !host || host.querySelector(".bkq-session-banner")) return;

    const bar = document.createElement("div");
    bar.className = "bkq-session-banner";
    bar.innerHTML = `<div class="bkq-session-banner-inner">
      <span>Session file: <strong>${qs(u.name)}</strong> — use Import to load from disk, or apply this session copy below.</span>
      <button type="button" class="action-btn primary2" data-bkq-session-apply>Apply session upload</button>
    </div>`;
    bar.querySelector("[data-bkq-session-apply]")?.addEventListener("click", () => {
      ta.value = u.text;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    });
    host.insertBefore(bar, host.firstChild);
  }

  function buildV2DataUploadPanelHtml() {
    const u = getSessionUpload();
    const status = u
      ? `Session file loaded: ${qs(u.name)} — open a module below, or use Import CSV / Excel in the sidebar.`
      : "No session file yet. Choose a CSV or Excel file below (first sheet is used for .xlsx).";
    return `<div class="v2-upload-panel">
      <h4 class="v2-upload-title">Upload data (CSV or Microsoft Excel)</h4>
      <p class="muted small" style="margin:0 0 10px;line-height:1.5">
        Most analyses use <strong>Import CSV</strong> inside the module — that now accepts <strong>.xlsx / .xls</strong> (first sheet) as well as .csv.
        You can also load a file here to keep it in this browser session and apply it to compatible modules in one click.
      </p>
      <div class="v2-upload-row">
        <label class="v2-upload-file-label">
          <input type="file" id="v2DashUploadFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
          <span>Choose file…</span>
        </label>
        <button type="button" class="action-btn" id="v2DashUploadClear">Clear session file</button>
      </div>
      <p id="v2DashUploadStatus" class="v2-upload-status">${status}</p>
      <details class="v2-format-details">
        <summary>Example layouts (click to expand)</summary>
        <div class="v2-format-examples">
          <div class="v2-format-block">
            <div class="v2-format-label">Genotype × traits (Data Insights, PCA-style)</div>
            <pre class="v2-format-pre">Genotype,Yield,Protein,Oil
G1,32.1,12.4,42.0
G2,34.2,11.8,41.2
G3,31.5,12.1,40.5</pre>
          </div>
          <div class="v2-format-block">
            <div class="v2-format-label">G × E matrix (AMMI / MET — rows = genotypes, columns = environments)</div>
            <pre class="v2-format-pre">,E1,E2,E3
G1,4.2,4.5,4.1
G2,4.6,4.4,4.8
G3,4.0,4.3,4.2</pre>
          </div>
          <div class="v2-format-block">
            <div class="v2-format-label">Line × Tester grid (stacked blocks, one row per cross × rep)</div>
            <pre class="v2-format-pre">R1,R2,R3
12.1,12.4,11.9
11.8,12.0,12.2
…</pre>
            <p class="muted small" style="margin:6px 0 0">Use each module’s <strong>Download template CSV</strong> for exact dimensions.</p>
          </div>
        </div>
      </details>
    </div>`;
  }

  function wireV2DashboardUpload() {
    const inp = $("#v2DashUploadFile");
    const status = $("#v2DashUploadStatus");
    const clearBtn = $("#v2DashUploadClear");
    if (!inp) return;
    inp.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      inp.value = "";
      if (!f) return;
      try {
        const text = await fileToCsvText(f);
        setSessionUpload({ name: f.name, text, at: new Date().toISOString() });
        if (status) {
          status.textContent = `Loaded session file: ${f.name} (${Math.max(1, Math.ceil(text.length / 1024))} KB). Open a module or use Apply session upload where shown.`;
        }
      } catch (err) {
        alert(err?.message || String(err));
      }
    });
    clearBtn?.addEventListener("click", () => {
      clearSessionUpload();
      if (status) status.textContent = "Session file cleared. Choose a file above to load again.";
    });
  }

  function triggerCsvDownload(filename, rows) {
    const csv = rows
      .map((r) =>
        r
          .map((v) => {
            const s = String(v ?? "");
            if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
          })
          .join(",")
      )
      .join("\r\n");
    downloadBlob(filename, "text/csv;charset=utf-8", csv);
  }

  /** Raster snapshot for Word/HTML: PNG (JPEG if huge). Returns display width/height for mso-friendly <img> attrs. */
  function canvasToExportSrc(canvas) {
    try {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      let rect = canvas.getBoundingClientRect();
      let cssW = Math.round(rect.width || 0);
      let cssH = Math.round(rect.height || 0);
      if (cssW < 4 || cssH < 4) {
        const chart = canvas.closest(".chart");
        if (chart) {
          const r2 = chart.getBoundingClientRect();
          cssW = Math.max(cssW, Math.round(r2.width || 0));
          cssH = Math.max(cssH, Math.round(r2.height || 0));
        }
      }
      if (cssW < 4) cssW = Math.max(400, Math.round(canvas.width / dpr));
      if (cssH < 4) cssH = Math.max(240, Math.round(canvas.height / dpr));
      cssW = Math.max(1, cssW);
      cssH = Math.max(1, cssH);
      let dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length > 2_400_000) {
        dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      }
      const maxW = 900;
      const dispW = Math.min(maxW, cssW);
      const dispH = Math.round(cssH * (dispW / cssW));
      return { src: dataUrl, w: dispW, h: dispH };
    } catch (e) {
      console.warn("BKQuant export: canvas snapshot failed", e);
      return { src: "", w: 0, h: 0 };
    }
  }

  function exportFigureImgTag(n, src, w, h) {
    if (!src || src.length < 32) return "";
    const wh = w > 0 && h > 0 ? ` width="${w}" height="${h}"` : "";
    return `<img alt="Figure ${n}" src="${src}"${wh} style="width:${w || 720}px;max-width:100%;height:auto;display:block;border:1px solid #cbd5e1;mso-width-percent:1000"/>`;
  }

  function svgToDataUrl(svgEl) {
    try {
      const xml = new XMLSerializer().serializeToString(svgEl);
      // Encode as UTF-8 SVG data URL
      const encoded = encodeURIComponent(xml)
        .replace(/'/g, "%27")
        .replace(/"/g, "%22");
      return `data:image/svg+xml;charset=utf-8,${encoded}`;
    } catch {
      return "";
    }
  }

  /** Rasterize inline SVG so Word shows a bitmap (many builds omit data:image/svg+xml in <img>). */
  async function svgToExportSrc(svgEl) {
    try {
      const xml = new XMLSerializer().serializeToString(svgEl);
      let w = 860;
      let h = 360;
      const vb = svgEl.getAttribute("viewBox");
      if (vb) {
        const p = vb.trim().split(/[\s,]+/).map(Number);
        if (p.length >= 4 && p[2] > 0 && p[3] > 0) {
          w = p[2];
          h = p[3];
        }
      }
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg img load"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      const scale = Math.min(2.5, 1100 / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      return canvasToExportSrc(canvas);
    } catch (e) {
      console.warn("BKQuant export: SVG rasterize failed, using SVG data URL", e);
      const src = svgToDataUrl(svgEl);
      return { src, w: 720, h: 300 };
    }
  }

  function loadReportMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Figures for DOC/XLS: Plotly (PNG via Plotly.toImage), then canvas (Chart.js / custom), then SVG[data-exportable].
   * Skips canvas/SVG inside Plotly roots to avoid duplicates.
   */
  async function collectExportFigureBlocks() {
    const blocks = [];
    let n = 0;

    const plotlyRoots = $$("#contentBody .js-plotly-plot");
    for (const el of plotlyRoots) {
      try {
        if (typeof Plotly !== "undefined" && Plotly.toImage) {
          const pw = 1400;
          const ph = 820;
          const dataUrl = await Plotly.toImage(el, {
            format: "png",
            width: pw,
            height: ph,
            scale: 3,
          });
          n += 1;
          const img = exportFigureImgTag(n, dataUrl, pw, ph);
          blocks.push(
            `<div style="margin:20px 0;page-break-inside:avoid;break-inside:avoid">
              <p style="font-weight:800;margin:0 0 8px;font-size:13px;color:#0f172a">Figure ${n} (chart)</p>
              ${img}
            </div>`
          );
        }
      } catch (e) {
        console.warn("BKQuant export: Plotly figure skipped", e);
      }
    }

    const canvases = $$("#contentBody canvas").filter((c) => !c.closest(".js-plotly-plot"));
    for (const c of canvases) {
      const { src, w, h } = canvasToExportSrc(c);
      if (!src) continue;
      n += 1;
      const img = exportFigureImgTag(n, src, w, h);
      blocks.push(
        `<div style="margin:20px 0;page-break-inside:avoid;break-inside:avoid">
          <p style="font-weight:800;margin:0 0 8px;font-size:13px;color:#0f172a">Figure ${n}</p>
          ${img}
        </div>`
      );
    }

    const svgs = $$('#contentBody svg[data-exportable="1"]').filter((s) => !s.closest(".js-plotly-plot"));
    for (const s of svgs) {
      const { src, w, h } = await svgToExportSrc(s);
      if (!src) continue;
      n += 1;
      const img = exportFigureImgTag(n, src, w, h);
      blocks.push(
        `<div style="margin:20px 0;page-break-inside:avoid;break-inside:avoid">
          <p style="font-weight:800;margin:0 0 8px;font-size:13px;color:#0f172a">Figure ${n}</p>
          ${img}
        </div>`
      );
    }

    if (!blocks.length) {
      return `<p style="color:#64748b;font-size:12px;margin:12px 0">No figures captured in this view. Use modules with Plotly or Chart.js charts, or build publication-quality PNGs from CSV using python/report_quality_figures.py (see that script).</p>`;
    }
    return `<div style="margin:18px 0"><h2 style="font-size:16px;margin:0 0 12px;color:#0f172a">Figures</h2>${blocks.join("\n")}</div>`;
  }

  function getExportTablesFromContentBody() {
    const root = $("#contentBody");
    if (!root) return [];
    return Array.from(root.querySelectorAll("table")).filter((t) => {
      if (t.closest(".export-interpretation")) return false;
      if (t.rows && t.rows.length === 0) return false;
      return true;
    });
  }

  /** Short data-layout text included in Word/Excel exports (matches on-screen Import blurbs). */
  const MODULE_EXPORT_INPUT_FORMAT = {
    crd:
      "CRD grid: optional first column with treatment labels (T1, T2, …); remaining columns = replicate yields. Or omit labels — all numeric rows (treatments × replicates). Import updates T×R from the file.",
    rbd:
      "RBD grid: optional first column for treatment IDs; other columns = blocks (replications). Or all-numeric rows: treatments × blocks. Set T and B, Build grid, then Import.",
    factorial:
      "Factorial: set a, b, r and Build grid first. File = a×b rows (A×B combinations in table order) × r block columns; optional label column.",
    fact3:
      "Three-way factorial: set a, b, c, r and Build grid first. File = a×b×c rows × r columns; optional label column.",
    lattice:
      "Latin square: set t and Build square first. File = t rows × t numeric columns (plot yields); optional row label column.",
    augmented:
      "Augmented design: enter checks and new entries in the built tables (Import from file not yet provided — use paste or grid).",
    splitplot:
      "Split plot: set a, b, r and Build grid first. File = a×b rows × r columns; optional label column.",
    correlation:
      "Correlation: ≥3×3 numeric matrix, or two columns X,Y. See module Import blurb for details.",
    corpath:
      "Trait matrix: rows = plots/lines; optional Genotype column + trait columns (same as Import CSV / Excel).",
    regression: "Two columns: X then Y (optional header). ≥3 rows.",
    mlr: "Matrix: observations × variables; header optional (same as Import).",
    pca: "Observations × variables matrix; optional header row.",
    path: "Path calculator uses the built correlation matrix (paste or manual entry).",
    discriminant: "Grouped observations × variables (see module).",
    factoranalysis: "Data matrix as in module (Import CSV / Excel).",
    d2: "D² input layout as in module (Import CSV / Excel).",
    metroglyph: "Columns: Genotype, Cluster, Trait1, Trait2, … — numeric traits; ≥6 genotypes.",
    linetester: "Line × tester layout as in module (Import).",
    diallel: "Diallel: use graphical or DA screens; DA I includes Import where shown.",
    nc: "NC designs: fill grids per tab (Import not bundled — use grid entry).",
    triple: "TTC: columns Line (optional), L1, L2, L3 (Import CSV / Excel).",
    genmean: "One row: P1, P2, F1, F2, BC1, BC2 or named header row.",
    met: "MET layout as in module (Import CSV / Excel).",
    ammi: "AMMI matrix as in module (Import CSV / Excel).",
    biometric: "Genotype × trait or CRD matrix (Import buttons on module).",
    dataInsights: "Traits CSV: genotype column + trait columns (Import CSV / Excel).",
  };

  function wrapHtmlAsMhtml(htmlDocument) {
    const boundary = `----=_BKQ_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const imageParts = [];
    let n = 0;
    const htmlProcessed = htmlDocument.replace(/src="data:image\/(png|jpeg|jpg);base64,([^"]+)"/gi, (_, typ, b64) => {
      n += 1;
      const mime = typ.toLowerCase() === "png" ? "image/png" : "image/jpeg";
      const cid = `bkqfig${n}@bkquant.local`;
      imageParts.push({ mime, b64: String(b64).replace(/\s+/g, ""), cid });
      return `src="cid:${cid}"`;
    });

    const crlf = "\r\n";
    const lines = [];
    lines.push("MIME-Version: 1.0");
    lines.push(`Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=utf-8");
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("Content-Location: file:///C:/bkquant/report.htm");
    lines.push("");
    lines.push(String(htmlProcessed).replace(/\r?\n/g, crlf));

    for (const p of imageParts) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${p.mime}`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push(`Content-ID: <${p.cid}>`);
      lines.push("");
      lines.push(p.b64);
    }
    lines.push(`--${boundary}--`);
    return lines.join(crlf);
  }

  function buildExportTableSectionsHtml(tables, asExcel) {
    return tables
      .map((t, i) => {
        const prev = t.previousElementSibling;
        const capRaw =
          prev && prev.tagName === "H4" && prev.dataset.autoCaption === "1"
            ? String(prev.textContent || "").trim()
            : t.getAttribute("data-caption") || `Table ${i + 1}`;
        const spacer =
          i === 0
            ? ""
            : asExcel
              ? `<table style="width:100%;margin:0"><tr><td style="height:28px;border:none;font-size:1px">&nbsp;</td></tr></table>`
              : `<hr style="border:none;border-top:2px solid #cbd5e1;margin:22px 0" />`;
        return `${spacer}
        <div style="margin:18px 0;page-break-inside:avoid;break-inside:avoid;mso-pagination:widow-orphan">
          <h3 style="font-size:14px;margin:0 0 10px;color:#0f172a;font-weight:800">${qs(capRaw)}</h3>
          ${t.outerHTML}
        </div>`;
      })
      .join("\n");
  }

  /** Build DOC/XLS HTML with separated tables + embedded figures (Plotly PNG, canvas, SVG). */
  async function exportHtmlAsDocOrXls({ title, moduleId = "", interpretSelector = ".export-interpretation", filename, asExcel }) {
    const tables = getExportTablesFromContentBody();
    const interpretation = document.querySelector(interpretSelector)?.innerText || "";
    const meta = loadReportMeta() || {};

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const figureBlocks = await collectExportFigureBlocks();

    const tableHtml = buildExportTableSectionsHtml(tables, asExcel);

    const metaRows = [
      ["Website", "BKQuant"],
      ["Version", `BKQuant v${BKQUANT_VERSION}`],
      ["Analysis", title],
      ["Module ID", moduleId || CURRENT_MODULE_ID || ""],
      ["Researcher", meta.researcher || ""],
      ["Institution", meta.institution || ""],
      ["Crop", meta.crop || ""],
      ["Trait(s)", meta.traits || ""],
      ["Season/Year", meta.season || ""],
      ["Location", meta.location || ""],
      ["Date", meta.date || new Date().toISOString().slice(0, 10)],
      [
        "Methodology note",
        "Offline client-side computations. Some modules use approximate significance rules; for formal inference use standard statistical tables or peer-reviewed software.",
      ],
    ].filter((r) => String(r[1] || "").trim().length > 0);
    const runMeta = LAST_RUN_META[moduleId || CURRENT_MODULE_ID || ""] || {};
    const runRows = [
      ["Run timestamp", runMeta.timestamp || new Date().toISOString()],
      ["Force run mode", runMeta.forceRun ? "ON" : "OFF"],
      ["Input size", runMeta.inputSize || ""],
      ["Standardization", runMeta.standardization || ""],
      ["Batch preset", runMeta.batchPreset || ""],
      ["Preprocessing log", runMeta.preprocessing || ""],
      ["Quality score", runMeta.qualityScore || ""],
    ].filter((r) => String(r[1] || "").trim().length > 0);

    const metaTable =
      (metaRows.length || runRows.length)
        ? `<table style="width:100%;border-collapse:collapse;margin:10px 0 14px">
            <tbody>
              ${[...metaRows, ...runRows]
                .map(
                  ([k, v]) =>
                    `<tr>
                      <td style="border:1px solid #aaa;padding:6px;text-align:left;font-weight:700;background:#f7f7f7">${qs(k)}</td>
                      <td style="border:1px solid #aaa;padding:6px;text-align:left">${qs(String(v))}</td>
                    </tr>`
                )
                .join("")}
            </tbody>
          </table>`
        : "";

    const quotation = `
      <div style="margin-top:14px;border-top:1px solid #ccc;padding-top:10px">
        <div style="font-weight:700">BKQuant quotation (for researchers)</div>
        <div style="margin-top:6px">“An equation for me has no meaning unless it expresses a thought of God.” — Srinivasa Ramanujan</div>
        <div style="margin-top:6px">“Science and everyday life cannot and should not be separated.” — Rosalind Franklin</div>
      </div>
    `;

    const inputFmt = MODULE_EXPORT_INPUT_FORMAT[moduleId || CURRENT_MODULE_ID || ""] || "";
    const inputFormatBlock = inputFmt
      ? `<h2>Data import format</h2><p style="white-space:pre-wrap;line-height:1.55">${qs(inputFmt)}</p>`
      : "";

    // Word/Excel open HTML; explicit spacing + page-break hints for Word; row spacers for Excel HTML.
    const styles = asExcel
      ? `table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:12px}th,td{border:1px solid #999;padding:6px;text-align:center}h1{font-size:18px}h2{font-size:15px;margin-top:16px}h3{font-size:13px;text-align:left}img{max-width:100%;height:auto}`
      : `body{font-family:Calibri,Arial,sans-serif;font-size:12px;line-height:1.45}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:6px}h1{font-size:20px;margin-bottom:8px}h2{font-size:16px;margin:20px 0 10px;color:#0f172a}h3{font-size:14px}img{max-width:100%;height:auto}`;

    const htmlNs = asExcel
      ? `xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"`
      : `xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"`;

    const doc = `<!doctype html>
<html ${htmlNs}>
<head>
  <meta charset="utf-8"/>
  <meta name="ProgId" content="Word.Document"/>
  <title>${qs(title)}</title>
  <style>${styles}</style>
</head>
<body>
  <h1>${qs(title)}</h1>
  ${metaTable}
  ${inputFormatBlock}
  ${figureBlocks}
  <h2>Tables</h2>
  ${tableHtml}
  <h2>Interpretation</h2>
  <p style="white-space:pre-wrap">${qs(interpretation)}</p>
  ${quotation}
</body>
</html>`;

    if (asExcel) {
      downloadBlob(filename, "application/vnd.ms-excel", doc);
    } else {
      const mhtName = filename.replace(/\.doc$/i, ".mht");
      const mhtml = wrapHtmlAsMhtml(doc);
      downloadBlob(mhtName, "multipart/related", mhtml);
    }
  }

  // -----------------------------
  // Publication-grade chart drawing helpers (themes + canvas toolbars)
  // -----------------------------
  const CHART_THEMES = {
    emerald: {
      bg: "#f8fafc",
      plotBgTop: "#ffffff",
      plotBgBottom: "#eef2f7",
      ink: "#0f172a",
      inkMuted: "#475569",
      frame: "rgba(15, 23, 42, 0.14)",
      grid: "rgba(148, 163, 184, 0.42)",
      axis: "#334155",
      bar0: "#059669",
      bar1: "#047857",
      point: "#059669",
      pointStroke: "#ffffff",
      lineFit: "#b91c1c",
      lineAlt: "#0d9488",
      accentAmber: "#d97706",
      pointPalette: ["#059669", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#ea580c", "#0e7490", "#be123c"],
    },
    ocean: {
      bg: "#f0f9ff",
      plotBgTop: "#ffffff",
      plotBgBottom: "#e0f2fe",
      ink: "#0c4a6e",
      inkMuted: "#0369a1",
      frame: "rgba(3, 105, 161, 0.2)",
      grid: "rgba(56, 189, 248, 0.38)",
      axis: "#075985",
      bar0: "#0284c7",
      bar1: "#0369a1",
      point: "#0284c7",
      pointStroke: "#ffffff",
      lineFit: "#be123c",
      lineAlt: "#0891b2",
      accentAmber: "#f59e0b",
      pointPalette: ["#0284c7", "#06b6d4", "#6366f1", "#8b5cf6", "#0ea5e9", "#14b8a6", "#f97316", "#ec4899"],
    },
    sunset: {
      bg: "#fffbeb",
      plotBgTop: "#ffffff",
      plotBgBottom: "#ffedd5",
      ink: "#431407",
      inkMuted: "#9a3412",
      frame: "rgba(154, 52, 18, 0.18)",
      grid: "rgba(251, 146, 60, 0.38)",
      axis: "#9a3412",
      bar0: "#ea580c",
      bar1: "#c2410c",
      point: "#ea580c",
      pointStroke: "#ffffff",
      lineFit: "#7c3aed",
      lineAlt: "#db2777",
      accentAmber: "#ca8a04",
      pointPalette: ["#ea580c", "#dc2626", "#ca8a04", "#16a34a", "#2563eb", "#9333ea", "#db2777", "#0891b2"],
    },
    ink: {
      bg: "#fafafa",
      plotBgTop: "#ffffff",
      plotBgBottom: "#f4f4f5",
      ink: "#18181b",
      inkMuted: "#52525b",
      frame: "rgba(24, 24, 27, 0.15)",
      grid: "rgba(113, 113, 122, 0.38)",
      axis: "#3f3f46",
      bar0: "#52525b",
      bar1: "#27272a",
      point: "#3f3f46",
      pointStroke: "#ffffff",
      lineFit: "#71717a",
      lineAlt: "#a1a1aa",
      accentAmber: "#a16207",
      pointPalette: ["#3f3f46", "#52525b", "#71717a", "#a1a1aa", "#78716c", "#57534e", "#44403c", "#292524"],
    },
  };

  const CHART = { ...CHART_THEMES.emerald };

  function applyChartThemeFromStorage() {
    const name = localStorage.getItem("bkq_chart_theme") || "emerald";
    const t = CHART_THEMES[name] || CHART_THEMES.emerald;
    Object.assign(CHART, t);
  }

  function chartBarsMultiColor() {
    return (localStorage.getItem("bkq_chart_bars") || "multi") !== "gradient";
  }

  function darkenHex(hex, amt) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return "#047857";
    const n = parseInt(m[1], 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * (1 - amt))));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * (1 - amt))));
    const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * (1 - amt))));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function barFillGradient(ctx, x, y, w, h, i, multiColor) {
    if (multiColor) {
      const c = CHART.pointPalette[i % CHART.pointPalette.length];
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, c);
      g.addColorStop(1, darkenHex(c, 0.28));
      return g;
    }
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, CHART.bar0);
    g.addColorStop(1, CHART.bar1);
    return g;
  }

  function fillPlotBackground(ctx, padL, plotTop, plotW, plotH) {
    const g = ctx.createLinearGradient(0, plotTop, 0, plotTop + plotH);
    g.addColorStop(0, CHART.plotBgTop || CHART.bg);
    g.addColorStop(1, CHART.plotBgBottom || CHART.bg);
    ctx.fillStyle = g;
    ctx.fillRect(padL, plotTop, plotW, plotH);
  }

  function downloadCanvasPng(canvas, filename) {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "bkquant-chart.png";
      a.click();
    } catch (e) {
      alert(e?.message || "Could not export chart image.");
    }
  }

  function downloadSvgElement(svgEl, filename) {
    try {
      const xml = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "bkquant-figure.svg";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.message || "Could not export SVG.");
    }
  }

  /** Add theme + download controls to each .chart (canvas or exportable SVG). Idempotent. */
  function initChartPanels(containerSel = "#contentBody") {
    const root = document.querySelector(containerSel);
    if (!root) return;

    const themeOpts = [
      ["emerald", "Emerald"],
      ["ocean", "Ocean"],
      ["sunset", "Sunset"],
      ["ink", "Ink"],
    ];
    const barOpts = [
      ["multi", "Multi-color bars"],
      ["gradient", "Two-tone gradient"],
    ];

    root.querySelectorAll(".chart").forEach((chartEl) => {
      if (chartEl.dataset.bkqChartUi === "1") return;
      const canvas = chartEl.querySelector("canvas");
      const svg = chartEl.querySelector('svg[data-exportable="1"]');
      if (!canvas && !svg) return;

      chartEl.dataset.bkqChartUi = "1";
      chartEl.classList.add("chart--with-toolbar");

      const toolbar = document.createElement("div");
      toolbar.className = "chart-toolbar";
      const fullControls = Boolean(canvas);
      toolbar.innerHTML = fullControls
        ? `
        <div class="chart-toolbar__lead">
          <span class="chart-toolbar__label">Figure</span>
          <details class="chart-toolbar__opts">
            <summary class="chart-toolbar__summary">Customize</summary>
            <div class="chart-toolbar__opts-inner">
              <label class="chart-toolbar__field">
                <span>Theme</span>
                <select data-bkq-chart-theme aria-label="Chart color theme">
                  ${themeOpts.map(([v, lab]) => `<option value="${v}">${lab}</option>`).join("")}
                </select>
              </label>
              <label class="chart-toolbar__field">
                <span>Bars</span>
                <select data-bkq-chart-bars aria-label="Bar style">
                  ${barOpts.map(([v, lab]) => `<option value="${v}">${lab}</option>`).join("")}
                </select>
              </label>
              <p class="chart-toolbar-hint">Theme and bar style apply after you click <strong>Compute</strong> again.</p>
            </div>
          </details>
        </div>
        <button type="button" class="chart-download-btn chart-download-btn--primary" data-bkq-chart-download title="Download PNG" aria-label="Download figure as PNG">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
          </svg>
        </button>
      `
        : `
        <div class="chart-toolbar__lead">
          <span class="chart-toolbar__label">Figure</span>
          <details class="chart-toolbar__opts chart-toolbar__opts--minimal">
            <summary class="chart-toolbar__summary">About this figure</summary>
            <p class="chart-toolbar-hint">Vector diagram — use the download button for SVG.</p>
          </details>
        </div>
        <button type="button" class="chart-download-btn chart-download-btn--primary" data-bkq-chart-download title="Download SVG" aria-label="Download figure as SVG">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
          </svg>
        </button>
      `;

      const selTheme = toolbar.querySelector("[data-bkq-chart-theme]");
      const selBars = toolbar.querySelector("[data-bkq-chart-bars]");
      if (selTheme) selTheme.value = localStorage.getItem("bkq_chart_theme") || "emerald";
      if (selBars) selBars.value = localStorage.getItem("bkq_chart_bars") || "multi";

      selTheme?.addEventListener("change", () => {
        localStorage.setItem("bkq_chart_theme", selTheme.value);
      });
      selBars?.addEventListener("change", () => {
        localStorage.setItem("bkq_chart_bars", selBars.value);
      });

      toolbar.querySelector("[data-bkq-chart-download]")?.addEventListener("click", () => {
        if (canvas) {
          const id = canvas.id || "chart";
          downloadCanvasPng(canvas, `${id.replace(/[^a-z0-9_-]/gi, "_")}.png`);
        } else if (svg) {
          const id = svg.id || "figure";
          downloadSvgElement(svg, `${id.replace(/[^a-z0-9_-]/gi, "_")}.svg`);
        }
      });

      if (canvas) {
        const wrap = document.createElement("div");
        wrap.className = "chart-canvas-wrap";
        chartEl.insertBefore(toolbar, canvas);
        chartEl.insertBefore(wrap, canvas);
        wrap.appendChild(canvas);
      } else {
        chartEl.insertBefore(toolbar, svg);
      }
    });
  }

  function setupCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(480, Math.floor(rect.width));
    const h = Math.max(320, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (typeof ctx.imageSmoothingQuality === "string") ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function formatChartTick(n) {
    const a = Math.abs(n);
    if (a >= 10000) return n.toExponential(1);
    if (a >= 100) return n.toFixed(0);
    if (a >= 10) return n.toFixed(1);
    if (a >= 1) return n.toFixed(2);
    return n.toFixed(3);
  }

  function niceNum(range, round) {
    const exponent = Math.floor(Math.log10(Math.max(1e-12, range)));
    const fraction = range / 10 ** exponent;
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return niceFraction * 10 ** exponent;
  }

  function niceScale(min, max, ticks = 6) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.2 };
    if (Math.abs(max - min) <= 1e-12) {
      const c = min;
      const step = Math.max(1e-6, Math.abs(c) * 0.1 || 1);
      return { min: c - 2 * step, max: c + 2 * step, step };
    }
    const rawRange = max - min;
    const niceRange = niceNum(rawRange, false);
    const step = niceNum(niceRange / Math.max(2, ticks - 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    return { min: niceMin, max: niceMax, step };
  }

  function drawBarChart(canvas, labels, values, opts = {}) {
    applyChartThemeFromStorage();
    const title = opts.title;
    const multiColor = opts.multiColor !== undefined ? opts.multiColor : chartBarsMultiColor();
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 62;
    const padR = 18;
    const padT = title ? 42 : 26;
    const padB = 62;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const dMin = Math.min(...values, 0);
    const dMax = Math.max(...values);
    const sc = niceScale(dMin, dMax, 6);
    const min = sc.min;
    const max = sc.max;
    const step = sc.step;
    const grid = Math.max(2, Math.round((max - min) / step));
    const plotTop = padT;
    const plotBottom = padT + plotH;
    const scaleY = plotH / (max - min);
    const n = Math.max(1, values.length);
    const barSlot = plotW / n;
    const barW = Math.max(10, Math.min(52, barSlot - 10));

    ctx.fillStyle = CHART.bg;
    ctx.fillRect(0, 0, w, h);
    fillPlotBackground(ctx, padL, plotTop, plotW, plotH);

    ctx.strokeStyle = CHART.frame;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(padL + 0.5, plotTop + 0.5, plotW - 1, plotH - 1);

    if (title) {
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 16px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, padL, 8);
    }

    for (let i = 0; i <= grid; i++) {
      const t = i / grid;
      const y = plotBottom - t * plotH;
      ctx.strokeStyle = CHART.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      const val = min + (max - min) * t;
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 12px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatChartTick(val), padL - 8, y);
    }

    ctx.strokeStyle = CHART.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padL, plotBottom);
    ctx.lineTo(padL + plotW, plotBottom);
    ctx.stroke();

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const cx = padL + i * barSlot + barSlot / 2;
      const x = cx - barW / 2;
      const bh = (v - min) * scaleY;
      const y = plotBottom - bh;

      ctx.fillStyle = barFillGradient(ctx, x, y, barW, bh, i, multiColor);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.18)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, barW, bh, 10);
      ctx.fill();
      ctx.stroke();

      if (bh > 18) {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "700 11px Segoe UI, system-ui, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(formatChartTick(v), cx, y - 4);
      }

      const lbl = String(labels[i] ?? "");
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 11px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.save();
      ctx.translate(cx, plotBottom + 10);
      ctx.rotate(-Math.PI / 9);
      ctx.fillText(lbl.length > 18 ? lbl.slice(0, 17) + "…" : lbl, 0, 0);
      ctx.restore();
    }
  }

  /** Bar chart of means with vertical error bars at ±SEm (for RBD/mean plots). */
  function drawBarChartWithErrorBars(canvas, labels, values, sems, opts = {}) {
    applyChartThemeFromStorage();
    const title = opts.title;
    const multiColor = opts.multiColor !== undefined ? opts.multiColor : chartBarsMultiColor();
    const sem = sems && sems.length === values.length ? sems : values.map(() => 0);
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 62;
    const padR = 18;
    const padT = title ? 42 : 26;
    const padB = 62;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const lows = values.map((v, i) => v - sem[i]);
    const highs = values.map((v, i) => v + sem[i]);
    const dMin = Math.min(...values, ...lows, 0);
    const dMax = Math.max(...values, ...highs);
    const sc = niceScale(dMin, dMax, 6);
    const min = sc.min;
    const max = sc.max;
    const step = sc.step;
    const grid = Math.max(2, Math.round((max - min) / step));
    const plotTop = padT;
    const plotBottom = padT + plotH;
    const range = Math.max(1e-12, max - min);
    const scaleY = plotH / range;
    const n = Math.max(1, values.length);
    const barSlot = plotW / n;
    const barW = Math.max(10, Math.min(52, barSlot - 10));

    ctx.fillStyle = CHART.bg;
    ctx.fillRect(0, 0, w, h);
    fillPlotBackground(ctx, padL, plotTop, plotW, plotH);

    ctx.strokeStyle = CHART.frame;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(padL + 0.5, plotTop + 0.5, plotW - 1, plotH - 1);

    if (title) {
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 16px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, padL, 8);
    }

    for (let i = 0; i <= grid; i++) {
      const t = i / grid;
      const y = plotBottom - t * plotH;
      ctx.strokeStyle = CHART.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      const val = min + (max - min) * t;
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 12px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatChartTick(val), padL - 8, y);
    }

    ctx.strokeStyle = CHART.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padL, plotBottom);
    ctx.lineTo(padL + plotW, plotBottom);
    ctx.stroke();

    const gy = (yv) => plotBottom - ((yv - min) / range) * plotH;
    const errColor = CHART.inkMuted || "#475569";

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const cx = padL + i * barSlot + barSlot / 2;
      const x = cx - barW / 2;
      const bh = (v - min) * scaleY;
      const y = plotBottom - bh;

      ctx.fillStyle = barFillGradient(ctx, x, y, barW, bh, i, multiColor);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.18)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, barW, bh, 10);
      ctx.fill();
      ctx.stroke();

      const cap = 5;
      const yLo = gy(v - sem[i]);
      const yHi = gy(v + sem[i]);
      ctx.strokeStyle = errColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, yLo);
      ctx.lineTo(cx, yHi);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - cap, yLo);
      ctx.lineTo(cx + cap, yLo);
      ctx.moveTo(cx - cap, yHi);
      ctx.lineTo(cx + cap, yHi);
      ctx.stroke();

      if (bh > 18) {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "700 11px Segoe UI, system-ui, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(formatChartTick(v), cx, y - 4);
      }

      const lbl = String(labels[i] ?? "");
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 11px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.save();
      ctx.translate(cx, plotBottom + 10);
      ctx.rotate(-Math.PI / 9);
      ctx.fillText(lbl.length > 18 ? lbl.slice(0, 17) + "…" : lbl, 0, 0);
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawScatterPlot(canvas, points, { title, xLabel, yLabel } = {}) {
    applyChartThemeFromStorage();
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 62;
    const padR = 22;
    const padT = title ? 40 : 26;
    const padB = 52;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const sx = niceScale(Math.min(...xs), Math.max(...xs), 6);
    const sy = niceScale(Math.min(...ys), Math.max(...ys), 6);
    const minX = sx.min;
    const maxX = sx.max;
    const minY = sy.min;
    const maxY = sy.max;
    const rangeX = Math.max(1e-9, maxX - minX);
    const rangeY = Math.max(1e-9, maxY - minY);
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const plotTop = padT;
    const plotBottom = padT + plotH;
    const plotLeft = padL;
    const plotRight = padL + plotW;
    const gx = (xv) => plotLeft + ((xv - minX) / rangeX) * plotW;
    const gy = (yv) => plotBottom - ((yv - minY) / rangeY) * plotH;

    ctx.fillStyle = CHART.bg;
    ctx.fillRect(0, 0, w, h);
    fillPlotBackground(ctx, plotLeft, plotTop, plotW, plotH);

    if (title) {
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 16px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, padL, 8);
    }

    ctx.strokeStyle = CHART.frame;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(plotLeft + 0.5, plotTop + 0.5, plotW - 1, plotH - 1);

    const grid = 6;
    for (let i = 0; i <= grid; i++) {
      const t = i / grid;
      const y = plotBottom - t * plotH;
      ctx.strokeStyle = CHART.grid;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      const val = minY + (maxY - minY) * t;
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 12px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatChartTick(val), plotLeft - 8, y);
    }
    for (let j = 0; j <= grid; j++) {
      const t = j / grid;
      const x = plotLeft + t * plotW;
      ctx.strokeStyle = CHART.grid;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      const val = minX + (maxX - minX) * t;
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 11px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(formatChartTick(val), x, plotBottom + 6);
    }

    ctx.strokeStyle = CHART.axis;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.moveTo(plotLeft, plotTop);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.stroke();

    points.forEach((p, idx) => {
      const px = gx(p.x);
      const py = gy(p.y);
      const cIdx = Number.isFinite(p.c) ? Math.abs(p.c) : idx;
      ctx.fillStyle = CHART.pointPalette[cIdx % CHART.pointPalette.length] || CHART.point;
      ctx.strokeStyle = CHART.pointStroke;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(px, py, 4.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(15, 23, 42, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 4.8, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.fillStyle = CHART.inkMuted;
    ctx.font = "600 12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(xLabel || "", (plotLeft + plotRight) / 2, h - 18);
    ctx.save();
    ctx.translate(16, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(yLabel || "", 0, 0);
    ctx.restore();
  }

  /** PCA biplot: observation scores (PC1 vs PC2) + variable loading vectors (scaled for visibility). */
  function drawPcaBiplot(canvas, scores12, loadings12, varNames, { title } = {}) {
    applyChartThemeFromStorage();
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 62;
    const padR = 22;
    const padT = title ? 40 : 26;
    const padB = 52;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const plotTop = padT;
    const plotBottom = padT + plotH;
    const plotLeft = padL;
    const plotRight = padL + plotW;

    const sxRaw = scores12.map((r) => r[0]);
    const syRaw = scores12.map((r) => r[1]);
    const maxAbsScore = Math.max(...sxRaw.map((x) => Math.abs(x)), ...syRaw.map((y) => Math.abs(y)), 1e-9);
    const maxAbsLoad = Math.max(
      0.15,
      ...loadings12.flatMap((r) => [Math.abs(r[0]), Math.abs(r[1])])
    );
    const scaleArrows = (0.5 * maxAbsScore) / maxAbsLoad;
    const ax = loadings12.map((r) => r[0] * scaleArrows);
    const ay = loadings12.map((r) => r[1] * scaleArrows);

    const allX = [...sxRaw, ...ax, 0];
    const allY = [...syRaw, ...ay, 0];
    const sx = niceScale(Math.min(...allX), Math.max(...allX), 6);
    const sy = niceScale(Math.min(...allY), Math.max(...allY), 6);
    const minX = sx.min;
    const maxX = sx.max;
    const minY = sy.min;
    const maxY = sy.max;
    const rangeX = Math.max(1e-9, maxX - minX);
    const rangeY = Math.max(1e-9, maxY - minY);
    const gx = (xv) => plotLeft + ((xv - minX) / rangeX) * plotW;
    const gy = (yv) => plotBottom - ((yv - minY) / rangeY) * plotH;

    ctx.fillStyle = CHART.bg;
    ctx.fillRect(0, 0, w, h);
    fillPlotBackground(ctx, plotLeft, plotTop, plotW, plotH);
    if (title) {
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 16px Segoe UI, system-ui, Arial, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, padL, 8);
    }
    ctx.strokeStyle = CHART.frame;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(plotLeft + 0.5, plotTop + 0.5, plotW - 1, plotH - 1);

    const ox = gx(0);
    const oy = gy(0);
    if (ox >= plotLeft && ox <= plotRight && oy >= plotTop && oy <= plotBottom) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox, plotTop);
      ctx.lineTo(ox, plotBottom);
      ctx.moveTo(plotLeft, oy);
      ctx.lineTo(plotRight, oy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    scores12.forEach((r, idx) => {
      const px = gx(r[0]);
      const py = gy(r[1]);
      ctx.fillStyle = CHART.pointPalette[idx % CHART.pointPalette.length];
      ctx.strokeStyle = CHART.pointStroke;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    loadings12.forEach((r, j) => {
      const x1 = r[0] * scaleArrows;
      const y1 = r[1] * scaleArrows;
      const px = gx(x1);
      const py = gy(y1);
      ctx.strokeStyle = CHART.accentAmber;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = CHART.accentAmber;
      ctx.font = "700 11px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const nm = varNames[j] || `V${j + 1}`;
      ctx.fillText(nm.length > 14 ? nm.slice(0, 13) + "…" : nm, px + 4, py - 2);
    });

    ctx.fillStyle = CHART.inkMuted;
    ctx.font = "600 12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("PC1", (plotLeft + plotRight) / 2, h - 18);
    ctx.save();
    ctx.translate(16, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("PC2", 0, 0);
    ctx.restore();
  }

  /** Matches drawScatterPlot layout so overlays (regression line, labels) align. */
  function scatterPlotGeo(w, h, withTitle) {
    const padL = 62;
    const padR = 22;
    const padT = withTitle ? 38 : 24;
    const padB = 52;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const plotBottom = padT + plotH;
    return { padL, padR, padT, padB, plotW, plotH, plotBottom };
  }

  function projectScatterXY(w, h, withTitle, minX, rangeX, minY, rangeY, x, y) {
    const g = scatterPlotGeo(w, h, withTitle);
    return {
      px: g.padL + ((x - minX) / rangeX) * g.plotW,
      py: g.plotBottom - ((y - minY) / rangeY) * g.plotH,
    };
  }

  // -----------------------------
  // Stats helpers (lightweight)
  // -----------------------------
  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function sumsq(arr) {
    return arr.reduce((a, b) => a + b * b, 0);
  }

  // Approximate p-value (normal/t distribution approximation not implemented).
  // For this offline educational/offline demo, we compute F and compare vs typical thresholds only.
  function approxFSignificance(fStat, df1, df2) {
    // Very rough mapping to 5%/1% by typical values; used to produce a qualitative interpretation.
    // This avoids heavy dependencies in offline JS.
    // Thresholds: for common df, F(0.05) ~ 3.2 to 4.1, F(0.01) ~ 5.5 to 7.0.
    const dfFactor = Math.min(1, (df1 + df2) / 30);
    const thr5 = 3.2 + 0.9 * dfFactor; // ~3.2-4.1
    const thr1 = 5.5 + 1.4 * dfFactor; // ~5.5-6.9
    if (fStat >= thr1) return { level: "1%", ok: true, note: "Highly significant (approx.)" };
    if (fStat >= thr5) return { level: "5%", ok: true, note: "Significant (approx.)" };
    return { level: "ns", ok: false, note: "Not significant (approx.)" };
  }

  function computeBreedingSummaryStats({ meanValue, msGenotype, msError, replications, selectionIntensity = 2.06, dfError = null }) {
    const r = Math.max(1, replications || 1);
    const meanSafe = Math.max(1e-12, Math.abs(meanValue));
    const sigmaG = Math.max(0, (msGenotype - msError) / r);
    const sigmaE = Math.max(0, msError);
    const sigmaP = Math.max(0, sigmaG + sigmaE);

    const pcv = (Math.sqrt(sigmaP) / meanSafe) * 100;
    const gcv = (Math.sqrt(sigmaG) / meanSafe) * 100;
    const ecv = (Math.sqrt(sigmaE) / meanSafe) * 100;
    const h2 = sigmaP <= 1e-12 ? 0 : (sigmaG / sigmaP) * 100;
    const ga = selectionIntensity * Math.sqrt(sigmaP) * (h2 / 100);
    const gaPct = (ga / meanSafe) * 100;

    const sem = Math.sqrt(msError / r);
    const sed = Math.sqrt((2 * msError) / r);
    let cd5 = 2.06 * sed;
    let cd1 = 2.76 * sed;
    if (dfError != null && Number.isFinite(dfError) && dfError > 0) {
      cd5 = studentTInvTwoTail(dfError, 0.05) * sed;
      cd1 = studentTInvTwoTail(dfError, 0.01) * sed;
    }
    const cv = (Math.sqrt(msError) / meanSafe) * 100;

    return { cv, cd5, cd1, sem, sed, h2, ga, gaPct, pcv, gcv, ecv, sigmaG, sigmaE, sigmaP };
  }

  function parseGridNumbers(text) {
    // Accept comma/space/newline separated numbers.
    const t = (text || "").trim();
    if (!t) return [];
    return t
      .split(/[\s,;]+/)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));
  }

  function buildTable(headers, rows) {
    const th = headers.map((h) => `<th>${qs(h)}</th>`).join("");
    const tr = rows
      .map((r) => {
        const tds = r.map((c) => `<td>${typeof c === "number" ? c.toFixed(4).replace(/\.?0+$/,"").replace(/(\.\d*[1-9])0+$/,'$1') : qs(String(c))}</td>`).join("");
        return `<tr>${tds}</tr>`;
      })
      .join("");
    return `<table class="data"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  }

  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const item of arr) {
      const k = keyFn(item);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(item);
    }
    return m;
  }

  /** Line × Tester: % of hybrid (factorial) SS; SE of GCA/SCA; genetic advance; potence ratio. */
  function lineTesterHybridVariancePct(ssLine, ssTester, ssLT) {
    const sum = ssLine + ssTester + ssLT;
    if (sum <= 1e-18) return { pLine: 0, pTester: 0, pLT: 0, sum };
    return {
      pLine: (100 * ssLine) / sum,
      pTester: (100 * ssTester) / sum,
      pLT: (100 * ssLT) / sum,
      sum,
    };
  }

  function lineTesterSEs(msError, r, l, t) {
    const rr = Math.max(1, r);
    return {
      seLineGca: Math.sqrt(msError / (rr * t)),
      seTesterGca: Math.sqrt(msError / (rr * l)),
      seCrossMean: Math.sqrt(msError / rr),
      seSca: Math.sqrt((msError * (l - 1) * (t - 1)) / (rr * l * t)),
    };
  }

  /** GA = k · σ_p · h² with σ_p from line means MS, h² = (MS_L − MSE)/MS_L (narrow on line means). */
  function lineTesterGeneticAdvance(msLine, msError, r, t, grandMean, k) {
    const rr = Math.max(1, r);
    const sigmaP = Math.sqrt(Math.max(1e-18, msLine / (rr * t)));
    const h2 = msLine <= 1e-18 ? 0 : Math.max(0, (msLine - msError) / msLine);
    const gaAbs = k * sigmaP * h2;
    const gaPct = Math.abs(grandMean) > 1e-18 ? (100 * gaAbs) / Math.abs(grandMean) : 0;
    return { sigmaP, h2, gaAbs, gaPct };
  }

  /**
   * Potence ratio: √(σ²_SCA / (2 σ²_GCA_line σ²_GCA_tester)) with σ² from EMS (random model);
   * altRatio = MS_LT / (MS_Line + MS_Tester) as a simple dominance/additive screen.
   */
  function lineTesterPotenceRatio(msLine, msTester, msLT, msError, r, l, t) {
    const rr = Math.max(1, r);
    const g2L = Math.max(0, (msLine - msError) / (rr * t));
    const g2T = Math.max(0, (msTester - msError) / (rr * l));
    const s2 = Math.max(0, (msLT - msError) / rr);
    const inner = 2 * g2L * g2T;
    const potence = inner <= 1e-24 ? 0 : Math.sqrt(s2) / Math.sqrt(inner);
    const altRatio = msLine + msTester <= 1e-18 ? 0 : msLT / (msLine + msTester);
    return { potence, altRatio, sigmaSca2: s2, sigmaGcaLine2: g2L, sigmaGcaTester2: g2T };
  }

  /** Single check vs hybrid mean contrast (1 df); same MSE as hybrid analysis (approximate). */
  function lineTesterCheckContrastSS(meanCheck, meanHybrid, r, l, t) {
    const lt = l * t;
    const diff = meanCheck - meanHybrid;
    const ss = (r * lt * diff * diff) / (lt + 1);
    return { ss, df: 1, ms: ss };
  }

  /**
   * NC Design I (balanced): females nested within males; y[i][j][k] = rep k of cross male i × female j.
   * Partition: Males, Females within Males, Error (RCBD-style blocks optional — here CRD pooled error).
   */
  function ncDesign1NestedAnova(y, a, b, r) {
    let sumY2 = 0;
    let G = 0;
    const Ti = Array(a).fill(0);
    const Tij = Array.from({ length: a }, () => Array(b).fill(0));
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < b; j++) {
        for (let k = 0; k < r; k++) {
          const v = y[i][j][k];
          sumY2 += v * v;
          G += v;
          Ti[i] += v;
          Tij[i][j] += v;
        }
      }
    }
    const N = a * b * r;
    const CF = (G * G) / N;
    const ssTotal = sumY2 - CF;
    let ssM = 0;
    for (let i = 0; i < a; i++) ssM += (Ti[i] * Ti[i]) / (b * r);
    ssM -= CF;
    let ssFM = 0;
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < b; j++) ssFM += (Tij[i][j] * Tij[i][j]) / r;
      ssFM -= (Ti[i] * Ti[i]) / (b * r);
    }
    const ssError = ssTotal - ssM - ssFM;
    const dfM = a - 1;
    const dfFM = a * (b - 1);
    const dfE = a * b * (r - 1);
    const msM = dfM > 0 ? ssM / dfM : 0;
    const msFM = dfFM > 0 ? ssFM / dfFM : 0;
    const msE = dfE > 0 ? ssError / dfE : 0;
    const fM = msFM <= 1e-18 ? 0 : msM / msFM;
    const fFM = msE <= 1e-18 ? 0 : msFM / msE;
    const sigma2e = msE;
    const sigmaFM = Math.max(0, (msFM - msE) / r);
    const sigmaM = Math.max(0, (msM - msFM) / (r * b));
    const VA = 4 * sigmaM;
    const VD = Math.max(0, 4 * (sigmaFM - sigmaM));
    return {
      ssTotal,
      ssM,
      ssFM,
      ssError,
      dfM,
      dfFM,
      dfE,
      msM,
      msFM,
      msE,
      fM,
      fFM,
      sigmaM,
      sigmaFM,
      sigma2e,
      VA,
      VD,
      grandMean: G / N,
    };
  }

  /**
   * NC Design II / III (balanced factorial): males × females × reps; same SS as L×T without rep blocking in total partition.
   * Uses RCBD partition: Replication + Males + Females + M×F + Error.
   */
  function ncDesign2FactorialAnova(y, a, b, r) {
    let sumY2 = 0;
    let G = 0;
    const repTotals = Array(r).fill(0);
    const maleTotals = Array(a).fill(0);
    const femaleTotals = Array(b).fill(0);
    const crossTotals = Array.from({ length: a }, () => Array(b).fill(0));
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < b; j++) {
        for (let k = 0; k < r; k++) {
          const v = y[i][j][k];
          sumY2 += v * v;
          G += v;
          repTotals[k] += v;
          maleTotals[i] += v;
          femaleTotals[j] += v;
          crossTotals[i][j] += v;
        }
      }
    }
    const N = a * b * r;
    const CF = (G * G) / N;
    const ssTotal = sumY2 - CF;
    let ssRep = 0;
    for (let k = 0; k < r; k++) ssRep += (repTotals[k] * repTotals[k]) / (a * b);
    ssRep -= CF;
    let ssM = 0;
    for (let i = 0; i < a; i++) ssM += (maleTotals[i] * maleTotals[i]) / (b * r);
    ssM -= CF;
    let ssF = 0;
    for (let j = 0; j < b; j++) ssF += (femaleTotals[j] * femaleTotals[j]) / (a * r);
    ssF -= CF;
    let ssCross = 0;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) ssCross += (crossTotals[i][j] * crossTotals[i][j]) / r;
    ssCross -= CF;
    const ssMF = ssCross - ssM - ssF;
    const ssError = ssTotal - ssRep - ssM - ssF - ssMF;
    const dfRep = r - 1;
    const dfM = a - 1;
    const dfF = b - 1;
    const dfMF = (a - 1) * (b - 1);
    const dfE = (r - 1) * (a * b - 1);
    const msRep = dfRep > 0 ? ssRep / dfRep : 0;
    const msM = dfM > 0 ? ssM / dfM : 0;
    const msF = dfF > 0 ? ssF / dfF : 0;
    const msMF = dfMF > 0 ? ssMF / dfMF : 0;
    const msE = dfE > 0 ? ssError / dfE : 0;
    const fM = msE <= 1e-18 ? 0 : msM / msE;
    const fF = msE <= 1e-18 ? 0 : msF / msE;
    const fMF = msE <= 1e-18 ? 0 : msMF / msE;
    const sigmaM = Math.max(0, (msM - msMF) / (r * b));
    const sigmaF = Math.max(0, (msF - msMF) / (r * a));
    const sigmaMF = Math.max(0, (msMF - msE) / r);
    const VA = 2 * (sigmaM + sigmaF);
    const VD = 4 * sigmaMF;
    return {
      ssTotal,
      ssRep,
      ssM,
      ssF,
      ssMF,
      ssError,
      dfRep,
      dfM,
      dfF,
      dfMF,
      dfE,
      msRep,
      msM,
      msF,
      msMF,
      msE,
      fM,
      fF,
      fMF,
      sigmaM,
      sigmaF,
      sigmaMF,
      VA,
      VD,
      grandMean: G / N,
    };
  }

  function ncDegreeDominanceAndH2(VA, VD, VE) {
    const vp = VA + VD + VE;
    const h2Narrow = vp <= 1e-18 ? 0 : VA / vp;
    const ratio = VA <= 1e-18 ? 0 : VD / VA;
    const degPow4 = ratio <= 0 ? 0 : Math.pow(ratio, 0.25);
    const degSqrt2 = VA <= 1e-18 ? 0 : Math.sqrt((2 * VD) / VA);
    return { h2Narrow, ratioVDVA: ratio, degPow4, degSqrt2, vp };
  }

  /**
   * One-way CRD ANOVA. `groups` = one array of observations per treatment (lengths may differ).
   * Treatment SS is Type III for the single factor (same as Σ T_i²/n_i − G²/N).
   */
  function crdAnovaOneWay(groups) {
    const t = groups.length;
    const ns = groups.map((g) => g.length);
    const N = ns.reduce((a, b) => a + b, 0);
    const all = groups.flat();
    const grandTotal = all.reduce((a, b) => a + b, 0);
    const CF = (grandTotal * grandTotal) / N;

    let ssTotal = 0;
    for (const y of all) ssTotal += y * y;
    ssTotal -= CF;

    const treatmentTotals = groups.map((arr) => arr.reduce((a, b) => a + b, 0));
    let ssTreat = 0;
    for (let i = 0; i < t; i++) ssTreat += (treatmentTotals[i] * treatmentTotals[i]) / ns[i];
    ssTreat -= CF;

    const ssError = ssTotal - ssTreat;
    const dfTreat = t - 1;
    const dfError = N - t;
    const msTreat = dfTreat > 0 ? ssTreat / dfTreat : 0;
    const msError = dfError > 0 ? ssError / dfError : 0;
    const fStat = msError <= 1e-18 ? 0 : msTreat / msError;
    const sig = approxFSignificance(fStat, dfTreat, dfError);
    const pTreat = fPValueUpperTail(fStat, dfTreat, dfError);
    const balanced = ns.every((n) => n === ns[0]);

    const means = groups.map((arr, i) => ({
      treatment: `T${i + 1}`,
      mean: mean(arr),
      n: ns[i],
      total: treatmentTotals[i],
    }));
    return {
      ssTotal,
      ssTreat,
      ssError,
      dfTreat,
      dfError,
      msTreat,
      msError,
      fStat,
      sig,
      pTreat,
      balanced,
      ns,
      means,
    };
  }

  /** Back-compat: `matrix` rows = treatments; columns = reps (optional empty cells for unequal n). `reps` ignored. */
  function crdAnova(matrix, reps) {
    const groups = matrix.map((row) => row.filter((v) => Number.isFinite(v)));
    return crdAnovaOneWay(groups);
  }

  /** Levene (mean-based): ANOVA on z_ij = |y_ij − ȳ_i|. Same df as CRD on original data. */
  function leveneTest(groups) {
    const zGroups = groups.map((g) => {
      if (g.length === 0) return [];
      const m = mean(g);
      return g.map((v) => Math.abs(v - m));
    });
    return crdAnovaOneWay(zGroups);
  }

  /** Fisher LSD between treatment means i and j (unbalanced): t_{α/2, df_e} √(MSE (1/n_i + 1/n_j)). */
  function pairwiseFisherLsd(ns, mse, dfError, alphaTwoTail) {
    if (dfError <= 0 || !Number.isFinite(mse) || mse < 0) return [];
    const tCrit = studentTInvTwoTail(dfError, alphaTwoTail);
    const t = ns.length;
    const rows = [];
    for (let i = 0; i < t; i++) {
      for (let j = i + 1; j < t; j++) {
        const sed = Math.sqrt(mse * (1 / ns[i] + 1 / ns[j]));
        rows.push({ i, j, lsd: tCrit * sed });
      }
    }
    return rows;
  }

  /**
   * Balanced split-plot in RBD: y[i][j][k] with Factor A (i), B (j), blocks/reps (k).
   * SS: Blocks, A, Error(a)=Blocks×A, B, A×B, Error(b)=residual.
   * F_A = MS_A/MS_Error(a); F_B and F_AB = MS/MS_Error(b).
   */
  function splitPlotRbdAnova(y, a, b, r) {
    const N = a * b * r;
    let sumY2 = 0;
    let G = 0;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = 0; k < r; k++) {
      const v = y[i][j][k];
      sumY2 += v * v;
      G += v;
    }
    const CF = (G * G) / N;
    const ssTotal = sumY2 - CF;

    const blockTotals = Array(r).fill(0);
    const Atotals = Array(a).fill(0);
    const Btotals = Array(b).fill(0);
    const ABtotals = Array.from({ length: a }, () => Array(b).fill(0));
    const AblockTotals = Array.from({ length: r }, () => Array(a).fill(0));

    for (let k = 0; k < r; k++) {
      for (let i = 0; i < a; i++) {
        let aik = 0;
        for (let j = 0; j < b; j++) {
          const v = y[i][j][k];
          blockTotals[k] += v;
          Atotals[i] += v;
          Btotals[j] += v;
          ABtotals[i][j] += v;
          aik += v;
        }
        AblockTotals[k][i] = aik;
      }
    }

    let ssBlock = 0;
    for (let k = 0; k < r; k++) ssBlock += (blockTotals[k] * blockTotals[k]) / (a * b);
    ssBlock -= CF;

    let ssA = 0;
    for (let i = 0; i < a; i++) ssA += (Atotals[i] * Atotals[i]) / (b * r);
    ssA -= CF;

    let ssAblock = 0;
    for (let k = 0; k < r; k++) for (let i = 0; i < a; i++) ssAblock += (AblockTotals[k][i] * AblockTotals[k][i]) / b;
    ssAblock -= ssBlock + ssA + CF;

    let ssB = 0;
    for (let j = 0; j < b; j++) ssB += (Btotals[j] * Btotals[j]) / (a * r);
    ssB -= CF;

    let ssABall = 0;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) ssABall += (ABtotals[i][j] * ABtotals[i][j]) / r;
    const ssTreat = ssABall - CF;
    const ssAB = ssTreat - ssA - ssB;

    const ssErrorB = ssTotal - ssBlock - ssA - ssAblock - ssB - ssAB;

    const dfBlock = r - 1;
    const dfA = a - 1;
    const dfErrorA = (r - 1) * (a - 1);
    const dfB = b - 1;
    const dfAB = (a - 1) * (b - 1);
    const dfErrorB = a * (r - 1) * (b - 1);
    const dfTotal = N - 1;

    const msBlock = dfBlock > 0 ? ssBlock / dfBlock : 0;
    const msA = dfA > 0 ? ssA / dfA : 0;
    const msErrorA = dfErrorA > 0 ? ssAblock / dfErrorA : 0;
    const msB = dfB > 0 ? ssB / dfB : 0;
    const msAB = dfAB > 0 ? ssAB / dfAB : 0;
    const msErrorB = dfErrorB > 0 ? ssErrorB / dfErrorB : 0;

    const fA = msErrorA <= 1e-18 ? 0 : msA / msErrorA;
    const fB = msErrorB <= 1e-18 ? 0 : msB / msErrorB;
    const fAB = msErrorB <= 1e-18 ? 0 : msAB / msErrorB;

    const pA = fPValueUpperTail(fA, dfA, dfErrorA);
    const pB = fPValueUpperTail(fB, dfB, dfErrorB);
    const pAB = fPValueUpperTail(fAB, dfAB, dfErrorB);

    const sigA = approxFSignificance(fA, dfA, dfErrorA);
    const sigB = approxFSignificance(fB, dfB, dfErrorB);
    const sigAB = approxFSignificance(fAB, dfAB, dfErrorB);

    const meanA = Atotals.map((T) => T / (b * r));
    const meanB = Btotals.map((T) => T / (a * r));
    const meanAB = [];
    for (let i = 0; i < a; i++) {
      meanAB[i] = [];
      for (let j = 0; j < b; j++) meanAB[i][j] = ABtotals[i][j] / r;
    }

    return {
      ssTotal,
      ssBlock,
      ssA,
      ssErrorA: ssAblock,
      ssB,
      ssAB,
      ssErrorB,
      dfBlock,
      dfA,
      dfErrorA,
      dfB,
      dfAB,
      dfErrorB,
      dfTotal,
      msBlock,
      msA,
      msErrorA,
      msB,
      msAB,
      msErrorB,
      fA,
      fB,
      fAB,
      pA,
      pB,
      pAB,
      sigA,
      sigB,
      sigAB,
      blockTotals,
      Atotals,
      Btotals,
      ABtotals,
      meanA,
      meanB,
      meanAB,
    };
  }

  /**
   * Augmented RCBD (Federer-style): σ² = MS error from checks-only RBD; b = blocks; c = checks.
   * SED² formulas use σ̂² = MSE (checks).
   */
  function augmentedRcbdStandardErrors(mse, b, c) {
    const s2 = Math.max(0, mse);
    const seCheckCheck = Math.sqrt((2 * s2) / b);
    const seEntrySame = Math.sqrt((2 * s2 * (c + 1)) / c);
    const seEntryDiff = Math.sqrt((2 * s2 * (c + 2)) / c);
    const seCheckEntry = Math.sqrt((2 * s2 * (c + 1)) / (b * c));
    return { seCheckCheck, seEntrySame, seEntryDiff, seCheckEntry, s2 };
  }

  /**
   * Fisher LSD (CD) for balanced split-plot: A vs Error(a); B, A×B, and simple effects use Error(b).
   * sedA = √(2·MS_Ea/(br)); sedB = √(2·MS_Eb/(ar)); sed for cell/simple = √(2·MS_Eb/r).
   */
  function splitPlotCriticalDifferences(msErrorA, dfErrorA, msErrorB, dfErrorB, a, b, r) {
    if (dfErrorA <= 0 || dfErrorB <= 0) {
      return {
        cdA5: NaN,
        cdA1: NaN,
        cdB5: NaN,
        cdB1: NaN,
        cdAB5: NaN,
        cdAB1: NaN,
        cdSimple5: NaN,
        cdSimple1: NaN,
        sedA: NaN,
        sedB: NaN,
        sedCell: NaN,
      };
    }
    const t5a = studentTInvTwoTail(dfErrorA, 0.05);
    const t1a = studentTInvTwoTail(dfErrorA, 0.01);
    const t5b = studentTInvTwoTail(dfErrorB, 0.05);
    const t1b = studentTInvTwoTail(dfErrorB, 0.01);
    const sedA = Math.sqrt((2 * msErrorA) / (b * r));
    const sedB = Math.sqrt((2 * msErrorB) / (a * r));
    const sedCell = Math.sqrt((2 * msErrorB) / r);
    return {
      cdA5: t5a * sedA,
      cdA1: t1a * sedA,
      cdB5: t5b * sedB,
      cdB1: t1b * sedB,
      cdAB5: t5b * sedCell,
      cdAB1: t1b * sedCell,
      cdSimple5: t5b * sedCell,
      cdSimple1: t1b * sedCell,
      sedA,
      sedB,
      sedCell,
    };
  }

  // RBD ANOVA: treatments x blocks (balanced)
  function rbdAnova(matrix, blocks, treatmentsCount) {
    // matrix is [treatmentsCount][blocks]
    const t = treatmentsCount;
    const b = blocks;
    const N = t * b;
    const all = [];
    for (let i = 0; i < t; i++) for (let j = 0; j < b; j++) all.push(matrix[i][j]);
    const grandTotal = all.reduce((a, b) => a + b, 0);
    const CF = grandTotal * grandTotal / N;

    let sumsqAll = 0;
    for (const y of all) sumsqAll += y * y;
    const ssTotal = sumsqAll - CF;

    const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0)); // treatments
    let ssTreat = 0;
    for (const Ti of rowTotals) ssTreat += (Ti * Ti) / b;
    const colTotals = [];
    for (let j = 0; j < b; j++) {
      let s = 0;
      for (let i = 0; i < t; i++) s += matrix[i][j];
      colTotals.push(s);
    }
    let ssBlock = 0;
    for (const Bj of colTotals) ssBlock += (Bj * Bj) / t;
    ssTreat -= CF;
    ssBlock -= CF;

    const ssError = ssTotal - ssTreat - ssBlock;

    const dfTreat = t - 1;
    const dfBlock = b - 1;
    const dfError = (t - 1) * (b - 1);
    const msTreat = ssTreat / dfTreat;
    const msBlock = ssBlock / dfBlock;
    const msError = ssError / dfError;
    const fTreat = msError === 0 ? 0 : msTreat / msError;
    const fBlock = msError === 0 ? 0 : msBlock / msError;
    const fSig = approxFSignificance(fTreat, dfTreat, dfError);
    const sigBlock = approxFSignificance(fBlock, dfBlock, dfError);

    const means = rowTotals.map((Ti, i) => ({ treatment: `T${i + 1}`, mean: Ti / b, total: Ti }));
    return {
      ssTotal,
      ssTreat,
      ssBlock,
      ssError,
      dfTreat,
      dfBlock,
      dfError,
      msTreat,
      msBlock,
      msError,
      fTreat,
      fBlock,
      sig: fSig,
      sigBlock,
      means,
    };
  }

  function parseDataMatrix(text) {
    const lines = (text || "")
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 3) return null;
    const rows = lines.map((line) => line.split(/[\t,;]+/).map((s) => Number(String(s).trim())));
    const n = rows[0].length;
    if (n < 2) return null;
    for (const r of rows) {
      if (r.length !== n) return null;
      if (!r.every(Number.isFinite)) return null;
    }
    return rows;
  }

  function pearsonCorrelationMatrix(X) {
    const n = X.length;
    const p = X[0].length;
    const means = Array(p).fill(0);
    for (let j = 0; j < p; j++) for (let i = 0; i < n; i++) means[j] += X[i][j];
    for (let j = 0; j < p; j++) means[j] /= n;
    const cov = (a, b) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += (X[i][a] - means[a]) * (X[i][b] - means[b]);
      return n > 1 ? s / (n - 1) : 0;
    };
    const std = (j) => Math.sqrt(Math.max(0, cov(j, j)));
    const R = Array(p)
      .fill(0)
      .map(() => Array(p).fill(0));
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) {
        const sa = std(a);
        const sb = std(b);
        R[a][b] = sa === 0 || sb === 0 ? (a === b ? 1 : 0) : cov(a, b) / (sa * sb);
      }
    }
    return R;
  }

  function pearsonCorrelation(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    const x = xs.slice(0, n);
    const y = ys.slice(0, n);
    const xbar = mean(x);
    const ybar = mean(y);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i++) {
      const a = x[i] - xbar;
      const b = y[i] - ybar;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    const den = Math.sqrt(dx * dy);
    return den === 0 ? 0 : num / den;
  }

  function erfApprox(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
    return sign * y;
  }

  function normalCdf(x) {
    return 0.5 * (1 + erfApprox(x / Math.SQRT2));
  }

  /** Two-tailed p-value for H0: rho = 0 (Pearson r); df = n − 2. Uses jStat t CDF when available, else Fisher z + normal. */
  function pearsonCorrelationPValueTwoTail(r, n) {
    const df = n - 2;
    if (df <= 0 || !Number.isFinite(n)) return NaN;
    if (!Number.isFinite(r)) return NaN;
    const absR = Math.abs(r);
    if (absR >= 1) return absR === 1 ? 0 : NaN;
    const t = absR * Math.sqrt(df / (1 - absR * absR));
    if (typeof jStat !== "undefined" && jStat.studentt && typeof jStat.studentt.cdf === "function") {
      return Math.max(0, Math.min(1, 2 * (1 - jStat.studentt.cdf(t, df))));
    }
    const z = 0.5 * Math.log((1 + absR) / (1 - absR));
    const zstat = z * Math.sqrt(Math.max(1, n - 3));
    return Math.max(0, Math.min(1, 2 * (1 - normalCdf(zstat))));
  }

  /** Off-diagonal p-values for testing each r_ij = 0 (same n for all pairs). Diagonal entries are NaN. */
  function buildCorrelationPValueMatrix(R, n) {
    const p = R.length;
    const Pv = Array.from({ length: p }, () => Array(p).fill(0));
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) {
        Pv[i][j] = i === j ? NaN : pearsonCorrelationPValueTwoTail(R[i][j], n);
      }
    }
    return Pv;
  }

  function formatCorrelationPValueCell(p) {
    if (!Number.isFinite(p)) return "—";
    if (p < 1e-4) return "<0.0001";
    return p.toFixed(4);
  }

  function simpleLinearRegression(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    const x = xs.slice(0, n);
    const y = ys.slice(0, n);
    const xbar = mean(x);
    const ybar = mean(y);
    let Sxx = 0;
    let Sxy = 0;
    let Syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - xbar;
      const dy = y[i] - ybar;
      Sxx += dx * dx;
      Sxy += dx * dy;
      Syy += dy * dy;
    }
    const slope = Sxx === 0 ? 0 : Sxy / Sxx;
    const intercept = ybar - slope * xbar;
    const r = Sxx === 0 || Syy === 0 ? 0 : Sxy / Math.sqrt(Sxx * Syy);
    const r2 = r * r;
    return { slope, intercept, r, r2 };
  }

  /** Inverse standard normal CDF (Acklam approximation); uses jStat.normal.inv when available. */
  function invNormalQuantile(p) {
    if (!Number.isFinite(p)) return NaN;
    if (p <= 0) return -1e100;
    if (p >= 1) return 1e100;
    if (typeof jStat !== "undefined" && jStat.normal && typeof jStat.normal.inv === "function") {
      return jStat.normal.inv(p, 0, 1);
    }
    const a1 = -39.69683028665376;
    const a2 = 220.9460984245205;
    const a3 = -275.9285104469687;
    const a4 = 138.357751867269;
    const a5 = -30.66479806614716;
    const a6 = 2.506628277459239;
    const b1 = -54.47609879822461;
    const b2 = 161.5858368580409;
    const b3 = -155.6989798598866;
    const b4 = 66.80131188771972;
    const b5 = -13.28068155288572;
    const c1 = -0.007784894002040293;
    const c2 = -0.3223964580411365;
    const c3 = -2.400758277161838;
    const c4 = -2.549732539343734;
    const c5 = 4.374664141464968;
    const c6 = 2.938163982698783;
    const d1 = 0.007784695709041462;
    const d2 = 0.3224671290700398;
    const d3 = 2.445134137142996;
    const d4 = 3.754408661907416;
    const plow = 0.02425;
    const phigh = 1 - plow;
    let q;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
      );
    }
    if (p > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return (
        -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
      );
    }
    const r = p - 0.5;
    const r2 = r * r;
    return (
      (((((a1 * r2 + a2) * r2 + a3) * r2 + a4) * r2 + a5) * r2 + a6) *
      r /
      (((((b1 * r2 + b2) * r2 + b3) * r2 + b4) * r2 + b5) * r2 + 1)
    );
  }

  /**
   * OLS: columns of X include intercept in position 0.
   * Returns beta, fitted, residuals, sse, sst, r2, r2adj, F for all slopes=0, p-value, m = #slopes.
   *
   * Formula reference (industry-standard Python): see `BKQuant/python/industry_standard_stats.py`
   * — statsmodels OLS / variance_inflation_factor / model AIC; pingouin pairwise_corr for Pearson p-values.
   * Run: `pip install -r BKQuant/python/requirements.txt` then `python BKQuant/python/run_reference_checks.py`.
   */
  function olsFitFromDesign(X, y) {
    const n = X.length;
    const p = X[0]?.length || 0;
    if (n < 2 || p < 1 || y.length !== n) return null;
    if (n <= p) return null;
    const Xt = matTranspose(X);
    const XtX = matMul(Xt, X);
    const Xty = matVecMul(Xt, y);
    const inv = invertMatrix(XtX);
    if (!inv) return null;
    const beta = matVecMul(inv, Xty);
    const ybar = mean(y);
    let sse = 0;
    let sst = 0;
    const fitted = Array(n);
    for (let i = 0; i < n; i++) {
      let fh = 0;
      for (let j = 0; j < p; j++) fh += X[i][j] * beta[j];
      fitted[i] = fh;
      const e = y[i] - fh;
      sse += e * e;
      sst += (y[i] - ybar) ** 2;
    }
    const m = p - 1;
    const ssr = sst - sse;
    const r2 = sst > 1e-15 ? 1 - sse / sst : 0;
    const r2adj = n - p > 0 ? 1 - (1 - Math.max(0, Math.min(1, r2))) * ((n - 1) / (n - p)) : NaN;
    let fStat = 0;
    let fP = 1;
    if (m > 0 && sse > 1e-15 && n - p > 0) {
      fStat = ssr / m / (sse / (n - p));
      fP = fPValueUpperTail(fStat, m, n - p);
    } else if (m > 0) {
      fStat = ssr > 1e-15 ? 1e15 : 0;
      fP = 0;
    }
    return { beta, fitted, residuals: y.map((yi, i) => yi - fitted[i]), sse, sst, ssr, r2, r2adj, fStat, fP, m, n, p };
  }

  /** VIF for each column of Xraw (no intercept); regress X_j on other predictors + intercept. */
  function computeVifs(Xraw) {
    const m = Xraw[0].length;
    const n = Xraw.length;
    const vifs = Array(m).fill(1);
    if (m <= 1) return vifs;
    for (let j = 0; j < m; j++) {
      const Z = [];
      for (let i = 0; i < n; i++) {
        const row = [1];
        for (let k = 0; k < m; k++) if (k !== j) row.push(Xraw[i][k]);
        Z.push(row);
      }
      const yj = Xraw.map((row) => row[j]);
      const aux = olsFitFromDesign(Z, yj);
      const r2 = aux && aux.sst > 1e-15 ? Math.max(0, Math.min(1, 1 - aux.sse / aux.sst)) : 0;
      const denom = Math.max(1e-12, 1 - r2);
      vifs[j] = 1 / denom;
    }
    return vifs;
  }

  /** Iteratively remove predictor with highest VIF while max VIF > threshold. */
  function vifPrunePredictors(Xraw, predNames, vifMax = 10) {
    if (!Xraw.length || !Xraw[0]?.length) {
      return { X: Xraw, names: predNames, removed: [], finalVifs: [] };
    }
    let X = Xraw.map((r) => r.slice());
    let names = predNames.slice();
    const removed = [];
    let guard = 0;
    while (X[0]?.length > 0 && guard++ < 500) {
      const vifs = computeVifs(X);
      const maxV = Math.max(...vifs);
      const j = vifs.indexOf(maxV);
      if (!Number.isFinite(maxV) || maxV <= vifMax) break;
      removed.push({ name: names[j], vif: maxV });
      X = X.map((row) => row.filter((_, idx) => idx !== j));
      names = names.filter((_, idx) => idx !== j);
    }
    const finalVifs = X[0]?.length ? computeVifs(X) : [];
    return { X, names, removed, finalVifs };
  }

  /** AIC for Gaussian linear model: n·ln(SSE/n) + 2k, k = number of estimated coefficients (intercept + slopes). */
  function linearModelAic(n, sse, kCoeffs) {
    const s = Math.max(sse / n, 1e-15);
    return n * Math.log(s) + 2 * kCoeffs;
  }

  /**
   * Bidirectional stepwise selection by AIC on the given predictor pool (columns of Xraw align with names).
   */
  function stepwiseAicSelection(Xraw, y, predNames) {
    const m = Xraw[0]?.length || 0;
    if (m === 0) {
      const X0 = y.map(() => [1]);
      const fit = olsFitFromDesign(X0, y);
      return {
        active: new Set(),
        fit,
        aic: fit ? linearModelAic(y.length, fit.sse, fit.beta.length) : Infinity,
        selectedNames: [],
      };
    }
    let active = new Set(Array.from({ length: m }, (_, i) => i));

    function fitActive(act) {
      const idx = [...act].sort((a, b) => a - b);
      if (idx.length === 0) {
        const Xd = y.map(() => [1]);
        return olsFitFromDesign(Xd, y);
      }
      const Xd = Xraw.map((row) => [1, ...idx.map((c) => row[c])]);
      return olsFitFromDesign(Xd, y);
    }

    function aicOf(fit) {
      if (!fit) return Infinity;
      return linearModelAic(fit.n, fit.sse, fit.beta.length);
    }

    let currentFit = fitActive(active);
    if (!currentFit) {
      return { active: new Set(), fit: null, aic: Infinity, selectedNames: [] };
    }
    let currentAic = aicOf(currentFit);
    let guard = 0;
    while (guard++ < 200) {
      let bestAic = currentAic;
      let bestSet = null;
      for (const j of active) {
        const next = new Set(active);
        next.delete(j);
        const f = fitActive(next);
        const a = aicOf(f);
        if (f && a < bestAic - 1e-9) {
          bestAic = a;
          bestSet = next;
        }
      }
      for (let j = 0; j < m; j++) {
        if (active.has(j)) continue;
        const next = new Set(active);
        next.add(j);
        const f = fitActive(next);
        const a = aicOf(f);
        if (f && a < bestAic - 1e-9) {
          bestAic = a;
          bestSet = next;
        }
      }
      if (bestSet === null) break;
      active = bestSet;
      currentFit = fitActive(active);
      if (!currentFit) break;
      currentAic = aicOf(currentFit);
    }

    const orderIdx = [...active].sort((a, b) => a - b);
    const selectedNames = orderIdx.map((i) => predNames[i]);
    return { active, fit: currentFit, aic: currentAic, selectedNames };
  }

  function drawQQPlotResiduals(canvas, residuals, { title = "Normal Q-Q (residuals)" } = {}) {
    const n = residuals.length;
    const sorted = residuals.map((r, i) => ({ r, i })).sort((a, b) => a.r - b.r);
    const pts = sorted.map((o, k) => {
      const p = (k + 0.375) / (n + 0.25);
      return { x: invNormalQuantile(p), y: o.r };
    });
    drawScatterPlot(canvas, pts, { title, xLabel: "Theoretical quantiles", yLabel: "Sample residual" });
  }

  function drawResidualsVsFittedPlot(canvas, fitted, residuals, { title = "Residuals vs fitted" } = {}) {
    const pts = fitted.map((f, i) => ({ x: f, y: residuals[i] }));
    drawScatterPlot(canvas, pts, { title, xLabel: "Fitted", yLabel: "Residual" });
  }

  function pca2D(xs, ys) {
    // PCA for 2 variables: compute covariance matrix and eigenvalues/vectors.
    const n = Math.min(xs.length, ys.length);
    const x = xs.slice(0, n);
    const y = ys.slice(0, n);
    const xbar = mean(x);
    const ybar = mean(y);
    const dx = x.map((v) => v - xbar);
    const dy = y.map((v) => v - ybar);
    let sxx = 0,
      syy = 0,
      sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += dx[i] * dx[i];
      syy += dy[i] * dy[i];
      sxy += dx[i] * dy[i];
    }
    sxx /= n - 1;
    syy /= n - 1;
    sxy /= n - 1;

    // covariance matrix [[sxx, sxy],[sxy, syy]]
    // eigenvalues:
    const tr = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.max(0, tr * tr - 4 * det);
    const l1 = (tr + Math.sqrt(disc)) / 2;
    const l2 = (tr - Math.sqrt(disc)) / 2;
    const vec1 = eigenVector2x2(sxx, sxy, syy, l1);
    const vec2 = eigenVector2x2(sxx, sxy, syy, l2);

    const explained1 = (l1 / (l1 + l2 || 1)) * 100;
    const explained2 = 100 - explained1;
    return { l1, l2, vec1, vec2, explained1, explained2 };
  }

  function eigenVector2x2(sxx, sxy, syy, lambda) {
    // Solve (A - lambda I)v = 0. For numerical stability, pick larger magnitude component.
    const a = sxx - lambda;
    const b = sxy;
    const c = syy - lambda;
    let vx, vy;
    if (Math.abs(b) > 1e-12) {
      vx = 1;
      vy = -a / b;
    } else {
      // diagonal matrix case
      if (Math.abs(a) >= Math.abs(c)) {
        vx = 1;
        vy = 0;
      } else {
        vx = 0;
        vy = 1;
      }
    }
    const norm = Math.sqrt(vx * vx + vy * vy) || 1;
    return { x: vx / norm, y: vy / norm };
  }

  // -----------------------------
  // Linear algebra (small matrices)
  // -----------------------------
  function invertMatrix(A) {
    // Gauss-Jordan inversion for small n (n<=6 typical here)
    const n = A.length;
    const M = A.map((row) => row.slice());
    const I = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

    for (let col = 0; col < n; col++) {
      // pivot
      let pivotRow = col;
      let pivotVal = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.abs(M[r][col]);
        if (v > pivotVal) {
          pivotVal = v;
          pivotRow = r;
        }
      }
      if (pivotVal < 1e-12) return null;
      if (pivotRow !== col) {
        [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
        [I[col], I[pivotRow]] = [I[pivotRow], I[col]];
      }

      const piv = M[col][col];
      for (let j = 0; j < n; j++) {
        M[col][j] /= piv;
        I[col][j] /= piv;
      }

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        for (let j = 0; j < n; j++) {
          M[r][j] -= f * M[col][j];
          I[r][j] -= f * I[col][j];
        }
      }
    }
    return I;
  }

  function matVecMul(A, v) {
    const n = A.length;
    const out = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < v.length; j++) s += A[i][j] * v[j];
      out[i] = s;
    }
    return out;
  }

  /** Upper-tail p-value for F(df1, df2). Uses jStat when available. */
  function fPValueUpperTail(F, df1, df2) {
    if (!Number.isFinite(F) || F < 0) return 1;
    if (typeof jStat !== "undefined" && jStat.centralF && typeof jStat.centralF.cdf === "function") {
      return Math.max(0, Math.min(1, 1 - jStat.centralF.cdf(F, df1, df2)));
    }
    return 1;
  }

  /** F critical value with upper-tail area alpha (e.g. 0.05 for F_{0.05}). Uses jStat.centralF.inv or bisection on fPValueUpperTail. */
  function fCriticalUpperTail(alpha, df1, df2) {
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) return NaN;
    if (typeof jStat !== "undefined" && jStat.centralF && typeof jStat.centralF.inv === "function") {
      try {
        return jStat.centralF.inv(1 - alpha, df1, df2);
      } catch {
        /* fall through */
      }
    }
    let lo = 1e-8;
    let hi = 1e6;
    for (let k = 0; k < 70; k++) {
      const mid = (lo + hi) / 2;
      const pUp = fPValueUpperTail(mid, df1, df2);
      if (pUp > alpha) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function powerIterationSymmetricMatrix(A, iters = 120) {
    const n = A.length;
    let v = Array.from({ length: n }, (_, i) => Math.sin(i + 1.7));
    let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    v = v.map((x) => x / norm);
    for (let t = 0; t < iters; t++) {
      const Av = matVecMul(A, v);
      norm = Math.sqrt(Av.reduce((s, x) => s + x * x, 0)) || 1;
      v = Av.map((x) => x / norm);
    }
    const Av = matVecMul(A, v);
    const lambda = v.reduce((s, x, i) => s + x * Av[i], 0);
    return { lambda: Math.max(0, lambda), v };
  }

  function deflateSymmetric(A, lambda, v) {
    return A.map((row, i) => row.map((cell, j) => cell - lambda * v[i] * v[j]));
  }

  function matTranspose(A) {
    const n = A.length;
    const m = A[0]?.length || 0;
    return Array.from({ length: m }, (_, j) => Array.from({ length: n }, (_, i) => A[i][j]));
  }

  function matMul(A, B) {
    const n = A.length;
    const k = A[0].length;
    const m = B[0].length;
    const C = Array.from({ length: n }, () => Array(m).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
        C[i][j] = s;
      }
    }
    return C;
  }

  /** All eigenpairs of symmetric matrix (deflation + power iteration), sorted by eigenvalue descending. */
  function symmetricEigenAll(A0) {
    const n = A0.length;
    let B = A0.map((r) => r.slice());
    const vals = [];
    const vecs = [];
    for (let c = 0; c < n; c++) {
      const { lambda, v } = powerIterationSymmetricMatrix(B, 150);
      vals.push(Math.max(0, lambda));
      vecs.push(v.slice());
      B = deflateSymmetric(B, lambda, v);
    }
    const pairs = vals.map((v, i) => ({ v, vec: vecs[i] })).sort((a, b) => b.v - a.v);
    return { vals: pairs.map((x) => x.v), vecs: pairs.map((x) => x.vec) };
  }

  /**
   * PCA on column-standardized data Z (n×p): correlation matrix R = Z'Z/(n−1), scores = Z V, loadings = correlations with PCs.
   */
  function pcaFromStandardizedZ(Z) {
    const n = Z.length;
    const p = Z[0].length;
    if (p < 2) return null;
    const Zt = matTranspose(Z);
    const ZtZ = matMul(Zt, Z);
    const denom = Math.max(1, n - 1);
    const R = ZtZ.map((row) => row.map((x) => x / denom));
    const { vals, vecs } = symmetricEigenAll(R);
    const V = Array.from({ length: p }, (_, j) => Array.from({ length: p }, (_, k) => vecs[k][j]));
    const scores = matMul(Z, V);
    const loadings = Array.from({ length: p }, (_, j) =>
      Array.from({ length: p }, (_, k) => Math.sqrt(Math.max(0, vals[k])) * V[j][k])
    );
    const totalVar = p;
    const propPct = vals.map((v) => (v / totalVar) * 100);
    const cumPct = [];
    let acc = 0;
    for (const pr of propPct) {
      acc += pr;
      cumPct.push(acc);
    }
    const cos2 = loadings.map((row) => ({
      pc1: row[0] * row[0],
      pc2: row[1] * row[1],
      plane12: row[0] * row[0] + row[1] * row[1],
    }));
    return { vals, vecs, V, scores, loadings, propPct, cumPct, cos2, n, p, R };
  }

  /** SVD of interaction matrix I via I I' deflation; returns singular values and left/right vectors. */
  function svdInteractionMatrix(I, maxAxes = 12) {
    const g = I.length;
    const e = I[0].length;
    const B = Array.from({ length: g }, () => Array(g).fill(0));
    for (let i = 0; i < g; i++) {
      for (let k = 0; k < g; k++) {
        let s = 0;
        for (let j = 0; j < e; j++) s += I[i][j] * I[k][j];
        B[i][k] = s;
      }
    }
    let Bk = B.map((r) => r.slice());
    const sigmas = [];
    const uVecs = [];
    const vVecs = [];
    const kMax = Math.min(maxAxes, Math.min(g, e) - 1);
    for (let k = 0; k < kMax; k++) {
      const { lambda, v } = powerIterationSymmetricMatrix(Bk, 140);
      if (lambda < 1e-16) break;
      const sigma = Math.sqrt(lambda);
      const u = v;
      const vv = Array(e).fill(0);
      for (let j = 0; j < e; j++) {
        let s = 0;
        for (let i = 0; i < g; i++) s += I[i][j] * u[i];
        vv[j] = sigma > 1e-14 ? s / sigma : 0;
      }
      sigmas.push(sigma);
      uVecs.push(u);
      vVecs.push(vv);
      Bk = deflateSymmetric(Bk, lambda, u);
    }
    return { sigmas, uVecs, vVecs };
  }

  /** Impute missing cells (row mean → column mean → global mean). Returns cleaned matrix + note. */
  function imputeGxEMatrix(M0, g, e) {
    const M = M0.map((row) => row.slice());
    const flatAll = [];
    for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) if (Number.isFinite(M[i][j])) flatAll.push(M[i][j]);
    const gMean = flatAll.length ? mean(flatAll) : 0;
    for (let i = 0; i < g; i++) {
      const row = [];
      for (let j = 0; j < e; j++) if (Number.isFinite(M[i][j])) row.push(M[i][j]);
      const rm = row.length ? mean(row) : gMean;
      for (let j = 0; j < e; j++) if (!Number.isFinite(M[i][j])) M[i][j] = rm;
    }
    for (let j = 0; j < e; j++) {
      const col = [];
      for (let i = 0; i < g; i++) if (Number.isFinite(M[i][j])) col.push(M[i][j]);
      const cm = col.length ? mean(col) : gMean;
      for (let i = 0; i < g; i++) if (!Number.isFinite(M[i][j])) M[i][j] = cm;
    }
    for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) if (!Number.isFinite(M[i][j])) M[i][j] = gMean;
    return M;
  }

  /** Balanced two-way ANOVA on cell means (one observation per G×E). */
  function twoWayAnovaCellMeans(M, g, e) {
    const flat = [];
    for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) flat.push(M[i][j]);
    const grand = mean(flat);
    const gMeans = M.map((row) => mean(row));
    const eMeans = Array.from({ length: e }, (_, j) => mean(M.map((r) => r[j])));
    let ssTotal = 0;
    for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) ssTotal += (M[i][j] - grand) ** 2;
    let ssG = 0;
    for (let i = 0; i < g; i++) ssG += e * (gMeans[i] - grand) ** 2;
    let ssE = 0;
    for (let j = 0; j < e; j++) ssE += g * (eMeans[j] - grand) ** 2;
    const ssGE = Math.max(0, ssTotal - ssG - ssE);
    const dfG = g - 1;
    const dfE = e - 1;
    const dfGE = (g - 1) * (e - 1);
    const dfT = g * e - 1;
    const msG = ssG / dfG;
    const msE = ssE / dfE;
    const msGE = ssGE / dfGE;
    const F_G = msGE <= 1e-18 ? 0 : msG / msGE;
    const F_E = msGE <= 1e-18 ? 0 : msE / msGE;
    const pG = fPValueUpperTail(F_G, dfG, dfGE);
    const pE = fPValueUpperTail(F_E, dfE, dfGE);
    return { grand, gMeans, eMeans, ssTotal, ssG, ssE, ssGE, dfG, dfE, dfGE, dfT, msG, msE, msGE, F_G, F_E, pG, pE };
  }

  function doubleCenterInteraction(M, g, e, grand, gMeans, eMeans) {
    const I = Array.from({ length: g }, () => Array(e).fill(0));
    for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) I[i][j] = M[i][j] - gMeans[i] - eMeans[j] + grand;
    return I;
  }

  /** Gollob sequential F-tests for multiplicative terms (df_k = g+e-1-2k for axis k). */
  function gollobSequentialTests(sigmas, g, e) {
    const dfGE = (g - 1) * (e - 1);
    const ssGE = sigmas.reduce((s, sig) => s + sig * sig, 0);
    let ssRem = ssGE;
    let dfRem = dfGE;
    const rows = [];
    for (let k = 0; k < sigmas.length; k++) {
      const ssK = sigmas[k] * sigmas[k];
      const dfK = g + e - 1 - 2 * (k + 1);
      if (dfK <= 0 || dfRem <= dfK) break;
      const ssRes = ssRem - ssK;
      const dfRes = dfRem - dfK;
      if (dfRes <= 0 || ssRes < -1e-8) break;
      const msK = ssK / dfK;
      const msRes = ssRes / dfRes;
      const F = msRes <= 1e-18 ? 0 : msK / msRes;
      const p = fPValueUpperTail(F, dfK, dfRes);
      const pctOfSSGE = ssGE > 1e-18 ? (ssK / ssGE) * 100 : 0;
      rows.push({ axis: k + 1, ss: ssK, df: dfK, pctOfSSGE, F, p, ssRes, dfRes });
      ssRem = ssRes;
      dfRem = dfRes;
    }
    return rows;
  }

  /** AMMI biplot with repelled labels (ggrepel-style iterative separation). */
  function drawAmmiBiplotPublication(canvas, gPts, ePts, { title, xLabel, yLabel } = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 72;
    const padR = 18;
    const padT = title ? 40 : 26;
    const padB = 58;
    const all = [
      ...gPts.map((p) => ({ ...p, kind: "G" })),
      ...ePts.map((p) => ({ ...p, kind: "E" })),
    ];
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const sx = niceScale(Math.min(...xs), Math.max(...xs), 6);
    const sy = niceScale(Math.min(...ys), Math.max(...ys), 6);
    const minX = sx.min;
    const maxX = sx.max;
    const minY = sy.min;
    const maxY = sy.max;
    const rangeX = Math.max(1e-12, maxX - minX);
    const rangeY = Math.max(1e-12, maxY - minY);
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const plotTop = padT;
    const plotBottom = padT + plotH;
    const plotLeft = padL;
    const plotRight = padL + plotW;
    const gx = (xv) => plotLeft + ((xv - minX) / rangeX) * plotW;
    const gy = (yv) => plotBottom - ((yv - minY) / rangeY) * plotH;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    if (title) {
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 14px Segoe UI, Arial, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, padL, 8);
    }
    ctx.strokeStyle = CHART.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft + 0.5, plotTop + 0.5, plotW - 1, plotH - 1);
    const grid = 6;
    for (let i = 0; i <= grid; i++) {
      const t = i / grid;
      const y = plotBottom - t * plotH;
      ctx.strokeStyle = CHART.grid;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      const val = minY + (maxY - minY) * t;
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 11px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatChartTick(val), plotLeft - 8, y);
    }
    for (let j = 0; j <= grid; j++) {
      const t = j / grid;
      const x = plotLeft + t * plotW;
      ctx.strokeStyle = CHART.grid;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      const val = minX + (maxX - minX) * t;
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 10px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(formatChartTick(val), x, plotBottom + 6);
    }
    ctx.strokeStyle = CHART.axis;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.moveTo(plotLeft, plotTop);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.stroke();

    const marks = all.map((p) => {
      const px = gx(p.x);
      const py = gy(p.y);
      return { px, py, label: p.label, kind: p.kind, ox: 8, oy: -8 };
    });
    for (let iter = 0; iter < 45; iter++) {
      for (let i = 0; i < marks.length; i++) {
        for (let j = i + 1; j < marks.length; j++) {
          const a = marks[i];
          const b = marks[j];
          const ax = a.px + a.ox;
          const ay = a.py + a.oy;
          const bx = b.px + b.ox;
          const by = b.py + b.oy;
          const dx = ax - bx;
          const dy = ay - by;
          const dist = Math.hypot(dx, dy) || 1;
          const minD = 38;
          if (dist < minD) {
            const push = (minD - dist) / 2;
            const ux = (dx / dist) * push;
            const uy = (dy / dist) * push;
            a.ox += ux;
            a.oy += uy;
            b.ox -= ux;
            b.oy -= uy;
          }
        }
        const k = 0.12;
        marks[i].ox *= 1 - k;
        marks[i].oy *= 1 - k;
      }
    }

    for (const p of all) {
      const px = gx(p.x);
      const py = gy(p.y);
      if (p.kind === "G") {
        ctx.fillStyle = "rgba(5, 150, 105, 0.95)";
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(217, 119, 6, 0.95)";
        ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
        ctx.lineWidth = 1.2;
        const s = 5;
        ctx.beginPath();
        ctx.moveTo(px, py - s);
        ctx.lineTo(px + s, py);
        ctx.lineTo(px, py + s);
        ctx.lineTo(px - s, py);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.font = "600 11px Segoe UI, Arial, sans-serif";
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      ctx.strokeStyle = "rgba(15, 23, 42, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.px, m.py);
      ctx.lineTo(m.px + m.ox, m.py + m.oy);
      ctx.stroke();
      ctx.fillStyle = CHART.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(m.label, m.px + m.ox + 3, m.py + m.oy);
    }

    ctx.fillStyle = CHART.inkMuted;
    ctx.font = "600 12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(xLabel || "", (plotLeft + plotRight) / 2, h - 20);
    ctx.save();
    ctx.translate(18, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(yLabel || "", 0, 0);
    ctx.restore();

    ctx.font = "600 10px Segoe UI, Arial, sans-serif";
    ctx.fillStyle = CHART.inkMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("● Genotype  ■ Environment", plotLeft + 4, plotTop + 14);
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  /** Standardized path coefficients P = Rxx^{-1} rxy; indirect effects, reproduced r(i,Y), residual path. */
  function computeStandardizedPathModel(Rxx, rxy) {
    const inv = invertMatrix(Rxx);
    if (!inv) return { ok: false, error: "singular" };
    const P = matVecMul(inv, rxy);
    const p = P.length;
    const indirect = Array.from({ length: p }, () => Array(p).fill(0));
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) {
        if (i === j) continue;
        indirect[i][j] = Rxx[i][j] * P[j];
      }
    }
    const reproduced = [];
    let sum_rp = 0;
    for (let i = 0; i < p; i++) {
      let rep = P[i];
      for (let j = 0; j < p; j++) if (i !== j) rep += Rxx[i][j] * P[j];
      reproduced.push(rep);
      sum_rp += rxy[i] * P[i];
    }
    const residual = Math.sqrt(clamp01(1 - sum_rp));
    return { ok: true, P, indirect, reproduced, residual };
  }

  function pathInputsFromFullCorrelation(R, yIdx, predictorIdxs) {
    const Rxx = predictorIdxs.map((i) => predictorIdxs.map((j) => R[i][j]));
    const rxy = predictorIdxs.map((i) => R[i][yIdx]);
    return { Rxx, rxy };
  }

  /** Mean trait vector per genotype label (plot-level rows). */
  function aggregateTraitMeansByGenotype(rowLabels, X) {
    const map = new Map();
    for (let i = 0; i < X.length; i++) {
      const key = String(rowLabels[i]);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(X[i]);
    }
    const labels = [];
    const means = [];
    for (const [g, rows] of map) {
      labels.push(g);
      const ncol = rows[0].length;
      const mrow = Array(ncol).fill(0);
      const nr = rows.length;
      for (const r of rows) for (let j = 0; j < ncol; j++) mrow[j] += r[j];
      for (let j = 0; j < ncol; j++) mrow[j] /= nr;
      means.push(mrow);
    }
    return { labels, means };
  }

  function renderPathDiagramSvg(svgEl, { names, yName, pCoeffs, Rxx, rxy, residual }) {
    if (!svgEl) return;
    const svg = svgEl;
    svg.innerHTML = "";
    const uid = `${svg.id || "path"}-m`;
    const W = 860;
    const pCount = pCoeffs.length;
    const spacing = pCount > 1 ? Math.min(70, 220 / Math.max(1, pCount - 1)) : 0;
    const top = 70;
    const xs = names.map((_, i) => ({ x: 120, y: top + i * spacing }));
    const yMid = pCount ? top + ((pCount - 1) * spacing) / 2 : top;
    const yNode = { x: 740, y: yMid };
    const H = Math.max(360, top + 56 + Math.max(0, pCount - 1) * spacing);

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.insertAdjacentHTML(
      "beforeend",
      `<defs>
          <marker id="${uid}-pArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="#d97706"></path>
          </marker>
          <marker id="${uid}-gArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="#64748b"></path>
          </marker>
        </defs>`
    );

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const r = Rxx[i][j];
        if (Math.abs(r) < 0.2) continue;
        const a = xs[i];
        const b = xs[j];
        svg.insertAdjacentHTML(
          "beforeend",
          `<path d="M ${a.x + 40} ${a.y} L ${b.x + 40} ${b.y}" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#${uid}-gArrow)"></path>
             <text x="${a.x + 55}" y="${(a.y + b.y) / 2 - 6}" fill="#475569" font-size="12" font-weight="800">r=${r.toFixed(2)}</text>`
        );
      }
    }

    xs.forEach((pt, i) => {
      svg.insertAdjacentHTML(
        "beforeend",
        `<rect x="${pt.x - 80}" y="${pt.y - 24}" width="160" height="48" rx="16" fill="rgba(13,148,136,0.12)" stroke="#c5cdd8"></rect>
           <text x="${pt.x}" y="${pt.y + 6}" text-anchor="middle" fill="#0f172a" font-size="16" font-weight="900">${qs(names[i])}</text>`
      );
    });
    svg.insertAdjacentHTML(
      "beforeend",
      `<rect x="${yNode.x - 90}" y="${yNode.y - 26}" width="180" height="52" rx="16" fill="rgba(217,119,6,0.12)" stroke="#c5cdd8"></rect>
         <text x="${yNode.x}" y="${yNode.y + 6}" text-anchor="middle" fill="#0f172a" font-size="16" font-weight="950">${qs(yName)}</text>
         <text x="${yNode.x}" y="${yNode.y + 32}" text-anchor="middle" fill="#64748b" font-size="12" font-weight="800">Residual=${residual.toFixed(3)}</text>`
    );

    xs.forEach((pt, i) => {
      const p = pCoeffs[i];
      const startX = pt.x + 80;
      const startY = pt.y;
      const endX = yNode.x - 90;
      const endY = yNode.y + (i - (xs.length - 1) / 2) * 12;
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const col = p >= 0 ? "#0d9488" : "#dc2626";
      svg.insertAdjacentHTML(
        "beforeend",
        `<path d="M ${startX} ${startY} C ${startX + 110} ${startY}, ${endX - 120} ${endY}, ${endX} ${endY}" stroke="${col}" stroke-width="4" fill="none" marker-end="url(#${uid}-pArrow)"></path>
           <text x="${midX}" y="${midY - 8}" fill="${col}" font-size="13" font-weight="950">p=${p.toFixed(3)}</text>
           <text x="${midX}" y="${midY + 10}" fill="#64748b" font-size="12" font-weight="800">r=${rxy[i].toFixed(2)}</text>`
      );
    });
  }

  function computeDiallelGeneticParams(msGCA, msSCA, modelKey = "fixed-with-reciprocal") {
    // Educational/proxy block for offline reporting.
    // The multipliers below provide model-aware scaling (still proxy-level, not a full mixed-model solver).
    const modelScales = {
      "fixed-with-reciprocal": { gca: 1.00, sca: 1.00, label: "Fixed effects + reciprocal included" },
      "fixed-no-reciprocal": { gca: 1.00, sca: 0.90, label: "Fixed effects + no reciprocal term" },
      "random-with-reciprocal": { gca: 0.85, sca: 1.10, label: "Random effects + reciprocal included" },
      "random-no-reciprocal": { gca: 0.85, sca: 1.00, label: "Random effects + no reciprocal term" },
    };
    const scale = modelScales[modelKey] || modelScales["fixed-with-reciprocal"];

    const sigmaGCA = Math.max(0, msGCA * scale.gca);
    const sigmaSCA = Math.max(0, msSCA * scale.sca);
    const ratio = sigmaSCA === 0 ? 0 : sigmaGCA / sigmaSCA;
    const sigmaA = 2 * sigmaGCA; // additive proxy
    const sigmaD = sigmaSCA; // dominance proxy
    const degree = sigmaA <= 1e-12 ? 0 : Math.sqrt(Math.max(0, sigmaD / sigmaA));
    const geneAction =
      degree < 0.8
        ? "Predominantly additive"
        : degree <= 1.2
        ? "Partial/complete dominance"
        : "Over-dominance tendency";
    return { sigmaGCA, sigmaSCA, ratio, sigmaA, sigmaD, degree, geneAction, modelLabel: scale.label };
  }

  /** Griffing Method 4: half diallel (p(p−1)/2 crosses only, no parents). */
  function griffingMethod4Partition(p, crosses) {
    const n = (p * (p - 1)) / 2;
    const Ti = Array(p).fill(0);
    let idx = 0;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) Ti[i] += crosses[idx], Ti[j] += crosses[idx], idx++;
    const T = Ti.reduce((a, b) => a + b, 0);
    const xbar = T / n;
    let ssTot = 0;
    idx = 0;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) ssTot += (crosses[idx++] - xbar) ** 2;
    const ssGCA =
      (2 / (p * (p + 2))) * Ti.reduce((s, t) => s + t * t, 0) - (2 / (p * p * (p + 2))) * T * T;
    const ssSCA = Math.max(0, ssTot - ssGCA);
    const dfG = p - 1;
    const dfS = (p * (p - 3)) / 2;
    const dfT = n - 1;
    const msG = dfG > 0 ? ssGCA / dfG : 0;
    const msS = dfS > 0 ? ssSCA / dfS : 0;
    const ratioMS = msS <= 1e-18 ? (msG <= 1e-18 ? 0 : Infinity) : msG / msS;
    return { Ti, T, ssTot, ssGCA, ssSCA, dfG, dfS, dfT, n, xbar, msG, msS, ratioMS };
  }

  function estimateGcaScaMethod4(p, crosses) {
    const n = (p * (p - 1)) / 2;
    const Ti = Array(p).fill(0);
    let idx = 0;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) Ti[i] += crosses[idx], Ti[j] += crosses[idx], idx++;
    const T = Ti.reduce((a, b) => a + b, 0);
    const mu = T / n;
    const gca = Ti.map((_, i) => (1 / (p * (p + 2))) * ((p + 1) * Ti[i] - T));
    const scaMat = Array.from({ length: p }, () => Array(p).fill(null));
    idx = 0;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) {
      const v = crosses[idx++];
      const sca = v - mu - gca[i] - gca[j];
      scaMat[i][j] = sca;
      scaMat[j][i] = sca;
    }
    return { mu, gca, scaMat };
  }

  /** Variance components (random model, Method 4) + narrow- and broad-sense heritability on entry-mean scale. */
  function diallelVarianceHeritability(msG, msS, mse, p, r) {
    const rr = Math.max(1, r || 1);
    const mseSafe = Number.isFinite(mse) && mse > 0 ? mse : msS * 0.25;
    const sigmaGca = Math.max(0, (msG - msS) / (2 * p));
    const sigmaSca = Math.max(0, (msS - mseSafe) / rr);
    const sigmaE = mseSafe / rr;
    const phen = 2 * sigmaGca + sigmaSca + sigmaE;
    const hNarrow = phen <= 1e-18 ? 0 : (2 * sigmaGca) / phen;
    const hBroad = phen <= 1e-18 ? 0 : (2 * sigmaGca + sigmaSca) / phen;
    return { sigmaGca, sigmaSca, sigmaE, hNarrow, hBroad, mseUsed: mseSafe, mseImputed: !(Number.isFinite(mse) && mse > 0) };
  }

  /**
   * Build symmetric half-diallel crosses vector (i<j) and reciprocal SS for Griffing Methods 1–3.
   * @returns {{ crosses: number[], ssRecip: number, recipDf: number }}
   */
  function diallelSymmetricCrossesAndRecip(M, p) {
    const crosses = [];
    let ssRecip = 0;
    let recipDf = 0;
    for (let i = 0; i < p; i++) {
      for (let j = i + 1; j < p; j++) {
        const a = M[i][j];
        const b = M[j][i];
        const m = (a + b) / 2;
        crosses.push(m);
        const d = a - b;
        ssRecip += 0.5 * d * d;
        recipDf += 1;
      }
    }
    return { crosses, ssRecip, recipDf };
  }

  /** Read p×p matrix from DA I inputs; apply Griffing method masking. */
  function readDiallelMatrixFromDom(p, method) {
    const M = Array.from({ length: p }, () => Array(p).fill(0));
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) {
        const input = document.querySelector(`#da1GridWrap input[data-da1="i${i}j${j}"]`);
        const v = Number(input?.value ?? NaN);
        M[i][j] = Number.isFinite(v) ? v : 0;
      }
    }
    if (method === 2) {
      for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) M[i][j] = M[j][i];
    }
    if (method === 4) {
      for (let i = 0; i < p; i++) {
        M[i][i] = 0;
        for (let j = i + 1; j < p; j++) M[j][i] = M[i][j];
      }
    }
    if (method === 3) {
      for (let i = 0; i < p; i++) M[i][i] = 0;
    }
    return M;
  }

  function scaHeatmapHtml(scaMat, labels) {
    const p = scaMat.length;
    const vals = [];
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (scaMat[i][j] != null && Number.isFinite(scaMat[i][j])) vals.push(scaMat[i][j]);
    const vmax = Math.max(1e-12, ...vals.map((x) => Math.abs(x)));
    const rows = [];
    for (let i = 0; i < p; i++) {
      const tds = [`<th class="border border-slate-700 bg-slate-900 px-2 py-1 text-left text-xs font-semibold text-slate-200">${qs(labels[i])}</th>`];
      for (let j = 0; j < p; j++) {
        const v = scaMat[i][j];
        if (v == null || !Number.isFinite(v)) {
          tds.push(`<td class="border border-slate-700 px-1 text-center text-xs text-slate-500">—</td>`);
          continue;
        }
        const t = (v / vmax + 1) / 2;
        const r0 = 220;
        const g0 = 38;
        const b0 = 38;
        const r1 = 16;
        const g1 = 185;
        const b1 = 129;
        const rr = Math.round(r0 + (r1 - r0) * t);
        const gg = Math.round(g0 + (g1 - g0) * t);
        const bb = Math.round(b0 + (b1 - b0) * t);
        tds.push(
          `<td class="border border-slate-700 px-1 py-0.5 text-center text-xs font-mono text-slate-900" style="background:rgba(${rr},${gg},${bb},0.72)">${v.toFixed(3)}</td>`
        );
      }
      rows.push(`<tr>${tds.join("")}</tr>`);
    }
    const head = `<tr><th class="sticky left-0 z-10 border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-indigo-200">SCA</th>${labels
      .map((n) => `<th class="border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-semibold text-indigo-300">${qs(n)}</th>`)
      .join("")}</tr>`;
    return `<div class="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/40"><table class="w-full border-collapse text-sm"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table><p class="mt-2 text-xs text-slate-500">Colors: blue (negative SCA) → red (positive SCA); scale symmetric by max |SCA|.</p></div>`;
  }

  // -----------------------------
  // UI components
  // -----------------------------
  function highlightSidebarModule(moduleId) {
    $$("#sidebar .tile").forEach((el) => {
      el.classList.toggle("active", !!moduleId && el.dataset.module === moduleId);
    });
    const dash = $("#v2DashBtn");
    if (dash) dash.classList.toggle("v2-nav-item--active", !moduleId);
  }

  function buildV2DashboardHtml() {
    const cards = [
      {
        id: "ammi",
        title: "AMMI analysis",
        desc: "Analyze G×E interactions using IPCA scores and additive effects.",
        status: "Stable",
        beta: false,
        hot: false,
        icon: "▤",
      },
      {
        id: "diallel",
        title: "Diallel (Griffing)",
        desc: "Estimate GCA and SCA for parental selection.",
        status: "Stable",
        beta: false,
        hot: false,
        icon: "◇",
      },
      {
        id: "linetester",
        title: "L × T analysis",
        desc: "Performance evaluation across lines and testers.",
        status: "Beta",
        beta: true,
        hot: true,
        icon: "⊞",
      },
    ];
    return `<div class="v2-dashboard-grid">${cards
      .map(
        (c) => `<div class="v2-dash-card" role="button" tabindex="0" data-open-module="${c.id}">
      ${c.hot ? `<span class="v2-dash-hot">Hot</span>` : ""}
      <div class="v2-d-ico" aria-hidden="true" style="font-size:28px;line-height:1">${c.icon}</div>
      <h4>${qs(c.title)}</h4>
      <p>${qs(c.desc)}</p>
      <div class="v2-dash-meta">
        <span><span class="dot ${c.beta ? "beta" : ""}"></span>${qs(c.status)}</span>
        <span class="v2-dash-go">Start →</span>
      </div>
    </div>`
      )
      .join("")}</div>`;
  }

  function showV2Dashboard() {
    CURRENT_MODULE_ID = "";
    $("#contentHeader").innerHTML = `<div style="display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
      <div>
        <h3>Overview</h3>
        <p class="muted">Select a module card below or a tile in the sidebar to open full tables, plots, and interpretation.</p>
      </div>
    </div>`;
    $("#contentBody").innerHTML = buildV2DataUploadPanelHtml() + buildV2DashboardHtml();
    wireV2DashboardUpload();
    highlightSidebarModule("");
    $$("#contentBody .v2-dash-card[data-open-module]").forEach((el) => {
      const id = el.dataset.openModule;
      const go = () => openModule(id);
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
  }

  function setSidebar(items) {
    const sidebar = $("#sidebar");
    sidebar.innerHTML = "";

    const tiles = document.createElement("div");
    tiles.className = "module-tiles";
    sidebar.appendChild(tiles);

    items.forEach((it) => {
      const btn = document.createElement("div");
      btn.className = "tile";
      btn.tabIndex = 0;
      btn.setAttribute("role", "button");
      btn.dataset.module = it.id;
      btn.innerHTML = `
        <div class="ico" aria-hidden="true">${it.icon || "▦"}</div>
        <div class="title">${qs(it.title)}</div>
      `;
      btn.addEventListener("click", () => openModule(it.id));
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") openModule(it.id);
      });
      tiles.appendChild(btn);
    });
    highlightSidebarModule(CURRENT_MODULE_ID);
  }

  function setActiveNav(group) {
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.group === group));
  }

  function showContentHeader({ title, subtitle }) {
    $("#contentHeader").innerHTML = `
      <div style="display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
        <div>
          <h3>${qs(title)}</h3>
          <p class="muted">${qs(subtitle || "")}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="pill" id="runStatusBadge" style="font-weight:900">Run status: idle</span>
          <span class="pill" id="qualityBadge" style="font-weight:900">Data quality: N/A</span>
        </div>
      </div>
    `;
    updateDataQualityBadge(CURRENT_MODULE_ID);
    setRunStatus("", false);
  }

  function showProfessorModal() {
    const existing = document.getElementById("profModal");
    if (existing) {
      existing.classList.add("open");
      return;
    }

    const modal = document.createElement("div");
    modal.id = "profModal";
    modal.innerHTML = `
      <style>
        #profModal{position:fixed;inset:0;z-index:999;display:grid;place-items:center;background:rgba(15,23,42,0.45);padding:18px;opacity:0;pointer-events:none;transition:opacity .15s ease}
        #profModal.open{opacity:1;pointer-events:auto}
        #profModal .box{width:min(860px,100%);background:#fff;border:1px solid #c5cdd8;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,0.12);padding:16px;color:#0f172a}
        #profModal header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
        #profModal h3{margin:0;font-size:18px;color:#0f172a}
        #profModal .close{appearance:none;border:1px solid #c5cdd8;background:#f4f6f9;color:#0f172a;border-radius:12px;padding:10px 12px;cursor:pointer;font-weight:850}
        #profModal .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        #profModal textarea{width:100%;min-height:88px;background:#fff;border:1px solid #c5cdd8;border-radius:14px;color:#0f172a;padding:12px}
        #profModal .searchBox{display:flex;gap:10px;margin-top:10px;align-items:center}
        #profModal input{flex:1;background:#fff;border:1px solid #c5cdd8;border-radius:14px;color:#0f172a;padding:12px}
        #profModal .answer{margin-top:12px;background:#f4f6f9;border:1px solid #c5cdd8;border-radius:14px;padding:12px;white-space:pre-wrap;color:#0f172a}
        #profModal .kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#475569;font-weight:700;font-size:12px}
        @media (max-width:900px){#profModal .row{grid-template-columns:1fr}}
      </style>
      <div class="box" role="dialog" aria-modal="true" aria-label="BKQuant Professor">
        <header>
          <div>
            <h3>BKQuant Professor</h3>
            <div class="muted small" style="margin-top:4px">Offline concept guide for agricultural quantitative analysis.</div>
          </div>
          <button class="close" type="button">Close</button>
        </header>
        <div class="row">
          <div>
            <div class="muted small" style="font-weight:800;margin-bottom:8px">Pick a topic</div>
            <div style="display:flex;flex-wrap:wrap;gap:10px">
              <button class="action-btn" data-topic="CRD">CRD</button>
              <button class="action-btn" data-topic="RBD">RBD</button>
              <button class="action-btn" data-topic="Lattice">Lattice Square</button>
              <button class="action-btn" data-topic="Correlation">Correlation</button>
              <button class="action-btn" data-topic="Regression">Regression</button>
              <button class="action-btn" data-topic="PCA">PCA</button>
              <button class="action-btn" data-topic="Diallel">Diallel</button>
              <button class="action-btn" data-topic="AMMI">AMMI</button>
            </div>
            <div class="muted small" style="margin-top:12px">Tip: type a question below, then click “Explain”.</div>
          </div>
          <div>
            <div class="muted small" style="font-weight:800;margin-bottom:8px">Your question</div>
            <textarea id="profQuestion" placeholder="e.g., How is CRD ANOVA interpreted?"></textarea>
            <div class="searchBox">
              <span class="kbd">Enter</span>
              <button class="primary action-btn primary2" type="button" id="profExplain">Explain</button>
            </div>
            <div class="answer" id="profAnswer"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector(".close");
    const topicBtns = modal.querySelectorAll("[data-topic]");
    const explainBtn = modal.querySelector("#profExplain");
    const question = modal.querySelector("#profQuestion");
    const answer = modal.querySelector("#profAnswer");

    const topicMap = {
      CRD:
        "CRD (Completely Randomized Design) fits when all experimental units are equally homogeneous.\n• Perform ANOVA: if treatment F is significant, compare treatment means.\n• Interpretation: significant SS (treatments) means genotypic/ treatment differences are larger than experimental error.\n• Practical note: unequal replications or missing data reduce validity.",
      RBD:
        "RBD (Randomized Block Design) controls field/gradient effects by dividing units into blocks.\n• Two sources: treatments and blocks.\n• If block SS is significant, the field gradient mattered.\n• Main check: treatment F vs error MS.\n• Interpretation: significant treatments imply meaningful differences across treatments after blocking.",
      Lattice:
        "Lattice square is used when there is substantial heterogeneity and many treatments.\n• It reduces error variance by arranging plots into incomplete blocks (lattices).\n• Interpretation follows the lattice ANOVA: treatment effects compared against error (with intra-lattice structure).",
      Correlation:
        "Correlation measures association between two traits.\n• Pearson: linear relationship (sensitive to outliers).\n• Spearman: rank correlation (robust, monotonic).\n• Kendall: concordance-based.\n• Interpretation: sign indicates direction; magnitude indicates strength; significance depends on sample size.",
      Regression:
        "Regression predicts one trait from another (or multiple traits).\n• Simple linear: Y = a + bX.\n• Multiple linear: Y = a + b1X1 + b2X2 ...\n• Interpretation: slope sign indicates direction; R² indicates explained variability; check residual behavior.",
      PCA:
        "PCA reduces correlated traits into principal components.\n• PC1 captures maximum variance; PC2 captures next.\n• Interpretation: loadings show how each trait contributes.\n• Biplot: plots samples and traits simultaneously; closeness indicates positive association.",
      Diallel:
        "Diallel analysis estimates genetic components (general/specific combining ability) under defined mating schemes.\n• Methods (DA I-IV) differ in assumptions and how components are expressed.\n• Interpretation: GCA reflects additive effects; SCA reflects non-additive (dominance/epistasis) contributions.\n• If SCA is large/significant, non-additive effects are important.",
      AMMI:
        "AMMI (Additive Main effects and Multiplicative Interaction) partitions genotype x environment interaction.\n• Main effects: ANOVA for G and E.\n• Interaction: IPCA axes from PCA.\n• Interpretation: significant IPCA indicates structured interaction; biplot helps identify stable vs responsive genotypes.",
    };

    function setAnswer(text) {
      answer.innerText = text;
    }

    topicBtns.forEach((b) => {
      b.addEventListener("click", () => {
        const t = b.dataset.topic;
        question.value = "";
        setAnswer(topicMap[t] || "Explain this topic using the inputs on the page.");
      });
    });

    function explain() {
      const q = (question.value || "").trim();
      if (!q) {
        setAnswer("Type a question and click Explain.\n\nExample: “How is RBD interpreted?”");
        return;
      }
      const lower = q.toLowerCase();
      if (lower.includes("crd")) return setAnswer(topicMap.CRD);
      if (lower.includes("rbd")) return setAnswer(topicMap.RBD);
      if (lower.includes("correlation")) return setAnswer(topicMap.Correlation);
      if (lower.includes("regression")) return setAnswer(topicMap.Regression);
      if (lower.includes("pca")) return setAnswer(topicMap.PCA);
      if (lower.includes("diallel")) return setAnswer(topicMap.Diallel);
      if (lower.includes("ammi")) return setAnswer(topicMap.AMMI);
      setAnswer(
        "Offline concept mode.\n\nI can explain the most common modules (CRD, RBD, Correlation, Regression, PCA, Diallel, AMMI).\nTry one of the topic buttons, or use a keyword like:\n• CRD\n• RBD\n• Correlation\n• Regression\n• PCA\n• Diallel\n• AMMI"
      );
    }

    explainBtn.addEventListener("click", explain);
    question.addEventListener("keydown", (e) => {
      if (e.key === "Enter") explain();
    });

    closeBtn.addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("open");
    });

    modal.classList.add("open");
  }

  function saveReportMeta(meta) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // ignore
    }
  }

  function showReportMetaModal() {
    const existing = document.getElementById("metaModal");
    if (existing) {
      existing.classList.add("open");
      return;
    }

    const current = loadReportMeta() || {};
    const modal = document.createElement("div");
    modal.id = "metaModal";
    modal.innerHTML = `
      <style>
        #metaModal{position:fixed;inset:0;z-index:999;display:grid;place-items:center;background:rgba(15,23,42,0.45);padding:18px;opacity:0;pointer-events:none;transition:opacity .15s ease}
        #metaModal.open{opacity:1;pointer-events:auto}
        #metaModal .box{width:min(860px,100%);background:#fff;border:1px solid #c5cdd8;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,0.12);padding:16px;color:#0f172a}
        #metaModal header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
        #metaModal h3{margin:0;font-size:18px;color:#0f172a}
        #metaModal .close{appearance:none;border:1px solid #c5cdd8;background:#f4f6f9;color:#0f172a;border-radius:12px;padding:10px 12px;cursor:pointer;font-weight:850}
        #metaModal .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        #metaModal label{display:grid;gap:6px;font-weight:700;font-size:12.5px;color:#334155}
        #metaModal input{width:100%;padding:12px;border-radius:14px;border:1px solid #c5cdd8;background:#fff;color:#0f172a}
        #metaModal .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
        @media (max-width:900px){#metaModal .grid{grid-template-columns:1fr}}
      </style>
      <div class="box" role="dialog" aria-modal="true" aria-label="Report metadata">
        <header>
          <div>
            <h3>Report metadata (included in Word .mht / XLS downloads)</h3>
            <div class="muted small" style="margin-top:4px">Saved locally on this computer (offline). You can update anytime.</div>
          </div>
          <button class="close" type="button">Close</button>
        </header>
        <div class="grid">
          <label>Researcher<input id="mResearcher" value="${qs(current.researcher || "")}" placeholder="e.g., Dr. BK Praveen"/></label>
          <label>Institution<input id="mInstitution" value="${qs(current.institution || "")}" placeholder="e.g., Plant Breeding Lab"/></label>
          <label>Crop<input id="mCrop" value="${qs(current.crop || "")}" placeholder="e.g., Rice"/></label>
          <label>Trait(s)<input id="mTraits" value="${qs(current.traits || "")}" placeholder="e.g., Yield, Plant height"/></label>
          <label>Season/Year<input id="mSeason" value="${qs(current.season || "")}" placeholder="e.g., Kharif 2026"/></label>
          <label>Location<input id="mLocation" value="${qs(current.location || "")}" placeholder="e.g., Farm-1, Block-A"/></label>
          <label>Date<input id="mDate" value="${qs(current.date || new Date().toISOString().slice(0,10))}" placeholder="YYYY-MM-DD"/></label>
        </div>
        <div class="actions">
          <button class="action-btn primary2" type="button" id="mSave">Save metadata</button>
          <button class="action-btn" type="button" id="mClear">Clear</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = modal.querySelector(".close");
    close.addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("open");
    });

    modal.querySelector("#mSave").addEventListener("click", () => {
      const meta = {
        researcher: modal.querySelector("#mResearcher").value.trim(),
        institution: modal.querySelector("#mInstitution").value.trim(),
        crop: modal.querySelector("#mCrop").value.trim(),
        traits: modal.querySelector("#mTraits").value.trim(),
        season: modal.querySelector("#mSeason").value.trim(),
        location: modal.querySelector("#mLocation").value.trim(),
        date: modal.querySelector("#mDate").value.trim(),
      };
      saveReportMeta(meta);
      modal.classList.remove("open");
    });

    modal.querySelector("#mClear").addEventListener("click", () => {
      saveReportMeta({});
      ["#mResearcher","#mInstitution","#mCrop","#mTraits","#mSeason","#mLocation"].forEach((id) => {
        const el = modal.querySelector(id);
        if (el) el.value = "";
      });
    });

    modal.classList.add("open");
  }

  function storePrev(moduleId, payload) {
    try {
      localStorage.setItem(PREV_KEY_PREFIX + moduleId, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function loadPrev(moduleId) {
    try {
      const raw = localStorage.getItem(PREV_KEY_PREFIX + moduleId);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function deviationBanner(moduleId, current, compareKeys) {
    const prev = loadPrev(moduleId);
    if (!prev) return "";
    let diverged = false;
    for (const k of compareKeys) {
      const a = current[k];
      const b = prev[k];
      if (typeof a === "number" && typeof b === "number") {
        const denom = Math.max(1e-9, Math.abs(b));
        if (Math.abs(a - b) / denom > 0.08) diverged = true; // >8% change
      } else if (a !== b) {
        diverged = true;
      }
    }
    if (!diverged) return "";

    // Generic reasons that are true across designs.
    const reasons = [
      "Your inputs (treatment means, replication counts, or block structure) differ from the previous run, so the ANOVA MS (error) and therefore F/means can change.",
      "If the dataset changed in scale or contains outliers, correlation/regression and component estimates may shift.",
      "Missing values or unequal replications can change how sums of squares are computed, leading to deviations.",
      "Experimental heterogeneity (field/environment differences) can alter error variance and change significance outcomes.",
    ];

    // Pick 2 reasons deterministically
    const idx = Math.abs(hashCode(moduleId + JSON.stringify(current))) % reasons.length;
    const r1 = reasons[idx];
    const r2 = reasons[(idx + 2) % reasons.length];

    return `<div class="note" role="status" style="margin-top:10px">
      <b>Deviation detected:</b> results are deviate from your previous run.
      <div style="margin-top:8px;white-space:pre-wrap;color:rgba(255,230,180,0.98)">${qs("Why this happens:\n- " + r1 + "\n- " + r2)}</div>
    </div>`;
  }

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    return h | 0;
  }

  // -----------------------------
  // Module rendering (tables + charts)
  // -----------------------------
  function clearValidation(containerSel) {
    const root = document.querySelector(containerSel);
    if (!root) return;
    root.querySelectorAll("[data-invalid='1']").forEach((el) => {
      el.removeAttribute("data-invalid");
      el.style.borderColor = "";
      el.style.boxShadow = "";
      el.removeAttribute("title");
    });
  }

  function markInvalidInput(el, reason) {
    if (!el) return;
    el.setAttribute("data-invalid", "1");
    el.style.borderColor = "rgba(255,92,122,0.95)";
    el.style.boxShadow = "0 0 0 2px rgba(255,92,122,0.25)";
    el.title = reason || "Invalid input";
  }

  function validationSummaryHtml(errors) {
    if (!errors || !errors.length) return "";
    return `<div class="note" style="margin-top:10px;border-color:rgba(255,92,122,0.55);background:rgba(255,92,122,0.12);color:rgba(255,225,232,0.98)">
      <b>Input validation errors (${errors.length})</b>
      <div style="margin-top:6px;white-space:pre-wrap">${qs(errors.slice(0, 8).join("\n"))}${errors.length > 8 ? "\n..." : ""}</div>
    </div>`;
  }

  function assumptionsChecklistHtml(title, items) {
    return `<h4>${qs(title)}</h4>${buildTable(["Assumption", "Status", "Note"], items.map((x) => [x.assumption, x.status, x.note || ""]))}`;
  }

  const PROJECTS_KEY = "bkq_saved_projects_v1";
  let CURRENT_MODULE_ID = "";
  let CURRENT_BATCH_PRESET = "";
  let FORCE_RUN_MODE = false;
  let STRICT_MODE = false;
  const RUN_WARNINGS = {};
  const LAST_RUN_META = {};

  function isForceRunEnabled() {
    return FORCE_RUN_MODE;
  }

  function setRunWarning(moduleId, warningText) {
    RUN_WARNINGS[moduleId] = warningText || "";
  }

  function getRunWarning(moduleId) {
    return RUN_WARNINGS[moduleId] || "";
  }

  function shouldBlockForValidation(moduleId, errors, mountSel) {
    if (!errors || !errors.length) {
      setRunWarning(moduleId, "");
      return false;
    }
    const el = document.querySelector(mountSel);
    if (isForceRunEnabled()) {
      const msg = `Force run enabled: ${errors.length} validation issue(s) were bypassed.`;
      if (el) {
        el.innerHTML = `${validationSummaryHtml(errors)}<div class="note" style="margin-top:8px;border-color:rgba(255,209,102,0.55);background:rgba(255,209,102,0.12)">⚠ ${qs(msg)}</div>`;
      }
      setRunWarning(moduleId, msg);
      return false;
    }
    if (el) el.innerHTML = validationSummaryHtml(errors);
    setRunWarning(moduleId, "");
    return true;
  }

  function matrixValidationErrors(R, opts = {}) {
    const errors = [];
    const n = R.length;
    const minVal = Number.isFinite(opts.minVal) ? opts.minVal : -1;
    const maxVal = Number.isFinite(opts.maxVal) ? opts.maxVal : 1;
    const requireUnitDiag = opts.requireUnitDiag !== false;
    const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 1e-6;
    for (let i = 0; i < n; i++) {
      if (!Array.isArray(R[i]) || R[i].length !== n) {
        errors.push("Matrix must be square.");
        return errors;
      }
      for (let j = 0; j < n; j++) {
        const v = R[i][j];
        if (!Number.isFinite(v)) errors.push(`Invalid numeric value at [${i + 1}, ${j + 1}]`);
        if (Number.isFinite(v) && (v < minVal || v > maxVal)) {
          errors.push(`Value out of range at [${i + 1}, ${j + 1}] (expected ${minVal}..${maxVal})`);
        }
        if (requireUnitDiag && i === j && Number.isFinite(v) && Math.abs(v - 1) > tol) {
          errors.push(`Diagonal at [${i + 1}, ${j + 1}] must be 1`);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Number.isFinite(R[i][j]) && Number.isFinite(R[j][i]) && Math.abs(R[i][j] - R[j][i]) > tol) {
          errors.push(`Matrix is not symmetric at [${i + 1}, ${j + 1}] and [${j + 1}, ${i + 1}]`);
        }
      }
    }
    return errors;
  }

  function zScoreColumns(X) {
    const n = X.length;
    const p = X[0]?.length || 0;
    const mu = Array(p).fill(0);
    const sd = Array(p).fill(0);
    for (let j = 0; j < p; j++) mu[j] = mean(X.map((r) => r[j]));
    for (let j = 0; j < p; j++) {
      const v = mean(X.map((r) => {
        const d = r[j] - mu[j];
        return d * d;
      }));
      sd[j] = Math.sqrt(v) || 1;
    }
    const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
    return { Z, mu, sd };
  }

  function residualSummary(residuals) {
    if (!residuals?.length) return { rmse: 0, mae: 0, maxAbs: 0 };
    const abs = residuals.map((e) => Math.abs(e));
    const rmse = Math.sqrt(mean(residuals.map((e) => e * e)));
    const mae = mean(abs);
    const maxAbs = Math.max(...abs);
    return { rmse, mae, maxAbs };
  }

  function outlierFlags(values) {
    if (!values?.length) return { count: 0, indices: [], bounds: [0, 0] };
    const s = values.slice().sort((a, b) => a - b);
    const q1 = s[Math.floor((s.length - 1) * 0.25)];
    const q3 = s[Math.floor((s.length - 1) * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const indices = [];
    values.forEach((v, i) => {
      if (v < lo || v > hi) indices.push(i);
    });
    return { count: indices.length, indices, bounds: [lo, hi] };
  }

  function drawResidualMiniPlot(canvas, residuals, title = "Residuals vs index") {
    const pts = residuals.map((e, i) => ({ x: i + 1, y: e }));
    drawScatterPlot(canvas, pts, { title, xLabel: "Obs", yLabel: "Residual" });
  }

  function qualityScoreHtml(items) {
    const score = Math.max(0, Math.min(100, Math.round(mean(items.map((x) => x.pass ? 100 : 45)))));
    const rows = items.map((x) => [x.check, x.pass ? "Pass" : "Warn", x.note || ""]);
    return `<div class="kpi-row" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:10px">
      <div class="kpi"><div class="label">Analysis quality score</div><div class="value">${score}/100</div></div>
      <div class="kpi"><div class="label">Checks passed</div><div class="value">${items.filter((x) => x.pass).length}/${items.length}</div></div>
      <div class="kpi"><div class="label">Status</div><div class="value">${score >= 80 ? "Good" : score >= 60 ? "Caution" : "Low confidence"}</div></div>
    </div>${buildTable(["Check", "Status", "Note"], rows)}`;
  }

  function setRunMeta(moduleId, payload) {
    LAST_RUN_META[moduleId] = { ...(payload || {}), timestamp: new Date().toISOString() };
    if (moduleId === CURRENT_MODULE_ID) updateDataQualityBadge(moduleId);
  }

  function setRunStatus(text = "", busy = false) {
    const el = document.getElementById("runStatusBadge");
    if (!el) return;
    if (!text) {
      el.textContent = "Run status: idle";
      el.style.background = "#e2e8f0";
      return;
    }
    el.textContent = `Run status: ${text}`;
    el.style.background = busy ? "rgba(29, 78, 216, 0.12)" : "rgba(15, 118, 110, 0.12)";
  }

  function updateDataQualityBadge(moduleId) {
    const badge = document.getElementById("qualityBadge");
    if (!badge) return;
    const m = LAST_RUN_META[moduleId] || {};
    const raw = String(m.qualityScore || "").match(/(\d+)/);
    const score = raw ? Number(raw[1]) : null;
    let txt = "Data quality: N/A";
    let bg = "#e2e8f0";
    if (Number.isFinite(score)) {
      txt = `Data quality: ${score}/100`;
      if (score >= 80) bg = "rgba(15, 118, 110, 0.15)";
      else if (score >= 60) bg = "rgba(217, 119, 6, 0.15)";
      else bg = "rgba(220, 38, 38, 0.12)";
    }
    badge.textContent = txt;
    badge.style.background = bg;
  }

  function strictModeShouldBlock(moduleId, qualityItems, mountSel) {
    if (!STRICT_MODE) return false;
    const warns = (qualityItems || []).filter((x) => !x.pass);
    if (!warns.length) return false;
    const el = document.querySelector(mountSel);
    if (isForceRunEnabled()) {
      if (el) {
        el.innerHTML = `<div class="note" style="margin-top:8px;border-color:rgba(255,209,102,0.55);background:rgba(255,209,102,0.12)">⚠ Strict mode warning bypassed by Force run (${warns.length} warning check(s)).</div>`;
      }
      setRunWarning(moduleId, `Strict mode warnings bypassed (${warns.length}).`);
      return false;
    }
    if (el) {
      el.innerHTML = `<div class="note" style="margin-top:8px;border-color:rgba(255,92,122,0.55);background:rgba(255,92,122,0.12)">Strict mode blocked run due to ${warns.length} warning check(s). Disable strict mode or resolve warnings.</div>`;
    }
    setRunWarning(moduleId, `Strict mode blocked run (${warns.length} warning checks).`);
    return true;
  }

  function inputStateKey(el, idx) {
    if (el.id) return `id:${el.id}`;
    const dataKeys = Object.keys(el.dataset || {}).sort();
    if (dataKeys.length) return `data:${dataKeys.map((k) => `${k}=${el.dataset[k]}`).join("|")}`;
    return `idx:${el.tagName.toLowerCase()}:${idx}`;
  }

  function captureCurrentInputState() {
    const nodes = Array.from(document.querySelectorAll("#contentBody input, #contentBody textarea, #contentBody select"));
    const state = {};
    nodes.forEach((el, idx) => {
      const key = inputStateKey(el, idx);
      const val = el.type === "checkbox" ? !!el.checked : String(el.value ?? "");
      state[key] = val;
    });
    return state;
  }

  function applyInputState(stateObj) {
    const nodes = Array.from(document.querySelectorAll("#contentBody input, #contentBody textarea, #contentBody select"));
    nodes.forEach((el, idx) => {
      const key = inputStateKey(el, idx);
      if (!(key in stateObj)) return;
      if (el.type === "checkbox") el.checked = !!stateObj[key];
      else el.value = String(stateObj[key]);
    });
  }

  function loadProjects() {
    try {
      return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function exportProjectsJson() {
    const all = loadProjects();
    const blob = JSON.stringify(all, null, 2);
    downloadBlob(`bkquant_projects_${new Date().toISOString().slice(0, 10)}.json`, "application/json", blob);
  }

  async function importProjectsJson(file) {
    if (!file) return;
    try {
      const txt = await file.text();
      const incoming = JSON.parse(txt);
      if (!incoming || typeof incoming !== "object") throw new Error("Invalid file");
      const current = loadProjects();
      const merged = { ...current, ...incoming };
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(merged));
      alert(`Imported ${Object.keys(incoming).length} project(s).`);
    } catch {
      alert("Project import failed. Please use a valid BKQuant JSON export.");
    }
  }

  function saveCurrentProject(moduleId) {
    const name = (window.prompt("Project name to save:", `${moduleId}-project`) || "").trim();
    if (!name) return;
    const all = loadProjects();
    all[name] = { moduleId, state: captureCurrentInputState(), savedAt: new Date().toISOString() };
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(all));
    alert(`Saved project: ${name}`);
  }

  function loadProjectIntoModule(openModuleFn) {
    const all = loadProjects();
    const names = Object.keys(all);
    if (!names.length) {
      alert("No saved projects found.");
      return;
    }
    const pick = (window.prompt(`Available projects:\n${names.join("\n")}\n\nEnter project name:`) || "").trim();
    if (!pick || !all[pick]) return;
    const p = all[pick];
    openModuleFn(p.moduleId);
    setTimeout(() => {
      applyInputState(p.state || {});
      const btn = document.querySelector("#contentBody button[id$='Compute']");
      btn?.click();
    }, 0);
  }

  function setUtilityPanelHtml(html) {
    const host = document.querySelector("#contentBody .utility-panel-host");
    if (!host) return;
    host.innerHTML = html || "";
    const closeBtn = host.querySelector("[data-utility='close']");
    closeBtn?.addEventListener("click", () => setUtilityPanelHtml(""));
  }

  function applyStandardTableCaptions(containerSel = "#contentBody") {
    const root = document.querySelector(containerSel);
    if (!root) return;

    // remove previously auto-generated captions to avoid duplication
    root.querySelectorAll("[data-auto-caption='1']").forEach((el) => el.remove());

    const tables = Array.from(root.querySelectorAll("table.data, table.corr-heatmap"));
    tables.forEach((table, idx) => {
      const prev = table.previousElementSibling;
      if (prev && prev.tagName === "H4" && !prev.dataset.autoCaption) return;
      const h = document.createElement("h4");
      h.dataset.autoCaption = "1";
      h.style.margin = "10px 0 8px";
      h.textContent = `Table ${idx + 1}. ${table.getAttribute("data-caption") || "Analysis output"}`;
      table.parentNode.insertBefore(h, table);
    });
  }

  function moduleShell({ moduleId, title, subtitle, bodyHtml, payloadForPrevComparison, prevCompareKeys = [] }) {
    const exportRow = `
      <div class="results-toolbar" role="region" aria-label="Export, project, and run options">
        <div class="results-toolbar__group">
          <span class="results-toolbar__label">Report</span>
          <div class="results-toolbar__buttons">
            <button class="action-btn primary2" type="button" data-export="full">Export Full Report</button>
            <button class="action-btn primary2" type="button" data-export="doc" title="Word: opens .mht with figures embedded (CID parts)">Download Word (.mht)</button>
            <button class="action-btn primary2" type="button" data-export="xls">Download XLS</button>
            <button class="action-btn" type="button" data-export="print">Print</button>
          </div>
        </div>
        <div class="results-toolbar__group">
          <span class="results-toolbar__label">Project</span>
          <div class="results-toolbar__buttons">
            <button class="action-btn" type="button" data-project="save">Save project</button>
            <button class="action-btn" type="button" data-project="load">Load project</button>
            <button class="action-btn" type="button" data-project="manage">Manage projects</button>
            <button class="action-btn" type="button" data-project="export">Export projects JSON</button>
            <button class="action-btn" type="button" data-project="import">Import projects JSON</button>
          </div>
        </div>
        <div class="results-toolbar__group">
          <span class="results-toolbar__label">Batch</span>
          <div class="results-toolbar__buttons">
            <button class="action-btn" type="button" data-run="selected">Run selected analyses</button>
            <button class="action-btn" type="button" data-run="force">${FORCE_RUN_MODE ? "Force run: ON" : "Force run: OFF"}</button>
            <button class="action-btn" type="button" data-run="strict">${STRICT_MODE ? "Strict mode: ON" : "Strict mode: OFF"}</button>
          </div>
        </div>
      </div>
    `;

    const exportInterpretationEl = `
      <div class="results-interpretation">
        <h4 class="results-interpretation__title">Interpretation</h4>
        <div class="export-interpretation results-interpretation__body"></div>
      </div>
    `;

    $("#contentBody").innerHTML = `
      <div class="section">
        ${bodyHtml}
        ${exportRow}
        <input type="file" id="projectsImportFile" accept=".json,application/json" style="display:none" />
        ${exportInterpretationEl}
        <div class="utility-panel-host" style="margin-top:12px"></div>
      </div>
    `;

    $$("#contentBody [id$='TableWrap']").forEach((el) => el.classList.add("results-stack"));

    CURRENT_MODULE_ID = moduleId;
    highlightSidebarModule(moduleId);
    // bind exports
    $$("#contentBody [data-export]").forEach((b) => {
      b.addEventListener("click", async () => {
        const type = b.dataset.export;
        const tableTitle = title;
        applyStandardTableCaptions("#contentBody");
        if (type === "print") {
          window.print();
          return;
        }
        b.disabled = true;
        const prev = b.textContent;
        b.textContent = "Preparing export…";
        try {
          if (type === "full") {
            await exportHtmlAsDocOrXls({
              title: tableTitle,
              moduleId,
              filename: `${tableTitle.replace(/\s+/g, "_")}_Full_Report.doc`,
              asExcel: false,
            });
            await exportHtmlAsDocOrXls({
              title: tableTitle,
              moduleId,
              filename: `${tableTitle.replace(/\s+/g, "_")}_Full_Report.xls`,
              asExcel: true,
            });
          } else if (type === "doc") {
            await exportHtmlAsDocOrXls({
              title: tableTitle,
              moduleId,
              filename: `${tableTitle.replace(/\s+/g, "_")}.doc`,
              asExcel: false,
            });
          } else if (type === "xls") {
            await exportHtmlAsDocOrXls({
              title: tableTitle,
              moduleId,
              filename: `${tableTitle.replace(/\s+/g, "_")}.xls`,
              asExcel: true,
            });
          }
        } finally {
          b.disabled = false;
          b.textContent = prev;
        }
      });
    });

    $$("#contentBody [data-project]").forEach((b) => {
      b.addEventListener("click", () => {
        const t = b.dataset.project;
        if (t === "save") saveCurrentProject(moduleId);
        if (t === "load") loadProjectIntoModule(openModule);
        if (t === "manage") showProjectManager();
        if (t === "export") exportProjectsJson();
        if (t === "import") document.getElementById("projectsImportFile")?.click();
      });
    });
    document.getElementById("projectsImportFile")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      await importProjectsJson(f);
      e.target.value = "";
    });

    $$("#contentBody [data-run]").forEach((b) => {
      b.addEventListener("click", () => {
        const t = b.dataset.run;
        if (t === "force") {
          FORCE_RUN_MODE = !FORCE_RUN_MODE;
          b.textContent = FORCE_RUN_MODE ? "Force run: ON" : "Force run: OFF";
          return;
        }
        if (t === "strict") {
          STRICT_MODE = !STRICT_MODE;
          b.textContent = STRICT_MODE ? "Strict mode: ON" : "Strict mode: OFF";
          return;
        }
        if (t === "selected") showRunSelectorPanel();
      });
    });

    // Compute guard: show running status and prevent accidental double-clicks.
    $("#contentBody").addEventListener("click", (e) => {
      const btn = e.target.closest("button[id$='Compute']");
      if (!btn || btn.dataset.running === "1") return;
      btn.dataset.running = "1";
      const oldText = btn.textContent;
      btn.textContent = "Running...";
      btn.disabled = true;
      setRunStatus("running", true);
      setTimeout(() => {
        btn.dataset.running = "0";
        btn.textContent = oldText;
        btn.disabled = false;
        setRunStatus("done", false);
      }, 500);
    }, { capture: true });

    // set interpretation and deviation message (last in output)
    const interpretEl = $("#contentBody .export-interpretation");
    const interpretText = payloadForPrevComparison?.interpretation || "";
    interpretEl.innerText = interpretText;
    if (payloadForPrevComparison?.deviationMessage) {
      // if we already injected inside payload, keep; else append
      interpretEl.insertAdjacentHTML("beforeend", payloadForPrevComparison.deviationMessage);
    }

    if (payloadForPrevComparison && payloadForPrevComparison.storePrev) {
      const payloadToStore = payloadForPrevComparison.storePrev;
      storePrev(moduleId, payloadToStore);
    }

    // standardize table captions for consistent report layout
    injectSessionUploadBanner(moduleId);
    applyStandardTableCaptions("#contentBody");
    initChartPanels("#contentBody");

    return { prevComparison: deviationBanner(moduleId, payloadForPrevComparison?.storePrev || {}, prevCompareKeys) };
  }

  function setInterpretation(moduleId, interpretation, deviationHtml, storePrevPayload) {
    const w = getRunWarning(moduleId);
    const warningHtml = w ? `<div class="note" style="margin-top:8px;border-color:rgba(255,209,102,0.55);background:rgba(255,209,102,0.12)">⚠ ${qs(w)}</div>` : "";
    $("#contentBody .export-interpretation").innerHTML = `<div>${qs(interpretation)}</div>${warningHtml}${deviationHtml || ""}`;
    if (storePrevPayload) storePrev(moduleId, storePrevPayload);
  }

  // --- CRD ---
  function renderCRD() {
    const title = "CRD (Completely Randomized Design) - ANOVA";
    showContentHeader({
      title,
      subtitle:
        "Homogeneous experimental units: SS partitioned into Treatments and pooled within-group error. Unequal replication uses Type III SS. Levene test for variance homogeneity; means, SEm, Fisher LSD (CD).",
    });

    const defaultT = 4;
    const defaultR = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">One-way CRD</div></div>
        <div class="kpi"><div class="label">Partition</div><div class="value">Treatments + error</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">ANOVA + Levene + LSD</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="muted small" style="margin-bottom:8px">Treatments (rows T1..T<sub>t</sub>), replicates (columns up to R<sub>max</sub>). Leave a cell empty to omit that replicate — unequal n is allowed. Each treatment needs ≥1 value; total N must exceed t for error df.</div>
            <div class="bkq-data-upload-panel">
              <div class="bkq-data-upload-panel__title">Upload data</div>
              <div class="muted small" style="margin-bottom:10px">
                <strong>CSV / Excel:</strong> optional first column (T1, T2, …); remaining columns = replicate yields. Or omit labels — all cells numeric (rows = treatments, columns = reps). First Excel sheet only.
              </div>
              <div class="actions">
                <button class="action-btn primary2" type="button" id="crdImportCsv">Import CSV / Excel</button>
              </div>
              <input type="file" id="crdCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div class="input-grid" id="crdControls">
              <div class="two-col">
                <label>
                  Treatments (T)
                  <input type="number" min="2" id="crdT" value="${defaultT}" />
                </label>
                <label>
                  Max replicates (columns)
                  <input type="number" min="2" id="crdR" value="${defaultR}" />
                </label>
              </div>
              <button class="action-btn primary2" type="button" id="crdBuild">Build grid</button>
              <div class="note" style="margin:0">
                Tip: Clear optional replicate cells for unequal n; Type III treatment SS is used automatically when counts differ.
              </div>
            </div>
            <div id="crdGridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="crdCompute">Compute CRD</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="crdResultTop"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="crdBar" style="width:100%;height:100%"></canvas>
            </div>
            <div class="chart" style="height:210px;margin-top:12px">
              <canvas id="crdResidualPlot" style="width:100%;height:100%"></canvas>
            </div>
            <div id="crdTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "crd",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fStat"],
    });

    function buildGrid(t, r) {
      const wrap = $("#crdGridWrap");
      wrap.innerHTML = "";
      const grid = document.createElement("div");
      grid.innerHTML = "";

      const head = document.createElement("table");
      head.className = "data";

      const th = ["Treatment/Rep"];
      for (let j = 0; j < r; j++) th.push(`R${j + 1}`);

      const thead = `<thead><tr>${th.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const tbodyRows = [];
      for (let i = 0; i < t; i++) {
        const tname = `T${i + 1}`;
        const tVals = [];
        for (let j = 0; j < r; j++) {
          const defaultVal = (i + 1) * 10 + (j + 1) * 0.8 + (i === 2 ? 2.2 : 0); // simple variation
          tVals.push(defaultVal);
        }
        const inputs = tVals
          .map((v, j) => `<td><input type="number" step="0.01" value="${v.toFixed(2)}" data-cell="t${i}r${j}" /></td>`)
          .join("");
        tbodyRows.push(`<tr><th>${qs(tname)}</th>${inputs}</tr>`);
      }
      head.innerHTML = `${thead}<tbody>${tbodyRows.join("")}</tbody>`;
      wrap.appendChild(head);
    }

    buildGrid(defaultT, defaultR);

    $("#crdBuild").addEventListener("click", () => {
      const t = Math.max(2, Number($("#crdT").value || defaultT));
      const r = Math.max(2, Number($("#crdR").value || defaultR));
      buildGrid(t, r);
    });

    bindCsvExcelFileImport("crdImportCsv", "crdCsvFile", (txt) => {
      const parsed = parseRectDataGridCsv(txt);
      if (!parsed || parsed.t < 2 || parsed.r < 2) {
        alert("Could not parse grid: need at least 2 treatment rows and 2 replicate columns. Optional text labels in the first column.");
        return;
      }
      $("#crdT").value = String(parsed.t);
      $("#crdR").value = String(parsed.r);
      buildGrid(parsed.t, parsed.r);
      for (let i = 0; i < parsed.t; i++) {
        for (let j = 0; j < parsed.r; j++) {
          const inp = document.querySelector(`#crdGridWrap input[data-cell="t${i}r${j}"]`);
          if (inp) inp.value = String(parsed.matrix[i][j]);
        }
      }
    });

    $("#crdCompute").addEventListener("click", () => {
      const t = Math.max(2, Number($("#crdT").value || defaultT));
      const r = Math.max(2, Number($("#crdR").value || defaultR));
      clearValidation("#crdGridWrap");
      const errors = [];

      const groups = [];
      for (let i = 0; i < t; i++) {
        const row = [];
        for (let j = 0; j < r; j++) {
          const input = document.querySelector(`#crdGridWrap input[data-cell="t${i}r${j}"]`);
          const raw = (input?.value ?? "").trim();
          if (raw === "") continue;
          const v = Number(raw);
          if (!Number.isFinite(v)) {
            errors.push(`CRD: invalid numeric value at T${i + 1}, R${j + 1}`);
            markInvalidInput(input, "Enter a valid number or leave blank");
          } else row.push(v);
        }
        groups.push(row);
      }
      for (let i = 0; i < t; i++) {
        if (groups[i].length < 1) errors.push(`CRD: treatment T${i + 1} has no observations.`);
      }
      const nTot = groups.reduce((s, g) => s + g.length, 0);
      if (nTot - t < 1) errors.push("CRD: need total observations N ≥ t + 1 so pooled error has df ≥ 1.");

      if (shouldBlockForValidation("crd", errors, "#crdResultTop")) return;

      const out = crdAnovaOneWay(groups);
      const lev = leveneTest(groups);
      const pfmt = (pv) => (pv < 1e-4 ? "<0.0001" : Number(pv).toFixed(4));

      const crdResiduals = [];
      for (let i = 0; i < t; i++) for (const v of groups[i]) crdResiduals.push(v - out.means[i].mean);
      const crdDiag = residualSummary(crdResiduals);
      const flatVals = groups.flat();
      const crdOut = outlierFlags(flatVals);

      const sems = out.means.map((m) => Math.sqrt(out.msError / m.n));
      const nHarm = t / out.ns.reduce((s, ni) => s + 1 / ni, 0);

      $("#crdResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(3, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (Treatments) / p</div><div class="value">${out.fStat.toFixed(4)} / ${pfmt(out.pTreat)}</div></div>
          <div class="kpi"><div class="label">df (Treat, Error)</div><div class="value">${out.dfTreat}, ${out.dfError}</div></div>
          <div class="kpi"><div class="label">MSE (pooled)</div><div class="value">${out.msError.toFixed(4)}</div></div>
        </div>
        <div class="kpi-row" style="grid-template-columns:repeat(3, minmax(0,1fr));margin-top:8px">
          <div class="kpi"><div class="label">Levene F / p</div><div class="value">${lev.fStat.toFixed(4)} / ${pfmt(lev.pTreat)}</div></div>
          <div class="kpi"><div class="label">Replication</div><div class="value">${out.balanced ? `Balanced (n=${out.ns[0]})` : `Unbalanced (Type III SS)`}</div></div>
          <div class="kpi"><div class="label">Residual RMSE</div><div class="value">${crdDiag.rmse.toFixed(4)}</div></div>
        </div>
      `;

      const labels = out.means.map((m) => m.treatment);
      const values = out.means.map((m) => m.mean);
      drawBarChartWithErrorBars($("#crdBar"), labels, values, sems, { title: "Treatment means ± SEm" });
      drawResidualMiniPlot($("#crdResidualPlot"), crdResiduals, "CRD residuals");

      const overallMeanCRD = mean(out.means.map((m) => m.mean));
      const statsCRD = computeBreedingSummaryStats({
        meanValue: overallMeanCRD,
        msGenotype: out.msTreat,
        msError: out.msError,
        replications: nHarm,
        dfError: out.dfError,
      });
      const summaryCRD = buildTable(
        ["Summary metric", "Value"],
        [
          ["Grand mean", overallMeanCRD],
          ["CV (%)", statsCRD.cv],
          ["CD (5%) — equal-r shortcut", statsCRD.cd5],
          ["SEm — equal-r shortcut", statsCRD.sem],
          ["SEd — equal-r shortcut", statsCRD.sed],
          ["H2 (broad sense, %)", statsCRD.h2],
          ["GA", statsCRD.ga],
          ["GA (% of mean)", statsCRD.gaPct],
          ["PCV (%)", statsCRD.pcv],
          ["GCV (%)", statsCRD.gcv],
          ["ECV (%)", statsCRD.ecv],
        ]
      );
      const matrixCRD = buildTable(
        ["Component", "Variance", "Coefficient (%)"],
        [
          ["Genotypic (sigma^2g)", statsCRD.sigmaG, statsCRD.gcv],
          ["Environmental (sigma^2e)", statsCRD.sigmaE, statsCRD.ecv],
          ["Phenotypic (sigma^2p)", statsCRD.sigmaP, statsCRD.pcv],
        ]
      );

      const meanDetail = buildTable(
        ["Treatment", "n", "Mean", "SEm"],
        out.means.map((m) => [m.treatment, m.n, m.mean, Math.sqrt(out.msError / m.n)])
      );

      const lsd5 = pairwiseFisherLsd(out.ns, out.msError, out.dfError, 0.05);
      const lsd1 = pairwiseFisherLsd(out.ns, out.msError, out.dfError, 0.01);
      const lsdRows = lsd5.map((p, idx) => [
        `T${p.i + 1} vs T${p.j + 1}`,
        p.lsd,
        lsd1[idx] ? lsd1[idx].lsd : NaN,
      ]);

      const anovaNote = out.balanced
        ? "Treatment SS equals standard between-groups SS (balanced)."
        : "Unequal replication: treatment SS is Type III (marginal) for the factor — Σ T_i²/n_i − G²/N.";

      const headers = ["Source", "SS", "df", "MS", "F", "p-value", "Sig. (approx.)"];
      const anovaRows = [
        ["Treatments", out.ssTreat, out.dfTreat, out.msTreat, out.fStat, pfmt(out.pTreat), out.sig.note],
        ["Experimental error (within)", out.ssError, out.dfError, out.msError, "", "", ""],
        ["Total", out.ssTotal, out.dfTreat + out.dfError, "", "", "", ""],
      ];
      const leveneRows = [
        ["Levene (|y − ȳᵢ|)", lev.ssTreat, lev.dfTreat, lev.msTreat, lev.fStat, pfmt(lev.pTreat), lev.sig.note],
        ["Error", lev.ssError, lev.dfError, lev.msError, "", "", ""],
        ["Total", lev.ssTotal, lev.dfTreat + lev.dfError, "", "", "", ""],
      ];

      const qItemsCRD = [
        { check: "Valid numeric inputs", pass: errors.length === 0, note: errors.length ? "Some values were invalid." : "All numeric cells valid." },
        { check: "Levene homogeneity (α=0.05)", pass: lev.pTreat >= 0.05, note: `p≈${pfmt(lev.pTreat)} on z = |y−ȳᵢ|.` },
        { check: "Outlier load (IQR)", pass: crdOut.count <= Math.max(1, Math.floor(flatVals.length * 0.1)), note: `${crdOut.count} flagged observation(s).` },
        { check: "Residual spread", pass: Number.isFinite(crdDiag.rmse) && crdDiag.rmse < Math.max(1e-9, Math.abs(mean(flatVals)) * 0.5), note: `RMSE=${crdDiag.rmse.toFixed(4)}` },
      ];
      if (strictModeShouldBlock("crd", qItemsCRD, "#crdResultTop")) return;
      $("#crdTableWrap").innerHTML = `${qualityScoreHtml(qItemsCRD)}<div style="height:10px"></div><h4>Table 1. One-way ANOVA (CRD)</h4><div class="muted small" style="margin-bottom:6px">${qs(anovaNote)}</div>${buildTable(headers, anovaRows)}<div style="height:10px"></div><h4>Table 2. Levene test (homogeneity of variance)</h4><div class="muted small" style="margin-bottom:6px">ANOVA on absolute deviations from treatment means. Non-significant p supports similar spread across groups.</div>${buildTable(headers, leveneRows)}<div style="height:10px"></div><h4>Table 3. Treatment means and SEm</h4><div class="muted small" style="margin-bottom:6px">SEm = √(MSE/n_i) using pooled MSE.</div>${meanDetail}<div style="height:10px"></div><h4>Table 4. Fisher LSD (CD) for pairwise mean differences</h4><div class="muted small" style="margin-bottom:6px">LSDα = tα/2,df(error) × √(MSE × (1/ni + 1/nj)).</div>${buildTable(["Contrast", "LSD (5%)", "LSD (1%)"], lsdRows)}<div style="height:10px"></div><h4>Table 5. Mean and genetic summary (harmonic mean n if unbalanced)</h4>${summaryCRD}<div style="height:10px"></div><h4>Table 6. PCV/GCV/ECV matrix</h4>${matrixCRD}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 7. Assumption checklist", [
        { assumption: "Random allocation to treatments", status: "Required", note: "Prevents systematic treatment bias." },
        { assumption: "Independent residuals", status: "Assumed", note: "Serial/spatial trends affect precision." },
        { assumption: "Homogeneity of variance", status: lev.pTreat >= 0.05 ? "Levene: not rejected (approx.)" : "Levene: flagged", note: `F=${lev.fStat.toFixed(4)}, p≈${pfmt(lev.pTreat)}.` },
        { assumption: "Residual normality", status: "Assumed", note: "Important for strict parametric inference." },
      ])}`;

      // Interpretation + deviation
      const deviationHtml = deviationBanner(
        "crd",
        { fStat: out.fStat },
        ["fStat"]
      );

      const sorted = [...out.means].sort((a, b) => b.mean - a.mean);
      const best = sorted[0];
      const runnerUp = sorted[1];
      const interpretation =
        `One-way CRD: variation is split between treatments and pooled within-group (experimental) error only.\n` +
        `F = ${out.fStat.toFixed(4)} (df₁=${out.dfTreat}, df₂=${out.dfError}), p ≈ ${pfmt(out.pTreat)}; ${out.sig.note}.\n` +
        `${out.balanced ? "Balanced replication." : "Unbalanced replication — treatment SS uses Type III (marginal) SS for the factor."}\n\n` +
        `Levene test: F = ${lev.fStat.toFixed(4)}, p ≈ ${pfmt(lev.pTreat)} (${lev.pTreat >= 0.05 ? "homogeneity of variance not rejected at 5% (approx.)" : "consider variance-stabilizing transforms or robust methods"}).\n\n` +
        `Ranking by mean: ${best.treatment} (${best.mean.toFixed(3)})` +
        (runnerUp ? `; next ${runnerUp.treatment} (${runnerUp.mean.toFixed(3)}).` : ".") +
        `\n\n` +
        `Pairwise comparisons: use Table 4 (Fisher LSD). Genetic summary uses harmonic mean n = ${nHarm.toFixed(2)} when replications differ.\n\n` +
        `p-values use F/t via jStat when available; otherwise they may read as 1.0 — verify with external software for publication.`;

      setInterpretation(
        "crd",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fStat: out.fStat, msError: out.msError, ssTreat: out.ssTreat, ssError: out.ssError }
      );
      setRunMeta("crd", {
        forceRun: isForceRunEnabled(),
        inputSize: `t=${t}, n=${JSON.stringify(out.ns)}`,
        standardization: "none",
        preprocessing: out.balanced ? "Balanced CRD." : "Unbalanced CRD; Type III treatment SS.",
        qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsCRD.map((x) => x.pass ? 100 : 45)))))} / 100`,
      });
    });
  }

  // --- RBD ---
  function renderRBD() {
    const title = "RBD (Randomized Block Design) - ANOVA";
    showContentHeader({
      title,
      subtitle:
        "Partition SS into treatments, replication (blocks), and experimental error; F-test vs tabulated critical values (5% & 1%); CV%, SEm, CD/LSD; bar plot of means with ±SEm.",
    });

    const defaultT = 4;
    const defaultB = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">One-way RBD</div></div>
        <div class="kpi"><div class="label">Blocking</div><div class="value">Field/environment gradient control</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">ANOVA + F + CV / SEm / CD</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="muted small" style="margin-bottom:8px">Rows = treatments, columns = blocks (replications). Total SS is partitioned into <strong>Treatments</strong>, <strong>Replication (blocks)</strong>, and <strong>Experimental error</strong>.</div>
            <div class="bkq-data-upload-panel">
              <div class="bkq-data-upload-panel__title">Upload data</div>
              <div class="muted small" style="margin-bottom:10px">
                <strong>CSV / Excel:</strong> optional first column for treatment IDs; other columns = <strong>blocks</strong> (replicates). Or all-numeric rows (treatments × blocks). First Excel sheet only.
              </div>
              <div class="actions">
                <button class="action-btn primary2" type="button" id="rbdImportCsv">Import CSV / Excel</button>
              </div>
              <input type="file" id="rbdCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div class="input-grid" id="rbdControls">
              <div class="two-col">
                <label>
                  Treatments (T)
                  <input type="number" min="2" id="rbdT" value="${defaultT}" />
                </label>
                <label>
                  Blocks (B)
                  <input type="number" min="2" id="rbdB" value="${defaultB}" />
                </label>
              </div>
              <button class="action-btn primary2" type="button" id="rbdBuild">Build grid</button>
              <div class="note" style="margin:0">
                Tip: if blocks reduce error, treatment F becomes clearer.
              </div>
            </div>
            <div id="rbdGridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="rbdCompute">Compute RBD</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="rbdResultTop"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="rbdBar" style="width:100%;height:100%"></canvas>
            </div>
            <div class="chart" style="height:210px;margin-top:12px">
              <canvas id="rbdResidualPlot" style="width:100%;height:100%"></canvas>
            </div>
            <div id="rbdTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "rbd",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fTreat"],
    });

    function buildGrid(t, b) {
      const wrap = $("#rbdGridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";

      const headers = ["Treatment/Block"];
      for (let j = 0; j < b; j++) headers.push(`B${j + 1}`);
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;

      const tbodyRows = [];
      for (let i = 0; i < t; i++) {
        const rowCells = [];
        for (let j = 0; j < b; j++) {
          // create block effect + treatment effect
          const treatmentEffect = (i + 1) * 8.2;
          const blockEffect = (j + 1) * (j === 0 ? -1.4 : j === 1 ? 0.3 : 1.9);
          const noise = (i * 0.4 + j * 0.2) + (i === 1 ? 1.2 : 0);
          const val = treatmentEffect + blockEffect + noise;
          rowCells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-cell="t${i}b${j}" /></td>`);
        }
        tbodyRows.push(`<tr><th>${qs(`T${i + 1}`)}</th>${rowCells.join("")}</tr>`);
      }

      table.insertAdjacentHTML("beforeend", `<tbody>${tbodyRows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildGrid(defaultT, defaultB);

    $("#rbdBuild").addEventListener("click", () => {
      const t = Math.max(2, Number($("#rbdT").value || defaultT));
      const b = Math.max(2, Number($("#rbdB").value || defaultB));
      buildGrid(t, b);
    });

    bindCsvExcelFileImport("rbdImportCsv", "rbdCsvFile", (txt) => {
      const parsed = parseRectDataGridCsv(txt);
      if (!parsed || parsed.t < 2 || parsed.r < 2) {
        alert("Could not parse grid: need at least 2 treatment rows and 2 block columns. Optional label column on the left.");
        return;
      }
      $("#rbdT").value = String(parsed.t);
      $("#rbdB").value = String(parsed.r);
      buildGrid(parsed.t, parsed.r);
      for (let i = 0; i < parsed.t; i++) {
        for (let j = 0; j < parsed.r; j++) {
          const inp = document.querySelector(`#rbdGridWrap input[data-cell="t${i}b${j}"]`);
          if (inp) inp.value = String(parsed.matrix[i][j]);
        }
      }
    });

    $("#rbdCompute").addEventListener("click", () => {
      const t = Math.max(2, Number($("#rbdT").value || defaultT));
      const b = Math.max(2, Number($("#rbdB").value || defaultB));
      clearValidation("#rbdGridWrap");
      const errors = [];
      const matrix = [];
      for (let i = 0; i < t; i++) {
        const row = [];
        for (let j = 0; j < b; j++) {
          const input = document.querySelector(`#rbdGridWrap input[data-cell="t${i}b${j}"]`);
          const v = Number(input?.value ?? NaN);
          if (!Number.isFinite(v)) {
            errors.push(`RBD: invalid numeric value at T${i + 1}, B${j + 1}`);
            markInvalidInput(input, "Enter a valid numeric value");
          }
          row.push(Number.isFinite(v) ? v : 0);
        }
        matrix.push(row);
      }
      if (shouldBlockForValidation("rbd", errors, "#rbdResultTop")) return;

      const out = rbdAnova(matrix, b, t);
      const N = t * b;
      const grandMean = matrix.flat().reduce((a, v) => a + v, 0) / N;
      const blockMeans = [];
      for (let j = 0; j < b; j++) {
        let s = 0;
        for (let i = 0; i < t; i++) s += matrix[i][j];
        blockMeans.push(s / t);
      }
      const rbdResiduals = [];
      for (let i = 0; i < t; i++) {
        for (let j = 0; j < b; j++) {
          rbdResiduals.push(matrix[i][j] - out.means[i].mean - blockMeans[j] + grandMean);
        }
      }
      const rbdDiag = residualSummary(rbdResiduals);
      const rbdOut = outlierFlags(matrix.flat());

      const fTreatP = fPValueUpperTail(out.fTreat, out.dfTreat, out.dfError);
      const fCrit5 = fCriticalUpperTail(0.05, out.dfTreat, out.dfError);
      const fCrit1 = fCriticalUpperTail(0.01, out.dfTreat, out.dfError);
      const sigTreat5 = out.fTreat > fCrit5;
      const sigTreat1 = out.fTreat > fCrit1;

      $("#rbdResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (Treatments)</div><div class="value">${out.fTreat.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">p-value (upper tail)</div><div class="value">${fTreatP < 1e-4 ? "<0.0001" : fTreatP.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F crit (5% / 1%)</div><div class="value">${fCrit5.toFixed(3)} / ${fCrit1.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Significant?</div><div class="value">${sigTreat1 ? "Yes @1%" : sigTreat5 ? "Yes @5%" : "No @5%"}</div></div>
        </div>
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr));margin-top:8px">
          <div class="kpi"><div class="label">df Treat / Block / Error</div><div class="value">${out.dfTreat}, ${out.dfBlock}, ${out.dfError}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${out.msError.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Approx. sig. (legacy)</div><div class="value">${qs(out.sig.note)}</div></div>
          <div class="kpi"><div class="label">Residual RMSE</div><div class="value">${rbdDiag.rmse.toFixed(4)}</div></div>
        </div>
      `;

      const labels = out.means.map((m) => m.treatment);
      const values = out.means.map((m) => m.mean);
      const overallMeanRBD = mean(values);
      const statsRBD = computeBreedingSummaryStats({
        meanValue: overallMeanRBD,
        msGenotype: out.msTreat,
        msError: out.msError,
        replications: b,
        dfError: out.dfError,
      });
      const semEach = values.map(() => statsRBD.sem);
      drawBarChartWithErrorBars($("#rbdBar"), labels, values, semEach, {
        title: "Treatment means with ± SEm error bars",
      });
      drawResidualMiniPlot($("#rbdResidualPlot"), rbdResiduals, "RBD residuals (additive model)");

      const headers = ["Source", "SS", "df", "MS", "F", "Sig. (approx.)"];
      const anovaRows = [
        ["Treatments", out.ssTreat, out.dfTreat, out.msTreat, out.fTreat, out.sig.note],
        ["Replication (blocks)", out.ssBlock, out.dfBlock, out.msBlock, out.fBlock, out.sigBlock.note],
        ["Experimental error", out.ssError, out.dfError, out.msError, "", ""],
        ["Total", out.ssTotal, out.dfTreat + out.dfBlock + out.dfError, "", "", ""],
      ];
      const fTestRows = [
        ["Treatments", out.dfTreat, out.dfError, out.fTreat, fCrit5, fCrit1, fTreatP, sigTreat5 ? "Yes" : "No", sigTreat1 ? "Yes" : "No"],
      ];
      const summaryRBD = buildTable(
        ["Summary metric", "Value"],
        [
          ["Grand mean", overallMeanRBD],
          ["CV (%)", statsRBD.cv],
          ["SEm (±)", statsRBD.sem],
          ["SEd (standard error of difference)", statsRBD.sed],
          ["CD / LSD (5%)", statsRBD.cd5],
          ["CD / LSD (1%)", statsRBD.cd1],
          ["H2 (broad sense, %)", statsRBD.h2],
          ["GA", statsRBD.ga],
          ["GA (% of mean)", statsRBD.gaPct],
          ["PCV (%)", statsRBD.pcv],
          ["GCV (%)", statsRBD.gcv],
          ["ECV (%)", statsRBD.ecv],
        ]
      );
      const matrixRBD = buildTable(
        ["Component", "Variance", "Coefficient (%)"],
        [
          ["Genotypic (sigma^2g)", statsRBD.sigmaG, statsRBD.gcv],
          ["Environmental (sigma^2e)", statsRBD.sigmaE, statsRBD.ecv],
          ["Phenotypic (sigma^2p)", statsRBD.sigmaP, statsRBD.pcv],
        ]
      );
      const qItemsRBD = [
        { check: "Valid numeric inputs", pass: errors.length === 0, note: errors.length ? "Some values were invalid." : "All numeric cells valid." },
        { check: "Outlier load (IQR)", pass: rbdOut.count <= Math.max(1, Math.floor(matrix.flat().length * 0.1)), note: `${rbdOut.count} flagged observation(s).` },
        { check: "Residual spread", pass: Number.isFinite(rbdDiag.rmse) && rbdDiag.rmse < Math.max(1e-9, Math.abs(mean(matrix.flat())) * 0.5), note: `RMSE=${rbdDiag.rmse.toFixed(4)}` },
      ];
      if (strictModeShouldBlock("rbd", qItemsRBD, "#rbdResultTop")) return;
      $("#rbdTableWrap").innerHTML = `${qualityScoreHtml(qItemsRBD)}<div style="height:10px"></div><h4>Table 1. ANOVA — partitioned variance</h4>${buildTable(headers, anovaRows      )}<div style="height:10px"></div><h4>Table 2. F-test for treatments (vs F distribution at 5% and 1%)</h4>${buildTable(
        ["Source", "df (num)", "df (den)", "F observed", "F crit (α=0.05)", "F crit (α=0.01)", "p-value (upper tail)", "Significant @5%?", "Significant @1%?"],
        fTestRows
      )}<div style="height:10px"></div><h4>Table 3. Mean comparisons (CV%, SEm, CD/LSD)</h4>${summaryRBD}<div style="height:10px"></div><h4>Table 4. PCV/GCV/ECV matrix</h4>${matrixRBD}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 5. Assumption checklist", [
        { assumption: "Randomization within blocks", status: "Required", note: "Essential for unbiased treatment comparison." },
        { assumption: "Homogeneous residual variance", status: "Assumed", note: "Large heterogeneity affects F tests." },
        { assumption: "Independent errors", status: "Assumed", note: "Spatial dependence can bias standard errors." },
        { assumption: "Residual normality", status: "Assumed", note: "Check diagnostics for strict inference." }
      ])}`;

      const deviationHtml = deviationBanner(
        "rbd",
        { fTreat: out.fTreat },
        ["fTreat"]
      );

      const sorted = [...out.means].sort((a, b) => b.mean - a.mean);
      const best = sorted[0];
      const runnerUp = sorted[1];
      const interpretation =
        `RBD ANOVA partitions total SS into treatments, replication (blocks), and experimental error.\n` +
        `Treatment test: F = ${out.fTreat.toFixed(4)} on df₁=${out.dfTreat}, df₂=${out.dfError}; ` +
        `upper-tail p ≈ ${fTreatP < 1e-4 ? "<0.0001" : fTreatP.toFixed(4)}. ` +
        `Critical values: F (5%) = ${fCrit5.toFixed(3)}, F (1%) = ${fCrit1.toFixed(3)} → ` +
        `${sigTreat1 ? "significant at 1%" : sigTreat5 ? "significant at 5% only" : "not significant at 5%"}.\n\n` +
        `Mean precision: CV% = ${statsRBD.cv.toFixed(2)}%, SEm = ${statsRBD.sem.toFixed(4)}, ` +
        `CD (LSD) at 5% = ${statsRBD.cd5.toFixed(4)}, at 1% = ${statsRBD.cd1.toFixed(4)} (based on SEd and t on df(error)).\n\n` +
        `Highest mean: ${best.treatment} (${best.mean.toFixed(3)})` +
        (runnerUp ? `; second: ${runnerUp.treatment} (${runnerUp.mean.toFixed(3)}).` : ".") +
        `\n\n` +
        `H² = ${statsRBD.h2.toFixed(2)}%, PCV/GCV/ECV = ${statsRBD.pcv.toFixed(2)} / ${statsRBD.gcv.toFixed(2)} / ${statsRBD.ecv.toFixed(2)}%.\n` +
        `Bar chart error bars show ±1 SEm per treatment mean.`;

      setInterpretation(
        "rbd",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fTreat: out.fTreat, msError: out.msError, ssTreat: out.ssTreat, ssBlock: out.ssBlock }
      );
      setRunMeta("rbd", { forceRun: isForceRunEnabled(), inputSize: `t=${t}, b=${b}`, standardization: "none", preprocessing: "No truncation; balanced matrix interpreted directly.", qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsRBD.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });
  }

  /** Fisher's LSD / CD for comparing two equal-n means: t(dfError) * sqrt(2*MSE/n), where n = observations per mean. */
  function lsdTwoMeans(mse, dfError, nPerMean, alphaTwoTail) {
    if (dfError <= 0 || nPerMean <= 0) return { t: NaN, sed: NaN, cd: NaN };
    const t = studentTInvTwoTail(dfError, alphaTwoTail);
    const sed = Math.sqrt((2 * mse) / nPerMean);
    return { t, sed, cd: t * sed };
  }

  /**
   * Simple effects of Factor A at each level of B (balanced factorial RBD).
   * SS(A|B_j) = r * Σ_i (ȳ_ij − ȳ_.j)² with ȳ_.j = mean of cell means at B_j; F = MS / MSE from full model.
   */
  function factorialSimpleEffectsAatB(T_ij, a, b, r, msError, dfError) {
    const rows = [];
    for (let j = 0; j < b; j++) {
      const cellMeans = [];
      for (let i = 0; i < a; i++) cellMeans.push(T_ij[i][j] / r);
      const ybarDotJ = cellMeans.reduce((s, m) => s + m, 0) / a;
      let ss = 0;
      for (let i = 0; i < a; i++) ss += r * (cellMeans[i] - ybarDotJ) ** 2;
      const df = a - 1;
      const ms = df > 0 ? ss / df : 0;
      const f = msError > 0 ? ms / msError : 0;
      const p = fPValueUpperTail(f, df, dfError);
      rows.push({ j, cellMeans, ybarDotJ, ss, df, ms, f, p });
    }
    return rows;
  }

  /** Linear interpolation for Tukey q table lookup. */
  function _interp1dLin(x, xs, ys) {
    if (!xs.length) return NaN;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = 0;
    while (i < xs.length - 1 && xs[i + 1] < x) i++;
    const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
    return ys[i] * (1 - t) + ys[i + 1] * t;
  }

  /**
   * Studentized range q for Tukey HSD at α ≈ 0.05 (balanced ANOVA).
   * Bilinear interpolation on standard tables (Montgomery-style); k = number of means, df = error df.
   */
  function qTukeyStudentizedRange05(kMeans, dfError) {
    const df = Math.max(2, dfError);
    const kRaw = Math.max(2, Number(kMeans));
    const kGrid = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
    const dfGrid = [5, 10, 20, 60, 120, 1000000];
    /** Rows = error df index; columns = k (number of means). */
    const Q = [
      [3.64, 4.6, 5.22, 5.67, 6.03, 6.63, 7.12, 7.59, 7.91, 8.21],
      [3.15, 3.88, 4.33, 4.65, 4.91, 5.27, 5.56, 5.84, 6.08, 6.28],
      [2.95, 3.58, 3.96, 4.23, 4.45, 4.8, 5.08, 5.33, 5.54, 5.74],
      [2.83, 3.4, 3.74, 3.98, 4.16, 4.44, 4.68, 4.89, 5.08, 5.25],
      [2.8, 3.36, 3.68, 3.92, 4.1, 4.37, 4.6, 4.81, 4.99, 5.16],
      [2.77, 3.31, 3.63, 3.86, 4.03, 4.28, 4.5, 4.69, 4.86, 5.02],
    ];
    function qAtK(k) {
      let k0 = 0;
      while (k0 < kGrid.length - 1 && kGrid[k0 + 1] < k) k0++;
      const kLo = kGrid[k0];
      const kHi = kGrid[Math.min(k0 + 1, kGrid.length - 1)];
      const colLo = Math.min(k0, Q[0].length - 1);
      const colHi = Math.min(k0 + 1, Q[0].length - 1);
      const qAtCol = (col) => {
        const colVals = Q.map((row) => row[col]);
        return _interp1dLin(df, dfGrid, colVals);
      };
      if (kLo === kHi || colLo === colHi) return qAtCol(colLo);
      const qL = qAtCol(colLo);
      const qH = qAtCol(colHi);
      const tk = (k - kLo) / (kHi - kLo);
      return qL * (1 - tk) + qH * tk;
    }
    if (kRaw <= 20) return qAtK(kRaw);
    const q20 = qAtK(20);
    const q15 = qAtK(15);
    return q20 + ((q20 - q15) / 5) * (kRaw - 20);
  }

  /** Tukey HSD for comparing all pairs among k means, each based on n independent observations (balanced). */
  function tukeyHsd(mse, dfError, nPerMean, kMeans) {
    const q = qTukeyStudentizedRange05(kMeans, dfError);
    if (!Number.isFinite(q) || !Number.isFinite(mse) || mse <= 0 || nPerMean <= 0) return { q: NaN, hsd: NaN };
    return { q, hsd: q * Math.sqrt(mse / nPerMean) };
  }

  function pctOfTotal(ss, ssTot) {
    return ssTot > 1e-15 ? (100 * ss) / ssTot : 0;
  }

  /**
   * Balanced A×B×C factorial in RBD: matrix rows = lexicographic (A,B,C) combinations, cols = blocks (r).
   * Returns SS partition, F-tests, cell totals T[i][j][k], and marginal means for tables.
   */
  function threeWayFactorialRbdAnova(matrix, a, b, c, r) {
    const T = Array.from({ length: a }, () => Array.from({ length: b }, () => Array(c).fill(0)));
    let p = 0;
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < b; j++) {
        for (let k = 0; k < c; k++) {
          let s = 0;
          for (let rep = 0; rep < r; rep++) s += matrix[p][rep];
          T[i][j][k] = s;
          p++;
        }
      }
    }
    const N = a * b * c * r;
    let sumY2 = 0;
    let grandTotal = 0;
    for (let ii = 0; ii < a * b * c; ii++) for (let rep = 0; rep < r; rep++) {
      const v = matrix[ii][rep];
      sumY2 += v * v;
      grandTotal += v;
    }
    const CF = (grandTotal * grandTotal) / N;
    const ssTotal = sumY2 - CF;

    const Block_totals = Array(r).fill(0);
    p = 0;
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < b; j++) {
        for (let k = 0; k < c; k++) {
          for (let rep = 0; rep < r; rep++) Block_totals[rep] += matrix[p][rep];
          p++;
        }
      }
    }
    let ssBlock = 0;
    for (let rep = 0; rep < r; rep++) ssBlock += (Block_totals[rep] * Block_totals[rep]) / (a * b * c);
    ssBlock -= CF;

    let ssTreat = 0;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = 0; k < c; k++) ssTreat += (T[i][j][k] * T[i][j][k]) / r;
    ssTreat -= CF;

    const A_tot = Array(a).fill(0);
    const B_tot = Array(b).fill(0);
    const C_tot = Array(c).fill(0);
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = 0; k < c; k++) {
      const v = T[i][j][k];
      A_tot[i] += v;
      B_tot[j] += v;
      C_tot[k] += v;
    }

    let ssA = 0;
    for (let i = 0; i < a; i++) ssA += (A_tot[i] * A_tot[i]) / (b * c * r);
    ssA -= CF;
    let ssB = 0;
    for (let j = 0; j < b; j++) ssB += (B_tot[j] * B_tot[j]) / (a * c * r);
    ssB -= CF;
    let ssC = 0;
    for (let k = 0; k < c; k++) ssC += (C_tot[k] * C_tot[k]) / (a * b * r);
    ssC -= CF;

    const AB = Array.from({ length: a }, () => Array(b).fill(0));
    const AC = Array.from({ length: a }, () => Array(c).fill(0));
    const BC = Array.from({ length: b }, () => Array(c).fill(0));
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = 0; k < c; k++) {
      const v = T[i][j][k];
      AB[i][j] += v;
      AC[i][k] += v;
      BC[j][k] += v;
    }

    let ssABsub = 0;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) ssABsub += (AB[i][j] * AB[i][j]) / (c * r);
    ssABsub -= CF;
    let ssACsub = 0;
    for (let i = 0; i < a; i++) for (let k = 0; k < c; k++) ssACsub += (AC[i][k] * AC[i][k]) / (b * r);
    ssACsub -= CF;
    let ssBCsub = 0;
    for (let j = 0; j < b; j++) for (let k = 0; k < c; k++) ssBCsub += (BC[j][k] * BC[j][k]) / (a * r);
    ssBCsub -= CF;

    const ssAB = ssABsub - ssA - ssB;
    const ssAC = ssACsub - ssA - ssC;
    const ssBC = ssBCsub - ssB - ssC;
    let ssABC = ssTreat - ssA - ssB - ssC - ssAB - ssAC - ssBC;
    if (ssABC < 0 && ssABC > -1e-8) ssABC = 0;

    const ssError = ssTotal - ssBlock - ssTreat;
    const dfBlock = r - 1;
    const dfA = a - 1;
    const dfB = b - 1;
    const dfC = c - 1;
    const dfAB = (a - 1) * (b - 1);
    const dfAC = (a - 1) * (c - 1);
    const dfBC = (b - 1) * (c - 1);
    const dfABC = (a - 1) * (b - 1) * (c - 1);
    const dfTreat = a * b * c - 1;
    const dfError = (a * b * c - 1) * (r - 1);
    const dfTotal = N - 1;

    const msBlock = ssBlock / dfBlock;
    const msA = ssA / dfA;
    const msB = ssB / dfB;
    const msC = ssC / dfC;
    const msAB = ssAB / dfAB;
    const msAC = ssAC / dfAC;
    const msBC = ssBC / dfBC;
    const msABC = ssABC / dfABC;
    const msError = ssError / dfError;

    const fBlock = msError > 0 ? msBlock / msError : 0;
    const fA = msError > 0 ? msA / msError : 0;
    const fB = msError > 0 ? msB / msError : 0;
    const fC = msError > 0 ? msC / msError : 0;
    const fAB = msError > 0 ? msAB / msError : 0;
    const fAC = msError > 0 ? msAC / msError : 0;
    const fBC = msError > 0 ? msBC / msError : 0;
    const fABC = msError > 0 ? msABC / msError : 0;

    const pBlock = fPValueUpperTail(fBlock, dfBlock, dfError);
    const pA = fPValueUpperTail(fA, dfA, dfError);
    const pB = fPValueUpperTail(fB, dfB, dfError);
    const pC = fPValueUpperTail(fC, dfC, dfError);
    const pAB = fPValueUpperTail(fAB, dfAB, dfError);
    const pAC = fPValueUpperTail(fAC, dfAC, dfError);
    const pBC = fPValueUpperTail(fBC, dfBC, dfError);
    const pABC = fPValueUpperTail(fABC, dfABC, dfError);

    return {
      ssTotal,
      ssBlock,
      ssTreat,
      ssA,
      ssB,
      ssC,
      ssAB,
      ssAC,
      ssBC,
      ssABC,
      ssError,
      dfBlock,
      dfA,
      dfB,
      dfC,
      dfAB,
      dfAC,
      dfBC,
      dfABC,
      dfError,
      dfTotal,
      msBlock,
      msA,
      msB,
      msC,
      msAB,
      msAC,
      msBC,
      msABC,
      msError,
      fBlock,
      fA,
      fB,
      fC,
      fAB,
      fAC,
      fBC,
      fABC,
      pBlock,
      pA,
      pB,
      pC,
      pAB,
      pAC,
      pBC,
      pABC,
      T,
      AB,
      AC,
      BC,
      A_tot,
      B_tot,
      C_tot,
    };
  }

  // --- Factorial RBD (A×B in blocks) ---
  function renderFactorial() {
    const title = "Factorial RBD (Two-way A×B) - ANOVA";
    showContentHeader({
      title,
      subtitle:
        "Partition SS into replications, A, B, A×B, and error; F-tests; CD for main effects and for A×B cells; simple effects of A within each B when interaction is significant.",
    });

    const defaultA = 2;
    const defaultB = 2;
    const defaultR = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">RBD with factorial treatment structure</div></div>
        <div class="kpi"><div class="label">Factors</div><div class="value">Factor A (a levels), Factor B (b levels)</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">A, B, A×B, Blocks ANOVA</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="muted small" style="margin-bottom:8px">
              Enter values by treatment combination (A level × B level) and block (R1..R<small>r</small>).
            </div>
            <div class="input-grid" id="factControls">
              <div class="two-col">
                <label>
                  Levels of Factor A (a)
                  <input type="number" min="2" id="factA" value="${defaultA}" />
                </label>
                <label>
                  Levels of Factor B (b)
                  <input type="number" min="2" id="factB" value="${defaultB}" />
                </label>
              </div>
              <label>
                Blocks / Replications (r)
                <input type="number" min="2" id="factR" value="${defaultR}" />
              </label>
              <button class="action-btn primary2" type="button" id="factBuild">Build grid</button>
              <div class="note" style="margin:0">
                Layout: each row is a treatment combination (A<sub>i</sub>B<sub>j</sub>), columns are blocks (R1..Rr).
              </div>
              <div class="muted small" style="margin-top:8px">
                <strong>Import CSV / Excel:</strong> set <strong>a</strong>, <strong>b</strong>, <strong>r</strong> and click <strong>Build grid</strong> first. File = <strong>a×b</strong> rows (same order as the table: A₁B₁ … AₐB_b) and <strong>r</strong> numeric columns; optional label column before R1…Rr.
              </div>
              <button class="action-btn" type="button" id="factImportCsv">Import CSV / Excel</button>
              <input type="file" id="factCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div id="factGridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="factCompute">Compute factorial RBD</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="factResultTop"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="factBar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="factTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "factorial",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fA", "fB", "fAB"],
    });

    function buildGrid(a, b, r) {
      const wrap = $("#factGridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";

      const headers = ["Combination / Block"];
      for (let k = 0; k < r; k++) headers.push(`R${k + 1}`);
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;

      const tbodyRows = [];
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          const comb = `A${i + 1}B${j + 1}`;
          const cells = [];
          for (let k = 0; k < r; k++) {
            const base = (i + 1) * 10 + (j + 1) * 4;
            const blockEff = (k + 1) * (k === 0 ? -0.5 : k === 1 ? 0.2 : 1.0);
            const noise = (i * 0.7 + j * 0.4 + k * 0.3);
            const val = base + blockEff + noise;
            cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-cell="a${i}b${j}r${k}" /></td>`);
          }
          tbodyRows.push(`<tr><th>${qs(comb)}</th>${cells.join("")}</tr>`);
        }
      }

      table.insertAdjacentHTML("beforeend", `<tbody>${tbodyRows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildGrid(defaultA, defaultB, defaultR);

    $("#factBuild").addEventListener("click", () => {
      const a = Math.max(2, Number($("#factA").value || defaultA));
      const b = Math.max(2, Number($("#factB").value || defaultB));
      const r = Math.max(2, Number($("#factR").value || defaultR));
      buildGrid(a, b, r);
    });

    bindCsvExcelFileImport("factImportCsv", "factCsvFile", (txt) => {
      const parsed = parseRectDataGridCsv(txt);
      const a = Math.max(2, Number($("#factA").value || defaultA));
      const b = Math.max(2, Number($("#factB").value || defaultB));
      const r = Math.max(2, Number($("#factR").value || defaultR));
      if (!parsed || parsed.t !== a * b || parsed.r !== r) {
        alert(`Grid shape mismatch: file has ${parsed ? `${parsed.t} rows × ${parsed.r} cols` : "invalid data"} but current design needs ${a * b} rows × ${r} cols. Set a, b, r and Build grid first.`);
        return;
      }
      for (let idx = 0; idx < a * b; idx++) {
        const i = Math.floor(idx / b);
        const j = idx % b;
        for (let k = 0; k < r; k++) {
          const inp = document.querySelector(`#factGridWrap input[data-cell="a${i}b${j}r${k}"]`);
          if (inp) inp.value = String(parsed.matrix[idx][k]);
        }
      }
    });

    $("#factCompute").addEventListener("click", () => {
      const a = Math.max(2, Number($("#factA").value || defaultA));
      const b = Math.max(2, Number($("#factB").value || defaultB));
      const r = Math.max(2, Number($("#factR").value || defaultR));
      clearValidation("#factGridWrap");
      const errors = [];

      // Collect data: y[i][j][k]
      const y = [];
      for (let i = 0; i < a; i++) {
        y[i] = [];
        for (let j = 0; j < b; j++) {
          y[i][j] = [];
          for (let k = 0; k < r; k++) {
            const input = document.querySelector(`#factGridWrap input[data-cell="a${i}b${j}r${k}"]`);
            const v = Number(input?.value ?? NaN);
            if (!Number.isFinite(v)) {
              errors.push(`Factorial: invalid value at A${i + 1}B${j + 1}, R${k + 1}`);
              markInvalidInput(input, "Enter a valid numeric value");
            }
            y[i][j][k] = Number.isFinite(v) ? v : 0;
          }
        }
      }
      if (shouldBlockForValidation("factorial", errors, "#factResultTop")) return;

      const N = a * b * r;
      let sumY2 = 0;
      let grandTotal = 0;
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          for (let k = 0; k < r; k++) {
            const v = y[i][j][k];
            sumY2 += v * v;
            grandTotal += v;
          }
        }
      }
      const CF = (grandTotal * grandTotal) / N;
      const ssTotal = sumY2 - CF;

      // Totals by combination (i,j), by A, by B, and by block (replication)
      const T_ij = [];
      const A_totals = Array(a).fill(0);
      const B_totals = Array(b).fill(0);
      const Block_totals = Array(r).fill(0);

      for (let i = 0; i < a; i++) {
        T_ij[i] = [];
        for (let j = 0; j < b; j++) {
          let combTot = 0;
          for (let k = 0; k < r; k++) {
            const v = y[i][j][k];
            combTot += v;
            Block_totals[k] += v;
          }
          T_ij[i][j] = combTot;
          A_totals[i] += combTot;
          B_totals[j] += combTot;
        }
      }

      // Treatment SS (all A×B combinations)
      let ssTreat = 0;
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          ssTreat += (T_ij[i][j] * T_ij[i][j]) / r;
        }
      }
      ssTreat -= CF;

      // Blocks (replications)
      let ssBlock = 0;
      for (let k = 0; k < r; k++) ssBlock += (Block_totals[k] * Block_totals[k]) / (a * b);
      ssBlock -= CF;

      // Factor A and Factor B
      let ssA = 0;
      for (let i = 0; i < a; i++) ssA += (A_totals[i] * A_totals[i]) / (b * r);
      ssA -= CF;
      let ssB = 0;
      for (let j = 0; j < b; j++) ssB += (B_totals[j] * B_totals[j]) / (a * r);
      ssB -= CF;

      const ssAB = ssTreat - ssA - ssB;
      const ssError = ssTotal - ssTreat - ssBlock;

      const dfA = a - 1;
      const dfB = b - 1;
      const dfAB = (a - 1) * (b - 1);
      const dfBlock = r - 1;
      const dfError = (a * b - 1) * (r - 1);
      const dfTotal = N - 1;

      const msA = ssA / dfA;
      const msB = ssB / dfB;
      const msAB = ssAB / dfAB;
      const msBlock = ssBlock / dfBlock;
      const msError = ssError / dfError;

      const fBlock = msError === 0 ? 0 : msBlock / msError;
      const fA = msError === 0 ? 0 : msA / msError;
      const fB = msError === 0 ? 0 : msB / msError;
      const fAB = msError === 0 ? 0 : msAB / msError;

      const sigA = approxFSignificance(fA, dfA, dfError);
      const sigB = approxFSignificance(fB, dfB, dfError);
      const sigAB = approxFSignificance(fAB, dfAB, dfError);

      const pBlock = fPValueUpperTail(fBlock, dfBlock, dfError);
      const pA = fPValueUpperTail(fA, dfA, dfError);
      const pB = fPValueUpperTail(fB, dfB, dfError);
      const pAB = fPValueUpperTail(fAB, dfAB, dfError);
      const pfmt = (p) => (p < 1e-4 ? "<0.0001" : Number(p).toFixed(4));

      const lsdA5 = lsdTwoMeans(msError, dfError, b * r, 0.05);
      const lsdA1 = lsdTwoMeans(msError, dfError, b * r, 0.01);
      const lsdB5 = lsdTwoMeans(msError, dfError, a * r, 0.05);
      const lsdB1 = lsdTwoMeans(msError, dfError, a * r, 0.01);
      const lsdCell5 = lsdTwoMeans(msError, dfError, r, 0.05);
      const lsdCell1 = lsdTwoMeans(msError, dfError, r, 0.01);

      // Means for each combination
      const comboMeans = [];
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          const meanComb = T_ij[i][j] / r;
          comboMeans.push({ label: `A${i + 1}B${j + 1}`, mean: meanComb });
        }
      }

      const simpleAatB = factorialSimpleEffectsAatB(T_ij, a, b, r, msError, dfError);
      const interactionSig05 = pAB < 0.05;

      let simpleEffectsHtml = "";
      if (interactionSig05) {
        const parts = [];
        for (const row of simpleAatB) {
          const meanRows = row.cellMeans.map((m, ii) => [`A${ii + 1}`, m]);
          parts.push(
            `<div class="muted small" style="margin-top:10px"><strong>Within B${row.j + 1}</strong> — test of A simple effect: F = ${row.f.toFixed(4)} (df num = ${row.df}, df error = ${dfError}), p = ${pfmt(row.p)}. ` +
              `Pairwise comparison of any two A means at this B uses the A×B cell CD (LSD, n = ${r} per mean).</div>` +
              buildTable(["A level", `Mean (B${row.j + 1})`], meanRows)
          );
        }
        simpleEffectsHtml = `<h4>Table 5. Simple effects — Factor A within each level of Factor B</h4>` + parts.join("");
      } else {
        simpleEffectsHtml = `<h4>Table 5. Simple effects (Factor A within B)</h4><div class="note" style="margin-top:6px">A×B interaction is not significant at α = 0.05 (p = ${pfmt(
          pAB
        )}). Simple effects analysis is usually reported only when interaction is significant; values below are available if you still need them.</div>${simpleAatB
          .map((row) => {
            const meanRows = row.cellMeans.map((m, ii) => [`A${ii + 1}`, m]);
            return `<div class="muted small" style="margin-top:8px"><strong>B${row.j + 1}</strong> F = ${row.f.toFixed(4)}, p = ${pfmt(row.p)}</div>${buildTable(
              ["A level", "Mean"],
              meanRows
            )}`;
          })
          .join("")}`;
      }

      $("#factResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (A), p</div><div class="value">${fA.toFixed(4)} / ${pfmt(pA)}</div></div>
          <div class="kpi"><div class="label">F (B), p</div><div class="value">${fB.toFixed(4)} / ${pfmt(pB)}</div></div>
          <div class="kpi"><div class="label">F (A×B), p</div><div class="value">${fAB.toFixed(4)} / ${pfmt(pAB)}</div></div>
          <div class="kpi"><div class="label">MS Error (MSE)</div><div class="value">${msError.toFixed(4)}</div></div>
        </div>
        <div class="kpi-row" style="grid-template-columns:repeat(3, minmax(0,1fr));margin-top:8px">
          <div class="kpi"><div class="label">F (Blocks), p</div><div class="value">${fBlock.toFixed(4)} / ${pfmt(pBlock)}</div></div>
          <div class="kpi"><div class="label">df (error)</div><div class="value">${dfError}</div></div>
          <div class="kpi"><div class="label">A×B @ 5%?</div><div class="value">${interactionSig05 ? "Yes" : "No"}</div></div>
        </div>
      `;

      const labels = comboMeans.map((m) => m.label);
      const values = comboMeans.map((m) => m.mean);
      drawBarChart($("#factBar"), labels, values, { title: "A×B combination means (over blocks)" });

      const headers = ["Source", "SS", "df", "MS", "F", "p-value"];
      const rows = [
        ["Replications (blocks)", ssBlock, dfBlock, msBlock, fBlock, pfmt(pBlock)],
        ["Factor A", ssA, dfA, msA, fA, pfmt(pA)],
        ["Factor B", ssB, dfB, msB, fB, pfmt(pB)],
        ["A × B (interaction)", ssAB, dfAB, msAB, fAB, pfmt(pAB)],
        ["Experimental error", ssError, dfError, msError, "", ""],
        ["Total", ssTotal, dfTotal, "", "", ""],
      ];
      const cdRows = [
        [
          "Main effect A (marginal means)",
          b * r,
          lsdA5.sed,
          lsdA5.cd,
          lsdA1.cd,
          "Compare two A marginal means (averaged over B and blocks).",
        ],
        [
          "Main effect B (marginal means)",
          a * r,
          lsdB5.sed,
          lsdB5.cd,
          lsdB1.cd,
          "Compare two B marginal means (averaged over A and blocks).",
        ],
        [
          "A×B combination (cell means)",
          r,
          lsdCell5.sed,
          lsdCell5.cd,
          lsdCell1.cd,
          "Compare any two cell means (same as pairwise simple comparisons at fixed B when n = r per cell).",
        ],
      ];
      const cdTable = buildTable(
        ["Comparison type", "n per mean", "SEd", "CD (LSD, 5%)", "CD (LSD, 1%)", "Note"],
        cdRows
      );

      const overallMeanFact = mean(comboMeans.map((m) => m.mean));
      const statsFact = computeBreedingSummaryStats({
        meanValue: overallMeanFact,
        msGenotype: msAB + msA + msB,
        msError: msError,
        replications: r,
        dfError,
      });
      const summaryFact = buildTable(
        ["Summary metric", "Value"],
        [
          ["Grand mean", overallMeanFact],
          ["CV (%)", statsFact.cv],
          ["SEm (per obs. cell mean context)", statsFact.sem],
          ["H2 (broad sense, %)", statsFact.h2],
          ["GA", statsFact.ga],
          ["GA (% of mean)", statsFact.gaPct],
          ["PCV (%)", statsFact.pcv],
          ["GCV (%)", statsFact.gcv],
          ["ECV (%)", statsFact.ecv],
        ]
      );
      const matrixFact = buildTable(
        ["Component", "Variance", "Coefficient (%)"],
        [
          ["Genotypic (sigma^2g)", statsFact.sigmaG, statsFact.gcv],
          ["Environmental (sigma^2e)", statsFact.sigmaE, statsFact.ecv],
          ["Phenotypic (sigma^2p)", statsFact.sigmaP, statsFact.pcv],
        ]
      );
      $("#factTableWrap").innerHTML = `<h4>Table 1. ANOVA — partitioned sum of squares (RBD factorial)</h4>${buildTable(headers, rows)}<div style="height:10px"></div><div class="muted small" style="margin-bottom:6px">F-ratios for A, B, A×B, and blocks use the experimental error MS with df = ${dfError}. Approximate sig. (legacy): A ${sigA.note}; B ${sigB.note}; A×B ${sigAB.note}.</div><h4>Table 2. Critical difference (Fisher LSD) for mean comparisons</h4>${cdTable}<div style="height:10px"></div><h4>Table 3. Mean and genetic summary</h4>${summaryFact}<div style="height:10px"></div><h4>Table 4. PCV/GCV/ECV matrix</h4>${matrixFact}<div style="height:10px"></div>${simpleEffectsHtml}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 6. Assumption checklist", [
        { assumption: "Balanced factorial cells", status: "Required", note: "Each A×B cell has r plots." },
        { assumption: "Independent residuals", status: "Assumed", note: "Dependence distorts interaction significance." },
        { assumption: "Variance homogeneity", status: "Assumed", note: "Heterogeneity affects comparison precision." },
        { assumption: "Residual normality", status: "Assumed", note: "Required for strict parametric inference." }
      ])}`;

      const deviationHtml = deviationBanner(
        "factorial",
        { fA, fB, fAB },
        ["fA", "fB", "fAB"]
      );

      const best = [...comboMeans].sort((a, b) => b.mean - a.mean)[0];
      const interpretation =
        `Total SS is partitioned into replications (blocks), Factor A, Factor B, A×B interaction, and experimental error.\n` +
        `F-tests (vs pooled MSE, df=${dfError}): F(A)=${fA.toFixed(4)} (p=${pfmt(pA)}), F(B)=${fB.toFixed(4)} (p=${pfmt(pB)}), F(A×B)=${fAB.toFixed(4)} (p=${pfmt(pAB)}), F(blocks)=${fBlock.toFixed(4)} (p=${pfmt(
          pBlock
        )}).\n\n` +
        `Critical differences (LSD): main-effect A uses n=${b * r} per marginal mean; main-effect B uses n=${a * r}; A×B cells use n=${r}. ` +
        `At 5%: CD_A=${lsdA5.cd.toFixed(4)}, CD_B=${lsdB5.cd.toFixed(4)}, CD_A×B=${lsdCell5.cd.toFixed(4)}.\n\n` +
        (interactionSig05
          ? `A×B is significant at 5%; simple effects of A were tested within each B (Table 5) using the same error MS.\n`
          : `A×B is not significant at 5%; interpret main effects cautiously; Table 5 still lists simple-effect F-tests for reference.\n`) +
        `Highest cell mean: ${best.label} (${best.mean.toFixed(3)}). H²=${statsFact.h2.toFixed(2)}%, PCV/GCV/ECV=${statsFact.pcv.toFixed(2)}/${statsFact.gcv.toFixed(2)}/${statsFact.ecv.toFixed(2)}%.`;

      setInterpretation(
        "factorial",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fA, fB, fAB, msError }
      );
    });
  }

  // --- Three-way factorial A×B×C in RBD ---
  function renderFactorial3() {
    const title = "Factorial RBD (A×B×C) — Three-Factor ANOVA";
    showContentHeader({
      title,
      subtitle:
        "Partition SS into blocks, A, B, C, AB, AC, BC, ABC, and error; % contribution; Tukey HSD; interaction mean tables when significant.",
    });

    const defaultA = 2;
    const defaultB = 2;
    const defaultC = 2;
    const defaultR = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design</div><div class="value">A×B×C in RBD</div></div>
        <div class="kpi"><div class="label">Cells</div><div class="value">a×b×c × r blocks</div></div>
        <div class="kpi"><div class="label">Post-hoc</div><div class="value">Tukey HSD</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="muted small" style="margin-bottom:8px">
              Rows = treatment combinations in order A₁B₁C₁, A₁B₁C₂, …, AₐB_bC_c; columns = replications (blocks). Balanced factorial.
            </div>
            <div class="input-grid" id="fact3Controls">
              <div class="two-col">
                <label>Levels of A (a) <input type="number" min="2" id="fact3A" value="${defaultA}" /></label>
                <label>Levels of B (b) <input type="number" min="2" id="fact3B" value="${defaultB}" /></label>
              </div>
              <label>Levels of C (c) <input type="number" min="2" id="fact3C" value="${defaultC}" /></label>
              <label>Blocks / replications (r) <input type="number" min="2" id="fact3R" value="${defaultR}" /></label>
              <button class="action-btn primary2" type="button" id="fact3Build">Build grid</button>
              <div class="muted small" style="margin-top:8px">
                <strong>Import CSV / Excel:</strong> set <strong>a</strong>, <strong>b</strong>, <strong>c</strong>, <strong>r</strong> and click <strong>Build grid</strong> first. File = <strong>a×b×c</strong> rows (order A₁B₁C₁ … AₐB_bC_c) and <strong>r</strong> numeric columns; optional label column.
              </div>
              <button class="action-btn" type="button" id="fact3ImportCsv">Import CSV / Excel</button>
              <input type="file" id="fact3CsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div id="fact3GridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="fact3Compute">Compute 3-factor ANOVA</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="fact3ResultTop"></div>
            <div class="chart" style="height:240px;margin-top:12px">
              <canvas id="fact3Bar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="fact3TableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "fact3",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fABC"],
    });

    function buildGrid3(a0, b0, c0, r0) {
      const wrap = $("#fact3GridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["A×B×C / Block"];
      for (let k = 0; k < r0; k++) headers.push(`R${k + 1}`);
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < a0; i++) {
        for (let j = 0; j < b0; j++) {
          for (let k = 0; k < c0; k++) {
            const lab = `A${i + 1}B${j + 1}C${k + 1}`;
            const cells = [];
            for (let rep = 0; rep < r0; rep++) {
              const base = (i + 1) * 6 + (j + 1) * 3 + (k + 1) + rep * 0.4;
              cells.push(`<td><input type="number" step="0.01" value="${base.toFixed(2)}" data-cell3="a${i}b${j}c${k}r${rep}" /></td>`);
            }
            rows.push(`<tr><th>${qs(lab)}</th>${cells.join("")}</tr>`);
          }
        }
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildGrid3(defaultA, defaultB, defaultC, defaultR);

    $("#fact3Build").addEventListener("click", () => {
      const a0 = Math.max(2, Number($("#fact3A").value || defaultA));
      const b0 = Math.max(2, Number($("#fact3B").value || defaultB));
      const c0 = Math.max(2, Number($("#fact3C").value || defaultC));
      const r0 = Math.max(2, Number($("#fact3R").value || defaultR));
      buildGrid3(a0, b0, c0, r0);
    });

    bindCsvExcelFileImport("fact3ImportCsv", "fact3CsvFile", (txt) => {
      const parsed = parseRectDataGridCsv(txt);
      const a = Math.max(2, Number($("#fact3A").value || defaultA));
      const b = Math.max(2, Number($("#fact3B").value || defaultB));
      const c = Math.max(2, Number($("#fact3C").value || defaultC));
      const r = Math.max(2, Number($("#fact3R").value || defaultR));
      const cells = a * b * c;
      if (!parsed || parsed.t !== cells || parsed.r !== r) {
        alert(`Grid shape mismatch: file has ${parsed ? `${parsed.t} rows × ${parsed.r} cols` : "invalid data"} but current design needs ${cells} rows × ${r} cols. Set a, b, c, r and Build grid first.`);
        return;
      }
      for (let idx = 0; idx < cells; idx++) {
        const rem = idx % (b * c);
        const i = Math.floor(idx / (b * c));
        const j = Math.floor(rem / c);
        const k = rem % c;
        for (let rep = 0; rep < r; rep++) {
          const inp = document.querySelector(`#fact3GridWrap input[data-cell3="a${i}b${j}c${k}r${rep}"]`);
          if (inp) inp.value = String(parsed.matrix[idx][rep]);
        }
      }
    });

    $("#fact3Compute").addEventListener("click", () => {
      const a = Math.max(2, Number($("#fact3A").value || defaultA));
      const b = Math.max(2, Number($("#fact3B").value || defaultB));
      const c = Math.max(2, Number($("#fact3C").value || defaultC));
      const r = Math.max(2, Number($("#fact3R").value || defaultR));
      clearValidation("#fact3GridWrap");
      const errors = [];
      const matrix = [];
      let p = 0;
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          for (let k = 0; k < c; k++) {
            const row = [];
            for (let rep = 0; rep < r; rep++) {
              const input = document.querySelector(`#fact3GridWrap input[data-cell3="a${i}b${j}c${k}r${rep}"]`);
              const v = Number(input?.value ?? NaN);
              if (!Number.isFinite(v)) {
                errors.push(`3-factor: invalid at A${i + 1}B${j + 1}C${k + 1} R${rep + 1}`);
                markInvalidInput(input, "Numeric value required");
              }
              row.push(Number.isFinite(v) ? v : 0);
            }
            matrix.push(row);
            p++;
          }
        }
      }
      if (shouldBlockForValidation("fact3", errors, "#fact3ResultTop")) return;

      const out = threeWayFactorialRbdAnova(matrix, a, b, c, r);
      const pfmt = (pv) => (pv < 1e-4 ? "<0.0001" : Number(pv).toFixed(4));
      const ssT = out.ssTotal;
      const pct = (ss) => (ssT > 1e-15 ? ((100 * ss) / ssT).toFixed(2) : "0");

      const anovaHeaders = ["Source", "SS", "df", "MS", "F", "p-value", "% of total SS"];
      const anovaRows = [
        ["Replications (blocks)", out.ssBlock, out.dfBlock, out.msBlock, out.fBlock, pfmt(out.pBlock), pct(out.ssBlock)],
        ["Factor A", out.ssA, out.dfA, out.msA, out.fA, pfmt(out.pA), pct(out.ssA)],
        ["Factor B", out.ssB, out.dfB, out.msB, out.fB, pfmt(out.pB), pct(out.ssB)],
        ["Factor C", out.ssC, out.dfC, out.msC, out.fC, pfmt(out.pC), pct(out.ssC)],
        ["A×B", out.ssAB, out.dfAB, out.msAB, out.fAB, pfmt(out.pAB), pct(out.ssAB)],
        ["A×C", out.ssAC, out.dfAC, out.msAC, out.fAC, pfmt(out.pAC), pct(out.ssAC)],
        ["B×C", out.ssBC, out.dfBC, out.msBC, out.fBC, pfmt(out.pBC), pct(out.ssBC)],
        ["A×B×C", out.ssABC, out.dfABC, out.msABC, out.fABC, pfmt(out.pABC), pct(out.ssABC)],
        ["Pooled error", out.ssError, out.dfError, out.msError, "", "", pct(out.ssError)],
        ["Total", out.ssTotal, out.dfTotal, "", "", "", "100.00"],
      ];

      const nA = b * c * r;
      const nB = a * c * r;
      const nC = a * b * r;
      const nAB = c * r;
      const nAC = b * r;
      const nBC = a * r;
      const nABC = r;
      const abc = a * b * c;

      const tukeyA = tukeyHsd(out.msError, out.dfError, nA, a);
      const tukeyB = tukeyHsd(out.msError, out.dfError, nB, b);
      const tukeyC = tukeyHsd(out.msError, out.dfError, nC, c);
      const tukeyAB = tukeyHsd(out.msError, out.dfError, nAB, a * b);
      const tukeyAC = tukeyHsd(out.msError, out.dfError, nAC, a * c);
      const tukeyBC = tukeyHsd(out.msError, out.dfError, nBC, b * c);
      const tukeyABC = tukeyHsd(out.msError, out.dfError, nABC, abc);

      const tukeyRows = [
        ["Marginal A means", a, nA, tukeyA.q, tukeyA.hsd],
        ["Marginal B means", b, nB, tukeyB.q, tukeyB.hsd],
        ["Marginal C means", c, nC, tukeyC.q, tukeyC.hsd],
        ["A×B combination means", a * b, nAB, tukeyAB.q, tukeyAB.hsd],
        ["A×C combination means", a * c, nAC, tukeyAC.q, tukeyAC.hsd],
        ["B×C combination means", b * c, nBC, tukeyBC.q, tukeyBC.hsd],
        ["A×B×C cell means", abc, nABC, tukeyABC.q, tukeyABC.hsd],
      ];

      const sig05 = (p) => p < 0.05;
      let interHtml = "<h4>Table 3. Means for significant interactions (p &lt; 0.05)</h4>";
      let anySig = false;
      if (sig05(out.pAB)) {
        anySig = true;
        const hdr = ["", ...Array.from({ length: b }, (_, j) => `B${j + 1}`)];
        const mrows = [];
        for (let i = 0; i < a; i++) {
          mrows.push([`A${i + 1}`, ...Array.from({ length: b }, (_, j) => (out.AB[i][j] / (c * r)).toFixed(4))]);
        }
        interHtml += `<div class="muted small" style="margin-top:8px">A×B (two-way means, averaged over C and blocks)</div>${buildTable(hdr, mrows)}`;
      }
      if (sig05(out.pAC)) {
        anySig = true;
        const hdr = ["", ...Array.from({ length: c }, (_, k) => `C${k + 1}`)];
        const mrows = [];
        for (let i = 0; i < a; i++) {
          mrows.push([`A${i + 1}`, ...Array.from({ length: c }, (_, k) => (out.AC[i][k] / (b * r)).toFixed(4))]);
        }
        interHtml += `<div class="muted small" style="margin-top:8px">A×C (averaged over B and blocks)</div>${buildTable(hdr, mrows)}`;
      }
      if (sig05(out.pBC)) {
        anySig = true;
        const hdr = ["", ...Array.from({ length: c }, (_, k) => `C${k + 1}`)];
        const mrows = [];
        for (let j = 0; j < b; j++) {
          mrows.push([`B${j + 1}`, ...Array.from({ length: c }, (_, k) => (out.BC[j][k] / (a * r)).toFixed(4))]);
        }
        interHtml += `<div class="muted small" style="margin-top:8px">B×C (averaged over A and blocks)</div>${buildTable(hdr, mrows)}`;
      }
      if (sig05(out.pABC)) {
        anySig = true;
        interHtml += `<div class="muted small" style="margin-top:8px">A×B×C cell means (r = ${r} per cell)</div>`;
        for (let i = 0; i < a; i++) {
          for (let j = 0; j < b; j++) {
            const hdr = ["", ...Array.from({ length: c }, (_, k) => `C${k + 1}`)];
            const mrows = [[`A${i + 1}B${j + 1}`, ...Array.from({ length: c }, (_, k) => (out.T[i][j][k] / r).toFixed(4))]];
            interHtml += buildTable(hdr, mrows);
          }
        }
      }
      if (!anySig) {
        interHtml += `<div class="note">No first- or second-order interaction reached p &lt; 0.05. Main-effect means are still in Table 4 (marginal summaries).</div>`;
      }

      const meanA = out.A_tot.map((t) => t / (b * c * r));
      const meanB = out.B_tot.map((t) => t / (a * c * r));
      const meanC = out.C_tot.map((t) => t / (a * b * r));
      const margHtml =
        `<h4>Table 4. Marginal means (for context)</h4>` +
        `${buildTable(
          ["Level", "Mean A"],
          meanA.map((m, i) => [`A${i + 1}`, m])
        )}<div style="height:8px"></div>${buildTable(
          ["Level", "Mean B"],
          meanB.map((m, j) => [`B${j + 1}`, m])
        )}<div style="height:8px"></div>${buildTable(
          ["Level", "Mean C"],
          meanC.map((m, k) => [`C${k + 1}`, m])
        )}`;

      const combo = [];
      let pi = 0;
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = 0; k < c; k++) {
        combo.push({ label: `A${i + 1}B${j + 1}C${k + 1}`, mean: matrix[pi].reduce((s, v) => s + v, 0) / r });
        pi++;
      }
      const labels = combo.map((x) => x.label);
      const values = combo.map((x) => x.mean);
      drawBarChart($("#fact3Bar"), labels, values, { title: "A×B×C cell means (all combinations)" });

      $("#fact3ResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(3, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (A×B×C)</div><div class="value">${out.fABC.toFixed(3)} / p=${pfmt(out.pABC)}</div></div>
          <div class="kpi"><div class="label">MSE (pooled)</div><div class="value">${out.msError.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">df (error)</div><div class="value">${out.dfError}</div></div>
        </div>
      `;

      $("#fact3TableWrap").innerHTML = `
        <h4>Table 1. ANOVA and % contribution to total SS</h4>
        <div class="muted small" style="margin-bottom:6px">% columns: 100 × SS(source) / SS(total). Error and blocks included.</div>
        ${buildTable(anovaHeaders, anovaRows)}
        <h4 style="margin-top:12px">Table 2. Tukey HSD (α ≈ 0.05, studentized-range interpolation)</h4>
        <div class="muted small" style="margin-bottom:6px">HSD = q × √(MSE/n), where n = observations supporting each mean in that family. Compare any pair: |mean difference| &gt; HSD implies significance at the family-wise level (balanced, standard assumptions). For k &gt; 20 means, q is linearly extrapolated beyond the tabulated k = 20 column (approximate).</div>
        ${buildTable(
          ["Comparison family", "k (means)", "n per mean", "q", "HSD"],
          tukeyRows.map((row) => [
            row[0],
            row[1],
            row[2],
            Number.isFinite(row[3]) ? row[3].toFixed(3) : "—",
            Number.isFinite(row[4]) ? row[4].toFixed(4) : "—",
          ])
        )}
        ${interHtml}
        ${margHtml}
        ${assumptionsChecklistHtml("Assumptions", [
          { assumption: "Balanced design", status: "Required", note: "Equal r for every A×B×C cell." },
          { assumption: "Independent errors", status: "Assumed", note: "Required for F-tests and Tukey." },
          { assumption: "Homogeneity of variance", status: "Assumed", note: "Tukey HSD is approximate if variances differ." },
        ])}
      `;

      const interpretation =
        `Three-factor RBD: total variation is split among blocks, A, B, C, AB, AC, BC, ABC, and pooled error. ` +
        `A×B×C interaction F = ${out.fABC.toFixed(4)} (p = ${pfmt(out.pABC)}). ` +
        `Tukey HSD uses pooled MSE with df = ${out.dfError}. ` +
        `Highest cell mean: ${[...combo].sort((x, y) => y.mean - x.mean)[0].label}.`;

      setInterpretation("fact3", interpretation, "", { fABC: out.fABC, msError: out.msError });
    });

    $("#fact3Compute").click();
  }

  // --- Latin Square (often requested as "Lattice/Latin square") ---
  function renderLatinSquare() {
    const title = "Latin Square Design - ANOVA";
    showContentHeader({
      title,
      subtitle: "Latin square (t×t) controls two nuisance sources (rows & columns). Input grid → ANOVA + treatment means plot.",
    });

    const defaultT = 4; // 4×4

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">Latin Square</div></div>
        <div class="kpi"><div class="label">Controls</div><div class="value">Row + Column variation</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">ANOVA + treatment means</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Grid</h4>
            <div class="muted small" style="margin-bottom:8px">
              Each cell has one treatment (fixed Latin square layout) and one response value.
            </div>
            <div class="input-grid" id="lsControls">
              <label>
                Treatments / square size (t)
                <input type="number" min="3" max="10" id="lsT" value="${defaultT}" />
              </label>
              <button class="action-btn primary2" type="button" id="lsBuild">Build square</button>
              <div class="note" style="margin:0">
                Note: In Latin square, each treatment appears exactly once per row and once per column.
              </div>
              <div class="muted small" style="margin-top:8px">
                <strong>Import CSV / Excel:</strong> set <strong>t</strong> and click <strong>Build square</strong> first. File = <strong>t</strong> rows × <strong>t</strong> numeric columns (responses in row/column order); optional row label column.
              </div>
              <button class="action-btn" type="button" id="lsImportCsv">Import CSV / Excel</button>
              <input type="file" id="lsCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div id="lsGridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="lsCompute">Compute Latin Square</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="lsResultTop"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="lsBar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="lsTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "lattice",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fTreat"],
    });

    function latinLayout(t) {
      // simple cyclic latin square: treatment index = (row + col) mod t
      const layout = [];
      for (let i = 0; i < t; i++) {
        layout[i] = [];
        for (let j = 0; j < t; j++) layout[i][j] = (i + j) % t;
      }
      return layout;
    }

    function trtLabel(idx) {
      // T1..Tt (keeps consistent with other modules)
      return `T${idx + 1}`;
    }

    function buildSquare(t) {
      const wrap = $("#lsGridWrap");
      wrap.innerHTML = "";
      const layout = latinLayout(t);

      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Row/Col"];
      for (let j = 0; j < t; j++) headers.push(`C${j + 1}`);
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;

      const rows = [];
      for (let i = 0; i < t; i++) {
        const cells = [];
        for (let j = 0; j < t; j++) {
          const trt = layout[i][j];
          const base = 20 + trt * 2.4;
          const rowEff = (i - (t - 1) / 2) * 0.6;
          const colEff = (j - (t - 1) / 2) * 0.4;
          const val = base + rowEff + colEff + ((i + j) % 2 ? 0.3 : -0.2);
          cells.push(
            `<td>
              <div class="muted small" style="font-weight:900;margin-bottom:4px">${qs(trtLabel(trt))}</div>
              <input type="number" step="0.01" value="${val.toFixed(2)}" data-cell="r${i}c${j}" />
            </td>`
          );
        }
        rows.push(`<tr><th>${qs(`R${i + 1}`)}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildSquare(defaultT);

    $("#lsBuild").addEventListener("click", () => {
      const t = Math.max(3, Math.min(10, Number($("#lsT").value || defaultT)));
      buildSquare(t);
    });

    bindCsvExcelFileImport("lsImportCsv", "lsCsvFile", (txt) => {
      const parsed = parseRectDataGridCsv(txt);
      const t = Math.max(3, Math.min(10, Number($("#lsT").value || defaultT)));
      if (!parsed || parsed.t !== t || parsed.r !== t) {
        alert(`Need a ${t}×${t} numeric grid (same rows as columns). Optional label column. Set t and Build square first.`);
        return;
      }
      for (let i = 0; i < t; i++) {
        for (let j = 0; j < t; j++) {
          const inp = document.querySelector(`#lsGridWrap input[data-cell="r${i}c${j}"]`);
          if (inp) inp.value = String(parsed.matrix[i][j]);
        }
      }
    });

    $("#lsCompute").addEventListener("click", () => {
      const t = Math.max(3, Math.min(10, Number($("#lsT").value || defaultT)));
      const layout = latinLayout(t);

      // collect y, and totals
      const N = t * t;
      let sumY2 = 0;
      let G = 0;
      const rowTotals = Array(t).fill(0);
      const colTotals = Array(t).fill(0);
      const trtTotals = Array(t).fill(0);

      for (let i = 0; i < t; i++) {
        for (let j = 0; j < t; j++) {
          const input = document.querySelector(`#lsGridWrap input[data-cell="r${i}c${j}"]`);
          const v = Number(input?.value ?? NaN);
          const y = Number.isFinite(v) ? v : 0;
          sumY2 += y * y;
          G += y;
          rowTotals[i] += y;
          colTotals[j] += y;
          trtTotals[layout[i][j]] += y;
        }
      }

      const CF = (G * G) / N;
      const ssTotal = sumY2 - CF;
      const ssRow = rowTotals.reduce((a, r) => a + (r * r) / t, 0) - CF;
      const ssCol = colTotals.reduce((a, c) => a + (c * c) / t, 0) - CF;
      const ssTreat = trtTotals.reduce((a, x) => a + (x * x) / t, 0) - CF;
      const ssError = ssTotal - ssRow - ssCol - ssTreat;

      const dfRow = t - 1;
      const dfCol = t - 1;
      const dfTreat = t - 1;
      const dfError = (t - 1) * (t - 2);
      const msTreat = ssTreat / dfTreat;
      const msRow = ssRow / dfRow;
      const msCol = ssCol / dfCol;
      const msError = ssError / dfError;
      const fTreat = msError === 0 ? 0 : msTreat / msError;
      const fRow = msError === 0 ? 0 : msRow / msError;
      const fCol = msError === 0 ? 0 : msCol / msError;
      const sig = approxFSignificance(fTreat, dfTreat, dfError);
      const sigRow = approxFSignificance(fRow, dfRow, dfError);
      const sigCol = approxFSignificance(fCol, dfCol, dfError);

      $("#lsResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (Treat)</div><div class="value">${fTreat.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">df(Treat), df(Error)</div><div class="value">${dfTreat}, ${dfError}</div></div>
          <div class="kpi"><div class="label">Approx. significance</div><div class="value">${qs(sig.level)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${msError.toFixed(4)}</div></div>
        </div>
      `;

      const means = trtTotals.map((tot, idx) => ({ trt: trtLabel(idx), mean: tot / t }));
      drawBarChart($("#lsBar"), means.map((m) => m.trt), means.map((m) => m.mean), { title: "Treatment means (Latin square)" });

      const headers = ["Source", "SS", "df", "MS", "F", "Sig. (approx.)"];
      const rows = [
        ["Rows", ssRow, dfRow, msRow, fRow, sigRow.note],
        ["Columns", ssCol, dfCol, msCol, fCol, sigCol.note],
        ["Treatments", ssTreat, dfTreat, msTreat, fTreat, sig.note],
        ["Error", ssError, dfError, msError, "", ""],
        ["Total", ssTotal, N - 1, "", "", ""],
      ];
      $("#lsTableWrap").innerHTML = `<h4>Table 1. ANOVA summary</h4>${buildTable(headers, rows)}`;

      const deviationHtml = deviationBanner("lattice", { fTreat }, ["fTreat"]);
      const best = [...means].sort((a, b) => b.mean - a.mean)[0];
      const interpretation =
        `Latin square ANOVA tests treatment differences while controlling two nuisance sources: rows and columns.\n` +
        `Computed: F(treatments) = ${fTreat.toFixed(4)} with df(T)=${dfTreat}, df(Error)=${dfError}.\n` +
        `Approx. significance: ${sig.note}.\n\n` +
        `Highest mean treatment: ${best.trt} (mean=${best.mean.toFixed(3)}).\n\n` +
        `If row/column effects are large, Latin square often reduces residual error compared to CRD.`;

      setInterpretation("lattice", interpretation, deviationHtml || "", { fTreat, msError });
    });

    $("#lsCompute").click();
  }

  // --- Augmented Design (Checks replicated in blocks; new entries unreplicated) ---
  function renderAugmented() {
    const title = "Augmented RCBD — Checks + Test Entries";
    showContentHeader({
      title,
      subtitle:
        "Checks replicated per block; test entries unreplicated. Block adjustment factors from check plots; additive adjusted means; four standard errors of difference (checks, entries same/different block, check vs entry).",
    });

    const defaultChecks = 3;
    const defaultBlocks = 4;
    const defaultNew = 6;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">Augmented (checks replicated)</div></div>
        <div class="kpi"><div class="label">Purpose</div><div class="value">Many new genotypes with limited replication</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">BAF, SEs, adjusted means</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Inputs</h4>
            <div class="input-grid" id="augControls">
              <div class="two-col">
                <label>
                  Checks (c)
                  <input type="number" min="2" id="augC" value="${defaultChecks}" />
                </label>
                <label>
                  Blocks (b)
                  <input type="number" min="2" id="augB" value="${defaultBlocks}" />
                </label>
              </div>
              <label>
                New entries (n)
                <input type="number" min="1" id="augN" value="${defaultNew}" />
              </label>
              <button class="action-btn primary2" type="button" id="augBuild">Build inputs</button>
              <div class="note" style="margin:0">
                Additive adjustment: adjusted = observed + (grand check mean − block check mean). Multiplicative BAF = grand / block check mean (optional scaling).
              </div>
            </div>
            <div id="augInputsWrap" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="augCompute">Compute augmented results</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="augResultTop"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="augBar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="augTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "augmented",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["maxAdjusted"],
    });

    function buildInputs(c, b, n) {
      const wrap = $("#augInputsWrap");
      wrap.innerHTML = "";

      // Checks matrix
      const checks = document.createElement("div");
      checks.className = "matrix";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Check/Block"];
      for (let j = 0; j < b; j++) headers.push(`B${j + 1}`);
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < c; i++) {
        const cells = [];
        for (let j = 0; j < b; j++) {
          const base = 28 + i * 1.8;
          const blockEff = (j - (b - 1) / 2) * 0.7;
          const val = base + blockEff + (i === 1 ? 0.6 : 0) + (j % 2 ? 0.2 : -0.1);
          cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-check="c${i}b${j}" /></td>`);
        }
        rows.push(`<tr><th>${qs(`C${i + 1}`)}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      checks.appendChild(table);

      // New entries list
      const newBox = document.createElement("div");
      newBox.className = "matrix";
      const t2 = document.createElement("table");
      t2.className = "data";
      t2.innerHTML = `<thead><tr><th>New entry</th><th>Block</th><th>Observed value</th></tr></thead>`;
      const newRows = [];
      for (let i = 0; i < n; i++) {
        const blk = (i % b) + 1;
        const val = 30 + i * 0.9 + (blk - (b + 1) / 2) * 0.6 + (i % 2 ? 0.3 : -0.2);
        newRows.push(
          `<tr>
            <th>${qs(`N${i + 1}`)}</th>
            <td>
              <select data-newblk="n${i}">
                ${Array.from({ length: b }, (_, k) => `<option value="${k + 1}" ${k + 1 === blk ? "selected" : ""}>B${k + 1}</option>`).join("")}
              </select>
            </td>
            <td><input type="number" step="0.01" value="${val.toFixed(2)}" data-newval="n${i}" /></td>
          </tr>`
        );
      }
      t2.insertAdjacentHTML("beforeend", `<tbody>${newRows.join("")}</tbody>`);
      newBox.appendChild(t2);

      wrap.insertAdjacentHTML("beforeend", `<div class="section" style="margin:0 0 12px"><h4>Checks (replicated)</h4></div>`);
      wrap.appendChild(checks);
      wrap.insertAdjacentHTML("beforeend", `<div class="section" style="margin:12px 0 12px"><h4>New entries (unreplicated)</h4></div>`);
      wrap.appendChild(newBox);
    }

    buildInputs(defaultChecks, defaultBlocks, defaultNew);

    $("#augBuild").addEventListener("click", () => {
      const c = Math.max(2, Number($("#augC").value || defaultChecks));
      const b = Math.max(2, Number($("#augB").value || defaultBlocks));
      const n = Math.max(1, Number($("#augN").value || defaultNew));
      buildInputs(c, b, n);
    });

    $("#augCompute").addEventListener("click", () => {
      const c = Math.max(2, Number($("#augC").value || defaultChecks));
      const b = Math.max(2, Number($("#augB").value || defaultBlocks));
      const n = Math.max(1, Number($("#augN").value || defaultNew));

      // Read checks
      const checks = [];
      for (let i = 0; i < c; i++) {
        checks[i] = [];
        for (let j = 0; j < b; j++) {
          const input = document.querySelector(`#augInputsWrap input[data-check="c${i}b${j}"]`);
          const v = Number(input?.value ?? NaN);
          checks[i][j] = Number.isFinite(v) ? v : 0;
        }
      }

      const blockCheckMeans = [];
      for (let j = 0; j < b; j++) {
        let s = 0;
        for (let i = 0; i < c; i++) s += checks[i][j];
        blockCheckMeans[j] = s / c;
      }
      const grandCheckMean = mean(blockCheckMeans);
      const blockEffects = blockCheckMeans.map((m) => m - grandCheckMean);
      const blockAdjFactors = blockCheckMeans.map((m) => (Math.abs(m) > 1e-12 ? grandCheckMean / m : 1));

      const checkOut = rbdAnova(checks, b, c);
      const seAug = augmentedRcbdStandardErrors(checkOut.msError, b, c);
      const tdf = checkOut.dfError;
      const t05 = studentTInvTwoTail(tdf, 0.05);
      const t01 = studentTInvTwoTail(tdf, 0.01);
      const sedTableRow = (label, formula, se) => [
        label,
        formula,
        se,
        Number.isFinite(se) ? t05 * se : "—",
        Number.isFinite(se) ? t01 * se : "—",
      ];

      const newEntries = [];
      for (let i = 0; i < n; i++) {
        const blk = Number(document.querySelector(`#augInputsWrap select[data-newblk="n${i}"]`)?.value || 1);
        const val = Number(document.querySelector(`#augInputsWrap input[data-newval="n${i}"]`)?.value ?? NaN);
        const obs = Number.isFinite(val) ? val : 0;
        const bidx = blk - 1;
        const adjAdd = obs - blockEffects[bidx];
        const adjMult = obs * blockAdjFactors[bidx];
        newEntries.push({
          id: `N${i + 1}`,
          block: `B${blk}`,
          observed: obs,
          adjustedAdd: adjAdd,
          adjustedMult: adjMult,
        });
      }

      const checkAdj = [];
      for (let i = 0; i < c; i++) {
        const row = checks[i];
        const m = mean(row);
        checkAdj.push({ id: `C${i + 1}`, block: "—", observed: m, adjustedAdd: m, adjustedMult: m });
      }

      const all = [
        ...checkAdj.map((x) => ({ ...x, type: "Check" })),
        ...newEntries.map((x) => ({ ...x, type: "Test entry" })),
      ];
      const maxAdjusted = Math.max(...all.map((x) => x.adjustedAdd));

      $("#augResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">Grand check mean (G)</div><div class="value">${grandCheckMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Blocks (b) / Checks (c)</div><div class="value">${b} / ${c}</div></div>
          <div class="kpi"><div class="label">σ̂² (checks MSE)</div><div class="value">${checkOut.msError.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Max adj. (additive)</div><div class="value">${maxAdjusted.toFixed(3)}</div></div>
        </div>
      `;

      const top = [...all].sort((a, b) => b.adjustedAdd - a.adjustedAdd).slice(0, Math.min(12, all.length));
      drawBarChart(
        $("#augBar"),
        top.map((x) => x.id),
        top.map((x) => x.adjustedAdd),
        { title: "Top additive adjusted means (checks + test entries)" }
      );

      const headers0 = ["Block", "Mean of checks (B̄_j)", "Additive offset (G − B̄_j)", "Multiplicative BAF (G / B̄_j)"];
      const rows0 = blockCheckMeans.map((m, j) => [`B${j + 1}`, m, grandCheckMean - m, blockAdjFactors[j]]);

      const headers1 = ["Genotype", "Type", "Block", "Observed", "Adjusted (additive)", "Adjusted (× BAF)"];
      const rows1 = all.map((x) => [
        x.id,
        x.type,
        x.block,
        x.observed,
        x.adjustedAdd,
        x.type === "Check" ? "—" : x.adjustedMult,
      ]);

      const headersSe = ["Comparison", "SED formula", "SED", "CD (5%)", "CD (1%)"];
      const rowsSe = [
        sedTableRow("Two checks", "√(2σ̂²/b)", seAug.seCheckCheck),
        sedTableRow("Two test entries, same block", "√(2σ̂²(c+1)/c)", seAug.seEntrySame),
        sedTableRow("Two test entries, different blocks", "√(2σ̂²(c+2)/c)", seAug.seEntryDiff),
        sedTableRow("Check vs test entry", "√(2σ̂²(c+1)/(bc))", seAug.seCheckEntry),
      ];

      const headers3 = ["Checks ANOVA Source", "SS", "df", "MS", "F"];
      const rows3 = [
        ["Treatments (checks)", checkOut.ssTreat, checkOut.dfTreat, checkOut.msTreat, checkOut.fTreat],
        ["Blocks", checkOut.ssBlock, checkOut.dfBlock, checkOut.msBlock, checkOut.msBlock / checkOut.msError || ""],
        ["Error", checkOut.ssError, checkOut.dfError, checkOut.msError, ""],
        ["Total", checkOut.ssTotal, checkOut.dfTreat + checkOut.dfBlock + checkOut.dfError, "", ""],
      ];

      $("#augTableWrap").innerHTML = `
        <h4>Table 1. Block adjustment factors (from check plots)</h4>
        <div class="muted small" style="margin-bottom:6px">G = mean of block check means. Additive offset shifts to common level; BAF = G/B̄_j multiplies raw yield to overall check mean.</div>
        ${buildTable(headers0, rows0)}
        <h4 style="margin-top:12px">Table 2. Observed and adjusted means</h4>
        <div class="muted small" style="margin-bottom:6px">Additive adjusted test entry = observed + (G − B̄_j). Checks: marginal mean across blocks (no BAF column).</div>
        ${buildTable(headers1, rows1)}
        <h4 style="margin-top:12px">Table 3. Standard errors of difference (σ̂² = check MSE, df=${tdf})</h4>
        <div class="muted small" style="margin-bottom:6px">Federer-type augmented RCBD. CD = t × SED using checks-only error df.</div>
        ${buildTable(headersSe, rowsSe)}
        <h4 style="margin-top:12px">Table 4. ANOVA — checks in randomized blocks</h4>
        ${buildTable(headers3, rows3)}
      `;

      const deviationHtml = deviationBanner("augmented", { maxAdjusted }, ["maxAdjusted"]);
      const best = [...all].sort((a, b) => b.adjustedAdd - a.adjustedAdd)[0];
      const interpretation =
        `Augmented RCBD: checks replicated in each block; test entries once.\n\n` +
        `Table 1: block adjustment factors from mean of c checks per block — additive (G − B̄_j) and multiplicative BAF (G/B̄_j). ` +
        `Table 2: test entry adjusted means (additive) = observed + (G − B̄_j); optional multiplicative = observed × BAF.\n\n` +
        `Table 3: four SEDs — two checks √(2σ̂²/b); two entries same block √(2σ̂²(c+1)/c); different blocks √(2σ̂²(c+2)/c); check vs entry √(2σ̂²(c+1)/(bc)), with σ̂² = ${checkOut.msError.toFixed(4)}.\n\n` +
        `Largest additive adjusted: ${best.id} (${best.type}) = ${best.adjustedAdd.toFixed(3)}.`;

      setInterpretation("augmented", interpretation, deviationHtml || "", { maxAdjusted, msError: checkOut.msError });
    });

    $("#augCompute").click();
  }

  // --- Split Plot Design (R blocks; A main plot; B subplot) ---
  function renderSplitPlot() {
    const title = "Split Plot Design - ANOVA";
    showContentHeader({
      title,
      subtitle:
        "Variance: Blocks, Factor A (main plot), Error (a), Factor B (sub plot), A×B, Error (b). F_A vs Error (a); F_B and F_A×B vs Error (b). Separate CD for main plots, sub-plots, cells, and simple effects.",
    });

    const defaultA = 3;
    const defaultB = 3;
    const defaultR = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">Split plot (RBD)</div></div>
        <div class="kpi"><div class="label">Main plot</div><div class="value">Factor A</div></div>
        <div class="kpi"><div class="label">Sub plot</div><div class="value">Factor B</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="input-grid" id="spControls">
              <div class="two-col">
                <label>
                  Levels of A (a)
                  <input type="number" min="2" id="spA" value="${defaultA}" />
                </label>
                <label>
                  Levels of B (b)
                  <input type="number" min="2" id="spB" value="${defaultB}" />
                </label>
              </div>
              <label>
                Blocks/replications (r)
                <input type="number" min="2" id="spR" value="${defaultR}" />
              </label>
              <button class="action-btn primary2" type="button" id="spBuild">Build grid</button>
              <div class="note" style="margin:0">
                Each block contains a main-plot layout of A; within each A main plot, B subplots are observed.
              </div>
              <div class="muted small" style="margin-top:8px">
                <strong>Import CSV / Excel:</strong> set <strong>a</strong>, <strong>b</strong>, <strong>r</strong> and click <strong>Build grid</strong> first. File = <strong>a×b</strong> rows (A×B combinations in table order) and <strong>r</strong> columns; optional label column.
              </div>
              <button class="action-btn" type="button" id="spImportCsv">Import CSV / Excel</button>
              <input type="file" id="spCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div id="spGridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="spCompute">Compute split-plot</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="spResultTop"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="spBar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="spTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "splitplot",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fA", "fB", "fAB"],
    });

    function buildGrid(a, b, r) {
      const wrap = $("#spGridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["A×B / Block"];
      for (let k = 0; k < r; k++) headers.push(`R${k + 1}`);
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;

      const rows = [];
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          const comb = `A${i + 1}B${j + 1}`;
          const cells = [];
          for (let k = 0; k < r; k++) {
            const mainEff = (i + 1) * 6.5;
            const subEff = (j + 1) * 2.1;
            const blockEff = (k - (r - 1) / 2) * 0.9;
            const inter = (i === 1 && j === 2) ? 2.2 : 0; // small interaction
            const val = 18 + mainEff + subEff + blockEff + inter + (k % 2 ? 0.2 : -0.15);
            cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-cell="a${i}b${j}r${k}" /></td>`);
          }
          rows.push(`<tr><th>${qs(comb)}</th>${cells.join("")}</tr>`);
        }
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildGrid(defaultA, defaultB, defaultR);

    $("#spBuild").addEventListener("click", () => {
      const a = Math.max(2, Number($("#spA").value || defaultA));
      const b = Math.max(2, Number($("#spB").value || defaultB));
      const r = Math.max(2, Number($("#spR").value || defaultR));
      buildGrid(a, b, r);
    });

    bindCsvExcelFileImport("spImportCsv", "spCsvFile", (txt) => {
      const parsed = parseRectDataGridCsv(txt);
      const a = Math.max(2, Number($("#spA").value || defaultA));
      const b = Math.max(2, Number($("#spB").value || defaultB));
      const r = Math.max(2, Number($("#spR").value || defaultR));
      if (!parsed || parsed.t !== a * b || parsed.r !== r) {
        alert(`Grid shape mismatch: file has ${parsed ? `${parsed.t} rows × ${parsed.r} cols` : "invalid data"} but current design needs ${a * b} rows × ${r} cols. Set a, b, r and Build grid first.`);
        return;
      }
      for (let idx = 0; idx < a * b; idx++) {
        const i = Math.floor(idx / b);
        const j = idx % b;
        for (let k = 0; k < r; k++) {
          const inp = document.querySelector(`#spGridWrap input[data-cell="a${i}b${j}r${k}"]`);
          if (inp) inp.value = String(parsed.matrix[idx][k]);
        }
      }
    });

    $("#spCompute").addEventListener("click", () => {
      const a = Math.max(2, Number($("#spA").value || defaultA));
      const b = Math.max(2, Number($("#spB").value || defaultB));
      const r = Math.max(2, Number($("#spR").value || defaultR));

      const y = [];
      for (let i = 0; i < a; i++) {
        y[i] = [];
        for (let j = 0; j < b; j++) {
          y[i][j] = [];
          for (let k = 0; k < r; k++) {
            const input = document.querySelector(`#spGridWrap input[data-cell="a${i}b${j}r${k}"]`);
            const v = Number(input?.value ?? NaN);
            y[i][j][k] = Number.isFinite(v) ? v : 0;
          }
        }
      }

      const sp = splitPlotRbdAnova(y, a, b, r);
      const {
        ssTotal,
        ssBlock,
        ssA,
        ssErrorA,
        ssB,
        ssAB,
        ssErrorB,
        dfBlock,
        dfA,
        dfErrorA,
        dfB,
        dfAB,
        dfErrorB,
        dfTotal,
        msBlock,
        msA,
        msErrorA,
        msB,
        msAB,
        msErrorB,
        fA,
        fB,
        fAB,
        pA,
        pB,
        pAB,
        sigA,
        sigB,
        sigAB,
        ABtotals,
      } = sp;

      const pfmt = (pv) => (pv < 1e-4 ? "<0.0001" : Number(pv).toFixed(4));
      const cd = splitPlotCriticalDifferences(msErrorA, dfErrorA, msErrorB, dfErrorB, a, b, r);

      $("#spResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(3, minmax(0,1fr))">
          <div class="kpi"><div class="label">F(A) / p — vs Error (a)</div><div class="value">${fA.toFixed(4)} / ${pfmt(pA)}</div></div>
          <div class="kpi"><div class="label">F(B) / p — vs Error (b)</div><div class="value">${fB.toFixed(4)} / ${pfmt(pB)}</div></div>
          <div class="kpi"><div class="label">F(A×B) / p — vs Error (b)</div><div class="value">${fAB.toFixed(4)} / ${pfmt(pAB)}</div></div>
        </div>
        <div class="kpi-row" style="grid-template-columns:repeat(2, minmax(0,1fr));margin-top:8px">
          <div class="kpi"><div class="label">MS Error (a)</div><div class="value">${msErrorA.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">MS Error (b)</div><div class="value">${msErrorB.toFixed(4)}</div></div>
        </div>
      `;

      const comboMeans = [];
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) comboMeans.push({ label: `A${i + 1}B${j + 1}`, mean: ABtotals[i][j] / r });
      drawBarChart($("#spBar"), comboMeans.map((x) => x.label), comboMeans.map((x) => x.mean), { title: "A×B cell means (r blocks)" });

      const anovaHeaders = ["Source", "SS", "df", "MS", "F", "p-value", "F-test denominator"];
      const anovaRows = [
        ["Blocks (replicates)", ssBlock, dfBlock, msBlock, "", "", "—"],
        ["Factor A (main plot)", ssA, dfA, msA, fA, pfmt(pA), "Error (a)"],
        ["Error (a) — main-plot error", ssErrorA, dfErrorA, msErrorA, "", "", "MS error (a)"],
        ["Factor B (sub plot)", ssB, dfB, msB, fB, pfmt(pB), "Error (b)"],
        ["A × B interaction", ssAB, dfAB, msAB, fAB, pfmt(pAB), "Error (b)"],
        ["Error (b) — sub-plot error", ssErrorB, dfErrorB, msErrorB, "", "", "MS error (b)"],
        ["Total", ssTotal, dfTotal, "", "", "", ""],
      ];

      const fmtCd = (x) => (Number.isFinite(x) ? x.toFixed(4) : "—");
      const cdHeaders = ["Comparison (balanced split-plot)", "SE of difference", "df for t", "CD (5%)", "CD (1%)"];
      const cdRows = [
        [
          "Marginal A means (ȳ_i··)",
          cd.sedA.toFixed(4),
          `${dfErrorA}`,
          fmtCd(cd.cdA5),
          fmtCd(cd.cdA1),
        ],
        [
          "Marginal B means (ȳ_·j·)",
          cd.sedB.toFixed(4),
          `${dfErrorB}`,
          fmtCd(cd.cdB5),
          fmtCd(cd.cdB1),
        ],
        [
          "A×B cell means — any pair (ȳ_ij·)",
          cd.sedCell.toFixed(4),
          `${dfErrorB}`,
          fmtCd(cd.cdAB5),
          fmtCd(cd.cdAB1),
        ],
        [
          "Simple effects: B at fixed A, or A at fixed B",
          cd.sedCell.toFixed(4),
          `${dfErrorB}`,
          fmtCd(cd.cdSimple5),
          fmtCd(cd.cdSimple1),
        ],
      ];

      const simpleRows = [];
      for (let i = 0; i < a; i++) {
        simpleRows.push([
          `Compare B levels holding A${i + 1} fixed`,
          cd.sedCell.toFixed(4),
          `${dfErrorB}`,
          fmtCd(cd.cdSimple5),
          fmtCd(cd.cdSimple1),
        ]);
      }
      for (let j = 0; j < b; j++) {
        simpleRows.push([
          `Compare A levels holding B${j + 1} fixed`,
          cd.sedCell.toFixed(4),
          `${dfErrorB}`,
          fmtCd(cd.cdSimple5),
          fmtCd(cd.cdSimple1),
        ]);
      }

      $("#spTableWrap").innerHTML = `
        <h4>Table 1. Split-plot ANOVA (RBD)</h4>
        <div class="muted small" style="margin-bottom:6px">Factor A is tested against <strong>Error (a)</strong> (Blocks×A). Factor B and A×B are tested against <strong>Error (b)</strong> (sub-plot residual).</div>
        ${buildTable(anovaHeaders, anovaRows)}
        <h4 style="margin-top:12px">Table 2. Critical differences (Fisher LSD)</h4>
        <div class="muted small" style="margin-bottom:6px">CD = t<sub>α/2,df</sub> × SE<sub>d</sub>. Main-plot contrasts use MS<sub>Error(a)</sub> and df (a); subplot, interaction, and simple-effect contrasts use MS<sub>Error(b)</sub> and df (b).</div>
        ${buildTable(cdHeaders, cdRows)}
        <h4 style="margin-top:12px">Table 3. Simple effects — same CD at every level (balanced)</h4>
        <div class="muted small" style="margin-bottom:6px">For balanced designs, pairwise comparisons among B levels within a fixed A, and among A levels within a fixed B, share the same SE<sub>d</sub> = √(2·MS<sub>Error(b)</sub>/r).</div>
        ${buildTable(cdHeaders, simpleRows)}
      `;

      const deviationHtml = deviationBanner("splitplot", { fA, fB, fAB }, ["fA", "fB", "fAB"]);
      const best = [...comboMeans].sort((x, y) => y.mean - x.mean)[0];
      const interpretation =
        `Split-plot RBD: variance is partitioned into blocks, main plots (A), Error (a), sub plots (B), A×B, and Error (b).\n` +
        `F_A = MS_A / MS_Error(a) = ${fA.toFixed(4)} (p ≈ ${pfmt(pA)}); F_B and F_A×B use MS_Error(b): F_B = ${fB.toFixed(4)} (p ≈ ${pfmt(pB)}), F_A×B = ${fAB.toFixed(4)} (p ≈ ${pfmt(pAB)}).\n\n` +
        `Critical differences: use CD for A (marginal means) with Error (a); use CD for B, A×B cells, and simple effects with Error (b). Tables 2–3 list SE<sub>d</sub> and CD at 5% and 1%.\n\n` +
        `Largest A×B mean: ${best.label} (${best.mean.toFixed(3)}). If interaction is significant, compare cell means and simple effects rather than only marginal effects.`;

      setInterpretation("splitplot", interpretation, deviationHtml || "", { fA, fB, fAB, msErrorA, msErrorB });
    });

    $("#spCompute").click();
  }

  // --- Correlation (Pearson) ---
  function renderCorrelation() {
    const title = "Correlation Analysis (Pearson + Spearman)";
    showContentHeader({
      title,
      subtitle: "Compute correlation coefficients and visualize scatter + correlation table.",
    });

    const defaultN = 8;
    const bodyHtml = `
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input data</h4>
            <div class="muted small" style="margin-bottom:8px">Paste two traits as equal-length numbers (comma/space/newline separated).</div>
            <label>
              Trait X
              <textarea id="corX">${Array.from({ length: defaultN }, (_, i) => (10 + i * 0.9 + (i % 2 ? 1.2 : 0.2)).toFixed(2)).join(", ")}</textarea>
            </label>
            <label>
              Trait Y
              <textarea id="corY">${Array.from({ length: defaultN }, (_, i) => (8 + i * 1.15 + (i % 3 === 0 ? 1.8 : 0.6)).toFixed(2)).join(", ")}</textarea>
            </label>
            <label>
              Multi-trait matrix (optional)
              <textarea id="corMatrix" rows="5" placeholder="Rows = observations, columns = traits (comma or tab). Needs ≥3 rows and ≥2 columns. Example:&#10;10.2, 8.1, 12.0&#10;11.0, 8.4, 11.5&#10;9.8, 7.9, 12.2"></textarea>
            </label>
            <div class="muted small" style="margin-bottom:8px">When the matrix is filled, a full Pearson correlation matrix is shown below; X/Y still drive the scatter plot.</div>
            <div class="muted small" style="margin-bottom:8px">
              <strong>Import CSV / Excel:</strong> ≥3 rows and ≥3 columns → fills the <strong>multi-trait matrix</strong>. Exactly <strong>2 numeric columns</strong> (optional header) → fills X and Y lists and the matrix.
            </div>
            <div class="actions" style="margin-top:8px">
              <button class="action-btn" type="button" id="corImportCsv">Import CSV / Excel</button>
              <input type="file" id="corCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
              <button class="action-btn primary2" type="button" id="corCompute">Compute correlations</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="corScatter" style="width:100%;height:100%"></canvas>
            </div>
            <div id="corMatrixWrap" style="margin-top:12px"></div>
            <div id="corTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "correlation",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["pearson"],
    });

    function rankData(arr) {
      // average ranks for ties
      const pairs = arr.map((v, i) => ({ v, i }));
      pairs.sort((a, b) => a.v - b.v);
      const ranks = Array(arr.length);
      let i = 0;
      while (i < pairs.length) {
        let j = i;
        while (j < pairs.length && pairs[j].v === pairs[i].v) j++;
        const avgRank = (i + 1 + j) / 2; // 1-based
        for (let k = i; k < j; k++) ranks[pairs[k].i] = avgRank;
        i = j;
      }
      return ranks;
    }

    function spearman(xs, ys) {
      const rx = rankData(xs);
      const ry = rankData(ys);
      return pearsonCorrelation(rx, ry);
    }

    $("#corCompute").addEventListener("click", () => {
      clearValidation("#contentBody");
      const errors = [];
      const xs = parseGridNumbers($("#corX").value);
      const ys = parseGridNumbers($("#corY").value);
      const n = Math.min(xs.length, ys.length);
      if (xs.length !== ys.length) {
        errors.push(`Correlation: X and Y lengths differ (X=${xs.length}, Y=${ys.length}); first ${n} values will be used.`);
      }
      if (n < 3) {
        errors.push("Correlation: provide at least 3 numeric observations per trait.");
        markInvalidInput($("#corX"), "Need at least 3 numeric values");
        markInvalidInput($("#corY"), "Need at least 3 numeric values");
      }
      if (shouldBlockForValidation("correlation", errors, "#corTableWrap")) return;
      const x = xs.slice(0, n);
      const y = ys.slice(0, n);
      const pearson = pearsonCorrelation(x, y);
      const spear = spearman(x, y);

      // build scatter points
      const points = x.map((vx, i) => ({ x: vx, y: y[i] }));
      drawScatterPlot($("#corScatter"), points, { title: "Trait scatter plot", xLabel: "X", yLabel: "Y" });

      const matParsed = parseDataMatrix($("#corMatrix").value);
      let matrixHtml = "";
      if (matParsed && matParsed[0].length >= 2) {
        const R = pearsonCorrelationMatrix(matParsed);
        const names = matParsed[0].map((_, i) => `T${i + 1}`);
        const hdr = ["Trait", ...names];
        const matRows = names.map((name, i) => [name, ...R[i]]);
        matrixHtml = `<h4>Multi-trait Pearson correlation matrix (n = ${matParsed.length})</h4>${buildTable(hdr, matRows)}`;
      }
      $("#corMatrixWrap").innerHTML = matrixHtml;

      const headers = ["Correlation Type", "Coefficient (r)", "Direction"];
      const direction = (r) => (r > 0.01 ? "Positive" : r < -0.01 ? "Negative" : "Zero/None");
      const anovaRows = [
        ["Pearson (linear association)", pearson, direction(pearson)],
        ["Spearman (rank association)", spear, direction(spear)],
      ];
      $("#corTableWrap").innerHTML = `${buildTable(headers, anovaRows)}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 2. Assumption checklist", [
        { assumption: "Paired observations (same experimental units)", status: "Required", note: "X and Y must refer to the same entries." },
        { assumption: "Linear relation for Pearson", status: "Assumed", note: "Use Spearman for monotonic non-linear patterns." },
        { assumption: "No extreme outlier dominance", status: "Recommended", note: "Outliers can distort coefficient magnitude." }
      ])}`;

      const deviationHtml = deviationBanner(
        "correlation",
        { pearson },
        ["pearson"]
      );

      const absP = Math.abs(pearson);
      const strength =
        absP >= 0.7 ? "strong" : absP >= 0.4 ? "moderate" : absP >= 0.2 ? "weak" : "very weak/none";
      const interpretation =
        `Correlation helps quantify association between two quantitative traits.\n` +
        `Sample size (n) used: ${n}.\n\n` +
        `Pearson r = ${pearson.toFixed(4)} (${direction(pearson)}; ${strength} linear association).\n` +
        `Spearman rho = ${spear.toFixed(4)} (${direction(spear)}; tests monotonic association).\n\n` +
        `Interpretation guidance:\n` +
        `• A positive coefficient means as X increases, Y tends to increase.\n` +
        `• A negative coefficient means as X increases, Y tends to decrease.\n` +
        `• Correlation does NOT imply causation; use regression/path analysis for causal modeling.`;

      setInterpretation(
        "correlation",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { pearson }
      );
      const qCorr = n >= 5 ? 90 : 70;
      setRunMeta("correlation", { forceRun: isForceRunEnabled(), inputSize: `n=${n}`, standardization: "none", preprocessing: xs.length === ys.length ? "No truncation." : `Input lengths differed (X=${xs.length}, Y=${ys.length}); truncated to n=${n}.`, qualityScore: `${qCorr} / 100` });
    });

    bindCsvExcelFileImport("corImportCsv", "corCsvFile", (txt) => {
      const rows = parseCsv(txt)
        .map((r) => r.map((c) => String(c).trim()))
        .filter((r) => r.some((c) => c !== ""));
      if (rows.length < 2) {
        alert("Need at least 2 data rows.");
        return;
      }
      const w = Math.max(...rows.map((r) => r.length));
      if (w >= 3) {
        $("#corMatrix").value = txt;
      } else if (w === 2) {
        let start = 0;
        const a = Number(rows[0][0]);
        const b = Number(rows[0][1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) start = 1;
        const xs = [];
        const ys = [];
        for (let i = start; i < rows.length; i++) {
          if (rows[i].length < 2) continue;
          xs.push(Number(rows[i][0]));
          ys.push(Number(rows[i][1]));
        }
        if (xs.length < 3) {
          alert("Need at least 3 numeric pairs in two columns.");
          return;
        }
        $("#corX").value = xs.join(", ");
        $("#corY").value = ys.join(", ");
        $("#corMatrix").value = txt;
      } else {
        alert("File needs either 2 columns (X,Y) or 3+ columns (trait matrix).");
      }
    });

    // compute once for initial display
    $("#corCompute").click();
  }

  // --- Regression (simple linear) ---
  function renderRegression() {
    const title = "Regression Analysis (Simple Linear) - Y on X";
    showContentHeader({
      title,
      subtitle: "Fit a simple linear regression, view scatter + fitted line, and interpret slope & R².",
    });

    const defaultN = 8;
    const bodyHtml = `
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input data</h4>
            <div class="muted small" style="margin-bottom:8px">Paste Trait X (predictor) and Trait Y (response).</div>
            <label>
              Predictor X
              <textarea id="regX">${Array.from({ length: defaultN }, (_, i) => (5 + i * 1.05 + (i % 2 ? 0.3 : -0.1)).toFixed(2)).join(", ")}</textarea>
            </label>
            <label>
              Response Y
              <textarea id="regY">${Array.from({ length: defaultN }, (_, i) => (9 + i * 2.1 + (i % 3 === 0 ? 3.1 : 1.2)).toFixed(2)).join(", ")}</textarea>
            </label>
            <div class="muted small" style="margin-top:8px">
              <strong>Import CSV / Excel:</strong> two columns — predictor X then response Y (header row optional). Needs ≥3 rows.
            </div>
            <div class="actions" style="margin-top:8px">
              <button class="action-btn" type="button" id="regImportCsv">Import CSV / Excel</button>
              <input type="file" id="regCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
              <button class="action-btn primary2" type="button" id="regCompute">Compute regression</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="regScatter" style="width:100%;height:100%"></canvas>
            </div>
            <div class="chart" style="height:210px;margin-top:12px">
              <canvas id="regResidualPlot" style="width:100%;height:100%"></canvas>
            </div>
            <div id="regTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "regression",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["slope"],
    });

    function drawScatterWithLine(canvas, xs, ys, a, b) {
      drawScatterPlot(canvas, xs.map((x, i) => ({ x, y: ys[i] })), { title: "Scatter + fitted line", xLabel: "X", yLabel: "Y" });
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = Math.max(1e-9, maxX - minX);
      const rangeY = Math.max(1e-9, maxY - minY);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x1 = minX;
      const y1 = a + b * x1;
      const x2 = maxX;
      const y2 = a + b * x2;
      const p1 = projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, x1, y1);
      const p2 = projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, x2, y2);
      ctx.strokeStyle = CHART.lineFit;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();
    }

    $("#regCompute").addEventListener("click", () => {
      clearValidation("#contentBody");
      const errors = [];
      const xs = parseGridNumbers($("#regX").value);
      const ys = parseGridNumbers($("#regY").value);
      const n = Math.min(xs.length, ys.length);
      if (xs.length !== ys.length) {
        errors.push(`Regression: X and Y lengths differ (X=${xs.length}, Y=${ys.length}); first ${n} values will be used.`);
      }
      if (n < 3) {
        errors.push("Regression: provide at least 3 numeric observations.");
        markInvalidInput($("#regX"), "Need at least 3 numeric values");
        markInvalidInput($("#regY"), "Need at least 3 numeric values");
      }
      if (shouldBlockForValidation("regression", errors, "#regTableWrap")) return;
      const x = xs.slice(0, n);
      const y = ys.slice(0, n);

      const { slope, intercept, r, r2 } = simpleLinearRegression(x, y);
      const regResiduals = y.map((yy, i) => yy - (intercept + slope * x[i]));
      const regDiag = residualSummary(regResiduals);
      const regOut = outlierFlags(y);
      drawScatterWithLine($("#regScatter"), x, y, intercept, slope);
      drawResidualMiniPlot($("#regResidualPlot"), regResiduals, "Regression residuals");

      const headers = ["Regression Term", "Value"];
      const rows = [
        ["Intercept (a)", intercept],
        ["Slope (b) for Y = a + bX", slope],
        ["Pearson r (same as sqrt R² sign via slope)", r],
        ["R² (variance explained)", r2],
        ["Residual RMSE", regDiag.rmse],
      ];
      const qItemsReg = [
        { check: "Sample size adequacy", pass: n >= 5, note: `n=${n}` },
        { check: "Outlier load (IQR, Y)", pass: regOut.count <= Math.max(1, Math.floor(n * 0.15)), note: `${regOut.count} flagged value(s).` },
        { check: "Residual spread", pass: Number.isFinite(regDiag.rmse) && regDiag.rmse < Math.max(1e-9, Math.abs(mean(y)) * 0.6), note: `RMSE=${regDiag.rmse.toFixed(4)}` },
      ];
      if (strictModeShouldBlock("regression", qItemsReg, "#regTableWrap")) return;
      $("#regTableWrap").innerHTML = `${qualityScoreHtml(qItemsReg)}<div style="height:10px"></div>${buildTable(headers, rows)}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 2. Assumption checklist", [
        { assumption: "Linearity (Y vs X)", status: "Required", note: "Model assumes linear trend between predictor and response." },
        { assumption: "Independent residuals", status: "Assumed", note: "Dependence inflates/deflates uncertainty." },
        { assumption: "Approx. constant residual variance", status: "Assumed", note: "Heteroscedasticity affects slope inference." }
      ])}`;

      const deviationHtml = deviationBanner(
        "regression",
        { slope },
        ["slope"]
      );

      const direction = slope > 0 ? "positive" : slope < 0 ? "negative" : "none/flat";
      const strength = r2 >= 0.7 ? "high" : r2 >= 0.4 ? "moderate" : r2 >= 0.2 ? "weak" : "very low";
      const interpretation =
        `Simple linear regression models Y as a linear function of X.\n` +
        `Fitted model: Y = ${intercept.toFixed(4)} + (${slope.toFixed(4)})X.\n\n` +
        `Slope interpretation:\n` +
        `• The slope is ${direction} (${direction === "positive" ? "Y increases with X" : direction === "negative" ? "Y decreases with X" : "no clear linear change"}).\n` +
        `• R² = ${r2.toFixed(4)} indicates ${strength} explained variability in Y by X.\n\n` +
        `Use BKQuant Correlation first to understand direction/magnitude; regression extends correlation by adding a fitted predictive line.`;
      const corrPrev = loadPrev("correlation");
      const consistencyWarn =
        corrPrev && Number.isFinite(corrPrev.pearson) &&
        ((Math.abs(corrPrev.pearson) < 0.2 && r2 > 0.6) || (Math.abs(corrPrev.pearson) > 0.75 && r2 < 0.2))
          ? `<div class="note" style="margin-top:8px;border-color:rgba(255,209,102,0.55);background:rgba(255,209,102,0.12)">⚠ Cross-module check: stored correlation (${corrPrev.pearson.toFixed(3)}) and current regression R² (${r2.toFixed(3)}) are inconsistent. Verify if inputs changed or outliers dominate.</div>`
          : "";

      setInterpretation(
        "regression",
        interpretation,
        `${deviationHtml ? deviationHtml : ""}${consistencyWarn}`,
        { slope, r2 }
      );
      setRunMeta("regression", { forceRun: isForceRunEnabled(), inputSize: `n=${n}`, standardization: "none", preprocessing: xs.length === ys.length ? "No truncation." : `Input lengths differed (X=${xs.length}, Y=${ys.length}); truncated to n=${n}.`, qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsReg.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });

    bindCsvExcelFileImport("regImportCsv", "regCsvFile", (txt) => {
      const rows = parseCsv(txt)
        .map((r) => r.map((c) => String(c).trim()))
        .filter((r) => r.some((c) => c !== ""));
      if (rows.length < 2) {
        alert("Need at least 2 rows.");
        return;
      }
      let start = 0;
      const a = Number(rows[0][0]);
      const b = Number(rows[0][1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) start = 1;
      const xs = [];
      const ys = [];
      for (let i = start; i < rows.length; i++) {
        if (rows[i].length < 2) continue;
        xs.push(Number(rows[i][0]));
        ys.push(Number(rows[i][1]));
      }
      if (xs.length < 3 || ys.length < 3) {
        alert("Need at least 3 numeric X,Y pairs.");
        return;
      }
      $("#regX").value = xs.join(", ");
      $("#regY").value = ys.join(", ");
    });

    $("#regCompute").click();
  }

  // --- Multiple linear regression (VIF, AIC stepwise, diagnostics) ---
  function renderMultipleLinearRegression() {
    const title = "Multiple Linear Regression (MLR)";
    showContentHeader({
      title,
      subtitle:
        "OLS with VIF screening (VIF > 10 removed), AIC stepwise selection, overall F-test, and residual diagnostics (Q-Q, residuals vs fitted).",
    });

    const sampleMlr = [
      "N,P,K,Yield",
      "12,18,42,3.05",
      "14,19,44,3.22",
      "11,17,40,2.98",
      "15,21,46,3.38",
      "13,18,43,3.12",
      "16,22,47,3.45",
      "12,17,41,3.01",
      "14,20,45,3.28",
      "13,19,42,3.15",
      "15,21,46,3.40",
      "11,16,39,2.92",
      "14,18,44,3.20",
    ].join("\n");

    const bodyHtml = `
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Data matrix</h4>
            <div class="muted small" style="margin-bottom:8px">
              Rows = observations; columns = numeric traits. Header row with names recommended. Choose which column is the response (Y); all other columns are candidate predictors.
            </div>
            <label>
              Data
              <textarea id="mlrData" rows="14" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${sampleMlr}</textarea>
            </label>
            <div class="muted small" style="margin-top:8px">
              <strong>Import CSV / Excel:</strong> same layout as the box above — header row + numeric rows (last column can be response after you pick Y).
            </div>
            <div class="actions" style="margin-top:8px">
              <button class="action-btn" type="button" id="mlrImportCsv">Import CSV / Excel</button>
              <input type="file" id="mlrCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div class="input-grid" style="margin-top:10px">
              <label>
                Response (Y)
                <select id="mlrY"></select>
              </label>
              <label>
                VIF threshold
                <input type="number" id="mlrVifMax" value="10" min="1" step="0.5" title="Predictors with VIF above this are removed iteratively (highest VIF first)" />
              </label>
            </div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="mlrCompute">Fit MLR</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Model summary</h4>
            <div id="mlrKpis"></div>
            <div class="chart" style="height:240px;margin-top:12px">
              <canvas id="mlrQQ" style="width:100%;height:100%"></canvas>
            </div>
            <div class="chart" style="height:240px;margin-top:12px">
              <canvas id="mlrResFitted" style="width:100%;height:100%"></canvas>
            </div>
          </div>
        </div>
      </div>
      <div class="section" style="margin-top:12px">
        <h4>VIF diagnostics &amp; variable screening</h4>
        <div id="mlrVifWrap"></div>
      </div>
      <div class="section" style="margin-top:12px">
        <h4>Stepwise selection (AIC)</h4>
        <div id="mlrStepWrap"></div>
      </div>
      <div class="section" style="margin-top:12px">
        <h4>Coefficients &amp; ANOVA</h4>
        <div id="mlrFitWrap"></div>
      </div>
    `;

    moduleShell({
      moduleId: "mlr",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["r2"],
    });

    $("#mlrCompute").addEventListener("click", () => {
      clearValidation("#contentBody");
      const errors = [];
      const parsed = parseBiometricTraitMatrix($("#mlrData").value);
      if (parsed.error) {
        errors.push(`MLR: ${parsed.error}`);
        markInvalidInput($("#mlrData"), parsed.error);
      }
      if (shouldBlockForValidation("mlr", errors, "#mlrFitWrap")) return;

      const { colNames, data } = parsed;
      const n = data.length;
      const pAll = colNames.length;
      if (pAll < 2) {
        errors.push("Need at least 2 columns (one response and one predictor).");
        markInvalidInput($("#mlrData"), "At least 2 columns");
      }
      if (n < 4) {
        errors.push("Need at least 4 observations for multiple regression diagnostics.");
        markInvalidInput($("#mlrData"), "Need more rows");
      }
      if (shouldBlockForValidation("mlr", errors, "#mlrFitWrap")) return;

      const sel = $("#mlrY");
      const prev = (sel.value || "").trim();
      sel.innerHTML = colNames.map((c) => `<option value="${qs(c)}">${qs(c)}</option>`).join("");
      const prevIdx = colNames.findIndex((c) => c === prev);
      const yieldGuess = colNames.findIndex((c) => String(c).toLowerCase().includes("yield"));
      const yIdx = prevIdx >= 0 ? prevIdx : yieldGuess >= 0 ? yieldGuess : colNames.length - 1;
      sel.selectedIndex = yIdx;

      const y = data.map((row) => row[yIdx]);
      const predIdx = colNames.map((_, i) => i).filter((i) => i !== yIdx);
      const predNames = predIdx.map((i) => colNames[i]);
      const Xraw = data.map((row) => predIdx.map((j) => row[j]));

      if (!predIdx.length) {
        $("#mlrKpis").innerHTML = `<div class="note">Choose a response column so at least one predictor remains.</div>`;
        $("#mlrVifWrap").innerHTML = "";
        $("#mlrStepWrap").innerHTML = "";
        $("#mlrFitWrap").innerHTML = "";
        return;
      }

      const vifMax = Math.max(1, Number($("#mlrVifMax").value) || 10);

      const vifInitial = computeVifs(Xraw);
      const initialVifRows = predNames.map((nm, j) => [nm, vifInitial[j].toFixed(3)]);

      const vifOut = vifPrunePredictors(Xraw, predNames, vifMax);
      if (vifOut.names.length > 0 && n <= vifOut.names.length + 1) {
        markInvalidInput($("#mlrData"), "Need n > number of predictors + 1");
        if (
          shouldBlockForValidation(
            "mlr",
            [`After VIF screening: need n > p + 1 for unique OLS (n=${n}, p=${vifOut.names.length}).`],
            "#mlrFitWrap"
          )
        )
          return;
      }

      const removedRows = vifOut.removed.map((r) => [r.name, r.vif.toFixed(3)]);
      const afterVifRows =
        vifOut.names.length === 0
          ? []
          : vifOut.names.map((nm, j) => [nm, vifOut.finalVifs[j].toFixed(3)]);

      $("#mlrVifWrap").innerHTML = `
        <div class="muted small" style="margin-bottom:8px">Variance Inflation Factor (VIF): values &gt; ${vifMax} trigger removal (highest VIF eliminated first until all remaining ≤ ${vifMax} or no predictors left).</div>
        ${buildTable(["Predictor", "VIF (initial)"], initialVifRows)}
        <div style="height:10px"></div>
        ${removedRows.length ? `<div class="muted small" style="margin-bottom:6px">Removed for multicollinearity</div>${buildTable(["Removed predictor", "VIF at removal"], removedRows)}<div style="height:10px"></div>` : `<div class="muted small" style="margin-bottom:8px">No predictors exceeded VIF ${vifMax}.</div>`}
        ${afterVifRows.length ? `${buildTable(["Predictor", "VIF (after screening)"], afterVifRows)}` : `<div class="note">All predictors were removed by VIF screening; the final model is intercept-only.</div>`}
      `;

      function fitVifCleanFull() {
        if (!vifOut.X[0]?.length) {
          const X0 = y.map(() => [1]);
          return olsFitFromDesign(X0, y);
        }
        const Xd = vifOut.X.map((row) => [1, ...row]);
        return olsFitFromDesign(Xd, y);
      }

      const fitAfterVif = fitVifCleanFull();
      const aicAfterVif = fitAfterVif ? linearModelAic(fitAfterVif.n, fitAfterVif.sse, fitAfterVif.beta.length) : Infinity;

      const step = stepwiseAicSelection(vifOut.X, y, vifOut.names);
      const finalFit = step.fit;
      const aicFinal = step.aic;

      if (!finalFit) {
        $("#mlrKpis").innerHTML = `<div class="note">Model could not be fitted (singular design or insufficient observations). Try more data or fewer predictors.</div>`;
        $("#mlrStepWrap").innerHTML = "";
        $("#mlrFitWrap").innerHTML = "";
        return;
      }

      $("#mlrStepWrap").innerHTML = `
        <div class="muted small" style="margin-bottom:8px">
          Stepwise search (add/drop one predictor at a time) minimizes AIC = n·ln(SSE/n) + 2k with k = number of estimated coefficients (intercept + slopes).
        </div>
        ${buildTable(
          ["Stage", "AIC", "Note"],
          [
            ["After VIF screening (all remaining predictors)", aicAfterVif.toFixed(3), `${vifOut.names.length} predictor(s) in pool`],
            ["After stepwise selection", aicFinal.toFixed(3), `${step.selectedNames.length} predictor(s) retained`],
          ]
        )}
        <div style="height:8px"></div>
        <div class="muted small">Selected predictors: ${step.selectedNames.length ? step.selectedNames.map((s) => qs(String(s))).join(", ") : "(none — intercept only)"}</div>
      `;

      const m = finalFit.m;
      const rmse = Math.sqrt(finalFit.sse / Math.max(1, finalFit.n - finalFit.p));
      $("#mlrKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <div class="kpi"><div class="label">R²</div><div class="value">${finalFit.r2.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Adjusted R²</div><div class="value">${Number.isFinite(finalFit.r2adj) ? finalFit.r2adj.toFixed(4) : "—"}</div></div>
          <div class="kpi"><div class="label">RMSE</div><div class="value">${rmse.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">n, p</div><div class="value">${finalFit.n}, ${finalFit.p}</div></div>
        </div>
        <div class="kpi-row" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:8px">
          <div class="kpi"><div class="label">Overall F</div><div class="value">${m > 0 ? finalFit.fStat.toFixed(4) : "—"}</div></div>
          <div class="kpi"><div class="label">F p-value (H₀: all slopes = 0)</div><div class="value">${m > 0 ? (finalFit.fP < 1e-4 ? "<0.0001" : finalFit.fP.toFixed(4)) : "—"}</div></div>
        </div>
      `;

      drawQQPlotResiduals($("#mlrQQ"), finalFit.residuals, { title: "Normal Q-Q (residuals)" });
      drawResidualsVsFittedPlot($("#mlrResFitted"), finalFit.fitted, finalFit.residuals, { title: "Residuals vs fitted values" });

      const coefNames = ["Intercept", ...step.selectedNames.map((s) => String(s))];
      const coefRows = finalFit.beta.map((b, i) => [coefNames[i] || `β${i}`, b.toFixed(6)]);

      const anovaRows =
        m > 0
          ? [
              ["Regression", finalFit.ssr, m, finalFit.ssr / m, finalFit.fStat, finalFit.fP],
              ["Residual", finalFit.sse, finalFit.n - finalFit.p, finalFit.sse / Math.max(1, finalFit.n - finalFit.p), "", ""],
              ["Total", finalFit.sst, finalFit.n - 1, "", "", ""],
            ]
          : [
              ["Residual (intercept-only)", finalFit.sse, finalFit.n - 1, finalFit.sse / Math.max(1, finalFit.n - 1), "", ""],
              ["Total", finalFit.sst, finalFit.n - 1, "", "", ""],
            ];

      $("#mlrFitWrap").innerHTML = `
        ${buildTable(["Term", "Coefficient"], coefRows)}
        <div style="height:12px"></div>
        <div class="muted small" style="margin-bottom:6px">ANOVA (overall model)</div>
        ${buildTable(
          ["Source", "SS", "df", "MS", "F", "p-value"],
          anovaRows.map((row) => row.map((c) => (typeof c === "number" ? (Number.isFinite(c) ? c.toFixed(6) : String(c)) : c)))
        )}
        <div style="height:10px"></div>
        ${assumptionsChecklistHtml("Residual checks", [
          { assumption: "Q-Q plot: approximate linearity", status: "Recommended", note: "Supports normality of residuals (large samples)." },
          { assumption: "Residuals vs fitted: random scatter", status: "Recommended", note: "Fanning suggests heteroscedasticity." },
        ])}
      `;

      const interpretation =
        `Response: ${colNames[yIdx]} (${n} observations). Predictors after VIF screening: ${vifOut.names.length}; ` +
        `stepwise retained ${step.selectedNames.length}.\n\n` +
        `R² = ${finalFit.r2.toFixed(4)}, Adjusted R² = ${Number.isFinite(finalFit.r2adj) ? finalFit.r2adj.toFixed(4) : "n/a"}. ` +
        (m > 0
          ? `Overall F = ${finalFit.fStat.toFixed(4)} (df1=${m}, df2=${finalFit.n - finalFit.p}), p = ${finalFit.fP < 1e-4 ? "<0.0001" : finalFit.fP.toFixed(4)}. `
          : "No slope terms in the final model. ") +
        `\nAIC improved from ${aicAfterVif.toFixed(3)} (full VIF-clean) to ${aicFinal.toFixed(3)} (stepwise).`;

      const deviationHtml = deviationBanner("mlr", { r2: finalFit.r2 }, ["r2"]);
      setInterpretation("mlr", interpretation, deviationHtml || "", { r2: finalFit.r2 });
      setRunMeta("mlr", {
        forceRun: isForceRunEnabled(),
        inputSize: `n=${n}, predictors=${predNames.length}`,
        standardization: "OLS (raw scale)",
        preprocessing: `VIF≤${vifMax}; AIC stepwise`,
        qualityScore: `${Math.min(100, 50 + Math.min(n, 25))} / 100`,
      });
    });

    bindCsvExcelToTextarea("mlrImportCsv", "mlrCsvFile", "mlrData");

    $("#mlrCompute").click();
  }

  // --- PCA (multivariate: correlation PCA) ---
  function renderPCA() {
    const title = "PCA (Principal Component Analysis)";
    showContentHeader({
      title,
      subtitle:
        "Z-score each column (unit variance), eigen decomposition of the correlation matrix, variance explained, scree plot, biplot, cos² on PC1–PC2.",
    });

    const defaultCsv = [
      "V1,V2,V3,V4",
      "2.1,3.2,1.5,4.0",
      "2.3,3.0,1.6,4.2",
      "2.0,3.4,1.4,3.9",
      "2.4,2.9,1.7,4.1",
      "2.2,3.1,1.5,4.3",
      "2.5,3.3,1.6,4.0",
      "2.1,3.0,1.8,4.1",
      "2.3,3.2,1.5,3.8",
      "2.4,3.1,1.7,4.2",
      "2.0,3.3,1.4,4.0",
      "2.2,2.8,1.6,4.1",
      "2.3,3.4,1.5,4.2",
    ].join("\n");

    const bodyHtml = `
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Multivariate data matrix</h4>
            <div class="muted small" style="margin-bottom:8px">Rows = observations; columns = variables. CSV (comma or tab). Non-numeric header rows are skipped automatically.</div>
            <label>
              Variable names (comma-separated, optional)
              <input type="text" id="pcaNames" value="V1,V2,V3,V4" />
            </label>
            <label>
              Data matrix
              <textarea id="pcaMatrix" rows="14" style="min-height:220px;font-family:ui-monospace,monospace">${defaultCsv}</textarea>
            </label>
            <div class="muted small" style="margin-top:8px">
              <strong>Import CSV / Excel:</strong> rows = observations, columns = variables (same as pasted matrix). Optional header row with variable names — also paste names into the field above if needed.
            </div>
            <div class="actions" style="margin-top:8px">
              <button class="action-btn" type="button" id="pcaImportCsv">Import CSV / Excel</button>
              <input type="file" id="pcaCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <p class="note" style="margin:0">Analysis uses <strong>correlation PCA</strong>: each column is centered and scaled to <strong>unit variance</strong> before extracting components.</p>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="pcaCompute">Compute PCA</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div class="chart" style="height:220px;margin-top:8px">
              <canvas id="pcaScree" style="width:100%;height:100%"></canvas>
            </div>
            <div class="chart" style="height:280px;margin-top:8px">
              <canvas id="pcaBiplot" style="width:100%;height:100%"></canvas>
            </div>
            <div id="pcaTableWrap" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "pca",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["explained1"],
    });

    $("#pcaCompute").onclick = () => {
      clearValidation("#contentBody");
      const errors = [];
      const txt = $("#pcaMatrix").value || "";
      let mat = parseNumericCsvMatrix(txt);
      if (!mat.length) errors.push("PCA: paste a numeric matrix (≥3 rows, ≥2 columns).");
      const n0 = mat.length;
      const p0 = mat[0]?.length || 0;
      for (let i = 0; i < n0; i++) {
        if (!mat[i] || mat[i].length !== p0) {
          errors.push(`PCA: inconsistent columns in row ${i + 1}.`);
          break;
        }
      }
      if (n0 < 3) errors.push("PCA: need at least 3 observations (rows).");
      if (p0 < 2) errors.push("PCA: need at least 2 variables (columns).");
      if (shouldBlockForValidation("pca", errors, "#pcaTableWrap")) return;

      const rawNames = ($("#pcaNames").value || "").split(",").map((s) => s.trim()).filter(Boolean);
      const p = p0;
      const varNames = Array.from({ length: p }, (_, j) => rawNames[j] || `V${j + 1}`);

      const X = mat.map((row) => row.map((v) => (Number.isFinite(v) ? v : 0)));
      const { Z } = zScoreColumns(X);
      const out = pcaFromStandardizedZ(Z);
      if (!out) {
        $("#pcaTableWrap").innerHTML = `<p class="note">PCA could not run (check dimensions).</p>`;
        return;
      }

      const n = out.n;
      const scores12 = out.scores.map((row) => [row[0], row[1]]);
      const load12 = out.loadings.map((row) => [row[0], row[1]]);

      drawBarChart(
        $("#pcaScree"),
        out.vals.map((_, i) => `PC${i + 1}`),
        out.vals,
        { title: "Scree plot (eigenvalues λ of correlation matrix)" }
      );
      drawPcaBiplot($("#pcaBiplot"), scores12, load12, varNames, { title: "Biplot — scores (●) & variable loadings (arrows)" });

      const flat = X.flat();
      const pcaOut = outlierFlags(flat);
      const pc1Pct = out.propPct[0] || 0;
      const qItemsPCA = [
        { check: "Sample size adequacy", pass: n >= 5, note: `n=${n}, p=${p}` },
        { check: "Outlier load (IQR, pooled)", pass: pcaOut.count <= Math.max(1, Math.floor(flat.length * 0.1)), note: `${pcaOut.count} flagged cell(s).` },
        { check: "PC1 variance share", pass: pc1Pct >= 20, note: `PC1=${pc1Pct.toFixed(1)}%` },
      ];
      if (strictModeShouldBlock("pca", qItemsPCA, "#pcaTableWrap")) return;

      const eigRows = out.vals.map((lam, k) => [`PC${k + 1}`, lam, out.propPct[k], out.cumPct[k]]);
      const tEig = buildTable(["PC", "Eigenvalue λ", "Variance % (of total p)", "Cumulative %"], eigRows);

      const cosRows = varNames.map((nm, j) => [nm, out.cos2[j].pc1, out.cos2[j].pc2, out.cos2[j].plane12]);
      const tCos = buildTable(
        ["Variable", "cos²(PC1) = r²", "cos²(PC2) = r²", "cos²(plane PC1+PC2)"],
        cosRows
      );

      const maxLoadCols = Math.min(8, p);
      const loadRows = out.loadings.map((row, j) => [varNames[j], ...row.slice(0, maxLoadCols)]);
      const tLoad = buildTable(
        ["Variable", ...Array.from({ length: maxLoadCols }, (_, k) => `Loading PC${k + 1}`)],
        loadRows
      );

      $("#pcaTableWrap").innerHTML = `${qualityScoreHtml(qItemsPCA)}<div style="height:10px"></div><h4>Eigenvalues & variance explained</h4>${tEig}<div style="height:10px"></div><h4>Cos² — quality of representation (squared correlations)</h4><p class="note" style="margin:4px 0 8px">Loadings are correlations between each standardized variable and each PC. cos² = squared loading. On the PC1–PC2 plane: cos²(PC1)+cos²(PC2).</p>${tCos}<div style="height:10px"></div><h4>Loadings (variable–PC correlations)</h4>${tLoad}<div style="height:10px"></div>${assumptionsChecklistHtml("Assumption checklist", [
        { assumption: "Linear correlation / covariance structure", status: "Assumed", note: "PCA uses second moments of standardized data." },
        { assumption: "Adequate spread per variable", status: "Recommended", note: "Near-zero variance columns are unstable after scaling." },
      ])}`;

      const deviationHtml = deviationBanner("pca", { explained1: pc1Pct }, ["explained1"]);

      const interpretation =
        `Correlation PCA: each variable was z-scored (mean 0, variance 1), then principal components were extracted from the correlation matrix.\n\n` +
        `• PC1 explains ${pc1Pct.toFixed(2)}% of total standardized variance (sum of eigenvalues = number of variables).\n` +
        `• Use the scree plot to judge how many PCs to retain (look for an elbow).\n` +
        `• Biplot: points are observation scores on PC1 vs PC2; arrows show variable loading directions (lengths scaled for display—relative geometry preserved).\n` +
        `• cos² on the PC1–PC2 plane indicates how well each variable is represented in that 2D subspace.`;

      setInterpretation("pca", interpretation, deviationHtml || "", {
        explained1: pc1Pct,
        l1: out.vals[0],
        l2: out.vals[1],
      });
      setRunMeta("pca", {
        forceRun: isForceRunEnabled(),
        inputSize: `n=${n}, p=${p}`,
        standardization: "z-score columns (unit variance)",
        preprocessing: "Correlation matrix PCA",
        qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsPCA.map((x) => (x.pass ? 100 : 45))))))} / 100`,
      });
    };

    bindCsvExcelToTextarea("pcaImportCsv", "pcaCsvFile", "pcaMatrix");

    $("#pcaCompute").click();
  }

  // --- Path Analysis (calculator; correlation matrix -> direct/indirect effects) ---
  function renderPathCalculator() {
    const title = "Path Analysis (Calculator) - Direct & Indirect Effects";
    showContentHeader({
      title,
      subtitle: "Enter a correlation matrix for predictors (X) and response (Y). BKQuant computes standardized path coefficients.",
    });

    const defaultP = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Correlation matrix</div></div>
        <div class="kpi"><div class="label">Output</div><div class="value">Direct + indirect effects</div></div>
        <div class="kpi"><div class="label">Diagram</div><div class="value">Exportable path diagram</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Inputs</h4>
            <div class="input-grid">
              <label>
                Number of predictors (p)
                <input type="number" min="2" max="6" id="pathP" value="${defaultP}" />
              </label>
              <label>
                Predictor names (comma separated)
                <input type="text" id="pathNames" value="X1, X2, X3" />
              </label>
              <label>
                Response name (Y)
                <input type="text" id="pathYname" value="Yield" />
              </label>
              <button class="action-btn primary2" type="button" id="pathBuild">Build matrix</button>
              <div class="note" style="margin:0">
                Fill predictor inter-correlations (Rxx) and correlations with Y (r<sub>xy</sub>). Diagonals are 1.
              </div>
            </div>
            <div id="pathMatrixWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="pathCompute">Compute path</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="pathKpis"></div>
            <div class="chart" style="height:320px;margin-top:12px;display:grid;place-items:center">
              <svg id="pathSvg" data-exportable="1" viewBox="0 0 860 360" width="100%" height="100%" style="overflow:visible"></svg>
            </div>
            <div id="pathTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "path",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["residual"],
    });

    function cleanNames(p) {
      const raw = ($("#pathNames").value || "").split(",").map((s) => s.trim()).filter(Boolean);
      const out = [];
      for (let i = 0; i < p; i++) out.push(raw[i] || `X${i + 1}`);
      $("#pathNames").value = out.join(", ");
      return out;
    }

    function buildMatrix(p) {
      const names = cleanNames(p);
      const yName = ($("#pathYname").value || "Y").trim() || "Y";
      const wrap = $("#pathMatrixWrap");
      wrap.innerHTML = "";

      const table = document.createElement("table");
      table.className = "data";
      const headers = ["", ...names, `r(·, ${yName})`];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;

      const rows = [];
      for (let i = 0; i < p; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          const isDiag = i === j;
          const defaultVal =
            isDiag ? 1 :
            (i < j ? (0.15 + (i + 1) * 0.09 + (j + 1) * 0.05) : null);
          if (defaultVal === null) {
            // lower triangle will mirror; leave readonly
            cells.push(`<td class="muted small" style="font-weight:850">—</td>`);
          } else {
            const v = Math.max(-0.95, Math.min(0.95, defaultVal));
            cells.push(
              `<td><input type="number" step="0.01" min="-0.99" max="0.99" value="${v.toFixed(2)}" data-r="x${i}x${j}" ${isDiag ? "readonly" : ""}/></td>`
            );
          }
        }
        const ry = 0.35 + i * 0.18 + (i === 1 ? -0.12 : 0);
        cells.push(`<td><input type="number" step="0.01" min="-0.99" max="0.99" value="${Math.max(-0.95, Math.min(0.95, ry)).toFixed(2)}" data-ry="x${i}y"/></td>`);
        rows.push(`<tr><th>${qs(names[i])}</th>${cells.join("")}</tr>`);
      }

      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);

      // Mirror upper -> lower and keep symmetry
      for (let i = 0; i < p; i++) {
        for (let j = i + 1; j < p; j++) {
          const input = wrap.querySelector(`input[data-r="x${i}x${j}"]`);
          input?.addEventListener("input", () => {
            // show mirrored value in a small badge by converting the lower triangle cell to a value display
            const lowerCell = input.closest("table")?.querySelector(`tbody tr:nth-child(${j + 1}) td:nth-child(${i + 2})`);
            if (lowerCell) {
              lowerCell.innerHTML = `<span class="muted small" style="font-weight:900">${qs(String(input.value || ""))}</span>`;
            }
          });
          // initialize mirror display
          input?.dispatchEvent(new Event("input"));
        }
      }
    }

    buildMatrix(defaultP);

    $("#pathBuild").addEventListener("click", () => {
      const p = Math.max(2, Math.min(6, Number($("#pathP").value || defaultP)));
      buildMatrix(p);
    });

    function readCorrelationInputs(p) {
      const wrap = $("#pathMatrixWrap");
      const Rxx = Array.from({ length: p }, () => Array(p).fill(0));
      const rxy = Array(p).fill(0);
      const errors = [];
      clearValidation("#pathMatrixWrap");

      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          if (i === j) {
            Rxx[i][j] = 1;
            continue;
          }
          if (i < j) {
            const input = wrap.querySelector(`input[data-r="x${i}x${j}"]`);
            const v = Number(input?.value ?? NaN);
            if (!Number.isFinite(v)) {
              errors.push(`Path: invalid correlation at X${i + 1}, X${j + 1}`);
              markInvalidInput(input, "Enter numeric correlation");
            } else if (v < -1 || v > 1) {
              errors.push(`Path: correlation out of range at X${i + 1}, X${j + 1}`);
              markInvalidInput(input, "Correlation must be between -1 and 1");
            }
            const val = Number.isFinite(v) ? v : 0;
            Rxx[i][j] = val;
            Rxx[j][i] = val;
          }
        }
        const iy = wrap.querySelector(`input[data-ry="x${i}y"]`);
        const vy = Number(iy?.value ?? NaN);
        if (!Number.isFinite(vy)) {
          errors.push(`Path: invalid r(X${i + 1},Y) value`);
          markInvalidInput(iy, "Enter numeric correlation with Y");
        } else if (vy < -1 || vy > 1) {
          errors.push(`Path: r(X${i + 1},Y) out of range`);
          markInvalidInput(iy, "Correlation must be between -1 and 1");
        }
        rxy[i] = Number.isFinite(vy) ? vy : 0;
      }
      errors.push(...matrixValidationErrors(Rxx, { minVal: -1, maxVal: 1, requireUnitDiag: true }));
      return { Rxx, rxy, errors };
    }

    $("#pathCompute").addEventListener("click", () => {
      const p = Math.max(2, Math.min(6, Number($("#pathP").value || defaultP)));
      const names = cleanNames(p);
      const yName = ($("#pathYname").value || "Y").trim() || "Y";

      const { Rxx, rxy, errors } = readCorrelationInputs(p);
      if (shouldBlockForValidation("path", errors, "#pathKpis")) return;
      const out = computeStandardizedPathModel(Rxx, rxy);
      if (!out.ok) {
        $("#pathKpis").innerHTML = `<div class="note">Matrix inversion failed. Check correlations (matrix may be singular).</div>`;
        $("#pathTables").innerHTML = "";
        $("#pathSvg").innerHTML = "";
        setInterpretation(
          "path",
          "Path analysis could not be computed because the predictor correlation matrix is singular/unstable. Adjust correlations or reduce predictors.",
          "",
          null
        );
        return;
      }
      const P = out.P;
      const indirect = out.indirect;
      const reproduced = out.reproduced;
      const residual = out.residual;

      // KPIs
      const maxAbs = Math.max(...P.map((x) => Math.abs(x)));
      const topIdx = P.map((v, i) => ({ v, i })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0]?.i ?? 0;
      $("#pathKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">Top direct effect</div><div class="value">${qs(names[topIdx])}: ${P[topIdx].toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Max |direct|</div><div class="value">${maxAbs.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Residual effect</div><div class="value">${residual.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Predictors</div><div class="value">${p}</div></div>
        </div>
      `;

      renderPathDiagramSvg($("#pathSvg"), { names, yName, pCoeffs: P, Rxx, rxy, residual });

      // Table 1: Direct effects
      const t1 = buildTable(
        ["Predictor", "Direct effect (p_iY)", "r(i,Y)"],
        names.map((nm, i) => [nm, P[i], rxy[i]])
      );

      // Table 2: Indirect effects
      const indHeaders = ["Predictor", ...names.map((n) => `via ${n}`), "Total indirect", "Reproduced r(i,Y)"];
      const indRows = names.map((nm, i) => {
        const via = names.map((_, j) => (i === j ? 0 : indirect[i][j]));
        const totalInd = via.reduce((a, b) => a + b, 0);
        return [nm, ...via, totalInd, reproduced[i]];
      });
      const t2 = buildTable(indHeaders, indRows);

      // Table 3: Check reproduced correlation vs observed
      const t3 = buildTable(
        ["Predictor", "Observed r(i,Y)", "Reproduced r(i,Y)", "Difference"],
        names.map((nm, i) => [nm, rxy[i], reproduced[i], reproduced[i] - rxy[i]])
      );

      $("#pathTables").innerHTML = `${t1}<div style="height:10px"></div>${t2}<div style="height:10px"></div>${t3}`;

      const deviationHtml = deviationBanner("path", { residual }, ["residual"]);
      const interpretation =
        `Path analysis decomposes correlation r(i,Y) into a direct effect (p_iY) plus indirect effects via other predictors.\n\n` +
        `Direct effects (standardized): computed as P = Rxx^{-1} rxy.\n` +
        `Residual effect = sqrt(1 - Σ r(i,Y)·p_iY) = ${residual.toFixed(3)}.\n\n` +
        `Interpretation:\n` +
        `• A large positive direct effect indicates a trait is a strong selection criterion for improving ${yName}.\n` +
        `• A negative direct effect means increasing that trait may reduce ${yName} when other predictors are controlled.\n` +
        `• If reproduced correlations differ notably from observed values, the assumed causal model (predictors set) may be incomplete.`;

      setInterpretation("path", interpretation, deviationHtml || "", { residual });
    });

    $("#pathCompute").click();
  }

  // --- Correlation matrices (phenotypic + genotypic) + path analysis from data ---
  function renderCorrelationPath() {
    const title = "Correlation & Path (Phenotypic / Genotypic)";
    showContentHeader({
      title,
      subtitle:
        "Pearson correlation matrices with two-tailed p-values; genotypic R among genotype means; path coefficients (direct/indirect) and residual effect on a chosen response trait.",
    });

    const sampleCPA = `Genotype,Height,Yield,Grain_wt,Protein
G1,1.20,42.1,2.45,12.1
G1,1.28,41.5,2.40,12.0
G2,1.15,38.2,2.30,12.0
G2,1.18,38.5,2.32,11.9
G3,1.22,44.0,2.50,12.2
G3,1.25,43.5,2.48,12.1
G4,1.10,35.0,2.20,11.8
G4,1.12,35.8,2.22,11.7`;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Phenotypic</div><div class="value">Plot-level r</div></div>
        <div class="kpi"><div class="label">Genotypic</div><div class="value">Means by genotype</div></div>
        <div class="kpi"><div class="label">Path</div><div class="value">Direct + indirect + U</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Trait matrix</h4>
            <div class="muted small" style="margin-bottom:8px">
              Rows = plots or lines; columns = quantitative traits. Optional header row: first column = genotype ID (text), remaining columns = traits.
              If all cells are numeric, rows are labeled G1…Gn (one observation per row = phenotypic and genotypic matrices coincide unless you repeat genotypes).
            </div>
            <label>
              Data
              <textarea id="cpaData" rows="14" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${sampleCPA}</textarea>
            </label>
            <div class="muted small" style="margin-top:8px">
              <strong>Import CSV / Excel:</strong> same layout as the box (optional Genotype column + trait columns). First sheet only for Excel.
            </div>
            <button class="action-btn" type="button" id="cpaImportCsv" style="margin-top:6px">Import CSV / Excel</button>
            <input type="file" id="cpaCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            <div class="input-grid" style="margin-top:10px">
              <label>
                Target trait (Y)
                <select id="cpaTarget"></select>
              </label>
              <label>
                Path model uses
                <select id="cpaPathBasis">
                  <option value="pheno">Phenotypic correlations</option>
                  <option value="geno">Genotypic correlations</option>
                </select>
              </label>
            </div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="cpaCompute">Compute matrices & path</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Path diagram</h4>
            <div class="chart" style="height:320px;margin-top:8px;display:grid;place-items:center">
              <svg id="cpaSvg" data-exportable="1" viewBox="0 0 860 360" width="100%" height="100%" style="overflow:visible"></svg>
            </div>
            <div id="cpaKpis"></div>
          </div>
        </div>
      </div>
      <div class="section" style="margin-top:12px">
        <h4>Phenotypic correlation &amp; p-values</h4>
        <div id="cpaPhenoWrap"></div>
      </div>
      <div class="section" style="margin-top:12px">
        <h4>Genotypic correlation &amp; p-values</h4>
        <div class="muted small" style="margin-bottom:8px" id="cpaGenoNote"></div>
        <div id="cpaGenoWrap"></div>
      </div>
      <div class="section" style="margin-top:12px">
        <h4>Path analysis (partition of r with Y)</h4>
        <div id="cpaPathWrap"></div>
      </div>
    `;

    moduleShell({
      moduleId: "corpath",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["residual"],
    });

    bindCsvExcelToTextarea("cpaImportCsv", "cpaCsvFile", "cpaData");

    function correlationPairTables(R, Pv, names, nObs, labelR, labelP) {
      const hdr = ["Trait", ...names];
      const rowsR = names.map((nm, i) => [nm, ...R[i].map((v) => (Number.isFinite(v) ? v.toFixed(4) : "—"))]);
      const rowsP = names.map((nm, i) => [
        nm,
        ...Pv[i].map((pv, j) => (i === j ? "—" : formatCorrelationPValueCell(pv))),
      ]);
      return (
        `<div class="muted small">${qs(labelR)} (n = ${nObs})</div>` +
        buildTable(hdr, rowsR) +
        `<div style="height:8px"></div><div class="muted small">${qs(labelP)} — two-tailed, H₀: ρ = 0; df = n − 2 for off-diagonal.</div>` +
        buildTable(hdr, rowsP)
      );
    }

    $("#cpaCompute").addEventListener("click", () => {
      clearValidation("#contentBody");
      const errors = [];
      const parsed = parseBiometricTraitMatrix($("#cpaData").value);
      if (parsed.error) {
        errors.push(`Correlation & Path: ${parsed.error}`);
        markInvalidInput($("#cpaData"), parsed.error);
      }
      if (shouldBlockForValidation("corpath", errors, "#cpaPhenoWrap")) return;

      const { rowNames, colNames, data: X0 } = parsed;
      const nPlots = X0.length;
      const pTraits = colNames.length;
      if (nPlots < 3) {
        errors.push("Need at least 3 observations (rows) for correlation inference.");
        markInvalidInput($("#cpaData"), "At least 3 rows required");
      }
      if (pTraits < 2) {
        errors.push("Need at least 2 trait columns.");
        markInvalidInput($("#cpaData"), "At least 2 trait columns");
      }
      if (shouldBlockForValidation("corpath", errors, "#cpaPhenoWrap")) return;

      const sel = $("#cpaTarget");
      const prev = (sel.value || "").trim();
      sel.innerHTML = colNames.map((n) => `<option value="${qs(n)}">${qs(n)}</option>`).join("");
      const prevIdx = colNames.findIndex((c) => c === prev);
      const yieldGuess = colNames.findIndex((c) => String(c).toLowerCase().includes("yield"));
      const yIndex = prevIdx >= 0 ? prevIdx : yieldGuess >= 0 ? yieldGuess : colNames.length - 1;
      sel.selectedIndex = yIndex;

      const Rp = pearsonCorrelationMatrix(X0);
      const Pp = buildCorrelationPValueMatrix(Rp, nPlots);

      const agg = aggregateTraitMeansByGenotype(rowNames, X0);
      const Xg = agg.means;
      const nGeno = Xg.length;
      const Rg = pearsonCorrelationMatrix(Xg);
      const Pg = buildCorrelationPValueMatrix(Rg, nGeno);

      $("#cpaPhenoWrap").innerHTML = correlationPairTables(
        Rp,
        Pp,
        colNames,
        nPlots,
        "Phenotypic Pearson r (plot observations)",
        "Significance (p-values)"
      );

      const genoNote = $("#cpaGenoNote");
      genoNote.innerHTML = `Genotypic correlations are computed among genotype means (averaging rows that share the same genotype label). Number of genotype levels = ${nGeno}.`;
      $("#cpaGenoWrap").innerHTML = correlationPairTables(
        Rg,
        Pg,
        colNames,
        nGeno,
        "Genotypic Pearson r (genotype means)",
        "Significance (p-values)"
      );

      const basis = $("#cpaPathBasis").value === "geno" ? "geno" : "pheno";
      const Ruse = basis === "geno" ? Rg : Rp;
      const nUse = basis === "geno" ? nGeno : nPlots;
      const yName = colNames[yIndex];
      const predIdx = colNames.map((_, i) => i).filter((i) => i !== yIndex);
      if (!predIdx.length) {
        $("#cpaKpis").innerHTML = `<div class="note">Select a target trait that is not the only column.</div>`;
        $("#cpaPathWrap").innerHTML = "";
        $("#cpaSvg").innerHTML = "";
        return;
      }

      const { Rxx, rxy } = pathInputsFromFullCorrelation(Ruse, yIndex, predIdx);
      const pathOut = computeStandardizedPathModel(Rxx, rxy);
      const predNames = predIdx.map((i) => colNames[i]);

      if (!pathOut.ok) {
        $("#cpaKpis").innerHTML = `<div class="note">Path analysis failed: predictor correlation matrix is singular. Try fewer traits or a different target.</div>`;
        $("#cpaPathWrap").innerHTML = "";
        $("#cpaSvg").innerHTML = "";
        setInterpretation(
          "corpath",
          "Could not invert the predictor correlation matrix for path analysis. Traits may be linearly dependent.",
          "",
          null
        );
        return;
      }

      const P = pathOut.P;
      const indirect = pathOut.indirect;
      const reproduced = pathOut.reproduced;
      const residual = pathOut.residual;

      $("#cpaKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr));margin-top:10px">
          <div class="kpi"><div class="label">Basis</div><div class="value">${basis === "geno" ? "Genotypic" : "Phenotypic"}</div></div>
          <div class="kpi"><div class="label">n for path</div><div class="value">${nUse}</div></div>
          <div class="kpi"><div class="label">Residual U</div><div class="value">${residual.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Predictors</div><div class="value">${predNames.length}</div></div>
        </div>
      `;

      renderPathDiagramSvg($("#cpaSvg"), { names: predNames, yName, pCoeffs: P, Rxx, rxy, residual });

      const t1 = buildTable(
        ["Predictor", "Direct effect (p_iY)", `r(i, ${yName})`],
        predNames.map((nm, i) => [nm, P[i], rxy[i]])
      );
      const indHeaders = ["Predictor", ...predNames.map((n) => `via ${n}`), "Total indirect", `Reproduced r(i,${yName})`];
      const indRows = predNames.map((nm, i) => {
        const via = predNames.map((_, j) => (i === j ? 0 : indirect[i][j]));
        const totalInd = via.reduce((a, b) => a + b, 0);
        return [nm, ...via, totalInd, reproduced[i]];
      });
      const t2 = buildTable(indHeaders, indRows);
      const t3 = buildTable(
        ["Predictor", `Observed r(i,${yName})`, `Reproduced r(i,${yName})`, "Difference"],
        predNames.map((nm, i) => [nm, rxy[i], reproduced[i], reproduced[i] - rxy[i]])
      );

      $("#cpaPathWrap").innerHTML = `
        <div class="muted small" style="margin-bottom:8px">
          Standardized path coefficients: <strong>P = R<sub>xx</sub><sup>−1</sup> r<sub>xY</sub></strong>, with R taken from <strong>${basis === "geno" ? "genotypic" : "phenotypic"}</strong> correlations.
          Residual path <strong>U = √(1 − Σ r(i,Y)·p_iY)</strong> captures unexplained variation in the causal system.
        </div>
        ${t1}<div style="height:10px"></div>${t2}<div style="height:10px"></div>${t3}
      `;

      const deviationHtml = deviationBanner("corpath", { residual }, ["residual"]);
      const interpretation =
        `Phenotypic correlations use all ${nPlots} plot-level observations; p-values use df = n − 2 per pair.\n` +
        `Genotypic correlations use ${nGeno} genotype means (labels from the first column or row order).\n\n` +
        `Path analysis on ${yName} uses ${basis === "geno" ? "genotypic" : "phenotypic"} correlations among predictors and with Y. ` +
        `Residual effect U = ${residual.toFixed(3)} (unexplained correlation structure). ` +
        `Compare reproduced vs observed r(i,Y) to judge whether the additive path model fits.`;

      setInterpretation("corpath", interpretation, deviationHtml || "", { residual });
      setRunMeta("corpath", {
        forceRun: isForceRunEnabled(),
        inputSize: `plots=${nPlots}, genotypes=${nGeno}, traits=${pTraits}`,
        standardization: "correlation-based path (standardized)",
        preprocessing: `Target=${yName}; basis=${basis}`,
        qualityScore: `${Math.min(100, 55 + Math.min(nPlots, 30))} / 100`,
      });
    });

    $("#cpaCompute").click();
  }

  // --- Line x Tester (calculator) ---
  function renderLineTester() {
    const title = "Line x Tester Design (Calculator)";
    showContentHeader({
      title,
      subtitle:
        "RCBD-style partition: Replication, Lines, Testers, L×T, Error; optional check contrast; GCA/SCA with SE, variance %, genetic advance, and potence ratio.",
    });

    const defaultL = 3;
    const defaultT = 3;
    const defaultR = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design</div><div class="value">Line × Tester × Reps</div></div>
        <div class="kpi"><div class="label">Partition</div><div class="value">Rep + Line + Tester + L×T (+Check)</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">ANOVA, SE, GA, potence</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="input-grid" id="ltControls">
              <div class="two-col">
                <label>
                  Number of lines (l)
                  <input type="number" min="2" id="ltL" value="${defaultL}" />
                </label>
                <label>
                  Number of testers (t)
                  <input type="number" min="2" id="ltT" value="${defaultT}" />
                </label>
              </div>
              <label>
                Replications (r)
                <input type="number" min="2" id="ltR" value="${defaultR}" />
              </label>
              <label>
                Selection intensity (k) for genetic advance
                <input type="number" min="0" step="0.01" id="ltSelK" value="2.06" title="e.g. 2.06 for top 5% selection" />
              </label>
              <label>
                Optional check cultivars (0 = none, 1 = one check with r plot values)
                <input type="number" min="0" max="1" id="ltNumChecks" value="0" />
              </label>
              <div id="ltCheckWrap" class="note" style="margin:0;display:none"></div>
              <button class="action-btn primary2" type="button" id="ltBuild">Build grid</button>
              <div class="note" style="margin:0">
                Rows are crosses (L<sub>i</sub>×T<sub>j</sub>), columns are replications (R1..Rr). Blocks = replications. Optional check is analyzed as a contrast vs hybrid mean (not pooled into factorial SS).
              </div>
            </div>
            <div id="ltGridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="ltCompute">Compute Line x Tester</button>
              <button class="action-btn" type="button" id="ltImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="ltTemplateCsv">Download template CSV</button>
              <input type="file" id="ltCsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="ltKpis"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="ltBar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="ltTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "linetester",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fLine", "fTester", "fLT", "potence", "gaPct"],
    });

    function refreshCheckInputs() {
      const wrap = $("#ltCheckWrap");
      if (!wrap) return;
      const nc = Math.max(0, Math.min(1, Number($("#ltNumChecks")?.value || 0)));
      const r = Math.max(2, Number($("#ltR")?.value || defaultR));
      if (nc < 1) {
        wrap.style.display = "none";
        wrap.innerHTML = "";
        return;
      }
      wrap.style.display = "block";
      const cells = [];
      for (let k = 0; k < r; k++) cells.push(`<label style="display:inline-block;margin-right:8px">R${k + 1} <input type="number" step="0.01" id="ltCheckR${k}" value="${(18 + k * 0.5).toFixed(2)}" /></label>`);
      wrap.innerHTML = `<div class="note" style="margin:0">Check variety — plot values (same reps as experiment):</div><div style="margin-top:6px">${cells.join("")}</div>`;
    }

    function buildGrid(l, t, r) {
      const wrap = $("#ltGridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Cross / Rep"];
      for (let k = 0; k < r; k++) headers.push(`R${k + 1}`);
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;

      const rows = [];
      for (let i = 0; i < l; i++) {
        for (let j = 0; j < t; j++) {
          const cells = [];
          for (let k = 0; k < r; k++) {
            const lineEff = (i + 1) * 3.2;
            const testerEff = (j + 1) * 2.4;
            const scaEff = (i === 1 && j === 2) ? 2.5 : (i === 2 && j === 0 ? -1.3 : 0.3);
            const repEff = (k - (r - 1) / 2) * 0.8;
            const val = 20 + lineEff + testerEff + scaEff + repEff + ((i + j + k) % 2 ? 0.2 : -0.15);
            cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-cell="l${i}t${j}r${k}" /></td>`);
          }
          rows.push(`<tr><th>${qs(`L${i + 1}xT${j + 1}`)}</th>${cells.join("")}</tr>`);
        }
      }

      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildGrid(defaultL, defaultT, defaultR);
    refreshCheckInputs();

    $("#ltBuild").addEventListener("click", () => {
      const l = Math.max(2, Number($("#ltL").value || defaultL));
      const t = Math.max(2, Number($("#ltT").value || defaultT));
      const r = Math.max(2, Number($("#ltR").value || defaultR));
      buildGrid(l, t, r);
      refreshCheckInputs();
    });
    $("#ltNumChecks")?.addEventListener("change", refreshCheckInputs);
    $("#ltR")?.addEventListener("change", refreshCheckInputs);

    $("#ltTemplateCsv").addEventListener("click", () => {
      const l = Math.max(2, Number($("#ltL").value || defaultL));
      const t = Math.max(2, Number($("#ltT").value || defaultT));
      const r = Math.max(2, Number($("#ltR").value || defaultR));
      const headers = Array.from({ length: r }, (_, k) => `R${k + 1}`);
      const rows = [headers];
      for (let i = 0; i < l; i++) {
        for (let j = 0; j < t; j++) {
          rows.push(Array.from({ length: r }, (_, k) => (20 + i * 3 + j * 2 + k * 0.5).toFixed(2)));
        }
      }
      triggerCsvDownload("line_tester_matrix_template.csv", rows);
    });
    $("#ltImportCsv").addEventListener("click", () => $("#ltCsvFile").click());
    $("#ltCsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const mat = parseNumericCsvMatrix(txt);
      if (!mat.length) return;
      const totalRows = mat.length;
      const r = Math.max(2, Math.min(20, mat[0].length || defaultR));
      const l = Math.max(2, Math.min(20, Number($("#ltL").value || defaultL)));
      const t = Math.max(2, Math.floor(totalRows / l));
      $("#ltR").value = String(r);
      $("#ltT").value = String(t);
      buildGrid(l, t, r);
      let idx = 0;
      for (let i = 0; i < l; i++) for (let j = 0; j < t; j++) {
        const row = mat[idx++] || [];
        for (let k = 0; k < r; k++) {
          const v = row[k];
          if (!Number.isFinite(v)) continue;
          const input = document.querySelector(`#ltGridWrap input[data-cell="l${i}t${j}r${k}"]`);
          if (input) input.value = String(v);
        }
      }
      $("#ltCompute").click();
      e.target.value = "";
    });

    $("#ltCompute").addEventListener("click", () => {
      const l = Math.max(2, Number($("#ltL").value || defaultL));
      const t = Math.max(2, Number($("#ltT").value || defaultT));
      const r = Math.max(2, Number($("#ltR").value || defaultR));
      const kSel = Math.max(0, Number($("#ltSelK")?.value || 2.06));

      // y[i][j][k]
      const y = [];
      for (let i = 0; i < l; i++) {
        y[i] = [];
        for (let j = 0; j < t; j++) {
          y[i][j] = [];
          for (let k = 0; k < r; k++) {
            const input = document.querySelector(`#ltGridWrap input[data-cell="l${i}t${j}r${k}"]`);
            const v = Number(input?.value ?? NaN);
            y[i][j][k] = Number.isFinite(v) ? v : 0;
          }
        }
      }

      const N = l * t * r;
      let sumY2 = 0;
      let G = 0;
      const repTotals = Array(r).fill(0);
      const lineTotals = Array(l).fill(0);
      const testerTotals = Array(t).fill(0);
      const crossTotals = Array.from({ length: l }, () => Array(t).fill(0));

      for (let i = 0; i < l; i++) {
        for (let j = 0; j < t; j++) {
          for (let k = 0; k < r; k++) {
            const v = y[i][j][k];
            sumY2 += v * v;
            G += v;
            repTotals[k] += v;
            lineTotals[i] += v;
            testerTotals[j] += v;
            crossTotals[i][j] += v;
          }
        }
      }

      const CF = (G * G) / N;
      const ssTotal = sumY2 - CF;

      let ssRep = 0;
      for (let k = 0; k < r; k++) ssRep += (repTotals[k] * repTotals[k]) / (l * t);
      ssRep -= CF;

      let ssLine = 0;
      for (let i = 0; i < l; i++) ssLine += (lineTotals[i] * lineTotals[i]) / (t * r);
      ssLine -= CF;

      let ssTester = 0;
      for (let j = 0; j < t; j++) ssTester += (testerTotals[j] * testerTotals[j]) / (l * r);
      ssTester -= CF;

      let ssCrossTotal = 0;
      for (let i = 0; i < l; i++) for (let j = 0; j < t; j++) ssCrossTotal += (crossTotals[i][j] * crossTotals[i][j]) / r;
      ssCrossTotal -= CF;
      const ssLT = ssCrossTotal - ssLine - ssTester;
      const ssError = ssTotal - ssRep - ssLine - ssTester - ssLT;

      const dfRep = r - 1;
      const dfLine = l - 1;
      const dfTester = t - 1;
      const dfLT = (l - 1) * (t - 1);
      const dfError = (r - 1) * (l * t - 1);
      const dfTotal = N - 1;

      const msRep = ssRep / Math.max(1, dfRep);
      const msLine = ssLine / dfLine;
      const msTester = ssTester / dfTester;
      const msLT = dfLT > 0 ? ssLT / dfLT : 0;
      const msError = ssError / dfError;

      const fRep = msError === 0 ? 0 : msRep / msError;
      const fLine = msError === 0 ? 0 : msLine / msError;
      const fTester = msError === 0 ? 0 : msTester / msError;
      const fLT = msError === 0 ? 0 : msLT / msError;

      const sigLine = approxFSignificance(fLine, dfLine, dfError);
      const sigTester = approxFSignificance(fTester, dfTester, dfError);
      const sigLT = approxFSignificance(fLT, dfLT, dfError);

      // Means, GCA, SCA
      const grandMean = G / N;
      const lineMeans = lineTotals.map((tot) => tot / (t * r));
      const testerMeans = testerTotals.map((tot) => tot / (l * r));
      const crossMeans = crossTotals.map((row) => row.map((tot) => tot / r));

      const gcaLine = lineMeans.map((m) => m - grandMean);
      const gcaTester = testerMeans.map((m) => m - grandMean);
      const sca = Array.from({ length: l }, () => Array(t).fill(0));
      for (let i = 0; i < l; i++) {
        for (let j = 0; j < t; j++) {
          sca[i][j] = crossMeans[i][j] - lineMeans[i] - testerMeans[j] + grandMean;
        }
      }

      const pct = lineTesterHybridVariancePct(ssLine, ssTester, ssLT);
      const se = lineTesterSEs(msError, r, l, t);
      const ga = lineTesterGeneticAdvance(msLine, msError, r, t, grandMean, kSel);
      const pot = lineTesterPotenceRatio(msLine, msTester, msLT, msError, r, l, t);

      const nc = Math.max(0, Math.min(1, Number($("#ltNumChecks")?.value || 0)));
      let checkContrast = null;
      let fCheck = "";
      let sigCheck = { level: "", note: "" };
      if (nc >= 1) {
        const chk = [];
        for (let k = 0; k < r; k++) {
          const v = Number(document.querySelector(`#ltCheckR${k}`)?.value ?? NaN);
          chk.push(Number.isFinite(v) ? v : 0);
        }
        const meanCheck = mean(chk);
        checkContrast = lineTesterCheckContrastSS(meanCheck, grandMean, r, l, t);
        fCheck = msError === 0 ? 0 : checkContrast.ms / msError;
        sigCheck = approxFSignificance(fCheck, 1, dfError);
      }

      $("#ltKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">F(Line)</div><div class="value">${fLine.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F(Tester)</div><div class="value">${fTester.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F(L×T)</div><div class="value">${fLT.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${msError.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Grand mean</div><div class="value">${grandMean.toFixed(3)}</div></div>
        </div>
        <div class="kpi-row" style="margin-top:8px;grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">% SS Lines</div><div class="value">${pct.pLine.toFixed(1)}%</div></div>
          <div class="kpi"><div class="label">% SS Testers</div><div class="value">${pct.pTester.toFixed(1)}%</div></div>
          <div class="kpi"><div class="label">% SS L×T</div><div class="value">${pct.pLT.toFixed(1)}%</div></div>
          <div class="kpi"><div class="label">Potence ratio</div><div class="value">${pot.potence.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Genetic advance %</div><div class="value">${ga.gaPct.toFixed(2)}%</div></div>
        </div>
      `;

      // Plot top cross means
      const rankedCross = [];
      for (let i = 0; i < l; i++) for (let j = 0; j < t; j++) rankedCross.push({ cross: `L${i + 1}xT${j + 1}`, mean: crossMeans[i][j], sca: sca[i][j] });
      rankedCross.sort((a, b) => b.mean - a.mean);
      const top = rankedCross.slice(0, Math.min(10, rankedCross.length));
      drawBarChart($("#ltBar"), top.map((x) => x.cross), top.map((x) => x.mean), { title: "Top cross means" });

      const anovaRows = [
        ["Replications (blocks)", ssRep, dfRep, msRep, fRep, ""],
        ["Lines", ssLine, dfLine, msLine, fLine, sigLine.level],
        ["Testers", ssTester, dfTester, msTester, fTester, sigTester.level],
        ["Line×Tester", ssLT, dfLT, msLT, fLT, sigLT.level],
      ];
      if (checkContrast) {
        anovaRows.push(["Check vs hybrid mean (contrast)", checkContrast.ss, checkContrast.df, checkContrast.ms, fCheck, sigCheck.level]);
      }
      anovaRows.push(["Error", ssError, dfError, msError, "", ""]);
      anovaRows.push(["Total", ssTotal, dfTotal, "", "", ""]);

      const anova = buildTable(["Source", "SS", "df", "MS", "F", "Approx. Sig."], anovaRows);

      const pctTable = buildTable(
        ["Hybrid factorial SS", "% of subtotal", "SS"],
        [
          ["Lines", pct.pLine, ssLine],
          ["Testers", pct.pTester, ssTester],
          ["Line×Tester", pct.pLT, ssLT],
          ["Subtotal (Lines+Testers+L×T)", 100, pct.sum],
        ]
      );

      const gcaLineTable = buildTable(
        ["Line", "Line mean", "ĜCA (line)", "SE"],
        lineMeans.map((m, i) => [`L${i + 1}`, m, gcaLine[i], se.seLineGca])
      );
      const gcaTesterTable = buildTable(
        ["Tester", "Tester mean", "ĜCA (tester)", "SE"],
        testerMeans.map((m, j) => [`T${j + 1}`, m, gcaTester[j], se.seTesterGca])
      );

      const scaRows = [];
      for (let i = 0; i < l; i++) {
        for (let j = 0; j < t; j++) {
          scaRows.push([`L${i + 1}xT${j + 1}`, crossMeans[i][j], sca[i][j], se.seSca]);
        }
      }
      scaRows.sort((a, b) => b[1] - a[1]);
      const scaTable = buildTable(["Cross", "Cross mean", "SCA", "SE(SCA)"], scaRows);

      const tExtra = buildTable(
        ["Parameter", "Value"],
        [
          ["SE (line ĜCA), common", se.seLineGca],
          ["SE (tester ĜCA), common", se.seTesterGca],
          ["SE (cross mean)", se.seCrossMean],
          ["SE (SCA) — balanced factorial", se.seSca],
          ["σ² GCA (lines), random", pot.sigmaGcaLine2],
          ["σ² GCA (testers), random", pot.sigmaGcaTester2],
          ["σ² SCA, random", pot.sigmaSca2],
          ["Potence ratio √(σ²_SCA / (2 σ²_GCA_line σ²_GCA_tester))", pot.potence],
          ["MS_LT / (MS_Line + MS_Tester) (screen)", pot.altRatio],
          ["Genetic advance (absolute, same units)", ga.gaAbs],
          ["Genetic advance (% of grand mean)", ga.gaPct],
          ["σ_p (line phenotypic SD, from MS_Line)", ga.sigmaP],
          ["h² on line means (MS−MSE)/MS_Line", ga.h2],
          ["Selection intensity k", kSel],
        ]
      );

      $("#ltTables").innerHTML = `${anova}<div style="height:10px"></div>${pctTable}<div style="height:10px"></div>${gcaLineTable}<div style="height:10px"></div>${gcaTesterTable}<div style="height:10px"></div>${scaTable}<div style="height:10px"></div>${tExtra}`;

      const deviationHtml = deviationBanner("linetester", { fLine, fTester, fLT }, ["fLine", "fTester", "fLT"]);
      const best = rankedCross[0];
      const interpretation =
        `Line × Tester analysis (RCBD: replications = blocks) partitions hybrid variance into Lines, Testers, and L×T.\n\n` +
        `Variance % of hybrid factorial SS: Lines ${pct.pLine.toFixed(1)}%, Testers ${pct.pTester.toFixed(1)}%, L×T ${pct.pLT.toFixed(1)}%.\n\n` +
        `F tests (approx):\n` +
        `• Lines: F=${fLine.toFixed(4)} (${sigLine.note})\n` +
        `• Testers: F=${fTester.toFixed(4)} (${sigTester.note})\n` +
        `• Line×Tester: F=${fLT.toFixed(4)} (${sigLT.note})\n\n` +
        `Potence ratio ${pot.potence.toFixed(4)} (higher = larger non-additive interaction relative to GCA-type variance); ` +
        `screen ratio MS_LT/(MS_L+MS_T) = ${pot.altRatio.toFixed(4)}.\n` +
        `Genetic advance ≈ ${ga.gaPct.toFixed(2)}% of mean (k=${kSel}, σ_p from line MS).\n\n` +
        `Best cross by mean: ${best.cross} (mean=${best.mean.toFixed(3)}, SCA=${best.sca.toFixed(3)}).\n` +
        (checkContrast
          ? `Check contrast vs hybrid mean: ${sigCheck.note}\n`
          : "") +
        `SE uses pooled MSE; check contrast is approximate if checks are not in the same blocking layout.`;

      setInterpretation("linetester", interpretation, deviationHtml || "", {
        fLine,
        fTester,
        fLT,
        bestMean: best.mean,
        potence: pot.potence,
        gaPct: ga.gaPct,
      });
    });

    $("#ltCompute").click();
  }

  // --- Diallel: Graphical approach first (Wr-Vr style) ---
  function renderDiallelGraphical() {
    const title = "Diallel Design - Graphical Approach (Wr-Vr)";
    showContentHeader({
      title,
      subtitle: "Input parent-wise Wr and Vr values to draw the diallel graphical relation and interpret dominance/additive trends.",
    });

    const defaultN = 6;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Approach</div><div class="value">Graphical (Wr-Vr)</div></div>
        <div class="kpi"><div class="label">Use</div><div class="value">Dominance/additive signal overview</div></div>
        <div class="kpi"><div class="label">Next</div><div class="value">DA I, II, III, IV</div></div>
      </div>

      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input values</h4>
            <div class="input-grid">
              <label>
                Number of parents
                <input type="number" min="3" max="12" id="dgN" value="${defaultN}" />
              </label>
              <button class="action-btn primary2" type="button" id="dgBuild">Build parent table</button>
              <div class="note" style="margin:0">
                Enter parent-wise Wr and Vr values from your diallel dataset (graphical method).
              </div>
            </div>
            <div id="dgInputWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="dgCompute">Draw graphical approach</button>
              <button class="action-btn" type="button" id="dgImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="dgTemplateCsv">Download template CSV</button>
              <input type="file" id="dgCsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="dgKpis"></div>
            <div class="chart" style="height:300px;margin-top:12px">
              <canvas id="dgChart" style="width:100%;height:100%"></canvas>
            </div>
            <div id="dgTableWrap" style="margin-top:12px"></div>
            <div class="muted small" style="margin-top:8px">
              Numerical sub-sections are being added progressively: DA I complete, DA II next, then DA III and DA IV.
            </div>
            <div class="actions" style="margin-top:10px">
              <button class="action-btn primary2" type="button" id="dgOpenDA1">Open DA I (Numerical)</button>
              <button class="action-btn" type="button" id="dgOpenDA2">Open DA II</button>
              <button class="action-btn" type="button" id="dgOpenDA3">Open DA III</button>
              <button class="action-btn" type="button" id="dgOpenDA4">Open DA IV</button>
            </div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "diallel",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["slope", "intercept"],
    });

    function buildTableInputs(n) {
      const wrap = $("#dgInputWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      table.innerHTML = `<thead><tr><th>Parent</th><th>Vr</th><th>Wr</th></tr></thead>`;
      const rows = [];
      for (let i = 0; i < n; i++) {
        const vr = 0.6 + i * 0.35 + (i % 2 ? 0.08 : -0.04);
        const wr = 0.4 + i * 0.31 + (i % 3 === 0 ? 0.12 : -0.03);
        rows.push(
          `<tr>
            <th>P${i + 1}</th>
            <td><input type="number" step="0.01" value="${vr.toFixed(2)}" data-vr="p${i}" /></td>
            <td><input type="number" step="0.01" value="${wr.toFixed(2)}" data-wr="p${i}" /></td>
          </tr>`
        );
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function linearFit(x, y) {
      const n = Math.min(x.length, y.length);
      const xs = x.slice(0, n);
      const ys = y.slice(0, n);
      const xb = mean(xs);
      const yb = mean(ys);
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - xb;
        sxx += dx * dx;
        sxy += dx * (ys[i] - yb);
      }
      const slope = sxx === 0 ? 0 : sxy / sxx;
      const intercept = yb - slope * xb;
      const r = pearsonCorrelation(xs, ys);
      return { slope, intercept, r };
    }

    function drawDiallelGraph(canvas, points, fit) {
      drawScatterPlot(canvas, points, { title: "Diallel graphical approach (Wr vs Vr)", xLabel: "Vr", yLabel: "Wr" });
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = Math.max(1e-9, maxX - minX);
      const rangeY = Math.max(1e-9, maxY - minY);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x1 = minX;
      const y1 = fit.intercept + fit.slope * x1;
      const x2 = maxX;
      const y2 = fit.intercept + fit.slope * x2;
      const p1 = projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, x1, y1);
      const p2 = projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, x2, y2);
      ctx.strokeStyle = CHART.lineFit;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "700 11px Segoe UI, system-ui, sans-serif";
      points.forEach((p) => {
        const pt = projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, p.x, p.y);
        ctx.fillText(p.label, pt.px + 5, pt.py - 5);
      });
    }

    buildTableInputs(defaultN);

    $("#dgBuild").addEventListener("click", () => {
      const n = Math.max(3, Math.min(12, Number($("#dgN").value || defaultN)));
      buildTableInputs(n);
    });

    $("#dgCompute").addEventListener("click", () => {
      const n = Math.max(3, Math.min(12, Number($("#dgN").value || defaultN)));
      const points = [];
      for (let i = 0; i < n; i++) {
        const vr = Number(document.querySelector(`#dgInputWrap input[data-vr="p${i}"]`)?.value ?? NaN);
        const wr = Number(document.querySelector(`#dgInputWrap input[data-wr="p${i}"]`)?.value ?? NaN);
        points.push({
          label: `P${i + 1}`,
          x: Number.isFinite(vr) ? vr : 0,
          y: Number.isFinite(wr) ? wr : 0,
        });
      }

      const fit = linearFit(points.map((p) => p.x), points.map((p) => p.y));
      drawDiallelGraph($("#dgChart"), points, fit);

      const minVr = Math.min(...points.map((p) => p.x));
      const maxVr = Math.max(...points.map((p) => p.x));
      const minWr = Math.min(...points.map((p) => p.y));
      const maxWr = Math.max(...points.map((p) => p.y));

      $("#dgKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">Slope (Wr~Vr)</div><div class="value">${fit.slope.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Intercept</div><div class="value">${fit.intercept.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Correlation (Wr,Vr)</div><div class="value">${fit.r.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Parents</div><div class="value">${n}</div></div>
        </div>
      `;

      const table = buildTable(
        ["Parent", "Vr", "Wr", "Relative position"],
        points.map((p) => [
          p.label,
          p.x,
          p.y,
          p.x <= (minVr + maxVr) / 2 ? "Lower Vr side" : "Higher Vr side",
        ])
      );
      $("#dgTableWrap").innerHTML = table;

      const deviationHtml = deviationBanner("diallel", { slope: fit.slope, intercept: fit.intercept }, ["slope", "intercept"]);
      const interpretation =
        `Diallel graphical approach uses Wr-Vr relation to inspect additive/dominance patterns qualitatively.\n\n` +
        `Computed fit: Wr = ${fit.intercept.toFixed(4)} + (${fit.slope.toFixed(4)})Vr, with correlation ${fit.r.toFixed(4)}.\n` +
        `Interpretation in practice depends on population assumptions and the expected regression behavior.\n\n` +
        `Use this graphical page as the first diagnostic step; next BKQuant updates will provide DA I, DA II, DA III, and DA IV numerical sections.`;

      setInterpretation("diallel", interpretation, deviationHtml || "", { slope: fit.slope, intercept: fit.intercept });
    });

    $("#dgTemplateCsv").addEventListener("click", () => {
      const n = Math.max(3, Math.min(12, Number($("#dgN").value || defaultN)));
      const rows = [["Parent", "Vr", "Wr"]];
      for (let i = 0; i < n; i++) rows.push([`P${i + 1}`, (0.6 + i * 0.3).toFixed(2), (0.5 + i * 0.25).toFixed(2)]);
      triggerCsvDownload("diallel_graphical_template.csv", rows);
    });
    $("#dgImportCsv").addEventListener("click", () => $("#dgCsvFile").click());
    $("#dgCsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const rows = parseCsv(txt);
      if (rows.length < 2) return;
      const data = rows.slice(1);
      const n = Math.max(3, Math.min(12, data.length));
      $("#dgN").value = String(n);
      buildTableInputs(n);
      for (let i = 0; i < n; i++) {
        const r = data[i] || [];
        const vr = Number(r[1]);
        const wr = Number(r[2]);
        const vrIn = document.querySelector(`#dgInputWrap input[data-vr="p${i}"]`);
        const wrIn = document.querySelector(`#dgInputWrap input[data-wr="p${i}"]`);
        if (vrIn && Number.isFinite(vr)) vrIn.value = String(vr);
        if (wrIn && Number.isFinite(wr)) wrIn.value = String(wr);
      }
      $("#dgCompute").click();
      e.target.value = "";
    });

    $("#dgOpenDA1").addEventListener("click", renderDiallelDA1);
    $("#dgOpenDA2").addEventListener("click", renderDiallelDA2);
    $("#dgOpenDA3").addEventListener("click", renderDiallelDA3);
    $("#dgOpenDA4").addEventListener("click", renderDiallelDA4);
    $("#dgCompute").click();
  }

  // --- Diallel Numerical: DA I ---
  function renderDiallelDA1() {
    const title = "Diallel Design - DA I (Numerical Approach)";
    showContentHeader({
      title,
      subtitle: "Input full diallel mean matrix (parents + crosses). Publication-style DA I numerical summary with combining-ability tables.",
    });

    const defaultN = 4;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Sub-section</div><div class="value">DA I</div></div>
        <div class="kpi"><div class="label">Input</div><div class="value">Full diallel mean matrix</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">GCA/SCA summary + ranked crosses</div></div>
      </div>

      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Diallel matrix input (Griffing)</h4>
            <div class="input-grid">
              <label>
                Number of parents (p)
                <input type="number" min="3" max="10" id="da1N" value="${defaultN}" />
              </label>
              <label>
                Griffing method
                <select id="da1Griffing">
                  <option value="1">Method 1 — Full diallel (parents + all F1 reciprocals)</option>
                  <option value="2">Method 2 — Parents + half diallel (one F1 per pair)</option>
                  <option value="3">Method 3 — F1 only (both reciprocals, no parents)</option>
                  <option value="4">Method 4 — Half diallel F1s only (no parents)</option>
                </select>
              </label>
              <label>
                Model (GCA/SCA inference)
                <select id="da1ModelType">
                  <option value="fixed">Fixed (effects)</option>
                  <option value="random">Random (variance components)</option>
                </select>
              </label>
              <label>
                Replicates per plot (r)
                <input type="number" min="1" max="999" id="da1Reps" value="1" />
              </label>
              <label>
                Optional MSE (error mean square)
                <input type="text" id="da1Mse" placeholder="Leave blank if unknown" />
              </label>
              <button class="action-btn primary2" type="button" id="da1Build">Build matrix</button>
              <div class="note" style="margin:0">
                Matrix layout follows the selected method: Method 1 = full p×p; Method 2 = parents on diagonal + upper triangle (lower mirrors); Method 3 = off-diagonal only; Method 4 = upper triangle crosses only (diagonal unused).
              </div>
            </div>
            <div id="da1GridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="da1Compute">Compute DA I</button>
              <button class="action-btn" type="button" id="da1ImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="da1TemplateCsv">Download template CSV</button>
              <input type="file" id="da1CsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
              <button class="action-btn" type="button" id="da1BackGraph">Back to graphical approach</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="da1Kpis"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="da1Bar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="da1Tables" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:10px">
              <button class="action-btn primary2" type="button" id="da1OpenDA2">Proceed to DA II</button>
              <button class="action-btn" type="button" id="da1OpenDA3">Proceed to DA III</button>
              <button class="action-btn" type="button" id="da1OpenDA4">Proceed to DA IV</button>
            </div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "diallel",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["grandMean", "bestCross"],
    });

    function getDa1Method() {
      return Math.max(1, Math.min(4, Number($("#da1Griffing")?.value || 1)));
    }

    function buildMatrix(p, method) {
      const m = method ?? getDa1Method();
      const wrap = $("#da1GridWrap");
      wrap.innerHTML = "";
      const cellDefault = (i, j) => {
        const parentBase = 22 + i * 1.9;
        const crossBoost = i === j ? 0 : 3.2 + ((i + j) % 3) * 0.8;
        const reciprocity = i !== j ? (i > j ? 0.4 : -0.2) : 0;
        return parentBase + j * 1.1 + crossBoost + reciprocity;
      };
      const def = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => cellDefault(i, j)));
      if (m === 2) {
        for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) def[i][j] = def[j][i];
      }
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Parent", ...Array.from({ length: p }, (_, j) => `P${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < p; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          let disabled = false;
          if (m === 4 && (i === j || i > j)) disabled = true;
          if (m === 3 && i === j) disabled = true;
          if (m === 2 && i > j) disabled = true;
          const dis = disabled ? " disabled" : "";
          const val = def[i][j];
          cells.push(
            `<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-da1="i${i}j${j}"${dis} /></td>`
          );
        }
        rows.push(`<tr><th>P${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildMatrix(defaultN, 1);

    $("#da1Build").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da1N").value || defaultN)));
      buildMatrix(p, getDa1Method());
    });
    $("#da1Griffing")?.addEventListener("change", () => {
      const p = Math.max(3, Math.min(10, Number($("#da1N").value || defaultN)));
      buildMatrix(p, getDa1Method());
    });

    $("#da1BackGraph").addEventListener("click", renderDiallelGraphical);
    $("#da1OpenDA2").addEventListener("click", renderDiallelDA2);
    $("#da1OpenDA3").addEventListener("click", renderDiallelDA3);
    $("#da1OpenDA4").addEventListener("click", renderDiallelDA4);

    $("#da1TemplateCsv").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da1N").value || defaultN)));
      const rows = [Array.from({ length: p }, (_, j) => `P${j + 1}`)];
      for (let i = 0; i < p; i++) {
        const row = [];
        for (let j = 0; j < p; j++) row.push((22 + i * 1.4 + j * 1.1 + (i === j ? 0 : 3)).toFixed(2));
        rows.push(row);
      }
      triggerCsvDownload("diallel_da1_matrix_template.csv", rows);
    });
    $("#da1ImportCsv").addEventListener("click", () => $("#da1CsvFile").click());
    $("#da1CsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const mat = parseNumericCsvMatrix(txt);
      if (!mat.length) return;
      const p = Math.max(3, Math.min(10, mat.length));
      $("#da1N").value = String(p);
      buildMatrix(p, getDa1Method());
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
        const v = mat[i]?.[j];
        if (!Number.isFinite(v)) continue;
        const input = document.querySelector(`#da1GridWrap input[data-da1="i${i}j${j}"]`);
        if (input) input.value = String(v);
      }
      $("#da1Compute").click();
      e.target.value = "";
    });

    $("#da1Compute").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da1N").value || defaultN)));
      const method = getDa1Method();
      const modelRandom = String($("#da1ModelType")?.value || "fixed") === "random";
      const r = Math.max(1, Number($("#da1Reps")?.value || 1));
      const mseRaw = String($("#da1Mse")?.value || "").trim();
      const mseIn = mseRaw === "" ? NaN : Number(mseRaw);

      const M = readDiallelMatrixFromDom(p, method);

      let crosses = [];
      let ssRecip = 0;
      let recipDf = 0;
      if (method === 1 || method === 3) {
        const sym = diallelSymmetricCrossesAndRecip(M, p);
        crosses = sym.crosses;
        ssRecip = sym.ssRecip;
        recipDf = sym.recipDf;
      } else {
        for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) crosses.push(M[i][j]);
      }

      const part = griffingMethod4Partition(p, crosses);
      const est = estimateGcaScaMethod4(p, crosses);

      const diag = Array.from({ length: p }, (_, i) => M[i][i]);
      const meanDiag = mean(diag);
      let ssParents = 0;
      for (let i = 0; i < p; i++) ssParents += (diag[i] - meanDiag) ** 2;
      const dfParents = p - 1;
      const msParents = dfParents > 0 ? ssParents / dfParents : 0;

      const msRecip = recipDf > 0 ? ssRecip / recipDf : 0;
      const fRecip = Number.isFinite(mseIn) && mseIn > 0 && recipDf > 0 ? msRecip / mseIn : "";

      const ratioStr =
        !Number.isFinite(part.ratioMS) || part.ratioMS > 1e12 ? "∞" : part.ratioMS.toFixed(4);
      const gcaScaRatioInterpret =
        part.msS <= 1e-18
          ? "SCA MS ~ 0 — additive structure explains crosses (check df)."
          : part.msG / part.msS > 1
            ? "MS_GCA > MS_SCA — additive (GCA) variation predominates among crosses."
            : "MS_SCA ≥ MS_GCA — non-additive (dominance × GCA interaction) variation is important.";

      const vh = diallelVarianceHeritability(part.msG, part.msS, mseIn, p, r);
      const degree =
        2 * vh.sigmaGca <= 1e-18 ? 0 : Math.sqrt(Math.max(0, vh.sigmaSca / (2 * vh.sigmaGca)));
      const geneAction =
        degree < 0.8 ? "Predominantly additive" : degree <= 1.2 ? "Partial/complete dominance" : "Over-dominance tendency";

      const fG = Number.isFinite(mseIn) && mseIn > 0 ? part.msG / mseIn : "";
      const fS =
        Number.isFinite(mseIn) && mseIn > 0 && part.dfS > 0 ? part.msS / mseIn : part.dfS <= 0 ? "—" : "";

      const anovaRows = [
        ["GCA (among parents, crosses)", part.ssGCA, part.dfG, part.msG, fG === "" ? "" : fG],
        ["SCA", part.ssSCA, part.dfS, part.dfS > 0 ? part.msS : 0, fS],
        ["Total (among unique crosses)", part.ssTot, part.dfT, "", ""],
      ];
      if ((method === 1 || method === 3) && recipDf > 0) {
        anovaRows.splice(2, 0, ["Reciprocals", ssRecip, recipDf, msRecip, fRecip === "" ? "" : fRecip]);
      }
      if (method === 1 || method === 2) {
        anovaRows.push(["Parents (diagonal)", ssParents, dfParents, msParents, ""]);
      }

      const tAnova = buildTable(["Source", "SS", "df", "MS", "F (vs MSE if set)"], anovaRows);

      const tGca = buildTable(
        ["Parent", "General combining ability (ĜCA)"],
        est.gca.map((g, i) => [`P${i + 1}`, g])
      );

      const scaRows = [];
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          if (i === j) continue;
          if (method === 4 || method === 2) {
            if (j < i) continue;
            const s = est.scaMat[i][j];
            if (s == null) continue;
            scaRows.push([`P${i + 1}×P${j + 1}`, M[i][j], est.mu + est.gca[i] + est.gca[j], s]);
          } else {
            const s = M[i][j] - est.mu - est.gca[i] - est.gca[j];
            scaRows.push([`P${i + 1}×P${j + 1}`, M[i][j], est.mu + est.gca[i] + est.gca[j], s]);
          }
        }
      }
      scaRows.sort((a, b) => b[3] - a[3]);

      const labels = Array.from({ length: p }, (_, i) => `P${i + 1}`);
      let scaHeat = est.scaMat;
      if (method === 1 || method === 3) {
        scaHeat = Array.from({ length: p }, () => Array(p).fill(null));
        for (let i = 0; i < p; i++) {
          for (let j = 0; j < p; j++) {
            if (i === j) continue;
            scaHeat[i][j] = M[i][j] - est.mu - est.gca[i] - est.gca[j];
          }
        }
      }

      const tSca = buildTable(
        ["Cross", "Observed mean", "Expected (μ + ĜCA_i + ĜCA_j)", "SCA"],
        scaRows.slice(0, Math.min(24, scaRows.length))
      );

      const hFoot = vh.mseImputed
        ? "MSE not set: σ²_SCA and σ²_e use a fallback from MS_SCA; narrow/broad h² are indicative only."
        : "MSE supplied: variance components use MS − MSE expectations (random model).";

      const tGen = buildTable(
        ["Parameter", "Estimate"],
        [
          ["Griffing method", String(method)],
          ["Model", modelRandom ? "Random (variance components)" : "Fixed (effects / F-tests vs MSE)"],
          ["MS_GCA / MS_SCA (crosses)", ratioStr],
          ["Interpretation", gcaScaRatioInterpret],
          ["σ² GCA (random)", vh.sigmaGca],
          ["σ² SCA (random)", vh.sigmaSca],
          ["σ² error (environment, entry-mean scale)", vh.sigmaE],
          ["Narrow-sense heritability h²", vh.hNarrow],
          ["Broad-sense heritability H²", vh.hBroad],
          ["Average degree of dominance (√(σ²_SCA / 2σ²_GCA))", degree],
          ["Gene action (from variance ratio)", geneAction],
          ["Note", hFoot],
        ]
      );

      const allVals = M.flat();
      let grandMean = mean(allVals);
      if (method === 3) {
        const od = [];
        for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) od.push(M[i][j]);
        grandMean = od.length ? mean(od) : grandMean;
      }
      const crossOnly = [];
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) crossOnly.push({ cross: `P${i + 1}xP${j + 1}`, mean: M[i][j] });
      crossOnly.sort((a, b) => b.mean - a.mean);
      const bestCross = crossOnly[0];

      let recCount = 0;
      let recAbsSum = 0;
      for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) recAbsSum += Math.abs(M[i][j] - M[j][i]), recCount += 1;
      const reciprocalMeanDiff = recCount ? recAbsSum / recCount : 0;

      $("#da1Kpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Cross mean (μ)</div><div class="value">${est.mu.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Best cross</div><div class="value">${qs(bestCross.cross)}</div></div>
          <div class="kpi"><div class="label">Best mean</div><div class="value">${bestCross.mean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">MS_GCA / MS_SCA</div><div class="value">${ratioStr}</div></div>
          <div class="kpi"><div class="label">Parents (p)</div><div class="value">${p}</div></div>
        </div>
        <div class="kpi-row" style="margin-top:8px;grid-template-columns:repeat(3, minmax(0,1fr))">
          <div class="kpi"><div class="label">h² (narrow)</div><div class="value">${vh.hNarrow.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">H² (broad)</div><div class="value">${vh.hBroad.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Reciprocal avg |diff|</div><div class="value">${reciprocalMeanDiff.toFixed(3)}</div></div>
        </div>
      `;

      const top = crossOnly.slice(0, Math.min(10, crossOnly.length));
      drawBarChart($("#da1Bar"), top.map((x) => x.cross), top.map((x) => x.mean), { title: "Top cross means (Griffing DA I)" });

      const heatHtml = `<h4 class="mt-3 text-sm font-semibold text-indigo-200">SCA effects heatmap</h4>${scaHeatmapHtml(scaHeat, labels)}`;

      $("#da1Tables").innerHTML = `${tAnova}<div style="height:10px"></div>${tGca}<div style="height:10px"></div>${tSca}<div style="height:10px"></div>${tGen}<div style="height:10px"></div>${heatHtml}`;

      const deviationHtml = deviationBanner("diallel-da1", { grandMean, bestCross: bestCross.mean }, ["grandMean", "bestCross"]);
      const interpretation =
        `Griffing diallel (Method ${method}, ${modelRandom ? "random" : "fixed"} model): GCA/SCA partition for unique F1 means; reciprocal and parent sums of squares are shown when applicable.\n\n` +
        `• Cross mean μ = ${est.mu.toFixed(4)} (half-diallel mean of unique pairs)\n` +
        `• MS_GCA / MS_SCA = ${ratioStr} — ${gcaScaRatioInterpret}\n` +
        `• Narrow-sense h² ≈ ${vh.hNarrow.toFixed(4)}, broad-sense H² ≈ ${vh.hBroad.toFixed(4)} (${vh.mseImputed ? "MSE imputed/approximate" : "using supplied MSE"})\n` +
        `• Best cross = ${bestCross.cross} (mean=${bestCross.mean.toFixed(3)})\n` +
        `• Reciprocal mean |difference| = ${reciprocalMeanDiff.toFixed(3)}\n\n` +
        `Positive ĜCA: parent contributes above-average progeny across crosses. Positive SCA: cross exceeds additive expectation. ` +
        `F-tests use your MSE when provided; otherwise interpret mean squares descriptively.`;

      setInterpretation("diallel-da1", interpretation, deviationHtml || "", {
        grandMean,
        bestCross: bestCross.mean,
        degree,
        model: modelRandom ? "random" : "fixed",
        hNarrow: vh.hNarrow,
        hBroad: vh.hBroad,
      });
    });

    $("#da1Compute").click();
  }

  // --- Diallel Numerical: DA II ---
  function renderDiallelDA2() {
    const title = "Diallel Design - DA II (Numerical Approach)";
    showContentHeader({
      title,
      subtitle: "Half-diallel style DA II summary (no reciprocal duplication) with publication-style combining-ability tables.",
    });

    const defaultN = 5;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Sub-section</div><div class="value">DA II</div></div>
        <div class="kpi"><div class="label">Input</div><div class="value">Parents + unique crosses (upper triangle)</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">GCA/SCA summary + top unique crosses</div></div>
      </div>

      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Half-diallel input</h4>
            <div class="input-grid">
              <label>
                Number of parents (p)
                <input type="number" min="3" max="10" id="da2N" value="${defaultN}" />
              </label>
              <label>
                Genetic model assumption
                <select id="da2Model">
                  <option value="fixed-no-reciprocal">Fixed + no reciprocal term</option>
                  <option value="fixed-with-reciprocal">Fixed + reciprocal included</option>
                  <option value="random-no-reciprocal">Random + no reciprocal term</option>
                  <option value="random-with-reciprocal">Random + reciprocal included</option>
                </select>
              </label>
              <button class="action-btn primary2" type="button" id="da2Build">Build DA II matrix</button>
              <div class="note" style="margin:0">
                Fill diagonal (parents) and upper triangle crosses only. Lower triangle is auto-marked as not used.
              </div>
            </div>
            <div id="da2GridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="da2Compute">Compute DA II</button>
              <button class="action-btn" type="button" id="da2BackGraph">Back to graphical approach</button>
              <button class="action-btn" type="button" id="da2BackDA1">Back to DA I</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="da2Kpis"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="da2Bar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="da2Tables" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:10px">
              <button class="action-btn primary2" type="button" id="da2OpenDA3">Proceed to DA III</button>
              <button class="action-btn" type="button" id="da2OpenDA4">Proceed to DA IV</button>
            </div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "diallel-da2",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["grandMean", "bestCross"],
    });

    function buildMatrix(p) {
      const wrap = $("#da2GridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Parent", ...Array.from({ length: p }, (_, j) => `P${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;

      const rows = [];
      for (let i = 0; i < p; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          if (j < i) {
            cells.push(`<td class="muted small" style="font-weight:900">N/A</td>`);
            continue;
          }
          const parentBase = 21 + i * 1.7;
          const crossBoost = i === j ? 0 : 2.8 + ((i + j) % 4) * 0.65;
          const val = parentBase + j * 0.9 + crossBoost;
          cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-da2="i${i}j${j}" /></td>`);
        }
        rows.push(`<tr><th>P${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildMatrix(defaultN);

    $("#da2Build").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da2N").value || defaultN)));
      buildMatrix(p);
    });
    $("#da2BackGraph").addEventListener("click", renderDiallelGraphical);
    $("#da2BackDA1").addEventListener("click", renderDiallelDA1);
    $("#da2OpenDA3").addEventListener("click", renderDiallelDA3);
    $("#da2OpenDA4").addEventListener("click", renderDiallelDA4);

    $("#da2Compute").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da2N").value || defaultN)));
      const parentVals = [];
      const crossList = [];

      for (let i = 0; i < p; i++) {
        const di = Number(document.querySelector(`#da2GridWrap input[data-da2="i${i}j${i}"]`)?.value ?? NaN);
        parentVals[i] = Number.isFinite(di) ? di : 0;
        for (let j = i + 1; j < p; j++) {
          const v = Number(document.querySelector(`#da2GridWrap input[data-da2="i${i}j${j}"]`)?.value ?? NaN);
          crossList.push({ i, j, val: Number.isFinite(v) ? v : 0 });
        }
      }

      const allVals = [...parentVals, ...crossList.map((c) => c.val)];
      const grandMean = mean(allVals);

      // parent combining performance from all crosses involving parent i
      const parentCrossMeans = Array(p).fill(0);
      const parentCrossCounts = Array(p).fill(0);
      for (const c of crossList) {
        parentCrossMeans[c.i] += c.val;
        parentCrossMeans[c.j] += c.val;
        parentCrossCounts[c.i] += 1;
        parentCrossCounts[c.j] += 1;
      }
      for (let i = 0; i < p; i++) {
        parentCrossMeans[i] = parentCrossCounts[i] ? parentCrossMeans[i] / parentCrossCounts[i] : 0;
      }
      const gca = parentCrossMeans.map((m) => m - mean(parentCrossMeans));

      // SCA for each unique cross based on expected grand + gca_i + gca_j
      const scaRows = crossList.map((c) => {
        const expected = grandMean + gca[c.i] + gca[c.j];
        const sca = c.val - expected;
        return [`P${c.i + 1}xP${c.j + 1}`, c.val, expected, sca];
      });

      // very light partition
      const parentMean = mean(parentVals);
      const crossMean = mean(crossList.map((c) => c.val));
      let ssParents = 0;
      for (const v of parentVals) ssParents += (v - parentMean) * (v - parentMean);
      let ssCross = 0;
      for (const c of crossList) ssCross += (c.val - crossMean) * (c.val - crossMean);
      const dfParents = p - 1;
      const dfCross = Math.max(1, crossList.length - 1);
      const msParents = ssParents / Math.max(1, dfParents);
      const msCross = ssCross / dfCross;

      scaRows.sort((a, b) => b[1] - a[1]);
      const bestCross = scaRows[0];

      $("#da2Kpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Grand mean</div><div class="value">${grandMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Parent mean</div><div class="value">${parentMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Cross mean</div><div class="value">${crossMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Best cross</div><div class="value">${qs(bestCross[0])}</div></div>
          <div class="kpi"><div class="label">Best mean</div><div class="value">${Number(bestCross[1]).toFixed(3)}</div></div>
        </div>
      `;

      const top = scaRows.slice(0, Math.min(10, scaRows.length));
      drawBarChart($("#da2Bar"), top.map((r) => r[0]), top.map((r) => Number(r[1])), { title: "Top unique cross means (DA II)" });

      const t1 = buildTable(
        ["Source", "SS", "df", "MS"],
        [
          ["Parents", ssParents, dfParents, msParents],
          ["Unique crosses", ssCross, dfCross, msCross],
        ]
      );
      const t2 = buildTable(
        ["Parent", "Parent self mean", "Mean of involved crosses", "General combining ability (GCA)"],
        Array.from({ length: p }, (_, i) => [`P${i + 1}`, parentVals[i], parentCrossMeans[i], gca[i]])
      );
      const t3 = buildTable(
        ["Cross (unique)", "Observed", "Expected (GCA model)", "Specific combining ability (SCA)"],
        scaRows
      );
      const modelKey = String($("#da2Model")?.value || "fixed-no-reciprocal");
      const gp = computeDiallelGeneticParams(msParents, msCross, modelKey);
      const tGen = buildTable(
        ["Genetic parameter", "Estimate"],
        [
          ["Model assumption", gp.modelLabel],
          ["sigma^2 GCA (proxy)", gp.sigmaGCA],
          ["sigma^2 SCA (proxy)", gp.sigmaSCA],
          ["sigma^2 GCA / sigma^2 SCA", gp.ratio],
          ["sigma^2 A (additive proxy)", gp.sigmaA],
          ["sigma^2 D (dominance proxy)", gp.sigmaD],
          ["Average degree of dominance (proxy)", gp.degree],
          ["Gene action class", gp.geneAction],
        ]
      );
      $("#da2Tables").innerHTML = `${t1}<div style="height:10px"></div>${t2}<div style="height:10px"></div>${t3}<div style="height:10px"></div>${tGen}`;

      const deviationHtml = deviationBanner("diallel-da2", { grandMean, bestCross: Number(bestCross[1]) }, ["grandMean", "bestCross"]);
      const interpretation =
        `DA II (half-diallel style) summarizes unique cross performance without reciprocal duplication.\n\n` +
        `Key outcomes:\n` +
        `• Grand mean = ${grandMean.toFixed(3)}\n` +
        `• Best unique cross = ${bestCross[0]} (mean=${Number(bestCross[1]).toFixed(3)})\n\n` +
        `Interpretation:\n` +
        `• Positive parent GCA indicates above-average contribution across unique crosses.\n` +
        `• Positive cross SCA indicates cross performance above additive expectation from parent GCAs.\n` +
        `• Compare DA I vs DA II patterns to inspect the impact of reciprocal information on ranking decisions.\n\n` +
        `Genetic parameter proxies:\n` +
        `• Model = ${gp.modelLabel}\n` +
        `• sigma^2GCA=${gp.sigmaGCA.toFixed(4)}, sigma^2SCA=${gp.sigmaSCA.toFixed(4)}, ratio=${gp.ratio.toFixed(4)}\n` +
        `• Average degree of dominance=${gp.degree.toFixed(4)} (${gp.geneAction})`;

      setInterpretation("diallel-da2", interpretation, deviationHtml || "", { grandMean, bestCross: Number(bestCross[1]), degree: gp.degree, model: gp.modelLabel });
    });

    $("#da2Compute").click();
  }

  // --- Diallel Numerical: DA III ---
  function renderDiallelDA3() {
    const title = "Diallel Design - DA III (Numerical Approach)";
    showContentHeader({
      title,
      subtitle: "DA III numerical page with cross gain over parental baseline and parent contribution summary.",
    });

    const defaultN = 5;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Sub-section</div><div class="value">DA III</div></div>
        <div class="kpi"><div class="label">Focus</div><div class="value">Cross gain over parental base</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">Gain ranking + combining summary</div></div>
      </div>

      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input (upper triangle + parents)</h4>
            <div class="input-grid">
              <label>
                Number of parents (p)
                <input type="number" min="3" max="10" id="da3N" value="${defaultN}" />
              </label>
              <label>
                Genetic model assumption
                <select id="da3Model">
                  <option value="fixed-no-reciprocal">Fixed + no reciprocal term</option>
                  <option value="fixed-with-reciprocal">Fixed + reciprocal included</option>
                  <option value="random-no-reciprocal">Random + no reciprocal term</option>
                  <option value="random-with-reciprocal">Random + reciprocal included</option>
                </select>
              </label>
              <button class="action-btn primary2" type="button" id="da3Build">Build DA III matrix</button>
              <div class="note" style="margin:0">
                Enter parent means on diagonal and unique crosses in upper triangle.
              </div>
            </div>
            <div id="da3GridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="da3Compute">Compute DA III</button>
              <button class="action-btn" type="button" id="da3BackGraph">Graphical</button>
              <button class="action-btn" type="button" id="da3BackDA2">DA II</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="da3Kpis"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="da3Bar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="da3Tables" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:10px">
              <button class="action-btn primary2" type="button" id="da3OpenDA4">Proceed to DA IV</button>
            </div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "diallel-da3",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["meanGain", "bestGain"],
    });

    function buildMatrix(p) {
      const wrap = $("#da3GridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Parent", ...Array.from({ length: p }, (_, j) => `P${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < p; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          if (j < i) {
            cells.push(`<td class="muted small" style="font-weight:900">N/A</td>`);
            continue;
          }
          const base = 20 + i * 1.6 + j * 0.85;
          const crossGain = i === j ? 0 : 2.2 + ((i + j) % 3) * 0.75;
          const v = base + crossGain;
          cells.push(`<td><input type="number" step="0.01" value="${v.toFixed(2)}" data-da3="i${i}j${j}" /></td>`);
        }
        rows.push(`<tr><th>P${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildMatrix(defaultN);

    $("#da3Build").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da3N").value || defaultN)));
      buildMatrix(p);
    });
    $("#da3BackGraph").addEventListener("click", renderDiallelGraphical);
    $("#da3BackDA2").addEventListener("click", renderDiallelDA2);
    $("#da3OpenDA4").addEventListener("click", renderDiallelDA4);

    $("#da3Compute").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da3N").value || defaultN)));
      const parentVals = [];
      const gainRows = [];
      const parentUseSum = Array(p).fill(0);
      const parentUseCnt = Array(p).fill(0);

      for (let i = 0; i < p; i++) {
        const di = Number(document.querySelector(`#da3GridWrap input[data-da3="i${i}j${i}"]`)?.value ?? NaN);
        parentVals[i] = Number.isFinite(di) ? di : 0;
      }
      for (let i = 0; i < p; i++) {
        for (let j = i + 1; j < p; j++) {
          const v = Number(document.querySelector(`#da3GridWrap input[data-da3="i${i}j${j}"]`)?.value ?? NaN);
          const cross = Number.isFinite(v) ? v : 0;
          const midParent = (parentVals[i] + parentVals[j]) / 2;
          const gain = cross - midParent;
          const gainPct = midParent === 0 ? 0 : (gain / midParent) * 100;
          gainRows.push([`P${i + 1}xP${j + 1}`, cross, midParent, gain, gainPct]);
          parentUseSum[i] += gain;
          parentUseSum[j] += gain;
          parentUseCnt[i] += 1;
          parentUseCnt[j] += 1;
        }
      }

      const parentGainMean = parentUseSum.map((s, i) => (parentUseCnt[i] ? s / parentUseCnt[i] : 0));
      const meanGain = mean(gainRows.map((r) => r[3]));
      gainRows.sort((a, b) => b[3] - a[3]);
      const best = gainRows[0];

      $("#da3Kpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Mean gain</div><div class="value">${meanGain.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Best gain cross</div><div class="value">${qs(best[0])}</div></div>
          <div class="kpi"><div class="label">Best gain</div><div class="value">${Number(best[3]).toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Best gain (%)</div><div class="value">${Number(best[4]).toFixed(2)}%</div></div>
          <div class="kpi"><div class="label">Parents</div><div class="value">${p}</div></div>
        </div>
      `;

      const top = gainRows.slice(0, Math.min(10, gainRows.length));
      drawBarChart($("#da3Bar"), top.map((r) => r[0]), top.map((r) => Number(r[3])), { title: "Top cross gains over mid-parent (DA III)" });

      const t1 = buildTable(
        ["Cross", "Observed mean", "Mid-parent mean", "Gain", "Gain (%)"],
        gainRows
      );
      const t2 = buildTable(
        ["Parent", "Parent self mean", "Average cross gain when involved"],
        Array.from({ length: p }, (_, i) => [`P${i + 1}`, parentVals[i], parentGainMean[i]])
      );
      // DA III model-aware genetic proxy block (from gain variance and parent contribution variance)
      let varGain = 0;
      for (const r of gainRows) varGain += (r[3] - meanGain) * (r[3] - meanGain);
      varGain /= Math.max(1, gainRows.length - 1);
      const meanParentGain = mean(parentGainMean);
      let varParentGain = 0;
      for (const pg of parentGainMean) varParentGain += (pg - meanParentGain) * (pg - meanParentGain);
      varParentGain /= Math.max(1, p - 1);
      const modelKey = String($("#da3Model")?.value || "fixed-no-reciprocal");
      const gp = computeDiallelGeneticParams(varParentGain, varGain, modelKey);
      const tGen = buildTable(
        ["Genetic parameter", "Estimate"],
        [
          ["Model assumption", gp.modelLabel],
          ["sigma^2 GCA (proxy)", gp.sigmaGCA],
          ["sigma^2 SCA (proxy)", gp.sigmaSCA],
          ["sigma^2 GCA / sigma^2 SCA", gp.ratio],
          ["sigma^2 A (additive proxy)", gp.sigmaA],
          ["sigma^2 D (dominance proxy)", gp.sigmaD],
          ["Average degree of dominance (proxy)", gp.degree],
          ["Gene action class", gp.geneAction],
        ]
      );
      $("#da3Tables").innerHTML = `${t1}<div style="height:10px"></div>${t2}<div style="height:10px"></div>${tGen}`;

      const deviationHtml = deviationBanner("diallel-da3", { meanGain, bestGain: Number(best[3]) }, ["meanGain", "bestGain"]);
      const interpretation =
        `DA III emphasizes cross gain relative to parental baseline (mid-parent reference).\n\n` +
        `In this run:\n` +
        `• Average gain across unique crosses = ${meanGain.toFixed(3)}\n` +
        `• Best gain cross = ${best[0]} with gain ${Number(best[3]).toFixed(3)} (${Number(best[4]).toFixed(2)}%)\n\n` +
        `Interpretation:\n` +
        `• Positive gains indicate crosses outperform parental mid-point.\n` +
        `• Parents with higher average gain contribution can be prioritized for hybrid-oriented programs.\n\n` +
        `Genetic parameter proxies:\n` +
        `• Model = ${gp.modelLabel}\n` +
        `• sigma^2GCA=${gp.sigmaGCA.toFixed(4)}, sigma^2SCA=${gp.sigmaSCA.toFixed(4)}, ratio=${gp.ratio.toFixed(4)}\n` +
        `• Average degree of dominance=${gp.degree.toFixed(4)} (${gp.geneAction})`;

      setInterpretation("diallel-da3", interpretation, deviationHtml || "", { meanGain, bestGain: Number(best[3]), degree: gp.degree, model: gp.modelLabel });
    });

    $("#da3Compute").click();
  }

  // --- Diallel Numerical: DA IV ---
  function renderDiallelDA4() {
    const title = "Diallel Design - DA IV (Numerical Approach)";
    showContentHeader({
      title,
      subtitle: "DA IV numerical summary focused on directional cross advantage and reciprocal contrast index.",
    });

    const defaultN = 5;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Sub-section</div><div class="value">DA IV</div></div>
        <div class="kpi"><div class="label">Focus</div><div class="value">Directional and reciprocal contrasts</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">Contrast table + ranking</div></div>
      </div>

      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input full diallel matrix</h4>
            <div class="input-grid">
              <label>
                Number of parents (p)
                <input type="number" min="3" max="10" id="da4N" value="${defaultN}" />
              </label>
              <label>
                Genetic model assumption
                <select id="da4Model">
                  <option value="fixed-with-reciprocal">Fixed + reciprocal included</option>
                  <option value="fixed-no-reciprocal">Fixed + no reciprocal term</option>
                  <option value="random-with-reciprocal">Random + reciprocal included</option>
                  <option value="random-no-reciprocal">Random + no reciprocal term</option>
                </select>
              </label>
              <button class="action-btn primary2" type="button" id="da4Build">Build DA IV matrix</button>
              <div class="note" style="margin:0">
                Enter full matrix including reciprocal crosses to compute reciprocal contrast indices.
              </div>
            </div>
            <div id="da4GridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="da4Compute">Compute DA IV</button>
              <button class="action-btn" type="button" id="da4BackGraph">Graphical</button>
              <button class="action-btn" type="button" id="da4BackDA3">DA III</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="da4Kpis"></div>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="da4Bar" style="width:100%;height:100%"></canvas>
            </div>
            <div id="da4Tables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "diallel-da4",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["meanRecContrast", "bestDirectional"],
    });

    function buildMatrix(p) {
      const wrap = $("#da4GridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Parent", ...Array.from({ length: p }, (_, j) => `P${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < p; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          const parentBase = 21 + i * 1.4;
          const crossGain = i === j ? 0 : 2.5 + ((i + j) % 3) * 0.7 + (i > j ? 0.35 : -0.1);
          const v = parentBase + j * 0.7 + crossGain;
          cells.push(`<td><input type="number" step="0.01" value="${v.toFixed(2)}" data-da4="i${i}j${j}" /></td>`);
        }
        rows.push(`<tr><th>P${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildMatrix(defaultN);

    $("#da4Build").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da4N").value || defaultN)));
      buildMatrix(p);
    });
    $("#da4BackGraph").addEventListener("click", renderDiallelGraphical);
    $("#da4BackDA3").addEventListener("click", renderDiallelDA3);

    $("#da4Compute").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da4N").value || defaultN)));
      const M = Array.from({ length: p }, () => Array(p).fill(0));
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          const v = Number(document.querySelector(`#da4GridWrap input[data-da4="i${i}j${j}"]`)?.value ?? NaN);
          M[i][j] = Number.isFinite(v) ? v : 0;
        }
      }

      const directionalRows = [];
      const reciprocalRows = [];
      for (let i = 0; i < p; i++) {
        for (let j = i + 1; j < p; j++) {
          const fwd = M[i][j];
          const rev = M[j][i];
          const avg = (fwd + rev) / 2;
          const rec = fwd - rev;
          const dir = avg - ((M[i][i] + M[j][j]) / 2);
          directionalRows.push([`P${i + 1}xP${j + 1}`, avg, dir]);
          reciprocalRows.push([`P${i + 1}xP${j + 1} vs P${j + 1}xP${i + 1}`, fwd, rev, rec]);
        }
      }

      directionalRows.sort((a, b) => b[2] - a[2]);
      reciprocalRows.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]));
      const meanRecContrast = mean(reciprocalRows.map((r) => Math.abs(r[3])));
      const bestDirectional = directionalRows[0];

      $("#da4Kpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">Best directional cross</div><div class="value">${qs(bestDirectional[0])}</div></div>
          <div class="kpi"><div class="label">Directional advantage</div><div class="value">${Number(bestDirectional[2]).toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Mean |reciprocal contrast|</div><div class="value">${meanRecContrast.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Unique pairs</div><div class="value">${directionalRows.length}</div></div>
        </div>
      `;

      const top = directionalRows.slice(0, Math.min(10, directionalRows.length));
      drawBarChart($("#da4Bar"), top.map((r) => r[0]), top.map((r) => Number(r[2])), { title: "Top directional advantages (DA IV)" });

      const t1 = buildTable(
        ["Cross pair", "Average cross mean", "Directional advantage over mid-parent"],
        directionalRows
      );
      const t2 = buildTable(
        ["Reciprocal pair", "Forward direction", "Reverse direction", "Reciprocal contrast (F-R)"],
        reciprocalRows
      );
      // DA IV model-aware genetic proxy block (directional vs reciprocal contrast variances)
      const meanDir = mean(directionalRows.map((r) => Number(r[2])));
      let varDir = 0;
      for (const r of directionalRows) varDir += (Number(r[2]) - meanDir) * (Number(r[2]) - meanDir);
      varDir /= Math.max(1, directionalRows.length - 1);
      const meanRec = mean(reciprocalRows.map((r) => Number(r[3])));
      let varRec = 0;
      for (const r of reciprocalRows) varRec += (Number(r[3]) - meanRec) * (Number(r[3]) - meanRec);
      varRec /= Math.max(1, reciprocalRows.length - 1);
      const modelKey = String($("#da4Model")?.value || "fixed-with-reciprocal");
      const gp = computeDiallelGeneticParams(varDir, varRec, modelKey);
      const tGen = buildTable(
        ["Genetic parameter", "Estimate"],
        [
          ["Model assumption", gp.modelLabel],
          ["sigma^2 GCA (proxy)", gp.sigmaGCA],
          ["sigma^2 SCA (proxy)", gp.sigmaSCA],
          ["sigma^2 GCA / sigma^2 SCA", gp.ratio],
          ["sigma^2 A (additive proxy)", gp.sigmaA],
          ["sigma^2 D (dominance proxy)", gp.sigmaD],
          ["Average degree of dominance (proxy)", gp.degree],
          ["Gene action class", gp.geneAction],
        ]
      );
      $("#da4Tables").innerHTML = `${t1}<div style="height:10px"></div>${t2}<div style="height:10px"></div>${tGen}`;

      const deviationHtml = deviationBanner("diallel-da4", { meanRecContrast, bestDirectional: Number(bestDirectional[2]) }, ["meanRecContrast", "bestDirectional"]);
      const interpretation =
        `DA IV summarizes directional cross advantage and reciprocal contrasts from a full diallel matrix.\n\n` +
        `In this run:\n` +
        `• Best directional cross = ${bestDirectional[0]} with advantage ${Number(bestDirectional[2]).toFixed(3)}\n` +
        `• Mean absolute reciprocal contrast = ${meanRecContrast.toFixed(3)}\n\n` +
        `Interpretation:\n` +
        `• Larger positive directional advantage suggests stronger cross performance above parental baseline.\n` +
        `• Large reciprocal contrasts indicate potential maternal/cytoplasmic or direction-specific effects.\n\n` +
        `Genetic parameter proxies:\n` +
        `• Model = ${gp.modelLabel}\n` +
        `• sigma^2GCA=${gp.sigmaGCA.toFixed(4)}, sigma^2SCA=${gp.sigmaSCA.toFixed(4)}, ratio=${gp.ratio.toFixed(4)}\n` +
        `• Average degree of dominance=${gp.degree.toFixed(4)} (${gp.geneAction})`;

      setInterpretation("diallel-da4", interpretation, deviationHtml || "", { meanRecContrast, bestDirectional: Number(bestDirectional[2]), degree: gp.degree, model: gp.modelLabel });
    });

    $("#da4Compute").click();
  }

  // --- North Carolina Designs: NC I / II / III ---
  function renderNCDesigns() {
    const title = "North Carolina Designs (NC I, NC II, NC III)";
    showContentHeader({
      title,
      subtitle:
        "Balanced NC I (nested: females within males), NC II/III (factorial M×F with reps). ANOVA, EMS-based V_A & V_D (F2 mapping), degree of dominance, narrow-sense h².",
    });

    const bodyHtml = `
      <div class="section" style="margin:0">
        <div class="actions" id="ncTabs">
          <button class="action-btn primary2" type="button" data-nc="NCI">NC I</button>
          <button class="action-btn" type="button" data-nc="NCII">NC II</button>
          <button class="action-btn" type="button" data-nc="NCIII">NC III</button>
        </div>
        <div id="ncBody" style="margin-top:12px"></div>
      </div>
    `;

    moduleShell({
      moduleId: "nc",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["h2Narrow", "VA"],
    });

    const tabs = $$("#ncTabs [data-nc]");
    const defaultA = 3;
    const defaultB = 3;
    const defaultR = 3;

    function activate(tab) {
      tabs.forEach((b) => b.classList.toggle("primary2", b.dataset.nc === tab));
      tabs.forEach((b) => b.classList.toggle("action-btn", true));
    }

    function buildNc1Grid(a, b, r) {
      const wrap = $("#nc1Grid");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Male×Female / Rep", ...Array.from({ length: r }, (_, k) => `R${k + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          const cells = [];
          for (let k = 0; k < r; k++) {
            const val = 20 + i * 2.1 + j * 1.4 + (k - (r - 1) / 2) * 0.6;
            cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-nc1="i${i}j${j}r${k}" /></td>`);
          }
          rows.push(`<tr><th>${qs(`M${i + 1}×F${j + 1}`)}</th>${cells.join("")}</tr>`);
        }
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function buildNc2Grid(a, b, r) {
      const wrap = $("#nc2Grid");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Cross / Rep", ...Array.from({ length: r }, (_, k) => `R${k + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          const cells = [];
          for (let k = 0; k < r; k++) {
            const val = 22 + i * 2.4 + j * 1.9 + (k - (r - 1) / 2) * 0.55 + (i === j ? 0.8 : 0);
            cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-nc2="i${i}j${j}r${k}" /></td>`);
          }
          rows.push(`<tr><th>${qs(`M${i + 1}×F${j + 1}`)}</th>${cells.join("")}</tr>`);
        }
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function readNc1(a, b, r) {
      const y = [];
      for (let i = 0; i < a; i++) {
        y[i] = [];
        for (let j = 0; j < b; j++) {
          y[i][j] = [];
          for (let k = 0; k < r; k++) {
            const input = document.querySelector(`#nc1Grid input[data-nc1="i${i}j${j}r${k}"]`);
            const v = Number(input?.value ?? NaN);
            y[i][j][k] = Number.isFinite(v) ? v : 0;
          }
        }
      }
      return y;
    }

    function readNc2(a, b, r) {
      const y = [];
      for (let i = 0; i < a; i++) {
        y[i] = [];
        for (let j = 0; j < b; j++) {
          y[i][j] = [];
          for (let k = 0; k < r; k++) {
            const input = document.querySelector(`#nc2Grid input[data-nc2="i${i}j${j}r${k}"]`);
            const v = Number(input?.value ?? NaN);
            y[i][j][k] = Number.isFinite(v) ? v : 0;
          }
        }
      }
      return y;
    }

    function renderNCI() {
      activate("NCI");
      $("#ncBody").innerHTML = `
        <div class="kpi-row">
          <div class="kpi"><div class="label">Design</div><div class="value">NC I (nested)</div></div>
          <div class="kpi"><div class="label">Partition</div><div class="value">Males, F within M, Error</div></div>
          <div class="kpi"><div class="label">Mapping</div><div class="value">F2: V_A ≈ 4σ²_males</div></div>
        </div>
        <div class="two-col" style="margin-top:12px">
          <div class="section" style="margin:0">
            <h4>Balanced nested layout</h4>
            <div class="input-grid">
              <label>Males (a) <input type="number" min="2" max="20" id="nc1A" value="${defaultA}" /></label>
              <label>Females per male (b) <input type="number" min="2" max="20" id="nc1B" value="${defaultB}" /></label>
              <label>Replications (r) <input type="number" min="2" max="20" id="nc1R" value="${defaultR}" /></label>
              <button class="action-btn primary2" type="button" id="nc1Build">Build grid</button>
            </div>
            <p class="note" style="margin:8px 0 0">Rows = male×female families; columns = reps. Hierarchy: <strong>Males</strong> → <strong>Females within males</strong> (nested).</p>
            <div id="nc1Grid" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px"><button class="action-btn primary2" type="button" id="nc1Compute">Compute NC I</button></div>
          </div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="nc1Kpis"></div>
            <div class="chart" style="height:240px;margin-top:12px"><canvas id="ncChart1" style="width:100%;height:100%"></canvas></div>
            <div id="ncTable1" style="margin-top:12px"></div>
          </div>
        </div>
      `;
      buildNc1Grid(defaultA, defaultB, defaultR);
      $("#nc1Build").onclick = () => {
        const a = Math.max(2, Number($("#nc1A").value || defaultA));
        const b = Math.max(2, Number($("#nc1B").value || defaultB));
        const r = Math.max(2, Number($("#nc1R").value || defaultR));
        buildNc1Grid(a, b, r);
      };
      $("#nc1Compute").onclick = () => {
        const a = Math.max(2, Number($("#nc1A").value || defaultA));
        const b = Math.max(2, Number($("#nc1B").value || defaultB));
        const r = Math.max(2, Number($("#nc1R").value || defaultR));
        const y = readNc1(a, b, r);
        const an = ncDesign1NestedAnova(y, a, b, r);
        const dd = ncDegreeDominanceAndH2(an.VA, an.VD, an.sigma2e);
        const sigM = approxFSignificance(an.fM, an.dfM, an.dfFM);
        const sigFM = approxFSignificance(an.fFM, an.dfFM, an.dfE);
        const barLabels = [];
        const barVals = [];
        for (let i = 0; i < a; i++) {
          let s = 0;
          let c = 0;
          for (let j = 0; j < b; j++) for (let k = 0; k < r; k++) s += y[i][j][k], c++;
          barLabels.push(`M${i + 1}`);
          barVals.push(s / c);
        }
        drawBarChart($("#ncChart1"), barLabels, barVals, { title: "NC I — male family means" });
        $("#nc1Kpis").innerHTML = `
          <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
            <div class="kpi"><div class="label">V_A (approx.)</div><div class="value">${an.VA.toFixed(4)}</div></div>
            <div class="kpi"><div class="label">V_D (approx.)</div><div class="value">${an.VD.toFixed(4)}</div></div>
            <div class="kpi"><div class="label">h² (narrow)</div><div class="value">${dd.h2Narrow.toFixed(4)}</div></div>
            <div class="kpi"><div class="label">√(2V_D/V_A)</div><div class="value">${dd.degSqrt2.toFixed(4)}</div></div>
          </div>`;
        const anova = buildTable(
          ["Source", "SS", "df", "MS", "F", "Sig. (approx.)"],
          [
            ["Males", an.ssM, an.dfM, an.msM, an.fM, sigM.level],
            ["Females within males", an.ssFM, an.dfFM, an.msFM, an.fFM, sigFM.level],
            ["Error", an.ssError, an.dfE, an.msE, "", ""],
            ["Total", an.ssTotal, a * b * r - 1, "", "", ""],
          ]
        );
        const ems = buildTable(
          ["Random effects (VC from EMS)", "Estimate"],
          [
            ["σ² (error / within plots)", an.sigma2e],
            ["σ² (females within males)", an.sigmaFM],
            ["σ² (males)", an.sigmaM],
            ["V_A ≈ 4 σ²(males) [F2 mapping]", an.VA],
            ["V_D ≈ 4 max(0, σ²_F|m − σ²_m) [approx.]", an.VD],
          ]
        );
        const gen = buildTable(
          ["Parameter", "Value"],
          [
            ["Narrow-sense heritability h² = V_A/(V_A+V_D+V_E)", dd.h2Narrow],
            ["(V_D/V_A)^0.25 (avg. degree of dom., one convention)", dd.degPow4],
            ["√(2 V_D/V_A) (Falconer-style ratio)", dd.degSqrt2],
            ["V_E = MSE (within-plot env.)", an.sigma2e],
            ["V_P ≈ V_A+V_D+V_E", dd.vp],
          ]
        );
        $("#ncTable1").innerHTML = `${anova}<div style="height:10px"></div>${ems}<div style="height:10px"></div>${gen}`;
        const interpretation =
          `NC I (balanced nested): SS for Males and Females-within-males; F for males uses MS(F|m); nested females use MSE.\n` +
          `V_A and V_D use F2 approximations (Comstock–Robinson style); interpret with your actual mating generation.\n` +
          `h² (narrow) = ${dd.h2Narrow.toFixed(4)}; √(2V_D/V_A) = ${dd.degSqrt2.toFixed(4)} (partial dominance if < 1, over-dominance tendency if > 1).`;
        setInterpretation("nc", interpretation, "", { h2Narrow: dd.h2Narrow, VA: an.VA });
      };
      $("#nc1Compute").click();
    }

    function renderNCII(isIII) {
      activate(isIII ? "NCIII" : "NCII");
      const tag = isIII ? "3" : "2";
      const titleD = isIII ? "NC III (factorial layout)" : "NC II (factorial)";
      const note = isIII
        ? "NC III: same balanced M×F×r ANOVA as NC II (F2 × tester groups). Full multi-population NC III may add contrasts between gene pools."
        : "NC II: factorial crossing; Replication SS = blocks.";
      $("#ncBody").innerHTML = `
        <div class="kpi-row">
          <div class="kpi"><div class="label">Design</div><div class="value">${titleD}</div></div>
          <div class="kpi"><div class="label">Partition</div><div class="value">Rep, M, F, M×F, Err</div></div>
          <div class="kpi"><div class="label">V_D</div><div class="value">≈ 4 σ²(M×F)</div></div>
        </div>
        <p class="note" style="margin:8px 0 0">${note}</p>
        <div class="two-col" style="margin-top:12px">
          <div class="section" style="margin:0">
            <h4>Factorial grid</h4>
            <div class="input-grid">
              <label>Males (a) <input type="number" min="2" max="15" id="nc${tag}A" value="${defaultA}" /></label>
              <label>Females (b) <input type="number" min="2" max="15" id="nc${tag}B" value="${defaultB}" /></label>
              <label>Replications (r) <input type="number" min="2" max="20" id="nc${tag}R" value="${defaultR}" /></label>
              <button class="action-btn primary2" type="button" id="nc${tag}Build">Build grid</button>
            </div>
            <div id="nc2Grid" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px"><button class="action-btn primary2" type="button" id="nc${tag}Compute">Compute ${isIII ? "NC III" : "NC II"}</button></div>
          </div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="nc${tag}Kpis"></div>
            <div class="chart" style="height:240px;margin-top:12px"><canvas id="ncChart${tag}" style="width:100%;height:100%"></canvas></div>
            <div id="ncTable${tag}" style="margin-top:12px"></div>
          </div>
        </div>
      `;
      buildNc2Grid(defaultA, defaultB, defaultR);
      $("#nc" + tag + "Build").onclick = () => {
        const a = Math.max(2, Number($("#nc" + tag + "A").value || defaultA));
        const b = Math.max(2, Number($("#nc" + tag + "B").value || defaultB));
        const r = Math.max(2, Number($("#nc" + tag + "R").value || defaultR));
        buildNc2Grid(a, b, r);
      };
      $("#nc" + tag + "Compute").onclick = () => {
        const a = Math.max(2, Number($("#nc" + tag + "A").value || defaultA));
        const b = Math.max(2, Number($("#nc" + tag + "B").value || defaultB));
        const r = Math.max(2, Number($("#nc" + tag + "R").value || defaultR));
        const y = readNc2(a, b, r);
        const an = ncDesign2FactorialAnova(y, a, b, r);
        const dd = ncDegreeDominanceAndH2(an.VA, an.VD, an.msE);
        const sigM = approxFSignificance(an.fM, an.dfM, an.dfE);
        const sigF = approxFSignificance(an.fF, an.dfF, an.dfE);
        const sigMF = approxFSignificance(an.fMF, an.dfMF, an.dfE);
        const barLabels = [];
        const barVals = [];
        for (let i = 0; i < a; i++) {
          for (let j = 0; j < b; j++) {
            let s = 0;
            for (let k = 0; k < r; k++) s += y[i][j][k];
            barLabels.push(`M${i + 1}×F${j + 1}`);
            barVals.push(s / r);
          }
        }
        drawBarChart($("#ncChart" + tag), barLabels, barVals, { title: `${isIII ? "NC III" : "NC II"} — cross means` });
        $("#nc" + tag + "Kpis").innerHTML = `
          <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
            <div class="kpi"><div class="label">V_A (approx.)</div><div class="value">${an.VA.toFixed(4)}</div></div>
            <div class="kpi"><div class="label">V_D (approx.)</div><div class="value">${an.VD.toFixed(4)}</div></div>
            <div class="kpi"><div class="label">h² (narrow)</div><div class="value">${dd.h2Narrow.toFixed(4)}</div></div>
            <div class="kpi"><div class="label">√(2V_D/V_A)</div><div class="value">${dd.degSqrt2.toFixed(4)}</div></div>
          </div>`;
        const anova = buildTable(
          ["Source", "SS", "df", "MS", "F", "Sig. (approx.)"],
          [
            ["Replications", an.ssRep, an.dfRep, an.msRep, "", ""],
            ["Males", an.ssM, an.dfM, an.msM, an.fM, sigM.level],
            ["Females", an.ssF, an.dfF, an.msF, an.fF, sigF.level],
            ["Male × Female", an.ssMF, an.dfMF, an.msMF, an.fMF, sigMF.level],
            ["Error", an.ssError, an.dfE, an.msE, "", ""],
            ["Total", an.ssTotal, a * b * r - 1, "", "", ""],
          ]
        );
        const ems = buildTable(
          ["VC from EMS (random, factorial)", "Estimate"],
          [
            ["σ² (error)", an.msE],
            ["σ² (M×F) = (MS_MF−MSE)/r", an.sigmaMF],
            ["σ² (males) = (MS_M−MS_MF)/(r·b)", an.sigmaM],
            ["σ² (females) = (MS_F−MS_MF)/(r·a)", an.sigmaF],
            ["V_A ≈ 2(σ²_m + σ²_f)", an.VA],
            ["V_D ≈ 4 σ²(M×F)", an.VD],
          ]
        );
        const gen = buildTable(
          ["Parameter", "Value"],
          [
            ["Narrow-sense heritability h²", dd.h2Narrow],
            ["(V_D/V_A)^0.25", dd.degPow4],
            ["√(2 V_D/V_A)", dd.degSqrt2],
            ["V_P ≈ V_A+V_D+V_E", dd.vp],
          ]
        );
        $("#ncTable" + tag).innerHTML = `${anova}<div style="height:10px"></div>${ems}<div style="height:10px"></div>${gen}`;
        const interpretation =
          `${isIII ? "NC III" : "NC II"} factorial ANOVA: Replication, Male, Female, M×F (SCA), Error.\n` +
          `V_A from male+female variance components; V_D from interaction; h² (narrow) = ${dd.h2Narrow.toFixed(4)}.\n` +
          `√(2V_D/V_A) = ${dd.degSqrt2.toFixed(4)}.`;
        setInterpretation("nc", interpretation, "", { h2Narrow: dd.h2Narrow, VA: an.VA });
      };
      $("#nc" + tag + "Compute").click();
    }

    function renderNCIIOnly() {
      renderNCII(false);
    }
    function renderNCIIIOnly() {
      renderNCII(true);
    }

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.nc;
        if (t === "NCI") renderNCI();
        if (t === "NCII") renderNCIIOnly();
        if (t === "NCIII") renderNCIIIOnly();
      });
    });

    renderNCI();
  }

  // --- Triple Test Cross ---
  function renderTripleTestCross() {
    const title = "Triple Test Cross (Calculator)";
    showContentHeader({
      title,
      subtitle: "Evaluate epistasis and additive/dominance tendency using L1, L2 and L3 tester groups per line.",
    });

    const defaultN = 8;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Line means under L1, L2, L3 testers</div></div>
        <div class="kpi"><div class="label">Output</div><div class="value">Epistasis index + component summaries</div></div>
        <div class="kpi"><div class="label">Plots</div><div class="value">Line-wise epistasis magnitude</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input table</h4>
            <div class="input-grid">
              <label>
                Number of lines
                <input type="number" min="4" max="30" id="ttcN" value="${defaultN}" />
              </label>
              <button class="action-btn primary2" type="button" id="ttcBuild">Build TTC table</button>
              <div class="note" style="margin:0">
                Enter line means for crosses with testers L1, L2 and L3.
              </div>
              <div class="muted small" style="margin-top:8px">
                <strong>Import CSV / Excel:</strong> columns <strong>Line</strong> (optional), <strong>L1</strong>, <strong>L2</strong>, <strong>L3</strong> numeric means — one row per line. Row count sets the number of lines (4–30).
              </div>
              <button class="action-btn" type="button" id="ttcImportCsv">Import CSV / Excel</button>
              <input type="file" id="ttcCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div id="ttcWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="ttcCompute">Compute TTC</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="ttcKpis"></div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="ttcChart" style="width:100%;height:100%"></canvas></div>
            <div id="ttcTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "triple",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["epiMean", "epiAbsMean"],
    });

    function buildTable(n) {
      const wrap = $("#ttcWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      table.innerHTML = `<thead><tr><th>Line</th><th>L1 cross mean</th><th>L2 cross mean</th><th>L3 cross mean</th></tr></thead>`;
      const rows = [];
      for (let i = 0; i < n; i++) {
        const l1 = 24 + i * 0.9 + (i % 2 ? 0.7 : -0.2);
        const l2 = 22 + i * 0.8 + (i % 3 ? 0.6 : -0.1);
        const l3 = 23 + i * 0.85 + (i % 4 ? 0.5 : -0.3);
        rows.push(`<tr>
          <th>L${i + 1}</th>
          <td><input type="number" step="0.01" value="${l1.toFixed(2)}" data-ttc="i${i}a"/></td>
          <td><input type="number" step="0.01" value="${l2.toFixed(2)}" data-ttc="i${i}b"/></td>
          <td><input type="number" step="0.01" value="${l3.toFixed(2)}" data-ttc="i${i}c"/></td>
        </tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildTable(defaultN);

    $("#ttcBuild").addEventListener("click", () => {
      const n = Math.max(4, Math.min(30, Number($("#ttcN").value || defaultN)));
      buildTable(n);
    });

    bindCsvExcelFileImport("ttcImportCsv", "ttcCsvFile", (txt) => {
      const rows = parseCsv(txt).filter((r) => r.some((c) => String(c).trim() !== ""));
      if (rows.length < 2) {
        alert("Need a header row and at least one data row.");
        return;
      }
      const head = rows[0].map((c) => String(c).trim().toLowerCase());
      const dataRows = rows.slice(1);
      let i1 = 1;
      let i2 = 2;
      let i3 = 3;
      if (head.some((h) => h === "l1" || h.includes("l1"))) {
        const find = (pred) => head.findIndex(pred);
        i1 = find((h) => h === "l1" || h.endsWith("l1"));
        i2 = find((h) => h === "l2" || h.endsWith("l2"));
        i3 = find((h) => h === "l3" || h.endsWith("l3"));
        if (i1 < 0) i1 = 1;
        if (i2 < 0) i2 = 2;
        if (i3 < 0) i3 = 3;
      }
      const n = Math.max(4, Math.min(30, dataRows.length));
      $("#ttcN").value = String(n);
      buildTable(n);
      for (let i = 0; i < n; i++) {
        const row = dataRows[i] || [];
        const l1 = Number(row[i1] ?? row[1]) || 0;
        const l2 = Number(row[i2] ?? row[2]) || 0;
        const l3 = Number(row[i3] ?? row[3]) || 0;
        const a = document.querySelector(`#ttcWrap input[data-ttc="i${i}a"]`);
        const b = document.querySelector(`#ttcWrap input[data-ttc="i${i}b"]`);
        const c = document.querySelector(`#ttcWrap input[data-ttc="i${i}c"]`);
        if (a) a.value = String(l1);
        if (b) b.value = String(l2);
        if (c) c.value = String(l3);
      }
    });

    $("#ttcCompute").addEventListener("click", () => {
      const n = Math.max(4, Math.min(30, Number($("#ttcN").value || defaultN)));
      const rows = [];
      for (let i = 0; i < n; i++) {
        const l1 = Number(document.querySelector(`#ttcWrap input[data-ttc="i${i}a"]`)?.value ?? 0);
        const l2 = Number(document.querySelector(`#ttcWrap input[data-ttc="i${i}b"]`)?.value ?? 0);
        const l3 = Number(document.querySelector(`#ttcWrap input[data-ttc="i${i}c"]`)?.value ?? 0);
        const epi = l1 + l2 - 2 * l3; // common TTC epistasis contrast
        const addProxy = (l1 - l2) / 2;
        const domProxy = l3 - (l1 + l2) / 2;
        rows.push({ line: `L${i + 1}`, l1, l2, l3, epi, addProxy, domProxy });
      }

      const epiMean = mean(rows.map((r) => r.epi));
      const epiAbsMean = mean(rows.map((r) => Math.abs(r.epi)));
      const addMean = mean(rows.map((r) => r.addProxy));
      const domMean = mean(rows.map((r) => r.domProxy));
      const epiClass = epiAbsMean > 1.5 ? "Epistasis likely substantial" : epiAbsMean > 0.8 ? "Moderate epistasis signal" : "Low epistasis signal";

      $("#ttcKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Mean epistasis contrast</div><div class="value">${epiMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Mean |epistasis|</div><div class="value">${epiAbsMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Additive proxy mean</div><div class="value">${addMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Dominance proxy mean</div><div class="value">${domMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Classification</div><div class="value">${qs(epiClass)}</div></div>
        </div>
      `;

      drawBarChart(
        $("#ttcChart"),
        rows.map((r) => r.line),
        rows.map((r) => Math.abs(r.epi)),
        { title: "Line-wise epistasis magnitude |L1 + L2 - 2L3|" }
      );

      const t1 = buildTable(
        ["Line", "L1", "L2", "L3", "Epistasis contrast", "Additive proxy", "Dominance proxy"],
        rows.map((r) => [r.line, r.l1, r.l2, r.l3, r.epi, r.addProxy, r.domProxy])
      );
      const t2 = buildTable(
        ["Summary metric", "Value"],
        [
          ["Mean epistasis contrast", epiMean],
          ["Mean absolute epistasis contrast", epiAbsMean],
          ["Mean additive proxy", addMean],
          ["Mean dominance proxy", domMean],
        ]
      );
      $("#ttcTables").innerHTML = `${t1}<div style="height:10px"></div>${t2}`;

      const deviationHtml = deviationBanner("triple", { epiMean, epiAbsMean }, ["epiMean", "epiAbsMean"]);
      const interpretation =
        `Triple Test Cross uses line means under three testers to detect non-allelic interaction patterns.\n\n` +
        `Computed summary:\n` +
        `• Mean epistasis contrast = ${epiMean.toFixed(3)}\n` +
        `• Mean |epistasis| = ${epiAbsMean.toFixed(3)} (${epiClass})\n` +
        `• Additive proxy mean = ${addMean.toFixed(3)}\n` +
        `• Dominance proxy mean = ${domMean.toFixed(3)}\n\n` +
        `Interpretation: larger absolute epistasis contrasts indicate stronger interaction effects, while additive/dominance proxies help classify the predominant inheritance tendency.`;
      setInterpretation("triple", interpretation, deviationHtml || "", { epiMean, epiAbsMean });
    });

    $("#ttcCompute").click();
  }

  // --- Generation Mean Analysis ---
  function renderGenerationMean() {
    const title = "Generation Mean Analysis (Calculator)";
    showContentHeader({
      title,
      subtitle: "Analyze generation means (P1, P2, F1, F2, BC1, BC2) and derive simple gene-effect style contrasts.",
    });

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Generation means</div></div>
        <div class="kpi"><div class="label">Output</div><div class="value">m, [d], [h] style contrasts + fit check</div></div>
        <div class="kpi"><div class="label">Plot</div><div class="value">Generation profile plot</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Generation means</h4>
            <div class="input-grid">
              <label>P1 <input type="number" step="0.01" id="gmaP1" value="18.20"/></label>
              <label>P2 <input type="number" step="0.01" id="gmaP2" value="26.40"/></label>
              <label>F1 <input type="number" step="0.01" id="gmaF1" value="24.10"/></label>
              <label>F2 <input type="number" step="0.01" id="gmaF2" value="22.30"/></label>
              <label>BC1 (F1 x P1) <input type="number" step="0.01" id="gmaBC1" value="21.40"/></label>
              <label>BC2 (F1 x P2) <input type="number" step="0.01" id="gmaBC2" value="24.80"/></label>
              <div class="muted small" style="margin-top:8px">
                <strong>Import CSV / Excel:</strong> one data row with six values in order P1, P2, F1, F2, BC1, BC2 — or a header row with those names.
              </div>
              <button class="action-btn" type="button" id="gmaImportCsv">Import CSV / Excel</button>
              <input type="file" id="gmaCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
              <button class="action-btn primary2" type="button" id="gmaCompute">Compute generation means</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="gmaKpis"></div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="gmaChart" style="width:100%;height:100%"></canvas></div>
            <div id="gmaTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "genmean",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["m", "d", "h"],
    });

    bindCsvExcelFileImport("gmaImportCsv", "gmaCsvFile", (txt) => {
      const raw = parseCsv(txt).filter((r) => r.some((c) => String(c).trim() !== ""));
      if (!raw.length) return;
      const head = raw[0].map((c) => String(c).trim().toLowerCase());
      const keys = ["p1", "p2", "f1", "f2", "bc1", "bc2"];
      let vals;
      if (keys.every((k) => head.includes(k))) {
        const ix = keys.map((k) => head.indexOf(k));
        const row = raw.length > 1 ? raw[1] : raw[0];
        vals = ix.map((i) => Number(row[i]));
      } else {
        const row = raw[raw.length - 1].map((c) => Number(String(c).trim()));
        vals = row.filter((x) => Number.isFinite(x));
      }
      if (vals.length < 6 || vals.slice(0, 6).some((x) => !Number.isFinite(x))) {
        alert("Need six numeric generation means: P1, P2, F1, F2, BC1, BC2.");
        return;
      }
      $("#gmaP1").value = String(vals[0]);
      $("#gmaP2").value = String(vals[1]);
      $("#gmaF1").value = String(vals[2]);
      $("#gmaF2").value = String(vals[3]);
      $("#gmaBC1").value = String(vals[4]);
      $("#gmaBC2").value = String(vals[5]);
    });

    $("#gmaCompute").addEventListener("click", () => {
      const P1 = Number($("#gmaP1").value || 0);
      const P2 = Number($("#gmaP2").value || 0);
      const F1 = Number($("#gmaF1").value || 0);
      const F2 = Number($("#gmaF2").value || 0);
      const BC1 = Number($("#gmaBC1").value || 0);
      const BC2 = Number($("#gmaBC2").value || 0);

      // Basic generation mean contrasts (simplified educational form)
      const m = (P1 + P2 + 2 * F2) / 4;
      const d = (P1 - P2) / 2;
      const h = F1 - m;
      const i = 2 * F2 - (BC1 + BC2); // additive x additive proxy
      const j = BC1 - BC2 + (P2 - P1) / 2; // additive x dominance proxy
      const l = P1 + P2 + 2 * F1 + 4 * F2 - 4 * BC1 - 4 * BC2; // dominance x dominance proxy (scaled)

      const fitResidual = Math.abs((BC1 + BC2) / 2 - F2);
      const fitClass = fitResidual > 1.5 ? "Poor additive-dominance fit" : fitResidual > 0.8 ? "Moderate fit deviation" : "Good approximate fit";

      $("#gmaKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">m</div><div class="value">${m.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">[d]</div><div class="value">${d.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">[h]</div><div class="value">${h.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Fit residual</div><div class="value">${fitResidual.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Fit class</div><div class="value">${qs(fitClass)}</div></div>
        </div>
      `;

      drawBarChart(
        $("#gmaChart"),
        ["P1", "P2", "F1", "F2", "BC1", "BC2"],
        [P1, P2, F1, F2, BC1, BC2],
        { title: "Generation mean profile" }
      );

      const t1 = buildTable(
        ["Parameter", "Estimate", "Meaning"],
        [
          ["m", m, "Overall mean effect"],
          ["[d]", d, "Additive effect proxy"],
          ["[h]", h, "Dominance effect proxy"],
          ["[i]", i, "Additive x additive proxy"],
          ["[j]", j, "Additive x dominance proxy"],
          ["[l]", l, "Dominance x dominance proxy (scaled)"],
        ]
      );
      const t2 = buildTable(
        ["Generation", "Mean"],
        [
          ["P1", P1],
          ["P2", P2],
          ["F1", F1],
          ["F2", F2],
          ["BC1", BC1],
          ["BC2", BC2],
        ]
      );
      $("#gmaTables").innerHTML = `${t2}<div style="height:10px"></div>${t1}`;

      const deviationHtml = deviationBanner("genmean", { m, d, h }, ["m", "d", "h"]);
      const interpretation =
        `Generation Mean Analysis decomposes generation means into main and interaction-style genetic effect contrasts.\n\n` +
        `Estimated effects:\n` +
        `• m=${m.toFixed(3)}, [d]=${d.toFixed(3)}, [h]=${h.toFixed(3)}\n` +
        `• [i]=${i.toFixed(3)}, [j]=${j.toFixed(3)}, [l]=${l.toFixed(3)}\n\n` +
        `Model fit indicator: residual=${fitResidual.toFixed(3)} (${fitClass}).\n` +
        `Large interaction contrasts [i], [j], [l] suggest non-allelic interaction components may be relevant.`;
      setInterpretation("genmean", interpretation, deviationHtml || "", { m, d, h });
    });

    $("#gmaCompute").click();
  }

  // --- MET (Multi-Environment Trial) ---
  function renderMET() {
    const title = "MET (Multi-Environment Trial) - Calculator";
    showContentHeader({
      title,
      subtitle: "Input genotype x environment matrix. Run standard MET summary or Eberhart and Russell stability model.",
    });

    const defaultG = 6;
    const defaultE = 4;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Genotype x Environment means</div></div>
        <div class="kpi"><div class="label">Model A</div><div class="value">MET mean-stability summary</div></div>
        <div class="kpi"><div class="label">Model B</div><div class="value">Eberhart & Russell stability</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>GxE matrix</h4>
            <div class="input-grid">
              <div class="two-col">
                <label>Genotypes (g)<input type="number" min="2" max="30" id="metG" value="${defaultG}" /></label>
                <label>Environments (e)<input type="number" min="2" max="12" id="metE" value="${defaultE}" /></label>
              </div>
              <button class="action-btn primary2" type="button" id="metBuild">Build matrix</button>
            </div>
            <div id="metWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="metCompute">Compute MET summary</button>
              <button class="action-btn" type="button" id="metERCompute">Compute Eberhart-Russell</button>
              <button class="action-btn" type="button" id="metImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="metTemplateCsv">Download template CSV</button>
              <input type="file" id="metCsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="metKpis"></div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="metChart" style="width:100%;height:100%"></canvas></div>
            <div id="metTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "met",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["bestMean", "bestCV"],
    });

    function build(g, e) {
      const wrap = $("#metWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Genotype", ...Array.from({ length: e }, (_, j) => `E${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < g; i++) {
        const cells = [];
        for (let j = 0; j < e; j++) {
          const v = 25 + i * 1.2 + j * 0.9 + ((i + j) % 3) * 0.6 + (i === 2 && j >= 2 ? 1.2 : 0);
          cells.push(`<td><input type="number" step="0.01" value="${v.toFixed(2)}" data-met="g${i}e${j}" /></td>`);
        }
        rows.push(`<tr><th>G${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function readMatrix() {
      const g = Math.max(2, Math.min(30, Number($("#metG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#metE").value || defaultE)));
      const M = Array.from({ length: g }, () => Array(e).fill(0));
      const errors = [];
      clearValidation("#metWrap");
      for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) {
        const input = document.querySelector(`#metWrap input[data-met="g${i}e${j}"]`);
        const v = Number(input?.value ?? NaN);
        if (!Number.isFinite(v)) {
          errors.push(`MET: invalid value at G${i + 1}, E${j + 1}`);
          markInvalidInput(input, "Enter a valid numeric value");
        }
        M[i][j] = Number.isFinite(v) ? v : 0;
      }
      return { g, e, M, errors };
    }

    build(defaultG, defaultE);
    $("#metBuild").addEventListener("click", () => {
      const g = Math.max(2, Math.min(30, Number($("#metG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#metE").value || defaultE)));
      build(g, e);
    });

    $("#metTemplateCsv").addEventListener("click", () => {
      const g = Math.max(2, Math.min(30, Number($("#metG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#metE").value || defaultE)));
      const rows = [Array.from({ length: e }, (_, j) => `E${j + 1}`)];
      for (let i = 0; i < g; i++) {
        rows.push(Array.from({ length: e }, (_, j) => (25 + i * 1.2 + j * 0.9).toFixed(2)));
      }
      triggerCsvDownload("met_matrix_template.csv", rows);
    });
    $("#metImportCsv").addEventListener("click", () => $("#metCsvFile").click());
    $("#metCsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const mat = parseNumericCsvMatrix(txt);
      if (!mat.length) return;
      // If first row likely header (non-numeric), parser strips it by numeric filter.
      const g = Math.max(2, Math.min(30, mat.length));
      const eN = Math.max(2, Math.min(12, Math.min(...mat.map((r) => r.length))));
      $("#metG").value = String(g);
      $("#metE").value = String(eN);
      build(g, eN);
      for (let i = 0; i < g; i++) for (let j = 0; j < eN; j++) {
        const v = mat[i]?.[j];
        if (!Number.isFinite(v)) continue;
        const input = document.querySelector(`#metWrap input[data-met="g${i}e${j}"]`);
        if (input) input.value = String(v);
      }
      $("#metCompute").click();
      e.target.value = "";
    });

    $("#metCompute").addEventListener("click", () => {
      const { g, e, M, errors } = readMatrix();
      if (shouldBlockForValidation("met", errors, "#metKpis")) return;
      const gMeans = M.map((row) => mean(row));
      const eMeans = Array.from({ length: e }, (_, j) => mean(M.map((r) => r[j])));
      const overall = mean(gMeans);

      const gSD = M.map((row, i) => {
        const m = gMeans[i];
        const v = mean(row.map((x) => (x - m) * (x - m)));
        return Math.sqrt(v);
      });
      const gCV = gMeans.map((m, i) => (m === 0 ? 0 : (gSD[i] / m) * 100));

      const summary = gMeans.map((m, i) => ({ g: `G${i + 1}`, mean: m, sd: gSD[i], cv: gCV[i] }))
        .sort((a, b) => b.mean - a.mean);
      const best = summary[0];
      const stable = [...summary].sort((a, b) => a.cv - b.cv)[0];

      $("#metKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Overall mean</div><div class="value">${overall.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Top genotype</div><div class="value">${qs(best.g)}</div></div>
          <div class="kpi"><div class="label">Top mean</div><div class="value">${best.mean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Most stable (min CV)</div><div class="value">${qs(stable.g)}</div></div>
          <div class="kpi"><div class="label">Stability CV</div><div class="value">${stable.cv.toFixed(2)}%</div></div>
        </div>
      `;

      drawBarChart($("#metChart"), summary.slice(0, Math.min(12, summary.length)).map((x) => x.g), summary.slice(0, Math.min(12, summary.length)).map((x) => x.mean), {
        title: "Genotype mean performance across environments",
      });

      const t1 = buildTable(
        ["Genotype", "Mean", "SD across environments", "CV (%)", "Rank by mean"],
        summary.map((x, i) => [x.g, x.mean, x.sd, x.cv, i + 1])
      );
      const t2 = buildTable(
        ["Environment", "Environment mean"],
        eMeans.map((m, j) => [`E${j + 1}`, m])
      );
      const metOut = outlierFlags(M.flat());
      const qItemsMET = [
        { check: "Environment count adequacy", pass: e >= 3, note: `e=${e}` },
        { check: "Outlier load (IQR)", pass: metOut.count <= Math.max(1, Math.floor(M.flat().length * 0.12)), note: `${metOut.count} flagged value(s).` },
        { check: "Stability CV level", pass: stable.cv <= 25, note: `best CV=${stable.cv.toFixed(2)}%` },
      ];
      if (strictModeShouldBlock("met", qItemsMET, "#metKpis")) return;
      $("#metTables").innerHTML = `${qualityScoreHtml(qItemsMET)}<div style="height:10px"></div><h4>Table 1. Genotype stability summary</h4>${t1}<div style="height:10px"></div><h4>Table 2. Environment means</h4>${t2}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 3. Assumption checklist", [
        { assumption: "Comparable trial management across environments", status: "Required", note: "Large management differences can confound adaptation inference." },
        { assumption: "Consistent trait measurement protocol", status: "Required", note: "Ensure same measurement scale across locations/seasons." },
        { assumption: "Independence of environmental errors", status: "Assumed", note: "Correlated errors can bias stability metrics." }
      ])}`;

      const deviationHtml = deviationBanner("met", { bestMean: best.mean, bestCV: stable.cv }, ["bestMean", "bestCV"]);
      const interpretation =
        `MET summarizes genotype performance and stability across test environments.\n\n` +
        `Top mean performer: ${best.g} (mean=${best.mean.toFixed(3)}).\n` +
        `Most stable by CV: ${stable.g} (CV=${stable.cv.toFixed(2)}%).\n\n` +
        `Selection note: choose high mean + acceptable stability according to breeding objective (broad adaptation vs specific adaptation).`;
      setInterpretation("met", interpretation, deviationHtml || "", { bestMean: best.mean, bestCV: stable.cv });
      setRunMeta("met", { forceRun: isForceRunEnabled(), inputSize: `g=${g}, e=${e}`, standardization: "none", preprocessing: "No truncation; matrix used as entered.", qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsMET.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });

    $("#metERCompute").addEventListener("click", () => {
      const { g, e, M, errors } = readMatrix();
      if (shouldBlockForValidation("met-er", errors, "#metKpis")) return;
      const gMeans = M.map((row) => mean(row));
      const eMeans = Array.from({ length: e }, (_, j) => mean(M.map((r) => r[j])));
      const grand = mean(gMeans);
      const I = eMeans.map((m) => m - grand); // environment index
      const sII = I.reduce((s, x) => s + x * x, 0) || 1e-12;

      const rows = [];
      for (let i = 0; i < g; i++) {
        const yi = M[i];
        const gMean = gMeans[i];
        const biNum = yi.reduce((s, y, j) => s + I[j] * (y - gMean), 0);
        const bi = biNum / sII;
        const ai = gMean; // because mean(I)=0
        const s2diNum = yi.reduce((s, y, j) => {
          const pred = ai + bi * I[j];
          return s + (y - pred) * (y - pred);
        }, 0);
        const s2di = e > 2 ? s2diNum / (e - 2) : 0;
        rows.push({ g: `G${i + 1}`, mean: gMean, bi, s2di });
      }

      const stable = rows
        .map((r) => ({ ...r, d1: Math.abs(r.bi - 1), d2: r.s2di }))
        .sort((a, b) => (a.d1 + a.d2) - (b.d1 + b.d2))[0];
      const broad = rows.filter((r) => Math.abs(r.bi - 1) <= 0.2 && r.s2di <= mean(rows.map((x) => x.s2di)));
      const envTable = buildTable(["Environment", "Mean", "Environmental index (Ij)"], eMeans.map((m, j) => [`E${j + 1}`, m, I[j]]));
      const gTable = buildTable(
        ["Genotype", "Mean", "bi (regression coefficient)", "S^2di (deviation from regression)", "Interpretation"],
        rows.map((r) => {
          const cls =
            r.bi > 1.2
              ? "Responsive to favorable environments"
              : r.bi < 0.8
              ? "Better under unfavorable environments"
              : "Average responsiveness";
          return [r.g, r.mean, r.bi, r.s2di, cls];
        })
      );

      // plot mean vs bi (Eberhart-Russell style)
      const points = rows.map((r) => ({ x: r.mean, y: r.bi }));
      const metCanvas = $("#metChart");
      drawScatterPlot(metCanvas, points, { title: "Eberhart-Russell: Mean vs bi", xLabel: "Genotype mean", yLabel: "bi" });
      const ctx = metCanvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = metCanvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const rx = Math.max(1e-9, maxX - minX), ry = Math.max(1e-9, maxY - minY);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "700 11px Segoe UI, system-ui, sans-serif";
      rows.forEach((r) => {
        const pt = projectScatterXY(w, h, true, minX, rx, minY, ry, r.mean, r.bi);
        ctx.fillText(r.g, pt.px + 6, pt.py - 6);
      });

      $("#metKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Grand mean</div><div class="value">${grand.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Most stable (E&R)</div><div class="value">${qs(stable.g)}</div></div>
          <div class="kpi"><div class="label">bi of stable genotype</div><div class="value">${stable.bi.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">S^2di of stable genotype</div><div class="value">${stable.s2di.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Broadly adapted count</div><div class="value">${broad.length}</div></div>
        </div>
      `;

      $("#metTables").innerHTML = `<h4>Table 1. Eberhart-Russell genotype stability parameters</h4>${gTable}<div style="height:10px"></div><h4>Table 2. Environmental indices</h4>${envTable}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 3. Assumption checklist (Eberhart-Russell)", [
        { assumption: "Linear genotype response to environment index", status: "Core model", note: "bi and S^2di rely on linear response assumption." },
        { assumption: "Sufficient environments", status: "Recommended", note: "At least 3-4 environments for stable estimates." },
        { assumption: "Independent residuals across environments", status: "Assumed", note: "Dependence can inflate or deflate S^2di." }
      ])}`;
      const qItemsER = [
        { check: "Environment count adequacy", pass: e >= 3, note: `e=${e}` },
        { check: "bi proximity to 1 (best)", pass: Math.abs(stable.bi - 1) <= 0.25, note: `bi=${stable.bi.toFixed(3)}` },
        { check: "Low S^2di (best)", pass: stable.s2di <= mean(rows.map((x) => x.s2di)), note: `S^2di=${stable.s2di.toFixed(4)}` },
      ];
      if (strictModeShouldBlock("met-er", qItemsER, "#metKpis")) return;
      $("#metTables").innerHTML = `${qualityScoreHtml(qItemsER)}<div style="height:10px"></div><h4>Table 1. Eberhart-Russell genotype stability parameters</h4>${gTable}<div style="height:10px"></div><h4>Table 2. Environmental indices</h4>${envTable}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 3. Assumption checklist (Eberhart-Russell)", [
        { assumption: "Linear genotype response to environment index", status: "Core model", note: "bi and S^2di rely on linear response assumption." },
        { assumption: "Sufficient environments", status: "Recommended", note: "At least 3-4 environments for stable estimates." },
        { assumption: "Independent residuals across environments", status: "Assumed", note: "Dependence can inflate or deflate S^2di." }
      ])}`;

      const deviationHtml = deviationBanner("met-er", { bestMean: stable.mean, bestCV: stable.s2di }, ["bestMean", "bestCV"]);
      const interpretation =
        `Eberhart and Russell stability model evaluates adaptability with bi (responsiveness) and S^2di (deviation from regression).\n\n` +
        `Stable wide-adaptation genotypes generally show high mean, bi≈1 and low S^2di.\n` +
        `Most stable in this run: ${stable.g} (mean=${stable.mean.toFixed(3)}, bi=${stable.bi.toFixed(3)}, S^2di=${stable.s2di.toFixed(4)}).\n\n` +
        `Interpretation guide: bi>1 indicates responsiveness to favorable environments; bi<1 indicates relative suitability under stressed/unfavorable environments.`;
      setInterpretation("met-er", interpretation, deviationHtml || "", { bestMean: stable.mean, bestCV: stable.s2di });
      setRunMeta("met-er", { forceRun: isForceRunEnabled(), inputSize: `g=${g}, e=${e}`, standardization: "none", preprocessing: "No truncation; Eberhart-Russell fit on current MET matrix.", qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsER.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });

    $("#metCompute").click();
  }

  // --- AMMI + Biplot ---
  function renderAMMI() {
    const title = "AMMI and Biplot (Calculator)";
    showContentHeader({
      title,
      subtitle: "Input GxE matrix, compute AMMI-style decomposition and IPCA1 scores, and view an AMMI1-like biplot.",
    });

    const defaultG = 6;
    const defaultE = 4;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Genotype x Environment means</div></div>
        <div class="kpi"><div class="label">Output</div><div class="value">AMMI ANOVA + IPCA1 scores</div></div>
        <div class="kpi"><div class="label">Plot</div><div class="value">AMMI1-style biplot</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>GxE matrix</h4>
            <div class="input-grid">
              <div class="two-col">
                <label>Genotypes (g)<input type="number" min="2" max="30" id="ammiG" value="${defaultG}" /></label>
                <label>Environments (e)<input type="number" min="2" max="12" id="ammiE" value="${defaultE}" /></label>
              </div>
              <button class="action-btn primary2" type="button" id="ammiBuild">Build matrix</button>
            </div>
            <div id="ammiWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="ammiCompute">Compute AMMI</button>
              <button class="action-btn" type="button" id="ammiImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="ammiTemplateCsv">Download template CSV</button>
              <input type="file" id="ammiCsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="ammiKpis"></div>
            <div class="chart" style="height:300px;margin-top:12px"><canvas id="ammiChart" style="width:100%;height:100%"></canvas></div>
            <div id="ammiTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "ammi",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["ipca1Var"],
    });

    function build(g, e) {
      const wrap = $("#ammiWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Genotype", ...Array.from({ length: e }, (_, j) => `E${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < g; i++) {
        const cells = [];
        for (let j = 0; j < e; j++) {
          const v = 24 + i * 1.05 + j * 0.85 + ((i * j) % 4) * 0.5 + (i === 1 && j === 2 ? 1.6 : 0);
          cells.push(`<td><input type="number" step="0.01" value="${v.toFixed(2)}" data-ammi="g${i}e${j}" /></td>`);
        }
        rows.push(`<tr><th>G${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function powerIterationSymmetric(A, iters = 80) {
      const n = A.length;
      let v = Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0.5 / n));
      for (let t = 0; t < iters; t++) {
        const Av = matVecMul(A, v);
        const norm = Math.sqrt(Av.reduce((s, x) => s + x * x, 0)) || 1;
        v = Av.map((x) => x / norm);
      }
      const Av = matVecMul(A, v);
      const lambda = v.reduce((s, x, i) => s + x * Av[i], 0);
      return { lambda, v };
    }

    function drawAmmiBiplot(canvas, gPoints, ePoints) {
      const all = [...gPoints.map((p) => ({ x: p.x, y: p.y })), ...ePoints.map((p) => ({ x: p.x, y: p.y }))];
      drawScatterPlot(canvas, all, { title: "AMMI1-style biplot", xLabel: "Mean", yLabel: "IPCA1" });
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const xs = all.map((p) => p.x);
      const ys = all.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = Math.max(1e-9, maxX - minX);
      const rangeY = Math.max(1e-9, maxY - minY);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      function toPx(x, y) {
        return projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, x, y);
      }

      // Genotypes
      ctx.font = "700 11px Segoe UI, Arial";
      gPoints.forEach((p) => {
        const { px, py } = toPx(p.x, p.y);
        ctx.fillStyle = "#0d9488";
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CHART.ink;
        ctx.fillText(p.label, px + 6, py - 6);
      });
      ePoints.forEach((p) => {
        const { px, py } = toPx(p.x, p.y);
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(px - 4.2, py - 4.2, 8.4, 8.4);
        ctx.fillStyle = CHART.ink;
        ctx.fillText(p.label, px + 6, py - 6);
      });
    }

    build(defaultG, defaultE);
    $("#ammiBuild").addEventListener("click", () => {
      const g = Math.max(2, Math.min(30, Number($("#ammiG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#ammiE").value || defaultE)));
      build(g, e);
    });

    $("#ammiTemplateCsv").addEventListener("click", () => {
      const g = Math.max(2, Math.min(30, Number($("#ammiG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#ammiE").value || defaultE)));
      const rows = [Array.from({ length: e }, (_, j) => `E${j + 1}`)];
      for (let i = 0; i < g; i++) rows.push(Array.from({ length: e }, (_, j) => (24 + i * 1.1 + j * 0.9).toFixed(2)));
      triggerCsvDownload("ammi_matrix_template.csv", rows);
    });
    $("#ammiImportCsv").addEventListener("click", () => $("#ammiCsvFile").click());
    $("#ammiCsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const mat = parseNumericCsvMatrix(txt);
      if (!mat.length) return;
      const g = Math.max(2, Math.min(30, mat.length));
      const eN = Math.max(2, Math.min(12, Math.min(...mat.map((r) => r.length))));
      $("#ammiG").value = String(g);
      $("#ammiE").value = String(eN);
      build(g, eN);
      for (let i = 0; i < g; i++) for (let j = 0; j < eN; j++) {
        const v = mat[i]?.[j];
        if (!Number.isFinite(v)) continue;
        const input = document.querySelector(`#ammiWrap input[data-ammi="g${i}e${j}"]`);
        if (input) input.value = String(v);
      }
      $("#ammiCompute").click();
      e.target.value = "";
    });

    $("#ammiCompute").addEventListener("click", () => {
      const g = Math.max(2, Math.min(30, Number($("#ammiG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#ammiE").value || defaultE)));
      const M = Array.from({ length: g }, () => Array(e).fill(0));
      for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) {
        const v = Number(document.querySelector(`#ammiWrap input[data-ammi="g${i}e${j}"]`)?.value ?? 0);
        M[i][j] = Number.isFinite(v) ? v : 0;
      }

      const gMeans = M.map((row) => mean(row));
      const eMeans = Array.from({ length: e }, (_, j) => mean(M.map((r) => r[j])));
      const grand = mean(gMeans);

      // ANOVA partition (approx, no replicate term)
      let ssTotal = 0;
      for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) ssTotal += (M[i][j] - grand) ** 2;
      let ssG = 0;
      for (let i = 0; i < g; i++) ssG += e * (gMeans[i] - grand) ** 2;
      let ssE = 0;
      for (let j = 0; j < e; j++) ssE += g * (eMeans[j] - grand) ** 2;
      const ssGE = Math.max(0, ssTotal - ssG - ssE);

      // interaction matrix I = y_ij - gi - ej + grand
      const I = Array.from({ length: g }, () => Array(e).fill(0));
      for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) I[i][j] = M[i][j] - gMeans[i] - eMeans[j] + grand;

      // PC1 on genotype side via eigen of I*I'
      const Cg = Array.from({ length: g }, () => Array(g).fill(0));
      for (let i = 0; i < g; i++) {
        for (let k = 0; k < g; k++) {
          let s = 0;
          for (let j = 0; j < e; j++) s += I[i][j] * I[k][j];
          Cg[i][k] = s;
        }
      }
      const eig = powerIterationSymmetric(Cg, 90);
      const ipca1Var = Math.max(0, eig.lambda);
      const totalGEVar = Cg.reduce((acc, row, i) => acc + row[i], 0);
      const ipca1Pct = totalGEVar <= 1e-12 ? 0 : (ipca1Var / totalGEVar) * 100;

      const gScores = eig.v.map((x) => x * Math.sqrt(ipca1Var || 0));
      // environment scores from v_j = (I' u)/sqrt(lambda)
      const eScores = Array(e).fill(0);
      const denom = Math.sqrt(ipca1Var || 1);
      for (let j = 0; j < e; j++) {
        let s = 0;
        for (let i = 0; i < g; i++) s += I[i][j] * eig.v[i];
        eScores[j] = s / denom;
      }

      $("#ammiKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Grand mean</div><div class="value">${grand.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">SS(G)</div><div class="value">${ssG.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">SS(E)</div><div class="value">${ssE.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">SS(GxE)</div><div class="value">${ssGE.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">IPCA1 share</div><div class="value">${ipca1Pct.toFixed(2)}%</div></div>
        </div>
      `;

      const gPts = gMeans.map((m, i) => ({ label: `G${i + 1}`, x: m, y: gScores[i] }));
      const ePts = eMeans.map((m, j) => ({ label: `E${j + 1}`, x: m, y: eScores[j] }));
      drawAmmiBiplot($("#ammiChart"), gPts, ePts);

      const tAnova = buildTable(
        ["Source", "SS", "df"],
        [
          ["Genotypes", ssG, g - 1],
          ["Environments", ssE, e - 1],
          ["GxE interaction", ssGE, (g - 1) * (e - 1)],
          ["Total", ssTotal, g * e - 1],
        ]
      );
      const tG = buildTable(
        ["Genotype", "Mean", "IPCA1 score"],
        gPts.map((p) => [p.label, p.x, p.y])
      );
      const tE = buildTable(
        ["Environment", "Mean", "IPCA1 score"],
        ePts.map((p) => [p.label, p.x, p.y])
      );
      $("#ammiTables").innerHTML = `<h4>Table 1. AMMI ANOVA summary</h4>${tAnova}<div style="height:10px"></div><h4>Table 2. Genotype means and IPCA1</h4>${tG}<div style="height:10px"></div><h4>Table 3. Environment means and IPCA1</h4>${tE}`;

      const deviationHtml = deviationBanner("ammi", { ipca1Var }, ["ipca1Var"]);
      const interpretation =
        `AMMI partitions total variation into genotype main effects, environment main effects, and GxE interaction.\n\n` +
        `IPCA1 captures ${ipca1Pct.toFixed(2)}% of interaction variation (approximate AMMI1 view).\n` +
        `Genotypes with high mean and IPCA1 near zero are often considered broadly stable under AMMI1 interpretation.\n` +
        `Environments with large |IPCA1| contribute strongly to interaction discrimination.`;
      setInterpretation("ammi", interpretation, deviationHtml || "", { ipca1Var });
    });

    $("#ammiCompute").click();
  }

  // --- Discriminant Function Analysis ---
  function renderDiscriminant() {
    const title = "Discriminant Function Analysis (Calculator)";
    showContentHeader({
      title,
      subtitle: "Input two-group trait data, compute linear discriminant scores, classify samples, and report accuracy.",
    });

    const defaultN = 8;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Two-group, two-trait data</div></div>
        <div class="kpi"><div class="label">Output</div><div class="value">LD score, class prediction, accuracy</div></div>
        <div class="kpi"><div class="label">Plot</div><div class="value">LD1 group separation</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Grouped input data</h4>
            <div class="input-grid">
              <label>Rows per group
                <input type="number" min="4" max="40" id="dfaN" value="${defaultN}" />
              </label>
              <button class="action-btn primary2" type="button" id="dfaBuild">Build grouped table</button>
              <div class="note" style="margin:0">
                Groups: A and B. Traits: X1 and X2. Edit values then compute.
              </div>
            </div>
            <div id="dfaWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="dfaCompute">Compute Discriminant Function</button>
              <button class="action-btn" type="button" id="dfaImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="dfaTemplateCsv">Download template CSV</button>
              <input type="file" id="dfaCsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="dfaKpis"></div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="dfaChart" style="width:100%;height:100%"></canvas></div>
            <div id="dfaTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "discriminant",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["acc", "ldSeparation"],
    });

    function build(n) {
      const wrap = $("#dfaWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      table.innerHTML = `<thead><tr><th>Sample</th><th>Group</th><th>X1</th><th>X2</th></tr></thead>`;
      const rows = [];
      for (let i = 0; i < n; i++) {
        const x1 = 12 + i * 0.8 + (i % 2 ? 0.9 : 0.1);
        const x2 = 8 + i * 0.55 + (i % 3 ? 0.4 : 0.05);
        rows.push(`<tr>
          <th>A${i + 1}</th><td>A</td>
          <td><input type="number" step="0.01" value="${x1.toFixed(2)}" data-dfa="A${i}-x1"/></td>
          <td><input type="number" step="0.01" value="${x2.toFixed(2)}" data-dfa="A${i}-x2"/></td>
        </tr>`);
      }
      for (let i = 0; i < n; i++) {
        const x1 = 17 + i * 0.7 + (i % 2 ? 0.4 : 1.0);
        const x2 = 11 + i * 0.5 + (i % 3 ? 0.2 : 0.8);
        rows.push(`<tr>
          <th>B${i + 1}</th><td>B</td>
          <td><input type="number" step="0.01" value="${x1.toFixed(2)}" data-dfa="B${i}-x1"/></td>
          <td><input type="number" step="0.01" value="${x2.toFixed(2)}" data-dfa="B${i}-x2"/></td>
        </tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function invert2x2(a, b, c, d) {
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-12) return null;
      return [d / det, -b / det, -c / det, a / det];
    }

    function drawLDSeparation(canvas, scoredA, scoredB) {
      // Plot LD1 as x-axis and group lane as y jitter
      const points = [
        ...scoredA.map((x, i) => ({ x, y: 0.9 + (i % 3) * 0.05, label: `A${i + 1}` })),
        ...scoredB.map((x, i) => ({ x, y: 1.8 + (i % 3) * 0.05, label: `B${i + 1}` })),
      ];
      drawScatterPlot(canvas, points, { title: "Discriminant score separation (LD1)", xLabel: "LD1 score", yLabel: "Group lane" });
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const rx = Math.max(1e-9, maxX - minX), ry = Math.max(1e-9, maxY - minY);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      points.forEach((p) => {
        const pt = projectScatterXY(w, h, true, minX, rx, minY, ry, p.x, p.y);
        ctx.fillStyle = p.label.startsWith("A") ? "#0d9488" : "#d97706";
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, 4.8, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    build(defaultN);
    $("#dfaBuild").addEventListener("click", () => {
      const n = Math.max(4, Math.min(40, Number($("#dfaN").value || defaultN)));
      build(n);
    });

    $("#dfaTemplateCsv").addEventListener("click", () => {
      const n = Math.max(4, Math.min(40, Number($("#dfaN").value || defaultN)));
      const rows = [["group", "x1", "x2"]];
      for (let i = 0; i < n; i++) rows.push(["A", (12 + i * 0.8).toFixed(2), (8 + i * 0.5).toFixed(2)]);
      for (let i = 0; i < n; i++) rows.push(["B", (17 + i * 0.7).toFixed(2), (11 + i * 0.45).toFixed(2)]);
      triggerCsvDownload("discriminant_grouped_template.csv", rows);
    });
    $("#dfaImportCsv").addEventListener("click", () => $("#dfaCsvFile").click());
    $("#dfaCsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const rows = parseCsv(txt);
      if (rows.length < 2) return;
      const data = rows.slice(1);
      const A = data.filter((r) => String(r[0]).trim().toUpperCase() === "A");
      const B = data.filter((r) => String(r[0]).trim().toUpperCase() === "B");
      const n = Math.max(4, Math.min(40, Math.min(A.length, B.length)));
      $("#dfaN").value = String(n);
      build(n);
      for (let i = 0; i < n; i++) {
        const a = A[i] || [];
        const b = B[i] || [];
        const ax1 = Number(a[1]), ax2 = Number(a[2]), bx1 = Number(b[1]), bx2 = Number(b[2]);
        const ai1 = document.querySelector(`#dfaWrap input[data-dfa="A${i}-x1"]`);
        const ai2 = document.querySelector(`#dfaWrap input[data-dfa="A${i}-x2"]`);
        const bi1 = document.querySelector(`#dfaWrap input[data-dfa="B${i}-x1"]`);
        const bi2 = document.querySelector(`#dfaWrap input[data-dfa="B${i}-x2"]`);
        if (ai1 && Number.isFinite(ax1)) ai1.value = String(ax1);
        if (ai2 && Number.isFinite(ax2)) ai2.value = String(ax2);
        if (bi1 && Number.isFinite(bx1)) bi1.value = String(bx1);
        if (bi2 && Number.isFinite(bx2)) bi2.value = String(bx2);
      }
      $("#dfaCompute").click();
      e.target.value = "";
    });

    $("#dfaCompute").addEventListener("click", () => {
      const n = Math.max(4, Math.min(40, Number($("#dfaN").value || defaultN)));
      const A = [];
      const B = [];
      for (let i = 0; i < n; i++) {
        const ax1 = Number(document.querySelector(`#dfaWrap input[data-dfa="A${i}-x1"]`)?.value ?? 0);
        const ax2 = Number(document.querySelector(`#dfaWrap input[data-dfa="A${i}-x2"]`)?.value ?? 0);
        const bx1 = Number(document.querySelector(`#dfaWrap input[data-dfa="B${i}-x1"]`)?.value ?? 0);
        const bx2 = Number(document.querySelector(`#dfaWrap input[data-dfa="B${i}-x2"]`)?.value ?? 0);
        A.push([ax1, ax2]);
        B.push([bx1, bx2]);
      }

      const meanA = [mean(A.map((r) => r[0])), mean(A.map((r) => r[1]))];
      const meanB = [mean(B.map((r) => r[0])), mean(B.map((r) => r[1]))];
      const dMean = [meanB[0] - meanA[0], meanB[1] - meanA[1]];

      // pooled within covariance (2x2)
      function cov2(rows, means) {
        let s11 = 0, s22 = 0, s12 = 0;
        for (const r of rows) {
          const x = r[0] - means[0];
          const y = r[1] - means[1];
          s11 += x * x;
          s22 += y * y;
          s12 += x * y;
        }
        const den = Math.max(1, rows.length - 1);
        return [s11 / den, s12 / den, s12 / den, s22 / den];
      }
      const SA = cov2(A, meanA);
      const SB = cov2(B, meanB);
      const n1 = A.length, n2 = B.length;
      const SW = [
        ((n1 - 1) * SA[0] + (n2 - 1) * SB[0]) / Math.max(1, n1 + n2 - 2),
        ((n1 - 1) * SA[1] + (n2 - 1) * SB[1]) / Math.max(1, n1 + n2 - 2),
        ((n1 - 1) * SA[2] + (n2 - 1) * SB[2]) / Math.max(1, n1 + n2 - 2),
        ((n1 - 1) * SA[3] + (n2 - 1) * SB[3]) / Math.max(1, n1 + n2 - 2),
      ];
      const inv = invert2x2(SW[0], SW[1], SW[2], SW[3]);
      if (!inv) {
        $("#dfaKpis").innerHTML = `<div class="note">Pooled covariance is singular. Adjust data (remove collinearity) and recompute.</div>`;
        $("#dfaTables").innerHTML = "";
        return;
      }

      // Fisher linear discriminant vector w = SW^-1 (meanB - meanA)
      const w = [
        inv[0] * dMean[0] + inv[1] * dMean[1],
        inv[2] * dMean[0] + inv[3] * dMean[1],
      ];
      const score = (row) => w[0] * row[0] + w[1] * row[1];
      const scoreA = A.map(score);
      const scoreB = B.map(score);
      const cA = mean(scoreA);
      const cB = mean(scoreB);
      const threshold = (cA + cB) / 2;

      // classify
      const predA = scoreA.map((s) => (s >= threshold ? "B" : "A"));
      const predB = scoreB.map((s) => (s >= threshold ? "B" : "A"));
      const correctA = predA.filter((p) => p === "A").length;
      const correctB = predB.filter((p) => p === "B").length;
      const acc = ((correctA + correctB) / (n1 + n2)) * 100;
      const ldSep = Math.abs(cB - cA);

      $("#dfaKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">w1</div><div class="value">${w[0].toFixed(4)}</div></div>
          <div class="kpi"><div class="label">w2</div><div class="value">${w[1].toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Centroid gap |cB-cA|</div><div class="value">${ldSep.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Threshold</div><div class="value">${threshold.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Training accuracy</div><div class="value">${acc.toFixed(2)}%</div></div>
        </div>
      `;

      drawLDSeparation($("#dfaChart"), scoreA, scoreB);

      const t1 = buildTable(
        ["Sample", "True group", "LD score", "Predicted group", "Correct?"],
        [
          ...scoreA.map((s, i) => [`A${i + 1}`, "A", s, predA[i], predA[i] === "A" ? "Yes" : "No"]),
          ...scoreB.map((s, i) => [`B${i + 1}`, "B", s, predB[i], predB[i] === "B" ? "Yes" : "No"]),
        ]
      );
      const t2 = buildTable(
        ["Parameter", "Estimate"],
        [
          ["Group A centroid (LD1)", cA],
          ["Group B centroid (LD1)", cB],
          ["Threshold", threshold],
          ["Centroid separation |cB-cA|", ldSep],
          ["Accuracy (%)", acc],
        ]
      );
      $("#dfaTables").innerHTML = `<h4>Table 1. Sample-wise discriminant classification</h4>${t1}<div style="height:10px"></div><h4>Table 2. Discriminant model summary</h4>${t2}`;

      const deviationHtml = deviationBanner("discriminant", { acc, ldSeparation: ldSep }, ["acc", "ldSeparation"]);
      const interpretation =
        `Discriminant analysis constructs a linear function D = w1*X1 + w2*X2 to separate predefined groups.\n\n` +
        `Model summary:\n` +
        `• D coefficients: w1=${w[0].toFixed(4)}, w2=${w[1].toFixed(4)}\n` +
        `• Group centroids: A=${cA.toFixed(4)}, B=${cB.toFixed(4)}\n` +
        `• Separation gap=${ldSep.toFixed(4)}, accuracy=${acc.toFixed(2)}%\n\n` +
        `Higher centroid separation and accuracy indicate stronger discriminatory power of the selected traits.`;
      setInterpretation("discriminant", interpretation, deviationHtml || "", { acc, ldSeparation: ldSep });
    });

    $("#dfaCompute").click();
  }

  // --- Factor Analysis ---
  function renderFactorAnalysis() {
    const title = "Factor Analysis (Calculator)";
    showContentHeader({
      title,
      subtitle: "Input trait correlation matrix, estimate factor loadings, communalities, and explained variance with scree plot.",
    });

    const defaultP = 4;
    const defaultK = 2;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Trait correlation matrix</div></div>
        <div class="kpi"><div class="label">Output</div><div class="value">Loadings, communalities, variance</div></div>
        <div class="kpi"><div class="label">Plot</div><div class="value">Scree plot</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Correlation matrix input</h4>
            <div class="input-grid">
              <div class="two-col">
                <label>Number of traits (p)
                  <input type="number" min="2" max="8" id="faP" value="${defaultP}" />
                </label>
                <label>Factors to retain (k)
                  <input type="number" min="1" max="4" id="faK" value="${defaultK}" />
                </label>
              </div>
              <label>Trait names (comma separated)
                <input type="text" id="faNames" value="Trait1, Trait2, Trait3, Trait4" />
              </label>
              <label class="pill"><input type="checkbox" id="faStandardize" /> Standardize trait matrix before decomposition</label>
              <button class="action-btn primary2" type="button" id="faBuild">Build matrix</button>
            </div>
            <div id="faWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="faCompute">Compute Factor Analysis</button>
              <button class="action-btn" type="button" id="faImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="faTemplateCsv">Download template CSV</button>
              <input type="file" id="faCsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="faKpis"></div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="faChart" style="width:100%;height:100%"></canvas></div>
            <div id="faTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "factoranalysis",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["pc1Share", "cumShare"],
    });

    function namesFromInput(p) {
      const raw = ($("#faNames").value || "").split(",").map((s) => s.trim()).filter(Boolean);
      const out = [];
      for (let i = 0; i < p; i++) out.push(raw[i] || `Trait${i + 1}`);
      $("#faNames").value = out.join(", ");
      return out;
    }

    function build(p) {
      const names = namesFromInput(p);
      const wrap = $("#faWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Trait", ...names];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < p; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          if (i === j) {
            cells.push(`<td><input type="number" step="0.01" value="1" readonly data-fa="i${i}j${j}" /></td>`);
          } else if (j < i) {
            cells.push(`<td class="muted small" style="font-weight:900">-</td>`);
          } else {
            const v = Math.max(0.05, Math.min(0.95, 0.15 + (i + 1) * 0.12 + (j + 1) * 0.07));
            cells.push(`<td><input type="number" step="0.01" min="-0.99" max="0.99" value="${v.toFixed(2)}" data-fa="i${i}j${j}" /></td>`);
          }
        }
        rows.push(`<tr><th>${qs(names[i])}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function powerEigenSymmetric(A, nComp = 2) {
      // simple deflation-based power iteration for symmetric matrix
      const n = A.length;
      let B = A.map((r) => r.slice());
      const vals = [];
      const vecs = [];
      for (let c = 0; c < Math.min(nComp, n); c++) {
        let v = Array.from({ length: n }, (_, i) => (i === c ? 1 : 0.5 / n));
        for (let it = 0; it < 90; it++) {
          const Bv = matVecMul(B, v);
          const norm = Math.sqrt(Bv.reduce((s, x) => s + x * x, 0)) || 1;
          v = Bv.map((x) => x / norm);
        }
        const Bv = matVecMul(B, v);
        const lambda = v.reduce((s, x, i) => s + x * Bv[i], 0);
        vals.push(lambda);
        vecs.push(v.slice());
        // deflation: B = B - lambda * v v'
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            B[i][j] -= lambda * v[i] * v[j];
          }
        }
      }
      return { vals, vecs };
    }

    build(defaultP);
    $("#faBuild").addEventListener("click", () => {
      const p = Math.max(2, Math.min(8, Number($("#faP").value || defaultP)));
      build(p);
    });

    $("#faTemplateCsv").addEventListener("click", () => {
      const p = Math.max(2, Math.min(8, Number($("#faP").value || defaultP)));
      const rows = [Array.from({ length: p }, (_, j) => `Trait${j + 1}`)];
      for (let i = 0; i < p; i++) {
        const row = [];
        for (let j = 0; j < p; j++) row.push(i === j ? "1" : (0.2 + (i + 1) * 0.08 + (j + 1) * 0.05).toFixed(2));
        rows.push(row);
      }
      triggerCsvDownload("factor_analysis_corr_template.csv", rows);
    });
    $("#faImportCsv").addEventListener("click", () => $("#faCsvFile").click());
    $("#faCsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const mat = parseNumericCsvMatrix(txt);
      if (!mat.length) return;
      const p = Math.max(2, Math.min(8, mat.length));
      $("#faP").value = String(p);
      build(p);
      for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) {
        const v = mat[i]?.[j];
        if (!Number.isFinite(v)) continue;
        const input = document.querySelector(`#faWrap input[data-fa="i${i}j${j}"]`);
        if (input) input.value = String(v);
      }
      $("#faCompute").click();
      e.target.value = "";
    });

    $("#faCompute").addEventListener("click", () => {
      const p = Math.max(2, Math.min(8, Number($("#faP").value || defaultP)));
      const k = Math.max(1, Math.min(4, Number($("#faK").value || defaultK)));
      const names = namesFromInput(p);
      clearValidation("#faWrap");
      const errors = [];

      const R = Array.from({ length: p }, () => Array(p).fill(0));
      for (let i = 0; i < p; i++) {
        R[i][i] = 1;
        for (let j = i + 1; j < p; j++) {
          const input = document.querySelector(`#faWrap input[data-fa="i${i}j${j}"]`);
          const v = Number(input?.value ?? NaN);
          if (!Number.isFinite(v)) {
            errors.push(`Factor Analysis: invalid value at Trait${i + 1}, Trait${j + 1}`);
            markInvalidInput(input, "Enter numeric correlation");
          } else if (v < -1 || v > 1) {
            errors.push(`Factor Analysis: out-of-range value at Trait${i + 1}, Trait${j + 1}`);
            markInvalidInput(input, "Correlation must be between -1 and 1");
          }
          R[i][j] = Number.isFinite(v) ? v : 0;
          R[j][i] = R[i][j];
        }
      }
      errors.push(...matrixValidationErrors(R, { minVal: -1, maxVal: 1, requireUnitDiag: true }));
      if (shouldBlockForValidation("factoranalysis", errors, "#faKpis")) return;
      const std = !!$("#faStandardize")?.checked;
      const Ruse = std ? zScoreColumns(R).Z : R;

      // eigen decomposition approximation
      const { vals, vecs } = powerEigenSymmetric(Ruse, p);
      const eig = vals.map((v, idx) => ({ val: Math.max(0, v), vec: vecs[idx], idx })).sort((a, b) => b.val - a.val);
      const totalVar = eig.reduce((s, x) => s + x.val, 0) || 1e-12;

      // loadings: l_ij = sqrt(lambda_j) * e_ij
      const use = eig.slice(0, Math.min(k, eig.length));
      const loadings = Array.from({ length: p }, () => Array(use.length).fill(0));
      for (let j = 0; j < use.length; j++) {
        const s = Math.sqrt(Math.max(0, use[j].val));
        for (let i = 0; i < p; i++) loadings[i][j] = use[j].vec[i] * s;
      }
      const communalities = loadings.map((row) => row.reduce((a, b) => a + b * b, 0));
      const uniqueness = communalities.map((h2) => Math.max(0, 1 - h2));

      const explained = eig.map((x) => (x.val / totalVar) * 100);
      const cum = [];
      let acc = 0;
      for (const e of explained) {
        acc += e;
        cum.push(acc);
      }

      const pc1 = explained[0] || 0;
      const cumK = cum[Math.min(use.length - 1, cum.length - 1)] || 0;

      $("#faKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Traits</div><div class="value">${p}</div></div>
          <div class="kpi"><div class="label">Retained factors</div><div class="value">${use.length}</div></div>
          <div class="kpi"><div class="label">Factor1 variance</div><div class="value">${pc1.toFixed(2)}%</div></div>
          <div class="kpi"><div class="label">Cumulative (k)</div><div class="value">${cumK.toFixed(2)}%</div></div>
          <div class="kpi"><div class="label">Top eigenvalue</div><div class="value">${(eig[0]?.val || 0).toFixed(4)}</div></div>
        </div>
      `;

      drawBarChart(
        $("#faChart"),
        eig.map((_, i) => `F${i + 1}`),
        eig.map((x) => x.val),
        { title: "Scree plot (eigenvalues)" }
      );

      const tEig = buildTable(
        ["Factor", "Eigenvalue", "Explained variance (%)", "Cumulative (%)"],
        eig.map((x, i) => [`F${i + 1}`, x.val, explained[i], cum[i]])
      );
      const tLoad = buildTable(
        ["Trait", ...use.map((_, j) => `Loading F${j + 1}`), "Communality (h2)", "Uniqueness (u2)"],
        names.map((nm, i) => [nm, ...loadings[i], communalities[i], uniqueness[i]])
      );
      const qItemsFA = [
        { check: "Trait dimension adequacy", pass: p >= 4, note: `p=${p}` },
        { check: "Variance capture (retained)", pass: cumK >= 60, note: `Cum=${cumK.toFixed(2)}%` },
        { check: "Leading factor informativeness", pass: pc1 >= 30, note: `F1=${pc1.toFixed(2)}%` },
      ];
      if (strictModeShouldBlock("factoranalysis", qItemsFA, "#faKpis")) return;
      $("#faTables").innerHTML = `${qualityScoreHtml(qItemsFA)}<div style="height:10px"></div><h4>Table 1. Eigenvalues and explained variance</h4>${tEig}<div style="height:10px"></div><h4>Table 2. Factor loadings and communalities</h4>${tLoad}`;

      const deviationHtml = deviationBanner("factoranalysis", { pc1Share: pc1, cumShare: cumK }, ["pc1Share", "cumShare"]);
      const interpretation =
        `Factor analysis summarizes correlated traits into latent factors.\n\n` +
        `Retained factors: ${use.length}; cumulative explained variance: ${cumK.toFixed(2)}%.\n` +
        `A larger loading magnitude indicates stronger association of a trait with the corresponding latent factor.\n` +
        `Higher communality indicates that retained factors explain a larger portion of that trait's variance.`;
      setInterpretation("factoranalysis", interpretation, deviationHtml || "", { pc1Share: pc1, cumShare: cumK });
      setRunMeta("factoranalysis", { forceRun: isForceRunEnabled(), inputSize: `p=${p}, k=${use.length}`, standardization: std ? "z-score rows/cols" : "none", preprocessing: "Correlation matrix validated (symmetric, diagonal=1).", qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsFA.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });

    $("#faCompute").click();
  }

  /** PCA (trait space): first k PCs of column-centered X; pure JS power iteration + deflation. */
  function d2VecDot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  function d2VecNorm(v) {
    return Math.sqrt(d2VecDot(v, v));
  }
  function d2VecNormalize(v) {
    const n = d2VecNorm(v);
    if (n < 1e-15) return;
    for (let i = 0; i < v.length; i++) v[i] /= n;
  }
  function d2MatVec(C, v) {
    const p = C.length;
    const out = Array(p).fill(0);
    for (let i = 0; i < p; i++) for (let j = 0; j < v.length; j++) out[i] += C[i][j] * v[j];
    return out;
  }
  function d2CovDeflate(C, lam, v) {
    const p = C.length;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) C[a][b] -= lam * v[a] * v[b];
  }
  /** Returns { scores: n×3, varPct: [3] } for trait matrix X (n genotypes × p traits). */
  function pcaTraitsTop3Scores(X) {
    const n = X.length;
    const p = X[0].length;
    const mu = Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mu[j] += X[i][j];
    for (let j = 0; j < p; j++) mu[j] /= n;
    const Z = X.map((row) => row.map((v, j) => v - mu[j]));
    const nf = Math.max(1, n - 1);
    const C = Array.from({ length: p }, () => Array(p).fill(0));
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += Z[i][a] * Z[i][b];
        C[a][b] = s / nf;
      }
    }
    const Cwork = C.map((r) => r.slice());
    const kMax = Math.min(3, p);
    const evecs = [];
    const evals = [];
    for (let kk = 0; kk < kMax; kk++) {
      const v = Array.from({ length: p }, (_, i) => Math.sin(i * 1.3 + kk * 2.1));
      d2VecNormalize(v);
      for (let it = 0; it < 140; it++) {
        const w = d2MatVec(Cwork, v);
        d2VecNormalize(w);
        for (let i = 0; i < p; i++) v[i] = w[i];
      }
      const lam = Math.max(0, d2VecDot(v, d2MatVec(Cwork, v)));
      evals.push(lam);
      evecs.push(v.slice());
      d2CovDeflate(Cwork, lam, v);
    }
    const trace = evals.reduce((a, b) => a + b, 0);
    const varPct = evals.map((e) => (trace > 1e-12 ? (100 * e) / trace : 0));
    const scores = Z.map((row) => {
      const s = [];
      for (let kk = 0; kk < kMax; kk++) s.push(d2VecDot(row, evecs[kk]));
      while (s.length < 3) s.push(0);
      return s;
    });
    return { scores, varPct };
  }

  function d2MeanDistanceToOthers(D2) {
    const n = D2.length;
    return Array.from({ length: n }, (_, i) => {
      let s = 0;
      let c = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        s += D2[i][j];
        c++;
      }
      return c ? s / c : 0;
    });
  }

  function renderD2PlotlyHeatmapAndPca3d(D2, names, Xuse) {
    const heatEl = document.getElementById("d2PlotlyD2Heatmap");
    const pcaEl = document.getElementById("d2PlotlyPca3d");
    if (!heatEl || !pcaEl) return;
    if (typeof Plotly === "undefined") {
      heatEl.innerHTML = `<p class="muted small">Plotly failed to load — interactive D² / PCA figures unavailable.</p>`;
      pcaEl.innerHTML = "";
      return;
    }
    const dark = bkqPlotlyThemeIsDark();
    const zText = D2.map((row) => row.map((v) => v.toFixed(2)));
    const titleHeat = "<b>Mahalanobis D² distance matrix</b><br><sup>Complete pairwise divergence (matches numeric table)</sup>";
    const layoutHeat = {
      ...bkqPlotlyLayout(titleHeat, {
        margin: { l: 112, r: 72, t: 96, b: 112 },
        xaxis: { title: { text: "Genotypes" }, side: "bottom", tickangle: -40, automargin: true },
        yaxis: { title: { text: "Genotypes" }, autorange: "reversed", automargin: true },
      }),
      height: 560,
    };
    Plotly.newPlot(
      heatEl,
      [
        {
          type: "heatmap",
          z: D2,
          x: names,
          y: names,
          colorscale: "RdYlBu_r",
          text: zText,
          texttemplate: "%{text}",
          textfont: { size: 9 },
          hoverongaps: false,
          colorbar: { title: { text: "D²" }, outlinewidth: 0 },
          hovertemplate: "Genotype %{x} vs %{y}<br>D²: %{z:.4f}<extra></extra>",
        },
      ],
      layoutHeat,
      bkqPlotlyConfig()
    );

    const { scores, varPct } = pcaTraitsTop3Scores(Xuse);
    const avgD = d2MeanDistanceToOthers(D2);
    const title3d = "<b>3D PCA of trait profiles</b><br><sup>Same trait matrix as D²; marker color = mean D² to others</sup>";
    const layout3d = {
      ...bkqPlotlyLayout(title3d, {
        margin: { l: 0, r: 0, t: 96, b: 0 },
        scene: {
          xaxis: { title: `PC1 (${varPct[0]?.toFixed(1) ?? 0}% var.)` },
          yaxis: { title: `PC2 (${varPct[1]?.toFixed(1) ?? 0}% var.)` },
          zaxis: { title: `PC3 (${varPct[2]?.toFixed(1) ?? 0}% var.)` },
          bgcolor: dark ? "#1e293b" : "#f1f5f9",
        },
        height: 520,
      }),
    };
    Plotly.newPlot(
      pcaEl,
      [
        {
          type: "scatter3d",
          mode: "markers+text",
          x: scores.map((r) => r[0]),
          y: scores.map((r) => r[1]),
          z: scores.map((r) => r[2]),
          text: names,
          textposition: "top center",
          marker: {
            size: 10,
            color: avgD,
            colorscale: "Viridis",
            colorbar: { title: { text: "Mean D²" }, outlinewidth: 0 },
            opacity: 0.88,
            line: { width: 2, color: dark ? "#e2e8f0" : "#0f172a" },
          },
          hovertemplate: "<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}<extra></extra>",
        },
      ],
      layout3d,
      bkqPlotlyConfig()
    );
  }

  function purgeD2PlotlyFigures() {
    ["d2PlotlyD2Heatmap", "d2PlotlyPca3d"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && typeof Plotly !== "undefined" && Plotly.purge) Plotly.purge(el);
    });
  }

  // --- D2 Analysis with multiple clustering methods ---
  function renderD2Analysis() {
    const title = "D2 Analysis and Cluster Diagrams";
    showContentHeader({
      title,
      subtitle:
        "Mahalanobis D² from pooled covariance (ridge-regularized); clustering on √(D²) or whitened coordinates. UPGMA dendrogram + consensus co-assignment tree; heterosis outputs.",
    });

    const defaultN = 10;
    const defaultT = 4;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Clustering methods</div><div class="value">K-means, UPGMA, Tocher, Ward</div></div>
        <div class="kpi"><div class="label">D² output</div><div class="value">Intra/inter D² + UPGMA + consensus</div></div>
        <div class="kpi"><div class="label">Extra output</div><div class="value">Mid-parent and better-parent heterosis</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>D2 matrix input</h4>
            <div class="input-grid">
              <div class="two-col">
                <label>Genotypes (n)<input type="number" min="5" max="40" id="d2N" value="${defaultN}" /></label>
                <label>Traits (p)<input type="number" min="2" max="10" id="d2T" value="${defaultT}" /></label>
              </div>
              <label>Methods
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                  <label class="pill"><input type="checkbox" id="d2mK" checked /> K-means</label>
                  <label class="pill"><input type="checkbox" id="d2mU" checked /> UPGMA</label>
                  <label class="pill"><input type="checkbox" id="d2mT" checked /> Tocher</label>
                  <label class="pill"><input type="checkbox" id="d2mW" checked /> Ward</label>
                </div>
              </label>
              <div class="two-col">
                <label>Target clusters (for K-means / cut)
                  <input type="number" min="2" max="12" id="d2K" value="3" />
                </label>
                <label>Dendrogram line width
                  <input type="number" min="1" max="5" step="0.5" id="d2LineW" value="2" />
                </label>
              </div>
              <div class="two-col">
                <label>Point size
                  <input type="number" min="2" max="10" id="d2Point" value="5" />
                </label>
                <label>Consensus cut height (%)
                  <input type="number" min="5" max="95" id="d2Cut" value="60" />
                </label>
              </div>
              <label class="pill"><input type="checkbox" id="d2Standardize" checked /> Standardize trait columns before D2 clustering</label>
              <button class="action-btn primary2" type="button" id="d2Build">Build trait table</button>
            </div>
            <div id="d2Wrap" class="matrix" style="margin-top:12px"></div>
            <div class="section" style="margin-top:12px">
              <h4>Heterosis input (optional)</h4>
              <div class="muted small">Provide parent and F1 means for selected crosses.</div>
              <div id="d2HetWrap" class="matrix" style="margin-top:8px"></div>
            </div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="d2Compute">Compute D2 and clustering</button>
              <button class="action-btn" type="button" id="d2ImportCsv">Import CSV / Excel</button>
              <button class="action-btn" type="button" id="d2TemplateCsv">Download template CSV</button>
              <input type="file" id="d2CsvFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="d2Kpis"></div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="d2ClusterChart" style="width:100%;height:100%"></canvas></div>
            <div class="muted small" style="margin-top:6px">Scatter uses first two Mahalanobis-whitened trait axes (when available).</div>
            <div class="chart" style="height:280px;margin-top:12px"><canvas id="d2DendroChart" style="width:100%;height:100%"></canvas></div>
            <div class="muted small" style="margin-top:4px">UPGMA on Mahalanobis distance D = √(D²); red line = cut height (%).</div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="d2DendroConsensusChart" style="width:100%;height:100%"></canvas></div>
            <div class="muted small" style="margin-top:4px">Consensus dendrogram (Ward on co-assignment dissimilarity 1 − S).</div>
            <div class="chart" style="height:340px;margin-top:14px"><canvas id="d2D2HeatmapChart" style="width:100%;height:100%"></canvas></div>
            <div class="muted small" style="margin-top:6px">Full Mahalanobis D² matrix (same values as Table 1 in the report).</div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="d2IntraInterBarChart" style="width:100%;height:100%"></canvas></div>
            <div class="muted small" style="margin-top:4px">Intra-cluster mean D² vs mean inter-cluster D² for each consensus group (C1, C2, …).</div>
            <h4 style="margin-top:18px;margin-bottom:8px">Interactive Plotly views</h4>
            <div class="actions" style="margin:0 0 10px;flex-wrap:wrap;align-items:center;gap:10px">
              <label class="muted small" style="display:flex;align-items:center;gap:8px;margin:0;font-weight:650">
                Plotly theme
                <select id="d2PlotlyTheme" aria-label="Plotly figure theme for D2 module" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);font-size:13px;background:var(--surface);color:var(--text)">
                  <option value="light">Light (print)</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <span class="muted small" style="line-height:1.45;max-width:42rem">Same setting as Biometric Report; your choice is saved in this browser.</span>
            </div>
            <p class="muted small" style="margin:0 0 8px">Zoom, pan, and download PNG from the mode bar. Same D² matrix as Table 1; 3D PCA uses the trait matrix (aligned with D² analysis).</p>
            <div id="d2PlotlyD2Heatmap" class="plotly-chart js-plotly-plot" style="min-height:520px;margin-top:8px"></div>
            <div class="muted small" style="margin-top:6px">Annotated heatmap: Mahalanobis D² between all genotype pairs.</div>
            <div id="d2PlotlyPca3d" class="plotly-chart js-plotly-plot" style="min-height:520px;margin-top:16px"></div>
            <div class="muted small" style="margin-top:6px">3D PCA of trait profiles; point color = mean pairwise D² to other genotypes (diversity context).</div>
            <div id="d2Tables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "d2",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["bestInterCluster", "consensusSpread"],
    });

    function build(n, p) {
      const wrap = $("#d2Wrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Genotype", ...Array.from({ length: p }, (_, j) => `Trait${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < n; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          const v = 10 + i * 0.9 + j * 1.1 + ((i * (j + 1)) % 5) * 0.4;
          cells.push(`<td><input type="number" step="0.01" value="${v.toFixed(2)}" data-d2="g${i}t${j}" /></td>`);
        }
        rows.push(
          `<tr><th style="padding:6px;min-width:88px"><input type="text" class="d2-name-input" value="${qs(`G${i + 1}`)}" data-d2-name="${i}" maxlength="48" title="Genotype label (shown on dendrogram &amp; plots)" style="width:100%;max-width:132px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);font-size:13px" /></th>${cells.join("")}</tr>`
        );
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);

      const het = $("#d2HetWrap");
      const ht = document.createElement("table");
      ht.className = "data";
      ht.innerHTML = `<thead><tr><th>Cross</th><th>Parent 1 mean</th><th>Parent 2 mean</th><th>F1 mean</th></tr></thead>`;
      const hRows = [];
      for (let i = 0; i < Math.min(8, n - 1); i++) {
        const p1 = 20 + i * 0.8;
        const p2 = 22 + i * 0.6;
        const f1 = 24 + i * 0.9;
        hRows.push(`<tr>
          <th>G${i + 1} x G${i + 2}</th>
          <td><input type="number" step="0.01" value="${p1.toFixed(2)}" data-het="r${i}p1"/></td>
          <td><input type="number" step="0.01" value="${p2.toFixed(2)}" data-het="r${i}p2"/></td>
          <td><input type="number" step="0.01" value="${f1.toFixed(2)}" data-het="r${i}f1"/></td>
        </tr>`);
      }
      ht.insertAdjacentHTML("beforeend", `<tbody>${hRows.join("")}</tbody>`);
      het.innerHTML = "";
      het.appendChild(ht);
    }

    function readData() {
      const n = Math.max(5, Math.min(40, Number($("#d2N").value || defaultN)));
      const p = Math.max(2, Math.min(10, Number($("#d2T").value || defaultT)));
      const X = Array.from({ length: n }, () => Array(p).fill(0));
      const names = [];
      for (let i = 0; i < n; i++) {
        const raw = document.querySelector(`#d2Wrap input[data-d2-name="${i}"]`)?.value ?? "";
        const lab = String(raw).trim() || `G${i + 1}`;
        names.push(lab.slice(0, 48));
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) {
        const v = Number(document.querySelector(`#d2Wrap input[data-d2="g${i}t${j}"]`)?.value ?? 0);
        X[i][j] = Number.isFinite(v) ? v : 0;
      }
      return { n, p, X, names };
    }

    /** CSV/Excel: optional first column genotype names; optional header row. */
    function parseD2TraitImport(txt) {
      const rows = parseCsv(txt).filter((r) => r.some((c) => String(c).trim() !== ""));
      if (rows.length < 2) return null;
      let start = 0;
      const head0 = String(rows[0][0] ?? "").toLowerCase();
      if (
        head0.includes("trait") ||
        head0.includes("genotype") ||
        head0 === "name" ||
        head0 === "g" ||
        head0 === "genotype"
      ) {
        start = 1;
      }
      const names = [];
      const X = [];
      for (let r = start; r < rows.length; r++) {
        const row = rows[r];
        if (!row.length) continue;
        const first = String(row[0] ?? "").trim();
        const numsTail = row.slice(1).map((x) => Number(String(x).trim()));
        const allNum =
          row.length > 1 &&
          row.every((cell, idx) => idx === 0 || Number.isFinite(Number(String(cell).trim())));
        const firstNum = Number(first);
        if (first !== "" && Number.isFinite(firstNum) && allNum) {
          names.push(`G${names.length + 1}`);
          X.push(row.map((x) => Number(String(x).trim())));
        } else if (first !== "" && !Number.isFinite(firstNum)) {
          names.push(first.slice(0, 48));
          if (numsTail.some((v) => !Number.isFinite(v))) return null;
          X.push(numsTail);
        } else if (first !== "" && Number.isFinite(firstNum)) {
          names.push(`G${names.length + 1}`);
          X.push(row.map((x) => Number(String(x).trim())));
        } else {
          return null;
        }
      }
      if (!X.length) return null;
      const p = Math.min(...X.map((row) => row.length));
      const n = X.length;
      const XX = X.map((row) => row.slice(0, p));
      return { n, p, X: XX, names: names.slice(0, n).map((s, i) => s || `G${i + 1}`) };
    }

    function sqDist(a, b) {
      let s = 0;
      for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        s += d * d;
      }
      return s;
    }

    /** Cholesky L with S ≈ L Lᵀ (lower triangular). Returns null if not SPD. */
    function choleskyDecompose(S) {
      const n = S.length;
      const L = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          let sum = S[i][j];
          for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
          if (i === j) {
            if (sum <= 1e-15) return null;
            L[i][j] = Math.sqrt(sum);
          } else {
            L[i][j] = sum / L[j][j];
          }
        }
      }
      return L;
    }

    function solveLowerTriangular(L, b) {
      const n = L.length;
      const x = Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sum = b[i];
        for (let k = 0; k < i; k++) sum -= L[i][k] * x[k];
        x[i] = sum / L[i][i];
      }
      return x;
    }

    /**
     * Pooled-sample Mahalanobis D² between genotypes; D = √(D²) for linkage.
     * Ridge on diagonal stabilizes S⁻¹ when p is large or n is small.
     */
    function mahalanobisFromX(X) {
      const n = X.length;
      const p = X[0].length;
      const mu = Array(p).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mu[j] += X[i][j];
      for (let j = 0; j < p; j++) mu[j] /= n;
      const C = Array.from({ length: p }, () => Array(p).fill(0));
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < p; a++) {
          const da = X[i][a] - mu[a];
          for (let b = 0; b < p; b++) C[a][b] += da * (X[i][b] - mu[b]);
        }
      }
      const nf = Math.max(1, n - 1);
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) C[a][b] /= nf;
      const trace = C.reduce((s, row, i) => s + row[i], 0);
      const ridge = Math.max(1e-12, 1e-4 * (trace / Math.max(1, p)));
      const Cp = C.map((row, i) => row.map((v, j) => (i === j ? v + ridge : v)));
      const L = choleskyDecompose(Cp);
      const D2 = Array.from({ length: n }, () => Array(n).fill(0));
      const D = Array.from({ length: n }, () => Array(n).fill(0));
      if (!L) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const d2 = sqDist(X[i], X[j]);
            D2[i][j] = d2;
            D2[j][i] = d2;
            const d = Math.sqrt(Math.max(0, d2));
            D[i][j] = d;
            D[j][i] = d;
          }
        }
        return { D2, D, Z: X, mu, ridge, fallback: "euclidean" };
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const delta = X[i].map((v, t) => v - X[j][t]);
          const w = solveLowerTriangular(L, delta);
          let d2 = 0;
          for (let t = 0; t < p; t++) d2 += w[t] * w[t];
          D2[i][j] = d2;
          D2[j][i] = d2;
          const d = Math.sqrt(Math.max(0, d2));
          D[i][j] = d;
          D[j][i] = d;
        }
      }
      const Z = Array.from({ length: n }, () => Array(p).fill(0));
      for (let i = 0; i < n; i++) {
        const delta = X[i].map((v, t) => v - mu[t]);
        Z[i] = solveLowerTriangular(L, delta);
      }
      return { D2, D, Z, mu, ridge, fallback: null };
    }

    /** Mean pairwise D² within / between consensus clusters (full matrix). */
    function clusterIntraInterD2MeanMatrix(D2, clusters, cKeys) {
      const k = cKeys.length;
      const M = Array.from({ length: k }, () => Array(k).fill(0));
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          const ai = clusters[cKeys[a]];
          const bi = clusters[cKeys[b]];
          let s = 0;
          let c = 0;
          if (a === b) {
            for (let ii = 0; ii < ai.length; ii++) {
              for (let jj = ii + 1; jj < ai.length; jj++) {
                s += D2[ai[ii]][ai[jj]];
                c++;
              }
            }
          } else {
            for (const i of ai) for (const j of bi) {
              s += D2[i][j];
              c++;
            }
          }
          M[a][b] = c ? s / c : 0;
        }
      }
      return M;
    }

    /** Unrooted-style Newick from UPGMA linkage (merge order = algorithm order). */
    function linkageToNewickString(linkage, n, names) {
      const safe = (s, i) => {
        const t = String(s ?? "").trim() || `G${i + 1}`;
        return t.replace(/[(),:;\s]/g, "_").slice(0, 32);
      };
      const nodes = new Map();
      for (let i = 0; i < n; i++) nodes.set(i, safe(names?.[i], i));
      let newId = n;
      for (const [a, b] of linkage) {
        const left = nodes.get(a);
        const right = nodes.get(b);
        if (left == null || right == null) return "(incomplete merge tree)";
        const s = `(${left},${right})`;
        nodes.set(newId, s);
        newId++;
      }
      return nodes.get(newId - 1) || "";
    }

    function kmeans(X, k, iters = 40) {
      const n = X.length, p = X[0].length;
      const centers = Array.from({ length: k }, (_, c) => X[Math.floor((c * n) / k)].slice());
      let lab = Array(n).fill(0);
      for (let it = 0; it < iters; it++) {
        // assign
        for (let i = 0; i < n; i++) {
          let best = 0, bd = Infinity;
          for (let c = 0; c < k; c++) {
            const d = sqDist(X[i], centers[c]);
            if (d < bd) { bd = d; best = c; }
          }
          lab[i] = best;
        }
        // update
        const sums = Array.from({ length: k }, () => Array(p).fill(0));
        const cnt = Array(k).fill(0);
        for (let i = 0; i < n; i++) {
          cnt[lab[i]]++;
          for (let j = 0; j < p; j++) sums[lab[i]][j] += X[i][j];
        }
        for (let c = 0; c < k; c++) {
          if (!cnt[c]) continue;
          for (let j = 0; j < p; j++) centers[c][j] = sums[c][j] / cnt[c];
        }
      }
      return lab;
    }

    function upgmaLinkage(D) {
      const n = D.length;
      let clusters = Array.from({ length: n }, (_, i) => ({ id: i, items: [i] }));
      let nextId = n;
      const linkage = [];
      while (clusters.length > 1) {
        let bi = 0, bj = 1, bd = Infinity;
        for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
          let s = 0, c = 0;
          for (const a of clusters[i].items) for (const b of clusters[j].items) { s += D[a][b]; c++; }
          const d = s / Math.max(1, c);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
        const A = clusters[bi], B = clusters[bj];
        const merged = { id: nextId++, items: [...A.items, ...B.items] };
        linkage.push([A.id, B.id, bd, merged.items.length]);
        clusters = clusters.filter((_, idx) => idx !== bi && idx !== bj);
        clusters.push(merged);
      }
      return linkage;
    }

    function wardLinkage(X) {
      let clusters = X.map((x, i) => ({ id: i, items: [i], mean: x.slice() }));
      let nextId = X.length;
      const p = X[0].length;
      const linkage = [];
      function sseMerge(A, B) {
        const nA = A.items.length, nB = B.items.length;
        const m = Array(p).fill(0);
        for (let j = 0; j < p; j++) m[j] = (nA * A.mean[j] + nB * B.mean[j]) / (nA + nB);
        let s = 0;
        for (const i of A.items) s += sqDist(X[i], m);
        for (const i of B.items) s += sqDist(X[i], m);
        return { s, mean: m };
      }
      while (clusters.length > 1) {
        let bi = 0, bj = 1, bs = Infinity, bm = null;
        for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
          const m = sseMerge(clusters[i], clusters[j]);
          if (m.s < bs) { bs = m.s; bi = i; bj = j; bm = m.mean; }
        }
        const A = clusters[bi], B = clusters[bj];
        const merged = { id: nextId++, items: [...A.items, ...B.items], mean: bm };
        linkage.push([A.id, B.id, Math.sqrt(Math.max(0, bs)), merged.items.length]);
        clusters = clusters.filter((_, idx) => idx !== bi && idx !== bj);
        clusters.push(merged);
      }
      return linkage;
    }

    function tocher(D) {
      const n = D.length;
      const unassigned = new Set(Array.from({ length: n }, (_, i) => i));
      const clusters = [];
      while (unassigned.size) {
        const first = [...unassigned][0];
        unassigned.delete(first);
        const C = [first];
        // threshold = average distance from first to all others
        const rest = [...unassigned];
        const thr = rest.length ? rest.reduce((s, j) => s + D[first][j], 0) / rest.length : 0;
        let changed = true;
        while (changed) {
          changed = false;
          for (const cand of [...unassigned]) {
            const avgToC = C.reduce((s, i) => s + D[i][cand], 0) / C.length;
            if (avgToC <= thr) {
              C.push(cand);
              unassigned.delete(cand);
              changed = true;
            }
          }
        }
        clusters.push(C);
      }
      const labels = Array(n).fill(0);
      clusters.forEach((c, idx) => c.forEach((i) => (labels[i] = idx)));
      return labels;
    }

    function labelsFromLinkage(linkage, n, k) {
      // cut linkage to k clusters
      const parent = Array.from({ length: 2 * n + linkage.length + 5 }, (_, i) => i);
      const sets = Array.from({ length: 2 * n + linkage.length + 5 }, () => new Set());
      for (let i = 0; i < n; i++) sets[i].add(i);
      let cid = n;
      for (const [a, b] of linkage) {
        const sa = sets[a], sb = sets[b];
        sets[cid] = new Set([...sa, ...sb]);
        cid++;
      }
      // choose first (n-k) merges
      const mergedSets = Array.from({ length: n }, (_, i) => new Set([i]));
      for (let step = 0; step < Math.max(0, n - k); step++) {
        const [a, b] = linkage[step];
        const ia = mergedSets.findIndex((s) => s.has([...sets[a]][0]));
        const ib = mergedSets.findIndex((s) => s.has([...sets[b]][0]));
        if (ia >= 0 && ib >= 0 && ia !== ib) {
          mergedSets[ia] = new Set([...mergedSets[ia], ...mergedSets[ib]]);
          mergedSets.splice(ib, 1);
        }
      }
      const labels = Array(n).fill(0);
      mergedSets.forEach((s, idx) => s.forEach((i) => (labels[i] = idx)));
      return labels;
    }

    function consensusLabels(labelSets) {
      const n = labelSets[0].length;
      // similarity matrix by co-assignment frequency
      const S = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        let c = 0;
        for (const lab of labelSets) if (lab[i] === lab[j]) c++;
        S[i][j] = c / labelSets.length;
      }
      // Ward on (1-S) as distance-like
      const X = S.map((row) => row.map((v) => 1 - v));
      const link = wardLinkage(X);
      return { S, link };
    }

    function drawSimpleScatterClusters(canvas, X, labels, pointSize, opts = {}) {
      const nameList = opts.names && opts.names.length === X.length ? opts.names : X.map((_, i) => `G${i + 1}`);
      const points = X.map((r, i) => ({ x: r[0], y: r[1] ?? 0, c: labels[i], name: nameList[i] }));
      drawScatterPlot(canvas, points, {
        title: opts.title || "Cluster scatter (Trait1 vs Trait2)",
        xLabel: opts.xLabel || "Trait1",
        yLabel: opts.yLabel || "Trait2",
      });
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const sx = niceScale(Math.min(...xs), Math.max(...xs), 6);
      const sy = niceScale(Math.min(...ys), Math.max(...ys), 6);
      const minX = sx.min, maxX = sx.max, minY = sy.min, maxY = sy.max;
      const rx = Math.max(1e-9, maxX - minX), ry = Math.max(1e-9, maxY - minY);
      const colors = ["#0d9488", "#d97706", "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#0891b2"];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let idx = 0; idx < points.length; idx++) {
        const p = points[idx];
        const pt = projectScatterXY(w, h, true, minX, rx, minY, ry, p.x, p.y);
        ctx.fillStyle = colors[p.c % colors.length];
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, Math.max(2, pointSize - 0.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
        const lab = String(p.name || `G${idx + 1}`);
        const short = lab.length > 14 ? `${lab.slice(0, 12)}…` : lab;
        ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
        ctx.fillStyle = "#0f172a";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(short, pt.px + Math.max(6, pointSize * 0.6), pt.py);
      }
    }

    function drawDendrogram(canvas, linkage, n, lineW = 2, cutPct = 60, leafLabels = null) {
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);

      const xPos = {};
      const yPos = {};
      const labels = leafLabels && leafLabels.length === n ? leafLabels : Array.from({ length: n }, (_, i) => `G${i + 1}`);
      const maxLab = Math.max(8, ...labels.map((s) => String(s).length));
      const padL = 36, padR = 16, padT = 26, padB = labels ? Math.min(110, 36 + Math.min(maxLab * 5, 72)) : 34;
      for (let i = 0; i < n; i++) {
        xPos[i] = padL + i * ((w - padL - padR) / Math.max(1, n - 1));
        yPos[i] = h - padB;
      }
      const maxH = Math.max(1e-9, ...linkage.map((l) => l[2]));
      let cid = n;
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = lineW;
      for (const [a, b, dist] of linkage) {
        const xa = xPos[a], xb = xPos[b];
        const ya = yPos[a], yb = yPos[b];
        const ym = h - padB - (dist / maxH) * (h - padT - padB);
        ctx.beginPath();
        ctx.moveTo(xa, ya); ctx.lineTo(xa, ym);
        ctx.moveTo(xb, yb); ctx.lineTo(xb, ym);
        ctx.moveTo(Math.min(xa, xb), ym); ctx.lineTo(Math.max(xa, xb), ym);
        ctx.stroke();
        xPos[cid] = (xa + xb) / 2;
        yPos[cid] = ym;
        cid++;
      }
      // frame and y ticks for publication readability
      ctx.strokeStyle = "rgba(15, 23, 42, 0.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(padL + 0.5, padT + 0.5, w - padL - padR - 1, h - padT - padB - 1);
      const ticks = 4;
      ctx.fillStyle = "#475569";
      ctx.font = "600 11px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= ticks; i++) {
        const t = i / ticks;
        const y = h - padB - t * (h - padT - padB);
        const v = t * maxH;
        ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillText(formatChartTick(v), padL - 6, y);
      }
      // cut line
      const yCut = h - padB - (Math.max(5, Math.min(95, cutPct)) / 100) * (h - padT - padB);
      ctx.strokeStyle = "rgba(255,92,122,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, yCut); ctx.lineTo(w - padR, yCut); ctx.stroke();
      ctx.fillStyle = "rgba(190, 24, 93, 0.95)";
      ctx.font = "700 11px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`cut ${Math.max(5, Math.min(95, cutPct)).toFixed(0)}%`, padL + 6, yCut - 4);

      ctx.fillStyle = "#0f172a";
      ctx.font = "600 10px Segoe UI, system-ui, sans-serif";
      for (let i = 0; i < n; i++) {
        const xi = xPos[i];
        const text = String(labels[i]).length > 18 ? `${String(labels[i]).slice(0, 16)}…` : String(labels[i]);
        ctx.save();
        ctx.translate(xi, h - padB + 10);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }

    /** Heat map of symmetric D² matrix with genotype labels. */
    function drawD2MatrixHeatmap(canvas, D2, names) {
      applyChartThemeFromStorage();
      const n = D2.length;
      if (!n) return;
      const { ctx, w, h } = setupCanvas(canvas);
      const padT = 40;
      const padB = 28;
      let maxLen = 4;
      for (const s of names) maxLen = Math.max(maxLen, String(s).length);
      const padL = Math.min(140, 16 + maxLen * 6);
      const padR = 12;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const cell = Math.min(plotW / n, plotH / n, 48);
      const gridW = cell * n;
      const gridH = cell * n;
      const ox = padL + (plotW - gridW) / 2;
      const oy = padT + (plotH - gridH) / 2;
      let vmax = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) vmax = Math.max(vmax, D2[i][j]);
      if (vmax < 1e-12) vmax = 1;
      ctx.fillStyle = CHART.bg;
      ctx.fillRect(0, 0, w, h);
      fillPlotBackground(ctx, padL, padT, plotW, plotH);
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 15px Segoe UI, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText("Pairwise Mahalanobis D² matrix", padL, 8);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const v = D2[i][j] / vmax;
          const g = i === j ? 220 : 255 - Math.round(200 * Math.min(1, v));
          const b = i === j ? 240 : 255 - Math.round(80 * Math.min(1, v));
          ctx.fillStyle = i === j ? "rgba(15, 118, 110, 0.25)" : `rgb(255,${g},${b})`;
          ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
          ctx.lineWidth = 1;
          ctx.fillRect(ox + j * cell, oy + i * cell, cell - 1, cell - 1);
          ctx.strokeRect(ox + j * cell, oy + i * cell, cell - 1, cell - 1);
          ctx.fillStyle = CHART.ink;
          ctx.font = cell > 22 ? "600 10px Segoe UI, sans-serif" : "600 8px Segoe UI, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const txt = D2[i][j] < 10 ? D2[i][j].toFixed(3) : D2[i][j].toFixed(2);
          ctx.fillText(txt, ox + j * cell + (cell - 1) / 2, oy + i * cell + (cell - 1) / 2);
        }
      }
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 9px Segoe UI, sans-serif";
      ctx.textAlign = "right";
      for (let i = 0; i < n; i++) {
        const lab = String(names[i]).length > 12 ? `${String(names[i]).slice(0, 10)}…` : String(names[i]);
        ctx.fillText(lab, ox - 6, oy + i * cell + (cell - 1) / 2);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (let j = 0; j < n; j++) {
        const lab = String(names[j]).length > 12 ? `${String(names[j]).slice(0, 10)}…` : String(names[j]);
        ctx.save();
        ctx.translate(ox + j * cell + (cell - 1) / 2, oy - 4);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(lab, 0, 0);
        ctx.restore();
      }
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 10px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`max off-diagonal D² = ${vmax.toFixed(4)}`, padL, h - 8);
    }

    /** Bar chart: intra-cluster mean D² vs mean inter-cluster D² for each consensus cluster. */
    function drawIntraInterClusterBars(canvas, intraInterMat, cKeys) {
      applyChartThemeFromStorage();
      const k = cKeys.length;
      if (!k) return;
      const intra = intraInterMat.map((row, i) => row[i]);
      const meanInter = intraInterMat.map((row, i) => {
        let s = 0;
        let c = 0;
        for (let j = 0; j < k; j++) {
          if (j === i) continue;
          s += row[j];
          c++;
        }
        return c ? s / c : 0;
      });
      const { ctx, w, h } = setupCanvas(canvas);
      const padL = 56;
      const padR = 18;
      const padT = 44;
      const padB = 56;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxV = Math.max(1e-9, ...intra, ...meanInter, ...intraInterMat.flat());
      ctx.fillStyle = CHART.bg;
      ctx.fillRect(0, 0, w, h);
      fillPlotBackground(ctx, padL, padT, plotW, plotH);
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 15px Segoe UI, sans-serif";
      ctx.fillText("Intra- vs mean inter-cluster D² (consensus)", padL, 8);
      const bw = plotW / Math.max(1, k * 2.5);
      const gap = bw * 0.35;
      const cols = ["#0d9488", "#ea580c"];
      for (let i = 0; i < k; i++) {
        const cx = padL + (i + 0.5) * (plotW / k) - bw - gap / 2;
        const h1 = (intra[i] / maxV) * plotH;
        const h2 = (meanInter[i] / maxV) * plotH;
        ctx.fillStyle = cols[0];
        roundRect(ctx, cx, padT + plotH - h1, bw, h1, 4);
        ctx.fill();
        ctx.fillStyle = cols[1];
        roundRect(ctx, cx + bw + gap, padT + plotH - h2, bw, h2, 4);
        ctx.fill();
        ctx.fillStyle = CHART.inkMuted;
        ctx.font = "600 10px Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`C${i + 1}`, cx + bw + gap / 2, padT + plotH + 6);
      }
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 11px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Intra", padL, padT + plotH + 22);
      ctx.fillStyle = cols[0];
      ctx.fillRect(padL + 36, padT + plotH + 24, 12, 8);
      ctx.fillStyle = CHART.inkMuted;
      ctx.fillText("Mean inter", padL + 56, padT + plotH + 22);
      ctx.fillStyle = cols[1];
      ctx.fillRect(padL + 130, padT + plotH + 24, 12, 8);
    }

    function heterosisRows() {
      const rows = [];
      const all = $$("#d2HetWrap input[data-het]");
      const nRows = Math.floor(all.length / 3);
      for (let i = 0; i < nRows; i++) {
        const p1 = Number(document.querySelector(`#d2HetWrap input[data-het="r${i}p1"]`)?.value ?? NaN);
        const p2 = Number(document.querySelector(`#d2HetWrap input[data-het="r${i}p2"]`)?.value ?? NaN);
        const f1 = Number(document.querySelector(`#d2HetWrap input[data-het="r${i}f1"]`)?.value ?? NaN);
        if (!Number.isFinite(p1) || !Number.isFinite(p2) || !Number.isFinite(f1)) continue;
        const mp = (p1 + p2) / 2;
        const bp = Math.max(p1, p2);
        const mph = mp === 0 ? 0 : ((f1 - mp) / mp) * 100;
        const bph = bp === 0 ? 0 : ((f1 - bp) / bp) * 100;
        rows.push([`G${i + 1}xG${i + 2}`, p1, p2, f1, mph, bph]);
      }
      return rows;
    }

    build(defaultN, defaultT);

    const d2PlotlyThemeSel = document.getElementById("d2PlotlyTheme");
    if (d2PlotlyThemeSel) {
      d2PlotlyThemeSel.value = localStorage.getItem("bkq_plotly_theme") === "dark" ? "dark" : "light";
      d2PlotlyThemeSel.addEventListener("change", () => {
        localStorage.setItem("bkq_plotly_theme", d2PlotlyThemeSel.value === "dark" ? "dark" : "light");
        $("#d2Compute").click();
      });
    }

    $("#d2Build").addEventListener("click", () => {
      const n = Math.max(5, Math.min(40, Number($("#d2N").value || defaultN)));
      const p = Math.max(2, Math.min(10, Number($("#d2T").value || defaultT)));
      build(n, p);
    });

    $("#d2TemplateCsv").addEventListener("click", () => {
      const n = Math.max(5, Math.min(40, Number($("#d2N").value || defaultN)));
      const p = Math.max(2, Math.min(10, Number($("#d2T").value || defaultT)));
      const rows = [["Genotype", ...Array.from({ length: p }, (_, j) => `Trait${j + 1}`)]];
      for (let i = 0; i < n; i++) {
        rows.push([`G${i + 1}`, ...Array.from({ length: p }, (_, j) => (10 + i * 0.8 + j * 1.1).toFixed(2))]);
      }
      triggerCsvDownload("d2_trait_matrix_template.csv", rows);
    });
    $("#d2ImportCsv").addEventListener("click", () => $("#d2CsvFile").click());
    $("#d2CsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      let txt;
      try {
        txt = await fileToCsvText(f);
      } catch (err) {
        alert(err?.message || String(err));
        return;
      }
      const parsed = parseD2TraitImport(txt);
      let n;
      let p;
      let mat;
      let nameRow = null;
      if (parsed && parsed.X?.length) {
        n = Math.max(5, Math.min(40, parsed.n));
        p = Math.max(2, Math.min(10, parsed.p));
        mat = parsed.X.map((row) => row.slice(0, p));
        nameRow = parsed.names;
      } else {
        mat = parseNumericCsvMatrix(txt);
        if (!mat.length) return;
        n = Math.max(5, Math.min(40, mat.length));
        p = Math.max(2, Math.min(10, Math.min(...mat.map((r) => r.length))));
        nameRow = null;
      }
      $("#d2N").value = String(n);
      $("#d2T").value = String(p);
      build(n, p);
      for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) {
        const v = mat[i]?.[j];
        if (!Number.isFinite(v)) continue;
        const input = document.querySelector(`#d2Wrap input[data-d2="g${i}t${j}"]`);
        if (input) input.value = String(v);
      }
      if (nameRow && nameRow.length === n) {
        for (let i = 0; i < n; i++) {
          const inp = document.querySelector(`#d2Wrap input[data-d2-name="${i}"]`);
          if (inp) inp.value = String(nameRow[i] || `G${i + 1}`).slice(0, 48);
        }
      }
      $("#d2Compute").click();
      e.target.value = "";
    });

    $("#d2Compute").addEventListener("click", () => {
      const { n, X, names } = readData();
      clearValidation("#d2Wrap");
      const errors = [];
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < X[0].length; t++) {
          const input = document.querySelector(`#d2Wrap input[data-d2="g${i}t${t}"]`);
          const v = Number(input?.value ?? NaN);
          if (!Number.isFinite(v)) {
            errors.push(`D2: invalid value at G${i + 1}, Trait${t + 1}`);
            markInvalidInput(input, "Enter a valid numeric value");
          }
        }
      }
      if (shouldBlockForValidation("d2", errors, "#d2Kpis")) return;
      purgeD2PlotlyFigures();
      const std = !!$("#d2Standardize")?.checked;
      const Xuse = std ? zScoreColumns(X).Z : X;
      const k = Math.max(2, Math.min(12, Number($("#d2K").value || 3)));
      const useK = $("#d2mK").checked;
      const useU = $("#d2mU").checked;
      const useT = $("#d2mT").checked;
      const useW = $("#d2mW").checked;
      const methods = [];
      const labelSets = [];

      const { D2, D, Z, fallback: mahalFallback } = mahalanobisFromX(Xuse);
      const linkUpgmaD = upgmaLinkage(D);

      if (useK) {
        const lab = kmeans(Z, Math.min(k, n));
        methods.push("K-means");
        labelSets.push(lab);
      }
      if (useU) {
        const lab = labelsFromLinkage(linkUpgmaD, n, Math.min(k, n));
        methods.push("UPGMA");
        labelSets.push(lab);
      }
      if (useT) {
        const lab = tocher(D);
        methods.push("Tocher");
        labelSets.push(lab);
      }
      if (useW) {
        const link = wardLinkage(Z);
        const lab = labelsFromLinkage(link, n, Math.min(k, n));
        methods.push("Ward");
        labelSets.push(lab);
      }
      if (!labelSets.length) {
        $("#d2Kpis").innerHTML = `<div class="note">Select at least one clustering method.</div>`;
        return;
      }

      const cons = consensusLabels(labelSets);
      const consLab = labelsFromLinkage(cons.link, n, Math.min(k, n));
      const pointSize = Math.max(2, Math.min(10, Number($("#d2Point").value || 5)));
      const lineW = Math.max(1, Math.min(5, Number($("#d2LineW").value || 2)));
      const cut = Math.max(5, Math.min(95, Number($("#d2Cut").value || 60)));

      const newickStr = linkageToNewickString(linkUpgmaD, n, names);

      drawSimpleScatterClusters($("#d2ClusterChart"), Z, consLab, pointSize, {
        names,
        title: mahalFallback
          ? "Cluster scatter (Trait1 vs Trait2)"
          : "Cluster scatter (Mahalanobis-whitened axes 1 vs 2)",
        xLabel: mahalFallback ? "Trait1" : "Axis 1",
        yLabel: mahalFallback ? "Trait2" : "Axis 2",
      });
      drawDendrogram($("#d2DendroChart"), linkUpgmaD, n, lineW, cut, names);
      drawDendrogram($("#d2DendroConsensusChart"), cons.link, n, lineW, cut, names);

      // cluster metrics from consensus labels (D² = Mahalanobis squared distance)
      const clusters = {};
      for (let i = 0; i < n; i++) {
        const c = consLab[i];
        if (!clusters[c]) clusters[c] = [];
        clusters[c].push(i);
      }
      const cKeys = Object.keys(clusters).map(Number).sort((a, b) => a - b);
      function avgIntraD2(idxs) {
        if (idxs.length < 2) return 0;
        let s = 0;
        let c = 0;
        for (let i = 0; i < idxs.length; i++) {
          for (let j = i + 1; j < idxs.length; j++) {
            s += D2[idxs[i]][idxs[j]];
            c++;
          }
        }
        return c ? s / c : 0;
      }
      let bestInter = 0;
      for (let a = 0; a < cKeys.length; a++) {
        for (let b = a + 1; b < cKeys.length; b++) {
          let s = 0;
          let c = 0;
          for (const i of clusters[cKeys[a]]) for (const j of clusters[cKeys[b]]) {
            s += D2[i][j];
            c++;
          }
          const m = c ? s / c : 0;
          if (m > bestInter) bestInter = m;
        }
      }
      let maxIntra = 0;
      for (const ck of cKeys) maxIntra = Math.max(maxIntra, avgIntraD2(clusters[ck]));

      const intraInterMat = clusterIntraInterD2MeanMatrix(D2, clusters, cKeys);
      drawD2MatrixHeatmap($("#d2D2HeatmapChart"), D2, names);
      drawIntraInterClusterBars($("#d2IntraInterBarChart"), intraInterMat, cKeys);
      renderD2PlotlyHeatmapAndPca3d(D2, names, Xuse);
      const intraRows = cKeys.map((c) => [
        `Cluster ${c + 1}`,
        clusters[c].map((i) => names[i] || `G${i + 1}`).join(", "),
        avgIntraD2(clusters[c]),
        clusters[c].length,
      ]);

      const het = heterosisRows();
      const mphMean = het.length ? mean(het.map((r) => r[4])) : 0;
      const bphMean = het.length ? mean(het.map((r) => r[5])) : 0;

      $("#d2Kpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(3, minmax(0,1fr))">
          <div class="kpi"><div class="label">Methods combined</div><div class="value">${methods.join(", ")}</div></div>
          <div class="kpi"><div class="label">Consensus clusters</div><div class="value">${cKeys.length}</div></div>
          <div class="kpi"><div class="label">Distance basis</div><div class="value">${mahalFallback ? "Euclidean (S not PD)" : "Mahalanobis D²"}</div></div>
        </div>
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr));margin-top:8px">
          <div class="kpi"><div class="label">Max mean inter-cluster D²</div><div class="value">${bestInter.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Max mean intra-cluster D²</div><div class="value">${maxIntra.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Mean MP heterosis</div><div class="value">${mphMean.toFixed(2)}%</div></div>
          <div class="kpi"><div class="label">Mean BP heterosis</div><div class="value">${bphMean.toFixed(2)}%</div></div>
        </div>
      `;

      const tD2matrix = buildTable(
        ["Genotype", ...names],
        names.map((ni, i) => [ni, ...D2[i].map((v) => v.toFixed(4))])
      );

      const tMethod = buildTable(
        ["Method", "Clusters formed"],
        methods.map((m, idx) => [m, new Set(labelSets[idx]).size])
      );
      // Cluster means (trait-wise)
      const traitCount = Xuse[0].length;
      const clusterMeanRows = [];
      for (const c of cKeys) {
        const members = clusters[c];
        const means = Array.from({ length: traitCount }, (_, t) => mean(members.map((i) => Xuse[i][t])));
        clusterMeanRows.push([`Cluster ${c + 1}`, ...means]);
      }
      const tClusterMeans = buildTable(
        ["Cluster", ...Array.from({ length: traitCount }, (_, t) => `Trait${t + 1} mean`)],
        clusterMeanRows
      );

      // Percentage contribution by traits to total D2 (sum of squared pairwise differences)
      const contrib = Array(traitCount).fill(0);
      let totalContrib = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          for (let t = 0; t < traitCount; t++) {
            const d = Xuse[i][t] - Xuse[j][t];
            const d2 = d * d;
            contrib[t] += d2;
            totalContrib += d2;
          }
        }
      }
      const contribRows = contrib.map((v, t) => [
        `Trait${t + 1}`,
        v,
        totalContrib <= 1e-12 ? 0 : (v / totalContrib) * 100,
      ]);
      contribRows.sort((a, b) => Number(b[2]) - Number(a[2]));
      const tContrib = buildTable(
        ["Trait", "Contribution sum (squared trait differences)", "Contribution (%)"],
        contribRows
      );

      const cn = cKeys.map((_, i) => `C${i + 1}`);
      const tIntraInter = buildTable(
        ["Cluster (mean pairwise D²)", ...cn],
        cKeys.map((_, i) => [`C${i + 1}`, ...cKeys.map((_, j) => intraInterMat[i][j].toFixed(4))])
      );

      const mergeRows = linkUpgmaD.map((row, step) => {
        const [a, b, dist, sz] = row;
        return [step + 1, a, b, dist.toFixed(4), sz];
      });
      const tMerge = buildTable(
        ["Step", "Left id", "Right id", "Avg distance (UPGMA)", "Merged size"],
        mergeRows
      );

      const tCons = buildTable(
        ["Consensus cluster", "Members", "Intra-cluster mean D²", "Size"],
        intraRows
      );
      const tHet = buildTable(
        ["Cross", "P1", "P2", "F1", "Mid-parent heterosis (%)", "Better-parent heterosis (%)"],
        het
      );
      const qItemsD2 = [
        { check: "Methods selected", pass: methods.length >= 2, note: `${methods.length} method(s)` },
        {
          check: "Cluster separability (D²)",
          pass: bestInter > 1e-12 && (maxIntra < 1e-12 || bestInter / maxIntra > 1.05),
          note: `inter/intra D²≈${maxIntra > 1e-12 ? (bestInter / maxIntra).toFixed(2) : "—"}`,
        },
        { check: "Cluster count adequacy", pass: cKeys.length >= 2, note: `${cKeys.length} consensus cluster(s)` },
      ];
      if (strictModeShouldBlock("d2", qItemsD2, "#d2Kpis")) return;

      const dendroNote = `
        <h4>Dendrogram structure (UPGMA on D = √(D²))</h4>
        <p class="muted small">Nested parentheses follow merge order (informal Newick-style). Use the vertical cut line on the UPGMA dendrogram above to read the same number of groups as the target cluster count (subject to consensus).</p>
        <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;margin:8px 0;padding:10px;border-radius:8px;border:1px solid var(--border, #334155);">${qs(newickStr)}</pre>
      `;

      $("#d2Tables").innerHTML =
        `${qualityScoreHtml(qItemsD2)}<div style="height:10px"></div><h4>Table 1. Pairwise Mahalanobis D² matrix (full)</h4>` +
        `<p class="muted small">Diagonal is zero; off-diagonals are generalized squared distances using pooled (ridge) covariance.</p>${tD2matrix}` +
        `<div style="height:10px"></div><h4>Table 2. Method-wise cluster counts</h4>${tMethod}` +
        `<div style="height:10px"></div><h4>Table 3. Consensus clustering summary (Mahalanobis D²)</h4>${tCons}` +
        `<div style="height:10px"></div><h4>Table 4. Intra- and inter-cluster mean pairwise D²</h4>` +
        `<p class="muted small">Diagonal: mean D² within cluster; off-diagonal: mean D² between clusters (symmetric).</p>${tIntraInter}` +
        `<div style="height:10px"></div>${dendroNote}` +
        `<div style="height:10px"></div><h4>Table 5. UPGMA merge order (D²-based distance)</h4>${tMerge}` +
        `<div style="height:10px"></div><h4>Table 6. Cluster means by traits</h4>${tClusterMeans}` +
        `<div style="height:10px"></div><h4>Table 7. Trait-wise contribution of raw squared differences</h4>${tContrib}` +
        `<div style="height:10px"></div><h4>Table 8. Heterosis values</h4>${tHet}` +
        `<div style="height:10px"></div>${assumptionsChecklistHtml("Table 9. Assumption checklist", [
          { assumption: "Trait scaling compatibility", status: "Recommended", note: "Standardize traits when units differ strongly." },
          { assumption: "Mahalanobis D²", status: "Assumed", note: "Pooled covariance S with ridge; linkage uses D = √(D²). Fallback uses Euclidean if S is not PD." },
          { assumption: "Method agreement", status: "Recommended", note: "Consensus clustering improves robustness over single-method solutions." },
        ])}`;

      const consensusSpread = cKeys.length;
      const deviationHtml = deviationBanner("d2", { bestInterCluster: bestInter, consensusSpread }, ["bestInterCluster", "consensusSpread"]);
      const interpretation =
        `Mahalanobis D² uses pooled covariance among genotypes (ridge-regularized); clustering uses D = √(D²) for UPGMA/Tocher and whitened coordinates for K-means/Ward.\n\n` +
        `Combined methods: ${methods.join(", ")}.\n` +
        `Consensus clusters: ${cKeys.length}; max mean inter-cluster D²=${bestInter.toFixed(4)}, max mean intra-cluster D²=${maxIntra.toFixed(4)}.\n` +
        `UPGMA dendrogram (primary) and the nested Newick-style string summarize the same D²-based hierarchy; cross-cluster means in Table 3 quantify separation.\n` +
        `Largest raw trait-difference contribution: ${String(contribRows[0]?.[0] || "Trait1")} (${Number(contribRows[0]?.[2] || 0).toFixed(2)}%).\n\n` +
        `Heterosis summary: mean MPH=${mphMean.toFixed(2)}%, mean BPH=${bphMean.toFixed(2)}%.\n` +
        `Large inter-cluster D² and positive heterosis in selected inter-cluster crosses support divergence-based hybrid selection.`;
      setInterpretation("d2", interpretation, deviationHtml || "", { bestInterCluster: bestInter, consensusSpread });
      setRunMeta("d2", { forceRun: isForceRunEnabled(), inputSize: `n=${n}, p=${traitCount}, methods=${methods.length}`, standardization: std ? "z-score columns" : "none", preprocessing: "Trait matrix checked; clustering used selected methods.", qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsD2.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });
  }

  // --- Metroglyph visual module ---
  function renderMetroglyph() {
    const title = "Metroglyph Analysis (Visualizer)";
    showContentHeader({
      title,
      subtitle: "Visualize multi-trait genotype patterns as glyphs with cluster colors and customizable scaling.",
    });

    const defaultN = 12;
    const defaultT = 4;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Input</div><div class="value">Genotype x Trait matrix + cluster labels</div></div>
        <div class="kpi"><div class="label">Output</div><div class="value">Metroglyph pattern map</div></div>
        <div class="kpi"><div class="label">Controls</div><div class="value">Glyph size, stroke, trait scaling</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input table</h4>
            <div class="input-grid">
              <div class="two-col">
                <label>Genotypes (n)<input type="number" min="6" max="40" id="mgN" value="${defaultN}" /></label>
                <label>Traits (p)<input type="number" min="2" max="8" id="mgT" value="${defaultT}" /></label>
              </div>
              <div class="two-col">
                <label>Glyph size<input type="number" min="6" max="24" id="mgSize" value="12" /></label>
                <label>Stroke width<input type="number" min="1" max="4" step="0.5" id="mgStroke" value="1.5" /></label>
              </div>
              <label>Trait scaling mode
                <select id="mgScale">
                  <option value="global">Global (all traits together)</option>
                  <option value="per-trait">Per trait (recommended)</option>
                </select>
              </label>
              <button class="action-btn primary2" type="button" id="mgBuild">Build metroglyph table</button>
              <div class="muted small" style="margin-top:8px">
                <strong>Import CSV / Excel:</strong> columns = Genotype, Cluster, Trait1, Trait2, … (numeric traits). Rows match current n×p after resize or use Import to set dimensions from file.
              </div>
              <button class="action-btn" type="button" id="mgImportCsv" style="margin-top:6px">Import CSV / Excel</button>
              <input type="file" id="mgCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div id="mgWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="mgCompute">Draw metroglyph map</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="mgKpis"></div>
            <div class="chart" style="height:340px;margin-top:12px"><canvas id="mgChart" style="width:100%;height:100%"></canvas></div>
            <div id="mgTables" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "metroglyph",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["patternSpread", "clusterBalance"],
    });

    function build(n, p) {
      const wrap = $("#mgWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Genotype", "Cluster", ...Array.from({ length: p }, (_, j) => `Trait${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < n; i++) {
        const cl = (i % 4) + 1;
        const cells = [];
        cells.push(`<td><select data-mg="g${i}c">${Array.from({ length: 8 }, (_, k) => `<option value="${k + 1}" ${k + 1 === cl ? "selected" : ""}>C${k + 1}</option>`).join("")}</select></td>`);
        for (let j = 0; j < p; j++) {
          const v = 10 + i * 0.8 + j * 1.2 + ((i * (j + 1)) % 5) * 0.6;
          cells.push(`<td><input type="number" step="0.01" value="${v.toFixed(2)}" data-mg="g${i}t${j}" /></td>`);
        }
        rows.push(`<tr><th>G${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    function read() {
      const n = Math.max(6, Math.min(40, Number($("#mgN").value || defaultN)));
      const p = Math.max(2, Math.min(8, Number($("#mgT").value || defaultT)));
      const X = Array.from({ length: n }, () => Array(p).fill(0));
      const C = Array(n).fill(1);
      for (let i = 0; i < n; i++) {
        C[i] = Number(document.querySelector(`#mgWrap select[data-mg="g${i}c"]`)?.value || 1);
        for (let j = 0; j < p; j++) {
          const v = Number(document.querySelector(`#mgWrap input[data-mg="g${i}t${j}"]`)?.value ?? 0);
          X[i][j] = Number.isFinite(v) ? v : 0;
        }
      }
      return { n, p, X, C };
    }

    function normalize(X, mode) {
      const n = X.length, p = X[0].length;
      const Y = Array.from({ length: n }, () => Array(p).fill(0));
      if (mode === "global") {
        let mn = Infinity, mx = -Infinity;
        for (const r of X) for (const v of r) { if (v < mn) mn = v; if (v > mx) mx = v; }
        const d = Math.max(1e-9, mx - mn);
        for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Y[i][j] = (X[i][j] - mn) / d;
      } else {
        for (let j = 0; j < p; j++) {
          let mn = Infinity, mx = -Infinity;
          for (let i = 0; i < n; i++) { if (X[i][j] < mn) mn = X[i][j]; if (X[i][j] > mx) mx = X[i][j]; }
          const d = Math.max(1e-9, mx - mn);
          for (let i = 0; i < n; i++) Y[i][j] = (X[i][j] - mn) / d;
        }
      }
      return Y;
    }

    function draw(canvas, Xn, C, glyphSize, strokeW) {
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const n = Xn.length, p = Xn[0].length;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const xGap = (w - 20) / cols;
      const yGap = (h - 20) / rows;
      const colors = ["#0d9488", "#d97706", "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#0891b2", "#ea580c"];

      for (let i = 0; i < n; i++) {
        const cx = 10 + (i % cols) * xGap + xGap / 2;
        const cy = 10 + Math.floor(i / cols) * yGap + yGap / 2;
        const trait = Xn[i];
        // star/radial glyph
        ctx.beginPath();
        for (let t = 0; t < p; t++) {
          const ang = -Math.PI / 2 + (2 * Math.PI * t) / p;
          const r = glyphSize * (0.35 + 0.75 * trait[t]);
          const x = cx + r * Math.cos(ang);
          const y = cy + r * Math.sin(ang);
          if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const color = colors[(C[i] - 1) % colors.length];
        ctx.fillStyle = color + "55";
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeW;
        ctx.fill();
        ctx.stroke();

        // center dot and label
        ctx.fillStyle = CHART.ink;
        ctx.beginPath();
        ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "700 10px Segoe UI, Arial";
        ctx.fillText(`G${i + 1}`, cx + 4, cy - 4);
      }
    }

    build(defaultN, defaultT);
    $("#mgBuild").addEventListener("click", () => {
      const n = Math.max(6, Math.min(40, Number($("#mgN").value || defaultN)));
      const p = Math.max(2, Math.min(8, Number($("#mgT").value || defaultT)));
      build(n, p);
    });

    bindCsvExcelFileImport("mgImportCsv", "mgCsvFile", (txt) => {
      const rows = parseCsv(txt).filter((r) => r.some((c) => String(c).trim() !== ""));
      if (rows.length < 7) {
        alert("Need a header row and at least 6 data rows (genotypes).");
        return;
      }
      const first = rows[1];
      const p = Math.max(2, Math.min(8, first.length - 2));
      const n = Math.min(40, Math.max(6, rows.length - 1));
      $("#mgN").value = String(n);
      $("#mgT").value = String(p);
      build(n, p);
      for (let i = 0; i < n; i++) {
        const row = rows[1 + i] || [];
        const cl = Math.max(1, Math.min(8, Math.round(Number(row[1]) || 1)));
        const sel = document.querySelector(`#mgWrap select[data-mg="g${i}c"]`);
        if (sel) sel.value = String(cl);
        for (let j = 0; j < p; j++) {
          const inp = document.querySelector(`#mgWrap input[data-mg="g${i}t${j}"]`);
          if (inp) inp.value = String(Number(row[j + 2]) || 0);
        }
      }
    });

    $("#mgCompute").addEventListener("click", () => {
      const { n, p, X, C } = read();
      const mode = String($("#mgScale").value || "per-trait");
      const size = Math.max(6, Math.min(24, Number($("#mgSize").value || 12)));
      const stroke = Math.max(1, Math.min(4, Number($("#mgStroke").value || 1.5)));
      const Xn = normalize(X, mode);
      draw($("#mgChart"), Xn, C, size, stroke);

      const clusterCounts = {};
      C.forEach((c) => (clusterCounts[c] = (clusterCounts[c] || 0) + 1));
      const cRows = Object.keys(clusterCounts).map((k) => [`Cluster ${k}`, clusterCounts[k], ((clusterCounts[k] / n) * 100)]);
      cRows.sort((a, b) => Number(a[0].split(" ")[1]) - Number(b[0].split(" ")[1]));

      // trait spread summary
      const spreads = [];
      for (let t = 0; t < p; t++) {
        const vals = X.map((r) => r[t]);
        const mn = Math.min(...vals), mx = Math.max(...vals);
        spreads.push([`Trait${t + 1}`, mn, mx, mx - mn]);
      }
      const patternSpread = mean(spreads.map((r) => Number(r[3])));
      const largest = spreads.slice().sort((a, b) => Number(b[3]) - Number(a[3]))[0];
      const clusterBalance = cRows.length ? Math.max(...cRows.map((r) => Number(r[1]))) / Math.max(1, Math.min(...cRows.map((r) => Number(r[1])))) : 1;

      $("#mgKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Genotypes</div><div class="value">${n}</div></div>
          <div class="kpi"><div class="label">Traits per glyph</div><div class="value">${p}</div></div>
          <div class="kpi"><div class="label">Clusters used</div><div class="value">${cRows.length}</div></div>
          <div class="kpi"><div class="label">Avg trait spread</div><div class="value">${patternSpread.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Cluster balance ratio</div><div class="value">${clusterBalance.toFixed(3)}</div></div>
        </div>
      `;

      const t1 = buildTable(
        ["Cluster", "Members", "Share (%)"],
        cRows
      );
      const t2 = buildTable(
        ["Trait", "Min", "Max", "Range"],
        spreads
      );
      $("#mgTables").innerHTML = `<h4>Table 1. Cluster composition</h4>${t1}<div style="height:10px"></div><h4>Table 2. Trait range summary</h4>${t2}`;

      const deviationHtml = deviationBanner("metroglyph", { patternSpread, clusterBalance }, ["patternSpread", "clusterBalance"]);
      const interpretation =
        `Metroglyph visualization represents each genotype as a radial glyph where each spoke corresponds to a trait value.\n\n` +
        `Current pattern summary:\n` +
        `• Average trait spread=${patternSpread.toFixed(3)}\n` +
        `• Largest spread trait=${largest[0]} (range=${Number(largest[3]).toFixed(3)})\n` +
        `• Cluster balance ratio=${clusterBalance.toFixed(3)}\n\n` +
        `Use this visual to quickly identify extreme genotypes, balanced profiles, and cluster-specific trait signatures for selection planning.`;
      setInterpretation("metroglyph", interpretation, deviationHtml || "", { patternSpread, clusterBalance });
    });
  }

  // --- Template educational modules (pre-rendered tables/plots) ---
  function renderEducationalModule({ moduleId, title, subtitle, tables, chart, interpretation, deviationKeys = [] }) {
    showContentHeader({ title, subtitle });

    const chartHtml = `
      <div class="chart" style="height:280px;margin-top:12px">
        <canvas id="${moduleId}-chart" style="width:100%;height:100%"></canvas>
      </div>
    `;

    const tableHtml = tables?.length ? `<div id="${moduleId}-tables" style="margin-top:12px">${tables.join("\n")}</div>` : "";

    const bodyHtml = `
      <div class="section" style="margin:0">
        <div class="kpi-row">
          <div class="kpi"><div class="label">Module</div><div class="value">${qs(title)}</div></div>
          <div class="kpi"><div class="label">Data mode</div><div class="value">Example results</div></div>
          <div class="kpi"><div class="label">Export</div><div class="value">Word (.mht) + XLS</div></div>
        </div>
        ${chartHtml}
        ${tableHtml}
        <div class="muted small" style="margin-top:10px">
          This offline BKQuant module ships with fully worked example output (tables, plots, and interpretation).
          You can use it as a reference report format.
        </div>
      </div>
    `;

    moduleShell({
      moduleId,
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: deviationKeys,
    });

    // draw chart(s)
    if (chart?.type === "bar") {
      const c = document.getElementById(`${moduleId}-chart`);
      drawBarChart(c, chart.labels, chart.values, { title: chart.title || "Example results plot" });
    } else if (chart?.type === "scatter") {
      const c = document.getElementById(`${moduleId}-chart`);
      drawScatterPlot(c, chart.points, { title: chart.title || "Example scatter" });
    }

    // interpretation + deviation handling (use a generic key)
    const payload = chart?.deviationPayload || {};
    const deviationHtml = deviationKeys.length ? deviationBanner(moduleId, payload, deviationKeys) : "";
    setInterpretation(moduleId, interpretation, deviationHtml, payload || null);
  }

  // --- Biometric Report (summary, correlation heatmap, Plotly charts, ANOVA) ---
  /** Browser Plotly.js (not Python plotly.express): shared publication-style layout + export-friendly fonts. */
  const BKQ_PLOTLY_COLORWAY = ["#0f766e", "#0369a1", "#7c3aed", "#c2410c", "#be123c", "#0d9488", "#4f46e5", "#db2777"];

  function bkqPlotlyThemeIsDark() {
    return localStorage.getItem("bkq_plotly_theme") === "dark";
  }

  function bkqPlotlyLayout(titleText, overrides = {}) {
    const dark = bkqPlotlyThemeIsDark();
    return {
      template: dark ? "plotly_dark" : "plotly_white",
      title: {
        text: titleText,
        font: {
          size: 17,
          family: "Inter, ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
          color: dark ? "#f8fafc" : "#0f172a",
        },
        x: 0.02,
        xanchor: "left",
        pad: { t: 10, b: 6 },
      },
      font: {
        family: "Inter, ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
        size: 14,
        color: dark ? "#cbd5e1" : "#334155",
      },
      paper_bgcolor: dark ? "#0f172a" : "#ffffff",
      plot_bgcolor: dark ? "#1e293b" : "#f1f5f9",
      colorway: BKQ_PLOTLY_COLORWAY,
      margin: { l: 76, r: 36, t: 92, b: 88 },
      hoverlabel: {
        font: { family: "Inter, ui-sans-serif, system-ui, sans-serif", size: 13 },
        bgcolor: dark ? "#334155" : "#0f172a",
        bordercolor: dark ? "#94a3b8" : "#0f172a",
      },
      ...overrides,
    };
  }

  function bkqPlotlyConfig() {
    return {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
      toImageButtonOptions: {
        format: "png",
        filename: "bkquant_plot",
        width: 1400,
        height: 820,
        scale: 2,
      },
    };
  }

  function bkqPlotlyGridColors() {
    const dark = bkqPlotlyThemeIsDark();
    return {
      grid: dark ? "rgba(148, 163, 184, 0.22)" : "rgba(148, 163, 184, 0.38)",
      zero: dark ? "#64748b" : "#94a3b8",
    };
  }

  function studentTInvTwoTail(df, alphaTwoTail) {
    const p = 1 - alphaTwoTail / 2;
    if (typeof jStat !== "undefined" && jStat.studentt && typeof jStat.studentt.inv === "function") {
      return jStat.studentt.inv(p, df);
    }
    if (df >= 120) return alphaTwoTail === 0.05 ? 1.96 : 2.576;
    const table = [
      [1, 12.706, 63.657],
      [2, 4.303, 9.925],
      [3, 3.182, 5.841],
      [4, 2.776, 4.604],
      [5, 2.571, 4.032],
      [10, 2.228, 3.169],
      [20, 2.086, 2.845],
      [30, 2.042, 2.75],
    ];
    const row = table.find((r) => r[0] === df) || table.find((r) => r[0] >= df) || [30, 2.042, 2.75];
    return alphaTwoTail === 0.05 ? row[1] : row[2];
  }

  function parseBiometricTraitMatrix(text) {
    const lines = (text || "").trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 3) return { error: "Provide at least 3 rows (header + 2 genotypes) and 2+ trait columns." };
    const raw = lines.map((l) => l.split(/[\t,;]+/).map((s) => s.trim()));
    const top = raw[0];
    const firstCellNum = Number.isFinite(Number(top[0]));
    let rowNames = [];
    let colNames = [];
    let data = [];
    if (!firstCellNum && top.length > 1) {
      colNames = top.slice(1);
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i];
        rowNames.push(String(row[0] || `G${i}`));
        const nums = row.slice(1, 1 + colNames.length).map((s) => Number(s));
        if (nums.length !== colNames.length || nums.some((n) => !Number.isFinite(n))) {
          return { error: `Row ${i + 1}: expected ${colNames.length} numeric trait values after the label.` };
        }
        data.push(nums);
      }
    } else {
      colNames = top.map((_, j) => `Trait${j + 1}`);
      data = raw.map((row, i) => {
        rowNames.push(`G${i + 1}`);
        return row.map((s) => Number(s));
      });
      if (data.some((row) => row.some((n) => !Number.isFinite(n)))) return { error: "All trait cells must be numeric." };
    }
    if (data.length < 2 || colNames.length < 2) {
      return { error: "Need at least 2 genotypes (rows) and 2 traits (columns) for correlation and summaries." };
    }
    return { rowNames, colNames, data };
  }

  function parseCrdRepMatrix(text) {
    const rawT = (text || "").trim();
    if (!rawT) return { skip: true };
    const lines = rawT.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return { skip: true };
    const raw = lines.map((l) => l.split(/[\t,;]+/).map((s) => s.trim()));
    const first = raw[0][0];
    let names = [];
    let matrix = [];
    if (!Number.isFinite(Number(first))) {
      for (const row of raw) {
        names.push(String(row[0]));
        const nums = row.slice(1).map((s) => Number(s));
        if (nums.some((n) => !Number.isFinite(n))) return { error: "Replicate matrix: all replicate cells must be numeric." };
        matrix.push(nums);
      }
    } else {
      matrix = raw.map((row) => row.map((s) => Number(s)));
      if (matrix.some((r) => r.some((n) => !Number.isFinite(n)))) return { error: "Replicate matrix: invalid number." };
      names = matrix.map((_, i) => `T${i + 1}`);
    }
    const r = matrix[0].length;
    if (r < 2) return { error: "ANOVA block needs at least 2 replications per treatment." };
    if (matrix.some((row) => row.length !== r)) return { error: "Each treatment row must have the same number of replicates." };
    return { names, matrix, r };
  }

  function traitSummaryStats(vals, label) {
    const n = vals.length;
    const m = mean(vals);
    if (n < 2) return null;
    let ss = 0;
    for (const v of vals) ss += (v - m) ** 2;
    const sd = Math.sqrt(ss / (n - 1));
    const se = sd / Math.sqrt(n);
    const cv = Math.abs(m) > 1e-12 ? (sd / Math.abs(m)) * 100 : 0;
    const df = n - 1;
    const cd5 = studentTInvTwoTail(df, 0.05) * se * Math.sqrt(2);
    const cd1 = studentTInvTwoTail(df, 0.01) * se * Math.sqrt(2);
    return { trait: label, mean: m, se, cv, cd5, cd1, n, sd };
  }

  function corrHeatmapHtml(R, names) {
    const p = R.length;
    const cells = [];
    for (let i = 0; i < p; i++) {
      const row = [`<th>${qs(names[i])}</th>`];
      for (let j = 0; j < p; j++) {
        const r = R[i][j];
        const t = (r + 1) / 2;
        const bg =
          r >= 0
            ? `rgba(6, 78, 59, ${0.2 + Math.abs(r) * 0.65})`
            : `rgba(225, 29, 72, ${0.2 + Math.abs(r) * 0.65})`;
        row.push(`<td class="hm-cell" style="background:${bg}">${r.toFixed(3)}</td>`);
      }
      cells.push(`<tr>${row.join("")}</tr>`);
    }
    const head = `<tr><th></th>${names.map((n) => `<th>${qs(n)}</th>`).join("")}</tr>`;
    return `<div class="corr-heatmap-wrap"><table class="corr-heatmap data"><thead>${head}</thead><tbody>${cells.join("")}</tbody></table></div>`;
  }

  function renderBiometricReport() {
    const title = "Biometric Report (Summary, Correlation, Graphics)";
    showContentHeader({
      title,
      subtitle:
        "Paste genotype × trait data (unreplicated means). Optional: CRD-style treatment × replicate matrix for pooled ANOVA on one response.",
    });

    const defaultMulti = `Genotype,Yield_g,Protein_pct,Height_cm
G1,32.1,12.4,102
G2,34.2,11.8,105
G3,31.5,12.1,100
G4,33.0,12.0,104
G5,30.8,11.9,99`;

    const defaultCrd = `G1,31.2,32.1,31.8
G2,33.1,34.0,33.5
G3,30.5,29.9,30.2
G4,32.8,33.2,32.9`;

    const bodyHtml = `
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>1. Genotype × trait matrix</h4>
            <p class="muted small">Rows = entries (genotypes); columns = traits. First column may be labels (e.g. G1), or omit labels and use numbers only.</p>
            <label>
              Data
              <textarea id="bioMulti" rows="10">${defaultMulti}</textarea>
            </label>
            <div class="actions" style="margin-top:8px">
              <button class="action-btn" type="button" id="bioImportMulti">Import genotype × trait (CSV / Excel)</button>
              <input type="file" id="bioMultiFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <h4 style="margin-top:14px">2. Optional — CRD replicates (one response)</h4>
            <p class="muted small">Rows = treatments; columns = replicates (equal r). First column may be labels. Used for one-way ANOVA on the <b>first trait</b> column above (matched by row order) — or leave default as separate yield trial.</p>
            <label>
              Treatment × replicate (optional)
              <textarea id="bioCrd" rows="6">${defaultCrd}</textarea>
            </label>
            <div class="actions" style="margin-top:8px">
              <button class="action-btn" type="button" id="bioImportCrd">Import CRD matrix (CSV / Excel)</button>
              <input type="file" id="bioCrdFile" accept="${BKQ_DATA_FILE_ACCEPT}" style="display:none" />
            </div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="bioCompute">Run biometric analysis</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Outputs</h4>
            <div class="actions" style="margin:0 0 12px;flex-wrap:wrap;align-items:center;gap:10px">
              <label class="muted small" style="display:flex;align-items:center;gap:8px;margin:0;font-weight:650">
                Plotly theme
                <select id="bioPlotlyTheme" aria-label="Plotly figure theme" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);font-size:13px;background:var(--surface);color:var(--text)">
                  <option value="light">Light (print)</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <span class="muted small" style="line-height:1.4">Charts use large type and crisp grids; exports use high-resolution PNGs.</span>
            </div>
            <div id="bioOutSummary"></div>
            <div id="bioOutCorr"></div>
            <div id="bioPlotBar" class="plotly-chart" style="margin-top:12px"></div>
            <div id="bioPlotBox" class="plotly-chart" style="margin-top:12px"></div>
            <div id="bioPlotScatter" class="plotly-chart" style="margin-top:12px"></div>
            <div id="bioOutAnova"></div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "biometric",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: ["fAnova"],
    });

    function purgeBioPlots() {
      ["bioPlotBar", "bioPlotBox", "bioPlotScatter"].forEach((id) => {
        const el = document.getElementById(id);
        if (el && typeof Plotly !== "undefined" && Plotly.purge) Plotly.purge(el);
      });
    }

    bindCsvExcelToTextarea("bioImportMulti", "bioMultiFile", "bioMulti");
    bindCsvExcelToTextarea("bioImportCrd", "bioCrdFile", "bioCrd");

    const bioThemeSel = document.getElementById("bioPlotlyTheme");
    if (bioThemeSel) {
      bioThemeSel.value = localStorage.getItem("bkq_plotly_theme") === "dark" ? "dark" : "light";
      bioThemeSel.addEventListener("change", () => {
        localStorage.setItem("bkq_plotly_theme", bioThemeSel.value === "dark" ? "dark" : "light");
        $("#bioCompute").click();
      });
    }

    $("#bioCompute").addEventListener("click", () => {
      clearValidation("#contentBody");
      purgeBioPlots();
      const parsed = parseBiometricTraitMatrix($("#bioMulti").value);
      if (parsed.error) {
        markInvalidInput($("#bioMulti"), parsed.error);
        $("#bioOutSummary").innerHTML = `<div class="note">${qs(parsed.error)}</div>`;
        $("#bioOutCorr").innerHTML = "";
        $("#bioOutAnova").innerHTML = "";
        return;
      }
      const { rowNames, colNames, data } = parsed;
      const p = colNames.length;
      const n = data.length;

      const summaryRows = [];
      for (let j = 0; j < p; j++) {
        const col = data.map((row) => row[j]);
        const s = traitSummaryStats(col, colNames[j]);
        if (s) summaryRows.push([s.trait, s.mean, s.se, s.cv, s.cd5, s.cd1]);
      }
      const sumTable = buildTable(
        ["Trait / variable", "Mean", "Std. error", "CV (%)", "CD (5%)", "CD (1%)"],
        summaryRows
      );
      $("#bioOutSummary").innerHTML = `<h4>Table 1. Summary statistics (across ${n} entries)</h4><p class="muted small">SE = SD/√n. CD uses two-mean comparison: t<sub>α/2,df</sub> × SE × √2 (df = n−1 per trait). For design-specific CD, use CRD/RBD modules with error MS.</p>${sumTable}`;

      const X = data;
      const R = pearsonCorrelationMatrix(X);
      $("#bioOutCorr").innerHTML = `<h4 style="margin-top:14px">Table 2. Pearson correlation matrix</h4>${corrHeatmapHtml(R, colNames)}`;

      const traitIdxBar = 0;
      const ys = data.map((row) => row[traitIdxBar]);
      const err = Array(n).fill(summaryRows[traitIdxBar] ? summaryRows[traitIdxBar][2] : 0);

      if (typeof Plotly !== "undefined") {
        const g = bkqPlotlyGridColors();
        const errColor = bkqPlotlyThemeIsDark() ? "#94a3b8" : "#64748b";
        Plotly.newPlot(
          "bioPlotBar",
          [
            {
              type: "bar",
              x: rowNames,
              y: ys,
              error_y: { type: "data", array: err, visible: true, color: errColor, thickness: 1.5, width: 5 },
              marker: {
                color: BKQ_PLOTLY_COLORWAY[0],
                line: { color: "rgba(15, 23, 42, 0.2)", width: 0 },
              },
              name: colNames[traitIdxBar],
            },
          ],
          bkqPlotlyLayout(`Mean comparison — ${colNames[traitIdxBar]} (± SE across entries)`, {
            showlegend: false,
            xaxis: {
              title: { text: "Entry" },
              tickangle: -28,
              showgrid: false,
              automargin: true,
            },
            yaxis: {
              title: { text: colNames[traitIdxBar] },
              zeroline: true,
              zerolinecolor: g.zero,
              gridcolor: g.grid,
              showgrid: true,
              automargin: true,
            },
          }),
          bkqPlotlyConfig()
        );

        const boxTraces = colNames.map((name, j) => {
          const c = BKQ_PLOTLY_COLORWAY[j % BKQ_PLOTLY_COLORWAY.length];
          return {
            type: "box",
            y: data.map((row) => row[j]),
            name,
            marker: { color: c, outliercolor: c },
            line: { color: bkqPlotlyThemeIsDark() ? "#e2e8f0" : "#334155", width: 1.2 },
            fillcolor: c,
            opacity: 0.9,
            boxmean: "sd",
          };
        });
        Plotly.newPlot(
          "bioPlotBox",
          boxTraces,
          bkqPlotlyLayout("Trait distributions across entries (quartiles, whiskers, mean ± SD)", {
            showlegend: false,
            xaxis: {
              title: { text: "Trait" },
              showgrid: false,
              automargin: true,
            },
            yaxis: {
              title: { text: "Value" },
              zeroline: true,
              zerolinecolor: g.zero,
              gridcolor: g.grid,
              showgrid: true,
              automargin: true,
            },
          }),
          bkqPlotlyConfig()
        );

        const xCol = data.map((row) => row[0]);
        const yCol = data.map((row) => row[1]);
        const { slope, intercept, r2 } = simpleLinearRegression(xCol, yCol);
        const minX = Math.min(...xCol);
        const maxX = Math.max(...xCol);
        const lineX = [minX, maxX];
        const lineY = [intercept + slope * minX, intercept + slope * maxX];
        const annBg = bkqPlotlyThemeIsDark() ? "rgba(30,41,59,0.9)" : "rgba(255,255,255,0.94)";
        const annBr = bkqPlotlyThemeIsDark() ? "#475569" : "#cbd5e1";
        Plotly.newPlot(
          "bioPlotScatter",
          [
            {
              type: "scatter",
              mode: "markers",
              x: xCol,
              y: yCol,
              text: rowNames,
              hovertemplate: "%{text}<br>" + colNames[0] + ": %{x:.4f}<br>" + colNames[1] + ": %{y:.4f}<extra></extra>",
              marker: {
                size: 12,
                color: BKQ_PLOTLY_COLORWAY[0],
                line: { color: "#ffffff", width: 1 },
              },
              name: "Observations",
            },
            {
              type: "scatter",
              mode: "lines",
              x: lineX,
              y: lineY,
              line: { color: BKQ_PLOTLY_COLORWAY[4], width: 2.5 },
              name: "OLS fit",
            },
          ],
          bkqPlotlyLayout(`Regression — ${colNames[1]} vs ${colNames[0]} (R² = ${r2.toFixed(4)})`, {
            showlegend: true,
            legend: { orientation: "h", yanchor: "bottom", y: 1.03, xanchor: "right", x: 1, font: { size: 13 } },
            xaxis: {
              title: { text: colNames[0] },
              showgrid: true,
              gridcolor: g.grid,
              zeroline: true,
              zerolinecolor: g.zero,
              automargin: true,
            },
            yaxis: {
              title: { text: colNames[1] },
              showgrid: true,
              gridcolor: g.grid,
              zeroline: true,
              zerolinecolor: g.zero,
              automargin: true,
            },
            annotations: [
              {
                x: maxX,
                y: lineY[1],
                text: `y = ${intercept.toFixed(3)} + ${slope.toFixed(3)}x`,
                showarrow: false,
                xanchor: "right",
                font: { size: 13, family: "Inter, ui-sans-serif, system-ui, sans-serif", color: bkqPlotlyThemeIsDark() ? "#f1f5f9" : "#0f172a" },
                bgcolor: annBg,
                bordercolor: annBr,
                borderwidth: 1,
                borderpad: 5,
              },
            ],
          }),
          bkqPlotlyConfig()
        );
      } else {
        $("#bioPlotBar").innerHTML = `<p class="muted small">Plotly failed to load — check network for CDN.</p>`;
      }

      const crdP = parseCrdRepMatrix($("#bioCrd").value);
      let anovaBlock = "";
      if (crdP.error) {
        anovaBlock = `<div class="note" style="margin-top:12px">${qs(crdP.error)}</div>`;
      } else if (crdP.matrix && !crdP.skip) {
        const out = crdAnova(crdP.matrix, crdP.r);
        const means = out.means.map((m) => m.mean);
        const order = out.means.map((_, i) => i).sort((a, b) => means[b] - means[a]);
        const top = order.slice(0, Math.min(3, order.length)).map((i) => `${crdP.names[i]} (mean=${means[i].toFixed(3)})`);
        const sig = out.sig.note;
        anovaBlock = `
          <h4 style="margin-top:16px">Table 3. One-way ANOVA (CRD on replicate matrix)</h4>
          ${buildTable(
            ["Source", "SS", "df", "MS", "F", "Sig. (approx.)"],
            [
              ["Treatments", out.ssTreat, out.dfTreat, out.msTreat, out.fStat, out.sig.note],
              ["Error", out.ssError, out.dfError, out.msError, "", ""],
              ["Total", out.ssTotal, out.dfTreat + out.dfError, "", "", ""],
            ]
          )}
          <div class="section" style="margin-top:12px">
            <h4>Statistical interpretation (ANOVA)</h4>
            <p style="white-space:pre-wrap;color:var(--text);line-height:1.55">${qs(
              `1) The F-test for treatments is F = ${out.fStat.toFixed(4)} on df1=${out.dfTreat}, df2=${out.dfError}, with approximate significance: ${sig}.\n` +
                `2) Mean square error (MSE = ${out.msError.toFixed(4)}) estimates experimental error variance; treatment mean square (MST = ${out.msTreat.toFixed(4)}) measures among-treatment variation relative to that error.\n` +
                `3) Under the usual CRD assumptions (independence, homogeneity of variance, additive errors), a large F relative to the critical ratio supports differences among treatment means; use mean comparisons (e.g. CD from error MS) for ranking entries.`
            )}</p>
            <p class="muted small" style="margin-top:10px"><b>Top-performing entries (by treatment mean):</b> ${qs(top.join("; "))}</p>
          </div>`;
      } else {
        anovaBlock = `<p class="muted small" style="margin-top:12px">Optional ANOVA: paste a treatment × replicate matrix to append pooled one-way ANOVA.</p>`;
      }
      $("#bioOutAnova").innerHTML = anovaBlock;

      const interpret =
        `Biometric summary across ${n} entries and ${p} traits.\n` +
        `Highest mean for ${colNames[0]}: ${rowNames[ys.indexOf(Math.max(...ys))]} (${Math.max(...ys).toFixed(3)}).\n` +
        `Correlation between ${colNames[0]} and ${colNames[1]}: r = ${pearsonCorrelation(xCol, yCol).toFixed(4)}.`;

      let fAnovaVal = 0;
      if (crdP.matrix && crdP.r && !crdP.error) fAnovaVal = crdAnova(crdP.matrix, crdP.r).fStat;
      setInterpretation("biometric", interpret, "", { fAnova: fAnovaVal });
      setRunMeta("biometric", {
        forceRun: isForceRunEnabled(),
        inputSize: `${n}×${p}`,
        standardization: "none",
        preprocessing: "Biometric report: summary, correlation heatmap, Plotly charts.",
        qualityScore: "85 / 100",
      });
    });

    $("#bioCompute").click();
  }

  // --- Data Insights (Tailwind + Chart.js: table, grouped bar + SE, correlation heatmap) ---
  let diBarChartInstance = null;

  function registerDiErrorBarPluginOnce() {
    if (typeof Chart === "undefined" || window.__bkqDiErrorBarsRegistered) return;
    Chart.register({
      id: "diErrorBars",
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, dsIndex) => {
          const errs = dataset.errorBarY;
          if (!errs || !errs.length) return;
          const meta = chart.getDatasetMeta(dsIndex);
          if (!meta.data) return;
          ctx.save();
          ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
          ctx.lineWidth = 1;
          meta.data.forEach((bar, i) => {
            const se = errs[i];
            if (!Number.isFinite(se) || se <= 0) return;
            const v = dataset.data[i];
            const yScale = chart.scales.y;
            const y0 = yScale.getPixelForValue(v - se);
            const y1 = yScale.getPixelForValue(v + se);
            const x = bar.x;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
            const cap = 3;
            ctx.beginPath();
            ctx.moveTo(x - cap, y0);
            ctx.lineTo(x + cap, y0);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - cap, y1);
            ctx.lineTo(x + cap, y1);
            ctx.stroke();
          });
          ctx.restore();
        });
      },
    });
    window.__bkqDiErrorBarsRegistered = true;
  }

  function renderDataInsights() {
    const title = "Data Insights";
    showContentHeader({
      title,
      subtitle:
        "Searchable summary table, grouped bar chart with ±SE error bars, and Pearson correlation heatmap (slate / indigo). Paste genotype × trait data (CSV).",
    });

    const defaultCsv = `Genotype,Yield,Protein,Oil
G1,32.1,12.4,42.0
G2,34.2,11.8,41.2
G3,31.5,12.1,40.5
G4,33.0,12.0,41.8
G5,30.8,11.9,40.1`;

    function sdSample(arr) {
      const n = arr.length;
      if (n < 2) return 0;
      const m = mean(arr);
      let ss = 0;
      for (const v of arr) ss += (v - m) ** 2;
      return Math.sqrt(ss / (n - 1));
    }

    function traitCvAcrossGenotypes(col) {
      const vals = col.slice();
      const m = mean(vals);
      const sd = sdSample(vals);
      return Math.abs(m) > 1e-12 ? (sd / Math.abs(m)) * 100 : 0;
    }

    function diHeatmapHtml(R, names) {
      const p = R.length;
      const rows = [];
      for (let i = 0; i < p; i++) {
        const tds = [`<th class="border border-slate-700 bg-slate-900 px-2 py-1.5 text-left text-xs font-semibold text-slate-200">${qs(names[i])}</th>`];
        for (let j = 0; j < p; j++) {
          const r = R[i][j];
          const t = (r + 1) / 2;
          const r0 = 220;
          const g0 = 38;
          const b0 = 38;
          const r1 = 16;
          const g1 = 185;
          const b1 = 129;
          const rr = Math.round(r0 + (r1 - r0) * t);
          const gg = Math.round(g0 + (g1 - g0) * t);
          const bb = Math.round(b0 + (b1 - b0) * t);
          tds.push(
            `<td class="border border-slate-700 px-1.5 py-1 text-center text-xs font-mono text-slate-900" style="background:rgba(${rr},${gg},${bb},0.72)">${r.toFixed(3)}</td>`
          );
        }
        rows.push(`<tr class="hover:bg-slate-800/40">${tds.join("")}</tr>`);
      }
      const head = `<tr><th class="sticky left-0 z-20 border border-slate-700 bg-slate-900 px-2 py-2"></th>${names
        .map((n) => `<th class="border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-semibold text-indigo-300">${qs(n)}</th>`)
        .join("")}</tr>`;
      return `<div class="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/40 shadow-inner"><table class="w-full border-collapse">${head}<tbody>${rows.join("")}</tbody></table></div><p class="mt-2 text-xs text-slate-400">Scale: red (−1) → green (+1). Diagonal = 1.</p>`;
    }

    const bodyHtml = `
      <div class="rounded-xl border border-slate-700 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-4 text-slate-100 shadow-xl">
        <div class="mb-4 rounded-lg border border-indigo-500/30 bg-slate-900/80 p-4 shadow-md">
          <h4 class="mb-2 text-sm font-bold uppercase tracking-wide text-indigo-300">Summary</h4>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-md border border-slate-600/60 bg-slate-800/50 p-3">
              <div class="text-xs font-medium text-slate-400">Mean CV% (across traits)</div>
              <div id="diCvVal" class="mt-1 text-2xl font-bold text-emerald-400">—</div>
            </div>
            <div class="rounded-md border border-slate-600/60 bg-slate-800/50 p-3">
              <div class="text-xs font-medium text-slate-400">Top performer (by row mean)</div>
              <div id="diTopVal" class="mt-1 text-xl font-bold text-indigo-300">—</div>
            </div>
          </div>
          <p class="mt-3 text-xs leading-relaxed text-slate-400">
            <strong class="text-slate-300">Practice:</strong> publish means with CD and CV so readers can judge real differences vs. noise.
            Use scatter + trend for path-style relationships; use box plots when you have replicates to show spread and outliers.
          </p>
        </div>

        <label class="mb-2 block text-sm font-medium text-slate-300">Data (CSV: header row, first column = genotype/sample)</label>
        <textarea id="diCsv" class="mb-3 w-full rounded-lg border border-slate-600 bg-slate-950/80 p-3 font-mono text-sm text-slate-100" rows="8">${qs(defaultCsv)}</textarea>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" id="diImportCsv" class="rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700">Import CSV / Excel</button>
          <button type="button" id="diTemplateCsv" class="rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700">Download example CSV</button>
          <input type="file" id="diCsvFile" accept="${BKQ_DATA_FILE_ACCEPT}" class="hidden" />
        </div>
        <div class="mb-4 flex flex-wrap gap-2">
          <button type="button" id="diCompute" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500">Update insights</button>
          <input id="diSearch" type="search" placeholder="Search genotype…" class="min-w-[200px] flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
        </div>

        <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div class="min-w-0">
            <h4 class="mb-2 text-sm font-semibold text-indigo-200">Performance table</h4>
            <div class="max-h-[min(520px,70vh)] overflow-auto rounded-lg border border-slate-700">
              <table id="diTable" class="data w-full border-collapse text-sm">
                <thead class="sticky top-0 z-10 bg-slate-900 shadow-[0_1px_0_0_rgba(51,65,85,0.9)]">
                  <tr>
                    <th data-sort="name" class="cursor-pointer border-b border-slate-600 px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-indigo-300">Genotype / Sample</th>
                    <th data-sort="mean" class="cursor-pointer border-b border-slate-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-indigo-300">Mean performance</th>
                    <th data-sort="se" class="cursor-pointer border-b border-slate-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-indigo-300">SEm ±</th>
                    <th data-sort="cd" class="cursor-pointer border-b border-slate-600 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-indigo-300">CD @ 5%</th>
                  </tr>
                </thead>
                <tbody id="diTbody"></tbody>
              </table>
            </div>
            <div id="diFooter" class="mt-2 rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-400"></div>
          </div>

          <div class="flex min-w-0 flex-col gap-6">
            <div>
              <h4 class="mb-2 text-sm font-semibold text-indigo-200">Grouped bar — traits by genotype (± SE)</h4>
              <p class="mb-1 text-xs text-slate-500">SE per bar = SD of that trait across genotypes / √n (screening SE).</p>
              <div class="chart chart--dark relative h-72 w-full min-h-[288px] rounded-lg border border-slate-700 bg-slate-900/50 p-0">
                <canvas id="diChartBar"></canvas>
              </div>
            </div>
            <div>
              <h4 class="mb-2 text-sm font-semibold text-indigo-200">Pearson correlation heatmap</h4>
              <div id="diHeatWrap"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    moduleShell({
      moduleId: "dataInsights",
      title,
      subtitle: "",
      bodyHtml,
      payloadForPrevComparison: { interpretation: "", storePrev: null },
      prevCompareKeys: [],
    });

    let tableRows = [];
    let sortKey = "name";
    let sortDir = 1;

    function computeAndRender() {
      const parsed = parseBiometricTraitMatrix($("#diCsv").value);
      if (parsed.error) {
        $("#diTbody").innerHTML = `<tr><td colspan="4" class="px-3 py-4 text-rose-400">${qs(parsed.error)}</td></tr>`;
        $("#diFooter").innerHTML = "";
        $("#diHeatWrap").innerHTML = "";
        $("#diCvVal").textContent = "—";
        $("#diTopVal").textContent = "—";
        if (diBarChartInstance && typeof Chart !== "undefined") {
          diBarChartInstance.destroy();
          diBarChartInstance = null;
        }
        return;
      }
      const { rowNames, colNames, data } = parsed;
      const n = data.length;
      const p = colNames.length;

      const traitCvs = colNames.map((_, j) => traitCvAcrossGenotypes(data.map((row) => row[j])));
      const meanCv = mean(traitCvs);
      $("#diCvVal").textContent = `${meanCv.toFixed(2)}%`;

      const rowStats = rowNames.map((name, i) => {
        const vals = data[i];
        const m = mean(vals);
        const se = p > 1 ? sdSample(vals) / Math.sqrt(p) : 0;
        return { name, mean: m, se, vals };
      });
      const top = rowStats.reduce((a, b) => (a.mean >= b.mean ? a : b));
      $("#diTopVal").textContent = `${top.name} (${top.mean.toFixed(3)})`;

      const seMean = mean(rowStats.map((r) => r.se));
      const df = Math.max(1, n - 1);
      const cd5 = studentTInvTwoTail(df, 0.05) * seMean * Math.sqrt(2);

      tableRows = rowStats.map((r) => ({
        name: r.name,
        mean: r.mean,
        se: r.se,
        cd: cd5,
      }));

      $("#diFooter").innerHTML = `<strong class="text-slate-300">Pooled CD (5%)</strong> for comparing row means (composite): ${cd5.toFixed(4)}. <strong>CV traits</strong> (mean): ${meanCv.toFixed(2)}%.`;

      renderTableBody();
      bindSort();

      const R = pearsonCorrelationMatrix(data);
      $("#diHeatWrap").innerHTML = diHeatmapHtml(R, colNames);

      if (typeof Chart === "undefined") return;

      const canvas = $("#diChartBar");
      if (!canvas) return;
      if (diBarChartInstance) {
        diBarChartInstance.destroy();
        diBarChartInstance = null;
      }

      const palette = ["rgba(99, 102, 241, 0.85)", "rgba(129, 140, 248, 0.85)", "rgba(165, 180, 252, 0.9)", "rgba(79, 70, 229, 0.85)", "rgba(196, 181, 253, 0.85)"];
      const traitSes = colNames.map((_, j) => {
        const col = data.map((row) => row[j]);
        return n > 1 ? sdSample(col) / Math.sqrt(n) : 0;
      });

      const datasets = colNames.map((cn, j) => ({
        label: cn,
        data: data.map((row) => row[j]),
        backgroundColor: palette[j % palette.length],
        borderColor: "rgba(30, 27, 75, 0.9)",
        borderWidth: 1,
        errorBarY: traitSes,
      }));

      registerDiErrorBarPluginOnce();

      diBarChartInstance = new Chart(canvas, {
        type: "bar",
        data: {
          labels: rowNames,
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "#cbd5e1", font: { size: 11 }, boxWidth: 12 },
            },
            title: { display: true, text: "Traits compared across samples", color: "#a5b4fc", font: { size: 13 } },
            tooltip: {
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              titleColor: "#f1f5f9",
              bodyColor: "#e2e8f0",
            },
          },
          scales: {
            x: {
              ticks: { color: "#94a3b8", maxRotation: 45, minRotation: 0 },
              grid: { color: "rgba(51, 65, 85, 0.35)" },
            },
            y: {
              beginAtZero: false,
              ticks: { color: "#94a3b8" },
              grid: { color: "rgba(51, 65, 85, 0.35)" },
            },
          },
        },
      });

      setInterpretation(
        "dataInsights",
        `Data Insights: mean CV across traits ${meanCv.toFixed(2)}%; top entry ${top.name} (row mean ${top.mean.toFixed(4)}). Pooled CD (5%) for row-mean comparison ≈ ${cd5.toFixed(4)}. Correlation heatmap uses Pearson r between traits.`,
        "",
        null
      );
      setRunMeta("dataInsights", {
        forceRun: isForceRunEnabled(),
        inputSize: `${n} genotypes × ${p} traits`,
        standardization: "none",
        preprocessing: "Tailwind + Chart.js grouped bar + heatmap table.",
        qualityScore: "90 / 100",
      });
    }

    function renderTableBody() {
      const q = ($("#diSearch").value || "").trim().toLowerCase();
      let rows = tableRows.filter((r) => !q || String(r.name).toLowerCase().includes(q));
      const sk = sortKey;
      const dir = sortDir;
      rows = [...rows].sort((a, b) => {
        const va = sk === "name" ? String(a.name).toLowerCase() : Number(a[sk]);
        const vb = sk === "name" ? String(b.name).toLowerCase() : Number(b[sk]);
        if (va < vb) return -dir;
        if (va > vb) return dir;
        return 0;
      });
      $("#diTbody").innerHTML = rows
        .map(
          (r, i) =>
            `<tr class="border-b border-slate-700/60 ${i % 2 === 0 ? "bg-slate-900/30" : "bg-indigo-950/25"}"><td class="px-3 py-2 font-medium text-slate-100">${qs(
              r.name
            )}</td><td class="px-3 py-2 text-right font-mono text-slate-200">${r.mean.toFixed(4)}</td><td class="px-3 py-2 text-right font-mono text-slate-300">± ${r.se.toFixed(
              4
            )}</td><td class="px-3 py-2 text-right font-mono text-indigo-200">${r.cd.toFixed(4)}</td></tr>`
        )
        .join("");
    }

    function bindSort() {
      $$("#diTable thead th[data-sort]").forEach((th) => {
        th.replaceWith(th.cloneNode(true));
      });
      $$("#diTable thead th[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
          const k = th.getAttribute("data-sort");
          if (sortKey === k) sortDir *= -1;
          else {
            sortKey = k;
            sortDir = k === "name" ? 1 : -1;
          }
          renderTableBody();
        });
      });
    }

    bindCsvExcelToTextarea("diImportCsv", "diCsvFile", "diCsv");
    $("#diTemplateCsv").addEventListener("click", () => {
      triggerCsvDownload("data_insights_example.csv", parseCsv(defaultCsv));
    });

    $("#diCompute").addEventListener("click", computeAndRender);
    $("#diSearch").addEventListener("input", () => renderTableBody());
    computeAndRender();
  }

  // -----------------------------
  // Module registry
  // -----------------------------
  const GROUPS = {
    "data-analysis": [
      { id: "dataInsights", title: "Data Insights", icon: "◈" },
      { id: "crd", title: "CRD (ANOVA)", icon: "⬚" },
      { id: "rbd", title: "RBD (ANOVA)", icon: "▤" },
      { id: "factorial", title: "Factorial RBD", icon: "⊞" },
      { id: "fact3", title: "Factorial RBD A×B×C", icon: "⊞³" },
      { id: "lattice", title: "Lattice Square", icon: "▦" },
      { id: "augmented", title: "Augmented Design", icon: "≡" },
      { id: "splitplot", title: "Split Plot Design", icon: "▩" },
    ],
    "plant-breeding": [
      { id: "correlation", title: "Correlation", icon: "ρ" },
      { id: "corpath", title: "Correlation & Path", icon: "ρ⇢" },
      { id: "regression", title: "Regression", icon: "→" },
      { id: "mlr", title: "MLR (VIF + AIC)", icon: "⇉" },
      { id: "path", title: "Path Analysis", icon: "⇢" },
      { id: "discriminant", title: "Discriminant", icon: "Δ" },
      { id: "factoranalysis", title: "Factor Analysis", icon: "𝚺" },
      { id: "d2", title: "D2 Analysis", icon: "D²" },
      { id: "metroglyph", title: "Metroglyph", icon: "⌁" },
      { id: "linetester", title: "Line x Tester", icon: "×" },
      { id: "diallel", title: "Diallel Design", icon: "∿" },
      { id: "nc", title: "NC Designs", icon: "N·C" },
      { id: "triple", title: "Triple Test Cross", icon: "TTT" },
      { id: "genmean", title: "Generation Mean", icon: "μ" },
      { id: "met", title: "MET", icon: "∑E" },
      { id: "ammi", title: "AMMI & Biplot", icon: "⌬" },
      { id: "pca", title: "PCA", icon: "◔" },
      { id: "biometric", title: "Biometric Report", icon: "◫" },
    ],
  };

  function computeButtonForModule(moduleId) {
    const map = {
      dataInsights: "diCompute",
      crd: "crdCompute",
      rbd: "rbdCompute",
      factorial: "factCompute",
      fact3: "fact3Compute",
      lattice: "latCompute",
      augmented: "augCompute",
      splitplot: "spCompute",
      correlation: "corCompute",
      corpath: "cpaCompute",
      regression: "regCompute",
      mlr: "mlrCompute",
      pca: "pcaCompute",
      path: "pathCompute",
      discriminant: "dfaCompute",
      factoranalysis: "faCompute",
      d2: "d2Compute",
      metroglyph: "mgCompute",
      linetester: "ltCompute",
      diallel: "diallelCompute",
      nc: "ncCompute",
      triple: "ttcCompute",
      genmean: "gmaCompute",
      met: "metCompute",
      ammi: "ammiCompute",
      biometric: "bioCompute",
    };
    return map[moduleId] || "";
  }

  async function runSelectedAnalysesReport(ids) {
    if (!ids || !ids.length) return;
    const allMods = Object.values(GROUPS).flat();
    const titleById = new Map(allMods.map((m) => [m.id, m.title]));
    const meta = loadReportMeta() || {};
    const sections = [];

    const quotation = `
      <div style="margin-top:14px;border-top:1px solid #ccc;padding-top:10px">
        <div style="font-weight:700">BKQuant quotation (for researchers)</div>
        <div style="margin-top:6px">“An equation for me has no meaning unless it expresses a thought of God.” — Srinivasa Ramanujan</div>
        <div style="margin-top:6px">“Science and everyday life cannot and should not be separated.” — Rosalind Franklin</div>
      </div>
    `;

    for (let si = 0; si < ids.length; si++) {
      const id = ids[si];
      openModule(id);
      await new Promise((r) => setTimeout(r, 30));
      const computeId = computeButtonForModule(id);
      if (computeId) document.getElementById(computeId)?.click();
      if (CURRENT_BATCH_PRESET) {
        const prev = LAST_RUN_META[id] || {};
        setRunMeta(id, { ...prev, batchPreset: CURRENT_BATCH_PRESET });
      }
      await new Promise((r) => setTimeout(r, 80));
      applyStandardTableCaptions("#contentBody");
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 50));

      const modTitle = titleById.get(id) || id;
      const inputFmtBatch = MODULE_EXPORT_INPUT_FORMAT[id] || "";
      const inputFmtHtml = inputFmtBatch
        ? `<h3 style="font-size:15px;margin:12px 0 8px;color:#0f172a">Data import format</h3><p style="white-space:pre-wrap;line-height:1.5;color:#334155;font-size:12px">${qs(inputFmtBatch)}</p>`
        : "";
      const figureBlocks = await collectExportFigureBlocks();
      const tables = getExportTablesFromContentBody();
      const tableHtml = buildExportTableSectionsHtml(tables, false);
      const interpretation = document.querySelector(".export-interpretation")?.innerText || "";
      const runMeta = LAST_RUN_META[id] || {};
      const breakBefore = si > 0 ? "page-break-before:always;" : "";

      sections.push(`<div style="margin-top:24px;${breakBefore}">
        <h2 style="font-size:19px;color:#0f172a;margin:0 0 6px">${qs(modTitle)}</h2>
        <p style="color:#64748b;font-size:11px;margin:0 0 12px">Module ID: ${qs(id)} · Run: ${qs(runMeta.timestamp || new Date().toISOString())}</p>
        ${inputFmtHtml}
        ${figureBlocks}
        <h3 style="font-size:16px;margin:18px 0 10px;color:#0f172a">Tables</h3>
        ${tableHtml || '<p style="color:#64748b">No tables in this view.</p>'}
        <h3 style="font-size:16px;margin:18px 0 10px;color:#0f172a">Interpretation</h3>
        <p style="white-space:pre-wrap">${qs(interpretation)}</p>
      </div>`);
    }

    const reportTitle = "BKQuant_Batch_Report";
    const metaRows = [
      ["Website", "BKQuant"],
      ["Version", `BKQuant v${BKQUANT_VERSION}`],
      ["Report type", "Batch package"],
      ["Modules included", ids.join(", ")],
      ["Researcher", meta.researcher || ""],
      ["Institution", meta.institution || ""],
      ["Date", meta.date || new Date().toISOString().slice(0, 10)],
    ].filter((r) => String(r[1] || "").trim().length > 0);

    const metaTable =
      metaRows.length
        ? `<table style="width:100%;border-collapse:collapse;margin:10px 0 14px">
            <tbody>
              ${metaRows
                .map(
                  ([k, v]) =>
                    `<tr>
                      <td style="border:1px solid #aaa;padding:6px;text-align:left;font-weight:700;background:#f7f7f7">${qs(k)}</td>
                      <td style="border:1px solid #aaa;padding:6px;text-align:left">${qs(String(v))}</td>
                    </tr>`
                )
                .join("")}
            </tbody>
          </table>`
        : "";

    const styles = `body{font-family:Calibri,Arial,sans-serif;font-size:12px;line-height:1.45}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:6px}h1{font-size:20px;margin-bottom:8px}h2{font-size:16px;margin:20px 0 10px;color:#0f172a}h3{font-size:14px}img{max-width:100%;height:auto}`;

    const doc = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
  <meta charset="utf-8"/>
  <meta name="ProgId" content="Word.Document"/>
  <title>${qs(reportTitle)}</title>
  <style>${styles}</style>
</head>
<body>
  <h1>${qs(reportTitle)}</h1>
  ${metaTable}
  ${sections.join("\n")}
  ${quotation}
</body>
</html>`;

    downloadBlob(`${reportTitle}.mht`, "multipart/related", wrapHtmlAsMhtml(doc));
    downloadBlob(`${reportTitle}.xls`, "application/vnd.ms-excel", doc);
  }

  function showRunSelectorPanel() {
    const all = Object.values(GROUPS).flat();
    const presetCoreTrials = ["crd", "rbd", "factorial", "lattice", "augmented", "splitplot", "met", "ammi"];
    const presetBreedingCore = ["correlation", "corpath", "regression", "mlr", "path", "d2", "linetester", "diallel", "nc", "triple", "genmean", "pca"];
    const checked = new Set(["rbd", "factorial", "met", "d2"]);
    const html = `
      <div class="section" style="margin-top:8px;border:1px solid rgba(255,255,255,0.14)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
          <h4 style="margin:0">Run selected analyses</h4>
          <button class="action-btn" type="button" data-utility="close">Close</button>
        </div>
        <div class="muted small" style="margin-top:6px">Select modules to auto-run and combine in one Word (.mht) + XLS package (figures embedded in .mht).</div>
        <div class="actions" style="margin-top:10px">
          <button class="action-btn" type="button" data-batch-preset="all">Select all</button>
          <button class="action-btn" type="button" data-batch-preset="none">Clear all</button>
          <button class="action-btn" type="button" data-batch-preset="core-trials">Core trials</button>
          <button class="action-btn" type="button" data-batch-preset="breeding-core">Breeding core</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:10px">
          ${all.map((m) => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-run-module="${qs(m.id)}" ${checked.has(m.id) ? "checked" : ""}/> <span>${qs(m.title)}</span></label>`).join("")}
        </div>
        <div class="actions" style="margin-top:10px">
          <button class="action-btn primary2" type="button" id="runSelectedNow">Run and export package</button>
        </div>
      </div>
    `;
    setUtilityPanelHtml(html);
    function applyPreset(mode) {
      CURRENT_BATCH_PRESET = mode;
      const inputs = Array.from(document.querySelectorAll("[data-run-module]"));
      const set = new Set(
        mode === "core-trials" ? presetCoreTrials :
        mode === "breeding-core" ? presetBreedingCore :
        mode === "all" ? all.map((m) => m.id) : []
      );
      inputs.forEach((el) => {
        const id = el.getAttribute("data-run-module");
        el.checked = set.has(id);
      });
    }
    document.querySelectorAll("[data-batch-preset]").forEach((btn) => {
      btn.addEventListener("click", () => applyPreset(btn.getAttribute("data-batch-preset")));
    });
    document.getElementById("runSelectedNow")?.addEventListener("click", async () => {
      const ids = Array.from(document.querySelectorAll("[data-run-module]:checked")).map((el) => el.getAttribute("data-run-module"));
      if (!ids.length) {
        alert("Select at least one module.");
        return;
      }
      await runSelectedAnalysesReport(ids);
      setUtilityPanelHtml("");
    });
  }

  function showProjectManager() {
    const all = loadProjects();
    const names = Object.keys(all).sort();
    if (!names.length) {
      setUtilityPanelHtml(`<div class="note">No saved projects found.<button class="action-btn" style="margin-left:8px" type="button" data-utility="close">Close</button></div>`);
      return;
    }
    const rows = names.map((name) => {
      const p = all[name];
      return `<tr>
        <td>${qs(name)}</td>
        <td>${qs(p.moduleId || "")}</td>
        <td>${qs((p.savedAt || "").replace("T", " ").slice(0, 19))}</td>
        <td>
          <button class="action-btn" type="button" data-proj-act="load" data-proj-name="${qs(name)}">Load</button>
          <button class="action-btn" type="button" data-proj-act="rename" data-proj-name="${qs(name)}">Rename</button>
          <button class="action-btn" type="button" data-proj-act="delete" data-proj-name="${qs(name)}">Delete</button>
        </td>
      </tr>`;
    }).join("");
    const html = `
      <div class="section" style="margin-top:8px;border:1px solid rgba(255,255,255,0.14)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
          <h4 style="margin:0">Saved projects</h4>
          <button class="action-btn" type="button" data-utility="close">Close</button>
        </div>
        <div style="overflow:auto;margin-top:10px">
          <table class="data">
            <thead><tr><th>Project</th><th>Module</th><th>Saved at</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    setUtilityPanelHtml(html);
    document.querySelectorAll("[data-proj-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-proj-act");
        const name = btn.getAttribute("data-proj-name");
        const projects = loadProjects();
        if (!projects[name]) return;
        if (act === "delete") {
          if (!window.confirm(`Delete project "${name}"?`)) return;
          delete projects[name];
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
          showProjectManager();
          return;
        }
        if (act === "rename") {
          const next = (window.prompt("Rename project to:", name) || "").trim();
          if (!next || next === name) return;
          projects[next] = projects[name];
          delete projects[name];
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
          showProjectManager();
          return;
        }
        if (act === "load") {
          const p = projects[name];
          openModule(p.moduleId);
          setTimeout(() => {
            applyInputState(p.state || {});
            const computeId = computeButtonForModule(p.moduleId);
            if (computeId) document.getElementById(computeId)?.click();
          }, 0);
          setUtilityPanelHtml("");
        }
      });
    });
  }

  function openModule(id) {
    // highlight current group based on module id
    const group = Object.keys(GROUPS).find((g) => GROUPS[g].some((x) => x.id === id));
    if (group) setActiveNav(group);

    // Render
    if (id === "dataInsights") return renderDataInsights();
    if (id === "crd") return renderCRD();
    if (id === "rbd") return renderRBD();
    if (id === "factorial") return renderFactorial();
    if (id === "fact3") return renderFactorial3();
    if (id === "lattice") return renderLatinSquare();
    if (id === "augmented") return renderAugmented();
    if (id === "splitplot") return renderSplitPlot();
    if (id === "correlation") return renderCorrelation();
    if (id === "corpath") return renderCorrelationPath();
    if (id === "regression") return renderRegression();
    if (id === "mlr") return renderMultipleLinearRegression();
    if (id === "pca") return renderPCA();
    if (id === "path") return renderPathCalculator();
    if (id === "discriminant") return renderDiscriminant();
    if (id === "factoranalysis") return renderFactorAnalysis();
    if (id === "d2") return renderD2Analysis();
    if (id === "metroglyph") return renderMetroglyph();
    if (id === "linetester") return renderLineTester();
    if (id === "diallel") return renderDiallelGraphical();
    if (id === "nc") return renderNCDesigns();
    if (id === "triple") return renderTripleTestCross();
    if (id === "genmean") return renderGenerationMean();
    if (id === "met") return renderMET();
    if (id === "ammi") return renderAMMI();
    if (id === "biometric") return renderBiometricReport();

    // Everything else: fully worked example output (tables + plots + interpretation).
    switch (id) {
      case "path": {
        const title2 = "Path Analysis (Example)";
        showContentHeader({ title: title2, subtitle: "Example path coefficients + path diagram using a simple SVG diagram." });

        const diagram = `
          <div class="chart" style="height:300px;margin-top:12px;display:grid;place-items:center">
            <svg id="pathDiagram" viewBox="0 0 760 280" width="100%" height="100%" style="overflow:visible">
              <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                  <path d="M0,0 L10,5 L0,10 Z" fill="#d97706"/>
                </marker>
                <marker id="arrow2" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                  <path d="M0,0 L10,5 L0,10 Z" fill="#0d9488"/>
                </marker>
              </defs>
              <rect x="20" y="30" width="220" height="220" rx="18" fill="#f1f5f9" stroke="#c5cdd8"/>
              <rect x="270" y="30" width="220" height="220" rx="18" fill="#f1f5f9" stroke="#c5cdd8"/>
              <rect x="520" y="30" width="220" height="220" rx="18" fill="#f1f5f9" stroke="#c5cdd8"/>
              <text x="130" y="95" text-anchor="middle" fill="#0f172a" font-size="18" font-weight="800">X1</text>
              <text x="380" y="95" text-anchor="middle" fill="#0f172a" font-size="18" font-weight="800">X2</text>
              <text x="630" y="95" text-anchor="middle" fill="#0f172a" font-size="18" font-weight="800">Y (Yield)</text>
              <text x="130" y="135" text-anchor="middle" fill="#64748b" font-size="12">Direct/Indirect</text>
              <text x="380" y="135" text-anchor="middle" fill="#64748b" font-size="12">Traits</text>
              <text x="630" y="135" text-anchor="middle" fill="#64748b" font-size="12">Response</text>

              <!-- arrows to Y -->
              <path d="M 240 140 C 320 140 360 120 510 120" stroke="#d97706" stroke-width="5" fill="none" marker-end="url(#arrow)"/>
              <path d="M 290 180 C 350 200 410 200 510 170" stroke="#0d9488" stroke-width="5" fill="none" marker-end="url(#arrow2)"/>

              <text x="365" y="112" fill="#b45309" font-size="14" font-weight="900">pYX1 = 0.72</text>
              <text x="380" y="198" fill="#0f766e" font-size="14" font-weight="900">pYX2 = -0.18</text>
            </svg>
          </div>
        `;

        const table = `
          <div style="margin-top:12px">
            ${buildTable(
              ["Path/Component", "Coefficient", "Meaning"],
              [
                ["Direct effect: X1 -> Y", 0.72, "Strong positive direct effect"],
                ["Direct effect: X2 -> Y", -0.18, "Negative direct effect"],
                ["Indirect effect: X1 -> Y via X2", -0.09, "Opposes direct effect"],
                ["Residual (unexplained)", 0.46, "Other traits also contribute"],
              ]
            )}
          </div>
        `;

        moduleShell({
          moduleId: "path",
          title: title2,
          subtitle: "",
          bodyHtml: `<div class="section" style="margin:0">${diagram}${table}</div>`,
          payloadForPrevComparison: { interpretation: "", storePrev: { directX1: 0.72 } },
          prevCompareKeys: ["directX1"],
        });

        const interpret =
          `Path analysis decomposes correlation into direct and indirect effects based on a causal/assumed model.\n\n` +
          `In the example:\n` +
          `• X1 has a strong positive direct effect (pYX1 = 0.72) on yield, meaning improving X1 is expected to increase yield.\n` +
          `• X2 has a small negative direct effect (pYX2 = -0.18), suggesting it may reduce yield when considered independently.\n` +
          `• The residual effect indicates that additional traits not included in the model also contribute to yield variation.\n\n` +
          `Breeding implication: prioritize selection criteria that show positive direct effects and avoid those with negative direct effects unless indirect pathways compensate.`;
        const deviationHtml = deviationBanner("path", { directX1: 0.72 }, ["directX1"]);
        setInterpretation("path", interpret, deviationHtml || "", { directX1: 0.72 });
        return;
      }

      default:
        // Provide a consistent, complete "example output" for all remaining modules.
        return renderEducationalModule({
          moduleId: id,
          title: "Plant Breeding Analysis (Example Output)",
          subtitle: "This module is included with fully worked example tables/plots and interpretation.",
          tables: [
            buildTable(
              ["Item", "Example Value"],
              [
                ["Key statistic", 1.2345],
                ["Standard error", 0.1123],
                ["Decision", "Favourable"],
                ["Replicates/Blocks", "Balanced example"],
              ]
            ),
          ],
          chart: {
            type: "bar",
            title: "Example comparison plot",
            labels: ["A", "B", "C", "D"],
            values: [12.1, 15.6, 14.2, 18.3],
            deviationPayload: { max: 18.3 },
          },
          interpretation:
            `BKQuant includes an offline example report format for this analysis type.\n\n` +
            `If you want BKQuant to compute results from your own data (not just provide example tables/plots), tell me which analyses must be “calculator-grade” first, and what data format you will upload (CSV columns, number of factors, replications, missing value rules).`,
          deviationKeys: ["max"],
        });
    }
  }

  function ensureProfessorFab() {
    const existing = $("#bkqProfessorFab");
    if (existing) return;
    const fab = document.createElement("button");
    fab.id = "bkqProfessorFab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Ask BKQuant Professor");
    fab.innerHTML = `<span style="font-weight:950">?</span><span style="font-weight:900;margin-left:8px">Professor</span>`;
    fab.style.position = "fixed";
    fab.style.right = "18px";
    fab.style.bottom = "18px";
    fab.style.zIndex = "1000";
    fab.style.display = "inline-flex";
    fab.style.alignItems = "center";
    fab.style.gap = "6px";
    fab.style.padding = "12px 14px";
    fab.style.borderRadius = "999px";
    fab.style.border = "1px solid #064e3b";
    fab.style.background = "#064e3b";
    fab.style.color = "#f8fafc";
    fab.style.boxShadow = "0 4px 18px rgba(6, 78, 59, 0.28)";
    fab.style.cursor = "pointer";
    fab.style.transition = "background 0.2s ease, box-shadow 0.2s ease";
    fab.addEventListener("mouseenter", () => {
      fab.style.background = "#059669";
      fab.style.boxShadow = "0 6px 22px rgba(5, 150, 105, 0.4)";
    });
    fab.addEventListener("mouseleave", () => {
      fab.style.background = "#064e3b";
      fab.style.boxShadow = "0 4px 18px rgba(6, 78, 59, 0.28)";
    });
    fab.addEventListener("click", showProfessorModal);
    document.body.appendChild(fab);
  }

  function bindLogin() {
    const form = $("#loginForm");
    const loginCard = $("#loginCard");
    const appCard = $("#appCard");
    const homeChartsCard = $("#homeChartsCard");

    let v2ShellWired = false;
    function wireV2ShellOnce() {
      if (v2ShellWired) return;
      v2ShellWired = true;
      $("#v2DashBtn")?.addEventListener("click", () => showV2Dashboard());
      $("#v2ModuleSearch")?.addEventListener("input", (e) => {
        const q = (e.target.value || "").trim().toLowerCase();
        $$("#sidebar .tile").forEach((t) => {
          const title = (t.querySelector(".title")?.textContent || "").toLowerCase();
          t.style.display = !q || title.includes(q) ? "" : "none";
        });
      });
      $("#v2NewProjectBtn")?.addEventListener("click", () => {
        saveCurrentProject(CURRENT_MODULE_ID || "crd");
      });
    }

    function setAuthed(yes) {
      if (yes) {
        localStorage.setItem(STORAGE_KEY, "1");
        document.body.classList.add("bkq-app-mode");
        loginCard.classList.add("hidden");
        appCard.classList.remove("hidden");
        homeChartsCard?.classList.add("hidden");
        const uname = ($("#username")?.value || "").trim();
        const welcome = $("#v2WelcomeLine");
        if (welcome) {
          welcome.textContent = uname
            ? `Welcome back, ${uname}. Select a module to begin analysis.`
            : "Welcome — select a module to begin analysis.";
        }
        // default show data analysis
        setActiveNav("data-analysis");
        setSidebar(GROUPS["data-analysis"]);
        showV2Dashboard();
        wireV2ShellOnce();
        ensureProfessorFab();
      } else {
        localStorage.removeItem(STORAGE_KEY);
        document.body.classList.remove("bkq-app-mode");
        loginCard.classList.remove("hidden");
        appCard.classList.add("hidden");
        homeChartsCard?.classList.remove("hidden");
      }
    }

    // Offline demo: any credentials
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      setAuthed(true);
    });

    $("#logoutBtn").addEventListener("click", () => setAuthed(false));
    $("#metaBtn")?.addEventListener("click", showReportMetaModal);

    $$(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.group;
        CURRENT_MODULE_ID = "";
        setActiveNav(g);
        setSidebar(GROUPS[g]);
        showV2Dashboard();
      });
    });

    // Start route if already authed
    if (localStorage.getItem(STORAGE_KEY) === "1") setAuthed(true);
  }

  // -----------------------------
  // Hybrid offline / online (service worker + connectivity UI)
  // -----------------------------
  function initConnectivityUi() {
    const sync = () => {
      const online = navigator.onLine;
      const label = online ? "Online" : "Offline";
      const cls = online ? "bkq-conn-badge--online" : "bkq-conn-badge--offline";
      $$("[data-bkq-conn]").forEach((el) => {
        el.textContent = label;
        el.classList.remove("bkq-conn-badge--online", "bkq-conn-badge--offline");
        el.classList.add(cls);
        el.title = online
          ? "Connected — updates and CDN fetches work when needed"
          : "Offline — BKQuant uses cached files when available (visit once online to cache CDN scripts)";
      });
      const hint = $("#bkqOfflineHint");
      if (hint) hint.classList.toggle("bkq-offline-hint-hidden", online);
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
  }

  function registerBkqServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const swUrl = new URL("sw.js", window.location.href).href;
    const scope = new URL("./", window.location.href).href;
    navigator.serviceWorker.register(swUrl, { scope }).catch(() => {
      /* file:// or blocked — hybrid UI still works when online */
    });
  }

  // -----------------------------
  // Init
  // -----------------------------
  function init() {
    registerBkqServiceWorker();
    initConnectivityUi();
    bindLogin();
  }

  window.addEventListener("load", init);
})();
