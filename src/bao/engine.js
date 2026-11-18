/*
 * Bao rules engine: "Bao la Kujifunza" (learners' Bao, also called mbili-mbili), the version
 * beginners play in Tanzania and Kenya before full Bao la Kiswahili. Pure functions, no DOM.
 *
 * Board: 4 rows x 8 pits. Each player owns two rows; the row facing the opponent is the
 * inner (front) row. Each player's 16 pits form a loop, indexed clockwise as seen from that
 * player's seat:
 *
 *   k = 0..7   inner row, from the player's left end (left kichwa, k=0) to the right end (k=7)
 *   k = 8..15  back row, from right to left
 *
 *   North (player 1) back row    k:  8  9 10 11 12 13 14 15     (screen left -> right)
 *   North inner row              k:  7  6  5  4  3  2  1  0
 *   South (player 0) inner row   k:  0  1  2  3  4  5  6  7
 *   South back row               k: 15 14 13 12 11 10  9  8
 *
 * Inner pit k faces the opponent's inner pit 7 - k.
 *
 * Rules (sources: Wikipedia "Bao (game)", Mancala World "Bao la Kujifunza"; see README):
 *  - 2 seeds in every pit, nothing in hand. Seeds never leave the board: captured seeds are
 *    sown into the capturer's own rows.
 *  - A turn starts from one of your pits with 2+ seeds, sown one by one clockwise or
 *    anticlockwise, staying in your own two rows.
 *  - Relay: if the last seed lands in an occupied pit, pick up all its seeds and keep sowing
 *    in the same direction. The turn ends when the last seed lands in an empty pit.
 *  - Capture: if the first sowing ends in an occupied pit of your inner row and the opponent's
 *    facing pit has seeds, the turn is a capturing turn (mtaji). Whenever a sowing in such a
 *    turn ends like that, you take the opponent's facing seeds and sow them from one end of
 *    your inner row (a kichwa), towards the middle: from the end nearest the capture if it was
 *    in one of the two end pits on either side, otherwise from the end that keeps your current
 *    direction (simplification: in full Bao the player may choose for the first capture).
 *  - You must make a capturing turn if you can. Otherwise (takata turn, no captures at all)
 *    you start from an inner-row pit with 2+ seeds if there is one, else from the back row.
 *  - A first sowing of 16 or more seeds is always a non-capturing turn.
 *  - You lose when your inner row is empty, or when you cannot move.
 */
