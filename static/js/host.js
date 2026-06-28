/* ===== host.js — logique interface formateur ===== */
  // même origine que la page (test->test, prod->prod)



let sessionCode = null;
let sessionId = null;
let currentQuestion = null;
let questionIndex = 0;
let numChoices = 4;
let participantScores = {}; // { display_name: { correct: 0, total: 0 } }
let selectedCorrect = new Set();
let timerEnabled = false;
let timerInterval = null;
let ws = null;
let participants = [];
let questionHistory = [];

// ------- INIT -------

function renderChoicesGrid() {
  const letters = ['A','B','C','D','E','F'];
  const grid = document.getElementById('choices-grid');
  grid.innerHTML = '';
  for (let i = 0; i < numChoices; i++) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn' + (selectedCorrect.has(i) ? ' selected' : '');
    btn.textContent = letters[i];
    btn.onclick = () => toggleCorrect(i, btn);
    grid.appendChild(btn);
  }
}

function toggleCorrect(i, btn) {
  if (selectedCorrect.has(i)) {
    selectedCorrect.delete(i);
    btn.classList.remove('selected');
  } else {
    selectedCorrect.add(i);
    btn.classList.add('selected');
  }
}

function changeChoices(delta) {
  numChoices = Math.max(2, Math.min(6, numChoices + delta));
  document.getElementById('choices-count').textContent = numChoices;
  selectedCorrect.clear();
  renderChoicesGrid();
}

function toggleTimer() {
  timerEnabled = !timerEnabled;
  document.getElementById('timer-toggle').classList.toggle('on', timerEnabled);
  document.getElementById('timer-input').classList.toggle('visible', timerEnabled);
}

renderChoicesGrid();

// ------- BANK PICKER (mode live) -------

let bankQueue = [];
let bankSelectedModules = new Set();

function openBankPicker() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('bank-screen').style.display = 'flex';
  document.getElementById('bank-screen').style.flexDirection = 'column';
}

function closeBankPicker() {
  document.getElementById('bank-screen').style.display = 'none';
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('setup-screen').style.flexDirection = 'column';
}

let bankType = 'mix';  // mix | mcq | scenario

function toggleBankModule(chip) {
  const mod = chip.dataset.mod;
  if (bankSelectedModules.has(mod)) {
    bankSelectedModules.delete(mod);
    chip.classList.remove('selected-chip');
  } else {
    bankSelectedModules.add(mod);
    chip.classList.add('selected-chip');
  }
  updateBankModuleCount();
  updateBankPreview();
}

function selectBankType(type) {
  bankType = type;
  document.getElementById('bank-type-mix').classList.toggle('selected-type', type === 'mix');
  document.getElementById('bank-type-mcq').classList.toggle('selected-type', type === 'mcq');
  document.getElementById('bank-type-scenario').classList.toggle('selected-type', type === 'scenario');
  updateBankPreview();
}

function updateBankModuleCount() {
  const n = bankSelectedModules.size;
  document.getElementById('bank-module-count').textContent = `(${n} sélectionné${n > 1 ? 's' : ''})`;
}

// Construit la liste des catégories à charger selon modules + type choisis
function bankCategories() {
  const cats = [];
  bankSelectedModules.forEach(mod => {
    if (mod === 'az-900') { cats.push('az-900'); return; }
    if (bankType === 'mix' || bankType === 'mcq') cats.push(`az-900-module-${mod}-mcq`);
    if (bankType === 'mix' || bankType === 'scenario') cats.push(`az-900-module-${mod}-scenario`);
  });
  return cats;
}

// Met à jour l'aperçu du nombre total de questions (estimation rapide)
async function updateBankPreview() {
  const cats = bankCategories();
  if (cats.length === 0) {
    document.getElementById('bank-preview-count').textContent = '0';
    return;
  }
  const perModule = parseInt(document.getElementById('bank-per-module').value, 10) || 0;
  // Estimation : si perModule défini, c'est perModule × nb de modules ; sinon on charge pour compter
  if (perModule > 0) {
    document.getElementById('bank-preview-count').textContent = perModule * bankSelectedModules.size;
  } else {
    document.getElementById('bank-preview-count').textContent = '…';
  }
}

