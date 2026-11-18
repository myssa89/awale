"""
Renders a short rules explainer, to video/awale-rules.mp4.

    python3 video/make_video.py                 # all languages (en, fr, de, it)
    python3 video/make_video.py --lang fr       # one language
    python3 video/make_video.py --stills        # a few frames as PNG, for checking

Writes video/awale-rules-<lang>.mp4 and a poster video/awale-rules-<lang>.jpg.

Needs: Pillow, numpy, ffmpeg. Fonts: Bricolage Grotesque + Atkinson Hyperlegible
(npm @fontsource packages); set FONT_DIR to their folder.
Game logic comes from python/awale.py, so every move shown follows the real rules.
"""
from __future__ import annotations

import math
import os
import pathlib
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
from awale import State, simulate  # noqa: E402

W, H, FPS = 1920, 1080, 30
OUT = ROOT / "video"
BUILD = pathlib.Path(os.environ.get("BUILD_DIR", "/tmp/awale-video"))
BUILD.mkdir(parents=True, exist_ok=True)
FONT_DIR = pathlib.Path(os.environ.get("FONT_DIR", "/tmp/claude-0/fonts"))

# ---- palette (same tokens as the app, light theme) ----
BG = (231, 234, 242)
INK = (26, 33, 66)
MUTED = (89, 97, 127)
ACCENT = (44, 60, 158)
WOOD, WOOD_HI, WOOD_LO = (139, 74, 40), (169, 95, 55), (92, 45, 22)
HOLLOW = (61, 29, 13)
ON_WOOD = (245, 230, 214)
GO = (47, 158, 106)
NO = (200, 69, 47)
PATH = (243, 226, 179)
CAPTURE = (255, 178, 30)
PANEL = (246, 247, 251)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    files = {
        "display": "fontsource-bricolage-grotesque-5.0.7/files/bricolage-grotesque-latin-800-normal.woff2",
        "display7": "fontsource-bricolage-grotesque-5.0.7/files/bricolage-grotesque-latin-700-normal.woff2",
        "body": "fontsource-atkinson-hyperlegible-5.0.8/files/atkinson-hyperlegible-latin-400-normal.woff2",
        "bold": "fontsource-atkinson-hyperlegible-5.0.8/files/atkinson-hyperlegible-latin-700-normal.woff2",
    }
    return ImageFont.truetype(str(FONT_DIR / files[name]), size)


F_EYEBROW = font("bold", 34)
TITLE_SIZES = (96, 88, 80, 72)
CAPTION_SIZES = (52, 48, 44)
F_COUNT = font("bold", 32)
F_STORE = font("display", 66)
F_LABEL = font("bold", 30)
F_PIT = font("bold", 26)
F_BIG = font("display", 220)
F_BADGE = font("display7", 38)

