// Google Business Profile API ke saath baat-cheet.
// Agar GOOGLE_CLIENT_ID set nahi hai to app "demo mode" me chalta hai (nakli reviews ke saath).
import crypto from "node:crypto";
import { getDb, save } from "./store.js";

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export const isDemo = () => !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET;

const redirectUri = () => `${(process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "")}/oauth/callback`;

// ---------- OAuth ----------

let pendingState = null;

export function authUrl() {
  pendingState = crypto.randomBytes(16).toString("hex");
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: pendingState,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function handleCallback(code, state) {
  if (!pendingState || state !== pendingState) throw new Error("OAuth state match nahi hua, dobara try karein.");
  pendingState = null;
  const tokens = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });
  const db = getDb();
  db.google.tokens = tokens;
  save();
}

async function tokenRequest(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google login fail: ${data.error_description || data.error || res.status}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || params.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
}

async function accessToken() {
  const db = getDb();
  const t = db.google.tokens;
  if (!t) throw new Error("Google account connect nahi hai.");
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) throw new Error("Google login expire ho gaya, dobara connect karein.");
  db.google.tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  save();
  return db.google.tokens.access_token;
}

async function gfetch(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = data.error?.message || text || res.statusText;
    throw new Error(`Google API error ${res.status}: ${msg}`);
  }
  return data;
}

export function isConnected() {
  const g = getDb().google;
  if (isDemo()) return Boolean(g.locationName);
  return Boolean(g.tokens && g.locationName);
}

export function hasLogin() {
  return isDemo() || Boolean(getDb().google.tokens);
}

// ---------- Locations ----------

export async function listLocations() {
  if (isDemo()) {
    return [{ accountName: "accounts/demo", locationName: "locations/demo", title: "Demo Kirana Store", address: "Lucknow" }];
  }
  const { accounts = [] } = await gfetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
  const out = [];
  for (const acc of accounts) {
    let pageToken = "";
    do {
      const q = new URLSearchParams({ readMask: "name,title,storefrontAddress", pageSize: "100" });
      if (pageToken) q.set("pageToken", pageToken);
      const data = await gfetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?${q}`);
      for (const loc of data.locations || []) {
        const a = loc.storefrontAddress;
        out.push({
          accountName: acc.name,
          locationName: loc.name,
          title: loc.title,
          address: a ? [a.locality, a.administrativeArea].filter(Boolean).join(", ") : "",
        });
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
  }
  return out;
}

// v4 API ko "accounts/X/locations/Y" format chahiye
function v4Location() {
  const g = getDb().google;
  return `${g.accountName}/${g.locationName}`;
}

// ---------- Reviews ----------

const demoReviews = [
  { id: "d1", author: "Rahul Sharma", stars: 5, comment: "Bahut achhi dukaan hai, saaman fresh milta hai aur bhaiya ka behaviour bhi badhiya.", daysAgo: 1 },
  { id: "d2", author: "Priya Verma", stars: 4, comment: "Good service, home delivery fast thi. Thoda parking ki problem hai.", daysAgo: 2 },
  { id: "d3", author: "Amit Kumar", stars: 2, comment: "Last time expired biscuit mila. Dhyaan rakhiye please.", daysAgo: 3 },
  { id: "d4", author: "Sana Khan", stars: 5, comment: "", daysAgo: 5 },
];
const demoReplies = {};

export async function listReviews() {
  if (isDemo()) {
    return demoReviews.map((r) => ({
      id: r.id,
      name: `${v4Location()}/reviews/${r.id}`,
      author: r.author,
      stars: r.stars,
      comment: r.comment,
      createTime: new Date(Date.now() - r.daysAgo * 864e5).toISOString(),
      reply: demoReplies[r.id] || null,
    }));
  }
  const out = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    if (pageToken) q.set("pageToken", pageToken);
    const data = await gfetch(`https://mybusiness.googleapis.com/v4/${v4Location()}/reviews?${q}`);
    for (const r of data.reviews || []) {
      out.push({
        id: r.reviewId,
        name: r.name,
        author: r.reviewer?.isAnonymous ? "Customer" : r.reviewer?.displayName || "Customer",
        stars: STAR[r.starRating] || 0,
        comment: r.comment || "",
        createTime: r.createTime,
        reply: r.reviewReply?.comment || null,
      });
    }
    pageToken = data.nextPageToken || "";
    if (out.length >= 200) break; // sirf naye reviews chahiye, 200 kaafi hain
  } while (pageToken);
  return out;
}

export async function replyToReview(reviewName, comment) {
  if (isDemo()) {
    demoReplies[reviewName.split("/").pop()] = comment;
    return;
  }
  await gfetch(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, { method: "PUT", body: { comment } });
}

// ---------- Posts ----------

export async function createPost(summary) {
  if (isDemo()) return { name: `demo-post-${Date.now()}`, searchUrl: null };
  const data = await gfetch(`https://mybusiness.googleapis.com/v4/${v4Location()}/localPosts`, {
    method: "POST",
    body: { languageCode: "hi", topicType: "STANDARD", summary },
  });
  return { name: data.name, searchUrl: data.searchUrl || null };
}
