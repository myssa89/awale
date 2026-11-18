// Generates random games with the JS engine for tests/crosscheck.py.
// Usage: node tests/gen_games.js 200 > /tmp/games.json
const E = require('../src/engine.js');
const A = require('../src/advisor.js');
const n = parseInt(process.argv[2] || '200', 10);
const games = [];
for (let g = 0; g < n; g++) {
  let s = E.newGame(g % 2);
  const h = { [E.positionKey(s)]: 1 };
  const moves = [];
  while (!s.result) {
    const legal = E.legalMoves(s);
    const pit = legal[Math.floor(Math.random() * legal.length)];
    const t = A.checkTrap(s, pit);
    const r = E.applyMove(s, pit, h);
    moves.push({ pit, legal, board: r.state.board, stores: r.state.stores,
      trap: t ? t.kind : null, better: t ? t.better.pit : null });
    s = r.state;
  }
  games.push({ first: g % 2, moves, result: s.result });
}
process.stdout.write(JSON.stringify(games));
