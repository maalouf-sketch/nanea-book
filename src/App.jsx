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

      {!me && (
        <div style={S.namePrompt} className="nz-fade">
          <span style={{ color: C.cream, fontSize: 14, fontFamily: SANS, opacity: 0.85 }}>Check in —</span>
          <select className="nz-input" style={{ ...S.inputInline, minWidth: 160 }} defaultValue="" onChange={(e) => e.target.value && setName(e.target.value)}>
            <option value="" disabled>pick your name</option>
            {state.players.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
      )}

      <nav style={S.tabs} className="nz-tabs">
        {[["standings", "Standings"], ["scoring", "Live Scoring"], ["rounds", "Rounds"], ["commish", "Commish"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className="nz-tab" style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{lbl}</button>
        ))}
      </nav>

      <main style={S.main}>
        <div key={tab} className="nz-page">
          {tab === "standings" && <Standings state={state} tp={tp} />}
          {tab === "scoring" && <Scoring state={state} me={me} setName={setName} save={save} />}
          {tab === "rounds" && <RoundsView state={state} tp={tp} />}
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
  merged.players = (s.players || base.players).map((p) => ({ ...p, scores: p.scores || {} }));
  merged.ryder = { ...base.ryder, ...(s.ryder || {}) };
  merged.r4 = { ...base.r4, ...(s.r4 || {}) };
  merged.r6 = { ...base.r6, ...(s.r6 || {}) };
  merged.manualTP = s.manualTP || {};
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

  // ---- Ryder Cup (R1 scramble + R2 singles) ----
  const ry = state.ryder;
  if (ry.teamA.length && ry.teamB.length) {
    let aPts = 0, bPts = 0;
    const tallyMatch = (m) => {
      // m.result: 'X' (xs win), 'Y' (ys win), 'H' halved, '' pending
      // xs are on team A by construction in commish; but track by side flag
      if (m.result === "X") return m.side === "A" ? [1, 0] : [0, 1];
      if (m.result === "Y") return m.side === "A" ? [0, 1] : [1, 0];
      if (m.result === "H") return [0.5, 0.5];
      return [0, 0];
    };
    [...(ry.r1 || []), ...(ry.r2 || [])].forEach((m) => { const [a, b] = tallyMatch(m); aPts += a; bPts += b; });
    detail.ryder = { aPts, bPts };
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
        ? <div style={{ textAlign: "center", color: C.birdie, fontFamily: SANS, fontSize: 13, marginTop: 6 }}>Team {d.winners === state.ryder.teamA ? "A" : "B"} wins — +2 TP each</div>
        : <div style={{ textAlign: "center", color: C.fescue, fontFamily: SANS, fontSize: 13, marginTop: 6 }}>{d.aPts === d.bPts && (d.aPts + d.bPts) > 0 ? "All square — captain playoff needed" : "In progress"}</div>}
    </div>
  );
}

