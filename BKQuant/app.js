/* BKQuant (offline) single-page dashboard.
   - Login gate (localStorage)
   - "Windows icon" style tiles
   - Each analysis renders: input (where simple), results table, chart(s), interpretation
   - Export to DOC/XLS using HTML + embedded chart images (no external libs, offline-friendly)
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

  function canvasToDataUrl(canvas) {
    try {
      return canvas.toDataURL("image/png");
    } catch {
      return "";
    }
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

  function loadReportMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function exportHtmlAsDocOrXls({ title, moduleId = "", tablesSelector = "table.data", interpretSelector = ".export-interpretation", filename, asExcel }) {
    const tables = $$(tablesSelector);
    const interpretation = document.querySelector(interpretSelector)?.innerText || "";
    const meta = loadReportMeta() || {};

    const charts = $$("#contentBody canvas");
    const chartImgs = charts
      .map((c) => {
        const src = canvasToDataUrl(c);
        if (!src) return "";
        return `<div class="export-chart"><img alt="chart" src="${src}" style="max-width:100%;height:auto;" /></div>`;
      })
      .join("");

    const svgs = $$('#contentBody svg[data-exportable="1"]');
    const svgImgs = svgs
      .map((s) => {
        const src = svgToDataUrl(s);
        if (!src) return "";
        return `<div class="export-chart"><img alt="diagram" src="${src}" style="max-width:100%;height:auto;" /></div>`;
      })
      .join("");

    const tableHtml = tables
      .map((t) => t.outerHTML)
      .join("\n");

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

    // Word/Excel can open HTML with the right MIME type.
    const styles = asExcel
      ? `table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:12px}th,td{border:1px solid #999;padding:6px;text-align:center}h1{font-size:18px}`
      : `body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse}th,td{border:1px solid #aaa;padding:6px}h1{font-size:20px;margin-bottom:8px}`;

    const doc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${qs(title)}</title>
  <style>${styles}</style>
</head>
<body>
  <h1>${qs(title)}</h1>
  ${metaTable}
  <div>${svgImgs}${chartImgs}</div>
  ${tableHtml}
  <h2>Interpretation</h2>
  <p style="white-space:pre-wrap">${qs(interpretation)}</p>
  ${quotation}
</body>
</html>`;

    downloadBlob(filename, asExcel ? "application/vnd.ms-excel" : "application/msword", doc);
  }

  // -----------------------------
  // Minimal chart drawing helpers (colors tuned for light UI)
  // -----------------------------
  const CHART = {
    bg: "#f8fafc",
    ink: "#0f172a",
    inkMuted: "#475569",
    grid: "rgba(15, 23, 42, 0.1)",
    bar0: "#0d9488",
    bar1: "#2563eb",
    point: "#0d9488",
    pointStroke: "#0f766e",
    lineFit: "#c2410c",
    lineAlt: "#2563eb",
    accentAmber: "#d97706",
  };

  function setupCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
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

  function drawBarChart(canvas, labels, values, { title } = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 52;
    const padR = 18;
    const padT = title ? 32 : 22;
    const padB = 56;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const max = Math.max(1e-9, ...values);
    const min = 0;
    const grid = 5;
    const plotTop = padT;
    const plotBottom = padT + plotH;
    const scaleY = plotH / (max - min);
    const n = Math.max(1, values.length);
    const barSlot = plotW / n;
    const barW = Math.max(8, Math.min(48, barSlot - 10));

    ctx.fillStyle = CHART.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(15, 23, 42, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, plotTop + 0.5, plotW - 1, plotH - 1);

    if (title) {
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 15px Segoe UI, system-ui, sans-serif";
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
      ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatChartTick(val), padL - 8, y);
    }

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
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

      const grad = ctx.createLinearGradient(0, y, 0, plotBottom);
      grad.addColorStop(0, CHART.bar0);
      grad.addColorStop(1, CHART.bar1);
      ctx.fillStyle = grad;
      ctx.strokeStyle = "rgba(15, 23, 42, 0.22)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, barW, bh, 8);
      ctx.fill();
      ctx.stroke();

      if (bh > 16) {
        ctx.fillStyle = "#fff";
        ctx.font = "700 11px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(formatChartTick(v), cx, y - 4);
      }

      const lbl = String(labels[i] ?? "");
      ctx.fillStyle = CHART.inkMuted;
      ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.save();
      ctx.translate(cx, plotBottom + 10);
      ctx.rotate(-Math.PI / 7);
      ctx.fillText(lbl.length > 12 ? lbl.slice(0, 11) + "…" : lbl, 0, 0);
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
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 54;
    const padR = 22;
    const padT = title ? 34 : 24;
    const padB = 44;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
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

    if (title) {
      ctx.fillStyle = CHART.ink;
      ctx.font = "700 15px Segoe UI, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, padL, 8);
    }

    ctx.strokeStyle = "rgba(15, 23, 42, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft + 0.5, plotTop + 0.5, plotW - 1, plotH - 1);

    const grid = 5;
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
      ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
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
      ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(formatChartTick(val), x, plotBottom + 6);
    }

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.moveTo(plotLeft, plotTop);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.stroke();

    points.forEach((p) => {
      const px = gx(p.x);
      const py = gy(p.y);
      ctx.fillStyle = CHART.point;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = CHART.pointStroke;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, 5.2, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.fillStyle = CHART.inkMuted;
    ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
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

  /** Matches drawScatterPlot layout so overlays (regression line, labels) align. */
  function scatterPlotGeo(w, h, withTitle) {
    const padL = 54;
    const padR = 22;
    const padT = withTitle ? 34 : 24;
    const padB = 44;
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

  function computeBreedingSummaryStats({ meanValue, msGenotype, msError, replications, selectionIntensity = 2.06 }) {
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
    const cd5 = 2.06 * sed; // approx 5% level
    const cv = (Math.sqrt(msError) / meanSafe) * 100;

    return { cv, cd5, sem, sed, h2, ga, gaPct, pcv, gcv, ecv, sigmaG, sigmaE, sigmaP };
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

  // One-way CRD ANOVA (equal reps): treatments x replicates
  function crdAnova(treatments, reps) {
    const t = treatments.length;
    const r = reps;
    const N = t * r;
    const all = treatments.flat();
    const grandTotal = all.reduce((a, b) => a + b, 0);
    const CF = grandTotal * grandTotal / N;

    let ssTotal = 0;
    for (const y of all) ssTotal += y * y;
    ssTotal = ssTotal - CF;

    const treatmentTotals = treatments.map((arr) => arr.reduce((a, b) => a + b, 0));
    let ssTreat = 0;
    for (const Ti of treatmentTotals) ssTreat += (Ti * Ti) / r;
    ssTreat = ssTreat - CF;

    const ssError = ssTotal - ssTreat;
    const dfTreat = t - 1;
    const dfError = N - t;
    const msTreat = ssTreat / dfTreat;
    const msError = ssError / dfError;
    const fStat = msError === 0 ? 0 : msTreat / msError;
    const sig = approxFSignificance(fStat, dfTreat, dfError);

    const means = treatments.map((arr, i) => ({ treatment: `T${i + 1}`, mean: mean(arr), total: treatmentTotals[i] }));
    return { ssTotal, ssTreat, ssError, dfTreat, dfError, msTreat, msError, fStat, sig, means };
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

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
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

  // -----------------------------
  // UI components
  // -----------------------------
  function setSidebar(items) {
    const sidebar = $("#sidebar");
    sidebar.innerHTML = "";

    const head = document.createElement("div");
    head.className = "sidebar-head";
    head.innerHTML = `
      <div>
        <div style="font-weight:950;font-size:13px;margin-bottom:2px">Modules</div>
        <div class="muted small" id="sidebarSubtitle">Choose an analysis</div>
      </div>
      <span class="pill"><span class="dot ok"></span>Offline</span>
    `;
    sidebar.appendChild(head);

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
            <h3>Report metadata (included in DOC/XLS downloads)</h3>
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
    downloadBlob(`bkquant_projects_${new Date().toISOString().slice(0, 10)}.json`, blob, "application/json");
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

    const tables = Array.from(root.querySelectorAll("table.data"));
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
      <div class="actions" style="margin-top:12px">
        <button class="action-btn primary2" type="button" data-export="full">Export Full Report</button>
        <button class="action-btn primary2" type="button" data-export="doc">Download DOC</button>
        <button class="action-btn primary2" type="button" data-export="xls">Download XLS</button>
        <button class="action-btn" type="button" data-export="print">Print</button>
        <button class="action-btn" type="button" data-project="save">Save project</button>
        <button class="action-btn" type="button" data-project="load">Load project</button>
        <button class="action-btn" type="button" data-project="manage">Manage projects</button>
        <button class="action-btn" type="button" data-project="export">Export projects JSON</button>
        <button class="action-btn" type="button" data-project="import">Import projects JSON</button>
        <button class="action-btn" type="button" data-run="selected">Run selected analyses</button>
        <button class="action-btn" type="button" data-run="force">${FORCE_RUN_MODE ? "Force run: ON" : "Force run: OFF"}</button>
        <button class="action-btn" type="button" data-run="strict">${STRICT_MODE ? "Strict mode: ON" : "Strict mode: OFF"}</button>
      </div>
    `;

    const exportInterpretationEl = `<div class="export-interpretation" style="margin-top:12px"></div>`;

    $("#contentBody").innerHTML = `
      <div class="section">
        ${bodyHtml}
        ${exportRow}
        <input type="file" id="projectsImportFile" accept=".json,application/json" style="display:none" />
        ${exportInterpretationEl}
        <div class="utility-panel-host" style="margin-top:12px"></div>
      </div>
    `;

    CURRENT_MODULE_ID = moduleId;
    // bind exports
    $$("#contentBody [data-export]").forEach((b) => {
      b.addEventListener("click", () => {
        const type = b.dataset.export;
        const tableTitle = title;
        applyStandardTableCaptions("#contentBody");
        if (type === "print") {
          window.print();
          return;
        }
        const interpret = $("#contentBody .export-interpretation")?.innerText || "";
        // Export uses current page state.
        if (type === "full") {
          exportHtmlAsDocOrXls({
            title: tableTitle,
            moduleId,
            filename: `${tableTitle.replace(/\s+/g, "_")}_Full_Report.doc`,
            asExcel: false,
          });
          exportHtmlAsDocOrXls({
            title: tableTitle,
            moduleId,
            filename: `${tableTitle.replace(/\s+/g, "_")}_Full_Report.xls`,
            asExcel: true,
          });
        } else if (type === "doc") {
          exportHtmlAsDocOrXls({
            title: tableTitle,
            moduleId,
            filename: `${tableTitle.replace(/\s+/g, "_")}.doc`,
            asExcel: false,
          });
        } else if (type === "xls") {
          exportHtmlAsDocOrXls({
            title: tableTitle,
            moduleId,
            filename: `${tableTitle.replace(/\s+/g, "_")}.xls`,
            asExcel: true,
          });
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
    applyStandardTableCaptions("#contentBody");

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
      subtitle: "Input treatment values → ANOVA table, treatment means plot, and interpretation.",
    });

    const defaultT = 4;
    const defaultR = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">One-way CRD</div></div>
        <div class="kpi"><div class="label">Assumption</div><div class="value">Equal replication</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">ANOVA + CD-ready means</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="muted small" style="margin-bottom:8px">Enter values by treatment (T1..T${defaultT}) and replicate (R1..R${defaultR}).</div>
            <div class="input-grid" id="crdControls">
              <div class="two-col">
                <label>
                  Treatments (T)
                  <input type="number" min="2" id="crdT" value="${defaultT}" />
                </label>
                <label>
                  Replicates (R)
                  <input type="number" min="2" id="crdR" value="${defaultR}" />
                </label>
              </div>
              <button class="action-btn primary2" type="button" id="crdBuild">Build grid</button>
              <div class="note" style="margin:0">
                Tip: You can edit numbers directly after building.
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

    $("#crdCompute").addEventListener("click", () => {
      const t = Math.max(2, Number($("#crdT").value || defaultT));
      const r = Math.max(2, Number($("#crdR").value || defaultR));
      clearValidation("#crdGridWrap");
      const errors = [];

      const matrix = [];
      for (let i = 0; i < t; i++) {
        const row = [];
        for (let j = 0; j < r; j++) {
          const input = document.querySelector(`#crdGridWrap input[data-cell="t${i}r${j}"]`);
          const v = Number(input?.value ?? NaN);
          if (!Number.isFinite(v)) {
            errors.push(`CRD: invalid numeric value at T${i + 1}, R${j + 1}`);
            markInvalidInput(input, "Enter a valid numeric value");
          }
          row.push(Number.isFinite(v) ? v : 0);
        }
        matrix.push(row);
      }
      if (shouldBlockForValidation("crd", errors, "#crdResultTop")) return;

      const out = crdAnova(matrix, r);
      const crdResiduals = [];
      for (let i = 0; i < t; i++) for (let j = 0; j < r; j++) crdResiduals.push(matrix[i][j] - out.means[i].mean);
      const crdDiag = residualSummary(crdResiduals);
      const crdOut = outlierFlags(matrix.flat());

      // Results summary text
      $("#crdResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (Treat)</div><div class="value">${out.fStat.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">df(Treat), df(Error)</div><div class="value">${out.dfTreat}, ${out.dfError}</div></div>
          <div class="kpi"><div class="label">Approx. significance</div><div class="value">${qs(out.sig.level)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${out.msError.toFixed(4)}</div></div><div class="kpi"><div class="label">Residual RMSE</div><div class="value">${crdDiag.rmse.toFixed(4)}</div></div>
        </div>
      `;

      // Bar chart of means
      const labels = out.means.map((m) => m.treatment);
      const values = out.means.map((m) => m.mean);
      drawBarChart($("#crdBar"), labels, values, { title: "Treatment means" });
      drawResidualMiniPlot($("#crdResidualPlot"), crdResiduals, "CRD residuals");

      const overallMeanCRD = mean(out.means.map((m) => m.mean));
      const statsCRD = computeBreedingSummaryStats({
        meanValue: overallMeanCRD,
        msGenotype: out.msTreat,
        msError: out.msError,
        replications: r,
      });
      const summaryCRD = buildTable(
        ["Summary metric", "Value"],
        [
          ["Grand mean", overallMeanCRD],
          ["CV (%)", statsCRD.cv],
          ["CD (5%)", statsCRD.cd5],
          ["SEm", statsCRD.sem],
          ["SEd", statsCRD.sed],
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

      // ANOVA table (full: SS, df, MS, F, approximate significance)
      const headers = ["Source", "SS", "df", "MS", "F", "Sig. (approx.)"];
      const anovaRows = [
        ["Treatments", out.ssTreat, out.dfTreat, out.msTreat, out.fStat, out.sig.note],
        ["Error", out.ssError, out.dfError, out.msError, "", ""],
        ["Total", out.ssTotal, out.dfTreat + out.dfError, "", "", ""],
      ];
      const qItemsCRD = [
        { check: "Valid numeric inputs", pass: errors.length === 0, note: errors.length ? "Some values were invalid." : "All numeric cells valid." },
        { check: "Outlier load (IQR)", pass: crdOut.count <= Math.max(1, Math.floor(matrix.flat().length * 0.1)), note: `${crdOut.count} flagged observation(s).` },
        { check: "Residual spread", pass: Number.isFinite(crdDiag.rmse) && crdDiag.rmse < Math.max(1e-9, Math.abs(mean(matrix.flat())) * 0.5), note: `RMSE=${crdDiag.rmse.toFixed(4)}` },
      ];
      if (strictModeShouldBlock("crd", qItemsCRD, "#crdResultTop")) return;
      $("#crdTableWrap").innerHTML = `${qualityScoreHtml(qItemsCRD)}<div style="height:10px"></div><h4>Table 1. ANOVA summary</h4>${buildTable(headers, anovaRows)}<div style="height:10px"></div><h4>Table 2. Mean and genetic summary (CV, CD, SEm, SEd, H2, GA)</h4>${summaryCRD}<div style="height:10px"></div><h4>Table 3. PCV/GCV/ECV matrix</h4>${matrixCRD}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 4. Assumption checklist", [
        { assumption: "Random allocation to treatments", status: "Required", note: "Prevents systematic treatment bias." },
        { assumption: "Independent residuals", status: "Assumed", note: "Serial/spatial trends affect precision." },
        { assumption: "Variance homogeneity", status: "Assumed", note: "Large spread differences alter F reliability." },
        { assumption: "Residual normality", status: "Assumed", note: "Important for strict parametric inference." }
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
        `ANOVA in CRD tests whether treatment means differ beyond experimental error.\n` +
        `Computed: F = ${out.fStat.toFixed(4)} with df(Treat)=${out.dfTreat}, df(Error)=${out.dfError}.\n` +
        `Approx. significance: ${out.sig.note}.\n\n` +
        `If treatments are significant, the highest mean indicates the best-performing treatment under your dataset.\n` +
        `Top means: ${best.treatment} (mean=${best.mean.toFixed(3)})` +
        (runnerUp ? `, followed by ${runnerUp.treatment} (mean=${runnerUp.mean.toFixed(3)}).` : ".") +
        `\n\n` +
        `Genetic summary: H2=${statsCRD.h2.toFixed(2)}%, GA=${statsCRD.ga.toFixed(3)}, PCV=${statsCRD.pcv.toFixed(2)}%, GCV=${statsCRD.gcv.toFixed(2)}%, ECV=${statsCRD.ecv.toFixed(2)}%.\n\n` +
        `Note: This offline BKQuant demo uses an approximate significance rule (no full t/F distribution table). For formal reporting, use standard CRD F-tables or statistical software.`;

      setInterpretation(
        "crd",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fStat: out.fStat, msError: out.msError, ssTreat: out.ssTreat, ssError: out.ssError }
      );
      setRunMeta("crd", { forceRun: isForceRunEnabled(), inputSize: `t=${t}, r=${r}`, standardization: "none", preprocessing: "No truncation; raw CRD cell values used.", qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsCRD.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });
  }

  // --- RBD ---
  function renderRBD() {
    const title = "RBD (Randomized Block Design) - ANOVA";
    showContentHeader({
      title,
      subtitle: "Input treatments across blocks → ANOVA table, means plot, and interpretation.",
    });

    const defaultT = 4;
    const defaultB = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">One-way RBD</div></div>
        <div class="kpi"><div class="label">Blocking</div><div class="value">Field/environment gradient control</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">Treatments + Blocks ANOVA</div></div>
      </div>

      <div style="height:12px"></div>

      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input grid</h4>
            <div class="muted small" style="margin-bottom:8px">Enter values by treatment (T1..T${defaultT}) and block (B1..B${defaultB}).</div>
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
      const rbdResiduals = [];
      for (let i = 0; i < t; i++) for (let j = 0; j < b; j++) rbdResiduals.push(matrix[i][j] - out.means[i].mean);
      const rbdDiag = residualSummary(rbdResiduals);
      const rbdOut = outlierFlags(matrix.flat());

      $("#rbdResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(6, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (Treat)</div><div class="value">${out.fTreat.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">df(Treat), df(Block)</div><div class="value">${out.dfTreat}, ${out.dfBlock}</div></div>
          <div class="kpi"><div class="label">df(Error)</div><div class="value">${out.dfError}</div></div>
          <div class="kpi"><div class="label">Approx. significance</div><div class="value">${qs(out.sig.level)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${out.msError.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Residual RMSE</div><div class="value">${rbdDiag.rmse.toFixed(4)}</div></div>
        </div>
      `;

      const labels = out.means.map((m) => m.treatment);
      const values = out.means.map((m) => m.mean);
      drawBarChart($("#rbdBar"), labels, values, { title: "Treatment means (over blocks)" });
      drawResidualMiniPlot($("#rbdResidualPlot"), rbdResiduals, "RBD residuals");

      const headers = ["Source", "SS", "df", "MS", "F", "Sig. (approx.)"];
      const anovaRows = [
        ["Treatments", out.ssTreat, out.dfTreat, out.msTreat, out.fTreat, out.sig.note],
        ["Blocks", out.ssBlock, out.dfBlock, out.msBlock, out.fBlock, out.sigBlock.note],
        ["Error", out.ssError, out.dfError, out.msError, "", ""],
        ["Total", out.ssTotal, out.dfTreat + out.dfBlock + out.dfError, "", "", ""],
      ];
      const overallMeanRBD = mean(out.means.map((m) => m.mean));
      const statsRBD = computeBreedingSummaryStats({
        meanValue: overallMeanRBD,
        msGenotype: out.msTreat,
        msError: out.msError,
        replications: b,
      });
      const summaryRBD = buildTable(
        ["Summary metric", "Value"],
        [
          ["Grand mean", overallMeanRBD],
          ["CV (%)", statsRBD.cv],
          ["CD (5%)", statsRBD.cd5],
          ["SEm", statsRBD.sem],
          ["SEd", statsRBD.sed],
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
      $("#rbdTableWrap").innerHTML = `${qualityScoreHtml(qItemsRBD)}<div style="height:10px"></div><h4>Table 1. ANOVA summary</h4>${buildTable(headers, anovaRows)}<div style="height:10px"></div><h4>Table 2. Mean and genetic summary (CV, CD, SEm, SEd, H2, GA)</h4>${summaryRBD}<div style="height:10px"></div><h4>Table 3. PCV/GCV/ECV matrix</h4>${matrixRBD}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 4. Assumption checklist", [
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
        `ANOVA in RBD partitions variability into treatments, blocks, and error.\n` +
        `Computed: F(treatments) = ${out.fTreat.toFixed(4)} with df(T)=${out.dfTreat}, df(Error)=${out.dfError}.\n` +
        `Approx. significance: ${out.sig.note}.\n\n` +
        `If block effects exist, it usually appears as smaller error MS and more reliable treatment testing.\n` +
        `Highest mean: ${best.treatment} (mean=${best.mean.toFixed(3)})` +
        (runnerUp ? `, second: ${runnerUp.treatment} (mean=${runnerUp.mean.toFixed(3)}).` : ".") +
        `\n\n` +
        `Genetic summary: H2=${statsRBD.h2.toFixed(2)}%, GA=${statsRBD.ga.toFixed(3)}, PCV=${statsRBD.pcv.toFixed(2)}%, GCV=${statsRBD.gcv.toFixed(2)}%, ECV=${statsRBD.ecv.toFixed(2)}%.\n\n` +
        `BKQuant note: significance uses approximate thresholds for offline demo purposes. Use official F tables/software for exact p-values.`;

      setInterpretation(
        "rbd",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fTreat: out.fTreat, msError: out.msError, ssTreat: out.ssTreat, ssBlock: out.ssBlock }
      );
      setRunMeta("rbd", { forceRun: isForceRunEnabled(), inputSize: `t=${t}, b=${b}`, standardization: "none", preprocessing: "No truncation; balanced matrix interpreted directly.", qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsRBD.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });
  }

  // --- Factorial RBD (A×B in blocks) ---
  function renderFactorial() {
    const title = "Factorial RBD (Two-way A×B) - ANOVA";
    showContentHeader({
      title,
      subtitle: "Input Factor A × Factor B across blocks → ANOVA for A, B, A×B, block effects, means and plots.",
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

      const fA = msError === 0 ? 0 : msA / msError;
      const fB = msError === 0 ? 0 : msB / msError;
      const fAB = msError === 0 ? 0 : msAB / msError;

      const sigA = approxFSignificance(fA, dfA, dfError);
      const sigB = approxFSignificance(fB, dfB, dfError);
      const sigAB = approxFSignificance(fAB, dfAB, dfError);

      // Means for each combination
      const comboMeans = [];
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < b; j++) {
          const meanComb = T_ij[i][j] / r;
          comboMeans.push({ label: `A${i + 1}B${j + 1}`, mean: meanComb });
        }
      }

      $("#factResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (A)</div><div class="value">${fA.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F (B)</div><div class="value">${fB.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F (A×B)</div><div class="value">${fAB.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${msError.toFixed(4)}</div></div>
        </div>
      `;

      const labels = comboMeans.map((m) => m.label);
      const values = comboMeans.map((m) => m.mean);
      drawBarChart($("#factBar"), labels, values, { title: "Combination means (A×B over blocks)" });

      const headers = ["Source", "SS", "df", "MS", "F", "Approx. Sig."];
      const rows = [
        ["Factor A", ssA, dfA, msA, fA, sigA.level],
        ["Factor B", ssB, dfB, msB, fB, sigB.level],
        ["A×B", ssAB, dfAB, msAB, fAB, sigAB.level],
        ["Blocks", ssBlock, dfBlock, msBlock, msBlock / msError || "", ""],
        ["Error", ssError, dfError, msError, "", ""],
        ["Total", ssTotal, dfTotal, "", "", ""],
      ];
      const overallMeanFact = mean(comboMeans.map((m) => m.mean));
      const statsFact = computeBreedingSummaryStats({
        meanValue: overallMeanFact,
        msGenotype: msAB + msA + msB, // combined signal proxy for factorial treatment variability
        msError: msError,
        replications: r,
      });
      const summaryFact = buildTable(
        ["Summary metric", "Value"],
        [
          ["Grand mean", overallMeanFact],
          ["CV (%)", statsFact.cv],
          ["CD (5%)", statsFact.cd5],
          ["SEm", statsFact.sem],
          ["SEd", statsFact.sed],
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
      $("#factTableWrap").innerHTML = `<h4>Table 1. ANOVA summary</h4>${buildTable(headers, rows)}<div style="height:10px"></div><h4>Table 2. Mean and genetic summary (CV, CD, SEm, SEd, H2, GA)</h4>${summaryFact}<div style="height:10px"></div><h4>Table 3. PCV/GCV/ECV matrix</h4>${matrixFact}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 4. Assumption checklist", [
        { assumption: "Balanced factorial cells", status: "Required", note: "Each A×B level should have similar replication." },
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
        `Factorial ANOVA in RBD partitions variability into main effects (A, B), interaction (A×B), blocks, and error.\n` +
        `Computed F-values:\n` +
        `• F(A) = ${fA.toFixed(4)} (${sigA.note})\n` +
        `• F(B) = ${fB.toFixed(4)} (${sigB.note})\n` +
        `• F(A×B) = ${fAB.toFixed(4)} (${sigAB.note})\n\n` +
        `If A×B is significant, the ranking of A or B levels changes across the other factor (cross-over interaction).\n` +
        `In your data, the highest mean combination is ${best.label} (mean=${best.mean.toFixed(3)}).\n\n` +
        `Genetic summary: H2=${statsFact.h2.toFixed(2)}%, GA=${statsFact.ga.toFixed(3)}, PCV=${statsFact.pcv.toFixed(2)}%, GCV=${statsFact.gcv.toFixed(2)}%, ECV=${statsFact.ecv.toFixed(2)}%.\n\n` +
        `BKQuant note: significance uses approximate thresholds for offline use. For formal reports, consult official F tables or full statistical software.`;

      setInterpretation(
        "factorial",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fA, fB, fAB, msError }
      );
    });
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
    const title = "Augmented Design - Adjusted Means (Checks + New Entries)";
    showContentHeader({
      title,
      subtitle: "Compute adjusted means for new entries using check-based block adjustment, with exportable tables and plot.",
    });

    const defaultChecks = 3;
    const defaultBlocks = 4;
    const defaultNew = 6;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design type</div><div class="value">Augmented (checks replicated)</div></div>
        <div class="kpi"><div class="label">Purpose</div><div class="value">Many new genotypes with limited replication</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">Adjusted means + check ANOVA</div></div>
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
                BKQuant adjustment: block effect is estimated from check means in each block.
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

      // Check means per block and overall
      const blockCheckMeans = [];
      for (let j = 0; j < b; j++) {
        let s = 0;
        for (let i = 0; i < c; i++) s += checks[i][j];
        blockCheckMeans[j] = s / c;
      }
      const grandCheckMean = mean(blockCheckMeans); // mean of block means == overall checks mean
      const blockEffects = blockCheckMeans.map((m) => m - grandCheckMean);

      // Check ANOVA (RBD on checks only) to estimate error MS
      const checkOut = rbdAnova(checks, b, c);

      // Read new entries
      const newEntries = [];
      for (let i = 0; i < n; i++) {
        const blk = Number(document.querySelector(`#augInputsWrap select[data-newblk="n${i}"]`)?.value || 1);
        const val = Number(document.querySelector(`#augInputsWrap input[data-newval="n${i}"]`)?.value ?? NaN);
        const obs = Number.isFinite(val) ? val : 0;
        const adj = obs - blockEffects[blk - 1];
        newEntries.push({ id: `N${i + 1}`, block: `B${blk}`, observed: obs, adjusted: adj });
      }

      // Include checks (use overall check means) as adjusted for reporting
      const checkAdj = [];
      for (let i = 0; i < c; i++) {
        const row = checks[i];
        checkAdj.push({ id: `C${i + 1}`, block: "All", observed: mean(row), adjusted: mean(row) }); // mean across blocks
      }

      const all = [...checkAdj.map((x) => ({ ...x, type: "Check" })), ...newEntries.map((x) => ({ ...x, type: "New" }))];
      const maxAdjusted = Math.max(...all.map((x) => x.adjusted));

      $("#augResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">Grand check mean</div><div class="value">${grandCheckMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Blocks (b)</div><div class="value">${b}</div></div>
          <div class="kpi"><div class="label">Check MS Error</div><div class="value">${checkOut.msError.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Max adjusted mean</div><div class="value">${maxAdjusted.toFixed(3)}</div></div>
        </div>
      `;

      // Plot adjusted means (top 10)
      const top = [...all].sort((a, b) => b.adjusted - a.adjusted).slice(0, Math.min(10, all.length));
      drawBarChart(
        $("#augBar"),
        top.map((x) => x.id),
        top.map((x) => x.adjusted),
        { title: "Top adjusted means (checks + new)" }
      );

      const headers1 = ["Genotype", "Type", "Block", "Observed", "Adjusted"];
      const rows1 = all.map((x) => [x.id, x.type, x.block, x.observed, x.adjusted]);
      const table1 = buildTable(headers1, rows1);

      const headers2 = ["Block", "Check mean", "Block effect (mean - grand)"];
      const rows2 = blockCheckMeans.map((m, j) => [`B${j + 1}`, m, blockEffects[j]]);
      const table2 = buildTable(headers2, rows2);

      const headers3 = ["Checks ANOVA Source", "SS", "df", "MS", "F"];
      const rows3 = [
        ["Treatments (checks)", checkOut.ssTreat, checkOut.dfTreat, checkOut.msTreat, checkOut.fTreat],
        ["Blocks", checkOut.ssBlock, checkOut.dfBlock, checkOut.msBlock, checkOut.msBlock / checkOut.msError || ""],
        ["Error", checkOut.ssError, checkOut.dfError, checkOut.msError, ""],
        ["Total", checkOut.ssTotal, checkOut.dfTreat + checkOut.dfBlock + checkOut.dfError, "", ""],
      ];
      const table3 = buildTable(headers3, rows3);

      $("#augTableWrap").innerHTML = `${table1}<div style="height:10px"></div>${table2}<div style="height:10px"></div>${table3}`;

      const deviationHtml = deviationBanner("augmented", { maxAdjusted }, ["maxAdjusted"]);
      const best = [...all].sort((a, b) => b.adjusted - a.adjusted)[0];
      const interpretation =
        `Augmented designs use replicated checks to estimate block effects, then adjust unreplicated new entries.\n\n` +
        `Adjustment used (BKQuant): adjusted = observed − (block check mean − grand check mean).\n` +
        `This removes systematic block differences estimated from checks.\n\n` +
        `Top adjusted genotype: ${best.id} (${best.type}) with adjusted mean ${best.adjusted.toFixed(3)}.\n\n` +
        `If results deviate from previous runs, it usually happens because block assignments or check values changed, altering block effects and adjustments.`;

      setInterpretation("augmented", interpretation, deviationHtml || "", { maxAdjusted, msError: checkOut.msError });
    });

    $("#augCompute").click();
  }

  // --- Split Plot Design (R blocks; A main plot; B subplot) ---
  function renderSplitPlot() {
    const title = "Split Plot Design - ANOVA";
    showContentHeader({
      title,
      subtitle: "Split-plot in RBD: A tested against Error(A)=Blocks×A; B and A×B tested against Error(B)=residual.",
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

    $("#spCompute").addEventListener("click", () => {
      const a = Math.max(2, Number($("#spA").value || defaultA));
      const b = Math.max(2, Number($("#spB").value || defaultB));
      const r = Math.max(2, Number($("#spR").value || defaultR));

      // y[i][j][k]
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

      // Totals
      const blockTotals = Array(r).fill(0); // Bk..
      const Atotals = Array(a).fill(0); // Ai..
      const Btotals = Array(b).fill(0); // .Bj.
      const ABtotals = Array.from({ length: a }, () => Array(b).fill(0)); // ABij.
      const AblockTotals = Array.from({ length: r }, () => Array(a).fill(0)); // Aik. (sum over B within block for each A)

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

      // SS blocks
      let ssBlock = 0;
      for (let k = 0; k < r; k++) ssBlock += (blockTotals[k] * blockTotals[k]) / (a * b);
      ssBlock -= CF;

      // SS A
      let ssA = 0;
      for (let i = 0; i < a; i++) ssA += (Atotals[i] * Atotals[i]) / (b * r);
      ssA -= CF;

      // SS Error(A) = blocks×A
      let ssAblock = 0;
      for (let k = 0; k < r; k++) for (let i = 0; i < a; i++) ssAblock += (AblockTotals[k][i] * AblockTotals[k][i]) / b;
      ssAblock = ssAblock - ssBlock - ssA - CF;
      // Explanation: ssAblock = Σ(Aik^2)/b − Σ(Bk^2)/(ab) − Σ(Ai^2)/(br) + CF
      // but we computed ssBlock and ssA already as (Σ.. − CF), so subtracting CF again yields correct algebra.
      // (keeps arithmetic stable and consistent with other modules)

      // SS B
      let ssB = 0;
      for (let j = 0; j < b; j++) ssB += (Btotals[j] * Btotals[j]) / (a * r);
      ssB -= CF;

      // SS AB
      let ssABall = 0;
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) ssABall += (ABtotals[i][j] * ABtotals[i][j]) / r;
      const ssTreat = ssABall - CF;
      const ssAB = ssTreat - ssA - ssB;

      // SS Error(B) = residual
      const ssErrorB = ssTotal - ssBlock - ssA - ssAblock - ssB - ssAB;

      const dfBlock = r - 1;
      const dfA = a - 1;
      const dfErrorA = (r - 1) * (a - 1);
      const dfB = b - 1;
      const dfAB = (a - 1) * (b - 1);
      const dfErrorB = a * (r - 1) * (b - 1);
      const dfTotal = N - 1;

      const msA = ssA / dfA;
      const msErrorA = ssAblock / dfErrorA;
      const msB = ssB / dfB;
      const msAB = ssAB / dfAB;
      const msErrorB = ssErrorB / dfErrorB;

      const fA = msErrorA === 0 ? 0 : msA / msErrorA;
      const fB = msErrorB === 0 ? 0 : msB / msErrorB;
      const fAB = msErrorB === 0 ? 0 : msAB / msErrorB;

      const sigA = approxFSignificance(fA, dfA, dfErrorA);
      const sigB = approxFSignificance(fB, dfB, dfErrorB);
      const sigAB = approxFSignificance(fAB, dfAB, dfErrorB);

      $("#spResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">F(A) vs Error(A)</div><div class="value">${fA.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F(B) vs Error(B)</div><div class="value">${fB.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F(A×B) vs Error(B)</div><div class="value">${fAB.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">MS Error(A)</div><div class="value">${msErrorA.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">MS Error(B)</div><div class="value">${msErrorB.toFixed(4)}</div></div>
        </div>
      `;

      // Plot AB means
      const comboMeans = [];
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) comboMeans.push({ label: `A${i + 1}B${j + 1}`, mean: ABtotals[i][j] / r });
      drawBarChart($("#spBar"), comboMeans.map((x) => x.label), comboMeans.map((x) => x.mean), { title: "A×B means (over blocks)" });

      const headers = ["Source", "SS", "df", "MS", "F", "Tested against"];
      const rows = [
        ["Blocks", ssBlock, dfBlock, ssBlock / dfBlock, "", ""],
        ["A (main plot)", ssA, dfA, msA, fA, "Error(A)"],
        ["Error(A) = Blocks×A", ssAblock, dfErrorA, msErrorA, "", ""],
        ["B (sub plot)", ssB, dfB, msB, fB, "Error(B)"],
        ["A×B", ssAB, dfAB, msAB, fAB, "Error(B)"],
        ["Error(B)", ssErrorB, dfErrorB, msErrorB, "", ""],
        ["Total", ssTotal, dfTotal, "", "", ""],
      ];
      $("#spTableWrap").innerHTML = buildTable(headers, rows);

      const deviationHtml = deviationBanner("splitplot", { fA, fB, fAB }, ["fA", "fB", "fAB"]);
      const best = [...comboMeans].sort((x, y) => y.mean - x.mean)[0];
      const interpretation =
        `Split-plot ANOVA uses two error terms: Error(A) for the main-plot factor A, and Error(B) for subplot factor B and A×B.\n\n` +
        `Computed (approx significance):\n` +
        `• A: F=${fA.toFixed(4)} (${sigA.note})\n` +
        `• B: F=${fB.toFixed(4)} (${sigB.note})\n` +
        `• A×B: F=${fAB.toFixed(4)} (${sigAB.note})\n\n` +
        `Best mean combination: ${best.label} (mean=${best.mean.toFixed(3)}).\n\n` +
        `If A×B is significant, interpret main effects cautiously and select based on specific combinations.`;

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
            <div class="actions" style="margin-top:12px">
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
            <div class="actions" style="margin-top:12px">
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

    $("#regCompute").click();
  }

  // --- PCA (2D demo) ---
  function renderPCA() {
    const title = "PCA (Principal Component Analysis) - 2 Trait Demo";
    showContentHeader({
      title,
      subtitle: "Offline PCA for two traits with explained variance + PC1/PC2 directions.",
    });

    const defaultN = 10;
    const bodyHtml = `
      <div class="two-col">
        <div>
          <div class="section" style="margin:0">
            <h4>Input data (two traits)</h4>
            <div class="muted small" style="margin-bottom:8px">Paste equal-length numbers for Trait 1 (X) and Trait 2 (Y).</div>
            <label>
              Trait 1 (X)
              <textarea id="pcaX">${Array.from({ length: defaultN }, (_, i) => (2 + i * 0.65 + (i % 4 === 0 ? 0.3 : -0.1)).toFixed(2)).join(", ")}</textarea>
            </label>
            <label>
              Trait 2 (Y)
              <textarea id="pcaY">${Array.from({ length: defaultN }, (_, i) => (1.2 + i * 0.92 + (i % 3 === 0 ? -0.15 : 0.25)).toFixed(2)).join(", ")}</textarea>
            </label>
            <label class="pill"><input type="checkbox" id="pcaStandardize" checked /> Standardize traits before PCA</label>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="pcaCompute">Compute PCA</button>
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div class="chart" style="height:260px;margin-top:12px">
              <canvas id="pcaScatter" style="width:100%;height:100%"></canvas>
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

    function drawPCDirections(canvas, xs, ys, pc1, pc2) {
      const pts = xs.map((x, i) => ({ x, y: ys[i] }));
      drawScatterPlot(canvas, pts, { title: "PCA scatter with PC directions", xLabel: "Trait 1", yLabel: "Trait 2" });
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = Math.max(1e-9, maxX - minX);
      const rangeY = Math.max(1e-9, maxY - minY);
      const cx = mean(xs);
      const cy = mean(ys);
      const center = projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, cx, cy);
      const arrowLenPx = 110;
      function toPx(dx, dy) {
        const endX = cx + dx;
        const endY = cy + dy;
        const end = projectScatterXY(w, h, true, minX, rangeX, minY, rangeY, endX, endY);
        const vx = end.px - center.px;
        const vy = end.py - center.py;
        const mag = Math.sqrt(vx * vx + vy * vy) || 1;
        const s = arrowLenPx / mag;
        return { x2: center.px + vx * s, y2: center.py + vy * s };
      }
      const end1 = toPx(pc1.x * 1.0, pc1.y * 1.0);
      const end2 = toPx(pc2.x * 1.0, pc2.y * 1.0);
      drawArrow(ctx, center.px, center.py, end1.x2, end1.y2, CHART.accentAmber);
      drawArrow(ctx, center.px, center.py, end2.x2, end2.y2, CHART.lineAlt);
      ctx.fillStyle = CHART.accentAmber;
      ctx.font = "800 12px Segoe UI, system-ui, sans-serif";
      ctx.fillText("PC1", end1.x2 + 6, end1.y2 - 6);
      ctx.fillStyle = CHART.lineAlt;
      ctx.font = "800 12px Segoe UI, system-ui, sans-serif";
      ctx.fillText("PC2", end2.x2 + 6, end2.y2 - 6);
    }

    function drawArrow(ctx, x1, y1, x2, y2, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // head
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }

    $("#pcaCompute").addEventListener("click", () => {
      clearValidation("#contentBody");
      const errors = [];
      const xs = parseGridNumbers($("#pcaX").value);
      const ys = parseGridNumbers($("#pcaY").value);
      const n = Math.min(xs.length, ys.length);
      if (xs.length !== ys.length) {
        errors.push(`PCA: Trait lengths differ (X=${xs.length}, Y=${ys.length}); first ${n} values will be used.`);
      }
      if (n < 3) {
        errors.push("PCA: provide at least 3 numeric observations per trait.");
        markInvalidInput($("#pcaX"), "Need at least 3 numeric values");
        markInvalidInput($("#pcaY"), "Need at least 3 numeric values");
      }
      if (shouldBlockForValidation("pca", errors, "#pcaTableWrap")) return;
      const x = xs.slice(0, n);
      const y = ys.slice(0, n);
      const std = !!$("#pcaStandardize")?.checked;
      const Zxy = std ? zScoreColumns(x.map((v, i) => [v, y[i]])).Z : null;
      const dataX = std ? Zxy.map((r) => r[0]) : x;
      const dataY = std ? Zxy.map((r) => r[1]) : y;

      const out = pca2D(dataX, dataY);
      drawPCDirections($("#pcaScatter"), dataX, dataY, out.vec1, out.vec2);
      const pcaOut = outlierFlags(dataX.concat(dataY));

      const headers = ["Component", "Eigenvalue", "Explained Variance (%)", "Direction (normalized)"];
      const rows = [
        ["PC1", out.l1, out.explained1, `(${out.vec1.x.toFixed(4)}, ${out.vec1.y.toFixed(4)})`],
        ["PC2", out.l2, out.explained2, `(${out.vec2.x.toFixed(4)}, ${out.vec2.y.toFixed(4)})`],
      ];
      const qItemsPCA = [
        { check: "Sample size adequacy", pass: n >= 5, note: `n=${n}` },
        { check: "Outlier load (IQR)", pass: pcaOut.count <= Math.max(1, Math.floor((dataX.length + dataY.length) * 0.1)), note: `${pcaOut.count} flagged value(s).` },
        { check: "PC1 information share", pass: out.explained1 >= 50, note: `PC1=${out.explained1.toFixed(2)}%` },
      ];
      if (strictModeShouldBlock("pca", qItemsPCA, "#pcaTableWrap")) return;
      $("#pcaTableWrap").innerHTML = `${qualityScoreHtml(qItemsPCA)}<div style="height:10px"></div>${buildTable(headers, rows)}<div style="height:10px"></div>${assumptionsChecklistHtml("Table 2. Assumption checklist", [
        { assumption: "Numeric traits on comparable scale", status: "Recommended", note: "Standardize before PCA when scales differ strongly." },
        { assumption: "Linear covariance structure", status: "Assumed", note: "PCA captures linear combinations of variation." },
        { assumption: "Adequate sample spread", status: "Required", note: "Very low variance in a trait can destabilize components." }
      ])}`;

      const deviationHtml = deviationBanner(
        "pca",
        { explained1: out.explained1 },
        ["explained1"]
      );

      const interpretation =
        `PCA converts correlated traits into orthogonal principal components.\n\n` +
        `Eigenvalues/variance:\n` +
        `• PC1 explains ${out.explained1.toFixed(2)}% of the variance.\n` +
        `• PC2 explains ${out.explained2.toFixed(2)}% of the remaining variance.\n\n` +
        `Direction (loadings style):\n` +
        `• PC1 direction ~ (${out.vec1.x.toFixed(3)}, ${out.vec1.y.toFixed(3)}): it indicates the dominant combined trend in Trait 1 (X) and Trait 2 (Y).\n` +
        `• PC2 is orthogonal and captures smaller residual variation.\n\n` +
        `In breeding context: if PC1 captures most variance, selections biased toward the PC1 trend tend to represent the main diversity pattern.`;

      setInterpretation(
        "pca",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { explained1: out.explained1, l1: out.l1, l2: out.l2 }
      );
      setRunMeta("pca", { forceRun: isForceRunEnabled(), inputSize: `n=${n}, p=2`, standardization: std ? "z-score" : "none", preprocessing: xs.length === ys.length ? "No truncation." : `Input lengths differed (X=${xs.length}, Y=${ys.length}); truncated to n=${n}.`, qualityScore: `${Math.max(0, Math.min(100, Math.round(mean(qItemsPCA.map((x) => x.pass ? 100 : 45)))))} / 100` });
    });

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

    function drawPathDiagram({ names, yName, pCoeffs, Rxx, rxy, residual }) {
      const svg = $("#pathSvg");
      svg.innerHTML = "";

      const W = 860;
      const H = 360;
      const leftX = 120;
      const rightX = 740;
      const top = 70;
      const spacing = pCoeffs.length > 1 ? Math.min(70, 220 / (pCoeffs.length - 1)) : 0;
      const xs = names.map((_, i) => ({ x: leftX, y: top + i * spacing }));
      const yNode = { x: rightX, y: 180 };

      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.insertAdjacentHTML(
        "beforeend",
        `<defs>
          <marker id="pArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="#d97706"></path>
          </marker>
          <marker id="gArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="#64748b"></path>
          </marker>
        </defs>`
      );

      // draw inter-correlations among X as light lines (only show if |r|>=0.2)
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const r = Rxx[i][j];
          if (Math.abs(r) < 0.2) continue;
          const a = xs[i];
          const b = xs[j];
          svg.insertAdjacentHTML(
            "beforeend",
            `<path d="M ${a.x + 40} ${a.y} L ${b.x + 40} ${b.y}" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#gArrow)"></path>
             <text x="${a.x + 55}" y="${(a.y + b.y) / 2 - 6}" fill="#475569" font-size="12" font-weight="800">r=${r.toFixed(2)}</text>`
          );
        }
      }

      // draw nodes
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

      // arrows from X -> Y with direct effects
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
          `<path d="M ${startX} ${startY} C ${startX + 110} ${startY}, ${endX - 120} ${endY}, ${endX} ${endY}" stroke="${col}" stroke-width="4" fill="none" marker-end="url(#pArrow)"></path>
           <text x="${midX}" y="${midY - 8}" fill="${col}" font-size="13" font-weight="950">p=${p.toFixed(3)}</text>
           <text x="${midX}" y="${midY + 10}" fill="#64748b" font-size="12" font-weight="800">r=${rxy[i].toFixed(2)}</text>`
        );
      });
    }

    $("#pathCompute").addEventListener("click", () => {
      const p = Math.max(2, Math.min(6, Number($("#pathP").value || defaultP)));
      const names = cleanNames(p);
      const yName = ($("#pathYname").value || "Y").trim() || "Y";

      const { Rxx, rxy, errors } = readCorrelationInputs(p);
      if (shouldBlockForValidation("path", errors, "#pathKpis")) return;
      const inv = invertMatrix(Rxx);
      if (!inv) {
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

      // Direct effects (standardized path coefficients): P = inv(Rxx) * rxy
      const P = matVecMul(inv, rxy);

      // Indirect effects: via j is r_ij * Pj
      const indirect = Array.from({ length: p }, () => Array(p).fill(0));
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          if (i === j) continue;
          indirect[i][j] = Rxx[i][j] * P[j];
        }
      }

      // Reproduced correlations and residual effect
      const reproduced = [];
      let sum_rp = 0;
      for (let i = 0; i < p; i++) {
        let rep = P[i]; // direct
        for (let j = 0; j < p; j++) if (i !== j) rep += Rxx[i][j] * P[j];
        reproduced.push(rep);
        sum_rp += rxy[i] * P[i];
      }
      const residual = Math.sqrt(clamp01(1 - sum_rp));

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

      drawPathDiagram({ names, yName, pCoeffs: P, Rxx, rxy, residual });

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

  // --- Line x Tester (calculator) ---
  function renderLineTester() {
    const title = "Line x Tester Design (Calculator)";
    showContentHeader({
      title,
      subtitle: "Compute Line, Tester, and Line×Tester effects (ANOVA style), with GCA/SCA tables and cross ranking.",
    });

    const defaultL = 3;
    const defaultT = 3;
    const defaultR = 3;

    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Design</div><div class="value">Line x Tester with replications</div></div>
        <div class="kpi"><div class="label">Effects</div><div class="value">GCA (Line/Tester) + SCA (Cross)</div></div>
        <div class="kpi"><div class="label">Outputs</div><div class="value">ANOVA + ranked crosses</div></div>
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
              <button class="action-btn primary2" type="button" id="ltBuild">Build grid</button>
              <div class="note" style="margin:0">
                Rows are crosses (L<sub>i</sub>xT<sub>j</sub>), columns are replications (R1..Rr).
              </div>
            </div>
            <div id="ltGridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="ltCompute">Compute Line x Tester</button>
              <button class="action-btn" type="button" id="ltImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="ltTemplateCsv">Download template CSV</button>
              <input type="file" id="ltCsvFile" accept=".csv,text/csv" style="display:none" />
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
      prevCompareKeys: ["fLine", "fTester", "fLT"],
    });

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

    $("#ltBuild").addEventListener("click", () => {
      const l = Math.max(2, Number($("#ltL").value || defaultL));
      const t = Math.max(2, Number($("#ltT").value || defaultT));
      const r = Math.max(2, Number($("#ltR").value || defaultR));
      buildGrid(l, t, r);
    });

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
      const txt = await f.text();
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

      const msLine = ssLine / dfLine;
      const msTester = ssTester / dfTester;
      const msLT = ssLT / dfLT;
      const msError = ssError / dfError;

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

      $("#ltKpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">F(Line)</div><div class="value">${fLine.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F(Tester)</div><div class="value">${fTester.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">F(LxT)</div><div class="value">${fLT.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${msError.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">Grand mean</div><div class="value">${grandMean.toFixed(3)}</div></div>
        </div>
      `;

      // Plot top cross means
      const rankedCross = [];
      for (let i = 0; i < l; i++) for (let j = 0; j < t; j++) rankedCross.push({ cross: `L${i + 1}xT${j + 1}`, mean: crossMeans[i][j], sca: sca[i][j] });
      rankedCross.sort((a, b) => b.mean - a.mean);
      const top = rankedCross.slice(0, Math.min(10, rankedCross.length));
      drawBarChart($("#ltBar"), top.map((x) => x.cross), top.map((x) => x.mean), { title: "Top cross means" });

      const anova = buildTable(
        ["Source", "SS", "df", "MS", "F", "Approx. Sig."],
        [
          ["Replications", ssRep, dfRep, ssRep / dfRep, "", ""],
          ["Lines", ssLine, dfLine, msLine, fLine, sigLine.level],
          ["Testers", ssTester, dfTester, msTester, fTester, sigTester.level],
          ["Line×Tester", ssLT, dfLT, msLT, fLT, sigLT.level],
          ["Error", ssError, dfError, msError, "", ""],
          ["Total", ssTotal, dfTotal, "", "", ""],
        ]
      );

      const gcaLineTable = buildTable(
        ["Line", "Line mean", "GCA effect"],
        lineMeans.map((m, i) => [`L${i + 1}`, m, gcaLine[i]])
      );
      const gcaTesterTable = buildTable(
        ["Tester", "Tester mean", "GCA effect"],
        testerMeans.map((m, j) => [`T${j + 1}`, m, gcaTester[j]])
      );

      const scaRows = [];
      for (let i = 0; i < l; i++) {
        for (let j = 0; j < t; j++) {
          scaRows.push([`L${i + 1}xT${j + 1}`, crossMeans[i][j], sca[i][j]]);
        }
      }
      scaRows.sort((a, b) => b[1] - a[1]);
      const scaTable = buildTable(["Cross", "Cross mean", "SCA effect"], scaRows);

      $("#ltTables").innerHTML = `${anova}<div style="height:10px"></div>${gcaLineTable}<div style="height:10px"></div>${gcaTesterTable}<div style="height:10px"></div>${scaTable}`;

      const deviationHtml = deviationBanner("linetester", { fLine, fTester, fLT }, ["fLine", "fTester", "fLT"]);
      const best = rankedCross[0];
      const interpretation =
        `Line x Tester analysis partitions variability into line (GCA-lines), tester (GCA-testers), and line×tester (SCA) components.\n\n` +
        `F tests (approx):\n` +
        `• Lines: F=${fLine.toFixed(4)} (${sigLine.note})\n` +
        `• Testers: F=${fTester.toFixed(4)} (${sigTester.note})\n` +
        `• Line×Tester: F=${fLT.toFixed(4)} (${sigLT.note})\n\n` +
        `Best cross by mean: ${best.cross} (mean=${best.mean.toFixed(3)}, SCA=${best.sca.toFixed(3)}).\n` +
        `High positive GCA suggests additive gene effects; high positive SCA suggests non-additive effects for specific crosses.`;

      setInterpretation("linetester", interpretation, deviationHtml || "", { fLine, fTester, fLT, bestMean: best.mean });
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
              <button class="action-btn" type="button" id="dgImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="dgTemplateCsv">Download template CSV</button>
              <input type="file" id="dgCsvFile" accept=".csv,text/csv" style="display:none" />
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
      const txt = await f.text();
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
            <h4>Diallel matrix input</h4>
            <div class="input-grid">
              <label>
                Number of parents (p)
                <input type="number" min="3" max="10" id="da1N" value="${defaultN}" />
              </label>
              <label>
                Genetic model assumption
                <select id="da1Model">
                  <option value="fixed-with-reciprocal">Fixed + reciprocal included</option>
                  <option value="fixed-no-reciprocal">Fixed + no reciprocal term</option>
                  <option value="random-with-reciprocal">Random + reciprocal included</option>
                  <option value="random-no-reciprocal">Random + no reciprocal term</option>
                </select>
              </label>
              <button class="action-btn primary2" type="button" id="da1Build">Build matrix</button>
              <div class="note" style="margin:0">
                Enter means for all cells (including diagonal parents and reciprocal entries if available).
              </div>
            </div>
            <div id="da1GridWrap" class="matrix" style="margin-top:12px"></div>
            <div class="actions" style="margin-top:12px">
              <button class="action-btn primary2" type="button" id="da1Compute">Compute DA I</button>
              <button class="action-btn" type="button" id="da1ImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="da1TemplateCsv">Download template CSV</button>
              <input type="file" id="da1CsvFile" accept=".csv,text/csv" style="display:none" />
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

    function buildMatrix(p) {
      const wrap = $("#da1GridWrap");
      wrap.innerHTML = "";
      const table = document.createElement("table");
      table.className = "data";
      const headers = ["Parent", ...Array.from({ length: p }, (_, j) => `P${j + 1}`)];
      table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${qs(h)}</th>`).join("")}</tr></thead>`;
      const rows = [];
      for (let i = 0; i < p; i++) {
        const cells = [];
        for (let j = 0; j < p; j++) {
          // diagonal parent + off-diagonal crosses
          const parentBase = 22 + i * 1.9;
          const crossBoost = i === j ? 0 : 3.2 + ((i + j) % 3) * 0.8;
          const reciprocity = i !== j ? (i > j ? 0.4 : -0.2) : 0;
          const val = parentBase + (j * 1.1) + crossBoost + reciprocity;
          cells.push(`<td><input type="number" step="0.01" value="${val.toFixed(2)}" data-da1="i${i}j${j}" /></td>`);
        }
        rows.push(`<tr><th>P${i + 1}</th>${cells.join("")}</tr>`);
      }
      table.insertAdjacentHTML("beforeend", `<tbody>${rows.join("")}</tbody>`);
      wrap.appendChild(table);
    }

    buildMatrix(defaultN);

    $("#da1Build").addEventListener("click", () => {
      const p = Math.max(3, Math.min(10, Number($("#da1N").value || defaultN)));
      buildMatrix(p);
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
      const txt = await f.text();
      const mat = parseNumericCsvMatrix(txt);
      if (!mat.length) return;
      const p = Math.max(3, Math.min(10, mat.length));
      $("#da1N").value = String(p);
      buildMatrix(p);
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
      const M = Array.from({ length: p }, () => Array(p).fill(0));
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          const input = document.querySelector(`#da1GridWrap input[data-da1="i${i}j${j}"]`);
          const v = Number(input?.value ?? NaN);
          M[i][j] = Number.isFinite(v) ? v : 0;
        }
      }

      // Means and effects
      const allVals = M.flat();
      const grandMean = mean(allVals);
      const rowMeans = M.map((row) => mean(row));
      const colMeans = Array.from({ length: p }, (_, j) => mean(M.map((row) => row[j])));

      // DA I numerical summary:
      // GCA_i approximated from average combining performance vs grand mean
      const gca = rowMeans.map((rm, i) => ((rm + colMeans[i]) / 2) - grandMean);

      // SCA_ij approximated as observed cross mean minus expectation from GCA
      // expected_ij = grandMean + gca_i + gca_j
      const scaRows = [];
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          if (i === j) continue;
          const expected = grandMean + gca[i] + gca[j];
          const sca = M[i][j] - expected;
          scaRows.push([`P${i + 1}xP${j + 1}`, M[i][j], expected, sca]);
        }
      }

      // Reciprocal deviation
      let recCount = 0;
      let recAbsSum = 0;
      for (let i = 0; i < p; i++) {
        for (let j = i + 1; j < p; j++) {
          recAbsSum += Math.abs(M[i][j] - M[j][i]);
          recCount += 1;
        }
      }
      const reciprocalMeanDiff = recCount ? recAbsSum / recCount : 0;

      // crude ANOVA-like partition on matrix cells (educational)
      let ssTotal = 0;
      for (const v of allVals) ssTotal += (v - grandMean) * (v - grandMean);
      let ssRows = 0;
      for (const rm of rowMeans) ssRows += p * (rm - grandMean) * (rm - grandMean);
      let ssCols = 0;
      for (const cm of colMeans) ssCols += p * (cm - grandMean) * (cm - grandMean);
      const ssResidual = Math.max(0, ssTotal - ssRows - ssCols);
      const dfRows = p - 1;
      const dfCols = p - 1;
      const dfResidual = (p - 1) * (p - 1);
      const msRows = ssRows / Math.max(1, dfRows);
      const msCols = ssCols / Math.max(1, dfCols);
      const msResidual = ssResidual / Math.max(1, dfResidual);
      const fRows = msResidual === 0 ? 0 : msRows / msResidual;
      const fCols = msResidual === 0 ? 0 : msCols / msResidual;

      // ranking by off-diagonal cross means
      const crossOnly = [];
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) crossOnly.push({ cross: `P${i + 1}xP${j + 1}`, mean: M[i][j] });
      crossOnly.sort((a, b) => b.mean - a.mean);
      const bestCross = crossOnly[0];

      $("#da1Kpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Grand mean</div><div class="value">${grandMean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Best cross</div><div class="value">${qs(bestCross.cross)}</div></div>
          <div class="kpi"><div class="label">Best mean</div><div class="value">${bestCross.mean.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Reciprocal avg |diff|</div><div class="value">${reciprocalMeanDiff.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Parents</div><div class="value">${p}</div></div>
        </div>
      `;

      // chart top crosses
      const top = crossOnly.slice(0, Math.min(10, crossOnly.length));
      drawBarChart($("#da1Bar"), top.map((x) => x.cross), top.map((x) => x.mean), { title: "Top cross means (DA I)" });

      const tAnova = buildTable(
        ["Source", "SS", "df", "MS", "F"],
        [
          ["Rows (parent-wise)", ssRows, dfRows, msRows, fRows],
          ["Columns (parent-wise)", ssCols, dfCols, msCols, fCols],
          ["Residual", ssResidual, dfResidual, msResidual, ""],
          ["Total", ssTotal, p * p - 1, "", ""],
        ]
      );

      const tGca = buildTable(
        ["Parent", "Array mean", "Reciprocal-array mean", "General combining ability (GCA)"],
        Array.from({ length: p }, (_, i) => [`P${i + 1}`, rowMeans[i], colMeans[i], gca[i]])
      );

      scaRows.sort((a, b) => b[3] - a[3]);
      const tSca = buildTable(
        ["Cross", "Observed mean", "Expected mean (GCA model)", "Specific combining ability (SCA)"],
        scaRows.slice(0, Math.min(20, scaRows.length))
      );

      const msGCAproxy = (msRows + msCols) / 2;
      const msSCAproxy = msResidual;
      const modelKey = String($("#da1Model")?.value || "fixed-with-reciprocal");
      const gp = computeDiallelGeneticParams(msGCAproxy, msSCAproxy, modelKey);
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

      $("#da1Tables").innerHTML = `${tAnova}<div style="height:10px"></div>${tGca}<div style="height:10px"></div>${tSca}<div style="height:10px"></div>${tGen}`;

      const deviationHtml = deviationBanner("diallel-da1", { grandMean, bestCross: bestCross.mean }, ["grandMean", "bestCross"]);
      const interpretation =
        `DA I numerical summary identifies parent combining patterns and superior cross combinations from the diallel matrix.\n\n` +
        `Computed highlights:\n` +
        `• Grand mean = ${grandMean.toFixed(3)}\n` +
        `• Best cross = ${bestCross.cross} (mean=${bestCross.mean.toFixed(3)})\n` +
        `• Reciprocal average absolute difference = ${reciprocalMeanDiff.toFixed(3)}\n\n` +
        `Interpretation:\n` +
        `• Positive GCA indicates stronger average combining contribution by that parent.\n` +
        `• Positive SCA for a cross indicates cross performance above additive expectation.\n` +
        `• Larger reciprocal differences suggest maternal/reciprocal effects may be relevant.\n\n` +
        `Genetic parameter proxies:\n` +
        `• Model = ${gp.modelLabel}\n` +
        `• sigma^2GCA=${gp.sigmaGCA.toFixed(4)}, sigma^2SCA=${gp.sigmaSCA.toFixed(4)}, ratio=${gp.ratio.toFixed(4)}\n` +
        `• Average degree of dominance=${gp.degree.toFixed(4)} (${gp.geneAction})\n\n` +
        `Note: These are DA I proxy estimates for practical interpretation in BKQuant; exact inferential formulas depend on strict diallel model assumptions.`;

      setInterpretation("diallel-da1", interpretation, deviationHtml || "", { grandMean, bestCross: bestCross.mean, degree: gp.degree, model: gp.modelLabel });
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
      subtitle: "Choose NC I/II/III sub-section. Each sub-section provides numeric summaries, charts, and interpretation.",
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
      prevCompareKeys: ["key"],
    });

    const tabs = $$("#ncTabs [data-nc]");
    function activate(tab) {
      tabs.forEach((b) => b.classList.toggle("primary2", b.dataset.nc === tab));
      tabs.forEach((b) => b.classList.toggle("action-btn", true));
    }

    function renderNCI() {
      activate("NCI");
      $("#ncBody").innerHTML = `
        <div class="kpi-row">
          <div class="kpi"><div class="label">Design</div><div class="value">NC I</div></div>
          <div class="kpi"><div class="label">Structure</div><div class="value">Nested males within females</div></div>
          <div class="kpi"><div class="label">Focus</div><div class="value">Among-family variance</div></div>
        </div>
        <div class="chart" style="height:260px;margin-top:12px"><canvas id="ncChart1" style="width:100%;height:100%"></canvas></div>
        <div id="ncTable1" style="margin-top:12px"></div>
      `;

      const labels = ["F1", "F2", "F3", "F4", "F5"];
      const values = [18.4, 21.1, 19.8, 23.5, 22.2];
      drawBarChart($("#ncChart1"), labels, values, { title: "NC I family means" });

      const table = buildTable(
        ["Source", "SS", "df", "MS", "Interpretation"],
        [
          ["Females", 112.6, 4, 28.15, "Female groups differ"],
          ["Males within females", 138.7, 10, 13.87, "Nested male variance present"],
          ["Error", 95.5, 20, 4.78, "Residual"],
        ]
      );
      $("#ncTable1").innerHTML = table;

      const interpretation =
        `NC I evaluates nested family structure (males within females).\n` +
        `Use it to estimate among-female and within-female components and identify promising female families.\n` +
        `Higher between-family MS indicates stronger exploitable genetic variation at that hierarchy level.`;
      setInterpretation("nc", interpretation, "", { key: values[3] });
    }

    function renderNCII() {
      activate("NCII");
      $("#ncBody").innerHTML = `
        <div class="kpi-row">
          <div class="kpi"><div class="label">Design</div><div class="value">NC II</div></div>
          <div class="kpi"><div class="label">Structure</div><div class="value">Factorial male x female</div></div>
          <div class="kpi"><div class="label">Focus</div><div class="value">GCA (male/female) and SCA</div></div>
        </div>
        <div class="chart" style="height:260px;margin-top:12px"><canvas id="ncChart2" style="width:100%;height:100%"></canvas></div>
        <div id="ncTable2" style="margin-top:12px"></div>
      `;

      const labels = ["M1xF1", "M1xF2", "M2xF1", "M2xF2", "M3xF1", "M3xF2"];
      const values = [25.1, 24.0, 27.4, 26.2, 23.8, 28.3];
      drawBarChart($("#ncChart2"), labels, values, { title: "NC II cross means" });

      const table = buildTable(
        ["Source", "SS", "df", "MS", "F (vs error)"],
        [
          ["Males", 96.2, 2, 48.10, 6.20],
          ["Females", 81.5, 1, 81.50, 10.50],
          ["Male x Female", 74.8, 2, 37.40, 4.82],
          ["Error", 108.0, 14, 7.71, ""],
        ]
      );
      $("#ncTable2").innerHTML = table;

      const interpretation =
        `NC II partitions male and female main effects (GCA proxies) and male×female interaction (SCA proxy).\n` +
        `Large male/female effects suggest additive contributions, while strong male×female interaction suggests non-additive effects.`;
      setInterpretation("nc", interpretation, "", { key: values[5] });
    }

    function renderNCIII() {
      activate("NCIII");
      $("#ncBody").innerHTML = `
        <div class="kpi-row">
          <div class="kpi"><div class="label">Design</div><div class="value">NC III</div></div>
          <div class="kpi"><div class="label">Structure</div><div class="value">Backcross/testcross based contrasts</div></div>
          <div class="kpi"><div class="label">Focus</div><div class="value">Additive vs dominance inference</div></div>
        </div>
        <div class="chart" style="height:260px;margin-top:12px"><canvas id="ncChart3" style="width:100%;height:100%"></canvas></div>
        <div id="ncTable3" style="margin-top:12px"></div>
      `;

      const labels = ["L1", "L2", "L3", "L4", "L5", "L6"];
      const values = [4.1, 3.5, 5.2, 2.9, 4.8, 3.2]; // example contrast magnitudes
      drawBarChart($("#ncChart3"), labels, values, { title: "NC III line contrast magnitudes" });

      const table = buildTable(
        ["Component", "Estimate", "Interpretation"],
        [
          ["Additive component (A proxy)", 2.84, "Substantial additive influence"],
          ["Dominance component (D proxy)", 1.71, "Moderate dominance influence"],
          ["Degree of dominance sqrt(D/A)", 0.776, "Partial dominance tendency"],
        ]
      );
      $("#ncTable3").innerHTML = table;

      const interpretation =
        `NC III is useful for separating additive and dominance tendencies using contrast structures.\n` +
        `If dominance degree is below 1, partial dominance is indicated; above 1 suggests over-dominance tendency.\n` +
        `Use alongside diallel and line×tester evidence for robust breeding decisions.`;
      setInterpretation("nc", interpretation, "", { key: values[2] });
    }

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.nc;
        if (t === "NCI") renderNCI();
        if (t === "NCII") renderNCII();
        if (t === "NCIII") renderNCIII();
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
              <button class="action-btn" type="button" id="metImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="metTemplateCsv">Download template CSV</button>
              <input type="file" id="metCsvFile" accept=".csv,text/csv" style="display:none" />
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
      const txt = await f.text();
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
              <button class="action-btn" type="button" id="ammiImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="ammiTemplateCsv">Download template CSV</button>
              <input type="file" id="ammiCsvFile" accept=".csv,text/csv" style="display:none" />
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
      const txt = await f.text();
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
              <button class="action-btn" type="button" id="dfaImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="dfaTemplateCsv">Download template CSV</button>
              <input type="file" id="dfaCsvFile" accept=".csv,text/csv" style="display:none" />
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
      const txt = await f.text();
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
              <button class="action-btn" type="button" id="faImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="faTemplateCsv">Download template CSV</button>
              <input type="file" id="faCsvFile" accept=".csv,text/csv" style="display:none" />
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
      const txt = await f.text();
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

  // --- D2 Analysis with multiple clustering methods ---
  function renderD2Analysis() {
    const title = "D2 Analysis and Cluster Diagrams";
    showContentHeader({
      title,
      subtitle: "Multiple clustering methods (K-means, UPGMA, Tocher, Ward), consensus dendrogram, and heterosis outputs.",
    });

    const defaultN = 10;
    const defaultT = 4;
    const bodyHtml = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Clustering methods</div><div class="value">K-means, UPGMA, Tocher, Ward</div></div>
        <div class="kpi"><div class="label">Combined output</div><div class="value">Consensus dendrogram</div></div>
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
              <button class="action-btn" type="button" id="d2ImportCsv">Import CSV</button>
              <button class="action-btn" type="button" id="d2TemplateCsv">Download template CSV</button>
              <input type="file" id="d2CsvFile" accept=".csv,text/csv" style="display:none" />
            </div>
          </div>
        </div>
        <div>
          <div class="section" style="margin:0">
            <h4>Results</h4>
            <div id="d2Kpis"></div>
            <div class="chart" style="height:260px;margin-top:12px"><canvas id="d2ClusterChart" style="width:100%;height:100%"></canvas></div>
            <div class="chart" style="height:300px;margin-top:12px"><canvas id="d2DendroChart" style="width:100%;height:100%"></canvas></div>
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
        rows.push(`<tr><th>G${i + 1}</th>${cells.join("")}</tr>`);
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
      for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) {
        const v = Number(document.querySelector(`#d2Wrap input[data-d2="g${i}t${j}"]`)?.value ?? 0);
        X[i][j] = Number.isFinite(v) ? v : 0;
      }
      return { n, p, X };
    }

    function sqDist(a, b) {
      let s = 0;
      for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        s += d * d;
      }
      return s;
    }

    function distanceMatrix(X) {
      const n = X.length;
      const D = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = Math.sqrt(sqDist(X[i], X[j]));
        D[i][j] = d; D[j][i] = d;
      }
      return D;
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

    function drawSimpleScatterClusters(canvas, X, labels, pointSize) {
      // use first two traits as axes
      const points = X.map((r, i) => ({ x: r[0], y: r[1] ?? 0, c: labels[i], name: `G${i + 1}` }));
      drawScatterPlot(canvas, points, { title: "Cluster scatter (Trait1 vs Trait2)", xLabel: "Trait1", yLabel: "Trait2" });
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const rx = Math.max(1e-9, maxX - minX), ry = Math.max(1e-9, maxY - minY);
      const colors = ["#0d9488", "#d97706", "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#0891b2"];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const p of points) {
        const pt = projectScatterXY(w, h, true, minX, rx, minY, ry, p.x, p.y);
        ctx.fillStyle = colors[p.c % colors.length];
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, pointSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawDendrogram(canvas, linkage, n, lineW = 2, cutPct = 60) {
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const xPos = {};
      const yPos = {};
      const padL = 24, padR = 16, padT = 16, padB = 24;
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
      // cut line
      const yCut = h - padB - (Math.max(5, Math.min(95, cutPct)) / 100) * (h - padT - padB);
      ctx.strokeStyle = "rgba(255,92,122,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, yCut); ctx.lineTo(w - padR, yCut); ctx.stroke();
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
    $("#d2Build").addEventListener("click", () => {
      const n = Math.max(5, Math.min(40, Number($("#d2N").value || defaultN)));
      const p = Math.max(2, Math.min(10, Number($("#d2T").value || defaultT)));
      build(n, p);
    });

    $("#d2TemplateCsv").addEventListener("click", () => {
      const n = Math.max(5, Math.min(40, Number($("#d2N").value || defaultN)));
      const p = Math.max(2, Math.min(10, Number($("#d2T").value || defaultT)));
      const rows = [Array.from({ length: p }, (_, j) => `Trait${j + 1}`)];
      for (let i = 0; i < n; i++) rows.push(Array.from({ length: p }, (_, j) => (10 + i * 0.8 + j * 1.1).toFixed(2)));
      triggerCsvDownload("d2_trait_matrix_template.csv", rows);
    });
    $("#d2ImportCsv").addEventListener("click", () => $("#d2CsvFile").click());
    $("#d2CsvFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const txt = await f.text();
      const mat = parseNumericCsvMatrix(txt);
      if (!mat.length) return;
      const n = Math.max(5, Math.min(40, mat.length));
      const p = Math.max(2, Math.min(10, Math.min(...mat.map((r) => r.length))));
      $("#d2N").value = String(n);
      $("#d2T").value = String(p);
      build(n, p);
      for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) {
        const v = mat[i]?.[j];
        if (!Number.isFinite(v)) continue;
        const input = document.querySelector(`#d2Wrap input[data-d2="g${i}t${j}"]`);
        if (input) input.value = String(v);
      }
      $("#d2Compute").click();
      e.target.value = "";
    });

    $("#d2Compute").addEventListener("click", () => {
      const { n, X } = readData();
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
      const std = !!$("#d2Standardize")?.checked;
      const Xuse = std ? zScoreColumns(X).Z : X;
      const k = Math.max(2, Math.min(12, Number($("#d2K").value || 3)));
      const useK = $("#d2mK").checked;
      const useU = $("#d2mU").checked;
      const useT = $("#d2mT").checked;
      const useW = $("#d2mW").checked;
      const methods = [];
      const labelSets = [];

      const D = distanceMatrix(Xuse);

      if (useK) {
        const lab = kmeans(Xuse, Math.min(k, n));
        methods.push("K-means");
        labelSets.push(lab);
      }
      if (useU) {
        const link = upgmaLinkage(D);
        const lab = labelsFromLinkage(link, n, Math.min(k, n));
        methods.push("UPGMA");
        labelSets.push(lab);
      }
      if (useT) {
        const lab = tocher(D);
        methods.push("Tocher");
        labelSets.push(lab);
      }
      if (useW) {
        const link = wardLinkage(Xuse);
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

      drawSimpleScatterClusters($("#d2ClusterChart"), Xuse, consLab, pointSize);
      drawDendrogram($("#d2DendroChart"), cons.link, n, lineW, cut);

      // cluster metrics from consensus labels
      const clusters = {};
      for (let i = 0; i < n; i++) {
        const c = consLab[i];
        if (!clusters[c]) clusters[c] = [];
        clusters[c].push(i);
      }
      const cKeys = Object.keys(clusters).map(Number).sort((a, b) => a - b);
      function avgIntra(idxs) {
        let s = 0, c = 0;
        for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
          s += D[idxs[i]][idxs[j]];
          c++;
        }
        return c ? s / c : 0;
      }
      let bestInter = 0;
      for (let a = 0; a < cKeys.length; a++) for (let b = a + 1; b < cKeys.length; b++) {
        let s = 0, c = 0;
        for (const i of clusters[cKeys[a]]) for (const j of clusters[cKeys[b]]) { s += D[i][j]; c++; }
        const m = c ? s / c : 0;
        if (m > bestInter) bestInter = m;
      }
      const intraRows = cKeys.map((c) => [`Cluster ${c + 1}`, clusters[c].map((i) => `G${i + 1}`).join(", "), avgIntra(clusters[c]), clusters[c].length]);

      const het = heterosisRows();
      const mphMean = het.length ? mean(het.map((r) => r[4])) : 0;
      const bphMean = het.length ? mean(het.map((r) => r[5])) : 0;

      $("#d2Kpis").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">Methods combined</div><div class="value">${methods.join(", ")}</div></div>
          <div class="kpi"><div class="label">Consensus clusters</div><div class="value">${cKeys.length}</div></div>
          <div class="kpi"><div class="label">Max inter-cluster D</div><div class="value">${bestInter.toFixed(3)}</div></div>
          <div class="kpi"><div class="label">Mean MP heterosis</div><div class="value">${mphMean.toFixed(2)}%</div></div>
          <div class="kpi"><div class="label">Mean BP heterosis</div><div class="value">${bphMean.toFixed(2)}%</div></div>
        </div>
      `;

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
        ["Trait", "Contribution sum (D2 basis)", "Contribution (%)"],
        contribRows
      );

      const tCons = buildTable(
        ["Consensus cluster", "Members", "Intra-cluster D (avg)", "Size"],
        intraRows
      );
      const tHet = buildTable(
        ["Cross", "P1", "P2", "F1", "Mid-parent heterosis (%)", "Better-parent heterosis (%)"],
        het
      );
      const qItemsD2 = [
        { check: "Methods selected", pass: methods.length >= 2, note: `${methods.length} method(s)` },
        { check: "Cluster separability", pass: bestInter > 0.5, note: `max inter=${bestInter.toFixed(3)}` },
        { check: "Cluster count adequacy", pass: cKeys.length >= 2, note: `${cKeys.length} consensus cluster(s)` },
      ];
      if (strictModeShouldBlock("d2", qItemsD2, "#d2Kpis")) return;

      $("#d2Tables").innerHTML =
        `${qualityScoreHtml(qItemsD2)}<div style="height:10px"></div><h4>Table 1. Method-wise cluster counts</h4>${tMethod}` +
        `<div style="height:10px"></div><h4>Table 2. Consensus clustering summary</h4>${tCons}` +
        `<div style="height:10px"></div><h4>Table 3. Cluster means by traits</h4>${tClusterMeans}` +
        `<div style="height:10px"></div><h4>Table 4. Trait-wise percentage contribution to D2</h4>${tContrib}` +
        `<div style="height:10px"></div><h4>Table 5. Heterosis values</h4>${tHet}` +
        `<div style="height:10px"></div>${assumptionsChecklistHtml("Table 6. Assumption checklist", [
          { assumption: "Trait scaling compatibility", status: "Recommended", note: "Standardize traits when units differ strongly." },
          { assumption: "Euclidean distance relevance", status: "Assumed", note: "Alternative metrics may be suitable for specific datasets." },
          { assumption: "Method agreement", status: "Recommended", note: "Consensus clustering improves robustness over single-method solutions." }
        ])}`;

      const consensusSpread = cKeys.length;
      const deviationHtml = deviationBanner("d2", { bestInterCluster: bestInter, consensusSpread }, ["bestInterCluster", "consensusSpread"]);
      const interpretation =
        `D2 analysis with multiple clustering methods provides robust grouping by comparing method-specific partitions and a combined consensus pattern.\n\n` +
        `Combined methods: ${methods.join(", ")}.\n` +
        `Consensus clusters: ${cKeys.length}, max inter-cluster distance=${bestInter.toFixed(3)}.\n` +
        `Top D2-contributing trait: ${String(contribRows[0]?.[0] || "Trait1")} (${Number(contribRows[0]?.[2] || 0).toFixed(2)}%).\n\n` +
        `Heterosis summary: mean MPH=${mphMean.toFixed(2)}%, mean BPH=${bphMean.toFixed(2)}%.\n` +
        `Large inter-cluster distances and positive heterosis in selected inter-cluster crosses support divergence-based hybrid selection.`;
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
          <div class="kpi"><div class="label">Export</div><div class="value">DOC + XLS</div></div>
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

  // -----------------------------
  // Module registry
  // -----------------------------
  const GROUPS = {
    "data-analysis": [
      { id: "crd", title: "CRD (ANOVA)", icon: "⬚" },
      { id: "rbd", title: "RBD (ANOVA)", icon: "▤" },
      { id: "factorial", title: "Factorial RBD", icon: "⊞" },
      { id: "lattice", title: "Lattice Square", icon: "▦" },
      { id: "augmented", title: "Augmented Design", icon: "≡" },
      { id: "splitplot", title: "Split Plot Design", icon: "▩" },
    ],
    "plant-breeding": [
      { id: "correlation", title: "Correlation", icon: "ρ" },
      { id: "regression", title: "Regression", icon: "→" },
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
    ],
  };

  function computeButtonForModule(moduleId) {
    const map = {
      crd: "crdCompute",
      rbd: "rbdCompute",
      factorial: "factCompute",
      lattice: "latCompute",
      augmented: "augCompute",
      splitplot: "spCompute",
      correlation: "corCompute",
      regression: "regCompute",
      pca: "pcaCompute",
      path: "pathCompute",
      discriminant: "dfaCompute",
      factoranalysis: "faCompute",
      d2: "d2Compute",
      metroglyph: "metgCompute",
      linetester: "ltCompute",
      diallel: "diallelCompute",
      nc: "ncCompute",
      triple: "ttcCompute",
      genmean: "gmCompute",
      met: "metCompute",
      ammi: "ammiCompute",
    };
    return map[moduleId] || "";
  }

  async function runSelectedAnalysesReport(ids) {
    if (!ids || !ids.length) return;
    const sections = [];
    for (const id of ids) {
      openModule(id);
      await new Promise((r) => setTimeout(r, 0));
      const computeId = computeButtonForModule(id);
      if (computeId) document.getElementById(computeId)?.click();
      if (CURRENT_BATCH_PRESET) {
        const prev = LAST_RUN_META[id] || {};
        setRunMeta(id, { ...prev, batchPreset: CURRENT_BATCH_PRESET });
      }
      await new Promise((r) => setTimeout(r, 0));
      const html = document.querySelector("#contentBody .section")?.innerHTML || "";
      sections.push(`<h2>${qs(id.toUpperCase())}</h2>${html}`);
    }
    const title = "BKQuant_Batch_Report";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title></head><body>${sections.join("<hr/>")}</body></html>`;
    downloadBlob(`${title}.doc`, html, "application/msword");
    downloadBlob(`${title}.xls`, html, "application/vnd.ms-excel");
  }

  function showRunSelectorPanel() {
    const all = Object.values(GROUPS).flat();
    const presetCoreTrials = ["crd", "rbd", "factorial", "lattice", "augmented", "splitplot", "met", "ammi"];
    const presetBreedingCore = ["correlation", "regression", "path", "d2", "linetester", "diallel", "nc", "triple", "genmean", "pca"];
    const checked = new Set(["rbd", "factorial", "met", "d2"]);
    const html = `
      <div class="section" style="margin-top:8px;border:1px solid rgba(255,255,255,0.14)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
          <h4 style="margin:0">Run selected analyses</h4>
          <button class="action-btn" type="button" data-utility="close">Close</button>
        </div>
        <div class="muted small" style="margin-top:6px">Select modules to auto-run and combine in one DOC/XLS package.</div>
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
    if (id === "crd") return renderCRD();
    if (id === "rbd") return renderRBD();
    if (id === "factorial") return renderFactorial();
    if (id === "lattice") return renderLatinSquare();
    if (id === "augmented") return renderAugmented();
    if (id === "splitplot") return renderSplitPlot();
    if (id === "correlation") return renderCorrelation();
    if (id === "regression") return renderRegression();
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

    function setAuthed(yes) {
      if (yes) {
        localStorage.setItem(STORAGE_KEY, "1");
        loginCard.classList.add("hidden");
        appCard.classList.remove("hidden");
        // default show data analysis
        setActiveNav("data-analysis");
        setSidebar(GROUPS["data-analysis"]);
        $("#contentHeader").innerHTML = `<h3>Select a module</h3><p class="muted">Use the left tiles to open full tables, plots, and interpretation.</p>`;
        $("#contentBody").innerHTML = `<div class="note">Choose a module from the left.</div>`;
        ensureProfessorFab();
      } else {
        localStorage.removeItem(STORAGE_KEY);
        loginCard.classList.remove("hidden");
        appCard.classList.add("hidden");
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
        setActiveNav(g);
        setSidebar(GROUPS[g]);
        $("#contentHeader").innerHTML = `<h3>Choose an analysis</h3><p class="muted">Open a module tile to view tables, plots, interpretation, and exports.</p>`;
        $("#contentBody").innerHTML = `<div class="note">Select a module from the left.</div>`;
      });
    });

    // Start route if already authed
    if (localStorage.getItem(STORAGE_KEY) === "1") setAuthed(true);
  }

  // -----------------------------
  // Init
  // -----------------------------
  function init() {
    bindLogin();
  }

  window.addEventListener("load", init);
})();
