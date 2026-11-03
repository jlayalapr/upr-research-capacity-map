"use strict";
/* =====================================================================
   UPR RESEARCH CAPACITY MAP — agregación institucional
   Todo parte de una tabla plana de "hechos de capacidad" (una fila por
   investigador × capacidad) que se puede agregar por cualquier dimensión
   y exportar a CSV/JSON para otras herramientas (Power BI, Tableau, VIVO…).
   ===================================================================== */
const DIMENSIONS = {
  campus:     {label:"Recinto",           get: f => f.campus},
  department: {label:"Departamento",      get: f => f.department},
  college:    {label:"Facultad/Colegio",  get: f => f.college},
  discipline: {label:"Disciplina (Primary Field)", get: f => f.discipline},
};
const CATEGORIES = ["Expertise","Research Topic","Method","Technology","Problem","Population","Geography","Funding Area","Funding Track Record"];

function capacityFacts(list = researchers()){
  const out = [];
  for (const R of list){
    const P = R.capacity; if (!P) continue;
    const base = {
      orcid: R.orcid, name: `${R.identity.given} ${R.identity.family}`.trim(),
      campus: R.affiliation.campus || "", department: R.affiliation.dept || "", college: R.affiliation.college || "",
      discipline: P.primary_field?.capacity || "", openalex_id: R.sources.openalex?.author?.id || "",
      activity: P.activity?.status || "",
    };
    for (const e of P.evidence){
      out.push({ ...base, category: e.category, capacity: e.capacity, tier: e.tier || "", confidence: e.confidence,
        supporting_works: e.supporting_works, years: e.years, source: e.source, kind: e.kind, method: e.method || "",
        agencies: e.agencies || e.agency || "", amount: e.amount || "", validated: e.validated ? "sí" : "", subfield: e.subfield || "", field: e.field || "",
        supporting_work_ids: (e.supporting_work_ids||[]).join(" ") });
    }
  }
  return out;
}

/** Agrega hechos: dimensión × capacidad → nº investigadores, evidencia, confianza media. */
function aggregateCapacities(facts, dim, {category="", minConfidence=0.4, top=8} = {}){
  const get = DIMENSIONS[dim]?.get || (f => f[dim]);
  const groups = new Map();
  for (const f of facts){
    if (category && f.category !== category) continue;
    if (f.confidence < minConfidence) continue;
    for (const g of String(get(f) || "(sin dato)").split(" | ")){
      const G = groups.get(g) || groups.set(g, {group:g, researchers:new Set(), caps:new Map()}).get(g);
      G.researchers.add(f.orcid);
      const k = f.category + "|" + f.capacity;
      const C = G.caps.get(k) || G.caps.set(k, {capacity:f.capacity, category:f.category, researchers:new Set(), works:0, conf:0}).get(k);
      if (!C.researchers.has(f.orcid)){ C.researchers.add(f.orcid); C.conf += f.confidence; }
      C.works += f.supporting_works;
    }
  }
  return [...groups.values()].map(G => ({
    group: G.group, researchers: G.researchers.size,
    capacities: [...G.caps.values()].map(C => ({capacity:C.capacity, category:C.category, researchers:C.researchers.size,
      supporting_works:C.works, mean_confidence: round2(C.conf / C.researchers.size)}))
      .sort((a,b) => b.researchers - a.researchers || b.mean_confidence - a.mean_confidence).slice(0, top),
  })).sort((a,b) => b.researchers - a.researchers);
}

/* ---------------------------------------------------------------------
   Consulta en lenguaje natural sencillo:
   "¿Quién utiliza GIS?" · "AI y educación para NSF" · "resiliencia costera"
   --------------------------------------------------------------------- */
