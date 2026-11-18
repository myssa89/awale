/*
 * Advisors: anything that can score the legal moves of a position.
 *
 * Interface (keep this stable, a trained model will implement it later):
 *
 *   advisor.analyze(state, opts) -> Promise<{
 *     moves: [{ pit, score }],   // score in "seeds", from the mover's point of view
 *     best: pit,
 *     source: string,            // e.g. 'search d7' or 'policy-net v1'
 *   }>
 *
 * The coach and the computer opponent only talk to advisors through this interface,
 * so swapping minimax for a neural network (ONNX in the browser, or an HTTP endpoint)
 * is a one-line change: Awale.Advisor.use('my-model').
 */
(function (root) {
  'use strict';
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.Awale.Engine;

  const WIN = 1000;

  // ---------- Alpha-beta search (negamax) ----------

  class Timeout extends Error {}

  function makeSearcher(deadline) {
    let nodes = 0;

    function legal(board, toMove) {
      const o = toMove * 6;
      const oppEmpty = E.sideSum(board, 1 - toMove) === 0;
      const out = [];
      for (let p = o; p < o + 6; p++) {
        const n = board[p];
        if (n === 0) continue;
        if (oppEmpty) {
          const dist = ((1 - toMove) * 6 - p + 12) % 12;
          if (n < dist) continue;
        }
        out.push(p);
      }
      return out;
    }

    function evaluate(board, stores, me) {
      // Material first; keeping seeds on your side is a mild plus (mobility, fewer forced feeds).
      const diff = stores[me] - stores[1 - me];
      const side = E.sideSum(board, me) - E.sideSum(board, 1 - me);
      return diff + 0.05 * side;
    }

    function negamax(state, depth, alpha, beta, ply) {
      if ((++nodes & 2047) === 0 && Date.now() > deadline) throw new Timeout();
      const { board, stores, toMove } = state;
      const opp = 1 - toMove;
      if (stores[toMove] >= 25) return WIN - ply;
      if (stores[opp] >= 25) return -WIN + ply;
      if (stores[0] === 24 && stores[1] === 24) return 0;
      const moves = legal(board, toMove);
      if (moves.length === 0) {
        const rest = board.reduce((a, b) => a + b, 0);
        const d = stores[toMove] + rest - stores[opp];
        return d > 0 ? WIN - ply : d < 0 ? -WIN + ply : 0;
      }
      if (depth === 0) return evaluate(board, stores, toMove);

      const children = moves.map((p) => E.simulate(state, p));
      children.sort((a, b) => b.captured - a.captured);
      let best = -Infinity;
      for (const c of children) {
        const v = -negamax(c.after, depth - 1, -beta, -alpha, ply + 1);
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }

    return { negamax, legal, evaluate, nodes: () => nodes };
  }

  /** Score every legal move with iterative deepening inside a time budget. */
  function searchAnalyze(state, opts) {
    opts = opts || {};
    const maxDepth = opts.depth == null ? 8 : opts.depth;
    const deadline = Date.now() + (opts.timeMs == null ? 400 : opts.timeMs);
    const moves = E.legalMoves(state);
    if (moves.length === 0) return { moves: [], best: null, depth: 0, source: 'search' };
    const s = makeSearcher(deadline);
    let done = null;
    let reached = 0;
    for (let d = 0; d <= maxDepth; d++) {
      try {
        const scored = moves.map((pit) => {
          const sim = E.simulate(state, pit);
          return { pit, score: -s.negamax(sim.after, d, -Infinity, Infinity, 1) };
        });
        done = scored;
        reached = d;
      } catch (e) {
        if (e instanceof Timeout) break;
        throw e;
      }
    }
    // Express scores relative to the current material balance, so 0 = "no change".
    const base = state.stores[state.toMove] - state.stores[1 - state.toMove];
    for (const m of done) if (Math.abs(m.score) < WIN / 2) m.score = round1(m.score - base);
    done.sort((a, b) => b.score - a.score);
    return { moves: done, best: done[0].pit, depth: reached + 1, source: 'search d' + (reached + 1) };
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  // ---------- Registry ----------

  const registry = {
    search: {
      name: 'Minimax search',
      analyze: (state, opts) => Promise.resolve(searchAnalyze(state, opts)),
    },
  };
  let current = 'search';

  const Advisor = {
    register(id, advisor) { registry[id] = advisor; },
    use(id) { if (!registry[id]) throw new Error('Unknown advisor ' + id); current = id; },
    get current() { return registry[current]; },
    analyze(state, opts) { return registry[current].analyze(state, opts); },
    analyzeSync: searchAnalyze,
    WIN,
  };

  // ---------- Coach: classify and explain moves ----------

  /** Quality label for a move given the analysis of its position. */
  function grade(analysis, pit) {
    const m = analysis.moves.find((x) => x.pit === pit);
    if (!m) return null;
    const best = analysis.moves[0].score;
    const loss = best - m.score;
    let label;
    if (loss <= 0.25) label = 'best';
    else if (loss < 1.5) label = 'good';
    else if (loss < 3.5) label = 'dubious';
    else label = 'mistake';
    return { pit, score: m.score, loss: round1(loss), label };
  }

  /** Biggest immediate capture available to the side to move. */
  function biggestCapture(state) {
    let best = { pit: null, captured: 0 };
    for (const p of E.legalMoves(state)) {
      const sim = E.simulate(state, p);
      if (sim.captured > best.captured) best = { pit: p, captured: sim.captured };
    }
    return best;
  }

  /** Plain-language reasons why `pit` is worse than the best move. */
  function explainMistake(state, analysis, pit) {
    const g = grade(analysis, pit);
    const bestPit = analysis.moves[0].pit;
    const opp = E.PLAYER_NAMES[1 - state.toMove];
    const lines = [];
    const mine = E.simulate(state, pit);
    const bestSim = E.simulate(state, bestPit);
    const replyAfterMine = biggestCapture(mine.after);
    const replyAfterBest = biggestCapture(bestSim.after);

    if (mine.grandSlam) lines.push('This would take every one of ' + opp + "'s seeds, so the grand slam rule cancels the capture.");
    if (bestSim.captured > mine.captured) {
      lines.push('Pit ' + E.PIT_NAMES[bestPit] + ' captures ' + bestSim.captured + ' seeds right now' +
        (mine.captured ? ', you only take ' + mine.captured + '.' : '.'));
    }
    if (replyAfterMine.captured > replyAfterBest.captured) {
      lines.push('After this move ' + opp + ' can capture ' + replyAfterMine.captured +
        ' seeds with pit ' + E.PIT_NAMES[replyAfterMine.pit] + '.');
    }
    if (lines.length === 0 && g && g.loss > 0) {
      lines.push('Looking a few moves ahead, this costs about ' + g.loss + ' seeds compared with pit ' + E.PIT_NAMES[bestPit] + '.');
    }
    const threat = replyAfterMine.captured > replyAfterBest.captured ? replyAfterMine : null;
    return { grade: g, bestPit, lines, threat, captureNow: mine.captured, bestCapture: bestSim.captured };
  }

  // ---------- Beginner coach: simple, one-move-deep traps only ----------
  //
  // For each move: how many seeds it wins now (take), and how many of your seeds the
  // opponent could grab right after (risk). net = take - risk. Nothing deeper, so every
  // warning can be explained in one sentence a child understands.

  function looksAt(state) {
    return E.legalMoves(state).map((pit) => {
      const sim = E.simulate(state, pit);
      let risk = 0, riskFrom = null, riskPits = [];
      if (!sim.after.result) {
        for (const r of E.legalMoves(sim.after)) {
          const rs = E.simulate(sim.after, r);
          if (rs.captured > risk) { risk = rs.captured; riskFrom = r; riskPits = rs.captures; }
        }
      }
      // A capture that wins the game outright has no risk worth mentioning.
      if (sim.after.stores[sim.player] >= E.SEEDS_TO_WIN) risk = 0;
      return { pit, take: sim.captured, grandSlam: sim.grandSlam, risk, riskFrom, riskPits, net: sim.captured - risk };
    });
  }

  /** The move a beginner should prefer: best net, then most seeds taken, then fewest seeds at risk. */
  function simpleBest(looks) {
    return looks.slice().sort((a, b) => b.net - a.net || b.take - a.take || a.risk - b.risk)[0];
  }

  /**
   * Is `pit` a simple trap compared with the alternatives? Returns null if fine, else
   * { kind: 'danger' | 'missed' | 'grand-slam', mine, better }.
   * Only warns when the difference is at least 2 seeds, so beginners aren't nagged.
   */
  function checkTrap(state, pit) {
    const looks = looksAt(state);
    const mine = looks.find((l) => l.pit === pit);
    if (!mine || looks.length < 2) return null;
    const better = simpleBest(looks);
    if (better.pit === pit || better.net - mine.net < 2) return null;
    let kind;
    if (mine.grandSlam && better.take > 0) kind = 'grand-slam';
    else if (mine.risk - better.risk >= 2) kind = 'danger';
    else kind = 'missed';
    return { kind, mine, better };
  }

  /** Simple colour for each move: 'win' (wins seeds safely), 'safe', 'risky' (gives seeds away). */
  function moveColors(state) {
    const out = {};
    for (const l of looksAt(state)) out[l.pit] = l.net > 0 ? 'win' : l.risk >= 2 && l.net < 0 ? 'risky' : 'safe';
    return out;
  }

  // ---------- Computer opponent ----------

  const LEVELS = {
    // Easy: looks one move ahead, often plays a random move. Good for a first game.
    easy: { label: 'Easy', depth: 1, temperature: 2.5, blunder: 0.35, timeMs: 150, adaptive: true },
    // Medium: sees simple traps, still makes mistakes now and then.
    medium: { label: 'Medium', depth: 3, temperature: 1.0, blunder: 0.08, timeMs: 300, adaptive: true },
    // Hard: deep search, always plays its best move, never eases off.
    hard: { label: 'Hard', depth: 12, temperature: 0, blunder: 0, timeMs: 900, adaptive: false },
  };
  // Older saved settings used these names.
  const LEVEL_ALIASES = { learner: 'easy', casual: 'medium', club: 'hard', strong: 'hard' };

  /**
   * Pick a move for the computer. With `adaptive`, the computer eases off when it is ahead
   * (more randomness, avoids piling on captures) and tightens up when the student pulls ahead,
   * so games stay close and instructive instead of crushing.
   */
  async function chooseMove(state, levelId, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const lvl = LEVELS[LEVEL_ALIASES[levelId] || levelId] || LEVELS.medium;
    const analysis = await Advisor.analyze(state, { depth: lvl.depth, timeMs: lvl.timeMs });
    const moves = analysis.moves;
    if (moves.length === 1) return { pit: moves[0].pit, analysis, mode: 'forced' };

    let temperature = lvl.temperature;
    let blunder = lvl.blunder;
    let mercy = false;
    if (opts.adaptive && lvl.adaptive) {
      const margin = state.stores[state.toMove] - state.stores[1 - state.toMove];
      if (margin >= 4) {
        temperature = Math.max(temperature, 0.5) * (1 + (margin - 3) * 0.4);
        blunder = Math.min(0.5, blunder + (margin - 3) * 0.04);
        mercy = margin >= 8;
      } else if (margin <= -4) {
        temperature *= 0.5;
        blunder *= 0.5;
      }
    }

    if (rng() < blunder) {
      const pick = moves[Math.floor(rng() * moves.length)];
      return { pit: pick.pit, analysis, mode: 'relaxed' };
    }

    let pool = moves;
    if (mercy) {
      // Comfortably ahead: prefer moves that don't capture right away.
      const quiet = moves.filter((m) => E.simulate(state, m.pit).captured === 0 && Math.abs(m.score) < WIN / 2);
      if (quiet.length) pool = quiet;
    }
    if (temperature <= 0) return { pit: pool[0].pit, analysis, mode: 'best' };

    const top = Math.max(...pool.map((m) => clampScore(m.score)));
    const weights = pool.map((m) => Math.exp((clampScore(m.score) - top) / temperature));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return { pit: pool[i].pit, analysis, mode: mercy ? 'mercy' : 'sampled' };
    }
    return { pit: pool[pool.length - 1].pit, analysis, mode: 'sampled' };
  }

  function clampScore(s) { return Math.max(-30, Math.min(30, s)); }

  const api = { Advisor, grade, explainMistake, biggestCapture, looksAt, simpleBest, checkTrap, moveColors, chooseMove, LEVELS, searchAnalyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Awale = root.Awale || {};
  Object.assign(root.Awale, {
    Advisor,
    Coach: { grade, explainMistake, biggestCapture, looksAt, simpleBest, checkTrap, moveColors },
    Opponent: { chooseMove, LEVELS },
  });
})(typeof window !== 'undefined' ? window : globalThis);
