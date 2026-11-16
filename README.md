# My Business Manager 🏪🤖

Aapki **Google Business Profile** (Google Maps / Search wala business page) ko AI se apne aap sambhalne wala app.

## Ye kya karta hai

| Kaam | Kaise |
|---|---|
| ⭐ **Reviews ka auto-reply** | Har 30 minute me naye reviews check karta hai. AI (Claude) har review padh kar uske hisaab se reply likhta hai. 4-5 star wale reviews ko reply apne aap chala jaata hai. |
| 🛑 **Bure reviews par aapki approval** | Kam star wale reviews ka reply AI likh ke rakhta hai, par bhejne se pehle aap dekh aur badal sakte hain. Kitne star par auto-reply ho, ye Settings me tay karein. |
| 📢 **Roz ek post** | Har din aapke chune time par AI ek nayi post likh kar Google par daal deta hai. Har din alag topic hota hai. Chahein to publish se pehle approval wala option on kar sakte hain. |
| 📷 **Asli photo ke saath post** | Apni dukaan ya products ki photos upload karein. AI photo dekh kar uske baare me post likhta hai aur photo ke saath Google par daalta hai. Sabse kam use hui photo pehle lagti hai. |
| 💯 **Profile score (100 me se)** | Description, phone, website, timing, category, photos, reviews, rating, reply aur posts check karke score deta hai, aur har kami ka Hinglish me tip deta hai. Description AI se likhwa kar seedha Google par daal sakte hain. |
| 📈 **Growth report** | Pichhle 28 din me kitne logon ne profile dekhi, kitni calls aayi, kitne logon ne raasta poochha, aur pichhle 28 din se kitna badha. Roz ka chart bhi. |
| 🔎 **Search keywords (local SEO)** | Log kya search karke aapko dhundhte hain (jaise "kirana store near me"). AI in shabdon ko roz ki posts me istemaal karta hai, taaki aap inhi searches me upar aayein. |
| 📱 **Phone par dashboard** | Hinglish dashboard jisme reviews, posts, settings aur "kya-kya hua" ka log dikhta hai. |
| 🔒 **Password** | Dashboard password se band rehta hai. |

Reply aur post ki bhasha aap chun sakte hain: Hinglish, Hindi ya English. Reply ke liye "customer ki bhasha" wala option bhi hai.

---

## Pehle demo dekhein (2 minute)

Computer me [Node.js](https://nodejs.org) (version 20 ya naya) install hona chahiye.

```bash
npm install
npm start
```

Browser me `http://localhost:3000` kholein. Google ya AI key ke bina app **demo mode** me chalta hai, jisme nakli reviews hote hain. Connect tab me "Demo Kirana Store" chunein aur dekhein ki app kaise kaam karta hai.

---

## Asli business ke saath chalane ke steps

### Step 1: AI key (Claude)

1. https://platform.claude.com par account banayein aur thoda credit daalein.
2. **API Keys** me jaakar nayi key banayein.
3. Key ko `.env` file me `ANTHROPIC_API_KEY=` ke aage daalein.

Ek reply ya post ka kharcha bahut kam hota hai (paise me).

### Step 2: Google se permission ⚠️ (sabse zaroori)

Google Business Profile ka API sabke liye khula nahi hai. Google se **access maangna padta hai**:

1. https://console.cloud.google.com par ek naya **Project** banayein.
2. Google ka **"Business Profile API access request" form** bharein. Google Search me "Business Profile API access request" search karke form mil jaayega. Form me apna Cloud Project number aur business ki details daalein.
3. Google approve kare, tab tak ruken (kuch din lag sakte hain). Approval ke bina API calls "quota 0" error denge.
4. Approval ke baad project me ye APIs **Enable** karein:
   - My Business Account Management API
   - My Business Business Information API
   - Google My Business API (reviews, posts aur photos ke liye)
   - Business Profile Performance API (growth report aur keywords ke liye)
5. **APIs & Services → OAuth consent screen** banayein. Apna Gmail "Test users" me daal dein.
6. **Credentials → Create Credentials → OAuth client ID** banayein:
   - Type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/oauth/callback` (server par chalayein to `https://aapki-site.com/oauth/callback`)
7. Client ID aur Client Secret ko `.env` me daalein.

### Step 3: `.env` file

`.env.example` ko copy karke `.env` naam se save karein:

```env
DASHBOARD_PASSWORD=apna-strong-password
BASE_URL=http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
TZ_NAME=Asia/Kolkata
```

### Step 4: Chalayein aur connect karein

```bash
npm start
```

1. Dashboard kholein. Login me username kuch bhi daalein, password wahi jo `.env` me rakha.
2. **Connect** tab → **Google se connect karo** → apne business wale Gmail se login karein.
3. Apna business chunein.
4. **Settings** me business ke baare me achhe se likhein: kya bechte hain, khaasiyat kya hai, timing kya hai. AI jitna jaanega, utne achhe reply aur post likhega.

Bas! Ab app khud reviews ka reply karega aur roz post daalega.

---

## 24 ghante chalane ke liye

Auto-reply aur roz ki post tabhi hoti hai jab app chal raha ho. Isliye ise kisi server par daalein, jaise Render, Railway ya koi VPS:

- Start command: `npm start`
- `.env` wali sab values server ki "Environment Variables" me daalein.
- `BASE_URL` ko server ke address par set karein, aur wahi `/oauth/callback` wala address Google Console ke redirect URI me bhi daalein.
- Data `data/db.json` me aur photos `data/uploads/` me save hoti hain, isliye server par **persistent disk** lagayein (ya `DATA_FILE` / `UPLOAD_DIR` se path badlein).
- **Photo wali post** tabhi jaayegi jab app internet par `https://` address par chal raha ho, kyunki Google photo aapke app se download karta hai. Photos ke naam random hote hain aur ye bina password ke khulti hain (Google ke liye zaroori).

---

## Code kahan kya hai

```
src/server.js   – web server, API, password
src/google.js   – Google Business Profile API (login, reviews, reply, post, profile, report)
src/ai.js       – Claude AI se reply aur post likhwana
src/jobs.js     – automatic kaam: har 30 min review check, roz post, photos, report
src/audit.js    – profile score aur sudhaar ke tips
src/store.js    – data save karna (data/db.json)
public/index.html – phone-friendly dashboard
```

## Dhyaan rakhein

- Google ki policy ke hisaab se post me **phone number ya link** nahi daalne chahiye. AI ko bhi yahi bataya gaya hai.
- AI kabhi-kabhi galti kar sakta hai. Shuru ke kuch din replies dekhte rahein. Chahein to "Kitne star par auto-reply" ko 5★ kar dein, ya auto-reply band karke sab kuch approval se bhejein.
- Ek baar me AI zyada se zyada 20 naye reviews ke draft banata hai, taaki purane hazaaron reviews par ek saath kharcha na ho.
