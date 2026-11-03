"use strict";
/* =====================================================================
   FUNDING-RELEVANT CAPACITY SIGNALS
   Reglas que traducen capacidades (con evidencia) a áreas de financiamiento
   potenciales. ES UNA INFERENCIA: no proviene de OpenAlex ni de ninguna
   agencia. Cada regla exige que TODAS sus condiciones encuentren una
   capacidad con evidencia; la confianza hereda la de esas capacidades.
   ===================================================================== */
const FUNDING_RULES = [
  {label:"AI & Data Science Research",              agencies:"NSF CISE (IIS) · DOE ASCR · NIH ODSS",                need:["artificial intelligence|machine learning|deep learning|data science|computer vision|natural language|language model|data analytics"]},
  {label:"AI in Education & Learning Technologies", agencies:"NSF EDU (DRK-12, IUSE, ITEST) · IES · NSF AI Institutes", need:["artificial intelligence|machine learning|learning analytics|learning technolog|educational technolog|language model|deep learning|virtual"], also:["educat|student|learning|teach|stem|literacy"]},
  {label:"STEM Education & Broadening Participation",agencies:"NSF EDU (IUSE, S-STEM, LSAMP, HSI) · Dept. of Education (MSEIP)", need:["stem education|science education|engineering education|mathematics education|computing education|\\bstem\\b"]},
  {label:"Student Success & Higher Education",      agencies:"Dept. of Education (Title V, TRIO, FIPSE) · NSF HSI",  need:["student success|retention|college students|higher education|academic performance"]},
  {label:"K-12 Education Research",                 agencies:"IES · NSF DRK-12 · Dept. of Education",               need:["k-12|teachers|teaching|literacy|curricul|pedagog"], also:["educat|student|school|children|learning|teach"]},
  {label:"Cancer Research",                          agencies:"NIH NCI · DoD CDMRP · American Cancer Society",       need:["cancer|oncolog|tumor|carcinoma|leukemia|lymphoma"]},
  {label:"Precision Medicine & Genomics",            agencies:"NIH NHGRI · NIH All of Us · NIH NCI",                 need:["genom|genetic|sequencing|bioinformatic|transcriptom|proteom"], also:["cancer|disease|health|clinical|patients|medic|pharmac"]},
  {label:"Health Disparities & Minority Health",     agencies:"NIH NIMHD · CDC · AHRQ",                              need:["hispanic|latino|puerto rican|health disparit|underserved|low-income|minorit|equity"], also:["health|disease|clinical|medic|cancer|diabet|cardio|mental|patients"]},
  {label:"Infectious & Vector-Borne Diseases",       agencies:"NIH NIAID · CDC · DoD",                               need:["infectious|dengue|zika|arbovir|vector|hiv|covid|pathogen|virolog|viral|bacteri|microbio|vaccin|parasit"]},
  {label:"Mental Health & Substance Use",            agencies:"NIH NIMH · NIDA · NIAAA · SAMHSA",                    need:["mental health|depress|anxiety|substance|addiction|psychiatr|suicid|clinical psycholog"]},
  {label:"Neuroscience & Aging",                     agencies:"NIH NINDS · NIA · NSF NCS",                           need:["neuro|alzheimer|dementia|aging|older adults|cognitive|brain"]},
  {label:"Cardiometabolic Health",                   agencies:"NIH NHLBI · NIDDK",                                   need:["diabet|cardio|obesity|hypertension|metabolic|nutrition"]},
  {label:"Environmental Health",                     agencies:"NIH NIEHS · EPA · ATSDR",                             need:["environmental|contamina|pollut|toxic|air quality|water quality|exposure|pesticid"], also:["health|disease|toxicolog|patients|children|pregnan|epidemiolog"]},
  {label:"Climate Change & Resilience",              agencies:"NSF GEO · NOAA · NSF CoPe · DOE BER · EPA",           need:["climate|resilien|sea-level|hurricane|flood|coastal erosion|disaster"]},
  {label:"Natural Hazards & Disaster Research",      agencies:"NSF CMMI (Natural Hazards) · FEMA · NIST · USGS",     need:["hurricane|earthquake|seismic|disaster|flood|landslide|tsunami|hazard"]},
  {label:"Marine & Coastal Science",                 agencies:"NOAA (Sea Grant, NCCOS) · NSF OCE · DOI",             need:["coral|reef|marine|ocean|coastal|fisher|mangrove|seagrass|oceanograph"]},
  {label:"Biodiversity, Ecology & Conservation",     agencies:"NSF DEB/BIO · USFWS · USDA Forest Service",           need:["biodiversity|ecolog|conservation|species|forest|wildlife|evolution"]},
  {label:"Renewable Energy & Energy Systems",        agencies:"DOE (EERE, OE, ARPA-E) · NSF ENG",                    need:["renewable|solar|photovolta|wind energy|energy storage|batter|microgrid|smart grid|power system|energy"]},
  {label:"Advanced Materials & Nanotechnology",      agencies:"NSF DMR · DOE BES · DoD",                             need:["nano|materials|polymer|composite|semiconductor|thin film|catalys"]},
  {label:"Agriculture & Food Systems",               agencies:"USDA NIFA · USDA ARS",                                need:["agricultur|crop|food security|food system|soil|plant|livestock|agroecolog|food science"]},
  {label:"Water Resources",                          agencies:"USGS · EPA · NSF CBET · USDA",                        need:["water quality|groundwater|watershed|hydrolog|wastewater|drinking water|water resources"]},
  {label:"Cybersecurity & Advanced Computing",       agencies:"NSF SaTC · NSF OAC · DHS",                            need:["cybersecurity|privacy|intrusion|malware|cryptograph|high-performance computing|cloud computing|network security"]},
  {label:"Social, Behavioral & Economic Sciences",   agencies:"NSF SBE",                                             need:["sociolog|economic|politic|social science|anthropolog|psycholog|migration|poverty|public policy|governance|demograph"]},
  {label:"Humanities & Cultural Heritage",           agencies:"NEH · NEA · IMLS · Mellon Foundation",                need:["history|literature|philosoph|linguist|cultural heritage|\\barts?\\b|music|archiv|identity|colonial|religio"]},
  {label:"Entrepreneurship, Innovation & Workforce", agencies:"NSF TIP (I-Corps, SBIR/STTR) · EDA · SBA · DOL",      need:["entrepreneur|innovation|small business|workforce|economic development|startup"]},
  {label:"Space & Astronomy",                        agencies:"NASA · NSF AST",                                      need:["astronom|astrophys|planetar|telescope|arecibo observatory|space|solar physics|atmospher"]},
  {label:"Public Health & Epidemiology",             agencies:"CDC · NIH · HRSA",                                    need:["public health|epidemiolog|surveillance|cohort|health services|health care|healthcare"]},
  {label:"Maternal & Child Health",                  agencies:"NIH NICHD · HRSA MCHB",                               need:["maternal|pregnan|prenatal|infant|children|pediatric|neonatal|adolescen"], also:["health|disease|clinical|medic|nutrition|development"]},
  {label:"Biomedical & Molecular Life Sciences",     agencies:"NIH NIGMS (incl. MARC, RISE) · NSF MCB",              need:["molecular biology|cell biology|biochemi|genetics|microbiolog|immunolog|pharmacolog|physiolog|structural biology"]},
  {label:"Engineering & Infrastructure",             agencies:"NSF ENG (CMMI, CBET) · DOT · NIST",                   need:["infrastructure|structural|civil engineering|transportation|manufacturing|robot|control and systems|mechanical engineering"]},
];
const COMPILED_FUNDING = FUNDING_RULES.map(r => ({...r, re:[...r.need, ...(r.also||[])].map(p => new RegExp(p, "i"))}));

