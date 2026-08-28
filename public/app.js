const API = "/api";
const state = { user: null, role: null, agentName: "", dossiers: [], requisitions: [], users: [], activeDossierId: null, editing: null, previewMode: false, watchId: null, tickInterval: null, newRequisition: null, managingUsers: false };

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
function fmtDuration(ms) {
  if (!ms || ms < 0) return "0 min";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${s} s` : `${s} s`;
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function api(path, opts) {
  const res = await fetch(API + path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401 && path !== "/login") {
    state.user = null; state.role = null; state.agentName = "";
    render();
    throw new Error("Session expirée, veuillez vous reconnecter.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
    throw new Error(err.error || "Erreur serveur");
  }
  return res.json();
}
async function loadAll() {
  state.requisitions = await api("/requisitions");
  state.dossiers = await api("/dossiers");
}
async function saveDossier(d) {
  const saved = await api("/dossiers", { method: "POST", body: JSON.stringify(d) });
  const idx = state.dossiers.findIndex((x) => x.id === saved.id);
  if (idx >= 0) state.dossiers[idx] = saved; else state.dossiers.push(saved);
  return saved;
}

function emptyRequisition() {
  return { referenceDossier: "", clientNom: "", clientTelephone: "", clientEmail: "", mandantType: "Banque", mandantNom: "", mandantTelephone: "", siteIndicatif: "", instructionsExpert: "" };
}
function emptyDossier(req) {
  return {
    requisitionId: req ? req.id : null, agentName: state.agentName, dateVisite: new Date().toISOString().slice(0, 10),
    numeroRapport: "", nomSite: req ? req.siteIndicatif : "",
    typeMission: req && req.mandantType === "Banque" ? "Garantie bancaire" : "Autre",
    demandeur: req ? (req.mandantNom || req.clientNom) : "", clientNom: req ? req.clientNom : "", clientTelephone: req ? req.clientTelephone : "",
    mandantType: req ? req.mandantType : "", mandantNom: req ? req.mandantNom : "", referenceDossier: req ? req.referenceDossier : "",
    equipe: [{ role: "Chef de mission", nom: state.agentName }], moyenDeplacement: "Véhicule",
    indicateurType: "Personne désignée par le client", indicateurNom: "", indicateurPrenom: "", indicateurTelephone: "",
    commune: "", quartier: "", cercle: "", region: "", bamakoDistrict: "", adresse: "",
    lat: null, lon: null, utm: null,
    typeTitre: "Titre Foncier", numeroTitre: "", numeroRequisitionCadastrale: "", titulaire: "",
    natureParcelle: [], etatTerrain: [], vrd: [], difficultesRencontrees: "",
    longueurParcelle: "", largeurParcelle: "",
    gpsAngles: { P1: null, P2: null, P3: null, P4: null, Centre: null },
    pieces: [], annexes: { fosseSeptiqueQte: "", lavoirM2: "", paveBetonM2: "", dalleBetonM2: "", devanture: "", clotureHauteurMl: "", regardsQte: "" },
    typeBien: "Terrain bâti", superficie: "", description: "", observationsAgent: "", photos: [],
    heureDebutMission: nowISO(), heureArriveeSite: null, heureFinMission: null,
    trackingPoints: [], distanceParcourue: 0,
    statut: "brouillon", expertNotes: "", prixReference: "", methodeEvaluation: "", conclusion: "",
    dateEnvoi: null, dernierModifiePar: state.agentName,
  };
}

function field(label, id, value, opts = {}) {
  const tag = opts.textarea ? "textarea" : "input";
  const type = opts.type || "text";
  const rows = opts.textarea ? 'rows="3"' : "";
  let tagHtml = "";
  if (opts.required) tagHtml = ' <span class="required">*</span>';
  else if (opts.showOptional) tagHtml = ' <span class="optional">(facultatif)</span>';
  const val = esc(value);
  const input = opts.select
    ? `<select id="${id}">${opts.select.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
    : tag === "textarea"
    ? `<textarea id="${id}" ${rows}>${val}</textarea>`
    : `<input id="${id}" type="${type}" value="${val}" />`;
  return `<label class="field"><span class="field-label">${label}${tagHtml}</span>${input}</label>`;
}
function checkboxGroup(label, cls, options, selected = []) {
  return `<div class="field"><span class="field-label">${label}</span><div class="checkbox-group">
    ${options.map((o) => `<label class="checkbox-pill"><input type="checkbox" class="${cls}" value="${o}" ${selected.includes(o) ? "checked" : ""}/>${o}</label>`).join("")}
  </div></div>`;
}
const collectChecked = (cls) => Array.from(document.querySelectorAll("." + cls + ":checked")).map((el) => el.value);

function statusBadge(statut) {
  const map = {
    brouillon: ["Brouillon", "badge-muted"], envoye: ["Envoyé", "badge-accent"],
    en_traitement: ["En traitement", "badge-warn"], rapport_genere: ["Rapport généré", "badge-ok"],
    en_attente: ["En attente d'agent", "badge-warn"], visitee: ["Visite effectuée", "badge-ok"],
  };
  const [label, cls] = map[statut] || map.brouillon;
  return `<span class="badge ${cls}">${label}</span>`;
}

// ---------------- Screens ----------------
function screenLogin() {
  return `<div style="max-width:360px;margin:2rem auto">
    <h1 style="font-size:20px;margin-bottom:4px;text-align:center">IQRA Expertise</h1>
    <div class="muted" style="margin-bottom:24px;text-align:center">Application unique — collecte terrain et traitement expert</div>
    ${field("Identifiant", "login-username", "", { required: true })}
    <label class="field"><span class="field-label">Mot de passe <span class="required">*</span></span><input id="login-password" type="password" /></label>
    <div id="login-error" class="error-text" style="display:none"></div>
    <button class="accent" id="btn-login" style="width:100%;margin-top:8px">Se connecter</button>
  </div>`;
}

function screenRequisitionForm(r) {
  return `<div>
    <button id="btn-cancel-req" style="margin-bottom:1rem">← Retour</button>
    <h2 style="font-size:17px;margin-bottom:4px">Réquisition à Expert (Ordre de mission)</h2>
    <div class="muted" style="margin-bottom:16px">Déclenche la mission de l'agent. Seuls le site et un contact (client ou mandant) sont obligatoires.</div>
    ${field("Référence du dossier", "r-referenceDossier", r.referenceDossier, { showOptional: true })}
    <div class="section-title">Client</div>
    ${field("Nom du client", "r-clientNom", r.clientNom, { showOptional: true })}
    ${field("Téléphone du client", "r-clientTelephone", r.clientTelephone, { showOptional: true })}
    ${field("Email du client", "r-clientEmail", r.clientEmail, { showOptional: true })}
    <div class="section-title">Mandant</div>
    ${field("Type de mandant", "r-mandantType", r.mandantType, { select: ["Banque", "Particulier", "Institution", "Autre"] })}
    ${field("Nom du mandant", "r-mandantNom", r.mandantNom, { showOptional: true })}
    ${field("Téléphone du mandant", "r-mandantTelephone", r.mandantTelephone, { showOptional: true })}
    <div class="section-title">Mission</div>
    ${field("Site à visiter (commune / quartier)", "r-siteIndicatif", r.siteIndicatif, { required: true })}
    ${field("Instructions pour l'agent", "r-instructionsExpert", r.instructionsExpert, { textarea: true, showOptional: true })}
    <div id="req-error" class="error-text" style="display:none"></div>
    <button class="accent" id="btn-send-requisition">Émettre la réquisition</button>
  </div>`;
}
function collectRequisitionForm(base) {
  const g = (id) => document.getElementById(id).value;
  return { ...base, referenceDossier: g("r-referenceDossier"), clientNom: g("r-clientNom"), clientTelephone: g("r-clientTelephone"), clientEmail: g("r-clientEmail"), mandantType: g("r-mandantType"), mandantNom: g("r-mandantNom"), mandantTelephone: g("r-mandantTelephone"), siteIndicatif: g("r-siteIndicatif"), instructionsExpert: g("r-instructionsExpert") };
}

function screenAgentHome() {
  const pending = state.requisitions.filter((r) => r.statut === "en_attente");
  const mine = state.dossiers.filter((d) => d.agentName === state.agentName);
  return `<div>
    <div class="row-between" style="margin-bottom:20px">
      <div><div style="font-weight:600;font-size:17px">Agent : ${esc(state.agentName)}</div><div class="muted">Mode saisie terrain</div></div>
      <button id="btn-logout">Se déconnecter</button></div>
    <div class="section-title" style="margin-top:0">Réquisitions en attente (${pending.length})</div>
    ${pending.length === 0 ? '<div class="muted">Aucune réquisition en attente. L\'expert doit émettre un ordre de mission avant toute visite.</div>' : pending.map((r) => `
      <div class="list-row req-row" data-id="${r.id}"><div><div style="font-weight:600">${esc(r.siteIndicatif)}</div>
      <div class="muted">${esc(r.mandantType)} ${r.mandantNom ? "— " + esc(r.mandantNom) : ""} ${r.clientNom ? "· Client : " + esc(r.clientNom) : ""}</div></div>
      <button style="pointer-events:none">Démarrer</button></div>`).join("")}
    <div class="section-title">Mes fiches (${mine.length})</div>
    ${mine.length === 0 ? '<div class="muted">Aucune fiche pour le moment.</div>' : mine.map((d) => `
      <div class="list-row mine-row" data-id="${d.id}" style="cursor:${d.statut === "brouillon" ? "pointer" : "default"}">
      <div><div style="font-weight:600">${esc(d.numeroRapport) || "(sans n°)"} — ${esc(d.nomSite || d.commune) || "?"}</div>
      <div class="muted">${d.dateVisite} · ${d.photos.length} photo(s) · ${(d.distanceParcourue / 1000).toFixed(2)} km</div></div>
      ${statusBadge(d.statut)}</div>`).join("")}
  </div>`;
}

function photoGallery(photos) {
  const body = !photos.length ? '<div class="muted" style="margin-bottom:4px">Aucune photo pour le moment.</div>' :
    `<div class="photo-grid">${photos.map((p) => `<div class="photo-thumb"><img src="${p.url}" />
      <button class="photo-del" data-pid="${p.id}" aria-label="Supprimer">✕</button></div>`).join("")}</div>`;
  return body + '<div class="muted" style="font-style:italic;margin-bottom:8px">Images IQRA-EXPERT</div>';
}
function gpsPointRow(label, key, pt) {
  return `<div class="gps-point-row"><div>${label}${pt ? `<div class="muted">${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}</div>` : ""}</div>
    <button type="button" class="btn-cap-angle" data-key="${key}">${pt ? "Reprendre" : "Capturer"}</button></div>`;
}
function locBlock(d) {
  const hasLoc = d.lat != null;
  return `<div class="card">
    <div class="row-between" style="margin-bottom:8px"><div style="font-weight:600;font-size:13px">Position centrale du site</div>
    <button type="button" id="btn-capture-gps">${hasLoc ? "Actualiser" : "Capturer ma position"}</button></div>
    <div id="gps-error" class="error-text" style="display:none"></div>
    ${hasLoc ? `<table class="info-table">
      <tr><td>Latitude / Longitude</td><td>${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}</td></tr>
      <tr><td>UTM (WGS84)</td><td>Zone ${d.utm.zone}${d.utm.hemisphere} — E ${d.utm.easting} m, N ${d.utm.northing} m</td></tr></table>
      <a class="link" href="https://www.google.com/maps/@${d.lat},${d.lon},400m/data=!3m1!1e3" target="_blank">Voir la vue satellite (Google Maps) ↗</a>`
      : '<div class="muted">Aucune position capturée.</div>'}
  </div>`;
}
function anglesBlock(d) {
  const a = d.gpsAngles;
  return `<div class="card"><div style="font-weight:600;font-size:13px;margin-bottom:6px">Coordonnées GPS des angles de la parcelle</div>
    ${gpsPointRow("Point P1", "P1", a.P1)}${gpsPointRow("Point P2", "P2", a.P2)}${gpsPointRow("Point P3", "P3", a.P3)}${gpsPointRow("Point P4", "P4", a.P4)}${gpsPointRow("Centre", "Centre", a.Centre)}
  </div>`;
}
function piecesBlock(d) {
  const rows = d.pieces.map((p) => `<div class="piece-row" data-id="${p.id}">
    <select class="pc-niveau"><option ${p.niveau === "RDC" ? "selected" : ""}>RDC</option><option ${p.niveau === "Étage 1" ? "selected" : ""}>Étage 1</option><option ${p.niveau === "Étage 2" ? "selected" : ""}>Étage 2</option></select>
    <input class="pc-designation" placeholder="ex. Chambre 1" value="${esc(p.designation)}" />
    <input class="pc-quantite" placeholder="Qté" value="${p.quantite || ""}" />
    <input class="pc-superficie" placeholder="m²" value="${p.superficie || ""}" />
    <button type="button" class="btn-del-piece" data-pid="${p.id}" aria-label="Supprimer">✕</button></div>`).join("");
  return `<div class="card"><div style="font-weight:600;font-size:13px;margin-bottom:8px">Relevé des pièces (par niveau)</div>
    ${d.pieces.length ? `<div class="piece-header"><div>Niveau</div><div>Désignation</div><div>Qté</div><div>Superficie</div><div></div></div>` : ""}
    <div>${rows || '<div class="muted" style="margin-bottom:6px">Aucune pièce ajoutée.</div>'}</div>
    <button type="button" id="btn-add-piece">+ Ajouter une pièce</button></div>`;
}
function indicateurBlock(d) {
  return `<div class="card accent-border">
    <div style="font-weight:600;font-size:13px;margin-bottom:2px">Indicateur de terrain <span class="required">*</span></div>
    <div class="muted" style="margin-bottom:10px">Personne ayant accompagné l'agent pour montrer les limites du terrain (désignée par le client, ou géomètre). Obligatoire avant l'envoi à l'expert.</div>
    ${field("Qualité de l'indicateur", "f-indicateurType", d.indicateurType, { select: ["Personne désignée par le client", "Géomètre"] })}
    ${field("Nom", "f-indicateurNom", d.indicateurNom, { required: true })}
    ${field("Prénom", "f-indicateurPrenom", d.indicateurPrenom, { required: true })}
    ${field("Numéro de téléphone", "f-indicateurTelephone", d.indicateurTelephone, { required: true, type: "tel" })}
  </div>`;
}
function trackingBlock(d) {
  const elapsed = d.heureDebutMission ? Date.now() - new Date(d.heureDebutMission).getTime() : 0;
  return `<div class="card"><div style="font-weight:600;font-size:13px;margin-bottom:8px">Suivi de mission</div>
    <table class="info-table" style="margin-bottom:10px">
      <tr><td>Date</td><td>${d.dateVisite}</td></tr>
      <tr><td>Début de mission</td><td>${fmtTime(d.heureDebutMission)}</td></tr>
      <tr><td>Arrivée sur site</td><td>${fmtTime(d.heureArriveeSite)}</td></tr>
      <tr><td>Fin de mission</td><td>${fmtTime(d.heureFinMission)}</td></tr>
      <tr><td>Distance tracée</td><td>${(d.distanceParcourue / 1000).toFixed(2)} km (${d.trackingPoints.length} pts)</td></tr>
      <tr><td style="font-weight:600">Temps total écoulé</td><td id="temps-total-live" style="font-weight:600">${fmtDuration(elapsed)}</td></tr>
    </table>
    <div id="tracking-error" class="error-text" style="display:none"></div>
    <div class="btn-row" style="margin-top:0">
      ${!d.trackingActif ? `<button type="button" id="btn-start-tracking">Démarrer le suivi du trajet</button>` : `<button type="button" id="btn-stop-tracking">Arrêter le suivi</button>`}
      <button type="button" id="btn-mark-arrival" ${d.heureArriveeSite ? "disabled" : ""}>Marquer arrivée sur site</button>
    </div></div>`;
}

function screenFicheForm(d) {
  return `<div id="fiche-form-wrap">
    <button id="btn-cancel-fiche" style="margin-bottom:1rem">← Retour</button>
    <h2 style="font-size:17px;margin-bottom:2px">Mission de terrain</h2>
    <div class="muted" style="margin-bottom:16px">Réquisition liée : ${esc(d.mandantType) || "—"} ${d.mandantNom ? "— " + esc(d.mandantNom) : ""} ${d.clientNom ? "· Client " + esc(d.clientNom) : ""}</div>

    ${trackingBlock(d)}

    <div class="section-title" style="margin-top:16px">Identification du rapport</div>
    ${field("N° du rapport de visite", "f-numeroRapport", d.numeroRapport)}
    ${field("Nom du site", "f-nomSite", d.nomSite)}
    ${field("Référence dossier", "f-referenceDossier", d.referenceDossier)}
    ${field("Date de visite", "f-dateVisite", d.dateVisite, { type: "date" })}
    ${field("Moyen de déplacement", "f-moyenDeplacement", d.moyenDeplacement, { select: ["Motocycle", "Véhicule"] })}
    ${field("Membres de l'équipe (outre le chef de mission)", "f-equipeAutres", (d.equipe || []).slice(1).map((e) => e.nom).join(", "), { showOptional: true })}

    ${indicateurBlock(d)}

    <div class="section-title">Relevés de terrain</div>
    ${field("Commune", "f-commune", d.commune)}
    ${field("Quartier / Localité", "f-quartier", d.quartier)}
    ${field("Cercle", "f-cercle", d.cercle, { showOptional: true })}
    ${field("Région", "f-region", d.region, { showOptional: true })}
    ${field("Bamako District (si applicable)", "f-bamakoDistrict", d.bamakoDistrict, { showOptional: true })}
    ${field("Adresse / repère", "f-adresse", d.adresse)}
    ${locBlock(d)}
    ${anglesBlock(d)}
    ${field("Longueur de la parcelle (m)", "f-longueurParcelle", d.longueurParcelle, { showOptional: true })}
    ${field("Largeur de la parcelle (m)", "f-largeurParcelle", d.largeurParcelle, { showOptional: true })}

    <div class="section-title">Photos prises sur le site</div>
    ${photoGallery(d.photos)}
    <input type="file" id="f-photo-input" accept="image/*" capture="environment" style="display:none" />
    <button type="button" id="btn-take-photo" style="margin-bottom:16px">📷 Prendre une photo</button>

    <div class="section-title">Identification de la parcelle</div>
    ${field("Type de titre", "f-typeTitre", d.typeTitre, { select: ["Titre Foncier (TF)", "Permis d'Occuper (PO)", "Titre Provisoire de Vente (TPV)", "Lettre d'Attribution (LA)", "Non titré"] })}
    ${field("Numéro du titre", "f-numeroTitre", d.numeroTitre, { showOptional: true })}
    ${field("N° de réquisition cadastrale (immatriculation, si applicable)", "f-numeroRequisitionCadastrale", d.numeroRequisitionCadastrale, { showOptional: true })}
    ${field("Titulaire (nom sur le titre)", "f-titulaire", d.titulaire, { showOptional: true })}

    ${checkboxGroup("Nature de la parcelle", "cb-nature", ["Habitation", "Champ", "Usine", "Ferme Agro"], d.natureParcelle)}
    ${checkboxGroup("État du terrain", "cb-etat", ["Bâtie", "Vide", "Terrain bâti", "Incendié", "Effondré", "Plat", "Accidenté", "Rocheux", "Inondé"], d.etatTerrain)}
    ${checkboxGroup("Voirie et réseaux divers (VRD)", "cb-vrd", ["Piste", "Goudron", "Pavé", "Collecteur", "Caniveau", "EDM", "SOMAGEP", "Forage"], d.vrd)}
    ${field("Difficultés rencontrées sur le site", "f-difficultesRencontrees", d.difficultesRencontrees, { textarea: true, showOptional: true })}

    ${piecesBlock(d)}

    <div class="section-title">Annexes et cours</div>
    ${field("Fosse septique (quantité)", "f-fosseSeptiqueQte", d.annexes.fosseSeptiqueQte, { showOptional: true })}
    ${field("Lavoir (m²)", "f-lavoirM2", d.annexes.lavoirM2, { showOptional: true })}
    ${field("Pavé de béton (m²)", "f-paveBetonM2", d.annexes.paveBetonM2, { showOptional: true })}
    ${field("Dalle de béton (m²)", "f-dalleBetonM2", d.annexes.dalleBetonM2, { showOptional: true })}
    ${field("Devanture", "f-devanture", d.annexes.devanture, { showOptional: true })}
    ${field("Clôture — hauteur (ml)", "f-clotureHauteurMl", d.annexes.clotureHauteurMl, { showOptional: true })}
    ${field("Regards (quantité)", "f-regardsQte", d.annexes.regardsQte, { showOptional: true })}

    <div class="section-title">Description générale</div>
    ${field("Type de bien", "f-typeBien", d.typeBien, { select: ["Terrain nu", "Terrain bâti", "Appartement", "Local commercial"] })}
    ${field("Superficie totale (m²)", "f-superficie", d.superficie, { showOptional: true })}
    ${field("Description (construction, matériaux, état)", "f-description", d.description, { textarea: true, showOptional: true })}
    ${field("Observations de l'agent", "f-observationsAgent", d.observationsAgent, { textarea: true, showOptional: true })}

    <div id="fiche-error" class="error-text" style="display:none"></div>
    <div class="btn-row">
      <button id="btn-save-draft">Enregistrer brouillon</button>
      <button type="button" id="btn-mark-end" ${d.heureFinMission ? "disabled" : ""}>Confirmer fin de mission</button>
      <button class="accent" id="btn-preview" ${!d.heureFinMission ? "disabled" : ""}>📄 Aperçu avant envoi</button>
    </div>
    ${!d.heureFinMission ? '<div class="muted" style="margin-top:6px">Confirmez la fin de mission pour débloquer l\'aperçu et l\'envoi.</div>' : ""}
  </div>`;
}

function collectFicheForm(base) {
  const g = (id) => document.getElementById(id).value;
  const equipeAutres = (g("f-equipeAutres") || "").split(",").map((s) => s.trim()).filter(Boolean).map((nom) => ({ role: "Agent", nom }));
  return {
    ...base,
    numeroRapport: g("f-numeroRapport"), nomSite: g("f-nomSite"), referenceDossier: g("f-referenceDossier"),
    dateVisite: g("f-dateVisite"), moyenDeplacement: g("f-moyenDeplacement"),
    equipe: [{ role: "Chef de mission", nom: state.agentName }, ...equipeAutres],
    indicateurType: g("f-indicateurType"), indicateurNom: g("f-indicateurNom"), indicateurPrenom: g("f-indicateurPrenom"), indicateurTelephone: g("f-indicateurTelephone"),
    commune: g("f-commune"), quartier: g("f-quartier"), cercle: g("f-cercle"), region: g("f-region"), bamakoDistrict: g("f-bamakoDistrict"), adresse: g("f-adresse"),
    longueurParcelle: g("f-longueurParcelle"), largeurParcelle: g("f-largeurParcelle"),
    typeTitre: g("f-typeTitre"), numeroTitre: g("f-numeroTitre"), numeroRequisitionCadastrale: g("f-numeroRequisitionCadastrale"), titulaire: g("f-titulaire"),
    natureParcelle: collectChecked("cb-nature"), etatTerrain: collectChecked("cb-etat"), vrd: collectChecked("cb-vrd"),
    difficultesRencontrees: g("f-difficultesRencontrees"),
    annexes: { fosseSeptiqueQte: g("f-fosseSeptiqueQte"), lavoirM2: g("f-lavoirM2"), paveBetonM2: g("f-paveBetonM2"), dalleBetonM2: g("f-dalleBetonM2"), devanture: g("f-devanture"), clotureHauteurMl: g("f-clotureHauteurMl"), regardsQte: g("f-regardsQte") },
    typeBien: g("f-typeBien"), superficie: g("f-superficie"), description: g("f-description"), observationsAgent: g("f-observationsAgent"),
  };
}

function previewHTML(d, mode) {
  const title = mode === "agent" ? "Aperçu de la fiche (avant envoi)" : "Aperçu du rapport";
  const pieces = d.pieces.length ? `<table class="info-table" style="margin-top:6px"><tr class="muted"><td>Niveau</td><td>Désignation</td><td>Qté</td><td>m²</td></tr>${d.pieces.map((p) => `<tr><td>${esc(p.niveau)}</td><td>${esc(p.designation)}</td><td>${esc(p.quantite)}</td><td>${esc(p.superficie)}</td></tr>`).join("")}</table>` : "";
  return `<div id="printable-preview" class="card" style="padding:20px">
    <div style="font-weight:600;font-size:15px;margin-bottom:2px">${title}</div>
    <div class="muted" style="margin-bottom:16px">N° ${esc(d.numeroRapport) || "—"} · ${esc(d.nomSite || d.commune) || "—"}</div>
    <table class="info-table">
      <tr><td>Mandant / Client</td><td>${esc(d.mandantType) || "—"} ${esc(d.mandantNom)} ${d.clientNom ? "· " + esc(d.clientNom) : ""}</td></tr>
      <tr><td>Équipe</td><td>${esc((d.equipe || []).map((e) => e.nom).filter(Boolean).join(", ")) || "—"}</td></tr>
      <tr><td>Indicateur de terrain</td><td>${d.indicateurNom ? `${esc(d.indicateurNom)} ${esc(d.indicateurPrenom)} — ${esc(d.indicateurTelephone)} (${esc(d.indicateurType)})` : "—"}</td></tr>
      <tr><td>Localisation</td><td>${esc(d.quartier)}, ${esc(d.commune) || "—"} (${esc(d.cercle) || "—"}, ${esc(d.region) || "—"})</td></tr>
      <tr><td>Coordonnées UTM</td><td>${d.utm ? `Zone ${d.utm.zone}${d.utm.hemisphere} — E ${d.utm.easting}, N ${d.utm.northing}` : "—"}</td></tr>
      <tr><td>Titre</td><td>${esc(d.typeTitre) || "—"} n°${esc(d.numeroTitre) || "—"}</td></tr>
      <tr><td>Nature / État / VRD</td><td>${esc([...d.natureParcelle, ...d.etatTerrain, ...d.vrd].join(", ")) || "—"}</td></tr>
      <tr><td>Dimensions parcelle</td><td>${esc(d.longueurParcelle) || "—"} m × ${esc(d.largeurParcelle) || "—"} m</td></tr>
      <tr><td>Début / arrivée / fin</td><td>${fmtTime(d.heureDebutMission)} · ${fmtTime(d.heureArriveeSite)} · ${fmtTime(d.heureFinMission)}</td></tr>
      <tr><td>Distance tracée</td><td>${(d.distanceParcourue / 1000).toFixed(2)} km</td></tr>
      <tr><td>Photos jointes</td><td>${d.photos.length}</td></tr>
      ${mode === "expert" ? `<tr><td colspan="2" style="padding-top:10px;font-weight:600">Traitement expert</td></tr>
      <tr><td>Prix de référence</td><td>${esc(d.prixReference) || "—"} FCFA/m²</td></tr>
      <tr><td>Méthode</td><td>${esc(d.methodeEvaluation) || "—"}</td></tr>
      <tr><td>Conclusion</td><td>${esc(d.conclusion) || "—"}</td></tr>` : ""}
    </table>${pieces}
    ${d.photos.length ? `<div class="photo-grid" style="margin-top:10px">${d.photos.map((p) => `<img src="${p.url}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px" />`).join("")}</div><div class="muted" style="font-style:italic;margin-top:4px">Images IQRA-EXPERT</div>` : ""}
  </div>`;
}
function screenPreview(d) {
  return `<div><h2 style="font-size:17px;margin-bottom:16px">Aperçu avant envoi</h2>${previewHTML(d, "agent")}
    <div class="btn-row">
      <button id="btn-back-to-edit">✎ Corriger des informations</button>
      <button id="btn-print-pdf">⬇ Enregistrer en PDF</button>
      <button class="accent" id="btn-confirm-send">Confirmer l'envoi à l'expert</button>
    </div></div>`;
}

function screenExpertHome() {
  const counts = { envoye: state.dossiers.filter((d) => d.statut === "envoye").length, en_traitement: state.dossiers.filter((d) => d.statut === "en_traitement").length, rapport_genere: state.dossiers.filter((d) => d.statut === "rapport_genere").length };
  const visible = state.dossiers.filter((d) => d.statut !== "brouillon");
  const reqPending = state.requisitions.filter((r) => r.statut === "en_attente").length;
  return `<div>
    <div class="row-between" style="margin-bottom:20px">
      <div><div style="font-weight:600;font-size:17px">Espace expert</div><div class="muted">Réquisitions et dossiers reçus</div></div>
      <div style="display:flex;gap:8px"><button id="btn-manage-users">Gérer les agents</button><button id="btn-logout">Se déconnecter</button></div></div>
    <button class="accent" id="btn-new-requisition" style="margin-bottom:20px">+ Nouvelle réquisition à expert</button>
    <div class="metrics">
      <div class="metric-card"><div class="label">Réq. en attente</div><div class="value">${reqPending}</div></div>
      <div class="metric-card"><div class="label">Nouveaux</div><div class="value">${counts.envoye}</div></div>
      <div class="metric-card"><div class="label">En traitement</div><div class="value">${counts.en_traitement}</div></div>
      <div class="metric-card"><div class="label">Rapports générés</div><div class="value">${counts.rapport_genere}</div></div>
    </div>
    <div class="section-title" style="margin-top:0">Dossiers reçus des agents</div>
    ${visible.length === 0 ? '<div class="muted">Aucun dossier reçu pour le moment.</div>' : visible.map((d) => `
      <div class="list-row dossier-row" data-id="${d.id}"><div><div style="font-weight:600">N° ${esc(d.numeroRapport) || "—"} — ${esc(d.nomSite || d.commune) || "?"}</div>
      <div class="muted">Agent : ${esc(d.agentName)} · Indicateur : ${esc(d.indicateurNom) || "—"} · ${d.photos.length} photo(s)</div></div>
      ${statusBadge(d.statut)}</div>`).join("")}
  </div>`;
}

function screenManageUsers() {
  return `<div>
    <button id="btn-back-users" style="margin-bottom:1rem">← Retour</button>
    <h2 style="font-size:17px;margin-bottom:16px">Gérer les comptes agents</h2>
    <div class="card">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">Nouveau compte agent</div>
      ${field("Identifiant de connexion", "nu-username", "", { required: true })}
      ${field("Nom affiché", "nu-displayName", "", { showOptional: true })}
      <label class="field"><span class="field-label">Mot de passe temporaire <span class="required">*</span></span><input id="nu-password" type="text" placeholder="6 caractères minimum" /></label>
      <div id="nu-error" class="error-text" style="display:none"></div>
      <button class="accent" id="btn-create-user">Créer le compte</button>
    </div>
    <div class="section-title">Comptes agents existants (${state.users.filter((u) => u.role === "agent").length})</div>
    ${state.users.filter((u) => u.role === "agent").length === 0 ? '<div class="muted">Aucun agent créé pour le moment.</div>' : state.users.filter((u) => u.role === "agent").map((u) => `
      <div class="list-row" data-id="${u.id}"><div><div style="font-weight:600">${esc(u.displayName)}</div>
      <div class="muted">Identifiant : ${esc(u.username)}</div></div>
      <button type="button" class="btn-toggle-user" data-id="${u.id}" data-active="${u.active}">${u.active ? "Désactiver" : "Réactiver"}</button></div>`).join("")}
  </div>`;
}

function screenExpertDetail(d) {
  return `<div>
    <button id="btn-back-expert" style="margin-bottom:1rem">← Retour à la liste</button>
    <div class="row-between" style="margin-bottom:10px"><div style="font-weight:600;font-size:17px">N° ${esc(d.numeroRapport) || "—"} — ${esc(d.nomSite)}</div>${statusBadge(d.statut)}</div>
    <div class="muted" style="margin-bottom:16px">Toutes les informations restent modifiables par l'expert après réception.</div>
    ${previewHTML(d, "agent")}
    <div class="section-title">Traitement de l'expert</div>
    ${field("Notes d'analyse", "e-expertNotes", d.expertNotes, { textarea: true, showOptional: true })}
    ${field("Prix de référence retenu (FCFA/m²)", "e-prixReference", d.prixReference, { showOptional: true })}
    <button type="button" id="btn-prix-reference" style="margin-bottom:16px">Consulter les prix de référence (dossiers similaires)</button>
    <div id="prix-reference-result" style="margin-bottom:16px"></div>
    ${field("Méthode d'évaluation", "e-methodeEvaluation", d.methodeEvaluation, { showOptional: true })}
    ${field("Conclusion", "e-conclusion", d.conclusion, { textarea: true, showOptional: true })}
    <div class="btn-row">
      <button id="btn-save-expert">Enregistrer les modifications</button>
      <button class="accent" id="btn-generate-report">Générer le rapport</button>
    </div>
    <div id="report-preview" style="margin-top:20px"></div></div>`;
}
function collectExpertForm(base) {
  const g = (id) => document.getElementById(id).value;
  return { ...base, expertNotes: g("e-expertNotes"), prixReference: g("e-prixReference"), methodeEvaluation: g("e-methodeEvaluation"), conclusion: g("e-conclusion"), dernierModifiePar: "Expert" };
}

function printPreview() {
  const node = document.getElementById("printable-preview");
  if (!node) return;
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>Aperçu fiche</title><style>body{font-family:sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 0;vertical-align:top}td:first-child{color:#666;width:40%}img{border-radius:6px}</style></head><body>${node.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
function stopTracking() {
  if (state.watchId != null && navigator.geolocation) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
  if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
}

// ---------------- Event wiring ----------------
function attachFicheHandlers(d) {
  document.getElementById("btn-cancel-fiche").onclick = () => { stopTracking(); state.editing = null; render(); };

  document.getElementById("btn-capture-gps").onclick = () => {
    const nd = collectFicheForm(d);
    const err = document.getElementById("gps-error");
    err.style.display = "none";
    if (!navigator.geolocation) { err.textContent = "Géolocalisation non disponible sur cet appareil/navigateur."; err.style.display = "block"; return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { nd.lat = pos.coords.latitude; nd.lon = pos.coords.longitude; state.editing = nd; render(); },
      (e) => { err.textContent = "Position indisponible (" + e.message + "). Vérifiez l'autorisation de localisation."; err.style.display = "block"; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };
  document.querySelectorAll(".btn-cap-angle").forEach((btn) => {
    btn.onclick = () => {
      const nd = collectFicheForm(d);
      const key = btn.getAttribute("data-key");
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => { nd.gpsAngles[key] = { lat: pos.coords.latitude, lon: pos.coords.longitude }; state.editing = nd; render(); }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
    };
  });
  document.getElementById("btn-add-piece").onclick = () => {
    const nd = collectFicheForm(d);
    nd.pieces.push({ id: uid(), niveau: "RDC", designation: "", quantite: "1", superficie: "" });
    state.editing = nd; render();
  };
  document.querySelectorAll(".btn-del-piece").forEach((btn) => {
    btn.onclick = () => { const nd = collectFicheForm(d); nd.pieces = nd.pieces.filter((p) => p.id !== btn.getAttribute("data-pid")); state.editing = nd; render(); };
  });
  document.querySelectorAll(".piece-row").forEach((row) => {
    const p = d.pieces.find((x) => x.id === row.getAttribute("data-id"));
    if (!p) return;
    row.querySelector(".pc-niveau").onchange = (e) => (p.niveau = e.target.value);
    row.querySelector(".pc-designation").oninput = (e) => (p.designation = e.target.value);
    row.querySelector(".pc-quantite").oninput = (e) => (p.quantite = e.target.value);
    row.querySelector(".pc-superficie").oninput = (e) => (p.superficie = e.target.value);
  });

  document.getElementById("btn-take-photo").onclick = () => {
    document.getElementById("f-photo-input").click();
  };
  document.getElementById("f-photo-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let nd = collectFicheForm(d);
    if (!nd.id) nd = await saveDossier(nd);
    const fd = new FormData();
    fd.append("photo", file);
    const photo = await fetch(`${API}/dossiers/${nd.id}/photos`, { method: "POST", body: fd }).then((r) => r.json());
    nd.photos = [...nd.photos, photo];
    state.editing = nd; render();
  };
  document.querySelectorAll(".photo-del").forEach((btn) => {
    btn.onclick = async () => {
      const nd = collectFicheForm(d);
      const pid = btn.getAttribute("data-pid");
      await fetch(`${API}/photos/${pid}`, { method: "DELETE" });
      nd.photos = nd.photos.filter((p) => p.id !== pid);
      state.editing = nd; render();
    };
  });

  const startBtn = document.getElementById("btn-start-tracking");
  if (startBtn) startBtn.onclick = () => {
    const nd = collectFicheForm(d);
    const err = document.getElementById("tracking-error");
    err.style.display = "none";
    if (!navigator.geolocation) { err.textContent = "Suivi GPS non disponible."; err.style.display = "block"; return; }
    nd.trackingActif = true; state.editing = nd;
    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const pt = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: nowISO() };
        const pts = nd.trackingPoints;
        if (pts.length) nd.distanceParcourue += haversine(pts[pts.length - 1].lat, pts[pts.length - 1].lon, pt.lat, pt.lon);
        pts.push(pt);
      },
      (e) => { err.textContent = "Suivi interrompu (" + e.message + ")."; err.style.display = "block"; },
      { enableHighAccuracy: true }
    );
    render();
  };
  const stopBtn = document.getElementById("btn-stop-tracking");
  if (stopBtn) stopBtn.onclick = () => { const nd = collectFicheForm(d); stopTracking(); nd.trackingActif = false; state.editing = nd; render(); };
  document.getElementById("btn-mark-arrival").onclick = () => { const nd = collectFicheForm(d); nd.heureArriveeSite = nowISO(); state.editing = nd; render(); };
  document.getElementById("btn-mark-end").onclick = () => { const nd = collectFicheForm(d); stopTracking(); nd.trackingActif = false; nd.heureFinMission = nowISO(); state.editing = nd; render(); };

  document.getElementById("btn-save-draft").onclick = async () => {
    const nd = collectFicheForm(d); nd.statut = "brouillon";
    await saveDossier(nd);
    stopTracking(); state.editing = null; render();
  };
  const previewBtn = document.getElementById("btn-preview");
  if (previewBtn) previewBtn.onclick = () => {
    const nd = collectFicheForm(d);
    const err = document.getElementById("fiche-error");
    if (!nd.commune || !nd.numeroRapport) { err.textContent = "Renseignez au moins le n° de rapport et la commune."; err.style.display = "block"; return; }
    if (!nd.indicateurNom || !nd.indicateurPrenom || !nd.indicateurTelephone) {
      err.textContent = "L'envoi est bloqué : renseignez le nom, le prénom et le téléphone de l'indicateur de terrain avant de continuer.";
      err.style.display = "block";
      state.editing = nd; render();
      document.getElementById("f-indicateurNom").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    state.editing = nd; state.previewMode = true; render();
  };
  if (d.trackingActif && !state.tickInterval) {
    state.tickInterval = setInterval(() => {
      const el = document.getElementById("temps-total-live");
      if (el && state.editing) el.textContent = fmtDuration(Date.now() - new Date(state.editing.heureDebutMission).getTime());
    }, 1000);
  }
}

async function doLogout() {
  stopTracking();
  try { await fetch(`${API}/logout`, { method: "POST" }); } catch (e) {}
  state.user = null; state.role = null; state.agentName = "";
  state.dossiers = []; state.requisitions = []; state.users = [];
  state.editing = null; state.activeDossierId = null; state.newRequisition = null; state.managingUsers = false;
  render();
}

async function render() {
  const app = document.getElementById("app");

  if (!state.role) {
    app.innerHTML = screenLogin();
    const doLogin = async () => {
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      const err = document.getElementById("login-error");
      err.style.display = "none";
      if (!username || !password) { err.textContent = "Identifiant et mot de passe requis."; err.style.display = "block"; return; }
      try {
        const user = await api("/login", { method: "POST", body: JSON.stringify({ username, password }) });
        state.user = user; state.role = user.role; state.agentName = user.displayName;
        await loadAll();
        render();
      } catch (e) {
        err.textContent = e.message; err.style.display = "block";
      }
    };
    document.getElementById("btn-login").onclick = doLogin;
    document.getElementById("login-password").onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
    return;
  }

  if (state.role === "agent") {
    if (state.editing && state.previewMode) {
      app.innerHTML = screenPreview(state.editing);
      document.getElementById("btn-back-to-edit").onclick = () => { state.previewMode = false; render(); };
      document.getElementById("btn-print-pdf").onclick = printPreview;
      document.getElementById("btn-confirm-send").onclick = async () => {
        const d = state.editing;
        d.statut = "envoye"; d.dateEnvoi = nowISO(); d.dernierModifiePar = state.agentName;
        await saveDossier(d);
        state.editing = null; state.previewMode = false;
        await loadAll(); render();
      };
      return;
    }
    if (state.editing) { app.innerHTML = screenFicheForm(state.editing); attachFicheHandlers(state.editing); return; }
    app.innerHTML = screenAgentHome();
    document.getElementById("btn-logout").onclick = doLogout;
    document.querySelectorAll(".req-row").forEach((row) => {
      row.onclick = async () => {
        const r = state.requisitions.find((x) => x.id === row.getAttribute("data-id"));
        if (r) { state.editing = emptyDossier(r); render(); }
      };
    });
    document.querySelectorAll(".mine-row").forEach((row) => {
      row.onclick = () => {
        const d = state.dossiers.find((x) => x.id === row.getAttribute("data-id"));
        if (d && d.statut === "brouillon") { state.editing = d; render(); }
      };
    });
    return;
  }

  if (state.role === "expert") {
    if (state.managingUsers) {
      app.innerHTML = screenManageUsers();
      document.getElementById("btn-back-users").onclick = () => { state.managingUsers = false; render(); };
      document.getElementById("btn-create-user").onclick = async () => {
        const username = document.getElementById("nu-username").value.trim();
        const displayName = document.getElementById("nu-displayName").value.trim();
        const password = document.getElementById("nu-password").value;
        const err = document.getElementById("nu-error");
        err.style.display = "none";
        try {
          await api("/users", { method: "POST", body: JSON.stringify({ username, password, displayName }) });
          state.users = await api("/users");
          render();
        } catch (e) {
          err.textContent = e.message; err.style.display = "block";
        }
      };
      document.querySelectorAll(".btn-toggle-user").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id");
          const active = btn.getAttribute("data-active") === "1";
          await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ active: !active }) });
          state.users = await api("/users");
          render();
        };
      });
      return;
    }
    if (state.newRequisition) {
      app.innerHTML = screenRequisitionForm(state.newRequisition);
      document.getElementById("btn-cancel-req").onclick = () => { state.newRequisition = null; render(); };
      document.getElementById("btn-send-requisition").onclick = async () => {
        const r = collectRequisitionForm(state.newRequisition);
        const err = document.getElementById("req-error");
        try {
          await api("/requisitions", { method: "POST", body: JSON.stringify(r) });
          state.newRequisition = null;
          await loadAll(); render();
        } catch (e) {
          err.textContent = e.message; err.style.display = "block";
        }
      };
      return;
    }
    if (state.activeDossierId) {
      const d = state.dossiers.find((x) => x.id === state.activeDossierId);
      app.innerHTML = screenExpertDetail(d);
      document.getElementById("btn-back-expert").onclick = () => { state.activeDossierId = null; render(); };
      document.getElementById("btn-prix-reference").onclick = async () => {
        const box = document.getElementById("prix-reference-result");
        box.innerHTML = '<div class="muted">Recherche…</div>';
        try {
          const params = new URLSearchParams();
          if (d.commune) params.set("commune", d.commune);
          if (d.typeBien) params.set("typeBien", d.typeBien);
          const rows = await api(`/prix-reference?${params.toString()}`);
          const others = rows.filter((r) => r.id !== d.id);
          box.innerHTML = others.length === 0
            ? '<div class="muted">Aucun dossier comparable trouvé (même commune / type de bien).</div>'
            : `<div class="card">${others.map((r) => `
              <div class="list-row"><div>
                <div style="font-weight:600">${esc(r.numeroRapport) || "—"} — ${esc(r.commune)}${r.quartier ? ", " + esc(r.quartier) : ""}</div>
                <div class="muted">${esc(r.typeBien)} · ${esc(r.superficie) || "?"} m² · ${esc(r.methodeEvaluation) || "—"}</div>
              </div><div style="font-weight:600">${esc(r.prixReference)} FCFA/m²</div></div>`).join("")}</div>`;
        } catch (e) {
          box.innerHTML = `<div class="error-text" style="display:block">${esc(e.message)}</div>`;
        }
      };
      document.getElementById("btn-save-expert").onclick = async () => {
        let updated = collectExpertForm(d);
        if (updated.statut === "envoye") updated.statut = "en_traitement";
        await saveDossier(updated);
        await loadAll(); render();
      };
      document.getElementById("btn-generate-report").onclick = async () => {
        let updated = collectExpertForm(d);
        updated.statut = "rapport_genere";
        const saved = await saveDossier(updated);
        document.getElementById("report-preview").innerHTML = previewHTML(saved, "expert");
      };
      return;
    }
    app.innerHTML = screenExpertHome();
    document.getElementById("btn-logout").onclick = doLogout;
    document.getElementById("btn-manage-users").onclick = async () => { state.users = await api("/users"); state.managingUsers = true; render(); };
    document.getElementById("btn-new-requisition").onclick = () => { state.newRequisition = emptyRequisition(); render(); };
    document.querySelectorAll(".dossier-row").forEach((row) => {
      row.onclick = () => { state.activeDossierId = row.getAttribute("data-id"); render(); };
    });
    return;
  }
}

(async function init() {
  document.getElementById("app").innerHTML = '<div class="muted">Chargement…</div>';
  try {
    const res = await fetch(`${API}/me`);
    if (res.ok) {
      const user = await res.json();
      state.user = user; state.role = user.role; state.agentName = user.displayName;
      await loadAll();
    }
  } catch (e) {
    console.error(e);
  }
  render();
})();
