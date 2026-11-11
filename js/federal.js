"use strict";
/* =====================================================================
   FONDOS FEDERALES: subvenciones de todas las agencias a la UPR (USAspending).
   Vista institucional (sin vínculo a profesores). Filtros: recinto, agencia,
   tipo de fondo y años de inicio. Todo se recalcula con ellos.
   ===================================================================== */
const FEDF = { campus: "", agency: "", cat: "", from: "", to: "", q: "", excl: true };

async function viewFondos(el){
  el.innerHTML = head(`${icon("money")} Fondos federales`, "Fondos federales de todas las agencias",
    `Subvenciones federales otorgadas a la UPR según <a href="https://www.usaspending.gov" target="_blank" rel="noopener">USAspending.gov</a>`) + `<div class="empty fed-loading"><b>Cargando fondos federales…</b></div>`;
  let D;
  try { D = await FEDERAL.load(); } catch(e){ el.querySelector(".fed-loading").outerHTML = `<div class="empty"><b>No se pudieron cargar los fondos federales.</b>${esc(e.message)}</div>`; return; }
  if (parseHash().name !== "fondos") return;
  if (!D?.awards?.length){ el.querySelector(".fed-loading").outerHTML = `<div class="empty"><b>Aún no se han descargado los fondos federales.</b>${AUTH.isAdmin() ? `Ve a <a href="#/admin">Administración</a>, paso 3, y pulsa «Descargar fondos federales».` : "Un administrador debe descargarlos."}</div>`; return; }
  const A = D.awards, opts = (list, cur, all) => `<option value="">${all}</option>` + list.map(v => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  const years = A.map(a => a.year).filter(Boolean);
  el.querySelector(".fed-loading").outerHTML = `
    <div class="filters">
      <input type="search" id="ffQ" placeholder="Buscar en la descripción…" value="${esc(FEDF.q)}">
      <select id="ffCampus">${opts(uniq(A.map(a => a.campus)).sort(), FEDF.campus, "Todos los recintos")}</select>
      <select id="ffAgency">${opts(uniq(A.map(a => a.agency)).sort(), FEDF.agency, "Todas las agencias")}</select>
      <select id="ffCat">${opts(uniq(A.map(a => a.cat)).sort(), FEDF.cat, "Todos los tipos de fondo")}</select>
      <label class="note">Inicio <input type="number" id="ffFrom" placeholder="${Math.min(...years)}" value="${esc(FEDF.from)}" style="width:84px"> – <input type="number" id="ffTo" placeholder="${Math.max(...years)}" value="${esc(FEDF.to)}" style="width:84px"></label>
      <label class="note"><input type="checkbox" id="ffExcl" ${FEDF.excl ? "checked" : ""}> Excluir emergencia COVID-19</label>
      <button type="button" id="ffReset">Limpiar filtros</button><button type="button" id="ffCsv">Descargar CSV</button>
    </div>
    <p class="note" id="ffScope"></p>
    <div class="kpis" id="fedKpis"></div>
    <div class="card" style="margin-bottom:16px"><h2>Fondos por año de inicio</h2><div id="fedYears"></div></div>
    <div class="grid2 even"><div class="card"><h2 id="fedAgTitle">Por agencia <span class="note">(clic para filtrar)</span></h2><div id="fedAgency"></div></div>
      <div class="card"><h2>Por recinto <span class="note">(clic para filtrar)</span></h2><div id="fedCampus"></div></div></div>
    <div class="grid2" style="margin:16px 0"><div class="card"><h2>Por tipo de fondo</h2><div id="fedCat"></div></div>
      <div class="card"><h2>Comparación con los proyectos vinculados a profesores</h2><div id="fedCmp"></div></div></div>
    <div class="card"><h2>Subvenciones más grandes</h2><div id="fedTop" class="tablewrap"></div></div>
    <p class="note" style="margin-top:14px">Fuente: USAspending.gov (subvenciones: tipos 02–05), descargado el ${esc(new Date(D.updated_at || D.generated).toLocaleDateString("es"))}, con actividad desde ${esc(D.since)}. El monto es lo obligado durante toda la vida de cada subvención. USAspending no publica el investigador, por eso estos fondos no se vinculan a profesores. El recinto se deduce del nombre del recipiente, la descripción o el lugar de ejecución; muchas subvenciones se registran a nombre de «University of Puerto Rico» y, si no hay más datos, quedan como «${esc(GENERAL.name)}». «Emergencia (COVID-19)» agrupa los fondos de la ley CARES y similares; «Educación y apoyo estudiantil» agrupa los del Departamento de Educación (TRIO, Título V, etc.).</p>`;
  const bind = (id, k, ev = "input", get = e => e.target.value) => $(id).addEventListener(ev, e => { FEDF[k] = get(e); drawFed(A); });
  bind("ffQ", "q"); bind("ffCampus", "campus"); bind("ffAgency", "agency"); bind("ffCat", "cat"); bind("ffFrom", "from"); bind("ffTo", "to");
  bind("ffExcl", "excl", "change", e => e.target.checked);
  $("ffReset").onclick = () => { Object.assign(FEDF, { campus: "", agency: "", cat: "", from: "", to: "", q: "", excl: true }); viewFondos(el); };
  $("ffCsv").onclick = () => fedCSV(filterFed(A));
  drawFed(A);
}

function filterFed(A){
  const from = Number(FEDF.from) || -Infinity, to = Number(FEDF.to) || Infinity, q = norm(FEDF.q);
  return A.filter(a => (!FEDF.campus || a.campus === FEDF.campus) && (!FEDF.agency || a.agency === FEDF.agency) && (!FEDF.cat || a.cat === FEDF.cat)
    && (!FEDF.excl || a.cat !== "Emergencia (COVID-19)") && (a.year ? a.year >= from && a.year <= to : from === -Infinity && to === Infinity)
    && (!q || norm(`${a.desc} ${a.id} ${a.sub}`).includes(q)));
}

function drawFed(A){
  const F = filterFed(A), sum = l => l.reduce((s, a) => s + a.amount, 0), total = sum(F), today = nowISO().slice(0, 10);
  ["ffCampus","ffAgency","ffCat"].forEach((id, i) => { const n = $(id); if (n) n.value = [FEDF.campus, FEDF.agency, FEDF.cat][i]; });
  const parts = [FEDF.campus, FEDF.agency, FEDF.cat, (FEDF.from || FEDF.to) && `inicio ${FEDF.from || "…"}–${FEDF.to || "…"}`, FEDF.q && `«${FEDF.q}»`, FEDF.excl && !FEDF.cat && "sin emergencia COVID-19"].filter(Boolean);
  $("ffScope").innerHTML = `Mostrando: <b>${esc(parts.join(" · ") || "todas las subvenciones")}</b>`;
  const active = F.filter(a => a.end && a.end >= today);
  $("fedKpis").innerHTML = `
    <div class="kpi">${icon("money")}<b>${money$(total)}</b><span>Fondos federales otorgados</span></div>
    <div class="kpi">${icon("flask")}<b>${fmt(F.length)}</b><span>Subvenciones</span></div>
    <div class="kpi">${icon("pulse")}<b>${money$(sum(active))}</b><span>En ${fmt(active.length)} subvenciones vigentes</span></div>
    <div class="kpi">${icon("building")}<b>${fmt(uniq(F.map(a => a.agency)).length)}</b><span>Agencias</span></div>
    <div class="kpi">${icon("bars")}<b>${money$(F.length ? total / F.length : 0)}</b><span>Promedio por subvención</span></div>`;
  const ys = F.map(a => a.year).filter(Boolean);
  if (ys.length){ const pts = []; for (let y = Math.max(Math.min(...ys), 2005); y <= Math.max(...ys); y++) pts.push({ x: String(y), y: sum(F.filter(a => a.year === y)) });
    areaChart($("fedYears"), { points: pts, label: "Fondos otorgados (por año de inicio)", fmt: money$ }); }
  else $("fedYears").innerHTML = `<p class="note">Sin datos.</p>`;
  const agg = key => { const m = new Map(); for (const a of F) m.set(a[key], (m.get(a[key]) || 0) + a.amount); return [...m].map(([label, value]) => ({ label: label || "—", value })); };
  const lvl = FEDF.agency ? "sub" : "agency";
  $("fedAgTitle").innerHTML = `${FEDF.agency ? "Por subagencia" : "Por agencia"} <span class="note">${FEDF.agency ? "" : "(clic para filtrar)"}</span>`;
  hbars($("fedAgency"), { items: agg(lvl), top: 14, fmt: money$, onClick: FEDF.agency ? null : k => { FEDF.agency = k; drawFed(A); } });
  hbars($("fedCampus"), { items: agg("campus"), top: 14, fmt: money$, onClick: k => { FEDF.campus = FEDF.campus === k ? "" : k; drawFed(A); } });
  donut($("fedCat"), { items: agg("cat"), center: { value: money$(total), label: "Total" }, fmt: money$ });
  // comparación NIH/NSF vinculados a profesores
  const S = sys(), linked = ag => S.awards.filter(a => a.agency === ag).reduce((s, a) => s + (a.amount || 0), 0);
  const fedBy = name => sum(F.filter(a => a.agency === name || a.sub === name));
  $("fedCmp").innerHTML = `<table class="mini"><thead><tr><th>Agencia</th><th class="num">USAspending (selección)</th><th class="num">Vinculado a profesores</th></tr></thead><tbody>
    <tr><td>NSF</td><td class="num">${money$(fedBy("National Science Foundation"))}</td><td class="num">${money$(linked("NSF"))}</td></tr>
    <tr><td>NIH</td><td class="num">${money$(fedBy("National Institutes of Health"))}</td><td class="num">${money$(linked("NIH"))}</td></tr></tbody></table>
    <p class="note">Los proyectos NIH y NSF de la sección Proyectos sí se vinculan a profesores (por nombre e institución); las demás agencias solo están disponibles a nivel institucional. Las cifras no coinciden exactamente: cambian la ventana de años, la forma de contar el monto (NSF: total estimado; NIH: años fiscales) y el filtro de recinto.</p>`;
  const top = [...F].sort((a, b) => b.amount - a.amount).slice(0, 100);
  $("fedTop").innerHTML = !top.length ? `<p class="note">Sin subvenciones.</p>` : `<table class="mini"><thead><tr><th>Subvención</th><th>Agencia</th><th>Recinto</th><th>Periodo</th><th class="num">Monto</th></tr></thead><tbody>
    ${top.map(a => `<tr><td><a href="${esc(FEDERAL.url(a))}" target="_blank" rel="noopener"><b>${esc(a.id)}</b></a> <span class="note">${esc(a.cat)}</span><br><small>${esc(a.desc)}</small></td>
      <td>${esc(a.agency)}<br><small>${esc(a.sub)}${a.cfda ? ` · CFDA ${esc(a.cfda)}` : ""}</small></td><td>${esc(a.campus)}<br><small>${esc(a.recipient)}</small></td>
      <td>${esc((a.start || "").slice(0, 10))} – ${esc((a.end || "").slice(0, 10))}</td><td class="num">${money$(a.amount)}</td></tr>`).join("")}</tbody></table>
    ${F.length > 100 ? `<p class="note">Se muestran 100 de ${fmt(F.length)} subvenciones. Descarga el CSV para la lista completa.</p>` : ""}`;
}

function fedCSV(F){
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const h = ["award_id","recipiente","recinto","agencia","subagencia","cfda","tipo_de_fondo","inicio","fin","monto_usd","descripcion","usaspending_url"];
  const lines = [h.join(",")].concat(F.map(a => [a.id, a.recipient, a.campus, a.agency, a.sub, a.cfda, a.cat, a.start, a.end, Math.round(a.amount), a.desc, FEDERAL.url(a)].map(q).join(",")));
  saveBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), `upr_fondos_federales_${new Date().toISOString().slice(0,10)}.csv`);
}

ROUTES.fondos = viewFondos;

/* ---------- Administración: descarga desde USAspending ---------- */
$("fedBtn").onclick = async () => {
  const b = $("fedBtn"), st = $("fedStatus"); b.disabled = true;
  const since = clamp(Number($("fundSince").value) || CURRENT_YEAR - 15, 2008, CURRENT_YEAR);
  try {
    st.textContent = "Descargando de USAspending.gov…";
    const data = await FEDERAL.harvest(since, null, n => st.textContent = `Descargando de USAspending.gov: ${fmt(n)} registros…`);
    st.textContent = `Guardando ${fmt(data.awards.length)} subvenciones…`;
    await FEDERAL.save(data);
    const tot = data.awards.reduce((s, a) => s + a.amount, 0);
    st.textContent = `✓ ${fmt(data.awards.length)} subvenciones de ${uniq(data.awards.map(a => a.agency)).length} agencias (${money$(tot)}) desde ${since}. Ya están en «Fondos federales».`;
  } catch(e){ st.textContent = `✗ No se pudo descargar: ${e.message}`; if (e instanceof AuthError) alert(e.message); }
  finally { b.disabled = false; }
};
