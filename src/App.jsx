import React, { useState, useEffect, useCallback, useMemo } from "react";
import { loadState, saveState, subscribe } from "./store.js";
// ============================================================
// NANEA — THE BOOK  ·  Tournament edition (Stage 1: scoring engine)
// 6-round net tournament for 8 players + Ryder Cup + Tournament Points.
// Sunset-luxe glass UI. Betting layer added in Stage 2.
//
// COMMISSIONER ACCESS: tap "Commish" tab, enter the PIN below.
// ============================================================

const COMMISH_PIN = "1918"; // <-- CHANGE THIS before sharing

// ---- default course (par 73). Stroke index editable in Commish. ----
const DEFAULT_HOLES = [
  { hole: 1, par: 5, si: 7 }, { hole: 2, par: 4, si: 3 }, { hole: 3, par: 4, si: 11 },
  { hole: 4, par: 3, si: 15 }, { hole: 5, par: 4, si: 1 }, { hole: 6, par: 5, si: 9 },
  { hole: 7, par: 4, si: 5 }, { hole: 8, par: 3, si: 17 }, { hole: 9, par: 4, si: 13 },
  { hole: 10, par: 4, si: 8 }, { hole: 11, par: 5, si: 10 }, { hole: 12, par: 4, si: 4 },
  { hole: 13, par: 3, si: 16 }, { hole: 14, par: 4, si: 18 }, { hole: 15, par: 4, si: 2 },
  { hole: 16, par: 5, si: 12 }, { hole: 17, par: 3, si: 14 }, { hole: 18, par: 4, si: 6 },
];

const DEFAULT_PLAYERS = [
  { id: "p1", name: "Paul Boranian", h: 13 }, { id: "p2", name: "Connor Nock", h: 10 },
  { id: "p3", name: "Luke Linaweaver", h: 18 }, { id: "p4", name: "John Sharp", h: 6 },
  { id: "p5", name: "Cameron Maalouf", h: 11 }, { id: "p6", name: "Kyle Lynds", h: 6 },
  { id: "p7", name: "Jack Clarey", h: 20 }, { id: "p8", name: "Jack Poncy", h: 20 },
];

const ROUNDS = [
  { n: 1, key: "r1", name: "Scramble Match", fmt: "2v2 Scramble Match Play · Ryder", kind: "ryder_scramble" },
  { n: 2, key: "r2", name: "Singles Match", fmt: "1v1 Match Play · Ryder", kind: "ryder_singles" },
  { n: 3, key: "r3", name: "Stableford", fmt: "Net Stableford", kind: "stableford" },
  { n: 4, key: "r4", name: "Best Ball", fmt: "2v2 Net Best Ball Match Play", kind: "bestball" },
  { n: 5, key: "r5", name: "Stroke Play", fmt: "Net Stroke Play", kind: "stroke" },
  { n: 6, key: "r6", name: "Championship", fmt: "Net Stroke Play · Final Groups", kind: "final" },
];

