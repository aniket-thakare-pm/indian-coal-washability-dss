// Global state
let currentSamples = [];
let currentCalculation = null;

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", async () => {
  await fetchSamples();
  // Initialize with 2 cuts for IND_001
  setPresetMode(2);
  runCalculation();
});

async function fetchSamples() {
  try {
    const res = await fetch("/api/samples");
    currentSamples = await res.json();
    const select = document.getElementById("seamSelect");
    select.innerHTML = "";
    
    currentSamples.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.sample_id;
      opt.textContent = `${s.sample_id} (Feed Ash: ${s.feed_ash}%, ${s.n_fractions} fractions)`;
      select.appendChild(opt);
    });

    // Default to IND_001 if present
    if (currentSamples.some(s => s.sample_id === "IND_001")) {
      select.value = "IND_001";
    }

    select.addEventListener("change", onSeamChange);
  } catch (err) {
    console.error("Failed to load coal samples:", err);
  }
}

function onSeamChange() {
  const sid = document.getElementById("seamSelect").value;
  const sample = currentSamples.find(s => s.sample_id === sid);
  if (sample) {
    document.getElementById("feedAshInput").value = sample.feed_ash;
    setPresetMode(2); // auto load 2 representative cuts from sample
    runCalculation();
  }
}

function setPresetMode(cuts) {
  // Update buttons
  document.querySelectorAll(".btn-preset").forEach((btn, idx) => {
    btn.classList.toggle("active", idx === cuts);
  });

  const tbody = document.getElementById("cutTableBody");
  tbody.innerHTML = "";

  const sid = document.getElementById("seamSelect").value;
  const sample = currentSamples.find(s => s.sample_id === sid);

  if (cuts === 0) {
    // 0 cuts: Feed ash alone
    updatePointCount();
    return;
  }

  if (cuts === 1) {
    // 1 cut: around SG 1.58
    if (sample && sample.fractions.length >= 6) {
      const f = sample.fractions[Math.min(5, sample.fractions.length - 1)];
      addCutRow(f.sg_midpoint, f.cum_yield, f.cum_ash);
    } else {
      addCutRow(1.575, 59.74, 20.31);
    }
  } else if (cuts === 2) {
    // 2 cuts: around SG 1.42 and SG 1.75
    if (sample && sample.fractions.length >= 8) {
      const f1 = sample.fractions[2];
      const f2 = sample.fractions[7];
      addCutRow(f1.sg_midpoint, f1.cum_yield, f1.cum_ash);
      addCutRow(f2.sg_midpoint, f2.cum_yield, f2.cum_ash);
    } else {
      addCutRow(1.425, 25.82, 15.41);
      addCutRow(1.750, 75.49, 44.17);
    }
  }
  updatePointCount();
}

