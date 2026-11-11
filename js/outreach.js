"use strict";
/* =====================================================================
   DIFUSIÓN DE CONVOCATORIAS (solo admin)
   Desde una convocatoria de Grants.gov arma un borrador de correo para el
   equipo sugerido: destinatarios (correos de ORCID + los añadidos en
   Seguimiento), asunto y mensaje con los detalles de la convocatoria y el
   ofrecimiento de apoyo. Se copia o se abre en Gmail / la app de correo.
   ===================================================================== */
GRANTS.detail = async function(id, signal){
  const key = `grants:detail:${id}`, c = CACHE.get(key);
  if (c.hit && Date.now() - (c.value.t || 0) < 24 * 3600e3) return c.value.d;
  const r = await fundFetch("grants", "/v1/api/fetchOpportunity", signal, { method: "POST", body: { opportunityId: Number(id) } });
  const D = r?.data || {}, s = D.synopsis || D.forecast || {};
  const text = h => { const el = document.createElement("div"); el.innerHTML = String(h || ""); return (el.textContent || "").replace(/\s+/g, " ").trim(); };
  const d = { desc: text(s.synopsisDesc || s.forecastDesc).slice(0, 900), ceiling: Number(s.awardCeiling) || null, floor: Number(s.awardFloor) || null,
    elig: text(s.applicantEligibilityDesc).slice(0, 350), types: (s.applicantTypes || []).map(t => t.description).slice(0, 4),
    contact: text(s.agencyContactName), contactEmail: s.agencyContactEmail || "", response: s.responseDateStr || s.responseDate || "",
    costSharing: s.costSharing, instruments: (s.fundingInstruments || []).map(f => f.description) };
  CACHE.set(key, { t: Date.now(), d }, true);
  return d;
};

const SIGN_KEY = "uprcap:signature";
const sigGet = () => { try { return JSON.parse(localStorage.getItem(SIGN_KEY) || "{}"); } catch { return {}; } };
const sigSet = s => { try { localStorage.setItem(SIGN_KEY, JSON.stringify(s)); } catch {} };

function outreachCandidates(call, areas){
  const seen = new Map();
  for (const l of call.areas || []) for (const p of (areas.get(l)?.people || [])){
    const x = seen.get(p.R.orcid) || seen.set(p.R.orcid, { R: p.R, score: 0, validated: false, areas: [] }).get(p.R.orcid);
    x.score = Math.max(x.score, p.conf || 0); x.validated ||= p.validated; if (!x.areas.includes(l)) x.areas.push(l);
  }
  return [...seen.values()].sort((a, b) => (personType(a.R) === "docente" ? 0 : 1) - (personType(b.R) === "docente" ? 0 : 1)
    || (b.validated ? 1 : 0) - (a.validated ? 1 : 0) || b.areas.length - a.areas.length || b.score - a.score);
}

