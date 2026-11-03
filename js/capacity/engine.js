"use strict";
/* =====================================================================
   RESEARCH CAPACITY INTELLIGENCE LAYER
   Transforma la evidencia bibliográfica (OpenAlex) en señales de capacidad
   trazables. Cada capacidad es un objeto "evidencia":
   {
     capacity, category, confidence (0–1), supporting_works, supporting_work_ids,
     years, first_year, last_year, source, kind:"inferred", method
   }
   ===================================================================== */
const CAPACITY_ENGINE_VERSION = "1.0";
const CAP_CFG = {
  recencyHalfLife: 6,     // años: un trabajo de hace 6 años pesa la mitad que uno de este año
  recencyFloor: 0.15,
  primaryTopicBoost: 1.25,
  lexiconWorksLimit: 300, // trabajos (los de mayor peso) analizados por vocabulario
  fieldWeights: { title:1.0, keywords:0.9, abstract:0.6, topics:0.6 },
};

const recencyW = y => !y ? 0.3 : Math.max(CAP_CFG.recencyFloor, 0.5 ** (Math.max(0, CURRENT_YEAR - y) / CAP_CFG.recencyHalfLife));
const citeW = c => 1 + Math.log10(1 + (c||0));
const workWeight = w => recencyW(w.year) * citeW(w.cited_by_count);

/** Confianza explicable: cantidad de evidencia + proporción del perfil + continuidad en el tiempo. */
function capConfidence(n, share, span){
  return round2(clamp(0.5*(1 - Math.exp(-n/3)) + 0.3*Math.min(1, share/0.15) + 0.2*Math.min(1, span/5), 0.05, 0.99));
}
function newAgg(extra={}){ return {weight:0, works:new Set(), years:new Set(), ev:0, ...extra}; }
function toEvidence(label, category, agg, totalWeight, totalWorks, extra={}){
  const ys = [...agg.years].filter(Boolean), n = agg.works.size;
  const first = ys.length ? Math.min(...ys) : null, last = ys.length ? Math.max(...ys) : null;
  const span = first ? last - first + 1 : 0;
  const conf = extra.method === "lexicon"
    ? round2(clamp(0.55*(1 - Math.exp(-agg.ev/2.5)) + 0.25*Math.min(1, (n/Math.max(1,totalWorks))/0.1) + 0.2*Math.min(1, span/5), 0.05, 0.99))
    : capConfidence(n, totalWeight ? agg.weight/totalWeight : 0, span);
  return { capacity: label, category, confidence: conf, supporting_works: n, supporting_work_ids: [...agg.works].slice(0,50),
           years: yearsRange(ys), first_year: first, last_year: last, weight: round2(agg.weight),
           single_evidence: n === 1, source: "OpenAlex", kind: "inferred", ...extra };
}

/* ---------------------------------------------------------------------
   Punto 5: áreas de investigación por frecuencia y relevancia de topics,
   con mayor peso a publicaciones recientes y más citadas.
   --------------------------------------------------------------------- */
function deriveResearchAreas(works, limit=10){
  const topics = new Map(), subfields = new Map(), fields = new Map();
  let total = 0;
  for (const w of works){
    const ww = workWeight(w);
    const pid = w.primary_topic?.id;
    for (const t of (w.topics||[])){
      const c = ww * (t.score ?? 0.5) * (t.id === pid ? CAP_CFG.primaryTopicBoost : 1);
      total += c;
      for (const [map, key, label, extra] of [
        [topics, t.id, t.name, {subfield:t.subfield, field:t.field, domain:t.domain, openalex_id:t.id}],
        [subfields, t.subfield_id || t.subfield, t.subfield, {field:t.field, domain:t.domain, openalex_id:t.subfield_id}],
        [fields, t.field_id || t.field, t.field, {domain:t.domain, openalex_id:t.field_id}]]){
        if (!key || !label) continue;
        const a = map.get(key) || map.set(key, newAgg({label, extra})).get(key);
        a.weight += c; a.works.add(w.id); a.years.add(w.year);
      }
    }
  }
  const nWorks = works.length;
  const rank = (map, cat) => [...map.values()].sort((a,b) => b.weight - a.weight)
    .map(a => toEvidence(a.label, cat, a, total, nWorks, {method:"topic-weighting", ...a.extra}));
  const T = rank(topics, "Research Topic");
  return { topics: T, top: T.slice(0, limit), subfields: rank(subfields, "Expertise"), fields: rank(fields, "Field"), totalWeight: total };
}