const uid = () => Math.random().toString(36).slice(2, 9);
const relToPar = (n) => (n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`);
const fmtTP = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

// ---- scoring helpers ----
const strokesOnHole = (si, ph) => (ph >= si ? 1 : 0) + (ph >= si + 18 ? 1 : 0);
const netHole = (g, si, ph) => g - strokesOnHole(si, ph);
const stbl = (net, par) => { const d = net - par; return d <= -3 ? 5 : d === -2 ? 4 : d === -1 ? 3 : d === 0 ? 2 : d === 1 ? 1 : 0; };

function playerNetTotal(holes, scores, h) {
  let g = 0, n = 0, thru = 0;
  holes.forEach((H) => { const v = scores?.[H.hole]; if (v != null) { g += v; n += netHole(v, H.si, h); thru++; } });
  return { gross: g, net: n, thru };
}
function playerStbl(holes, scores, h) {
  let pts = 0, thru = 0;
  holes.forEach((H) => { const v = scores?.[H.hole]; if (v != null) { pts += stbl(netHole(v, H.si, h), H.par); thru++; } });
  return { pts, thru };
}
// rank -> TP (7..0) with average tie-sharing
function rankToTP(arr, higherBetter) {
  const s = [...arr].sort((a, b) => (higherBetter ? b.val - a.val : a.val - b.val));
  const pts = [7, 6, 5, 4, 3, 2, 1, 0]; const out = {}; let i = 0;
  while (i < s.length) {
    let j = i; while (j + 1 < s.length && s[j + 1].val === s[i].val) j++;
    const share = pts.slice(i, j + 1).reduce((a, b) => a + b, 0) / (j - i + 1);
    for (let k = i; k <= j; k++) out[s[k].id] = share;
    i = j + 1;
  }
  return out;
}

// ---- Ryder match-play engine ----
// Standard 2-person scramble team handicap: 35% low + 15% high, rounded.
const scrambleTeamHcp = (h1, h2) => { const lo = Math.min(h1, h2), hi = Math.max(h1, h2); return Math.round(0.35 * lo + 0.15 * hi); };

// Compute live match-play status from two sides' per-hole NET scores.
// xNet / yNet are objects keyed by hole number (or undefined if not entered).
// Auto-closes ("3&2") the moment a side is more holes up than holes remain.
function matchStatus(holes, xNet, yNet) {
  let up = 0, thru = 0, decidedHole = null;
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i].hole;
    if (xNet[h] == null || yNet[h] == null) break;
    thru++;
    if (xNet[h] < yNet[h]) up++; else if (yNet[h] < xNet[h]) up--;
    if (Math.abs(up) > holes.length - thru) { decidedHole = thru; break; }
  }
  const final = decidedHole != null || thru === holes.length;
  let result = null, status;
  if (decidedHole != null) {
    result = up > 0 ? "X" : "Y";
    status = `${Math.abs(up)}&${holes.length - decidedHole}`;
  } else if (final) {
    if (up === 0) { result = "H"; status = "Halved (AS)"; }
    else { result = up > 0 ? "X" : "Y"; status = `${Math.abs(up)} UP`; }
  } else {
    status = up === 0 ? (thru ? `All square thru ${thru}` : "Not started") : `${Math.abs(up)} UP thru ${thru}`;
  }
  return { up, thru, final, result, status };
}

const DEFAULT_STATE = {
  tournamentName: "Nanea Invitational",
  holes: DEFAULT_HOLES,
  players: DEFAULT_PLAYERS.map((p) => ({ ...p, scores: {} })), // scores keyed by round: {r1:{hole:strokes}}
  ryder: { teamA: [], teamB: [], captainA: "", captainB: "",
    r1: [], r2: [], // matches: {id, side:'A', xs:[ids], ys:[ids], result:'X'|'Y'|'H'|''}
    playoff: "" }, // 'A' | 'B' | ''
  r4: { matches: [] }, // {id, xs:[id,id], ys:[id,id]}
  r6: { champ: [], losers: [], champWinner: "", loserLast: "" },
  manualTP: {}, // commissioner overrides id->delta (rare)
  markets: [], // betting markets: {id, title, kind, status:'open'|'settled', winnerId, options:[{id,label,odds,manual:bool}]}
  bets: [], // {id, who, marketId, optionId, label, stake, oddsAtBet, status, payout, ts}
};

export default function App() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("standings");
  const [me, setMe] = useState("");
  const [isCommish, setIsCommish] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [toast, setToast] = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  // Save to the shared Supabase tournament (optimistic local update first).
  const save = useCallback(async (next) => {
    setState(next);
    try { await saveState(next); }
    catch (e) { console.error("save failed", e); }
  }, []);

  // Initial load + live subscription to changes from other phones.
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        const data = await loadState();
        if (data) setState(migrate(data));
      } catch (e) { console.error("load failed", e); }
      setLoading(false);
      // start listening for everyone else's updates
      unsub = subscribe((incoming) => {
        setState((cur) => {
          const next = migrate(incoming);
          return JSON.stringify(cur) !== JSON.stringify(next) ? next : cur;
        });
      });
    })();
    try { const n = localStorage.getItem("nanea_me"); if (n) setMe(n); } catch {}
    return () => unsub();
  }, []);

  const setName = (n) => { setMe(n); try { localStorage.setItem("nanea_me", n); } catch {} };

  const tp = useMemo(() => computeTP(state), [state]);

  if (loading) return <div style={S.shell}><Style /><Hero name="Nanea" sub="loading the book…" minimal /><div style={{ textAlign: "center", color: C.copperLt, letterSpacing: 4, marginTop: 30, fontFamily: SANS }}>NANEA</div></div>;

  return (
    <div style={S.shell}>
      <Style />
      {toast && <div className="nz-toast" style={S.toast}>{toast}</div>}
      <Hero name={state.tournamentName} sub={`Par ${state.holes.reduce((s, h) => s + h.par, 0)} · Mount Hualālai · 8-player net tournament`} badge={isCommish ? "COMMISSIONER" : me} />

      {!me ? (
        <div style={S.namePrompt} className="nz-fade">
          <span style={{ color: C.cream, fontSize: 14, fontFamily: SANS, opacity: 0.85 }}>Check in —</span>
          <select className="nz-input" style={{ ...S.inputInline, minWidth: 160 }} defaultValue="" onChange={(e) => e.target.value && setName(e.target.value)}>
            <option value="" disabled>pick your name</option>
            {state.players.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
      ) : (
        <div style={S.switcherRow} className="nz-fade">
          <span style={{ color: C.fescue, fontSize: 12, fontFamily: SANS }}>Playing as</span>
          <select className="nz-input" style={S.switcher} value={me} onChange={(e) => setName(e.target.value)}>
            {state.players.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
      )}

      <nav style={S.tabs} className="nz-tabs">
        {[["standings", "Standings"], ["scoring", "Live Scoring"], ["ryder", "Ryder Cup"], ["rounds", "Rounds"], ["bets", "The Book"], ["commish", "Commish"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className="nz-tab" style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{lbl}</button>
        ))}
      </nav>

      <main style={S.main}>
        <div key={tab} className="nz-page">
          {tab === "standings" && <Standings state={state} tp={tp} />}
          {tab === "scoring" && <Scoring state={state} me={me} setName={setName} save={save} isCommish={isCommish} />}
          {tab === "ryder" && <RyderView state={state} tp={tp} />}
          {tab === "rounds" && <RoundsView state={state} tp={tp} />}
          {tab === "bets" && <BookView state={state} tp={tp} me={me} setName={setName} save={save} flash={flash} />}
          {tab === "commish" && (isCommish
            ? <Commish state={state} save={save} flash={flash} tp={tp} />
            : <PinGate pinEntry={pinEntry} setPinEntry={setPinEntry} onTry={() => { if (pinEntry === COMMISH_PIN) { setIsCommish(true); flash("Welcome, Commissioner."); } else flash("Wrong PIN."); }} />)}
        </div>
      </main>
      <footer style={S.footer}>One shared book — everyone with the link sees the same scores and standings. Net scoring throughout · betting coming online soon.</footer>
    </div>
  );
}

function migrate(s) {
  const base = JSON.parse(JSON.stringify(DEFAULT_STATE));
  const merged = { ...base, ...s };
  merged.holes = s.holes || base.holes;
  merged.players = (s.players || base.players).map((p) => ({ ...p, scores: p.scores || {}, submitted: p.submitted || {} }));
  merged.ryder = { ...base.ryder, ...(s.ryder || {}) };
  merged.r4 = { ...base.r4, ...(s.r4 || {}) };
  merged.r6 = { ...base.r6, ...(s.r6 || {}) };
  merged.manualTP = s.manualTP || {};
  merged.markets = s.markets || [];
  merged.bets = s.bets || [];
  return merged;
}

// ============================================================
// TOURNAMENT POINTS ENGINE
// ============================================================
function computeTP(state) {
  const tp = {}; state.players.forEach((p) => (tp[p.id] = 0));
  const P = (id) => state.players.find((x) => x.id === id);
  const holes = state.holes;
  const detail = { r1: null, r2: null, ryder: null, r3: {}, r4: [], r5: {}, r6: null };

  // ---- Ryder Cup (R1 scramble + R2 singles) — auto-calculated from scores ----
  const ry = state.ryder;
  if (ry.teamA.length && ry.teamB.length) {
    let aPts = 0, bPts = 0;
    const matchResults = {};
    const tallyMatch = (m, roundKey) => {
      const res = ryderMatchResult(holes, m, state, roundKey);
      matchResults[m.id] = res;
      // xs are Team A, ys are Team B (built that way in commish).
      if (res.result === "X") { aPts += 1; }
      else if (res.result === "Y") { bPts += 1; }
      else if (res.result === "H") { aPts += 0.5; bPts += 0.5; }
    };
    (ry.r1 || []).forEach((m) => tallyMatch(m, "r1"));
    (ry.r2 || []).forEach((m) => tallyMatch(m, "r2"));
    detail.ryder = { aPts, bPts, matchResults };
    let winners = null;
    if (aPts > bPts) winners = ry.teamA;
    else if (bPts > aPts) winners = ry.teamB;
    else if (ry.playoff === "A") winners = ry.teamA;
    else if (ry.playoff === "B") winners = ry.teamB;
    if (winners) winners.forEach((id) => (tp[id] += 2));
    detail.ryder.winners = winners;
  }

  // ---- R3 Stableford ----
  const r3vals = state.players.map((p) => ({ id: p.id, val: playerStbl(holes, p.scores.r3, p.h).pts, thru: playerStbl(holes, p.scores.r3, p.h).thru }));
  if (r3vals.some((v) => v.thru > 0)) {
    const done = r3vals.filter((v) => v.thru === 18);
    if (done.length === state.players.length) {
      const map = rankToTP(r3vals.map((v) => ({ id: v.id, val: v.val })), true);
      Object.entries(map).forEach(([id, v]) => (tp[id] += v));
      detail.r3 = map;
    }
  }

  // ---- R4 best ball ----
  (state.r4.matches || []).forEach((m) => {
    const res = bestBallResult(holes, m, state);
    detail.r4.push(res);
    if (res.winner) res.winner.forEach((id) => (tp[id] += 4));
  });

  // ---- R5 stroke ----
  const r5vals = state.players.map((p) => { const t = playerNetTotal(holes, p.scores.r5, p.h); return { id: p.id, val: t.net, thru: t.thru }; });
  if (r5vals.every((v) => v.thru === 18) && r5vals.length) {
    const map = rankToTP(r5vals.map((v) => ({ id: v.id, val: v.val })), false);
    Object.entries(map).forEach(([id, v]) => (tp[id] += v));
    detail.r5 = map;
  }

  // ---- manual overrides ----
  Object.entries(state.manualTP || {}).forEach(([id, d]) => { if (tp[id] != null) tp[id] += Number(d) || 0; });

  return { tp, detail, P };
}

function bestBallResult(holes, m, state) {
  const P = (id) => state.players.find((x) => x.id === id);
  const sc = (id) => (P(id)?.scores?.r4) || {};
  let x = 0, complete = true;
  holes.forEach((H) => {
    const xs = m.xs.map((id) => { const v = sc(id)[H.hole]; return v != null ? netHole(v, H.si, P(id).h) : null; }).filter((v) => v != null);
    const ys = m.ys.map((id) => { const v = sc(id)[H.hole]; return v != null ? netHole(v, H.si, P(id).h) : null; }).filter((v) => v != null);
    if (!xs.length || !ys.length) { complete = false; return; }
    const xn = Math.min(...xs), yn = Math.min(...ys);
    if (xn < yn) x++; else if (yn < xn) x--;
  });
  const winner = x > 0 ? m.xs : x < 0 ? m.ys : null;
  return { id: m.id, up: x, winner, complete, xs: m.xs, ys: m.ys };
}

// Per-hole NET for one Ryder side. roundKey 'r1' = scramble (best gross of pair + team
// handicap blend), 'r2' = singles (each player's own net; pairs use best net of the side).
function ryderSideNet(holes, ids, state, roundKey) {
  const P = (id) => state.players.find((x) => x.id === id);
  const sc = (id) => (P(id)?.scores?.[roundKey]) || {};
  const out = {};
  if (roundKey === "r1") {
    // scramble: one ball = best gross of the pair on each hole, then apply team handicap
    const teamH = ids.length === 2 ? scrambleTeamHcp(P(ids[0]).h, P(ids[1]).h) : P(ids[0]).h;
    holes.forEach((H) => {
      const grosses = ids.map((id) => sc(id)[H.hole]).filter((v) => v != null);
      out[H.hole] = grosses.length ? netHole(Math.min(...grosses), H.si, teamH) : null;
    });
  } else {
    // singles / per-player net; if a side somehow has 2, take their best net
    holes.forEach((H) => {
      const nets = ids.map((id) => { const v = sc(id)[H.hole]; return v != null ? netHole(v, H.si, P(id).h) : null; }).filter((v) => v != null);
      out[H.hole] = nets.length ? Math.min(...nets) : null;
    });
  }
  return out;
}

// Full auto-calculated result for a Ryder match (scramble or singles).
function ryderMatchResult(holes, m, state, roundKey) {
  const xNet = ryderSideNet(holes, m.xs, state, roundKey);
  const yNet = ryderSideNet(holes, m.ys, state, roundKey);
  const st = matchStatus(holes, xNet, yNet);
  return { id: m.id, ...st, xs: m.xs, ys: m.ys, roundKey };
}

// ============================================================
// RYDER CUP VIEW — live team board, all matches
// ============================================================
function RyderView({ state, tp }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ry = state.ryder;
  const d = tp.detail.ryder;

  if (!ry.teamA.length || !ry.teamB.length) {
    return <Empty msg="Ryder Cup teams aren't set yet. The commissioner assigns Team A and Team B in Commish → Ryder R1–2." />;
  }

  const MatchCard = ({ m, roundKey }) => {
    const res = ryderMatchResult(state.holes, m, state, roundKey);
    const xNames = m.xs.map((id) => P(id)?.name).filter(Boolean);
    const yNames = m.ys.map((id) => P(id)?.name).filter(Boolean);
    const xUp = res.up > 0, yUp = res.up < 0;
    const statusText = res.final
      ? (res.result === "H" ? "Halved" : `${res.result === "X" ? "Team A" : "Team B"} wins ${res.status}`)
      : (res.up === 0 ? res.status : `${Math.abs(res.up)} UP`);
    return (
      <div style={S.matchCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: xUp ? C.birdie : C.cream }}>{xNames.join(" & ") || "—"}</div>
            <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, letterSpacing: 1 }}>TEAM A</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 92 }}>
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 15, color: res.final ? (res.result === "H" ? C.fescue : C.copperLt) : C.copperLt }}>
              {res.up === 0 && !res.final ? "AS" : statusText.replace("Team A wins ", "A ").replace("Team B wins ", "B ")}
            </div>
            <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS }}>{res.final ? "FINAL" : res.thru ? `thru ${res.thru}` : "not started"}</div>
          </div>
          <div style={{ flex: 1, textAlign: "right" }}>
            <div style={{ fontWeight: 700, color: yUp ? C.ocean : C.cream }}>{yNames.join(" & ") || "—"}</div>
            <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, letterSpacing: 1 }}>TEAM B</div>
          </div>
        </div>
        {/* progress bar: center = AS, slides toward leader */}
        <div style={S.mpTrack}>
          <div style={S.mpCenter} />
          <div style={{ ...S.mpFill, ...(res.up >= 0 ? { left: "50%", width: `${Math.min(Math.abs(res.up), 9) / 9 * 50}%`, background: C.birdie } : { right: "50%", width: `${Math.min(Math.abs(res.up), 9) / 9 * 50}%`, background: C.ocean }) }} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* overall cup score */}
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Ryder Cup</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", marginTop: 8 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>TEAM A</div>
            <div style={{ fontSize: 44, fontWeight: 800, fontFamily: SANS, color: d && d.aPts >= d.bPts ? C.birdie : C.cream }}>{d ? fmtTP(d.aPts) : "0"}</div>
            <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>{ry.teamA.map((id) => P(id)?.name.split(" ")[0]).join(", ")}</div>
          </div>
          <div style={{ color: C.fescue, fontFamily: SANS }}>vs</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>TEAM B</div>
            <div style={{ fontSize: 44, fontWeight: 800, fontFamily: SANS, color: d && d.bPts >= d.aPts ? C.ocean : C.cream }}>{d ? fmtTP(d.bPts) : "0"}</div>
            <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>{ry.teamB.map((id) => P(id)?.name.split(" ")[0]).join(", ")}</div>
          </div>
        </div>
        <p style={{ ...S.hint, textAlign: "center" }}>First to 3½ of 6 points wins the Cup. Each player on the winning team earns 2 TP. {d && d.winners ? `Team ${d.winners === ry.teamA ? "A" : "B"} has clinched.` : "3–3 goes to a captain playoff."}</p>
      </div>

      {/* round 1 matches */}
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round 1 · Scramble</div>
        {(ry.r1 || []).length ? (ry.r1 || []).map((m) => <MatchCard key={m.id} m={m} roundKey="r1" />) : <p style={S.hint}>No scramble matches set yet.</p>}
      </div>

      {/* round 2 matches */}
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round 2 · Singles</div>
        {(ry.r2 || []).length ? (ry.r2 || []).map((m) => <MatchCard key={m.id} m={m} roundKey="r2" />) : <p style={S.hint}>No singles matches set yet.</p>}
      </div>
    </div>
  );
}

// ============================================================
// STANDINGS
// ============================================================
function Standings({ state, tp }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ranked = [...state.players].map((p) => ({ p, pts: tp.tp[p.id] })).sort((a, b) => b.pts - a.pts);
  const leader = ranked[0]?.pts || 0;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Tournament Points</div>
        <p style={S.hint}>Cumulative across all six rounds. Drives Round 4 pairings and the final-round groups.</p>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {ranked.map(({ p, pts }, i) => (
            <div key={p.id} style={S.standRow}>
              <span style={{ width: 28, fontWeight: 800, color: i === 0 ? C.copperLt : C.fescue, fontFamily: SANS }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{p.name} <span style={{ color: C.fescue, fontWeight: 400, fontSize: 13 }}>· {p.h}</span></div>
                <div style={S.tpBarTrack}><div style={{ ...S.tpBarFill, width: `${leader ? (pts / leader) * 100 : 0}%` }} /></div>
              </div>
              <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 20, color: C.copperLt, width: 44, textAlign: "right" }}>{fmtTP(pts)}</span>
            </div>
          ))}
        </div>
      </div>
      <RyderBanner state={state} tp={tp} />
    </div>
  );
}

function RyderBanner({ state, tp }) {
  const d = tp.detail.ryder;
  if (!d) return null;
  const P = (id) => state.players.find((x) => x.id === id);
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Ryder Cup</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", marginTop: 10 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>TEAM A</div>
          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: SANS, color: d.aPts >= d.bPts ? C.copperLt : C.cream }}>{fmtTP(d.aPts)}</div>
        </div>
        <div style={{ color: C.fescue, fontFamily: SANS }}>vs</div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>TEAM B</div>
          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: SANS, color: d.bPts >= d.aPts ? C.copperLt : C.cream }}>{fmtTP(d.bPts)}</div>
        </div>
      </div>
      {d.winners
        ? <div style={{ textAlign: "center", color: C.birdie, fontFamily: SANS, fontSize: 13, marginTop: 6 }}>Team {d.winners === state.ryder.teamA ? "A" : "B"} wins the Cup — each player on the team gets +2 TP</div>
        : <div style={{ textAlign: "center", color: C.fescue, fontFamily: SANS, fontSize: 13, marginTop: 6 }}>{d.aPts === d.bPts && (d.aPts + d.bPts) > 0 ? "All square — captain playoff needed" : "In progress"}</div>}
      <p style={{ ...S.hint, textAlign: "center" }}>6 points are up for grabs across the 2 scramble + 4 singles matches combined. Win the majority and every player on the winning team earns 2 Tournament Points — it's one team prize for the combined result, not 2 points per match.</p>
    </div>
  );
}

// ============================================================
// LIVE SCORING — per round, each player enters own card
// ============================================================
function Scoring({ state, me, setName, save, isCommish }) {
  const [roundKey, setRoundKey] = useState("r3");
  const [open, setOpen] = useState(null);
  const holes = state.holes;
  const round = ROUNDS.find((r) => r.key === roundKey);
  const myPlayer = state.players.find((p) => p.name === me);

  const setScore = async (playerId, hole, strokes) => {
    const players = state.players.map((p) => {
      if (p.id !== playerId) return p;
      const rs = { ...(p.scores[roundKey] || {}) };
      if (strokes == null) delete rs[hole]; else rs[hole] = strokes;
      return { ...p, scores: { ...p.scores, [roundKey]: rs } };
    });
    await save({ ...state, players });
  };

  const submitRound = async (playerId, rKey) => {
    const players = state.players.map((p) => p.id !== playerId ? p
      : { ...p, submitted: { ...(p.submitted || {}), [rKey]: true } });
    await save({ ...state, players });
  };
  const reopenRound = async (playerId, rKey) => {
    const players = state.players.map((p) => p.id !== playerId ? p
      : { ...p, submitted: { ...(p.submitted || {}), [rKey]: false } });
    await save({ ...state, players });
  };
  const clearRound = async (playerId, rKey) => {
    const players = state.players.map((p) => {
      if (p.id !== playerId) return p;
      const scores = { ...p.scores }; delete scores[rKey];
      return { ...p, scores, submitted: { ...(p.submitted || {}), [rKey]: false } };
    });
    await save({ ...state, players });
  };
  const isSubmitted = (p) => !!(p.submitted && p.submitted[roundKey]);

  // par played so far (for net-to-par display)
  const parThru = (rs) => holes.reduce((s, H) => s + (rs[H.hole] != null ? H.par : 0), 0);

  // leaderboard for this round
  const rows = state.players.map((p) => {
    const rs = p.scores[roundKey] || {};
    const t = playerNetTotal(holes, rs, p.h);
    const toPar = t.thru ? t.net - parThru(rs) : null;
    if (round.kind === "stableford") {
      const s = playerStbl(holes, rs, p.h);
      return { p, sortVal: s.pts, thru: s.thru, gross: t.gross, net: t.net, toPar, stbl: s.pts, higher: true };
    }
    return { p, sortVal: t.net, thru: t.thru, gross: t.gross, net: t.net, toPar, stbl: null, higher: false };
  }).sort((a, b) => { if (!a.thru) return 1; if (!b.thru) return -1; return a.higher ? b.sortVal - a.sortVal : a.sortVal - b.sortVal; });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Live Scoring</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {ROUNDS.map((r) => (
            <button key={r.key} onClick={() => setRoundKey(r.key)} style={{ ...S.roundPill, ...(roundKey === r.key ? S.roundPillOn : {}) }}>R{r.n}</button>
          ))}
        </div>
        <div style={{ marginTop: 10, color: C.copperLt, fontFamily: SANS, fontSize: 13 }}>{round.fmt}</div>
      </div>

      {!me && <div className="nz-glass" style={S.card}><div style={S.cardTitle}>Check in to score</div>
        <select className="nz-input" style={S.input} defaultValue="" onChange={(e) => e.target.value && setName(e.target.value)}>
          <option value="" disabled>pick your name</option>
          {state.players.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select></div>}

      {myPlayer && <MyCard player={myPlayer} holes={holes} roundKey={roundKey} round={round} setScore={setScore} submitRound={submitRound} isSubmitted={isSubmitted(myPlayer)} />}

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round {round.n} — {round.name}</div>
        <div style={{ display: "grid", gap: 1, marginTop: 10 }}>
          <div style={{ ...S.lbRow, ...S.lbHead }}>
            <span style={{ width: 24 }}>#</span>
            <span style={{ flex: 1 }}>Player</span>
            <span style={{ width: 42, textAlign: "center" }}>Thru</span>
            {round.kind === "stableford" && <span style={{ width: 44, textAlign: "right" }}>Pts</span>}
            <span style={{ width: 52, textAlign: "right" }}>Gross</span>
            <span style={{ width: 52, textAlign: "right" }}>Net</span>
          </div>
          {rows.map(({ p, thru, gross, net, toPar, stbl }, i) => (
            <div key={p.id}>
              <div className="nz-lbrow" style={{ ...S.lbRow, cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
                <span style={{ width: 24, color: C.copperLt, fontWeight: 700, fontFamily: SANS }}>{thru ? i + 1 : "–"}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{p.name}{p.name === me && <span style={S.youDot}>you</span>}{isSubmitted(p) && <span style={S.subDot}>✓</span>}</span>
                <span style={{ width: 42, textAlign: "center", color: C.fescue, fontFamily: SANS, fontSize: 13 }}>{thru === 18 ? "F" : thru || "—"}</span>
                {round.kind === "stableford" && <span style={{ width: 44, textAlign: "right", fontWeight: 700, fontFamily: SANS, color: C.cream }}>{thru ? stbl : "—"}</span>}
                <span style={{ width: 52, textAlign: "right", fontFamily: SANS, color: C.cream }}>{thru ? gross : "—"}</span>
                <span style={{ width: 52, textAlign: "right", fontWeight: 800, fontFamily: SANS, color: toPar == null ? C.fescue : toPar < 0 ? C.birdie : toPar > 0 ? C.copperLt : C.cream }}>{thru ? relToPar(toPar) : "—"}</span>
              </div>
              {open === p.id && <div className="nz-expand">
                <Scorecard player={p} holes={holes} roundKey={roundKey} />
                {isCommish && (
                  <div style={{ display: "flex", gap: 6, padding: "4px 8px 10px" }}>
                    {isSubmitted(p)
                      ? <button style={S.miniGhost} onClick={() => reopenRound(p.id, roundKey)}>Reopen round</button>
                      : <span style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>Not submitted</span>}
                    <button style={{ ...S.miniGhost, color: C.bogeyBad, borderColor: "rgba(224,117,85,0.5)" }}
                      onClick={() => { if (window.confirm(`Clear ${p.name}'s Round ${round.n} scores? This erases their card for this round.`)) clearRound(p.id, roundKey); }}>Clear scores</button>
                  </div>
                )}
              </div>}
            </div>
          ))}
        </div>
        <p style={S.hint}>Tap a player to see their full scorecard. Net scoring applied automatically.{isCommish ? " As commissioner you can reopen or clear a submitted round here." : ""}</p>
      </div>
    </div>
  );
}

