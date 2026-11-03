"use strict";
/* =====================================================================
   INTERFAZ: fichas de profesor, Research Capacity Profile, Capacity Map.
   ===================================================================== */
const UI = { page: 0, perPage: 25 };
const SRC = { orcid:'<span class="src orcid">ORCID</span>', oa:'<span class="src oa">OpenAlex</span>', inf:'<span class="src inf">Inferido</span>', fund:'<span class="src fund">NIH · NSF</span>' };
const money$ = n => !n ? "$0" : n >= 1e6 ? `$${(n/1e6).toFixed(1)} M` : n >= 1e3 ? `$${Math.round(n/1e3)} K` : `$${Math.round(n)}`;
const LEVEL_LABEL = { high: ["ok","confianza alta"], medium: ["warn","confianza media · verificar"], ambiguous: ["warn","ambiguo · no asignado"] };
function awardItem(a, level){
  const [cls, txt] = LEVEL_LABEL[level || a.level || a.match?.level] || ["",""];
  return `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title || a.id)}</a> ${txt ? `<span class="pill ${cls}">${esc(txt)}</span>` : ""}
    <div class="m">${esc([`${a.agency} ${a.unit}`.trim(), a.mechanism, a.id].filter(Boolean).join(" · "))} · ${esc(yearsRange([a.first_year, a.last_year]))} · ${money$(a.amount)}
    · ${esc(a.role || a.match?.role || "")}${a.is_active ? " · <b>vigente</b>" : ""}${a.match?.reasons ? ` · <i>${esc(a.match.reasons.join(", "))}</i>` : ""}</div></li>`;
}
function fundingBlock(R){
  const srcs = ["nih","nsf"].filter(k => R.sources[k]);
  if (!srcs.length) return `<h3>Financiamiento ${SRC.fund}</h3><p class="note">Aún no se ha consultado NIH RePORTER ni NSF Awards.</p>`;
  const all = srcs.flatMap(k => R.sources[k].awards);
  if (!all.length) return `<h3>Financiamiento ${SRC.fund}</h3><p class="note">Sin proyectos NIH/NSF de la UPR vinculados a este nombre desde ${R.sources[srcs[0]].window_since}.</p>`;
  const order = {high:0, medium:1, ambiguous:2};
  return `<h3>Financiamiento ${SRC.fund}</h3><p class="note" style="margin:0 0 4px">Vinculado por nombre + institución UPR (estas fuentes no usan ORCID). Solo los de confianza alta${FUND_CFG.includeMedium ? " y media" : ""} cuentan en el perfil.</p>
    <ul class="pubs">${all.sort((a,b) => order[a.match.level] - order[b.match.level] || (b.last_year||0) - (a.last_year||0)).map(a => awardItem(a)).join("")}</ul>`;
}
function trackBlock(P){
  const F = P.funding_record;
  if (!F?.total_awards) return `<p class="note">Sin fondos NIH/NSF vinculados con confianza suficiente (o aún no se han consultado).</p>`;
  return `<div class="tiles"><div class="tile"><b>${F.total_awards}</b><span>Proyectos</span></div><div class="tile"><b>${money$(F.total_amount)}</b><span>Total</span></div>
      <div class="tile"><b>${F.active_awards}</b><span>Vigentes</span></div><div class="tile"><b>${F.as_lead_pi}</b><span>Como PI</span></div></div>
    <div style="margin-top:8px">${chips(P.evidence.filter(e => e.category === "Funding Track Record"))}</div>
    <ul class="pubs">${F.awards.slice(0,8).map(a => awardItem(a, a.level)).join("")}</ul>`;
}
const fmt = n => (n === null || n === undefined || n === "") ? "—" : Number(n).toLocaleString("es");
const oaLink = id => id ? `<a href="https://openalex.org/${esc(id)}" target="_blank" rel="noopener">${esc(id)}</a>` : "—";
const fullName = R => `${R.identity.given} ${R.identity.family}`.trim() || R.identity.credit || R.orcid;