function addCutRow(sg = 1.50, yieldVal = 50.0, ashVal = 20.0) {
  const tbody = document.getElementById("cutTableBody");
  const rowCount = tbody.children.length + 1;
  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td>${rowCount}</td>
    <td><input type="number" step="0.005" class="input-sg" value="${sg}"></td>
    <td><input type="number" step="0.1" class="input-yield" value="${yieldVal}"></td>
    <td><input type="number" step="0.1" class="input-ash" value="${ashVal}"></td>
    <td><button type="button" class="btn-del" onclick="deleteCutRow(this)">×</button></td>
  `;
  tbody.appendChild(tr);
  updatePointCount();
}

function deleteCutRow(btn) {
  btn.closest("tr").remove();
  // renumber
  const rows = document.querySelectorAll("#cutTableBody tr");
  rows.forEach((r, i) => r.children[0].textContent = i + 1);
  updatePointCount();
}

function updatePointCount() {
  const count = document.querySelectorAll("#cutTableBody tr").length;
  const text = document.getElementById("pointCountText");
  const badge = document.getElementById("calibrationBadge");

  if (count === 0) {
    text.textContent = "0 Cuts (Prior Mode)";
    badge.textContent = "Empirical Prior";
    badge.style.background = "#EEF2F6";
    badge.style.color = "#334155";
  } else if (count === 1) {
    text.textContent = "1 Cut Anchor Defined";
    badge.textContent = "1-Cut Anchored";
    badge.style.background = "#FEF3C7";
    badge.style.color = "#92400E";
  } else if (count === 2) {
    text.textContent = "2 Cuts (Exact Analytical)";
    badge.textContent = "2-Cut Analytical";
    badge.style.background = "#E0F2FE";
    badge.style.color = "#0369A1";
  } else {
    text.textContent = `${count} Cuts Defined`;
    badge.textContent = `Multi-Cut (${count})`;
    badge.style.background = "#DCFCE7";
    badge.style.color = "#166534";
  }
}

async function runCalculation() {
  const feedAsh = parseFloat(document.getElementById("feedAshInput").value) || 36.16;
  const sampleId = document.getElementById("seamSelect").value || null;

  // Gather cuts
  const rows = document.querySelectorAll("#cutTableBody tr");
  const cut_points = [];
  rows.forEach(r => {
    const sg = parseFloat(r.querySelector(".input-sg").value);
    const y = parseFloat(r.querySelector(".input-yield").value);
    const a = parseFloat(r.querySelector(".input-ash").value);
    if (!isNaN(sg) && !isNaN(y)) {
      cut_points.push({ sg: sg, yield_pct: y, ash_pct: isNaN(a) ? null : a });
    }
  });

  const payload = {
    feed_ash: feedAsh,
    sample_id: sampleId,
    target_clean_ash: 17.0,
    cut_points: cut_points
  };

  try {
    document.getElementById("btnCalculate").textContent = "Calculating...";
    const res = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    currentCalculation = data;

    // Update KPIs
    document.getElementById("kpiD50").textContent = `${data.kpis.cut_density_d50} g/cm³`;
    document.getElementById("kpiYield").textContent = `${data.kpis.clean_coal_yield}%`;
    document.getElementById("kpiAsh").textContent = `${data.kpis.clean_coal_ash}%`;
    document.getElementById("kpiNGM").textContent = `${data.kpis.near_gravity_material}% (${data.kpis.ngm_classification})`;
    
    if (data.metrics.uncertainty_drop_pct) {
      document.getElementById("kpiError").textContent = `-${data.metrics.uncertainty_drop_pct}% (MAE: ${data.metrics.yield_mae}%)`;
    } else if (data.metrics.yield_mae) {
      document.getElementById("kpiError").textContent = `MAE: ${data.metrics.yield_mae}%`;
    } else {
      document.getElementById("kpiError").textContent = "Baseline Prior";
    }

    // Update Status Bar
    document.getElementById("statusText").textContent = `${data.calibration_mode} (${data.calculation_time_ms} ms)`;
    document.getElementById("statusFeedAsh").textContent = `${feedAsh}%`;
    document.getElementById("statusParams").textContent = `μ=${data.parameters.mu}, σ=${data.parameters.sigma}, a=${data.parameters.a}, b=${data.parameters.b}`;

    // Render Plotly Chart
    renderPlotlyChart(data);

    // Populate Tabular Schedule
    renderScheduleTable(data.spectrum);

  } catch (err) {
    console.error("Calculation failed:", err);
  } finally {
    document.getElementById("btnCalculate").textContent = "▶ Calculate Washability Curves";
  }
}

function renderPlotlyChart(data) {
  const spec = data.spectrum;
  const traces = [];

  // 1. Elementary Ash Curve (frac_ash vs cum_float_yield) -> Bottom X, Left Y
  traces.push({
    x: spec.frac_ash,
    y: spec.cum_float_yield,
    name: "Elementary Ash Curve",
    type: "scatter",
    mode: "lines",
    line: { color: "#2563EB", width: 2.2, dash: "dot" },
    xaxis: "x",
    yaxis: "y",
    visible: document.getElementById("chkElementary").checked ? true : false
  });

  // 2. Cumulative Floats Curve (cum_float_ash vs cum_float_yield) -> Bottom X, Left Y
  traces.push({
    x: spec.cum_float_ash,
    y: spec.cum_float_yield,
    name: "Cumulative Floats (Clean Coal)",
    type: "scatter",
    mode: "lines",
    line: { color: "#DC2626", width: 2.8 },
    xaxis: "x",
    yaxis: "y",
    visible: document.getElementById("chkFloat").checked ? true : false
  });

  // 3. Cumulative Sinks Curve (cum_sink_ash vs cum_float_yield) -> Bottom X, Left Y
  traces.push({
    x: spec.cum_sink_ash,
    y: spec.cum_float_yield,
    name: "Cumulative Sinks (Discard)",
    type: "scatter",
    mode: "lines",
    line: { color: "#D97706", width: 2.2, dash: "dash" },
    xaxis: "x",
    yaxis: "y",
    visible: document.getElementById("chkSink").checked ? true : false
  });

  // 4. Density - Yield Curve (rho vs cum_float_yield) -> Top X2, Left Y
  traces.push({
    x: spec.rho,
    y: spec.cum_float_yield,
    name: "Density – Yield Curve",
    type: "scatter",
    mode: "lines",
    line: { color: "#059669", width: 2.5 },
    xaxis: "x2",
    yaxis: "y",
    visible: document.getElementById("chkDensity").checked ? true : false
  });

  // 5. Overlay Measured Lab Data Points
  if (data.actual_points && data.actual_points.length > 0) {
    const act = data.actual_points;
    traces.push({
      x: act.map(p => p.cum_ash),
      y: act.map(p => p.cum_yield),
      name: "Actual Lab Floats (Ground Truth)",
      type: "scatter",
      mode: "markers",
      marker: { size: 8, color: "#1E293B", symbol: "circle", line: { width: 1.5, color: "#FFFFFF" } },
      xaxis: "x",
      yaxis: "y",
      visible: document.getElementById("chkOverlayActual").checked ? true : false
    });

    traces.push({
      x: act.map(p => p.sg_midpoint),
      y: act.map(p => p.cum_yield),
      name: "Actual Density Cuts",
      type: "scatter",
      mode: "markers",
      marker: { size: 9, color: "#7C3AED", symbol: "diamond", line: { width: 1.5, color: "#FFFFFF" } },
      xaxis: "x2",
      yaxis: "y",
      visible: document.getElementById("chkOverlayActual").checked ? true : false
    });
  }

  // 4-Axis Standard Layout
  const layout = {
    margin: { l: 65, r: 65, t: 65, b: 55 },
    font: { family: "Segoe UI, sans-serif", size: 11 },
    showlegend: true,
    legend: {
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: -0.15,
      font: { size: 10 }
    },
    // Primary Left Y-axis (Inverted 0 at top -> 100 at bottom)
    yaxis: {
      title: "<b>Cumulative Wt % Floats (Recovery)</b>",
      range: [100, 0], // Inverted
      showgrid: true,
      gridcolor: "#E2E8F0",
      zeroline: false
    },
    // Secondary Right Y-axis (Inverted 100 at top -> 0 at bottom)
    yaxis2: {
      title: "<b>Cumulative Wt % Sinks (Discard)</b>",
      range: [0, 100], // Sinks scale
      overlaying: "y",
      side: "right",
      showgrid: false,
      zeroline: false
    },
    // Primary Bottom X-axis (Ash % 0 to 100)
    xaxis: {
      title: "<b>Ash % (Air-Dried Basis)</b>",
      range: [0, 100],
      showgrid: true,
      gridcolor: "#E2E8F0",
      zeroline: false
    },
    // Secondary Top X-axis (Relative Density 2.2 on left down to 1.3 on right - Inverted!)
    xaxis2: {
      title: "<b>Relative Density (Specific Gravity, g/cm³)</b>",
      range: [2.2, 1.25], // Inverted
      overlaying: "x",
      side: "top",
      showgrid: false,
      zeroline: false
    }
  };

  Plotly.newPlot("chartContainer", traces, layout, { responsive: true, displayModeBar: true });
}

function updateCurveVisibility() {
  if (!currentCalculation) return;
  renderPlotlyChart(currentCalculation);
}

function renderScheduleTable(spec) {
  const tbody = document.getElementById("scheduleTableBody");
  tbody.innerHTML = "";

  // Pick ~20 representative density cuts
  const step = Math.floor(spec.rho.length / 22);
  for (let i = 0; i < spec.rho.length; i += step) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${spec.rho[i]}</strong></td>
      <td>${spec.cum_float_yield[i]}</td>
      <td>${spec.frac_ash[i]}</td>
      <td style="color: #DC2626; font-weight: bold;">${spec.cum_float_ash[i]}</td>
      <td>${spec.cum_sink_yield[i]}</td>
      <td>${spec.cum_sink_ash[i]}</td>
    `;
    tbody.appendChild(tr);
  }
}