function tierTopics(ranked, careerStart){
  let primary = ranked.filter(t => t.supporting_works >= 3).slice(0,5);
  if (!primary.length) primary = ranked.filter(t => t.supporting_works >= 2).slice(0,3);
  if (!primary.length) primary = ranked.slice(0,2);
  const P = new Set(primary.map(t => t.capacity));
  const emerging = (careerStart && careerStart < CURRENT_YEAR - 4)
    ? ranked.filter(t => !P.has(t.capacity) && t.supporting_works >= 2 && t.first_year >= CURRENT_YEAR - 3).slice(0,5) : [];
  const E = new Set(emerging.map(t => t.capacity));
  const secondary = ranked.filter(t => !P.has(t.capacity) && !E.has(t.capacity) && t.supporting_works >= 2).slice(0,10);
  return {
    primary: primary.map(t => ({...t, tier:"Primary"})),
    secondary: secondary.map(t => ({...t, tier:"Secondary"})),
    emerging: emerging.map(t => ({...t, tier:"Emerging"})),
    emerging_note: careerStart && careerStart >= CURRENT_YEAR - 4 ? "Trayectoria reciente: no se distinguen temas emergentes." : "",
  };
}

/* Expertise = subcampos con experiencia sostenida (≥3 trabajos en ≥2 años distintos). */
function deriveExpertise(subfields){
  const sustained = subfields.filter(s => s.supporting_works >= 3 && new Set(s.supporting_work_ids).size >= 3 && s.first_year !== s.last_year);
  const out = (sustained.length ? sustained : subfields.filter(s => s.supporting_works >= 2)).slice(0,6);
  return out.map(s => ({...s, sustained: sustained.includes(s)}));
}

/* ---------------------------------------------------------------------
   Detección por vocabulario: métodos, tecnologías, problemas, poblaciones,
   geografía. Solo se reconoce lo que aparece EXPLÍCITO en el texto.
   --------------------------------------------------------------------- */
function lexiconDetect(works){
  const sample = [...works].sort((a,b) => workWeight(b) - workWeight(a)).slice(0, CAP_CFG.lexiconWorksLimit);
  const prepared = sample.map(w => {
    const raw = { title: w.title||"", keywords: (w.keywords||[]).map(k => k.name).join(" ; "), abstract: w.abstract||"", topics: (w.topics||[]).map(t => t.name).join(" ; ") };
    return { w, raw, n: Object.fromEntries(Object.entries(raw).map(([k,v]) => [k, norm(v)])), ww: workWeight(w) };
  });
  const result = {};
  for (const [cat, entries] of Object.entries(COMPILED_LEX)){
    const aggs = [];
    for (const e of entries){
      const a = newAgg();
      for (const p of prepared){
        let best = 0, where = "";
        for (const [field, fw] of Object.entries(CAP_CFG.fieldWeights)){
          if (fw <= best) continue;
          if ((e.ci && e.ci.test(p.n[field])) || (e.cs && e.cs.test(p.raw[field]))){ best = fw; where = field; }
        }
        if (best){ a.works.add(p.w.id); a.years.add(p.w.year); a.ev += best * (p.w.evidence_boost || 1); a.weight += best * p.ww; (a.fields ||= {})[where] = ((a.fields||{})[where]||0) + 1; }
      }
      if (a.works.size) aggs.push(toEvidence(e.label, cat, a, 0, sample.length, {method:"lexicon", matched_in:a.fields, source: sourceOfIds(a.works)}));
    }
    result[cat] = aggs.sort((x,y) => y.confidence - x.confidence || y.supporting_works - x.supporting_works);
  }
  return result;
}

/* ---------------------------------------------------------------------
   Red de colaboración
   --------------------------------------------------------------------- */
