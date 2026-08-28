require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Database ----------
const db = new Database(path.join(DATA_DIR, "iqra.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS requisitions (
  id TEXT PRIMARY KEY,
  dateCreation TEXT,
  referenceDossier TEXT,
  clientNom TEXT, clientTelephone TEXT, clientEmail TEXT,
  mandantType TEXT, mandantNom TEXT, mandantTelephone TEXT,
  siteIndicatif TEXT, instructionsExpert TEXT,
  statut TEXT DEFAULT 'en_attente'
);

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  requisitionId TEXT,
  agentName TEXT,
  dateVisite TEXT,
  numeroRapport TEXT, nomSite TEXT,
  typeMission TEXT, demandeur TEXT, clientNom TEXT, clientTelephone TEXT,
  mandantType TEXT, mandantNom TEXT, referenceDossier TEXT,
  equipeJson TEXT, moyenDeplacement TEXT,
  indicateurType TEXT, indicateurNom TEXT, indicateurPrenom TEXT, indicateurTelephone TEXT,
  commune TEXT, quartier TEXT, cercle TEXT, region TEXT, bamakoDistrict TEXT, adresse TEXT,
  lat REAL, lon REAL, utmJson TEXT,
  typeTitre TEXT, numeroTitre TEXT, numeroRequisitionCadastrale TEXT, titulaire TEXT,
  natureParcelleJson TEXT, etatTerrainJson TEXT, vrdJson TEXT, difficultesRencontrees TEXT,
  longueurParcelle TEXT, largeurParcelle TEXT,
  gpsAnglesJson TEXT,
  piecesJson TEXT,
  annexesJson TEXT,
  typeBien TEXT, superficie TEXT, description TEXT, observationsAgent TEXT,
  heureDebutMission TEXT, heureArriveeSite TEXT, heureFinMission TEXT,
  trackingPointsJson TEXT, distanceParcourue REAL DEFAULT 0,
  statut TEXT DEFAULT 'brouillon',
  expertNotes TEXT, prixReference TEXT, methodeEvaluation TEXT, conclusion TEXT,
  dateEnvoi TEXT, dernierModifiePar TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  dossierId TEXT,
  filename TEXT,
  t TEXT,
  FOREIGN KEY(dossierId) REFERENCES dossiers(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  passwordHash TEXT,
  role TEXT,
  displayName TEXT,
  active INTEGER DEFAULT 1,
  createdAt TEXT
);
`);

// ---------- Uploads (photos) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// ---------- Email (optional, requires .env credentials) ----------
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
async function notifyExpert(subject, text) {
  if (!transporter) {
    console.log("[email non configuré] Aurait envoyé:", subject);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.EXPERT_EMAIL || "iqraexpertise@gmail.com",
      subject,
      text,
    });
  } catch (e) {
    console.error("Erreur envoi email:", e.message);
  }
}

// ---------- Auth helpers ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const suppliedBuffer = crypto.scryptSync(password, salt, 64);
  return hashBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Non connecté" });
  next();
}
function requireExpert(req, res, next) {
  if (req.session.role !== "expert") return res.status(403).json({ error: "Réservé à l'expert" });
  next();
}

// ---------- Middleware ----------
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me-in-.env",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 12 * 3600 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", requireAuth, express.static(UPLOAD_DIR));

// ---------- Helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Seed initial expert account ----------
(function seedExpertIfNeeded() {
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'expert'").get().c;
  if (count > 0) return;
  const username = process.env.EXPERT_USERNAME || "expert";
  let password = process.env.EXPERT_PASSWORD;
  const generated = !password;
  if (generated) password = crypto.randomBytes(6).toString("hex");
  db.prepare(
    "INSERT INTO users (id,username,passwordHash,role,displayName,active,createdAt) VALUES (?,?,?,?,?,1,?)"
  ).run(uid(), username, hashPassword(password), "expert", "Expert", nowISO());
  console.log("=".repeat(60));
  console.log(`Compte expert initial créé — identifiant : ${username}`);
  if (generated) console.log(`Mot de passe généré (à noter et changer) : ${password}`);
  else console.log("Mot de passe : celui défini dans EXPERT_PASSWORD (.env)");
  console.log("=".repeat(60));
})();

function rowToRequisition(r) {
  return r;
}
function rowToDossier(row) {
  if (!row) return null;
  const photos = db.prepare("SELECT id, filename, t FROM photos WHERE dossierId = ? ORDER BY t").all(row.id);
  return {
    ...row,
    equipe: JSON.parse(row.equipeJson || "[]"),
    utm: row.utmJson ? JSON.parse(row.utmJson) : null,
    natureParcelle: JSON.parse(row.natureParcelleJson || "[]"),
    etatTerrain: JSON.parse(row.etatTerrainJson || "[]"),
    vrd: JSON.parse(row.vrdJson || "[]"),
    gpsAngles: JSON.parse(row.gpsAnglesJson || "{}"),
    pieces: JSON.parse(row.piecesJson || "[]"),
    annexes: JSON.parse(row.annexesJson || "{}"),
    trackingPoints: JSON.parse(row.trackingPointsJson || "[]"),
    photos: photos.map((p) => ({ id: p.id, url: `/uploads/${p.filename}`, t: p.t })),
  };
}

// ---------- UTM conversion (server-side, authoritative) ----------
function toUTM(lat, lon) {
  const a = 6378137.0, eccSq = 0.00669438, k0 = 0.9996;
  const radLat = (lat * Math.PI) / 180, radLon = (lon * Math.PI) / 180;
  const zone = Math.floor((lon + 180) / 6) + 1;
  const radLonOrigin = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const eccP = eccSq / (1 - eccSq);
  const N = a / Math.sqrt(1 - eccSq * Math.sin(radLat) ** 2);
  const T = Math.tan(radLat) ** 2, C = eccP * Math.cos(radLat) ** 2, A = Math.cos(radLat) * (radLon - radLonOrigin);
  const M =
    a *
    ((1 - eccSq / 4 - (3 * eccSq * eccSq) / 64 - (5 * Math.pow(eccSq, 3)) / 256) * radLat -
      ((3 * eccSq) / 8 + (3 * eccSq * eccSq) / 32 + (45 * Math.pow(eccSq, 3)) / 1024) * Math.sin(2 * radLat) +
      ((15 * eccSq * eccSq) / 256 + (45 * Math.pow(eccSq, 3)) / 1024) * Math.sin(4 * radLat) -
      ((35 * Math.pow(eccSq, 3)) / 3072) * Math.sin(6 * radLat));
  let easting = k0 * N * (A + ((1 - T + C) * Math.pow(A, 3)) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * eccP) * Math.pow(A, 5)) / 120) + 500000;
  let northing =
    k0 *
    (M +
      N *
        Math.tan(radLat) *
        ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * eccP) * Math.pow(A, 6)) / 720));
  if (lat < 0) northing += 10000000;
  return { zone, hemisphere: lat >= 0 ? "N" : "S", easting: Math.round(easting), northing: Math.round(northing) };
}

// =========================================================
// API: Authentification
// =========================================================
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username || "");
  if (!user || !verifyPassword(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ id: user.id, username: user.username, role: user.role, displayName: user.displayName });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, username, role, displayName FROM users WHERE id = ? AND active = 1").get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Non connecté" });
  res.json(user);
});

app.use("/api", requireAuth);

// =========================================================
// API: Comptes utilisateurs (réservé à l'expert)
// =========================================================
app.get("/api/users", requireExpert, (req, res) => {
  const rows = db.prepare("SELECT id, username, role, displayName, active, createdAt FROM users ORDER BY createdAt DESC").all();
  res.json(rows);
});

app.post("/api/users", requireExpert, (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: "Identifiant et mot de passe (6 caractères minimum) requis." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(400).json({ error: "Cet identifiant existe déjà." });
  const u = {
    id: uid(),
    username,
    passwordHash: hashPassword(password),
    role: "agent",
    displayName: displayName || username,
    active: 1,
    createdAt: nowISO(),
  };
  db.prepare(
    "INSERT INTO users (id,username,passwordHash,role,displayName,active,createdAt) VALUES (@id,@username,@passwordHash,@role,@displayName,@active,@createdAt)"
  ).run(u);
  res.json({ id: u.id, username: u.username, role: u.role, displayName: u.displayName, active: u.active, createdAt: u.createdAt });
});

app.patch("/api/users/:id", requireExpert, (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  const active = req.body.active != null ? (req.body.active ? 1 : 0) : existing.active;
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active, req.params.id);
  res.json({ id: existing.id, username: existing.username, role: existing.role, displayName: existing.displayName, active });
});

// =========================================================
// API: Réquisitions
// =========================================================
app.get("/api/requisitions", (req, res) => {
  const rows = db.prepare("SELECT * FROM requisitions ORDER BY dateCreation DESC").all();
  res.json(rows);
});

app.post("/api/requisitions", requireExpert, ah(async (req, res) => {
  const b = req.body;
  if (!b.siteIndicatif || (!b.clientTelephone && !b.mandantNom)) {
    return res.status(400).json({ error: "Le site à visiter et un contact (téléphone client ou nom du mandant) sont obligatoires." });
  }
  const r = {
    id: uid(),
    dateCreation: nowISO(),
    referenceDossier: b.referenceDossier || "",
    clientNom: b.clientNom || "",
    clientTelephone: b.clientTelephone || "",
    clientEmail: b.clientEmail || "",
    mandantType: b.mandantType || "",
    mandantNom: b.mandantNom || "",
    mandantTelephone: b.mandantTelephone || "",
    siteIndicatif: b.siteIndicatif,
    instructionsExpert: b.instructionsExpert || "",
    statut: "en_attente",
  };
  db.prepare(
    `INSERT INTO requisitions (id,dateCreation,referenceDossier,clientNom,clientTelephone,clientEmail,mandantType,mandantNom,mandantTelephone,siteIndicatif,instructionsExpert,statut)
     VALUES (@id,@dateCreation,@referenceDossier,@clientNom,@clientTelephone,@clientEmail,@mandantType,@mandantNom,@mandantTelephone,@siteIndicatif,@instructionsExpert,@statut)`
  ).run(r);
  res.json(r);
}));

app.patch("/api/requisitions/:id", requireExpert, (req, res) => {
  const existing = db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  const statut = req.body.statut || existing.statut;
  db.prepare("UPDATE requisitions SET statut = ? WHERE id = ?").run(statut, req.params.id);
  res.json({ ...existing, statut });
});

// =========================================================
// API: Dossiers
// =========================================================
app.get("/api/dossiers", (req, res) => {
  const rows = db.prepare("SELECT * FROM dossiers ORDER BY dateVisite DESC").all();
  res.json(rows.map(rowToDossier));
});

app.get("/api/dossiers/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Introuvable" });
  res.json(rowToDossier(row));
});

// =========================================================
// API: Base de prix de référence (expertises terminées)
// =========================================================
app.get("/api/prix-reference", requireExpert, (req, res) => {
  const { commune, typeBien } = req.query;
  let sql = `SELECT id, commune, quartier, region, typeBien, superficie, prixReference, methodeEvaluation, dateVisite, numeroRapport
             FROM dossiers WHERE statut = 'rapport_genere' AND prixReference IS NOT NULL AND prixReference != ''`;
  const params = [];
  if (commune) { sql += " AND commune = ?"; params.push(commune); }
  if (typeBien) { sql += " AND typeBien = ?"; params.push(typeBien); }
  sql += " ORDER BY dateVisite DESC LIMIT 50";
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

function upsertDossier(b) {
  const id = b.id || uid();
  const existing = db.prepare("SELECT id FROM dossiers WHERE id = ?").get(id);
  const utm = b.lat != null && b.lon != null ? toUTM(b.lat, b.lon) : null;
  const row = {
    id,
    requisitionId: b.requisitionId || null,
    agentName: b.agentName || "",
    dateVisite: b.dateVisite || nowISO().slice(0, 10),
    numeroRapport: b.numeroRapport || "",
    nomSite: b.nomSite || "",
    typeMission: b.typeMission || "",
    demandeur: b.demandeur || "",
    clientNom: b.clientNom || "",
    clientTelephone: b.clientTelephone || "",
    mandantType: b.mandantType || "",
    mandantNom: b.mandantNom || "",
    referenceDossier: b.referenceDossier || "",
    equipeJson: JSON.stringify(b.equipe || []),
    moyenDeplacement: b.moyenDeplacement || "",
    indicateurType: b.indicateurType || "",
    indicateurNom: b.indicateurNom || "",
    indicateurPrenom: b.indicateurPrenom || "",
    indicateurTelephone: b.indicateurTelephone || "",
    commune: b.commune || "",
    quartier: b.quartier || "",
    cercle: b.cercle || "",
    region: b.region || "",
    bamakoDistrict: b.bamakoDistrict || "",
    adresse: b.adresse || "",
    lat: b.lat != null ? b.lat : null,
    lon: b.lon != null ? b.lon : null,
    utmJson: utm ? JSON.stringify(utm) : null,
    typeTitre: b.typeTitre || "",
    numeroTitre: b.numeroTitre || "",
    numeroRequisitionCadastrale: b.numeroRequisitionCadastrale || "",
    titulaire: b.titulaire || "",
    natureParcelleJson: JSON.stringify(b.natureParcelle || []),
    etatTerrainJson: JSON.stringify(b.etatTerrain || []),
    vrdJson: JSON.stringify(b.vrd || []),
    difficultesRencontrees: b.difficultesRencontrees || "",
    longueurParcelle: b.longueurParcelle || "",
    largeurParcelle: b.largeurParcelle || "",
    gpsAnglesJson: JSON.stringify(b.gpsAngles || {}),
    piecesJson: JSON.stringify(b.pieces || []),
    annexesJson: JSON.stringify(b.annexes || {}),
    typeBien: b.typeBien || "",
    superficie: b.superficie || "",
    description: b.description || "",
    observationsAgent: b.observationsAgent || "",
    heureDebutMission: b.heureDebutMission || null,
    heureArriveeSite: b.heureArriveeSite || null,
    heureFinMission: b.heureFinMission || null,
    trackingPointsJson: JSON.stringify(b.trackingPoints || []),
    distanceParcourue: b.distanceParcourue || 0,
    statut: b.statut || "brouillon",
    expertNotes: b.expertNotes || "",
    prixReference: b.prixReference || "",
    methodeEvaluation: b.methodeEvaluation || "",
    conclusion: b.conclusion || "",
    dateEnvoi: b.dateEnvoi || null,
    dernierModifiePar: b.dernierModifiePar || b.agentName || "",
  };
  if (existing) {
    const cols = Object.keys(row).filter((k) => k !== "id");
    db.prepare(`UPDATE dossiers SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run(row);
  } else {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO dossiers (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`).run(row);
  }
  return id;
}

app.post("/api/dossiers", ah(async (req, res) => {
  const b = req.body;
  const id = upsertDossier(b);
  if (b.statut === "envoye" && b.requisitionId) {
    db.prepare("UPDATE requisitions SET statut = 'visitee' WHERE id = ?").run(b.requisitionId);
  }
  if (b.statut === "envoye") {
    await notifyExpert(
      `Nouveau dossier reçu — ${b.numeroRapport || "sans n°"} (${b.nomSite || b.commune || ""})`,
      `Un agent (${b.agentName}) vient d'envoyer un dossier de visite terrain.\n\nSite : ${b.nomSite || b.commune}\nIndicateur de terrain : ${b.indicateurNom} ${b.indicateurPrenom} (${b.indicateurTelephone})\n\nConsultez l'application pour le traiter.`
    );
  }
  const row = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(id);
  res.json(rowToDossier(row));
}));

app.post("/api/dossiers/:id/photos", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
  const photo = { id: uid(), dossierId: req.params.id, filename: req.file.filename, t: nowISO() };
  db.prepare("INSERT INTO photos (id, dossierId, filename, t) VALUES (@id,@dossierId,@filename,@t)").run(photo);
  res.json({ id: photo.id, url: `/uploads/${photo.filename}`, t: photo.t });
});

app.delete("/api/photos/:id", (req, res) => {
  const photo = db.prepare("SELECT * FROM photos WHERE id = ?").get(req.params.id);
  if (photo) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, photo.filename));
    } catch (e) {}
    db.prepare("DELETE FROM photos WHERE id = ?").run(req.params.id);
  }
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error("Erreur serveur:", err);
  res.status(500).json({ error: "Erreur serveur" });
});

app.listen(PORT, () => {
  console.log(`IQRA Expertise Terrain — serveur démarré sur http://localhost:${PORT}`);
  console.log(transporter ? "Email expert : configuré (SMTP actif)" : "Email expert : NON configuré (voir .env.example) — les envois seront seulement journalisés dans la console");
});
