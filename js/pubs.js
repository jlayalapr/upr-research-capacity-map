"use strict";
/* =====================================================================
   PUBLICACIONES: tablero de la producción de la UPR (OpenAlex).
   Datos: una fila por publicación ÚNICA de la versión publicada
   (api_get_pubs, en caché en IndexedDB por versión) o, en modo local,
   las publicaciones de los registros completos cargados.
   Filtros: recinto, campo, subcampo, tipo y años. Todo se recalcula con ellos.
   ===================================================================== */
const PUBS = {
  key: null, rows: null,
  /** Filas {id, year, cites, oa, type, field, sub, topic, venue, orcids} */
  async load(){
    const local = APP_CONFIG.backend === "local" || !STORE.harvestId;
    const key = local ? `local:${STATE.version || 0}:${STATE.researchers.size}` : STORE.harvestId;
    if (this.key === key && this.rows) return this.rows;
    let raw = null;
    if (local) raw = this.fromState();
    else {
      raw = await IDB.get(`pubs:${key}`);
      if (!raw){
        raw = await SB.rpc("api_get_pubs", { p_session: AUTH.token, p_harvest: key }) || [];
        for (const k of await IDB.keys()) if (String(k).startsWith("pubs:")) await IDB.del(k);
        await IDB.put(`pubs:${key}`, raw);
      }
    }
    this.rows = raw.map(r => ({ id: r[0], year: r[1] || null, cites: r[2] || 0, oa: !!r[3], type: r[4] || "", field: r[5] || "",
      sub: r[6] || "", topic: r[7] || "", venue: r[8] || "", orcids: r[9] || [] }));
    this.key = key;
    return this.rows;
  },
  fromState(){
    const by = new Map();
    for (const R of researchers()) for (const w of (R.sources.openalex?.works || [])){
      const x = by.get(w.id) || by.set(w.id, [w.id, w.year, w.cited_by_count || 0, !!w.oa?.is_oa, w.type, w.primary_topic?.field, w.primary_topic?.subfield,
        w.primary_topic?.name, w.source?.name, []]).get(w.id);
      if (!x[9].includes(R.orcid)) x[9].push(R.orcid);
    }
    return [...by.values()];
  },
  /** Título, revista y DOI de unas pocas publicaciones. */
  async meta(ids){
    if (!ids.length) return new Map();
    if (APP_CONFIG.backend === "local" || !STORE.harvestId || researchers().some(R => R.sources.openalex?.works?.length)){
      const m = new Map();
      for (const R of researchers()) for (const w of (R.sources.openalex?.works || [])) if (ids.includes(w.id) && !m.has(w.id))
        m.set(w.id, { title: w.title, year: w.year, venue: w.source?.name, doi: w.doi, cited: w.cited_by_count, oa: w.oa?.is_oa });
      if (m.size === ids.length || APP_CONFIG.backend === "local" || !STORE.harvestId) return m;
    }
    const rows = await SB.rpc("api_get_work_meta", { p_session: AUTH.token, p_harvest: STORE.harvestId, p_ids: ids.slice(0, 100) }) || [];
    return new Map(rows.map(r => [r.id, r]));
  },
};

const PUBF = { campus: "", field: "", sub: "", type: "", from: "", to: "", rank: "pubs", yearMetric: "pubs" };
const pubCampuses = w => uniq(w.orcids.flatMap(o => { const R = STATE.researchers.get(o); return R ? campusOf(R) : []; }));