/** items: evidencias de capacidad (expertise, topics, methods…). Devuelve señales de financiamiento. */
function inferFundingSignals(items){
  const pool = items.filter(e => e.supporting_works >= 2 || e.confidence >= 0.5);
  const text = e => norm(`${e.capacity} ${e.subfield||""} ${e.field||""}`);
  const out = [];
  for (const rule of COMPILED_FUNDING){
    const matched = [];
    for (const re of rule.re){
      const best = pool.filter(e => re.test(text(e)) && !matched.includes(e)).sort((a,b) => b.confidence - a.confidence)[0];
      if (!best) { matched.length = 0; break; }
      matched.push(best);
    }
    if (!matched.length) continue;
    const ids = uniq(matched.flatMap(m => m.supporting_work_ids||[]));
    const ys = matched.flatMap(m => [m.first_year, m.last_year]).filter(Boolean);
    out.push({
      capacity: rule.label, category: "Funding Area", agencies: rule.agencies,
      confidence: round2(0.9 * matched.reduce((s,m) => s + m.confidence, 0) / matched.length),
      supporting_works: ids.length, supporting_work_ids: ids.slice(0,50), years: yearsRange(ys),
      first_year: ys.length ? Math.min(...ys) : null, last_year: ys.length ? Math.max(...ys) : null,
      rationale: uniq(matched.map(m => `${m.category}: ${m.capacity}`)),
      source: "Inferred (rules over OpenAlex evidence)", kind: "inferred", method: "funding-rules",
    });
  }
  return out.sort((a,b) => b.confidence - a.confidence).slice(0, 8);
}