function chip(e, extra=""){
  const tip = [`${e.category}`, `confianza ${e.confidence}`, `${e.supporting_works} evidencia(s) (publicaciones/proyectos)`, e.years && `años ${e.years}`,
               e.subfield && `subcampo: ${e.subfield}`, e.field && `campo: ${e.field}`, `fuente: ${e.source}`, e.method && `método: ${e.method}`].filter(Boolean).join(" · ");
  return `<span class="chip${e.single_evidence ? " single" : ""}" title="${esc(tip)}">${esc(e.capacity)}${extra}
    <span class="meter"><i style="width:${Math.round(e.confidence*100)}%"></i></span><span class="c">${e.supporting_works}</span></span>`;
}
function chips(list, empty="Sin evidencia suficiente."){
  return list?.length ? `<div class="chips">${list.map(e => chip(e)).join("")}</div>` : `<p class="note">${empty}</p>`;
}
function capSec(title, body, badge=SRC.inf){ return `<div class="cap-sec"><h4>${esc(title)} ${badge}</h4>${body}</div>`; }

/* ---------------- lista de fichas ---------------- */
function filteredResearchers(){
  const f = norm($("rFilter").value), c = $("rCampus").value, s = $("rSort").value;
  let list = researchers().filter(R => !c || R.affiliation.campus.split(" | ").includes(c));
  if (f) list = list.filter(R => norm([fullName(R), R.affiliation.dept, R.affiliation.role, R.orcid,
      ...(R.capacity?.evidence||[]).map(e => e.capacity)].join(" ")).includes(f));
  const m = R => R.sources.openalex?.metrics || {};
  const cmp = { name: (a,b) => (a.identity.family+a.identity.given).localeCompare(b.identity.family+b.identity.given, "es"),
    citations: (a,b) => (m(b).citations||0) - (m(a).citations||0), pubs: (a,b) => (m(b).publications||0) - (m(a).publications||0),
    h: (a,b) => (m(b).h_index||0) - (m(a).h_index||0) }[s];
  return list.sort(cmp);
}
function renderFichas(){
  const list = filteredResearchers(), total = researchers().length;
  $("rCount").textContent = total ? `${list.length} de ${total}` : "";
  const pages = Math.max(1, Math.ceil(list.length / UI.perPage)); UI.page = Math.min(UI.page, pages-1);
  const slice = list.slice(UI.page*UI.perPage, (UI.page+1)*UI.perPage);
  $("fichas").innerHTML = total ? slice.map(fichaShell).join("") || `<p class="note">Ningún profesor coincide con el filtro.</p>`
                                : `<p class="note">Haz una búsqueda en ORCID o importa un archivo JSON del mapa.</p>`;
  $("pager").innerHTML = pages > 1 ? `<button ${UI.page ? "" : "disabled"} data-p="${UI.page-1}">‹ Anterior</button><span class="note">Página ${UI.page+1} de ${pages}</span><button ${UI.page < pages-1 ? "" : "disabled"} data-p="${UI.page+1}">Siguiente ›</button>` : "";
  // campus filter options
  const sel = $("rCampus"), cur = sel.value, cs = uniq(researchers().flatMap(R => R.affiliation.campus.split(" | "))).sort();
  sel.innerHTML = `<option value="">Todos los recintos</option>` + cs.map(c => `<option ${c===cur?"selected":""}>${esc(c)}</option>`).join("");
}
function fichaShell(R){
  const oa = R.sources.openalex, m = oa?.metrics, act = R.capacity?.activity;
  let badges;
  const F = R.capacity?.funding_record;
  const fundPill = F?.total_awards ? `<span class="pill" title="${F.total_awards} proyecto(s) NIH/NSF">${money$(F.total_amount)} fondos</span>` : "";
  if (!oa) badges = `<span class="pill">sin OpenAlex</span>` + fundPill;
  else if (!oa.author) badges = `<span class="pill warn">sin perfil OpenAlex</span>` + fundPill;
  else badges = `<span class="pill">${fmt(m.publications)} pubs</span><span class="pill">${fmt(m.citations)} citas</span><span class="pill">h ${fmt(m.h_index)}</span>`
    + fundPill + (act ? `<span class="pill ${act.status.startsWith("Active") ? "ok" : ""}">${esc(act.status)}</span>` : "")
    + (R.discrepancies?.length ? `<span class="pill warn" title="Hay diferencias entre ORCID y OpenAlex">discrepancia</span>` : "");
  return `<details class="ficha" data-orcid="${esc(R.orcid)}">
    <summary><div class="f-name">${esc(fullName(R))}</div>
      <div class="f-meta">${esc([R.affiliation.role, R.affiliation.dept, R.affiliation.campus].filter(Boolean).join(" · "))}</div>
      <div class="f-badges">${badges}</div></summary>
    <div class="f-body"></div></details>`;
}
function openFicha(el, tab="ficha"){
  const R = STATE.researchers.get(el.dataset.orcid); if (!R) return;
  const body = el.querySelector(".f-body");
  const tabs = [["ficha","Ficha"],["profile","Research Capacity Profile"],["evidence","Evidencia y fuentes"]];
  body.innerHTML = `<div class="tabs">${tabs.map(([k,l]) => `<button data-tab="${k}" class="${k===tab?"on":""}">${l}</button>`).join("")}</div>
    <div class="tab-panel">${({ficha:tabFicha, profile:tabProfile, evidence:tabEvidence})[tab](R)}</div>`;
}

