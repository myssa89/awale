// Run: node tests/bao.test.js
const assert = require('assert');
const B = require('../src/bao/engine.js');
const A = require('../src/bao/advisor.js');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.stack.split('\n').slice(0, 3).join('\n     ')); process.exitCode = 1; }
}
const S = (south, north, toMove = 0) => ({ pits: [south.slice(), north.slice()], toMove });
const zeros = () => new Array(16).fill(0);

test('start: 2 seeds everywhere, 64 in total', () => {
  const s = B.newGame();
  assert.strictEqual(B.sideSum(s, 0) + B.sideSum(s, 1), 64);
});

test('opening: every move captures, so only capturing moves are legal', () => {
  const s = B.newGame();
  const m = B.legalMoves(s);
  assert.ok(m.length > 0 && m.every((x) => x.capture));
});

test('screen layout: inner pits face each other', () => {
  for (let k = 0; k < 8; k++) {
    const a = B.screenPos(0, k), b = B.screenPos(1, B.facing(k));
    assert.strictEqual(a.col, b.col); assert.strictEqual(a.row, 2); assert.strictEqual(b.row, 1);
  }
  assert.deepStrictEqual(B.screenPos(0, 8), { row: 3, col: 7 });
  assert.deepStrictEqual(B.screenPos(1, 8), { row: 0, col: 0 });
});

test('relay: landing in an occupied pit picks it up and continues', () => {
  const south = zeros(); south[8] = 2; south[10] = 1; // back row: sow 8 -> 9,10 ; 10 has 2 -> relay
  const north = zeros(); north[0] = 1;
  const r = B.play(S(south, north), { pit: 8, dir: 1 });
  assert.strictEqual(r.sowings, 2);
  assert.ok(!r.mtaji);
  assert.strictEqual(B.sideSum(r.state, 0), 3);
});

test('capture: seeds taken and sown from the end of the inner row', () => {
  const south = zeros(); south[1] = 2; south[3] = 1;   // sow 1 -> 2,3: 3 now has 2
  const north = zeros(); north[B.facing(3)] = 5; north[0] = 1;
  const r = B.play(S(south, north), { pit: 1, dir: 1 });
  assert.ok(r.mtaji);
  assert.strictEqual(r.captured, 5);
  const cap = r.events.find((e) => e.t === 'capture');
  assert.strictEqual(cap.kichwa, 0); // central capture, moving clockwise: from the left end
  assert.strictEqual(r.state.pits[1][B.facing(3)], 0);
  assert.strictEqual(B.sideSum(r.state, 0) + B.sideSum(r.state, 1), 9);
});

test('capture in an end pit sows from the nearest end', () => {
  const south = zeros(); south[4] = 2; south[6] = 1;   // 4 -> 5,6 ; 6 is a right-end pit
  const north = zeros(); north[B.facing(6)] = 3; north[3] = 1;
  const r = B.play(S(south, north), { pit: 4, dir: 1 });
  const cap = r.events.find((e) => e.t === 'capture');
  assert.strictEqual(cap.kichwa, 7);
  assert.strictEqual(cap.dir, -1);
});

test('must capture when possible; otherwise inner row first', () => {
  const south = zeros(); south[1] = 2; south[3] = 1; south[9] = 3;
  const north = zeros(); north[B.facing(3)] = 2;
  const m = B.legalMoves(S(south, north));
  assert.ok(m.length && m.every((x) => x.capture));
  const south2 = zeros(); south2[2] = 2; south2[9] = 3;
  const north2 = zeros(); north2[0] = 2;
  const m2 = B.legalMoves(S(south2, north2));
  assert.ok(m2.every((x) => x.pit < 8), 'non-capturing moves start in the inner row');
});

test('16+ seeds in the first sowing never capture', () => {
  const south = zeros(); south[0] = 16; south[2] = 1;
  const north = zeros(); north.fill(1);
  assert.ok(!B.isCaptureMove(S(south, north), 0, 1));
});