# ---- on-screen text, per language ----
TEXT = {
    "en": {
        "sub": "The seed game. Learn the rules in about a minute.",
        "board": ("The board", "Two rows, 48 seeds", "The bottom row is yours. The top row is your opponent's. Every pit starts with 4 seeds."),
        "move": ("Rule 1", "Move your seeds", "Pick one of your pits. Take all its seeds and drop them one by one into the next pits, going this way."),
        "capture": ("Rule 2", "Make 2 or 3 to win them", "If your last seed lands on your opponent's side and that pit now has 2 or 3 seeds, you win them."),
        "chain": ("Rule 3", "Then look back", "Check the pit just before. If it is on your opponent's side and has 2 or 3, win those too. Keep going back."),
        "big": ("Rule 4", "Big pits jump over themselves", "With 12 or more seeds you go all the way round. Skip the pit you started from: it stays empty."),
        "feed": ("Rule 5", "Share your seeds", "If your opponent has no seeds left, you must give them some. Moves that can't reach them are not allowed."),
        "slam": ("Rule 6", "Don't take them all", "A move that would take every seed your opponent has wins nothing. The seeds stay where they are."),
        "win": ("Winning", "First to 25 seeds wins", "There are 48 seeds. Win 25 and the game is yours. If you both have 24, it's a draw."),
        "outro": ("Your turn!", "Open the Awale app and try the lessons."),
        "opponent": "OPPONENT", "you": "YOU", "skip": "skip!", "nothing": "wins nothing",
    },
    "fr": {
        "sub": "Le jeu de graines. Apprends les règles en une minute.",
        "board": ("Le plateau", "Deux rangées, 48 graines", "La rangée du bas est à toi. Celle du haut est à ton adversaire. Chaque trou commence avec 4 graines."),
        "move": ("Règle 1", "Déplace tes graines", "Choisis un de tes trous. Prends toutes ses graines et pose-les une par une dans les trous suivants, dans ce sens."),
        "capture": ("Règle 2", "Fais 2 ou 3 pour les gagner", "Si ta dernière graine tombe chez ton adversaire et que ce trou a maintenant 2 ou 3 graines, tu les gagnes."),
        "chain": ("Règle 3", "Puis regarde en arrière", "Regarde le trou juste avant. S'il est chez ton adversaire avec 2 ou 3 graines, gagne-les aussi. Continue en reculant."),
        "big": ("Règle 4", "Les gros trous se sautent", "Avec 12 graines ou plus, tu fais tout le tour. Saute le trou de départ : il reste vide."),
        "feed": ("Règle 5", "Partage tes graines", "Si ton adversaire n'a plus de graines, tu dois lui en donner. Les coups qui ne l'atteignent pas sont interdits."),
        "slam": ("Règle 6", "Ne prends pas tout", "Un coup qui prendrait toutes les graines de ton adversaire ne gagne rien. Les graines restent où elles sont."),
        "win": ("Gagner", "Le premier à 25 gagne", "Il y a 48 graines. Gagnes-en 25 et la partie est à toi. 24 chacun, c'est un match nul."),
        "outro": ("À toi de jouer !", "Ouvre l'app Awale et essaie les leçons."),
        "opponent": "ADVERSAIRE", "you": "TOI", "skip": "saute !", "nothing": "ne gagne rien",
    },
    "de": {
        "sub": "Das Samenspiel. Lerne die Regeln in einer Minute.",
        "board": ("Das Brett", "Zwei Reihen, 48 Samen", "Die untere Reihe gehört dir, die obere deinem Gegner. Jede Mulde beginnt mit 4 Samen."),
        "move": ("Regel 1", "Verteile deine Samen", "Wähl eine deiner Mulden. Nimm alle Samen heraus und leg sie einzeln in die nächsten Mulden, in diese Richtung."),
        "capture": ("Regel 2", "Mach 2 oder 3 und gewinn sie", "Landet dein letzter Samen beim Gegner und hat die Mulde jetzt 2 oder 3 Samen, gewinnst du sie."),
        "chain": ("Regel 3", "Dann schau zurück", "Schau in die Mulde davor. Ist sie beim Gegner und hat 2 oder 3, gewinnst du die auch. Geh so weiter zurück."),
        "big": ("Regel 4", "Große Mulden springen über sich", "Mit 12 oder mehr Samen gehst du einmal rundherum. Überspring die Startmulde: Sie bleibt leer."),
        "feed": ("Regel 5", "Teile deine Samen", "Hat dein Gegner keine Samen mehr, musst du ihm welche geben. Züge, die ihn nicht erreichen, sind verboten."),
        "slam": ("Regel 6", "Nimm nicht alles", "Ein Zug, der dem Gegner alle Samen nehmen würde, gewinnt nichts. Die Samen bleiben liegen."),
        "win": ("Gewinnen", "Wer zuerst 25 hat, gewinnt", "Es gibt 48 Samen. Gewinn 25 und das Spiel gehört dir. 24 zu 24 ist unentschieden."),
        "outro": ("Du bist dran!", "Öffne die Awale-App und probier die Lektionen."),
        "opponent": "GEGNER", "you": "DU", "skip": "überspringen!", "nothing": "gewinnt nichts",
    },
    "it": {
        "sub": "Il gioco dei semi. Impara le regole in un minuto.",
        "board": ("Il tavoliere", "Due file, 48 semi", "La fila in basso è tua. Quella in alto è del tuo avversario. Ogni buca parte con 4 semi."),
        "move": ("Regola 1", "Muovi i tuoi semi", "Scegli una delle tue buche. Prendi tutti i semi e mettili uno alla volta nelle buche successive, in questa direzione."),
        "capture": ("Regola 2", "Fai 2 o 3 e vincili", "Se l'ultimo seme cade dal tuo avversario e quella buca ora ha 2 o 3 semi, li vinci."),
        "chain": ("Regola 3", "Poi guarda indietro", "Guarda la buca appena prima. Se è del tuo avversario e ha 2 o 3 semi, vinci anche quelli. Continua all'indietro."),
        "big": ("Regola 4", "Le buche grandi saltano sé stesse", "Con 12 semi o più fai tutto il giro. Salta la buca di partenza: resta vuota."),
        "feed": ("Regola 5", "Condividi i tuoi semi", "Se il tuo avversario non ha più semi, devi dargliene. Le mosse che non lo raggiungono non sono permesse."),
        "slam": ("Regola 6", "Non prenderli tutti", "Una mossa che prenderebbe tutti i semi del tuo avversario non vince niente. I semi restano dove sono."),
        "win": ("Vincere", "Vince chi arriva a 25", "Ci sono 48 semi. Vincine 25 e la partita è tua. 24 a testa è pareggio."),
        "outro": ("Tocca a te!", "Apri l'app Awale e prova le lezioni."),
        "opponent": "AVVERSARIO", "you": "TU", "skip": "salta!", "nothing": "non vince niente",
    },
}
LANG = "en"


def T(key):
    return TEXT[LANG][key]

# ---- geometry ----
BX0, BX1, BY0, BY1 = 150, 1770, 262, 818          # board
PIT_D = 176
COL0, STEP = 465, 198                                 # first pit centre x, spacing
ROW_N, ROW_S = 432, 652                               # row centre y
STORE_X = {1: 292, 0: 1628}                           # north store left, south store right
STORE_W, STORE_H, STORE_Y = 168, 390, 520
SEED_D = 38
PIT_NAMES = "abcdefABCDEF"