/* ---------------- pestaña: Ficha ---------------- */
function tabFicha(R){
  const a = R.affiliation, oa = R.sources.openalex, P = R.capacity, m = oa?.metrics;
  let h = `<div class="two"><div>
    <h3>Identidad y afiliación ${SRC.orcid}</h3>
    <dl class="kv">
      <dt>Nombre</dt><dd>${esc(fullName(R))}${R.identity.credit ? ` <span class="note">(publica como ${esc(R.identity.credit)})</span>` : ""}</dd>
      <dt>Cargo</dt><dd>${esc(a.role || "—")}</dd>
      <dt>Departamento</dt><dd>${esc(a.dept || "—")}</dd>
      ${a.college ? `<dt>Facultad/Colegio</dt><dd>${esc(a.college)} <span class="note">(derivado del departamento)</span></dd>` : ""}
      <dt>Recinto</dt><dd>${esc(a.campus || "—")}</dd>
      <dt>Institución</dt><dd>${esc(a.org || "—")}</dd>
      <dt>ORCID</dt><dd><a href="https://orcid.org/${esc(R.orcid)}" target="_blank" rel="noopener">${esc(R.orcid)}</a></dd>
    </dl></div><div>
    <h3>Perfil bibliográfico ${SRC.oa}</h3>`;
  if (!oa) h += `<p class="note">Aún no se ha consultado OpenAlex. Usa “Enriquecer con OpenAlex”.</p>`;
  else if (!oa.author){
    h += `<p class="note">${esc(oa.match?.note || "No encontrado.")}</p>`;
    if (oa.unverified_candidates?.length) h += `<p class="note"><b>Candidatos por nombre (sin verificar, no usados):</b></p><ul class="note">${oa.unverified_candidates.map(c =>
      `<li>${oaLink(c.id)} ${esc(c.name)} · ${fmt(c.works_count)} trabajos · ${esc(c.institutions.join(", "))}${c.orcid ? ` · ORCID ${esc(c.orcid)}` : ""} · <i>${esc(c.reasons.join(", "))}</i></li>`).join("")}</ul>`;
  } else {
    h += `<dl class="kv">
      <dt>OpenAlex ID</dt><dd>${oaLink(oa.author.id)}${oa.alternates?.length ? ` + ${oa.alternates.map(x => oaLink(x.id)).join(", ")}` : ""}</dd>
      <dt>Nombre</dt><dd>${esc(oa.author.name)}</dd>
      <dt>Vinculación</dt><dd>${esc(oa.match.status)} <span class="note">(${esc(oa.match.reasons?.join(", ") || "")})</span></dd>
      <dt>Instituciones</dt><dd>${esc(uniq(oa.author.last_known_institutions.map(i => i.name)).join(" | ") || "—")}</dd>
    </dl>${oa.match.note ? `<p class="note">${esc(oa.match.note)}</p>` : ""}`;
  }
  h += `</div></div>`;
  if (R.discrepancies?.length) h += `<div class="disc"><b>Discrepancias entre fuentes</b> (se conservan ambas; ORCID prevalece para la afiliación):<ul>${R.discrepancies.map(d =>
    `<li><b>${esc(d.field)}</b>: ORCID «${esc(d.orcid)}» · OpenAlex «${esc(d.openalex)}». ${esc(d.note)}</li>`).join("")}</ul></div>`;
  h += fundingBlock(R);
  if (!oa?.author) return h;

  h += `<h3>Research Metrics ${SRC.oa}</h3>
    <div class="tiles"><div class="tile"><b>${fmt(m.publications)}</b><span>Publications</span></div>
      <div class="tile"><b>${fmt(m.citations)}</b><span>Citations</span></div>
      <div class="tile"><b>${fmt(m.h_index)}</b><span>H-index</span></div>
      <div class="tile"><b>${esc(m.years_active || "—")}</b><span>Years active</span></div></div>
    ${barsByYear(P?.activity?.by_year)}
    ${oa.works_truncated ? `<p class="note">Se analizaron las ${fmt(oa.works.length)} publicaciones más recientes de ${fmt(oa.works_total)}.</p>` : ""}`;
  if (P){
    h += `<h3>Research Areas ${SRC.inf}</h3><p class="note" style="margin:0 0 6px">Topics de OpenAlex ponderados por frecuencia, relevancia, actualidad y citas.</p>${chips(P.research_areas)}`;
    const byId = new Map(oa.works.map(w => [w.id, w]));
    h += `<h3>Selected Publications ${SRC.oa}</h3><ul class="pubs">${P.selected_publications.map(id => byId.get(id)).filter(Boolean).map(pubItem).join("")}</ul>`;
    h += `<h3>Collaborators ${SRC.oa}</h3>${collabList(P.collaboration.top_coauthors.slice(0,10))}`;
  }
  return h;
}
function pubItem(w){
  const url = w.doi ? `https://doi.org/${w.doi}` : `https://openalex.org/${w.id}`;
  return `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(w.title || "(sin título)")}</a>
    <div class="m">${esc([w.year, w.source?.name, w.type].filter(Boolean).join(" · "))} · ${fmt(w.cited_by_count)} citas
    ${w.oa?.is_oa ? ` · <b>Open Access</b> (${esc(w.oa.status)})` : ""}${w.primary_topic ? ` · ${esc(w.primary_topic.name)}` : ""} · ${oaLink(w.id)}</div></li>`;
}
function collabList(list){
  if (!list?.length) return `<p class="note">Sin coautores registrados.</p>`;
  return `<ul class="pubs">${list.map(c => `<li>${esc(c.name)} <span class="m">· ${c.works} trabajo(s) · ${esc(c.years)}${c.institution ? " · "+esc(c.institution) : ""}</span>
    ${c.upr ? ' <span class="pill">UPR</span>' : ""}${c.in_dataset ? ` <button class="link" data-goto="${esc(c.in_dataset)}">en este conjunto →</button>` : ""}</li>`).join("")}</ul>`;
}
function barsByYear(by){
  if (!by) return "";
  const ys = []; for (let y = CURRENT_YEAR - 14; y <= CURRENT_YEAR; y++) ys.push(y);
  const max = Math.max(1, ...ys.map(y => by[y]||0));
  return `<div class="bars" title="Publicaciones por año (últimos 15 años)">${ys.map(y => `<i style="height:${Math.round(100*(by[y]||0)/max)}%" title="${y}: ${by[y]||0}"></i>`).join("")}</div>
    <div class="bars-x"><span>${ys[0]}</span><span>${CURRENT_YEAR}</span></div>`;
}

