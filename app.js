// montevideo-gris — v2 renderer.
// Reads data.csv (Date,Value) and draws one GitHub-style calendar heatmap
// per year, most recent year first, with no charting dependency.

const STATUS = {
  0: { key: "sol", label: "sol", emoji: "☀️", varName: "--sol" },
  1: { key: "gris", label: "gris", emoji: "☁️", varName: "--gris" },
  2: { key: "lluvia", label: "lluvia", emoji: "🌧️", varName: "--lluvia" },
};

const WEEKDAY_LABELS = ["L", "", "X", "", "V", "", ""]; // Mon, Wed, Fri shown

function isoWeekdayMon0(date) {
  return (date.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
}

function parseCSV(text) {
  const byDate = new Map();
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [dateStr, valueStr] = line.split(",");
    const value = parseInt(valueStr, 10);
    if (!dateStr || Number.isNaN(value)) continue;
    byDate.set(dateStr, value);
  }
  return byDate;
}

function toUTCDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateStrOf(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

const monthFmt = new Intl.DateTimeFormat("es-UY", { month: "short", timeZone: "UTC" });

function stripDayLabel(date) {
  return String(date.getUTCDate());
}
const tooltipDateFmt = new Intl.DateTimeFormat("es-UY", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function monthAbbrev(date) {
  return monthFmt.format(date).replace(/\.$/, "");
}

function groupByYear(byDate) {
  const years = new Map();
  for (const dateStr of byDate.keys()) {
    const year = dateStr.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(dateStr);
  }
  return years;
}

function buildYearRange(year, byDate, globalMaxDate) {
  const yearStart = new Date(Date.UTC(Number(year), 0, 1));
  const naturalEnd = new Date(Date.UTC(Number(year), 11, 31));
  const cappedEnd = naturalEnd.getTime() > globalMaxDate.getTime() ? globalMaxDate : naturalEnd;

  const startOffset = isoWeekdayMon0(yearStart);
  const gridStart = addDays(yearStart, -startOffset);

  const raw = [];
  for (let d = yearStart; d.getTime() <= cappedEnd.getTime(); d = addDays(d, 1)) {
    const dateStr = dateStrOf(d);
    const rawWeekIndex = Math.floor((d.getTime() - gridStart.getTime()) / 86400000 / 7);
    const row = isoWeekdayMon0(d);
    raw.push({ date: d, dateStr, rawWeekIndex, row, value: byDate.has(dateStr) ? byDate.get(dateStr) : null });
  }

  // Weeks that contain the 1st of a month (after the range's first month) get
  // an extra empty grid column before them, so months read as separate blocks.
  const monthStartWeeks = new Set();
  let firstMonthSeen = false;
  for (const day of raw) {
    if (day.date.getUTCDate() !== 1) continue;
    if (!firstMonthSeen) { firstMonthSeen = true; continue; }
    monthStartWeeks.add(day.rawWeekIndex);
  }

  let offset = 0;
  let lastRawWeek = null;
  const days = raw.map((day) => {
    if (day.rawWeekIndex !== lastRawWeek) {
      if (monthStartWeeks.has(day.rawWeekIndex)) offset += 1;
      lastRawWeek = day.rawWeekIndex;
    }
    return { date: day.date, dateStr: day.dateStr, weekIndex: day.rawWeekIndex + offset, row: day.row, value: day.value };
  });

  return { yearStart, cappedEnd, days };
}

function buildDateRange(byDate, endDate, windowSize) {
  const start = addDays(endDate, -(windowSize - 1));
  const days = [];
  for (let d = start; d.getTime() <= endDate.getTime(); d = addDays(d, 1)) {
    const dateStr = dateStrOf(d);
    days.push({ date: d, dateStr, weekIndex: 0, row: 0, value: byDate.has(dateStr) ? byDate.get(dateStr) : null });
  }
  return days;
}

function computeStats(days) {
  const counts = { 0: 0, 1: 0, 2: 0, missing: 0 };
  for (const d of days) {
    if (d.value === null) counts.missing++;
    else counts[d.value]++;
  }
  const total = days.length;
  return { counts, total };
}

function computeMonthlyStats(days) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    months.push({ 0: 0, 1: 0, 2: 0, missing: 0, total: 0 });
  }
  for (const d of days) {
    const m = d.date.getUTCMonth();
    if (d.value === null) months[m].missing++;
    else months[m][d.value]++;
    months[m].total++;
  }
  return months.filter((m) => m.total > 0);
}

