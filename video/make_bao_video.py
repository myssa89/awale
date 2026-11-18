"""
Renders the Bao rules explainer (learners' rules), to video/bao-rules-<lang>.mp4 + .jpg.

    python3 video/make_bao_video.py                 # all languages (en, fr, de, it)
    python3 video/make_bao_video.py --lang fr       # one language
    python3 video/make_bao_video.py --stills        # a few frames as PNG, for checking

Reuses the drawing, sound and encoding helpers of make_video.py (same look as the Awale video).
Every move shown is played by the real JS engine (src/bao/engine.js, through node), on the
positions of the in-app lessons (src/bao/lessons.js).
"""
from __future__ import annotations

import json
import math
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import make_video as mv  # noqa: E402
from make_video import (W, H, FPS, BG, INK, MUTED, ACCENT, ON_WOOD, GO, NO, PATH, CAPTURE, PANEL,  # noqa: E402
                        WOOD, WOOD_HI, WOOD_LO, font, text_img, pill, rounded_rect, ease)

ROOT = mv.ROOT
OUT = mv.OUT
BUILD = mv.BUILD.parent / "bao-video"

TEXT = {
    "en": {
        "sub": "The seed game of East Africa. Learn the rules in about a minute.",
        "board": ("The board", "Four rows, two are yours", "The bottom two rows are yours. The middle row facing your opponent is your front row. Every pit starts with 2 seeds."),
        "move": ("Rule 1", "Sow left or right", "Take all the seeds from one of your pits with 2 or more. Drop them one by one round your own two rows, left or right."),
        "relay": ("Rule 2", "Land on seeds? Keep going!", "If the last seed lands on seeds, pick them all up and keep sowing the same way. You stop in an empty pit."),
        "capture": ("Rule 3", "Capture from your front row", "End on seeds in your front row with seeds facing it? Take those seeds and sow them again from the end of your front row."),
        "must": ("Rule 4", "If you can capture, you must", "Only capturing moves are allowed then. If you can't capture, start from your front row when you can."),
        "winning": ("Winning", "Empty the front row", "If your opponent's front row is empty, or they can't move, you win. Seeds never leave the board!"),
        "outro": ("Your turn!", "Open the Bao lessons and try it."),
        "opponent": "OPPONENT", "you": "YOU", "front": "front row", "win": "You win!",
    },
    "fr": {
        "sub": "Le jeu de graines d'Afrique de l'Est. Apprends les règles en une minute.",
        "board": ("Le plateau", "Quatre rangées, deux à toi", "Les deux rangées du bas sont à toi. Celle du milieu, face à ton adversaire, est ta rangée de devant. Chaque trou commence avec 2 graines."),
        "move": ("Règle 1", "Sème à gauche ou à droite", "Prends toutes les graines d'un de tes trous qui en a 2 ou plus. Pose-les une par une autour de tes deux rangées, à gauche ou à droite."),
        "relay": ("Règle 2", "Sur des graines ? Continue !", "Si la dernière graine tombe sur des graines, ramasse-les toutes et continue dans le même sens. Tu t'arrêtes dans un trou vide."),
        "capture": ("Règle 3", "Capture depuis ta rangée de devant", "Tu finis sur des graines de ta rangée de devant, avec des graines en face ? Prends-les et ressème-les depuis le bout de ta rangée de devant."),
        "must": ("Règle 4", "Si tu peux capturer, tu dois", "Seuls les coups qui capturent sont permis. Sinon, commence par ta rangée de devant si tu peux."),
        "winning": ("Gagner", "Vide la rangée de devant", "Si la rangée de devant de ton adversaire est vide, ou s'il ne peut plus jouer, tu gagnes. Les graines ne quittent jamais le plateau !"),
        "outro": ("À toi de jouer !", "Ouvre les leçons de Bao et essaie."),
        "opponent": "ADVERSAIRE", "you": "TOI", "front": "rangée de devant", "win": "Gagné !",
    },
    "de": {
        "sub": "Das Samenspiel aus Ostafrika. Lerne die Regeln in einer Minute.",
        "board": ("Das Brett", "Vier Reihen, zwei gehören dir", "Die unteren zwei Reihen gehören dir. Die mittlere, die dem Gegner gegenüberliegt, ist deine vordere Reihe. Jede Mulde beginnt mit 2 Samen."),
        "move": ("Regel 1", "Säe nach links oder rechts", "Nimm alle Samen aus einer deiner Mulden mit 2 oder mehr. Leg sie einzeln rund um deine zwei Reihen, nach links oder rechts."),
        "relay": ("Regel 2", "Auf Samen gelandet? Weiter!", "Landet der letzte Samen auf Samen, nimm alle auf und säe in dieselbe Richtung weiter. Du hörst in einer leeren Mulde auf."),
        "capture": ("Regel 3", "Schlagen aus der vorderen Reihe", "Endest du auf Samen in deiner vorderen Reihe und gegenüber liegen Samen? Nimm sie und säe sie vom Ende deiner vorderen Reihe neu."),
        "must": ("Regel 4", "Wenn du schlagen kannst, musst du", "Dann sind nur schlagende Züge erlaubt. Kannst du nicht schlagen, beginne wenn möglich in der vorderen Reihe."),
        "winning": ("Gewinnen", "Leere die vordere Reihe", "Ist die vordere Reihe des Gegners leer oder kann er nicht ziehen, gewinnst du. Samen verlassen nie das Brett!"),
        "outro": ("Du bist dran!", "Öffne die Bao-Lektionen und probier es."),
        "opponent": "GEGNER", "you": "DU", "front": "vordere Reihe", "win": "Gewonnen!",
    },
    "it": {
        "sub": "Il gioco dei semi dell'Africa orientale. Impara le regole in un minuto.",
        "board": ("Il tavoliere", "Quattro file, due sono tue", "Le due file in basso sono tue. Quella di mezzo, di fronte all'avversario, è la tua fila davanti. Ogni buca parte con 2 semi."),
        "move": ("Regola 1", "Semina a sinistra o a destra", "Prendi tutti i semi da una tua buca con 2 o più. Mettili uno alla volta intorno alle tue due file, a sinistra o a destra."),
        "relay": ("Regola 2", "Sui semi? Continua!", "Se l'ultimo seme cade su altri semi, prendili tutti e continua nella stessa direzione. Ti fermi in una buca vuota."),
        "capture": ("Regola 3", "Cattura dalla fila davanti", "Finisci su semi nella tua fila davanti, con semi di fronte? Prendili e riseminali dal bordo della tua fila davanti."),
        "must": ("Regola 4", "Se puoi catturare, devi", "Allora sono permesse solo le mosse che catturano. Se non puoi, parti dalla fila davanti quando puoi."),
        "winning": ("Vincere", "Svuota la fila davanti", "Se la fila davanti dell'avversario è vuota, o non può muovere, vinci. I semi non lasciano mai il tavoliere!"),
        "outro": ("Tocca a te!", "Apri le lezioni di Bao e prova."),
        "opponent": "AVVERSARIO", "you": "TU", "front": "fila davanti", "win": "Hai vinto!",
    },
}
LANG = "en"


