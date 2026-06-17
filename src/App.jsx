import React, { useState, useEffect, useCallback, useMemo } from "react";
import { loadState, saveState, subscribe, uploadAvatar } from "./store.js";
// ============================================================
// NANEA — THE BOOK  ·  Tournament edition (Stage 1: scoring engine)
// 6-round net tournament for 8 players + Ryder Cup + Tournament Points.
// Sunset-luxe glass UI. Betting layer added in Stage 2.
//
// COMMISSIONER ACCESS: tap "Commish" tab, enter the PIN below.
// ============================================================

const COMMISH_PIN = "1918"; // <-- CHANGE THIS before sharing
// Only these players (by their real login name) can see the Commish tab.
const COMMISH_NAMES = ["Cameron Maalouf", "Jack Clarey"];

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
// Display name = nickname if set, else real name. hasNick = whether to show the real-name subtext.
const dispName = (p) => (p && p.displayName && p.displayName.trim()) ? p.displayName.trim() : (p ? p.name : "");
const hasNick = (p) => !!(p && p.displayName && p.displayName.trim() && p.displayName.trim() !== p.name);
const firstName = (p) => dispName(p).split(" ")[0];

// ---- scoring helpers ----
const strokesOnHole = (si, ph) => (ph >= si ? 1 : 0) + (ph >= si + 18 ? 1 : 0);
const netHole = (g, si, ph) => g - strokesOnHole(si, ph);

// ---- editable scoring rules (commish-configurable, with safe defaults) ----
const RULES_DEFAULTS = {
  finishTP: [7, 6, 5, 4, 3, 2, 1, 0],     // TP by finish position (1st..8th) for R3/R5/R6
  stbl: { albatross: 5, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0 }, // net Stableford per hole
  bestBallTP: 4,                            // TP to each player on a winning R4 pair
  ryderTP: 2,                               // TP to each player on the winning Ryder team
  scrambleLow: 35,                          // % of lower handicap in scramble blend
  scrambleHigh: 15,                         // % of higher handicap in scramble blend
};
// Resolve rules from state with fallback to defaults (older saves may lack the field).
const RZ = (state) => ({ ...RULES_DEFAULTS, ...(state?.rules || {}), stbl: { ...RULES_DEFAULTS.stbl, ...(state?.rules?.stbl || {}) } });

const stbl = (net, par, rules = RULES_DEFAULTS) => {
  const d = net - par; const s = rules.stbl || RULES_DEFAULTS.stbl;
  return d <= -3 ? s.albatross : d === -2 ? s.eagle : d === -1 ? s.birdie : d === 0 ? s.par : d === 1 ? s.bogey : s.double;
};

function playerNetTotal(holes, scores, h) {
  let g = 0, n = 0, thru = 0;
  holes.forEach((H) => { const v = scores?.[H.hole]; if (v != null) { g += v; n += netHole(v, H.si, h); thru++; } });
  return { gross: g, net: n, thru };
}
function playerStbl(holes, scores, h, rules = RULES_DEFAULTS) {
  let pts = 0, thru = 0;
  holes.forEach((H) => { const v = scores?.[H.hole]; if (v != null) { pts += stbl(netHole(v, H.si, h), H.par, rules); thru++; } });
  return { pts, thru };
}
// rank -> TP with average tie-sharing
function rankToTP(arr, higherBetter, finishTP = RULES_DEFAULTS.finishTP) {
  const s = [...arr].sort((a, b) => (higherBetter ? b.val - a.val : a.val - b.val));
  const pts = finishTP; const out = {}; let i = 0;
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
const scrambleTeamHcp = (h1, h2, low = RULES_DEFAULTS.scrambleLow, high = RULES_DEFAULTS.scrambleHigh) => { const lo = Math.min(h1, h2), hi = Math.max(h1, h2); return Math.round((low / 100) * lo + (high / 100) * hi); };

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
  ryder: { teamA: [], teamB: [], teamAName: "Team A", teamBName: "Team B", captainA: "", captainB: "",
    r1: [], r2: [], // matches: {id, side:'A', xs:[ids], ys:[ids], result:'X'|'Y'|'H'|''}
    playoff: "" }, // 'A' | 'B' | ''
  r4: { matches: [] }, // {id, xs:[id,id], ys:[id,id]}
  r6: { champ: [], losers: [], champWinner: "", loserLast: "" },
  manualTP: {}, // commissioner overrides id->delta (rare)
  rules: RULES_DEFAULTS,
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
  const [profileFor, setProfileFor] = useState(null);
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
  const logout = () => { setMe(""); setIsCommish(false); try { localStorage.removeItem("nanea_me"); } catch {} };

  // Claim a name (sets its PIN the first time) or log in with the existing PIN.
  const loginPlayer = async (playerId, pinTry, isClaim) => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, msg: "Player not found." };
    if (!/^\d{4}$/.test(pinTry)) return { ok: false, msg: "PIN must be 4 digits." };
    if (isClaim) {
      // set the PIN now (claim-on-first-use)
      const players = state.players.map((p) => p.id === playerId ? { ...p, pin: pinTry } : p);
      await save({ ...state, players });
      setName(player.name);
      return { ok: true };
    }
    // commish PIN works for anyone
    if (pinTry === COMMISH_PIN) { setName(player.name); return { ok: true }; }
    if (player.pin && pinTry === player.pin) { setName(player.name); return { ok: true }; }
    return { ok: false, msg: "Wrong PIN." };
  };

  const tp = useMemo(() => computeTP(state), [state]);

  // Auto-settle any market whose outcome is now mathematically decided. Runs on the
  // commissioners' devices (idempotent + last-write-wins, so it's safe). The moment a
  // Ryder match/cup, over-under, or the tournament winner is decided, pending bets pay out.
  useEffect(() => {
    if (loading) return;
    if (!COMMISH_NAMES.includes(me)) return; // only commish devices drive settlement
    const toSettle = (state.markets || []).filter((m) => m.status !== "settled").map((m) => ({ m, o: marketOutcome(m, state, tp) })).filter((x) => x.o.decided && x.o.winningOptionId);
    // also handle halved Ryder matches: decided (no winner) → all bets lose, market closes
    const halvedMatches = (state.markets || []).filter((m) => m.status !== "settled" && m.kind === "match").map((m) => ({ m, o: marketOutcome(m, state, tp) })).filter((x) => x.o.halved);
    if (!toSettle.length && !halvedMatches.length) return;
    const run = async () => {
      const latest = migrate((await loadState()) || state);
      const latestTp = computeTP(latest);
      let markets = latest.markets, bets = latest.bets, changed = false;
      const apply = (mkt, winId) => {
        markets = markets.map((m) => m.id === mkt.id ? { ...m, status: "settled", winnerId: winId } : m);
        bets = bets.map((b) => (b.marketId === mkt.id && b.status === "pending") ? { ...b, status: (winId && b.optionId === winId) ? "won" : "lost" } : b);
        changed = true;
      };
      latest.markets.filter((m) => m.status !== "settled").forEach((m) => {
        const o = marketOutcome(m, latest, latestTp);
        if (o.decided && o.winningOptionId) apply(m, o.winningOptionId);
        else if (o.halved) apply(m, null); // halved match: no winner, all wagers lose
      });
      if (changed) { await saveState({ ...latest, markets, bets }); setState({ ...latest, markets, bets }); }
    };
    run().catch((e) => console.error("auto-settle failed", e));
  }, [state, tp, me, loading]);

  if (loading) return <div style={S.shell}><Style /><Hero name="Nanea" sub="loading the book…" minimal /><div style={{ textAlign: "center", color: C.copperLt, letterSpacing: 4, marginTop: 30, fontFamily: SANS }}>NANEA</div></div>;

  return (
    <div style={S.shell}>
      <Style />
      {toast && <div className="nz-toast" style={S.toast}>{toast}</div>}
      <Hero name={state.tournamentName} sub={`Par ${state.holes.reduce((s, h) => s + h.par, 0)} · Mount Hualālai · 8-player net tournament`} badge={isCommish ? "COMMISSIONER" : me} />

      {!me ? (
        <PlayerLogin state={state} onLogin={loginPlayer} />
      ) : (
        <div style={S.switcherRow} className="nz-fade">
          <span style={{ color: C.fescue, fontSize: 12, fontFamily: SANS }}>Logged in as <strong style={{ color: C.cream }}>{dispName(state.players.find((p) => p.name === me)) || me}</strong></span>
          <button style={S.profileIconBtn} onClick={() => setProfileFor(state.players.find((p) => p.name === me)?.id)} title="Profile">
            {(() => { const mp = state.players.find((p) => p.name === me); return <Avatar player={mp} size={30} />; })()}
          </button>
          <button style={{ ...S.miniGhost, padding: "5px 12px" }} onClick={logout}>Log out</button>
        </div>
      )}

      {profileFor && <ProfileModal state={state} tp={tp} playerId={profileFor} isMe={state.players.find((p) => p.id === profileFor)?.name === me} isCommish={isCommish} onClose={() => setProfileFor(null)} save={save} flash={flash} setName={setName} />}

      <nav style={S.tabs} className="nz-tabs">
        {[["standings", "Standings"], ["scoring", "Live Scoring"], ["ryder", "Ryder Cup"], ["rounds", "Rounds"], ["bets", "The Book"], ["rules", "Rules"], ...(COMMISH_NAMES.includes(me) ? [["commish", "Commish"]] : [])].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className="nz-tab" style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{lbl}</button>
        ))}
      </nav>

      <main style={S.main} className="nz-main">
        <div key={tab} className="nz-page nz-cols">
          {tab === "standings" && <Standings state={state} tp={tp} onProfile={setProfileFor} />}
          {tab === "scoring" && <Scoring state={state} me={me} setName={setName} save={save} isCommish={isCommish} />}
          {tab === "ryder" && <RyderView state={state} tp={tp} />}
          {tab === "rounds" && <RoundsView state={state} tp={tp} />}
          {tab === "rules" && <RulesView state={state} />}
          {tab === "bets" && <BookView state={state} tp={tp} me={me} setName={setName} save={save} flash={flash} />}
          {tab === "commish" && (COMMISH_NAMES.includes(me)
            ? (isCommish
                ? <Commish state={state} save={save} flash={flash} tp={tp} />
                : <PinGate pinEntry={pinEntry} setPinEntry={setPinEntry} onTry={() => { if (pinEntry === COMMISH_PIN) { setIsCommish(true); flash("Welcome, Commissioner."); } else flash("Wrong PIN."); }} />)
            : <Empty msg="The commissioner area is restricted." />)}
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
  merged.rules = { ...RULES_DEFAULTS, ...(s.rules || {}), stbl: { ...RULES_DEFAULTS.stbl, ...(s.rules?.stbl || {}) } };
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
  const R = RZ(state);
  const detail = { r1: null, r2: null, ryder: null, r3: {}, r4: [], r5: {}, r6: null };

  // ---- Ryder Cup (R1 scramble + R2 singles) — auto-calculated from scores ----
  const ry = state.ryder;
  if (ry.teamA.length && ry.teamB.length) {
    let aPts = 0, bPts = 0;
    const matchResults = {};
    const tallyMatch = (m, roundKey) => {
      const res = ryderMatchResult(holes, m, state, roundKey);
      matchResults[m.id] = res;
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
    if (winners) winners.forEach((id) => (tp[id] += R.ryderTP));
    detail.ryder.winners = winners;
  }

  // ---- R3 Stableford ----
  const r3vals = state.players.map((p) => { const s = playerStbl(holes, p.scores.r3, p.h, R); return { id: p.id, val: s.pts, thru: s.thru }; });
  if (r3vals.some((v) => v.thru > 0)) {
    const done = r3vals.filter((v) => v.thru === 18);
    if (done.length === state.players.length) {
      const map = rankToTP(r3vals.map((v) => ({ id: v.id, val: v.val })), true, R.finishTP);
      Object.entries(map).forEach(([id, v]) => (tp[id] += v));
      detail.r3 = map;
    }
  }

  // ---- R4 best ball ----
  (state.r4.matches || []).forEach((m) => {
    const res = bestBallResult(holes, m, state);
    detail.r4.push(res);
    if (res.winner) res.winner.forEach((id) => (tp[id] += R.bestBallTP));
  });

  // ---- R5 stroke ----
  const r5vals = state.players.map((p) => { const t = playerNetTotal(holes, p.scores.r5, p.h); return { id: p.id, val: t.net, thru: t.thru }; });
  if (r5vals.every((v) => v.thru === 18) && r5vals.length) {
    const map = rankToTP(r5vals.map((v) => ({ id: v.id, val: v.val })), false, R.finishTP);
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

// Per-hole NET for one Ryder side.
// roundKey 'r1' = scramble: the PAIR enters one team gross per hole (stored on the match
//   as teamScores), then we apply the blended team handicap.
// roundKey 'r2' = singles: each player's own net.
function ryderSideNet(holes, ids, state, roundKey, teamScores) {
  const P = (id) => state.players.find((x) => x.id === id);
  const out = {};
  if (roundKey === "r1") {
    const ts = teamScores || {};
    const teamH = ids.length === 2 ? scrambleTeamHcp(P(ids[0]).h, P(ids[1]).h, RZ(state).scrambleLow, RZ(state).scrambleHigh) : (ids[0] ? P(ids[0]).h : 0);
    holes.forEach((H) => {
      const g = ts[H.hole];
      out[H.hole] = g != null ? netHole(g, H.si, teamH) : null;
    });
  } else {
    const sc = (id) => (P(id)?.scores?.[roundKey]) || {};
    holes.forEach((H) => {
      const nets = ids.map((id) => { const v = sc(id)[H.hole]; return v != null ? netHole(v, H.si, P(id).h) : null; }).filter((v) => v != null);
      out[H.hole] = nets.length ? Math.min(...nets) : null;
    });
  }
  return out;
}

// Full auto-calculated result for a Ryder match (scramble or singles).
function ryderMatchResult(holes, m, state, roundKey) {
  const xNet = ryderSideNet(holes, m.xs, state, roundKey, m.xScores);
  const yNet = ryderSideNet(holes, m.ys, state, roundKey, m.yScores);
  const st = matchStatus(holes, xNet, yNet);
  return { id: m.id, ...st, xs: m.xs, ys: m.ys, roundKey };
}

// Compact live match board for one Ryder round, shown under Live Scoring for R1/R2.
function RyderRoundBoard({ state, roundKey }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ry = state.ryder;
  const nameA = ry.teamAName || "Team A";
  const nameB = ry.teamBName || "Team B";
  const [openId, setOpenId] = useState(null);
  const ms = roundKey === "r1" ? (ry.r1 || []) : (ry.r2 || []);
  const roundNum = roundKey === "r1" ? 1 : 2;
  const roundName = roundKey === "r1" ? "Scramble" : "Singles";

  if (!ry.teamA.length || !ry.teamB.length) {
    return <Empty msg="Teams aren't set yet. The commissioner assigns them in Commish → Ryder R1–2." />;
  }
  if (!ms.length) {
    return <Empty msg={`No ${roundName.toLowerCase()} matches set yet. Commissioner builds them in Commish → Ryder R1–2.`} />;
  }

  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Round {roundNum} · {roundName} — Live Matches</div>
      <p style={S.hint}>Auto-scored from the entered scores. Tap a match to see the full card.</p>
      {ms.map((m) => {
        const res = ryderMatchResult(state.holes, m, state, roundKey);
        const xNames = m.xs.map((id) => dispName(P(id))).filter(Boolean);
        const yNames = m.ys.map((id) => dispName(P(id))).filter(Boolean);
        const xUp = res.up > 0, yUp = res.up < 0;
        return (
          <div key={m.id} style={S.matchCard}>
            <div className="nz-lbrow" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 8 }} onClick={() => setOpenId(openId === m.id ? null : m.id)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: xUp ? C.birdie : C.cream }}>{xNames.join(" & ") || "—"}</div>
                <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, letterSpacing: 1 }}>{nameA.toUpperCase()}</div>
              </div>
              <div style={{ textAlign: "center", minWidth: 84 }}>
                <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 15, color: res.final ? (res.result === "H" ? C.fescue : C.copperLt) : C.copperLt }}>
                  {res.up === 0 && !res.final ? "AS" : (res.final ? res.status : `${Math.abs(res.up)} UP`)}
                </div>
                <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS }}>{res.final ? "FINAL" : res.thru ? `thru ${res.thru}` : "tap to view"}</div>
              </div>
              <div style={{ flex: 1, textAlign: "right" }}>
                <div style={{ fontWeight: 700, color: yUp ? C.ocean : C.cream }}>{yNames.join(" & ") || "—"}</div>
                <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, letterSpacing: 1 }}>{nameB.toUpperCase()}</div>
              </div>
            </div>
            <div style={S.mpTrack}>
              <div style={S.mpCenter} />
              <div style={{ ...S.mpFill, ...(res.up > 0 ? { right: "50%", width: `${Math.min(Math.abs(res.up), 9) / 9 * 50}%`, background: C.birdie } : res.up < 0 ? { left: "50%", width: `${Math.min(Math.abs(res.up), 9) / 9 * 50}%`, background: C.ocean } : { left: "50%", width: 0 }) }} />
            </div>
            {roundKey === "r1" && m.xs.length === 2 && m.ys.length === 2 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: SANS, fontSize: 11, color: C.fescue }}>
                <span>scr. hcp {scrambleTeamHcp(P(m.xs[0]).h, P(m.xs[1]).h, RZ(state).scrambleLow, RZ(state).scrambleHigh)}</span>
                <span>scr. hcp {scrambleTeamHcp(P(m.ys[0]).h, P(m.ys[1]).h, RZ(state).scrambleLow, RZ(state).scrambleHigh)}</span>
              </div>
            )}
            {openId === m.id && <div className="nz-expand"><RyderMatchScorecard state={state} m={m} roundKey={roundKey} nameA={nameA} nameB={nameB} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// Hole-by-hole scorecard for one Ryder match (scramble team scores or singles nets).
function RyderMatchScorecard({ state, m, roundKey, nameA, nameB }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const holes = state.holes;
  const xNet = ryderSideNet(holes, m.xs, state, roundKey, m.xScores);
  const yNet = ryderSideNet(holes, m.ys, state, roundKey, m.yScores);
  // gross row for display: scramble shows team gross; singles shows best gross of side
  const sideGross = (ids, teamScores) => {
    const out = {};
    if (roundKey === "r1") { holes.forEach((H) => { out[H.hole] = (teamScores || {})[H.hole] ?? null; }); }
    else { holes.forEach((H) => { const gs = ids.map((id) => (P(id)?.scores?.[roundKey] || {})[H.hole]).filter((v) => v != null); out[H.hole] = gs.length ? Math.min(...gs) : null; }); }
    return out;
  };
  const xG = sideGross(m.xs, m.xScores), yG = sideGross(m.ys, m.yScores);

  const Row = ({ label, vals, net, color }) => (
    <tr><td style={S.scLbl}>{label}</td>{holes.map((H) => {
      const v = vals[H.hole];
      return <td key={H.hole} style={{ ...S.scVal, color: v == null ? C.fescue : color }}>{v == null ? "·" : v}</td>;
    })}</tr>
  );
  // who won each hole (by net) for a highlight row
  const winRow = holes.map((H) => xNet[H.hole] == null || yNet[H.hole] == null ? "" : xNet[H.hole] < yNet[H.hole] ? "A" : yNet[H.hole] < xNet[H.hole] ? "B" : "½");

  return (
    <div style={S.cardOpen}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ ...S.scTable, minWidth: 560 }}><tbody>
          <tr><td style={S.scLbl}>Hole</td>{holes.map((H) => <td key={H.hole} style={S.scH}>{H.hole}</td>)}</tr>
          <tr><td style={S.scLbl}>Par</td>{holes.map((H) => <td key={H.hole} style={S.scPar}>{H.par}</td>)}</tr>
          <Row label={`${nameA} gross`} vals={xG} color={C.cream} />
          <Row label={`${nameA} net`} vals={xNet} color={C.birdie} />
          <Row label={`${nameB} gross`} vals={yG} color={C.cream} />
          <Row label={`${nameB} net`} vals={yNet} color={C.ocean} />
          <tr><td style={S.scLbl}>Hole won</td>{winRow.map((w, i) => <td key={i} style={{ ...S.scVal, fontWeight: 800, color: w === "A" ? C.birdie : w === "B" ? C.ocean : C.fescue }}>{w || "·"}</td>)}</tr>
        </tbody></table>
      </div>
      <p style={{ ...S.hint, marginTop: 4 }}>{roundKey === "r1" ? "Scramble: one team score per hole, net off the blended team handicap." : "Singles: each player's net. 'Hole won' shows who took each hole."}</p>
    </div>
  );
}