// Pioche aléatoirement les questions selon modules + type + nombre par module
async function pickBankQuestions() {
  const perModule = parseInt(document.getElementById('bank-per-module').value, 10) || 0;
  const picked = [];

  // On traite chaque module séparément pour appliquer le "N par module"
  for (const mod of bankSelectedModules) {
    const cats = [];
    if (mod === 'az-900') {
      cats.push('az-900');
    } else {
      if (bankType === 'mix' || bankType === 'mcq') cats.push(`az-900-module-${mod}-mcq`);
      if (bankType === 'mix' || bankType === 'scenario') cats.push(`az-900-module-${mod}-scenario`);
    }

    const results = await Promise.all(
      cats.map(c => fetch(`${API}/bank/questions?category=${encodeURIComponent(c)}`).then(r => r.json()))
    );
    let modQuestions = results.flat();
    shuffleArray(modQuestions);
    if (perModule > 0) modQuestions = modQuestions.slice(0, perModule);
    picked.push(...modQuestions);
  }
  return picked;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function launchFromBank() {
  if (bankSelectedModules.size === 0) {
    alert('Sélectionne au moins un module.');
    return;
  }
  const btn = document.querySelector('#bank-screen .btn-primary');
  btn.textContent = 'Création…';
  btn.disabled = true;

  // 1. Créer la session
  const res = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'live' })
  });
  const data = await res.json();
  sessionCode = data.code;
  sessionId = data.id;

  // 2. Piocher les questions selon modules + type + nombre par module
  bankQueue = await pickBankQuestions();
  if (bankQueue.length === 0) {
    alert('Aucune question trouvée pour cette sélection.');
    btn.textContent = 'Lancer la session →';
    btn.disabled = false;
    return;
  }
  shuffleArray(bankQueue);  // mélange final tous modules confondus

  // 3. Afficher l'UI session
  document.getElementById('nav-code').textContent = sessionCode;
  document.getElementById('bank-screen').style.display = 'none';
  document.getElementById('session-screen').style.display = 'flex';
  document.getElementById('session-screen').style.flexDirection = 'column';
  document.getElementById('qr-panel').style.display = 'block';
  document.getElementById('btn-end').style.display = 'block';

  const joinUrl = `${window.location.origin}/student.html?session=${sessionCode}`;
  document.getElementById('sidebar-code').textContent = sessionCode;
  document.getElementById('join-url-text').textContent = joinUrl;
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}&bgcolor=1a1a24&color=e8e8f0`;
  img.style.borderRadius = '8px';
  img.width = 180; img.height = 180;
  document.getElementById('qr-canvas').replaceWith(img);

  // 4. Remplacer le builder par le mode banque
  document.getElementById('question-builder').style.display = 'none';
  renderBankQueue();

  connectWS();
  btn.textContent = 'Lancer la session →';
  btn.disabled = false;
}

function renderBankQueue() {
  const existing = document.getElementById('bank-queue-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'bank-queue-panel';
  panel.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

  const header = document.createElement('div');
  header.style.cssText = 'font-family:var(--mono);font-size:0.7rem;color:var(--muted);letter-spacing:2px;';
  header.textContent = `FILE — ${bankQueue.length} QUESTION(S)`;
  panel.appendChild(header);

  if (bankQueue.length === 0) {
    const done = document.createElement('div');
    done.style.cssText = 'color:var(--green);font-size:0.9rem;padding:16px 0;';
    done.textContent = '✓ Toutes les questions ont été lancées.';
    panel.appendChild(done);
  } else {
    const next = bankQueue[0];
    const card = document.createElement('div');
    card.style.cssText = 'padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:0.9rem;line-height:1.5;';
    card.innerHTML = `<div style="color:var(--muted);font-family:var(--mono);font-size:0.7rem;margin-bottom:6px;">PROCHAINE QUESTION</div>${next.text}<div style="margin-top:8px;font-size:0.75rem;color:var(--muted);font-family:var(--mono);">${next.num_choices} choix</div>`;
    panel.appendChild(card);

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = `Lancer (${bankQueue.length} restante(s))`;
    btn.onclick = launchNextFromQueue;
    panel.appendChild(btn);
  }

  const sessionScreen = document.getElementById('session-screen');
  sessionScreen.insertBefore(panel, sessionScreen.firstChild.nextSibling);
}

async function launchNextFromQueue() {
  if (bankQueue.length === 0) return;
  const q = bankQueue.shift();
  questionIndex++;

  const res = await fetch(`${API}/sessions/${sessionCode}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_index: questionIndex,
      num_choices: q.num_choices,
      correct_choices: q.correct_choices,
      time_limit_seconds: null,
      question_text: q.text,
      choices_text: q.choices_text,
    })
  });
  const created = await res.json();
  await fetch(`${API}/sessions/${sessionCode}/questions/${created.id}/start`, { method: 'POST' });
  currentQuestion = { ...created, text: q.text, choices_text: q.choices_text };

  selectedCorrect = new Set(q.correct_choices);
  numChoices = q.num_choices;

  answerCount = 0;
  document.getElementById('bank-queue-panel').style.display = 'none';
  document.getElementById('stats-panel').style.display = 'none';

  const hostQ = document.getElementById('active-question');
  hostQ.style.display = 'flex';
  hostQ.style.flexDirection = 'column';
  document.getElementById('active-q-label').textContent = `Question #${questionIndex} — ${q.text}`;

  const existingChoices = document.getElementById('host-choices-display');
  if (existingChoices) existingChoices.remove();
  if (q.choices_text && q.choices_text.length) {
    const letters = ['A','B','C','D','E','F'];
    const div = document.createElement('div');
    div.id = 'host-choices-display';
    div.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:10px;font-size:0.85rem;';
    q.choices_text.forEach((txt, i) => {
      // Pas de coloration de la bonne réponse ici : on ne révèle rien tant que
      // le formateur n'a pas cliqué "Révéler les résultats" (écran suivant).
      div.innerHTML += `<div style="padding:8px 12px;border-radius:6px;background:var(--bg);border:1px solid var(--border);color:var(--text);">${letters[i]}. ${txt}</div>`;
    });
    hostQ.insertBefore(div, hostQ.querySelector('.answer-count'));
  }

  document.getElementById('answer-count-num').textContent = '0';
  document.getElementById('timer-display').style.display = 'none';
}