function pct(n, total) {
  if (!total) return "0";
  return ((n / total) * 100).toFixed(0);
}

// ---------- tooltip ----------

const tooltip = document.getElementById("tooltip");

function showTooltip(target, day) {
  tooltip.innerHTML = "";

  const dateEl = document.createElement("span");
  dateEl.className = "tt-date";
  dateEl.textContent = tooltipDateFmt.format(day.date);
  tooltip.appendChild(dateEl);

  const statusEl = document.createElement("span");
  statusEl.className = "tt-status";
  if (day.value === null) {
    statusEl.textContent = "sin datos";
  } else {
    const meta = STATUS[day.value];
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = `var(${meta.varName})`;
    statusEl.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = `${meta.emoji} ${meta.label}`;
    statusEl.appendChild(label);
  }
  tooltip.appendChild(statusEl);

  const rect = target.getBoundingClientRect();
  tooltip.classList.add("visible");
  const ttRect = tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - ttRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - ttRect.width - 8));
  let top = rect.top - ttRect.height - 10;
  if (top < 8) top = rect.bottom + 10;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.classList.remove("visible");
}

// ---------- rendering ----------

// Set in init(): the cell to highlight — today when it has data, otherwise the
// most recent data day (mirrors the header chip's "Hoy" / "Último dato" split).
let todayMarker = null;

function markToday(el, day, withFlag) {
  if (!todayMarker || day.dateStr !== todayMarker.dateStr) return;
  el.classList.add("is-today");
  if (withFlag) {
    const flag = document.createElement("span");
    // Cells in the top two weekday rows get the flag below, clear of the month labels.
    flag.className = "cell-flag" + (day.row <= 1 ? " cell-flag--below" : "");
    flag.textContent = todayMarker.label;
    el.appendChild(flag);
  }
}

function renderCell(day, withFlag = false) {
  if (day.value === null) {
    const el = document.createElement("button");
    el.className = "cell";
    el.type = "button";
    el.disabled = true;
    el.setAttribute("aria-label", `${tooltipDateFmt.format(day.date)}: sin datos`);
    el.style.gridColumn = String(day.weekIndex + 1);
    el.style.gridRow = String(day.row + 1);
    el.addEventListener("pointerenter", () => showTooltip(el, day));
    el.addEventListener("pointerleave", hideTooltip);
    el.addEventListener("focus", () => showTooltip(el, day));
    el.addEventListener("blur", hideTooltip);
    markToday(el, day, withFlag);
    return el;
  }

  const meta = STATUS[day.value];
  const el = document.createElement("button");
  el.className = "cell";
  el.type = "button";
  el.dataset.v = String(day.value);
  el.setAttribute("aria-label", `${tooltipDateFmt.format(day.date)}: ${meta.label}`);
  el.style.gridColumn = String(day.weekIndex + 1);
  el.style.gridRow = String(day.row + 1);
  el.addEventListener("pointerenter", () => showTooltip(el, day));
  el.addEventListener("pointerleave", hideTooltip);
  el.addEventListener("focus", () => showTooltip(el, day));
  el.addEventListener("blur", hideTooltip);
  markToday(el, day, withFlag);
  return el;
}

function renderMonthRow(days) {
  const row = document.createElement("div");
  row.className = "month-row";
  const seen = new Set();
  for (const day of days) {
    const m = day.date.getUTCMonth();
    if (seen.has(m)) continue;
    seen.add(m);
    const label = document.createElement("span");
    label.textContent = monthAbbrev(day.date);
    label.style.gridColumn = `${day.weekIndex + 1} / span 4`;
    row.appendChild(label);
  }
  return row;
}

function renderWeekdayLabels() {
  const col = document.createElement("div");
  col.className = "weekday-labels";
  for (const label of WEEKDAY_LABELS) {
    const span = document.createElement("span");
    span.textContent = label;
    col.appendChild(span);
  }
  return col;
}