// ============================================================
// RYDER CUP VIEW — live team board, all matches
// ============================================================
function RyderView({ state, tp }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ry = state.ryder;
  const d = tp.detail.ryder;
  const [openId, setOpenId] = useState(null);

  if (!ry.teamA.length || !ry.teamB.length) {
    return <Empty msg="Ryder Cup teams aren't set yet. The commissioner assigns the two teams in Commish → Ryder R1–2." />;
  }
  const nameA = ry.teamAName || "Team A";
  const nameB = ry.teamBName || "Team B";

  const MatchCard = ({ m, roundKey, onOpen }) => {
    const res = ryderMatchResult(state.holes, m, state, roundKey);
    const xNames = m.xs.map((id) => dispName(P(id))).filter(Boolean);
    const yNames = m.ys.map((id) => dispName(P(id))).filter(Boolean);
    const xUp = res.up > 0, yUp = res.up < 0;
    const statusText = res.final
      ? (res.result === "H" ? "Halved" : `${res.result === "X" ? nameA : nameB} wins ${res.status}`)
      : (res.up === 0 ? res.status : `${Math.abs(res.up)} UP`);
    return (
      <div style={S.matchCard}>
        <div className="nz-lbrow" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 8 }} onClick={onOpen}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: xUp ? C.birdie : C.cream }}>{xNames.join(" & ") || "—"}</div>
            <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, letterSpacing: 1 }}>{nameA.toUpperCase()}</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 92 }}>
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 15, color: res.final ? (res.result === "H" ? C.fescue : C.copperLt) : C.copperLt }}>
              {res.up === 0 && !res.final ? "AS" : (res.final ? res.status : `${Math.abs(res.up)} UP`)}
            </div>
            <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS }}>{res.final ? "FINAL" : res.thru ? `thru ${res.thru}` : "tap to view"}</div>
          </div>
          <div style={{ flex: 1, textAlign: "right" }}>
            <div style={{ fontWeight: 700, color: yUp ? C.ocean : C.cream }}>{yNames.join(" & ") || "—"}</div>
            <div style={{ fontSize: 11, color: C.fescue, fontFamily: SANS, letterSpacing: 1 }}>{nameB.toUpperCase()}</div>
          </div>
        </div>
        <div style={S.mpTrack}>
          <div style={S.mpCenter} />
          <div style={{ ...S.mpFill, ...(res.up > 0 ? { right: "50%", width: `${Math.min(Math.abs(res.up), 9) / 9 * 50}%`, background: C.birdie } : res.up < 0 ? { left: "50%", width: `${Math.min(Math.abs(res.up), 9) / 9 * 50}%`, background: C.ocean } : { left: "50%", width: 0 }) }} />
        </div>
        {roundKey === "r1" && m.xs.length === 2 && m.ys.length === 2 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: SANS, fontSize: 11, color: C.fescue }}>
            <span>scr. hcp {scrambleTeamHcp(P(m.xs[0]).h, P(m.xs[1]).h, RZ(state).scrambleLow, RZ(state).scrambleHigh)}</span>
            <span>scr. hcp {scrambleTeamHcp(P(m.ys[0]).h, P(m.ys[1]).h, RZ(state).scrambleLow, RZ(state).scrambleHigh)}</span>
          </div>
        )}
        {openId === m.id && <div className="nz-expand"><RyderMatchScorecard state={state} m={m} roundKey={roundKey} nameA={nameA} nameB={nameB} /></div>}
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
            <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>{nameA.toUpperCase()}</div>
            <div style={{ fontSize: 44, fontWeight: 800, fontFamily: SANS, color: d && d.aPts >= d.bPts ? C.birdie : C.cream }}>{d ? fmtTP(d.aPts) : "0"}</div>
            <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>{ry.teamA.map((id) => firstName(P(id))).join(", ")}</div>
          </div>
          <div style={{ color: C.fescue, fontFamily: SANS }}>vs</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>{nameB.toUpperCase()}</div>
            <div style={{ fontSize: 44, fontWeight: 800, fontFamily: SANS, color: d && d.bPts >= d.aPts ? C.ocean : C.cream }}>{d ? fmtTP(d.bPts) : "0"}</div>
            <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>{ry.teamB.map((id) => firstName(P(id))).join(", ")}</div>
          </div>
        </div>
        <p style={{ ...S.hint, textAlign: "center" }}>First to 3½ of 6 points wins the Cup. Each player on the winning team earns {RZ(state).ryderTP} TP. {d && d.winners ? `${d.winners === ry.teamA ? nameA : nameB} has clinched.` : "3–3 goes to a captain playoff."}</p>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round 1 · Scramble</div>
        {(ry.r1 || []).length ? (ry.r1 || []).map((m) => <MatchCard key={m.id} m={m} roundKey="r1" onOpen={() => setOpenId(openId === m.id ? null : m.id)} />) : <p style={S.hint}>No scramble matches set yet.</p>}
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round 2 · Singles</div>
        {(ry.r2 || []).length ? (ry.r2 || []).map((m) => <MatchCard key={m.id} m={m} roundKey="r2" onOpen={() => setOpenId(openId === m.id ? null : m.id)} />) : <p style={S.hint}>No singles matches set yet.</p>}
      </div>
    </div>
  );
}

// ============================================================
// STANDINGS
// ============================================================
function Standings({ state, tp, onProfile }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ranked = [...state.players].map((p) => ({ p, pts: tp.tp[p.id] })).sort((a, b) => b.pts - a.pts);
  const leader = ranked[0]?.pts || 0;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Tournament Points</div>
        <p style={S.hint}>Cumulative across all six rounds. Drives Round 4 pairings and the final-round groups. Tap a player to see their card.</p>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {ranked.map(({ p, pts }, i) => (
            <div key={p.id} className="nz-lbrow" style={{ ...S.standRow, cursor: "pointer" }} onClick={() => onProfile && onProfile(p.id)}>
              <span style={{ width: 28, fontWeight: 800, color: i === 0 ? C.copperLt : C.fescue, fontFamily: SANS }}>{i + 1}</span>
              <Avatar player={p} size={34} />
              <div style={{ flex: 1, marginLeft: 10 }}>
                <div style={{ fontWeight: 600 }}><PlayerName player={p} /> <span style={{ color: C.fescue, fontWeight: 400, fontSize: 13 }}>· {p.h}</span></div>
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
  const nameA = state.ryder.teamAName || "Team A";
  const nameB = state.ryder.teamBName || "Team B";
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Ryder Cup</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", marginTop: 10 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>{nameA.toUpperCase()}</div>
          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: SANS, color: d.aPts >= d.bPts ? C.copperLt : C.cream }}>{fmtTP(d.aPts)}</div>
        </div>
        <div style={{ color: C.fescue, fontFamily: SANS }}>vs</div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: C.fescue, fontFamily: SANS }}>{nameB.toUpperCase()}</div>
          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: SANS, color: d.bPts >= d.aPts ? C.copperLt : C.cream }}>{fmtTP(d.bPts)}</div>
        </div>
      </div>
      {d.winners
        ? <div style={{ textAlign: "center", color: C.birdie, fontFamily: SANS, fontSize: 13, marginTop: 6 }}>{d.winners === state.ryder.teamA ? nameA : nameB} wins the Cup — each player on the team gets +{RZ(state).ryderTP} TP</div>
        : <div style={{ textAlign: "center", color: C.fescue, fontFamily: SANS, fontSize: 13, marginTop: 6 }}>{d.aPts === d.bPts && (d.aPts + d.bPts) > 0 ? "All square — captain playoff needed" : "In progress"}</div>}
      <p style={{ ...S.hint, textAlign: "center" }}>6 points across the 2 scramble + 4 singles matches combined. Win the majority and every player on the winning team earns 2 Tournament Points — one team prize for the combined result, not 2 per match.</p>
    </div>
  );
}

