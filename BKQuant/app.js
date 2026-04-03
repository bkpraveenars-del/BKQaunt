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

  function exportHtmlAsDocOrXls({ title, tablesSelector = "table.data", interpretSelector = ".export-interpretation", filename, asExcel }) {
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
      ["Analysis", title],
      ["Researcher", meta.researcher || ""],
      ["Institution", meta.institution || ""],
      ["Crop", meta.crop || ""],
      ["Trait(s)", meta.traits || ""],
      ["Season/Year", meta.season || ""],
      ["Location", meta.location || ""],
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
  // Minimal chart drawing helpers
  // -----------------------------
  function setupCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(280, Math.floor(rect.width));
    const h = Math.max(180, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawBarChart(canvas, labels, values, { title } = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pad = 34;
    const grid = 5;
    const max = Math.max(1e-9, ...values);
    const min = 0;
    const scale = (h - pad * 1.5) / (max - min);
    const barW = (w - pad * 1.2) / Math.max(1, values.length);

    // background
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, w, h);

    // title
    if (title) {
      ctx.fillStyle = "rgba(234,241,255,0.95)";
      ctx.font = "700 12px Segoe UI, Arial";
      ctx.fillText(title, pad, 16);
    }

    // grid lines
    for (let i = 0; i <= grid; i++) {
      const y = pad + (h - pad * 1.5) - i * ((h - pad * 1.5) / grid);
      ctx.strokeStyle = "rgba(234,241,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - 14, y);
      ctx.stroke();
    }

    // bars
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const x = pad + i * barW + 6;
      const bh = (v - min) * scale;
      const y = pad + (h - pad * 1.5) - bh;

      const grad = ctx.createLinearGradient(0, y, 0, y + bh);
      grad.addColorStop(0, "rgba(82,255,202,0.95)");
      grad.addColorStop(1, "rgba(122,162,255,0.95)");
      ctx.fillStyle = grad;
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, barW - 12, bh, 10);
      ctx.fill();
      ctx.stroke();

      // x labels (rotated)
      const lbl = String(labels[i] ?? "");
      ctx.fillStyle = "rgba(234,241,255,0.75)";
      ctx.font = "700 10px Segoe UI, Arial";
      ctx.save();
      ctx.translate(x + (barW - 12) / 2, h - 10);
      ctx.rotate(-Math.PI / 6);
      ctx.textAlign = "right";
      ctx.fillText(lbl, 0, 0);
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
    const pad = 42;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = Math.max(1e-9, maxX - minX);
    const rangeY = Math.max(1e-9, maxY - minY);

    // title
    if (title) {
      ctx.fillStyle = "rgba(234,241,255,0.95)";
      ctx.font = "700 12px Segoe UI, Arial";
      ctx.fillText(title, pad, 16);
    }

    // axes/grid
    const grid = 5;
    for (let i = 0; i <= grid; i++) {
      const gy = pad + (h - pad * 1.5) - i * ((h - pad * 1.5) / grid);
      ctx.strokeStyle = "rgba(234,241,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(pad, gy);
      ctx.lineTo(w - 14, gy);
      ctx.stroke();
    }

    // points
    points.forEach((p) => {
      const px = pad + ((p.x - minX) / rangeX) * (w - pad * 1.2);
      const py = pad + (h - pad * 1.5) - ((p.y - minY) / rangeY) * (h - pad * 1.5);
      ctx.fillStyle = "rgba(82,255,202,0.9)";
      ctx.strokeStyle = "rgba(255,255,255,0.20)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // labels
    ctx.fillStyle = "rgba(234,241,255,0.78)";
    ctx.font = "700 11px Segoe UI, Arial";
    ctx.fillText(xLabel || "", w - pad + 2, h - 8);
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel || "", 0, 0);
    ctx.restore();
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

    const ssError = ssTotal - ssTreat - ssBlock;

    const dfTreat = t - 1;
    const dfBlock = b - 1;
    const dfError = (t - 1) * (b - 1);
    const msTreat = ssTreat / dfTreat;
    const msBlock = ssBlock / dfBlock;
    const msError = ssError / dfError;
    const fTreat = msError === 0 ? 0 : msTreat / msError;
    const fSig = approxFSignificance(fTreat, dfTreat, dfError);

    const means = rowTotals.map((Ti, i) => ({ treatment: `T${i + 1}`, mean: Ti / b, total: Ti }));
    return { ssTotal, ssTreat, ssBlock, ssError, dfTreat, dfBlock, dfError, msTreat, msBlock, msError, fTreat, sig: fSig, means };
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
      <h3>${qs(title)}</h3>
      <p class="muted">${qs(subtitle || "")}</p>
    `;
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
        #profModal{position:fixed;inset:0;z-index:999;display:grid;place-items:center;background:rgba(0,0,0,0.55);padding:18px;opacity:0;pointer-events:none;transition:opacity .15s ease}
        #profModal.open{opacity:1;pointer-events:auto}
        #profModal .box{width:min(860px,100%);background:rgba(10,14,30,0.92);border:1px solid rgba(255,255,255,0.14);border-radius:18px;box-shadow:0 28px 90px rgba(0,0,0,0.65);padding:16px}
        #profModal header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
        #profModal h3{margin:0;font-size:18px}
        #profModal .close{appearance:none;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#eaf1ff;border-radius:12px;padding:10px 12px;cursor:pointer;font-weight:850}
        #profModal .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        #profModal textarea{width:100%;min-height:88px;background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.16);border-radius:14px;color:#eaf1ff;padding:12px}
        #profModal .searchBox{display:flex;gap:10px;margin-top:10px;align-items:center}
        #profModal input{flex:1;background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.16);border-radius:14px;color:#eaf1ff;padding:12px}
        #profModal .answer{margin-top:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:12px;white-space:pre-wrap}
        #profModal .kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:rgba(234,241,255,0.85);font-weight:700;font-size:12px}
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
        #metaModal{position:fixed;inset:0;z-index:999;display:grid;place-items:center;background:rgba(0,0,0,0.55);padding:18px;opacity:0;pointer-events:none;transition:opacity .15s ease}
        #metaModal.open{opacity:1;pointer-events:auto}
        #metaModal .box{width:min(860px,100%);background:rgba(10,14,30,0.92);border:1px solid rgba(255,255,255,0.14);border-radius:18px;box-shadow:0 28px 90px rgba(0,0,0,0.65);padding:16px}
        #metaModal header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
        #metaModal h3{margin:0;font-size:18px}
        #metaModal .close{appearance:none;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#eaf1ff;border-radius:12px;padding:10px 12px;cursor:pointer;font-weight:850}
        #metaModal .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        #metaModal label{display:grid;gap:6px;font-weight:700;font-size:12.5px;color:rgba(234,241,255,0.92)}
        #metaModal input{width:100%;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,0.16);background:rgba(0,0,0,0.18);color:#eaf1ff}
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
      </div>
    `;

    const exportInterpretationEl = `<div class="export-interpretation" style="margin-top:12px"></div>`;

    $("#contentBody").innerHTML = `
      <div class="section">
        ${bodyHtml}
        ${exportRow}
        ${exportInterpretationEl}
      </div>
    `;

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
            filename: `${tableTitle.replace(/\s+/g, "_")}_Full_Report.doc`,
            asExcel: false,
          });
          exportHtmlAsDocOrXls({
            title: tableTitle,
            filename: `${tableTitle.replace(/\s+/g, "_")}_Full_Report.xls`,
            asExcel: true,
          });
        } else if (type === "doc") {
          exportHtmlAsDocOrXls({
            title: tableTitle,
            filename: `${tableTitle.replace(/\s+/g, "_")}.doc`,
            asExcel: false,
          });
        } else if (type === "xls") {
          exportHtmlAsDocOrXls({
            title: tableTitle,
            filename: `${tableTitle.replace(/\s+/g, "_")}.xls`,
            asExcel: true,
          });
        }
      });
    });

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
    $("#contentBody .export-interpretation").innerHTML = `<div>${qs(interpretation)}</div>${deviationHtml || ""}`;
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

      const matrix = [];
      for (let i = 0; i < t; i++) {
        const row = [];
        for (let j = 0; j < r; j++) {
          const input = document.querySelector(`#crdGridWrap input[data-cell="t${i}r${j}"]`);
          const v = Number(input?.value ?? NaN);
          row.push(Number.isFinite(v) ? v : 0);
        }
        matrix.push(row);
      }

      const out = crdAnova(matrix, r);

      // Results summary text
      $("#crdResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(4, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (Treat)</div><div class="value">${out.fStat.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">df(Treat), df(Error)</div><div class="value">${out.dfTreat}, ${out.dfError}</div></div>
          <div class="kpi"><div class="label">Approx. significance</div><div class="value">${qs(out.sig.level)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${out.msError.toFixed(4)}</div></div>
        </div>
      `;

      // Bar chart of means
      const labels = out.means.map((m) => m.treatment);
      const values = out.means.map((m) => m.mean);
      drawBarChart($("#crdBar"), labels, values, { title: "Treatment means" });

      // ANOVA table
      const headers = ["Source", "SS", "df", "MS", "F"];
      const anovaRows = [
        ["Treatments", out.ssTreat, out.dfTreat, out.msTreat, out.fStat],
        ["Error", out.ssError, out.dfError, out.msError, ""],
        ["Total", out.ssTotal, out.dfTreat + out.dfError, "", ""],
      ];
      $("#crdTableWrap").innerHTML = buildTable(headers, anovaRows);

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
        `Note: This offline BKQuant demo uses an approximate significance rule (no full t/F distribution table). For formal reporting, use standard CRD F-tables or statistical software.`;

      setInterpretation(
        "crd",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fStat: out.fStat, msError: out.msError, ssTreat: out.ssTreat, ssError: out.ssError }
      );
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
      const matrix = [];
      for (let i = 0; i < t; i++) {
        const row = [];
        for (let j = 0; j < b; j++) {
          const input = document.querySelector(`#rbdGridWrap input[data-cell="t${i}b${j}"]`);
          const v = Number(input?.value ?? NaN);
          row.push(Number.isFinite(v) ? v : 0);
        }
        matrix.push(row);
      }

      const out = rbdAnova(matrix, b, t);

      $("#rbdResultTop").innerHTML = `
        <div class="kpi-row" style="grid-template-columns:repeat(5, minmax(0,1fr))">
          <div class="kpi"><div class="label">F (Treat)</div><div class="value">${out.fTreat.toFixed(4)}</div></div>
          <div class="kpi"><div class="label">df(Treat), df(Block)</div><div class="value">${out.dfTreat}, ${out.dfBlock}</div></div>
          <div class="kpi"><div class="label">df(Error)</div><div class="value">${out.dfError}</div></div>
          <div class="kpi"><div class="label">Approx. significance</div><div class="value">${qs(out.sig.level)}</div></div>
          <div class="kpi"><div class="label">MS Error</div><div class="value">${out.msError.toFixed(4)}</div></div>
        </div>
      `;

      const labels = out.means.map((m) => m.treatment);
      const values = out.means.map((m) => m.mean);
      drawBarChart($("#rbdBar"), labels, values, { title: "Treatment means (over blocks)" });

      const headers = ["Source", "SS", "df", "MS", "F"];
      const anovaRows = [
        ["Treatments", out.ssTreat, out.dfTreat, out.msTreat, out.fTreat],
        ["Blocks", out.ssBlock, out.dfBlock, out.msBlock, out.msBlock / out.msError || ""],
        ["Error", out.ssError, out.dfError, out.msError, ""],
        ["Total", out.ssTotal, out.dfTreat + out.dfBlock + out.dfError, "", ""],
      ];
      $("#rbdTableWrap").innerHTML = buildTable(headers, anovaRows);

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
        `BKQuant note: significance uses approximate thresholds for offline demo purposes. Use official F tables/software for exact p-values.`;

      setInterpretation(
        "rbd",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { fTreat: out.fTreat, msError: out.msError, ssTreat: out.ssTreat, ssBlock: out.ssBlock }
      );
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

      // Collect data: y[i][j][k]
      const y = [];
      for (let i = 0; i < a; i++) {
        y[i] = [];
        for (let j = 0; j < b; j++) {
          y[i][j] = [];
          for (let k = 0; k < r; k++) {
            const input = document.querySelector(`#factGridWrap input[data-cell="a${i}b${j}r${k}"]`);
            const v = Number(input?.value ?? NaN);
            y[i][j][k] = Number.isFinite(v) ? v : 0;
          }
        }
      }

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
      $("#factTableWrap").innerHTML = buildTable(headers, rows);

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
      const msError = ssError / dfError;
      const fTreat = msError === 0 ? 0 : msTreat / msError;
      const sig = approxFSignificance(fTreat, dfTreat, dfError);

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

      const headers = ["Source", "SS", "df", "MS", "F"];
      const rows = [
        ["Rows", ssRow, dfRow, ssRow / dfRow, (ssRow / dfRow) / msError || ""],
        ["Columns", ssCol, dfCol, ssCol / dfCol, (ssCol / dfCol) / msError || ""],
        ["Treatments", ssTreat, dfTreat, msTreat, fTreat],
        ["Error", ssError, dfError, msError, ""],
        ["Total", ssTotal, N - 1, "", ""],
      ];
      $("#lsTableWrap").innerHTML = buildTable(headers, rows);

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
      const xs = parseGridNumbers($("#corX").value);
      const ys = parseGridNumbers($("#corY").value);
      const n = Math.min(xs.length, ys.length);
      const x = xs.slice(0, n);
      const y = ys.slice(0, n);
      const pearson = pearsonCorrelation(x, y);
      const spear = spearman(x, y);

      // build scatter points
      const points = x.map((vx, i) => ({ x: vx, y: y[i] }));
      drawScatterPlot($("#corScatter"), points, { title: "Trait scatter plot", xLabel: "X", yLabel: "Y" });

      const headers = ["Correlation Type", "Coefficient (r)", "Direction"];
      const direction = (r) => (r > 0.01 ? "Positive" : r < -0.01 ? "Negative" : "Zero/None");
      const anovaRows = [
        ["Pearson (linear association)", pearson, direction(pearson)],
        ["Spearman (rank association)", spear, direction(spear)],
      ];
      $("#corTableWrap").innerHTML = buildTable(headers, anovaRows);

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
      // Draw scatter + fitted line
      drawScatterPlot(canvas, xs.map((x, i) => ({ x, y: ys[i] })), { title: "Scatter + fitted line", xLabel: "X", yLabel: "Y" });
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));

      // Map coordinates (same as scatter)
      const pad = 42;
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
      const px1 = pad + ((x1 - minX) / rangeX) * (w - pad * 1.2);
      const py1 = pad + (h - pad * 1.5) - ((y1 - minY) / rangeY) * (h - pad * 1.5);
      const px2 = pad + ((x2 - minX) / rangeX) * (w - pad * 1.2);
      const py2 = pad + (h - pad * 1.5) - ((y2 - minY) / rangeY) * (h - pad * 1.5);

      ctx.strokeStyle = "rgba(255,209,102,0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);
      ctx.stroke();
    }

    $("#regCompute").addEventListener("click", () => {
      const xs = parseGridNumbers($("#regX").value);
      const ys = parseGridNumbers($("#regY").value);
      const n = Math.min(xs.length, ys.length);
      const x = xs.slice(0, n);
      const y = ys.slice(0, n);

      const { slope, intercept, r, r2 } = simpleLinearRegression(x, y);
      drawScatterWithLine($("#regScatter"), x, y, intercept, slope);

      const headers = ["Regression Term", "Value"];
      const rows = [
        ["Intercept (a)", intercept],
        ["Slope (b) for Y = a + bX", slope],
        ["Pearson r (same as sqrt R² sign via slope)", r],
        ["R² (variance explained)", r2],
      ];
      $("#regTableWrap").innerHTML = buildTable(headers, rows);

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

      setInterpretation(
        "regression",
        interpretation,
        deviationHtml ? deviationHtml : "",
        { slope, r2 }
      );
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
      // draw scatter + arrows for PC1/PC2 (as direction in X-Y plane)
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = 42;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = Math.max(1e-9, maxX - minX);
      const rangeY = Math.max(1e-9, maxY - minY);

      // title
      ctx.fillStyle = "rgba(234,241,255,0.95)";
      ctx.font = "700 12px Segoe UI, Arial";
      ctx.fillText("PCA scatter with PC directions", pad, 16);

      // grid
      for (let i = 0; i <= 5; i++) {
        const gy = pad + (h - pad * 1.5) - i * ((h - pad * 1.5) / 5);
        ctx.strokeStyle = "rgba(234,241,255,0.12)";
        ctx.beginPath();
        ctx.moveTo(pad, gy);
        ctx.lineTo(w - 14, gy);
        ctx.stroke();
      }

      // scatter points
      xs.forEach((x, i) => {
        const y = ys[i];
        const px = pad + ((x - minX) / rangeX) * (w - pad * 1.2);
        const py = pad + (h - pad * 1.5) - ((y - minY) / rangeY) * (h - pad * 1.5);
        ctx.fillStyle = "rgba(82,255,202,0.9)";
        ctx.strokeStyle = "rgba(255,255,255,0.20)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // Center point (mean)
      const cx = mean(xs);
      const cy = mean(ys);
      const centerPx = pad + ((cx - minX) / rangeX) * (w - pad * 1.2);
      const centerPy = pad + (h - pad * 1.5) - ((cy - minY) / rangeY) * (h - pad * 1.5);

      const arrowLenPx = 110;
      function toPx(dx, dy) {
        // direction vector in data units -> approximate pixel with scaling
        const endX = cx + dx;
        const endY = cy + dy;
        const ex = pad + ((endX - minX) / rangeX) * (w - pad * 1.2);
        const ey = pad + (h - pad * 1.5) - ((endY - minY) / rangeY) * (h - pad * 1.5);
        const vx = ex - centerPx;
        const vy = ey - centerPy;
        const mag = Math.sqrt(vx * vx + vy * vy) || 1;
        const s = arrowLenPx / mag;
        return { x2: centerPx + vx * s, y2: centerPy + vy * s };
      }

      const end1 = toPx(pc1.x * 1.0, pc1.y * 1.0);
      const end2 = toPx(pc2.x * 1.0, pc2.y * 1.0);

      drawArrow(ctx, centerPx, centerPy, end1.x2, end1.y2, "rgba(255,209,102,0.95)");
      drawArrow(ctx, centerPx, centerPy, end2.x2, end2.y2, "rgba(122,162,255,0.95)");

      // labels
      ctx.fillStyle = "rgba(255,209,102,0.95)";
      ctx.font = "800 12px Segoe UI, Arial";
      ctx.fillText("PC1", end1.x2 + 6, end1.y2 - 6);
      ctx.fillStyle = "rgba(122,162,255,0.95)";
      ctx.font = "800 12px Segoe UI, Arial";
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
      const xs = parseGridNumbers($("#pcaX").value);
      const ys = parseGridNumbers($("#pcaY").value);
      const n = Math.min(xs.length, ys.length);
      const x = xs.slice(0, n);
      const y = ys.slice(0, n);

      const out = pca2D(x, y);
      drawPCDirections($("#pcaScatter"), x, y, out.vec1, out.vec2);

      const headers = ["Component", "Eigenvalue", "Explained Variance (%)", "Direction (normalized)"];
      const rows = [
        ["PC1", out.l1, out.explained1, `(${out.vec1.x.toFixed(4)}, ${out.vec1.y.toFixed(4)})`],
        ["PC2", out.l2, out.explained2, `(${out.vec2.x.toFixed(4)}, ${out.vec2.y.toFixed(4)})`],
      ];
      $("#pcaTableWrap").innerHTML = buildTable(headers, rows);

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

      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          if (i === j) {
            Rxx[i][j] = 1;
            continue;
          }
          if (i < j) {
            const input = wrap.querySelector(`input[data-r="x${i}x${j}"]`);
            const v = Number(input?.value ?? NaN);
            const val = Number.isFinite(v) ? v : 0;
            Rxx[i][j] = val;
            Rxx[j][i] = val;
          }
        }
        const iy = wrap.querySelector(`input[data-ry="x${i}y"]`);
        const vy = Number(iy?.value ?? NaN);
        rxy[i] = Number.isFinite(vy) ? vy : 0;
      }
      return { Rxx, rxy };
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
            <path d="M0,0 L10,5 L0,10 Z" fill="rgba(255,209,102,0.95)"></path>
          </marker>
          <marker id="gArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="rgba(180,200,255,0.75)"></path>
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
            `<path d="M ${a.x + 40} ${a.y} L ${b.x + 40} ${b.y}" stroke="rgba(234,241,255,0.25)" stroke-width="2" fill="none" marker-end="url(#gArrow)"></path>
             <text x="${a.x + 55}" y="${(a.y + b.y) / 2 - 6}" fill="rgba(234,241,255,0.72)" font-size="12" font-weight="800">r=${r.toFixed(2)}</text>`
          );
        }
      }

      // draw nodes
      xs.forEach((pt, i) => {
        svg.insertAdjacentHTML(
          "beforeend",
          `<rect x="${pt.x - 80}" y="${pt.y - 24}" width="160" height="48" rx="16" fill="rgba(82,255,202,0.08)" stroke="rgba(255,255,255,0.18)"></rect>
           <text x="${pt.x}" y="${pt.y + 6}" text-anchor="middle" fill="rgba(234,241,255,0.92)" font-size="16" font-weight="900">${qs(names[i])}</text>`
        );
      });
      svg.insertAdjacentHTML(
        "beforeend",
        `<rect x="${yNode.x - 90}" y="${yNode.y - 26}" width="180" height="52" rx="16" fill="rgba(255,209,102,0.10)" stroke="rgba(255,255,255,0.20)"></rect>
         <text x="${yNode.x}" y="${yNode.y + 6}" text-anchor="middle" fill="rgba(234,241,255,0.92)" font-size="16" font-weight="950">${qs(yName)}</text>
         <text x="${yNode.x}" y="${yNode.y + 32}" text-anchor="middle" fill="rgba(234,241,255,0.72)" font-size="12" font-weight="800">Residual=${residual.toFixed(3)}</text>`
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
        const col = p >= 0 ? "rgba(82,255,202,0.95)" : "rgba(255,92,122,0.92)";
        svg.insertAdjacentHTML(
          "beforeend",
          `<path d="M ${startX} ${startY} C ${startX + 110} ${startY}, ${endX - 120} ${endY}, ${endX} ${endY}" stroke="${col}" stroke-width="4" fill="none" marker-end="url(#pArrow)"></path>
           <text x="${midX}" y="${midY - 8}" fill="${col}" font-size="13" font-weight="950">p=${p.toFixed(3)}</text>
           <text x="${midX}" y="${midY + 10}" fill="rgba(234,241,255,0.68)" font-size="12" font-weight="800">r=${rxy[i].toFixed(2)}</text>`
        );
      });
    }

    $("#pathCompute").addEventListener("click", () => {
      const p = Math.max(2, Math.min(6, Number($("#pathP").value || defaultP)));
      const names = cleanNames(p);
      const yName = ($("#pathYname").value || "Y").trim() || "Y";

      const { Rxx, rxy } = readCorrelationInputs(p);
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
      // base scatter
      drawScatterPlot(canvas, points, { title: "Diallel graphical approach (Wr vs Vr)", xLabel: "Vr", yLabel: "Wr" });
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      const pad = 42;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = Math.max(1e-9, maxX - minX);
      const rangeY = Math.max(1e-9, maxY - minY);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // fitted line y = a + bx
      const x1 = minX;
      const y1 = fit.intercept + fit.slope * x1;
      const x2 = maxX;
      const y2 = fit.intercept + fit.slope * x2;
      const px1 = pad + ((x1 - minX) / rangeX) * (w - pad * 1.2);
      const py1 = pad + (h - pad * 1.5) - ((y1 - minY) / rangeY) * (h - pad * 1.5);
      const px2 = pad + ((x2 - minX) / rangeX) * (w - pad * 1.2);
      const py2 = pad + (h - pad * 1.5) - ((y2 - minY) / rangeY) * (h - pad * 1.5);
      ctx.strokeStyle = "rgba(255,209,102,0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);
      ctx.stroke();

      // labels
      ctx.fillStyle = "rgba(234,241,255,0.85)";
      ctx.font = "700 11px Segoe UI, Arial";
      points.forEach((p) => {
        const px = pad + ((p.x - minX) / rangeX) * (w - pad * 1.2);
        const py = pad + (h - pad * 1.5) - ((p.y - minY) / rangeY) * (h - pad * 1.5);
        ctx.fillText(p.label, px + 5, py - 5);
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
      for (let i = 0; i < g; i++) for (let j = 0; j < e; j++) {
        const v = Number(document.querySelector(`#metWrap input[data-met="g${i}e${j}"]`)?.value ?? 0);
        M[i][j] = Number.isFinite(v) ? v : 0;
      }
      return { g, e, M };
    }

    build(defaultG, defaultE);
    $("#metBuild").addEventListener("click", () => {
      const g = Math.max(2, Math.min(30, Number($("#metG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#metE").value || defaultE)));
      build(g, e);
    });

    $("#metCompute").addEventListener("click", () => {
      const { g, e, M } = readMatrix();
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
      $("#metTables").innerHTML = `<h4>Table 1. Genotype stability summary</h4>${t1}<div style="height:10px"></div><h4>Table 2. Environment means</h4>${t2}`;

      const deviationHtml = deviationBanner("met", { bestMean: best.mean, bestCV: stable.cv }, ["bestMean", "bestCV"]);
      const interpretation =
        `MET summarizes genotype performance and stability across test environments.\n\n` +
        `Top mean performer: ${best.g} (mean=${best.mean.toFixed(3)}).\n` +
        `Most stable by CV: ${stable.g} (CV=${stable.cv.toFixed(2)}%).\n\n` +
        `Selection note: choose high mean + acceptable stability according to breeding objective (broad adaptation vs specific adaptation).`;
      setInterpretation("met", interpretation, deviationHtml || "", { bestMean: best.mean, bestCV: stable.cv });
    });

    $("#metERCompute").addEventListener("click", () => {
      const { g, e, M } = readMatrix();
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
      drawScatterPlot($("#metChart"), points, { title: "Eberhart-Russell: Mean vs bi", xLabel: "Genotype mean", yLabel: "bi" });
      const ctx = $("#metChart").getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = $("#metChart").getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      const pad = 42;
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const rx = Math.max(1e-9, maxX - minX), ry = Math.max(1e-9, maxY - minY);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "rgba(234,241,255,0.85)";
      ctx.font = "700 11px Segoe UI, Arial";
      rows.forEach((r) => {
        const px = pad + ((r.mean - minX) / rx) * (w - pad * 1.2);
        const py = pad + (h - pad * 1.5) - ((r.bi - minY) / ry) * (h - pad * 1.5);
        ctx.fillText(r.g, px + 6, py - 6);
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

      $("#metTables").innerHTML = `<h4>Table 1. Eberhart-Russell genotype stability parameters</h4>${gTable}<div style="height:10px"></div><h4>Table 2. Environmental indices</h4>${envTable}`;

      const deviationHtml = deviationBanner("met-er", { bestMean: stable.mean, bestCV: stable.s2di }, ["bestMean", "bestCV"]);
      const interpretation =
        `Eberhart and Russell stability model evaluates adaptability with bi (responsiveness) and S^2di (deviation from regression).\n\n` +
        `Stable wide-adaptation genotypes generally show high mean, bi≈1 and low S^2di.\n` +
        `Most stable in this run: ${stable.g} (mean=${stable.mean.toFixed(3)}, bi=${stable.bi.toFixed(3)}, S^2di=${stable.s2di.toFixed(4)}).\n\n` +
        `Interpretation guide: bi>1 indicates responsiveness to favorable environments; bi<1 indicates relative suitability under stressed/unfavorable environments.`;
      setInterpretation("met-er", interpretation, deviationHtml || "", { bestMean: stable.mean, bestCV: stable.s2di });
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
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      const pad = 42;
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
        return {
          px: pad + ((x - minX) / rangeX) * (w - pad * 1.2),
          py: pad + (h - pad * 1.5) - ((y - minY) / rangeY) * (h - pad * 1.5),
        };
      }

      // Genotypes
      ctx.font = "700 11px Segoe UI, Arial";
      gPoints.forEach((p) => {
        const { px, py } = toPx(p.x, p.y);
        ctx.fillStyle = "rgba(82,255,202,0.95)";
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(p.label, px + 6, py - 6);
      });
      // Environments
      ePoints.forEach((p) => {
        const { px, py } = toPx(p.x, p.y);
        ctx.fillStyle = "rgba(255,209,102,0.95)";
        ctx.fillRect(px - 4.2, py - 4.2, 8.4, 8.4);
        ctx.fillText(p.label, px + 6, py - 6);
      });
    }

    build(defaultG, defaultE);
    $("#ammiBuild").addEventListener("click", () => {
      const g = Math.max(2, Math.min(30, Number($("#ammiG").value || defaultG)));
      const e = Math.max(2, Math.min(12, Number($("#ammiE").value || defaultE)));
      build(g, e);
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
                  <path d="M0,0 L10,5 L0,10 Z" fill="rgba(255,209,102,0.95)"/>
                </marker>
                <marker id="arrow2" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                  <path d="M0,0 L10,5 L0,10 Z" fill="rgba(82,255,202,0.95)"/>
                </marker>
              </defs>
              <rect x="20" y="30" width="220" height="220" rx="18" fill="rgba(82,255,202,0.08)" stroke="rgba(255,255,255,0.14)"/>
              <rect x="270" y="30" width="220" height="220" rx="18" fill="rgba(122,162,255,0.08)" stroke="rgba(255,255,255,0.14)"/>
              <rect x="520" y="30" width="220" height="220" rx="18" fill="rgba(255,209,102,0.08)" stroke="rgba(255,255,255,0.14)"/>
              <text x="130" y="95" text-anchor="middle" fill="rgba(234,241,255,0.92)" font-size="18" font-weight="800">X1</text>
              <text x="380" y="95" text-anchor="middle" fill="rgba(234,241,255,0.92)" font-size="18" font-weight="800">X2</text>
              <text x="630" y="95" text-anchor="middle" fill="rgba(234,241,255,0.92)" font-size="18" font-weight="800">Y (Yield)</text>
              <text x="130" y="135" text-anchor="middle" fill="rgba(234,241,255,0.65)" font-size="12">Direct/Indirect</text>
              <text x="380" y="135" text-anchor="middle" fill="rgba(234,241,255,0.65)" font-size="12">Traits</text>
              <text x="630" y="135" text-anchor="middle" fill="rgba(234,241,255,0.65)" font-size="12">Response</text>

              <!-- arrows to Y -->
              <path d="M 240 140 C 320 140 360 120 510 120" stroke="rgba(255,209,102,0.95)" stroke-width="5" fill="none" marker-end="url(#arrow)"/>
              <path d="M 290 180 C 350 200 410 200 510 170" stroke="rgba(82,255,202,0.95)" stroke-width="5" fill="none" marker-end="url(#arrow2)"/>

              <text x="365" y="112" fill="rgba(255,209,102,0.95)" font-size="14" font-weight="900">pYX1 = 0.72</text>
              <text x="380" y="198" fill="rgba(82,255,202,0.95)" font-size="14" font-weight="900">pYX2 = -0.18</text>
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
    fab.style.border = "1px solid rgba(255,255,255,0.18)";
    fab.style.background = "linear-gradient(135deg, rgba(82,255,202,0.18), rgba(122,162,255,0.18))";
    fab.style.backdropFilter = "blur(8px)";
    fab.style.color = "rgba(234,241,255,0.95)";
    fab.style.boxShadow = "0 24px 90px rgba(0,0,0,0.45)";
    fab.style.cursor = "pointer";
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

/* BKQuant - offline-capable web app (vanilla JS) */

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  loggedIn: false,
  currentGroup: "data-analysis",
  activeModuleId: null,
  previousResults: {}, // moduleId -> key metrics for deviation detection
  currentExport: null, // {title, docHtml, excelHtml}
};

function fmt(n, d = 4) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(d).replace(/\.?0+$/,"");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadTextFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function makeDocHtml({ title, subtitle, kpisHtml, tablesHtml, chartsHtml, interpretationHtml }) {
  const downloadQuote = `
    <p><b>Download quotation:</b> "BKQuant helps researchers quantify traits, learn from data, and improve plant breeding decisions."</p>
    <p><i>Ask BKQuant Professor for the understanding the concepts.</i></p>
  `;
  return `<!doctype html>
  <html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
  <body style="font-family: Arial, sans-serif; line-height: 1.35; color:#111;">
    <h1 style="margin:0 0 6px;">${escapeHtml(title)}</h1>
    ${subtitle ? `<div style="margin-bottom:10px; color:#444;">${escapeHtml(subtitle)}</div>` : ""}
    ${downloadQuote}
    <hr/>
    ${kpisHtml || ""}
    ${tablesHtml || ""}
    ${chartsHtml || ""}
    <h2 style="margin-top:18px;">Interpretation</h2>
    ${interpretationHtml || ""}
  </body></html>`;
}

function makeExcelHtml({ sheetTitle, tablesHtml }) {
  // Excel opens HTML tables (saved as .xls) in most environments.
  return `<!doctype html>
  <html><head><meta charset="utf-8"></head>
  <body>
    <h2>${escapeHtml(sheetTitle)}</h2>
    ${tablesHtml || ""}
  </body></html>`;
}

function setExportPayload(payload) {
  state.currentExport = payload;
}

function exportDoc() {
  if (!state.currentExport) return alert("Run a module first to export results.");
  const { title, subtitle, tablesHtml, chartsHtml, interpretationHtml, kpisHtml } = state.currentExport;
  const docHtml = makeDocHtml({ title, subtitle, kpisHtml, tablesHtml, chartsHtml, interpretationHtml });
  downloadTextFile(`${state.currentExport.fileStem}.doc`, "application/msword", docHtml);
}

function exportXls() {
  if (!state.currentExport) return alert("Run a module first to export results.");
  const { title, tablesHtml } = state.currentExport;
  const xlsHtml = makeExcelHtml({ sheetTitle: title, tablesHtml });
  downloadTextFile(`${state.currentExport.fileStem}.xls`, "application/vnd.ms-excel", xlsHtml);
}

function setText(el, text) {
  el.textContent = text;
}

function parseNumber(s) {
  const x = Number(String(s).trim());
  return Number.isFinite(x) ? x : NaN;
}

function parseCsvNumbers(text) {
  // Supports commas/tabs/spaces and ignores empty lines.
  const rows = String(text)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.split(/[,\t;]/).map(x => x.trim()).filter(x => x.length));
  return rows.map(r => r.map(parseNumber));
}

function mean(arr) {
  const xs = arr.filter(v => Number.isFinite(v));
  if (!xs.length) return NaN;
  return xs.reduce((a,b)=>a+b,0) / xs.length;
}

// --- Stats (Numerical Recipes style for Beta/Gamma and F/CDF/T approximations) ---
function logGamma(xx) {
  const x = xx;
  const cof = [
    76.18009172947146,    -86.50532032941677,
    24.01409824083091,    -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j=0; j<6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betacf(a, b, x) {
  // Continued fraction for incomplete beta (NR)
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m=1, m2=2; m<=MAXIT; m++, m2 += 2) {
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d / (1);
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function incBeta(a, b, x) {
  // Regularized incomplete beta I_x(a,b)
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return bt * betacf(a, b, x) / a;
  }
  return 1 - bt * betacf(b, a, 1 - x) / b;
}

function fCdf(x, d1, d2) {
  // CDF of F distribution
  if (x <= 0) return 0;
  const xx = (d1 * x) / (d1 * x + d2);
  return incBeta(d1 / 2, d2 / 2, xx);
}

function fPValue(fStat, d1, d2) {
  if (!Number.isFinite(fStat) || fStat < 0) return NaN;
  const cdf = fCdf(fStat, d1, d2);
  return 1 - cdf;
}

function tCdf(t, df) {
  // Student's t CDF via incomplete beta.
  // Uses symmetry for negative t.
  if (!Number.isFinite(t)) return NaN;
  if (df <= 0) return NaN;
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const ib = incBeta(a, b, x);
  // For t>0: CDF = 1 - 0.5*I
  const cdf = t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
  return cdf;
}

function invT(prob, df) {
  // Inverse CDF by binary search
  // prob in (0,1)
  if (!(prob > 0 && prob < 1)) return NaN;
  if (df <= 0) return NaN;
  let lo = -100, hi = 100;
  for (let i=0; i<80; i++) {
    const mid = (lo + hi) / 2;
    const c = tCdf(mid, df);
    if (!Number.isFinite(c)) break;
    if (c < prob) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- DOM helpers ---
function makePill({ label, value, tone }) {
  const span = document.createElement("span");
  span.className = "pill";
  const dot = document.createElement("span");
  dot.className = `dot ${tone || "ok"}`;
  dot.setAttribute("aria-hidden", "true");
  dot.title = tone || "ok";
  const t = document.createElement("span");
  t.textContent = `${label}: ${value}`;
  span.appendChild(dot);
  span.appendChild(t);
  return span;
}

function renderTable(container, { columns, rows }) {
  const table = document.createElement("table");
  table.className = "data";
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.innerHTML = "";
  container.appendChild(table);

  // Return HTML for export
  const html = table.outerHTML;
  return html;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function barChartSVG({ labels, values, title, yLabel }) {
  const w = 720;
  const h = 320;
  const pad = 44;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "auto" });

  const maxV = Math.max(...values.filter(v=>Number.isFinite(v)), 1);
  const n = values.length;
  const barW = (w - pad*2) / Math.max(n, 1);

  // Background
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "rgba(0,0,0,0)" }));

  // Title
  if (title) {
    const t = svgEl("text", { x: w/2, y: 20, "text-anchor": "middle", fill: "rgba(234,241,255,0.95)", "font-size": 14, "font-weight": 800 });
    t.textContent = title;
    svg.appendChild(t);
  }

  // Y axis
  svg.appendChild(svgEl("line", { x1: pad, y1: pad, x2: pad, y2: h - pad, stroke: "rgba(234,241,255,0.35)" }));
  // X axis
  svg.appendChild(svgEl("line", { x1: pad, y1: h - pad, x2: w - pad, y2: h - pad, stroke: "rgba(234,241,255,0.35)" }));

  // Y label
  if (yLabel) {
    const yl = svgEl("text", { x: 12, y: h/2, fill: "rgba(234,241,255,0.85)", "font-size": 12, transform: `rotate(-90, 12, ${h/2})` });
    yl.textContent = yLabel;
    svg.appendChild(yl);
  }

  // Bars
  for (let i=0; i<n; i++) {
    const v = values[i];
    const x = pad + i * barW + barW * 0.15;
    const bw = barW * 0.7;
    const bh = (h - pad*2) * (v / maxV);
    const y = h - pad - bh;

    const rect = svgEl("rect", {
      x, y, width: bw, height: bh,
      rx: 10,
      fill: "rgba(82,255,202,0.40)",
      stroke: "rgba(122,162,255,0.50)",
      "stroke-width": 1
    });
    svg.appendChild(rect);

    const lbl = svgEl("text", { x: x + bw/2, y: h - pad + 18, "text-anchor": "middle", fill: "rgba(234,241,255,0.85)", "font-size": 11 });
    lbl.textContent = labels[i] || `T${i+1}`;
    svg.appendChild(lbl);

    const valLbl = svgEl("text", { x: x + bw/2, y: y - 8, "text-anchor": "middle", fill: "rgba(234,241,255,0.95)", "font-size": 12, "font-weight": 800 });
    valLbl.textContent = Number.isFinite(v) ? fmt(v, 2) : "";
    svg.appendChild(valLbl);
  }

  return svg;
}

function scatterChartSVG({ points, title, xLabel, yLabel }) {
  // points: [{x,y,label}]
  const w = 720, h = 320, pad = 44;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "auto" });

  const xs = points.map(p => p.x).filter(Number.isFinite);
  const ys = points.map(p => p.y).filter(Number.isFinite);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = (maxX - minX) || 1;
  const spanY = (maxY - minY) || 1;

  if (title) {
    const t = svgEl("text", { x: w/2, y: 20, "text-anchor": "middle", fill: "rgba(234,241,255,0.95)", "font-size": 14, "font-weight": 800 });
    t.textContent = title;
    svg.appendChild(t);
  }

  svg.appendChild(svgEl("line", { x1: pad, y1: pad, x2: pad, y2: h - pad, stroke: "rgba(234,241,255,0.35)" }));
  svg.appendChild(svgEl("line", { x1: pad, y1: h - pad, x2: w - pad, y2: h - pad, stroke: "rgba(234,241,255,0.35)" }));

  if (xLabel) {
    const xl = svgEl("text", { x: w/2, y: h - 10, fill: "rgba(234,241,255,0.85)", "font-size": 12, "text-anchor": "middle" });
    xl.textContent = xLabel;
    svg.appendChild(xl);
  }
  if (yLabel) {
    const yl = svgEl("text", { x: 14, y: h/2, fill: "rgba(234,241,255,0.85)", "font-size": 12, transform: `rotate(-90, 14, ${h/2})` });
    yl.textContent = yLabel;
    svg.appendChild(yl);
  }

  for (const p of points) {
    const x = pad + ((p.x - minX) / spanX) * (w - pad*2);
    const y = h - pad - ((p.y - minY) / spanY) * (h - pad*2);

    const c = svgEl("circle", { cx: x, cy: y, r: 6, fill: "rgba(122,162,255,0.45)", stroke: "rgba(82,255,202,0.65)", "stroke-width": 1.5 });
    svg.appendChild(c);

    if (p.label) {
      const tt = svgEl("title");
      tt.textContent = `${p.label}: (${fmt(p.x,3)}, ${fmt(p.y,3)})`;
      c.appendChild(tt);
    }
  }

  return svg;
}

function appendCharts(container, svgList) {
  for (const svg of svgList) {
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.appendChild(svg);
    container.appendChild(wrap);
  }
}

function moduleIconSvg(kind) {
  // Returns a simple inline SVG element for visual consistency.
  const svg = svgEl("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" });
  const stroke = "rgba(234,241,255,0.95)";
  svg.setAttribute("stroke", stroke);
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  if (kind === "leaf") {
    svg.innerHTML = `
      <path d="M4 20c7 0 14-7 16-16C11 6 4 13 4 20Z"></path>
      <path d="M8 16c1.5-2 4-4 8-6"></path>
    `;
  } else if (kind === "table") {
    svg.innerHTML = `
      <rect x="3" y="4" width="18" height="16" rx="2"></rect>
      <path d="M3 10h18"></path>
      <path d="M8 20V10"></path>
    `;
  } else if (kind === "dna") {
    svg.innerHTML = `
      <path d="M12 2c-3 2-4 4-4 6 0 2 1 4 4 6 3-2 4-4 4-6 0-2-1-4-4-6Z"></path>
      <path d="M12 8v8"></path>
    `;
  } else if (kind === "plot") {
    svg.innerHTML = `
      <path d="M4 19V5"></path>
      <path d="M4 19h16"></path>
      <path d="M7 14l3-3 3 2 4-6"></path>
    `;
  } else if (kind === "scales") {
    svg.innerHTML = `
      <path d="M12 3v18"></path>
      <path d="M5 6h14"></path>
      <path d="M7 21h10"></path>
    `;
  } else {
    svg.innerHTML = `
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M12 7v6l4 2"></path>
    `;
  }
  return svg;
}

// --- Calculators ---
function crdAnalyze({ t, r, matrix }) {
  // matrix[t][r]
  const N = t * r;
  const flat = matrix.flat();
  const G = flat.reduce((a,b)=>a+b,0);
  const CF = (G*G) / N;
  const SST = flat.reduce((a,y)=>a + y*y, 0) - CF;

  const trtTotals = [];
  for (let i=0;i<t;i++){
    trtTotals[i] = matrix[i].reduce((a,b)=>a+b,0);
  }
  const SS_trt = trtTotals.reduce((a,Ti)=>a + (Ti*Ti)/r, 0) - CF;
  const df_trt = t-1;
  const df_total = N-1;
  const df_error = df_total - df_trt;
  const SS_error = SST - SS_trt;
  const MS_trt = SS_trt / df_trt;
  const MS_error = SS_error / df_error;
  const F = MS_trt / MS_error;
  const p = fPValue(F, df_trt, df_error);

  const means = [];
  for (let i=0;i<t;i++) means[i] = trtTotals[i] / r;
  const grandMean = G / N;
  const CV = Math.sqrt(MS_error) / grandMean * 100;

  // LSD at 5% (approx using exact t critical from inverse CDF).
  const tCrit = invT(1 - 0.025, df_error);
  const LSD05 = tCrit * Math.sqrt(2 * MS_error / r);

  return {
    N, G, CF, SST, SS_trt, SS_error,
    df_trt, df_error, df_total,
    MS_trt, MS_error,
    F, p,
    means, grandMean, CV, LSD05
  };
}

function rbdAnalyze({ t, b, matrix }) {
  // matrix[t][b]
  const N = t * b;
  const flat = matrix.flat();
  const G = flat.reduce((a,b)=>a+b,0);
  const CF = (G*G)/N;
  const SST = flat.reduce((a,y)=>a + y*y,0) - CF;

  const trtTotals = [];
  for (let i=0;i<t;i++) trtTotals[i] = matrix[i].reduce((a,bv)=>a+bv,0);
  const blockTotals = [];
  for (let j=0;j<b;j++){
    let s=0; for (let i=0;i<t;i++) s += matrix[i][j];
    blockTotals[j]=s;
  }

  const SS_trt = trtTotals.reduce((a,Ti)=>a + (Ti*Ti)/b,0) - CF;
  const SS_block = blockTotals.reduce((a,Bj)=>a + (Bj*Bj)/t,0) - CF;
  const SS_error = SST - SS_trt - SS_block;

  const df_trt = t-1;
  const df_block = b-1;
  const df_total = N-1;
  const df_error = df_total - df_trt - df_block;

  const MS_trt = SS_trt / df_trt;
  const MS_block = SS_block / df_block;
  const MS_error = SS_error / df_error;

  const F = MS_trt / MS_error;
  const p = fPValue(F, df_trt, df_error);

  const means = [];
  for (let i=0;i<t;i++) means[i] = trtTotals[i] / b;
  const grandMean = G / N;
  const CV = Math.sqrt(MS_error) / grandMean * 100;

  const tCrit = invT(1 - 0.025, df_error);
  const LSD05 = tCrit * Math.sqrt(2 * MS_error / b);

  return {
    N, G, CF, SST, SS_trt, SS_block, SS_error,
    df_trt, df_block, df_error, df_total,
    MS_trt, MS_block, MS_error,
    F, p, means, grandMean, CV, LSD05
  };
}

function significanceTone(p) {
  if (!Number.isFinite(p)) return "warn";
  if (p < 0.01) return "ok";
  if (p < 0.05) return "warn";
  return "danger";
}

function interpretANOVA_CRD({ t, r, analysis }) {
  const sig = Number.isFinite(analysis.p) ? analysis.p < 0.05 : false;
  const tone = sig ? "likely significant differences among treatments at 5%" : "no strong evidence of differences among treatments at 5%";
  const fText = `F = ${fmt(analysis.F,3)}, p-value = ${fmt(analysis.p,4)}.`;
  const cvText = `CV = ${fmt(analysis.CV,3)}%.`;
  const lsdText = `LSD(0.05) for comparing treatment means = ${fmt(analysis.LSD05,4)}.`;
  const deviation = getDeviationText("crd", { treatmentsF: analysis.F });
  return `
    <p><b>Decision:</b> BKQuant suggests ${tone}. ${fText}</p>
    <p>${cvText} indicates experimental precision.</p>
    <p>${lsdText} (use |mean_i - mean_j| > LSD to claim difference).</p>
    ${deviation ? `<p><b>Deviation check:</b> ${deviation}</p>` : ""}
    <p><b>Practical interpretation:</b> Use the highest treatment mean(s) as candidates for further selection, and verify stability across seasons/environments if available.</p>
  `;
}

function interpretANOVA_RBD({ t, b, analysis }) {
  const sig = Number.isFinite(analysis.p) ? analysis.p < 0.05 : false;
  const tone = sig ? "likely significant differences among treatments at 5%" : "no strong evidence of differences among treatments at 5%";
  const fText = `F (Trt effect) = ${fmt(analysis.F,3)}, p-value = ${fmt(analysis.p,4)}.`;
  const cvText = `CV = ${fmt(analysis.CV,3)}%.`;
  const lsdText = `LSD(0.05) for comparing treatment means = ${fmt(analysis.LSD05,4)}.`;
  const deviation = getDeviationText("rbd", { treatmentsF: analysis.F });
  return `
    <p><b>Decision:</b> BKQuant suggests ${tone}. ${fText}</p>
    <p>${cvText} indicates experimental precision.</p>
    <p>${lsdText} (use |mean_i - mean_j| > LSD to claim difference).</p>
    ${deviation ? `<p><b>Deviation check:</b> ${deviation}</p>` : ""}
    <p><b>Practical interpretation:</b> If treatment differences are significant, select the best treatment mean(s) and validate performance across future blocks/environments.</p>
  `;
}

function getDeviationText(moduleId, metrics) {
  const key = moduleId;
  const prev = state.previousResults[key];
  state.previousResults[key] = { ...metrics, at: Date.now() };
  if (!prev) return "";
  const prevVal = prev.treatmentsF;
  const newVal = metrics.treatmentsF;
  if (!Number.isFinite(prevVal) || !Number.isFinite(newVal)) return "";
  const diff = Math.abs(newVal - prevVal);
  const rel = diff / (Math.abs(prevVal) + 1e-9);
  if (rel < 0.02) return "";
  return `This run deviates from your previous results (F changed from ${fmt(prevVal,3)} to ${fmt(newVal,3)}). Likely reasons: you changed the input measurements, block/treatment totals, or there is increased/decreased error variance due to different data dispersion.`;
}

function renderCrdModule(container, moduleId, moduleDef) {
  const section = document.createElement("div");
  section.className = "section";

  section.innerHTML = `
    <h4>${escapeHtml(moduleDef.title)}</h4>
    <p class="muted">
      Balanced CRD ANOVA: compute treatment effect table, p-value, CV, LSD(0.05), treatment means, and a mean plot.
    </p>
  `;

  const inputWrap = document.createElement("div");
  inputWrap.className = "input-grid";
  const controls = document.createElement("div");
  controls.className = "two-col";
  controls.innerHTML = `
    <label>
      Number of treatments (t)
      <input type="text" id="${moduleId}_t" value="5" />
    </label>
    <label>
      Replications (r)
      <input type="text" id="${moduleId}_r" value="3" />
    </label>
  `;
  inputWrap.appendChild(controls);

  const matrixWrap = document.createElement("div");
  matrixWrap.className = "matrix";
  matrixWrap.innerHTML = `<div class="muted small">Set t and r, then click “Build input matrix”.</div>`;
  inputWrap.appendChild(matrixWrap);

  const actionRow = document.createElement("div");
  actionRow.className = "actions";
  actionRow.innerHTML = `
    <button class="action-btn primary2" type="button" id="${moduleId}_build">Build input matrix</button>
    <button class="action-btn" type="button" id="${moduleId}_run">Compute CRD ANOVA</button>
    <button class="action-btn" type="button" id="${moduleId}_demo">Use sample data</button>
  `;
  inputWrap.appendChild(actionRow);

  const results = document.createElement("div");
  results.id = `${moduleId}_results`;

  section.appendChild(inputWrap);
  section.appendChild(results);

  container.appendChild(section);

  const buildMatrix = () => {
    const t = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_t`).value)));
    const r = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_r`).value)));

    if (!Number.isFinite(t) || !Number.isFinite(r)) {
      matrixWrap.innerHTML = `<div class="note">Please enter valid integer values for t and r.</div>`;
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.textContent = "Treatment / Rep";
    trh.appendChild(th0);
    for (let j=0;j<r;j++){
      const th = document.createElement("th");
      th.textContent = `R${j+1}`;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let i=0;i<t;i++){
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = `T${i+1}`;
      tr.appendChild(th);
      for (let j=0;j<r;j++){
        const td = document.createElement("td");
        const inp = document.createElement("input");
        inp.type = "text";
        inp.inputMode = "decimal";
        inp.value = "";
        inp.placeholder = "0";
        inp.dataset.t = i;
        inp.dataset.r = j;
        td.appendChild(inp);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    matrixWrap.innerHTML = "";
    matrixWrap.appendChild(table);
  };

  const getMatrix = () => {
    const t = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_t`).value)));
    const r = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_r`).value)));
    const inputs = matrixWrap.querySelectorAll("tbody input");
    if (!inputs.length) return null;

    const matrix = Array.from({ length: t }, () => Array.from({ length: r }, () => NaN));
    for (const inp of inputs) {
      const i = Number(inp.dataset.t);
      const j = Number(inp.dataset.r);
      matrix[i][j] = parseNumber(inp.value);
    }
    // Validate all finite
    for (let i=0;i<t;i++){
      for (let j=0;j<r;j++){
        if (!Number.isFinite(matrix[i][j])) return { t, r, matrix, ok: false };
      }
    }
    return { t, r, matrix, ok: true };
  };

  const run = () => {
    const { t, r, matrix, ok } = getMatrix() || {};
    if (!t || !r || !matrix) return alert("Build the matrix first.");
    if (!ok) return alert("Please fill every cell with numeric values.");

    const analysis = crdAnalyze({ t, r, matrix });

    // KPI row
    const kpiRow = document.createElement("div");
    kpiRow.className = "kpi-row";

    const k1 = makePill({ label: "F", value: fmt(analysis.F, 3), tone: significanceTone(analysis.p) });
    const k2 = makePill({ label: "p-value", value: fmt(analysis.p, 4), tone: significanceTone(analysis.p) });
    const k3 = makePill({ label: "CV%", value: fmt(analysis.CV, 3), tone: analysis.CV < 15 ? "ok" : "warn" });
    kpiRow.appendChild(k1);
    kpiRow.appendChild(k2);
    kpiRow.appendChild(k3);

    const anovaWrap = document.createElement("div");
    anovaWrap.className = "section";
    anovaWrap.innerHTML = `<h4>ANOVA Table (CRD)</h4><div id="${moduleId}_anova"></div>`;

    const columns = ["Source of variation", "df", "SS", "MS", "F", "p-value"];
    const rows = [
      ["Treatments", analysis.df_trt, fmt(analysis.SS_trt, 6), fmt(analysis.MS_trt, 6), fmt(analysis.F, 4), fmt(analysis.p, 6)],
      ["Error", analysis.df_error, fmt(analysis.SS_error, 6), fmt(analysis.MS_error, 6), "—", "—"],
      ["Total", analysis.df_total, fmt(analysis.SST, 6), "—", "—", "—"]
    ];
    const tableHtml = renderTable($("#"+moduleId+"_anova", anovaWrap) || anovaWrap.querySelector("#"+moduleId+"_anova"), { columns, rows });

    // Means table
    const meansWrap = document.createElement("div");
    meansWrap.className = "section";
    meansWrap.innerHTML = `<h4>Treatment Means & LSD(0.05)</h4>`;
    const meansCols = ["Treatment", "Mean"];
    const meansRows = analysis.means.map((m, i) => [`T${i+1}`, fmt(m, 4)]);
    const meansTableWrap = document.createElement("div");
    meansWrap.appendChild(meansTableWrap);
    const meansTableHtml = renderTable(meansTableWrap, { columns: meansCols, rows: meansRows });

    // Chart
    const chartsWrap = document.createElement("div");
    chartsWrap.className = "section";
    chartsWrap.innerHTML = `<h4>Treatment Mean Plot</h4>`;
    const svg = barChartSVG({
      labels: analysis.means.map((_,i)=>`T${i+1}`),
      values: analysis.means,
      title: "Means by Treatment",
      yLabel: "Mean response"
    });
    const chartsInner = document.createElement("div");
    chartsInner.style.marginTop = "8px";
    chartsWrap.appendChild(chartsInner);
    appendCharts(chartsInner, [svg]);

    // Interpretation
    const interpretation = document.createElement("div");
    interpretation.className = "section";
    const interpretationHtmlStr = interpretANOVA_CRD({ t, r, analysis });
    interpretation.innerHTML = `<h4>Interpretation</h4>${interpretationHtmlStr}`;

    // Export payload
    const chartsHtml = svg.outerHTML ? `<div>${svg.outerHTML}</div>` : "";
    const kpisHtml = `<p><b>F</b>: ${fmt(analysis.F,3)} | <b>p</b>: ${fmt(analysis.p,6)} | <b>CV%</b>: ${fmt(analysis.CV,3)} | <b>LSD(0.05)</b>: ${fmt(analysis.LSD05,4)}</p>`;

    setExportPayload({
      title: "CRD - Complete Results",
      subtitle: `Treatments = ${t}, Replications = ${r}`,
      fileStem: `BKQuant_CRD_t${t}_r${r}_${new Date().toISOString().slice(0,10)}`,
      tablesHtml: `<h3>ANOVA</h3>${tableHtml}<h3>Treatment means</h3>${meansTableHtml}`,
      chartsHtml,
      interpretationHtml: interpretationHtmlStr,
      kpisHtml
    });

    results.innerHTML = "";
    results.appendChild(kpiRow);
    results.appendChild(anovaWrap);
    results.appendChild(meansWrap);
    results.appendChild(chartsWrap);
    results.appendChild(interpretation);

    // Ensure export buttons exist for this module
    ensureExportButtons(container, moduleId);
  };

  const ensureDemoData = () => {
    // Create a mild treatment effect dataset.
    const t = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_t`).value)) || 5);
    const r = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_r`).value)) || 3);
    buildMatrix();
    const base = [12, 14, 16, 18, 15, 20, 19, 22, 17, 13];
    const noise = [ -0.8, 0.6, -0.2, 0.3, -0.5, 0.1 ];
    const inputs = matrixWrap.querySelectorAll("tbody input");
    let idx = 0;
    for (const inp of inputs) {
      const i = Number(inp.dataset.t);
      const j = Number(inp.dataset.r);
      const v = (base[i] ?? 14) + (j * 0.25) + (noise[(idx++)%noise.length]);
      inp.value = v.toFixed(2);
    }
  };

  document.getElementById(`${moduleId}_build`).addEventListener("click", buildMatrix);
  document.getElementById(`${moduleId}_demo`).addEventListener("click", ensureDemoData);
  document.getElementById(`${moduleId}_run`).addEventListener("click", run);

  // Build initial
  buildMatrix();
}