// ------- BATTLE PICKER -------

let battleQuestions = [];
let battleSelected = new Set();
let battleTimerEnabled = false;
let battleSessionCode = null;

function openBattlePicker() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('battle-screen').style.display = 'flex';
  document.getElementById('battle-screen').style.flexDirection = 'column';
}

function closeBattlePicker() {
  document.getElementById('battle-screen').style.display = 'none';
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('setup-screen').style.flexDirection = 'column';
}

function toggleBattleTimer() {
  battleTimerEnabled = !battleTimerEnabled;
  document.getElementById('battle-timer-toggle').classList.toggle('on', battleTimerEnabled);
  document.getElementById('battle-timer-input').style.display = battleTimerEnabled ? 'block' : 'none';
  document.getElementById('battle-timer-unit').style.display = battleTimerEnabled ? 'inline' : 'none';
  document.getElementById('battle-timer-label-txt').textContent = battleTimerEnabled ? '' : 'Désactivé';
}

async function loadBattleQuestions() {
  const cat = document.getElementById('battle-cat').value;
  const loading = document.getElementById('battle-bank-loading');
  const list = document.getElementById('battle-question-list');
  loading.style.display = 'block';
  list.innerHTML = '';
  battleQuestions = [];
  battleSelected.clear();
  updateBattleCount();

  const url = cat ? `${API}/bank/questions?category=${encodeURIComponent(cat)}` : `${API}/bank/questions`;
  const res = await fetch(url);
  battleQuestions = await res.json();
  loading.style.display = 'none';
  renderBattleList();
}