// ============================================================
// LIVE SCORING — per round, each player enters own card
// ============================================================
function Scoring({ state, me, setName, save, isCommish }) {
  const [roundKey, setRoundKey] = useState(() => { try { return localStorage.getItem("nanea_round") || "r3"; } catch { return "r3"; } });
  const pickRound = (k) => { setRoundKey(k); try { localStorage.setItem("nanea_round", k); } catch {} };
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

  // ---- R1 scramble team entry: find the match this player is in, and which side ----
  const myMatch = (state.ryder.r1 || []).find((m) => m.xs.includes(myPlayer?.id) || m.ys.includes(myPlayer?.id));
  const mySide = myMatch ? (myMatch.xs.includes(myPlayer?.id) ? "x" : "y") : null;
  const setTeamScore = async (matchId, side, hole, gross) => {
    const r1 = state.ryder.r1.map((m) => {
      if (m.id !== matchId) return m;
      const key = side === "x" ? "xScores" : "yScores";
      const cur = { ...(m[key] || {}) };
      if (gross == null) delete cur[hole]; else cur[hole] = gross;
      return { ...m, [key]: cur };
    });
    await save({ ...state, ryder: { ...state.ryder, r1 } });
  };
  const submitTeam = async (matchId, side) => {
    const r1 = state.ryder.r1.map((m) => m.id !== matchId ? m
      : { ...m, submitted: { ...(m.submitted || {}), [side]: true } });
    await save({ ...state, ryder: { ...state.ryder, r1 } });
  };
  const teamSubmitted = myMatch && myMatch.submitted ? !!myMatch.submitted[mySide] : false;

  // par played so far (for net-to-par display)
  const parThru = (rs) => holes.reduce((s, H) => s + (rs[H.hole] != null ? H.par : 0), 0);

  // leaderboard for this round
  const rows = state.players.map((p) => {
    const rs = p.scores[roundKey] || {};
    const t = playerNetTotal(holes, rs, p.h);
    const toPar = t.thru ? t.net - parThru(rs) : null;
    if (round.kind === "stableford") {
      const s = playerStbl(holes, rs, p.h, RZ(state));
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
            <button key={r.key} onClick={() => pickRound(r.key)} style={{ ...S.roundPill, ...(roundKey === r.key ? S.roundPillOn : {}) }}>R{r.n}</button>
          ))}
        </div>
        <div style={{ marginTop: 10, color: C.copperLt, fontFamily: SANS, fontSize: 13 }}>{round.fmt}</div>
      </div>

      {!me && <div className="nz-glass" style={S.card}><div style={S.cardTitle}>Log in to score</div>
        <p style={S.hint}>Use the Check In box at the top to log in with your name and code, then you can enter your scores.</p></div>}

      {myPlayer && roundKey === "r1" && (
        myMatch
          ? <ScrambleTeamCard state={state} holes={holes} match={myMatch} side={mySide} setTeamScore={setTeamScore} submitTeam={submitTeam} isSubmitted={teamSubmitted} />
          : <div className="nz-glass" style={S.card}><div style={S.cardTitle}>Scramble — Round 1</div><p style={S.hint}>You're not in a scramble match yet. The commissioner sets the R1 pairings in Commish → Ryder R1–2.</p></div>
      )}
      {myPlayer && roundKey !== "r1" && <MyCard player={myPlayer} holes={holes} roundKey={roundKey} round={round} setScore={setScore} submitRound={submitRound} isSubmitted={isSubmitted(myPlayer)} rules={RZ(state)} />}

      {round.kind.includes("ryder") ? (
        <RyderRoundBoard state={state} roundKey={roundKey} />
      ) : (
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round {round.n} — {round.name}</div>
        {(() => {
          const Header = () => (
            <div style={{ ...S.lbRow, ...S.lbHead }}>
              <span style={{ width: 24 }}>#</span>
              <span style={{ flex: 1 }}>Player</span>
              <span style={{ width: 42, textAlign: "center" }}>Thru</span>
              {round.kind === "stableford" && <span style={{ width: 44, textAlign: "right" }}>Pts</span>}
              <span style={{ width: 52, textAlign: "right" }}>Gross</span>
              <span style={{ width: 52, textAlign: "right" }}>Net</span>
            </div>
          );
          const Row = ({ r: rr, i }) => {
            const { p, thru, gross, net, toPar, stbl } = rr;
            return (
              <div key={p.id}>
                <div className="nz-lbrow" style={{ ...S.lbRow, cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <span style={{ width: 24, color: C.copperLt, fontWeight: 700, fontFamily: SANS }}>{thru ? i + 1 : "–"}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{dispName(p)}{p.name === me && <span style={S.youDot}>you</span>}{isSubmitted(p) && <span style={S.subDot}>✓</span>}{hasNick(p) && <span style={{ display: "block", fontSize: 11, color: C.fescue, fontWeight: 400, fontFamily: SANS }}>{p.name}</span>}</span>
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
            );
          };

          // R6: split into Championship (top 4) and Losers (bottom 4) groups
          if (roundKey === "r6" && (state.r6.champ.length || state.r6.losers.length)) {
            const inGroup = (ids) => rows.filter((rr) => ids.includes(rr.p.id))
              .sort((a, b) => { if (!a.thru) return 1; if (!b.thru) return -1; return a.net - b.net; });
            const champRows = inGroup(state.r6.champ);
            const loserRows = inGroup(state.r6.losers);
            return (
              <>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.copperLt, fontFamily: SANS, margin: "12px 0 4px" }}>🏆 CHAMPIONSHIP GROUP · low net wins the tournament</div>
                <div style={{ display: "grid", gap: 1 }}><Header />{champRows.map((rr, i) => <Row key={rr.p.id} r={rr} i={i} />)}</div>
                <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, margin: "18px 0 4px" }}>LOSERS GROUP · high net is the tournament loser</div>
                <div style={{ display: "grid", gap: 1 }}><Header />{loserRows.map((rr, i) => <Row key={rr.p.id} r={rr} i={i} />)}</div>
              </>
            );
          }

          // all other rounds: single combined leaderboard
          return (
            <div style={{ display: "grid", gap: 1, marginTop: 10 }}>
              <Header />
              {rows.map((rr, i) => <Row key={rr.p.id} r={rr} i={i} />)}
            </div>
          );
        })()}
        <p style={S.hint}>Tap a player to see their full scorecard. Net scoring applied automatically.{isCommish ? " As commissioner you can reopen or clear a submitted round here." : ""}{roundKey === "r6" && !state.r6.champ.length ? " R6 groups are set by the commissioner after Round 5." : ""}</p>
      </div>
      )}
    </div>
  );
}

function ScrambleTeamCard({ state, holes, match, side, setTeamScore, submitTeam, isSubmitted }) {
  const P = (id) => state.players.find((x) => x.id === id);
  const ids = side === "x" ? match.xs : match.ys;
  const oppIds = side === "x" ? match.ys : match.xs;
  const scores = (side === "x" ? match.xScores : match.yScores) || {};
  const teamH = ids.length === 2 ? scrambleTeamHcp(P(ids[0]).h, P(ids[1]).h, RZ(state).scrambleLow, RZ(state).scrambleHigh) : (ids[0] ? P(ids[0]).h : 0);
  const teamNames = ids.map((id) => dispName(P(id))).filter(Boolean).join(" & ");
  const oppNames = oppIds.map((id) => dispName(P(id))).filter(Boolean).join(" & ");

  const thru = holes.filter((H) => scores[H.hole] != null).length;
  const nextHole = thru >= 18 ? 18 : (() => { const miss = holes.find((H) => scores[H.hole] == null); return miss ? miss.hole : 18; })();
  const [h, setH] = useState(nextHole);
  const H = holes.find((x) => x.hole === h);
  const cur = scores[h];
  const teamStrokes = strokesOnHole(H.si, teamH);
  const res = ryderMatchResult(holes, match, state, "r1");
  const myUp = side === "x" ? res.up : -res.up;
  const guardedTeamScore = (mid, sd, hole, val) => {
    if (isSubmitted && !window.confirm("This team round is submitted. Edit anyway?")) return;
    setTeamScore(mid, sd, hole, val);
  };

  return (
    <div className="nz-mycard" style={S.myCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={S.kicker}>Scramble Card · {teamNames}</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.cream, opacity: 0.85 }}>{thru === 0 ? "Not started" : res.final ? res.status : (myUp === 0 ? `AS thru ${thru}` : `${myUp > 0 ? myUp + " UP" : Math.abs(myUp) + " DN"} thru ${thru}`)}</div>
      </div>

      {/* scramble handicap explainer */}
      <div style={S.scrambleHcpBox}>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.cream }}>Team scramble handicap: <strong style={{ color: C.copperLt }}>{teamH}</strong></div>
        <div style={{ fontFamily: SANS, fontSize: 11, color: C.fescue, marginTop: 2 }}>
          {ids.length === 2 ? `35% of ${Math.min(P(ids[0]).h, P(ids[1]).h)} + 15% of ${Math.max(P(ids[0]).h, P(ids[1]).h)} = ${teamH} · vs ${oppNames}` : `vs ${oppNames}`}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button className="nz-holenav" style={S.holeNav} disabled={h <= 1} onClick={() => setH(Math.max(1, h - 1))}>‹</button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 12, color: C.copperLt, fontFamily: SANS, letterSpacing: 2 }}>HOLE</div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, fontFamily: SANS }}>{h}</div>
          <div style={{ marginTop: 4, display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
            <span style={S.parBadge}>PAR {H.par}</span>
            <span style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>SI {H.si}{teamStrokes > 0 ? ` · team ${teamStrokes} stroke${teamStrokes > 1 ? "s" : ""}` : ""}</span>
          </div>
        </div>
        <button className="nz-holenav" style={S.holeNav} disabled={h >= 18} onClick={() => setH(Math.min(18, h + 1))}>›</button>
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: C.fescue, fontFamily: SANS, marginTop: 6 }}>Enter your team's one scramble score</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
          const diff = n - H.par; const active = cur === n;
          return <button key={n} className="nz-score" onClick={() => { guardedTeamScore(match.id, side, h, n); if (h < 18) setTimeout(() => setH(h + 1), 200); }} style={{ ...S.scoreBtn, ...(active ? scoreColor(diff) : {}) }}>{n}</button>;
        })}
      </div>
      {cur != null && <div style={{ textAlign: "center", marginTop: 12, fontFamily: SANS, fontSize: 13, color: C.cream, opacity: 0.9 }}>
        Team gross {cur} · net {netHole(cur, H.si, teamH)} on {h}. <button style={S.clearBtn} onClick={() => guardedTeamScore(match.id, side, h, null)}>clear</button></div>}
      {!isSubmitted && (
        <button className="nz-primary" style={{ ...S.primaryBtn, opacity: thru === 18 ? 1 : 0.55 }}
          onClick={() => { if (thru < 18 && !window.confirm(`Your team has only entered ${thru} of 18 holes. Submit anyway?`)) return; submitTeam(match.id, side); }}>
          {thru === 18 ? "Submit Team Round" : `Submit Team Round (${thru}/18)`}
        </button>
      )}
      {isSubmitted && <div style={S.submittedTag}>✓ TEAM SUBMITTED — locked. Tap a score to edit (you'll confirm). Commissioner can reopen.</div>}
      <p style={{ ...S.hint, textAlign: "center" }}>Either teammate can enter — you share one card. Both of you (and everyone) see it live.</p>
    </div>
  );
}