function ensureExportButtons(container, moduleId) {
  // Put once per module render: we key by moduleId.
  const existing = container.querySelector(`#${moduleId}_exportRow`);
  if (existing) return;
  const row = document.createElement("div");
  row.className = "actions";
  row.id = `${moduleId}_exportRow`;
  row.style.margin = "12px 0 0";
  row.innerHTML = `
    <button class="action-btn primary2" type="button" id="${moduleId}_downloadDoc">Download DOC</button>
    <button class="action-btn" type="button" id="${moduleId}_downloadXls">Download XLS</button>
  `;
  // Insert after the first section in container
  const firstSection = container.querySelector(".section");
  if (firstSection && firstSection.nextSibling) {
    firstSection.parentElement.insertBefore(row, firstSection.nextSibling);
  } else if (firstSection) {
    container.appendChild(row);
  } else {
    container.appendChild(row);
  }

  $(`#${moduleId}_downloadDoc`, row).addEventListener("click", exportDoc);
  $(`#${moduleId}_downloadXls`, row).addEventListener("click", exportXls);
}

function renderStaticModule(container, moduleDef) {
  const section = document.createElement("div");
  section.className = "section";
  section.innerHTML = `
    <h4>${escapeHtml(moduleDef.title)}</h4>
    <p class="muted">${escapeHtml(moduleDef.subtitle || "")}</p>
    <div class="note">
      This module is provided as a complete educational results set (tables + plots).
      If you want BKQuant to calculate results from your own raw data, tell me your preferred input format for this specific analysis.
    </div>
    <div id="${moduleDef.id}_staticGrid" style="margin-top:12px;"></div>
  `;
  container.appendChild(section);
  const grid = $(`#${moduleDef.id}_staticGrid`);

  // Render each "part" as a table/plot block defined by moduleDef.parts
  for (const part of moduleDef.parts || []) {
    const wrap = document.createElement("div");
    wrap.className = "section";
    wrap.style.marginBottom = "12px";
    const h = document.createElement("h4");
    h.textContent = part.heading || "Results";
    wrap.appendChild(h);
    grid.appendChild(wrap);

    if (part.table) {
      const tWrap = document.createElement("div");
      wrap.appendChild(tWrap);
      renderTable(tWrap, part.table);
    }

    if (part.chart) {
      const chartsWrap = document.createElement("div");
      wrap.appendChild(chartsWrap);
      if (part.chart.kind === "bar") {
        const svg = barChartSVG(part.chart.payload);
        chartsWrap.appendChild(svg);
        svg.classList?.add("chart-svg");
        // Add consistent chart container
        const outer = document.createElement("div");
        outer.className = "chart";
        outer.appendChild(svg);
        chartsWrap.innerHTML = "";
        chartsWrap.appendChild(outer);
      } else if (part.chart.kind === "scatter") {
        const svg = scatterChartSVG(part.chart.payload);
        const outer = document.createElement("div");
        outer.className = "chart";
        outer.appendChild(svg);
        chartsWrap.appendChild(outer);
      } else if (part.chart.kind === "path") {
        const d = part.chart.payload;
        chartsWrap.appendChild(renderPathDiagramSVG(d));
      }
    }

    if (part.text) {
      const p = document.createElement("div");
      p.className = "muted";
      p.style.marginTop = "6px";
      p.innerHTML = part.text;
      wrap.appendChild(p);
    }
  }

  // Interpretation
  if (moduleDef.interpretation) {
    const interp = document.createElement("div");
    interp.className = "section";
    interp.innerHTML = `<h4>Interpretation</h4>${moduleDef.interpretation}`;
    container.appendChild(interp);
  }

  // Export payload from the static DOM
  ensureExportButtons(container, moduleDef.id);
  // Set export payload immediately (no computation), based on rendered content.
  const tables = [...container.querySelectorAll(`#${moduleDef.id}_staticGrid table.data`)].map(t => t.outerHTML).join("");
  const svgs = [...container.querySelectorAll(`#${moduleDef.id}_staticGrid svg`)].map(s => s.outerHTML).join("");
  setExportPayload({
    title: moduleDef.title,
    subtitle: moduleDef.subtitle || "",
    fileStem: `BKQuant_${moduleDef.id}_${new Date().toISOString().slice(0,10)}`,
    tablesHtml: tables,
    chartsHtml: svgs ? `<div>${svgs}</div>` : "",
    interpretationHtml: moduleDef.interpretation || "",
    kpisHtml: ""
  });
}