// ============================================================
// LIVE SCORING — per round, each player enters own card
// ============================================================
function Scoring({ state, me, setName, save }) {
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

  // leaderboard for this round
  const rows = state.players.map((p) => {
    const rs = p.scores[roundKey] || {};
    if (round.kind === "stableford") { const s = playerStbl(holes, rs, p.h); return { p, primary: s.pts, thru: s.thru, label: `${s.pts} pts`, higher: true }; }
    const t = playerNetTotal(holes, rs, p.h);
    return { p, primary: t.net, thru: t.thru, label: t.thru ? `${t.net} net` : "—", higher: false };
  }).sort((a, b) => { if (!a.thru) return 1; if (!b.thru) return -1; return a.higher ? b.primary - a.primary : a.primary - b.primary; });

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

      {myPlayer && <MyCard player={myPlayer} holes={holes} roundKey={roundKey} round={round} setScore={setScore} />}

      <div className="nz-glass" style={S.card}>
        <div style={S.cardTitle}>Round {round.n} — {round.name}</div>
        <div style={{ display: "grid", gap: 1, marginTop: 10 }}>
          <div style={{ ...S.lbRow, ...S.lbHead }}><span style={{ width: 24 }}>#</span><span style={{ flex: 1 }}>Player</span><span style={{ width: 50, textAlign: "center" }}>Thru</span><span style={{ width: 64, textAlign: "right" }}>{round.kind === "stableford" ? "Points" : "Net"}</span></div>
          {rows.map(({ p, primary, thru, label, higher }, i) => (
            <div key={p.id}>
              <div className="nz-lbrow" style={{ ...S.lbRow, cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
                <span style={{ width: 24, color: C.copperLt, fontWeight: 700, fontFamily: SANS }}>{thru ? i + 1 : "–"}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{p.name}{p.name === me && <span style={S.youDot}>you</span>}</span>
                <span style={{ width: 50, textAlign: "center", color: C.fescue, fontFamily: SANS, fontSize: 13 }}>{thru === 18 ? "F" : thru || "—"}</span>
                <span style={{ width: 64, textAlign: "right", fontWeight: 800, fontFamily: SANS, color: C.copperLt }}>{thru ? label : "—"}</span>
              </div>
              {open === p.id && <div className="nz-expand"><Scorecard player={p} holes={holes} roundKey={roundKey} /></div>}
            </div>
          ))}
        </div>
        <p style={S.hint}>Tap a player to see their full scorecard. Net scoring applied automatically.</p>
      </div>
    </div>
  );
}

function MyCard({ player, holes, roundKey, round, setScore }) {
  const rs = player.scores[roundKey] || {};
  const thru = holes.filter((H) => rs[H.hole] != null).length;
  const nextHole = thru >= 18 ? 18 : (() => { const miss = holes.find((H) => rs[H.hole] == null); return miss ? miss.hole : 18; })();
  const [h, setH] = useState(nextHole);
  useEffect(() => { setH(nextHole); /* eslint-disable-next-line */ }, [roundKey]);
  const H = holes.find((x) => x.hole === h);
  const cur = rs[h];
  const strokes = strokesOnHole(H.si, player.h);
  const t = round.kind === "stableford" ? playerStbl(holes, rs, player.h).pts : playerNetTotal(holes, rs, player.h).net;

  return (
    <div className="nz-mycard" style={S.myCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={S.kicker}>Your Card · {player.name} · R{round.n}</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.cream, opacity: 0.85 }}>{thru === 0 ? "Not started" : `Thru ${thru} · ${round.kind === "stableford" ? t + " pts" : t + " net"}`}</div>
      </div>
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
          return <button key={n} className="nz-score" onClick={() => { setScore(player.id, h, n); if (h < 18) setTimeout(() => setH(h + 1), 200); }} style={{ ...S.scoreBtn, ...(active ? scoreColor(diff) : {}) }}>{n}</button>;
        })}
      </div>
      {cur != null && <div style={{ textAlign: "center", marginTop: 12, fontFamily: SANS, fontSize: 13, color: C.cream, opacity: 0.9 }}>
        Gross {cur} · Net {netHole(cur, H.si, player.h)} on {h}. <button style={S.clearBtn} onClick={() => setScore(player.id, h, null)}>clear</button></div>}
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
    return <div style={{ marginTop: 8 }}>{(ms || []).map((m) => (
      <div key={m.id} style={S.matchRow}>
        <span style={{ flex: 1 }}>{m.xs.map((id) => P(id)?.name).join(" & ")} <span style={{ color: C.fescue }}>vs</span> {m.ys.map((id) => P(id)?.name).join(" & ")}</span>
        <span style={{ fontFamily: SANS, color: m.result ? C.copperLt : C.fescue }}>{m.result === "X" ? "◀" : m.result === "Y" ? "▶" : m.result === "H" ? "AS" : "—"}</span>
      </div>))}</div>;
  }
  if (r.key === "r4") {
    if (!state.r4.matches.length) return <p style={S.hint}>Pairings set after R3 standings — 1st+8th vs 2nd+7th, 3rd+6th vs 4th+5th.</p>;
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
function Commish({ state, save, flash, tp }) {
  const [section, setSection] = useState("setup");
  const P = (id) => state.players.find((x) => x.id === id);
  const ranked = [...state.players].map((p) => ({ id: p.id, pts: tp.tp[p.id] })).sort((a, b) => b.pts - a.pts).map((x) => x.id);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="nz-glass" style={S.card}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["setup", "Setup"], ["ryder", "Ryder R1–2"], ["r4", "R4 Pairings"], ["r6", "R6 Groups"], ["tp", "TP Override"]].map(([k, l]) => (
            <button key={k} onClick={() => setSection(k)} style={{ ...S.roundPill, ...(section === k ? S.roundPillOn : {}) }}>{l}</button>
          ))}
        </div>
      </div>

      {section === "setup" && <CommishSetup state={state} save={save} flash={flash} />}
      {section === "ryder" && <CommishRyder state={state} save={save} flash={flash} />}
      {section === "r4" && <CommishR4 state={state} save={save} flash={flash} ranked={ranked} />}
      {section === "r6" && <CommishR6 state={state} save={save} flash={flash} ranked={ranked} />}
      {section === "tp" && <CommishTP state={state} save={save} flash={flash} tp={tp} />}
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

  const MatchEditor = ({ key2, m, partners }) => (
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
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {[["X", "A wins"], ["Y", "B wins"], ["H", "Halved"], ["", "Pending"]].map(([v, l]) => (
          <button key={v} onClick={() => updMatch(key2, m.id, { result: v, side: "A" })} style={{ ...S.resultBtn, ...(m.result === v ? S.resultOn : {}) }}>{l}</button>
        ))}
      </div>
    </div>
  );

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
      { id: uid(), xs: [ranked[0], ranked[7]], ys: [ranked[1], ranked[6]] },
      { id: uid(), xs: [ranked[2], ranked[5]], ys: [ranked[3], ranked[4]] },
    ];
    await save({ ...state, r4: { matches } });
    flash("Pairings built from standings.");
  };
  return (
    <div className="nz-glass" style={S.card}>
      <div style={S.cardTitle}>Round 4 — Best Ball Pairings</div>
      <p style={S.hint}>Auto-build from current standings: 1st+8th vs 2nd+7th, and 3rd+6th vs 4th+5th. Each winner earns 4 TP.</p>
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
  return (
    <div style={S.hero}>
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
      {!minimal && (
        <div style={S.heroContent}>
          <div style={S.heroTopRow}><Domes />{badge && (badge === "COMMISSIONER" ? <span style={S.commishBadge}>{badge}</span> : <span style={S.youBadge}>{badge}</span>)}</div>
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