function MyCard({ player, holes, roundKey, round, setScore, submitRound, isSubmitted, rules = RULES_DEFAULTS }) {
  const rs = player.scores[roundKey] || {};
  const thru = holes.filter((H) => rs[H.hole] != null).length;
  const nextHole = thru >= 18 ? 18 : (() => { const miss = holes.find((H) => rs[H.hole] == null); return miss ? miss.hole : 18; })();
  const [h, setH] = useState(nextHole);
  useEffect(() => { setH(nextHole); /* eslint-disable-next-line */ }, [roundKey]);
  const H = holes.find((x) => x.hole === h);
  const cur = rs[h];
  const strokes = strokesOnHole(H.si, player.h);
  const t = round.kind === "stableford" ? playerStbl(holes, rs, player.h, rules).pts : playerNetTotal(holes, rs, player.h).net;

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
        <div style={S.kicker}>Your Card · {dispName(player)} · R{round.n}</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.cream, opacity: 0.85 }}>{thru === 0 ? "Not started" : `Thru ${thru} · ${round.kind === "stableford" ? t + " pts" : t + " net"}`}</div>
      </div>
      {isSubmitted && <div style={S.submittedTag}>✓ SUBMITTED — locked. Tap a score to edit (you'll be asked to confirm). Commissioner can reopen.</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button className="nz-holenav" style={S.holeNav} disabled={h <= 1} onClick={() => setH(Math.max(1, h - 1))}>‹</button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 12, color: C.copperLt, fontFamily: SANS, letterSpacing: 2 }}>HOLE</div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, fontFamily: SANS, textShadow: "0 2px 20px rgba(255,200,120,0.3)" }}>{h}</div>
          <div style={{ marginTop: 4, display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
            <span style={S.parBadge}>PAR {H.par}</span>
            <span style={{ fontSize: 12, color: C.fescue, fontFamily: SANS }}>SI {H.si}{strokes > 0 ? ` · ${strokes} stroke${strokes > 1 ? "s" : ""}` : ""}</span>
          </div>
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
// RULES — plain-English explanation of every format + scoring
// ============================================================
function RulesView({ state }) {
  const nameA = state.ryder.teamAName || "Team A";
  const nameB = state.ryder.teamBName || "Team B";
  const R = RZ(state);
  const finishStr = R.finishTP.map((v, i) => `${i + 1}${["st","nd","rd"][i] || "th"} = ${v}`).join(", ");
  const Rule = ({ tag, title, children }) => (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTop}><span style={S.kindTag}>{tag}</span></div>
      <div style={S.cardTitle}>{title}</div>
      <div style={{ fontFamily: SANS, fontSize: 14, color: C.cream, lineHeight: 1.6, marginTop: 6 }}>{children}</div>
    </div>
  );
  const StblRow = ({ s, label }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.line}` }}>
      <span>{label}</span><span style={{ fontFamily: SANS, fontWeight: 700, color: C.copperLt }}>{s} pt{s === 1 ? "" : "s"}</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Rule tag="OVERVIEW" title="How the Tournament Works">
        Six rounds, all played on a <b>net</b> basis (your handicap evens the field). Each round awards <b>Tournament Points (TP)</b>. Add up your TP across all six rounds — most points at the end wins the whole thing. The standings tab tracks the running total.
      </Rule>

      <Rule tag="ROUNDS 1–2" title="Ryder Cup (Scramble + Singles)">
        The field splits into two teams, {nameA} vs {nameB}. <b>Round 1</b> is 2v2 scramble match play (each pair plays one ball, best of the two on each hole). <b>Round 2</b> is 1v1 singles match play. Together these are worth <b>6 points</b> (2 scramble matches + 4 singles). Whichever team wins the majority takes the Cup, and <b>every player on the winning team gets {R.ryderTP} TP</b> — it's one team prize for the combined result, not points per match. A 3–3 tie goes to a captain playoff.
        <div style={{ marginTop: 8, color: C.fescue, fontSize: 13 }}>Match play = won hole by hole. "3&2" means 3 holes up with 2 to play — the match is over.</div>
      </Rule>

      <Rule tag="ROUND 3" title="Net Stableford">
        Stableford scores each hole by how you did against par on a <b>net</b> basis (after your handicap strokes). Higher is better. Your points decide your <b>finish position</b>, and position sets your TP (see below). Per-hole points:
        <div style={{ marginTop: 10 }}>
          <StblRow s={R.stbl.albatross} label="Albatross or better (3+ under net)" />
          <StblRow s={R.stbl.eagle} label="Eagle (2 under net)" />
          <StblRow s={R.stbl.birdie} label="Birdie (1 under net)" />
          <StblRow s={R.stbl.par} label="Par (net)" />
          <StblRow s={R.stbl.bogey} label="Bogey (1 over net)" />
          <StblRow s={R.stbl.double} label="Double bogey or worse" />
        </div>
        <div style={{ marginTop: 10, color: C.fescue, fontSize: 13 }}>Example: net birdie on a hole = {R.stbl.birdie} points. Add up all 18. Most total points finishes 1st.</div>
      </Rule>

      <Rule tag="ROUND 4" title="Best Ball Match Play (2v2)">
        Pairs are set from the standings: <b>1st + 8th vs 4th + 5th</b>, and <b>2nd + 7th vs 3rd + 6th</b>. On each hole, each team takes its <b>better net ball</b>; lower net wins the hole. It's match play (holes up/down). <b>Each player on a winning pair earns {R.bestBallTP} TP.</b>
      </Rule>

      <Rule tag="ROUND 5" title="Net Stroke Play">
        Straight net stroke play — lowest net total over 18 holes finishes 1st. Position sets your TP.
      </Rule>

      <Rule tag="ROUND 6" title="Championship Final">
        Final groups are set by standings: the <b>top 4 in TP</b> play the Championship group, the <b>bottom 4</b> play the Losers group. Net stroke play. <b>Lowest net in the Championship group wins the tournament.</b> Highest net in the Losers group is the official "loser."
      </Rule>

      <Rule tag="POINTS" title="Tournament Points by Finish">
        Rounds 3, 5, and 6 award TP by finish position: <b>{finishStr}</b>. Ties split the points evenly. Round 4 best ball awards {R.bestBallTP} TP to each winning player; the Ryder Cup awards {R.ryderTP} TP to each player on the winning team.
      </Rule>

      <Rule tag="HANDICAPS" title="Net Scoring & Scramble Handicaps">
        Everything is net: you get strokes on the hardest holes based on your handicap, so a high-handicapper and a low-handicapper compete fairly. For the Round 1 scramble, each pair plays off a blended team handicap: <b>{R.scrambleLow}% of the lower handicap + {R.scrambleHigh}% of the higher</b>, rounded.
      </Rule>

      <Rule tag="THE BOOK" title="Betting">
        Friendly wagers with auto-generated odds that move with handicaps and live position. Your bet locks at the odds shown when you place it. Markets close automatically once an outcome is decided, and the commissioner can pause the book anytime. Settle up at the clubhouse.
      </Rule>
    </div>
  );
}

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
      <p style={S.hint}>Auto-scored from each player's hole scores. Counts toward the combined Ryder Cup (6 points across both rounds). Win the majority and each player on the winning team gets {RZ(state).ryderTP} TP.</p>
      {(ms || []).map((m) => {
        const res = ryderMatchResult(state.holes, m, state, r.key);
        const color = res.result === "X" ? C.birdie : res.result === "Y" ? C.ocean : res.result === "H" ? C.fescue : C.copperLt;
        return (
          <div key={m.id} style={{ ...S.matchRow, alignItems: "flex-start" }}>
            <span style={{ flex: 1 }}>
              <span style={{ color: res.result === "X" ? C.birdie : C.cream }}>{m.xs.map((id) => dispName(P(id))).join(" & ")}</span>
              <span style={{ color: C.fescue }}> vs </span>
              <span style={{ color: res.result === "Y" ? C.ocean : C.cream }}>{m.ys.map((id) => dispName(P(id))).join(" & ")}</span>
            </span>
            <span style={{ fontFamily: SANS, color, fontSize: 13, fontWeight: 700, textAlign: "right", minWidth: 90 }}>
              {res.final
                ? (res.result === "H" ? "Halved" : `${res.result === "X" ? m.xs.map((id) => firstName(P(id))).join("/") : m.ys.map((id) => firstName(P(id))).join("/")} win ${res.status}`)
                : res.status}
            </span>
          </div>
        );
      })}</div>;
  }
  if (r.key === "r4") {
    if (!state.r4.matches.length) return <p style={S.hint}>Pairings set after R3 standings — 1st+8th vs 4th+5th, 2nd+7th vs 3rd+6th.</p>;
    return <div style={{ marginTop: 8 }}>{state.r4.matches.map((m) => {
      const res = bestBallResult(state.holes, m, state);
      const xN = m.xs.map((id) => dispName(P(id))).join(" & ");
      const yN = m.ys.map((id) => dispName(P(id))).join(" & ");
      const up = res.up;
      let status, color = C.copperLt;
      if (up === 0) { status = res.complete ? "Halved" : "All square"; color = C.fescue; }
      else { const lead = Math.abs(up); const winner = up > 0 ? xN : yN; color = up > 0 ? C.birdie : C.ocean;
        status = res.complete ? `${winner} win ${lead} up` : `${winner} ${lead} up`; }
      return <div key={m.id} style={{ ...S.matchRow, alignItems: "flex-start" }}>
        <span style={{ flex: 1 }}>
          <span style={{ color: up > 0 ? C.birdie : C.cream }}>{xN}</span>
          <span style={{ color: C.fescue }}> vs </span>
          <span style={{ color: up < 0 ? C.ocean : C.cream }}>{yN}</span>
        </span>
        <span style={{ fontFamily: SANS, color, fontSize: 13, fontWeight: 700, textAlign: "right", minWidth: 110 }}>{status}{res.complete ? " · FINAL" : ""}</span>
      </div>; })}</div>;
  }
  if (r.key === "r6") {
    if (!state.r6.champ.length) return <p style={S.hint}>Final groups set after R5 — top 4 in the Championship group, bottom 4 in the Losers group.</p>;
    const parThru6 = (rs) => state.holes.reduce((s, H) => s + (rs[H.hole] != null ? H.par : 0), 0);
    const groupRows = (ids) => ids.map((id) => {
      const pl = P(id); const rs = pl?.scores.r6 || {}; const t = playerNetTotal(state.holes, rs, pl?.h);
      return { id, name: dispName(pl), thru: t.thru, gross: t.gross, net: t.net, toPar: t.thru ? t.net - parThru6(rs) : null };
    }).sort((a, b) => { if (!a.thru) return 1; if (!b.thru) return -1; return a.net - b.net; });
    const Head = () => <div style={{ ...S.lbRow, ...S.lbHead }}><span style={{ flex: 1 }}>Player</span><span style={{ width: 52, textAlign: "right" }}>Gross</span><span style={{ width: 52, textAlign: "right" }}>Net</span></div>;
    const GroupRow = ({ g }) => (
      <div style={S.matchRow}>
        <span style={{ flex: 1 }}>{g.name}</span>
        <span style={{ width: 52, textAlign: "right", fontFamily: SANS, color: C.cream }}>{g.thru ? g.gross : "—"}</span>
        <span style={{ width: 52, textAlign: "right", fontFamily: SANS, fontWeight: 800, color: g.toPar == null ? C.fescue : g.toPar < 0 ? C.birdie : g.toPar > 0 ? C.copperLt : C.cream }}>{g.thru ? relToPar(g.toPar) : "—"}</span>
      </div>
    );
    return <div style={{ marginTop: 8 }}>
      <div style={{ color: C.copperLt, fontFamily: SANS, fontSize: 12, letterSpacing: 1 }}>🏆 CHAMPIONSHIP · low net wins</div>
      <Head />{groupRows(state.r6.champ).map((g) => <GroupRow key={g.id} g={g} />)}
      <div style={{ color: C.fescue, fontFamily: SANS, fontSize: 12, letterSpacing: 1, marginTop: 12 }}>LOSERS · high net is the loser</div>
      <Head />{groupRows(state.r6.losers).map((g) => <GroupRow key={g.id} g={g} />)}
    </div>;
  }
  // stableford / stroke ranking preview
  const isStbl = r.kind === "stableford";
  const parThru = (rs) => state.holes.reduce((s, H) => s + (rs[H.hole] != null ? H.par : 0), 0);
  const vals = state.players.map((p) => {
    const rs = p.scores[r.key] || {};
    const t = playerNetTotal(state.holes, rs, p.h);
    const stbl = isStbl ? playerStbl(state.holes, rs, p.h, RZ(state)) : null;
    return { id: p.id, sortVal: isStbl ? stbl.pts : t.net, thru: t.thru, gross: t.gross, net: t.net, toPar: t.thru ? t.net - parThru(rs) : null, pts: stbl ? stbl.pts : null };
  });
  const any = vals.some((v) => v.thru > 0);
  if (!any) return <p style={S.hint}>{isStbl ? "Net Stableford — best points total earns 7 TP down to 0 for last." : "Net stroke play — lowest net earns 7 TP down to 0 for last."}</p>;
  const sorted = [...vals].sort((a, b) => { if (!a.thru) return 1; if (!b.thru) return -1; return isStbl ? b.sortVal - a.sortVal : a.sortVal - b.sortVal; });
  return <div style={{ marginTop: 8 }}>
    <div style={{ ...S.lbRow, ...S.lbHead }}>
      <span style={{ flex: 1 }}>Player</span>
      {isStbl && <span style={{ width: 44, textAlign: "right" }}>Pts</span>}
      <span style={{ width: 52, textAlign: "right" }}>Gross</span>
      <span style={{ width: 52, textAlign: "right" }}>Net</span>
    </div>
    {sorted.map((v, i) => (
      <div key={v.id} style={S.matchRow}>
        <span style={{ flex: 1 }}>{v.thru ? i + 1 : "–"}. {dispName(P(v.id))}</span>
        {isStbl && <span style={{ width: 44, textAlign: "right", fontFamily: SANS, fontWeight: 700, color: C.cream }}>{v.thru ? v.pts : "—"}</span>}
        <span style={{ width: 52, textAlign: "right", fontFamily: SANS, color: C.cream }}>{v.thru ? v.gross : "—"}</span>
        <span style={{ width: 52, textAlign: "right", fontFamily: SANS, fontWeight: 800, color: v.toPar == null ? C.fescue : v.toPar < 0 ? C.birdie : v.toPar > 0 ? C.copperLt : C.cream }}>{v.thru ? relToPar(v.toPar) : "—"}</span>
      </div>
    ))}
  </div>;
}

// ============================================================
// COMMISH
// ============================================================
// Commish-owned fields that Save commits. Player scores + bets are NOT here —
// they stay live and are preserved on merge so a Save never wipes them.
const COMMISH_FIELDS = ["tournamentName", "holes", "ryder", "r4", "r6", "manualTP", "markets", "rules"];

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
          {[["setup", "Setup"], ["rules", "Scoring Rules"], ["ryder", "Ryder R1–2"], ["r4", "R4 Pairings"], ["r6", "R6 Groups"], ["book", "The Book"], ["clear", "Clear Scores"], ["tp", "TP Override"]].map(([k, l]) => (
            <button key={k} onClick={() => setSection(k)} style={{ ...S.roundPill, ...(section === k ? S.roundPillOn : {}) }}>{l}</button>
          ))}
        </div>
        <p style={S.hint}>Edits are held as a draft on your screen until you press <b>Save</b>. Player scores keep updating live the whole time and are never overwritten by your save.</p>
      </div>

      {section === "setup" && <CommishSetup state={draft} save={draftSave} flash={flash} />}
      {section === "rules" && <CommishRules state={draft} save={draftSave} flash={flash} />}
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

function CommishRules({ state, save, flash }) {
  const R = RZ(state);
  const setRules = (patch) => save({ ...state, rules: { ...R, ...patch } });
  const setFinish = (i, val) => { const arr = [...R.finishTP]; arr[i] = parseFloat(val) || 0; setRules({ finishTP: arr }); };
  const setStbl = (k, val) => setRules({ stbl: { ...R.stbl, [k]: parseFloat(val) || 0 } });
  const resetAll = () => { if (!window.confirm("Reset all scoring rules to the original defaults?")) return; save({ ...state, rules: JSON.parse(JSON.stringify(RULES_DEFAULTS)) }); flash("Rules reset to defaults."); };
  const NumF = ({ value, onChange, w = 56 }) => (
    <input className="nz-input" style={{ ...S.input, width: w, textAlign: "center" }} type="number" step="0.5" defaultValue={value} onBlur={(e) => onChange(e.target.value)} />
  );
  const ordinal = (i) => `${i + 1}${["st", "nd", "rd"][i] || "th"}`;
  return (
    <>
      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Scoring Rules</div>
        <p style={S.hint}>Change how points are awarded. Edits are held as a draft until you press <b>Save</b> at the bottom — then they go live and the Rules tab updates to match. Defaults shown in grey.</p>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>TP by Finish Position</div>
        <p style={S.hint}>Points for each finishing place in Rounds 3, 5 and 6. Ties split evenly.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10 }}>
          {R.finishTP.map((v, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS, marginBottom: 3 }}>{ordinal(i)} <span style={{ opacity: 0.6 }}>({RULES_DEFAULTS.finishTP[i]})</span></div>
              <NumF value={v} onChange={(val) => setFinish(i, val)} w="100%" />
            </div>
          ))}
        </div>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Stableford Points (per hole, net)</div>
        <p style={S.hint}>Points earned on each hole vs. net par in Round 3.</p>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {[["albatross", "Albatross+ (3+ under)"], ["eagle", "Eagle (2 under)"], ["birdie", "Birdie (1 under)"], ["par", "Par"], ["bogey", "Bogey (1 over)"], ["double", "Double+ (2+ over)"]].map(([k, label]) => (
            <div key={k} style={{ ...S.lbRow, alignItems: "center" }}>
              <span style={{ flex: 1 }}>{label} <span style={{ color: C.fescue, fontSize: 12 }}>(default {RULES_DEFAULTS.stbl[k]})</span></span>
              <NumF value={R.stbl[k]} onChange={(val) => setStbl(k, val)} />
            </div>
          ))}
        </div>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Match-Play TP Values</div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ ...S.lbRow, alignItems: "center" }}>
            <span style={{ flex: 1 }}>Round 4 best ball — per winning player <span style={{ color: C.fescue, fontSize: 12 }}>(default {RULES_DEFAULTS.bestBallTP})</span></span>
            <NumF value={R.bestBallTP} onChange={(val) => setRules({ bestBallTP: parseFloat(val) || 0 })} />
          </div>
          <div style={{ ...S.lbRow, alignItems: "center" }}>
            <span style={{ flex: 1 }}>Ryder Cup — per player on winning team <span style={{ color: C.fescue, fontSize: 12 }}>(default {RULES_DEFAULTS.ryderTP})</span></span>
            <NumF value={R.ryderTP} onChange={(val) => setRules({ ryderTP: parseFloat(val) || 0 })} />
          </div>
        </div>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Scramble Handicap Blend</div>
        <p style={S.hint}>Round 1 team handicap = (low% × lower handicap) + (high% × higher handicap), rounded. Defaults 35% / 15%.</p>
        <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS, marginBottom: 3 }}>Lower handicap % <span style={{ opacity: 0.6 }}>(35)</span></div>
            <NumF value={R.scrambleLow} onChange={(val) => setRules({ scrambleLow: parseFloat(val) || 0 })} w="100%" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS, marginBottom: 3 }}>Higher handicap % <span style={{ opacity: 0.6 }}>(15)</span></div>
            <NumF value={R.scrambleHigh} onChange={(val) => setRules({ scrambleHigh: parseFloat(val) || 0 })} w="100%" />
          </div>
        </div>
      </div>

      <div className="nz-glass" style={{ ...S.card, border: "1px solid rgba(224,117,85,0.4)" }}>
        <div style={S.cardTitle}>Reset</div>
        <p style={S.hint}>Put every scoring rule back to the original defaults. (Still a draft until you Save.)</p>
        <button style={{ ...S.miniGhost, padding: "10px 16px", marginTop: 8, color: C.bogeyBad, borderColor: "rgba(224,117,85,0.5)" }} onClick={resetAll}>Reset all rules to defaults</button>
      </div>
    </>
  );
}

function CommishSetup({ state, save, flash }) {
  const [tName, setTName] = useState(state.tournamentName);
  const setSI = async (hole, si) => { const holes = state.holes.map((H) => H.hole === hole ? { ...H, si: Math.max(1, Math.min(18, parseInt(si) || H.si)) } : H); await save({ ...state, holes }); };
  const setPar = async (hole, par) => { const holes = state.holes.map((H) => H.hole === hole ? { ...H, par: Math.max(3, Math.min(6, parseInt(par) || H.par)) } : H); await save({ ...state, holes }); };
  const setHcp = async (id, h) => { const players = state.players.map((p) => p.id === id ? { ...p, h: parseFloat(h) || 0 } : p); await save({ ...state, players }); };
  const resetPin = async (id, name) => { if (!window.confirm(`Reset ${name}'s login code? They'll set a new one next time they log in.`)) return; const players = state.players.map((p) => p.id === id ? { ...p, pin: "" } : p); await save({ ...state, players }); flash(`${name}'s code reset.`); };
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
        <div style={S.cardTitle}>Player Login Codes</div>
        <p style={S.hint}>Players set their own 4-digit code on first login. Reset one here if someone forgets it or you need to re-issue it.</p>
        <div style={{ display: "grid", gap: 1, marginTop: 8 }}>
          {state.players.map((p) => (
            <div key={p.id} style={S.lbRow}>
              <span style={{ flex: 1 }}>{p.name} <span style={{ color: p.pin ? C.birdie : C.fescue, fontSize: 12, fontFamily: SANS }}>{p.pin ? "· code set" : "· not claimed"}</span></span>
              <button style={S.miniGhost} disabled={!p.pin} onClick={() => resetPin(p.id, p.name)}>Reset code</button>
            </div>
          ))}
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
  const clearTeams = async () => {
    if (!window.confirm("Clear both team rosters? (Matches and names stay.)")) return;
    await save({ ...state, ryder: { ...ry, teamA: [], teamB: [] } });
  };
  const clearMatches = async () => {
    if (!window.confirm("Remove all R1 scramble and R2 singles matches? (Team rosters stay.)")) return;
    await save({ ...state, ryder: { ...ry, r1: [], r2: [] } });
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
        <div style={S.cardTitle}>Team Names</div>
        <p style={S.hint}>Name the two teams whatever you like — used everywhere on the Ryder Cup board.</p>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ ...S.teamBtn, ...S.teamBtnA, display: "grid", placeItems: "center" }}>A</span>
            <input className="nz-input" style={S.input} defaultValue={ry.teamAName || "Team A"} onBlur={(e) => save({ ...state, ryder: { ...ry, teamAName: e.target.value.trim() || "Team A" } })} placeholder="Team A name" />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ ...S.teamBtn, ...S.teamBtnB, display: "grid", placeItems: "center" }}>B</span>
            <input className="nz-input" style={S.input} defaultValue={ry.teamBName || "Team B"} onBlur={(e) => save({ ...state, ryder: { ...ry, teamBName: e.target.value.trim() || "Team B" } })} placeholder="Team B name" />
          </div>
        </div>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Assign Teams</div>
        <p style={S.hint}>Tap to put a player on {ry.teamAName || "Team A"} or {ry.teamBName || "Team B"} (4 each).</p>
        <div style={{ display: "grid", gap: 1, marginTop: 8 }}>
          {state.players.map((p) => (
            <div key={p.id} style={S.lbRow}>
              <span style={{ flex: 1 }}>{p.name} <span style={{ color: C.fescue }}>· {p.h}</span></span>
              <button onClick={() => toggleTeam(p.id, "teamA")} style={{ ...S.teamBtn, ...(ry.teamA.includes(p.id) ? S.teamBtnA : {}) }}>A</button>
              <button onClick={() => toggleTeam(p.id, "teamB")} style={{ ...S.teamBtn, ...(ry.teamB.includes(p.id) ? S.teamBtnB : {}) }}>B</button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 12, color: C.fescue }}>{ry.teamAName || "Team A"}: {ry.teamA.length}/4 · {ry.teamBName || "Team B"}: {ry.teamB.length}/4</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={{ ...S.miniGhost, color: C.bogeyBad, borderColor: "rgba(224,117,85,0.5)" }} onClick={clearTeams}>Clear rosters</button>
          <button style={{ ...S.miniGhost, color: C.bogeyBad, borderColor: "rgba(224,117,85,0.5)" }} onClick={clearMatches}>Clear all matches</button>
        </div>
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
          <div key={m.id} style={S.matchRow}><span style={{ flex: 1 }}>Match {i + 1}: {m.xs.map((id) => dispName(P(id))).join(" & ")} <span style={{ color: C.fescue }}>vs</span> {m.ys.map((id) => dispName(P(id))).join(" & ")}</span></div>
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
        {state.r6.champ.map((id) => <div key={id} style={S.matchRow}><span>{dispName(P(id))}</span></div>)}
        <div style={{ color: C.fescue, fontFamily: SANS, fontSize: 12, letterSpacing: 1, marginTop: 8 }}>LOSERS</div>
        {state.r6.losers.map((id) => <div key={id} style={S.matchRow}><span>{dispName(P(id))}</span></div>)}
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
// ---- live position helpers (blend in-progress standing into the odds) ----
// Net to-par for a player in a round (lower = better). Used to gauge who's pulling away.
function playerLiveEdge(state, pid, roundKey) {
  const p = state.players.find((x) => x.id === pid); if (!p) return 0;
  const rs = p.scores[roundKey] || {};
  let net = 0, par = 0;
  state.holes.forEach((H) => { if (rs[H.hole] != null) { net += netHole(rs[H.hole], H.si, p.h); par += H.par; } });
  return par ? par - net : 0; // positive = under par (playing well)
}

// Money-balancing: shade an option's probability toward where the stakes are.
// More money on a side -> its implied prob rises (odds shorten), the other lengthens.
// strength = base softmax probs (array), stakes = array of $ on each option.
function shadeForMoney(probs, stakes, weight = 0.25) {
  const total = stakes.reduce((a, b) => a + b, 0);
  if (total <= 0) return probs;
  const moneyShare = stakes.map((s) => s / total);
  // blend: final = (1-w)*model + w*money. Keeps model primary, nudges toward the book.
  const blended = probs.map((p, i) => (1 - weight) * p + weight * moneyShare[i]);
  const sum = blended.reduce((a, b) => a + b, 0);
  return blended.map((x) => x / sum);
}

// stakes per option for a market (pending only)
function stakesByOption(state, marketId, optionIds) {
  const map = {}; optionIds.forEach((id) => (map[id] = 0));
  state.bets.filter((b) => b.marketId === marketId && b.status === "pending").forEach((b) => { if (b.optionId in map) map[b.optionId] += b.stake; });
  return optionIds.map((id) => map[id]);
}

function autoOddsByTP(state, tp, marketId, openOdds) {
  const ps = state.players.map((p) => ({ id: p.id, name: dispName(p), tp: tp.tp[p.id] }));
  const liveRound = currentLiveRound(state);
  // live movement each player has earned: TP banked + gentle nudge from round in progress
  const movement = ps.map((p) => p.tp + (liveRound ? 0.6 * playerLiveEdge(state, p.id, liveRound) : 0));
  let probs;
  if (openOdds && Object.keys(openOdds).length) {
    // anchor: start from the commish's opening implied probabilities, then add live movement
    const base = ps.map((p) => {
      const o = openOdds[p.id];
      const impliedProb = o != null ? (o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100)) : 0.12;
      return Math.log(Math.max(impliedProb, 0.01)); // log-space so we can add movement linearly
    });
    const strengths = base.map((b, i) => b * 10 + movement[i]); // *10 to weight the anchor strongly
    probs = softmax(strengths, 10);
  } else {
    const strengths = ps.map((p, i) => p.tp + 8 + (liveRound ? 0.6 * playerLiveEdge(state, p.id, liveRound) : 0));
    probs = softmax(strengths, 10);
  }
  if (marketId) probs = shadeForMoney(probs, stakesByOption(state, marketId, ps.map((p) => p.id)));
  return ps.map((p, i) => ({ id: p.id, label: p.name, odds: withVig(probToAmerican(probs[i])) }));
}

// the round most likely "in progress" — the lowest-numbered round with partial scores
function currentLiveRound(state) {
  for (const r of ["r3", "r5", "r6", "r1", "r2"]) {
    const any = state.players.some((p) => Object.keys(p.scores[r] || {}).length > 0);
    if (any && !state.players.every((p) => Object.keys(p.scores[r] || {}).length === 18)) return r;
  }
  return null;
}

// Two-way odds for a single Ryder match. Handicap sets the baseline (kept tight because
// handicaps even the field); live match position shifts it — gently at 1 up, hard as a
// side pulls away (4-5 up). Money on a side shades the line toward it.
function autoOddsForMatch(state, m, roundKey, marketId) {
  const P = (id) => state.players.find((x) => x.id === id);
  const sideH = (ids) => ids.length === 2 ? scrambleTeamHcp(P(ids[0]).h, P(ids[1]).h, RZ(state).scrambleLow, RZ(state).scrambleHigh) : (ids[0] ? P(ids[0]).h : 18);
  const xs = roundKey === "r1" ? sideH(m.xs) : P(m.xs[0]).h;
  const ys = roundKey === "r1" ? sideH(m.ys) : P(m.ys[0]).h;
  // baseline handicap strength (small spread; temp 5 keeps it modest)
  const baseX = -xs, baseY = -ys;
  // live position: holes up, but scaled by how many holes remain. A 2-up lead early is
  // soft; the same lead with few holes left is decisive. This keeps swings gentle until
  // someone is genuinely pulling away.
  const res = ryderMatchResult(state.holes, m, state, roundKey);
  const up = res.up; // + = X ahead
  const remaining = Math.max(1, 18 - res.thru);
  // dominance: lead relative to what's catchable. ~0.1 early, ->1 as lead approaches remaining.
  const dominance = Math.sign(up) * Math.min(1, Math.pow(Math.abs(up) / Math.max(remaining, Math.abs(up)), 0.85)) * Math.abs(up);
  const liveX = baseX + dominance * 1.6, liveY = baseY - dominance * 1.6;
  let probs = res.final
    ? (res.result === "X" ? [0.97, 0.03] : res.result === "Y" ? [0.03, 0.97] : [0.5, 0.5])
    : softmax([liveX, liveY], 5);
  const label = (ids) => ids.map((id) => dispName(P(id))).join(" & ");
  const optIds = ["X_" + m.id, "Y_" + m.id];
  if (marketId) probs = shadeForMoney(probs, stakesByOption(state, marketId, optIds));
  return [
    { optionId: optIds[0], label: label(m.xs), odds: withVig(probToAmerican(probs[0])), manual: false },
    { optionId: optIds[1], label: label(m.ys), odds: withVig(probToAmerican(probs[1])), manual: false },
  ];
}

// Over/Under on Team A's total Ryder points. Handicap baseline + live Cup position.
function autoOddsOverUnder(state, tp, marketId) {
  const P = (id) => state.players.find((x) => x.id === id);
  const sumH = (ids) => ids.reduce((s, id) => s + (P(id)?.h || 0), 0);
  let aStr = -sumH(state.ryder.teamA), bStr = -sumH(state.ryder.teamB);
  // live: current Cup points shift the O/U
  const d = tp.detail.ryder;
  if (d) { aStr += (d.aPts - 3) * 1.5; bStr += (d.bPts - 3) * 1.5; }
  let probs = softmax([aStr, bStr], 14);
  const optIds = ["over", "under"];
  if (marketId) probs = shadeForMoney(probs, stakesByOption(state, marketId, optIds));
  return [
    { optionId: "over", label: "Over 3.5", odds: withVig(probToAmerican(probs[0])), manual: false },
    { optionId: "under", label: "Under 3.5", odds: withVig(probToAmerican(probs[1])), manual: false },
  ];
}

// Regenerate odds for a market if it's auto (not manually pinned).
function refreshedOptions(market, state, tp) {
  if (market.kind === "outright" || market.kind === "next_round") {
    const auto = autoOddsByTP(state, tp, market.id, market.openOdds);
    return market.options.map((o) => o.manual ? o : (auto.find((x) => x.id === o.optionId) ? { ...o, odds: auto.find((x) => x.id === o.optionId).odds } : o));
  }
  if (market.kind === "match" && market.matchRef) {
    const m = [...(state.ryder.r1 || []), ...(state.ryder.r2 || [])].find((x) => x.id === market.matchRef.id);
    if (m) { const auto = autoOddsForMatch(state, m, market.matchRef.roundKey, market.id); return market.options.map((o) => o.manual ? o : (auto.find((a) => a.optionId === o.optionId) ? { ...o, odds: auto.find((a) => a.optionId === o.optionId).odds } : o)); }
  }
  if (market.kind === "overunder") {
    const auto = autoOddsOverUnder(state, tp, market.id);
    return market.options.map((o) => o.manual ? o : (auto.find((a) => a.optionId === o.optionId) ? { ...o, odds: auto.find((a) => a.optionId === o.optionId).odds } : o));
  }
  return market.options;
}

// Should this market be closed to NEW bets? Locks when the outcome is decided or so
// lopsided it's effectively decided, or when the commish has manually locked it.
// Determine a market's outcome from live data.
// Returns { decided, winningOptionId, lock, reason } — lock can be true before
// fully decided (runaway lead). winningOptionId is only meaningful when decided.
function marketOutcome(market, state, tp) {
  const none = { decided: false, winningOptionId: null, lock: false, reason: "" };
  const ry = state.ryder;

  // ---- Ryder match (single match X vs Y) ----
  if (market.kind === "match" && market.matchRef) {
    const m = [...(ry.r1 || []), ...(ry.r2 || [])].find((x) => x.id === market.matchRef.id);
    if (!m) return none;
    const res = ryderMatchResult(state.holes, m, state, market.matchRef.roundKey);
    if (res.final) {
      const winId = res.result === "X" ? "X_" + m.id : res.result === "Y" ? "Y_" + m.id : null; // halved → no single winner
      return { decided: winId != null, winningOptionId: winId, lock: true, reason: `Final — ${res.status}`, halved: res.result === "H" };
    }
    const remaining = 18 - res.thru;
    if (Math.abs(res.up) > 0 && Math.abs(res.up) >= remaining - 1 && res.thru >= 9) return { ...none, lock: true, reason: `${Math.abs(res.up)} up, ${remaining} to play` };
    return none;
  }

  // ---- Tournament Winner (outright; one option per player) ----
  if (market.kind === "outright") {
    const finished = state.players.filter((p) => playerNetTotal(state.holes, p.scores.r6, p.h).thru === 18).length;
    const allDone = state.r6.champ.length > 0 && state.r6.champ.every((id) => { const pl = state.players.find((x) => x.id === id); return playerNetTotal(state.holes, pl?.scores.r6, pl?.h).thru === 18; });
    // Decided: championship group all finished R6 → lowest net in champ group wins the tournament.
    if (allDone) {
      let best = null, bestNet = Infinity;
      state.r6.champ.forEach((id) => { const pl = state.players.find((x) => x.id === id); const net = playerNetTotal(state.holes, pl?.scores.r6, pl?.h).net; if (net < bestNet) { bestNet = net; best = id; } });
      // tie at the top → not auto-decided (commish playoff)
      const tied = state.r6.champ.filter((id) => { const pl = state.players.find((x) => x.id === id); return playerNetTotal(state.holes, pl?.scores.r6, pl?.h).net === bestNet; });
      if (best && tied.length === 1) return { decided: true, winningOptionId: best, lock: true, reason: "Tournament over — champion decided" };
      return { ...none, lock: true, reason: "Final group done — tie, awaiting playoff" };
    }
    // Runaway lock: late in R6 and the TP leader is mathematically (or near) uncatchable.
    const ranked = [...state.players].map((p) => ({ id: p.id, pts: tp.tp[p.id] })).sort((a, b) => b.pts - a.pts);
    if (ranked.length >= 2 && state.r6.champ.length) {
      const lead = ranked[0].pts - ranked[1].pts;
      const champThru = state.r6.champ.map((id) => { const pl = state.players.find((x) => x.id === id); return playerNetTotal(state.holes, pl?.scores.r6, pl?.h).thru; });
      const minThru = Math.min(...champThru);
      // R6 is the last points round; if leader is well clear and final group is deep into the round, lock.
      if (lead >= 7 && minThru >= 14) return { ...none, lock: true, reason: "Leader pulling away late" };
    }
    return none;
  }

  // ---- Over/Under on Team A's Ryder points ----
  if (market.kind === "overunder") {
    const d = tp.detail.ryder;
    if (!d) return none;
    const ryderDone = (ry.r1 || []).every((m) => ryderMatchResult(state.holes, m, state, "r1").final) &&
                      (ry.r2 || []).every((m) => ryderMatchResult(state.holes, m, state, "r2").final) &&
                      ((ry.r1 || []).length + (ry.r2 || []).length) > 0;
    const line = 3.5; // O/U 3.5
    if (ryderDone) {
      const over = d.aPts > line;
      const opt = market.options.find((o) => (over ? /over/i : /under/i).test(o.label));
      return { decided: !!opt, winningOptionId: opt?.optionId || null, lock: true, reason: "Ryder Cup complete" };
    }
    // clinch: if aPts already > line and remaining can't pull it back under, or vice versa
    const totalMatches = (ry.r1 || []).length + (ry.r2 || []).length;
    const played = (ry.r1 || []).filter((m) => ryderMatchResult(state.holes, m, state, "r1").final).length + (ry.r2 || []).filter((m) => ryderMatchResult(state.holes, m, state, "r2").final).length;
    const remain = totalMatches - played;
    if (totalMatches > 0) {
      if (d.aPts > line && (d.aPts - line) > remain) return { ...none, lock: true, reason: "Over clinched" };
      if ((line - d.aPts) > remain) return { ...none, lock: true, reason: "Under clinched" };
    }
    return none;
  }

  // ---- Ryder Cup Winner (prop with team-name options) ----
  if (market.kind === "prop" && /cup winner/i.test(market.title || "")) {
    const d = tp.detail.ryder;
    if (!d || !d.winners) {
      // clinch check: 3.5 of 6 wins
      if (d) { if (d.aPts >= 3.5) return { ...none, lock: true, reason: "Team A clinched" }; if (d.bPts >= 3.5) return { ...none, lock: true, reason: "Team B clinched" }; }
      return none;
    }
    const winnerName = d.winners === ry.teamA ? (ry.teamAName || "Team A") : (ry.teamBName || "Team B");
    const opt = market.options.find((o) => o.label === winnerName);
    return { decided: !!opt, winningOptionId: opt?.optionId || null, lock: true, reason: "Cup decided" };
  }

  return none; // fun props (longest drive, etc.) stay manual
}

function marketLocked(market, state, tp) {
  if (state.bookPaused) return { locked: true, reason: "Book paused" };
  if (market.locked) return { locked: true, reason: "Closed by commissioner" };
  if (market.status === "settled") return { locked: true, reason: "Settled" };
  if (tp) { const o = marketOutcome(market, state, tp); if (o.lock) return { locked: true, reason: o.reason }; }
  return { locked: false };
}

function BookView({ state, tp, me, setName, save, flash }) {
  const [sel, setSel] = useState(null); // {marketId, optionId, label, odds, title}
  const [stake, setStake] = useState("");
  const P = (id) => state.players.find((x) => x.id === id);

  const place = async () => {
    if (state.bookPaused) { setSel(null); return flash("The book is paused right now."); }
    if (!me) return flash("Check in with your name first.");
    if (!sel) return flash("Tap a line to bet.");
    const mkt = state.markets.find((x) => x.id === sel.marketId);
    if (mkt && marketLocked(mkt, state, tp).locked) { setSel(null); return flash("That market just closed."); }
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
      {state.bookPaused && (
        <div className="nz-glass" style={{ ...S.card, border: "1px solid rgba(224,117,85,0.5)", textAlign: "center" }}>
          <div style={{ fontSize: 30 }}>⏸️</div>
          <div style={S.cardTitle}>The Book is temporarily closed</div>
          <p style={{ ...S.hint, textAlign: "center" }}>The commissioner has paused betting. Existing bets still stand — you just can't place new ones right now. Check back soon.</p>
        </div>
      )}
      {!me && <div className="nz-glass" style={S.card}><div style={S.cardTitle}>Log in to bet</div>
        <p style={S.hint}>Use the Check In box at the top to log in with your name and code, then you can place bets.</p></div>}

      {!openMarkets.length && <Empty msg="No betting lines open yet. The commissioner opens markets — odds move automatically as scores and points change." />}

      {me && (() => {
        const mine = state.bets.filter((b) => b.who === me);
        if (!mine.length) return null;
        const open = mine.filter((b) => b.status === "pending");
        const won = mine.filter((b) => b.status === "won");
        const lost = mine.filter((b) => b.status === "lost");
        const atRisk = open.reduce((s, b) => s + b.stake, 0);
        const toWin = open.reduce((s, b) => s + (b.payout - b.stake), 0);
        const net = won.reduce((s, b) => s + (b.payout - b.stake), 0) - lost.reduce((s, b) => s + b.stake, 0);
        const Line = ({ b }) => (
          <div style={S.openBetRow}>
            <span style={{ flex: 1 }}>{b.label}</span>
            <span style={{ fontFamily: SANS, color: b.status === "won" ? C.birdie : b.status === "lost" ? C.bogeyBad : C.copperLt }}>
              ${b.stake} @ {b.oddsAtBet > 0 ? `+${b.oddsAtBet}` : b.oddsAtBet}{b.status === "won" ? ` · +$${(b.payout - b.stake).toFixed(2)}` : b.status === "lost" ? " · lost" : ""}
            </span>
          </div>
        );
        return (
          <div className="nz-glass" style={S.card}>
            <div style={S.cardTitle}>My Bets — {me}</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontFamily: SANS, fontSize: 13 }}>
              <span style={{ color: C.fescue }}>At risk <strong style={{ color: C.cream }}>${atRisk.toFixed(2)}</strong></span>
              <span style={{ color: C.fescue }}>Could win <strong style={{ color: C.copperLt }}>${toWin.toFixed(2)}</strong></span>
              <span style={{ color: C.fescue }}>Settled net <strong style={{ color: net > 0 ? C.birdie : net < 0 ? C.bogeyBad : C.cream }}>{net > 0 ? "+" : ""}${net.toFixed(2)}</strong></span>
            </div>
            {open.length > 0 && <><div style={S.myBetsHead}>OPEN</div>{open.map((b) => <Line key={b.id} b={b} />)}</>}
            {won.length > 0 && <><div style={S.myBetsHead}>WON</div>{won.map((b) => <Line key={b.id} b={b} />)}</>}
            {lost.length > 0 && <><div style={S.myBetsHead}>LOST</div>{lost.map((b) => <Line key={b.id} b={b} />)}</>}
          </div>
        );
      })()}

      {openMarkets.map((m) => {
        const opts = refreshedOptions(m, state, tp);
        const betsOnMarket = state.bets.filter((b) => b.marketId === m.id);
        const lock = marketLocked(m, state, tp);
        return (
          <div key={m.id} className="nz-glass" style={S.card}>
            <div style={S.cardTop}><span style={S.kindTag}>{m.kind === "outright" ? "OUTRIGHT" : m.kind === "next_round" ? "NEXT ROUND" : m.kind === "match" ? "RYDER MATCH" : m.kind === "overunder" ? "OVER/UNDER" : "PROP"}</span>
              {lock.locked ? <span style={{ ...S.kindTag, color: C.bogeyBad }}>🔒 CLOSED</span> : m.live && <span style={{ ...S.kindTag, color: C.birdie }}>● LIVE ODDS</span>}</div>
            <div style={S.cardTitle}>{m.title}</div>
            {lock.locked && <div style={{ fontSize: 12, color: C.bogeyBad, fontFamily: SANS, marginTop: 2 }}>Betting closed — {lock.reason}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {opts.map((o) => {
                const active = sel && sel.marketId === m.id && sel.optionId === o.optionId;
                const moneyOn = betsOnMarket.filter((b) => b.optionId === o.optionId && b.status === "pending").reduce((s, b) => s + b.stake, 0);
                return (
                  <button key={o.optionId} className="nz-oddsbtn" disabled={lock.locked} onClick={() => !lock.locked && setSel({ marketId: m.id, optionId: o.optionId, label: o.label, odds: o.odds, title: m.title })}
                    style={{ ...S.oddsChip, ...(active ? S.oddsSelected : {}), ...(lock.locked ? { opacity: 0.45, cursor: "not-allowed" } : {}) }}>
                    <span style={S.oddsLabel}>{o.label}</span>
                    <span style={S.oddsNum}>{o.odds > 0 ? `+${o.odds}` : o.odds}{o.manual ? " ✎" : ""}</span>
                    {moneyOn > 0 && <span style={{ fontSize: 11, color: C.birdie, fontFamily: SANS, marginTop: 2 }}>${moneyOn} in</span>}
                  </button>
                );
              })}
            </div>
            {/* aggregated: where the money is */}
            {(() => {
              const agg = {};
              betsOnMarket.filter((b) => b.status === "pending").forEach((b) => { agg[b.optionId] = (agg[b.optionId] || 0) + b.stake; });
              const rows = Object.entries(agg).sort((a, b) => b[1] - a[1]);
              if (!rows.length) return null;
              return (
                <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, marginBottom: 6 }}>WHERE THE MONEY IS</div>
                  {rows.map(([oid, amt]) => {
                    const opt = opts.find((o) => o.optionId === oid);
                    return <div key={oid} style={S.openBetRow}><span style={{ flex: 1 }}>{opt?.label || "—"}</span>
                      <span style={{ fontFamily: SANS, fontWeight: 700, color: C.copperLt }}>${amt}</span></div>;
                  })}
                </div>
              );
            })()}
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
  // commish opening tournament-winner lines (American odds per player)
  const [openLines, setOpenLines] = useState(() => { const o = {}; state.players.forEach((p) => (o[p.id] = "")); return o; });

  const openOutright = async () => {
    // use commish-entered opening lines as the anchor; blanks default to a mid line
    const openOdds = {};
    state.players.forEach((p) => { const v = parseInt(openLines[p.id]); openOdds[p.id] = Number.isFinite(v) ? v : 800; });
    const auto = autoOddsByTP(state, tp, null, openOdds);
    const m = { id: uid(), title: "Tournament Winner", kind: "outright", live: true, status: "open", openOdds,
      options: auto.map((a) => ({ optionId: a.id, label: a.label, odds: a.odds, manual: false })) };
    await save({ ...state, markets: [...state.markets, m] });
    flash("Tournament winner market opened — opening lines set, will drift with scores.");
  };
  const openNextRound = async () => {
    const auto = autoOddsByTP(state, tp);
    const m = { id: uid(), title: "Wins the Next Round", kind: "next_round", live: true, status: "open",
      options: auto.map((a) => ({ optionId: a.id, label: a.label, odds: a.odds, manual: false })) };
    await save({ ...state, markets: [...state.markets, m] });
    flash("Next-round market opened.");
  };
  // Fun manual props the commish settles by hand.
  const openFunProp = async (kind) => {
    let title, options;
    const playerOpts = (oddsVal) => state.players.map((p) => ({ optionId: uid(), label: dispName(p), odds: oddsVal, manual: true }));
    if (kind === "balls") { title = "Most golf balls lost"; options = playerOpts(700); }
    else if (kind === "drive") { title = "Longest drive of the trip"; options = playerOpts(700); }
    else if (kind === "threeputt") { title = "Most 3-putts"; options = playerOpts(700); }
    else if (kind === "round") { title = "First to buy a round at the clubhouse"; options = playerOpts(700); }
    const m = { id: uid(), title, kind: "prop", live: false, status: "open", options };
    await save({ ...state, markets: [...state.markets, m] });
    flash(`"${title}" posted — settle it by hand.`);
  };
  // One-tap: a moneyline for every Ryder match (scramble + singles)
  const openAllMatches = async () => {
    const P2 = (id) => state.players.find((x) => x.id === id);
    const label = (ids) => ids.map((id) => P2(id)?.name).join(" & ");
    const build = (m, rk, rn) => ({ id: uid(), title: `${rn}: ${label(m.xs)} vs ${label(m.ys)}`, kind: "match", matchRef: { id: m.id, roundKey: rk }, live: true, status: "open", options: autoOddsForMatch(state, m, rk) });
    const ms = [...(state.ryder.r1 || []).map((m) => build(m, "r1", "Scramble")), ...(state.ryder.r2 || []).map((m) => build(m, "r2", "Singles"))];
    if (!ms.length) return flash("Set Ryder matches first.");
    await save({ ...state, markets: [...state.markets, ...ms] });
    flash(`${ms.length} match markets opened.`);
  };
  const openOverUnder = async () => {
    if (!state.ryder.teamA.length || !state.ryder.teamB.length) return flash("Set Ryder teams first.");
    const m = { id: uid(), title: `${state.ryder.teamAName || "Team A"} total Ryder points — O/U 3.5`, kind: "overunder", live: true, status: "open", options: autoOddsOverUnder(state, tp) };
    await save({ ...state, markets: [...state.markets, m] });
    flash("Over/Under market opened.");
  };
  const openCupWinner = async () => {
    if (!state.ryder.teamA.length) return flash("Set Ryder teams first.");
    const P2 = (id) => state.players.find((x) => x.id === id);
    const sumH = (ids) => ids.reduce((s, id) => s + (P2(id)?.h || 0), 0);
    const probs = softmax([-sumH(state.ryder.teamA), -sumH(state.ryder.teamB)], 12);
    const m = { id: uid(), title: "Ryder Cup Winner", kind: "prop", live: false, status: "open", options: [
      { optionId: uid(), label: state.ryder.teamAName || "Team A", odds: withVig(probToAmerican(probs[0])), manual: true },
      { optionId: uid(), label: state.ryder.teamBName || "Team B", odds: withVig(probToAmerican(probs[1])), manual: true },
    ] };
    await save({ ...state, markets: [...state.markets, m] });
    flash("Cup winner market opened.");
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
  const toggleLock = async (marketId) => {
    const markets = state.markets.map((m) => m.id === marketId ? { ...m, locked: !m.locked } : m);
    await save({ ...state, markets });
  };

  // ---- money summary (the book's exposure) ----
  const pending = state.bets.filter((b) => b.status === "pending");
  const settled = state.bets.filter((b) => b.status !== "pending");
  const openStakes = pending.reduce((s, b) => s + b.stake, 0);
  const openLiability = pending.reduce((s, b) => s + (b.payout - b.stake), 0); // profit owed if all open bets win
  const settledPaidOut = settled.filter((b) => b.status === "won").reduce((s, b) => s + (b.payout - b.stake), 0);
  const settledCollected = settled.filter((b) => b.status === "lost").reduce((s, b) => s + b.stake, 0);
  const bookNetSoFar = settledCollected - settledPaidOut; // + = book is up
  // per-player net (settled) + open exposure
  const players = {};
  state.bets.forEach((b) => {
    if (!players[b.who]) players[b.who] = { net: 0, openStake: 0, openCould: 0 };
    if (b.status === "won") players[b.who].net += (b.payout - b.stake);
    else if (b.status === "lost") players[b.who].net -= b.stake;
    else { players[b.who].openStake += b.stake; players[b.who].openCould += (b.payout - b.stake); }
  });
  const playerRows = Object.entries(players).sort((a, b) => (b[1].openCould + Math.abs(b[1].net)) - (a[1].openCould + Math.abs(a[1].net)));
  // biggest single open risks
  const biggestRisks = [...pending].sort((a, b) => (b.payout - b.stake) - (a.payout - a.stake)).slice(0, 4);

  return (
    <>
      <div className="nz-glass" style={{ ...S.card, border: "1px solid rgba(242,166,90,0.35)" }}>
        <div style={S.cardTitle}>💰 The Book — Money Summary</div>
        <p style={S.hint}>Everything the book is exposed to right now. "Liability" = profit you'd owe bettors if their open bets win (stakes returned on top).</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <div style={S.sumBox}><div style={S.sumLabel}>OPEN BETS</div><div style={S.sumBig}>{pending.length}</div><div style={S.sumSub}>${openStakes.toFixed(0)} staked</div></div>
          <div style={S.sumBox}><div style={S.sumLabel}>OPEN LIABILITY</div><div style={{ ...S.sumBig, color: C.bogeyBad }}>${openLiability.toFixed(0)}</div><div style={S.sumSub}>if all open bets win</div></div>
          <div style={S.sumBox}><div style={S.sumLabel}>SETTLED — BOOK NET</div><div style={{ ...S.sumBig, color: bookNetSoFar >= 0 ? C.birdie : C.bogeyBad }}>{bookNetSoFar >= 0 ? "+" : ""}${bookNetSoFar.toFixed(0)}</div><div style={S.sumSub}>collected ${settledCollected.toFixed(0)} · paid ${settledPaidOut.toFixed(0)}</div></div>
          <div style={S.sumBox}><div style={S.sumLabel}>WORST CASE</div><div style={{ ...S.sumBig, color: C.bogeyBad }}>{(bookNetSoFar - openLiability) >= 0 ? "+" : "−"}${Math.abs(bookNetSoFar - openLiability).toFixed(0)}</div><div style={S.sumSub}>if every open bet wins</div></div>
        </div>

        {playerRows.length > 0 && <>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, margin: "16px 0 6px" }}>PER PLAYER</div>
          <div style={{ ...S.lbRow, ...S.lbHead }}><span style={{ flex: 1 }}>Player</span><span style={{ width: 70, textAlign: "right" }}>Settled</span><span style={{ width: 88, textAlign: "right" }}>Open → win</span></div>
          {playerRows.map(([who, v]) => (
            <div key={who} style={S.lbRow}>
              <span style={{ flex: 1 }}>{who}</span>
              <span style={{ width: 70, textAlign: "right", fontFamily: SANS, fontWeight: 700, color: v.net > 0 ? C.birdie : v.net < 0 ? C.bogeyBad : C.fescue }}>{v.net > 0 ? "+" : ""}{v.net ? "$" + v.net.toFixed(0) : "—"}</span>
              <span style={{ width: 88, textAlign: "right", fontFamily: SANS, color: C.copperLt }}>{v.openStake ? `$${v.openStake.toFixed(0)} → +$${v.openCould.toFixed(0)}` : "—"}</span>
            </div>
          ))}
        </>}

        {biggestRisks.length > 0 && <>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, margin: "16px 0 6px" }}>BIGGEST OPEN RISKS</div>
          {biggestRisks.map((b) => (
            <div key={b.id} style={S.openBetRow}><span style={{ flex: 1 }}>{b.who} · {b.label}</span><span style={{ fontFamily: SANS, color: C.bogeyBad }}>owe +${(b.payout - b.stake).toFixed(0)}</span></div>
          ))}
        </>}
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Tournament Winner — Set Opening Lines</div>
        <p style={S.hint}>Set each player's opening odds (American, e.g. +650 or -120). These anchor the market and drift automatically as scores and points come in. Blank = +800 default.</p>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {state.players.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontFamily: SANS, fontSize: 14 }}>{p.name} <span style={{ color: C.fescue }}>· hcp {p.h}</span></span>
              <input className="nz-input" style={{ ...S.input, width: 100 }} type="number" placeholder="+800" value={openLines[p.id]} onChange={(e) => setOpenLines({ ...openLines, [p.id]: e.target.value })} />
            </div>
          ))}
        </div>
        <button className="nz-small" style={{ ...S.smallBtn, marginTop: 10 }} onClick={openOutright}>+ Open Tournament Winner Market</button>
      </div>

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Quick Markets</div>
        <p style={S.hint}>One tap — auto-priced off handicaps and live position, and they auto-close once decided.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="nz-small" style={S.smallBtn} onClick={openNextRound}>+ Wins Next Round</button>
          <button className="nz-small" style={S.smallBtn} onClick={openAllMatches}>+ All Ryder Matches</button>
          <button className="nz-small" style={S.smallBtn} onClick={openOverUnder}>+ Ryder Pts O/U 3.5</button>
          <button className="nz-small" style={S.smallBtn} onClick={openCupWinner}>+ Ryder Cup Winner</button>
        </div>
        <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, margin: "14px 0 6px" }}>FUN PROPS (settle by hand)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="nz-small" style={S.smallBtn} onClick={() => openFunProp("balls")}>+ Most Balls Lost</button>
          <button className="nz-small" style={S.smallBtn} onClick={() => openFunProp("drive")}>+ Longest Drive</button>
          <button className="nz-small" style={S.smallBtn} onClick={() => openFunProp("threeputt")}>+ Most 3-Putts</button>
          <button className="nz-small" style={S.smallBtn} onClick={() => openFunProp("round")}>+ First to Buy a Round</button>
        </div>
      </div>

      <div className="nz-glass" style={{ ...S.card, border: state.bookPaused ? "1px solid rgba(224,117,85,0.5)" : undefined }}>
        <div style={S.cardTitle}>Pause the Book</div>
        <p style={S.hint}>{state.bookPaused ? "The book is PAUSED — players can't place new bets and see a closed message. Existing bets stand." : "Temporarily close betting. Players will see a 'temporarily closed' message; existing bets stay put."}</p>
        <button className="nz-small" style={{ ...S.smallBtn, marginTop: 10, ...(state.bookPaused ? { background: "linear-gradient(135deg,#9AD17A,#6FA04E)" } : { background: "linear-gradient(135deg,#E07555,#C04A2A)", color: "#fff" }) }}
          onClick={async () => { const latest = migrate((await loadState()) || state); const now = !latest.bookPaused; await liveSettle({ ...latest, bookPaused: now }); flash(now ? "Book paused." : "Book reopened."); }}>
          {state.bookPaused ? "▶ Reopen the Book" : "⏸ Pause the Book"}
        </button>
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
              <div style={{ display: "flex", gap: 6 }}>
                {m.status !== "settled" && <button style={S.miniGhost} onClick={() => toggleLock(m.id)}>{m.locked ? "🔓 unlock" : "🔒 lock"}</button>}
                <button style={S.xBtn} onClick={() => rmMarket(m.id)}>✕</button>
              </div>
            </div>
            <div style={S.kindTag}>{m.status === "settled" ? "SETTLED" : marketLocked(m, state, tp).locked ? "CLOSED · " + marketLocked(m, state, tp).reason : m.kind.toUpperCase()}</div>
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
  const wipeAll = async () => {
    if (!window.confirm("Wipe ALL scores for EVERY player across ALL rounds? This also clears scramble team cards and reopens every round. Standings reset to zero. Cannot be undone.")) return;
    if (!window.confirm("Are you absolutely sure? This erases the entire tournament's scores.")) return;
    const latest = migrate((await loadState()) || state);
    const players = latest.players.map((p) => ({ ...p, scores: {}, submitted: {} }));
    const r1 = (latest.ryder.r1 || []).map((m) => ({ ...m, xScores: {}, yScores: {}, submitted: {} }));
    await liveSave({ ...latest, players, ryder: { ...latest.ryder, r1 } });
    flash("All scores wiped. Every round reopened.");
  };
  const gameDayReset = async () => {
    if (!window.confirm("RESET FOR GAME DAY?\n\nThis wipes everything from testing:\n• all scores + scramble cards\n• all bets, settled history, the money board\n• all betting markets / wager lines\n• Ryder match pairings & results\n• nicknames and photos\n• unpauses the book\n\nKEEPS: player names, handicaps, login codes, scorecard, team names.\n\nCannot be undone.")) return;
    if (!window.confirm("Final check — this clears all test data and returns to a fresh start. Proceed?")) return;
    const latest = migrate((await loadState()) || state);
    const players = latest.players.map((p) => ({ ...p, scores: {}, submitted: {}, displayName: "", avatar: "" }));
    await liveSave({
      ...latest,
      players,
      bets: [],
      markets: [],
      bookPaused: false,
      ryder: { ...latest.ryder, r1: [], r2: [], playoff: "" },
      manualTP: {},
    });
    flash("Reset complete — fresh and ready for game day.");
  };
  return (
    <>
    <div className="nz-glass" style={{ ...S.card, border: "1px solid rgba(224,117,85,0.55)" }}>
      <div style={S.cardTitle}>🏁 Reset for Game Day</div>
      <p style={S.hint}>Clears everything from testing — all scores, bets, markets, Ryder matches, nicknames and photos — and returns to a clean slate. <b>Keeps</b> your setup: player names, handicaps, login codes, scorecard, and team names. Use this once, right before the real tournament starts. Double-confirmed.</p>
      <button style={{ ...S.miniGhost, padding: "12px 18px", marginTop: 8, color: "#fff", background: "linear-gradient(135deg,#E07555,#C04A2A)", border: "none" }} onClick={gameDayReset}>Reset everything for game day</button>
    </div>
    <div className="nz-glass" style={{ ...S.card, border: "1px solid rgba(224,117,85,0.4)" }}>
      <div style={S.cardTitle}>Wipe All Scores</div>
      <p style={S.hint}>Just the scores — every player, every round, including scramble team cards. Leaves bets, markets, names, nicknames intact. Double-confirmed.</p>
      <button style={{ ...S.miniGhost, padding: "11px 16px", marginTop: 8, color: C.bogeyBad, borderColor: "rgba(224,117,85,0.5)" }} onClick={wipeAll}>Wipe ALL scores</button>
    </div>
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
    </>
  );
}