async function openOutreach(call, areas){
  document.querySelector(".modal-back")?.remove();
  const cands = outreachCandidates(call, areas);
  const sel = new Set(cands.filter(x => personType(x.R) === "docente").slice(0, 10).map(x => x.R.orcid));
  const S = { sig: { name: "", title: "", office: "", email: "", phone: "", ...sigGet() }, bcc: false, others: false, dirty: false, detail: null };
  const back = document.createElement("div"); back.className = "modal-back";
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Preparar correo">
    <div class="modal-head"><div><div class="crumbs">Preparar correo</div><h2>${esc(call.title)}</h2><p class="note">${esc(call.agency)} · ${esc(call.number)} · fecha límite ${esc(call.closeDate || "no indicada")}</p></div>
      <button class="btn ghost" id="omClose" aria-label="Cerrar">✕</button></div>
    <div class="modal-body">
      <h3>1. Equipo sugerido <span class="note">(${fmt(cands.length)} con capacidad en ${esc((call.areas || []).join(", "))})</span></h3>
      <label class="note"><input type="checkbox" id="omOthers"> Mostrar también «Otros por verificar»</label>
      <div id="omPeople" class="om-people"></div>
      <h3>2. Destinatarios</h3>
      <div class="row"><input type="text" id="omTo" readonly class="mono" style="flex:1;min-width:240px"><button class="primary" id="omCopyTo">Copiar correos</button></div>
      <p class="note" id="omToNote"></p>
      <label class="note"><input type="checkbox" id="omBcc"> Al abrir en Gmail o en la app de correo, poner los destinatarios en CCO (no se ven entre sí)</label>
      <h3>3. Mensaje</h3>
      <details class="om-sig"><summary class="note">Tu firma (se guarda en este navegador)</summary>
        <div class="fields om-sig-fields">${[["name","Nombre"],["title","Cargo"],["office","Oficina / unidad"],["email","Correo"],["phone","Teléfono"]].map(([k, l]) => `<label class="note">${l}<input type="text" data-sig="${k}" value="${esc(S.sig[k] || "")}"></label>`).join("")}</div></details>
      <label class="note">Asunto<input type="text" id="omSubject" style="width:100%"></label>
      <label class="note">Mensaje <span id="omDetailSt"></span><textarea id="omBody" rows="16" style="width:100%"></textarea></label>
      <div class="row" style="margin-top:8px"><button id="omCopySub">Copiar asunto</button><button id="omCopyBody">Copiar mensaje</button><button id="omRegen" title="Vuelve a generar el mensaje con la selección actual">Regenerar mensaje</button>
        <span style="flex:1"></span><a class="btn" id="omMailto" target="_blank" rel="noopener">Abrir en la app de correo</a><a class="btn gold" id="omGmail" target="_blank" rel="noopener">Abrir en Gmail</a></div>
      <p class="note" id="omSt"></p>
    </div></div>`;
  document.body.appendChild(back);
  const $m = id => back.querySelector("#" + id), close = () => { back.remove(); document.removeEventListener("keydown", esc_); };
  const esc_ = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", esc_);
  $m("omClose").onclick = close; back.addEventListener("click", e => { if (e.target === back) close(); });

  const chosen = () => cands.filter(x => sel.has(x.R.orcid));
  const drawPeople = () => {
    const list = cands.filter(x => S.others || personType(x.R) === "docente" || sel.has(x.R.orcid));
    $m("omPeople").innerHTML = !list.length ? `<p class="note">No hay docentes con capacidad en estas áreas${cands.length ? "; marca «Mostrar también Otros»" : ""}.</p>`
      : list.map(x => { const em = emailsOf(x.R);
        return `<label class="om-p"><input type="checkbox" data-o="${esc(x.R.orcid)}" ${sel.has(x.R.orcid) ? "checked" : ""}>
          <span><b>${esc(fullName(x.R))}</b> <small>${esc(x.R.affiliation.campus)}${personType(x.R) === "otro" ? " · por verificar" : ""}${x.validated ? " · ✓ fondos previos en el área" : ""}</small><br>
          ${em.length ? `<small>${em.map(esc).join(", ")}</small>` : `<small class="warn-t">sin correo</small> <input type="text" class="om-addmail" data-mo="${esc(x.R.orcid)}" placeholder="añadir correo y Enter">`}</span></label>`; }).join("");
    $m("omPeople").querySelectorAll("[data-o]").forEach(cb => cb.onchange = () => { cb.checked ? sel.add(cb.dataset.o) : sel.delete(cb.dataset.o); drawTo(); if (!S.dirty) drawBody(); });
    $m("omPeople").querySelectorAll("[data-mo]").forEach(inp => {
      inp.addEventListener("click", e => e.preventDefault());
      inp.addEventListener("keydown", async e => { if (e.key !== "Enter") return; e.preventDefault();
        const v = inp.value.trim().toLowerCase(), o = inp.dataset.mo;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){ $m("omSt").textContent = `✗ Correo inválido: ${v}`; return; }
        try { const cur = PEOPLE.notes.get(o) || {}; await PEOPLE.set(o, { emails: uniq([...(cur.emails || []), v]) }); sel.add(o); $m("omSt").textContent = "✓ Correo guardado (también queda en Seguimiento)."; drawPeople(); drawTo(); }
        catch(err){ $m("omSt").textContent = `✗ ${err.message}`; } }); });
  };
  const emails = () => uniq(chosen().flatMap(x => emailsOf(x.R).slice(0, 1)));
  const drawTo = () => {
    const ch = chosen(), em = emails(), missing = ch.filter(x => !emailsOf(x.R).length);
    $m("omTo").value = em.join("; ");
    $m("omToNote").innerHTML = `${fmt(ch.length)} seleccionado(s) · ${fmt(em.length)} correo(s)` + (missing.length ? ` · <b>sin correo:</b> ${missing.map(x => esc(fullName(x.R))).join(", ")} — <a href="#/seguimiento" id="omSeg">añadir en Seguimiento</a>` : "");
    const seg = $m("omSeg"); if (seg) seg.onclick = () => close();
    drawLinks();
  };
  const days = (() => { const d = GRANTS.date(call.closeDate); return d ? Math.ceil((d - new Date()) / 864e5) : null; })();
  const subject = () => `Oportunidad de financiamiento: ${call.title}${call.closeDate ? ` (fecha límite ${call.closeDate})` : ""}`;
  const body = () => {
    const D = S.detail || {}, ch = chosen(), sg = S.sig;
    const cnt = new Map(); for (const x of ch) for (const a of x.areas) cnt.set(a, (cnt.get(a) || 0) + 1);
    const ar = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    const areasTxt = (ar.length ? ar : (call.areas || []).slice(0, 3)).join(", ").replace(/, ([^,]*)$/, " y $1");
    const greet = ch.length === 1 ? `Estimado(a) ${fullName(ch[0].R)}:` : "Estimados colegas:";
    const lines = [greet, "",
      `Les comparto una oportunidad de financiamiento que se alinea con su experiencia en ${areasTxt}.`, "",
      call.title, `Agencia: ${call.agency}`, `Número: ${call.number}`,
      `Estado: ${call.status === "forecasted" ? "Anunciada (pronóstico; aún no abre)" : "Abierta"}${call.openDate ? `, publicada el ${call.openDate}` : ""}`,
      `Fecha límite: ${call.closeDate ? `${call.closeDate}${days !== null && days >= 0 ? ` (en ${days} días)` : ""}` : "no indicada; verifique en el anuncio"}`];
    if (D.ceiling) lines.push(`Monto máximo por propuesta: $${Number(D.ceiling).toLocaleString("en-US")}${D.floor && D.floor > 1 ? ` (mínimo $${Number(D.floor).toLocaleString("en-US")})` : ""}`);
    if (D.costSharing === true) lines.push("Requiere pareo de fondos (cost sharing).");
    if (D.elig) lines.push(`Elegibilidad: ${D.elig}${D.elig.length >= 350 ? "…" : ""}`);
    if (D.desc) lines.push("", `Resumen: ${D.desc}${D.desc.length >= 900 ? "…" : ""}`);
    lines.push("", `Anuncio completo: ${GRANTS.url(call)}`, "",
      "Les identificamos, a partir de sus publicaciones y proyectos, como investigadores con capacidad en esta área. Si les interesa someter, con gusto les apoyamos en la planificación, la preparación del presupuesto y los documentos institucionales, la revisión de la propuesta y la coordinación de un equipo entre recintos.", "",
      "Si desean conversar, respondan a este correo y coordinamos una reunión.", "",
      "Saludos cordiales,", "", ...[sg.name, sg.title, sg.office, [sg.email, sg.phone].filter(Boolean).join(" · ")].filter(Boolean));
    return lines.join("\n");
  };
  const drawBody = () => { $m("omBody").value = body(); drawLinks(); };
  const drawLinks = () => {
    const to = emails().join(","), su = $m("omSubject").value, bd = $m("omBody").value, bcc = S.bcc;
    const gm = new URLSearchParams({ view: "cm", fs: "1", [bcc ? "bcc" : "to"]: to, su, body: bd });
    $m("omGmail").href = `https://mail.google.com/mail/?${gm.toString()}`;
    const mt = `mailto:${bcc ? "" : encodeURIComponent(to).replace(/%2C/g, ",").replace(/%40/g, "@")}?${bcc ? `bcc=${encodeURIComponent(to)}&` : ""}subject=${encodeURIComponent(su)}&body=${encodeURIComponent(bd)}`;
    $m("omMailto").href = mt;
    $m("omSt").textContent = mt.length > 1900 ? "Nota: el mensaje es largo; algunas apps de correo recortan los enlaces «mailto». Si se corta, usa «Copiar mensaje» o «Abrir en Gmail»." : "";
  };
  const copy = async (txt, what) => { try { await navigator.clipboard.writeText(txt); $m("omSt").textContent = `✓ ${what} copiado.`; } catch { prompt(`Copia ${what}:`, txt); } };

  $m("omSubject").value = subject();
  $m("omOthers").onchange = e => { S.others = e.target.checked; drawPeople(); };
  $m("omBcc").onchange = e => { S.bcc = e.target.checked; drawLinks(); };
  $m("omCopyTo").onclick = () => copy($m("omTo").value, "Los correos");
  $m("omCopySub").onclick = () => copy($m("omSubject").value, "El asunto");
  $m("omCopyBody").onclick = () => copy($m("omBody").value, "El mensaje");
  $m("omRegen").onclick = () => { S.dirty = false; drawBody(); };
  $m("omBody").addEventListener("input", () => { S.dirty = true; drawLinks(); });
  $m("omSubject").addEventListener("input", drawLinks);
  back.querySelectorAll("[data-sig]").forEach(i => i.addEventListener("input", () => { S.sig[i.dataset.sig] = i.value; sigSet(S.sig); if (!S.dirty) drawBody(); }));
  drawPeople(); drawTo(); drawBody();
  $m("omDetailSt").textContent = "· buscando detalles en Grants.gov…";
  try { S.detail = await GRANTS.detail(call.id); $m("omDetailSt").textContent = ""; if (!S.dirty && document.body.contains(back)) drawBody(); }
  catch(e){ $m("omDetailSt").textContent = "· no se pudieron traer los detalles; el mensaje incluye el enlace al anuncio."; }
}