(function (root) {
  'use strict';

  const N = 16;          // pits per player
  const INNER = 8;       // k < 8 is the inner row
  const MAX_SOWINGS = 300; // safety net against endless relays (never seen in play)

  function newGame(first) {
    return { pits: [new Array(N).fill(2), new Array(N).fill(2)], toMove: first || 0 };
  }

  function cloneState(s) {
    return { pits: [s.pits[0].slice(), s.pits[1].slice()], toMove: s.toMove };
  }

  const isInner = (k) => k < INNER;
  const facing = (k) => INNER - 1 - k;
  const sum = (a, from, to) => { let t = 0; for (let i = from; i < to; i++) t += a[i]; return t; };
  const innerSum = (s, p) => sum(s.pits[p], 0, INNER);
  const sideSum = (s, p) => sum(s.pits[p], 0, N);

  /** Screen position of pit k of player p: row 0 (top) .. 3 (bottom), col 0..7 (left to right). */
  function screenPos(p, k) {
    if (p === 0) return k < INNER ? { row: 2, col: k } : { row: 3, col: 15 - k };
    return k < INNER ? { row: 1, col: 7 - k } : { row: 0, col: k - 8 };
  }

  /** Would sowing pit k in direction dir be a capturing turn? (first sowing only) */
  function isCaptureMove(s, k, dir) {
    const P = s.pits[s.toMove], O = s.pits[1 - s.toMove];
    const n = P[k];
    if (n < 2 || n > 15) return false;
    const end = ((k + dir * n) % N + N) % N;
    return isInner(end) && P[end] >= 1 && O[facing(end)] > 0;
  }

  /**
   * Legal moves for the side to move: [{ pit, dir, capture }].
   * Captures are compulsory; non-capturing moves start in the inner row when possible.
   */
  function legalMoves(s) {
    const P = s.pits[s.toMove];
    const caps = [];
    for (let k = 0; k < N; k++) {
      if (P[k] < 2) continue;
      for (const dir of [1, -1]) if (isCaptureMove(s, k, dir)) caps.push({ pit: k, dir, capture: true });
    }
    if (caps.length) return caps;
    const out = [];
    const innerOk = P.slice(0, INNER).some((n) => n >= 2);
    for (let k = 0; k < N; k++) {
      if (P[k] < 2) continue;
      if (innerOk && !isInner(k)) continue;
      out.push({ pit: k, dir: 1, capture: false }, { pit: k, dir: -1, capture: false });
    }
    return out;
  }

  /** Why can't pit k be played? 'ok' | 'not-your-side' | 'too-few' | 'must-capture' | 'inner-first' */
  function pitStatus(s, p, k) {
    if (p !== s.toMove) return 'not-your-side';
    const moves = legalMoves(s);
    if (moves.some((m) => m.pit === k)) return 'ok';
    const P = s.pits[p];
    if (P[k] < 2) return 'too-few';
    if (moves.length && moves[0].capture) return 'must-capture';
    return 'inner-first';
  }

  /**
   * Play a move. Returns { state, events, captured, sowings, mtaji }.
   * events (for animation and explanations):
   *   { t: 'pick', k, n }            lift n seeds from own pit k
   *   { t: 'drop', k }               one seed into own pit k
   *   { t: 'capture', k, from, n, kichwa, dir }  take n seeds from the opponent's pit `from`
   *                                  (facing own pit k) and start sowing them at own `kichwa`
   *   { t: 'end', k, reason }        'empty' (last seed in an empty pit) | 'limit'
   */
  function play(s, move) {
    const st = cloneState(s);
    const me = st.toMove;
    const P = st.pits[me], O = st.pits[1 - me];
    const events = [];
    let k = move.pit, dir = move.dir;
    let n = P[k];
    if (n < 2) throw new Error('Pit has fewer than 2 seeds');
    P[k] = 0;
    events.push({ t: 'pick', k, n });
    let mtaji = null;
    let captured = 0, captures = 0, sowings = 0;
    for (;;) {
      let pos = k;
      for (let i = 0; i < n; i++) {
        pos = ((pos + dir) % N + N) % N;
        P[pos]++;
        events.push({ t: 'drop', k: pos });
      }
      sowings++;
      const marker = isInner(pos) && P[pos] > 1 && O[facing(pos)] > 0;
      if (mtaji === null) mtaji = n <= 15 && marker; // decided by the first sowing
      if (P[pos] === 1) { events.push({ t: 'end', k: pos, reason: 'empty' }); break; }
      if (sowings >= MAX_SOWINGS) { events.push({ t: 'end', k: pos, reason: 'limit' }); break; }
      if (mtaji && marker) {
        const from = facing(pos);
        const c = O[from];
        O[from] = 0;
        let kichwa;
        if (pos <= 1) { kichwa = 0; dir = 1; }
        else if (pos >= INNER - 2) { kichwa = INNER - 1; dir = -1; }
        else kichwa = dir > 0 ? 0 : INNER - 1;
        events.push({ t: 'capture', k: pos, from, n: c, kichwa, dir });
        captured += c; captures++;
        k = ((kichwa - dir) % N + N) % N; // so the first seed goes into the kichwa itself
        n = c;
        continue;
      }
      // Relay: pick up the pit and continue in the same direction.
      n = P[pos];
      P[pos] = 0;
      k = pos;
      events.push({ t: 'pick', k, n });
    }
    st.toMove = 1 - me;
    return { state: st, events, captured, captures, sowings, mtaji: !!mtaji };
  }

  /**
   * Is the game over for the side to move? null or { winner, reason }.
   * reason: 'inner-empty' (loser's inner row is empty) | 'no-moves'
   */
  function checkEnd(s) {
    const p = s.toMove;
    if (innerSum(s, p) === 0) return { winner: 1 - p, reason: 'inner-empty' };
    if (legalMoves(s).length === 0) return { winner: 1 - p, reason: 'no-moves' };
    return null;
  }

  function positionKey(s) {
    return s.toMove + ':' + s.pits[0].join(',') + '|' + s.pits[1].join(',');
  }

  const api = {
    N, INNER, newGame, cloneState, isInner, facing, innerSum, sideSum, screenPos,
    legalMoves, isCaptureMove, pitStatus, play, checkEnd, positionKey,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Bao = root.Bao || {};
  root.Bao.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