// ---- pin gate ----
// ---- name display: nickname big, real name in small subtext if a nickname is set ----
function PlayerName({ player, sub = true, style }) {
  if (!player) return null;
  return (
    <span style={style}>
      {dispName(player)}
      {sub && hasNick(player) && <span style={{ display: "block", fontSize: 11, color: C.fescue, fontWeight: 400, fontFamily: SANS }}>{player.name}</span>}
    </span>
  );
}

// ---- avatar: emoji if set, else colored initials monogram ----
function Avatar({ player, size = 40 }) {  if (!player) return null;
  const initials = dispName(player).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const palette = ["#C77F45", "#5B8FB0", "#9AD17A", "#D98A5B", "#A88BC4", "#E0A95B", "#7BA8A0", "#C96A6A"];
  const color = palette[(player.name.charCodeAt(0) + player.name.length) % palette.length];
  const isPhoto = player.avatar && /^https?:\/\//.test(player.avatar);
  const isEmoji = player.avatar && !isPhoto && !player.avatar.startsWith("#");
  if (isPhoto) {
    return <img src={player.avatar} alt={initials} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid rgba(255,255,255,0.2)" }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: isEmoji ? "rgba(255,255,255,0.1)" : color,
      display: "grid", placeItems: "center", fontSize: isEmoji ? size * 0.55 : size * 0.4, fontWeight: 800, fontFamily: SANS,
      color: "#1a0f08", flexShrink: 0, border: "2px solid rgba(255,255,255,0.2)" }}>
      {isEmoji ? player.avatar : initials}
    </div>
  );
}