async function viewPublicaciones(el){
  el.innerHTML = head(`${icon("book")} Publicaciones`, "Producción de Publicaciones",
    `Publicaciones de los profesores de la UPR identificados en ORCID y vinculados en OpenAlex ${SRC.oa}`) + `<div class="empty pub-loading"><b>Cargando publicaciones…</b></div>`;
  let rows;
  try { rows = await PUBS.load(); }
  catch(e){ el.querySelector(".pub-loading").outerHTML = `<div class="empty"><b>No se pudieron cargar las publicaciones.</b>${esc(e.message)}</div>`; return; }
  if (parseHash().name !== "publicaciones") return;
  if (!rows.length){ el.querySelector(".pub-loading").outerHTML = emptyState("Aún no hay publicaciones (requiere enriquecer con OpenAlex)."); return; }
  const years = rows.map(w => w.year).filter(Boolean), y0 = Math.min(...years), y1 = Math.max(...years);
  const opts = (list, cur, all) => `<option value="">${all}</option>` + list.map(v => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  const campuses = uniq(researchers().flatMap(campusOf)).sort();
  const fields = uniq(rows.map(w => w.field)).sort();
  const types = uniq(rows.map(w => w.type)).sort();
  el.querySelector(".pub-loading").outerHTML = `
    <div class="filters" id="pubFilters">
      <select id="pfCampus">${opts(campuses, PUBF.campus, "Todos los recintos")}</select>
      <select id="pfField">${opts(fields, PUBF.field, "Todos los campos")}</select>
      <select id="pfSub"></select>
      <select id="pfType">${opts(types, PUBF.type, "Todos los tipos")}</select>
      <label class="note">Años <input type="number" id="pfFrom" min="${y0}" max="${y1}" placeholder="${y0}" value="${esc(PUBF.from)}" style="width:84px"> – <input type="number" id="pfTo" min="${y0}" max="${y1}" placeholder="${y1}" value="${esc(PUBF.to)}" style="width:84px"></label>
      <button type="button" id="pfReset">Limpiar filtros</button>
      <button type="button" id="pfCsv">Descargar CSV</button>
    </div>
    <p class="note" id="pfScope"></p>
    <div class="kpis" id="pubKpis"></div>
    <div class="card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Producción por año</h2>
      <span class="seg" id="pfYearSeg"><button data-m="pubs">Publicaciones</button><button data-m="cites">Citas recibidas</button><button data-m="oa">% acceso abierto</button></span></div>
      <div id="pubYears" style="margin-top:10px"></div></div>
    <div class="grid2 even"><div class="card"><h2>Por recinto <span class="note">(clic para filtrar)</span></h2><div id="pubCampus"></div></div>
      <div class="card"><h2 id="pubAreaTitle">Áreas más productivas</h2><div id="pubAreas"></div></div></div>
    <div class="card" style="margin:16px 0"><h2>Áreas más productivas por recinto</h2><p class="note" style="margin-top:0">Publicaciones por campo de OpenAlex. Clic en una celda para filtrar.</p><div id="pubMatrix" class="tablewrap"></div></div>
    <div class="card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Profesores más productivos y citados</h2>
      <span class="seg" id="pfRankSeg"><button data-r="pubs">Publicaciones</button><button data-r="cites">Citas</button><button data-r="h">Índice h</button></span></div>
      <div id="pubPeople" class="tablewrap" style="margin-top:10px"></div></div>
    <div class="grid2"><div class="card"><h2>Publicaciones más citadas</h2><div id="pubTop"></div></div>
      <div class="card"><h2>Revistas principales</h2><div id="pubVenues"></div></div></div>
    <p class="note" style="margin-top:14px">Cada publicación se cuenta <b>una vez</b> en los totales aunque tenga varios autores UPR; en «Por recinto» y en la matriz cuenta en cada recinto de sus autores. El área es el campo del tópico principal de OpenAlex. El índice h de la selección se calcula solo con las publicaciones filtradas; el «h OpenAlex» es el de toda la carrera del investigador. Por profesor se analizan hasta el máximo de publicaciones configurado en el harvest.</p>`;
  const subSel = () => { const subs = uniq(rows.filter(w => !PUBF.field || w.field === PUBF.field).map(w => w.sub)).sort();
    if (PUBF.sub && !subs.includes(PUBF.sub)) PUBF.sub = "";
    $("pfSub").innerHTML = opts(subs, PUBF.sub, PUBF.field ? "Todos los subcampos" : "Subcampo (todos)"); };
  subSel();
  const bind = (id, k, after) => $(id).addEventListener("input", e => { PUBF[k] = e.target.value; if (after) after(); drawPubs(rows); });
  bind("pfCampus", "campus"); bind("pfField", "field", subSel); bind("pfSub", "sub"); bind("pfType", "type"); bind("pfFrom", "from"); bind("pfTo", "to");
  $("pfReset").onclick = () => { Object.assign(PUBF, { campus: "", field: "", sub: "", type: "", from: "", to: "" }); viewPublicaciones(el); };
  $("pfCsv").onclick = () => pubsCSV(filterPubs(rows));
  const seg = (id, attr, k) => $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; PUBF[k] = b.dataset[attr]; drawPubs(rows); });
  seg("pfYearSeg", "m", "yearMetric"); seg("pfRankSeg", "r", "rank");
  drawPubs(rows);
}

