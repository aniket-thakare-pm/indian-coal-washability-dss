// Global state
let currentCalculation = null;

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
  // Initialize with 2 default representative cuts
  setPresetMode(2);
  runCalculation();
});

function setPresetMode(cuts) {
  // Update buttons
  document.querySelectorAll(".btn-preset").forEach((btn, idx) => {
    btn.classList.toggle("active", idx === cuts);
  });

  const tbody = document.getElementById("cutTableBody");
  tbody.innerHTML = "";

  if (cuts === 0) {
    // 0 cuts: Feed ash alone
    updatePointCount();
    runCalculation();
    return;
  }

  if (cuts === 1) {
    // 1 cut: around SG 1.58
    addCutRow(1.575, 59.74, 20.31);
  } else if (cuts === 2) {
    // 2 cuts: around SG 1.42 and SG 1.75
    addCutRow(1.425, 25.82, 15.41);
    addCutRow(1.750, 75.49, 44.17);
  }
  updatePointCount();
  runCalculation();
}

function addCutRow(sg = 1.50, yieldVal = 50.0, ashVal = 20.0) {
  const tbody = document.getElementById("cutTableBody");
  const rowCount = tbody.children.length + 1;
  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td>${rowCount}</td>
    <td><input type="number" step="0.005" class="input-sg" value="${sg}" onchange="runCalculation()"></td>
    <td><input type="number" step="0.1" class="input-yield" value="${yieldVal}" onchange="runCalculation()"></td>
    <td><input type="number" step="0.1" class="input-ash" value="${ashVal}" onchange="runCalculation()"></td>
    <td><button type="button" class="btn-del" onclick="deleteCutRow(this)">×</button></td>
  `;
  tbody.appendChild(tr);
  updatePointCount();
}

function deleteCutRow(btn) {
  btn.closest("tr").remove();
  const rows = document.querySelectorAll("#cutTableBody tr");
  rows.forEach((r, i) => r.children[0].textContent = i + 1);
  updatePointCount();
  runCalculation();
}

function updatePointCount() {
  const count = document.querySelectorAll("#cutTableBody tr").length;
  const text = document.getElementById("pointCountText");

  if (count === 0) {
    text.textContent = "0 Cuts (Prior Mode)";
  } else if (count === 1) {
    text.textContent = "1 Cut Anchor Defined";
  } else if (count === 2) {
    text.textContent = "2 Cuts (Analytical Inversion)";
  } else {
    text.textContent = `${count} Cuts Defined`;
  }
}

async function runCalculation() {
  const feedAsh = parseFloat(document.getElementById("feedAshInput").value) || 36.16;
  const seamName = document.getElementById("seamInput").value || "Seam XI";

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
    sample_id: "IND_001", // reference for benchmark error tracking
    target_clean_ash: parseFloat(document.getElementById("sliderTargetAsh").value) || 17.0,
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

    // Update Operational Target Slider Readouts
    syncSliderWithCalculation();

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

// Operational Target Slider Synchronization
function onTargetAshSlider(targetAsh) {
  targetAsh = parseFloat(targetAsh);
  document.getElementById("targetAshVal").textContent = `${targetAsh.toFixed(1)} %`;

  if (!currentCalculation || !currentCalculation.spectrum) return;
  const spec = currentCalculation.spectrum;

  // Find index where cum_float_ash is closest to targetAsh
  let bestIdx = 0;
  let minDiff = 999;
  for (let i = 0; i < spec.cum_float_ash.length; i++) {
    const diff = Math.abs(spec.cum_float_ash[i] - targetAsh);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
    }
  }

  const yVal = spec.cum_float_yield[bestIdx];
  const d50Val = spec.rho[bestIdx];
  const rejectAsh = spec.cum_sink_ash[bestIdx];

  document.getElementById("targetYieldVal").textContent = `${yVal.toFixed(1)} %`;
  document.getElementById("sliderTargetYield").value = yVal;
  document.getElementById("boxD50").textContent = d50Val.toFixed(3);
  document.getElementById("boxRejectAsh").textContent = `${rejectAsh.toFixed(1)} %`;

  if (document.getElementById("chkShowTargetLine").checked) {
    updateCurveVisibility();
  }
}

function onTargetYieldSlider(targetYield) {
  targetYield = parseFloat(targetYield);
  document.getElementById("targetYieldVal").textContent = `${targetYield.toFixed(1)} %`;

  if (!currentCalculation || !currentCalculation.spectrum) return;
  const spec = currentCalculation.spectrum;

  // Find index where cum_float_yield is closest to targetYield
  let bestIdx = 0;
  let minDiff = 999;
  for (let i = 0; i < spec.cum_float_yield.length; i++) {
    const diff = Math.abs(spec.cum_float_yield[i] - targetYield);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
    }
  }

  const ashVal = spec.cum_float_ash[bestIdx];
  const d50Val = spec.rho[bestIdx];
  const rejectAsh = spec.cum_sink_ash[bestIdx];

  document.getElementById("targetAshVal").textContent = `${ashVal.toFixed(1)} %`;
  document.getElementById("sliderTargetAsh").value = ashVal;
  document.getElementById("boxD50").textContent = d50Val.toFixed(3);
  document.getElementById("boxRejectAsh").textContent = `${rejectAsh.toFixed(1)} %`;

  if (document.getElementById("chkShowTargetLine").checked) {
    updateCurveVisibility();
  }
}

function syncSliderWithCalculation() {
  if (!currentCalculation) return;
  const curAsh = parseFloat(document.getElementById("sliderTargetAsh").value) || 17.0;
  onTargetAshSlider(curAsh);
}

function renderPlotlyChart(data) {
  const spec = data.spectrum;
  const traces = [];

  // 1. Elementary Ash Curve
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

  // 2. Cumulative Floats Curve (Clean Coal)
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

  // 3. Cumulative Sinks Curve (Discard)
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

  // 4. Density - Yield Curve
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

  // 6. Optional Operating Target Crosshair Guide Lines (Section 4 Slider)
  const showTarget = document.getElementById("chkShowTargetLine").checked;
  const shapes = [];
  const annotations = [];

  if (showTarget) {
    const tAsh = parseFloat(document.getElementById("sliderTargetAsh").value) || 17.0;
    const tYield = parseFloat(document.getElementById("sliderTargetYield").value) || 52.4;
    const d50 = document.getElementById("boxD50").textContent;

    // Horizontal guide line from x=0 to x=tAsh at y=tYield
    shapes.push({
      type: "line",
      x0: 0,
      x1: tAsh,
      y0: tYield,
      y1: tYield,
      line: { color: "#7C3AED", width: 1.8, dash: "dashdot" }
    });

    // Vertical guide line from y=0 (top) down to y=tYield at x=tAsh
    shapes.push({
      type: "line",
      x0: tAsh,
      x1: tAsh,
      y0: 0,
      y1: tYield,
      line: { color: "#7C3AED", width: 1.8, dash: "dashdot" }
    });

    // Operational target marker dot on Cumulative Float curve
    traces.push({
      x: [tAsh],
      y: [tYield],
      name: `Operating Target (Ash: ${tAsh}%, Yield: ${tYield}%)`,
      type: "scatter",
      mode: "markers+text",
      marker: { size: 12, color: "#7C3AED", symbol: "star", line: { width: 2, color: "#FFFFFF" } },
      text: [`Target: ${tAsh}% Ash → Yield ${tYield}% (d₅₀=${d50})`],
      textposition: "bottom right",
      textfont: { family: "Segoe UI", size: 10, color: "#5B21B6" },
      xaxis: "x",
      yaxis: "y",
      showlegend: true
    });
  }

  // 4-Axis Standard Layout
  const layout = {
    margin: { l: 65, r: 65, t: 65, b: 55 },
    font: { family: "Segoe UI, sans-serif", size: 11 },
    showlegend: true,
    shapes: shapes,
    annotations: annotations,
    legend: {
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: -0.15,
      font: { size: 10 }
    },
    yaxis: {
      title: "<b>Cumulative Wt % Floats (Recovery)</b>",
      range: [100, 0], // Inverted
      showgrid: true,
      gridcolor: "#E2E8F0",
      zeroline: false
    },
    yaxis2: {
      title: "<b>Cumulative Wt % Sinks (Discard)</b>",
      range: [0, 100],
      overlaying: "y",
      side: "right",
      showgrid: false,
      zeroline: false
    },
    xaxis: {
      title: "<b>Ash % (Air-Dried Basis)</b>",
      range: [0, 100],
      showgrid: true,
      gridcolor: "#E2E8F0",
      zeroline: false
    },
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
  const seamName = document.getElementById("seamInput").value || "Custom";

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
    body: JSON.stringify({ feed_ash: feedAsh, sample_id: seamName, cut_points: cut_points })
  });

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `washability_${seamName.replace(/[^a-zA-Z0-9]/g, "_")}_${feedAsh}pct.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