/* ---------------- pestaña: Research Capacity Profile ---------------- */
function tabProfile(R){
  const P = R.capacity;
  if (!P) return `<p class="note">${R.sources.openalex ? "No hay producción en OpenAlex vinculada por ORCID ni fondos NIH/NSF para generar el perfil." : "Primero enriquece con OpenAlex y/o busca financiamiento."}</p>`;
  const C = P.collaboration, A = P.activity;
  let h = `<p class="note" style="margin-top:0">Todo en esta vista se infiere de ${fmt(P.basis.works_analyzed)} publicaciones de OpenAlex${P.basis.grants_analyzed ? ` y ${P.basis.grants_analyzed} proyecto(s) financiado(s) NIH/NSF` : ""}. Cada etiqueta indica su confianza (barra) y el número de evidencias (publicaciones o proyectos) que la sostienen. Las de borde punteado se basan en una sola evidencia.</p>`;
  h += capSec("Primary Expertise", chips(P.expertise) + (P.primary_field ? `<p class="note">Campo principal: <b>${esc(P.primary_field.capacity)}</b></p>` : ""));
  h += capSec("Research Topics", `<p class="note" style="margin:0 0 4px">Primary</p>${chips(P.topics.primary)}
    <p class="note" style="margin:8px 0 4px">Secondary</p>${chips(P.topics.secondary, "—")}
    <p class="note" style="margin:8px 0 4px">Emerging (aparecen en los últimos 3 años)</p>${chips(P.topics.emerging, P.topics.emerging_note || "—")}`);
  h += capSec("Methods", chips(P.methods));
  h += capSec("Technologies", chips(P.technologies));
  h += capSec("Research Problems", chips(P.problems));
  h += capSec("Populations", chips(P.populations) + `<p class="note">Solo poblaciones descritas explícitamente en las publicaciones; no se infieren características de personas.</p>`);
  h += capSec("Geographic Focus", chips(P.geography));
  if (C) h += capSec("Collaboration Network", `
    <div class="two"><div><p class="note" style="margin:0 0 4px">Coautores principales</p>${collabList(C.top_coauthors.slice(0,8))}</div>
    <div><p class="note" style="margin:0 0 4px">Instituciones colaboradoras</p>
      <ul class="pubs">${C.institutions.slice(0,8).map(i => `<li>${esc(i.name)} <span class="m">· ${i.works} trabajo(s)${i.country ? " · "+esc(i.country) : ""}</span>${i.upr ? ' <span class="pill">UPR</span>' : ""}</li>`).join("") || "<li class='note'>—</li>"}</ul>
      <p class="note">Recintos UPR: ${C.upr_campuses.map(c => `${esc(c.campus)} (${c.works})${c.own ? " · propio" : ""}`).join(" · ") || "—"}<br>
      Colaboración internacional: ${Math.round(C.international.share*100)}% de los trabajos${C.international.countries.length ? " ("+C.international.countries.map(c => esc(c.country)).join(", ")+")" : ""}<br>
      ${C.frequency.collaborative_works} trabajos en colaboración · ${C.frequency.solo_works} individuales · ${C.frequency.mean_coauthors} coautores en promedio${C.frequency.big_team_works_excluded ? ` · ${C.frequency.big_team_works_excluded} de consorcio (>${BIG_TEAM} autores) excluidos` : ""}</p></div></div>`, SRC.oa);
  h += capSec("Research Activity", `<p style="margin:0"><b>${esc(A.status)}</b>${A.flags.map(f => ` · <b>${esc(f)}</b>`).join("")} · ${fmt(A.works_total)} publicaciones · ${A.first_year ?? "—"}${A.first_year_is_lower_bound ? " (o antes)" : ""}–${A.last_year ?? "—"} · ${A.works_last3} en los últimos 3 años</p><p class="note">${esc(A.rule)}</p>`);
  h += capSec("Funding Track Record", trackBlock(P), SRC.fund);
  h += capSec("Funding-Relevant Capacity", (P.funding_signals.length ? P.funding_signals.map(f => `<div class="fund"><b>${esc(f.capacity)}</b>${f.validated ? ' <span class="pill ok">respaldado por fondos previos</span>' : ""} <span class="c note">confianza ${f.confidence} · ${f.supporting_works} evidencias · ${esc(f.years)}</span>
      <div class="ag">Posibles agencias/programas: ${esc(f.agencies)}</div><div class="note">Basado en: ${f.rationale.map(esc).join(" · ")}</div></div>`).join("") : `<p class="note">Sin señales suficientes.</p>`)
    + `<p class="note"><b>Inferencia:</b> son áreas de financiamiento sugeridas a partir de la producción científica. No provienen de OpenAlex ni de las agencias, y no indican fondos recibidos.</p>`);
  return h;
}

