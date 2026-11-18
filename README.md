# Awale and Bao

Two mancala trainers sharing one shell (players, languages, video, lessons, puzzles):
`index.html` is Awale, `bao.html` is Bao. After choosing who plays, the "Who's playing?" screen
asks which game; the switch at the top of each page moves between them (same player, same visit).

A visual Awale (Oware, Abapa rules) trainer: guided lessons, legal/illegal move highlighting,
sowing previews and animation, a coach that warns before mistakes, and a computer opponent
that eases off instead of crushing beginners.

## Run

Open `index.html` in a browser. No build step, no dependencies.

`node build.js` writes self-contained pages: `dist/awale.html`, `dist/bao.html` (private preview,
premium on; `dist/full/` has the same as complete pages) and `site/` (`index.html`, `bao.html`, videos;
premium off) to upload to Netlify.

## Layout

```
index.html, styles.css   UI shell
src/engine.js            rules, pure functions (browser + Node)
src/advisor.js           move scoring (alpha-beta search), coach logic, computer opponent
src/lessons.js           guided lesson positions and goals
src/app.js               board rendering, previews, animation, modes
python/awale.py          identical rules in Python + gym-style env, for training
tests/engine.test.js     rules + lesson + search tests       (node tests/engine.test.js)
tests/crosscheck.py      JS vs Python engine replay check    (see below)
```

Cross-check both engines agree move for move:

```
node tests/gen_games.js 500 > /tmp/games.json && python3 tests/crosscheck.py /tmp/games.json
```

## Rules implemented (Abapa)

- 4 seeds per pit, sow counterclockwise; a pit with 12+ seeds skips itself.
- Last seed on the opponent's side making 2 or 3 captures, chaining backwards.
- Grand slam (capturing all the opponent's seeds) captures nothing.
- You must feed an opponent who has no seeds; if you cannot, you collect the rest.
- 25 wins, 24-24 draws, threefold repetition ends the game with each side keeping its own seeds.

## Computer opponent

Three levels, picked above the board in "vs Computer" mode:

- **Easy**: looks one move ahead and often plays a random move.
- **Medium**: looks a few moves ahead, sees simple traps, still slips up.
- **Hard**: deep search, always plays its best move.

On Easy and Medium, "go easy on me when I'm losing" (on by default) adds randomness as the
computer's lead grows and, 8+ seeds ahead, prefers moves that don't capture. Hard never eases off.

## Beginner coach

The coach is aimed at kids (7-10) and non-expert adults. It only warns about traps you can see
one move ahead, and only when another move is at least 2 seeds better:

- you leave seeds the opponent can grab on the very next turn,
- you miss a move that wins seeds right now,
- your move would take all the opponent's seeds and so wins nothing.

Deep search is used only by the computer opponent, never to explain warnings.

## Languages

English, French, German and Italian. The language follows the browser on first visit and can be
changed in the header or on the "Who's playing?" screen. All text lives in `src/i18n.js`
(lesson text included); `tests/engine.test.js` checks every language has every text.

## Premium switch

`src/config.js` has `premium: true|false`. Premium covers the Puzzles tab and "Copy games for
analysis". `node build.js` writes `dist/` (private preview) with premium on and `site/` (the public
Netlify version) with premium off. Local `index.html` uses whatever config.js says (on by default).

## Puzzles

The Puzzles tab has 35 positions where exactly one move is clearly best for a beginner, in four
kinds: win seeds, find the chain, keep your seeds safe, don't be greedy. One is "today's puzzle"
(same for everyone that day); solving it builds a daily streak. Stars: 3 on the first try with
no hint, fewer with retries or hints. Progress is kept per player in the browser.

Puzzles are generated, not hand-made: `node tools/make_puzzles.js` plays realistic games and keeps
positions where the coach's one-move-ahead check finds a single best move at least 2 seeds better
than any other. `tests/engine.test.js` re-checks every puzzle.

## Rules video