function collaborationNetwork(R, works, oaIndex){
  const oa = R.sources.openalex;
  const self = new Set([oa.author.id, ...(oa.alternates||[]).map(a => a.id)]);
  const people = new Map(), insts = new Map(), countries = new Map();
  let solo = 0, coll = 0, coauthorSum = 0, big = 0, intl = 0, analyzed = 0;
  for (const w of works){
    if (w.n_authors > BIG_TEAM){ big++; continue; }
    analyzed++;
    const others = (w.authors||[]).filter(a => !self.has(a.id));
    if (w.n_authors <= 1 || !others.length){ solo++; continue; }
    coll++; coauthorSum += w.n_authors - 1;
    const seenInst = new Set(); let isIntl = false;
    for (const a of others){
      const key = a.id || "name:"+norm(a.name);
      const p = people.get(key) || people.set(key, {id:a.id, name:a.name, orcid:a.orcid, works:new Set(), years:new Set(), institutions:new Map()}).get(key);
      p.works.add(w.id); p.years.add(w.year);
      for (const i of a.institutions){
        p.institutions.set(i.name, (p.institutions.get(i.name)||0) + 1);
        if (seenInst.has(i.id||i.name)) continue; seenInst.add(i.id||i.name);
        const I = insts.get(i.id||i.name) || insts.set(i.id||i.name, {...i, works:new Set(), upr:isUPR(i.name)}).get(i.id||i.name);
        I.works.add(w.id);
        if (i.cc && i.cc !== "PR" && i.cc !== "US"){ isIntl = true; countries.set(i.cc, (countries.get(i.cc)||0) + 1); }
      }
    }
    if (isIntl) intl++;
  }
  const top = [...people.values()].sort((a,b) => b.works.size - a.works.size || Math.max(...b.years) - Math.max(...a.years)).slice(0,15)
    .map(p => ({ name:p.name, openalex_id:p.id, orcid:p.orcid, works:p.works.size, years:yearsRange([...p.years]),
                 institution:[...p.institutions.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] || "",
                 upr:[...p.institutions.keys()].some(isUPR), in_dataset: (p.id && oaIndex.get(p.id)) || null }));
  const instList = [...insts.values()].sort((a,b) => b.works.size - a.works.size);
  const campuses = new Map();
  for (const i of instList.filter(i => i.upr)){ const c = detectCampus(i.name,"").name; campuses.set(c, (campuses.get(c)||0) + i.works.size); }
  return {
    top_coauthors: top,
    institutions: instList.slice(0,15).map(i => ({name:i.name, openalex_id:i.id, ror:i.ror, country:i.cc, works:i.works.size, upr:i.upr, campus:i.upr ? detectCampus(i.name,"").name : ""})),
    upr_campuses: [...campuses.entries()].sort((a,b) => b[1]-a[1]).map(([campus, works]) => ({campus, works, own: R.affiliation.campus.split(" | ").includes(campus)})),
    international: { works: intl, share: analyzed ? round2(intl/analyzed) : 0, countries: [...countries.entries()].sort((a,b) => b[1]-a[1]).slice(0,10).map(([cc,n]) => ({country:cc, works:n})) },
    frequency: { works_analyzed: analyzed, collaborative_works: coll, solo_works: solo, mean_coauthors: coll ? round2(coauthorSum/coll) : 0, big_team_works_excluded: big, unique_coauthors: people.size },
    source: "OpenAlex", kind: "bibliographic",
  };
}

/* ---------------------------------------------------------------------
   Actividad de investigación
   --------------------------------------------------------------------- */
function researchActivity(works, metrics, truncated, awards=[]){
  const ys = works.map(w => w.year).filter(Boolean);
  const n3 = ys.filter(y => y >= CURRENT_YEAR - 2).length, n5 = ys.filter(y => y >= CURRENT_YEAR - 4).length;
  const first = ys.length ? Math.min(...ys) : null, last = ys.length ? Math.max(...ys) : null;
  const activeAward = awards.some(a => a.is_active);
  let status = !ys.length ? (activeAward ? "Active researcher (funding)" : "No publications found") : n3 >= 2 ? "Active researcher" : n5 >= 1 ? "Recently active" : "Historically active";
  if (activeAward && (status === "Recently active" || status === "Historically active")) status = "Active researcher (funding)";
  const flags = [];
  if (activeAward) flags.push("Currently funded");
  if (first && first >= CURRENT_YEAR - 6 && n5 >= 1 && ys.length <= 25 && !truncated) flags.push("Emerging researcher");
  const by_year = {}; for (const y of ys) if (y >= CURRENT_YEAR - 14) by_year[y] = (by_year[y]||0) + 1;
  return { status, flags, first_year: first, last_year: last, first_year_is_lower_bound: !!truncated,
           works_total: metrics?.publications ?? ys.length, works_last3: n3, works_last5: n5, by_year,
           rule: "Active: ≥2 trabajos en los últimos 3 años (o un proyecto financiado vigente) · Recently: ≥1 en 5 años · Historically: sin trabajos en 5 años · Emerging: primer trabajo hace ≤6 años y ≤25 trabajos",
           source: "OpenAlex", kind: "inferred" };
}

