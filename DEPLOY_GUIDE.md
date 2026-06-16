# 🏌️ The Nanea Book — Setup Guide (for total beginners)

This turns the folder you downloaded into a real website with its own link,
not tied to Claude. Everyone you share the link with sees the same live
scores, standings, and bets.

**Time needed:** about 25–30 minutes, one time.
**You need:** a computer, an email address. No coding. No software to install.

There are two free services:
- **Supabase** = the shared database (where scores live).
- **Vercel** = the website host (gives you the link).

Do them in this order. Take it slow; each step is small.

---

## PART 1 — Supabase (the database)  ~10 min

### 1. Make a free account
Go to **https://supabase.com** → click **Start your project** → sign up
(the "Sign in with GitHub" or email option both work).

### 2. Create a project
- Click **New project**.
- Name it anything (e.g. `nanea`).
- It will ask for a **database password** — make one up and **write it down**
  somewhere (you won't need it often, but don't lose it).
- Pick the region closest to you (e.g. *West US*).
- Click **Create new project** and wait ~2 minutes while it sets up.

### 3. Run the setup script
- On the left sidebar, click **SQL Editor**.
- Click **New query**.
- Open the file **SUPABASE_SETUP.sql** from your folder, copy ALL of it,
  paste it into the box.
- Click **Run** (bottom right).
- You should see **"Success. No rows returned."** — that's exactly right.

### 4. Copy your two keys (you'll paste these in Part 2)
- On the left sidebar, click the **gear icon (Project Settings)** → **API**.
- You'll see two things you need. Keep this tab open:
  - **Project URL** — looks like `https://abcd1234.supabase.co`
  - **anon public** key — a long string under "Project API keys"
- Leave this tab open; you'll copy these in a moment.

✅ Supabase is done.

---

## PART 2 — Vercel (the website)  ~12 min

### 5. Make a free account
Go to **https://vercel.com** → **Sign Up** (the **Hobby / free** plan).
Signing up with GitHub is easiest, but email works too.

### 6. Upload the project
Vercel deploys best from a folder uploaded to **GitHub**, but there's a
simpler no-GitHub path:

**Easiest path (no GitHub):**
- Install the Vercel app on your computer isn't needed — instead use the
  drag-and-drop importer:
- On your Vercel dashboard, click **Add New… → Project**.
- Choose **"Import a third-party Git Repository"** is the GitHub way; to avoid
  GitHub entirely, use the **Deploy a folder** option if shown, OR follow the
  GitHub path below (recommended, only ~3 extra clicks).

**Recommended path (with GitHub — most reliable):**
1. Go to **https://github.com**, sign up (free) if you don't have an account.
2. Click **New repository** → name it `nanea-book` → **Create**.
3. On the new repo page, click **"uploading an existing file"**.
4. Drag **everything inside your project folder** (App.jsx, store.js,
   package.json, index.html, etc.) into the upload box → **Commit changes**.
5. Back on **Vercel → Add New → Project**, pick your `nanea-book` repo →
   **Import**.

### 7. Add your two keys to Vercel
Before clicking Deploy, on the import screen find **Environment Variables**.
Add these two (copy the values from the Supabase tab you left open):

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | your Project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon public key |

Type the name on the left, paste the value on the right, click **Add** for each.

### 8. Deploy
Click **Deploy**. Wait ~1 minute. When it finishes you'll get a link like
`https://nanea-book.vercel.app`.

**That's your app.** Open it on your phone, then text the link to your group.

---

## Make it feel like an app
On your phone, open the link in Safari (iPhone) or Chrome (Android) →
tap the Share icon → **Add to Home Screen**. Now it's an icon like any app.
Have everyone do the same.

---

## Changing the Commissioner PIN
Open `src/App.jsx`, line ~12: `const COMMISH_PIN = "1918";`
Change `1918` to your own number. If you used GitHub, edit the file there
(pencil icon → change → Commit) and Vercel auto-redeploys in a minute.

---

## If something breaks
- **Scores don't sync between phones:** re-check that the SQL script ran
  (Part 1, step 3) and that both environment variables are spelled exactly
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel.
- **Blank page:** usually a missing/typo'd key. In Vercel → your project →
  Settings → Environment Variables, fix them, then Deployments → Redeploy.
- **Want to wipe everything and restart:** Supabase → Table Editor →
  `tournament` table → delete the row. The app rebuilds it fresh.

---

## Your data is safe across updates
All scores live in Supabase, separate from the app code. Editing/redeploying
the app does **not** erase scores. The only thing that wipes data is deleting
the row in Supabase yourself.
