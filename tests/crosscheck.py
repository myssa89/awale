"""Replay JS-generated games in the Python engine and compare every step.

    node tests/gen_games.js 300 > games.json && python3 tests/crosscheck.py games.json
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "python"))
from awale import Awale, check_trap  # noqa: E402

games = json.load(open(sys.argv[1]))
for gi, g in enumerate(games):
    env = Awale(first_player=g["first"])
    for mi, m in enumerate(g["moves"]):
        assert env.legal_moves() == m["legal"], (gi, mi, env.legal_moves(), m["legal"])
        t = check_trap(env.state, m["pit"])
        assert (t["kind"] if t else None) == m["trap"], (gi, mi, t and t["kind"], m["trap"])
        assert (t["better"]["pit"] if t else None) == m["better"], (gi, mi)
        env.step(m["pit"])
        assert env.state.board == m["board"], (gi, mi)
        assert env.state.stores == m["stores"], (gi, mi)
    r = g["result"]
    assert env.result["reason"] == r["reason"], (gi, env.result, r)
    assert env.result["stores"] == r["stores"], (gi, env.result, r)
    assert env.result["winner"] == r["winner"], (gi, env.result, r)
print(f"ok: {len(games)} games, {sum(len(g['moves']) for g in games)} moves identical in JS and Python (rules and coach)")