function MyCard({ player, holes, roundKey, round, setScore, submitRound, isSubmitted }) {
  const rs = player.scores[roundKey] || {};
  const thru = holes.filter((H) => rs[H.hole] != null).length;
  const nextHole = thru >= 18 ? 18 : (() => { const miss = holes.find((H) => rs[H.hole] == null); return miss ? miss.hole : 18; })();
  const [h, setH] = useState(nextHole);
  useEffect(() => { setH(nextHole); /* eslint-disable-next-line */ }, [roundKey]);
  const H = holes.find((x) => x.hole === h);
  const cur = rs[h];
  const strokes = strokesOnHole(H.si, player.h);
  const t = round.kind === "stableford" ? playerStbl(holes, rs, player.h).pts : playerNetTotal(holes, rs, player.h).net;

  // Soft lock: when submitted, editing a hole asks for confirmation first.
  const guardedSetScore = (pid, hole, val) => {
    if (isSubmitted) {
      if (!window.confirm("This round is already submitted. Edit anyway?")) return;
    }
    setScore(pid, hole, val);
  };

  return (
    <div className="nz-mycard" style={{ ...S.myCard, ...(isSubmitted ? { borderColor: C.birdie } : {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={S.kicker}>Your Card · {player.name} · R{round.n}</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.cream, opacity: 0.85 }}>{thru === 0 ? "Not started" : `Thru ${thru} · ${round.kind === "stableford" ? t + " pts" : t + " net"}`}</div>
      </div>
      {isSubmitted && <div style={S.submittedTag}>✓ SUBMITTED — locked. Tap a score to edit (you'll be asked to confirm). Commissioner can reopen.</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button className="nz-holenav" style={S.holeNav} disabled={h <= 1} onClick={() => setH(Math.max(1, h - 1))}>‹</button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 12, color: C.copperLt, fontFamily: SANS, letterSpacing: 2 }}>HOLE</div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, fontFamily: SANS, textShadow: "0 2px 20px rgba(255,200,120,0.3)" }}>{h}</div>
          <div style={{ fontSize: 13, color: C.cream, opacity: 0.8, fontFamily: SANS }}>Par {H.par} · SI {H.si}{strokes > 0 ? ` · ${strokes} stroke${strokes > 1 ? "s" : ""}` : ""}</div>
        </div>
        <button className="nz-holenav" style={S.holeNav} disabled={h >= 18} onClick={() => setH(Math.min(18, h + 1))}>›</button>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
          const diff = n - H.par; const active = cur === n;
          return <button key={n} className="nz-score" onClick={() => { guardedSetScore(player.id, h, n); if (h < 18) setTimeout(() => setH(h + 1), 200); }} style={{ ...S.scoreBtn, ...(active ? scoreColor(diff) : {}) }}>{n}</button>;
        })}
      </div>
      {cur != null && <div style={{ textAlign: "center", marginTop: 12, fontFamily: SANS, fontSize: 13, color: C.cream, opacity: 0.9 }}>
        Gross {cur} · Net {netHole(cur, H.si, player.h)} on {h}. <button style={S.clearBtn} onClick={() => guardedSetScore(player.id, h, null)}>clear</button></div>}
      {!isSubmitted && (
        <button className="nz-primary" style={{ ...S.primaryBtn, opacity: thru === 18 ? 1 : 0.55 }}
          onClick={() => { if (thru < 18 && !window.confirm(`You've only entered ${thru} of 18 holes. Submit anyway?`)) return; submitRound(player.id, roundKey); }}>
          {thru === 18 ? "Submit Round" : `Submit Round (${thru}/18)`}
        </button>
      )}
    </div>
  );
}

function Scorecard({ player, holes, roundKey }) {
  const rs = player.scores[roundKey] || {};
  const front = holes.slice(0, 9), back = holes.slice(9);
  const sumNet = (arr) => arr.reduce((s, H) => s + (rs[H.hole] != null ? netHole(rs[H.hole], H.si, player.h) : 0), 0);
  const Nine = ({ hs, label }) => (
    <div style={{ overflowX: "auto" }}>
      <table style={S.scTable}><tbody>
        <tr><td style={S.scLbl}>Hole</td>{hs.map((H) => <td key={H.hole} style={S.scH}>{H.hole}</td>)}<td style={S.scTot}>{label}</td></tr>
        <tr><td style={S.scLbl}>Par</td>{hs.map((H) => <td key={H.hole} style={S.scPar}>{H.par}</td>)}<td style={S.scTot}>{hs.reduce((s, H) => s + H.par, 0)}</td></tr>
        <tr><td style={S.scLbl}>Net</td>{hs.map((H) => { const v = rs[H.hole]; const net = v != null ? netHole(v, H.si, player.h) : null; const diff = net != null ? net - H.par : null;
          return <td key={H.hole} style={{ padding: "2px 1px" }}><div style={{ ...S.scVal, ...(diff != null ? scoreColor(diff) : {}) }}>{net ?? "·"}</div></td>; })}
          <td style={{ ...S.scTot, color: C.copperLt }}>{sumNet(hs) || "·"}</td></tr>
      </tbody></table>
    </div>
  );
  return <div style={S.cardOpen}><Nine hs={front} label="OUT" /><Nine hs={back} label="IN" /></div>;
}

const scoreColor = (diff) =>
  diff <= -2 ? { background: "linear-gradient(135deg,#3E8E5A,#2C6B42)", color: "#fff", borderColor: "transparent" }
  : diff === -1 ? { background: "linear-gradient(135deg,#9AD17A,#6FA84E)", color: "#0b1a0b", borderColor: "transparent" }
  : diff === 0 ? { background: "rgba(255,255,255,0.14)", color: C.cream, borderColor: C.copper }
  : diff === 1 ? { background: "linear-gradient(135deg,#6a4a28,#4a3018)", color: C.cream, borderColor: "transparent" }
  : { background: "linear-gradient(135deg,#D2553A,#A23420)", color: "#fff", borderColor: "transparent" };

// ============================================================
// ROUNDS VIEW — read-only summary of each round's format + result
// ============================================================
function RoundsView({ state, tp }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ranked = [...state.players].map((p) => ({ id: p.id, pts: tp.tp[p.id] })).sort((a, b) => b.pts - a.pts).map((x) => x.id);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {ROUNDS.map((r) => (
        <div key={r.key} className="nz-glass" style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={S.cardTitle}>Round {r.n} · {r.name}</div>
            <span style={S.kindTag}>{r.kind.includes("ryder") ? "RYDER" : r.kind === "final" ? "FINAL" : ""}</span>
          </div>
          <div style={{ color: C.copperLt, fontFamily: SANS, fontSize: 13 }}>{r.fmt}</div>
          <RoundDetail r={r} state={state} tp={tp} ranked={ranked} />
        </div>
      ))}
    </div>
  );
}
function RoundDetail({ r, state, tp, ranked }) {
  const P = (id) => state.players.find((x) => x.id === id);
  if (r.kind.includes("ryder")) {
    const ms = r.key === "r1" ? state.ryder.r1 : state.ryder.r2;
    if (!state.ryder.teamA.length) return <p style={S.hint}>Teams not set yet — commissioner assigns Team A / Team B.</p>;
    return <div style={{ marginTop: 8 }}>
      <p style={S.hint}>Auto-scored from each player's hole scores. Counts toward the combined Ryder Cup (6 points across both rounds). Win the majority and each player on the winning team gets 2 TP.</p>
      {(ms || []).map((m) => {
        const res = ryderMatchResult(state.holes, m, state, r.key);
        const color = res.result === "X" ? C.birdie : res.result === "Y" ? C.ocean : res.result === "H" ? C.fescue : C.copperLt;
        return (
          <div key={m.id} style={{ ...S.matchRow, alignItems: "flex-start" }}>
            <span style={{ flex: 1 }}>
              <span style={{ color: res.result === "X" ? C.birdie : C.cream }}>{m.xs.map((id) => P(id)?.name).join(" & ")}</span>
              <span style={{ color: C.fescue }}> vs </span>
              <span style={{ color: res.result === "Y" ? C.ocean : C.cream }}>{m.ys.map((id) => P(id)?.name).join(" & ")}</span>
            </span>
            <span style={{ fontFamily: SANS, color, fontSize: 13, fontWeight: 700, textAlign: "right", minWidth: 90 }}>
              {res.final
                ? (res.result === "H" ? "Halved" : `${res.result === "X" ? m.xs.map((id) => P(id)?.name.split(" ")[0]).join("/") : m.ys.map((id) => P(id)?.name.split(" ")[0]).join("/")} win ${res.status}`)
                : res.status}
            </span>
          </div>
        );
      })}</div>;
  }
  if (r.key === "r4") {
    if (!state.r4.matches.length) return <p style={S.hint}>Pairings set after R3 standings — 1st+8th vs 4th+5th, 2nd+7th vs 3rd+6th.</p>;
    return <div style={{ marginTop: 8 }}>{state.r4.matches.map((m) => { const res = bestBallResult(state.holes, m, state);
      return <div key={m.id} style={S.matchRow}><span style={{ flex: 1 }}>{m.xs.map((id) => P(id)?.name).join(" & ")} <span style={{ color: C.fescue }}>vs</span> {m.ys.map((id) => P(id)?.name).join(" & ")}</span>
        <span style={{ fontFamily: SANS, color: C.copperLt }}>{res.complete ? (res.up > 0 ? `${res.up}↑ X` : res.up < 0 ? `${-res.up}↑ Y` : "AS") : (res.up === 0 ? "—" : `${res.up > 0 ? "+" : ""}${res.up}`)}</span></div>; })}</div>;
  }
  if (r.key === "r6") {
    if (!state.r6.champ.length) return <p style={S.hint}>Final groups set after R5 — top 4 in the Championship group, bottom 4 in the Losers group.</p>;
    return <div style={{ marginTop: 8 }}>
      <div style={{ color: C.copperLt, fontFamily: SANS, fontSize: 12, letterSpacing: 1 }}>CHAMPIONSHIP</div>
      {state.r6.champ.map((id) => <div key={id} style={S.matchRow}><span>{P(id)?.name}</span><span style={{ fontFamily: SANS, color: C.fescue }}>{playerNetTotal(state.holes, P(id)?.scores.r6, P(id)?.h).thru === 18 ? playerNetTotal(state.holes, P(id)?.scores.r6, P(id)?.h).net + " net" : "—"}</span></div>)}
      <div style={{ color: C.fescue, fontFamily: SANS, fontSize: 12, letterSpacing: 1, marginTop: 8 }}>LOSERS</div>
      {state.r6.losers.map((id) => <div key={id} style={S.matchRow}><span>{P(id)?.name}</span><span style={{ fontFamily: SANS, color: C.fescue }}>{playerNetTotal(state.holes, P(id)?.scores.r6, P(id)?.h).thru === 18 ? playerNetTotal(state.holes, P(id)?.scores.r6, P(id)?.h).net + " net" : "—"}</span></div>)}
    </div>;
  }
  // stableford / stroke ranking preview
  const isStbl = r.kind === "stableford";
  const vals = state.players.map((p) => { const v = isStbl ? playerStbl(state.holes, p.scores[r.key], p.h) : playerNetTotal(state.holes, p.scores[r.key], p.h);
    return { id: p.id, val: isStbl ? v.pts : v.net, thru: v.thru }; });
  const any = vals.some((v) => v.thru > 0);
  if (!any) return <p style={S.hint}>{isStbl ? "Net Stableford — best points total earns 7 TP down to 0 for last." : "Net stroke play — lowest net earns 7 TP down to 0 for last."}</p>;
  const sorted = [...vals].sort((a, b) => isStbl ? b.val - a.val : a.val - b.val);
  return <div style={{ marginTop: 8 }}>{sorted.map((v, i) => <div key={v.id} style={S.matchRow}><span style={{ flex: 1 }}>{i + 1}. {P(v.id)?.name}</span><span style={{ fontFamily: SANS, color: C.copperLt }}>{v.thru ? (isStbl ? v.val + " pts" : v.val + " net") : "—"}</span></div>)}</div>;
}