def T(key):
    return TEXT[LANG][key]


# ---- engine (the real JS one) ----
NODE = """
const B=require(process.argv[1]+'/src/bao/engine.js');global.window=global;require(process.argv[1]+'/src/bao/lessons.js');
const q=JSON.parse(require('fs').readFileSync(0,'utf8'));const out={};
const L=Object.fromEntries(Bao.LESSONS.map(l=>[l.id,l.pits]));out.lessons=L;
out.plays=q.map(([pits,pit,dir])=>pit==null?null:B.play({pits,toMove:0},{pit,dir}));
out.legal=q.map(([pits])=>B.legalMoves({pits,toMove:0}));
console.log(JSON.stringify(out));
"""


def engine(queries):
    r = subprocess.run(["node", "-e", NODE, str(ROOT)], input=json.dumps(queries), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


LESSONS = engine([])["lessons"]
START = [[2] * 16, [2] * 16]

# ---- geometry: 4 rows x 8 pits ----
BX0, BX1, BY0, BY1 = 190, 1730, 232, 858
PIT_D = 116
COL0, STEP = 560, 140
ROWS_Y = [308, 440, 650, 782]          # North back, North front, South front, South back
LABEL_X = 360                          # centre of the side labels, left margin
PIT = mv.make_pit(PIT_D)
SEED = mv.make_seed(30)
SEED_OFF = (SEED.width // 2, SEED.height // 2)
RINGS = {k: mv.ring(PIT_D + 18, c, 7) for k, c in
         {"go": GO, "no": NO, "path": PATH, "capture": CAPTURE, "accent": ACCENT, "active": PATH}.items()}
GLOWS = {"capture": mv.glow(PIT_D + 18, CAPTURE), "active": mv.glow(PIT_D + 18, PATH), "no": mv.glow(PIT_D + 18, NO)}
CROSS = mv.cross(PIT_D, NO)
F_COUNT = font("bold", 24)
F_BADGE = font("display7", 34)


def arrow_sprite(direction):
    d = 64
    img = Image.new("RGBA", (d + 16, d + 16), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((8, 12, d + 8, d + 12), fill=(0, 0, 0, 110))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)))
    img.alpha_composite(mv.supersample((d, d), lambda dr, s, im: dr.ellipse((0, 0, d * s - 1, d * s - 1), fill=GO + (255,), outline=(255, 255, 255, 255), width=4 * s)), (8, 8))
    c = mv.chevron(direction, (255, 255, 255))
    img.alpha_composite(c, (8 + (d - c.width) // 2, 8 + (d - c.height) // 2))
    return img


ARROW_SPRITES = {k: arrow_sprite(k) for k in ("right", "left", "up", "down")}


def screen(p, k):
    if p == 0:
        return (0 + 2, k) if k < 8 else (3, 15 - k)
    return (1, 7 - k) if k < 8 else (0, k - 8)


def pit_xy(p, k):
    row, col = screen(p, k)
    return COL0 + STEP * col, ROWS_Y[row]


def arrow_name(p, k, d):
    a, b = screen(p, k), screen(p, (k + d) % 16)
    if b[1] > a[1]:
        return "right"
    if b[1] < a[1]:
        return "left"
    return "up" if b[0] < a[0] else "down"


def make_background(labels=True):
    img = Image.new("RGBA", (W, H), BG + (255,))
    import numpy as np
    bw, bh = BX1 - BX0, BY1 - BY0
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((BX0 + 6, BY0 + 26, BX1 - 6, BY1 + 26), 90, fill=(26, 33, 66, 70))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(24)))
    t = np.linspace(0, 1, bh)[:, None]
    top, mid, bot = np.array(WOOD_HI), np.array(WOOD), np.array(WOOD_LO)
    col = np.where(t < 0.45, top * (1 - t / 0.45) + mid * (t / 0.45), mid * (1 - (t - 0.45) / 0.55) + bot * ((t - 0.45) / 0.55))
    grad = np.repeat(col[:, None, :], bw, axis=1).astype(np.float32)
    rng = np.random.default_rng(5)
    xs = np.arange(bw)[None, :]
    yy = np.arange(bh)[:, None]
    grain = np.zeros((bh, bw), np.float32)
    for _ in range(26):
        x0, amp, per, ph = rng.uniform(0, bw), rng.uniform(3, 10), rng.uniform(300, 900), rng.uniform(0, 6)
        centre = x0 + amp * np.sin(yy / per * 6.28 + ph) + yy * 0.12
        grain += np.exp(-((xs - centre) ** 2) / rng.uniform(2, 14)) * rng.uniform(0.04, 0.1)
    grad *= (1 - grain[..., None])
    wood = Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    mask = rounded_rect((bw, bh), 90, (255, 255, 255, 255)).split()[3]
    img.paste(wood, (BX0, BY0), mask)
    deco = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(deco)
    d.rounded_rectangle((BX0, BY0, BX1, BY1), 90, outline=(255, 255, 255, 45), width=3)
    # the two front rows: a light band with the middle line
    x0, x1 = COL0 - PIT_D / 2 - 18, COL0 + STEP * 7 + PIT_D / 2 + 18
    d.rounded_rectangle((x0, ROWS_Y[1] - PIT_D / 2 - 14, x1, ROWS_Y[2] + PIT_D / 2 + 14), 30, fill=(255, 226, 170, 34), outline=(255, 226, 170, 50), width=2)
    ym = (ROWS_Y[1] + ROWS_Y[2]) / 2
    d.line((x0 + 10, ym, x1 - 10, ym), fill=(0, 0, 0, 80), width=3)
    img.alpha_composite(deco)
    for p in (0, 1):
        for k in range(16):
            x, y = pit_xy(p, k)
            img.alpha_composite(PIT, (int(x - PIT_D / 2), int(y - PIT_D / 2)))
    if labels:
        for p, (ya, yb) in ((1, ROWS_Y[:2]), (0, ROWS_Y[2:])):
            txt = T("opponent") if p == 1 else T("you")
            for size in (30, 26, 22):
                lab = text_img(txt, font("bold", size), ON_WOOD + (225,))
                if lab.width <= 220:
                    break
            img.alpha_composite(lab, (int(LABEL_X - lab.width / 2), int((ya + yb) / 2 - lab.height / 2)))
    return img


