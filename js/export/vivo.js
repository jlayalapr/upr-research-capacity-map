"use strict";
// =====================================================================
//  Perfil completo ORCID → VIVO (VIVO-ISF RDF + CSV relacionales)
// =====================================================================
const vlog = m => { const el=$("vlog"); el.textContent += m+"\n"; el.scrollTop = el.scrollHeight; };
let vAbort = null;

function hsh(s){ // hash estable para URIs (FNV-1a doble, base36)
  let a=0x811c9dc5, b=0x9747b28c;
  for (const ch of String(s)){ const c=ch.codePointAt(0); a=Math.imul(a^c,16777619)>>>0; b=Math.imul(b^c,2246822519)>>>0; }
  return a.toString(36)+b.toString(36);
}
const lit = s => '"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/\t/g,"\\t")+'"';
const iri = s => "<"+String(s).replace(/[\s<>"{}|^`\\]/g, c=>encodeURIComponent(c))+">";

class Graph {
  constructor(ns){ this.ns=ns; this.lines=new Set(); }
  u(local){ return `<${this.ns}${local}>`; }
  t(s,p,o){ if (s && o) this.lines.add(`${s} ${p} ${o} .`); }
  l(s,p,v,dt){ if (v===undefined||v===null) return; v=String(v).trim(); if (!v) return; this.t(s,p, lit(v)+(dt?`^^xsd:${dt}`:"")); }
  ttl(){
    return [
      "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
      "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
      "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
      "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
      "@prefix foaf: <http://xmlns.com/foaf/0.1/> .",
      "@prefix vivo: <http://vivoweb.org/ontology/core#> .",
      "@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .",
      "@prefix obo: <http://purl.obolibrary.org/obo/> .",
      "@prefix bibo: <http://purl.org/ontology/bibo/> .",
      "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
      "", ...this.lines, ""].join("\n");
  }
}

// ---- utilidades de fechas ----
function dparts(d){ const y=d?.year?.value; if (!y) return null; return {y, m:d.month?.value||"", d:d.day?.value||""}; }
const dstr = d => { const p=dparts(d); return p ? [p.y,p.m,p.d].filter(Boolean).join("-") : ""; };
function dtv(g, d){
  const p = dparts(d); if (!p) return null;
  const prec = p.m ? (p.d ? "yearMonthDayPrecision" : "yearMonthPrecision") : "yearPrecision";
  const u = g.u("dtv-"+[p.y,p.m,p.d].filter(Boolean).join("-"));
  g.t(u,"a","vivo:DateTimeValue");
  g.l(u,"vivo:dateTime",`${p.y}-${p.m||"01"}-${(p.m&&p.d)||"01"}T00:00:00`,"dateTime");
  g.t(u,"vivo:dateTimePrecision","vivo:"+prec);
  return u;
}
function interval(g, s, e){
  const a=dtv(g,s), b=dtv(g,e); if (!a && !b) return null;
  const u = g.u("dti-"+hsh((a||"")+"|"+(b||"")));
  g.t(u,"a","vivo:DateTimeInterval"); g.t(u,"vivo:start",a); g.t(u,"vivo:end",b);
  return u;
}

// ---- organizaciones ----
function orgLabel(o){
  const city = o.address?.city || "";
  return (isUPR(o.name) && detectCampus(o.name,"")===GENERAL && city && !norm(o.name).includes(norm(city))) ? `${o.name}, ${city}` : o.name;
}
function orgNode(g, o, extraType){
  if (!o?.name) return null;
  const label = orgLabel(o), n = norm(o.name);
  const u = g.u("org-"+hsh(norm(label)));
  g.t(u,"a","foaf:Organization");
  g.t(u,"a", /universi/.test(n) ? "vivo:University" : /college|colegio/.test(n) ? "vivo:College" : /hospital/.test(n) ? "vivo:Hospital" : "foaf:Organization");
  if (extraType) g.t(u,"a",extraType);
  g.l(u,"rdfs:label",label);
  return u;
}
function deptNode(g, orgU, name){
  if (!name || !orgU) return orgU;
  const u = g.u("dept-"+hsh(orgU+"|"+norm(name)));
  g.t(u,"a","foaf:Organization"); g.t(u,"a","vivo:AcademicDepartment"); g.l(u,"rdfs:label",name);
  g.t(u,"obo:BFO_0000050",orgU); g.t(orgU,"obo:BFO_0000051",u);
  return u;
}
const orgId = o => { const d=o?.["disambiguated-organization"]; return d ? `${d["disambiguation-source"]}:${d["disambiguated-organization-identifier"]}` : ""; };

// ---- lectura del registro ORCID ----
function affs(as, key){
  const out=[];
  for (const gr of (as?.[key+"s"]?.["affiliation-group"]||[]))
    for (const s of (gr.summaries||[])){ const e=s[key+"-summary"]; if (e) out.push(e); }
  return out;
}
async function fetchPerson(id, signal, full){
  const rec = await ORCID.record(id, signal);
  const works = (rec["activities-summary"]?.works?.group||[]).map(x=>x["work-summary"]?.[0]).filter(Boolean);
  const details = {};
  if (full)
    for (let i=0; i<works.length; i+=100){
      const pcs = works.slice(i,i+100).map(w=>w["put-code"]).join(",");
      const d = await getJSON(`${API}/${id}/works/${pcs}`, signal);
      for (const b of (d.bulk||[])) if (b.work) details[b.work["put-code"]] = b.work;
    }
  return {rec, works, details};
}

const WORK_CLASS = {
  "journal-article":"bibo:AcademicArticle","magazine-article":"bibo:Article","newspaper-article":"bibo:Article",
  "book":"bibo:Book","edited-book":"bibo:EditedBook","book-chapter":"bibo:Chapter","book-review":"vivo:Review","review":"vivo:Review",
  "conference-paper":"vivo:ConferencePaper","conference-abstract":"vivo:Abstract","conference-poster":"vivo:ConferencePoster",
  "dissertation-thesis":"bibo:Thesis","dissertation":"bibo:Thesis","report":"bibo:Report","working-paper":"vivo:WorkingPaper",
  "data-set":"vivo:Dataset","patent":"bibo:Patent","website":"bibo:Webpage","software":"obo:ERO_0000071",
  "encyclopedia-entry":"bibo:Article","dictionary-entry":"bibo:Article","translation":"bibo:Document","preprint":"bibo:Article",
  "lecture-speech":"vivo:Speech","manual":"bibo:Manual","standards-and-policy":"bibo:Standard",
};
const VENUE_CLASS = t => t==="book-chapter" ? "bibo:Book" : /conference/.test(t) ? "bibo:Proceedings" : /article|review|preprint/.test(t) ? "bibo:Journal" : "bibo:Collection";

function bib(cit, field){
  if (!cit || !/bibtex/i.test(cit["citation-type"]||"")) return "";
  const m = new RegExp(field+"\\s*=\\s*[{\"]((?:[^{}\"]|\\{[^{}]*\\})*)[}\"]","i").exec(cit["citation-value"]||"");
  return m ? m[1].replace(/[{}]/g,"").trim() : "";
}
function workInfo(sum, det){
  const w = det || sum, type = (w.type||"").toLowerCase().replace(/_/g,"-");
  const ids = w["external-ids"]?.["external-id"]||[];
  const idv = t => { const x = ids.find(e => (e["external-id-type"]||"").toLowerCase()===t); return x ? String(x["external-id-normalized"]?.value || x["external-id-value"] || "") : ""; };
  const doi = idv("doi").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//,"").replace(/^doi:\s*/,"");
  let authors = (det?.contributors?.contributor||[])
    .filter(c => !/editor|chair|translator/i.test(c["contributor-attributes"]?.["contributor-role"]||""))
    .map(c => ({name: c["credit-name"]?.value||"", orcid: c["contributor-orcid"]?.path||""}))
    .filter(a => a.name || a.orcid);
  if (!authors.length){ const ba = bib(det?.citation,"author"); if (ba) authors = ba.split(/\s+and\s+/i).map(n=>({name:n.trim(), orcid:""})); }
  const pages = bib(det?.citation,"pages").replace(/--/g,"-");
  return {
    putcode: w["put-code"], type, cls: WORK_CLASS[type] || "bibo:Document",
    title: w.title?.title?.value || "", subtitle: w.title?.subtitle?.value || "",
    journal: w["journal-title"]?.value || bib(det?.citation,"journal") || bib(det?.citation,"booktitle"),
    date: w["publication-date"], doi, pmid: idv("pmid"), pmcid: idv("pmc"), isbn: idv("isbn").replace(/[^0-9xX]/g,""), issn: idv("issn"),
    url: w.url?.value || (doi ? "https://doi.org/"+doi : ""),
    abstract: det?.["short-description"] || "", lang: det?.["language-code"] || "",
    volume: bib(det?.citation,"volume"), issue: bib(det?.citation,"number"), pages,
    authors,
  };
}
const familyOf = n => { n = (n||"").trim(); return norm(n.includes(",") ? n.split(",")[0] : n.split(/\s+/).pop()); };
function splitName(n){
  n=(n||"").trim();
  if (n.includes(",")){ const [f,...g]=n.split(","); return {given:g.join(",").trim(), family:f.trim()}; }
  const parts=n.split(/\s+/); return {given:parts.slice(0,-1).join(" "), family:parts.slice(-1)[0]||""};
}

// ---- construcción ----
function buildVivo(raw, ns, roleRe){
  const g = new Graph(ns);
  const T = {personas:[],posiciones:[],educacion:[],publicaciones:[],autorias:[],financiamiento:[],premios:[],otras_afiliaciones:[],palabras_clave:[],sitios_web:[],identificadores:[]};
  const personU = id => g.u("person-"+id);
  const local = new Set(Object.keys(raw));
  const pubs = new Map();   // clave → {info, listedBy:Set}
  const grants = new Set();
  let nPos = 0;

  for (const [id, {rec, works, details, row, R}] of Object.entries(raw)){
    const pr = rec.person||{}, as = rec["activities-summary"]||{};
    const given = pr.name?.["given-names"]?.value || row.Nombre || "";
    const family = pr.name?.["family-names"]?.value || row.Apellidos || "";
    const credit = pr.name?.["credit-name"]?.value || "";
    const p = personU(id), vc = g.u("person-"+id+"-vcard"), vn = g.u("person-"+id+"-vcard-name");
    g.t(p,"a","foaf:Person");
    g.l(p,"rdfs:label", family ? `${family}, ${given}` : (credit||given||id));
    g.t(p,"vivo:orcidId",`<https://orcid.org/${id}>`); g.t(`<https://orcid.org/${id}>`,"a","owl:Thing");
    g.t(p,"obo:ARG_2000028",vc); g.t(vc,"obo:ARG_2000029",p); g.t(vc,"a","vcard:Individual");
    g.t(vc,"vcard:hasName",vn); g.t(vn,"a","vcard:Name"); g.l(vn,"vcard:givenName",given); g.l(vn,"vcard:familyName",family);
    const bio = pr.biography?.content || ""; g.l(p,"vivo:overview",bio);

    const emails = (pr.emails?.email||[]).map(e=>e.email).filter(Boolean);
    emails.forEach((e,i)=>{ const u=g.u(`person-${id}-email${i+1}`); g.t(vc,"vcard:hasEmail",u); g.t(u,"a","vcard:Email"); g.t(u,"a","vcard:Work"); g.l(u,"vcard:email",e); });

    const kws = (pr.keywords?.keyword||[]).flatMap(k=>(k.content||"").split(/\s*[;,]\s*/)).map(s=>s.trim()).filter(Boolean);
    kws.forEach(k=>{ g.l(p,"vivo:freetextKeyword",k); T.palabras_clave.push({ORCID:id,"Palabra clave":k}); });

    (pr["researcher-urls"]?.["researcher-url"]||[]).forEach((r,i)=>{
      const url=r.url?.value; if(!url) return; const u=g.u(`person-${id}-url${i+1}`);
      g.t(vc,"vcard:hasURL",u); g.t(u,"a","vcard:URL"); g.l(u,"vcard:url",url,"anyURI"); g.l(u,"rdfs:label",r["url-name"]||"");
      T.sitios_web.push({ORCID:id,Nombre:r["url-name"]||"",URL:url});
    });

    // Áreas de investigación (fuente: OpenAlex, derivadas por la capa de capacidades). URI = topic de OpenAlex.
    for (const t of (R?.capacity?.research_areas || [])){
      if (!t.openalex_id) continue;
      const tu = `<https://openalex.org/${t.openalex_id}>`;
      g.t(p,"vivo:hasResearchArea",tu); g.t(tu,"vivo:researchAreaOf",p);
      g.t(tu,"a","skos:Concept"); g.l(tu,"rdfs:label",t.capacity);
    }
    const oaId = R?.sources?.openalex?.author?.id;
    if (oaId){
      const u=g.u(`person-${id}-url-openalex`);
      g.t(vc,"vcard:hasURL",u); g.t(u,"a","vcard:URL"); g.l(u,"vcard:url",`https://openalex.org/${oaId}`,"anyURI"); g.l(u,"rdfs:label","OpenAlex");
      T.identificadores.push({ORCID:id,Tipo:"OpenAlex Author ID",Valor:oaId,URL:`https://openalex.org/${oaId}`});
    }

    for (const x of (pr["external-identifiers"]?.["external-identifier"]||[])){
      const type=x["external-id-type"]||"", val=x["external-id-value"]||"";
      if (/scopus/i.test(type)) g.l(p,"vivo:scopusId",val);
      if (/researcherid/i.test(type)) g.l(p,"vivo:researcherId",val);
      T.identificadores.push({ORCID:id,Tipo:type,Valor:val,URL:x["external-id-url"]?.value||""});
    }

    // Posiciones (empleos y posiciones invitadas)
    let isFaculty=false, title="";
    for (const [kind,label] of [["employment","Empleo"],["invited-position","Posición invitada"]])
      for (const e of affs(as,kind)){
        const o=e.organization||{}, upr=isUPR(o.name), role=e["role-title"]||"";
        const fac = kind==="employment" && upr && roleRe.test(role);
        if (fac && !e["end-date"]){ isFaculty=true; if(!title) title=role; }
        const orgU=orgNode(g,o), du=deptNode(g,orgU,e["department-name"]);
        const pos=g.u(`pos-${id}-${e["put-code"]}`);
        g.t(pos,"a","vivo:Position"); if (fac) g.t(pos,"a","vivo:FacultyPosition");
        g.l(pos,"rdfs:label", role || label);
        g.t(pos,"vivo:relates",p); g.t(p,"vivo:relatedBy",pos);
        g.t(pos,"vivo:relates",du); g.t(du,"vivo:relatedBy",pos);
        g.t(pos,"vivo:dateTimeInterval", interval(g,e["start-date"],e["end-date"]));
        nPos++;
        T.posiciones.push({ORCID:id,Tipo:label,Cargo:role,Departamento:e["department-name"]||"",Organización:o.name||"",Ciudad:o.address?.city||"",Región:o.address?.region||"",País:o.address?.country||"","ID organización":orgId(o),Inicio:dstr(e["start-date"]),Fin:dstr(e["end-date"]),UPR:upr?"sí":"no",Recinto:upr?detectCampus(o.name,o.address?.city).name:"","Docente":fac?"sí":"no"});
      }
    if (isFaculty) g.t(p,"a","vivo:FacultyMember");
    title = title || row.Cargo?.split(" | ")[0] || "";
    if (title){ const tu=g.u(`person-${id}-vcard-title`); g.t(vc,"vcard:hasTitle",tu); g.t(tu,"a","vcard:Title"); g.l(tu,"vcard:title",title); }

    // Educación y calificaciones
    for (const [kind,label] of [["education","Educación"],["qualification","Calificación"]])
      for (const e of affs(as,kind)){
        const o=e.organization||{}, orgU=orgNode(g,o), deg=e["role-title"]||"";
        const ep=g.u(`edu-${id}-${e["put-code"]}`);
        g.t(ep,"a","vivo:EducationalProcess");
        g.t(ep,"obo:RO_0000057",p); g.t(p,"obo:RO_0000056",ep);
        g.t(ep,"obo:RO_0000057",orgU); g.t(orgU,"obo:RO_0000056",ep);
        g.l(ep,"vivo:departmentOrSchool",e["department-name"]);
        g.t(ep,"vivo:dateTimeInterval", interval(g,e["start-date"],e["end-date"]));
        if (deg){
          const ad=g.u(`deg-${id}-${e["put-code"]}`), dg=g.u("degree-"+hsh(norm(deg)));
          g.t(ad,"a","vivo:AwardedDegree"); g.l(ad,"rdfs:label",deg);
          g.t(ad,"vivo:relates",p); g.t(p,"vivo:relatedBy",ad);
          g.t(dg,"a","vivo:AcademicDegree"); g.l(dg,"rdfs:label",deg); g.t(ad,"vivo:relates",dg); g.t(dg,"vivo:relatedBy",ad);
          g.t(ad,"obo:RO_0002353",ep); g.t(ep,"obo:RO_0002234",ad);
          g.t(ad,"vivo:assignedBy",orgU); g.t(orgU,"vivo:assigns",ad);
        }
        T.educacion.push({ORCID:id,Tipo:label,Grado:deg,Departamento:e["department-name"]||"",Organización:o.name||"",Ciudad:o.address?.city||"",País:o.address?.country||"","ID organización":orgId(o),Inicio:dstr(e["start-date"]),Fin:dstr(e["end-date"])});
      }

    // Premios / distinciones
    for (const e of affs(as,"distinction")){
      const o=e.organization||{}, orgU=orgNode(g,o), name=e["role-title"]||o.name||"Distinción";
      const ar=g.u(`award-${id}-${e["put-code"]}`), aw=g.u("awd-"+hsh(norm(name)+"|"+(orgU||"")));
      g.t(ar,"a","vivo:AwardReceipt"); g.l(ar,"rdfs:label",name);
      g.t(ar,"vivo:relates",p); g.t(p,"vivo:relatedBy",ar);
      g.t(aw,"a","vivo:Award"); g.l(aw,"rdfs:label",name); g.t(ar,"vivo:relates",aw); g.t(aw,"vivo:relatedBy",ar);
      g.t(ar,"vivo:assignedBy",orgU); g.t(orgU,"vivo:assigns",ar);
      g.t(ar,"vivo:dateTimeValue", dtv(g,e["start-date"]));
      T.premios.push({ORCID:id,Premio:name,Departamento:e["department-name"]||"",Organización:o.name||"",Fecha:dstr(e["start-date"])});
    }

    // Membresías y servicio
    for (const [kind,cls,label] of [["membership","vivo:MemberRole","Membresía"],["service","vivo:ServiceProviderRole","Servicio"]])
      for (const e of affs(as,kind)){
        const o=e.organization||{}, orgU=orgNode(g,o);
        const r=g.u(`${kind}-${id}-${e["put-code"]}`);
        g.t(r,"a",cls); g.l(r,"rdfs:label",e["role-title"]||label);
        g.t(r,"obo:RO_0000052",p); g.t(p,"obo:RO_0000053",r);
        g.t(r,"vivo:roleContributesTo",orgU); g.t(orgU,"vivo:contributingRole",r);
        g.t(r,"vivo:dateTimeInterval", interval(g,e["start-date"],e["end-date"]));
        T.otras_afiliaciones.push({ORCID:id,Tipo:label,Rol:e["role-title"]||"",Departamento:e["department-name"]||"",Organización:o.name||"",Inicio:dstr(e["start-date"]),Fin:dstr(e["end-date"])});
      }

    // Financiamiento
    const fundings = (as.fundings?.group||[]).map(x=>x["funding-summary"]?.[0]).filter(Boolean);
    // Proyectos NIH/NSF aceptados (vínculo nombre + institución). Evita duplicar los que ya declara ORCID.
    const extAwards = (R && typeof acceptedAwards === "function") ? acceptedAwards(R) : [];
    const extIds = extAwards.map(a => String(a.id).replace(/[^a-z0-9]/gi,"").toUpperCase()).filter(x => x.length >= 6);
    for (const f of fundings){
      const o=f.organization||{}, num=(f["external-ids"]?.["external-id"]||[]).find(x=>/grant/i.test(x["external-id-type"]||""))?.["external-id-value"]||"";
      const numN = String(num).replace(/[^a-z0-9]/gi,"").toUpperCase();
      if (numN && extIds.some(x => numN.includes(x) || x.includes(numN))) continue;
      const ftitle=f.title?.title?.value||"";
      const key = num ? "grant-"+hsh(norm(o.name)+"|"+norm(num)) : "grant-"+hsh(norm(o.name)+"|"+norm(ftitle));
      const gr=g.u(key), fo=orgNode(g,o,"vivo:FundingOrganization");
      if (!grants.has(key)){
        grants.add(key);
        g.t(gr,"a","vivo:Grant"); g.l(gr,"rdfs:label",ftitle); g.l(gr,"vivo:sponsorAwardId",num);
        g.t(gr,"vivo:assignedBy",fo); g.t(fo,"vivo:assigns",gr);
        g.t(gr,"vivo:dateTimeInterval", interval(g,f["start-date"],f["end-date"]));
      }
      const rl=g.u(`grole-${id}-${f["put-code"]}`);
      g.t(rl,"a","vivo:InvestigatorRole"); g.t(rl,"obo:RO_0000052",p); g.t(p,"obo:RO_0000053",rl);
      g.t(gr,"vivo:relates",rl); g.t(rl,"vivo:relatedBy",gr); g.t(gr,"vivo:relates",p); g.t(p,"vivo:relatedBy",gr);
      T.financiamiento.push({ORCID:id,Fuente:"ORCID","Nivel de vínculo":"declarado",Título:ftitle,Tipo:f.type||"",Financiador:o.name||"","ID financiador":orgId(o),"Número de premio":num,Inicio:dstr(f["start-date"]),Fin:dstr(f["end-date"]),Monto:"",Rol:"",URL:f.url?.value||""});
    }
    for (const a of extAwards){
      const key = "grant-"+hsh(a.agency+"|"+a.id), gr = g.u(key);
      const fo = orgNode(g, {name: a.agency === "NIH" ? (a.unit_name ? `${a.unit_name} (NIH)` : "National Institutes of Health") : "National Science Foundation"}, "vivo:FundingOrganization");
      const Y = y => y ? {year:{value:String(y)}} : null;
      if (!grants.has(key)){
        grants.add(key);
        g.t(gr,"a","vivo:Grant"); g.l(gr,"rdfs:label",a.title); g.l(gr,"vivo:sponsorAwardId",a.id);
        if (a.amount) g.l(gr,"vivo:totalAwardAmount",String(Math.round(a.amount)));
        g.t(gr,"vivo:assignedBy",fo); g.t(fo,"vivo:assigns",gr);
        g.t(gr,"vivo:dateTimeInterval", interval(g,Y(a.first_year),Y(a.last_year)));
        if (a.url){ const k=g.u(key+"-vcard"), uu=g.u(key+"-vcard-url"); g.t(gr,"obo:ARG_2000028",k); g.t(k,"obo:ARG_2000029",gr); g.t(k,"a","vcard:Kind"); g.t(k,"vcard:hasURL",uu); g.t(uu,"a","vcard:URL"); g.l(uu,"vcard:url",a.url,"anyURI"); }
      }
      const rl = g.u(`grole-${id}-${hsh(a.agency+a.id)}`);
      g.t(rl,"a", a.match.role === "Co-PI" ? "vivo:CoPrincipalInvestigatorRole" : "vivo:PrincipalInvestigatorRole"); g.t(rl,"a","vivo:InvestigatorRole");
      g.t(rl,"obo:RO_0000052",p); g.t(p,"obo:RO_0000053",rl);
      g.t(gr,"vivo:relates",rl); g.t(rl,"vivo:relatedBy",gr); g.t(gr,"vivo:relates",p); g.t(p,"vivo:relatedBy",gr);
      T.financiamiento.push({ORCID:id,Fuente:a.source,"Nivel de vínculo":a.match.level,Título:a.title,Tipo:[a.agency,a.unit,a.mechanism].filter(Boolean).join(" "),
        Financiador:a.agency==="NIH"?(a.unit_name||"NIH"):"National Science Foundation","ID financiador":"","Número de premio":a.id,Inicio:a.start||a.first_year||"",Fin:a.end||a.last_year||"",Monto:Math.round(a.amount||0),Rol:a.match.role,URL:a.url});
    }

    // Publicaciones (se agrupan entre profesores: un mismo DOI = una publicación)
    for (const s of works){
      const info = workInfo(s, details[s["put-code"]]);
      if (!info.title) continue;
      const key = info.doi ? "doi-"+hsh(info.doi) : "t-"+hsh(norm(info.title)+"|"+(info.date?.year?.value||""));
      let pb = pubs.get(key);
      if (!pb){ pb = {key, info, listedBy:new Set()}; pubs.set(key,pb); }
      else if (!pb.info.authors.length && info.authors.length) pb.info.authors = info.authors;
      else if (pb.info.authors.length===info.authors.length)
        info.authors.forEach((a,i)=>{ if (a.orcid && !pb.info.authors[i].orcid) pb.info.authors[i].orcid=a.orcid; });
      pb.listedBy.add(id);
    }

    T.personas.push({ORCID:id,"URI VIVO":p.slice(1,-1),Nombre:given,Apellidos:family,"Nombre publicado":credit,
      "Otros nombres":(pr["other-names"]?.["other-name"]||[]).map(x=>x.content).join(" | "),
      Recinto:row.Recinto||"","Cargo actual":title,"Departamento":row.Departamento||"",Correos:emails.join(" | "),
      País:(pr.addresses?.address||[]).map(a=>a.country?.value).filter(Boolean).join(" | "),
      Biografía:bio,"Palabras clave":kws.join(" | "),Publicaciones:works.length,Fondos:fundings.length,
      "Revisiones por pares":(as["peer-reviews"]?.group||[]).length,"Última modificación":as["last-modified-date"]?.value ? new Date(as["last-modified-date"].value).toISOString().slice(0,10) : ""});
  }

  // Serializar publicaciones y autorías
  const nameOf = id => { const r=raw[id]?.rec?.person?.name; return r ? `${r["family-names"]?.value||""}, ${r["given-names"]?.value||""}` : id; };
  for (const {key, info, listedBy} of pubs.values()){
    // asegurar que cada profesor que la lista aparezca como autor
    for (const id of listedBy){
      if (info.authors.some(a=>a.orcid===id)) continue;
      const fam = norm(raw[id].rec.person?.name?.["family-names"]?.value||"");
      const m = fam && info.authors.find(a=>!a.orcid && familyOf(a.name) && fam.split(/\s+/).includes(familyOf(a.name)));
      if (m) m.orcid = id; else info.authors.push({name:nameOf(id), orcid:id});
    }
    const u = g.u("pub-"+key);
    g.t(u,"a",info.cls); if (info.cls!=="bibo:Document") g.t(u,"a","bibo:Document");
    g.l(u,"rdfs:label", info.subtitle ? `${info.title}: ${info.subtitle}` : info.title);
    g.l(u,"bibo:doi",info.doi); g.l(u,"bibo:pmid",info.pmid); g.l(u,"vivo:pmcid",info.pmcid);
    if (info.isbn) g.l(u, info.isbn.length===13 ? "bibo:isbn13" : "bibo:isbn10", info.isbn);
    g.l(u,"bibo:volume",info.volume); g.l(u,"bibo:issue",info.issue);
    if (info.pages){ const [a,b]=info.pages.split("-"); g.l(u,"bibo:pageStart",a); g.l(u,"bibo:pageEnd",b); }
    g.l(u,"bibo:abstract",info.abstract);
    g.t(u,"vivo:dateTimeValue",dtv(g,info.date));
    if (info.url){
      const k=g.u(`pub-${key}-vcard`), uu=g.u(`pub-${key}-vcard-url`);
      g.t(u,"obo:ARG_2000028",k); g.t(k,"obo:ARG_2000029",u); g.t(k,"a","vcard:Kind");
      g.t(k,"vcard:hasURL",uu); g.t(uu,"a","vcard:URL"); g.l(uu,"vcard:url",info.url,"anyURI");
    }
    if (info.journal){
      const v=g.u("venue-"+hsh(info.issn ? info.issn.replace(/-/g,"") : norm(info.journal)));
      g.t(v,"a",VENUE_CLASS(info.type)); g.l(v,"rdfs:label",info.journal); g.l(v,"bibo:issn",info.issn);
      g.t(u,"vivo:hasPublicationVenue",v); g.t(v,"vivo:publicationVenueFor",u);
    }
    info.authors.forEach((a,i)=>{
      const au=g.u(`pub-${key}-a${i+1}`), isLocal = a.orcid && local.has(a.orcid);
      g.t(au,"a","vivo:Authorship"); g.l(au,"vivo:rank",i+1,"int");
      g.t(au,"vivo:relates",u); g.t(u,"vivo:relatedBy",au);
      if (isLocal){ const p=personU(a.orcid); g.t(au,"vivo:relates",p); g.t(p,"vivo:relatedBy",au); }
      else {
        const vi=g.u(`pub-${key}-a${i+1}-vcard`), vn=g.u(`pub-${key}-a${i+1}-vcard-name`), sn=splitName(a.name);
        g.t(vi,"a","vcard:Individual"); g.t(au,"vivo:relates",vi); g.t(vi,"vivo:relatedBy",au);
        g.t(vi,"vcard:hasName",vn); g.t(vn,"a","vcard:Name"); g.l(vn,"vcard:givenName",sn.given); g.l(vn,"vcard:familyName",sn.family);
      }
      T.autorias.push({"ID publicación":key,Rango:i+1,Autor:a.name||nameOf(a.orcid),"ORCID autor":a.orcid||"","Profesor UPR en el paquete":isLocal?"sí":"no"});
    });
    const p=dparts(info.date)||{};
    T.publicaciones.push({"ID publicación":key,"URI VIVO":u.slice(1,-1),"Tipo ORCID":info.type,"Clase VIVO":info.cls,Título:info.title,Subtítulo:info.subtitle,
      "Revista / fuente":info.journal,Año:p.y||"",Mes:p.m||"",Día:p.d||"",DOI:info.doi,PMID:info.pmid,PMCID:info.pmcid,ISBN:info.isbn,ISSN:info.issn,
      Volumen:info.volume,Número:info.issue,Páginas:info.pages,URL:info.url,Idioma:info.lang,Resumen:info.abstract,
      Autores:info.authors.map(a=>a.name||nameOf(a.orcid)).join("; "),"Profesores UPR (ORCID)":[...listedBy].join(" | ")});
  }
  return {g, T, stats:{people:local.size, pos:nPos, pubs:pubs.size, grants:grants.size}};
}


$("vivoBtn").onclick = async () => {
  let ns = $("ns").value.trim(); if (!/^https?:\/\//.test(ns)){ alert("El namespace debe empezar con http:// o https://"); return; }
  if (!/[\/#]$/.test(ns)) ns += "/";
  let roleRe; try{ roleRe = new RegExp($("roleRegex").value,"i"); }catch(e){ alert("Expresión regular inválida"); return; }
  const full = $("fullWorks").checked;
  const people = researchers();
  vAbort = new AbortController(); const signal = vAbort.signal;
  $("vlog").textContent=""; $("vbar").style.width="0";
  $("vivoBtn").disabled = true; $("vivoStop").disabled = false; $("start").disabled = true;
  const raw = {};
  try{
    vlog(`Descargando ${people.length} registros ORCID completos…`);
    let done = 0;
    await pool(people, 6, async (R) => {
      try{ raw[R.orcid] = {...await fetchPerson(R.orcid, signal, full), row: baseRow(R), R}; }
      catch(e){ if (!signal.aborted) vlog(`  ✗ ${R.orcid}: ${e.message}`); }
      done++; $("vPeople").textContent = done; $("vbar").style.width = Math.round(90*done/people.length)+"%";
    }, signal);
    if (signal.aborted) vlog("Detenido: se generará el paquete con lo descargado hasta ahora.");
    if (!Object.keys(raw).length){ vlog("No hay datos para generar."); return; }

    vlog("Generando RDF y CSV…");
    const {g, T, stats} = buildVivo(raw, ns, roleRe);
    $("vPeople").textContent=stats.people; $("vPos").textContent=stats.pos; $("vPubs").textContent=stats.pubs;
    $("vGrants").textContent=stats.grants; $("vTriples").textContent=g.lines.size.toLocaleString("es");

    const lbl = slug(STATE.label);
    const stamp = new Date().toISOString().slice(0,10);
    const files = {"vivo.ttl": g.ttl()};
    for (const [k,rows] of Object.entries(T)) files[`csv/${k}.csv`] = tableCSV(rows);
    files["orcid_raw.json"] = JSON.stringify(Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,{record:v.rec, works:v.details}])), null, 1);
    files["LEEME.txt"] = [
      `Paquete VIVO generado desde pub.orcid.org — ${STATE.label} — ${stamp}`,
      `Namespace: ${ns}`, "",
      "vivo.ttl: RDF (Turtle, ontología VIVO-ISF). Incluye fondos de ORCID y, si se consultaron, proyectos NIH/NSF vinculados con confianza alta.",
      "  Cárgalo en VIVO: Site Admin → Add/Remove RDF data → formato N3/Turtle → add mixed RDF.",
      "  Recomendado: cargarlo primero en un grafo aparte (p. ej. http://vivo.upr.edu/graph/orcid) para poder reemplazarlo luego.",
      "csv/: tablas relacionales enlazadas por ORCID e 'ID publicación', útiles para revisar, limpiar o importar con otras herramientas.",
      "orcid_raw.json: datos originales de ORCID.", "",
      "Notas:",
      "- Solo se incluye la información que cada investigador hizo pública en ORCID.",
      "- Las publicaciones se agrupan por DOI (o por título+año) entre profesores; los coautores externos se crean como vcard:Individual.",
      "- Revisa organizaciones duplicadas por variantes de nombre (p. ej. 'UPR Mayagüez' vs 'University of Puerto Rico at Mayagüez') antes de cargar a producción.",
    ].join("\r\n");

    if (window.JSZip){
      const zip = new JSZip(); for (const [n,c] of Object.entries(files)) zip.file(n,c);
      saveBlob(await zip.generateAsync({type:"blob", compression:"DEFLATE"}), `vivo_upr_${lbl}_${stamp}.zip`);
    } else {
      vlog("No se pudo cargar JSZip; se descargarán los archivos por separado.");
      for (const [n,c] of Object.entries(files)) saveBlob(new Blob([c],{type:"text/plain;charset=utf-8"}), `vivo_upr_${lbl}_${n.replace("/","_")}`);
    }
    $("vbar").style.width="100%";
    vlog(`✓ Paquete listo: ${stats.people} personas, ${stats.pos} posiciones, ${stats.pubs} publicaciones, ${stats.grants} fondos, ${g.lines.size} triples.`);
  }catch(e){ vlog("✗ Error: "+e.message); console.error(e); }
  finally{ $("vivoBtn").disabled=false; $("vivoStop").disabled=true; $("start").disabled=false; }
};
$("vivoStop").onclick = () => vAbort && vAbort.abort();