function selectPublications(works, n=10){
  const score = w => recencyW(w.year) * citeW(w.cited_by_count);
  const byScore = [...works].sort((a,b) => score(b) - score(a));
  const recent = [...works].sort((a,b) => (b.year||0) - (a.year||0)).slice(0,3);
  return uniq([...recent, ...byScore].map(w => w.id)).slice(0, n);
}

/* ---------------------------------------------------------------------
   Financiamiento (NIH RePORTER, NSF Awards) como evidencia de capacidad
   --------------------------------------------------------------------- */
function sourceOfIds(ids){
  const s = new Set();
  for (const id of ids) s.add(String(id).startsWith("NIH:") ? "NIH RePORTER" : String(id).startsWith("NSF:") ? "NSF Awards" : "OpenAlex");
  return [...s].join(" + ");
}
const grantDoc = a => ({ id: `${a.agency}:${a.id}`, year: a.last_year, title: a.title, abstract: a.abstract,
  keywords: (a.terms||[]).map(name => ({name})), topics: [], cited_by_count: 0,
  evidence_boost: 1.5 });   // un proyecto financiado y evaluado por pares pesa más que una sola publicación

function fundingTrackRecord(awards){
  const groups = new Map();
  for (const a of awards){
    const label = `${a.agency} · ${a.unit_name || a.unit || "—"}`;
    const g = groups.get(label) || groups.set(label, {awards:[], agency:a.agency, unit:a.unit}).get(label);
    g.awards.push(a);
  }
  const evidence = [...groups.entries()].map(([label, g]) => {
    const ys = g.awards.flatMap(a => [a.first_year, a.last_year]).filter(Boolean);
    return { capacity: label, category: "Funding Track Record", confidence: round2(Math.min(...g.awards.map(a => a.match.confidence))),
      supporting_works: g.awards.length, supporting_work_ids: g.awards.map(a => `${a.agency}:${a.id}`), years: yearsRange(ys),
      first_year: ys.length ? Math.min(...ys) : null, last_year: ys.length ? Math.max(...ys) : null,
      amount: g.awards.reduce((s,a) => s + (a.amount||0), 0), agency: g.agency, unit: g.unit,
      single_evidence: g.awards.length === 1, source: g.awards[0].source, kind: "funding", method: "award-match" };
  }).sort((a,b) => b.amount - a.amount);
  const by = ag => { const l = awards.filter(a => a.agency === ag); return {awards: l.length, amount: l.reduce((s,a) => s + (a.amount||0), 0), active: l.filter(a => a.is_active).length}; };
  const summary = {
    awards: [...awards].sort((a,b) => (b.last_year||0) - (a.last_year||0)).map(a => ({ id:a.id, agency:a.agency, unit:a.unit, unit_name:a.unit_name, mechanism:a.mechanism,
      title:a.title, first_year:a.first_year, last_year:a.last_year, amount:a.amount, is_active:a.is_active, role:a.match.role, level:a.match.level,
      reasons:a.match.reasons, url:a.url, org:a.org, source:a.source })),
    total_awards: awards.length, total_amount: awards.reduce((s,a) => s + (a.amount||0), 0), active_awards: awards.filter(a => a.is_active).length,
    as_lead_pi: awards.filter(a => /PI/.test(a.match.role) && a.match.role !== "Co-PI").length,
    agencies: { NIH: by("NIH"), NSF: by("NSF") },
    source: "NIH RePORTER / NSF Awards", kind: "funding", include_medium: FUND_CFG.includeMedium,
  };
  return { evidence, summary };
}

