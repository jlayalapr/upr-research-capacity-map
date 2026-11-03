"use strict";
/* =====================================================================
   VISTAS (páginas) y ENRUTADOR
   Rutas: #/ (portada) · #/acceso · #/inicio · #/investigadores · #/investigador/ORCID/tab
          #/capacidades · #/proyectos · #/colaboraciones · #/oportunidades
          #/analitica · #/recintos · #/buscar?q= · #/admin
   ===================================================================== */
const ICONS = {
  home:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M16 14.2c3 .3 5.5 2.4 5.5 5.8"/>',
  layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".6"/>',
  flask:'<path d="M9 3h6"/><path d="M10 3v6L4.5 19a1.5 1.5 0 001.3 2.2h12.4a1.5 1.5 0 001.3-2.2L14 9V3"/><path d="M7 15h10"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  bars:'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  building:'<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01"/>',
  shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  arrow:'<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout:'<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  link:'<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  book:'<path d="M4 4h10a4 4 0 014 4v12H8a4 4 0 01-4-4z"/><path d="M4 16a4 4 0 014-4h10"/>',
  cite:'<path d="M7 7h4v4c0 3-1.5 5-4 6"/><path d="M14 7h4v4c0 3-1.5 5-4 6"/>',
  money:'<circle cx="12" cy="12" r="9"/><path d="M15 9c-.5-1.2-1.7-2-3-2-1.7 0-3 1-3 2.5S10.3 12 12 12s3 .9 3 2.5S13.7 17 12 17c-1.3 0-2.5-.8-3-2"/><path d="M12 5v2M12 17v2"/>',
  pin:'<path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  pulse:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  grid:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
};
const icon = (n, cls="") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]||""}</svg>`;
function hydrateIcons(root=document){ root.querySelectorAll("[data-icon]").forEach(s => { s.outerHTML = icon(s.dataset.icon); }); }

const DOMAIN_ES = { "Health Sciences":"Salud y Ciencias Biomédicas", "Life Sciences":"Ciencias de la Vida", "Physical Sciences":"STEM e Ingeniería", "Social Sciences":"Ciencias Sociales, Educación y Humanidades" };
const ACT_ES = { "Active researcher":"Activo", "Active researcher (funding)":"Activo (con fondos)", "Recently active":"Recientemente activo", "Historically active":"Históricamente activo", "No publications found":"Sin publicaciones", "Emerging researcher":"Investigador emergente", "Currently funded":"Con fondos vigentes" };
const initials = R => ((R.identity.given||"")[0] || "") + ((R.identity.family||"")[0] || "") || "?";
const AV_COLORS = ["#123a78","#1d5fa8","#0e6b74","#5b3f9e","#8a4b12","#1f6a3a"];
const avatar = (R, cls="") => `<div class="avatar ${cls}" style="background:${AV_COLORS[parseInt(hsh(R.orcid), 36) % AV_COLORS.length]}" aria-hidden="true">${esc(initials(R).toUpperCase())}</div>`;
const listES = a => a.length <= 1 ? (a[0]||"") : a.slice(0,-1).join(", ") + " y " + a[a.length-1];
const campusOf = R => R.affiliation.campus.split(" | ");
const emailOf = R => (R.identity.emails||[])[0] || "";
const head = (crumb, title, sub, actions="") => `<div class="view-head"><div><div class="crumbs">${crumb}</div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
const emptyState = (msg="Aún no hay datos.") => `<div class="empty"><b>${esc(msg)}</b>${AUTH.isAdmin() ? `Ve a <a href="#/admin">Administración</a> para ejecutar el harvest.` : "Un administrador debe ejecutar el harvest para cargar los datos."}</div>`;
const actLabel = s => ACT_ES[s] || s || "—";

/* ---------------- datos agregados del sistema (memoizados) ---------------- */
let SYS = null, SYS_KEY = "";
function sys(){
  const key = `${STATE.researchers.size}|${STORE.savedAt}|${STATE.version||0}`;
  if (SYS && SYS_KEY === key) return SYS;
  const list = researchers(), works = new Map(), awards = new Map(), insts = new Set(), citeYear = {};
  for (const R of list){
    for (const w of (R.sources.openalex?.works || [])) if (!works.has(w.id)) works.set(w.id, w);
    for (const c of (R.sources.openalex?.author?.counts_by_year || [])) citeYear[c.year] = (citeYear[c.year]||0) + (c.citations||0);
    for (const a of (R.capacity?.funding_record?.awards || [])){
      const k = `${a.agency}:${a.id}`, A = awards.get(k) || awards.set(k, {...a, key:k, people:[]}).get(k);
      A.people.push({R, role:a.role});
    }
    for (const i of (R.capacity?.collaboration?.institutions || [])) if (!i.upr) insts.add(i.openalex_id || i.name);
  }
  const facts = capacityFacts(list);
  const capLabels = new Set(facts.filter(f => ["Expertise","Research Topic","Method","Technology","Problem"].includes(f.category) && f.confidence >= 0.4).map(f => f.capacity));
  const campuses = new Set(list.flatMap(campusOf).filter(c => c && c !== GENERAL.name));
  const summary = STATE.summary || null, useSummary = !!summary && list.some(R => R.light);
  SYS = { list, works, awards: [...awards.values()], insts, citeYear, facts, capLabels, campuses,
          pubsByYear: y => useSummary ? (summary.pubsByYear?.[y] || 0) : [...works.values()].filter(w => w.year === y).length,
          uniqueWorks: useSummary ? (summary.uniqueWorks || 0) : works.size };
  SYS_KEY = key; return SYS;
}
function invalidateSys(){ SYS = null; STATE.version = (STATE.version||0) + 1; }

