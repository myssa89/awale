// Builds src/puzzles.js: positions from realistic games where exactly one move is clearly best,
// judged with the same one-move-ahead rules as the beginner coach (seeds won now minus seeds
// the opponent can grab right after). Deterministic: same seed, same puzzles.
//
//   node tools/make_puzzles.js            -> writes src/puzzles.js
//
// Puzzle types (and the skill each one trains):
//   win     - one move wins seeds, safely                    ("Win seeds")
//   chain   - the best move wins several pits in a row       ("Find the chain")
//   defend  - most moves give seeds away; find the safe one  ("Keep your seeds safe")
//   greedy  - the biggest capture is a trap; find the better move ("Don't be greedy")
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const A = require('../src/advisor.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261105);

// A plausible beginner-to-decent player: usually picks a sensible move, sometimes not.
function pickMove(s) {
  const looks = A.looksAt(s);
  if (rng() < 0.3) return looks[Math.floor(rng() * looks.length)].pit;
  const w = looks.map((l) => Math.exp(l.net / 1.5));
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < looks.length; i++) { r -= w[i]; if (r <= 0) return looks[i].pit; }
  return looks[looks.length - 1].pit;
}

// Always present puzzles from South's side (the bottom row).
function asSouth(s) {
  if (s.toMove === 0) return { board: s.board.slice(), stores: s.stores.slice(), toMove: 0 };
  return { board: s.board.slice(6).concat(s.board.slice(0, 6)), stores: [s.stores[1], s.stores[0]], toMove: 0 };
}

function classify(s) {
  const looks = A.looksAt(s);
  if (looks.length < 3) return null;
  if (Math.max(...s.board) > 11) return null;                 // keep laps out of puzzles
  const seeds = s.board.reduce((a, b) => a + b, 0);
  if (seeds < 12 || seeds > 38) return null;
  if (s.stores[0] > 20 || s.stores[1] > 20) return null;      // no game-ending positions
  if (looks.some((l) => l.grandSlam)) return null;            // keep the take-all rule out
  const bestNet = Math.max(...looks.map((l) => l.net));
  const sols = looks.filter((l) => l.net === bestNet);
  if (sols.length !== 1) return null;
  const best = sols[0];
  const second = Math.max(...looks.filter((l) => l !== best).map((l) => l.net));
  if (bestNet - second < 2) return null;
  const sim = E.simulate(s, best.pit);

  const greedyTrap = looks.find((l) => l.take > best.take && l.net <= bestNet - 2);
  if (greedyTrap && best.risk === 0) return { type: 'greedy', answer: best.pit, bait: greedyTrap.pit };
  if (best.risk > 0) return null;
  if (sim.captures.length >= 2 && best.take >= 4) return { type: 'chain', answer: best.pit };
  const risky = looks.filter((l) => l.risk >= 2).length;
  if (best.take === 0 && risky >= Math.ceil(looks.length / 2) && risky >= 2) return { type: 'defend', answer: best.pit };
  const capturing = looks.filter((l) => l.take > 0).length;
  if (best.take >= 2 && sim.captures.length === 1 && capturing === 1) return { type: 'win', answer: best.pit };
  return null;
}

const found = { win: [], chain: [], defend: [], greedy: [] };
const seen = new Set();
const WANT = { win: 10, chain: 8, defend: 10, greedy: 8 };
for (let g = 0; g < 6000; g++) {
  let s = E.newGame(g % 2);
  const h = {};
  for (let ply = 0; ply < 120 && !s.result; ply++) {
    if (ply >= 6) {
      const p = asSouth(s);
      const key = E.positionKey(p);
      if (!seen.has(key)) {
        seen.add(key);
        const c = classify(p);
        if (c && found[c.type].length < WANT[c.type] * 10) found[c.type].push(Object.assign({ board: p.board, stores: p.stores, game: g }, c));
      }
    }
    s = E.applyMove(s, pickMove(s), h).state;
  }
  if (Object.keys(WANT).every((k) => found[k].length >= WANT[k] * 10)) break;
}

// Prefer mid-game positions (around 22 seeds on the board): busy enough to think, small enough to read.
const usedGames = new Set();
for (const k of Object.keys(found)) {
  const mid = (p) => Math.abs(p.board.reduce((x, y) => x + y, 0) - 22);
  found[k].sort((a, b) => mid(a) - mid(b));
  // Variety: one puzzle per game, and the answer pit spread out (so "always pit a" never works).
  const picked = [], perPit = {};
  for (const p of found[k]) {
    if (picked.length >= WANT[k]) break;
    if (usedGames.has(p.game) || (perPit[p.answer] || 0) >= 2) continue;
    picked.push(p); usedGames.add(p.game); perPit[p.answer] = (perPit[p.answer] || 0) + 1;
  }
  found[k] = picked;
  if (found[k].length < WANT[k]) console.warn('only', found[k].length, k, 'puzzles');
}

// Easy to hard: start with plain wins, then mix in the other skills.
const order = 'wwwcwdcwdgcdwgdcwgdcgdwgcdgwdcgdwgcd';
const take = { w: 'win', c: 'chain', d: 'defend', g: 'greedy' };
const list = [];
for (const ch of order) { const p = found[take[ch]].shift(); if (p) list.push(p); }
for (const k of Object.keys(found)) list.push(...found[k]);
list.forEach((p, i) => { p.id = 'p' + String(i + 1).padStart(2, '0'); });

const body = list.map((p) => '    ' + JSON.stringify({ id: p.id, type: p.type, board: p.board, stores: p.stores, answer: p.answer })).join(',\n');
const out = `/*
 * Puzzles: positions where exactly one move is clearly best for a beginner.
 * Generated by tools/make_puzzles.js (do not edit by hand); tests/engine.test.js re-checks each one.
 * type: win | chain | defend | greedy. answer: the pit to play (0-5 = a-f).
 */
(function (root) {
  'use strict';
  const PUZZLES = [
${body},
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = PUZZLES;
  root.Awale = root.Awale || {};
  root.Awale.PUZZLES = PUZZLES;
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'puzzles.js'), out);
const counts = {};
for (const p of list) counts[p.type] = (counts[p.type] || 0) + 1;
console.log('wrote', list.length, 'puzzles', counts);