def pit_xy(i: int) -> tuple[float, float]:
    if i < 6:
        return COL0 + STEP * i, ROW_S
    return COL0 + STEP * (11 - i), ROW_N


SPIRAL = []
for k in range(40):
    r = 0 if k == 0 else min(0.17 * math.sqrt(k) * 1.45, 0.47)
    a = k * 2.39996
    SPIRAL.append((r * math.cos(a), r * math.sin(a)))


def seed_offsets(n: int, radius: float) -> list[tuple[float, float]]:
    return [(x * radius * 2, y * radius * 2) for x, y in SPIRAL[:min(n, 24)]]


def store_offsets(n: int) -> list[tuple[float, float]]:
    out = []
    for k in range(min(n, 48)):
        col, row = k % 4, k // 4
        out.append(((col - 1.5) * 34 + (row % 2) * 9, -STORE_H / 2 + 44 + row * 27))
    return out


# ---- sprites (drawn 4x and scaled down for smooth edges) ----
def supersample(size, draw_fn, scale=4):
    big = Image.new("RGBA", (size[0] * scale, size[1] * scale), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(big), scale, big)
    return big.resize(size, Image.LANCZOS)


def make_seed(d=SEED_D):
    def fn(dr, s, img):
        D = d * s
        arr = np.zeros((D, D, 4), np.uint8)
        yy, xx = np.mgrid[0:D, 0:D]
        cx, cy = D * 0.5, D * 0.5
        dist = np.hypot(xx - cx, yy - cy) / (D * 0.5)
        hl = np.hypot(xx - D * 0.35, yy - D * 0.3) / (D * 0.7)
        t = np.clip(hl, 0, 1)[..., None]
        light, dark = np.array([228, 223, 210]), np.array([150, 144, 130])
        col = light * (1 - t) + dark * t
        arr[..., :3] = col.astype(np.uint8)
        arr[..., 3] = np.where(dist <= 1, 255, 0)
        img.paste(Image.fromarray(arr, "RGBA"), (0, 0))
    seed = supersample((d, d), fn)
    shadow = Image.new("RGBA", (d + 12, d + 12), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse((6, 9, d + 6, d + 9), fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(3))
    shadow.alpha_composite(seed, (6, 6))
    return shadow


SEED = make_seed()
SEED_OFF = (SEED.width // 2, SEED.height // 2)


def make_pit(d=PIT_D):
    def fn(dr, s, img):
        D = d * s
        arr = np.zeros((D, D, 4), np.uint8)
        yy, xx = np.mgrid[0:D, 0:D]
        dist = np.hypot(xx - D / 2, yy - D / 2) / (D / 2)
        inner = np.hypot(xx - D / 2, yy - D * 0.42) / (D / 2)
        t = np.clip((inner - 0.55) / 0.5, 0, 1)[..., None]
        col = np.array(HOLLOW) * (1 - t) + (np.array(HOLLOW) * 0.7 + np.array(WOOD) * 0.3) * t
        top_shadow = np.clip(1 - (yy / D) * 3, 0, 1)[..., None] * 0.45
        col = col * (1 - top_shadow)
        arr[..., :3] = col.astype(np.uint8)
        arr[..., 3] = np.where(dist <= 1, 255, 0)
        img.paste(Image.fromarray(arr, "RGBA"), (0, 0))
        dr.ellipse((s, s, D - s, D - s), outline=(255, 255, 255, 40), width=2 * s)
    return supersample((d, d), fn)


def rounded_rect(size, radius, fill, outline=None, width=0):
    def fn(dr, s, img):
        dr.rounded_rectangle((0, 0, size[0] * s - 1, size[1] * s - 1), radius * s, fill=fill,
                             outline=outline, width=width * s)
    return supersample(size, fn)


def ring(d, color, width, alpha=255):
    def fn(dr, s, img):
        dr.ellipse((width * s / 2, width * s / 2, (d - width / 2) * s, (d - width / 2) * s),
                   outline=color + (alpha,), width=width * s)
    return supersample((d, d), fn)


def glow(d, color):
    img = Image.new("RGBA", (d + 80, d + 80), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((40, 40, d + 40, d + 40), outline=color + (200,), width=18)
    return img.filter(ImageFilter.GaussianBlur(14))


def cross(d, color):
    def fn(dr, s, img):
        m, w = d * 0.3 * s, int(d * 0.09 * s)
        dr.line((m, m, d * s - m, d * s - m), fill=color + (235,), width=w)
        dr.line((m, d * s - m, d * s - m, m), fill=color + (235,), width=w)
    return supersample((d, d), fn)


def chevron(direction: str, color=PATH):
    size = 44
    def fn(dr, s, img):
        pts = {"right": [(10, 6), (32, 22), (10, 38)], "left": [(34, 6), (12, 22), (34, 38)],
               "up": [(6, 34), (22, 12), (38, 34)], "down": [(6, 10), (22, 32), (38, 10)]}[direction]
        dr.line([(x * s, y * s) for x, y in pts], fill=color + (255,), width=7 * s, joint="curve")
    return supersample((size, size), fn)


PIT = make_pit()
RINGS = {k: ring(PIT_D + 22, c, 8) for k, c in
         {"go": GO, "no": NO, "path": PATH, "capture": CAPTURE, "accent": ACCENT, "active": PATH}.items()}
GLOWS = {"capture": glow(PIT_D + 22, CAPTURE), "active": glow(PIT_D + 22, PATH), "no": glow(PIT_D + 22, NO)}
CROSS = cross(PIT_D, NO)


def text_img(txt, fnt, color, max_w=None, spacing=12):
    lines = [txt]
    if max_w:
        words, lines, cur = txt.split(), [], ""
        for w_ in words:
            trial = (cur + " " + w_).strip()
            if fnt.getlength(trial) <= max_w:
                cur = trial
            else:
                lines.append(cur); cur = w_
        lines.append(cur)
    asc, desc = fnt.getmetrics()
    lh = asc + desc + spacing
    wid = int(max(fnt.getlength(l) for l in lines)) + 4
    img = Image.new("RGBA", (wid, lh * len(lines)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        d.text((0, i * lh), l, font=fnt, fill=color)
    return img


def pill(txt, fnt, fg, bg, pad=(14, 6)):
    t = text_img(txt, fnt, fg)
    asc, desc = fnt.getmetrics()
    w_, h_ = t.width + pad[0] * 2, asc + desc + pad[1] * 2
    p = rounded_rect((w_, h_), h_ // 2, bg + (255,))
    p.alpha_composite(t, (pad[0], pad[1] - 2))
    return p


# ---- static background ----
def make_background(labels=True):
    img = Image.new("RGBA", (W, H), BG + (255,))
    # board body
    bw, bh = BX1 - BX0, BY1 - BY0
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((BX0 + 6, BY0 + 26, BX1 - 6, BY1 + 26), 120, fill=(26, 33, 66, 70))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(24)))
    grad = np.zeros((bh, bw, 3), np.float32)
    t = np.linspace(0, 1, bh)[:, None]
    top, mid, bot = np.array(WOOD_HI), np.array(WOOD), np.array(WOOD_LO)
    col = np.where(t < 0.45, top * (1 - t / 0.45) + mid * (t / 0.45), mid * (1 - (t - 0.45) / 0.55) + bot * ((t - 0.45) / 0.55))
    grad[:] = col[:, None, :] if col.ndim == 2 else col
    rng = np.random.default_rng(3)
    xs = np.arange(bw)[None, :]
    grain = np.zeros((bh, bw), np.float32)
    for _ in range(26):
        x0, amp, per, ph = rng.uniform(0, bw), rng.uniform(3, 10), rng.uniform(300, 900), rng.uniform(0, 6)
        yy = np.arange(bh)[:, None]
        centre = x0 + amp * np.sin(yy / per * 6.28 + ph) + yy * 0.12
        grain += np.exp(-((xs - centre) ** 2) / rng.uniform(2, 14)) * rng.uniform(0.04, 0.1)
    grad *= (1 - grain[..., None])
    wood = Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    mask = rounded_rect((bw, bh), 120, (255, 255, 255, 255)).split()[3]
    img.paste(wood, (BX0, BY0), mask)
    hl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(hl).rounded_rectangle((BX0, BY0, BX1, BY1), 120, outline=(255, 255, 255, 45), width=3)
    img.alpha_composite(hl)
    # stores
    for p, x in STORE_X.items():
        s = make_store()
        img.alpha_composite(s, (int(x - STORE_W / 2), int(STORE_Y - STORE_H / 2)))
    # pits + names
    for i in range(12):
        x, y = pit_xy(i)
        img.alpha_composite(PIT, (int(x - PIT_D / 2), int(y - PIT_D / 2)))
        n = text_img(PIT_NAMES[i], F_PIT, ON_WOOD + (170,))
        ny = y + PIT_D / 2 - 30 if i >= 6 else y - PIT_D / 2 + 2
        img.alpha_composite(n, (int(x - PIT_D / 2 + 4), int(ny)))
    if labels:
        for p, x in STORE_X.items():
            lab = text_img(T("opponent") if p == 1 else T("you"), F_LABEL, ON_WOOD + (220,))
            img.alpha_composite(lab, (int(x - lab.width / 2), BY0 + 22))
    return img


def make_store():
    def fn(dr, s, img):
        D = (STORE_W * s, STORE_H * s)
        arr = np.zeros((D[1], D[0], 4), np.uint8)
        arr[..., :3] = np.array(HOLLOW, np.uint8)
        yy = np.arange(D[1])[:, None]
        sh = np.clip(1 - yy / (D[1] * 0.25), 0, 1) * 0.45
        arr[..., :3] = (np.array(HOLLOW)[None, None, :] * (1 - sh[..., None])).astype(np.uint8)
        arr[..., 3] = 255
        m = Image.new("L", D, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, D[0] - 1, D[1] - 1), D[0] // 2, fill=255)
        im = Image.fromarray(arr, "RGBA"); im.putalpha(m)
        img.paste(im, (0, 0))
    return supersample((STORE_W, STORE_H), fn, scale=2)


# ---- scene state and frame drawing ----
class Scene:
    def __init__(self, name, eyebrow, title, caption, board, stores, labels=True):
        self.name = name
        self.eyebrow, self.title, self.caption = eyebrow, title, caption
        self.board = list(board)
        self.stores = list(stores)
        self.rings: dict[int, str] = {}
        self.crosses: set[int] = set()
        self.badges: dict[int, tuple[str, tuple]] = {}
        self.chevrons = False
        self.hand: tuple[float, float, int] | None = None   # x, y, seeds in hand
        self.flying: list[tuple[float, float]] = []          # loose seeds in flight
        self.store_hidden = [0, 0]                           # seeds en route, not yet shown
        self.big_text = None
        self.text_alpha = 1.0
        self.frames: list[Image.Image] = []
        self.sounds: list[tuple[float, str]] = []
        self.bg = make_background(labels)
        self.cache = {}

    # -- drawing
    def text_layers(self):
        if "txt" not in self.cache:
            layers = []
            if self.eyebrow:
                layers.append((text_img(self.eyebrow.upper(), F_EYEBROW, MUTED + (255,)), (150, 64)))
            if self.title:
                for size in TITLE_SIZES:  # shrink long titles (German!) to one line
                    ti = text_img(self.title, font("display", size), INK + (255,))
                    if ti.width <= 1620:
                        break
                layers.append((ti, (146, 108 + (96 - size) // 2)))
            if self.caption:
                for size in CAPTION_SIZES:  # biggest size that fits on two lines
                    c = text_img(self.caption, font("body", size), INK + (255,), max_w=1620, spacing=12)
                    if c.height <= 2 * (size * 1.32 + 12) or size == CAPTION_SIZES[-1]:
                        break
                layers.append((c, (150, 852)))
            self.cache["txt"] = layers
        return self.cache["txt"]

    def draw(self) -> Image.Image:
        img = self.bg.copy()
        # rings / glows under seeds
        for i, kind in self.rings.items():
            x, y = pit_xy(i)
            if kind in GLOWS:
                g = GLOWS[kind]
                img.alpha_composite(g, (int(x - g.width / 2), int(y - g.height / 2)))
            r = RINGS[kind]
            img.alpha_composite(r, (int(x - r.width / 2), int(y - r.height / 2)))
        # seeds in pits
        for i in range(12):
            x, y = pit_xy(i)
            for dx, dy in seed_offsets(self.board[i], PIT_D * 0.36):
                img.alpha_composite(SEED, (int(x + dx - SEED_OFF[0]), int(y + dy - SEED_OFF[1])))
        # seeds in stores
        for p, sx in STORE_X.items():
            shown = self.stores[p] - self.store_hidden[p]
            for dx, dy in store_offsets(shown):
                img.alpha_composite(SEED, (int(sx + dx - SEED_OFF[0]), int(STORE_Y + dy - SEED_OFF[1])))
            cnt = text_img(str(shown), F_STORE, ON_WOOD + (255,))
            img.alpha_composite(cnt, (int(sx - cnt.width / 2), int(STORE_Y + STORE_H / 2 + 8)))
        # counts
        for i in range(12):
            x, y = pit_xy(i)
            pl = self.cache.get(("cnt", self.board[i]))
            if pl is None:
                pl = self.cache[("cnt", self.board[i])] = pill(str(self.board[i]), F_COUNT, INK, PANEL, (12, 2))
            cy = y + PIT_D / 2 - pl.height / 2 + 4 if i < 6 else y - PIT_D / 2 - pl.height / 2 - 4
            img.alpha_composite(pl, (int(x - pl.width / 2), int(cy)))
        for i in self.crosses:
            x, y = pit_xy(i)
            img.alpha_composite(CROSS, (int(x - PIT_D / 2), int(y - PIT_D / 2)))
        for i, (txt, colors) in self.badges.items():
            x, y = pit_xy(i)
            key = ("badge", txt, colors)
            b = self.cache.get(key) or self.cache.setdefault(key, pill(txt, F_BADGE, colors[0], colors[1]))
            by = y - PIT_D / 2 - b.height - 18 if i >= 6 else y + PIT_D / 2 + 20
            if i >= 6:
                by = y - PIT_D / 2 - b.height - 34
            img.alpha_composite(b, (int(x - b.width / 2), int(by)))
        if self.chevrons:
            for i in range(5):  # bottom row, to the right
                c = CHEV["right"]; x = COL0 + STEP * i + STEP / 2; img.alpha_composite(c, (int(x - 22), ROW_S - 22))
            for i in range(5):  # top row, to the left
                c = CHEV["left"]; x = COL0 + STEP * i + STEP / 2; img.alpha_composite(c, (int(x - 22), ROW_N - 22))
            img.alpha_composite(CHEV["up"], (COL0 + STEP * 5 - 22 + 0, int((ROW_N + ROW_S) / 2 - 22)))
            img.alpha_composite(CHEV["down"], (COL0 - 22, int((ROW_N + ROW_S) / 2 - 22)))
        # moving seeds
        for fx, fy in self.flying:
            img.alpha_composite(SEED, (int(fx - SEED_OFF[0]), int(fy - SEED_OFF[1])))
        if self.hand:
            hx, hy, n = self.hand
            for dx, dy in seed_offsets(n, 26):
                img.alpha_composite(SEED, (int(hx + dx - SEED_OFF[0]), int(hy + dy - SEED_OFF[1])))
        # text
        layers = self.text_layers()
        if self.text_alpha > 0:
            for t, pos in layers:
                if self.text_alpha < 1:
                    t = t.copy(); t.putalpha(t.split()[3].point(lambda a: int(a * self.text_alpha)))
                img.alpha_composite(t, pos)
        if self.big_text:
            txt, color, alpha = self.big_text
            t = text_img(txt, F_BIG, color + (int(255 * alpha),))
            plate = rounded_rect((t.width + 120, t.height + 40), 60, PANEL + (int(235 * alpha),))
            px, py = (W - plate.width) // 2, (BY0 + BY1) // 2 - plate.height // 2
            img.alpha_composite(plate, (px, py))
            img.alpha_composite(t, (px + 60, py + 2))
        return img.convert("RGB")

    # -- timeline helpers
    def frame(self):
        self.frames.append(self.draw())

    @property
    def t(self):
        return len(self.frames) / FPS

    def hold(self, sec):
        for _ in range(int(round(sec * FPS))):
            self.frame()

    def sound(self, kind):
        self.sounds.append((self.t, kind))

    def fade_text(self, to, sec=0.4):
        start = self.text_alpha
        n = int(sec * FPS)
        for k in range(1, n + 1):
            self.text_alpha = start + (to - start) * k / n
            self.frame()

    def sow(self, pit, step=0.32, lift=0.35):
        """Animate one move with the real rules; returns the simulate() result."""
        st = State(self.board[:], self.stores[:], 0 if pit < 6 else 1)
        sim = simulate(st, pit)
        n = self.board[pit]
        x, y = pit_xy(pit)
        self.rings[pit] = "go"
        self.hold(0.25)
        # scoop
        self.board[pit] = 0
        frames = int(lift * FPS)
        for k in range(1, frames + 1):
            self.hand = (x, y - 70 * ease(k / frames), n)
            self.frame()
        prev = (x, y - 70)
        left = n
        for target in sim["sown"]:
            tx, ty = pit_xy(target)
            frames = max(2, int(step * FPS))
            for k in range(1, frames + 1):
                u = ease(k / frames)
                hx = prev[0] + (tx - prev[0]) * u
                hy = prev[1] + (ty - 70 - prev[1]) * u - 26 * math.sin(math.pi * u)
                self.hand = (hx, hy, left)
                self.frame()
            self.board[target] += 1
            left -= 1
            self.rings[target] = "active"
            self.sound("drop")
            prev = (tx, ty - 70)
            self.hand = (tx, ty - 70, left) if left else None
            self.frame()
            if self.rings.get(target) == "active":
                self.rings[target] = "path"
        self.hand = None
        self.rings.pop(pit, None)
        self.rings[sim["last"]] = "active"
        return sim

    def capture(self, pits_seeds, player, one_by_one=True):
        """Flash and fly captured seeds into `player`'s store."""
        for p, _ in pits_seeds:
            self.rings[p] = "capture"
            self.badges[p] = (f"+{self.board[p]}", (INK, CAPTURE))
            self.sound("ding")
            self.hold(0.5 if one_by_one else 0.1)
        self.hold(0.5)
        flights = []
        total = 0
        sx, sy = STORE_X[player], STORE_Y
        for p, _ in pits_seeds:
            x, y = pit_xy(p)
            for k, (dx, dy) in enumerate(seed_offsets(self.board[p], PIT_D * 0.36)):
                dest = store_offsets(self.stores[player] + total + 1)[-1]
                flights.append(((x + dx, y + dy), (sx + dest[0], sy + dest[1]), k * 0.05))
                total += 1
            self.board[p] = 0
            self.badges.pop(p, None)
        self.stores[player] += total
        self.store_hidden[player] = total
        dur = 0.75
        frames = int((dur + 0.05 * 3) * FPS)
        landed = 0
        self.sound("whoosh")
        for f in range(1, frames + 1):
            tt = f / FPS
            self.flying = []
            arrived = 0
            for (a, b, delay) in flights:
                u = min(1, max(0, (tt - delay) / dur))
                if u >= 1:
                    arrived += 1
                    continue
                e = ease(u)
                self.flying.append((a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e - 140 * math.sin(math.pi * e)))
            self.store_hidden[player] = total - arrived
            self.frame()
        self.flying = []
        self.store_hidden[player] = 0
        for p, _ in pits_seeds:
            self.rings.pop(p, None)


def captured_pits(before, sim, player):
    """Pits emptied by the capture, from the last seed backwards."""
    opp = range(6, 12) if player == 0 else range(0, 6)
    pits = [p for p in opp if sim["after"].board[p] == 0 and (before[p] > 0 or p in sim["sown"])]
    pits.sort(key=lambda p: (sim["last"] - p) % 12)
    return [(p, 0) for p in pits]


def ease(u):
    return 0.5 - 0.5 * math.cos(math.pi * min(1, max(0, u)))


CHEV = {d: chevron(d) for d in ("left", "right", "up", "down")}


# ---- the script ----
START = [4] * 12


def scene_title():
    s = Scene("01-title", None, None, None, START, [0, 0], labels=False)
    s.text_alpha = 1
    title = text_img("Awale", font("display", 200), INK + (255,))
    sub = text_img(T("sub"), font("body", 56), MUTED + (255,))
    base = s.bg
    s.bg = base.copy()
    s.bg.alpha_composite(title, ((W - title.width) // 2, 30))
    s.bg.alpha_composite(sub, ((W - sub.width) // 2, 870))
    s.hold(3.5)
    return s


def scene_board():
    s = Scene("02-board", *T("board"), START, [0, 0])
    s.hold(1.2)
    for i in range(6):
        s.rings[i] = "accent"
    s.sound("drop"); s.hold(1.6)
    s.rings = {i: "path" for i in range(6, 12)}
    s.sound("drop"); s.hold(1.6)
    s.rings = {}
    s.badges = {}
    s.hold(1.6)
    s.fade_text(0)
    return s


def scene_move():
    s = Scene("03-move", *T("move"),
              START, [0, 0])
    s.text_alpha = 0
    s.fade_text(1)
    s.chevrons = True
    s.hold(2.2)
    s.sow(2, step=0.42)
    s.hold(2.0)
    s.fade_text(0)
    return s


def scene_capture():
    board = [3, 0, 2, 1, 0, 2, 4, 1, 3, 2, 0, 5]
    s = Scene("04-capture", *T("capture"),
              board, [13, 12])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.6)
    before = s.board[:]
    sim = s.sow(5, step=0.45)
    s.hold(0.5)
    s.capture(captured_pits(before, sim, 0), 0)
    s.rings = {}
    s.hold(1.6)
    s.fade_text(0)
    return s


def scene_chain():
    board = [1, 2, 0, 3, 4, 1, 2, 1, 2, 4, 1, 6]
    s = Scene("05-chain", *T("chain"),
              board, [11, 10])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.6)
    before = s.board[:]
    sim = s.sow(4, step=0.4)
    s.hold(0.4)
    s.capture(captured_pits(before, sim, 0), 0)
    s.rings = {}
    s.hold(1.4)
    s.fade_text(0)
    return s


def scene_big():
    board = [17, 1, 0, 2, 0, 0, 1, 3, 0, 2, 4, 1]
    s = Scene("06-big", *T("big"),
              board, [9, 8])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.5)
    # play pit a, flagging the skip on the second lap
    st = State(s.board[:], s.stores[:], 0)
    sim = simulate(st, 0)
    n = s.board[0]
    x, y = pit_xy(0)
    s.rings[0] = "go"; s.hold(0.25)
    s.board[0] = 0
    for k in range(1, 9):
        s.hand = (x, y - 70 * ease(k / 8), n); s.frame()
    prev, left = (x, y - 70), n
    for idx, target in enumerate(sim["sown"]):
        if idx == 11:  # passing over pit a
            s.rings[0] = "no"; s.badges[0] = (T("skip"), ((255, 255, 255), NO))
            ax, ay = pit_xy(0)
            for k in range(1, 9):
                u = ease(k / 8)
                s.hand = (prev[0] + (ax - prev[0]) * u, prev[1] + (ay - 110 - prev[1]) * u, left); s.frame()
            prev = (ax, ay - 110)
            s.hold(0.7)
        tx, ty = pit_xy(target)
        frames = 6
        for k in range(1, frames + 1):
            u = ease(k / frames)
            s.hand = (prev[0] + (tx - prev[0]) * u, prev[1] + (ty - 70 - prev[1]) * u - 20 * math.sin(math.pi * u), left)
            s.frame()
        s.board[target] += 1; left -= 1; s.sound("drop")
        if idx == 12:
            s.rings.pop(0, None); s.badges.pop(0, None)
        prev = (tx, ty - 70)
        s.hand = (tx, ty - 70, left) if left else None
        s.frame()
    s.hand = None
    s.rings[sim["last"]] = "active"
    s.hold(0.4)
    s.capture(captured_pits(board, sim, 0), 0)
    s.rings = {}
    s.hold(1.4)
    s.fade_text(0)
    return s


def scene_feed():
    board = [6, 3, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0]
    s = Scene("07-feed", *T("feed"),
              board, [18, 18])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.5)
    s.rings = {1: "no", 3: "no"}; s.crosses = {1, 3}; s.sound("buzz"); s.hold(1.6)
    s.rings.update({0: "go", 4: "go"}); s.hold(1.6)
    s.rings = {}; s.crosses = set()
    s.sow(4, step=0.45)
    s.hold(1.6)
    s.fade_text(0)
    return s


def scene_slam():
    board = [2, 0, 1, 0, 2, 2, 1, 1, 0, 0, 0, 0]
    s = Scene("08-slam", *T("slam"),
              board, [20, 19])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.5)
    sim = s.sow(5, step=0.45)
    assert sim["grand_slam"]
    s.hold(0.3)
    for p in (7, 6):
        s.rings[p] = "no"
    s.badges[7] = (T("nothing"), ((255, 255, 255), NO))
    s.sound("buzz")
    s.hold(2.8)
    s.fade_text(0)
    return s


def scene_win():
    board = [0, 0, 1, 0, 1, 3, 2, 0, 1, 2, 1, 1]
    s = Scene("09-win", *T("win"),
              board, [23, 13])
    s.text_alpha = 0
    s.fade_text(1)
    s.hold(1.4)
    before = s.board[:]
    sim = s.sow(5, step=0.42)
    s.hold(0.3)
    s.capture(captured_pits(before, sim, 0), 0)
    s.rings = {}
    s.sound("win")
    for k in range(1, 10):
        s.big_text = ("25!", ACCENT, k / 9); s.frame()
    s.hold(1.8)
    s.fade_text(0)
    return s


def scene_outro():
    s = Scene("10-outro", None, None, None, START, [0, 0], labels=False)
    t1 = text_img(T("outro")[0], font("display", 160), INK + (255,))
    t2 = text_img(T("outro")[1], font("body", 56), MUTED + (255,))
    s.bg = s.bg.copy()
    s.bg.alpha_composite(t1, ((W - t1.width) // 2, 40))
    s.bg.alpha_composite(t2, ((W - t2.width) // 2, 880))
    s.hold(3.5)
    return s


SCENES = [scene_title, scene_board, scene_move, scene_capture, scene_chain, scene_big,
          scene_feed, scene_slam, scene_win, scene_outro]
XFADE = 12  # frames of crossfade at the start of each scene


# ---- sound: little wooden clicks, synthesized ----
SR = 44100


def synth(kind):
    t = np.linspace(0, 1, SR)
    if kind == "drop":
        d = 0.09; n = int(SR * d); tt = t[:n]
        s = np.sin(2 * np.pi * 820 * tt) * np.exp(-tt * 55) + 0.5 * np.sin(2 * np.pi * 1640 * tt) * np.exp(-tt * 80)
        return 0.35 * s
    if kind == "ding":
        d = 0.5; n = int(SR * d); tt = t[:n]
        return 0.25 * (np.sin(2 * np.pi * 1046 * tt) + 0.4 * np.sin(2 * np.pi * 1568 * tt)) * np.exp(-tt * 7)
    if kind == "whoosh":
        d = 0.6; n = int(SR * d); tt = t[:n]
        noise = np.random.default_rng(1).normal(0, 1, n)
        env = np.sin(np.pi * tt / d) ** 2
        k = np.ones(40) / 40
        return 0.12 * np.convolve(noise, k, "same") * env
    if kind == "buzz":
        d = 0.35; n = int(SR * d); tt = t[:n]
        return 0.18 * np.sign(np.sin(2 * np.pi * 150 * tt)) * np.exp(-tt * 6) * (tt < d)
    if kind == "win":
        out = np.zeros(int(SR * 1.2))
        for i, f in enumerate([523, 659, 784, 1046]):
            n0 = int(SR * 0.12 * i); n = int(SR * 0.6); tt = np.arange(n) / SR
            seg = 0.2 * np.sin(2 * np.pi * f * tt) * np.exp(-tt * 4)
            out[n0:n0 + n] += seg[: len(out) - n0]
        return out
    return np.zeros(1)


def write_audio(events, total_sec, path):
    buf = np.zeros(int(SR * (total_sec + 1)))
    for at, kind in events:
        s = synth(kind)
        i = int(at * SR)
        buf[i:i + len(s)] += s[: max(0, len(buf) - i)]
    buf = np.clip(buf, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((buf * 32767).astype(np.int16).tobytes())


def encode(frames, path):
    tmp = path.with_name(path.stem + ".part.mp4")
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                          "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "18",
                          "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", str(FPS), str(tmp)],
                         stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit("ffmpeg failed on " + path.name)
    tmp.rename(path)


def render_language(lang, stills=False):
    global LANG
    LANG = lang
    build = BUILD / lang
    build.mkdir(parents=True, exist_ok=True)
    files, events, clock, prev_last = [], [], 0.0, None
    poster = None
    for fn in SCENES:
        s = fn()
        frames = s.frames
        if prev_last is not None:
            for k in range(min(XFADE, len(frames))):
                a = (k + 1) / (XFADE + 1)
                frames[k] = Image.blend(prev_last, frames[k], a)
        if poster is None:
            poster = frames[-1]
        prev_last = frames[-1]
        events += [(clock + t, kind) for t, kind in s.sounds]
        print(f"[{lang}] {s.name}: {len(frames) / FPS:.1f}s", flush=True)
        if stills:
            for q in (0.35, 0.7, 0.95):
                frames[int(len(frames) * q) - 1].save(build / f"{s.name}-{int(q * 100)}.png")
        else:
            path = build / f"{s.name}.mp4"
            encode(frames, path)
            files.append(path)
        clock += len(frames) / FPS
        s.frames = []
    if stills:
        return
    poster.save(OUT / f"awale-rules-{lang}.jpg", quality=85)
    lst = build / "list.txt"
    lst.write_text("".join(f"file '{f}'\n" for f in files))
    silent = build / "silent.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(silent)], check=True)
    wav = build / "sound.wav"
    write_audio(events, clock, wav)
    final = OUT / f"awale-rules-{lang}.mp4"
    tmp = OUT / f"awale-rules-{lang}.part.mp4"
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