/* ---------------- pestaña: Evidencia ---------------- */
function tabEvidence(R){
  const P = R.capacity;
  const srcs = Object.entries(R.sources).filter(([,v]) => v).map(([k,v]) => `<li><b>${esc(k)}</b> · ${esc(KIND_LABEL[v.kind] || v.kind)} · consultado ${esc((v.retrieved||"").slice(0,19).replace("T"," "))}</li>`).join("");
  let h = `<h3>Fuentes de este registro</h3><ul class="note">${srcs}</ul>`;
  if (!P) return h;
  h += `<h3>Evidencia de capacidades ${SRC.inf}</h3><div class="tablewrap"><table><thead><tr><th>Categoría</th><th>Capacidad</th><th class="num">Confianza</th><th class="num">Publicaciones</th><th>Años</th><th>Método</th><th>Fuente</th></tr></thead><tbody>
    ${P.evidence.map(e => `<tr><td>${esc(e.category)}${e.tier ? ` (${esc(e.tier)})` : ""}</td><td>${esc(e.capacity)}</td><td class="num">${e.confidence}</td><td class="num">${e.supporting_works}</td><td>${esc(e.years)}</td><td>${esc(e.method||"")}</td><td>${esc(e.source)}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>JSON del perfil</h3><details><summary class="note">Ver JSON (evidencia trazable)</summary><pre class="log" style="max-height:340px">${esc(JSON.stringify(P.evidence.map(({weight, ...e}) => e), null, 1))}</pre></details>`;
  return h;
}

/* ---------------- Capacity Map ---------------- */
const QUERY_EXAMPLES = ["¿Qué investigadores de la UPR trabajan con inteligencia artificial?","¿Dónde tenemos capacidades en resiliencia costera?","¿Quién utiliza GIS?",
  "¿Qué investigadores trabajan con cáncer?","¿Quiénes tienen experiencia en educación STEM?","¿Qué recintos tienen capacidades en energía renovable?",
  "¿Quién podría formar parte de un equipo para una convocatoria NSF sobre AI y educación?"];

function renderQuery(q){
  const facts = capacityFacts();
  if (!facts.length){ $("qOut").innerHTML = `<p class="note">Primero enriquece con OpenAlex para generar capacidades.</p>`; return; }
  const r = queryCapacities(q, facts);
  if (!r.terms.length && !r.agencies.length){ $("qOut").innerHTML = `<p class="note">No reconocí términos en la pregunta.</p>`; return; }
  const max = Math.max(1, ...r.campuses.map(c => c[1]));
  let h = `<p class="note">Términos: ${r.terms.map(t => `<b>${esc(t.text)}</b>`).join(" · ")}${r.agencies.length ? ` · agencias: ${r.agencies.map(a => `<b>${esc(a.toUpperCase())}</b>`).join(", ")}` : ""} — ${r.researchers.length} investigador(es)</p>`;
  if (r.team.length) h += `<div class="team"><b>Equipo sugerido</b> <span class="note">(cubre los términos de la pregunta y prioriza variedad de recintos)</span><ul class="pubs">${r.team.map(t =>
    `<li><button class="link" data-goto="${esc(t.orcid)}">${esc(t.name)}</button> <span class="m">· ${esc(t.campus)} · ${t.matched.map(m => esc(m.capacity)).join(", ")}</span></li>`).join("")}</ul></div>`;
  if (r.campuses.length) h += `<h3>Por recinto</h3>` + r.campuses.map(([c,n]) => `<div class="hbar"><span>${esc(c)}</span><div><i style="width:${100*n/max}%"></i></div><span>${n}</span></div>`).join("");
  h += `<h3>Investigadores</h3>` + (r.researchers.slice(0,40).map(x => `<div class="qres"><button class="link" data-goto="${esc(x.orcid)}"><b>${esc(x.name)}</b></button>
      <span class="note"> · ${esc(x.campus)}${x.department ? " · "+esc(x.department) : ""} · ${esc(x.activity)} · cobertura ${Math.round(x.coverage*100)}%</span>
      <div class="chips" style="margin-top:4px">${x.matched.map(m => `<span class="chip" title="${esc(m.category)}">${esc(m.capacity)}<span class="c">${m.confidence} · ${m.supporting_works}</span></span>`).join("")}</div></div>`).join("") || `<p class="note">Sin resultados.</p>`);
  $("qOut").innerHTML = h;
}
function renderAgg(){
  const facts = capacityFacts();
  if (!facts.length){ $("aggOut").innerHTML = `<p class="note">Sin capacidades todavía.</p>`; return; }
  const groups = aggregateCapacities(facts, $("aggDim").value, {category: $("aggCat").value, minConfidence: Number($("aggMin").value)||0});
  $("aggOut").innerHTML = `<div class="tablewrap"><table><thead><tr><th>${esc(DIMENSIONS[$("aggDim").value].label)}</th><th class="num">Investigadores</th><th>Capacidades principales (nº investigadores · confianza media)</th></tr></thead><tbody>
    ${groups.map(g => `<tr><td>${esc(g.group)}</td><td class="num">${g.researchers}</td><td>${g.capacities.map(c => `${esc(c.capacity)} <span class="note">(${c.researchers} · ${c.mean_confidence}${$("aggCat").value ? "" : " · "+esc(c.category)})</span>`).join("; ")}</td></tr>`).join("")}
    </tbody></table></div>`;
}
