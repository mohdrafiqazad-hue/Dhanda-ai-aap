import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { getDb, save, log, updateSettings } from "./store.js";
import * as google from "./google.js";
import * as ai from "./ai.js";
import * as jobs from "./jobs.js";
import { computeAudit } from "./audit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "100kb" }));

// ---------- Uploaded photos: public, taaki Google inhe download kar sake (naam random hain) ----------
app.use("/uploads", express.static(jobs.UPLOAD_DIR, { index: false, maxAge: "7d" }));

// ---------- Google OAuth callback (password check se pehle, state se protected) ----------
app.get("/oauth/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    await google.handleCallback(String(req.query.code || ""), String(req.query.state || ""));
    log("Google account connect ho gaya.");
    res.redirect("/#connect");
  } catch (e) {
    res.status(400).send(`Google connect nahi hua: ${escapeHtml(e.message)} <a href="/">Wapas jaayein</a>`);
  }
});

// ---------- Dashboard password ----------
const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
app.use((req, res, next) => {
  if (!PASSWORD) return next();
  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  const given = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(PASSWORD).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.set("WWW-Authenticate", 'Basic realm="My Business Manager"').status(401).send("Password chahiye");
});

app.use(express.static(path.join(here, "..", "public")));

const wrap = (fn) => async (req, res) => {
  try {
    res.json((await fn(req, res)) ?? { ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// ---------- API ----------
app.get("/api/status", wrap(() => {
  const db = getDb();
  const reviews = Object.values(db.reviews);
  return {
    demo: google.isDemo(),
    aiReady: ai.aiReady(),
    passwordSet: Boolean(PASSWORD),
    hasLogin: google.hasLogin(),
    connected: google.isConnected(),
    locationTitle: db.google.locationTitle,
    settings: db.settings,
    stats: {
      reviews: reviews.length,
      pending: reviews.filter((r) => r.status === "pending").length,
      autoReplied: reviews.filter((r) => r.repliedBy === "auto").length,
      avgStars: reviews.length ? (reviews.reduce((n, r) => n + r.stars, 0) / reviews.length).toFixed(1) : "-",
      postsPublished: db.posts.filter((p) => p.status === "published").length,
      postDrafts: db.posts.filter((p) => p.status === "draft").length,
    },
    log: db.log.slice(0, 30),
  };
}));

app.get("/auth/google", (req, res) => {
  if (google.isDemo()) return res.redirect("/#connect");
  res.redirect(google.authUrl());
});

app.post("/api/disconnect", wrap(() => {
  const db = getDb();
  db.google = { tokens: null, accountName: null, locationName: null, locationTitle: null };
  db.reviews = {};
  save();
  log("Google account disconnect kiya gaya.");
}));

app.get("/api/locations", wrap(() => google.listLocations()));

app.post("/api/location", wrap(async (req) => {
  const { accountName, locationName, title } = req.body || {};
  const options = await google.listLocations();
  const match = options.find((o) => o.accountName === accountName && o.locationName === locationName);
  if (!match) throw new Error("Ye business aapke account me nahi mila.");
  const db = getDb();
  Object.assign(db.google, { accountName, locationName, locationTitle: title || match.title });
  if (!db.settings.businessName) db.settings.businessName = match.title;
  if (!db.settings.city && match.address) db.settings.city = match.address;
  db.reviews = {};
  save();
  log(`Business chuna gaya: ${match.title}`);
  jobs.syncReviews().catch((e) => log(`Review sync fail: ${e.message}`));
}));

app.post("/api/settings", wrap((req) => updateSettings(req.body || {})));

app.get("/api/reviews", wrap(() =>
  Object.values(getDb().reviews).sort((a, b) => String(b.createTime).localeCompare(String(a.createTime))),
));
app.post("/api/reviews/sync", wrap(() => jobs.syncReviews()));
app.post("/api/reviews/:id/draft", wrap((req) => jobs.redraftReview(req.params.id)));
app.post("/api/reviews/:id/reply", wrap((req) => jobs.sendReply(req.params.id, req.body?.text)));
app.post("/api/reviews/:id/skip", wrap((req) => jobs.skipReview(req.params.id)));

app.get("/api/posts", wrap(() => getDb().posts));
app.post("/api/posts/generate", wrap((req) => jobs.generatePost(req.body?.photoId || undefined)));
app.post("/api/posts/:id/publish", wrap((req) => jobs.publishPost(req.params.id, req.body?.text)));
app.post("/api/posts/:id/delete", wrap((req) => jobs.deletePost(req.params.id)));

// Photos
app.get("/api/photos", wrap(() => getDb().photos));
app.post("/api/photos", express.raw({ type: ["image/jpeg", "image/png"], limit: "5mb" }), wrap((req) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error("Sirf JPG ya PNG photo chalegi.");
  const photo = jobs.savePhoto(req.body);
  log("Nayi photo upload hui.");
  return photo;
}));
app.post("/api/photos/:id/delete", wrap((req) => jobs.deletePhoto(req.params.id)));

// Profile score
app.get("/api/audit", wrap(async () => {
  if (!google.isConnected()) throw new Error("Pehle Google business connect karein.");
  return computeAudit(await google.getProfile(), getDb());
}));
app.post("/api/audit/description", wrap(async () => {
  const profile = await google.getProfile();
  return { text: await ai.draftDescription(getDb().settings, profile) };
}));
app.post("/api/profile/description", wrap(async (req) => {
  const text = String(req.body?.text || "").trim();
  if (!text) throw new Error("Description khaali hai.");
  if (text.length > 750) throw new Error("Description 750 akshar se lambi nahi ho sakti.");
  await google.updateDescription(text);
  log("Google par business description update ki gayi.");
}));

// Growth report
app.get("/api/report", wrap(() => jobs.getInsights()));
app.post("/api/report/refresh", wrap(() => jobs.getInsights({ force: true })));

// Badi photo ya galat JSON par bhi saaf message
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const msg = err.type === "entity.too.large" ? "Photo 5 MB se badi nahi honi chahiye." : err.message || "Kuch gadbad hui";
  res.status(err.status || 400).json({ error: msg });
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`My Business Manager chal raha hai: http://localhost:${port}`);
  if (google.isDemo()) console.log("Demo mode: GOOGLE_CLIENT_ID/SECRET set nahi hai, nakli reviews dikhenge.");
  if (!ai.aiReady()) console.log("ANTHROPIC_API_KEY set nahi hai, AI ki jagah simple template text use hoga.");
  if (!PASSWORD) console.log("Chetavani: DASHBOARD_PASSWORD set nahi hai.");
  jobs.startScheduler();
});