// ============================================================
// COMMISH
// ============================================================
// Commish-owned fields that Save commits. Player scores + bets are NOT here —
// they stay live and are preserved on merge so a Save never wipes them.
const COMMISH_FIELDS = ["tournamentName", "holes", "ryder", "r4", "r6", "manualTP", "markets"];

// Merge a commish draft onto the freshest live state without clobbering live scores/bets.
function mergeCommishDraft(latest, draft) {
  const out = JSON.parse(JSON.stringify(latest));
  COMMISH_FIELDS.forEach((f) => { if (draft[f] !== undefined) out[f] = draft[f]; });
  out.players = latest.players.map((lp) => {
    const dp = draft.players.find((p) => p.id === lp.id);
    return dp ? { ...lp, name: dp.name, h: dp.h, scores: lp.scores } : lp;
  });
  out.bets = latest.bets; // bets are placed/settled live, never from a stale draft
  return out;
}

function Commish({ state, save, flash, tp }) {
  const [section, setSection] = useState("setup");
  // Draft: a working copy commish edits freely. Starts as a clone of live state.
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(state)));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // If live state changes (someone else saved, or scores came in) and we have NO
  // unsaved edits, refresh our draft so we're editing current data.
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(JSON.stringify(state)));
  }, [state, dirty]);

  // draftSave mimics the live save() signature but only updates the local draft.
  const draftSave = useCallback(async (next) => {
    setDraft(next);
    setDirty(true);
  }, []);

  // Commit: pull freshest live data, merge commish fields, write once.
  const commit = async () => {
    setSaving(true);
    try {
      const latest = (await loadState()) || state;
      const merged = migrate(mergeCommishDraft(migrate(latest), draft));
      await save(merged);
      setDirty(false);
      setDraft(JSON.parse(JSON.stringify(merged)));
      flash("Saved — live for everyone ✓");
    } catch (e) {
      console.error(e); flash("Save failed — try again.");
    }
    setSaving(false);
  };

  const discard = () => { setDraft(JSON.parse(JSON.stringify(state))); setDirty(false); flash("Changes discarded."); };

  // Settlement pays real money, so it commits immediately (not a draft action).
  const liveSettle = save;

  const P = (id) => draft.players.find((x) => x.id === id);
  const ranked = [...draft.players].map((p) => ({ id: p.id, pts: tp.tp[p.id] })).sort((a, b) => b.pts - a.pts).map((x) => x.id);

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: dirty ? 72 : 0 }}>
      <div className="nz-glass" style={S.card}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["setup", "Setup"], ["ryder", "Ryder R1–2"], ["r4", "R4 Pairings"], ["r6", "R6 Groups"], ["book", "The Book"], ["clear", "Clear Scores"], ["tp", "TP Override"]].map(([k, l]) => (
            <button key={k} onClick={() => setSection(k)} style={{ ...S.roundPill, ...(section === k ? S.roundPillOn : {}) }}>{l}</button>
          ))}
        </div>
        <p style={S.hint}>Edits are held as a draft on your screen until you press <b>Save</b>. Player scores keep updating live the whole time and are never overwritten by your save.</p>
      </div>

      {section === "setup" && <CommishSetup state={draft} save={draftSave} flash={flash} />}
      {section === "ryder" && <CommishRyder state={draft} save={draftSave} flash={flash} />}
      {section === "r4" && <CommishR4 state={draft} save={draftSave} flash={flash} ranked={ranked} />}
      {section === "r6" && <CommishR6 state={draft} save={draftSave} flash={flash} ranked={ranked} />}
      {section === "book" && <CommishBook state={draft} save={draftSave} liveSettle={liveSettle} flash={flash} tp={tp} />}
      {section === "clear" && <CommishClear state={draft} liveSave={liveSettle} flash={flash} />}
      {section === "tp" && <CommishTP state={draft} save={draftSave} flash={flash} tp={tp} />}

      {dirty && (
        <div style={S.saveBar} className="nz-fade">
          <div style={{ flex: 1, fontFamily: SANS, fontSize: 13, color: "#1a0f08" }}><b>Unsaved changes</b> — not live yet</div>
          <button onClick={discard} style={S.discardBtn}>Discard</button>
          <button onClick={commit} disabled={saving} style={S.saveBtn}>{saving ? "Saving…" : "Save & go live"}</button>
        </div>
      )}
    </div>
  );
}

function CommishSetup({ state, save, flash }) {
  const [tName, setTName] = useState(state.tournamentName);
  const setSI = async (hole, si) => { const holes = state.holes.map((H) => H.hole === hole ? { ...H, si: Math.max(1, Math.min(18, parseInt(si) || H.si)) } : H); await save({ ...state, holes }); };
  const setPar = async (hole, par) => { const holes = state.holes.map((H) => H.hole === hole ? { ...H, par: Math.max(3, Math.min(6, parseInt(par) || H.par)) } : H); await save({ ...state, holes }); };
  const setHcp = async (id, h) => { const players = state.players.map((p) => p.id === id ? { ...p, h: parseFloat(h) || 0 } : p); await save({ ...state, players }); };
  return (
    <>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Tournament Name</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="nz-input" style={S.input} value={tName} onChange={(e) => setTName(e.target.value)} />
          <button className="nz-small" style={S.smallBtn} onClick={() => { save({ ...state, tournamentName: tName.trim() || state.tournamentName }); flash("Saved."); }}>Save</button>
        </div>
      </div>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Handicaps</div>
        <div style={{ display: "grid", gap: 1, marginTop: 8 }}>
          {state.players.map((p) => (
            <div key={p.id} style={S.lbRow}><span style={{ flex: 1 }}>{p.name}</span>
              <input className="nz-input" style={{ ...S.input, width: 64 }} type="number" defaultValue={p.h} onBlur={(e) => setHcp(p.id, e.target.value)} /></div>
          ))}
        </div>
      </div>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Scorecard — Par & Stroke Index</div>
        <p style={S.hint}>Enter the real Nanea stroke index (1 = hardest hole). Net strokes allocate by these.</p>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ ...S.scTable, minWidth: 520 }}><tbody>
            <tr><td style={S.scLbl}>Hole</td>{state.holes.map((H) => <td key={H.hole} style={S.scH}>{H.hole}</td>)}</tr>
            <tr><td style={S.scLbl}>Par</td>{state.holes.map((H) => <td key={H.hole} style={{ padding: 2 }}><input style={S.miniInput} type="number" defaultValue={H.par} onBlur={(e) => setPar(H.hole, e.target.value)} /></td>)}</tr>
            <tr><td style={S.scLbl}>SI</td>{state.holes.map((H) => <td key={H.hole} style={{ padding: 2 }}><input style={S.miniInput} type="number" defaultValue={H.si} onBlur={(e) => setSI(H.hole, e.target.value)} /></td>)}</tr>
          </tbody></table>
        </div>
      </div>
    </>
  );
}

