"use strict";
/* =====================================================================
   OTRAS AGENCIAS Y FUENTES (vinculadas al profesor por su ORCID)
   1) Fondos declarados por la persona en su ORCID (sección Fundings).
   2) Subvenciones agradecidas en sus publicaciones (OpenAlex: financiador + número).
   No hay adivinanza por nombre: ambas fuentes ya están atadas a la persona.
   Si el número de premio coincide con una subvención de USAspending, se añade
   el monto oficial. El financiador se normaliza a una agencia.
   ===================================================================== */
const AGENCY_RULES = [
  ["NASA", /\bnasa\b|aeronautics and space|space grant|goddard|jet propulsion|\bjpl\b/i],
  ["USDA", /agricultur|\busda\b|\bnifa\b|forest service|food and nutrition service|natural resources conservation/i],
  ["NIH", /national institutes? of health|\bnih\b|national (cancer|heart|eye|library of medicine|human genome) |national institute (of|on|for) |inbre|nimhd|nigms|niehs|nichd|ninds|nimh|niaid|nidcr|nida\b|niaaa|ncats|eunice kennedy|fogarty|national center for (advancing|complementary|research resources)/i],
  ["NSF", /national science foundation|\bnsf\b|directorate for|epscor/i],
  ["DOE", /department of energy|\bdoe\b|office of science|arpa-e|national (renewable energy|nuclear security)|(oak ridge|argonne|brookhaven|sandia|los alamos|lawrence (berkeley|livermore)|fermi)/i],
  ["DoD", /defense|\barmy\b|\bnavy\b|naval|air force|\bdarpa\b|\bonr\b|\bafosr\b|\bdtra\b|\bcdmrp\b/i],
  ["NOAA / Commerce", /\bnoaa\b|oceanic and atmospheric|department of commerce|\bnist\b|standards and technology|sea grant|economic development administration/i],
  ["CDC / otras HHS", /centers? for disease control|\bcdc\b|\bhrsa\b|health resources and services|\bsamhsa\b|substance abuse and mental|\bahrq\b|healthcare research and quality|food and drug administration|\bfda\b|department of health and human services|\bhhs\b|administration for (community living|children)/i],
  ["EPA", /environmental protection agency|\bepa\b/i],
  ["Education (ED / IES)", /department of education|institute of education sciences|\bies\b/i],
  ["Interior / USGS", /geological survey|\busgs\b|fish and wildlife|national park service|department of the interior|bureau of (land|reclamation|ocean)/i],
  ["NEH / NEA / IMLS", /national endowment for the (humanities|arts)|\bneh\b|\bnea\b|museum and library services|\bimls\b/i],
  ["DHS / FEMA", /homeland security|\bfema\b/i],
  ["Puerto Rico (fondos locales)", /puerto ric|puertorrique|universidad de puerto rico|university of puerto rico|\bupr\b|fideicomiso|prstrt|iinas/i],
  ["Fundaciones y privados", /foundation|fundaci[oó]n|fund\b|trust|institute\b|society|association|asociaci[oó]n|council|inc\.?$|llc|corporation|company|pharma|gates|howard hughes|sloan|keck|mellon|rockefeller|kellogg|google|microsoft|ibm|intel/i],
];
const AG_SHORT = { "NOAA / Commerce": "NOAA", "CDC / otras HHS": "HHS", "Education (ED / IES)": "ED", "Interior / USGS": "USGS", "NEH / NEA / IMLS": "NEH", "DHS / FEMA": "DHS", "Puerto Rico (fondos locales)": "PR", "Fundaciones y privados": "Fund.", "Otros / internacionales": "Otros" };
function agencyOfFunder(name){ for (const [ag, re] of AGENCY_RULES) if (re.test(name || "")) return ag; return "Otros / internacionales"; }

let USA_INDEX = null;
function usaIndex(){
  if (USA_INDEX || !FEDERAL.data?.awards) return USA_INDEX;
  USA_INDEX = new Map(); for (const a of FEDERAL.data.awards){ const k = normAwardId(a.id); if (k.length >= 6 && !USA_INDEX.has(k)) USA_INDEX.set(k, a); }
  return USA_INDEX;
}
/** Fondos de otras fuentes de un investigador, combinando ORCID y publicaciones. */
function otherAwards(R){
  const by = new Map(), idx = usaIndex();
  const add = (src, x) => {
    const id = normAwardId(x.award), ag = agencyOfFunder(x.funder);
    const k = id.length >= 4 ? `id:${id}` : `f:${norm(x.funder)}|${norm(x.title || "")}`;
    const e = by.get(k) || by.set(k, { orcid: R.orcid, agency: ag, funder: x.funder, award: x.award || "", title: "", start: "", end: "", url: "", works: 0, sources: [] }).get(k);
    if (!e.sources.includes(src)) e.sources.push(src);
    if (x.title && !e.title) e.title = x.title;
    if (src === "ORCID"){ e.start = x.start || e.start; e.end = x.end || e.end; e.url = x.url || e.url; e.type = x.type; }
    if (src === "Publicaciones"){ e.works += x.works || 0; e.first = x.first; e.last = x.last; }
    if (!e.usa && idx && id.length >= 6 && idx.has(id)){ const u = idx.get(id); e.usa = { amount: u.amount, agency: u.agency, url: FEDERAL.url(u), start: u.start, end: u.end }; }
  };
  for (const x of (R.sources.orcid_funding?.items || [])) add("ORCID", x);
  for (const x of (R.sources.openalex?.funding_ack || [])) add("Publicaciones", x);
  return [...by.values()];
}