const AVATAR_EMOJIS = ["⛳", "🏌️", "🦅", "🐦", "🔥", "🍺", "😎", "🤠", "🦈", "🐐", "💪", "🌊", "☀️", "🌴", "🏆", "🎯"];

function ProfileModal({ state, tp, playerId, isMe, isCommish, onClose, save, flash, setName }) {
  const player = state.players.find((p) => p.id === playerId);
  const [editName, setEditName] = useState(player?.displayName || "");
  const [tab, setTab] = useState("scores");
  if (!player) return null;
  const canEdit = isMe || isCommish;

  const myBets = state.bets.filter((b) => b.who === player.name);
  const openBets = myBets.filter((b) => b.status === "pending");
  const settledBets = myBets.filter((b) => b.status !== "pending");
  const net = settledBets.reduce((s, b) => s + (b.status === "won" ? b.payout - b.stake : -b.stake), 0);

  const saveName = async () => {
    const nm = editName.trim();
    // displayName is a nickname only; real name (login id) never changes. Blank = clear nickname.
    const players = state.players.map((p) => p.id === playerId ? { ...p, displayName: nm } : p);
    await save({ ...state, players });
    flash(nm ? "Nickname set." : "Nickname cleared.");
  };
  const setAvatar = async (av) => {
    const players = state.players.map((p) => p.id === playerId ? { ...p, avatar: av } : p);
    await save({ ...state, players });
  };
  const [uploading, setUploading] = useState(false);
  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(playerId, file);
      await setAvatar(url);
      flash("Photo updated.");
    } catch (err) { flash(err.message || "Upload failed."); }
    setUploading(false);
    e.target.value = "";
  };

  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div className="nz-glass" style={S.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar player={player} size={56} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: SERIF, fontSize: 22, color: C.cream }}>{dispName(player)}</div>
            {hasNick(player) && <div style={{ fontFamily: SANS, fontSize: 12, color: C.fescue }}>{player.name}</div>}
            <div style={{ fontFamily: SANS, fontSize: 13, color: C.copperLt }}>{fmtTP(tp.tp[player.id] || 0)} Tournament Points · hcp {player.h}</div>
          </div>
          <button style={S.xBtn} onClick={onClose}>✕</button>
        </div>

        {canEdit && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, marginBottom: 6 }}>AVATAR</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => setAvatar("")} style={{ ...S.avatarPick, ...(!player.avatar ? S.avatarPickOn : {}) }} title="initials">Aa</button>
              {AVATAR_EMOJIS.map((e) => (
                <button key={e} onClick={() => setAvatar(e)} style={{ ...S.avatarPick, ...(player.avatar === e ? S.avatarPickOn : {}) }}>{e}</button>
              ))}
              <label style={{ ...S.avatarPick, width: "auto", padding: "0 12px", cursor: "pointer", opacity: uploading ? 0.5 : 1 }}>
                {uploading ? "…" : "📷 Photo"}
                <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploading} onChange={onPickPhoto} />
              </label>
            </div>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.fescue, fontFamily: SANS, margin: "12px 0 4px" }}>NICKNAME</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="nz-input" style={S.input} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={player.name} />
              <button className="nz-small" style={S.smallBtn} onClick={saveName}>Save</button>
            </div>
            <p style={{ ...S.hint }}>Nickname shows everywhere instead of your full name (real name stays in small text underneath). Blank = just your name. You always log in with your full name.</p>
          </div>
        )}

        {/* mini tab switch */}
        <div style={{ display: "flex", gap: 4, marginTop: 16, borderBottom: `1px solid ${C.line}` }}>
          {[["scores", "Scores"], ...(canEdit ? [["bets", "Bets"], ["money", "Money"]] : [])].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...S.profileTab, ...(tab === k ? S.profileTabOn : {}) }}>{l}</button>
          ))}
        </div>

        <div style={{ marginTop: 12, maxHeight: 320, overflowY: "auto" }}>
          {tab === "scores" && (
            <>
              <div style={{ ...S.lbRow, ...S.lbHead }}>
                <span style={{ flex: 1 }}>Round</span>
                <span style={{ width: 56, textAlign: "right" }}>Gross</span>
                <span style={{ width: 56, textAlign: "right" }}>Net</span>
                <span style={{ width: 44, textAlign: "right" }}>TP</span>
              </div>
              {ROUNDS.map((r) => {
                const rs = player.scores[r.key] || {};
                const thru = state.holes.filter((H) => rs[H.hole] != null).length;
                let gross = "—", net = "—";
                if (r.kind.includes("ryder")) {
                  // Ryder rounds: per-player gross/net only meaningful for singles (r2); scramble is a team card
                  if (r.key === "r2" && thru) { const t = playerNetTotal(state.holes, rs, player.h); gross = t.gross; net = t.net; }
                  else { gross = "—"; net = "team"; }
                } else if (thru) {
                  const t = playerNetTotal(state.holes, rs, player.h);
                  gross = t.gross; net = t.net;
                }
                // TP earned this round
                let earned = null;
                if (r.key === "r3") earned = tp.detail.r3?.[player.id];
                else if (r.key === "r5") earned = tp.detail.r5?.[player.id];
                else if (r.key === "r4") { const m = (tp.detail.r4 || []).find((x) => x.winner && x.winner.includes(player.id)); earned = m ? 4 : ((tp.detail.r4 || []).some((x) => (x.xs?.includes(player.id) || x.ys?.includes(player.id)) && x.complete) ? 0 : null); }
                else if (r.key === "r1" || r.key === "r2") { const d = tp.detail.ryder; if (d && d.winners) earned = d.winners.includes(player.id) ? 2 : 0; }
                return (
                  <div key={r.key} style={S.lbRow}>
                    <span style={{ flex: 1, fontFamily: SANS, fontSize: 14 }}>R{r.n} · {r.name}<span style={{ display: "block", color: C.fescue, fontSize: 11 }}>{thru ? `thru ${thru}` : "not started"}{r.kind === "stableford" && thru ? ` · ${playerStbl(state.holes, rs, player.h, RZ(state)).pts} pts` : ""}</span></span>
                    <span style={{ width: 56, textAlign: "right", fontFamily: SANS, color: C.cream, fontSize: 13 }}>{gross}</span>
                    <span style={{ width: 56, textAlign: "right", fontFamily: SANS, color: C.cream, fontSize: 13 }}>{net}</span>
                    <span style={{ width: 44, textAlign: "right", fontFamily: SANS, fontWeight: 700, color: earned ? C.copperLt : C.fescue, fontSize: 13 }}>{earned != null ? fmtTP(earned) : "—"}</span>
                  </div>
                );
              })}
              <div style={{ ...S.lbRow, borderTop: `1px solid ${C.line}`, marginTop: 4, paddingTop: 8 }}>
                <span style={{ flex: 1, fontFamily: SANS, fontWeight: 700 }}>Total Tournament Points</span>
                <span style={{ fontFamily: SANS, fontWeight: 800, color: C.copperLt, fontSize: 16 }}>{fmtTP(tp.tp[player.id] || 0)}</span>
              </div>
            </>
          )}

          {tab === "bets" && (openBets.length ? openBets.map((b) => (
            <div key={b.id} style={S.openBetRow}><span style={{ flex: 1 }}>{b.label}</span>
              <span style={{ fontFamily: SANS, color: C.copperLt }}>${b.stake} @ {b.oddsAtBet > 0 ? `+${b.oddsAtBet}` : b.oddsAtBet}</span></div>
          )) : <p style={S.hint}>No open bets.</p>)}

          {tab === "money" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontFamily: SANS }}>
                <span style={{ color: C.fescue }}>Settled net</span>
                <strong style={{ color: net > 0 ? C.birdie : net < 0 ? C.bogeyBad : C.cream }}>{net > 0 ? "+" : ""}${net.toFixed(2)}</strong>
              </div>
              {settledBets.length ? settledBets.map((b) => (
                <div key={b.id} style={S.openBetRow}><span style={{ flex: 1 }}>{b.label}</span>
                  <span style={{ fontFamily: SANS, color: b.status === "won" ? C.birdie : C.bogeyBad }}>{b.status === "won" ? `+$${(b.payout - b.stake).toFixed(2)}` : `-$${b.stake}`}</span></div>
              )) : <p style={S.hint}>No settled bets yet.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerLogin({ state, onLogin }) {
  const [pid, setPid] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const player = state.players.find((p) => p.id === pid);
  const isClaim = player && !player.pin; // no PIN set yet = first-time claim

  const submit = async () => {
    setErr("");
    if (!pid) { setErr("Pick your name."); return; }
    const r = await onLogin(pid, pin, isClaim);
    if (!r.ok) { setErr(r.msg); setPin(""); }
  };

  return (
    <div className="nz-glass" style={{ ...S.card, maxWidth: 420, margin: "16px auto 0" }}>
      <div style={S.cardTitle}>Check In</div>
      <p style={S.hint}>Pick your name and your 4-digit code. First time in, you set your code — after that it's how you log in on any device. This keeps anyone else from betting or scoring as you.</p>
      <select className="nz-input" style={{ ...S.input, marginTop: 10 }} value={pid} onChange={(e) => { setPid(e.target.value); setErr(""); setPin(""); }}>
        <option value="">Select your name…</option>
        {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.pin ? "" : " (new)"}</option>)}
      </select>
      {player && (
        <>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: C.fescue, fontFamily: SANS, marginBottom: 4 }}>{isClaim ? "Set your 4-digit code" : "Enter your 4-digit code"}</div>
            <input className="nz-input" style={S.input} type="password" inputMode="numeric" maxLength={4} placeholder="• • • •" value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </div>
          {isClaim && <p style={{ ...S.hint, color: C.copperLt }}>You're claiming "{player.name}" — pick a code you'll remember. The commissioner can reset it if you forget.</p>}
          {err && <div style={{ color: C.bogeyBad, fontFamily: SANS, fontSize: 13, marginTop: 8 }}>{err}</div>}
          <button className="nz-primary" style={S.primaryBtn} onClick={submit}>{isClaim ? "Claim & enter" : "Log in"}</button>
        </>
      )}
    </div>
  );
}

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
    @media (min-width:1024px){
      .nz-main{max-width:1000px!important}
      /* turn each tab's vertical card stack into a balanced 2-column flow */
      .nz-cols > div[style*="grid"]{display:block!important;column-count:2;column-gap:18px}
      .nz-cols > div[style*="grid"] > *{break-inside:avoid;margin-bottom:18px;display:block}
    }
    @media (min-width:1400px){
      .nz-main{max-width:1180px!important}
    }
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
  sumBox: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 14px' },
  sumLabel: { fontSize: 10, letterSpacing: 1.2, color: '#8a8595', fontFamily: 'Helvetica, Arial, sans-serif' },
  sumBig: { fontSize: 26, fontWeight: 800, fontFamily: 'Helvetica, Arial, sans-serif', color: '#F7F1E6', marginTop: 2 },
  sumSub: { fontSize: 11, color: '#8a8595', fontFamily: 'Helvetica, Arial, sans-serif', marginTop: 2 },
  profileIconBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center' },
  modalOverlay: { position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8,6,12,0.7)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'grid', placeItems: 'start center', padding: '40px 16px', overflowY: 'auto' },
  modalCard: { width: '100%', maxWidth: 460, padding: 20, borderRadius: 18 },
  avatarPick: { width: 38, height: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', fontSize: 18, cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#F7F1E6' },
  avatarPickOn: { borderColor: '#F2A65A', background: 'rgba(242,166,90,0.2)', boxShadow: '0 0 0 2px rgba(242,166,90,0.3)' },
  profileTab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#8a8595', fontFamily: SANS, fontSize: 14, padding: '8px 14px', cursor: 'pointer' },
  profileTabOn: { color: '#F7F1E6', borderBottomColor: '#F2A65A' },
  myBetsHead: { fontSize: 11, letterSpacing: 1.5, color: '#8FA68E', fontFamily: SANS, marginTop: 10, marginBottom: 2 },
  parBadge: { display: 'inline-block', fontSize: 16, fontWeight: 800, fontFamily: SANS, color: '#1a0f08', background: 'linear-gradient(135deg, #F2C188, #C77F45)', padding: '3px 12px', borderRadius: 8, letterSpacing: 0.5 },
  scrambleHcpBox: { marginTop: 12, padding: '10px 12px', background: 'rgba(199,127,69,0.12)', border: '1px solid rgba(242,193,136,0.3)', borderRadius: 10 },
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
  shell: { minHeight: "100%", maxWidth: "100vw", overflowX: "hidden", background: `radial-gradient(circle at 50% -10%, ${C.ink2} 0%, ${C.ink} 55%)`, color: C.cream, fontFamily: SERIF, padding: "0 0 40px", position: "relative" },
  hero: { position: "relative", width: "100%", height: 200, overflow: "hidden", borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
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
  main: { padding: "18px 16px", maxWidth: 680, margin: "0 auto", width: "100%" },
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