function CommishRyder({ state, save, flash }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ry = state.ryder;
  const toggleTeam = async (id, team) => {
    const other = team === "teamA" ? "teamB" : "teamA";
    let A = new Set(ry.teamA), B = new Set(ry.teamB);
    const cur = team === "teamA" ? A : B, oth = team === "teamA" ? B : A;
    if (cur.has(id)) cur.delete(id); else { cur.add(id); oth.delete(id); }
    await save({ ...state, ryder: { ...ry, teamA: [...A], teamB: [...B] } });
  };
  const addMatch = async (key) => {
    const m = { id: uid(), side: "A", xs: [], ys: [], result: "" };
    await save({ ...state, ryder: { ...ry, [key]: [...(ry[key] || []), m] } });
  };
  const updMatch = async (key, id, patch) => {
    const arr = ry[key].map((m) => m.id === id ? { ...m, ...patch } : m);
    await save({ ...state, ryder: { ...ry, [key]: arr } });
  };
  const rmMatch = async (key, id) => save({ ...state, ryder: { ...ry, [key]: ry[key].filter((m) => m.id !== id) } });

  const PlayerPicker = ({ value, onPick, pool }) => (
    <select className="nz-input" style={{ ...S.input, padding: "7px 8px", fontSize: 13 }} value={value || ""} onChange={(e) => onPick(e.target.value)}>
      <option value="">—</option>
      {pool.map((id) => <option key={id} value={id}>{P(id)?.name}</option>)}
    </select>
  );

  const MatchEditor = ({ key2, m, partners }) => {
    const res = ryderMatchResult(state.holes, m, state, key2);
    const color = res.result === "X" ? C.birdie : res.result === "Y" ? C.ocean : res.result === "H" ? C.fescue : C.copperLt;
    return (
    <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, width: 50 }}>Team A</span>
        <PlayerPicker value={m.xs[0]} pool={ry.teamA} onPick={(v) => updMatch(key2, m.id, { xs: partners ? [v, m.xs[1]] : [v] })} />
        {partners && <PlayerPicker value={m.xs[1]} pool={ry.teamA} onPick={(v) => updMatch(key2, m.id, { xs: [m.xs[0], v] })} />}
        <button style={S.xBtn} onClick={() => rmMatch(key2, m.id)}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, width: 50 }}>Team B</span>
        <PlayerPicker value={m.ys[0]} pool={ry.teamB} onPick={(v) => updMatch(key2, m.id, { ys: partners ? [v, m.ys[1]] : [v] })} />
        {partners && <PlayerPicker value={m.ys[1]} pool={ry.teamB} onPick={(v) => updMatch(key2, m.id, { ys: [m.ys[0], v] })} />}
      </div>
      <div style={{ marginTop: 8, padding: "7px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8, fontFamily: SANS, fontSize: 13, color }}>
        Auto: {res.final ? (res.result === "H" ? "Halved — ½ pt each" : `Team ${res.result === "X" ? "A" : "B"} wins ${res.status}`) : res.status}
      </div>
    </div>
  );
  };

  return (
    <>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Assign Teams</div>
        <p style={S.hint}>Tap to put a player on Team A or Team B (4 each).</p>
        <div style={{ display: "grid", gap: 1, marginTop: 8 }}>
          {state.players.map((p) => (
            <div key={p.id} style={S.lbRow}>
              <span style={{ flex: 1 }}>{p.name} <span style={{ color: C.fescue }}>· {p.h}</span></span>
              <button onClick={() => toggleTeam(p.id, "teamA")} style={{ ...S.teamBtn, ...(ry.teamA.includes(p.id) ? S.teamBtnA : {}) }}>A</button>
              <button onClick={() => toggleTeam(p.id, "teamB")} style={{ ...S.teamBtn, ...(ry.teamB.includes(p.id) ? S.teamBtnB : {}) }}>B</button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 12, color: C.fescue }}>A: {ry.teamA.length}/4 · B: {ry.teamB.length}/4</div>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round 1 — Scramble (2 matches)</div>
        {(ry.r1 || []).map((m) => <MatchEditor key={m.id} key2="r1" m={m} partners />)}
        <button className="nz-small" style={{ ...S.smallBtn, marginTop: 10 }} onClick={() => addMatch("r1")}>+ scramble match</button>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round 2 — Singles (4 matches)</div>
        {(ry.r2 || []).map((m) => <MatchEditor key={m.id} key2="r2" m={m} />)}
        <button className="nz-small" style={{ ...S.smallBtn, marginTop: 10 }} onClick={() => addMatch("r2")}>+ singles match</button>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Tiebreaker</div>
        <p style={S.hint}>If the Ryder Cup ends all square, enter the captain-vs-captain playoff winner.</p>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {[["", "None"], ["A", "Team A"], ["B", "Team B"]].map(([v, l]) => (
            <button key={v} onClick={() => save({ ...state, ryder: { ...ry, playoff: v } })} style={{ ...S.resultBtn, ...(ry.playoff === v ? S.resultOn : {}) }}>{l}</button>
          ))}
        </div>
      </div>
    </>
  );
}

function CommishR4({ state, save, flash, ranked }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const autobuild = async () => {
    if (ranked.length < 8) return flash("Need standings first.");
    const matches = [
      { id: uid(), xs: [ranked[0], ranked[7]], ys: [ranked[3], ranked[4]] }, // 1st+8th vs 4th+5th
      { id: uid(), xs: [ranked[1], ranked[6]], ys: [ranked[2], ranked[5]] }, // 2nd+7th vs 3rd+6th
    ];
    await save({ ...state, r4: { matches } });
    flash("Pairings built from standings.");
  };
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Round 4 — Best Ball Pairings</div>
      <p style={S.hint}>Auto-build from current standings: 1st+8th vs 4th+5th, and 2nd+7th vs 3rd+6th. Each player on a winning pair earns 4 TP.</p>
      <button className="nz-small" style={{ ...S.smallBtn, marginTop: 10 }} onClick={autobuild}>Auto-build from standings</button>
      <div style={{ marginTop: 12 }}>
        {state.r4.matches.map((m, i) => (
          <div key={m.id} style={S.matchRow}><span style={{ flex: 1 }}>Match {i + 1}: {m.xs.map((id) => P(id)?.name).join(" & ")} <span style={{ color: C.fescue }}>vs</span> {m.ys.map((id) => P(id)?.name).join(" & ")}</span></div>
        ))}
        {!state.r4.matches.length && <p style={S.hint}>No pairings yet.</p>}
      </div>
    </div>
  );
}

function CommishR6({ state, save, flash, ranked }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const build = async () => {
    if (ranked.length < 8) return flash("Need standings first.");
    await save({ ...state, r6: { ...state.r6, champ: ranked.slice(0, 4), losers: ranked.slice(4) } });
    flash("Final groups set.");
  };
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Round 6 — Final Groups</div>
      <p style={S.hint}>Top 4 by TP play the Championship group (low net wins the tournament). Bottom 4 play the Losers group (high net is the tournament loser).</p>
      <button className="nz-small" style={{ ...S.smallBtn, marginTop: 10 }} onClick={build}>Build groups from standings</button>
      {state.r6.champ.length > 0 && <div style={{ marginTop: 12 }}>
        <div style={{ color: C.copperLt, fontFamily: SANS, fontSize: 12, letterSpacing: 1 }}>CHAMPIONSHIP</div>
        {state.r6.champ.map((id) => <div key={id} style={S.matchRow}><span>{P(id)?.name}</span></div>)}
        <div style={{ color: C.fescue, fontFamily: SANS, fontSize: 12, letterSpacing: 1, marginTop: 8 }}>LOSERS</div>
        {state.r6.losers.map((id) => <div key={id} style={S.matchRow}><span>{P(id)?.name}</span></div>)}
      </div>}
    </div>
  );
}