function parseCapacityQuery(q){
  let text = " " + norm(q).replace(/[¿?¡!.,;:()"]/g, " ") + " ";
  const terms = [], agencies = [];
  for (const [from, to] of QUERY_SYNONYMS){
    const re = new RegExp(`(^|\\s)(${from})(?=\\s|$)`, "i");
    const m = re.exec(text);
    if (m){ terms.push({text: m[2].trim(), re: new RegExp(to, "i")}); text = text.replace(re, " "); }
  }
  for (const w of text.split(/\s+/).filter(Boolean)){
    if (QUERY_AGENCIES.includes(w)) { agencies.push(w); continue; }
    if (QUERY_STOPWORDS.has(w) || w.length < 3) continue;
    terms.push({text: w, re: new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")});
  }
  // "fondos NIH" → solo el historial de financiamiento de esa(s) agencia(s)
  const ft = terms.find(t => t.re.source === QUERY_SYNONYMS[0][1]);
  const fundAg = agencies.filter(a => a === "nih" || a === "nsf");
  if (ft && fundAg.length){ ft.re = new RegExp(`^(${fundAg.join("|")}) · `, "i"); ft.text = `fondos ${fundAg.join("/").toUpperCase()}`; }
  return {terms, agencies};
}

function queryCapacities(q, facts, {minConfidence=0.3} = {}){
  const {terms, agencies} = parseCapacityQuery(q);
  if (!terms.length && !agencies.length) return {terms, agencies, researchers:[], campuses:[], team:[]};
  const byR = new Map();
  for (const f of facts){
    if (f.confidence < minConfidence) continue;
    const hay = norm(`${f.capacity} ${f.subfield} ${f.field}`);
    const R = byR.get(f.orcid) || byR.set(f.orcid, {orcid:f.orcid, name:f.name, campus:f.campus, department:f.department, activity:f.activity, hits:new Map(), agencyHits:new Set()}).get(f.orcid);
    terms.forEach((t, i) => {
      if (t.re.test(hay)){
        // una misma capacidad no puede cubrir dos términos distintos de la pregunta
        if ([...R.hits.entries()].some(([j, g]) => j !== i && g.capacity === f.capacity)) return;
        const prev = R.hits.get(i);
        if (!prev || f.confidence > prev.confidence) R.hits.set(i, f);
      }
    });
    if (f.category === "Funding Area" || f.category === "Funding Track Record") agencies.forEach(a => { if (new RegExp(`\\b${a}\\b`).test(norm(f.agencies + " " + f.capacity))) R.agencyHits.add(a); });
  }
  const list = [...byR.values()].filter(r => r.hits.size || (!terms.length && r.agencyHits.size)).map(r => {
    const matched = [...r.hits.entries()].map(([i, f]) => ({term: terms[i].text, capacity: f.capacity, category: f.category, confidence: f.confidence, supporting_works: f.supporting_works}));
    const coverage = terms.length ? r.hits.size / terms.length : 1;
    const strength = matched.reduce((s,m) => s + m.confidence * Math.min(1, 0.5 + m.supporting_works/10), 0) / Math.max(1, terms.length);
    return {...r, matched, coverage, score: round2(coverage*0.6 + strength*0.4 + (agencies.length ? 0.15 * r.agencyHits.size/agencies.length : 0))};
  }).sort((a,b) => b.score - a.score);
  const campuses = new Map();
  for (const r of list) for (const c of r.campus.split(" | ")) campuses.set(c, (campuses.get(c)||0) + 1);
  return { terms, agencies, researchers: list, campuses: [...campuses.entries()].sort((a,b) => b[1]-a[1]), team: suggestTeam(list, terms.length) };
}

/** Equipo sugerido: cobertura voraz de todos los términos, priorizando diversidad de recintos. */
function suggestTeam(list, nTerms, max=5){
  if (nTerms < 2) return [];
  const team = [], covered = new Set(), campuses = new Set();
  while (team.length < max && covered.size < nTerms){
    let best = null, bestGain = 0;
    for (const r of list){
      if (team.includes(r)) continue;
      const newTerms = r.matched.filter(m => !covered.has(m.term));
      const gain = newTerms.reduce((s,m) => s + m.confidence, 0) + (campuses.has(r.campus) ? 0 : 0.1);
      if (newTerms.length && gain > bestGain){ best = r; bestGain = gain; }
    }
    if (!best) break;
    team.push(best); best.matched.forEach(m => covered.add(m.term)); campuses.add(best.campus);
  }
  return team;
}