function renderStatTile(statusKey, count, total, prevPct, deltaLabel = "año anterior") {
  const meta = Object.values(STATUS).find((s) => s.key === statusKey);
  const tile = document.createElement("div");
  tile.className = "stat-tile";

  const fill = document.createElement("div");
  fill.className = "stat-fill";
  fill.style.width = `${total ? (count / total) * 100 : 0}%`;
  fill.style.background = `var(${meta.varName})`;
  tile.appendChild(fill);

  const content = document.createElement("div");
  content.className = "stat-content";

  const labelRow = document.createElement("div");
  labelRow.className = "stat-label";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = `var(${meta.varName})`;
  labelRow.appendChild(dot);
  const labelText = document.createElement("span");
  labelText.textContent = `${meta.emoji} ${meta.label}`;
  labelRow.appendChild(labelText);
  content.appendChild(labelRow);

  const valueRow = document.createElement("div");
  valueRow.className = "stat-value";
  const p = pct(count, total);
  valueRow.textContent = `${count} `;
  const small = document.createElement("small");
  small.textContent = `${p}%`;
  valueRow.appendChild(small);
  content.appendChild(valueRow);

  if (prevPct !== null) {
    const delta = document.createElement("div");
    delta.className = "stat-delta";
    const diff = Number(p) - prevPct;
    const sign = diff > 0 ? "+" : "";
    const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";
    delta.textContent = diff === 0 ? `= ${deltaLabel}` : `${arrow} ${sign}${diff.toFixed(0)}% vs ${deltaLabel}`;
    content.appendChild(delta);
  }

  tile.appendChild(content);
  return tile;
}

function renderMonthlyBars(monthlyStats) {
  const wrap = document.createElement("div");
  wrap.className = "month-bars";

  const label = document.createElement("p");
  label.className = "month-bars-label";
  label.textContent = "Comparar meses";
  wrap.appendChild(label);

  monthlyStats.forEach((m, idx) => {
    const monthDate = new Date(Date.UTC(2000, idx, 1));
    const row = document.createElement("div");
    row.className = "month-bar-row";

    const name = document.createElement("span");
    name.className = "month-bar-name";
    name.textContent = monthAbbrev(monthDate);
    row.appendChild(name);

    const track = document.createElement("div");
    track.className = "month-bar-track";
    const segments = [
      ["sol", m[0], "--sol"],
      ["gris", m[1], "--gris"],
      ["lluvia", m[2], "--lluvia"],
      ["sin datos", m.missing, null],
    ];
    for (const [segLabel, count, varName] of segments) {
      if (!count) continue;
      const seg = document.createElement("span");
      seg.className = "month-bar-seg" + (varName ? "" : " is-missing");
      seg.style.width = `${(count / m.total) * 100}%`;
      if (varName) seg.style.background = `var(${varName})`;
      seg.title = `${segLabel}: ${count} día${count === 1 ? "" : "s"} (${pct(count, m.total)}%)`;
      track.appendChild(seg);
    }
    row.appendChild(track);
    wrap.appendChild(row);
  });

  return wrap;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function computeYearTotals(monthlyStats) {
  const totals = { 0: 0, 1: 0, 2: 0, missing: 0, total: 0 };
  for (const m of monthlyStats) {
    totals[0] += m[0];
    totals[1] += m[1];
    totals[2] += m[2];
    totals.missing += m.missing;
    totals.total += m.total;
  }
  return totals;
}

function renderMiniPie(monthlyStats, size = 28) {
  const totals = computeYearTotals(monthlyStats);
  const total = totals.total || 1;

  const segments = [
    { label: "sol", count: totals[0], varName: "--sol" },
    { label: "gris", count: totals[1], varName: "--gris" },
    { label: "lluvia", count: totals[2], varName: "--lluvia" },
    { label: "sin datos", count: totals.missing, varName: null },
  ];

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = size / 2;
  const r = strokeWidth / 2;
  const circumference = 2 * Math.PI * r;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("class", "mini-pie");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", segments.map((s) => `${s.label} ${pct(s.count, total)}%`).join(", "));

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = segments.map((s) => `${s.label}: ${pct(s.count, total)}%`).join(" · ");
  svg.appendChild(title);

  const bg = document.createElementNS(SVG_NS, "circle");
  bg.setAttribute("cx", cx);
  bg.setAttribute("cy", cy);
  bg.setAttribute("r", r);
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "var(--empty-fill)");
  bg.setAttribute("stroke-width", strokeWidth);
  svg.appendChild(bg);

  let cumulative = 0;
  for (const seg of segments) {
    const dash = (seg.count / total) * circumference;
    if (dash > 0) {
      const arc = document.createElementNS(SVG_NS, "circle");
      arc.setAttribute("cx", cx);
      arc.setAttribute("cy", cy);
      arc.setAttribute("r", r);
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke", seg.varName ? `var(${seg.varName})` : "var(--ink-muted)");
      arc.setAttribute("stroke-width", strokeWidth);
      arc.setAttribute("stroke-dasharray", `${dash} ${circumference - dash}`);
      arc.setAttribute("stroke-dashoffset", `${-cumulative}`);
      arc.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
      svg.appendChild(arc);
    }
    cumulative += dash;
  }

  return svg;
}

