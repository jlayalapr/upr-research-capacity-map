"use strict";
/* =====================================================================
   GRÁFICAS (SVG/HTML sin dependencias)
   - areaChart: una serie en el tiempo (sin doble eje), con cruz y tooltip
   - donut:     parte-todo, máx. 5 categorías + "Otros", leyenda con valores
   - hbars:     magnitudes ordenadas, una sola serie
   Cada gráfica incluye una vista de tabla (accesibilidad).
   Paleta categórica validada (orden fijo): --s1 … --s6, --s-other.
   ===================================================================== */
const TIP = (() => {
  const d = document.createElement("div"); d.className = "tip"; d.hidden = true; document.body.appendChild(d);
  const move = e => {
    const t = e.target.closest?.("[data-tip]");
    if (!t){ d.hidden = true; return; }
    d.innerHTML = t.dataset.tip; d.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - d.offsetWidth - 8), y = Math.max(8, e.clientY - d.offsetHeight - 12);
    d.style.left = x + "px"; d.style.top = y + "px";
  };
  document.addEventListener("mousemove", move); document.addEventListener("scroll", () => d.hidden = true, true);
  return d;
})();
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SERIES = () => ["--s1","--s2","--s3","--s4","--s5","--s6"].map(cssVar);
let CHART_SEQ = 0;
function niceMax(v){ if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function tableView(headers, rows){
  return `<details class="datatable"><summary>Ver como tabla</summary><div class="tablewrap" style="max-height:240px"><table><thead><tr>${headers.map((h,i) => `<th${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c,i) => `<td${i ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

function areaChart(el, {points, label, fmt = v => fmt0(v), height = 230}){
  if (!points.length || points.every(p => !p.y)){ el.innerHTML = `<p class="note">Sin datos para graficar.</p>`; return; }
  const W = Math.max(320, el.clientWidth || 640), H = height, L = 44, R = 14, T = 14, B = 28;
  const max = niceMax(Math.max(...points.map(p => p.y))), n = points.length;
  const X = i => L + (n === 1 ? (W-L-R)/2 : i * (W - L - R) / (n - 1)), Y = v => T + (H - T - B) * (1 - v / max);
  const id = "g" + (++CHART_SEQ), c = SERIES()[0];
  const line = points.map((p,i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const area = `${line}L${X(n-1).toFixed(1)},${Y(0)}L${X(0).toFixed(1)},${Y(0)}Z`;
  const ticks = [0, .25, .5, .75, 1].map(f => max * f);
  const band = (W - L - R) / Math.max(1, n - 1);
  const step = Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 48)));
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} por año">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity=".02"/></linearGradient></defs>
    <g class="grid">${ticks.map(t => `<line x1="${L}" x2="${W-R}" y1="${Y(t)}" y2="${Y(t)}"/>`).join("")}</g>
    <g class="axis">${ticks.map(t => `<text x="${L-8}" y="${Y(t)+4}" text-anchor="end">${esc(fmtShort(t))}</text>`).join("")}
      ${points.map((p,i) => i % step === 0 || i === n-1 ? `<text x="${X(i)}" y="${H-8}" text-anchor="middle">${esc(p.x)}</text>` : "").join("")}</g>
    <path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p,i) => `<g class="hov" data-tip="<b>${esc(p.x)}</b><br>${esc(label)}: ${esc(fmt(p.y))}">
      <rect x="${X(i) - band/2}" y="${T}" width="${band}" height="${H-T-B}" fill="transparent"/>
      <line x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${Y(0)}" stroke="var(--muted)" stroke-dasharray="3 3"/>
      <circle cx="${X(i)}" cy="${Y(p.y)}" r="5" fill="${c}" stroke="var(--card)" stroke-width="2"/></g>`).join("")}
  </svg></div>${tableView(["Año", label], points.map(p => [p.x, fmt(p.y)]))}`;
}

function donut(el, {items, center, fmt = v => fmt0(v), max = 5}){
  items = items.filter(i => i.value > 0).sort((a,b) => b.value - a.value);
  if (!items.length){ el.innerHTML = `<p class="note">Sin datos para graficar.</p>`; return; }
  if (items.length > max + 1){ const rest = items.slice(max); items = [...items.slice(0, max), {label:"Otros", value: rest.reduce((s,i) => s + i.value, 0), other:true}]; }
  const total = items.reduce((s,i) => s + i.value, 0), cols = SERIES(), other = cssVar("--s-other");
  const r = 70, C = 2*Math.PI*r; let off = 0;
  const color = (it, i) => it.other || it.label === "Sin datos" ? other : cols[i % cols.length];
  const arcs = items.map((it, i) => { const len = C * it.value / total, seg = Math.max(0, len - 2);
    const s = `<circle r="${r}" cx="90" cy="90" fill="none" stroke="${color(it,i)}" stroke-width="26" stroke-dasharray="${seg} ${C - seg}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"
      data-tip="<b>${esc(it.label)}</b><br>${esc(fmt(it.value))} · ${Math.round(100*it.value/total)}%"/>`; off += len; return s; }).join("");
  el.innerHTML = `<div class="donut-wrap"><div class="chart"><svg viewBox="0 0 180 180" role="img" aria-label="Distribución">${arcs}
      <text x="90" y="88" text-anchor="middle" font-size="28" font-weight="800" fill="var(--ink)">${esc(center?.value ?? fmt(total))}</text>
      <text x="90" y="108" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(center?.label ?? "")}</text></svg></div>
    <div class="legend">${items.map((it,i) => `<div data-tip="<b>${esc(it.label)}</b><br>${esc(fmt(it.value))}"><i style="background:${color(it,i)}"></i><span>${esc(it.label)}</span><span class="v">${Math.round(100*it.value/total)}%</span></div>`).join("")}</div></div>
    ${tableView(["Categoría","Valor","%"], items.map(it => [it.label, fmt(it.value), Math.round(100*it.value/total) + "%"]))}`;
}

function hbars(el, {items, fmt = v => fmt0(v), top = 10, onClick}){
  items = items.filter(i => i.value > 0).sort((a,b) => b.value - a.value).slice(0, top);
  if (!items.length){ el.innerHTML = `<p class="note">Sin datos para graficar.</p>`; return; }
  const max = Math.max(...items.map(i => i.value)), c = SERIES()[0];
  el.innerHTML = `<div class="hb">${items.map(it => `<div class="hb-row" data-tip="<b>${esc(it.label)}</b><br>${esc(fmt(it.value))}" ${onClick ? `data-hb="${esc(it.key ?? it.label)}"` : ""}>
      <span class="hb-l">${esc(it.label)}</span><span class="hb-t"><i style="width:${Math.max(1, 100*it.value/max)}%;background:${c}"></i></span><span class="hb-v">${esc(fmt(it.value))}</span></div>`).join("")}</div>
    ${tableView(["Categoría","Valor"], items.map(it => [it.label, fmt(it.value)]))}`;
  if (onClick) el.querySelectorAll("[data-hb]").forEach(r => r.onclick = () => onClick(r.dataset.hb));
}
const fmt0 = v => Number(v || 0).toLocaleString("es");
const fmtShort = v => v >= 1e6 ? (v/1e6).toFixed(v % 1e6 ? 1 : 0) + " M" : v >= 1e3 ? (v/1e3).toFixed(v % 1e3 ? 1 : 0) + " K" : String(Math.round(v*100)/100);

/* estilos específicos de gráficas */
document.head.insertAdjacentHTML("beforeend", `<style>
  .chart .hov line,.chart .hov circle{opacity:0;transition:opacity .1s}
  .chart .hov:hover line,.chart .hov:hover circle{opacity:1}
  .hb{display:flex;flex-direction:column;gap:8px}
  .hb-row{display:grid;grid-template-columns:minmax(110px,190px) 1fr 70px;gap:10px;align-items:center;font-size:.84rem}
  .hb-row[data-hb]{cursor:pointer}
  .hb-l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hb-t{height:10px;background:var(--bar);border-radius:4px;overflow:hidden}
  .hb-t i{display:block;height:100%;border-radius:4px}
  .hb-v{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
</style>`);