function renderBattleList() {
  const list = document.getElementById('battle-question-list');
  list.innerHTML = '';
  if (battleQuestions.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:0.9rem;padding:16px 0;">Aucune question trouvée.</div>';
    return;
  }
  battleQuestions.forEach(q => {
    const item = document.createElement('div');
    item.className = 'bank-item' + (battleSelected.has(q.id) ? ' selected' : '');
    item.innerHTML = `
      <input type="checkbox" ${battleSelected.has(q.id) ? 'checked' : ''} onchange="toggleBattleItem(${q.id}, this)">
      <div>
        <div class="bank-item-text">${q.text}</div>
        <div class="bank-item-meta">${q.category || ''} · ${q.num_choices} choix</div>
      </div>`;
    item.onclick = (e) => { if (e.target.tagName !== 'INPUT') { const cb = item.querySelector('input'); cb.checked = !cb.checked; toggleBattleItem(q.id, cb); } };
    list.appendChild(item);
  });
}

function toggleBattleItem(id, cb) {
  if (cb.checked) battleSelected.add(id);
  else battleSelected.delete(id);
  const item = cb.closest('.bank-item');
  item.classList.toggle('selected', cb.checked);
  updateBattleCount();
}

function toggleBattleSelectAll() {
  const allSelected = battleSelected.size === battleQuestions.length;
  battleSelected.clear();
  if (!allSelected) battleQuestions.forEach(q => battleSelected.add(q.id));
  renderBattleList();
  updateBattleCount();
}

function updateBattleCount() {
  document.getElementById('battle-selected-count').textContent = battleSelected.size;
}

async function launchBattle() {
  if (battleSelected.size === 0) {
    alert('Sélectionne au moins une question.');
    return;
  }
  const btn = document.querySelector('#battle-screen .btn-battle');
  btn.textContent = 'Création…';
  btn.disabled = true;

  // 1. Créer la session en mode battle
  const sRes = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'battle' })
  });
  const sData = await sRes.json();
  battleSessionCode = sData.code;
  sessionCode = sData.code;

  // 2. Préparer le payload de setup
  const selectedQs = battleQuestions.filter(q => battleSelected.has(q.id));
  const timeLimitSec = battleTimerEnabled
    ? parseInt(document.getElementById('battle-timer-input').value) * 60
    : null;

  const setupPayload = {
    time_limit_seconds: timeLimitSec,
    questions: selectedQs.map((q, i) => ({
      order_index: i + 1,
      num_choices: q.num_choices,
      correct_choices: q.correct_choices,
      bank_question_id: q.id,
      question_text: q.text,
      choices_text: q.choices_text,
    })),
  };

  // 3. Envoyer le setup au serveur
  await fetch(`${API}/sessions/${battleSessionCode}/battle/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setupPayload),
  });

  // 4. Afficher la salle d'attente host
  document.getElementById('nav-code').textContent = battleSessionCode;
  document.getElementById('battle-screen').style.display = 'none';
  document.getElementById('battle-waiting').style.display = 'flex';
  document.getElementById('battle-waiting').style.flexDirection = 'column';
  document.getElementById('qr-panel').style.display = 'block';
  document.getElementById('btn-end').style.display = 'block';

  const joinUrl = `${window.location.origin}/student.html?session=${battleSessionCode}`;
  document.getElementById('sidebar-code').textContent = battleSessionCode;
  document.getElementById('join-url-text').textContent = joinUrl;
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}&bgcolor=1a1a24&color=e8e8f0`;
  img.style.borderRadius = '8px';
  img.width = 180; img.height = 180;
  document.getElementById('qr-canvas').replaceWith(img);

  document.getElementById('battle-q-count').textContent = selectedQs.length;
  document.getElementById('battle-timer-display').textContent = timeLimitSec
    ? `${timeLimitSec / 60} min`
    : 'sans limite';

  connectWS();
  btn.textContent = 'Créer la session Battle →';
  btn.disabled = false;
}

async function startBattle() {
  const btn = document.getElementById('btn-start-battle');
  btn.textContent = 'Lancement…';
  btn.disabled = true;
  await fetch(`${API}/sessions/${battleSessionCode}/battle/start`, { method: 'POST' });
  btn.textContent = '✓ Battle lancée !';
  document.getElementById('battle-ranking-waiting').style.display = 'block';
}

async function forceRanking() {
  await fetch(`${API}/sessions/${battleSessionCode}/battle/ranking`, { method: 'POST' });
}

