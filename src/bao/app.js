/*
 * Bao UI. Same shell as the Awale page (players, languages, tabs, video, warnings, games),
 * with a 4 x 8 board: tap one of your pits, then an arrow for the direction.
 * Players, settings and recorded games are shared with Awale through localStorage.
 */
(function () {
  'use strict';
  const B = Bao.Engine;
  const A = Bao.Advisor;
  const LESSONS = Bao.LESSONS;
  const PUZZLES = Bao.PUZZLES || [];
  const I18n = Awale.I18n;
  const t = I18n.t;
  const PREMIUM = !!(Awale.CONFIG && Awale.CONFIG.premium);
  const $ = (id) => document.getElementById(id);
  const GAME = 'bao';

  // ---------- settings, players, games (shared with Awale) ----------
  const defaults = { level: 'easy', adaptive: true, coach: true, ratings: false, speed: '220', first: '0', me: null, opponent: null, lang: null };
  let settings = Object.assign({}, defaults);
  try { Object.assign(settings, JSON.parse(localStorage.getItem('awale.settings') || '{}')); } catch (e) { /* storage unavailable */ }
  if (!A.LEVELS[settings.level]) settings.level = 'easy';
  function saveSettings() { try { localStorage.setItem('awale.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
  function cleanName(raw) { return String(raw || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14); }
  function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  let players = loadJSON('awale.players', []);
  if (!Array.isArray(players)) players = [];
  players = players.map(cleanName).filter(Boolean);
  let games = loadJSON('awale.games', []);
  if (!Array.isArray(games)) games = [];
  function savePlayers() { saveJSON('awale.players', players); }
  function addPlayer(name) {
    const n = cleanName(name);
    if (!n) return null;
    const existing = players.find((x) => x.toLowerCase() === n.toLowerCase());
    if (existing) return existing;
    players.push(n); savePlayers();
    return n;
  }
  if (!players.includes(settings.me)) settings.me = null;
  if (!players.includes(settings.opponent) || settings.opponent === settings.me) settings.opponent = null;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- state ----------
  const G = {
    mode: 'learn', lesson: 0, lessonsDone: new Set(), state: null, result: null,
    undo: [], log: [], busy: false, pending: null, selected: null, dir: null, hoverPit: null,
    lessonOutcome: null, rec: null, display: null, anim: null, coachNote: null, afterNote: null, hint: null,
  };
  const PZ = { index: 0, outcome: null, tries: 0, hints: 0, shown: false };
  let token = 0;

  function isPractice() { return G.mode === 'learn' || G.mode === 'puzzle'; }
  function playerName(p) {
    if (p === 0) return settings.me || t('name.you');
    if (G.mode === 'cpu') return t('name.computer');
    return settings.opponent || t('name.player2');
  }
  function sideName(p) {
    if (isPractice()) return p === 0 ? t('name.you') : t('name.opponent');
    return playerName(p);
  }
  function oppWords(p) {
    if (G.mode === 'cpu') return p === 0 ? t('opp.cpu') : t('name.you');
    if (G.mode === 'duo') return playerName(1 - p);
    return t('opp.other');
  }
  function seedsWord(n) { return t(n === 1 ? 'seed1' : 'seedN', { n }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- board DOM ----------
  const pitEls = [[], []];
  const AT = {}; // "row,col" -> { p, k }
  for (const p of [0, 1]) for (let k = 0; k < B.N; k++) { const sp = B.screenPos(p, k); AT[sp.row + ',' + sp.col] = { p, k }; }

  function buildBoard() {
    const rows = $('bao-rows');
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 8; col++) {
        const { p, k } = AT[row + ',' + col];
        const b = document.createElement('button');
        b.className = 'pit bpit' + (B.isInner(k) ? ' front' : '') + (B.isInner(k) && (k === 0 || k === 7) ? ' kichwa' : '');
        b.dataset.p = p; b.dataset.k = k;
        b.style.gridRow = String(row + 1 + (row >= 2 ? 1 : 0));
        b.style.gridColumn = String(col + 1);
        b.innerHTML = '<div class="seeds"></div><span class="count">0</span>';
        b.addEventListener('mouseenter', () => { G.hoverPit = { p, k }; renderCoach(); });
        b.addEventListener('mouseleave', () => { G.hoverPit = null; renderCoach(); });
        b.addEventListener('click', () => onPitClick(p, k));
        pitEls[p][k] = b;
        rows.appendChild(b);
      }
    }
    const mid = document.createElement('div');
    mid.className = 'bao-mid';
    mid.style.gridRow = '2 / 5';
    mid.style.gridColumn = '1 / -1';
    rows.appendChild(mid);
  }

  const SEED_POS = [];
  for (let k = 0; k < 30; k++) {
    const r = k === 0 ? 0 : 0.17 * Math.sqrt(k) * 1.45;
    const a = k * 2.39996;
    SEED_POS.push([50 + Math.min(r, 0.47) * 100 * Math.cos(a), 50 + Math.min(r, 0.47) * 100 * Math.sin(a)]);
  }
  function seedHtml(n) {
    let h = '';
    for (let k = 0; k < Math.min(n, 20); k++) {
      const [x, y] = SEED_POS[k];
      h += '<i class="seed" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%"></i>';
    }
    return h;
  }

  // Screen direction of the first step of a move, for arrows and words.
  function arrowFor(p, k, dir) {
    const a = B.screenPos(p, k), b = B.screenPos(p, ((k + dir) % B.N + B.N) % B.N);
    if (b.col > a.col) return 'right';
    if (b.col < a.col) return 'left';
    return b.row < a.row ? 'up' : 'down';
  }
  const ARROWS = { right: '→', left: '←', up: '↑', down: '↓' };
  let arrowSig = '';

  // ---------- rendering ----------
  function isHumanTurn() {
    if (!G.state || G.result || G.busy) return false;
    if (G.mode === 'cpu') return G.state.toMove === 0;
    if (G.mode === 'learn') return G.state.toMove === 0 && !G.lessonOutcome;
    if (G.mode === 'puzzle') return G.state.toMove === 0 && !PZ.outcome;
    return true;
  }
  function legal() { return G.state ? B.legalMoves(G.state) : []; }

  function previewResult() {
    if (G.selected == null || G.dir == null || !isHumanTurn()) return null;
    return B.play(G.state, { pit: G.selected, dir: G.dir });
  }

  function render() {
    const s = G.state;
    const pits = G.display || s.pits;
    const human = isHumanTurn();
    const moves = human ? legal() : [];
    const legalPits = new Set(moves.map((m) => m.pit));
    const mover = s.toMove;
    const colors = settings.ratings && human && !G.pending && !isPractice() ? A.moveColors(s) : null;
    const pre = previewResult();
    const prePath = new Set(), preCap = {};
    if (pre && G.mode !== 'puzzle') {
      for (const e of pre.events) {
        if (e.t === 'drop') prePath.add(e.k);
        if (e.t === 'capture') preCap[e.from] = (preCap[e.from] || 0) + e.n;
      }
    } else if (pre) {
      for (const e of pre.events) { if (e.t === 'drop') prePath.add(e.k); if (e.t !== 'drop' && e.t !== 'pick') break; }
    }
    const firstEnd = pre ? pre.events.find((e) => e.t === 'pick' && pre.events.indexOf(e) > 0 || e.t === 'capture' || e.t === 'end') : null;

    for (const p of [0, 1]) {
      for (let k = 0; k < B.N; k++) {
        const el = pitEls[p][k];
        const n = pits[p][k];
        if (el.dataset.n !== String(n)) { el.querySelector('.seeds').innerHTML = seedHtml(n); el.dataset.n = n; }
        el.querySelector('.count').textContent = n;
        const mine = p === mover && human;
        el.className = 'pit bpit' + (B.isInner(k) ? ' front' : '') + (B.isInner(k) && (k === 0 || k === 7) ? ' kichwa' : '');
        if (mine && (legalPits.has(k) || n > 0)) el.classList.add(legalPits.has(k) ? 'legal' : 'illegal', 'mine');
        if (G.selected === k && p === mover && human) el.classList.add('selected');
        for (const x of el.querySelectorAll('.cap, .rating')) x.remove();
        if (colors && p === mover && colors[k]) {
          const r = document.createElement('span'); r.className = 'rating ' + colors[k]; el.appendChild(r);
        }
        if (pre && p === mover && prePath.has(k)) el.classList.add('path');
        if (pre && p !== mover && preCap[k]) { el.classList.add('capture'); addBadge(el, '+' + preCap[k], 'cap'); }
        el.setAttribute('aria-label', t('aria.pit', { p: '', n: seedsWord(n) }).replace(/\s+,/, ','));
      }
    }
    if (pre && firstEnd && firstEnd.k != null && firstEnd.t === 'end') pitEls[mover][firstEnd.k].classList.add('last');

    // Direction arrows on the selected pit. Kept in place while hovering, so a click is never lost.
    const sig = G.selected != null && human ? mover + ':' + G.selected + ':' + moves.filter((x) => x.pit === G.selected).map((m) => m.dir).join(',') : '';
    if (sig !== arrowSig) {
      for (const x of document.querySelectorAll('.bpit .arrow')) x.remove();
      arrowSig = sig;
      if (sig) {
        const el = pitEls[mover][G.selected];
        const pit = G.selected;
        for (const m of moves.filter((x) => x.pit === pit)) {
          const dirName = arrowFor(mover, pit, m.dir);
          const a = document.createElement('span');
          a.className = 'arrow a-' + dirName;
          a.dataset.dir = m.dir;
          a.textContent = ARROWS[dirName];
          a.setAttribute('role', 'button');
          a.setAttribute('aria-label', t('bao.dir.' + dirName));
          a.addEventListener('mouseenter', () => { if (G.dir !== m.dir) { G.dir = m.dir; render(); } });
          a.addEventListener('click', (ev) => { ev.stopPropagation(); if (isHumanTurn() && !G.pending) play({ pit, dir: m.dir }, false); });
          el.appendChild(a);
        }
      }
    }
    for (const a of document.querySelectorAll('.bpit .arrow')) a.classList.toggle('on', +a.dataset.dir === G.dir);
    // Hint / warning marks.
    if (G.hint && human) {
      pitEls[mover][G.hint.pit].classList.add('hint');
    }
    if (G.pending) {
      const tr = G.pending.trap;
      pitEls[mover][G.pending.move.pit].classList.add('warn-pit');
      pitEls[mover][tr.better.pit].classList.add('better-pit');
      addBadge(pitEls[mover][tr.better.pit], ARROWS[arrowFor(mover, tr.better.pit, tr.better.dir)] + ' ' + t('badge.try'), 'cap go');
      addBadge(pitEls[mover][G.pending.move.pit], t('badge.yourPick'), 'cap no');
    }
    if (G.anim) {
      const a = G.anim;
      if (a.src != null) pitEls[a.p][a.src].classList.add('source');
      if (a.cur != null) pitEls[a.p][a.cur].classList.add('active');
      if (a.flash != null) pitEls[1 - a.p][a.flash].classList.add('flash', 'capture');
      for (const k of a.visited) pitEls[a.p][k].classList.add('path');
    }

    for (const p of [0, 1]) {
      const el = $('store-' + p);
      el.querySelector('.store-count').textContent = pits[p].reduce((x, y) => x + y, 0);
      $('label-' + p).textContent = sideName(p);
    }
    renderStatus(); renderCoach(); renderActions(); renderEnd(); renderAlert();
  }

  function addBadge(el, text, cls) {
    const b = document.createElement('span'); b.className = cls; b.textContent = text; el.appendChild(b);
  }

  function renderStatus() {
    const s = G.state, el = $('status');
    if (G.mode === 'learn' && G.lessonOutcome) {
      const ok = G.lessonOutcome.ok, last = G.lesson === LESSONS.length - 1;
      el.innerHTML = '<span class="chip ' + (ok ? 'done' : 'retry') + '">' + (ok ? '✓' : '↺') + '</span><span>' +
        t(ok ? 'status.lessonOk' : 'status.lessonRetry') + '</span>' +
        '<button class="btn ' + (ok ? '' : 'primary') + ' status-btn" id="status-retry">↺ ' + t('lesson.again') + '</button>' +
        '<button class="btn ' + (ok ? 'primary' : '') + ' status-btn" id="status-next">' + t(last ? 'lesson.last' : 'lesson.next') + ' →</button>';
      $('status-next').onclick = () => $('lesson-next').click();
      $('status-retry').onclick = () => loadLesson(G.lesson);
      return;
    }
    if (G.mode === 'puzzle' && PZ.outcome) {
      const o = PZ.outcome;
      el.innerHTML = (o.ok ? '<span class="chip done">✓</span><span>' + t('puzzle.solved') + '</span>' + (o.shown ? '' : starsHtml(o.stars))
        : '<span class="chip retry">↺</span><span>' + t('status.lessonRetry') + '</span>') +
        '<button class="btn ' + (o.ok ? '' : 'primary') + ' status-btn" id="pz-retry">↺ ' + t('lesson.again') + '</button>' +
        (o.ok ? '' : '<button class="btn status-btn" id="pz-show">' + t('puzzle.show') + '</button>') +
        '<button class="btn ' + (o.ok ? 'primary' : '') + ' status-btn" id="pz-next">' + t('puzzle.next') + ' →</button>';
      $('pz-retry').onclick = () => loadPuzzle(PZ.index, !o.ok);
      $('pz-next').onclick = () => loadPuzzle(nextPuzzleIndex());
      if ($('pz-show')) $('pz-show').onclick = showAnswer;
      return;
    }
    if (G.result) { el.innerHTML = '<span>' + t('status.over') + '</span>'; return; }
    const p = s.toMove;
    const chip = '<span class="chip name' + (p === 1 ? ' north' : '') + '">' + sideName(p) + '</span>';
    if (G.mode === 'cpu' && p === 1) { el.innerHTML = chip + '<span class="thinking">' + t('status.thinking') + '</span>'; return; }
    if (G.busy) { el.innerHTML = chip + '<span>' + t('status.sowing') + '</span>'; return; }
    el.innerHTML = chip + '<span>' + (G.mode === 'duo' ? t('status.duoTurn') : t('status.yourTurn')) + '</span>';
  }

  /** Plain-language description of a move from its events. */
  function describe(r, move, p) {
    const out = [];
    const first = r.events[0];
    out.push(t('bao.d.first', { n: seedsWord(first.n), dir: t('bao.dir.' + arrowFor(p, move.pit, move.dir)) }));
    if (first.n >= 16) out.push(t('bao.d.big'));
    const relays = r.events.filter((e, i) => e.t === 'pick' && i > 0).length;
    if (relays === 1) out.push(t('bao.d.relay1'));
    else if (relays > 1) out.push(t('bao.d.relayN', { k: relays }));
    if (r.captures === 1) out.push(t('bao.d.capture1', { n: seedsWord(r.captured) }));
    else if (r.captures > 1) out.push(t('bao.d.captureN', { n: seedsWord(r.captured), k: r.captures }));
    else out.push(t('bao.d.noCapture'));
    const end = B.checkEnd(r.state);
    if (end && end.winner === p) out.push(t('bao.d.wins'));
    return out;
  }

  const REASON = { 'not-your-side': 'bao.r.notYours', 'too-few': 'bao.r.tooFew', 'must-capture': 'bao.r.mustCapture', 'inner-first': 'bao.r.innerFirst' };

  function renderCoach() {
    const body = $('coach-body');
    const s = G.state;
    if (!s) return;
    if (G.pending) { body.innerHTML = ''; return; }
    if (G.result) { body.innerHTML = '<p>' + endSummary() + '</p>'; return; }
    const human = isHumanTurn();
    if (human && G.selected != null && G.dir != null) {
      const r = previewResult();
      let lines = describe(r, { pit: G.selected, dir: G.dir }, s.toMove);
      if (G.mode === 'puzzle') lines = lines.slice(0, 1);
      let tag = '';
      if (G.mode !== 'puzzle' && !(G.mode === 'learn' && G.lesson < 2)) {
        const look = A.looksAt(s).find((l) => l.pit === G.selected && l.dir === G.dir);
        if (look && look.risk >= 3) tag = '<p><span class="tag mistake">' + t('tag.careful') + '</span> ' +
          (look.risk >= 64 ? t('bao.t.dangerLose', { opp: oppWords(s.toMove) }) : t('preview.careful', { opp: oppWords(s.toMove), n: seedsWord(look.risk) })) + '</p>';
        else if (look) tag = '<p><span class="tag best">' + t('tag.safe') + '</span> ' + t('preview.safe', { opp: oppWords(s.toMove) }) + '</p>';
      }
      body.innerHTML = lines.map((l, k) => '<p' + (k === 0 ? ' class="lead"' : '') + '>' + l + '</p>').join('') + tag;
      return;
    }
    if (human && G.hoverPit && G.selected == null) {
      const st = G.hoverPit.p === s.toMove ? B.pitStatus(s, s.toMove, G.hoverPit.k) : 'not-your-side';
      if (st !== 'ok') { body.innerHTML = '<p class="lead">' + t('notAllowed') + '</p><p>' + t(REASON[st]) + '</p>'; return; }
    }
    if (G.coachNote) { body.innerHTML = typeof G.coachNote === 'function' ? G.coachNote() : G.coachNote; return; }
    if (human) {
      const ms = legal();
      body.innerHTML = '<p>' + (G.selected != null ? t('bao.pickDir') : t('bao.idle')) + '</p>' +
        (ms.length && ms[0].capture && G.selected == null ? '<p>' + t('bao.idleMust') + '</p>' : '');
    } else if (G.mode === 'cpu') body.innerHTML = '<p>' + t('cpu.choosing') + '</p>';
    else body.innerHTML = '';
  }

  function renderActions() {
    $('btn-undo').disabled = G.busy || G.undo.length === 0 || isPractice();
    $('btn-hint').disabled = !isHumanTurn();
    $('btn-undo').hidden = isPractice();
    $('btn-new').hidden = isPractice();
    $('btn-split').hidden = true;
  }

  function endSummary() {
    const r = G.result;
    if (!r) return '';
    const loser = sideName(1 - r.winner);
    return r.reason === 'inner-empty' ? t('bao.end.inner', { name: loser }) : t('bao.end.noMoves', { name: loser });
  }

  function renderEnd() {
    const r = G.result, card = $('endcard');
    if (!r || isPractice()) { card.hidden = true; return; }
    card.hidden = false;
    $('end-title').textContent = G.mode === 'cpu' ? (r.winner === 0 ? t('end.youWin') : t('end.cpuWins')) : t('end.wins', { name: playerName(r.winner) });
    $('end-reason').textContent = endSummary();
    const s = G.state;
    $('end-score').textContent = sideName(0) + ' ' + B.sideSum(s, 0) + ' – ' + B.sideSum(s, 1) + ' ' + sideName(1);
  }

  // ---------- warnings ----------
  let alertShownFor = null;
  function renderAlert() {
    const el = $('alert');
    if (G.pending) {
      const tr = G.pending.trap;
      const opp = oppWords(G.state.toMove);
      const lines = [];
      let title;
      if (tr.kind === 'danger') {
        title = t('trap.dangerTitle');
        lines.push(tr.mine.risk >= 64 ? t('bao.t.dangerLose', { opp }) : t('bao.t.danger', { opp, n: tr.mine.risk }));
      } else {
        title = t('trap.missedTitle');
        lines.push(tr.better.take >= 64 ? t('bao.t.missedWin') : t('bao.t.missed', { n: tr.better.take }));
      }
      lines.push(tr.better.take && tr.better.take < 64 ? t('bao.t.tryWin', { n: seedsWord(tr.better.take) }) : t('bao.t.trySafe'));
      el.className = 'alert ' + (tr.kind === 'missed' ? 'tip' : 'stop');
      el.innerHTML = '<div class="alert-icon" aria-hidden="true">' + (tr.kind === 'missed' ? '+' : '!') + '</div><div class="alert-main">' +
        '<p class="alert-title">' + title + '</p>' + lines.map((l) => '<p class="alert-cost">' + l + '</p>').join('') +
        '<div class="btnrow"><button class="btn primary" id="a-best">' + t('bao.a.instead') + '</button>' +
        '<button class="btn" id="a-back">' + t('alert.again') + '</button>' +
        '<button class="btn subtle" id="a-anyway">' + t('bao.a.anyway') + '</button></div></div>';
      el.hidden = false;
      $('a-best').onclick = () => { const b = tr.better; G.pending = null; play({ pit: b.pit, dir: b.dir }, true); };
      $('a-back').onclick = () => { G.pending = null; G.selected = null; G.dir = null; render(); };
      $('a-anyway').onclick = () => { const m = G.pending.move; G.pending = null; play(m, true); };
      if (alertShownFor !== G.pending) {
        alertShownFor = G.pending;
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
      }
      return;
    }
    alertShownFor = null;
    if (G.afterNote && !G.result) {
      el.className = 'alert soft';
      el.innerHTML = '<div class="alert-icon" aria-hidden="true">?</div><div class="alert-main">' + G.afterNote() + '</div>';
      el.hidden = false;
      return;
    }
    el.hidden = true; el.innerHTML = '';
  }

  // ---------- interaction ----------
  function onPitClick(p, k) {
    if (!isHumanTurn() || G.pending) return;
    const s = G.state;
    if (p !== s.toMove) return shake(p, k);
    const dirs = legal().filter((m) => m.pit === k);
    if (!dirs.length) { G.selected = null; G.dir = null; G.hoverPit = { p, k }; render(); return shake(p, k); }
    if (G.selected === k) { G.selected = null; G.dir = null; G.hint = null; render(); return; }
    G.selected = k;
    G.dir = (G.hint && G.hint.pit === k) ? G.hint.dir : dirs[0].dir;
    render();
  }
  function shake(p, k) {
    const el = pitEls[p][k];
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  function play(move, confirmed) {
    const trap = !isPractice() ? A.checkTrap(G.state, move) : null;
    if (!confirmed && settings.coach && trap) {
      G.warnedThisTurn = trap.kind;
      G.pending = { move, trap };
      render();
      return;
    }
    commitMove(move, trap);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function animate(before, r, my) {
    const speed = reduceMotion ? 0 : parseInt(settings.speed, 10);
    if (speed === 0) return;
    const me = before.toMove;
    const drops = r.events.filter((e) => e.t === 'drop').length;
    const step = Math.max(35, Math.min(speed, 7000 / Math.max(1, drops))); // long moves play faster
    G.display = [before.pits[0].slice(), before.pits[1].slice()];
    G.anim = { p: me, src: null, cur: null, flash: null, visited: [] };
    for (const e of r.events) {
      if (my !== token) return;
      if (e.t === 'pick') { G.display[me][e.k] = 0; G.anim.src = e.k; G.anim.visited = []; G.anim.cur = null; render(); await sleep(step * 1.5); }
      else if (e.t === 'drop') {
        G.display[me][e.k]++;
        if (G.anim.cur != null) G.anim.visited.push(G.anim.cur);
        G.anim.cur = e.k; render(); await sleep(step);
      } else if (e.t === 'capture') {
        G.anim.flash = e.from; render(); await sleep(Math.max(500, step * 3));
        G.display[1 - me][e.from] = 0; G.anim.flash = null; G.anim.src = e.kichwa; G.anim.visited = []; G.anim.cur = null;
        render(); await sleep(step * 2);
      }
    }
    await sleep(step);
  }

  async function commitMove(move, trap) {
    const my = token;
    const s = G.state;
    if (!isPractice()) G.undo.push({ state: B.cloneState(s), log: G.log.slice(), turns: G.rec ? G.rec.turns.length : 0 });
    G.selected = null; G.dir = null; G.pending = null; G.coachNote = null; G.hint = null;
    if (G.mode === 'duo' || s.toMove === 0) G.afterNote = null;
    const r = B.play(s, move);
    G.busy = true;
    await animate(s, r, my);
    if (my !== token) return;
    G.busy = false; G.display = null; G.anim = null;
    G.state = r.state;
    G.result = isPractice() ? null : B.checkEnd(r.state);
    G.log.push({ player: s.toMove, text: () => logText(s.toMove, r, trap, move) });
    recordTurn(s.toMove, move, r, trap);
    renderLog();
    if (G.mode === 'learn') { checkLesson(r); render(); return; }
    if (G.mode === 'puzzle') { await checkPuzzle(move, s, r, my); return; }
    if (settings.coach && trap && trap.mine.key === A.moveKey(move)) {
      G.afterNote = () => '<p class="alert-title">' + cap(trap.kind === 'danger'
        ? (trap.mine.risk >= 64 ? t('bao.t.dangerLose', { opp: oppWords(s.toMove) }) : t('bao.after.danger', { opp: oppWords(s.toMove), n: trap.mine.risk }))
        : t('after.missed', { n: seedsWord(trap.better.take) })) + '</p><p class="alert-cost">' + t('after.undo') + '</p>';
    }
    if (G.mode === 'cpu' && s.toMove === 1 && !G.result) {
      const canWin = legal().some((m) => m.capture);
      G.coachNote = () => '<p>' + (r.captured ? t('bao.cpu.took', { n: r.captured }) : t('bao.cpu.played')) + ' ' + t('cpu.yourTurn') + '</p>' +
        (canWin ? '<p>' + t('cpu.canWin') + '</p>' : '');
    }
    render();
    if (G.mode === 'cpu' && !G.result && G.state.toMove === 1) computerTurn();
  }

  function logText(p, r, trap, move) {
    let txt = sideName(p) + ': ' + ARROWS[arrowFor(p, move.pit, move.dir)];
    if (r.captured) txt += t('log.won', { n: seedsWord(r.captured) });
    if (trap && trap.mine.key === A.moveKey(move)) txt += trap.kind === 'danger' ? t('log.risky') : t('log.missed');
    return txt;
  }

  async function computerTurn() {
    const my = token;
    render();
    const started = Date.now();
    await sleep(30);
    const m = A.chooseMove(G.state, settings.level, { adaptive: settings.adaptive });
    await sleep(reduceMotion ? 0 : Math.max(0, 600 - (Date.now() - started)));
    if (my !== token || G.mode !== 'cpu') return;
    commitMove({ pit: m.pit, dir: m.dir }, null);
  }

  function hint() {
    if (!isHumanTurn()) return;
    if (G.mode === 'puzzle') { puzzleHint(); return; }
    const b = A.simpleBest(A.looksAt(G.state));
    G.hint = { pit: b.pit, dir: b.dir };
    G.selected = b.pit; G.dir = b.dir;
    G.coachNote = () => '<p class="lead">' + (b.take >= 64 ? t('bao.hint.winGame') : b.take ? t('bao.hint.win', { n: seedsWord(b.take) }) : t('bao.hint.safe')) + '</p>';
    render();
  }

  // ---------- lessons ----------
  function loadLesson(i) {
    token++;
    G.lesson = Math.max(0, Math.min(LESSONS.length - 1, i));
    const L = LESSONS[G.lesson];
    G.state = { pits: [L.pits[0].slice(), L.pits[1].slice()], toMove: 0 };
    G.undo = []; G.log = []; G.lessonOutcome = null; G.result = null;
    resetTransient();
    renderLessonText(); renderLog(); render();
  }
  function renderLessonText() {
    const L = LESSONS[G.lesson];
    const tx = I18n.lessonText('bao:' + L.id);
    $('lesson-step').textContent = t('lesson.step', { n: G.lesson + 1, total: LESSONS.length });
    $('lesson-title').textContent = tx.title;
    $('lesson-intro').textContent = tx.intro;
    $('lesson-task').textContent = tx.task;
    $('lesson-prev').disabled = G.lesson === 0;
    $('lesson-next').textContent = t(G.lesson === LESSONS.length - 1 ? 'lesson.last' : 'lesson.next');
    const box = $('lesson-result'), o = G.lessonOutcome;
    box.hidden = !o;
    if (o) { box.className = 'lesson-result ' + (o.ok ? 'ok' : 'fail'); box.textContent = o.ok ? tx.success : tx.task; }
    $('lesson-dots').innerHTML = LESSONS.map((x, k) => '<li class="' + (k === G.lesson ? 'current' : G.lessonsDone.has(k) ? 'done' : '') + '"></li>').join('');
  }
  function checkLesson(r) {
    const goal = LESSONS[G.lesson].goal;
    let ok = true;
    if (goal.type === 'relay') ok = r.sowings >= 2;
    if (goal.type === 'capture') ok = r.captured > 0;
    if (goal.type === 'win') { const e = B.checkEnd(r.state); ok = !!(e && e.winner === 0); }
    G.lessonOutcome = { ok };
    if (ok) G.lessonsDone.add(G.lesson);
    renderLessonText();
  }

  // ---------- puzzles (premium) ----------
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dailyIndex() { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5) % Math.max(1, PUZZLES.length); }
  function progress() { const all = loadJSON('bao.puzzles', {}); const pr = all[focusPlayer()] || {}; return { stars: pr.stars || {}, daily: pr.daily || {} }; }
  function saveProgress(pr) { const all = loadJSON('bao.puzzles', {}); all[focusPlayer()] = pr; saveJSON('bao.puzzles', all); }
  function streak(pr) { const d = new Date(); if (!pr.daily[dayKey(d)]) d.setDate(d.getDate() - 1); let n = 0; while (pr.daily[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); } return n; }
  function startPuzzleIndex() { const pr = progress(); if (!pr.daily[dayKey(new Date())]) return dailyIndex(); const i = PUZZLES.findIndex((p) => !pr.stars[p.id]); return i >= 0 ? i : dailyIndex(); }
  function nextPuzzleIndex() { const pr = progress(); for (let k = 1; k <= PUZZLES.length; k++) { const i = (PZ.index + k) % PUZZLES.length; if (!pr.stars[PUZZLES[i].id]) return i; } return (PZ.index + 1) % PUZZLES.length; }
  function starsHtml(n) { let h = '<span class="stars">'; for (let k = 1; k <= 3; k++) h += '<i class="' + (k <= n ? 'on' : '') + '">★</i>'; return h + '</span>'; }
  function loadPuzzle(i, keep) {
    token++;
    PZ.index = (i + PUZZLES.length) % PUZZLES.length;
    PZ.outcome = null;
    if (!keep) { PZ.tries = 0; PZ.hints = 0; PZ.shown = false; }
    const pz = PUZZLES[PZ.index];
    G.state = { pits: [pz.pits[0].slice(), pz.pits[1].slice()], toMove: 0 };
    G.undo = []; G.log = []; G.result = null;
    resetTransient(); renderPuzzleCard(); renderLog(); render();
  }
  function renderPuzzleCard() {
    if (!PUZZLES.length) return;
    const pz = PUZZLES[PZ.index], pr = progress(), st = streak(pr), isDaily = PZ.index === dailyIndex();
    $('pz-step').textContent = t('puzzle.count', { n: PZ.index + 1, total: PUZZLES.length });
    $('pz-daily').hidden = !isDaily; $('pz-daily').textContent = t('puzzle.daily');
    $('pz-streak').hidden = st === 0; $('pz-streak').textContent = t(st === 1 ? 'puzzle.streak1' : 'puzzle.streak', { n: st });
    $('pz-title').textContent = t('puzzle.type.' + pz.type);
    $('pz-task').textContent = t('baopz.task.' + pz.type);
    $('pz-best').innerHTML = pr.stars[pz.id] ? starsHtml(pr.stars[pz.id]) : '';
    $('pz-progress').textContent = t('puzzle.solvedCount', { n: PUZZLES.filter((p) => pr.stars[p.id]).length, total: PUZZLES.length });
    $('pz-today').hidden = isDaily; $('pz-today').textContent = t('puzzle.daily');
    $('pz-grid').innerHTML = PUZZLES.map((p, i) => '<button class="pz-tile' + (i === PZ.index ? ' current' : '') + (i === dailyIndex() ? ' daily' : '') +
      (pr.stars[p.id] ? ' solved s' + pr.stars[p.id] : '') + '" data-i="' + i + '">' + (i + 1) + '</button>').join('');
    for (const b of $('pz-grid').querySelectorAll('button')) b.onclick = () => loadPuzzle(+b.dataset.i);
  }
  async function checkPuzzle(move, before, r, my) {
    const pz = PUZZLES[PZ.index];
    const ok = move.pit === pz.answer.pit && move.dir === pz.answer.dir;
    PZ.tries++;
    const looks = A.looksAt(before);
    const ans = looks.find((l) => l.pit === pz.answer.pit && l.dir === pz.answer.dir);
    const mine = looks.find((l) => l.pit === move.pit && l.dir === move.dir);
    if (ok) {
      const stars = PZ.shown ? 0 : PZ.tries === 1 && PZ.hints === 0 ? 3 : PZ.tries <= 2 && PZ.hints <= 1 ? 2 : 1;
      PZ.outcome = { ok: true, stars, shown: PZ.shown };
      if (!PZ.shown) { const pr = progress(); pr.stars[pz.id] = Math.max(pr.stars[pz.id] || 0, stars); if (PZ.index === dailyIndex()) pr.daily[dayKey(new Date())] = true; saveProgress(pr); }
      G.coachNote = () => '<p class="lead">' + (ans.take >= 64 ? t('bao.d.wins') : ans.take ? t('hint.winSafe', { n: seedsWord(ans.take) }) : t('hint.safe')) + '</p>';
      renderPuzzleCard(); render(); return;
    }
    PZ.outcome = { ok: false };
    const score = (label, l) => '<span class="pz-score-label">' + label + '</span><span>' + t('pz.fb.winLose', { a: Math.min(l.take, 64), b: Math.min(l.risk, 64) }) + '</span>';
    G.coachNote = () => '<p class="lead">' + (mine.risk >= 64 ? t('bao.t.dangerLose', { opp: t('opp.other') })
      : mine.risk >= 3 ? t('bao.t.danger', { opp: t('opp.other'), n: mine.risk }) : t('pz.fb.bestSafe')) + '</p>' +
      '<p>' + (ans.take ? t('pz.fb.best', { n: seedsWord(Math.min(ans.take, 64)) }) : t('pz.fb.bestSafe')) + '</p>' +
      '<div class="pz-score">' + score(t('pz.fb.yours'), mine) + score(t('pz.fb.bestLabel'), ans) + '</div>' +
      '<p class="pz-tip"><span class="tag best">' + t('pz.fb.tipLabel') + '</span> ' + t('baopz.tip.' + pz.type) + '</p>';
    render();
    if (mine.risk >= 3 && mine.riskMove && !B.checkEnd(G.state)) {
      await sleep(reduceMotion ? 0 : 700);
      if (my !== token) return;
      const prev = G.state;
      const rr = B.play(prev, mine.riskMove);
      G.busy = true;
      await animate(prev, rr, my);
      if (my !== token) return;
      G.busy = false; G.display = null; G.anim = null;
      G.state = rr.state;
      render();
    }
  }
  function puzzleHint() {
    const pz = PUZZLES[PZ.index];
    PZ.hints++;
    if (PZ.hints === 1) { G.coachNote = () => '<p class="lead">' + t('baopz.hint.' + pz.type) + '</p>'; render(); return; }
    G.hint = { pit: pz.answer.pit, dir: pz.answer.dir }; G.selected = pz.answer.pit; G.dir = pz.answer.dir;
    G.coachNote = () => '<p class="lead">' + t('bao.pickDir') + '</p>';
    render();
  }
  function showAnswer() {
    const keep = PZ.index;
    loadPuzzle(keep, true);
    PZ.shown = true;
    puzzleHint(); puzzleHint();
  }

  // ---------- games ----------
  function resetTransient() {
    G.busy = false; G.display = null; G.anim = null; G.pending = null; G.selected = null; G.dir = null;
    G.coachNote = null; G.afterNote = null; G.hint = null; G.hoverPit = null;
  }
  function newGame() {
    token++;
    const first = G.mode === 'cpu' ? parseInt(settings.first, 10) : 0;
    G.state = B.newGame(first);
    G.result = null; G.undo = []; G.log = [];
    startRecording(first);
    resetTransient(); renderLog(); render();
    if (G.mode === 'cpu' && G.state.toMove === 1) computerTurn();
  }
  function undo() {
    if (!G.undo.length || G.busy) return;
    token++;
    const u = G.undo.pop();
    G.state = u.state; G.log = u.log; G.result = null;
    if (G.rec) { G.rec.turns.length = u.turns; G.rec.undos++; }
    resetTransient(); renderLog(); render();
  }
  function renderLog() {
    const el = $('log');
    if (!G.log.length) { el.innerHTML = '<li class="empty">' + t('moves.none') + '</li>'; return; }
    el.innerHTML = G.log.map((m, k) => '<li class="who-' + m.player + '"><span class="n">' + (k + 1) + '.</span><span>' + m.text() + '</span></li>').join('');
    el.scrollTop = el.scrollHeight;
  }
  function startRecording(first) {
    G.warnedThisTurn = null;
    if (isPractice()) { G.rec = null; return; }
    G.rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), game: GAME, date: new Date().toISOString(), mode: G.mode,
      level: G.mode === 'cpu' ? settings.level : null, players: [playerName(0), playerName(1)], computer: G.mode === 'cpu' ? 1 : null,
      first, rules: 'kujifunza', turns: [], undos: 0, warnings: settings.coach, result: null };
  }
  function recordTurn(p, move, r, trap) {
    if (!G.rec) return;
    const human = G.mode === 'duo' || p === 0;
    const mineTrap = human && trap && trap.mine.key === A.moveKey(move);
    G.rec.turns.push({ p, pit: move.pit, dir: move.dir, took: r.captured, trap: mineTrap ? trap.kind : null, warned: human ? G.warnedThisTurn || null : null });
    G.warnedThisTurn = null;
    if (G.result) {
      const s = G.state;
      G.rec.result = { winner: G.result.winner, reason: G.result.reason, stores: [B.sideSum(s, 0), B.sideSum(s, 1)] };
      G.rec.ended = new Date().toISOString();
      const rec = JSON.parse(JSON.stringify(G.rec));
      const i = games.findIndex((g) => g.id === rec.id);
      if (i >= 0) games[i] = rec; else games.push(rec);
      if (games.length > 300) games = games.slice(-300);
      saveJSON('awale.games', games);
      renderGames();
    }
  }
  function gamesFor(name) { return games.filter((g) => (g.game || 'awale') === GAME && g.players.some((p, i) => p === name && g.computer !== i)); }
  function focusPlayer() { return settings.me || t('name.you'); }
  function renderGames() {
    const name = focusPlayer(), list = gamesFor(name);
    $('games-count').textContent = '(' + name + ': ' + list.length + ')';
    let wins = 0, losses = 0, traps = 0, moves = 0;
    for (const g of list) {
      const seat = g.players[0] === name ? 0 : 1;
      if (g.result.winner === seat) wins++; else losses++;
      for (const tu of g.turns) if (tu.p === seat) { moves++; if (tu.trap) traps++; }
    }
    $('games-stats').textContent = list.length ? t('games.stats', { name, w: wins, l: losses, d: '', t: traps, m: moves }) : t('games.none', { name });
    $('games-list').innerHTML = list.slice(-12).reverse().map((g) => {
      const seat = g.players[0] === name ? 0 : 1;
      const vs = g.computer != null ? t('games.vsCpu', { level: g.level ? t('level.' + g.level) : '' }) : t('games.vs', { name: g.players[1 - seat] });
      const res = g.result.winner === seat ? 'won' : 'lost';
      return '<li><span class="g-res g-' + res + '">' + t('games.' + res) + '</span><span>' + vs + ', ' + g.result.stores[seat] + '–' + g.result.stores[1 - seat] +
        '</span><span class="g-meta">' + new Date(g.date).toLocaleDateString(I18n.lang, { day: 'numeric', month: 'short' }) + '</span></li>';
    }).join('');
    $('games-clear').hidden = !list.length;
    $('games-clear').textContent = t('games.clear', { name });
  }
  function bindGames() {
    let armed = false;
    $('games-copy').hidden = true; // the analysis script only understands Awale games for now
    $('games-clear').addEventListener('click', () => {
      const btn = $('games-clear'), name = focusPlayer();
      if (!armed) { armed = true; btn.textContent = t('games.clearConfirm', { name }); btn.classList.add('warn'); return; }
      armed = false; btn.classList.remove('warn');
      const drop = new Set(gamesFor(name));
      games = games.filter((g) => !drop.has(g));
      saveJSON('awale.games', games);
      $('games-msg').textContent = t('games.deleted');
      renderGames();
    });
    $('games-card').addEventListener('toggle', () => { armed = false; $('games-clear').classList.remove('warn'); renderGames(); });
    renderGames();
  }

  // ---------- welcome, players, game picker ----------
  let welcome = null;
  const AVATAR_COLORS = ['#2c3c9e', '#8b4a28', '#2f9e6a', '#c8452f', '#b07d12', '#6b3fa0', '#1f7f8c', '#a23b6d'];
  function avatarHtml(name, cls) {
    let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return '<span class="avatar ' + (cls || '') + '" style="--av:' + AVATAR_COLORS[h % AVATAR_COLORS.length] + '" aria-hidden="true">' + name.charAt(0).toUpperCase() + '</span>';
  }
  function openWelcome(kind, cancelable) {
    welcome = { kind, cancelable: !!cancelable, adding: false, picking: false };
    renderWelcome();
    $('welcome').hidden = false;
    document.body.classList.add('welcoming');
    if (welcome.adding) $('welcome-name').focus({ preventScroll: true });
  }
  function closeWelcome() { welcome = null; $('welcome').hidden = true; document.body.classList.remove('welcoming'); }
  function renderWelcome() {
    const w = welcome;
    const choices = w.kind === 'me' ? players : players.filter((n) => n !== settings.me);
    if (!choices.length) w.adding = true;
    $('game-pick').hidden = !w.picking;
    if (w.picking) {
      $('welcome-title').textContent = t('pick.title', { name: settings.me });
      $('welcome-sub').textContent = t('pick.sub');
      $('welcome-grid').hidden = true; $('welcome-form').hidden = true; $('welcome-cancel').hidden = true; $('welcome-error').textContent = '';
      return;
    }
    $('welcome-title').textContent = w.kind === 'me' ? t(players.length ? 'welcome.title' : 'welcome.titleFirst') : t('welcome.titleOpp', { name: settings.me });
    $('welcome-sub').textContent = w.kind === 'me' ? t(players.length ? 'welcome.sub' : 'welcome.subFirst') : t(choices.length ? 'welcome.subOpp' : 'welcome.subOppNew');
    const grid = $('welcome-grid');
    grid.hidden = !choices.length;
    grid.innerHTML = choices.map((n) => '<button class="tile" data-name="' + n + '">' + avatarHtml(n, 'big') + '<span class="tile-name">' + n + '</span><span class="tile-meta">&nbsp;</span></button>').join('') +
      '<button class="tile add" id="welcome-add"><span class="avatar big plus" aria-hidden="true">+</span><span class="tile-name">' + t('welcome.add') + '</span><span class="tile-meta">&nbsp;</span></button>';
    $('welcome-form').hidden = !w.adding;
    $('welcome-go').textContent = t(choices.length ? 'welcome.addBtn' : 'welcome.go');
    $('welcome-name').placeholder = t(w.kind === 'me' && !players.length ? 'welcome.phFirst' : 'welcome.ph');
    $('welcome-cancel').hidden = !w.cancelable;
    $('welcome-cancel').textContent = t(w.kind === 'opponent' && !settings.opponent ? 'welcome.back' : 'welcome.cancel');
    $('welcome-error').textContent = '';
    for (const b of grid.querySelectorAll('.tile[data-name]')) b.onclick = () => pickPlayer(b.dataset.name, false);
    $('welcome-add').onclick = () => { welcome.adding = true; renderWelcome(); $('welcome-name').value = ''; $('welcome-name').focus(); };
  }
  function pickPlayer(name, isNew) {
    if (welcome.kind === 'me') {
      settings.me = name;
      if (settings.opponent === name) settings.opponent = null;
      saveSettings();
      try { sessionStorage.setItem('awale.session', name); } catch (e) { /* ignore */ }
      welcome.picking = true; welcome.isNew = isNew;
      renderWelcome(); renderMatchup(); renderGames();
      return;
    }
    closeWelcome();
    const changed = settings.opponent !== name;
    settings.opponent = name; saveSettings();
    if (G.mode !== 'duo') setMode('duo'); else if (changed) newGame(); else render();
    renderMatchup();
  }
  function chooseGame(game) {
    const isNew = welcome && welcome.isNew;
    if (game !== GAME) { location.href = $(game === 'awale' ? 'go-awale' : 'go-bao').getAttribute('href') + (isNew ? '#video' : ''); return; }
    closeWelcome();
    if (isNew) { if (G.mode === 'duo') setMode('learn'); setMode('video'); }
    else if (G.mode === 'duo' && !settings.opponent) setMode('duo');
    else if (!isPractice()) newGame(); else render();
    renderMatchup(); renderGames();
  }
  function bindWelcome() {
    $('welcome-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = cleanName($('welcome-name').value);
      if (!n) { $('welcome-error').textContent = t('welcome.errEmpty'); $('welcome-name').focus(); return; }
      if (welcome.kind === 'opponent' && settings.me && n.toLowerCase() === settings.me.toLowerCase()) { $('welcome-error').textContent = t('welcome.errSame', { name: settings.me }); return; }
      const isNew = !players.some((x) => x.toLowerCase() === n.toLowerCase());
      pickPlayer(addPlayer(n), isNew);
    });
    $('welcome-cancel').addEventListener('click', () => {
      const kind = welcome.kind; closeWelcome();
      if (kind === 'opponent' && G.mode === 'duo' && !settings.opponent) setMode('cpu');
    });
    for (const b of document.querySelectorAll('#game-pick .tile')) b.addEventListener('click', () => chooseGame(b.dataset.game));
    $('btn-profile').addEventListener('click', () => openWelcome('me', true));
    $('who-1').addEventListener('click', () => openWelcome('opponent', true));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && welcome && welcome.cancelable && !welcome.picking) $('welcome-cancel').click();
      if (e.key === 'Escape' && !welcome && (G.selected != null || G.pending)) { G.selected = null; G.dir = null; G.pending = null; render(); }
    });
  }
  function renderMatchup() {
    const duo = G.mode === 'duo', me = settings.me || t('name.you');
    $('who-0').innerHTML = avatarHtml(me) + '<span>' + me + '</span>';
    $('who-1').hidden = !duo;
    if (duo && settings.opponent) $('who-1').innerHTML = avatarHtml(settings.opponent) + '<span>' + settings.opponent + '</span><span class="caret" aria-hidden="true">▾</span>';
    $('who-end').hidden = duo;
    $('btn-profile').innerHTML = avatarHtml(me) + '<span class="profile-name">' + me + '</span><span class="caret" aria-hidden="true">▾</span>';
  }

  // ---------- modes, language, video ----------
  function showVideo(show) {
    $('video-view').hidden = !show;
    $('layout').hidden = show;
    if (!show) $('rules-video').pause();
    for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', String(show ? b.dataset.mode === 'video' : b.dataset.mode === G.mode));
    try { history.replaceState(null, '', '#' + (show ? 'video' : G.mode)); } catch (e) { /* ignore */ }
  }
  function setMode(mode) {
    if (mode === 'puzzle' && (!PREMIUM || !PUZZLES.length)) mode = 'learn';
    if (mode === 'video') { showVideo(true); return; }
    if (!$('video-view').hidden) showVideo(false);
    if (mode === 'duo' && !settings.opponent && settings.me) { openWelcome('opponent', true); return; }
    G.mode = mode;
    for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    const practice = isPractice();
    $('lesson-card').hidden = mode !== 'learn';
    $('puzzle-card').hidden = mode !== 'puzzle';
    $('difficulty').hidden = mode !== 'cpu';
    $('matchup').hidden = practice;
    $('btn-warn').hidden = practice;
    for (const id of ['games-card', 'moves', 'settings']) $(id).hidden = practice;
    $('field-first').hidden = mode !== 'cpu';
    renderMatchup(); renderLevelNote();
    if (mode === 'learn') loadLesson(G.lesson);
    else if (mode === 'puzzle') loadPuzzle(startPuzzleIndex());
    else newGame();
    try { if (location.hash.slice(1) !== mode) history.replaceState(null, '', '#' + mode); } catch (e) { /* ignore */ }
  }
  function renderLevelNote() {
    $('difficulty-note').textContent = t('level.note.' + settings.level);
    $('field-adaptive').hidden = G.mode !== 'cpu' || settings.level === 'hard';
  }
  function applyStatic() {
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    document.documentElement.lang = I18n.lang;
    const sel = $('lang-select');
    sel.innerHTML = I18n.LANGS.map((l) => '<option value="' + l.id + '">' + l.short + '</option>').join('');
    sel.value = I18n.lang;
    $('welcome-langs').innerHTML = I18n.LANGS.map((l) => '<button class="lang-btn" data-lang="' + l.id + '" aria-pressed="' + (l.id === I18n.lang) + '">' + l.label + '</button>').join('');
    for (const b of $('welcome-langs').querySelectorAll('button')) b.onclick = () => setLanguage(b.dataset.lang);
  }
  let syncWarn = () => {};
  function setLanguage(l) {
    I18n.setLang(l); settings.lang = I18n.lang; saveSettings();
    applyStatic(); setVideoSource(); renderLevelNote(); syncWarn(); renderMatchup(); renderGames(); renderLog();
    if (G.mode === 'learn' && G.state) renderLessonText();
    if (G.mode === 'puzzle' && G.state) renderPuzzleCard();
    if (G.state) render();
    if (welcome) renderWelcome();
  }
  function setVideoSource() {
    const v = $('rules-video'), src = 'video/bao-rules-' + I18n.lang + '.mp4';
    if (v.dataset.src === src) return;
    const wasPlaying = !v.paused;
    v.dataset.src = src; v.poster = 'video/bao-rules-' + I18n.lang + '.jpg'; v.src = src;
    if (wasPlaying) v.play().catch(() => {});
  }
  function bindSettings() {
    const bind = (id, key, isCheck) => {
      const el = $(id);
      if (isCheck) el.checked = !!settings[key]; else el.value = settings[key];
      el.addEventListener('change', () => {
        settings[key] = isCheck ? el.checked : el.value; saveSettings();
        if (key === 'first' && G.mode === 'cpu' && G.log.length === 0) newGame();
        render();
      });
    };
    bind('opt-adaptive', 'adaptive', true); bind('opt-ratings', 'ratings', true); bind('opt-speed', 'speed'); bind('opt-first', 'first');
    const levelBtns = document.querySelectorAll('#difficulty button');
    const syncLevel = () => levelBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === settings.level)));
    levelBtns.forEach((b) => b.addEventListener('click', () => { settings.level = b.dataset.level; saveSettings(); syncLevel(); renderLevelNote(); }));
    syncLevel(); renderLevelNote();
    const warn = $('btn-warn');
    syncWarn = () => { warn.setAttribute('aria-checked', String(!!settings.coach)); $('warn-state').textContent = t(settings.coach ? 'warn.on' : 'warn.off'); };
    warn.addEventListener('click', () => { settings.coach = !settings.coach; saveSettings(); syncWarn(); if (!settings.coach) { G.pending = null; G.afterNote = null; } render(); });
    syncWarn();
    // Learner / advanced rules switch: only the learners' rules exist so far.
    $('rules-advanced').addEventListener('click', () => {
      $('rules-note').textContent = t('bao.advancedSoon');
      $('rules-note').classList.add('flash-note');
    });
    $('rules-learner').addEventListener('click', () => { $('rules-note').textContent = t('bao.learnerNote'); });
  }

  function start() {
    $('mode-puzzle').hidden = !PREMIUM || !PUZZLES.length;
    $('games-copy').hidden = true;
    I18n.setLang(settings.lang || I18n.detect());
    applyStatic();
    $('video-start').addEventListener('click', () => setMode('learn'));
    setVideoSource();
    $('lang-select').addEventListener('change', (e) => setLanguage(e.target.value));
    buildBoard(); bindSettings(); bindWelcome(); bindGames();
    $('pz-prev').onclick = () => loadPuzzle(PZ.index - 1);
    $('pz-next-card').onclick = () => loadPuzzle(PZ.index + 1);
    $('pz-today').onclick = () => loadPuzzle(dailyIndex());
    for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
    $('btn-new').onclick = newGame; $('end-new').onclick = newGame; $('btn-undo').onclick = undo; $('btn-hint').onclick = hint;
    $('lesson-prev').onclick = () => loadLesson(G.lesson - 1);
    $('lesson-retry').onclick = () => loadLesson(G.lesson);
    $('lesson-next').onclick = () => (G.lesson === LESSONS.length - 1 ? setMode('cpu') : loadLesson(G.lesson + 1));
    window.addEventListener('hashchange', () => {
      const m = location.hash.slice(1);
      if (m === 'video') setMode('video'); else if (['learn', 'puzzle', 'cpu', 'duo'].includes(m) && m !== G.mode) setMode(m);
    });
    const m = location.hash.slice(1);
    const wanted = ['learn', 'puzzle', 'cpu', 'duo'].includes(m) ? m : 'learn';
    setMode(wanted === 'duo' && !settings.opponent ? 'cpu' : wanted);
    if (m === 'video') showVideo(true);
    // Coming from the Awale page in the same visit: don't ask who's playing again.
    let ses = null;
    try { ses = sessionStorage.getItem('awale.session'); } catch (e) { /* ignore */ }
    if (ses && players.includes(ses)) { settings.me = ses; saveSettings(); renderMatchup(); renderGames(); }
    else openWelcome('me', false);
  }

  window.BaoApp = { get game() { return G; }, setMode, loadLesson };
  start();
})();