/* ---------------- Proyectos → Otras agencias y fuentes ---------------- */
const OTH = { agency: "", source: "", campus: "", q: "", inclNihNsf: false };
async function drawOtherProjects(box){
  box.innerHTML = `<p class="note">Cargando…</p>`;
  try { await FEDERAL.load(); USA_INDEX = null; } catch {}
  const people = researchers(), all = people.flatMap(R => otherAwards(R).map(a => ({ ...a, R })));
  const anyData = people.some(R => R.sources.orcid_funding || R.sources.openalex?.funding_ack);
  if (!anyData){ box.innerHTML = `<div class="empty"><b>Aún no hay datos de otras fuentes.</b>${AUTH.isAdmin() ? `En <a href="#/admin">Administración</a>: corre el paso 2 (OpenAlex) para captar los financiadores de las publicaciones, y el paso 3 con «Fondos declarados en ORCID».` : "Un administrador debe actualizar los pasos 2 y 3 del harvest."}</div>`; return; }
  const ags = uniq(all.map(a => a.agency)).sort(), cs = uniq(people.flatMap(campusOf)).sort();
  const opt = (v, cur, l = v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  box.innerHTML = `<div class="notice" style="margin-bottom:14px">Fondos vinculados a cada profesor <b>por su ORCID</b>: los que declara en su perfil ORCID y los que agradece en sus publicaciones (OpenAlex). Incluye agencias federales, fondos de Puerto Rico y fundaciones. Cuando el número de premio coincide con USAspending se muestra el monto oficial.</div>
    <div class="filters"><input type="search" id="othQ" placeholder="Buscar por financiador, título, número o persona…" value="${esc(OTH.q)}">
      <select id="othAg"><option value="">Agencia / tipo</option>${ags.map(a => opt(a, OTH.agency)).join("")}</select>
      <select id="othSrc"><option value="">ORCID y publicaciones</option>${opt("ORCID", OTH.source, "Declarado en ORCID")}${opt("Publicaciones", OTH.source, "Agradecido en publicaciones")}</select>
      <select id="othCampus"><option value="">Recinto</option>${cs.map(c => opt(c, OTH.campus)).join("")}</select>
      <label class="note"><input type="checkbox" id="othNN" ${OTH.inclNihNsf ? "checked" : ""}> Incluir NIH y NSF</label>
      <button type="button" id="othCsv">Descargar CSV</button></div>
    <div class="kpis" id="othKpis"></div>
    <div class="grid2 even" style="margin-bottom:16px"><div class="card"><h2>Profesores por agencia <span class="note">(clic para filtrar)</span></h2><div id="othByAg"></div></div>
      <div class="card"><h2>Financiadores más frecuentes</h2><div id="othByF"></div></div></div>
    <p class="note" id="othCount"></p><div class="card" style="padding:0" id="othList"></div>`;
  const filt = () => { const q = norm(OTH.q);
    return all.filter(a => (OTH.inclNihNsf || OTH.agency === "NIH" || OTH.agency === "NSF" || !["NIH", "NSF"].includes(a.agency)) && (!OTH.agency || a.agency === OTH.agency)
      && (!OTH.source || a.sources.includes(OTH.source)) && (!OTH.campus || campusOf(a.R).includes(OTH.campus))
      && (!q || norm(`${a.funder} ${a.title} ${a.award} ${fullName(a.R)}`).includes(q))); };
  const draw = () => {
    const F = filt(), withAmt = F.filter(a => a.usa), amt = withAmt.reduce((s, a) => s + (a.usa.amount || 0), 0);
    $("othKpis").innerHTML = `<div class="kpi">${icon("flask")}<b>${fmt(F.length)}</b><span>Fondos / subvenciones</span></div>
      <div class="kpi">${icon("users")}<b>${fmt(uniq(F.map(a => a.orcid)).length)}</b><span>Profesores</span></div>
      <div class="kpi">${icon("building")}<b>${fmt(uniq(F.map(a => a.agency)).length)}</b><span>Agencias / tipos</span></div>
      <div class="kpi">${icon("money")}<b>${money$(amt)}</b><span>Monto conocido (${fmt(withAmt.length)} con número en USAspending)</span></div>`;
    const pa = new Map(); for (const a of F){ const s = pa.get(a.agency) || pa.set(a.agency, new Set()).get(a.agency); s.add(a.orcid); }
    hbars($("othByAg"), { items: [...pa].map(([label, s]) => ({ label, value: s.size })), top: 16, fmt: v => `${fmt(v)} prof.`, onClick: k => { OTH.agency = OTH.agency === k ? "" : k; $("othAg").value = OTH.agency; draw(); } });
    const fc = new Map(); for (const a of F) fc.set(a.funder, (fc.get(a.funder) || 0) + 1);
    hbars($("othByF"), { items: [...fc].map(([label, value]) => ({ label, value })), top: 12 });
    const L = [...F].sort((a, b) => (b.usa?.amount || 0) - (a.usa?.amount || 0) || (b.works || 0) - (a.works || 0));
    $("othCount").textContent = `${fmt(F.length)} registro(s)${F.length > 200 ? " · se muestran 200; descarga el CSV para todos" : ""}`;
    $("othList").innerHTML = L.slice(0, 200).map(a => `<div class="item"><div class="agency inf" title="${esc(a.agency)}">${esc(AG_SHORT[a.agency] || a.agency)}</div>
      <div><h3>${a.url || a.usa?.url ? `<a href="${esc(a.url || a.usa.url)}" target="_blank" rel="noopener">` : ""}${esc(a.title || a.funder)}${a.url || a.usa?.url ? "</a>" : ""}</h3>
        <div class="meta">${esc(a.funder)}${a.award ? ` · nº ${esc(a.award)}` : ""} · ${esc(a.agency)}</div>
        <div class="meta"><a href="#/investigador/${esc(a.R.orcid)}/proyectos">${esc(fullName(a.R))}</a> · ${esc(a.R.affiliation.campus)}
          ${a.sources.includes("ORCID") ? ' · <span class="pill">declarado en ORCID</span>' : ""}${a.sources.includes("Publicaciones") ? ` · <span class="pill">agradecido en ${fmt(a.works)} publicación(es)${a.first ? ` ${a.first}${a.last && a.last !== a.first ? "–" + a.last : ""}` : ""}</span>` : ""}</div></div>
      <div class="deadline">${a.usa ? `Monto<b>${money$(a.usa.amount)}</b><a class="note" href="${esc(a.usa.url)}" target="_blank" rel="noopener">USAspending</a>` : `${esc([a.start, a.end].filter(Boolean).join(" – ") || "")}`}</div></div>`).join("") || `<div class="empty"><b>Nada coincide con los filtros.</b></div>`;
  };
  const bind = (id, k, ev = "input", get = e => e.target.value) => $(id).addEventListener(ev, e => { OTH[k] = get(e); draw(); });
  bind("othQ", "q"); bind("othAg", "agency"); bind("othSrc", "source"); bind("othCampus", "campus"); bind("othNN", "inclNihNsf", "change", e => e.target.checked);
  $("othCsv").onclick = () => {
    const qv = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const h = ["profesor","orcid","recinto","agencia","financiador","numero_premio","titulo","fuente","publicaciones_que_lo_agradecen","inicio","fin","monto_usaspending","enlace"];
    const lines = [h.join(",")].concat(filt().map(a => [fullName(a.R), a.orcid, a.R.affiliation.campus, a.agency, a.funder, a.award, a.title, a.sources.join(" + "), a.works || "", a.start || a.first || "", a.end || a.last || "", a.usa ? Math.round(a.usa.amount) : "", a.url || a.usa?.url || ""].map(qv).join(",")));
    saveBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), `upr_otras_fuentes_${new Date().toISOString().slice(0,10)}.csv`);
  };
  draw();
}
/** Bloque para el perfil (pestaña Proyectos). */
function otherFundingBlock(R){
  const L = otherAwards(R);
  const has = R.sources.orcid_funding || R.sources.openalex?.funding_ack;
  if (!has) return "";
  if (!L.length) return `<h3>Otras agencias y fuentes <span class="src orcid">ORCID · OpenAlex</span></h3><p class="note">No declara fondos en ORCID ni se encontraron financiadores agradecidos en sus publicaciones.</p>`;
  L.sort((a, b) => (b.usa?.amount || 0) - (a.usa?.amount || 0) || (b.works || 0) - (a.works || 0));
  return `<h3>Otras agencias y fuentes <span class="src orcid">ORCID · OpenAlex</span></h3><p class="note" style="margin:0 0 4px">Vinculados por su ORCID: declarados en su perfil o agradecidos en sus publicaciones.</p>
    <ul class="pubs">${L.map(a => `<li><b>${esc(a.title || a.funder)}</b><div class="m">${esc(a.funder)}${a.award ? ` · nº ${esc(a.award)}` : ""} · ${esc(a.agency)}${a.sources.includes("ORCID") ? " · declarado en ORCID" : ""}${a.works ? ` · agradecido en ${a.works} publicación(es)` : ""}${a.usa ? ` · <a href="${esc(a.usa.url)}" target="_blank" rel="noopener">${money$(a.usa.amount)} (USAspending)</a>` : ""}</div></li>`).join("")}</ul>`;
}