function showBattleRanking(ranking, isLive) {
  const medals = ['🥇','🥈','🥉'];
  const classes = ['gold','silver','bronze'];
  const table = document.getElementById('battle-ranking-table');
  table.innerHTML = '';

  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  ranking.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = `ranking-row ${classes[i] || ''}`;
    const elapsed = Math.round(entry.elapsed_seconds);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    const timeStr = min > 0 ? `${min}m${sec.toString().padStart(2,'0')}s` : `${sec}s`;
    row.innerHTML = `
      <span class="ranking-pos">${medals[i] || '#' + (i + 1)}</span>
      <span class="ranking-name">${esc(entry.display_name)}</span>
      <span class="ranking-score">${entry.score}/${entry.total}</span>
      <span class="ranking-time">${timeStr}</span>
    `;
    table.appendChild(row);
  });

  document.getElementById('battle-ranking-waiting').style.display = 'none';
  document.getElementById('battle-ranking-section').style.display = 'block';

  // Indicateur live vs final
  const titleEl = document.getElementById('battle-ranking-title');
  if (titleEl) {
    titleEl.textContent = isLive ? 'Classement en cours…' : 'Classement final';
  }
}

// ------- SESSION (live) -------

async function createSession(mode) {
  const res = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
  const data = await res.json();
  sessionCode = data.code;
  sessionId = data.id;

  document.getElementById('nav-code').textContent = sessionCode;
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('session-screen').style.display = 'flex';
  document.getElementById('session-screen').style.flexDirection = 'column';
  document.getElementById('qr-panel').style.display = 'block';
  document.getElementById('btn-end').style.display = 'block';
  const joinUrl = `${window.location.origin}/student.html?session=${sessionCode}`;
  document.getElementById('sidebar-code').textContent = sessionCode;
  document.getElementById('join-url-text').textContent = joinUrl;

  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}&bgcolor=1a1a24&color=e8e8f0`;
  img.style.borderRadius = '8px';
  img.width = 180;
  img.height = 180;
  document.getElementById('qr-canvas').replaceWith(img);

  connectWS();
}

// ------- WEBSOCKET -------

let answerCount = 0;

function connectWS() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${sessionCode}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'participant_join') {
      addParticipant(msg);
      // Mettre à jour le compteur battle si on est en salle d'attente battle
      document.getElementById('battle-joined-count').textContent = participants.length;
    } else if (msg.type === 'answer_received') {
      answerCount = msg.total_answers;
      document.getElementById('answer-count-num').textContent = answerCount;
    } else if (msg.type === 'battle_ranking') {
      showBattleRanking(msg.ranking, false);
    } else if (msg.type === 'battle_ranking_update') {
      showBattleRanking(msg.ranking, true);
    }
  };
}

// ------- PARTICIPANTS -------

function addParticipant(data) {
  if (participants.find(p => p.participant_id === data.participant_id)) return;
  participants.push(data);
  const count = document.getElementById('participant-count');
  count.textContent = participants.length;
  const list = document.getElementById('participants-list');
  if (list.querySelector('.empty-state')) list.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'participant-item';
  item.innerHTML = `<span class="participant-dot"></span>${escapeHtml(data.display_name || 'Anonyme')}`;
  list.appendChild(item);
}

// ------- QUESTION (live) -------

async function launchQuestion() {
  if (selectedCorrect.size === 0) {
    alert('Sélectionnez au moins une bonne réponse.');
    return;
  }

  questionIndex++;
  const timerSec = timerEnabled ? parseInt(document.getElementById('timer-input').value) : null;

  const res = await fetch(`${API}/sessions/${sessionCode}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_index: questionIndex,
      num_choices: numChoices,
      correct_choices: Array.from(selectedCorrect),
      time_limit_seconds: timerSec,
    })
  });
  const q = await res.json();

  await fetch(`${API}/sessions/${sessionCode}/questions/${q.id}/start`, { method: 'POST' });
  currentQuestion = q;
  answerCount = 0;

  document.getElementById('question-builder').style.display = 'none';
  document.getElementById('stats-panel').style.display = 'none';
  document.getElementById('active-question').style.display = 'flex';
  document.getElementById('active-question').style.flexDirection = 'column';
  document.getElementById('active-q-label').textContent = `Question #${questionIndex}`;
  document.getElementById('answer-count-num').textContent = '0';

  if (timerSec) startTimerDisplay(timerSec);
}