function renderYearDonut(monthlyStats) {
  const totals = computeYearTotals(monthlyStats);
  const total = totals.total || 1;

  const segments = [
    { label: "sol", count: totals[0], varName: "--sol" },
    { label: "gris", count: totals[1], varName: "--gris" },
    { label: "lluvia", count: totals[2], varName: "--lluvia" },
    { label: "sin datos", count: totals.missing, varName: null },
  ];

  const cx = 140;
  const cy = 100;
  const r = 50;
  const strokeWidth = 22;
  const circumference = 2 * Math.PI * r;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 280 200");
  svg.setAttribute("class", "year-donut");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", segments.map((s) => `${s.label} ${pct(s.count, total)}%`).join(", "));

  const bg = document.createElementNS(SVG_NS, "circle");
  bg.setAttribute("cx", cx);
  bg.setAttribute("cy", cy);
  bg.setAttribute("r", r);
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "var(--empty-fill)");
  bg.setAttribute("stroke-width", strokeWidth);
  svg.appendChild(bg);

  let cumulative = 0;
  segments.forEach((seg, i) => {
    const fraction = seg.count / total;
    const dash = fraction * circumference;

    if (dash > 0) {
      const arc = document.createElementNS(SVG_NS, "circle");
      arc.setAttribute("cx", cx);
      arc.setAttribute("cy", cy);
      arc.setAttribute("r", r);
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke", seg.varName ? `var(${seg.varName})` : "var(--ink-muted)");
      arc.setAttribute("stroke-width", strokeWidth);
      arc.setAttribute("stroke-dasharray", `${dash} ${circumference - dash}`);
      arc.setAttribute("stroke-dashoffset", `${-cumulative}`);
      arc.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
      svg.appendChild(arc);

      const midTheta = ((cumulative + dash / 2) / circumference) * 2 * Math.PI;
      const sinT = Math.sin(midTheta);
      const cosT = Math.cos(midTheta);
      const labelR = r + strokeWidth / 2 + 12;
      const lx = cx + labelR * sinT;
      const ly = cy - labelR * cosT;

      let anchor = "middle";
      let dyName = -3;
      let dyPct = 11;
      if (Math.abs(sinT) > 0.35) {
        anchor = sinT > 0 ? "start" : "end";
      } else if (cosT < 0) {
        dyName = 5;
        dyPct = 19;
      }

      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", lx);
      text.setAttribute("text-anchor", anchor);
      text.setAttribute("class", "donut-label");

      const nameTspan = document.createElementNS(SVG_NS, "tspan");
      nameTspan.setAttribute("x", lx);
      nameTspan.setAttribute("y", ly);
      nameTspan.setAttribute("dy", dyName);
      nameTspan.setAttribute("class", "donut-label-name");
      nameTspan.setAttribute("fill", seg.varName ? `var(${seg.varName})` : "var(--ink-muted)");
      nameTspan.textContent = seg.label;
      text.appendChild(nameTspan);

      const pctTspan = document.createElementNS(SVG_NS, "tspan");
      pctTspan.setAttribute("x", lx);
      pctTspan.setAttribute("y", ly);
      pctTspan.setAttribute("dy", dyPct);
      pctTspan.setAttribute("class", "donut-label-pct");
      pctTspan.textContent = `${pct(seg.count, total)}%`;
      text.appendChild(pctTspan);

      svg.appendChild(text);
    }

    cumulative += dash;
  });

  return svg;
}

