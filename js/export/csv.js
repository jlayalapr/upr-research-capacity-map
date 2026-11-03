"use strict";
/* =====================================================================
   EXPORTACIÓN: CSV de profesores, CSV de capacidades, JSON del mapa.
   Las columnas indican su fuente: ORCID (declarado), OpenAlex
   (bibliográfico) o inferido (capa de capacidades).
   ===================================================================== */
const PROF_COLS = [
  "Recinto","ORCID","URL ORCID","Nombre","Apellidos","Nombre publicado","Cargo","Departamento","Facultad/Colegio (derivado)","Institución","Ciudad","Fecha inicio","Fecha fin","Correo público",
  "OpenAlex ID","OpenAlex Match","Publications","Citations","H-index","Years Active","Research Topics","Primary Field","Recent Publications","Main Collaborators",
  "OpenAlex Institutions","Discrepancias ORCID/OpenAlex",
  "Expertise (inferido)","Methods (inferido)","Technologies (inferido)","Research Problems (inferido)","Populations (inferido)","Geographic Focus (inferido)","Research Activity (inferido)","Potential Funding Areas (inferido)",
  "NIH Awards","NSF Awards","Total Funding (USD)","Active Awards","Funding Units","Funding Match Level",
];

function baseRow(R){
  const a = R.affiliation, id = R.identity;
  return {
    "Recinto": a.campus, "ORCID": R.orcid, "URL ORCID": "https://orcid.org/" + R.orcid,
    "Nombre": id.given, "Apellidos": id.family, "Nombre publicado": id.credit,
    "Cargo": a.role, "Departamento": a.dept, "Facultad/Colegio (derivado)": a.college, "Institución": a.org, "Ciudad": a.city,
    "Fecha inicio": a.start, "Fecha fin": a.end, "Correo público": (id.emails||[]).join(" | "),
  };
}
const capList = (list, n=6) => (list||[]).slice(0,n).map(e => `${e.capacity} (${e.confidence})`).join("; ");

function professorRow(R){
  const row = baseRow(R), oa = R.sources.openalex, P = R.capacity;
  const fr = P?.funding_record;
  if (fr) Object.assign(row, {
    "NIH Awards": fr.agencies.NIH.awards, "NSF Awards": fr.agencies.NSF.awards, "Total Funding (USD)": Math.round(fr.total_amount),
    "Active Awards": fr.active_awards, "Funding Units": uniq(fr.awards.map(a => `${a.agency} ${a.unit}`)).join("; "),
    "Funding Match Level": uniq(fr.awards.map(a => a.level)).join("/"),
  });
  if (P) Object.assign(row, {
    "Expertise (inferido)": capList(P.expertise), "Methods (inferido)": capList(P.methods), "Technologies (inferido)": capList(P.technologies),
    "Research Problems (inferido)": capList(P.problems), "Populations (inferido)": capList(P.populations), "Geographic Focus (inferido)": capList(P.geography),
    "Research Activity (inferido)": [P.activity?.status, ...(P.activity?.flags||[])].filter(Boolean).join(" · "),
    "Potential Funding Areas (inferido)": (P.funding_signals||[]).map(f => `${f.capacity} [${f.agencies}] (${f.confidence}${f.validated ? ", respaldado por fondos previos" : ""})`).join("; "),
  });
  if (!oa?.author) return row;
  const m = oa.metrics || {};
  const byId = new Map((oa.works||[]).map(w => [w.id, w]));
  Object.assign(row, {
    "OpenAlex ID": oa.author?.id || "",
    "OpenAlex Match": oa.match?.status || "",
    "Publications": m.publications ?? "", "Citations": m.citations ?? "", "H-index": m.h_index ?? "", "Years Active": m.years_active || "",
    "OpenAlex Institutions": uniq((oa.author?.last_known_institutions||[]).map(i => i.name)).join(" | "),
    "Discrepancias ORCID/OpenAlex": (R.discrepancies||[]).map(d => `${d.field}: ORCID="${d.orcid}" / OpenAlex="${d.openalex}"`).join(" || "),
  });
  if (P){
    Object.assign(row, {
      "Research Topics": (P.research_areas||[]).slice(0,10).map(t => t.capacity).join("; "),
      "Primary Field": P.primary_field?.capacity || "",
      "Recent Publications": [...(oa.works||[])].sort((a,b) => (b.year||0)-(a.year||0)).slice(0,5).map(w => `${w.title} (${w.year||"s.f."})${w.doi ? " doi:"+w.doi : ""}`).join(" || "),
      "Main Collaborators": (P.collaboration?.top_coauthors||[]).slice(0,8).map(c => `${c.name} (${c.works})`).join("; "),
    });
  }
  return row;
}

function downloadProfessorsCSV(list, label){
  const rows = list.map(professorRow);
  saveBlob(new Blob([tableCSV(rows, PROF_COLS)], {type:"text/csv;charset=utf-8"}), `orcid_upr_${slug(label)}_${new Date().toISOString().slice(0,10)}.csv`);
}
function downloadCapacitiesCSV(list, label){
  const facts = capacityFacts(list);
  saveBlob(new Blob([tableCSV(facts)], {type:"text/csv;charset=utf-8"}), `upr_capacidades_${slug(label)}_${new Date().toISOString().slice(0,10)}.csv`);
}

/* JSON completo del mapa: fuentes separadas + capacidades + hechos agregables. */
function capacityMapJSON(list){
  return {
    schema: "upr-research-capacity-map/1.0",
    generated: nowISO(), label: STATE.label, engine_version: CAPACITY_ENGINE_VERSION,
    architecture: {
      ORCID: "quién es el investigador (identidad y afiliación declarada)",
      OpenAlex: "qué ha publicado y qué temas trabaja (bibliográfico)",
      VIVO: "cómo la Universidad representa institucionalmente ese conocimiento",
      "Research Capacity Intelligence Layer": "capacidades inferidas a partir de la evidencia",
      "UPR Research Capacity Map": "agregación y visualización de todo el sistema",
    },
    sources: SOURCE_REGISTRY.map(({enrich, harvest, ...s}) => s),
    researchers: list,
    capacity_facts: capacityFacts(list),
  };
}
function downloadCapacityJSON(list, label){
  saveBlob(new Blob([JSON.stringify(capacityMapJSON(list))], {type:"application/json"}), `upr_capacity_map_${slug(label)}_${new Date().toISOString().slice(0,10)}.json`);
}
function importCapacityJSON(obj){
  if (!obj || !Array.isArray(obj.researchers)) throw new Error("Archivo no reconocido (falta 'researchers').");
  STATE.researchers.clear();
  for (const R of obj.researchers) STATE.researchers.set(R.orcid, R);
  STATE.label = obj.label || "Importado";
  return obj.researchers.length;
}
