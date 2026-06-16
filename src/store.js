// ============================================================
// store.js — Supabase data layer for The Nanea Book
// One shared tournament state, synced live across all phones.
//
// HOW IT WORKS (plain English):
//   • All tournament data lives in ONE row in a Supabase table
//     called "tournament", under a fixed id ("main").
//   • When anyone saves, we write that row.
//   • Supabase Realtime pushes the change to every other phone
//     instantly — no refresh needed.
//   • If realtime ever hiccups, we also poll every few seconds
//     as a safety net.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// These two values come from your Supabase project (Settings → API).
// They are filled in via the .env file — see DEPLOY_GUIDE.md.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const ROW_ID = "main"; // single shared tournament

let supabase = null;
export function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error("Missing Supabase keys — check your .env file.");
      return null;
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// Load the shared tournament state. Returns the saved `data` object, or null if none yet.
export async function loadState() {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.from("tournament").select("data").eq("id", ROW_ID).maybeSingle();
  if (error) { console.error("loadState error:", error.message); return null; }
  return data ? data.data : null;
}

// Save the shared tournament state (upsert the single row).
export async function saveState(stateObj) {
  const sb = getClient();
  if (!sb) return false;
  const { error } = await sb.from("tournament").upsert({ id: ROW_ID, data: stateObj, updated_at: new Date().toISOString() });
  if (error) { console.error("saveState error:", error.message); return false; }
  return true;
}

// Subscribe to live updates. `onChange(newData)` fires whenever the row changes.
// Returns an unsubscribe function. Falls back to polling if realtime is unavailable.
export function subscribe(onChange) {
  const sb = getClient();
  if (!sb) return () => {};

  let lastJSON = "";

  // 1) Realtime channel
  const channel = sb
    .channel("tournament-main")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "tournament", filter: `id=eq.${ROW_ID}` },
      (payload) => {
        const next = payload.new?.data;
        if (next) {
          const j = JSON.stringify(next);
          if (j !== lastJSON) { lastJSON = j; onChange(next); }
        }
      })
    .subscribe();

  // 2) Polling safety net (every 5s) — covers the rare case realtime drops.
  const poll = setInterval(async () => {
    const data = await loadState();
    if (data) {
      const j = JSON.stringify(data);
      if (j !== lastJSON) { lastJSON = j; onChange(data); }
    }
  }, 5000);

  return () => { try { sb.removeChannel(channel); } catch {} clearInterval(poll); };
}