function CommishTP({ state, save, flash, tp }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const setDelta = async (id, v) => { const manualTP = { ...state.manualTP, [id]: parseFloat(v) || 0 }; await save({ ...state, manualTP }); };
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Manual TP Adjustment</div>
      <p style={S.hint}>Rarely needed — adds/subtracts TP on top of auto-calculated points (e.g. a special bonus or correction).</p>
      <div style={{ display: "grid", gap: 1, marginTop: 8 }}>
        {state.players.map((p) => (
          <div key={p.id} style={S.lbRow}>
            <span style={{ flex: 1 }}>{p.name}</span>
            <span style={{ fontFamily: SANS, color: C.fescue, fontSize: 13, marginRight: 8 }}>auto {fmtTP(tp.tp[p.id] - (Number(state.manualTP[p.id]) || 0))}</span>
            <input className="nz-input" style={{ ...S.input, width: 70 }} type="number" defaultValue={state.manualTP[p.id] || 0} onBlur={(e) => setDelta(p.id, e.target.value)} placeholder="±0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// BETTING — auto-odds from standings/scores, public open bets,
// commissioner override + settlement.
// ============================================================

const americanToMult = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const probToAmerican = (p) => { p = Math.max(0.04, Math.min(0.90, p)); return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100); };
const softmax = (s, t = 1) => { const m = Math.max(...s); const e = s.map((x) => Math.exp((x - m) / t)); const sum = e.reduce((a, b) => a + b, 0); return e.map((x) => x / sum); };
const round5 = (n) => { const a = Math.abs(n); let r; if (a < 150) r = Math.round(a / 5) * 5; else if (a < 300) r = Math.round(a / 10) * 10; else r = Math.round(a / 25) * 25; return n < 0 ? -r : r; };
const withVig = (am, vig = 0.05) => round5(am < 0 ? Math.round(am * (1 + vig)) : Math.round(am * (1 - vig)));

// Build auto-odds for "outright tournament winner" and "win next round" from current TP.
function autoOddsByTP(state, tp) {
  const ps = state.players.map((p) => ({ id: p.id, name: p.name, tp: tp.tp[p.id] }));
  const strengths = ps.map((p) => p.tp + 8);
  const probs = softmax(strengths, 10);
  return ps.map((p, i) => ({ id: p.id, label: p.name, odds: withVig(probToAmerican(probs[i])) }));
}

// Regenerate odds for a market if it's auto (not manually pinned).
function refreshedOptions(market, state, tp) {
  if (market.kind === "outright" || market.kind === "next_round") {
    const auto = autoOddsByTP(state, tp);
    return market.options.map((o) => {
      if (o.manual) return o; // commissioner pinned this line
      const a = auto.find((x) => x.id === o.optionId);
      return a ? { ...o, odds: a.odds } : o;
    });
  }
  return market.options;
}

function BookView({ state, tp, me, setName, save, flash }) {
  const [sel, setSel] = useState(null); // {marketId, optionId, label, odds, title}
  const [stake, setStake] = useState("");
  const P = (id) => state.players.find((x) => x.id === id);

  const place = async () => {
    if (!me) return flash("Check in with your name first.");
    if (!sel) return flash("Tap a line to bet.");
    const s = parseFloat(stake);
    if (!s || s <= 0) return flash("Enter a stake.");
    const bet = { id: uid(), who: me, marketId: sel.marketId, optionId: sel.optionId, label: `${sel.title} — ${sel.label}`,
      stake: s, oddsAtBet: sel.odds, status: "pending", payout: +(s * americanToMult(sel.odds)).toFixed(2), ts: Date.now() };
    await save({ ...state, bets: [...state.bets, bet] });
    setSel(null); setStake("");
    flash(`Locked: $${s} to win $${(bet.payout - s).toFixed(2)}`);
  };

  const openMarkets = state.markets.filter((m) => m.status !== "settled");

  // ledger for the standings strip
  const ledger = {}; state.players.forEach((p) => (ledger[p.name] = 0));
  state.bets.forEach((b) => { if (!(b.who in ledger)) ledger[b.who] = 0; if (b.status === "won") ledger[b.who] += b.payout - b.stake; else if (b.status === "lost") ledger[b.who] -= b.stake; });
  const ledgerRows = Object.entries(ledger).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!me && <div className="nz-glass" style={S.card}><div style={S.cardTitle}>Check in to bet</div>
        <select className="nz-input" style={S.input} defaultValue="" onChange={(e) => e.target.value && setName(e.target.value)}>
          <option value="" disabled>pick your name</option>
          {state.players.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select></div>}

      {!openMarkets.length && <Empty msg="No betting lines open yet. The commissioner opens markets — odds move automatically as scores and points change." />}

      {openMarkets.map((m) => {
        const opts = refreshedOptions(m, state, tp);
        const betsOnMarket = state.bets.filter((b) => b.marketId === m.id);
        return (
          <div key={m.id} className="nz-glass" style={S.card}>
            <div style={S.cardTop}><span style={S.kindTag}>{m.kind === "outright" ? "OUTRIGHT" : m.kind === "next_round" ? "NEXT ROUND" : "PROP"}</span>
              {m.live && <span style={{ ...S.kindTag, color: C.birdie }}>● LIVE ODDS</span>}</div>
            <div style={S.cardTitle}>{m.title}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {opts.map((o) => {
                const active = sel && sel.marketId === m.id && sel.optionId === o.optionId;
                return (
                  <button key={o.optionId} className="nz-oddsbtn" onClick={() => setSel({ marketId: m.id, optionId: o.optionId, label: o.label, odds: o.odds, title: m.title })}
                    style={{ ...S.oddsChip, ...(active ? S.oddsSelected : {}) }}>
                    <span style={S.oddsLabel}>{o.label}</span>
                    <span style={S.oddsNum}>{o.odds > 0 ? `+${o.odds}` : o.odds}{o.manual ? " ✎" : ""}</span>
                  </button>
                );
              })}
            </div>
            {/* public open bets on this market */}
            {betsOnMarket.length > 0 && (
              <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, marginBottom: 6 }}>WHO'S IN</div>
                {betsOnMarket.map((b) => {
                  const opt = m.options.find((o) => o.optionId === b.optionId);
                  return <div key={b.id} style={S.openBetRow}>
                    <span style={{ flex: 1 }}><b>{b.who}</b> · {opt?.label}</span>
                    <span style={{ fontFamily: SANS, color: C.copperLt }}>${b.stake} @ {b.oddsAtBet > 0 ? `+${b.oddsAtBet}` : b.oddsAtBet}</span>
                  </div>;
                })}
              </div>
            )}
          </div>
        );
      })}

      {sel && (
        <div className="nz-glass" style={S.betSlip}>
          <div style={S.slipKicker}>BET SLIP</div>
          <div style={S.slipPick}>{sel.title}<br /><strong style={{ color: C.copperLt }}>{sel.label}</strong> @ {sel.odds > 0 ? `+${sel.odds}` : sel.odds}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <span style={{ color: C.cream, opacity: 0.8 }}>$</span>
            <input className="nz-input" style={S.input} type="number" placeholder="stake" value={stake} onChange={(e) => setStake(e.target.value)} />
          </div>
          {stake > 0 && <div style={S.payout}>To win <strong>${(stake * americanToMult(sel.odds) - stake).toFixed(2)}</strong> · returns ${(stake * americanToMult(sel.odds)).toFixed(2)}</div>}
          <button className="nz-primary" style={S.primaryBtn} onClick={place}>Lock it in</button>
          <button onClick={() => setSel(null)} style={{ ...S.clearBtn, display: "block", margin: "10px auto 0" }}>cancel</button>
        </div>
      )}

      {/* money board */}
      {ledgerRows.some(([, v]) => v !== 0) && (
        <div className="nz-glass" style={S.card}>
          <div style={S.cardTitle}>The Money</div>
          <p style={S.hint}>Net position from settled bets. Square up at the clubhouse.</p>
          <div style={{ display: "grid", gap: 1, marginTop: 8 }}>
            {ledgerRows.map(([name, amt]) => (
              <div key={name} style={S.lbRow}><span style={{ flex: 1 }}>{name}</span>
                <span style={{ fontFamily: SANS, fontWeight: 700, color: amt > 0 ? C.birdie : amt < 0 ? C.bogeyBad : C.fescue }}>{amt > 0 ? "+" : ""}${amt.toFixed(2)}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* settled history */}
      {state.bets.some((b) => b.status !== "pending") && (
        <div className="nz-glass" style={S.card}>
          <div style={S.cardTitle}>Settled Bets</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {[...state.bets].filter((b) => b.status !== "pending").reverse().map((b) => (
              <div key={b.id} style={S.betRow}>
                <div><div style={{ fontWeight: 600 }}>{b.who}</div><div style={{ fontSize: 13, color: C.fescue }}>{b.label}</div></div>
                <div style={{ textAlign: "right", fontFamily: SANS }}><div>${b.stake}</div><div style={{ fontSize: 12, color: b.status === "won" ? C.birdie : C.bogeyBad }}>{b.status.toUpperCase()}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Commissioner betting controls ----
function CommishBook({ state, save, flash, tp, liveSettle }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const [propTitle, setPropTitle] = useState("");
  const [propOpts, setPropOpts] = useState([{ label: "", odds: "" }, { label: "", odds: "" }]);

  const openOutright = async () => {
    const auto = autoOddsByTP(state, tp);
    const m = { id: uid(), title: "Tournament Winner", kind: "outright", live: true, status: "open",
      options: auto.map((a) => ({ optionId: a.id, label: a.label, odds: a.odds, manual: false })) };
    await save({ ...state, markets: [...state.markets, m] });
    flash("Outright market opened — odds auto-update.");
  };
  const openNextRound = async () => {
    const auto = autoOddsByTP(state, tp);
    const m = { id: uid(), title: "Wins the Next Round", kind: "next_round", live: true, status: "open",
      options: auto.map((a) => ({ optionId: a.id, label: a.label, odds: a.odds, manual: false })) };
    await save({ ...state, markets: [...state.markets, m] });
    flash("Next-round market opened.");
  };
  const addProp = async () => {
    if (!propTitle.trim()) return flash("Title needed.");
    const opts = propOpts.filter((o) => o.label.trim()).map((o) => ({ optionId: uid(), label: o.label.trim(), odds: parseInt(o.odds) || 100, manual: true }));
    if (opts.length < 2) return flash("Need 2+ options.");
    const m = { id: uid(), title: propTitle.trim(), kind: "prop", live: false, status: "open", options: opts };
    await save({ ...state, markets: [...state.markets, m] });
    setPropTitle(""); setPropOpts([{ label: "", odds: "" }, { label: "", odds: "" }]);
    flash("Prop posted.");
  };
  const overrideOdds = async (marketId, optionId, odds) => {
    const markets = state.markets.map((m) => m.id !== marketId ? m : { ...m, options: m.options.map((o) => o.optionId === optionId ? { ...o, odds: parseInt(odds) || o.odds, manual: true } : o) });
    await save({ ...state, markets });
    flash("Line pinned (won't auto-move).");
  };
  const unpin = async (marketId, optionId) => {
    const markets = state.markets.map((m) => m.id !== marketId ? m : { ...m, options: m.options.map((o) => o.optionId === optionId ? { ...o, manual: false } : o) });
    await save({ ...state, markets });
    flash("Line back to auto.");
  };
  const settle = async (marketId, winningOptionId) => {
    // Settlement pays real money — commit immediately against the FRESHEST live data,
    // not the draft (which may have stale bets). Pull fresh, settle, write live.
    const latest = migrate((await loadState()) || state);
    const markets = latest.markets.map((m) => m.id === marketId ? { ...m, status: "settled", winnerId: winningOptionId } : m);
    const bets = latest.bets.map((b) => (b.marketId === marketId && b.status === "pending") ? { ...b, status: b.optionId === winningOptionId ? "won" : "lost" } : b);
    await liveSettle({ ...latest, markets, bets });
    flash("Market settled live — money board updated.");
  };
  const rmMarket = async (marketId) => save({ ...state, markets: state.markets.filter((m) => m.id !== marketId), bets: state.bets.filter((b) => b.marketId !== marketId) });
  const clearAllBets = async () => {
    // Wipes every bet (pending + settled) against the freshest live data. Markets stay.
    const latest = migrate((await loadState()) || state);
    await liveSettle({ ...latest, bets: [] });
    flash("All bets cleared.");
  };
  const clearPendingBets = async () => {
    const latest = migrate((await loadState()) || state);
    await liveSettle({ ...latest, bets: latest.bets.filter((b) => b.status !== "pending") });
    flash("Outstanding (unsettled) bets cleared.");
  };
  const deleteBet = async (betId) => {
    const latest = migrate((await loadState()) || state);
    await liveSettle({ ...latest, bets: latest.bets.filter((b) => b.id !== betId) });
    flash("Bet removed.");
  };

  return (
    <>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Open a Market</div>
        <p style={S.hint}>Auto markets price themselves off the live standings and re-quote as points change. You can pin any single line to a fixed number.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="nz-small" style={S.smallBtn} onClick={openOutright}>+ Tournament Winner</button>
          <button className="nz-small" style={S.smallBtn} onClick={openNextRound}>+ Wins Next Round</button>
        </div>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Clear Bets</div>
        <p style={S.hint}>{state.bets.length === 0 ? "No bets on the board." : `${state.bets.filter((b) => b.status === "pending").length} outstanding · ${state.bets.length} total on the board.`} Clearing acts on live data immediately.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={{ ...S.miniGhost, padding: "11px 16px" }}
            onClick={() => { if (state.bets.some((b) => b.status === "pending") && window.confirm("Clear all OUTSTANDING (unsettled) bets? Settled bets and the money board stay.")) clearPendingBets(); }}>Clear outstanding bets</button>
          <button style={{ ...S.miniGhost, padding: "11px 16px", color: C.bogeyBad, borderColor: "rgba(224,117,85,0.5)" }}
            onClick={() => { if (state.bets.length && window.confirm("Clear ALL bets, including settled ones? This wipes the entire bet history and money board. Cannot be undone.")) clearAllBets(); }}>Clear ALL bets</button>
        </div>
        {state.bets.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, marginBottom: 6 }}>REMOVE A SINGLE BET</div>
            <div style={{ display: "grid", gap: 6 }}>
              {[...state.bets].reverse().map((b) => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{b.who} · ${b.stake}</div>
                    <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>{b.label} @ {b.oddsAtBet > 0 ? `+${b.oddsAtBet}` : b.oddsAtBet} · {b.status}</div>
                  </div>
                  <button style={{ ...S.miniGhost, color: C.bogeyBad, borderColor: "rgba(224,117,85,0.5)" }}
                    onClick={() => { if (window.confirm(`Remove ${b.who}'s $${b.stake} bet on ${b.label}?`)) deleteBet(b.id); }}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Custom Prop</div>
        <input className="nz-input" style={S.input} placeholder='e.g. "Longest drive on 17"' value={propTitle} onChange={(e) => setPropTitle(e.target.value)} />
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {propOpts.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input className="nz-input" style={{ ...S.input, flex: 2 }} placeholder={`Option ${i + 1}`} value={o.label} onChange={(e) => setPropOpts(propOpts.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <input className="nz-input" style={{ ...S.input, flex: 1 }} placeholder="odds ±" value={o.odds} onChange={(e) => setPropOpts(propOpts.map((x, j) => j === i ? { ...x, odds: e.target.value } : x))} />
              {propOpts.length > 2 && <button style={S.xBtn} onClick={() => setPropOpts(propOpts.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <button className="nz-small" style={S.smallBtn} onClick={() => setPropOpts([...propOpts, { label: "", odds: "" }])}>+ option</button>
        </div>
        <button className="nz-primary" style={S.primaryBtn} onClick={addProp}>Post prop</button>
      </div>

      {state.markets.map((m) => {
        const opts = refreshedOptions(m, state, tp);
        return (
          <div key={m.id} className="nz-glass" style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={S.cardTitle}>{m.title}</div>
              <button style={S.xBtn} onClick={() => rmMarket(m.id)}>✕</button>
            </div>
            <div style={S.kindTag}>{m.status === "settled" ? "SETTLED" : m.kind.toUpperCase()}</div>
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {opts.map((o) => (
                <div key={o.optionId} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{o.label} <span style={{ color: C.copperLt, fontFamily: SANS }}>{o.odds > 0 ? `+${o.odds}` : o.odds}</span>{o.manual ? <span style={{ color: C.fescue, fontSize: 11 }}> pinned</span> : ""}</span>
                  {m.status !== "settled" && <>
                    <input className="nz-input" style={{ ...S.input, width: 70, padding: "6px 8px" }} placeholder="set" onKeyDown={(e) => { if (e.key === "Enter") overrideOdds(m.id, o.optionId, e.target.value); }} />
                    {o.manual && <button style={S.miniGhost} onClick={() => unpin(m.id, o.optionId)}>auto</button>}
                    <button style={S.miniGhost} onClick={() => settle(m.id, o.optionId)}>won</button>
                  </>}
                </div>
              ))}
            </div>
            {m.status !== "settled" && <p style={S.hint}>Type a number + Enter to pin a line. "won" settles the market and pays out.</p>}
          </div>
        );
      })}
    </>
  );
}


const Empty = ({ msg }) => <div className="nz-glass" style={{ ...S.card, textAlign: "center", color: C.fescue, padding: 36, fontFamily: SANS }}>{msg}</div>;

// ---- per-player, per-round score clear ----
function CommishClear({ state, liveSave, flash }) {
  const [pid, setPid] = React.useState("");
  const player = state.players.find((p) => p.id === pid);
  const clearOne = async (rKey, rName) => {
    if (!player) return;
    if (!window.confirm(`Clear ${player.name}'s ${rName} scores? This erases their card for that round and reopens it.`)) return;
    const latest = migrate((await loadState()) || state);
    const players = latest.players.map((p) => {
      if (p.id !== pid) return p;
      const scores = { ...p.scores }; delete scores[rKey];
      return { ...p, scores, submitted: { ...(p.submitted || {}), [rKey]: false } };
    });
    await liveSave({ ...latest, players });
    flash(`Cleared ${player.name}'s ${rName}.`);
  };
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Clear a Player's Round</div>
      <p style={S.hint}>Pick a player, then clear any single round's scores. Acts live immediately.</p>
      <select className="nz-input" style={{ ...S.input, marginTop: 10 }} value={pid} onChange={(e) => setPid(e.target.value)}>
        <option value="">Select a player…</option>
        {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {player && (
        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          {ROUNDS.map((r) => {
            const thru = state.holes.filter((H) => (player.scores[r.key] || {})[H.hole] != null).length;
            const sub = !!(player.submitted && player.submitted[r.key]);
            return (
              <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: `1px solid ${C.line}` }}>
                <span style={{ flex: 1, fontFamily: SANS, fontSize: 14 }}>R{r.n} · {r.name}
                  <span style={{ color: C.fescue, fontSize: 12 }}>  {thru ? `${thru}/18${sub ? " ✓ submitted" : ""}` : "no scores"}</span>
                </span>
                <button disabled={!thru} style={{ ...S.miniGhost, color: thru ? C.bogeyBad : C.fescue, borderColor: thru ? "rgba(224,117,85,0.5)" : C.glassBorder, opacity: thru ? 1 : 0.5 }}
                  onClick={() => clearOne(r.key, `Round ${r.n}`)}>Clear</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- pin gate ----
function PinGate({ pinEntry, setPinEntry, onTry }) {
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Commissioner Access</div>
      <p style={{ color: C.fescue, fontSize: 14, fontFamily: SANS }}>Sets teams, pairings, results, and the scorecard.</p>
      <input className="nz-input" style={S.input} type="password" placeholder="PIN" value={pinEntry} onChange={(e) => setPinEntry(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onTry(); }} />
      <button className="nz-primary" style={S.primaryBtn} onClick={onTry}>Enter</button>
    </div>
  );
}

// ---- animated hero ----
function Hero({ name, sub, badge, minimal }) {
  // Tries your real photo (public/clubhouse.jpg) and logo (public/logo.png).
  // If a file isn't there, it falls back to the animated sunset so nothing breaks.
  const [photoOk, setPhotoOk] = useState(true);
  const [logoOk, setLogoOk] = useState(true);

  return (
    <div style={S.hero}>
      {photoOk ? (
        <>
          <img src="/clubhouse.jpg" alt="Nanea Golf Club" style={S.heroPhoto} onError={() => setPhotoOk(false)} />
          <div style={S.heroPhotoScrim} />
        </>
      ) : (
        <>
          <svg style={S.heroSvg} viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#241133" /><stop offset="38%" stopColor="#7A2E5A" /><stop offset="64%" stopColor="#D9633F" /><stop offset="84%" stopColor="#F2A65A" /><stop offset="100%" stopColor="#F6C97D" /></linearGradient>
              <radialGradient id="sun" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FFF1D0" /><stop offset="45%" stopColor="#FFD98A" /><stop offset="100%" stopColor="#F2A65A" stopOpacity="0" /></radialGradient>
              <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8915A" /><stop offset="40%" stopColor="#9C5A6E" /><stop offset="100%" stopColor="#1B2A4A" /></linearGradient>
              <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2A1838" /><stop offset="100%" stopColor="#14202E" /></linearGradient>
            </defs>
            <rect x="0" y="0" width="400" height="158" fill="url(#sky)" />
            <g className="nz-clouds" opacity="0.35"><ellipse cx="80" cy="48" rx="70" ry="9" fill="#FFD98A" opacity="0.4" /><ellipse cx="300" cy="70" rx="90" ry="10" fill="#F2A65A" opacity="0.35" /><ellipse cx="200" cy="34" rx="60" ry="7" fill="#FFE9C0" opacity="0.3" /></g>
            <circle className="nz-sunglow" cx="200" cy="150" r="120" fill="url(#sun)" />
            <circle className="nz-sun" cx="200" cy="150" r="30" fill="#FFF1D0" />
            <path d="M0 158 L70 96 L120 130 L175 78 L230 130 L300 92 L400 150 L400 158 Z" fill="url(#mtn)" opacity="0.95" />
            <rect x="0" y="156" width="400" height="84" fill="url(#ocean)" />
            <g className="nz-shimmer"><rect x="188" y="160" width="24" height="3" rx="1.5" fill="#FFE9C0" opacity="0.8" /><rect x="184" y="170" width="32" height="3" rx="1.5" fill="#FFD98A" opacity="0.6" /><rect x="180" y="182" width="40" height="3" rx="1.5" fill="#F2A65A" opacity="0.5" /><rect x="176" y="196" width="48" height="3" rx="1.5" fill="#E8915A" opacity="0.4" /></g>
          </svg>
          <div style={S.heroVignette} />
        </>
      )}
      {!minimal && (
        <div style={S.heroContent}>
          <div style={S.heroTopRow}>
            {logoOk
              ? <img src="/logo.png" alt="Nanea Golf Club" style={S.heroLogo} onError={() => setLogoOk(false)} />
              : <Domes />}
            {badge && (badge === "COMMISSIONER" ? <span style={S.commishBadge}>{badge}</span> : <span style={S.youBadge}>{badge}</span>)}
          </div>
          <div style={S.kicker}>Nanea Golf Club</div>
          <h1 style={S.h1}>{name}</h1>
          <div style={S.sub}>{sub}</div>
        </div>
      )}
    </div>
  );
}
function Domes() {
  return (
    <svg width="62" height="34" viewBox="0 0 62 34">
      <defs><linearGradient id="cu" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F4C58A" /><stop offset="55%" stopColor="#C77F45" /><stop offset="100%" stopColor="#7A4420" /></linearGradient></defs>
      {[[8, 22], [20, 16], [31, 11], [42, 16], [54, 22]].map(([cx, top], i) => (
        <g key={i}><path d={`M ${cx - 6.5} 30 Q ${cx} ${top - 9} ${cx + 6.5} 30 Z`} fill="url(#cu)" /><line x1={cx} y1={top - 7} x2={cx} y2={top - 12} stroke="#C77F45" strokeWidth="1" /><circle cx={cx} cy={top - 13} r="1.2" fill="#F4C58A" /></g>
      ))}
    </svg>
  );
}

function Style() {
  return (<style>{`
    @keyframes nzSunPulse{0%,100%{opacity:.85;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
    @keyframes nzGlow{0%,100%{opacity:.55}50%{opacity:.85}}
    @keyframes nzDrift{0%{transform:translateX(-12px)}100%{transform:translateX(12px)}}
    @keyframes nzShimmer{0%,100%{opacity:.5}50%{opacity:1}}
    @keyframes nzFadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes nzExpand{from{opacity:0;max-height:0}to{opacity:1;max-height:500px}}
    @keyframes nzToastIn{from{opacity:0;transform:translate(-50%,-12px)}to{opacity:1;transform:translate(-50%,0)}}
    .nz-sun{animation:nzSunPulse 5s ease-in-out infinite;transform-origin:200px 150px}
    .nz-sunglow{animation:nzGlow 6s ease-in-out infinite}.nz-clouds{animation:nzDrift 14s ease-in-out infinite alternate}
    .nz-shimmer{animation:nzShimmer 4s ease-in-out infinite}.nz-page{animation:nzFadeUp .45s cubic-bezier(.2,.7,.3,1)}
    .nz-fade{animation:nzFadeUp .5s ease}.nz-expand{animation:nzExpand .4s ease;overflow:hidden}.nz-toast{animation:nzToastIn .3s ease}
    .nz-glass,.nz-mycard{backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);transition:transform .25s ease,box-shadow .25s ease,border-color .25s ease}
    .nz-glass:hover{transform:translateY(-2px);box-shadow:0 14px 40px rgba(0,0,0,.4)}
    .nz-tab{transition:color .2s ease,border-color .2s ease}.nz-tab:hover{color:#fff}
    .nz-lbrow{transition:background .2s ease;border-radius:8px}.nz-lbrow:hover{background:rgba(255,255,255,.06)}
    .nz-score{transition:transform .15s ease}.nz-score:hover{transform:translateY(-2px)}.nz-score:active{transform:scale(.92)}
    .nz-primary{transition:transform .2s ease,box-shadow .3s ease,filter .2s ease}
    .nz-primary:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(242,166,90,.5);filter:brightness(1.08)}.nz-primary:active{transform:scale(.97)}
    .nz-small{transition:transform .15s ease,filter .2s ease}.nz-small:hover{transform:translateY(-1px);filter:brightness(1.1)}
    .nz-holenav:hover:not(:disabled){box-shadow:0 0 0 1px rgba(255,200,120,.5)}.nz-holenav:disabled{opacity:.3}
    .nz-input{transition:border-color .2s ease,box-shadow .2s ease}.nz-input:focus{border-color:#F2A65A;box-shadow:0 0 0 3px rgba(242,166,90,.18)}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}
    ::-webkit-scrollbar{height:6px;width:6px}::-webkit-scrollbar-thumb{background:rgba(199,127,69,.4);border-radius:3px}
  `}</style>);
}

const SANS = "'Helvetica Neue', Arial, sans-serif";
const SERIF = "'Georgia', 'Times New Roman', serif";
const C = {
  ink: "#0E0B14", ink2: "#171020", glass: "rgba(255,255,255,0.07)", glassBorder: "rgba(255,255,255,0.14)",
  copper: "#C77F45", copperLt: "#F2C188", cream: "#F7F1E6", fescue: "#C3B49E",
  birdie: "#9AD17A", bogeyBad: "#E07555", ocean: "#5B8FB8", line: "rgba(255,255,255,0.1)",
};
const S = {
  matchCard: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px 14px', marginTop: 10 },
  mpTrack: { position: 'relative', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  mpCenter: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.25)' },
  mpFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 3, transition: 'width .4s ease' },
  switcherRow: { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 18px 2px', justifyContent: 'flex-end' },
  switcher: { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, color: '#F7F1E6', padding: '6px 10px', fontSize: 13, fontFamily: SANS, outline: 'none' },
  submittedTag: { marginTop: 10, padding: '8px 12px', background: 'rgba(154,209,122,0.16)', border: '1px solid rgba(154,209,122,0.5)', borderRadius: 10, color: '#9AD17A', fontFamily: SANS, fontSize: 12, lineHeight: 1.5 },
  subDot: { fontSize: 11, color: '#0b1a0b', background: '#9AD17A', padding: '1px 6px', borderRadius: 10, marginLeft: 7, fontFamily: SANS, verticalAlign: 'middle' },
  heroPhoto: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
  heroPhotoScrim: { position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(14,11,20,0.15) 0%, rgba(14,11,20,0.1) 40%, rgba(14,11,20,0.72) 100%)' },
  heroLogo: { height: 38, width: 'auto', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.7))', objectFit: 'contain' },
  saveBar: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', maxWidth: 680, margin: '0 auto', background: 'linear-gradient(135deg, #F2C188, #C77F45)', borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: '0 -8px 30px rgba(0,0,0,0.4)' },
  saveBtn: { background: '#1a0f08', color: '#F2C188', border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 700, cursor: 'pointer', fontFamily: SANS, fontSize: 14 },
  discardBtn: { background: 'rgba(0,0,0,0.15)', color: '#1a0f08', border: 'none', borderRadius: 10, padding: '11px 14px', fontWeight: 600, cursor: 'pointer', fontFamily: SANS, fontSize: 13 },
  oddsChip: { flex: "1 1 130px", display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.glassBorder}`, borderRadius: 12, padding: "12px 14px", minWidth: 120, cursor: "pointer", color: C.cream, textAlign: "left", fontFamily: SERIF },
  oddsSelected: { borderColor: C.copperLt, background: "rgba(242,166,90,0.18)", boxShadow: `0 0 0 1px ${C.copperLt}, 0 8px 24px rgba(242,166,90,0.25)` },
  oddsLabel: { fontSize: 14 },
  oddsNum: { fontSize: 22, fontWeight: 700, color: C.copperLt, fontFamily: SANS },
  cardTop: { display: "flex", justifyContent: "space-between", marginBottom: 4 },
  betSlip: { background: "linear-gradient(160deg, rgba(242,166,90,0.18), rgba(199,127,69,0.08))", border: `1px solid ${C.copperLt}`, borderRadius: 18, padding: 18, position: "sticky", bottom: 12, boxShadow: "0 12px 40px rgba(199,127,69,0.3)" },
  slipKicker: { fontSize: 10, letterSpacing: 3, color: C.copperLt, fontFamily: SANS },
  slipPick: { marginTop: 6, lineHeight: 1.5 },
  payout: { marginTop: 8, color: C.birdie, fontSize: 14, fontFamily: SANS },
  betRow: { display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.line}` },
  openBetRow: { display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13.5, color: C.cream },
  miniGhost: { background: "rgba(255,255,255,0.06)", color: C.fescue, border: `1px solid ${C.glassBorder}`, borderRadius: 7, padding: "6px 9px", cursor: "pointer", fontFamily: SANS, fontSize: 12 },
  shell: { minHeight: "100%", background: `radial-gradient(circle at 50% -10%, ${C.ink2} 0%, ${C.ink} 55%)`, color: C.cream, fontFamily: SERIF, padding: "0 0 40px", position: "relative" },
  hero: { position: "relative", height: 200, overflow: "hidden", borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  heroSvg: { position: "absolute", inset: 0, width: "100%", height: "100%" },
  heroVignette: { position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(14,11,20,0) 45%, rgba(14,11,20,0.55) 100%)" },
  heroContent: { position: "absolute", left: 20, right: 20, bottom: 14 },
  heroTopRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  kicker: { fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: C.copperLt, fontFamily: SANS, textShadow: "0 1px 8px rgba(0,0,0,0.5)" },
  h1: { margin: "2px 0", fontSize: 28, fontWeight: 700, lineHeight: 1.02, letterSpacing: 0.3, textShadow: "0 2px 16px rgba(0,0,0,0.45)" },
  sub: { fontSize: 12, color: C.cream, opacity: 0.92, fontFamily: SANS, letterSpacing: 0.3, textShadow: "0 1px 8px rgba(0,0,0,0.5)" },
  commishBadge: { fontSize: 9.5, letterSpacing: 1.5, background: "rgba(199,127,69,0.9)", color: "#1a0f08", padding: "4px 9px", borderRadius: 20, fontFamily: SANS, fontWeight: 700 },
  youBadge: { fontSize: 12, color: C.cream, fontFamily: SANS, background: "rgba(255,255,255,0.12)", padding: "4px 11px", borderRadius: 20 },
  namePrompt: { display: "flex", gap: 10, alignItems: "center", padding: "14px 18px 4px", flexWrap: "wrap" },
  tabs: { display: "flex", gap: 2, padding: "8px 10px 0", overflowX: "auto", position: "sticky", top: 0, zIndex: 20, background: "rgba(14,11,20,0.75)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${C.line}` },
  tab: { background: "none", border: "none", color: C.fescue, padding: "12px 14px", fontSize: 14, cursor: "pointer", fontFamily: SANS, borderBottom: "2px solid transparent", whiteSpace: "nowrap" },
  tabActive: { color: C.cream, borderBottom: `2px solid ${C.copperLt}` },
  main: { padding: "18px 16px", maxWidth: 680, margin: "0 auto" },
  card: { background: C.glass, border: `1px solid ${C.glassBorder}`, borderRadius: 18, padding: 18, boxShadow: "0 8px 30px rgba(0,0,0,0.25)" },
  myCard: { background: "linear-gradient(160deg, rgba(242,166,90,0.16), rgba(199,127,69,0.06))", border: "1px solid rgba(242,193,136,0.4)", borderRadius: 22, padding: 20, boxShadow: "0 10px 40px rgba(199,127,69,0.18)" },
  cardOpen: { background: "rgba(0,0,0,0.25)", border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 8px", margin: "4px 0 8px" },
  cardTitle: { fontSize: 19, fontWeight: 700, marginBottom: 4 },
  hint: { color: C.fescue, fontSize: 12, marginTop: 6, fontFamily: SANS, lineHeight: 1.5 },
  standRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 4px" },
  tpBarTrack: { height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, marginTop: 5, overflow: "hidden" },
  tpBarFill: { height: "100%", background: "linear-gradient(90deg, #C77F45, #F2C188)", borderRadius: 3, transition: "width .5s ease" },
  lbRow: { display: "flex", alignItems: "center", gap: 8, padding: "11px 6px", borderBottom: `1px solid ${C.line}` },
  lbHead: { color: C.fescue, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontFamily: SANS },
  youDot: { fontSize: 10, color: "#1a0f08", background: C.copperLt, padding: "1px 6px", borderRadius: 10, marginLeft: 7, fontFamily: SANS, verticalAlign: "middle" },
  matchRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", borderBottom: `1px solid ${C.line}`, fontSize: 14 },
  holeNav: { width: 46, height: 46, borderRadius: 23, background: "rgba(255,255,255,0.08)", color: C.copperLt, border: `1px solid ${C.glassBorder}`, fontSize: 24, cursor: "pointer", flexShrink: 0 },
  scoreBtn: { width: 40, height: 46, borderRadius: 12, background: "rgba(255,255,255,0.06)", color: C.cream, border: `1px solid ${C.glassBorder}`, fontSize: 17, fontWeight: 700, cursor: "pointer", fontFamily: SANS },
  clearBtn: { background: "none", border: "none", color: C.bogeyBad, textDecoration: "underline", cursor: "pointer", fontFamily: SANS, fontSize: 13 },
  scTable: { borderCollapse: "collapse", width: "100%", marginBottom: 6, fontFamily: SANS },
  scLbl: { fontSize: 10, color: C.fescue, textAlign: "left", padding: "3px 6px 3px 2px", textTransform: "uppercase", whiteSpace: "nowrap" },
  scH: { fontSize: 11, color: C.fescue, textAlign: "center", padding: "3px 0", minWidth: 22 },
  scPar: { fontSize: 11, color: C.copperLt, textAlign: "center", padding: "3px 0" },
  scVal: { fontSize: 12, fontWeight: 700, textAlign: "center", padding: "4px 0", border: "1px solid transparent", borderRadius: 6, minWidth: 20 },
  scTot: { fontSize: 12, fontWeight: 700, textAlign: "center", color: C.cream, paddingLeft: 8, borderLeft: `1px solid ${C.line}` },
  miniInput: { width: 30, background: "rgba(0,0,0,0.3)", border: `1px solid ${C.glassBorder}`, borderRadius: 5, color: C.cream, padding: "4px 2px", fontSize: 12, textAlign: "center", fontFamily: SANS, outline: "none" },
  kindTag: { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.copperLt, fontFamily: SANS },
  roundPill: { background: "rgba(255,255,255,0.06)", color: C.fescue, border: `1px solid ${C.glassBorder}`, borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontFamily: SANS, fontSize: 13 },
  roundPillOn: { background: "linear-gradient(135deg, #F2A65A, #C77F45)", color: "#1a0f08", borderColor: "transparent", fontWeight: 700 },
  teamBtn: { width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.06)", color: C.fescue, border: `1px solid ${C.glassBorder}`, cursor: "pointer", fontFamily: SANS, fontWeight: 700, marginLeft: 4 },
  teamBtnA: { background: "linear-gradient(135deg,#F2A65A,#C77F45)", color: "#1a0f08", borderColor: "transparent" },
  teamBtnB: { background: "linear-gradient(135deg,#5B8FB8,#3E6A8E)", color: "#fff", borderColor: "transparent" },
  resultBtn: { flex: 1, background: "rgba(255,255,255,0.05)", color: C.fescue, border: `1px solid ${C.glassBorder}`, borderRadius: 8, padding: "8px", cursor: "pointer", fontFamily: SANS, fontSize: 12 },
  resultOn: { background: "linear-gradient(135deg,#F2A65A,#C77F45)", color: "#1a0f08", borderColor: "transparent", fontWeight: 700 },
  input: { background: "rgba(0,0,0,0.28)", border: `1px solid ${C.glassBorder}`, borderRadius: 10, color: C.cream, padding: "11px 13px", fontSize: 15, fontFamily: SERIF, width: "100%", boxSizing: "border-box", outline: "none" },
  inputInline: { background: "rgba(255,255,255,0.1)", border: `1px solid ${C.glassBorder}`, borderRadius: 10, color: C.cream, padding: "8px 12px", fontSize: 14, fontFamily: SERIF, outline: "none" },
  primaryBtn: { marginTop: 14, width: "100%", background: "linear-gradient(135deg, #F2A65A, #C77F45)", color: "#1a0f08", border: "none", borderRadius: 12, padding: "14px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: SANS, boxShadow: "0 6px 20px rgba(242,166,90,0.3)" },
  smallBtn: { background: "linear-gradient(135deg, #9AD17A, #6FA84E)", color: "#0b1a0b", border: "none", borderRadius: 10, padding: "11px 16px", fontWeight: 700, cursor: "pointer", fontFamily: SANS, whiteSpace: "nowrap" },
  xBtn: { background: "none", border: "none", color: C.bogeyBad, cursor: "pointer", fontSize: 16 },
  toast: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg, #F2A65A, #C77F45)", color: "#1a0f08", padding: "11px 20px", borderRadius: 12, fontWeight: 700, zIndex: 50, fontFamily: SANS, fontSize: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.4)" },
  footer: { textAlign: "center", color: C.fescue, fontSize: 12, padding: "24px 20px 0", maxWidth: 480, margin: "0 auto", fontFamily: SANS, lineHeight: 1.5 },
};