/* ================================ INICIO ================================ */
function viewInicio(el){
  const S = sys();
  el.innerHTML = head(`${icon("home")} Bienvenido`, "UPR Research Capacity Map", STATE.label ? `Datos: ${esc(STATE.label)}${STORE.savedAt ? ` · actualizado ${esc(new Date(STORE.savedAt).toLocaleDateString("es"))}` : ""}` : "")
    + (!S.list.length ? emptyState() : `
    <div class="kpis">
      <div class="kpi">${icon("users")}<b>${fmt(S.list.length)}</b><span>Investigadores</span></div>
      <div class="kpi">${icon("layers")}<b>${fmt(S.capLabels.size)}</b><span>Capacidades</span></div>
      <div class="kpi">${icon("flask")}<b>${fmt(S.awards.length)}</b><span>Proyectos NIH/NSF</span></div>
      <div class="kpi">${icon("link")}<b>${fmt(S.insts.size)}</b><span>Instituciones colaboradoras</span></div>
      <div class="kpi">${icon("building")}<b>${fmt(S.campuses.size)}</b><span>Recintos</span></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Actividad de investigación UPR <span class="spacer"></span>
        <span class="seg" id="actSeg"><button data-m="pubs" class="on">Publicaciones</button><button data-m="proj">Proyectos iniciados</button><button data-m="cites">Citas</button></span></h2>
        <div id="actChart"></div></div>
      <div class="card"><h2>Áreas de capacidad</h2><div id="domainChart"></div></div>
    </div>
    <div class="grid3" style="margin-top:16px">
      <div class="card"><h2>Capacidades principales</h2><div id="topCaps"></div></div>
      <div class="card"><h2>Proyectos recientes</h2><div id="recentProj"></div></div>
      <div class="card"><h2>Investigadores más citados</h2><div id="topCited"></div></div>
    </div>`);
  if (!S.list.length) return;
  const years = []; for (let y = CURRENT_YEAR - 11; y <= CURRENT_YEAR; y++) years.push(y);
  const series = {
    pubs: {label:"Publicaciones", fn: y => S.pubsByYear(y)},
    proj: {label:"Proyectos iniciados", fn: y => S.awards.filter(a => a.first_year === y).length},
    cites:{label:"Citas recibidas", fn: y => S.citeYear[y] || 0},
  };
  const draw = m => areaChart($("actChart"), {points: years.map(y => ({x:String(y), y: series[m].fn(y)})), label: series[m].label});
  draw("pubs");
  $("actSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; $("actSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); draw(b.dataset.m); };
  const dom = new Map(); for (const R of S.list){ const d = DOMAIN_ES[R.capacity?.primary_field?.domain] || "Sin datos"; dom.set(d, (dom.get(d)||0) + 1); }
  donut($("domainChart"), {items: [...dom.entries()].map(([label,value]) => ({label, value})), center:{value: fmt(S.list.length), label:"Investigadores"}, fmt: v => `${fmt(v)} investigadores`});
  const caps = new Map(); for (const f of S.facts) if (f.category === "Expertise" && f.confidence >= 0.4) (caps.get(f.capacity) || caps.set(f.capacity, new Set()).get(f.capacity)).add(f.orcid);
  hbars($("topCaps"), {items: [...caps.entries()].map(([label, s]) => ({label, value: s.size})), top: 8, fmt: v => `${v} inv.`, onClick: k => location.hash = `#/buscar?q=${encodeURIComponent(k)}`});
  $("recentProj").innerHTML = S.awards.length ? `<ul class="pubs">${[...S.awards].sort((a,b) => (b.first_year||0) - (a.first_year||0)).slice(0,5).map(a =>
    `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><div class="m">${esc(a.agency)} ${esc(a.unit)} · ${esc(yearsRange([a.first_year,a.last_year]))} · ${a.people.map(p => `<a href="#/investigador/${esc(p.R.orcid)}">${esc(fullName(p.R))}</a>`).join(", ")}</div></li>`).join("")}</ul>` : `<p class="note">Aún no se han vinculado proyectos NIH/NSF.</p>`;
  const cited = S.list.filter(R => R.sources.openalex?.metrics).sort((a,b) => (b.sources.openalex.metrics.citations||0) - (a.sources.openalex.metrics.citations||0)).slice(0,5);
  $("topCited").innerHTML = cited.length ? `<ul class="pubs">${cited.map(R => `<li style="display:flex;gap:10px;align-items:center">${avatar(R)}<div><a href="#/investigador/${esc(R.orcid)}"><b>${esc(fullName(R))}</b></a><div class="m">${esc(R.affiliation.campus)} · ${fmt(R.sources.openalex.metrics.citations)} citas</div></div></li>`).join("")}</ul>` : `<p class="note">Enriquece con OpenAlex para ver métricas.</p>`;
}

/* ============================ INVESTIGADORES ============================ */
const INV = { q:"", campus:"", field:"", cap:"", status:"", mode:"list", page:0, per:30 };
function viewInvestigadores(el, r){
  const S = sys();
  if (r.q.get("campus") !== null) { INV.campus = r.q.get("campus"); INV.page = 0; }
  const fields = uniq(S.list.map(R => R.capacity?.primary_field?.capacity)).sort();
  const capCount = new Map(); for (const f of S.facts) if ((f.category === "Expertise" || f.category === "Technology" || f.category === "Method") && f.confidence >= 0.4) capCount.set(f.capacity, (capCount.get(f.capacity)||0) + 1);
  const caps = [...capCount.entries()].sort((a,b) => b[1]-a[1]).slice(0,40).map(x => x[0]);
  const opt = (v, cur, label=v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
  el.innerHTML = head(`${icon("user")} Investigadores`, "Investigadores UPR", "Explora perfiles, áreas de pericia, proyectos y posibilidades de colaboración.",
      AUTH.isAdmin() ? `<a class="btn gold" href="#/admin">+ Añadir / actualizar perfiles</a>` : "")
    + (!S.list.length ? emptyState() : `
    <div class="filters">
      <input type="search" id="invQ" placeholder="Buscar por nombre, tema o palabra clave…" value="${esc(INV.q)}">
      <select id="invCampus"><option value="">Recinto</option>${[...CAMPUSES, GENERAL].map(c => c.name).filter(n => S.list.some(R => campusOf(R).includes(n))).map(n => opt(n, INV.campus)).join("")}</select>
      <select id="invField"><option value="">Área de investigación</option>${fields.map(f => opt(f, INV.field)).join("")}</select>
      <select id="invCap"><option value="">Capacidad</option>${caps.map(c => opt(c, INV.cap)).join("")}</select>
      <select id="invStatus"><option value="">Estado</option>${["Active researcher","Recently active","Historically active","Active researcher (funding)"].map(s => opt(s, INV.status, actLabel(s))).join("")}</select>
      <span class="seg" id="invMode"><button data-m="list" class="${INV.mode === "list" ? "on" : ""}" aria-label="Lista">${icon("list")}</button><button data-m="grid" class="${INV.mode === "grid" ? "on" : ""}" aria-label="Cuadrícula">${icon("grid")}</button></span>
    </div>
    <p class="note" id="invCount"></p><div id="invList"></div><div class="pager" id="invPager"></div>`);
  if (!S.list.length) return;
  const bind = (id, k) => $(id).addEventListener("input", e => { INV[k] = e.target.value; INV.page = 0; drawInv(); });
  bind("invQ","q"); bind("invCampus","campus"); bind("invField","field"); bind("invCap","cap"); bind("invStatus","status");
  $("invMode").onclick = e => { const b = e.target.closest("button"); if (!b) return; INV.mode = b.dataset.m; $("invMode").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); drawInv(); };
  $("invPager").onclick = e => { const b = e.target.closest("[data-pg]"); if (!b) return; INV.page = Number(b.dataset.pg); drawInv(); window.scrollTo({top:0, behavior:"smooth"}); };
  drawInv();
}
function researcherTags(R, n=3){
  const P = R.capacity; if (!P) return [];
  return uniq([...(P.expertise||[]), ...(P.research_areas||[]), ...(P.technologies||[])].map(e => e.capacity)).slice(0, n);
}
function drawInv(){
  const S = sys(), q = norm(INV.q);
  let list = S.list.filter(R =>
    (!INV.campus || campusOf(R).includes(INV.campus)) &&
    (!INV.field || R.capacity?.primary_field?.capacity === INV.field) &&
    (!INV.status || R.capacity?.activity?.status === INV.status) &&
    (!INV.cap || (R.capacity?.evidence||[]).some(e => e.capacity === INV.cap && e.confidence >= 0.4)) &&
    (!q || norm([fullName(R), R.affiliation.dept, R.affiliation.role, R.orcid, ...(R.capacity?.evidence||[]).map(e => e.capacity)].join(" ")).includes(q)));
  list.sort((a,b) => (a.identity.family + a.identity.given).localeCompare(b.identity.family + b.identity.given, "es"));
  const pages = Math.max(1, Math.ceil(list.length / INV.per)); INV.page = Math.min(INV.page, pages - 1);
  const slice = list.slice(INV.page * INV.per, (INV.page + 1) * INV.per);
  $("invCount").textContent = `${fmt(list.length)} investigador(es)`;
  const icons = R => `<div class="icons"><a class="iconbtn orcid" href="https://orcid.org/${esc(R.orcid)}" target="_blank" rel="noopener" title="ORCID">iD</a>
      <a class="iconbtn" ${emailOf(R) ? `href="mailto:${esc(emailOf(R))}"` : 'aria-disabled="true"'} title="${emailOf(R) ? "Enviar correo" : "Sin correo público en ORCID"}">${icon("mail")}</a></div>`;
  const tags = R => researcherTags(R).map(t => `<span class="tag">${esc(t)}</span>`).join("") || `<span class="note">Sin capacidades aún</span>`;
  $("invList").innerHTML = !slice.length ? `<div class="empty"><b>Ningún investigador coincide con los filtros.</b></div>`
    : INV.mode === "grid"
    ? `<div class="rgrid">${slice.map(R => `<div class="rcard"><div class="top">${avatar(R)}<div><a href="#/investigador/${esc(R.orcid)}">${esc(fullName(R))}</a><div class="note">UPR ${esc(R.affiliation.campus)}</div></div></div>
        <div>${tags(R)}</div>${icons(R)}</div>`).join("")}</div>`
    : `<div class="rlist">${slice.map(R => `<div class="rrow">${avatar(R)}<div class="who"><a href="#/investigador/${esc(R.orcid)}"><b>${esc(fullName(R))}</b></a><small>UPR ${esc(R.affiliation.campus)}${R.affiliation.dept ? " · " + esc(R.affiliation.dept) : ""}</small></div>
        <div class="tags">${tags(R)}</div>${icons(R)}</div>`).join("")}</div>`;
  $("invPager").innerHTML = pages > 1 ? `<button data-pg="${INV.page-1}" ${INV.page ? "" : "disabled"}>‹ Anterior</button><span class="note">Página ${INV.page+1} de ${pages}</span><button data-pg="${INV.page+1}" ${INV.page < pages-1 ? "" : "disabled"}>Siguiente ›</button>` : "";
}

