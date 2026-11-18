// Run: node tests/engine.test.js
const assert = require('assert');
const E = require('../src/engine.js');
const A = require('../src/advisor.js');
const LESSONS = require('../src/lessons.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}
const S = (board, stores = [0, 0], toMove = 0) => ({ board, stores, toMove });

test('opening: sowing pit c puts one seed in d,e,f,A', () => {
  const r = E.applyMove(E.newGame(), 2);
  assert.deepStrictEqual(r.state.board, [4, 4, 0, 5, 5, 5, 5, 4, 4, 4, 4, 4]);
  assert.strictEqual(r.state.toMove, 1);
});

test('capture 2 or 3 on the opponent side', () => {
  const r = E.simulate(S([0, 0, 0, 0, 0, 2, 4, 1, 3, 2, 0, 5]), 5);
  assert.strictEqual(r.captured, 2);
  assert.deepStrictEqual(r.captures, [{ pit: 7, seeds: 2 }]);
});

test('no capture on own side', () => {
  const r = E.simulate(S([0, 0, 0, 1, 1, 2, 4, 4, 4, 4, 4, 4]), 3);
  assert.strictEqual(r.captured, 0);
});

test('chain capture walks backwards and stops at own side', () => {
  const r = E.simulate(S([1, 2, 0, 3, 4, 1, 2, 1, 2, 4, 1, 6]), 4);
  assert.strictEqual(r.captured, 8);
  assert.deepStrictEqual(r.captures.map((c) => c.pit), [8, 7, 6]);
});

test('chain stops at a pit that is not 2 or 3', () => {
  const r = E.simulate(S([0, 0, 0, 0, 3, 0, 1, 4, 1, 4, 4, 4]), 4);
  // sows 5,6,7 -> 6:2, 7:5 -> last pit 7 has 5: no capture
  assert.strictEqual(r.captured, 0);
});

test('12+ seeds skip the starting pit', () => {
  const r = E.simulate(S([17, 1, 0, 2, 0, 0, 1, 3, 0, 2, 4, 1], [9, 8]), 0);
  assert.strictEqual(r.after.board[0], 0);
  assert.ok(!r.sown.includes(0));
  assert.strictEqual(r.sown.length, 17);
  assert.strictEqual(r.last, 6);
  assert.strictEqual(r.captured, 3);
});

test('grand slam captures nothing', () => {
  const r = E.simulate(S([2, 0, 1, 0, 2, 2, 1, 1, 0, 0, 0, 0], [20, 19]), 5);
  assert.ok(r.grandSlam);
  assert.strictEqual(r.captured, 0);
  assert.deepStrictEqual(r.after.board.slice(6, 8), [2, 2]);
});

test('must feed an empty opponent', () => {
  const s = S([6, 3, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0], [18, 18]);
  assert.deepStrictEqual(E.legalMoves(s), [0, 4]);
  assert.strictEqual(E.moveStatus(s, 1).reason, 'must-feed');
  assert.strictEqual(E.moveStatus(s, 2).reason, 'empty');
  assert.strictEqual(E.moveStatus(s, 7).reason, 'not-your-side');
});

test('cannot feed: mover collects remaining seeds', () => {
  const s = S([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [24, 22]);
  const end = E.checkEnd(s);
  assert.strictEqual(end.reason, 'no-moves');
  assert.deepStrictEqual(end.stores, [26, 22]);
  assert.strictEqual(end.winner, 0);
});

test('25 wins, 24-24 draws', () => {
  assert.strictEqual(E.checkEnd(S(new Array(12).fill(0).map((_, i) => (i === 3 ? 23 : 0)), [25, 0])).winner, 0);
  const d = E.checkEnd(S(new Array(12).fill(0), [24, 24]));
  assert.strictEqual(d.reason, 'draw');
});

test('threefold repetition splits the board', () => {
  const s = S([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], [23, 23]);
  const h = { [E.positionKey(s)]: 3 };
  const end = E.checkEnd(s, h);
  assert.strictEqual(end.reason, 'repetition');
  assert.deepStrictEqual(end.stores, [24, 24]);
});

test('seed count is conserved over random games', () => {
  for (let g = 0; g < 300; g++) {
    let s = E.newGame(g % 2);
    const h = {};
    for (let ply = 0; ply < 400 && !s.result; ply++) {
      const moves = E.legalMoves(s);
      s = E.applyMove(s, moves[Math.floor(Math.random() * moves.length)], h).state;
      const total = s.board.reduce((a, b) => a + b, 0) + s.stores[0] + s.stores[1];
      assert.strictEqual(total, 48);
    }
  }
});

test('every lesson is consistent and solvable', () => {
  for (const L of LESSONS) {
    const total = L.board.reduce((a, b) => a + b, 0) + L.stores[0] + L.stores[1];
    assert.strictEqual(total, 48, L.id + ' has ' + total + ' seeds');
    const s = S(L.board.slice(), L.stores.slice(), 0);
    const moves = E.legalMoves(s);
    assert.ok(moves.length > 0, L.id + ' has no legal move');
    if (L.goal.type === 'capture') {
      const ok = moves.some((p) => E.simulate(s, p).captured >= L.goal.min);
      assert.ok(ok, L.id + ' goal not reachable');
    }
  }
});

test('search finds the 8-seed chain capture', () => {
  const s = S([1, 2, 0, 3, 4, 1, 2, 1, 2, 4, 1, 6], [11, 10]);
  const r = A.searchAnalyze(s, { depth: 4, timeMs: 2000 });
  assert.strictEqual(r.best, 4);
});

test('search avoids the grand slam', () => {
  const s = S([2, 0, 1, 0, 2, 2, 1, 1, 0, 0, 0, 0], [20, 19]);
  const r = A.searchAnalyze(s, { depth: 4, timeMs: 2000 });
  assert.notStrictEqual(r.best, 5);
});

test('beginner coach stays quiet in the opening', () => {
  const s = E.newGame();
  for (const p of E.legalMoves(s)) assert.strictEqual(A.checkTrap(s, p), null);
});

test('beginner coach flags a missed win', () => {
  const s = S([1, 2, 0, 3, 4, 1, 2, 1, 2, 4, 1, 6], [11, 10]);
  const t = A.checkTrap(s, 1);
  assert.strictEqual(t.kind, 'missed');
  assert.strictEqual(t.better.pit, 4);
  assert.strictEqual(t.better.take, 8);
});

test('beginner coach flags seeds left in danger', () => {
  // South a=1, b=1; North F (11) has 2 seeds -> reaches a, b. Playing c leaves a,b at 1 -> F makes 2,2: lose 4.
  const s = S([1, 1, 3, 0, 0, 0, 0, 0, 0, 5, 0, 2], [17, 18]);
  const looks = A.looksAt(s);
  const c = looks.find((l) => l.pit === 2);
  assert.ok(c.risk >= 2, JSON.stringify(looks));
});

test('every language has every text, with the same placeholders', () => {
  const I = require('../src/i18n.js');
  const en = Object.keys(I.strings.en);
  const ph = (x) => (x.match(/\{\w+\}/g) || []).map((y) => y.toLowerCase()).sort().join();
  for (const l of ['fr', 'de', 'it']) {
    assert.deepStrictEqual(Object.keys(I.strings[l]).sort(), en.slice().sort(), l + ' keys differ');
    for (const k of en) assert.strictEqual(ph(I.strings[l][k]), ph(I.strings.en[k]), l + ' ' + k);
    for (const L of LESSONS) assert.strictEqual((I.lessons[l][L.id] || []).length, 4, l + ' lesson ' + L.id);
  }
});

test('every puzzle has exactly one clearly best move', () => {
  const PUZZLES = require('../src/puzzles.js');
  assert.ok(PUZZLES.length >= 30);
  const ids = new Set();
  for (const p of PUZZLES) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    const total = p.board.reduce((x, y) => x + y, 0) + p.stores[0] + p.stores[1];
    assert.strictEqual(total, 48, p.id + ' seed count');
    const s = { board: p.board.slice(), stores: p.stores.slice(), toMove: 0 };
    assert.ok(E.legalMoves(s).includes(p.answer), p.id + ' answer is legal');
    const looks = A.looksAt(s);
    const best = looks.find((l) => l.pit === p.answer);
    for (const l of looks) if (l !== best) assert.ok(best.net - l.net >= 2, p.id + ' answer is clearly best');
    assert.strictEqual(best.risk, 0, p.id + ' answer is safe');
    if (p.type === 'greedy') assert.ok(looks.some((l) => l.take > best.take), p.id + ' has a bait');
    if (p.type === 'chain') assert.ok(E.simulate(s, p.answer).captures.length >= 2, p.id + ' is a chain');
  }
});

(async () => {
  // Strong vs random, a few games, to make sure the search is sane.
  let wins = 0;
  for (let g = 0; g < 6; g++) {
    let s = E.newGame(g % 2);
    const h = {};
    while (!s.result) {
      let pit;
      if (s.toMove === 0) pit = (await A.chooseMove(s, 'hard', { rng: Math.random })).pit;
      else { const m = E.legalMoves(s); pit = m[Math.floor(Math.random() * m.length)]; }
      s = E.applyMove(s, pit, h).state;
    }
    if (s.result.winner === 0) wins++;
  }
  test('hard level wins most games against random (' + wins + '/6)', () => assert.ok(wins >= 5));
  console.log('\n' + passed + ' passed');
})();
