"""
Analyze recorded Awale games for one player and explain their common mistakes.

1. In the app, open "Games played" and press "Copy games for analysis".
   Paste into a file, e.g. games.json.
2. Run:

    python3 python/analyze_games.py games.json --player Amina            # plain report, no API
    OPENAI_API_KEY=sk-... python3 python/analyze_games.py games.json --player Amina --llm

How it works: the mistakes are found here, deterministically, by replaying every game with the
same rules and the same "simple trap" checks as the in-game coach (awale.py). The language
model never judges moves; it only receives the counted patterns and a few example positions,
and turns them into short, friendly advice. That keeps the advice correct.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from awale import PIT_NAMES, State, check_trap, simulate  # noqa: E402

KIND_TEXT = {
    "danger": "left seeds where the opponent could grab them on the very next turn",
    "missed": "missed a move that would have won seeds right away",
    "grand-slam": "played a move that would take all the opponent's seeds, which wins nothing",
}


def board_diagram(state: State, seat: int) -> str:
    """Text picture of the board, with `seat`'s row at the bottom."""
    b = state.board
    if seat == 0:
        top = [(PIT_NAMES[i], b[i]) for i in range(11, 5, -1)]
        bottom = [(PIT_NAMES[i], b[i]) for i in range(0, 6)]
    else:
        top = [(PIT_NAMES[i], b[i]) for i in range(5, -1, -1)]
        bottom = [(PIT_NAMES[i], b[i]) for i in range(6, 12)]
    row = lambda cells: " ".join(f"{n:>2}" for _, n in cells)
    names = lambda cells: " ".join(f"{p:>2}" for p, _ in cells)
    return "\n".join([
        "      " + names(top),
        "them: " + row(top),
        "you:  " + row(bottom),
        "      " + names(bottom),
    ])


def phase_of(state: State, move_no: int) -> str:
    seeds = sum(state.board)
    if move_no < 10:
        return "opening"
    if seeds <= 16:
        return "endgame"
    return "middle"


def analyze(data: dict, player: str) -> dict:
    games = [g for g in data["games"]
             if g.get("game", "awale") == "awale"  # Bao games are skipped for now
             and any(p == player and g.get("computer") != i for i, p in enumerate(g["players"]))]
    games.sort(key=lambda g: g["date"])
    kinds, phases, sizes = Counter(), Counter(), Counter()
    warned_ignored = warned_listened = 0
    small_piles = 0
    results = Counter()
    per_game = []
    examples = []

    for gi, g in enumerate(games):
        seat = 0 if g["players"][0] == player and g.get("computer") != 0 else 1
        state = State(to_move=g["first"])
        my_moves = traps = 0
        for n, t in enumerate(g["turns"]):
            if t["p"] == seat:
                my_moves += 1
                trap = check_trap(state, t["pit"])
                if t.get("warned"):
                    if trap:
                        warned_ignored += 1
                    else:
                        warned_listened += 1
                if trap:
                    traps += 1
                    k = trap["kind"]
                    kinds[k] += 1
                    phases[phase_of(state, n)] += 1
                    lost = (trap["better"]["net"] - trap["mine"]["net"])
                    sizes["big (4+ seeds)" if lost >= 4 else "small (2-3 seeds)"] += 1
                    if k == "danger":
                        after = simulate(state, t["pit"])["after"]
                        if any(after.board[p] in (1, 2) for p in trap["mine"]["risk_pits"]):
                            small_piles += 1
                    examples.append({
                        "game": gi + 1, "move": n + 1, "kind": k, "lost": lost,
                        "played": PIT_NAMES[t["pit"]], "better": PIT_NAMES[trap["better"]["pit"]],
                        "took": trap["mine"]["take"], "risk": trap["mine"]["risk"],
                        "better_took": trap["better"]["take"], "better_risk": trap["better"]["risk"],
                        "board": board_diagram(state, seat),
                    })
            state = simulate(state, t["pit"])["after"]
        r = g["result"]
        res = "draw" if r["winner"] is None else ("win" if r["winner"] == seat else "loss")
        results[res] += 1
        opp = f"computer ({g.get('level')})" if g.get("computer") is not None else g["players"][1 - seat]
        per_game.append({"date": g["date"][:10], "vs": opp, "result": res,
                         "score": f"{r['stores'][seat]}-{r['stores'][1 - seat]}",
                         "moves": my_moves, "traps": traps, "undos": g.get("undos", 0)})

    examples.sort(key=lambda e: -e["lost"])
    total_moves = sum(p["moves"] for p in per_game)
    half = len(per_game) // 2
    def rate(rows):
        m = sum(r["moves"] for r in rows)
        return round(100 * sum(r["traps"] for r in rows) / m, 1) if m else None

    return {
        "player": player,
        "games": len(games),
        "results": dict(results),
        "moves": total_moves,
        "traps": sum(kinds.values()),
        "trap_rate_percent": rate(per_game),
        "trap_rate_first_half": rate(per_game[:half]) if half else None,
        "trap_rate_second_half": rate(per_game[half:]) if half else None,
        "by_kind": dict(kinds),
        "by_phase": dict(phases),
        "by_size": dict(sizes),
        "danger_from_small_piles": small_piles,
        "warnings_ignored": warned_ignored,
        "warnings_listened": warned_listened,
        "per_game": per_game,
        "examples": examples[:4],
    }