`video/awale-rules-<lang>.mp4` (EN/FR/DE/IT, about 74 s) is embedded at the top of the Learn tab
and follows the chosen language. To change wording or timing, edit `video/make_video.py` and run
`python3 video/make_video.py` (or `--lang fr`); it needs Pillow, numpy, ffmpeg and the
Bricolage Grotesque / Atkinson Hyperlegible fonts (`FONT_DIR`). Then `node build.js`.

## Players and recorded games

Pick who is playing at the top ("Amina plays the computer", or two players in two-player mode;
"+ New player" adds one). Every finished game is saved in this browser (localStorage, last 300
games) with each move, which moves fell into a simple trap, and whether a warning was shown.
"Games played" lists them per player. Games live only in the browser they were played in.

## Analyzing a player's games

In "Games played", press "Copy games for analysis" and paste into `games.json`. Then:

```
python3 python/analyze_games.py games.json --player Amina                  # report, no API needed
OPENAI_API_KEY=sk-... python3 python/analyze_games.py games.json --player Amina --llm --language French
```

The script replays every game with the Python engine and finds the mistakes itself (the same
one-move-deep checks as the in-game coach, cross-checked against the JS version). Only the counted
patterns and a few example positions go to the OpenAI model, which writes short, kid-friendly
advice. The model never judges moves, so it can't give wrong Awale advice. Set `OPENAI_MODEL` or
`--model` to choose the model (default `gpt-4o-mini`).

## Plugging in a trained model later

The coach and the opponent only use the advisor interface in `src/advisor.js`:

```js
Awale.Advisor.register('policy-v1', {
  name: 'Policy net v1',
  async analyze(state, opts) {
    // state = { board: [12 ints], stores: [s, n], toMove: 0|1 }
    // return { moves: [{ pit, score }], best, source: 'policy-v1' }
    //   score: expected seed margin for the mover (or any monotone value)
  },
});
Awale.Advisor.use('policy-v1');
```

Suggested path: self-play or imitation training on `python/awale.py` (its `observation()` is
already rotated to the mover's perspective), export to ONNX, run in the browser with
onnxruntime-web (or behind a small HTTP endpoint), and return per-move values from `analyze`.
The existing minimax search is a strong baseline to evaluate against.

## Bao

`bao.html` + `src/bao/` (engine, advisor, lessons, puzzles, app). Rules: **Bao la Kujifunza**, the
learners' Bao played before full Bao la Kiswahili:

- 4 rows of 8; each player owns the two rows on their side, the middle one is their front row. 2 seeds per pit.
- A move takes a pit with 2+ seeds and sows it left or right round your own 16 pits. Landing on seeds:
  pick them up and keep going (relay). The turn ends in an empty pit.
- Capture (mtaji): if the first sowing ends on seeds in your front row and the facing pit has seeds, the
  turn captures; each such landing takes the facing seeds and sows them again from an end of your front
  row (the end nearest the capture, or the one that keeps your direction for a middle pit; in full Bao
  the player may choose). A first sowing of 16+ seeds never captures.
- Capturing is compulsory. Otherwise start from your front row if it has a pit with 2+ seeds.
- You lose with an empty front row or no legal move. Turns are capped at 300 sowings (never seen in play).

The "Rules: Learner / Advanced" switch is there for full Bao (the house, seeds in hand); Advanced is
not built yet. The coach, computer levels, warnings and recorded games work as in Awale (games are
stored with `game: 'bao'`; `analyze_games.py` skips them for now).

```
node tests/bao.test.js            # rules, lessons, coach, puzzles, texts in 4 languages
node tools/make_bao_lessons.js    # regenerate src/bao/lessons.js
node tools/make_bao_puzzles.js    # regenerate src/bao/puzzles.js (32 puzzles: win, game, defend, greedy)
python3 video/make_bao_video.py   # video/bao-rules-<lang>.mp4 + .jpg (moves played by the JS engine)
```
