"use strict";
/* =====================================================================
   REGISTRO DE FUENTES
   Cada fuente es un adaptador con uno de dos contratos:
     { id, label, kind, role, status, enrich(R, signal) }        → consulta por investigador (OpenAlex)
     { id, label, kind, role, status, harvest(since, signal) }   → descarga masiva + matchAwards() (NIH, NSF)
   enrich() escribe SOLO en R.sources[id] (con prov()) y nunca modifica
   R.identity ni R.affiliation. La capa de capacidades lee de R.sources.
   Para integrar una fuente nueva: implementar enrich(), cambiar status a
   "active" y, si aporta trabajos, normalizarlos al formato compactWork()
   (id, doi, title, year, type, source, authors, topics, keywords, abstract).
   ===================================================================== */
const SOURCE_REGISTRY = [
  {id:"orcid",      label:"ORCID",                   kind:"declared",      status:"active",  role:"Identidad y afiliación declarada (fuente principal)"},
  {id:"openalex",   label:"OpenAlex",                kind:"bibliographic", status:"active",  role:"Producción científica, métricas, topics", enrich:(R,s) => OPENALEX.enrich(R,s)},
  {id:"vivo",       label:"VIVO",                    kind:"institutional", status:"export",  role:"Representación institucional (exportación RDF)"},
  {id:"crossref",   label:"Crossref",                kind:"bibliographic", status:"planned", role:"Metadatos de DOI, financiadores (Funder Registry), licencias"},
  {id:"pubmed",     label:"PubMed",                  kind:"bibliographic", status:"planned", role:"MeSH, tipos de estudio clínico, poblaciones"},
  {id:"dspace",     label:"Repositorio UPR / DSpace",kind:"institutional", status:"planned", role:"Tesis, informes técnicos, producción local"},
  {id:"infoed",     label:"InfoEd",                  kind:"funding",       status:"planned", role:"Propuestas y adjudicaciones institucionales"},
  {id:"nih",        label:"NIH RePORTER",            kind:"funding",       status:"active",  role:"Proyectos NIH financiados (vínculo por nombre + institución UPR)", harvest:(y,s,p) => NIH.harvest(y,s,p)},
  {id:"nsf",        label:"NSF Awards",              kind:"funding",       status:"active",  role:"Proyectos NSF financiados (vínculo por nombre + institución UPR)", harvest:(y,s,p) => NSF.harvest(y,s,p)},
  {id:"scopus",     label:"Scopus",                  kind:"bibliographic", status:"planned", role:"Métricas y producción (requiere licencia/API key)"},
  {id:"wos",        label:"Web of Science",          kind:"bibliographic", status:"planned", role:"Métricas y producción (requiere licencia/API key)"},
];