function startTimerDisplay(seconds) {
  const display = document.getElementById('timer-display');
  display.style.display = 'block';
  display.classList.remove('urgent');
  let remaining = seconds;

  const tick = () => {
    display.textContent = remaining + 's';
    if (remaining <= 5) display.classList.add('urgent');
    if (remaining <= 0) {
      clearInterval(timerInterval);
      display.textContent = '0s';
    }
    remaining--;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

async function revealQuestion() {
  clearInterval(timerInterval);
  const res = await fetch(`${API}/sessions/${sessionCode}/questions/${currentQuestion.id}/reveal`, {
    method: 'POST'
  });
  const stats = await res.json();
  showStats(stats);
}

function showStats(stats) {
  const letters = ['A','B','C','D','E','F'];
  document.getElementById('active-question').style.display = 'none';
  document.getElementById('stats-panel').style.display = 'flex';
  document.getElementById('stats-panel').style.flexDirection = 'column';

  document.getElementById('stat-correct').textContent = stats.correct_count;
  document.getElementById('stat-wrong').textContent = stats.total_answers - stats.correct_count;

  const bars = document.getElementById('stat-bars');
  bars.innerHTML = '';
  const total = stats.total_answers || 1;

  for (let i = 0; i < numChoices; i++) {
    const count = stats.choices_breakdown[i] || 0;
    const pct = Math.round((count / total) * 100);
    const isCorrect = selectedCorrect.has(i);
    const choiceText = (currentQuestion.choices_text && currentQuestion.choices_text[i]) || '';

    bars.innerHTML += `
      <div class="stat-bar-item">
        <div class="stat-bar-label">
          <span class="letter" style="${isCorrect ? 'color:var(--green);font-weight:600;' : ''}">${letters[i]}. ${choiceText}${isCorrect ? ' ✓' : ''}</span>
          <span class="count">${count} rép.</span>
        </div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill ${isCorrect ? 'correct' : ''}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  stats.results.forEach(r => {
    if (!participantScores[r.display_name]) {
      participantScores[r.display_name] = { correct: 0, total: 0 };
    }
    participantScores[r.display_name].total++;
    if (r.is_correct) participantScores[r.display_name].correct++;
  });

  const ladder = Object.entries(participantScores)
    .sort((a, b) => b[1].correct - a[1].correct);

  const oldDetail = document.getElementById('detail-participants');
  if (oldDetail) oldDetail.remove();

  let detail = '<div id="detail-participants" style="margin-top:16px;display:flex;flex-direction:column;gap:6px;">';
  detail += '<div style="font-family:var(--mono);font-size:0.7rem;color:var(--muted);letter-spacing:2px;margin-bottom:4px;">CLASSEMENT</div>';
  ladder.forEach(([name, score], index) => {
    const pct = Math.round((score.correct / score.total) * 100);
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
    detail += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg);border-radius:6px;font-size:0.85rem;">
      <span>${medal} ${name}</span>
      <span style="font-family:var(--mono);color:var(--green)">${score.correct}/${score.total} <span style="color:var(--muted)">(${pct}%)</span></span>
    </div>`;
  });
  detail += '</div>';
  bars.insertAdjacentHTML('afterend', detail);
}

function nextQuestion() {
  clearInterval(timerInterval);
  currentQuestion = null;
  selectedCorrect.clear();
  document.getElementById('stats-panel').style.display = 'none';
  document.getElementById('active-question').style.display = 'none';
  document.getElementById('timer-display').style.display = 'none';
  document.getElementById('timer-display').classList.remove('urgent');

  if (bankQueue !== undefined && document.getElementById('bank-queue-panel')) {
    document.getElementById('bank-queue-panel').style.display = 'flex';
    renderBankQueue();
  } else {
    document.getElementById('question-builder').style.display = 'flex';
    renderChoicesGrid();
  }
}

// ------- HISTORIQUE -------
renderChoicesGrid();

function endSession() {
  if (!confirm('Terminer la session ?')) return;
  location.reload();
}
