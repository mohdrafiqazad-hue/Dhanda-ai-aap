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

// Return: { reviews, total, average } — total/average poore profile ke hote hain
export async function listReviews() {
  if (isDemo()) {
    const reviews = demoReviews.map((r) => ({
      id: r.id,
      name: `${v4Location()}/reviews/${r.id}`,
      author: r.author,
      stars: r.stars,
      comment: r.comment,
      createTime: new Date(Date.now() - r.daysAgo * 864e5).toISOString(),
      reply: demoReplies[r.id] || null,
    }));
    return { reviews, total: 23, average: 4.2 };
  }
  const reviews = [];
  let total = 0;
  let average = 0;
  let pageToken = "";
  do {
    const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    if (pageToken) q.set("pageToken", pageToken);
    const data = await gfetch(`https://mybusiness.googleapis.com/v4/${v4Location()}/reviews?${q}`);
    total = data.totalReviewCount ?? total;
    average = data.averageRating ?? average;
    for (const r of data.reviews || []) {
      reviews.push({
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
    if (reviews.length >= 200) break; // sirf naye reviews chahiye, 200 kaafi hain
  } while (pageToken);
  return { reviews, total, average };
}

export async function replyToReview(reviewName, comment) {
  if (isDemo()) {
    demoReplies[reviewName.split("/").pop()] = comment;
    return;
  }
  await gfetch(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, { method: "PUT", body: { comment } });
}

// ---------- Posts ----------

export async function createPost(summary, photoUrl) {
  if (isDemo()) return { name: `demo-post-${Date.now()}`, searchUrl: null };
  const body = { languageCode: "hi", topicType: "STANDARD", summary };
  if (photoUrl) {
    if (!/^https:\/\//.test(photoUrl) || /localhost|127\.0\.0\.1/.test(photoUrl)) {
      throw new Error("Photo wali post ke liye app internet par chalna chahiye (BASE_URL https:// wala ho), taaki Google photo download kar sake.");
    }
    body.media = [{ mediaFormat: "PHOTO", sourceUrl: photoUrl }];
  }
  const data = await gfetch(`https://mybusiness.googleapis.com/v4/${v4Location()}/localPosts`, { method: "POST", body });
  return { name: data.name, searchUrl: data.searchUrl || null };
}

// ---------- Profile (score audit ke liye) ----------

const demoProfile = {
  title: "Demo Kirana Store",
  description: "Lucknow ki bharosemand kirana dukaan.",
  phone: "+91 98xxxxxx10",
  website: "",
  hasHours: true,
  primaryCategory: "Grocery store",
  extraCategories: 0,
  hasAddress: true,
  photoCount: 4,
};

export async function getProfile() {
  if (isDemo()) return { ...demoProfile };
  const g = getDb().google;
  const readMask = "title,phoneNumbers,categories,storefrontAddress,serviceArea,websiteUri,regularHours,profile";
  const loc = await gfetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${g.locationName}?readMask=${readMask}`);
  let photoCount = null;
  try {
    const media = await gfetch(`https://mybusiness.googleapis.com/v4/${v4Location()}/media?pageSize=1`);
    photoCount = media.totalMediaItemCount ?? (media.mediaItems || []).length;
  } catch {
    photoCount = null; // pata nahi chal paaya
  }
  return {
    title: loc.title || "",
    description: loc.profile?.description || "",
    phone: loc.phoneNumbers?.primaryPhone || "",
    website: loc.websiteUri || "",
    hasHours: Boolean(loc.regularHours?.periods?.length),
    primaryCategory: loc.categories?.primaryCategory?.displayName || "",
    extraCategories: (loc.categories?.additionalCategories || []).length,
    hasAddress: Boolean(loc.storefrontAddress?.addressLines?.length || loc.serviceArea),
    photoCount,
  };
}

export async function updateDescription(description) {
  if (isDemo()) {
    demoProfile.description = description;
    return;
  }
  const g = getDb().google;
  await gfetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${g.locationName}?updateMask=profile.description`, {
    method: "PATCH",
    body: { profile: { description } },
  });
}

// ---------- Growth report ----------

const METRICS = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "views",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "views",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "views",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "views",
  CALL_CLICKS: "calls",
  BUSINESS_DIRECTION_REQUESTS: "directions",
  WEBSITE_CLICKS: "website",
};

const isoDate = (d) => d.toISOString().slice(0, 10);

// Return: { days: [{date, views, calls, directions, website}] (purane se naye), keywords: [{keyword, count, approx}] }
export async function fetchPerformance(numDays = 56) {
  const end = new Date(Date.now() - 2 * 864e5); // Google ka data 1-2 din pichhe chalta hai
  const start = new Date(end.getTime() - (numDays - 1) * 864e5);
  const blank = () => ({ views: 0, calls: 0, directions: 0, website: 0 });
  const byDate = {};
  for (let t = start.getTime(); t <= end.getTime(); t += 864e5) byDate[isoDate(new Date(t))] = blank();

  if (isDemo()) return demoPerformance(byDate);

  const g = getDb().google;
  const q = new URLSearchParams();
  for (const m of Object.keys(METRICS)) q.append("dailyMetrics", m);
  for (const [k, d] of [["startDate", start], ["endDate", end]]) {
    q.set(`dailyRange.${k}.year`, d.getUTCFullYear());
    q.set(`dailyRange.${k}.month`, d.getUTCMonth() + 1);
    q.set(`dailyRange.${k}.day`, d.getUTCDate());
  }
  const data = await gfetch(`https://businessprofileperformance.googleapis.com/v1/${g.locationName}:fetchMultiDailyMetricsTimeSeries?${q}`);
  for (const group of data.multiDailyMetricTimeSeries || []) {
    for (const series of group.dailyMetricTimeSeries || []) {
      const field = METRICS[series.dailyMetric];
      for (const dv of series.timeSeries?.datedValues || []) {
        const key = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}`;
        if (byDate[key] && field) byDate[key][field] += Number(dv.value || 0);
      }
    }
  }

  // Pichhle 3 poore mahino ke search keywords
  const now = new Date();
  const endM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const startM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const kq = new URLSearchParams({
    "monthlyRange.startMonth.year": startM.getUTCFullYear(),
    "monthlyRange.startMonth.month": startM.getUTCMonth() + 1,
    "monthlyRange.endMonth.year": endM.getUTCFullYear(),
    "monthlyRange.endMonth.month": endM.getUTCMonth() + 1,
    pageSize: "100",
  });
  let keywords = [];
  try {
    const kd = await gfetch(`https://businessprofileperformance.googleapis.com/v1/${g.locationName}/searchkeywords/impressions/monthly?${kq}`);
    keywords = (kd.searchKeywordsCounts || []).map((k) => ({
      keyword: k.searchKeyword,
      count: Number(k.insightsValue?.value ?? k.insightsValue?.threshold ?? 0),
      approx: k.insightsValue?.value === undefined,
    }));
  } catch {
    keywords = [];
  }
  keywords.sort((a, b) => b.count - a.count);
  return { days: Object.entries(byDate).map(([date, v]) => ({ date, ...v })), keywords: keywords.slice(0, 15) };
}

function demoPerformance(byDate) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const entries = Object.keys(byDate);
  const days = entries.map((date, i) => {
    const weekend = [0, 6].includes(new Date(date).getUTCDay()) ? 1.25 : 1;
    const views = Math.round((38 + i * 0.9) * weekend * (0.75 + rand() * 0.5));
    return { date, views, calls: Math.round(views * (0.04 + rand() * 0.03)), directions: Math.round(views * (0.06 + rand() * 0.04)), website: Math.round(views * 0.01 * rand() * 2) };
  });
  const keywords = [
    ["kirana store near me", 412], ["grocery shop lucknow", 236], ["demo kirana store", 188], ["atta dal chawal shop", 97],
    ["home delivery grocery", 64], ["general store", 41], ["dry fruits shop near me", 15],
  ].map(([keyword, count]) => ({ keyword, count, approx: count === 15 }));
  return { days, keywords };
}