/* =============================== PERFIL =============================== */
const PTABS = [["resumen","Resumen"],["proyectos","Proyectos"],["publicaciones","Publicaciones"],["capacidades","Capacidades"],["colaboraciones","Colaboraciones"],["fuentes","Fuentes y evidencia"]];
function summaryText(R){
  const P = R.capacity, m = R.sources.openalex?.metrics, out = [];
  if (!P) return "Aún no hay evidencia bibliográfica ni de financiamiento vinculada a este perfil.";
  const exp = (P.expertise||[]).slice(0,3).map(e => e.capacity);
  if (exp.length) out.push(`Su producción se concentra en ${listES(exp)}${P.primary_field ? ` (campo principal: ${P.primary_field.capacity})` : ""}.`);
  if (m?.publications) out.push(`OpenAlex registra ${fmt(m.publications)} publicaciones${m.years_active ? ` (${m.years_active})` : ""} y ${fmt(m.citations)} citas.`);
  const probs = (P.problems||[]).slice(0,3).map(e => e.capacity); if (probs.length) out.push(`Estudia problemas como ${listES(probs)}.`);
  const meth = [...(P.methods||[]).slice(0,2), ...(P.technologies||[]).slice(0,2)].map(e => e.capacity); if (meth.length) out.push(`Utiliza ${listES(meth)}.`);
  if (P.topics?.emerging?.length) out.push(`Temas emergentes: ${listES(P.topics.emerging.slice(0,3).map(e => e.capacity))}.`);
  const fr = P.funding_record; if (fr?.total_awards) out.push(`Tiene ${fr.total_awards} proyecto(s) NIH/NSF vinculados (${money$(fr.total_amount)}${fr.active_awards ? `, ${fr.active_awards} vigente(s)` : ""}).`);
  return out.join(" ");
}
function viewInvestigador(el, r){
  const R = STATE.researchers.get(r.args[0]);
  if (!R){ el.innerHTML = head("Investigadores", "Perfil no encontrado", "") + `<div class="empty"><b>No existe un investigador con ese ORCID en los datos.</b><a href="#/investigadores">Volver a la lista</a></div>`; return; }
  const tab = PTABS.some(t => t[0] === r.args[1]) ? r.args[1] : "resumen";
  if (R.light && ["publicaciones","colaboraciones","fuentes","capacidades"].includes(tab)){
    el.innerHTML = `<div class="empty"><b>Cargando el perfil completo…</b></div>`;
    STORE.fullRecord(R.orcid).then(() => { if (parseHash().args[0] === R.orcid) route(); })
      .catch(e => { el.innerHTML = `<div class="empty"><b>No se pudo cargar el perfil completo.</b>${esc(e.message)}</div>`; });
    return;
  }
  const P = R.capacity, oa = R.sources.openalex, m = oa?.metrics, mail = emailOf(R);
  el.innerHTML = `<div class="view-head" style="margin-bottom:8px"><div class="crumbs"><a href="#/investigadores">Investigadores</a> › Perfil</div></div>
    <div class="card"><div class="p-head">${avatar(R, "lg")}<div><h1>${esc(fullName(R))}</h1>
      <p class="sub">${esc([R.affiliation.role, "UPR " + R.affiliation.campus].filter(Boolean).join(" · "))}</p>
      <p class="sub">${esc(R.affiliation.dept || "")}</p></div>
      <div class="actions">${mail ? `<a class="btn gold" href="mailto:${esc(mail)}">${icon("mail")}Contactar</a>` : `<span class="btn" aria-disabled="true" title="Sin correo público en ORCID" style="opacity:.5">${icon("mail")}Sin correo público</span>`}
        <a class="btn" href="https://orcid.org/${esc(R.orcid)}" target="_blank" rel="noopener">ORCID</a>
        ${oa?.author ? `<a class="btn" href="https://openalex.org/${esc(oa.author.id)}" target="_blank" rel="noopener">OpenAlex</a>` : ""}</div></div>
      <nav class="ptabs">${PTABS.map(([k,l]) => `<a href="#/investigador/${esc(R.orcid)}/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</nav>
      <div id="ptab"></div></div>`;
  const box = $("ptab");
  if (tab === "resumen"){
    const tagsFrom = (list, cls="") => (list||[]).slice(0,8).map(e => `<span class="tag ${cls}" title="confianza ${e.confidence} · ${e.supporting_works} evidencia(s)">${esc(e.capacity)}</span>`).join("");
    box.innerHTML = `<div class="grid2"><div>
        <h3 style="margin-top:0">Sobre el investigador ${SRC.inf}</h3><p>${esc(summaryText(R))}</p>
        <p class="note">Resumen generado automáticamente a partir de la evidencia (OpenAlex, NIH, NSF). No es una biografía escrita por la persona.</p>
        <h3>Capacidades</h3><div>${tagsFrom(P?.expertise) || ""}${tagsFrom(P?.methods)}${tagsFrom(P?.technologies)}${!P ? '<span class="note">—</span>' : ""}</div>
        ${P?.funding_signals?.length ? `<h3>Áreas de financiamiento potenciales ${SRC.inf}</h3><div>${P.funding_signals.slice(0,6).map(f => `<span class="tag ${f.validated ? "green" : "gold"}" title="${esc(f.agencies)}">${esc(f.capacity)}${f.validated ? " ✓" : ""}</span>`).join("")}</div><p class="note">✓ = respaldada por fondos previos.</p>` : ""}
      </div><div class="side-facts card" style="box-shadow:none">
        <dl><dt>${icon("building")}</dt><dd>UPR ${esc(R.affiliation.campus)}<small>Recinto ${SRC.orcid}</small></dd>
          <dt>${icon("book")}</dt><dd>${esc(R.affiliation.dept || "—")}<small>Departamento</small></dd>
          <dt>${icon("layers")}</dt><dd>${esc(P?.primary_field?.capacity || "—")}<small>Área principal ${SRC.inf}</small></dd>
          <dt>${icon("pulse")}</dt><dd>${esc(actLabel(P?.activity?.status))}${(P?.activity?.flags||[]).map(f => ` · ${esc(actLabel(f))}`).join("")}<small>Actividad</small></dd>
          <dt>${icon("link")}</dt><dd><a href="https://orcid.org/${esc(R.orcid)}" target="_blank" rel="noopener">${esc(R.orcid)}</a><small>ORCID</small></dd></dl>
        ${m ? `<div class="tiles" style="margin-top:14px;grid-template-columns:repeat(2,1fr)"><div class="tile"><b>${fmt(m.publications)}</b><span>Publicaciones</span></div><div class="tile"><b>${fmt(m.citations)}</b><span>Citas</span></div>
          <div class="tile"><b>${fmt(m.h_index)}</b><span>Índice h</span></div><div class="tile"><b>${money$(P?.funding_record?.total_amount || 0)}</b><span>Fondos NIH/NSF</span></div></div>` : ""}
        ${R.discrepancies?.length ? `<div class="disc">Hay ${R.discrepancies.length} diferencia(s) entre ORCID y OpenAlex. <a href="#/investigador/${esc(R.orcid)}/fuentes">Ver</a></div>` : ""}
      </div></div>`;
  } else if (tab === "proyectos"){
    box.innerHTML = fundingBlock(R) + (P?.funding_record?.total_awards ? `<h3>Resumen</h3>${trackBlock(P)}` : "");
  } else if (tab === "publicaciones"){
    const works = oa?.works || [];
    if (!works.length){ box.innerHTML = `<p class="note">${oa ? "Sin publicaciones vinculadas en OpenAlex." : "Aún no se ha consultado OpenAlex."}</p>`; return; }
    let order = "recent", shown = 50;
    const draw = () => { const s = [...works].sort(order === "recent" ? (a,b) => (b.year||0) - (a.year||0) : (a,b) => b.cited_by_count - a.cited_by_count);
      box.querySelector("#pubList").innerHTML = s.slice(0, shown).map(pubItem).join("");
      box.querySelector("#pubMore").hidden = shown >= s.length; };
    box.innerHTML = `<div class="filters"><span class="seg" id="pubSeg"><button data-o="recent" class="on">Más recientes</button><button data-o="cited">Más citadas</button></span>
      <span class="note">${fmt(works.length)} publicaciones analizadas${oa.works_truncated ? ` de ${fmt(oa.works_total)}` : ""} ${SRC.oa}</span></div><ul class="pubs" id="pubList"></ul><button id="pubMore" class="btn" style="margin-top:10px">Mostrar más</button>`;
    box.querySelector("#pubSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; order = b.dataset.o; box.querySelectorAll("#pubSeg button").forEach(x => x.classList.toggle("on", x === b)); draw(); };
    box.querySelector("#pubMore").onclick = () => { shown += 50; draw(); };
    draw();
  } else if (tab === "capacidades"){
    box.innerHTML = tabProfile(R);
  } else if (tab === "colaboraciones"){
    const C = P?.collaboration;
    box.innerHTML = !C ? `<p class="note">Sin datos de coautoría (requiere OpenAlex).</p>` : `<div class="grid2 even"><div><h3 style="margin-top:0">Coautores principales ${SRC.oa}</h3>${collabList(C.top_coauthors)}</div>
      <div><h3 style="margin-top:0">Instituciones colaboradoras</h3><ul class="pubs">${C.institutions.map(i => `<li>${esc(i.name)} <span class="m">· ${i.works} trabajo(s)${i.country ? " · " + esc(i.country) : ""}</span>${i.upr ? ' <span class="pill">UPR</span>' : ""}</li>`).join("") || "<li class='note'>—</li>"}</ul>
      <p class="note">Recintos UPR: ${C.upr_campuses.map(c => `${esc(c.campus)} (${c.works})`).join(" · ") || "—"}<br>Colaboración internacional: ${Math.round(C.international.share*100)}% de los trabajos · ${C.frequency.mean_coauthors} coautores en promedio</p></div></div>`;
  } else {
    box.innerHTML = tabFicha(R) + tabEvidence(R);
  }
}

/* ============================== CAPACIDADES ============================== */
function viewCapacidades(){ try { renderCampusMap(); } catch(e){ console.error(e); } setTimeout(() => { if (MAPV.map) MAPV.map.invalidateSize(); }, 60); }

/* =============================== PROYECTOS =============================== */
const PRJ = { status:"", campus:"", agency:"", unit:"", q:"" };
function viewProyectos(el){
  const S = sys();
  const units = uniq(S.awards.map(a => `${a.agency} ${a.unit}`.trim())).sort();
  const opt = (v, cur, l=v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  el.innerHTML = head(`${icon("flask")} Proyectos`, "Proyectos de Investigación", `Proyectos NIH y NSF vinculados a profesores de la UPR ${SRC.fund}`)
    + (!S.awards.length ? `<div class="empty"><b>Aún no hay proyectos vinculados.</b>${AUTH.isAdmin() ? `Ejecuta "Buscar financiamiento" en <a href="#/admin">Administración</a>.` : "Un administrador debe ejecutar la búsqueda de financiamiento."}</div>` : `
    <div class="filters"><input type="search" id="prjQ" placeholder="Buscar por título o investigador…" value="${esc(PRJ.q)}">
      <select id="prjStatus"><option value="">Estado</option>${opt("on", PRJ.status, "Vigente")}${opt("off", PRJ.status, "Finalizado")}</select>
      <select id="prjCampus"><option value="">Recinto</option>${[...S.campuses].sort().map(c => opt(c, PRJ.campus)).join("")}</select>
      <select id="prjAgency"><option value="">Agencia</option>${opt("NIH", PRJ.agency)}${opt("NSF", PRJ.agency)}</select>
      <select id="prjUnit"><option value="">Instituto / programa</option>${units.map(u => opt(u, PRJ.unit)).join("")}</select></div>
    <p class="note" id="prjCount"></p><div class="card" style="padding:0" id="prjList"></div>`);
  if (!S.awards.length) return;
  for (const [id,k] of [["prjQ","q"],["prjStatus","status"],["prjCampus","campus"],["prjAgency","agency"],["prjUnit","unit"]]) $(id).addEventListener("input", e => { PRJ[k] = e.target.value; drawPrj(); });
  drawPrj();
}
function drawPrj(){
  const q = norm(PRJ.q);
  const list = sys().awards.filter(a => (!PRJ.status || (PRJ.status === "on") === !!a.is_active) && (!PRJ.agency || a.agency === PRJ.agency) &&
    (!PRJ.unit || `${a.agency} ${a.unit}`.trim() === PRJ.unit) && (!PRJ.campus || a.people.some(p => campusOf(p.R).includes(PRJ.campus))) &&
    (!q || norm(a.title + " " + a.people.map(p => fullName(p.R)).join(" ")).includes(q)))
    .sort((a,b) => (b.is_active?1:0) - (a.is_active?1:0) || (b.last_year||0) - (a.last_year||0));
  $("prjCount").textContent = `${fmt(list.length)} proyecto(s) · ${money$(list.reduce((s,a) => s + (a.amount||0), 0))}`;
  $("prjList").innerHTML = list.slice(0, 200).map(a => `<div class="item"><div class="agency ${esc(a.agency)}">${esc(a.agency)}</div>
    <div><h3><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a></h3>
      <div class="meta">${esc(uniq(a.people.flatMap(p => campusOf(p.R)).map(c => "UPR " + c)).join(", "))} · ${esc(a.agency)} ${esc(a.unit_name || a.unit)}${a.mechanism ? " · " + esc(a.mechanism) : ""} · ${esc(a.id)}</div>
      <div class="meta">${a.people.map(p => `<a href="#/investigador/${esc(p.R.orcid)}">${esc(fullName(p.R))}</a> (${esc(p.role)})`).join(", ")} · ${esc(yearsRange([a.first_year, a.last_year]))} · ${money$(a.amount)}</div></div>
    <span class="status ${a.is_active ? "on" : "off"}">${a.is_active ? "Vigente" : "Finalizado"}</span></div>`).join("") || `<div class="empty"><b>Ningún proyecto coincide.</b></div>`;
}

/* ============================ COLABORACIONES ============================ */
function viewColaboraciones(el, r){
  const q = r.q.get("q"); if (q){ $("q").value = q; renderQuery(q); }
  const S = sys(), box = $("collabExtra");
  if (!S.list.some(R => R.capacity?.collaboration)){ box.innerHTML = ""; return; }
  const pairs = new Map(), campusPair = new Map(), ext = new Map();
  for (const R of S.list){
    const C = R.capacity?.collaboration; if (!C) continue;
    for (const c of C.top_coauthors) if (c.in_dataset && c.in_dataset !== R.orcid){
      const k = [R.orcid, c.in_dataset].sort().join("|"); pairs.set(k, Math.max(pairs.get(k)||0, c.works)); }
    for (const own of campusOf(R)) for (const u of C.upr_campuses) if (!u.own && u.campus !== GENERAL.name && own !== GENERAL.name){
      const k = [own, u.campus].sort().join(" ↔ "); campusPair.set(k, (campusPair.get(k)||0) + u.works); }
    for (const i of C.institutions) if (!i.upr) ext.set(i.name, (ext.get(i.name)||0) + i.works);
  }
  const P = [...pairs.entries()].sort((a,b) => b[1]-a[1]).slice(0, 15);
  box.innerHTML = `<div class="grid2" style="margin-top:16px">
    <div class="card"><h2>Colaboraciones internas UPR ${SRC.oa}</h2>${P.length ? `<ul class="pubs">${P.map(([k,w]) => { const [a,b] = k.split("|").map(o => STATE.researchers.get(o));
        return `<li><a href="#/investigador/${esc(a.orcid)}">${esc(fullName(a))}</a> ↔ <a href="#/investigador/${esc(b.orcid)}">${esc(fullName(b))}</a> <span class="m">· ${w} trabajo(s) en coautoría · ${esc(a.affiliation.campus)} / ${esc(b.affiliation.campus)}</span></li>`; }).join("")}</ul>` : `<p class="note">No se encontraron coautorías entre los profesores del conjunto.</p>`}</div>
    <div class="card"><h2>Colaboración entre recintos</h2><div id="campPairs"></div></div></div>
    <div class="card" style="margin-top:16px"><h2>Instituciones externas con más coautorías</h2><div id="extInst"></div></div>`;
  hbars($("campPairs"), {items: [...campusPair.entries()].map(([label, value]) => ({label, value})), fmt: v => `${v} trabajos`});
  hbars($("extInst"), {items: [...ext.entries()].map(([label, value]) => ({label, value})), top: 12, fmt: v => `${v} trabajos`});
}

/* ============================= OPORTUNIDADES ============================= */
const OPP = { tab:"calls", agency:"", q:"", area:"", within:"", saved:false };
const BM = { get(){ try { return JSON.parse(localStorage.getItem("uprcap:bookmarks") || "{}"); } catch { return {}; } },
             toggle(o){ const b = this.get(); if (b[o.id]) delete b[o.id]; else b[o.id] = o; try { localStorage.setItem("uprcap:bookmarks", JSON.stringify(b)); } catch {} return !!b[o.id]; } };
function capacityAreas(){
  const areas = new Map();
  for (const R of sys().list) for (const f of (R.capacity?.funding_signals || [])){
    const A = areas.get(f.capacity) || areas.set(f.capacity, {label:f.capacity, agencies:f.agencies, people:[], campuses:new Map()}).get(f.capacity);
    A.people.push({R, conf:f.confidence, validated:!!f.validated});
    for (const c of campusOf(R)) A.campuses.set(c, (A.campuses.get(c)||0) + 1);
  }
  for (const A of areas.values()) A.people.sort((x,y) => (y.validated?1:0) - (x.validated?1:0) || y.conf - x.conf);
  return areas;
}
function viewOportunidades(el){
  const areas = capacityAreas();
  el.innerHTML = head(`${icon("target")} Oportunidades`, "Oportunidades de Financiamiento", "Convocatorias abiertas relacionadas con las capacidades de la UPR, y los investigadores que podrían liderarlas.",
      `<span class="seg" id="oppTab"><button data-t="calls" class="${OPP.tab === "calls" ? "on" : ""}">Convocatorias abiertas</button><button data-t="areas" class="${OPP.tab === "areas" ? "on" : ""}">Áreas de capacidad</button></span>`)
    + (!areas.size ? emptyState("Aún no hay áreas de oportunidad (requiere enriquecer con OpenAlex).") : `<div id="oppBody"></div>`);
  $("oppTab").onclick = e => { const b = e.target.closest("button"); if (!b) return; OPP.tab = b.dataset.t; viewOportunidades(el); };
  if (!areas.size) return;
  if (OPP.tab === "areas") return drawAreas(areas);
  drawCalls(areas);
}
function drawAreas(areas){
  const agencies = uniq([...areas.values()].flatMap(a => a.agencies.split("·").map(s => s.trim().split(/\s|\(/)[0]))).sort();
  $("oppBody").innerHTML = `<div class="notice" style="margin-bottom:14px">${SRC.inf} Áreas <b>inferidas</b> de las publicaciones y los proyectos de cada investigador; no son convocatorias.</div>
    <div class="filters"><input type="search" id="oppQ" placeholder="Buscar área…" value="${esc(OPP.q)}">
      <select id="oppAg"><option value="">Agencia</option>${agencies.map(a => `<option ${a === OPP.agency ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
    <div class="card" style="padding:0" id="oppList"></div>`;
  const draw = () => {
    const q = norm(OPP.q);
    const list = [...areas.values()].filter(a => (!OPP.agency || a.agencies.includes(OPP.agency)) && (!q || norm(a.label + " " + a.agencies).includes(q)))
      .sort((a,b) => b.people.length - a.people.length);
    $("oppList").innerHTML = list.map(a => { const val = a.people.filter(p => p.validated).length;
      return `<div class="item"><div class="agency inf">${esc(a.agencies.split(/[\s·(]/)[0])}</div>
        <div><h3>${esc(a.label)}</h3><div class="meta">${esc(a.agencies)}</div>
          <div style="margin:6px 0"><span class="tag">${a.people.length} investigador(es)</span>${val ? `<span class="tag green">${val} con fondos previos en el área</span>` : ""}${[...a.campuses.entries()].sort((x,y) => y[1]-x[1]).slice(0,4).map(([c,n]) => `<span class="tag gold">${esc(c)} · ${n}</span>`).join("")}</div>
          <div class="meta">${a.people.slice(0,5).map(p => `<a href="#/investigador/${esc(p.R.orcid)}">${esc(fullName(p.R))}</a>${p.validated ? " ✓" : ""}`).join(", ")}</div></div>
        <a class="btn" href="#/colaboraciones?q=${encodeURIComponent(a.label)}">Armar equipo</a></div>`; }).join("") || `<div class="empty"><b>Ningún área coincide.</b></div>`;
  };
  $("oppQ").addEventListener("input", e => { OPP.q = e.target.value; draw(); });
  $("oppAg").addEventListener("input", e => { OPP.agency = e.target.value; draw(); });
  draw();
}
let CALLS = null, CALLS_KEY = "";
async function drawCalls(areas){
  const top = [...areas.values()].filter(a => GRANTS_QUERIES[a.label]).sort((a,b) => b.people.length - a.people.length).slice(0, 12);
  $("oppBody").innerHTML = `<div class="notice" style="margin-bottom:14px">Convocatorias <b>abiertas o anunciadas</b> en <a href="https://www.grants.gov" target="_blank" rel="noopener">Grants.gov</a>, buscadas para las ${top.length} áreas donde la UPR tiene más capacidad. Los investigadores sugeridos salen de la evidencia (publicaciones y proyectos); verifica la elegibilidad en cada convocatoria.</div>
    <div class="filters"><input type="search" id="callQ" placeholder="Buscar convocatoria…" value="${esc(OPP.q)}">
      <select id="callArea"><option value="">Área UPR</option>${top.map(a => `<option ${a.label === OPP.area ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select>
      <select id="callWithin"><option value="">Fecha límite</option>${[["30","En 30 días"],["90","En 90 días"],["180","En 6 meses"]].map(([v,l]) => `<option value="${v}" ${v === OPP.within ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label class="note"><input type="checkbox" id="callSaved" ${OPP.saved ? "checked" : ""}> Solo guardadas</label></div>
    <p class="note" id="callCount">Buscando convocatorias…</p><div class="card" style="padding:0" id="callList"></div>`;
  const key = top.map(a => a.label).join("|");
  if (!CALLS || CALLS_KEY !== key){
    CALLS = new Map(); CALLS_KEY = key; const errors = [];
    await pool(top, 3, async a => {
      try { for (const o of await GRANTS.search(GRANTS_QUERIES[a.label])){ const c = CALLS.get(o.id) || CALLS.set(o.id, {...o, areas:[]}).get(o.id); if (!c.areas.includes(a.label)) c.areas.push(a.label); } }
      catch(e){ errors.push(e.message); }
    });
    if (errors.length && !CALLS.size){ $("callCount").innerHTML = `<span style="color:#c0352f">No se pudo consultar Grants.gov: ${esc(errors[0])}</span>`; CALLS = null; return; }
  }
  const draw = () => {
    const q = norm(OPP.q), now = new Date(), bm = BM.get();
    let list = [...CALLS.values()].filter(c => (!OPP.area || c.areas.includes(OPP.area)) && (!q || norm(c.title + " " + c.agency + " " + c.number).includes(q)) && (!OPP.saved || bm[c.id]));
    if (OPP.within){ const lim = Number(OPP.within) * 864e5; list = list.filter(c => { const d = GRANTS.date(c.closeDate); return d && d - now >= 0 && d - now <= lim; }); }
    list.sort((a,b) => (GRANTS.date(a.closeDate)?.getTime() ?? 9e15) - (GRANTS.date(b.closeDate)?.getTime() ?? 9e15));
    $("callCount").textContent = `${fmt(list.length)} convocatoria(s)`;
    $("callList").innerHTML = list.slice(0, 150).map(c => {
      const d = GRANTS.date(c.closeDate), days = d ? Math.ceil((d - now) / 864e5) : null;
      const people = uniq(c.areas.flatMap(l => areas.get(l).people.slice(0, 3).map(p => p.R.orcid))).slice(0, 4).map(o => STATE.researchers.get(o));
      return `<div class="item"><div class="agency ${esc(GRANTS.badge(c))}">${esc(GRANTS.badge(c))}</div>
        <div><h3><a href="${esc(GRANTS.url(c))}" target="_blank" rel="noopener">${esc(c.title)}</a> <span class="note">(${esc(c.number)})</span></h3>
          <div class="meta">${esc(c.agency)} · ${c.status === "forecasted" ? "Anunciada (pronóstico)" : "Abierta"}${c.openDate ? " desde " + esc(c.openDate) : ""}</div>
          <div style="margin:6px 0">${c.areas.map(l => `<span class="tag">${esc(l)}</span>`).join("")}</div>
          <div class="meta">Investigadores UPR con capacidad: ${people.map(R => `<a href="#/investigador/${esc(R.orcid)}">${esc(fullName(R))}</a>`).join(", ") || "—"}</div></div>
        <div class="deadline ${days !== null && days <= 30 ? "soon" : ""}">Fecha límite<b>${d ? esc(c.closeDate) : (c.status === "forecasted" ? "Por anunciar" : "Continua / no indicada")}</b>${days !== null && days >= 0 ? `${days} día(s)` : ""}
          <div><button class="bm ${bm[c.id] ? "on" : ""}" data-bm="${esc(c.id)}" title="Guardar convocatoria" aria-label="Guardar">${bm[c.id] ? "★" : "☆"}</button></div></div></div>`; }).join("") || `<div class="empty"><b>No hay convocatorias que coincidan.</b></div>`;
    $("callList").querySelectorAll("[data-bm]").forEach(b => b.onclick = () => { const on = BM.toggle(CALLS.get(b.dataset.bm)); b.classList.toggle("on", on); b.textContent = on ? "★" : "☆"; if (OPP.saved) draw(); });
  };
  $("callQ").addEventListener("input", e => { OPP.q = e.target.value; draw(); });
  $("callArea").addEventListener("input", e => { OPP.area = e.target.value; draw(); });
  $("callWithin").addEventListener("input", e => { OPP.within = e.target.value; draw(); });
  $("callSaved").addEventListener("input", e => { OPP.saved = e.target.checked; draw(); });
  draw();
}

/* =============================== ANALÍTICA =============================== */
function viewAnalitica(){
  const S = sys(), top = $("analyticsTop");
  const amount = S.awards.reduce((s,a) => s + (a.amount||0), 0);
  const cites = S.list.reduce((s,R) => s + (R.sources.openalex?.metrics?.citations || 0), 0);
  const active = S.list.filter(R => R.capacity?.activity?.status?.startsWith("Active")).length;
  top.innerHTML = head(`${icon("bars")} Analítica`, "Analítica de Capacidades", "Indicadores de la actividad investigativa y las capacidades institucionales.")
    + (!S.list.length ? emptyState() : `<div class="kpis">
      <div class="kpi">${icon("money")}<b>${money$(amount)}</b><span>Fondos NIH + NSF vinculados</span></div>
      <div class="kpi">${icon("flask")}<b>${fmt(S.awards.length)}</b><span>Proyectos (${S.awards.filter(a => a.is_active).length} vigentes)</span></div>
      <div class="kpi">${icon("book")}<b>${fmt(S.uniqueWorks)}</b><span>Publicaciones únicas analizadas</span></div>
      <div class="kpi">${icon("cite")}<b>${fmt(cites)}</b><span>Citas (OpenAlex)</span></div>
      <div class="kpi">${icon("pulse")}<b>${S.list.length ? Math.round(100*active/S.list.length) : 0}%</b><span>Investigadores activos</span></div></div>
    <div class="grid2"><div class="card"><h2>Fondos por instituto / programa ${SRC.fund}</h2><div id="anUnits"></div></div>
      <div class="card"><h2>Fondos por recinto</h2><div id="anCampus"></div></div></div>
    <div class="grid2 even" style="margin:16px 0"><div class="card"><h2>Publicaciones por recinto</h2><div id="anPubs"></div></div>
      <div class="card"><h2>Investigadores por área principal</h2><div id="anFields"></div></div></div>`);
  if (!S.list.length) return;
  const sumBy = (keyFn, valFn) => { const m = new Map(); for (const x of S.awards) for (const k of keyFn(x)) m.set(k, (m.get(k)||0) + valFn(x)); return [...m.entries()].map(([label, value]) => ({label, value})); };
  hbars($("anUnits"), {items: sumBy(a => [`${a.agency} ${a.unit_name || a.unit}`.trim()], a => a.amount||0), fmt: money$});
  donut($("anCampus"), {items: sumBy(a => uniq(a.people.flatMap(p => campusOf(p.R))), a => a.amount||0), center:{value: money$(amount), label:"Fondos"}, fmt: money$});
  const pubs = new Map(); for (const R of S.list) for (const c of campusOf(R)) pubs.set(c, (pubs.get(c)||0) + (R.sources.openalex?.metrics?.publications || 0));
  hbars($("anPubs"), {items: [...pubs.entries()].map(([label, value]) => ({label, value}))});
  const fld = new Map(); for (const R of S.list){ const f = R.capacity?.primary_field?.capacity; if (f) fld.set(f, (fld.get(f)||0) + 1); }
  hbars($("anFields"), {items: [...fld.entries()].map(([label, value]) => ({label, value})), fmt: v => `${v} inv.`});
  renderAgg();
}

/* ================================ RECINTOS ================================ */
function viewRecintos(el){
  const S = sys(), stats = campusStats("", "");
  const cards = [...stats.values()].filter(s => s.researchers.size).sort((a,b) => (a.name === GENERAL.name) - (b.name === GENERAL.name) || b.researchers.size - a.researchers.size);
  el.innerHTML = head(`${icon("building")} Recintos`, "Recintos UPR", "Capacidades, producción y financiamiento de cada recinto.")
    + (!cards.length ? emptyState() : `<div class="grid3">${cards.map(s => `<div class="card campus-card"><h2>${icon("pin")} ${esc(s.name)}</h2>
      <div class="nums"><div><b>${fmt(s.researchers.size)}</b><span>Profesores</span></div><div><b>${fmt(s.pubs)}</b><span>Publicaciones</span></div><div><b>${money$(s.funding)}</b><span>Fondos NIH/NSF</span></div></div>
      <div>${topCaps(s.name, "Expertise", 5).map(c => `<span class="tag">${esc(c.capacity)} · ${c.researchers.size}</span>`).join("") || '<span class="note">Sin capacidades aún</span>'}</div>
      <div class="row">${s.campus.id !== "gen" ? `<button class="btn" data-mapgo="${esc(s.name)}">Ver en el mapa</button>` : ""}<a class="btn" href="#/investigadores?campus=${encodeURIComponent(s.name)}">Ver investigadores</a></div></div>`).join("")}</div>`);
  el.querySelectorAll("[data-mapgo]").forEach(b => b.onclick = () => { MAPV.selected = b.dataset.mapgo; location.hash = "#/capacidades"; });
}

/* ================================ BÚSQUEDA ================================ */
function viewBuscar(el, r){
  const q = (r.q.get("q") || "").trim(), S = sys(), nq = norm(q);
  $("topQ").value = q;
  if (!q){ el.innerHTML = head("Buscar", "Buscar", "Escribe un nombre, tema, capacidad o recinto en la barra superior."); return; }
  const people = S.list.filter(R => norm([fullName(R), R.affiliation.dept, R.affiliation.campus].join(" ")).includes(nq)).slice(0, 20);
  const res = queryCapacities(q, S.facts);
  el.innerHTML = head(`${icon("search")} Buscar`, `Resultados para «${q}»`, "")
    + `<div class="grid2"><div class="card"><h2>Investigadores por nombre, departamento o recinto</h2>${people.length ? `<ul class="pubs">${people.map(R => `<li style="display:flex;gap:10px;align-items:center">${avatar(R)}<div><a href="#/investigador/${esc(R.orcid)}"><b>${esc(fullName(R))}</b></a><div class="m">UPR ${esc(R.affiliation.campus)} · ${esc(R.affiliation.dept || "")}</div></div></li>`).join("")}</ul>` : `<p class="note">Sin coincidencias por nombre.</p>`}</div>
      <div class="card"><h2>Por capacidades ${SRC.inf}</h2>${res.researchers.length ? `<p class="note">Términos: ${res.terms.map(t => `<b>${esc(t.text)}</b>`).join(" · ")}</p><ul class="pubs">${res.researchers.slice(0, 25).map(x => { const R = STATE.researchers.get(x.orcid);
        return `<li><a href="#/investigador/${esc(x.orcid)}"><b>${esc(x.name)}</b></a> <span class="m">· ${esc(x.campus)}</span><div>${x.matched.map(m => `<span class="tag" title="${esc(m.category)} · confianza ${m.confidence}">${esc(m.capacity)}</span>`).join("")}</div></li>`; }).join("")}</ul>
        <p class="note"><a href="#/colaboraciones?q=${encodeURIComponent(q)}">Ver como equipo sugerido →</a></p>` : `<p class="note">Sin capacidades que coincidan.</p>`}</div></div>`;
}

/* ================================ ADMIN ================================ */
function viewAdmin(){
  const n = STATE.researchers.size;
  $("adminStatus").innerHTML = `<div><b>${fmt(n)}</b> <span class="note">investigadores</span></div>
    <div><b>${fmt(researchers().filter(R => R.sources.openalex?.author).length)}</b> <span class="note">con OpenAlex</span></div>
    <div><b>${fmt(researchers().filter(R => R.capacity?.funding_record?.total_awards).length)}</b> <span class="note">con fondos NIH/NSF</span></div>
    <div class="note">Copia de trabajo: <b>${esc(working().length ? `${STATE.scope || STATE.label} (${fmt(working().length)})` : "—")}</b> · Versión publicada: <b>${esc(STORE.published ? `${STORE.published.label} (${fmt(STORE.published.count)})` : "—")}</b> · Guardado: ${STORE.savedAt ? esc(new Date(STORE.savedAt).toLocaleString("es")) : "nunca"} · Almacenamiento: ${APP_CONFIG.backend === "local" ? "este navegador (IndexedDB)" : "base de datos Supabase"}${STORE.isLight() ? " · viendo la versión publicada" : ""}</div>`;
  updateButtons();
}

/* ================================ ENRUTADOR ================================ */
const ROUTES = { inicio:viewInicio, investigadores:viewInvestigadores, investigador:viewInvestigador, capacidades:viewCapacidades, proyectos:viewProyectos,
  colaboraciones:viewColaboraciones, oportunidades:viewOportunidades, analitica:viewAnalitica, recintos:viewRecintos, buscar:viewBuscar, admin:viewAdmin };
function parseHash(){
  const h = location.hash.replace(/^#\/?/, ""), [path, qs] = h.split("?");
  const parts = (path || "").split("/").filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || "", args: parts.slice(1), q: new URLSearchParams(qs || "") };
}
function showScreen(id){ for (const s of ["landing","gate","app"]) $(s).hidden = s !== id; }
function showGate(mode, next){
  showScreen("gate");
  $("gateViewer").hidden = mode === "admin"; $("gateAdmin").hidden = mode !== "admin";
  $("gateErr").textContent = ""; $("modeBanner").hidden = APP_CONFIG.backend !== "local";
  $("gate").dataset.next = next || (mode === "admin" ? "#/admin" : "#/inicio");
  setTimeout(() => (mode === "admin" ? $("admUser") : $("viewerPw")).focus(), 50);
}
let LAST_ROUTE = "";
function route(){
  const r = parseHash();
  if (!r.name) return showScreen("landing");
  if (r.name === "acceso") return showGate(r.q.get("admin") ? "admin" : "viewer", r.q.get("next"));
  if (!ROUTES[r.name]){ location.hash = "#/inicio"; return; }
  if (r.name === "admin" && !AUTH.isAdmin()){ location.replace(`#/acceso?admin=1&next=${encodeURIComponent("#/admin")}`); return; }
  if (!AUTH.canView()){ location.replace(`#/acceso?next=${encodeURIComponent(location.hash)}`); return; }
  showScreen("app");
  document.querySelectorAll("#views > .view").forEach(v => v.hidden = v.dataset.view !== r.name);
  document.querySelectorAll(".side a.nav").forEach(a => a.classList.toggle("on", a.dataset.r === (r.name === "investigador" ? "investigadores" : r.name === "buscar" ? "" : r.name)));
  $("app").classList.remove("nav-open");
  $("userName").textContent = AUTH.isAdmin() ? "Administrador" : "Visitante";
  $("userRole").textContent = AUTH.isAdmin() ? "Harvest y actualización" : "Acceso de consulta";
  $("userAv").textContent = AUTH.isAdmin() ? "A" : "V";
  $("dataStamp").textContent = STORE.savedAt ? `Datos: ${new Date(STORE.savedAt).toLocaleDateString("es")}` : "";
  const el = document.querySelector(`#views > .view[data-view="${r.name}"]`);
  const key = r.name + "/" + r.args.join("/");
  ROUTES[r.name](el, r);
  if (key !== LAST_ROUTE) window.scrollTo(0, 0);
  LAST_ROUTE = key;
}
function rerender(){ invalidateSys(); if (!$("app").hidden) route(); }