function renderMonthlyTable(year, monthlyStats) {
  const details = document.createElement("details");
  details.className = "year-table";

  const summary = document.createElement("summary");
  summary.textContent = "Ver tabla mensual";
  details.appendChild(summary);

  const compare = document.createElement("div");
  compare.className = "monthly-compare";
  compare.appendChild(renderMonthlyBars(monthlyStats));
  const donutWrap = document.createElement("div");
  donutWrap.className = "year-donut-wrap";
  donutWrap.appendChild(renderYearDonut(monthlyStats));
  compare.appendChild(donutWrap);
  details.appendChild(compare);

  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.textContent = `Días por mes, ${year}`;
  table.appendChild(caption);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const h of ["Mes", "Sol", "Gris", "Lluvia", "Sin datos"]) {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const monthNameFmt = new Intl.DateTimeFormat("es-UY", { month: "long", timeZone: "UTC" });
  monthlyStats.forEach((m, idx) => {
    const tr = document.createElement("tr");
    const monthDate = new Date(Date.UTC(2000, idx, 1));
    const cells = [monthNameFmt.format(monthDate), m[0], m[1], m[2], m.missing];
    cells.forEach((val, i) => {
      const td = document.createElement("td");
      td.textContent = String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  details.appendChild(table);
  return details;
}

function renderRecentStrip(byDate, globalMaxDate) {
  const windowSize = 30;
  const days = buildDateRange(byDate, globalMaxDate, windowSize);
  const stats = computeStats(days);
  const prevDays = buildDateRange(byDate, addDays(globalMaxDate, -windowSize), windowSize);
  const prevStats = computeStats(prevDays);

  const section = document.createElement("section");
  section.className = "year-section recent-section";

  const head = document.createElement("div");
  head.className = "year-head";
  const title = document.createElement("h2");
  title.className = "year-num";
  title.textContent = "Últimos 30 días";
  head.appendChild(title);
  const tag = document.createElement("span");
  tag.className = "year-tag";
  tag.textContent = `hasta ${new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "short", timeZone: "UTC" }).format(globalMaxDate)}`;
  head.appendChild(tag);
  section.appendChild(head);

  const statRow = document.createElement("div");
  statRow.className = "stat-row stat-row--compact";
  const recordedTotal = stats.total - stats.counts.missing;
  const prevRecordedTotal = prevStats.total - prevStats.counts.missing;
  const prevPctFor = (idx) => (prevRecordedTotal ? Number(pct(prevStats.counts[idx], prevRecordedTotal)) : null);
  statRow.appendChild(renderStatTile("sol", stats.counts[0], recordedTotal, prevPctFor(0), "período anterior"));
  statRow.appendChild(renderStatTile("gris", stats.counts[1], recordedTotal, prevPctFor(1), "período anterior"));
  statRow.appendChild(renderStatTile("lluvia", stats.counts[2], recordedTotal, prevPctFor(2), "período anterior"));
  section.appendChild(statRow);

  const strip = document.createElement("div");
  strip.className = "strip-row";
  let lastMonth = null;
  for (const day of days) {
    const m = day.date.getUTCMonth();
    if (lastMonth !== null && m !== lastMonth) {
      const divider = document.createElement("div");
      divider.className = "strip-divider";
      strip.appendChild(divider);
    }
    lastMonth = m;

    const col = document.createElement("div");
    col.className = "strip-col";
    if (todayMarker && day.dateStr === todayMarker.dateStr) {
      col.classList.add("is-today");
      const flag = document.createElement("span");
      flag.className = "strip-flag";
      flag.textContent = todayMarker.label;
      col.appendChild(flag);
    }

    const label = document.createElement("span");
    label.className = "strip-label";
    label.textContent = stripDayLabel(day.date);
    col.appendChild(label);

    col.appendChild(renderCell(day));
    strip.appendChild(col);
  }
  section.appendChild(strip);

  return section;
}

function renderYear(year, byDate, globalMaxDate, prevStats) {
  const { days, cappedEnd } = buildYearRange(year, byDate, globalMaxDate);
  const stats = computeStats(days);
  const isCurrentYear = cappedEnd.getTime() < new Date(Date.UTC(Number(year), 11, 31)).getTime();

  const section = document.createElement("section");
  section.className = "year-section";

  const monthlyStats = computeMonthlyStats(days);

  const head = document.createElement("div");
  head.className = "year-head";
  head.appendChild(renderMiniPie(monthlyStats));
  const num = document.createElement("h2");
  num.className = "year-num";
  num.textContent = year;
  head.appendChild(num);
  if (isCurrentYear) {
    const tag = document.createElement("span");
    tag.className = "year-tag";
    tag.textContent = "en curso";
    head.appendChild(tag);
  }
  section.appendChild(head);

  const statRow = document.createElement("div");
  statRow.className = "stat-row";
  const recordedTotal = stats.total - stats.counts.missing;
  const prevPctFor = (key) => (prevStats ? Number(pct(prevStats.counts[key === "sol" ? 0 : key === "gris" ? 1 : 2], prevStats.total - prevStats.counts.missing)) : null);
  statRow.appendChild(renderStatTile("sol", stats.counts[0], recordedTotal, prevPctFor("sol")));
  statRow.appendChild(renderStatTile("gris", stats.counts[1], recordedTotal, prevPctFor("gris")));
  statRow.appendChild(renderStatTile("lluvia", stats.counts[2], recordedTotal, prevPctFor("lluvia")));
  section.appendChild(statRow);

  const scroll = document.createElement("div");
  scroll.className = "heatmap-scroll";
  const heatmap = document.createElement("div");
  heatmap.className = "heatmap";

  heatmap.appendChild(renderWeekdayLabels());

  const gridCol = document.createElement("div");
  gridCol.className = "grid-col";
  gridCol.appendChild(renderMonthRow(days));

  const daysGrid = document.createElement("div");
  daysGrid.className = "days-grid";
  for (const day of days) {
    daysGrid.appendChild(renderCell(day, true));
  }
  gridCol.appendChild(daysGrid);
  heatmap.appendChild(gridCol);

  scroll.appendChild(heatmap);
  section.appendChild(scroll);

  section.appendChild(renderMonthlyTable(year, monthlyStats));

  return { section, stats };
}

function renderTodayChip(byDate) {
  const chip = document.getElementById("today-chip");
  if (!byDate.size) return;
  const lastDateStr = [...byDate.keys()].sort().at(-1);
  const lastValue = byDate.get(lastDateStr);
  const lastDate = toUTCDate(lastDateStr);
  const now = new Date();
  const isToday = dateStrOf(lastDate) === dateStrOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const meta = STATUS[lastValue];

  const label = chip.querySelector(".label");
  label.textContent = isToday ? "Hoy" : `Último dato · ${new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "short", timeZone: "UTC" }).format(lastDate)}`;

  const pill = chip.querySelector(".today-pill");
  pill.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = `var(${meta.varName})`;
  pill.appendChild(dot);
  const text = document.createElement("span");
  text.textContent = `${meta.emoji} ${meta.label}`;
  pill.appendChild(text);
}

async function init() {
  const res = await fetch("data.csv");
  const text = await res.text();
  const byDate = parseCSV(text);

  renderTodayChip(byDate);

  const years = [...groupByYear(byDate).keys()].sort().reverse();
  const globalMaxDate = toUTCDate([...byDate.keys()].sort().at(-1));

  const now = new Date();
  const todayStr = dateStrOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  todayMarker = byDate.has(todayStr)
    ? { dateStr: todayStr, label: "hoy" }
    : { dateStr: dateStrOf(globalMaxDate), label: "Hoy" };

  const main = document.getElementById("years");
  main.appendChild(renderRecentStrip(byDate, globalMaxDate));

  let prevStats = null;
  // Render oldest -> newest so each year can compare against the previous one,
  // then flip to newest-first in the DOM.
  const chronological = [...years].reverse();
  const rendered = [];
  for (const year of chronological) {
    const { section, stats } = renderYear(year, byDate, globalMaxDate, prevStats);
    rendered.push(section);
    prevStats = stats;
  }
  for (const section of rendered.reverse()) {
    main.appendChild(section);
  }
}

function initThemeToggle() {
  const toggle = document.getElementById("theme-toggle");
  const root = document.documentElement;
  const stored = localStorage.getItem("mvd-gris-theme");
  if (stored) root.setAttribute("data-theme", stored);

  const label = () => {
    const current = root.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    toggle.textContent = current === "dark" ? "☀️ modo sol" : "☁️ modo gris";
  };
  label();

  toggle.addEventListener("click", () => {
    const current = root.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("mvd-gris-theme", next);
    label();
  });
}

initThemeToggle();
init();