class Scene(mv.Scene):
    """Same timeline helpers as the Awale scenes (hold, fade_text, sound), with a Bao board."""

    def __init__(self, name, eyebrow, title, caption, pits, labels=True):
        self.name = name
        self.eyebrow, self.title, self.caption = eyebrow, title, caption
        self.pits = [list(pits[0]), list(pits[1])]
        self.rings, self.crosses, self.badges = {}, set(), {}
        self.hand = None
        self.flying = []
        self.big_text = None
        self.text_alpha = 1.0
        self.frames, self.sounds = [], []
        self.bg = make_background(labels)
        self.cache = {}

    # Frames are streamed to ffmpeg as they are drawn (a 1080p frame is 6 MB; scenes don't fit in memory).
    sink = None          # ffmpeg process, set by render_language
    prev_last = None     # last frame of the previous scene, for the crossfade
    stills_dir = None

    def frame(self):
        img = self.draw()
        n = self.count = getattr(self, "count", 0) + 1
        if Scene.prev_last is not None and n <= mv.XFADE:
            img = Image.blend(Scene.prev_last, img, n / (mv.XFADE + 1))
        self.last = img
        if Scene.sink is not None:
            Scene.sink.stdin.write(img.tobytes())
        if Scene.stills_dir is not None and n % 75 == 0:
            img.save(Scene.stills_dir / f"{self.name}-{n:04d}.png")

    @property
    def t(self):
        return getattr(self, "count", 0) / FPS

    def text_layers(self):
        if "txt" not in self.cache:
            layers = []
            if self.eyebrow:
                layers.append((text_img(self.eyebrow.upper(), mv.F_EYEBROW, MUTED + (255,)), (150, 40)))
            if self.title:
                for size in (88, 80, 72, 64):
                    ti = text_img(self.title, font("display", size), INK + (255,))
                    if ti.width <= 1620:
                        break
                layers.append((ti, (146, 84 + (88 - size) // 2)))
            if self.caption:
                for size in (48, 44, 40):
                    c = text_img(self.caption, font("body", size), INK + (255,), max_w=1620, spacing=10)
                    if c.height <= 2 * (size * 1.32 + 10) or size == 40:
                        break
                layers.append((c, (150, 900)))
            self.cache["txt"] = layers
        return self.cache["txt"]

    def sprite(self, key, make):
        if key not in self.cache:
            self.cache[key] = make()
        return self.cache[key]

    def draw(self):
        img = self.bg.copy()
        for (p, k), kind in self.rings.items():
            x, y = pit_xy(p, k)
            if kind in GLOWS:
                g = GLOWS[kind]; img.alpha_composite(g, (int(x - g.width / 2), int(y - g.height / 2)))
            r = RINGS[kind]; img.alpha_composite(r, (int(x - r.width / 2), int(y - r.height / 2)))
        for p in (0, 1):
            for k in range(16):
                x, y = pit_xy(p, k)
                for dx, dy in mv.seed_offsets(self.pits[p][k], PIT_D * 0.34):
                    img.alpha_composite(SEED, (int(x + dx - SEED_OFF[0]), int(y + dy - SEED_OFF[1])))
                n = self.pits[p][k]
                pl = self.sprite(("cnt", n), lambda: pill(str(n), F_COUNT, INK, PANEL, (10, 1)))
                cy = y + PIT_D / 2 - pl.height / 2 + 2 if p == 0 else y - PIT_D / 2 - pl.height / 2 - 2
                img.alpha_composite(pl, (int(x - pl.width / 2), int(cy)))
        for (p, k) in self.crosses:
            x, y = pit_xy(p, k)
            img.alpha_composite(CROSS, (int(x - PIT_D / 2), int(y - PIT_D / 2)))
        for key, (txt, colors, where) in self.badges.items():
            p, k = key[0], key[1]
            x, y = pit_xy(p, k)
            if txt in ARROW_SPRITES:
                b = ARROW_SPRITES[txt]
            else:
                b = self.sprite(("badge", txt, colors), lambda: pill(txt, F_BADGE, colors[0], colors[1], (14, 4)))
            if where == "band":
                bx, by = x + STEP / 2 - b.width / 2, y - PIT_D / 2 - b.height / 2 - 14
            elif where == "right":
                bx, by = x + PIT_D / 2 - 8, y - b.height / 2
            elif where == "left":
                bx, by = x - PIT_D / 2 - b.width + 8, y - b.height / 2
            elif where == "down":
                bx, by = x - b.width / 2, y + PIT_D / 2 - 8
            elif where == "up":
                bx, by = x - b.width / 2, y - PIT_D / 2 - b.height + 8
            else:
                bx, by = x - b.width / 2, y - b.height / 2
            img.alpha_composite(b, (int(bx), int(by)))
        for fx, fy in self.flying:
            img.alpha_composite(SEED, (int(fx - SEED_OFF[0]), int(fy - SEED_OFF[1])))
        if self.hand:
            hx, hy, n = self.hand
            for dx, dy in mv.seed_offsets(n, 22):
                img.alpha_composite(SEED, (int(hx + dx - SEED_OFF[0]), int(hy + dy - SEED_OFF[1])))
        layers = self.text_layers()
        if self.text_alpha > 0:
            for t, pos in layers:
                if self.text_alpha < 1:
                    t = t.copy(); t.putalpha(t.split()[3].point(lambda a: int(a * self.text_alpha)))
                img.alpha_composite(t, pos)
        if self.big_text:
            txt, color, alpha = self.big_text
            t = text_img(txt, font("display", 170), color + (int(255 * alpha),))
            plate = rounded_rect((t.width + 120, t.height + 40), 60, PANEL + (int(235 * alpha),))
            px, py = (W - plate.width) // 2, (BY0 + BY1) // 2 - plate.height // 2
            img.alpha_composite(plate, (px, py))
            img.alpha_composite(t, (px + 60, py + 2))
        return img.convert("RGB")

    # -- a whole move, from the engine's events
    def play(self, pit, dirn, step=0.3, after_capture=None):
        res = engine([[self.pits, pit, dirn]])["plays"][0]
        me = 0
        hx = hy = None
        left = 0
        lift = 56
        for e in res["events"]:
            if e["t"] == "pick":
                k, n = e["k"], e["n"]
                x, y = pit_xy(me, k)
                self.rings[(me, k)] = "go"
                self.hold(0.3)
                self.pits[me][k] = 0
                for f in range(1, 9):
                    self.hand = (x, y - lift * ease(f / 8), n); self.frame()
                hx, hy, left = x, y - lift, n
            elif e["t"] == "drop":
                tx, ty = pit_xy(me, e["k"])
                frames = max(2, int(step * FPS))
                for f in range(1, frames + 1):
                    u = ease(f / frames)
                    self.hand = (hx + (tx - hx) * u, hy + (ty - lift - hy) * u - 20 * math.sin(math.pi * u), left)
                    self.frame()
                self.pits[me][e["k"]] += 1
                left -= 1
                self.sound("drop")
                for key, kind in list(self.rings.items()):
                    if kind == "active":
                        self.rings[key] = "path"
                self.rings[(me, e["k"])] = "active"
                hx, hy = tx, ty - lift
                self.hand = (hx, hy, left) if left else None
                self.frame()
            elif e["t"] == "capture":
                k, src, n, kichwa = e["k"], e["from"], e["n"], e["kichwa"]
                self.rings[(me, k)] = "active"
                self.rings[(1 - me, src)] = "capture"
                self.badges[(1 - me, src)] = (f"+{n}", (INK, CAPTURE), "up")
                self.sound("ding")
                self.hold(0.9)
                # seeds fly to the end of the front row (kichwa)
                sx, sy = pit_xy(1 - me, src)
                kx, ky = pit_xy(me, kichwa)
                ky -= lift
                flights = [((sx + dx, sy + dy), k_ * 0.05) for k_, (dx, dy) in enumerate(mv.seed_offsets(n, PIT_D * 0.34))]
                self.pits[1 - me][src] = 0
                self.badges.pop((1 - me, src), None)
                self.sound("whoosh")
                dur = 0.7
                total = int((dur + 0.05 * len(flights)) * FPS)
                for f in range(1, total + 1):
                    tt = f / FPS
                    self.flying, got = [], 0
                    for (a, delay) in flights:
                        u = min(1, max(0, (tt - delay) / dur))
                        if u >= 1:
                            got += 1; continue
                        q = ease(u)
                        self.flying.append((a[0] + (kx - a[0]) * q, a[1] + (ky - a[1]) * q - 90 * math.sin(math.pi * q)))
                    self.hand = (kx, ky, got) if got else None
                    self.frame()
                self.flying = []
                self.rings.pop((1 - me, src), None)
                for key, kind in list(self.rings.items()):
                    if kind in ("path", "active", "go"):
                        self.rings.pop(key)
                self.rings[(me, kichwa)] = "accent"
                self.hold(0.3)
                # the first seed goes into the kichwa itself: start from the pit "before" it
                hx, hy, left = kx, ky, n
                self.hand = (hx, hy, left)
                if after_capture:
                    after_capture(self)
            elif e["t"] == "end":
                self.hand = None
                self.rings[(me, e["k"])] = "active"
                self.frame()
        return res


# ---- the script ----
def scene_title():
    s = Scene("01-title", None, None, None, START, labels=False)
    title = text_img("Bao", font("display", 190), INK + (255,))
    sub = text_img(T("sub"), font("body", 50), MUTED + (255,))
    s.bg = s.bg.copy()
    s.bg.alpha_composite(title, ((W - title.width) // 2, 10))
    s.bg.alpha_composite(sub, ((W - sub.width) // 2, 905))
    s.hold(3.5)
    return s


def scene_board():
    s = Scene("02-board", *T("board"), START)
    s.hold(1.2)
    s.rings = {(0, k): "go" for k in range(16)}
    s.sound("drop"); s.hold(1.8)
    s.rings = {(0, k): "accent" for k in range(8)}
    s.badges = {(0, 3): (T("front"), ((255, 255, 255), ACCENT), "band")}
    s.sound("drop"); s.hold(2.2)
    s.badges = {}
    s.rings = {(1, k): "path" for k in range(16)}
    s.sound("drop"); s.hold(1.8)
    s.rings = {}
    s.hold(1.4)
    s.fade_text(0)
    return s


def scene_move():
    s = Scene("03-move", *T("move"), LESSONS["board"])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.4)
    pit = 1
    s.rings[(0, pit)] = "go"
    # both directions, as arrows on the edges of the pit (like in the app)
    for d in (1, -1):
        name = arrow_name(0, pit, d)
        s.badges[(0, pit, d)] = (name, None, name)
        s.sound("drop"); s.hold(0.7)
    s.hold(1.6)
    s.badges = {}
    s.play(pit, 1, step=0.45)
    s.hold(1.8)
    s.fade_text(0)
    return s


def scene_relay():
    s = Scene("04-relay", *T("relay"), LESSONS["relay"])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.6)
    s.play(0, 1, step=0.42)
    s.hold(2.0)
    s.fade_text(0)
    return s


def scene_capture():
    s = Scene("05-capture", *T("capture"), LESSONS["ends"])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.8)
    s.play(8, -1, step=0.36)
    s.hold(2.0)
    s.fade_text(0)
    return s


def scene_must():
    pits = LESSONS["must"]
    s = Scene("06-must", *T("must"), pits)
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.4)
    legal = engine([[pits, None, None]])["legal"][0]
    ok = {m["pit"] for m in legal}
    bad = [k for k in range(16) if pits[0][k] >= 2 and k not in ok]
    for k in bad:
        s.rings[(0, k)] = "no"; s.crosses.add((0, k))
    s.sound("buzz"); s.hold(1.8)
    for k in ok:
        s.rings[(0, k)] = "go"
    s.hold(1.8)
    s.rings = {}; s.crosses = set()
    m = legal[0]
    s.play(m["pit"], m["dir"], step=0.34)
    s.hold(1.8)
    s.fade_text(0)
    return s


def scene_win():
    pits = LESSONS["win"]
    s = Scene("07-win", *T("winning"), pits)
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.6)
    s.play(6, -1, step=0.4)
    s.hold(0.4)
    s.rings = {(1, k): "no" for k in range(8)}
    s.sound("win")
    for k in range(1, 10):
        s.big_text = (T("win"), ACCENT, k / 9); s.frame()
    s.hold(2.2)
    s.fade_text(0)
    return s


def scene_outro():
    s = Scene("08-outro", None, None, None, START, labels=False)
    t1 = text_img(T("outro")[0], font("display", 150), INK + (255,))
    t2 = text_img(T("outro")[1], font("body", 54), MUTED + (255,))
    s.bg = s.bg.copy()
    s.bg.alpha_composite(t1, ((W - t1.width) // 2, 20))
    s.bg.alpha_composite(t2, ((W - t2.width) // 2, 905))
    s.hold(3.5)
    return s


SCENES = [scene_title, scene_board, scene_move, scene_relay, scene_capture, scene_must, scene_win, scene_outro]


def ffmpeg_sink(path):
    return subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                             "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "18",
                             "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", str(FPS), str(path)], stdin=subprocess.PIPE)


def render_language(lang, stills=False):
    global LANG
    LANG = lang
    mv.LANG = lang
    build = BUILD / lang
    build.mkdir(parents=True, exist_ok=True)
    silent = build / "silent.mp4"
    Scene.prev_last = None
    Scene.stills_dir = build if stills else None
    Scene.sink = None if stills else ffmpeg_sink(silent)
    events, clock, poster = [], 0.0, None
    for fn in SCENES:
        s = fn()
        if poster is None:
            poster = s.last
        Scene.prev_last = s.last
        events += [(clock + t, kind) for t, kind in s.sounds]
        print(f"[{lang}] {s.name}: {s.count / FPS:.1f}s", flush=True)
        clock += s.count / FPS
    if stills:
        return
    Scene.sink.stdin.close()
    if Scene.sink.wait() != 0:
        raise SystemExit("ffmpeg failed")
    Scene.sink = None
    poster.save(OUT / f"bao-rules-{lang}.jpg", quality=85)
    wav = build / "sound.wav"
    mv.write_audio(events, clock, wav)
    final = OUT / f"bao-rules-{lang}.mp4"
    tmp = OUT / f"bao-rules-{lang}.part.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent), "-i", str(wav), "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(tmp)], check=True)
    tmp.rename(final)
    print("wrote", final, f"{clock:.1f}s")


def main():
    stills = "--stills" in sys.argv
    langs = list(TEXT)
    if "--lang" in sys.argv:
        langs = sys.argv[sys.argv.index("--lang") + 1].split(",")
    for lang in langs:
        render_language(lang, stills)


if __name__ == "__main__":
    main()