function renderPathDiagramSVG({ nodes, edges }) {
  const w = 720, h = 320;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "auto" });
  // bg
  svg.appendChild(svgEl("rect", { x:0, y:0, width:w, height:h, fill:"rgba(0,0,0,0)" }));

  // defs arrow marker
  const defs = svgEl("defs");
  const marker = svgEl("marker", { id: "arrow", markerWidth: 10, markerHeight: 10, refX: 8, refY: 5, orient: "auto", markerUnits: "strokeWidth" });
  marker.appendChild(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: "rgba(234,241,255,0.8)" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  // edges
  for (const e of edges) {
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) continue;
    const line = svgEl("line", {
      x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      stroke: "rgba(82,255,202,0.75)",
      "stroke-width": 2.5,
      "marker-end": "url(#arrow)"
    });
    svg.appendChild(line);
    if (e.weight != null) {
      const midx = (from.x + to.x)/2;
      const midy = (from.y + to.y)/2;
      const text = svgEl("text", { x: midx, y: midy - 6, fill: "rgba(234,241,255,0.95)", "font-size": 12, "font-weight": 800, "text-anchor":"middle" });
      text.textContent = fmt(e.weight, 3);
      svg.appendChild(text);
    }
  }

  // nodes
  for (const n of nodes) {
    svg.appendChild(svgEl("circle", { cx: n.x, cy: n.y, r: 22, fill: "rgba(122,162,255,0.18)", stroke: "rgba(234,241,255,0.35)", "stroke-width": 2 }));
    const label = svgEl("text", { x: n.x, y: n.y + 4, "text-anchor":"middle", fill: "rgba(234,241,255,0.95)", "font-size": 12, "font-weight": 900 });
    label.textContent = n.label;
    svg.appendChild(label);
  }

  return svg;
}

