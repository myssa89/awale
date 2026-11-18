/*
 * Awale rules engine (Abapa / Oware rules, the international standard).
 *
 * Pure functions, no DOM. Works in the browser (window.Awale.Engine) and in Node
 * (require('./engine.js')). python/awale.py mirrors these rules exactly so a
 * trained model sees the same game the student plays.
 *
 * Board layout (indices), sowing runs counterclockwise = increasing index:
 *
 *        North (player 1)
 *    11  10   9   8   7   6
 *     0   1   2   3   4   5
 *        South (player 0)
 *
 * Rules implemented:
 *  - 4 seeds per pit, 48 total. Pick a non-empty pit on your side, sow one seed per pit
 *    counterclockwise. With 12+ seeds the starting pit is skipped.
 *  - Capture: if the last seed lands in an opponent pit and makes it 2 or 3, take them.
 *    Then keep checking the previous pits (clockwise) while they are on the opponent's side
 *    and hold 2 or 3.
 *  - Grand slam: a move that would capture every seed on the opponent's side captures nothing.
 *  - Feeding: if the opponent has no seeds, you must play a move that gives them some.
 *  - End: 25+ seeds captured wins; 24-24 is a draw. If the player to move has no legal move,
 *    they collect every seed left on the board. A position repeated 3 times ends the game and
 *    each player collects the seeds on their own side.
 */
(function (root) {
  'use strict';

  const PITS = 12;
  const SIDE = 6;
  const SEEDS_TO_WIN = 25;

  const PIT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'A', 'B', 'C', 'D', 'E', 'F'];
  const PLAYER_NAMES = ['South', 'North'];

  function newGame(firstPlayer) {
    return { board: new Array(PITS).fill(4), stores: [0, 0], toMove: firstPlayer || 0 };
  }

  function cloneState(s) {
    return { board: s.board.slice(), stores: s.stores.slice(), toMove: s.toMove };
  }

  function owner(pit) { return pit < SIDE ? 0 : 1; }
  function sidePits(player) { return player === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]; }
  function sideSum(board, player) {
    const o = player * SIDE;
    return board[o] + board[o + 1] + board[o + 2] + board[o + 3] + board[o + 4] + board[o + 5];
  }

  /**
   * Sow + capture without legality checks. Returns full detail used by the UI to animate
   * and explain the move.
   */
  function simulate(state, pit) {
    const board = state.board.slice();
    const stores = state.stores.slice();
    const player = owner(pit);
    const opp = 1 - player;
    let seeds = board[pit];
    board[pit] = 0;
    const sown = [];
    let i = pit;
    while (seeds > 0) {
      i = (i + 1) % PITS;
      if (i === pit) continue; // 12+ seeds: skip the starting pit
      board[i]++;
      sown.push(i);
      seeds--;
    }
    const last = i;

    // Captures, walking backwards from the last pit while on the opponent's side.
    const captures = [];
    let j = last;
    while (owner(j) === opp && (board[j] === 2 || board[j] === 3)) {
      captures.push({ pit: j, seeds: board[j] });
      j = (j - 1 + PITS) % PITS;
    }
    const captureTotal = captures.reduce((t, c) => t + c.seeds, 0);

    let grandSlam = false;
    if (captures.length > 0 && captureTotal === sideSum(board, opp)) {
      grandSlam = true; // would empty the opponent: no capture
    }
    if (!grandSlam) {
      for (const c of captures) board[c.pit] = 0;
      stores[player] += captureTotal;
    }
    return {
      pit,
      player,
      seeds: state.board[pit],
      sown,
      last,
      captures: grandSlam ? [] : captures,
      blockedCaptures: grandSlam ? captures : [],
      captured: grandSlam ? 0 : captureTotal,
      grandSlam,
      fed: sideSum(state.board, opp) === 0 && sideSum(board, opp) > 0,
      after: { board, stores, toMove: opp },
    };
  }

  /**
   * Why a pit can or cannot be played. reason is one of:
   *   ok | not-your-side | empty | must-feed | game-over
   */
  function moveStatus(state, pit) {
    if (state.result) return { legal: false, reason: 'game-over' };
    if (owner(pit) !== state.toMove) return { legal: false, reason: 'not-your-side' };
    if (state.board[pit] === 0) return { legal: false, reason: 'empty' };
    const opp = 1 - state.toMove;
    if (sideSum(state.board, opp) === 0) {
      // Must reach the opponent's side. Distance from pit to the first opponent pit:
      const firstOpp = opp * SIDE;
      const dist = (firstOpp - pit + PITS) % PITS;
      if (state.board[pit] < dist) return { legal: false, reason: 'must-feed' };
    }
    return { legal: true, reason: 'ok' };
  }

  function legalMoves(state) {
    const out = [];
    for (const p of sidePits(state.toMove)) if (moveStatus(state, p).legal) out.push(p);
    return out;
  }

  function positionKey(state) {
    return state.toMove + ':' + state.board.join(',');
  }

  /**
   * Decide whether a state (with toMove already set) is finished.
   * Returns null or { winner: 0|1|null, reason, stores }.
   * `history` (optional) maps positionKey -> count for the repetition rule.
   */
  function checkEnd(state, history) {
    const s = state.stores;
    if (s[0] >= SEEDS_TO_WIN) return { winner: 0, reason: 'majority', stores: s.slice() };
    if (s[1] >= SEEDS_TO_WIN) return { winner: 1, reason: 'majority', stores: s.slice() };
    if (s[0] === 24 && s[1] === 24) return { winner: null, reason: 'draw', stores: s.slice() };

    if (legalMoves(state).length === 0) {
      // The player to move cannot play (or cannot feed): they collect what is left.
      const stores = s.slice();
      stores[state.toMove] += state.board.reduce((a, b) => a + b, 0);
      return { winner: winnerOf(stores), reason: 'no-moves', stores, collector: state.toMove };
    }
    if (history && (history[positionKey(state)] || 0) >= 3) {
      return finishBySplit(state, 'repetition');
    }
    return null;
  }

  function finishBySplit(state, reason) {
    const stores = state.stores.slice();
    stores[0] += sideSum(state.board, 0);
    stores[1] += sideSum(state.board, 1);
    return { winner: winnerOf(stores), reason, stores };
  }

  function winnerOf(stores) {
    if (stores[0] > stores[1]) return 0;
    if (stores[1] > stores[0]) return 1;
    return null;
  }

  /** Apply a legal move. Returns { state, info }. Throws on illegal moves. */
  function applyMove(state, pit, history) {
    const st = moveStatus(state, pit);
    if (!st.legal) throw new Error('Illegal move ' + pit + ': ' + st.reason);
    const info = simulate(state, pit);
    const next = info.after;
    if (history) history[positionKey(next)] = (history[positionKey(next)] || 0) + 1;
    const result = checkEnd(next, history);
    if (result) next.result = result;
    return { state: next, info };
  }

  const api = {
    PITS, SIDE, SEEDS_TO_WIN, PIT_NAMES, PLAYER_NAMES,
    newGame, cloneState, owner, sidePits, sideSum,
    simulate, moveStatus, legalMoves, applyMove, checkEnd, finishBySplit,
    positionKey, winnerOf,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Awale = root.Awale || {};
  root.Awale.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