/** Marca las áreas de financiamiento inferidas que coinciden con fondos ya recibidos. */
function validateFundingSignals(signals, awards){
  const NSF_ALIASES = { EHR: "EDU", EDU: "EHR" };
  return signals.map(sg => {
    const txt = sg.agencies.toUpperCase();
    const hits = awards.filter(a => {
      if (!txt.includes(a.agency)) return false;
      if (a.agency === "NIH") return !!a.unit && new RegExp(`\\b${a.unit}\\b`).test(txt);
      return String(a.unit).split("/").some(u => u && (new RegExp(`\\b${u}\\b`).test(txt) || (NSF_ALIASES[u] && txt.includes(NSF_ALIASES[u]))));
    });
    if (!hits.length) return sg;
    return { ...sg, validated: true, confidence: round2(Math.min(0.99, sg.confidence + 0.07)),
      track_record: hits.map(a => `${a.agency} ${a.unit} ${a.mechanism} ${a.id}`.replace(/\s+/g," ").trim()),
      rationale: [...sg.rationale, `Fondos previos: ${uniq(hits.map(a => `${a.agency} ${a.unit}`)).join(", ")} (${hits.length})`],
      source: sg.source + " + funding record" };
  }).sort((a,b) => (b.validated?1:0) - (a.validated?1:0) || b.confidence - a.confidence);
}

/* ---------------------------------------------------------------------
   Perfil completo de capacidades de un investigador
   --------------------------------------------------------------------- */
function buildCapacityProfile(R, oaIndex){
  const oa = R.sources.openalex, hasOA = !!oa?.author;
  const awards = (typeof acceptedAwards === "function") ? acceptedAwards(R) : [];
  if (!hasOA && !awards.length) return null;
  const works = hasOA ? (oa.works || []) : [];
  const areas = deriveResearchAreas(works, 10);
  const careerStart = oa?.metrics?.first_year;
  const topics = tierTopics(areas.topics, careerStart);
  const expertise = deriveExpertise(areas.subfields);
  const lex = lexiconDetect([...works, ...awards.map(grantDoc)]);
  const keep = list => list.filter(e => e.supporting_works >= 2 || e.confidence >= 0.45).slice(0,10);
  const methods = keep(lex.Method), technologies = keep(lex.Technology), problems = keep(lex.Problem),
        populations = keep(lex.Population), geography = keep(lex.Geography);
  const track = fundingTrackRecord(awards);
  const funding = validateFundingSignals(inferFundingSignals([...expertise, ...topics.primary, ...topics.secondary, ...methods, ...technologies, ...problems, ...populations, ...geography]), awards);
  const profile = {
    engine_version: CAPACITY_ENGINE_VERSION, generated: nowISO(),
    basis: { source: [hasOA && "OpenAlex", awards.length && "NIH RePORTER / NSF Awards"].filter(Boolean).join(" + "),
             author_id: hasOA ? oa.author.id : null, works_analyzed: works.length, works_total: oa?.works_total || 0,
             truncated: !!oa?.works_truncated, grants_analyzed: awards.length, funding_include_medium: FUND_CFG.includeMedium },
    research_areas: areas.top,
    primary_field: areas.fields[0] || null,
    fields: areas.fields.slice(0,5),
    expertise, topics, methods, technologies, problems, populations, geography,
    collaboration: hasOA ? collaborationNetwork(R, works, oaIndex) : null,
    activity: researchActivity(works, oa?.metrics, oa?.works_truncated, awards),
    selected_publications: selectPublications(works, 10),
    funding_record: track.summary,
    funding_signals: funding,
    declared_keywords: { values: [], source:"ORCID", kind:"declared" },
  };
  profile.evidence = [
    ...expertise, ...(profile.primary_field ? [profile.primary_field] : []),
    ...topics.primary, ...topics.secondary, ...topics.emerging,
    ...methods, ...technologies, ...problems, ...populations, ...geography, ...track.evidence, ...funding,
  ];
  return profile;
}

/** Recalcula los perfiles de todos (permite enlazar colaboradores que están en el conjunto). */
async function buildAllProfiles(list, onProgress){
  const oaIndex = new Map();
  for (const R of list){ const a = R.sources.openalex?.author; if (a){ oaIndex.set(a.id, R.orcid); (R.sources.openalex.alternates||[]).forEach(x => oaIndex.set(x.id, R.orcid)); } }
  let i = 0;
  for (const R of list){
    R.capacity = buildCapacityProfile(R, oaIndex);
    if (++i % 10 === 0){ onProgress && onProgress(i); await sleep(0); }
  }
}