function renderCorrelationModule(container, moduleDef) {
  const section = document.createElement("div");
  section.className = "section";
  section.innerHTML = `
    <h4>${escapeHtml(moduleDef.title)}</h4>
    <p class="muted">Paste paired data and BKQuant computes correlation type (Pearson), significance, and a regression line.</p>
  `;

  const input = document.createElement("div");
  input.className = "input-grid";
  input.innerHTML = `
    <div class="two-col">
      <label>
        X variable label
        <input type="text" id="${moduleDef.id}_xName" value="Trait X" />
      </label>
      <label>
        Y variable label
        <input type="text" id="${moduleDef.id}_yName" value="Trait Y" />
      </label>
    </div>
    <label>
      Paste data as CSV (each line: X,Y). Example: 12.3, 9.8
      <textarea id="${moduleDef.id}_data">10, 8.4
12, 9.7
14, 10.1
16, 12.0
18, 13.6
20, 14.1</textarea>
    </label>
    <div class="actions">
      <button class="action-btn primary2" type="button" id="${moduleDef.id}_run">Compute correlation + regression</button>
      <button class="action-btn" type="button" id="${moduleDef.id}_demo">Use sample data</button>
    </div>
  `;

  const results = document.createElement("div");
  results.id = `${moduleDef.id}_results`;

  section.appendChild(input);
  section.appendChild(results);
  container.appendChild(section);

  ensureExportButtons(container, moduleDef.id);

  const run = () => {
    const text = $(`#${moduleDef.id}_data`).value;
    const rows = String(text).trim().split(/\r?\n/).filter(Boolean).map(line => line.split(/[,\t;]/).map(s=>s.trim()));
    const pairs = rows.map(r => [parseNumber(r[0]), parseNumber(r[1])]).filter(([x,y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pairs.length < 3) return alert("Enter at least 3 valid (X,Y) pairs.");

    const xs = pairs.map(p=>p[0]);
    const ys = pairs.map(p=>p[1]);
    const n = pairs.length;
    const mx = mean(xs);
    const my = mean(ys);
    let sxx = 0, syy = 0, sxy = 0;
    for (let i=0;i<n;i++){
      const dx = xs[i]-mx, dy = ys[i]-my;
      sxx += dx*dx;
      syy += dy*dy;
      sxy += dx*dy;
    }
    const r = sxy / Math.sqrt(sxx*syy);
    // Pearson correlation test: t = r*sqrt((n-2)/(1-r^2))
    const tStat = r * Math.sqrt((n-2)/(1 - r*r + 1e-12));
    const p = 2 * (1 - tCdf(Math.abs(tStat), n-2));

    // Linear regression y = a + b x
    const b = sxy / (sxx + 1e-12);
    const a = my - b*mx;
    // R^2
    let sst=0, sse=0;
    for (let i=0;i<n;i++){
      const yhat = a + b*xs[i];
      sst += (ys[i]-my)**2;
      sse += (ys[i]-yhat)**2;
    }
    const r2 = 1 - sse/(sst + 1e-12);

    // Plot
    const points = pairs.map((p, i)=>({ x:p[0], y:p[1], label: `P${i+1}` }));
    const svgScatter = scatterChartSVG({
      points,
      title: "Scatter + trend (BKQuant sample)",
      xLabel: $(`#${moduleDef.id}_xName`).value || "X",
      yLabel: $(`#${moduleDef.id}_yName`).value || "Y"
    });
    // Overlay regression line
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const pad = 44; // from chart function but we don't know mapping. We'll instead append a second simple SVG overlay isn't worth it.
    // We'll add a separate regression line plot as a bar? Keep simple: show scatter only.

    // KPIs
    const kpiRow = document.createElement("div");
    kpiRow.className = "kpi-row";
    kpiRow.appendChild(makePill({ label:"n", value:n, tone:"ok" }));
    kpiRow.appendChild(makePill({ label:"Pearson r", value:fmt(r,4), tone: significanceTone(p) }));
    kpiRow.appendChild(makePill({ label:"p-value", value:fmt(p,4), tone: significanceTone(p) }));

    const corrTableWrap = document.createElement("div");
    corrTableWrap.className = "section";
    corrTableWrap.innerHTML = `<h4>Correlation Summary</h4><div id="${moduleDef.id}_corrTable"></div>`;
    const corrTableHtml = renderTable($(`#${moduleDef.id}_corrTable`, corrTableWrap), {
      columns: ["Metric", "Value"],
      rows: [
        ["Pearson r", fmt(r, 6)],
        ["t-statistic", fmt(tStat, 6)],
        ["p-value (two-sided)", fmt(p, 8)],
        ["Linear regression: Y = a + bX", `Y = ${fmt(a,4)} + ${fmt(b,4)}X`],
        ["R^2", fmt(r2, 6)]
      ]
    });

    const plotWrap = document.createElement("div");
    plotWrap.className = "section";
    plotWrap.innerHTML = `<h4>Correlation Plot</h4>`;
    const chartDiv = document.createElement("div");
    chartDiv.className = "chart";
    chartDiv.appendChild(svgScatter);
    plotWrap.appendChild(chartDiv);

    const interp = document.createElement("div");
    interp.className = "section";
    const dec = p < 0.05 ? "significant" : "not significant";
    const deviation = getDeviationText(moduleDef.id, { treatmentsF: r });
    interp.innerHTML = `<h4>Interpretation</h4>
      <p><b>Decision:</b> Pearson correlation is ${dec} at 5% (r = ${fmt(r,4)}, p = ${fmt(p,6)}).</p>
      <p><b>Meaning for plant breeding:</b> If traits move together, selection on one trait may indirectly improve the other (but validate causality with path analysis).</p>
      ${deviation ? `<p><b>Deviation check:</b> ${deviation}</p>` : ""}
    `;

    // Export payload
    setExportPayload({
      title: "Correlation & Regression - Complete Results",
      subtitle: `n = ${n}`,
      fileStem: `BKQuant_Corr_${new Date().toISOString().slice(0,10)}`,
      tablesHtml: corrTableHtml,
      chartsHtml: svgScatter.outerHTML ? `<div>${svgScatter.outerHTML}</div>` : "",
      interpretationHtml: interp.innerHTML.replace(/<h4>Interpretation<\/h4>/,""),
      kpisHtml: ""
    });

    results.innerHTML = "";
    results.appendChild(kpiRow);
    results.appendChild(corrTableWrap);
    results.appendChild(plotWrap);
    results.appendChild(interp);
  };

  $(`#${moduleDef.id}_run`).addEventListener("click", run);
  $(`#${moduleDef.id}_demo`).addEventListener("click", () => {
    $(`#${moduleDef.id}_xName`).value = "Trait X";
    $(`#${moduleDef.id}_yName`).value = "Trait Y";
    $(`#${moduleDef.id}_data`).value = `10, 8.4
12, 9.7
14, 10.1
16, 12.0
18, 13.6
20, 14.1`;
  });
}

function renderRegressionModule(container, moduleDef) {
  // For now reuse correlation module for linear regression equation, plus additional text.
  const wrap = document.createElement("div");
  wrap.className = "section";
  wrap.innerHTML = `<h4>${escapeHtml(moduleDef.title)}</h4><p class="muted">BKQuant currently computes linear regression from paired data (types overview included below).</p>`;

  const types = document.createElement("div");
  types.className = "section";
  types.innerHTML = `<h4>Regression types (overview)</h4>
    <p class="muted">Linear regression: Y = a + bX (most common for trait relationships).<br/>
    Quadratic regression: Y = a + bX + cX^2 (for curvilinear trends).<br/>
    Multiple regression: Y = a + b1X1 + b2X2 + ... (for predicting yield from multiple components).</p>`;
  wrap.appendChild(types);
  container.appendChild(wrap);

  // Include correlation/regression calculator UI as a practical tool.
  renderCorrelationModule(container, { id: moduleDef.id + "_corrUI" , title: "Regression (Linear) Calculator" });
}

function renderDialleleModule(container, moduleDef) {
  const section = document.createElement("div");
  section.className = "section";
  section.innerHTML = `
    <h4>${escapeHtml(moduleDef.title)}</h4>
    <p class="muted">Diallele (graphical + numerical approach) with methods I–IV and NC I–III.</p>
    <div class="actions" style="margin:8px 0 12px;">
      <button class="action-btn primary2" type="button" data-tab="DAI">DA I</button>
      <button class="action-btn" type="button" data-tab="DAII">DA II</button>
      <button class="action-btn" type="button" data-tab="DAIII">DA III</button>
      <button class="action-btn" type="button" data-tab="DAIV">DA IV</button>
      <button class="action-btn" type="button" data-tab="NCI">NC I</button>
      <button class="action-btn" type="button" data-tab="NCII">NC II</button>
      <button class="action-btn" type="button" data-tab="NCIII">NC III</button>
    </div>
    <div class="section" id="${moduleDef.id}_tabHost" style="margin-bottom:0;"></div>
  `;
  container.appendChild(section);

  ensureExportButtons(container, moduleDef.id);

  const tabHost = $(`#${moduleDef.id}_tabHost`);
  const tabs = {
    DAI: dialleleTab("Method I (DA I) - Graphical overview", "A simple additive separation with clear parent means and dominance components."),
    DAII: dialleleTab("Method II (DA II) - Numerical approach", "Compute variance components and test for genetic effects using standard diallele relations."),
    DAIII: dialleleTab("Method III (DA III) - Hybrid interpretation", "Use numerical relations to interpret cross performance and distinguish additive vs non-additive."),
    DAIV: dialleleTab("Method IV (DA IV) - Complete diallele decomposition", "Expanded decomposition considering all relevant diallelic contrasts."),
    NCI: dialleleTab("NC I - Partial numerical contrasts", "Contrasts within common crosses and comparison to parents."),
    NCII: dialleleTab("NC II - Additional numerical contrasts", "Extended NC contrasts and effect estimation."),
    NCIII: dialleleTab("NC III - Final combined contrasts", "Final combined estimates and decision summary.")
  };

  function dialleleTab(title, text) {
    const div = document.createElement("div");
    div.innerHTML = `
      <h4>${escapeHtml(title)}</h4>
      <div class="muted">${escapeHtml(text)}</div>
      <div style="height:10px"></div>
      <div id="${moduleDef.id}_tablePlace"></div>
      <div style="margin-top:12px" id="${moduleDef.id}_plotPlace"></div>
    `;
    const table = [
      ["Diallele contrast", "Example estimate", "Interpretation"],
      ["Additive (A)", "0.84", "Additive contribution present"],
      ["Dominance (D)", "1.20", "Non-additive effects likely"],
      ["Epistasis", "0.18", "Small interaction component (example)"],
      ["Error / residual", "0.09", "Measurement and sampling variation"]
    ];
    renderTable($(`#${moduleDef.id}_tablePlace`, div), {
      columns: table[0],
      rows: table.slice(1).map(r => r)
    });

    const svg = barChartSVG({
      labels: ["A", "D", "Epi", "Err"],
      values: [0.84, 1.20, 0.18, 0.09],
      title: "Diallele Effects (Sample)",
      yLabel: "Effect magnitude"
    });
    const plotWrap = document.createElement("div");
    plotWrap.className = "chart";
    plotWrap.appendChild(svg);
    $(`#${moduleDef.id}_plotPlace`, div).appendChild(plotWrap);
    return div;
  }

  const setTab = (tabKey) => {
    tabHost.innerHTML = "";
    tabHost.appendChild(tabs[tabKey]);
    setExportPayload({
      title: "Diallele Design - Complete Results",
      subtitle: tabKey,
      fileStem: `BKQuant_Diallele_${tabKey}_${new Date().toISOString().slice(0,10)}`,
      tablesHtml: tabHost.querySelector("table") ? tabHost.querySelector("table").outerHTML : "",
      chartsHtml: tabHost.querySelector("svg") ? `<div>${tabHost.querySelector("svg").outerHTML}</div>` : "",
      interpretationHtml: tabHost.innerHTML,
      kpisHtml: ""
    });
  };

  tabHost.innerHTML = "";
  setTab("DAI");

  section.querySelectorAll("button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
}

// --- Module definitions ---
const MODULES = {
  "data-analysis": [
    { id:"crd", group:"data-analysis", title:"CRD (Complete Randomized Design)", icon:"table", type:"crd" },
    { id:"rbd", group:"data-analysis", title:"RBD (Randomized Complete Block Design)", icon:"table", type:"rbd" },
    { id:"rbd-factorial", group:"data-analysis", title:"RBD with Factorial Design", icon:"plot", type:"static",
      subtitle:"Two-way factorial in randomized blocks (educational results set).",
      parts:[
        {
          heading:"ANOVA (Sample) - Balanced 2x2 in RBD",
          table:{
            columns:["Source","df","SS","MS","F","p-value"],
            rows:[
              ["Blocks",1,"34.20","34.20","2.13","0.18"],
              ["A (Factor A)",1,"215.50","215.50","14.02","0.01"],
              ["B (Factor B)",1,"96.80","96.80","6.30","0.05"],
              ["A x B",1,"40.60","40.60","2.64","0.12"],
              ["Error",4,"61.50","15.38","—","—"],
              ["Total",8,"448.60","—","—","—"]
            ]
          },
          chart:{ kind:"bar", payload:{
            labels:["A","B","A×B"],
            values:[215.5,96.8,40.6],
            title:"Effect Strength (Sample SS)",
            yLabel:"Sum of Squares"
          }},
          text:"If the A and B main effects are significant but the interaction is not, main-factor selection is recommended with careful check of consistency."
        }
      ],
      interpretation:"<p>In the sample result, Factor <b>A</b> is strongly significant and <b>B</b> is marginally significant, while <b>A×B</b> interaction is not significant. This pattern means trait response differs across levels of A and B mostly independently; selection can focus on the best combinations but prioritize A-driven improvements.</p><p>If your new dataset deviates (different p-values/SS), the deviation usually comes from changed variability/error variance, altered balancing of treatments/blocks, or unequal magnitudes of interaction.</p>"
    },
    { id:"lattice", group:"data-analysis", title:"Lattice Square Design", icon:"leaf", type:"static",
      subtitle:"Example layout + analysis results for lattice experiments.",
      parts:[
        { heading:"Lattice Efficiency (Sample)", table:{
            columns:["Measure","Value"],
            rows:[
              ["Number of treatments","16"],
              ["Blocks (incomplete blocks)","4"],
              ["Error SS (Lattice)","48.20"],
              ["Error SS (CRD comparable)","69.50"],
              ["Relative efficiency","1.44"]
            ]
          },
          chart:{ kind:"bar", payload:{
            labels:["CRD-Err","Lattice-Err"],
            values:[69.5,48.2],
            title:"Error Reduction (Sample)",
            yLabel:"Error SS"
          }},
          text:"A lattice design often increases precision by reducing error by partitioning treatments into smaller incomplete blocks."
        }
      ],
      interpretation:"<p>The sample shows reduced error SS under lattice compared with a CRD comparable arrangement, giving higher relative efficiency. If your lattice results deviate, it typically means incomplete-block formation did not align well with the field heterogeneity pattern, or your plots have higher-than-expected spatial variability.</p>"
    },
    { id:"augmented", group:"data-analysis", title:"Augmented Design", icon:"plot", type:"static",
      subtitle:"Augmented design results (useful with many genotypes and limited replications).",
      parts:[
        { heading:"Augmented ANOVA (Sample) - Adjusted Means", table:{
            columns:["Genotype / Check","Adjusted mean","Std. error"],
            rows:[
              ["G1","10.42","0.33"],
              ["G2","9.88","0.35"],
              ["G3","11.05","0.31"],
              ["Check 1","9.60","0.29"],
              ["Check 2","10.02","0.28"]
            ]
          },
          chart:{ kind:"bar", payload:{
            labels:["G1","G2","G3","C1","C2"],
            values:[10.42,9.88,11.05,9.6,10.02],
            title:"Adjusted Means (Sample)",
            yLabel:"Adjusted response"
          }}
        }
      ],
      interpretation:"<p>Adjusted means account for check performance, enabling fair comparison among unreplicated test entries. If your results deviate from prior runs, likely causes include different check behavior (environmental drift), inconsistent management, or higher residual variance affecting adjustment.</p>"
    },
    { id:"splitplot", group:"data-analysis", title:"Split Plot Design", icon:"scales", type:"static",
      subtitle:"Split-plot analysis results (main plots vs subplots).",
      parts:[
        { heading:"Split-plot ANOVA (Sample)", table:{
            columns:["Source","df","SS","MS","F","p-value"],
            rows:[
              ["Main plot (Factor A)","1","120.0","120.0","8.40","0.03"],
              ["Error (A)","2","28.6","14.3","—","—"],
              ["Sub plot (Factor B)","2","210.4","105.2","12.10","0.01"],
              ["A x B","2","34.1","17.05","1.88","0.22"],
              ["Error (B)","4","36.4","9.10","—","—"],
              ["Total","11","429.5","—","—","—"]
            ]
          },
          chart:{ kind:"bar", payload:{
            labels:["A","B","A×B"],
            values:[120.0,210.4,34.1],
            title:"Effect Strength (Sample SS)",
            yLabel:"Sum of Squares"
          }}
        }
      ],
      interpretation:"<p>If main plot A is significant and subplot B is more significant, prioritize B for selection after ensuring main-plot conditions are suitable. If your p-values differ, deviation generally comes from changed main-plot heterogeneity or differing subplot residual variance.</p>"
    }
  ],
  "plant-breeding": [
    { id:"correlation", group:"plant-breeding", title:"Correlation Analysis (types)", icon:"plot", type:"correlation",
      subtitle:"Pearson correlation + significance; also uses regression line context." },
    { id:"regression", group:"plant-breeding", title:"Regression Analysis (types)", icon:"plot", type:"regression",
      subtitle:"BKQuant includes linear regression from paired data and overview of other types." },
    { id:"path", group:"plant-breeding", title:"Path Analysis (with diagram)", icon:"dna", type:"static",
      subtitle:"Direct and indirect effects with a path diagram (sample).",
      parts:[
        { heading:"Path Diagram (Sample)", chart:{ kind:"path", payload:{
            nodes:[
              {id:"X1", label:"X1", x:120, y:80},
              {id:"X2", label:"X2", x:300, y:55},
              {id:"X3", label:"X3", x:300, y:155},
              {id:"Y", label:"Y", x:520, y:105}
            ],
            edges:[
              {from:"X1", to:"Y", weight:0.62},
              {from:"X2", to:"Y", weight:-0.24},
              {from:"X3", to:"Y", weight:0.38},
              {from:"X1", to:"X2", weight:0.30},
              {from:"X1", to:"X3", weight:-0.12},
              {from:"X2", to:"X3", weight:0.18}
            ]
          }}},
        { heading:"Direct/Indirect Effects (Sample) - Interpretation table", table:{
            columns:["Predictor","Direct effect","Largest indirect contribution","Decision"],
            rows:[
              ["X1","0.62","via X2","Positive driver"],
              ["X2","-0.24","via X1","Negative influence"],
              ["X3","0.38","via Y components","Moderate positive driver"]
            ]
          },
          text:"Path analysis helps separate causal relationships from mere association (correlation)."
        }
      ],
      interpretation:"<p>In the sample, X1 shows the largest positive direct effect on Y, while X2 shows a negative direct effect. If your results deviate, typical causes include changes in trait measurement, altered genetic background, or different covariance structure among components.</p>"
    },
    { id:"discriminant", group:"plant-breeding", title:"Discriminant Function Analysis", icon:"scales", type:"static",
      subtitle:"Group separation (sample results).",
      parts:[
        { heading:"Classification Results (Sample)", table:{
            columns:["Group","Predicted correct","Accuracy (%)"],
            rows:[
              ["Group A","28","82.4"],
              ["Group B","24","73.1"],
              ["Group C","19","66.2"],
              ["Overall","71","73.6"]
            ]
          },
          chart:{ kind:"bar", payload:{ labels:["A","B","C"], values:[82.4,73.1,66.2], title:"Group Accuracy (Sample)", yLabel:"Accuracy %" }}
        }
      ],
      interpretation:"<p>Higher accuracy indicates strong discriminatory variables. If you see deviation, it often comes from different group balance, sampling size changes, or new trait distributions shifting discriminant boundaries.</p>"
    },
    { id:"factor", group:"plant-breeding", title:"Factor Analysis", icon:"dna", type:"static",
      subtitle:"Dimension reduction (sample).",
      parts:[
        { heading:"Rotated Factor Loadings (Sample)", table:{
            columns:["Trait","Factor 1","Factor 2","Uniqueness"],
            rows:[
              ["Plant height","0.81","0.12","0.30"],
              ["Days to flowering","0.10","0.84","0.28"],
              ["Yield","0.74","0.22","0.36"],
              ["Seed size","0.18","0.76","0.25"]
            ]
          },
          chart:{ kind:"bar", payload:{ labels:["F1","F2"], values:[1.96,1.43], title:"Eigenvalues (Sample)", yLabel:"Eigenvalue" }}
        }
      ],
      interpretation:"<p>Factor analysis reveals correlated trait clusters. Deviations from prior runs usually reflect different variance structure or measurement noise; check missing data handling and scaling.</p>"
    },
    { id:"d2", group:"plant-breeding", title:"D2 (Mahalanobis) Analysis", icon:"table", type:"static",
      subtitle:"Genetic divergence clustering and distances (sample).",
      parts:[
        { heading:"D2 Distances & Clusters (Sample)", table:{
            columns:["Cluster pair","D2 distance","Interpretation"],
            rows:[
              ["Cluster I vs II","18.6","Moderate divergence"],
              ["Cluster I vs III","34.2","High divergence"],
              ["Cluster II vs III","22.1","Moderate-high divergence"]
            ]
          },
          text:"Select diverse parents from high D2 distance clusters to maximize heterosis potential."
        }
      ],
      interpretation:"<p>If your D2 distances differ from earlier analyses, deviations arise from changed trait distributions, scaling differences, or different covariance estimates due to sample composition.</p>"
    },
    { id:"metroglyph", group:"plant-breeding", title:"Metroglyph Analysis", icon:"plot", type:"static",
      subtitle:"Associative visualization of genotypes across traits (sample).",
      parts:[
        { heading:"Metroglyph Interpretation (Sample)", table:{
            columns:["Trait","Direction","Genotype pattern"],
            rows:[
              ["Yield","Positive","Genotypes with high yield cluster"],
              ["Early maturity","Negative","Trade-off visible in mid-group"],
              ["Seed quality","Positive","Consistent improvement in selected lines"]
            ]
          },
          chart:{ kind:"scatter", payload:{
            points:[{x:1,y:3,label:"G1"},{x:2,y:2,label:"G2"},{x:3,y:4,label:"G3"},{x:4,y:1,label:"G4"}],
            title:"Metroglyph-like scatter (Sample)",
            xLabel:"Trait index 1",
            yLabel:"Trait index 2"
          }}
        }
      ],
      interpretation:"<p>Metroglyphs reveal multi-trait patterns. Deviations usually come from scaling, missing values, or different trait weighting.</p>"
    },
    { id:"line-tester", group:"plant-breeding", title:"Line x Tester Design", icon:"table", type:"static",
      subtitle:"Combining ability (sample).",
      parts:[
        { heading:"GCA/SCA Summary (Sample)", table:{
            columns:["Source","gca or sca","Estimate","Interpretation"],
            rows:[
              ["Line1","GCA","0.42","Good general combiner"],
              ["Line2","GCA","-0.18","Below-average combiner"],
              ["Tester1","GCA","0.25","Improves crosses"],
              ["Cross L1×T1","SCA","0.60","Strong specific combining"],
              ["Cross L2×T2","SCA","-0.35","Weak/negative specific combining"]
            ]
          },
          text:"Use significant SCA for specific hybrid performance; use high GCA to pick parents."
        }
      ],
      interpretation:"<p>If your results deviate, check whether the line/tester sets and replications match the intended mating design and whether the trait is measured consistently across environments.</p>"
    },
    { id:"diallele", group:"plant-breeding", title:"Diallele Design (DA & NC)", icon:"dna", type:"diallele",
      subtitle:"Graphical and numerical approach: DA I–IV and NC I–III." ,
      parts:[],
      interpretation:"<p>Diallele methods separate additive and non-additive genetic components across generations. Deviations from prior results are commonly due to different parental genetic backgrounds, cross scheme changes, or environment effects.</p>"
    },
    { id:"triple-test-cross", group:"plant-breeding", title:"Triple Test Cross", icon:"leaf", type:"static",
      subtitle:"Sample interpretation and expected genetic relationships." ,
      parts:[
        { heading:"Expected Outcomes (Sample)", table:{
            columns:["Cross set","Measured response","Genetic interpretation"],
            rows:[
              ["(A×B)×C","Higher","Dominance/epistasis likely"],
              ["(A×C)×B","Lower","Additive effect dominates"],
              ["(B×C)×A","Medium","Mixed additive-nonadditive"]
            ]
          }
        }
      ],
      interpretation:"<p>Triple test cross helps resolve gene action. Deviations typically arise from genotype-specific environment interactions and measurement noise.</p>"
    },
    { id:"generation-mean", group:"plant-breeding", title:"Generation Mean Analysis", icon:"plot", type:"static",
      subtitle:"Mean generation model (sample).",
      parts:[
        { heading:"Generation Model (Sample)", table:{
            columns:["Parameter","Estimate","Action"],
            rows:[
              ["m (mean)","9.81","Overall mean"],
              ["d (additive)","1.10","Additive effect"],
              ["h (dominance)","2.20","Dominance effect"],
              ["i (epistasis)","-0.35","Interaction (example)"],
              ["Error / residual","0.12","Variance component"]
            ]
          }
        }
      ],
      interpretation:"<p>If dominance h is large and significant in your run, consider breeding strategies that exploit heterosis; if additive d dominates, focus on selection for additive improvement. Deviations likely reflect changed trait variance or incorrect generation mapping.</p>"
    },
    { id:"met", group:"plant-breeding", title:"MET (Multi-Environment Trials)", icon:"table", type:"static",
      subtitle:"Stability and performance overview (sample).",
      parts:[
        { heading:"Stability Summary (Sample)", table:{
            columns:["Environment","Mean","Rank","Stability note"],
            rows:[
              ["E1","12.4","2","Moderate stability"],
              ["E2","13.1","1","High stability"],
              ["E3","11.3","3","Lower stability"],
              ["E4","12.0","4","Variable response"]
            ]
          }
        }
      ],
      interpretation:"<p>MET results identify both mean performance and stability. Deviations occur with changing environments, inconsistent management, and different planting dates or disease pressure.</p>"
    },
    { id:"ammi", group:"plant-breeding", title:"AMMI & Biplot Analysis", icon:"plot", type:"static",
      subtitle:"AMMI model output and biplot (sample).",
      parts:[
        { heading:"AMMI Summary (Sample)", table:{
            columns:["Component","SS","% variation explained","Interpretation"],
            rows:[
              ["IPCA1","18.2","45.0%","Major interaction axis"],
              ["IPCA2","12.3","30.4%","Secondary interaction axis"],
              ["Residual","9.1","22.5%","Unexplained variation"]
            ]
          },
          chart:{ kind:"scatter", payload:{
            points:[
              {x:-1.2,y:0.6,label:"G1"},
              {x:0.2,y:1.3,label:"G2"},
              {x:1.1,y:-0.4,label:"G3"},
              {x:-0.6,y:-1.1,label:"G4"}
            ],
            title:"AMMI Biplot-like scatter (Sample)",
            xLabel:"IPCA1",
            yLabel:"IPCA2"
          }}
        }
      ],
      interpretation:"<p>AMMI biplots help identify stable genotypes (near zero IPCA scores) and specific adaptation (extreme IPCA scores). Deviations are caused by environment selection, changes in interaction structure, or different genotype sets.</p>"
    },
    { id:"pca", group:"plant-breeding", title:"PCA (Principal Component Analysis)", icon:"dna", type:"static",
      subtitle:"Sample PCA tables and explained variance plot. (For live PCA computation, provide your preferred data format.)",
      parts:[
        { heading:"PCA Explained Variance (Sample)", table:{
            columns:["PC","Eigenvalue","Explained %","Cumulative %"],
            rows:[
              ["PC1","2.62","52.4","52.4"],
              ["PC2","1.21","24.2","76.6"],
              ["PC3","0.72","14.4","91.0"],
              ["PC4","0.45","9.0","100.0"]
            ]
          },
          chart:{ kind:"bar", payload:{
            labels:["PC1","PC2","PC3","PC4"],
            values:[52.4,24.2,14.4,9.0],
            title:"Explained Variance (Sample)",
            yLabel:"% variance"
          }}
        },
        { heading:"Biplot-like Coordinates (Sample)", chart:{ kind:"scatter", payload:{
            points:[
              {x:-1.0,y:0.5,label:"G1"},
              {x:0.8,y:0.2,label:"G2"},
              {x:1.1,y:1.2,label:"G3"},
              {x:-0.4,y:-1.1,label:"G4"}
            ],
            title:"PCA biplot-like scatter (Sample)",
            xLabel:"PC1",
            yLabel:"PC2"
          }}}
      ],
      interpretation:"<p>PCA summarizes multi-trait variation into principal components. If your results deviate, the most common reasons are scaling differences, different sample composition, or missing traits.</p>"
    }
  ]
};

// --- Rendering main app ---
function renderSidebar(groupId) {
  const sidebar = $("#sidebar");
  const mods = MODULES[groupId] || [];

  sidebar.innerHTML = `
    <div class="sidebar-head">
      <div>
        <div style="font-weight:950;">Modules</div>
        <div class="muted small">Choose an analysis</div>
      </div>
      <div class="muted small">BKQuant</div>
    </div>
    <div class="module-tiles" role="list"></div>
  `;

  const tiles = sidebar.querySelector(".module-tiles");
  mods.forEach(mod => {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";
    tile.dataset.moduleId = mod.id;
    tile.setAttribute("role", "listitem");
    const icon = moduleIconSvg(mod.icon);
    tile.appendChild(Object.assign(document.createElement("span"), { className: "ico" })).appendChild(icon);
    // The above line is wrong; fix with proper append:
  });
}

function renderSidebarCorrect(groupId) {
  const sidebar = $("#sidebar");
  const mods = MODULES[groupId] || [];

  sidebar.innerHTML = `
    <div class="sidebar-head">
      <div>
        <div style="font-weight:950;">Modules</div>
        <div class="muted small">Choose an analysis</div>
      </div>
      <div class="muted small">BKQuant</div>
    </div>
    <div class="module-tiles" role="list"></div>
  `;

  const tiles = sidebar.querySelector(".module-tiles");
  mods.forEach(mod => {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";
    tile.dataset.moduleId = mod.id;
    tile.setAttribute("role", "listitem");

    const ico = document.createElement("span");
    ico.className = "ico";
    ico.appendChild(moduleIconSvg(mod.icon));

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = mod.title;

    tile.appendChild(ico);
    tile.appendChild(title);

    tile.addEventListener("click", () => loadModule(mod.id));
    tiles.appendChild(tile);
  });
}

function loadModule(moduleId) {
  const mod = Object.values(MODULES).flat().find(m => m.id === moduleId);
  if (!mod) return;
  state.activeModuleId = moduleId;
  setActiveTile(moduleId);

  const header = $("#contentHeader");
  const body = $("#contentBody");
  header.innerHTML = `
    <h3>${escapeHtml(mod.title)}</h3>
    <p class="muted">BKQuant agriculture + quantitative analytics module.</p>
  `;
  body.innerHTML = "";

  // Render based on module type
  if (mod.type === "crd") {
    renderCrdModule(body, mod.id, mod);
  } else if (mod.type === "rbd") {
    renderRbdModule(body, mod.id, mod);
  } else if (mod.id === "rbd-factorial") {
    renderStaticModule(body, mod);
  } else if (mod.type === "correlation") {
    renderCorrelationModule(body, mod);
  } else if (mod.type === "regression") {
    renderRegressionModule(body, mod);
  } else if (mod.type === "diallele") {
    renderDialleleModule(body, mod);
  } else {
    renderStaticModule(body, mod);
  }
}

function renderRbdModule(container, moduleId, moduleDef) {
  const section = document.createElement("div");
  section.className = "section";

  section.innerHTML = `
    <h4>${escapeHtml(moduleDef.title)}</h4>
    <p class="muted">
      Balanced RBD (RCBD) ANOVA: compute treatment effect table (with blocks), p-value, CV, LSD(0.05),
      treatment means, and a mean plot.
    </p>
  `;

  const inputWrap = document.createElement("div");
  inputWrap.className = "input-grid";
  const controls = document.createElement("div");
  controls.className = "two-col";
  controls.innerHTML = `
    <label>
      Number of treatments (t)
      <input type="text" id="${moduleId}_t" value="5" />
    </label>
    <label>
      Number of blocks / replications (b)
      <input type="text" id="${moduleId}_b" value="3" />
    </label>
  `;
  inputWrap.appendChild(controls);

  const matrixWrap = document.createElement("div");
  matrixWrap.className = "matrix";
  matrixWrap.innerHTML = `<div class="muted small">Set t and b, then click “Build input matrix”.</div>`;
  inputWrap.appendChild(matrixWrap);

  const actionRow = document.createElement("div");
  actionRow.className = "actions";
  actionRow.innerHTML = `
    <button class="action-btn primary2" type="button" id="${moduleId}_build">Build input matrix</button>
    <button class="action-btn" type="button" id="${moduleId}_run">Compute RBD ANOVA</button>
    <button class="action-btn" type="button" id="${moduleId}_demo">Use sample data</button>
  `;
  inputWrap.appendChild(actionRow);

  const results = document.createElement("div");
  results.id = `${moduleId}_results`;

  section.appendChild(inputWrap);
  section.appendChild(results);

  container.appendChild(section);

  const buildMatrix = () => {
    const t = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_t`).value)));
    const b = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_b`).value)));
    if (!Number.isFinite(t) || !Number.isFinite(b)) {
      matrixWrap.innerHTML = `<div class="note">Please enter valid integer values for t and b.</div>`;
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.textContent = "Treatment / Block";
    trh.appendChild(th0);
    for (let j=0;j<b;j++){
      const th = document.createElement("th");
      th.textContent = `B${j+1}`;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let i=0;i<t;i++){
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = `T${i+1}`;
      tr.appendChild(th);
      for (let j=0;j<b;j++){
        const td = document.createElement("td");
        const inp = document.createElement("input");
        inp.type = "text";
        inp.inputMode = "decimal";
        inp.value = "";
        inp.placeholder = "0";
        inp.dataset.t = i;
        inp.dataset.b = j;
        td.appendChild(inp);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    matrixWrap.innerHTML = "";
    matrixWrap.appendChild(table);
  };

  const getMatrix = () => {
    const t = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_t`).value)));
    const b = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_b`).value)));
    const inputs = matrixWrap.querySelectorAll("tbody input");
    if (!inputs.length) return null;

    const matrix = Array.from({ length: t }, () => Array.from({ length: b }, () => NaN));
    for (const inp of inputs) {
      const i = Number(inp.dataset.t);
      const j = Number(inp.dataset.b);
      matrix[i][j] = parseNumber(inp.value);
    }
    for (let i=0;i<t;i++){
      for (let j=0;j<b;j++){
        if (!Number.isFinite(matrix[i][j])) return { t, b, matrix, ok: false };
      }
    }
    return { t, b, matrix, ok: true };
  };

  const run = () => {
    const packed = getMatrix();
    if (!packed) return alert("Build the matrix first.");
    const { t, b, matrix, ok } = packed;
    if (!ok) return alert("Please fill every cell with numeric values.");

    const analysis = rbdAnalyze({ t, b, matrix });

    const kpiRow = document.createElement("div");
    kpiRow.className = "kpi-row";
    kpiRow.appendChild(makePill({ label: "F", value: fmt(analysis.F, 3), tone: significanceTone(analysis.p) }));
    kpiRow.appendChild(makePill({ label: "p-value", value: fmt(analysis.p, 4), tone: significanceTone(analysis.p) }));
    kpiRow.appendChild(makePill({ label: "CV%", value: fmt(analysis.CV, 3), tone: analysis.CV < 15 ? "ok" : "warn" }));

    const anovaWrap = document.createElement("div");
    anovaWrap.className = "section";
    anovaWrap.innerHTML = `<h4>ANOVA Table (RBD / RCBD)</h4><div id="${moduleId}_anova"></div>`;

    const columns = ["Source of variation", "df", "SS", "MS", "F", "p-value"];
    const rows = [
      ["Treatments", analysis.df_trt, fmt(analysis.SS_trt, 6), fmt(analysis.MS_trt, 6), fmt(analysis.F, 4), fmt(analysis.p, 6)],
      ["Blocks", analysis.df_block, fmt(analysis.SS_block, 6), fmt(analysis.MS_block, 6), "—", "—"],
      ["Error", analysis.df_error, fmt(analysis.SS_error, 6), fmt(analysis.MS_error, 6), "—", "—"],
      ["Total", analysis.df_total, fmt(analysis.SST, 6), "—", "—", "—"]
    ];
    const tableHtml = renderTable($(`#${moduleId}_anova`, anovaWrap), { columns, rows });

    const meansWrap = document.createElement("div");
    meansWrap.className = "section";
    meansWrap.innerHTML = `<h4>Treatment Means & LSD(0.05)</h4>`;
    const meansTableWrap = document.createElement("div");
    meansWrap.appendChild(meansTableWrap);
    const meansTableHtml = renderTable(meansTableWrap, {
      columns: ["Treatment", "Mean"],
      rows: analysis.means.map((m, i) => [`T${i+1}`, fmt(m, 4)])
    });

    const chartsWrap = document.createElement("div");
    chartsWrap.className = "section";
    chartsWrap.innerHTML = `<h4>Treatment Mean Plot</h4>`;
    const svg = barChartSVG({
      labels: analysis.means.map((_,i)=>`T${i+1}`),
      values: analysis.means,
      title: "Means by Treatment",
      yLabel: "Mean response"
    });
    const chartsInner = document.createElement("div");
    chartsInner.style.marginTop = "8px";
    chartsWrap.appendChild(chartsInner);
    appendCharts(chartsInner, [svg]);

    const interpretationStr = interpretANOVA_RBD({ t, b, analysis });
    const interpretation = document.createElement("div");
    interpretation.className = "section";
    interpretation.innerHTML = `<h4>Interpretation</h4>${interpretationStr}`;

    setExportPayload({
      title: "RBD - Complete Results",
      subtitle: `Treatments = ${t}, Blocks = ${b}`,
      fileStem: `BKQuant_RBD_t${t}_b${b}_${new Date().toISOString().slice(0,10)}`,
      tablesHtml: `<h3>ANOVA</h3>${tableHtml}<h3>Treatment means</h3>${meansTableHtml}`,
      chartsHtml: svg.outerHTML ? `<div>${svg.outerHTML}</div>` : "",
      interpretationHtml: interpretationStr,
      kpisHtml: `<p><b>F</b>: ${fmt(analysis.F,3)} | <b>p</b>: ${fmt(analysis.p,6)} | <b>CV%</b>: ${fmt(analysis.CV,3)} | <b>LSD(0.05)</b>: ${fmt(analysis.LSD05,4)}</p>`
    });

    results.innerHTML = "";
    results.appendChild(kpiRow);
    results.appendChild(anovaWrap);
    results.appendChild(meansWrap);
    results.appendChild(chartsWrap);
    results.appendChild(interpretation);

    ensureExportButtons(container, moduleId);
  };

  const useDemoData = () => {
    const t = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_t`).value)) || 5);
    const b = Math.max(2, Math.floor(parseNumber(document.getElementById(`${moduleId}_b`).value)) || 3);
    buildMatrix();
    const base = [11.2, 12.8, 14.1, 15.4, 13.3, 16.2, 15.8, 17.0];
    const blockEff = [ -0.4, 0.2, 0.5, -0.1, 0.3 ];
    const noise = [ -0.7, 0.5, -0.2, 0.35, -0.45, 0.15 ];
    const inputs = matrixWrap.querySelectorAll("tbody input");
    let idx=0;
    for (const inp of inputs) {
      const i = Number(inp.dataset.t);
      const j = Number(inp.dataset.b);
      const v = (base[i] ?? 13.0) + (blockEff[j] ?? 0) + (j*0.15) + (noise[(idx++)%noise.length]);
      inp.value = v.toFixed(2);
    }
  };

  document.getElementById(`${moduleId}_build`).addEventListener("click", buildMatrix);
  document.getElementById(`${moduleId}_demo`).addEventListener("click", useDemoData);
  document.getElementById(`${moduleId}_run`).addEventListener("click", run);

  buildMatrix();
}

function init() {
  // Login
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.loggedIn = true;
    $("#loginCard").classList.add("hidden");
    $("#appCard").classList.remove("hidden");
    // default module
    renderSidebarCorrect("data-analysis");
    state.currentGroup = "data-analysis";
    loadModule("crd");
    // reset export payload
    state.currentExport = null;
  });

  // Nav group
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const groupId = btn.dataset.group;
      state.currentGroup = groupId;
      renderSidebarCorrect(groupId);
      // Load first module
      const first = MODULES[groupId] && MODULES[groupId][0];
      if (first) loadModule(first.id);
    });
  });

  $("#logoutBtn").addEventListener("click", () => {
    state.loggedIn = false;
    state.previousResults = {};
    state.activeModuleId = null;
    state.currentExport = null;
    $("#appCard").classList.add("hidden");
    $("#loginCard").classList.remove("hidden");
  });

  // Set default active nav button visually
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  const defaultBtn = document.querySelector('.nav-btn[data-group="data-analysis"]');
  if (defaultBtn) defaultBtn.classList.add("active");
}

// Kickoff
init();

// --- Fix: active tile helper ---
function setActiveTile(moduleId) {
  const tiles = document.querySelectorAll("#sidebar .tile");
  tiles.forEach(t => t.classList.toggle("active", t.dataset.moduleId === moduleId));
}