function switchView(view) {
  const chartEl = document.getElementById("chartContainer");
  const tableEl = document.getElementById("scheduleContainer");
  const btns = document.querySelectorAll(".view-tab-btn");

  if (view === "chart") {
    chartEl.style.display = "block";
    tableEl.style.display = "none";
    btns[0].classList.add("active");
    btns[1].classList.remove("active");
  } else {
    chartEl.style.display = "none";
    tableEl.style.display = "block";
    btns[0].classList.remove("active");
    btns[1].classList.add("active");
  }
}

async function exportCSV() {
  const feedAsh = parseFloat(document.getElementById("feedAshInput").value) || 36.16;
  const sampleId = document.getElementById("seamSelect").value || "custom";

  const rows = document.querySelectorAll("#cutTableBody tr");
  const cut_points = [];
  rows.forEach(r => {
    const sg = parseFloat(r.querySelector(".input-sg").value);
    const y = parseFloat(r.querySelector(".input-yield").value);
    const a = parseFloat(r.querySelector(".input-ash").value);
    if (!isNaN(sg) && !isNaN(y)) {
      cut_points.push({ sg: sg, yield_pct: y, ash_pct: isNaN(a) ? null : a });
    }
  });

  const res = await fetch("/api/export/csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feed_ash: feedAsh, sample_id: sampleId, cut_points: cut_points })
  });

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `washability_${sampleId}_${feedAsh}pct.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