def report(a: dict) -> str:
    out = [f"# {a['player']}: how to step up your game", ""]
    if not a["games"]:
        return "\n".join(out + [f"No finished games found for {a['player']}."])
    r = a["results"]
    out.append(f"{a['games']} games: {r.get('win', 0)} won, {r.get('loss', 0)} lost, {r.get('draw', 0)} drawn.")
    out.append(f"Simple traps on {a['traps']} of {a['moves']} moves ({a['trap_rate_percent']}%).")
    if a["trap_rate_first_half"] is not None:
        out.append(f"Earlier games: {a['trap_rate_first_half']}% of moves. Recent games: {a['trap_rate_second_half']}%.")
    out.append("")
    if a["by_kind"]:
        out.append("## Most common mistakes")
        for k, n in sorted(a["by_kind"].items(), key=lambda kv: -kv[1]):
            out.append(f"- {n}x: {KIND_TEXT[k]}")
        if a["danger_from_small_piles"]:
            out.append(f"- {a['danger_from_small_piles']} of the 'left seeds in danger' moves left a pit with 1 or 2 seeds "
                       "that the opponent could turn into 2 or 3.")
        if a["by_phase"]:
            out.append("- When: " + ", ".join(f"{k} {v}" for k, v in a["by_phase"].items()))
        if a["warnings_ignored"]:
            out.append(f"- Played the risky move anyway after a warning {a['warnings_ignored']} time(s).")
        out.append("")
    if a["examples"]:
        out.append("## Examples")
        for e in a["examples"]:
            out.append(f"Game {e['game']}, move {e['move']}: played {e['played']}, better was {e['better']} "
                       f"({KIND_TEXT[e['kind']]}; about {e['lost']} seeds).")
            out.append("```\n" + e["board"] + "\n```")
    return "\n".join(out)


SYSTEM_PROMPT = """You are a warm, encouraging Awale (Oware) coach.
The learner is either a child aged 7-10 or an adult beginner. They are not trying to become
an expert; they want to stop falling into simple traps.

Rules reminder: players sow seeds counterclockwise; landing the last seed on the opponent's side
to make 2 or 3 wins those seeds (and the pits just before, if they also make 2 or 3). A pit
holding 1 or 2 seeds on your own side is in danger if the opponent can drop their last seed there.

Write in plain, short sentences. No jargon (do not say capture, sow, grand slam, heuristic).
Use only the numbers and examples you are given; never invent statistics or moves.
Structure:
1. One sentence on how they are doing (mention progress if the recent trap rate is lower).
2. The 2 or 3 most common mistakes, each with: what happens, and one simple habit to fix it
   (a question they can ask themselves before each move).
3. One example position from the data, explained simply.
4. One encouraging line.
Keep it under 250 words."""


def ask_llm(analysis: dict, model: str, language: str) -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit("Set OPENAI_API_KEY to use --llm.")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT + f"\nAnswer in {language}."},
            {"role": "user", "content": "Here is the analysis of my recorded games:\n" + json.dumps(analysis, indent=1)},
        ],
        "temperature": 0.4,
    }
    req = urllib.request.Request(
        os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"OpenAI API error {e.code}: {e.read().decode(errors='replace')[:500]}")
    return body["choices"][0]["message"]["content"].strip()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("games", help="JSON copied from the app's 'Games played' panel")
    ap.add_argument("--player", help="whose games to analyze (default: the only/first player)")
    ap.add_argument("--llm", action="store_true", help="also ask an OpenAI model for friendly advice")
    ap.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                    help="OpenAI model (or set OPENAI_MODEL)")
    ap.add_argument("--language", default="English", help="language for the advice, e.g. French")
    ap.add_argument("--json", action="store_true", help="print the raw analysis as JSON")
    args = ap.parse_args()

    data = json.load(open(args.games))
    if isinstance(data, list):
        data = {"games": data}
    player = args.player
    if not player:
        names = Counter(p for g in data["games"] for i, p in enumerate(g["players"]) if g.get("computer") != i)
        if not names:
            raise SystemExit("No games found.")
        player = names.most_common(1)[0][0]

    a = analyze(data, player)
    if args.json:
        print(json.dumps(a, indent=1))
        return
    print(report(a))
    if args.llm and a["games"]:
        print("\n## Coach's advice\n")
        print(ask_llm(a, args.model, args.language))


if __name__ == "__main__":
    main()