test('end: empty inner row loses; no move loses', () => {
  const south = zeros(); south[9] = 5;
  assert.deepStrictEqual(B.checkEnd(S(south, new Array(16).fill(1))), { winner: 1, reason: 'inner-empty' });
  const s2 = zeros(); s2[0] = 1; s2[1] = 1;
  assert.strictEqual(B.checkEnd(S(s2, new Array(16).fill(1))).reason, 'no-moves');
});

test('random games: seeds conserved, games finish, endless relays are rare', () => {
  let finished = 0, maxSow = 0, limits = 0, turns = 0;
  for (let g = 0; g < 300; g++) {
    let s = B.newGame(g % 2);
    for (let ply = 0; ply < 400; ply++) {
      if (B.checkEnd(s)) { finished++; break; }
      const m = B.legalMoves(s);
      const r = B.play(s, m[Math.floor(Math.random() * m.length)]);
      maxSow = Math.max(maxSow, r.sowings); turns++;
      if (r.events.some((e) => e.reason === 'limit')) limits++; // a never-ending relay: the turn stops
      s = r.state;
      assert.strictEqual(B.sideSum(s, 0) + B.sideSum(s, 1), 64);
    }
  }
  console.log('     finished', finished, '/300, longest turn', maxSow, 'sowings, endless relays stopped:', limits, 'of', turns, 'turns');
  assert.ok(limits / turns < 0.005);
  assert.ok(finished > 250);
});

test('coach finds an obvious trap and stays quiet otherwise', () => {
  const s = B.newGame();
  const looks = A.looksAt(s);
  assert.ok(looks.length > 0);
  const best = A.simpleBest(looks);
  assert.strictEqual(A.checkTrap(s, best), null);
});

test('hard computer beats random play', () => {
  let wins = 0;
  for (let g = 0; g < 4; g++) {
    let s = B.newGame(g % 2), ply = 0, end;
    while (!(end = B.checkEnd(s)) && ply++ < 300) {
      const m = s.toMove === 0 ? A.chooseMove(s, 'hard') : (() => { const l = B.legalMoves(s); return l[Math.floor(Math.random() * l.length)]; })();
      s = B.play(s, m).state;
    }
    if (end && end.winner === 0) wins++;
  }
  assert.ok(wins >= 3, 'won ' + wins + '/4');
});

test('puzzles: one clearly best move, still true with the current engine', () => {
  global.window = global;
  const P = require('../src/bao/puzzles.js');
  assert.ok(P.length >= 25);
  const ids = new Set();
  for (const pz of P) {
    assert.ok(!ids.has(pz.id)); ids.add(pz.id);
    const s = { pits: pz.pits, toMove: 0 };
    const looks = A.looksAt(s);
    const ans = looks.find((l) => l.pit === pz.answer.pit && l.dir === pz.answer.dir);
    assert.ok(ans, pz.id + ' answer is legal');
    for (const l of looks) if (l !== ans) assert.ok(ans.net - l.net >= 4, pz.id + ' answer clearly best');
    assert.strictEqual(B.sideSum(s, 0) + B.sideSum(s, 1), 64);
  }
});

test('every Bao text exists in every language', () => {
  global.window = global;
  require('../src/i18n.js');
  const I = global.Awale.I18n;
  const app = require('fs').readFileSync(require('path').join(__dirname, '../src/bao/app.js'), 'utf8');
  const keys = [...new Set([...app.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.')))];
  for (const d of ['right', 'left', 'up', 'down']) keys.push('bao.dir.' + d);
  for (const t of ['win', 'defend', 'greedy', 'game']) keys.push('puzzle.type.' + t, 'baopz.task.' + t, 'baopz.hint.' + t, 'baopz.tip.' + t);
  const L = require('../src/bao/lessons.js');
  for (const l of I.LANGS) {
    I.setLang(l.id);
    for (const k of keys) assert.notStrictEqual(I.t(k, {}), k, l.id + ' ' + k);
    for (const les of L) assert.ok(I.lessonText('bao:' + les.id).title, l.id + ' lesson ' + les.id);
  }
});

console.log('\n' + passed + ' passed');
