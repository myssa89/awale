/*
 * Bao coach and computer opponent. Same ideas as the Awale advisor:
 *  - looksAt / checkTrap: one move ahead, for beginners ("you win N, then the opponent can take M").
 *  - search: alpha-beta on seeds-on-my-side, for the computer player.
 */
(function (root) {
  'use strict';
  const B = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.Bao.Engine;
  const WIN = 1000;

  function moveKey(m) { return m.pit + (m.dir > 0 ? '+' : '-'); }

  /** Result of a move from the mover's point of view, including "the game is over". */
  function outcome(s, m) {
    const r = B.play(s, m);
    const end = B.checkEnd(r.state);
    return { r, end };
  }

  /**
   * For each legal move: seeds captured now (take), the most the opponent can capture right after
   * (risk; a reply that wins the game counts as everything), net = take - risk.
   */
  function looksAt(s) {
    const me = s.toMove;
    return B.legalMoves(s).map((m) => {
      const { r, end } = outcome(s, m);
      let take = r.captured, risk = 0, riskMove = null, riskEvents = null;
      if (end && end.winner === me) take = 64;
      else if (!end) {
        for (const om of B.legalMoves(r.state)) {
          const o = outcome(r.state, om);
          const lost = o.end && o.end.winner !== me ? 64 : o.r.captured;
          if (lost > risk) { risk = lost; riskMove = om; riskEvents = o.r.events; }
        }
      }
      return { pit: m.pit, dir: m.dir, key: moveKey(m), capture: m.capture, take, risk, riskMove, riskEvents, net: take - risk, result: r };
    });
  }

  function simpleBest(looks) {
    return looks.slice().sort((a, b) => b.net - a.net || b.take - a.take || a.risk - b.risk)[0];
  }

  /** Same contract as the Awale coach: null, or { kind: 'danger'|'missed', mine, better }. */
  function checkTrap(s, move) {
    const looks = looksAt(s);
    const mine = looks.find((l) => l.pit === move.pit && l.dir === move.dir);
    if (!mine || looks.length < 2) return null;
    const better = simpleBest(looks);
    if (better.key === mine.key || better.net - mine.net < 3) return null;
    const kind = mine.risk - better.risk >= 3 ? 'danger' : 'missed';
    return { kind, mine, better };
  }

  // ---------- search ----------
  class Timeout extends Error {}

  function evaluate(s, me) {
    // Seeds on my side, with a small bonus for a healthy inner row (an empty inner row loses).
    const mine = B.sideSum(s, me), theirs = 64 - mine;
    const innerBonus = Math.min(B.innerSum(s, me), 8) - Math.min(B.innerSum(s, 1 - me), 8);
    return mine - theirs + 0.3 * innerBonus;
  }

  function searchAnalyze(s, opts) {
    opts = opts || {};
    const maxDepth = opts.depth == null ? 4 : opts.depth;
    const deadline = Date.now() + (opts.timeMs == null ? 500 : opts.timeMs);
    let nodes = 0;
    function negamax(st, depth, alpha, beta, ply) {
      if ((++nodes & 255) === 0 && Date.now() > deadline) throw new Timeout();
      const end = B.checkEnd(st);
      if (end) return end.winner === st.toMove ? WIN - ply : -WIN + ply;
      if (depth === 0) return evaluate(st, st.toMove);
      const kids = B.legalMoves(st).map((m) => B.play(st, m));
      kids.sort((a, b) => b.captured - a.captured);
      let best = -Infinity;
      for (const c of kids) {
        const v = -negamax(c.state, depth - 1, -beta, -alpha, ply + 1);
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }
    const moves = B.legalMoves(s);
    let done = moves.map((m) => ({ pit: m.pit, dir: m.dir, score: 0 }));
    let reached = 0;
    for (let d = 0; d <= maxDepth; d++) {
      try {
        done = moves.map((m) => ({ pit: m.pit, dir: m.dir, score: -negamax(B.play(s, m).state, d, -Infinity, Infinity, 1) }));
        reached = d;
      } catch (e) {
        if (e instanceof Timeout) break;
        throw e;
      }
    }
    done.sort((a, b) => b.score - a.score);
    return { moves: done, best: done[0], depth: reached + 1, source: 'search d' + (reached + 1) };
  }

  const LEVELS = {
    easy: { depth: 1, temperature: 3, blunder: 0.35, timeMs: 200, adaptive: true },
    medium: { depth: 2, temperature: 1.2, blunder: 0.1, timeMs: 400, adaptive: true },
    hard: { depth: 5, temperature: 0, blunder: 0, timeMs: 1200, adaptive: false },
  };

  function chooseMove(s, levelId, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const lvl = LEVELS[levelId] || LEVELS.medium;
    const a = searchAnalyze(s, { depth: lvl.depth, timeMs: lvl.timeMs });
    const moves = a.moves;
    if (moves.length === 1) return moves[0];
    let temperature = lvl.temperature, blunder = lvl.blunder;
    if (opts.adaptive && lvl.adaptive) {
      const margin = B.sideSum(s, s.toMove) - 32;
      if (margin >= 6) { temperature = Math.max(temperature, 1) * (1 + (margin - 5) * 0.3); blunder = Math.min(0.5, blunder + (margin - 5) * 0.03); }
      else if (margin <= -6) { temperature *= 0.5; blunder *= 0.5; }
    }
    if (rng() < blunder) return moves[Math.floor(rng() * moves.length)];
    if (temperature <= 0) return moves[0];
    const clamp = (x) => Math.max(-40, Math.min(40, x));
    const top = clamp(moves[0].score);
    const w = moves.map((m) => Math.exp((clamp(m.score) - top) / temperature));
    let r = rng() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < moves.length; i++) { r -= w[i]; if (r <= 0) return moves[i]; }
    return moves[moves.length - 1];
  }

  function moveColors(s) {
    const out = {};
    for (const l of looksAt(s)) {
      const c = l.net > 0 ? 'win' : l.risk >= 3 && l.net < 0 ? 'risky' : 'safe';
      const prev = out[l.pit];
      const rank = { win: 2, safe: 1, risky: 0 };
      if (!prev || rank[c] > rank[prev]) out[l.pit] = c;
    }
    return out;
  }

  const api = { looksAt, simpleBest, checkTrap, moveColors, searchAnalyze, chooseMove, LEVELS, moveKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Bao = root.Bao || {};
  root.Bao.Advisor = api;
})(typeof window !== 'undefined' ? window : globalThis);