function filterPubs(rows){
  const from = Number(PUBF.from) || -Infinity, to = Number(PUBF.to) || Infinity;
  return rows.filter(w => (!PUBF.field || w.field === PUBF.field) && (!PUBF.sub || w.sub === PUBF.sub) && (!PUBF.type || w.type === PUBF.type)
    && (w.year ? w.year >= from && w.year <= to : (from === -Infinity && to === Infinity))
    && (!PUBF.campus || pubCampuses(w).includes(PUBF.campus)));
}

let PUB_TOP_SEQ = 0;
async function drawPubs(rows){
  const W = filterPubs(rows), set = (id, sel) => { const n = $(id); if (n) n.value = sel; };
  set("pfCampus", PUBF.campus); set("pfField", PUBF.field); set("pfSub", PUBF.sub);
  document.querySelectorAll("#pfYearSeg button").forEach(b => b.classList.toggle("on", b.dataset.m === PUBF.yearMetric));
  document.querySelectorAll("#pfRankSeg button").forEach(b => b.classList.toggle("on", b.dataset.r === PUBF.rank));
  const parts = [PUBF.campus && `recinto ${PUBF.campus}`, PUBF.field && `campo ${PUBF.field}`, PUBF.sub && `subcampo ${PUBF.sub}`, PUBF.type && `tipo ${PUBF.type}`,
    (PUBF.from || PUBF.to) && `años ${PUBF.from || "…"}–${PUBF.to || "…"}`].filter(Boolean);
  $("pfScope").innerHTML = parts.length ? `Mostrando: <b>${esc(parts.join(" · "))}</b>` : "Mostrando: <b>toda la UPR</b>";

  // KPIs
  const cites = W.reduce((s, w) => s + w.cites, 0), people = new Set(W.flatMap(w => w.orcids).filter(o => !PUBF.campus || campusOf(STATE.researchers.get(o) || {affiliation:{campus:""}}).includes(PUBF.campus)));
  const oa = W.filter(w => w.oa).length, venues = new Set(W.map(w => w.venue).filter(Boolean));
  const recent = W.filter(w => w.year >= CURRENT_YEAR - 4).length;
  $("pubKpis").innerHTML = `
    <div class="kpi">${icon("book")}<b>${fmt(W.length)}</b><span>Publicaciones únicas · ${fmt(recent)} desde ${CURRENT_YEAR - 4}</span></div>
    <div class="kpi">${icon("cite")}<b>${fmt(cites)}</b><span>Citas · ${W.length ? (cites / W.length).toFixed(1) : 0} por publicación</span></div>
    <div class="kpi">${icon("bars")}<b>${fmt(hIndex(W.map(w => w.cites)))}</b><span>Índice h de la selección</span></div>
    <div class="kpi">${icon("users")}<b>${fmt(people.size)}</b><span>Profesores con publicaciones</span></div>
    <div class="kpi">${icon("link")}<b>${W.length ? Math.round(100 * oa / W.length) : 0}%</b><span>Acceso abierto</span></div>`;

  // por año
  const ys = W.map(w => w.year).filter(Boolean);
  if (ys.length){
    const a = Math.max(Math.min(...ys), CURRENT_YEAR - 40), b = Math.max(...ys), pts = [];
    for (let y = a; y <= b; y++){
      const ws = W.filter(w => w.year === y);
      pts.push({ x: String(y), y: PUBF.yearMetric === "cites" ? ws.reduce((s, w) => s + w.cites, 0) : PUBF.yearMetric === "oa" ? (ws.length ? Math.round(100 * ws.filter(w => w.oa).length / ws.length) : 0) : ws.length });
    }
    areaChart($("pubYears"), { points: pts, label: { pubs: "Publicaciones", cites: "Citas (por año de publicación)", oa: "% acceso abierto" }[PUBF.yearMetric],
      fmt: PUBF.yearMetric === "oa" ? v => `${v}%` : undefined });
  } else $("pubYears").innerHTML = `<p class="note">Sin publicaciones con año en la selección.</p>`;

  // por recinto
  const byC = new Map();
  for (const w of W) for (const c of pubCampuses(w)) byC.set(c, (byC.get(c) || 0) + 1);
  hbars($("pubCampus"), { items: [...byC].map(([label, value]) => ({ label, value })), top: 14, fmt: v => fmt(v),
    onClick: k => { PUBF.campus = PUBF.campus === k ? "" : k; drawPubs(rows); } });

  // áreas: campo → subcampo → tópico
  const lvl = PUBF.sub ? "topic" : PUBF.field ? "sub" : "field";
  $("pubAreaTitle").innerHTML = `${{ field: "Campos", sub: "Subcampos", topic: "Tópicos" }[lvl]} más productivos <span class="note">(clic para filtrar)</span>`;
  const byA = new Map(); for (const w of W) if (w[lvl]) byA.set(w[lvl], (byA.get(w[lvl]) || 0) + 1);
  hbars($("pubAreas"), { items: [...byA].map(([label, value]) => ({ label, value })), top: 12, fmt: v => fmt(v),
    onClick: lvl === "topic" ? null : k => { if (lvl === "field"){ PUBF.field = k; PUBF.sub = ""; const s = $("pfField"); if (s) s.value = k; s?.dispatchEvent(new Event("input")); return; } PUBF.sub = k; drawPubs(rows); } });

  // matriz recinto × campo
  const topF = [...byA.keys()].length && lvl === "field" ? [...byA].sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0])
    : [...new Map(W.map(w => [w.field, 0]))].map(x => x[0]).filter(Boolean).slice(0, 8);
  const cs = [...byC].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const cell = new Map(); let mx = 0;
  for (const w of W) for (const c of pubCampuses(w)){ const k = `${c}||${w.field}`, v = (cell.get(k) || 0) + 1; cell.set(k, v); if (topF.includes(w.field)) mx = Math.max(mx, v); }
  $("pubMatrix").innerHTML = !cs.length || !topF.length ? `<p class="note">Sin datos.</p>` : `<table class="mini heat"><thead><tr><th>Recinto</th>${topF.map(f => `<th>${esc(f)}</th>`).join("")}</tr></thead><tbody>
    ${cs.map(c => `<tr><th>${esc(c)}</th>${topF.map(f => { const v = cell.get(`${c}||${f}`) || 0, a = mx ? v / mx : 0;
      return `<td class="num" data-pcell="${esc(c)}||${esc(f)}" style="background:color-mix(in srgb, var(--s1) ${Math.round(a * 70)}%, transparent);${a > .55 ? "color:#fff" : ""}" title="${esc(c)} · ${esc(f)}: ${v}">${v ? fmt(v) : "·"}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
  $("pubMatrix").querySelectorAll("[data-pcell]").forEach(td => td.onclick = () => { const [c, f] = td.dataset.pcell.split("||"); PUBF.campus = c; PUBF.field = f; PUBF.sub = "";
    const s = $("pfField"); if (s){ s.value = f; s.dispatchEvent(new Event("input")); } else drawPubs(rows); });

  // profesores
  const per = new Map();
  for (const w of W) for (const o of w.orcids){ const R = STATE.researchers.get(o); if (!R || (PUBF.campus && !campusOf(R).includes(PUBF.campus))) continue;
    const p = per.get(o) || per.set(o, { R, n: 0, c: 0, cs: [] }).get(o); p.n++; p.c += w.cites; p.cs.push(w.cites); }
  const plist = [...per.values()].map(p => ({ ...p, h: hIndex(p.cs) }));
  const sk = { pubs: p => p.n, cites: p => p.c, h: p => p.h }[PUBF.rank];
  plist.sort((a, b) => sk(b) - sk(a) || b.c - a.c);
  $("pubPeople").innerHTML = !plist.length ? `<p class="note">Sin profesores en la selección.</p>` : `<table class="mini"><thead><tr><th>#</th><th>Profesor</th><th>Recinto</th><th class="num">Publicaciones</th><th class="num">Citas</th><th class="num">h (selección)</th><th class="num">h OpenAlex</th><th class="num">Citas totales OpenAlex</th></tr></thead><tbody>
    ${plist.slice(0, 25).map((p, i) => { const m = p.R.sources.openalex?.metrics || {}; return `<tr><td>${i + 1}</td><td><a href="#/investigador/${esc(p.R.orcid)}/publicaciones">${esc(fullName(p.R))}</a></td>
      <td>${esc(p.R.affiliation.campus)}</td><td class="num">${fmt(p.n)}</td><td class="num">${fmt(p.c)}</td><td class="num">${fmt(p.h)}</td><td class="num">${m.h_index ?? "—"}</td><td class="num">${m.citations != null ? fmt(m.citations) : "—"}</td></tr>`; }).join("")}</tbody></table>
    ${plist.length > 25 ? `<p class="note">Se muestran 25 de ${fmt(plist.length)} profesores. Descarga el CSV para la lista completa de publicaciones.</p>` : ""}`;

  // revistas
  const byV = new Map(); for (const w of W) if (w.venue) byV.set(w.venue, (byV.get(w.venue) || 0) + 1);
  hbars($("pubVenues"), { items: [...byV].map(([label, value]) => ({ label, value })), top: 12, fmt: v => fmt(v) });

  // más citadas (títulos bajo demanda)
  const top = [...W].sort((a, b) => b.cites - a.cites).slice(0, 10), seq = ++PUB_TOP_SEQ, box = $("pubTop");
  box.innerHTML = `<p class="note">Cargando…</p>`;
  let meta = new Map(); try { meta = await PUBS.meta(top.map(w => w.id)); } catch(e){ console.warn(e); }
  if (seq !== PUB_TOP_SEQ || !document.body.contains(box)) return;
  box.innerHTML = !top.length ? `<p class="note">Sin publicaciones.</p>` : `<ol class="pubs">${top.map(w => { const m = meta.get(w.id) || {};
    const url = m.doi ? `https://doi.org/${String(m.doi).replace(/^https?:\/\/doi.org\//, "")}` : `https://openalex.org/${w.id}`;
    const auth = w.orcids.map(o => STATE.researchers.get(o)).filter(Boolean);
    return `<li><a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(m.title || w.id)}</b></a>
      <div class="m">${w.year || "s.f."}${w.venue ? " · " + esc(w.venue) : ""} · <b>${fmt(w.cites)} citas</b>${w.oa ? ' · <span class="pill">Acceso abierto</span>' : ""}</div>
      <div class="m">${auth.map(R => `<a href="#/investigador/${esc(R.orcid)}">${esc(fullName(R))}</a>`).join(", ")}</div></li>`; }).join("")}</ol>`;
}

function pubsCSV(W){
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["openalex_id","año","citas","acceso_abierto","tipo","campo","subcampo","tópico","revista","profesores_upr","orcids","recintos"];
  const lines = [head.join(",")].concat(W.map(w => [w.id, w.year, w.cites, w.oa ? "sí" : "no", w.type, w.field, w.sub, w.topic, w.venue,
    w.orcids.map(o => { const R = STATE.researchers.get(o); return R ? fullName(R) : o; }).join(" | "), w.orcids.join(" | "), pubCampuses(w).join(" | ")].map(q).join(",")));
  saveBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), `upr_publicaciones_${new Date().toISOString().slice(0,10)}.csv`);
}

ROUTES.publicaciones = viewPublicaciones;
