/* Awale UI: board rendering, move previews, animation, lessons, coach and opponent. */
(function () {
  'use strict';
  const E = Awale.Engine;
  const Coach = Awale.Coach;
  const Opp = Awale.Opponent;
  const LESSONS = Awale.LESSONS;
  const $ = (id) => document.getElementById(id);
  const I18n = Awale.I18n;
  // Premium features (puzzles, game analysis export) are switched off in the public build.
  const PREMIUM = !!(Awale.CONFIG && Awale.CONFIG.premium);
  const t = I18n.t;
  const N = E.PIT_NAMES;

  // ---------- settings (per-viewer, remembered when storage allows) ----------
  const defaults = { level: 'easy', adaptive: true, coach: true, ratings: false, speed: '220', first: '0', me: null, opponent: null, lang: null };
  let settings = Object.assign({}, defaults);
  try { Object.assign(settings, JSON.parse(localStorage.getItem('awale.settings') || '{}')); } catch (e) { /* storage unavailable */ }
  settings.level = { learner: 'easy', casual: 'medium', club: 'hard', strong: 'hard' }[settings.level] || settings.level;
  if (!Opp.LEVELS[settings.level]) settings.level = 'easy';

  // ---------- players and recorded games (kept in this browser) ----------
  // Player names are shown inside HTML, so keep them to plain text.
  function cleanName(raw) {
    return String(raw || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  }
  function loadJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }

  let players = loadJSON('awale.players', []);
  if (!Array.isArray(players)) players = [];
  players = players.map(cleanName).filter(Boolean);
  let games = loadJSON('awale.games', []);
  if (!Array.isArray(games)) games = [];
  // Earlier versions created "Player 1" / "Player 2" automatically; drop them unless they have games.
  players = players.filter((n) => !/^Player [12]$/.test(n) || games.some((g) => g.players.includes(n)));
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
  delete settings.duo; delete settings.names;

  /** Name of the human at seat p (0 = bottom, 1 = top). */
  function playerName(p) {
    if (p === 0) return settings.me || t('name.you');
    if (G.mode === 'cpu') return t('name.computer');
    return settings.opponent || t('name.player2');
  }
  function saveSettings() { try { localStorage.setItem('awale.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- game state ----------
  const G = {
    mode: 'learn',          // learn | cpu | duo
    lesson: 0,
    lessonsDone: new Set(),
    state: null,
    history: {},
    undo: [],               // stack of { state, history, log }
    log: [],
    busy: false,
    analysis: null,         // coach analysis for current position
    analysisKey: null,
    pending: null,          // move awaiting confirmation after a coach warning
    hover: null,
    selected: null,
    lessonOutcome: null,
    rec: null,              // the game being recorded
    display: null,          // board shown during animation
    displayStores: null,
  };
  let lastPointer = window.matchMedia && window.matchMedia('(hover: none)').matches ? 'touch' : 'mouse';
  let token = 0;            // invalidates in-flight async work after resets

  // ---------- board DOM ----------
  const pitEls = [];
  function buildBoard() {
    const rowN = $('row-n'), rowS = $('row-s');
    for (let i = 0; i < 12; i++) {
      const b = document.createElement('button');
      b.className = 'pit';
      b.dataset.pit = i;
      b.innerHTML = '<div class="seeds"></div><span class="pname">' + N[i] + '</span><span class="count">0</span>';
      b.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; });
      b.addEventListener('mouseenter', () => { if (lastPointer === 'mouse') setHover(i); });
      b.addEventListener('mouseleave', () => { if (lastPointer === 'mouse') setHover(null); });
      b.addEventListener('focus', () => setHover(i));
      b.addEventListener('blur', () => { if (G.hover === i) setHover(null); });
      b.addEventListener('click', () => onPitClick(i));
      pitEls[i] = b;
    }
    for (let i = 11; i >= 6; i--) rowN.appendChild(pitEls[i]);
    for (let i = 0; i < 6; i++) rowS.appendChild(pitEls[i]);
  }

  // Deterministic seed layout: a sunflower spiral, so seeds don't jump around between renders.
  const SEED_POS = [];
  for (let k = 0; k < 30; k++) {
    const r = k === 0 ? 0 : 0.17 * Math.sqrt(k) * 1.45;
    const a = k * 2.39996;
    SEED_POS.push([50 + Math.min(r, 0.47) * 100 * Math.cos(a), 50 + Math.min(r, 0.47) * 100 * Math.sin(a)]);
  }
  function seedHtml(n, cap) {
    let h = '';
    const shown = Math.min(n, cap);
    for (let k = 0; k < shown; k++) {
      const [x, y] = SEED_POS[k];
      h += '<i class="seed" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%"></i>';
    }
    return h;
  }
  function storeSeedHtml(n) {
    // Seeds packed in a loose grid inside the store well.
    const narrow = window.matchMedia('(max-width: 620px)').matches;
    let h = '';
    const shown = Math.min(n, 48);
    for (let k = 0; k < shown; k++) {
      let x, y;
      if (narrow) { x = 3 + (k % 24) * 4.1; y = k < 24 ? 32 : 70; }
      else { x = 18 + (k % 4) * 21 + ((k >> 2) % 2) * 10; y = 6 + Math.floor(k / 4) * 7.6; }
      h += '<i class="seed" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%"></i>';
    }
    return h;
  }

  // ---------- rendering ----------
  /** Lessons and puzzles: one move from a set position, nothing recorded, no computer reply. */
  function isPractice() { return G.mode === 'learn' || G.mode === 'puzzle'; }

  function isHumanTurn() {
    if (!G.state || G.state.result || G.busy) return false;
    if (G.mode === 'cpu') return G.state.toMove === 0;
    if (G.mode === 'learn') return G.state.toMove === 0 && !G.lessonOutcome;
    if (G.mode === 'puzzle') return G.state.toMove === 0 && !PZ.outcome;
    return true;
  }

  function render() {
    const s = G.state;
    const board = G.display || s.board;
    const stores = G.displayStores || s.stores;
    const human = isHumanTurn();
    const preview = previewInfo();
    const colors = settings.ratings && human && !G.pending ? Coach.moveColors(s) : null;

    for (let i = 0; i < 12; i++) {
      const el = pitEls[i];
      const n = board[i];
      if (el.dataset.n !== String(n)) { el.querySelector('.seeds').innerHTML = seedHtml(n, 26); el.dataset.n = n; }
      el.querySelector('.count').textContent = n;
      const st = E.moveStatus(s, i);
      const mine = E.owner(i) === s.toMove;
      el.classList.toggle('mine', mine && human);
      el.classList.toggle('legal', human && st.legal && !G.display);
      el.classList.toggle('illegal', human && !st.legal);
      el.classList.toggle('selected', G.selected === i);
      for (const c of ['path', 'last', 'capture', 'blocked', 'source', 'active', 'flash', 'warn-pit', 'better-pit', 'threat-pit', 'danger-pit']) el.classList.remove(c);
      for (const x of el.querySelectorAll('.order, .cap')) x.remove();
      const oldR = el.querySelector('.rating'); if (oldR) oldR.remove();

      let label = t('aria.pit', { p: N[i], n: seedsWord(n) });
      if (human && mine) label += t(st.legal ? 'aria.playable' : 'aria.notPlayable');
      el.setAttribute('aria-label', label);

      if (colors && colors[i]) {
        const r = document.createElement('span');
        r.className = 'rating ' + colors[i];
        r.title = t('rating.' + colors[i]);
        el.appendChild(r);
      }
    }

    if (preview && preview.sim) {
      const sim = preview.sim;
      pitEls[sim.pit].classList.add('source');
      const orders = {};
      sim.sown.forEach((p, k) => { (orders[p] = orders[p] || []).push(k + 1); });
      for (const p in orders) {
        pitEls[p].classList.add('path');
        const o = document.createElement('span');
        o.className = 'order' + (orders[p].length > 1 ? ' multi' : '');
        o.textContent = orders[p].join('+');
        pitEls[p].appendChild(o);
      }
      pitEls[sim.last].classList.add('last');
      if (G.mode !== 'puzzle') {
        for (const c of sim.captures) { pitEls[c.pit].classList.add('capture'); addCap(c.pit, '+' + c.seeds, false); }
        for (const c of sim.blockedCaptures) { pitEls[c.pit].classList.add('blocked'); addCap(c.pit, 'no', true); }
      }
    }

    if (G.anim) {
      const a = G.anim;
      pitEls[a.pit].classList.add('source');
      for (const p of a.visited) pitEls[p].classList.add('path');
      if (a.current != null) pitEls[a.current].classList.add('active');
      for (const p of a.flash) pitEls[p].classList.add('flash');
      for (const p of a.blocked) pitEls[p].classList.add('blocked');
    }

    if (G.pending) {
      const tr = G.pending.trap;
      pitEls[G.pending.pit].classList.add('warn-pit');
      addBadge(G.pending.pit, t('badge.yourPick'), 'cap no');
      pitEls[tr.better.pit].classList.add('better-pit');
      addBadge(tr.better.pit, t('badge.try'), 'cap go');
      if (tr.kind === 'danger') {
        for (const c of tr.mine.riskPits) {
          if (c.pit === G.pending.pit || c.pit === tr.better.pit) continue;
          pitEls[c.pit].classList.add('danger-pit');
          addBadge(c.pit, t('badge.danger'), 'cap no');
        }
      }
    }

    for (const p of [0, 1]) {
      const el = $('store-' + p);
      el.querySelector('.seeds').innerHTML = storeSeedHtml(stores[p]);
      el.querySelector('.store-count').textContent = stores[p];
    }
    $('label-0').textContent = sideName(0);
    $('label-1').textContent = sideName(1);

    renderStatus();
    renderCoach(preview);
    renderActions();
    renderEnd();
    renderAlert();
  }

  function addCap(pit, text, blocked) {
    const b = document.createElement('span');
    b.className = 'cap' + (blocked ? ' no' : '');
    b.textContent = blocked ? t('badge.nothing') : t('badge.win', { n: text.slice(1) });
    pitEls[pit].appendChild(b);
  }

  function addBadge(pit, text, cls) {
    const b = document.createElement('span');
    b.className = cls;
    b.textContent = text;
    pitEls[pit].appendChild(b);
  }

  // Big, unmissable warning right above the board.
  let alertShownFor = null;
  function renderAlert() {
    const el = $('alert');
    if (G.pending) {
      const tr = G.pending.trap;
      const pit = G.pending.pit;
      const msg = trapMessage(tr, G.state.toMove);
      el.className = 'alert ' + (tr.kind === 'missed' ? 'tip' : 'stop');
      el.innerHTML =
        '<div class="alert-icon" aria-hidden="true">' + (tr.kind === 'missed' ? '+' : '!') + '</div>' +
        '<div class="alert-main">' +
        '<p class="alert-title">' + msg.title + '</p>' +
        msg.lines.map((l) => '<p class="alert-cost">' + l + '</p>').join('') +
        '<div class="btnrow">' +
        '<button class="btn primary" id="a-best">' + t('alert.instead', { p: N[tr.better.pit] }) + '</button>' +
        '<button class="btn" id="a-back">' + t('alert.again') + '</button>' +
        '<button class="btn subtle" id="a-anyway">' + t('alert.anyway', { p: N[pit] }) + '</button>' +
        '</div></div>';
      el.hidden = false;
      $('a-best').onclick = () => { const p = tr.better.pit; G.pending = null; play(p, true); };
      $('a-back').onclick = () => { G.pending = null; render(); };
      $('a-anyway').onclick = () => { const p = G.pending.pit; G.pending = null; play(p, true); };
      if (alertShownFor !== G.pending) {
        alertShownFor = G.pending;
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
        $('a-best').focus({ preventScroll: true });
      }
      return;
    }
    alertShownFor = null;
    if (G.afterNote && !G.state.result) {
      el.className = 'alert soft';
      el.innerHTML = '<div class="alert-icon" aria-hidden="true">?</div><div class="alert-main">' + (typeof G.afterNote === 'function' ? G.afterNote() : G.afterNote) + '</div>';
      el.hidden = false;
      return;
    }
    el.hidden = true;
    el.innerHTML = '';
  }

  // Who the opponent is, in words, for the player `p` who is moving.
  function oppWords(p) {
    if (G.mode === 'cpu') return p === 0 ? t('opp.cpu') : t('name.you');
    if (G.mode === 'duo') return playerName(1 - p);
    return t('opp.other');
  }
  function seedsWord(n) { return t(n === 1 ? 'seed1' : 'seedN', { n }); }
  function pitTag(pit, capital) { return t(capital ? 'Pit' : 'pit', { p: '<b class="mono">' + N[pit] + '</b>' }); }

  /** Kid-friendly text for a trap found by Coach.checkTrap. */
  function trapMessage(tr, p) {
    const opp = oppWords(p);
    const m = tr.mine, b = tr.better;
    const lines = [];
    let title;
    if (tr.kind === 'grand-slam') {
      title = t('trap.slamTitle');
      lines.push(t('trap.slamLine', { Pit: pitTag(m.pit, true) }));
    } else if (tr.kind === 'danger') {
      title = t('trap.dangerTitle');
      lines.push(t('trap.dangerLine', { pit: pitTag(m.pit), opp, n: seedsWord(m.risk) }));
      if (m.take) lines.push(t('trap.dangerMore', { n: seedsWord(m.take) }));
    } else {
      title = t('trap.missedTitle');
      lines.push(t('trap.missedLine', { Pit: pitTag(b.pit, true), n: seedsWord(b.take) }));
    }
    const pit = pitTag(b.pit), n = seedsWord(b.take);
    if (tr.kind !== 'missed') {
      if (b.take && b.risk === 0) lines.push(t('try.winSafe', { pit, n }));
      else if (b.take) lines.push(t('try.win', { pit, n }));
      else if (b.risk === 0) lines.push(t('try.safe', { pit }));
      else lines.push(t('try.fewer', { pit }));
    } else if (b.risk === 0) {
      lines[0] += ' ' + t('trap.missedSafe');
    }
    return { title, lines };
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function sideName(p) {
    if (G.mode === 'cpu') return p === 0 ? (settings.me || t('name.you')) : t('name.computer');
    if (isPractice()) return p === 0 ? t('name.you') : t('name.opponent');
    return playerName(p);
  }

  function renderStatus() {
    const s = G.state;
    const el = $('status');
    if (G.mode === 'learn' && G.lessonOutcome) {
      // Lesson finished: say how it went, with the next step right beside it.
      const ok = G.lessonOutcome.ok;
      const last = G.lesson === LESSONS.length - 1;
      el.innerHTML = '<span class="chip ' + (ok ? 'done' : 'retry') + '">' + (ok ? '✓' : '↺') + '</span><span>' +
        t(ok ? 'status.lessonOk' : 'status.lessonRetry') + '</span>' +
        // Same two buttons either way; the suggested one is highlighted.
        '<button class="btn ' + (ok ? '' : 'primary') + ' status-btn" id="status-retry">↺ ' + t('lesson.again') + '</button>' +
        '<button class="btn ' + (ok ? 'primary' : '') + ' status-btn" id="status-next">' + t(last ? 'lesson.last' : 'lesson.next') + ' →</button>';
      $('status-next').onclick = () => $('lesson-next').click();
      $('status-retry').onclick = () => loadLesson(G.lesson);
      return;
    }
    if (G.mode === 'puzzle' && PZ.outcome) {
      const o = PZ.outcome;
      const head = o.ok ? '<span class="chip done">✓</span><span>' + t('puzzle.solved') + '</span>' + (o.shown ? '' : starsHtml(o.stars))
        : '<span class="chip retry">↺</span><span>' + t('status.lessonRetry') + '</span>';
      el.innerHTML = head +
        '<button class="btn ' + (o.ok ? '' : 'primary') + ' status-btn" id="pz-retry">↺ ' + t('lesson.again') + '</button>' +
        (o.ok ? '' : '<button class="btn status-btn" id="pz-show">' + t('puzzle.show') + '</button>') +
        '<button class="btn ' + (o.ok ? 'primary' : '') + ' status-btn" id="pz-next">' + t('puzzle.next') + ' →</button>';
      $('pz-retry').onclick = () => loadPuzzle(PZ.index, !o.ok);
      $('pz-next').onclick = () => loadPuzzle(nextPuzzleIndex());
      if ($('pz-show')) $('pz-show').onclick = showAnswer;
      return;
    }
    if (s.result) { el.innerHTML = '<span>' + t('status.over') + '</span>'; return; }
    const p = s.toMove;
    const chip = '<span class="chip name' + (p === 1 ? ' north' : '') + '">' + sideName(p) + '</span>';
    if (G.mode === 'cpu' && p === 1) { el.innerHTML = chip + '<span class="thinking">' + t('status.thinking') + '</span>'; return; }
    if (G.busy) { el.innerHTML = chip + '<span>' + t('status.sowing') + '</span>'; return; }
    const who = G.mode === 'duo' ? t('status.duoTurn') : t('status.yourTurn');
    const oppEmpty = E.sideSum(s.board, 1 - p) === 0;
    el.innerHTML = chip + '<span>' + who + (oppEmpty ? t('status.mustFeed', { opp: oppWords(p) }) : '') + '</span>';
  }

  // ---------- previews and explanations ----------
  function previewInfo() {
    const pit = G.hover != null ? G.hover : G.selected;
    if (pit == null || !isHumanTurn()) return null;
    const st = E.moveStatus(G.state, pit);
    if (!st.legal) return { pit, status: st };
    return { pit, status: st, sim: E.simulate(G.state, pit) };
  }

  const REASONS = {
    'not-your-side': (s, pit) => t('reason.notYours', { p: N[pit] }),
    empty: (s, pit) => t('reason.empty', { p: N[pit] }),
    'must-feed': (s, pit) => {
      const need = ((1 - s.toMove) * 6 - pit + 12) % 12;
      return t('reason.feed', { opp: oppWords(s.toMove), p: N[pit], n: seedsWord(s.board[pit]), need });
    },
    'game-over': () => t('reason.over'),
  };

  function names(list) { return list.map((p) => '<span class="mono">' + N[p] + '</span>').join(' '); }

  function describeMove(state, sim) {
    const out = [];
    const n = sim.seeds;
    const path = sim.sown.length <= 9 ? names(sim.sown) : t('describe.around', { p: '<span class="mono">' + N[sim.last] + '</span>' });
    out.push(t('describe.go', { Pit: t('Pit', { p: '<b class="mono">' + N[sim.pit] + '</b>' }), n: seedsWord(n), path }));
    if (n >= 12) out.push(t('describe.big', { p: N[sim.pit] }));
    const lastCount = state.board[sim.last] + sim.sown.filter((p) => p === sim.last).length;
    if (E.owner(sim.last) === sim.player) {
      out.push(t('describe.own'));
    } else if (sim.grandSlam) {
      out.push(t('describe.slam'));
    } else if (sim.captures.length) {
      const parts = sim.captures.map((c) => N[c.pit] + ' (' + c.seeds + ')');
      out.push(t('describe.win', { n: seedsWord(sim.captured), list: parts.join(', ') }));
      if (sim.captures.length > 1) out.push(t('describe.chain'));
    } else {
      out.push(t('describe.noWin', { p: N[sim.last], k: lastCount }));
    }
    if (sim.fed) out.push(t('describe.fed'));
    return out;
  }

  function renderCoach(preview) {
    const body = $('coach-body');
    const s = G.state;
    if (G.pending) {
      body.innerHTML = '';
      return;
    }
    if (s.result) { body.innerHTML = '<p>' + endSummary(s.result) + '</p>'; return; }
    if (preview) {
      if (!preview.status.legal) {
        body.innerHTML = '<p class="lead">' + t('notAllowed') + '</p><p>' + REASONS[preview.status.reason](s, preview.pit) + '</p>';
        return;
      }
      let lines = describeMove(s, preview.sim);
      if (G.mode === 'puzzle') lines = lines.slice(0, 1); // the path only: working out what it wins is the puzzle
      let g = '';
      if (G.mode !== 'puzzle' && (G.mode !== 'learn' || G.lesson >= 1)) {
        const look = Coach.looksAt(s).find((l) => l.pit === preview.pit);
        if (look && look.risk >= 2) g = '<p><span class="tag mistake">' + t('tag.careful') + '</span> ' + t('preview.careful', { opp: oppWords(s.toMove), n: seedsWord(look.risk) }) + '</p>';
        else if (look) g = '<p><span class="tag best">' + t('tag.safe') + '</span> ' + t('preview.safe', { opp: oppWords(s.toMove) }) + '</p>';
      }
      body.innerHTML = lines.map((l, k) => '<p' + (k === 0 ? ' class="lead"' : '') + '>' + l + '</p>').join('') + g;
      return;
    }
    if (G.coachNote) { body.innerHTML = typeof G.coachNote === 'function' ? G.coachNote() : G.coachNote; return; }
    if (isHumanTurn()) {
      const legal = E.legalMoves(s);
      const mouse = lastPointer === 'mouse';
      body.innerHTML = '<p>' + t(mouse ? 'idle.mouse' : 'idle.touch') + ' ' + t('idle.green') +
        (legal.length < 6 ? ' ' + t(mouse ? 'idle.redMouse' : 'idle.redTouch') : '') + '</p>';
    } else if (G.mode === 'cpu') {
      body.innerHTML = '<p>' + t('cpu.choosing') + '</p>';
    } else body.innerHTML = '';
  }

  function renderActions() {
    $('btn-undo').disabled = G.busy || G.undo.length === 0 || isPractice();
    $('btn-hint').disabled = !isHumanTurn();
    $('btn-undo').hidden = isPractice();
    $('btn-new').hidden = isPractice();
    const remaining = G.state.board.reduce((a, b) => a + b, 0);
    $('btn-split').hidden = !(!isPractice() && !G.state.result && remaining <= 10);
  }

  function endSummary(r) {
    const reasons = {
      majority: t('end.majority'),
      draw: t('end.drawReason'),
      'no-moves': t('end.noMoves', { name: sideName(r.collector) }),
      repetition: t('end.repetition'),
      agreed: t('end.agreed'),
    };
    return reasons[r.reason] || '';
  }

  function renderEnd() {
    const r = G.state.result;
    const card = $('endcard');
    if (!r || isPractice()) { card.hidden = true; return; }
    card.hidden = false;
    let title;
    if (r.winner == null) title = t('end.draw');
    else if (G.mode === 'cpu') title = r.winner === 0 ? t('end.youWin') : t('end.cpuWins');
    else title = t('end.wins', { name: playerName(r.winner) });
    $('end-title').textContent = title;
    $('end-reason').textContent = endSummary(r);
    $('end-score').textContent = sideName(0) + ' ' + r.stores[0] + ' – ' + r.stores[1] + ' ' + sideName(1);
  }

  function renderLog() {
    const el = $('log');
    if (!G.log.length) { el.innerHTML = '<li class="empty">' + t('moves.none') + '</li>'; return; }
    el.innerHTML = G.log.map((m, k) =>
      '<li class="who-' + m.player + '"><span class="n">' + (k + 1) + '.</span><span>' + (typeof m.text === 'function' ? m.text() : m.text) + '</span></li>').join('');
    el.scrollTop = el.scrollHeight;
  }

  // ---------- coach analysis ----------
  function refreshAnalysis() {
    return; // The beginner coach checks simple traps directly; deep search is only used by the computer.
    const s = G.state;
    if (s.result) return;
    const humanSide = G.mode === 'duo' || s.toMove === 0;
    if (!humanSide) return;
    const key = E.positionKey(s);
    if (G.analysisKey === key && G.analysis) return;
    const my = token;
    G.analysis = null; G.analysisKey = null;
    setTimeout(() => {
      Awale.Advisor.analyze(s, { depth: 14, timeMs: 350 }).then((a) => {
        if (my !== token || E.positionKey(G.state) !== key) return;
        G.analysis = a; G.analysisKey = key;
        render();
      });
    }, 30);
  }

  // ---------- interaction ----------
  function setHover(pit) {
    if (G.hover === pit) return;
    G.hover = pit;
    render();
  }

  function onPitClick(pit) {
    if (!isHumanTurn() || G.pending) return;
    const st = E.moveStatus(G.state, pit);
    if (lastPointer !== 'mouse' && G.selected !== pit) {
      // Touch: first tap previews, second tap plays.
      G.selected = pit; G.hover = null; render();
      return;
    }
    if (!st.legal) {
      G.selected = pit; render();
      const el = pitEls[pit];
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      return;
    }
    play(pit, false);
  }

  function play(pit, confirmed) {
    const s = G.state;
    const trap = !isPractice() ? Coach.checkTrap(s, pit) : null;
    if (!confirmed && settings.coach && trap) {
      G.warnedThisTurn = trap.kind;
      G.pending = { pit, trap };
      G.selected = null; G.hover = null;
      render();
      return;
    }
    commitMove(pit, trap);
  }

  // ---------- welcome screen: who's playing ----------
  // kind 'me': pick (or create) the main player. kind 'opponent': pick the second player for two-player games.
  let welcome = null;
  const AVATAR_COLORS = ['#2c3c9e', '#8b4a28', '#2f9e6a', '#c8452f', '#b07d12', '#6b3fa0', '#1f7f8c', '#a23b6d'];
  function avatarColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function avatarHtml(name, cls) {
    return '<span class="avatar ' + (cls || '') + '" style="--av:' + avatarColor(name) + '" aria-hidden="true">' +
      name.charAt(0).toUpperCase() + '</span>';
  }

  function openWelcome(kind, cancelable) {
    welcome = { kind, cancelable: !!cancelable, adding: false, picking: false };
    renderWelcome();
    $('welcome').hidden = false;
    document.body.classList.add('welcoming');
    if (welcome.adding) $('welcome-name').focus({ preventScroll: true });
  }

  function closeWelcome() {
    welcome = null;
    $('welcome').hidden = true;
    document.body.classList.remove('welcoming');
  }

  function renderWelcome() {
    const w = welcome;
    const choices = w.kind === 'me' ? players : players.filter((n) => n !== settings.me);
    if (!choices.length) w.adding = true;
    $('game-pick').hidden = !w.picking;
    $('welcome-grid').hidden = false;
    if (w.picking) {
      $('welcome-title').textContent = t('pick.title', { name: settings.me });
      $('welcome-sub').textContent = t('pick.sub');
      $('welcome-grid').hidden = true; $('welcome-form').hidden = true; $('welcome-cancel').hidden = true; $('welcome-error').textContent = '';
      return;
    }
    $('welcome-title').textContent = w.kind === 'me'
      ? t(players.length ? 'welcome.title' : 'welcome.titleFirst')
      : t('welcome.titleOpp', { name: settings.me });
    $('welcome-sub').textContent = w.kind === 'me'
      ? t(players.length ? 'welcome.sub' : 'welcome.subFirst')
      : t(choices.length ? 'welcome.subOpp' : 'welcome.subOppNew');
    const grid = $('welcome-grid');
    grid.hidden = !choices.length;
    grid.innerHTML = choices.map((n) =>
      '<button class="tile" data-name="' + n + '">' + avatarHtml(n, 'big') + '<span class="tile-name">' + n + '</span>' +
      '<span class="tile-meta">' + t(gamesFor(n).length === 1 ? 'welcome.game1' : 'welcome.gameN', { n: gamesFor(n).length }) + '</span></button>').join('') +
      '<button class="tile add" id="welcome-add"><span class="avatar big plus" aria-hidden="true">+</span><span class="tile-name">' + t('welcome.add') + '</span><span class="tile-meta">&nbsp;</span></button>';
    $('welcome-form').hidden = !w.adding;
    $('welcome-go').textContent = t(choices.length ? 'welcome.addBtn' : 'welcome.go');
    $('welcome-name').placeholder = t(w.kind === 'me' && !players.length ? 'welcome.phFirst' : 'welcome.ph');
    $('welcome-cancel').hidden = !w.cancelable;
    $('welcome-cancel').textContent = t(w.kind === 'opponent' && !settings.opponent ? 'welcome.back' : 'welcome.cancel');
    $('welcome-error').textContent = '';
    for (const t of grid.querySelectorAll('.tile[data-name]')) t.onclick = () => pickPlayer(t.dataset.name);
    $('welcome-add').onclick = () => { welcome.adding = true; renderWelcome(); $('welcome-name').value = ''; $('welcome-name').focus(); };
  }

  function pickPlayer(name, isNew) {
    const kind = welcome.kind;
    if (kind === 'me') {
      // Next: which game? (Awale or Bao)
      welcome.picking = true; welcome.isNew = !!isNew; welcome.prevMe = settings.me;
      settings.me = name;
      if (settings.opponent === name) settings.opponent = null;
      saveSettings();
      try { sessionStorage.setItem('awale.session', name); } catch (e) { /* ignore */ }
      renderWelcome();
      return;
    }
    finishPick(kind, name, isNew);
  }

  function chooseGame(game) {
    const w = welcome;
    if (game !== 'awale') { location.href = $('go-bao').getAttribute('href') + (w.isNew ? '#video' : ''); return; }
    finishPick('me', settings.me, w.isNew, w.prevMe);
  }

  function finishPick(kind, name, isNew, prevMe) {
    closeWelcome();
    if (kind === 'me') {
      const changed = prevMe !== name;
      // A brand-new player starts with the 1-minute rules video.
      if (isNew) { if (G.mode === 'duo') setMode('learn'); setMode('video'); renderMatchup(); renderGames(); return; }
      if (G.mode === 'duo' && !settings.opponent) { setMode('duo'); renderMatchup(); renderGames(); return; }
      if (changed && !isPractice()) newGame(); else if (G.mode === 'puzzle') loadPuzzle(PZ.index); else { render(); }
    } else {
      const changed = settings.opponent !== name;
      settings.opponent = name;
      saveSettings();
      if (changed || G.mode !== 'duo') { if (G.mode !== 'duo') setMode('duo'); else newGame(); } else render();
    }
    renderMatchup(); renderGames();
    if (G.mode === 'puzzle') renderPuzzleCard();
  }

  function bindWelcome() {
    $('welcome-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = $('welcome-name').value;
      const n = cleanName(raw);
      if (!n) { $('welcome-error').textContent = t('welcome.errEmpty'); $('welcome-name').focus(); return; }
      if (welcome.kind === 'opponent' && settings.me && n.toLowerCase() === settings.me.toLowerCase()) {
        $('welcome-error').textContent = t('welcome.errSame', { name: settings.me }); return;
      }
      const isNew = !players.some((x) => x.toLowerCase() === n.toLowerCase());
      pickPlayer(addPlayer(n), isNew);
    });
    $('welcome-cancel').addEventListener('click', () => {
      const kind = welcome.kind;
      closeWelcome();
      if (kind === 'opponent' && G.mode === 'duo' && !settings.opponent) setMode('cpu');
    });
    for (const b of document.querySelectorAll('#game-pick .tile')) b.addEventListener('click', () => chooseGame(b.dataset.game));
    $('btn-profile').addEventListener('click', () => openWelcome('me', true));
    $('who-1').addEventListener('click', () => openWelcome('opponent', true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && welcome && welcome.cancelable && !welcome.picking) $('welcome-cancel').click(); });
  }

  function renderMatchup() {
    const duo = G.mode === 'duo';
    const me = settings.me || t('name.you');
    $('who-0').innerHTML = avatarHtml(me) + '<span>' + me + '</span>';
    $('who-1').hidden = !duo;
    if (duo && settings.opponent) $('who-1').innerHTML = avatarHtml(settings.opponent) + '<span>' + settings.opponent + '</span><span class="caret" aria-hidden="true">▾</span>';
    $('who-end').hidden = duo;
    $('btn-profile').innerHTML = avatarHtml(me) + '<span class="profile-name">' + me + '</span><span class="caret" aria-hidden="true">▾</span>';
  }

  // ---------- games played ----------
  function gamesFor(name) { return games.filter((g) => (g.game || 'awale') === 'awale' && g.players.some((p, i) => p === name && g.computer !== i)); }
  function focusPlayer() { return settings.me || t('name.you'); }

  function renderGames() {
    const name = focusPlayer();
    const list = gamesFor(name);
    $('games-count').textContent = '(' + name + ': ' + list.length + ')';
    let wins = 0, losses = 0, draws = 0, traps = 0, moves = 0;
    for (const g of list) {
      const seat = g.players[0] === name ? 0 : 1;
      if (g.result.winner == null) draws++; else if (g.result.winner === seat) wins++; else losses++;
      for (const tu of g.turns) if (tu.p === seat) { moves++; if (tu.trap) traps++; }
    }
    $('games-stats').textContent = list.length
      ? t('games.stats', { name, w: wins, l: losses, d: draws ? t('games.drew', { n: draws }) : '', t: traps, m: moves })
      : t('games.none', { name });
    $('games-list').innerHTML = list.slice(-12).reverse().map((g) => {
      const seat = g.players[0] === name ? 0 : 1;
      const vs = g.computer != null ? t('games.vsCpu', { level: g.level ? t('level.' + g.level) : '' }) : t('games.vs', { name: g.players[1 - seat] });
      const res = g.result.winner == null ? 'draw' : g.result.winner === seat ? 'won' : 'lost';
      const d = new Date(g.date);
      const myTraps = g.turns.filter((tu) => tu.p === seat && tu.trap).length;
      return '<li><span class="g-res g-' + res + '">' + t('games.' + res) + '</span><span>' + vs + ', ' +
        g.result.stores[seat] + '–' + g.result.stores[1 - seat] + '</span><span class="g-meta">' +
        d.toLocaleDateString(I18n.lang, { day: 'numeric', month: 'short' }) + ' · ' + t(myTraps === 1 ? 'games.trap1' : 'games.trapN', { n: myTraps }) + '</span></li>';
    }).join('');
    $('games-clear').hidden = !list.length;
    $('games-clear').textContent = t('games.clear', { name });
    $('games-copy').disabled = !games.length;
  }

  function bindGames() {
    let armed = false;
    $('games-copy').addEventListener('click', () => {
      const aw = games.filter((g) => (g.game || 'awale') === 'awale');
      const text = JSON.stringify({ format: 'awale-games-v1', players, games: aw }, null, 1);
      const msg = $('games-msg');
      const done = () => { msg.textContent = t('games.copied', { n: aw.length }); };
      try {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, msg));
      } catch (e) { fallbackCopy(text, msg); }
    });
    $('games-clear').addEventListener('click', () => {
      const btn = $('games-clear');
      const name = focusPlayer();
      if (!armed) { armed = true; btn.textContent = t('games.clearConfirm', { name }); btn.classList.add('warn'); return; }
      armed = false; btn.classList.remove('warn');
      games = games.filter((g) => !gamesFor(name).includes(g));
      saveJSON('awale.games', games);
      $('games-msg').textContent = t('games.deleted');
      renderGames();
    });
    $('games-card').addEventListener('toggle', () => { armed = false; $('games-clear').classList.remove('warn'); renderGames(); });
    renderGames();
  }

  function fallbackCopy(text, msg) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.className = 'copybox'; ta.readOnly = true;
    msg.textContent = t('games.copyManual');
    msg.appendChild(ta);
    ta.focus(); ta.select();
  }

  function startRecording(first) {
    G.warnedThisTurn = null;
    if (isPractice()) { G.rec = null; return; }
    G.rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: new Date().toISOString(),
      mode: G.mode,
      level: G.mode === 'cpu' ? settings.level : null,
      players: [playerName(0), playerName(1)],
      computer: G.mode === 'cpu' ? 1 : null,
      first,
      turns: [],
      undos: 0,
      warnings: settings.coach,
      result: null,
    };
  }

  function recordTurn(info, trap) {
    if (!G.rec) return;
    const human = G.mode === 'duo' || info.player === 0;
    G.rec.turns.push({
      p: info.player,
      pit: info.pit,
      took: info.captured,
      trap: human && trap && trap.mine.pit === info.pit ? trap.kind : null,
      better: human && trap && trap.mine.pit === info.pit ? trap.better.pit : null,
      warned: human ? G.warnedThisTurn || null : null,
    });
    G.warnedThisTurn = null;
    if (G.state.result) saveGame();
  }

  function saveGame() {
    if (!G.rec || !G.state.result) return;
    const r = G.state.result;
    G.rec.result = { winner: r.winner, reason: r.reason, stores: r.stores.slice() };
    G.rec.ended = new Date().toISOString();
    const rec = JSON.parse(JSON.stringify(G.rec));
    const i = games.findIndex((g) => g.id === rec.id);
    if (i >= 0) games[i] = rec; else games.push(rec);
    if (games.length > 300) games = games.slice(-300);
    saveJSON('awale.games', games);
    renderGames();
  }

  function snapshotForUndo() {
    G.undo.push({ state: E.cloneState(G.state), result: G.state.result, history: Object.assign({}, G.history), log: G.log.slice(),
      turns: G.rec ? G.rec.turns.length : 0 });
    if (G.undo.length > 200) G.undo.shift();
  }

  async function commitMove(pit, trap) {
    const my = token;
    const s = G.state;
    if (!isPractice() && (G.mode === 'duo' || s.toMove === 0)) snapshotForUndo();
    G.selected = null; G.hover = null; G.pending = null; G.coachNote = null;
    if (G.mode === 'duo' || s.toMove === 0) G.afterNote = null;
    const { state: next, info } = E.applyMove(s, pit, G.history);
    G.busy = true;
    await animate(s, info, my);
    if (my !== token) return;
    G.busy = false;
    G.display = null; G.displayStores = null;
    G.state = next;
    G.log.push({ player: info.player, text: () => logText(info, trap) });
    recordTurn(info, trap);
    renderLog();

    if (G.mode === 'learn') { checkLesson(info); render(); return; }
    if (G.mode === 'puzzle') { await checkPuzzle(info, s, my); return; }
    if (settings.coach && trap && trap.mine.pit === info.pit) {
      G.afterNote = () => {
        const head = trap.kind === 'danger' ? t('after.danger', { opp: oppWords(info.player), n: seedsWord(trap.mine.risk) })
          : trap.kind === 'grand-slam' ? t('after.slam')
            : t('after.missed', { n: seedsWord(trap.better.take) });
        return '<p class="alert-title">' + cap(head) + '</p><p class="alert-cost">' + t('after.undo') + '</p>';
      };
    }
    if (G.mode === 'cpu' && info.player === 1 && !next.result) {
      const canWin = Coach.biggestCapture(next).captured > 0;
      G.coachNote = () => '<p>' + (info.captured ? t('cpu.playedTook', { pit: pitTag(info.pit), n: seedsWord(info.captured) }) : t('cpu.played', { pit: pitTag(info.pit) })) +
        ' ' + t('cpu.yourTurn') + '</p>' + (canWin ? '<p>' + t('cpu.canWin') + '</p>' : '');
    }
    render();
    refreshAnalysis();
    if (G.mode === 'cpu' && !next.result && next.toMove === 1) computerTurn();
  }

  function logText(info, trap) {
    let txt = sideName(info.player) + ': ' + N[info.pit];
    if (info.captured) txt += t('log.won', { n: seedsWord(info.captured) });
    if (info.grandSlam) txt += t('log.slam');
    if (trap && trap.mine.pit === info.pit) txt += trap.kind === 'danger' ? t('log.risky') : trap.kind === 'missed' ? t('log.missed') : '';
    return txt;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function animate(before, info, my) {
    const speed = reduceMotion ? 0 : parseInt(settings.speed, 10);
    if (speed === 0) return;
    G.display = before.board.slice();
    G.displayStores = before.stores.slice();
    G.display[info.pit] = 0;
    G.anim = { pit: info.pit, visited: [], current: null, flash: [], blocked: [] };
    render();
    try {
      for (const p of info.sown) {
        await sleep(speed);
        if (my !== token) return;
        G.display[p]++;
        if (G.anim.current != null) G.anim.visited.push(G.anim.current);
        G.anim.current = p;
        render();
      }
      if (info.captures.length || info.blockedCaptures.length) {
        await sleep(speed * 1.5);
        if (my !== token) return;
        G.anim.flash = info.captures.map((c) => c.pit);
        G.anim.blocked = info.blockedCaptures.map((c) => c.pit);
        render();
        await sleep(Math.max(600, speed * 3));
        if (my !== token) return;
        for (const c of info.captures) G.display[c.pit] = 0;
        G.displayStores[info.player] += info.captured;
        G.anim.flash = [];
        render();
        if (info.captured) {
          const st = $('store-' + info.player);
          st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump');
        }
      }
      await sleep(speed);
    } finally {
      if (my === token) G.anim = null;
    }
  }

  async function computerTurn() {
    const my = token;
    render();
    const started = Date.now();
    const choice = await Opp.chooseMove(G.state, settings.level, { adaptive: settings.adaptive });
    const wait = Math.max(0, 550 - (Date.now() - started));
    await sleep(reduceMotion ? 0 : wait);
    if (my !== token || G.mode !== 'cpu') return;
    commitMove(choice.pit, null);
  }

  // ---------- lessons ----------
  function loadLesson(i) {
    token++;
    G.lesson = Math.max(0, Math.min(LESSONS.length - 1, i));
    const L = LESSONS[G.lesson];
    G.state = { board: L.board.slice(), stores: L.stores.slice(), toMove: 0 };
    G.history = { [E.positionKey(G.state)]: 1 };
    G.undo = []; G.log = []; G.lessonOutcome = null;
    resetTransient();
    renderLessonText();
    renderLog();
    render();
    refreshAnalysis();
  }

  function renderLessonText() {
    const L = LESSONS[G.lesson];
    const tx = I18n.lessonText(L.id);
    $('lesson-step').textContent = t('lesson.step', { n: G.lesson + 1, total: LESSONS.length });
    $('lesson-title').textContent = tx.title;
    $('lesson-intro').textContent = tx.intro;
    $('lesson-task').textContent = tx.task;
    $('lesson-prev').disabled = G.lesson === 0;
    $('lesson-next').textContent = t(G.lesson === LESSONS.length - 1 ? 'lesson.last' : 'lesson.next');
    const box = $('lesson-result');
    const o = G.lessonOutcome;
    box.hidden = !o;
    if (o) {
      box.className = 'lesson-result ' + (o.ok ? 'ok' : 'fail');
      box.textContent = o.ok ? tx.success
        : o.slam ? t('lesson.failSlam')
          : o.captured ? t('lesson.failMore', { n: seedsWord(o.captured) })
            : t('lesson.failNone');
    }
    renderDots();
  }

  function renderDots() {
    $('lesson-dots').innerHTML = LESSONS.map((L, k) =>
      '<li class="' + (k === G.lesson ? 'current' : G.lessonsDone.has(k) ? 'done' : '') + '" title="' + I18n.lessonText(L.id).title + '"></li>').join('');
  }

  function checkLesson(info) {
    const L = LESSONS[G.lesson];
    let ok = true;
    if (L.goal.type === 'capture') ok = info.captured >= L.goal.min;
    G.lessonOutcome = { ok, slam: info.grandSlam, captured: info.captured };
    if (ok) G.lessonsDone.add(G.lesson);
    renderLessonText();
  }

  // ---------- puzzles ----------
  // Progress is kept per player in this browser: best stars per puzzle and the days the
  // daily puzzle was solved (for the streak).
  const PUZZLES = Awale.PUZZLES;
  const PZ = { index: 0, outcome: null, tries: 0, hints: 0, shown: false };

  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dailyIndex() {
    const d = new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5) % PUZZLES.length;
  }
  function progress() {
    const all = loadJSON('awale.puzzles', {});
    const pr = all[focusPlayer()] || {};
    return { stars: pr.stars || {}, daily: pr.daily || {} };
  }
  function saveProgress(pr) {
    const all = loadJSON('awale.puzzles', {});
    all[focusPlayer()] = pr;
    saveJSON('awale.puzzles', all);
  }
  function streak(pr) {
    const d = new Date();
    if (!pr.daily[dayKey(d)]) d.setDate(d.getDate() - 1); // today not done yet: count up to yesterday
    let n = 0;
    while (pr.daily[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function startPuzzleIndex() {
    const pr = progress();
    if (!pr.daily[dayKey(new Date())]) return dailyIndex();
    const open = PUZZLES.findIndex((p) => !pr.stars[p.id]);
    return open >= 0 ? open : dailyIndex();
  }
  function nextPuzzleIndex() {
    const pr = progress();
    for (let k = 1; k <= PUZZLES.length; k++) {
      const i = (PZ.index + k) % PUZZLES.length;
      if (!pr.stars[PUZZLES[i].id]) return i;
    }
    return (PZ.index + 1) % PUZZLES.length;
  }
  function starsHtml(n, small) {
    let h = '<span class="stars' + (small ? ' small' : '') + '" aria-label="' + n + '/3">';
    for (let k = 1; k <= 3; k++) h += '<i class="' + (k <= n ? 'on' : '') + '">★</i>';
    return h + '</span>';
  }

  /** keep = retrying the same puzzle: earlier tries and hints still count for the stars. */
  function loadPuzzle(i, keep) {
    token++;
    PZ.index = (i + PUZZLES.length) % PUZZLES.length;
    PZ.outcome = null;
    if (!keep) { PZ.tries = 0; PZ.hints = 0; PZ.shown = false; }
    const pz = PUZZLES[PZ.index];
    G.state = { board: pz.board.slice(), stores: pz.stores.slice(), toMove: 0 };
    G.history = { [E.positionKey(G.state)]: 1 };
    G.undo = []; G.log = [];
    resetTransient();
    renderPuzzleCard();
    renderLog();
    render();
  }

  function renderPuzzleCard() {
    const pz = PUZZLES[PZ.index];
    const pr = progress();
    const solved = PUZZLES.filter((p) => pr.stars[p.id]).length;
    const isDaily = PZ.index === dailyIndex();
    const st = streak(pr);
    $('pz-step').textContent = t('puzzle.count', { n: PZ.index + 1, total: PUZZLES.length });
    $('pz-daily').hidden = !isDaily;
    $('pz-daily').textContent = t('puzzle.daily');
    $('pz-streak').hidden = st === 0;
    $('pz-streak').textContent = t(st === 1 ? 'puzzle.streak1' : 'puzzle.streak', { n: st });
    $('pz-title').textContent = t('puzzle.type.' + pz.type);
    $('pz-task').textContent = t('puzzle.task.' + pz.type);
    $('pz-best').innerHTML = pr.stars[pz.id] ? starsHtml(pr.stars[pz.id]) : '';
    $('pz-progress').textContent = t('puzzle.solvedCount', { n: solved, total: PUZZLES.length });
    $('pz-today').hidden = isDaily;
    $('pz-today').textContent = t('puzzle.daily');
    $('pz-grid').innerHTML = PUZZLES.map((p, i) =>
      '<button class="pz-tile' + (i === PZ.index ? ' current' : '') + (i === dailyIndex() ? ' daily' : '') +
      (pr.stars[p.id] ? ' solved s' + pr.stars[p.id] : '') + '" data-i="' + i + '" aria-label="' +
      t('puzzle.count', { n: i + 1, total: PUZZLES.length }) + '">' + (i + 1) + '</button>').join('');
    for (const b of $('pz-grid').querySelectorAll('button')) b.onclick = () => loadPuzzle(+b.dataset.i);
  }

  function lostAfter(state, pit) {
    return Coach.looksAt(state).find((l) => l.pit === pit);
  }

  async function checkPuzzle(info, before, my) {
    const pz = PUZZLES[PZ.index];
    const ok = info.pit === pz.answer;
    PZ.tries++;
    const ans = lostAfter(before, pz.answer);
    if (ok) {
      const stars = PZ.shown ? 0 : PZ.tries === 1 && PZ.hints === 0 ? 3 : PZ.tries <= 2 && PZ.hints <= 1 ? 2 : 1;
      PZ.outcome = { ok: true, stars, shown: PZ.shown };
      if (!PZ.shown) {
        const pr = progress();
        pr.stars[pz.id] = Math.max(pr.stars[pz.id] || 0, stars);
        if (PZ.index === dailyIndex()) pr.daily[dayKey(new Date())] = true;
        saveProgress(pr);
      }
      const bait = pz.type === 'greedy' ? Coach.looksAt(before).filter((l) => l.take > ans.take).sort((a, b) => a.net - b.net)[0] : null;
      G.coachNote = () => '<p class="lead">' + (bait
        ? t('puzzle.whyGreedy', { pit: pitTag(bait.pit), n: seedsWord(bait.take), r: seedsWord(bait.risk) })
        : t(ans.take ? 'hint.winSafe' : 'hint.safe', { n: seedsWord(ans.take) })) + '</p>';
      renderPuzzleCard();
      render();
      return;
    }
    // Wrong: explain, and if the move leaves seeds hanging, let the opponent actually take them.
    const mine = lostAfter(before, info.pit);
    PZ.outcome = { ok: false };
    G.coachNote = () => puzzleFeedback(pz, before, info, mine, ans);
    render();
    if (mine.risk >= 2 && mine.riskFrom != null && !G.state.result) {
      await sleep(reduceMotion ? 0 : 700);
      if (my !== token) return;
      const prev = G.state;
      const r = E.applyMove(prev, mine.riskFrom, G.history);
      G.busy = true;
      await animate(prev, r.info, my);
      if (my !== token) return;
      G.busy = false; G.display = null; G.displayStores = null;
      G.state = r.state;
      render();
    }
  }

  /**
   * Why the chosen move is worse, in three short parts: what it did, what it gave away,
   * and what the best move achieves (without saying which pit it is), plus a tip.
   */
  function puzzleFeedback(pz, before, info, mine, ans) {
    const out = [];
    // 1. What the move did.
    if (mine.take) out.push(t('pz.fb.took', { n: seedsWord(mine.take) }));
    else if (E.owner(info.last) === 0) out.push(t('describe.own'));
    else {
      const k = before.board[info.last] + info.sown.filter((q) => q === info.last).length;
      out.push(t('describe.noWin', { p: N[info.last], k }));
    }
    // 2. What it gave away.
    if (mine.risk >= 2 && mine.riskFrom != null) {
      const pits = mine.riskPits.map((c) => '<b class="mono">' + N[c.pit] + '</b>');
      const list = pits.length === 1 ? t('pz.pit1', { p: pits[0] })
        : t('pz.pitN', { list: pits.slice(0, -1).join(', ') + ' ' + t('pz.and') + ' ' + pits[pits.length - 1] });
      out.push(t(mine.take ? 'pz.fb.risk' : 'pz.fb.riskAlso', { pits: list, from: pitTag(mine.riskFrom), n: seedsWord(mine.risk) }) +
        (mine.take ? ' ' + t('trap.dangerMore', { n: seedsWord(mine.take) }) : ''));
    }
    // 3. What is possible instead.
    out.push(ans.take ? t('pz.fb.best', { n: seedsWord(ans.take) }) : t('pz.fb.bestSafe'));
    const score = (label, l) => '<span class="pz-score-label">' + label + '</span><span>' +
      t('pz.fb.winLose', { a: l.take, b: l.risk }) + '</span>';
    return out.map((l, k) => '<p' + (k === 0 ? ' class="lead"' : '') + '>' + l + '</p>').join('') +
      '<div class="pz-score">' + score(t('pz.fb.yours'), mine) + score(t('pz.fb.bestLabel'), ans) + '</div>' +
      '<p class="pz-tip"><span class="tag best">' + t('pz.fb.tipLabel') + '</span> ' + t('pz.fb.tip.' + pz.type) + '</p>';
  }

  function puzzleHint() {
    const pz = PUZZLES[PZ.index];
    PZ.hints++;
    if (PZ.hints === 1) {
      G.coachNote = () => '<p class="lead">' + t('puzzle.hint.' + pz.type) + '</p>';
      render();
      return;
    }
    G.coachNote = () => '<p class="lead">' + t('hint.try', { pit: pitTag(pz.answer) }) + '</p>';
    render();
    const el = pitEls[pz.answer];
    el.classList.remove('hint'); void el.offsetWidth; el.classList.add('hint');
  }

  function showAnswer() {
    const keep = PZ.index;
    loadPuzzle(keep, true);
    PZ.shown = true;
    const pz = PUZZLES[keep];
    G.coachNote = () => '<p class="lead">' + t('puzzle.answer', { pit: pitTag(pz.answer) }) + '</p><p>' + t('puzzle.playIt') + '</p>';
    render();
    const el = pitEls[pz.answer];
    el.classList.remove('hint'); void el.offsetWidth; el.classList.add('hint');
  }

  function bindPuzzles() {
    $('pz-prev').onclick = () => loadPuzzle(PZ.index - 1);
    $('pz-next-card').onclick = () => loadPuzzle(PZ.index + 1);
    $('pz-today').onclick = () => loadPuzzle(dailyIndex());
  }

  // ---------- games ----------
  function newGame() {
    token++;
    const first = G.mode === 'cpu' ? parseInt(settings.first, 10) : 0;
    G.state = E.newGame(first);
    G.history = { [E.positionKey(G.state)]: 1 };
    G.undo = []; G.log = [];
    startRecording(first);
    resetTransient();
    renderLog();
    render();
    refreshAnalysis();
    if (G.mode === 'cpu' && G.state.toMove === 1) computerTurn();
  }

  function resetTransient() {
    G.busy = false; G.display = null; G.displayStores = null; G.pending = null; G.anim = null;
    G.hover = null; G.selected = null; G.analysis = null; G.analysisKey = null; G.coachNote = null; G.afterNote = null;
  }

  function undo() {
    if (!G.undo.length || G.busy) return;
    token++;
    const u = G.undo.pop();
    G.state = u.state; G.state.result = undefined; delete G.state.result;
    G.history = u.history; G.log = u.log;
    if (G.rec) { G.rec.turns.length = u.turns; G.rec.undos++; }
    resetTransient();
    renderLog();
    render();
    refreshAnalysis();
  }

  function hint() {
    if (!isHumanTurn()) return;
    if (G.mode === 'puzzle') { puzzleHint(); return; }
    const looks = Coach.looksAt(G.state);
    const b = Coach.simpleBest(looks);
    const el = pitEls[b.pit];
    const key = b.take && b.risk === 0 ? 'hint.winSafe' : b.take ? 'hint.win' : b.risk === 0 ? 'hint.safe' : 'hint.fewer';
    G.coachNote = () => '<p class="lead">' + t('hint.try', { pit: pitTag(b.pit) }) + '</p><p>' + t(key, { n: seedsWord(b.take) }) + '</p>';
    render();
    el.classList.remove('hint'); void el.offsetWidth; el.classList.add('hint');
  }

  function splitEnd() {
    if (G.state.result || G.busy) return;
    token++;
    snapshotForUndo();
    const r = E.finishBySplit(G.state, 'agreed');
    G.state = Object.assign(E.cloneState(G.state), { result: r });
    saveGame();
    resetTransient();
    render();
  }

  // The video tab is a separate view; the game keeps its own mode underneath.
  function showVideo(show) {
    $('video-view').hidden = !show;
    $('layout').hidden = show;
    if (!show) $('rules-video').pause();
    for (const b of document.querySelectorAll('.modes button')) {
      b.setAttribute('aria-selected', String(show ? b.dataset.mode === 'video' : b.dataset.mode === G.mode));
    }
    try { history.replaceState(null, '', '#' + (show ? 'video' : G.mode)); } catch (e) { /* ignore */ }
  }

  function setMode(mode) {
    if (mode === 'puzzle' && !PREMIUM) mode = 'learn';
    if (mode === 'video') { showVideo(true); return; }
    if (!$('video-view').hidden) showVideo(false);
    if (mode === 'duo' && !settings.opponent && settings.me) {
      // Need a second player first; the welcome screen calls setMode('duo') again once picked.
      G.mode = G.mode || 'learn';
      openWelcome('opponent', true);
      return;
    }
    G.mode = mode;
    for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    const practice = isPractice();
    $('lesson-card').hidden = mode !== 'learn';
    $('puzzle-card').hidden = mode !== 'puzzle';
    $('difficulty').hidden = mode !== 'cpu';
    $('matchup').hidden = practice;
    renderMatchup();
    $('btn-warn').hidden = practice;
    // Lessons and puzzles don't record games or need settings; keep only the card and the rules.
    for (const id of ['games-card', 'moves', 'settings']) $(id).hidden = practice;
    renderLevelNote();
    $('field-first').hidden = mode !== 'cpu';
    if (mode === 'learn') loadLesson(G.lesson);
    else if (mode === 'puzzle') loadPuzzle(startPuzzleIndex());
    else newGame();
    try { if (location.hash.slice(1) !== mode) history.replaceState(null, '', '#' + mode); } catch (e) { /* ignore */ }
  }

  // ---------- wiring ----------
  function renderLevelNote() {
    $('difficulty-note').textContent = t('level.note.' + settings.level);
    $('field-adaptive').hidden = G.mode !== 'cpu' || settings.level === 'hard';
  }

  // ---------- language ----------
  function applyStatic() {
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    document.documentElement.lang = I18n.lang;
    const sel = $('lang-select');
    sel.innerHTML = I18n.LANGS.map((l) => '<option value="' + l.id + '">' + l.short + '</option>').join('');
    sel.value = I18n.lang;
    $('welcome-langs').innerHTML = I18n.LANGS.map((l) =>
      '<button class="lang-btn" data-lang="' + l.id + '" aria-pressed="' + (l.id === I18n.lang) + '">' + l.label + '</button>').join('');
    for (const b of $('welcome-langs').querySelectorAll('button')) b.onclick = () => setLanguage(b.dataset.lang);
  }

  function setLanguage(l) {
    I18n.setLang(l);
    settings.lang = I18n.lang;
    saveSettings();
    applyStatic();
    setVideoSource();
    renderLevelNote();
    syncWarn();
    renderMatchup();
    renderGames();
    renderLog();
    if (G.mode === 'learn' && G.state) renderLessonText();
    if (G.mode === 'puzzle' && G.state) renderPuzzleCard();
    if (G.state) render();
    if (welcome) renderWelcome();
  }

  // ---------- rules video (Learn tab) ----------
  function setVideoSource() {
    const v = $('rules-video');
    const src = 'video/awale-rules-' + I18n.lang + '.mp4';
    if (v.dataset.src === src) return;
    const wasPlaying = !v.paused;
    v.dataset.src = src;
    v.poster = 'video/awale-rules-' + I18n.lang + '.jpg';
    v.src = src;
    if (wasPlaying) v.play().catch(() => {});
  }

  function bindVideo() {
    $('video-start').addEventListener('click', () => setMode('learn'));
    setVideoSource();
  }

  let syncWarn = () => {};

  function bindSettings() {
    const bind = (id, key, isCheck) => {
      const el = $(id);
      if (isCheck) el.checked = !!settings[key]; else el.value = settings[key];
      el.addEventListener('change', () => {
        settings[key] = isCheck ? el.checked : el.value;
        saveSettings();
        if (key === 'first' && G.mode === 'cpu' && G.log.length === 0) newGame();
        render();
      });
    };
    bind('opt-adaptive', 'adaptive', true);
    const levelBtns = document.querySelectorAll('#difficulty button');
    const syncLevel = () => levelBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === settings.level)));
    levelBtns.forEach((b) => b.addEventListener('click', () => { settings.level = b.dataset.level; saveSettings(); syncLevel(); renderLevelNote(); }));
    syncLevel();
    renderLevelNote();
    bindWelcome();
    bindGames();
    bindPuzzles();
    const warn = $('btn-warn');
    syncWarn = () => { warn.setAttribute('aria-checked', String(!!settings.coach)); $('warn-state').textContent = t(settings.coach ? 'warn.on' : 'warn.off'); };
    warn.addEventListener('click', () => {
      settings.coach = !settings.coach; saveSettings(); syncWarn();
      if (!settings.coach) { G.pending = null; G.afterNote = null; }
      render();
    });
    syncWarn();
    bind('opt-ratings', 'ratings', true); bind('opt-speed', 'speed'); bind('opt-first', 'first');
  }

  function start() {
    $('mode-puzzle').hidden = !PREMIUM;
    $('games-copy').hidden = !PREMIUM;
    I18n.setLang(settings.lang || I18n.detect());
    applyStatic();
    bindVideo();
    $('lang-select').addEventListener('change', (e) => setLanguage(e.target.value));
    buildBoard();
    bindSettings();
    for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
    $('btn-new').onclick = newGame;
    $('end-new').onclick = newGame;
    $('btn-undo').onclick = undo;
    $('btn-hint').onclick = hint;
    $('btn-split').onclick = splitEnd;
    $('lesson-prev').onclick = () => loadLesson(G.lesson - 1);
    $('lesson-retry').onclick = () => loadLesson(G.lesson);
    $('lesson-next').onclick = () => (G.lesson === LESSONS.length - 1 ? setMode('cpu') : loadLesson(G.lesson + 1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (G.selected != null || G.pending)) { G.selected = null; G.pending = null; render(); }
    });
    window.addEventListener('resize', () => render());
    window.addEventListener('hashchange', () => {
      const m = location.hash.slice(1);
      if (m === 'video') setMode('video');
      else if (['learn', 'puzzle', 'cpu', 'duo'].includes(m) && m !== G.mode) setMode(m);
    });
    const m = location.hash.slice(1);
    const wanted = ['learn', 'puzzle', 'cpu', 'duo'].includes(m) ? m : 'learn';
    setMode(wanted === 'duo' && !settings.opponent ? 'cpu' : wanted);
    if (m === 'video') showVideo(true);
    // Netflix-style: start every visit by choosing who is playing, unless the player just
    // came over from the Bao page in this same visit.
    let ses = null;
    try { ses = sessionStorage.getItem('awale.session'); } catch (e) { /* ignore */ }
    if (ses && players.includes(ses)) { settings.me = ses; saveSettings(); renderMatchup(); renderGames(); }
    else openWelcome('me', false);
  }

  // Expose a tiny API for debugging and for plugging in a trained advisor later.
  window.AwaleApp = { get game() { return G; }, newGame, loadLesson, setMode };
  start();
})();
