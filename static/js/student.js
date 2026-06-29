/* ===== student.js — logique interface joueur ===== */
  // même origine que la page (test->test, prod->prod)
const letters = ['A','B','C','D','E','F'];

let sessionCode = null;
let participantId = null;
let currentQuestion = null;
let selectedChoices = new Set();
let timerInterval = null;
let timerTotal = 0;
let ws = null;
let scoreCorrect = 0;
let scoreTotal = 0;
let mode = 'live'; // live | solo | battle

// Solo
let soloQuestions = [];
let soloIndex = 0;
let soloTimerEnabled = false;
let soloTheme = 'az-900';
let wrongAnswers = [];

// Battle
let battleQuestions = [];     // liste ordonnée reçue dans battle_start
let battleIndex = 0;          // index de la question en cours
let battleCorrect = 0;        // bonnes réponses accumulées
let battleSelectedChoices = new Set();
let battleGlobalTimerInterval = null;
let battleTimeUp = false;   // passe à true quand le timer global expire
let battleStartedAt = null;   // Date JS de début
let battleTimeLimitSec = null;
let battleDisplayName = '';
let isBattleHost = false;       // true si ce client a créé la battle
let battleHostPlayers = [];     // joueurs vus dans la salle d'attente créateur
// Config en cours de création
let battleCfgCount = 20;
let battleCfgTimerMin = null;   // minutes ou null

// ------- NAVIGATION -------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showJoin() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('session')) {
    document.getElementById('session-code-input').value = params.get('session').toUpperCase();
  }
  showScreen('screen-join');
}

function showSolo() { showScreen('screen-solo'); }

// ------- CONFIG & CRÉATION BATTLE (créateur) -------

function showBattleSetup() {
  updateBattleModuleCount();
  showScreen('screen-battle-setup');
}

function toggleBattleModule(el) {
  el.classList.toggle('selected-chip');
  updateBattleModuleCount();
}

function updateBattleModuleCount() {
  const n = document.querySelectorAll('#battle-module-grid .module-chip.selected-chip').length;
  document.getElementById('battle-module-count-label').textContent = `(${n} sélectionné${n > 1 ? 's' : ''})`;
}

function selectBattleCount(n) {
  battleCfgCount = n;
  [10, 20, 30].forEach(v => {
    document.getElementById('bn-' + v).classList.toggle('selected-theme', v === n);
  });
}

function selectBattleTimer(min) {
  battleCfgTimerMin = min;
  document.getElementById('bt-none').classList.toggle('selected-theme', min === null);
  document.getElementById('bt-5').classList.toggle('selected-theme', min === 5);
  document.getElementById('bt-10').classList.toggle('selected-theme', min === 10);
}

function getBattleSelectedCategories() {
  const chips = document.querySelectorAll('#battle-module-grid .module-chip.selected-chip');
  const cats = [];
  chips.forEach(chip => JSON.parse(chip.dataset.cats).forEach(c => cats.push(c)));
  return [...new Set(cats)];
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function createBattle() {
  const name = document.getElementById('battle-name-input').value.trim();
  if (!name) { alert('Entre ton prénom.'); return; }

  const categories = getBattleSelectedCategories();
  if (categories.length === 0) { alert('Sélectionne au moins un module.'); return; }

  const btn = document.getElementById('btn-create-battle');
  btn.textContent = 'Création…';
  btn.disabled = true;

  try {
    // 1. Charger les questions des catégories choisies
    const results = await Promise.all(
      categories.map(cat => fetch(`${API}/bank/questions?category=${encodeURIComponent(cat)}`).then(r => r.json()))
    );
    let pool = results.flat();

    // Dédoublonnage par id
    const seen = new Set();
    pool = pool.filter(q => { if (seen.has(q.id)) return false; seen.add(q.id); return true; });

    if (pool.length === 0) { alert('Aucune question disponible.'); btn.textContent = 'Créer la battle →'; btn.disabled = false; return; }

    // Mélanger et limiter au nombre choisi
    pool = shuffleArr(pool).slice(0, battleCfgCount);

    // 2. Créer la session en mode battle
    const sRes = await fetch(`${API}/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'battle' })
    });
    const sData = await sRes.json();
    sessionCode = sData.code;

    // 3. Setup des questions (chrono global converti en secondes)
    const timeLimitSec = battleCfgTimerMin ? battleCfgTimerMin * 60 : null;
    const setupPayload = {
      time_limit_seconds: timeLimitSec,
      questions: pool.map((q, i) => ({
        order_index: i + 1,
        num_choices: q.num_choices,
        correct_choices: q.correct_choices,
        bank_question_id: q.id,
        question_text: q.text,
        choices_text: q.choices_text,
      })),
    };
    await fetch(`${API}/sessions/${sessionCode}/battle/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setupPayload),
    });

    // 4. Le créateur rejoint aussi comme joueur
    const pRes = await fetch(`${API}/sessions/${sessionCode}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: name })
    });
    const pData = await pRes.json();
    participantId = pData.id;
    battleDisplayName = name;
    isBattleHost = true;
    battleHostPlayers = [];

    // 5. Afficher la salle d'attente créateur
    document.getElementById('battle-host-code').textContent = sessionCode;
    document.getElementById('battle-host-info').textContent =
      `${pool.length} questions · chrono : ${timeLimitSec ? battleCfgTimerMin + ' min' : 'aucun'}`;
    document.getElementById('battle-host-count').textContent = '0';
    document.getElementById('battle-host-players').innerHTML =
      '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:12px 0;">En attente…</div>';
    showScreen('screen-battle-host-waiting');

    connectWS();
  } catch (e) {
    alert('Erreur lors de la création : ' + e.message);
  }
  btn.textContent = 'Créer la battle →';
  btn.disabled = false;
}

function addBattleHostPlayer(name) {
  if (battleHostPlayers.includes(name)) return;
  battleHostPlayers.push(name);
  document.getElementById('battle-host-count').textContent = battleHostPlayers.length;
  const list = document.getElementById('battle-host-players');
  if (list.querySelector('div[style*="En attente"]')) list.innerHTML = '';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg);border-radius:6px;font-size:0.85rem;';
  row.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:var(--green);"></span>${escapeHtml(name)}`;
  list.appendChild(row);
}

async function hostStartBattle() {
  const btn = document.getElementById('btn-host-start-battle');
  btn.textContent = 'Lancement…';
  btn.disabled = true;
  await fetch(`${API}/sessions/${sessionCode}/battle/start`, { method: 'POST' });
  // Le créateur reçoit battle_start via son propre WebSocket et enchaîne sur le jeu.
}


window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('session')) showJoin();
  updateModuleCount();
  updateBattleModuleCount();
};

// ------- JOIN LIVE / BATTLE -------

async function joinSession() {
  const code = document.getElementById('session-code-input').value.trim().toUpperCase();
  const name = document.getElementById('name-input').value.trim();
  if (!code || !name) { alert('Code et prénom requis.'); return; }

  // Vérifier le mode de la session pour router vers battle ou live
  const sessionRes = await fetch(`${API}/sessions/${code}`);
  if (!sessionRes.ok) { alert('Session introuvable.'); return; }
  const sessionData = await sessionRes.json();

  const res = await fetch(`${API}/sessions/${code}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: name })
  });
  if (!res.ok) { alert('Impossible de rejoindre la session.'); return; }

  const data = await res.json();
  sessionCode = code;
  participantId = data.id;
  battleDisplayName = name;

  if (sessionData.mode === 'battle') {
    // --- Mode Battle : écran d'attente dédié ---
    mode = 'battle';
    document.getElementById('battle-waiting-code').textContent = code;
    document.getElementById('battle-waiting-info').textContent = 'En attente du lancement par le créateur…';
    showScreen('screen-battle-waiting');
    connectWS();
  } else {
    // --- Mode Live classique ---
    mode = 'live';
    document.getElementById('waiting-code').textContent = code;
    showScreen('screen-waiting');
    connectWS();
  }
}

// ------- SOLO -------

let soloQuestionType = 'all'; // all | mcq | scenario

function selectCert(cert) {
  document.getElementById('cert-az900').classList.toggle('selected-theme', cert === 'az-900');
}

function toggleModule(el) {
  el.classList.toggle('selected-chip');
  updateModuleCount();
}

function updateModuleCount() {
  const selected = document.querySelectorAll('#module-grid .module-chip.selected-chip').length;
  document.getElementById('module-count-label').textContent = `(${selected} sélectionné${selected > 1 ? 's' : ''})`;
}

function selectType(type) {
  soloQuestionType = type;
  document.getElementById('type-all').classList.toggle('selected-theme', type === 'all');
  document.getElementById('type-mcq').classList.toggle('selected-theme', type === 'mcq');
  document.getElementById('type-scenario').classList.toggle('selected-theme', type === 'scenario');
}

function selectTimerMode(withTimer) {
  soloTimerEnabled = withTimer;
  document.getElementById('mode-chrono').classList.toggle('selected-theme', withTimer);
  document.getElementById('mode-libre').classList.toggle('selected-theme', !withTimer);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getSeenIds(key) {
  try { return new Set(JSON.parse(localStorage.getItem(`seen_${key}`) || '[]')); }
  catch { return new Set(); }
}

function markSeen(key, id) {
  const seen = getSeenIds(key);
  seen.add(id);
  localStorage.setItem(`seen_${key}`, JSON.stringify([...seen]));
}

function getSelectedCategories() {
  const chips = document.querySelectorAll('#module-grid .module-chip.selected-chip');
  const cats = [];
  chips.forEach(chip => {
    const chipCats = JSON.parse(chip.dataset.cats);
    chipCats.forEach(c => {
      if (soloQuestionType === 'all') cats.push(c);
      else if (soloQuestionType === 'mcq' && (c.endsWith('-mcq') || c === 'az-900')) cats.push(c);
      else if (soloQuestionType === 'scenario' && c.endsWith('-scenario')) cats.push(c);
    });
  });
  return [...new Set(cats)];
}

async function startSolo() {
  const name = 'Joueur';  // solo : pas de prénom demandé (joueur unique)
  const skipSeen = document.getElementById('skip-seen').checked;
  const categories = getSelectedCategories();

  if (categories.length === 0) {
    alert('Sélectionne au moins un module.');
    return;
  }

  const sRes = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'solo' })
  });
  const session = await sRes.json();
  sessionCode = session.code;

  const pRes = await fetch(`${API}/sessions/${sessionCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: name })
  });
  const participant = await pRes.json();
  participantId = participant.id;
  mode = 'solo';

  const results = await Promise.all(
    categories.map(cat => fetch(`${API}/bank/questions?category=${encodeURIComponent(cat)}`).then(r => r.json()))
  );
  let questions = results.flat();

  const seen_ids = new Map();
  questions = questions.filter(q => { if (seen_ids.has(q.id)) return false; seen_ids.set(q.id, true); return true; });

  const seenKey = categories.sort().join('+');
  soloTheme = seenKey;

  if (skipSeen) {
    const seenSet = getSeenIds(seenKey);
    const unseen = questions.filter(q => !seenSet.has(q.id));
    if (unseen.length === 0) { localStorage.removeItem(`seen_${seenKey}`); }
    else { questions = unseen; }
  }

  soloQuestions = shuffle(questions);

  // Plafonner au nombre de questions demandé (vide = toutes)
  const countInput = document.getElementById('solo-count').value.trim();
  const maxCount = countInput ? parseInt(countInput, 10) : 0;
  if (maxCount > 0 && soloQuestions.length > maxCount) {
    soloQuestions = soloQuestions.slice(0, maxCount);
  }

  if (soloQuestions.length === 0) {
    alert('Aucune question disponible pour cette sélection.');
    return;
  }

  soloIndex = 0;
  scoreCorrect = 0;
  scoreTotal = 0;
  wrongAnswers = [];

  document.getElementById('solo-score-bar').style.display = 'flex';
  document.getElementById('btn-stop-solo').style.display = 'block';
  updateScoreBar();
  updateModuleCount();

  await loadSoloQuestion();
}

function updateScoreBar() {
  document.getElementById('sb-correct').textContent = scoreCorrect;
  document.getElementById('sb-wrong').textContent = scoreTotal - scoreCorrect;
  const pct = scoreTotal > 0 ? Math.round((scoreCorrect / scoreTotal) * 100) : '–';
  document.getElementById('sb-pct').textContent = scoreTotal > 0 ? pct + '%' : '–';
}

function stopSolo() {
  clearInterval(timerInterval);
  showRecap();
}

async function loadSoloQuestion() {
  if (soloIndex >= soloQuestions.length) {
    showRecap();
    return;
  }

  const bq = soloQuestions[soloIndex];
  const timeLimitSec = soloTimerEnabled ? (bq.time_limit_seconds || 60) : null;

  const res = await fetch(`${API}/sessions/${sessionCode}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_index: soloIndex + 1,
      num_choices: bq.num_choices,
      correct_choices: bq.correct_choices,
      time_limit_seconds: timeLimitSec,
      bank_question_id: bq.id,
    })
  });
  const q = await res.json();
  await fetch(`${API}/sessions/${sessionCode}/questions/${q.id}/start`, { method: 'POST' });

  currentQuestion = { ...q, correct_choices_real: bq.correct_choices, bank_question: bq };

  const qText = document.getElementById('q-text');
  qText.innerHTML = renderText(bq.text);
  qText.style.display = 'block';

  renderQuestion(bq.num_choices, timeLimitSec, soloIndex + 1, bq.choices_text, bq.correct_choices.length);
}

// ------- WEBSOCKET -------

let wsShouldReconnect = true;   // passe à false quand la session est finie
let wsReconnectDelay = 1000;    // backoff léger, plafonné
let battleAlreadyStarted = false; // évite qu'un replay battle_start ne remette à zéro

function connectWS() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${sessionCode}`);

  ws.onopen = () => {
    // Connexion rétablie : on remet le délai de reconnexion à zéro
    wsReconnectDelay = 1000;
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'participant_join') {
      // Le créateur de battle voit les joueurs arriver dans sa salle d'attente
      if (isBattleHost && document.getElementById('screen-battle-host-waiting').classList.contains('active')) {
        addBattleHostPlayer(msg.display_name || 'Anonyme');
      }

    } else if (msg.type === 'question_start') {
      // Mode live classique. Garde-fou : si on a déjà répondu à CETTE question
      // (reconnexion après coup), on ne réaffiche pas la grille de réponse.
      const qid = msg.question_id;
      if (currentQuestion && (currentQuestion.question_id === qid) &&
          document.getElementById('screen-result').classList.contains('active')) {
        return; // on a déjà répondu, on reste sur l'écran résultat
      }
      currentQuestion = msg;
      const qTextEl = document.getElementById('q-text');
      if (msg.question_text) {
        qTextEl.innerHTML = renderText(msg.question_text);
        qTextEl.style.display = 'block';
      } else {
        qTextEl.style.display = 'none';
      }
      renderQuestion(msg.num_choices, msg.time_limit_seconds, msg.order_index, msg.choices_text || null, 1);
      showScreen('screen-question');

    } else if (msg.type === 'question_reveal') {
      showResultFromReveal(msg);

    } else if (msg.type === 'battle_start') {
      // Garde-fou : ne démarre la battle qu'une seule fois.
      // Un replay reçu à la reconnexion est ignoré pour ne pas revenir à Q1.
      if (battleAlreadyStarted) return;
      battleAlreadyStarted = true;
      startBattleGame(msg);

    } else if (msg.type === 'battle_ranking') {
      showBattleRanking(msg.ranking, false);
    } else if (msg.type === 'battle_ranking_update') {
      showBattleRanking(msg.ranking, true);
    }
  };

  ws.onclose = () => {
    // Reconnexion automatique tant que la session n'est pas terminée.
    if (!wsShouldReconnect) return;
    setTimeout(() => {
      connectWS();
    }, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 8000); // backoff plafonné à 8s
  };

  ws.onerror = () => {
    // onclose sera appelé juste après, c'est lui qui gère la reconnexion.
    try { ws.close(); } catch (_) {}
  };
}

// ------- QUESTION (solo & live) -------

function renderQuestion(numChoices, timeLimitSec, orderIndex, choicesText, numCorrect) {
  selectedChoices.clear();
  clearInterval(timerInterval);

  document.getElementById('q-counter').textContent = `Q${orderIndex}`;
  document.getElementById('confirm-row').style.display = 'none';
  document.getElementById('q-hint').textContent = numCorrect > 1 ? 'Plusieurs bonnes réponses possibles' : 'Sélectionne ta réponse';

  const grid = document.getElementById('choices-grid');
  grid.innerHTML = '';

  for (let i = 0; i < numChoices; i++) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.dataset.index = i;
    btn.textContent = choicesText ? choicesText[i] : letters[i];
    if (choicesText) {
      btn.style.fontSize = '0.9rem';
      btn.style.aspectRatio = 'auto';
      btn.style.padding = '16px';
      btn.style.textAlign = 'left';
      btn.style.justifyContent = 'flex-start';
    }

    if (mode === 'solo' && numCorrect === 1) {
      btn.onclick = () => selectAndSubmit(i, btn);
    } else {
      btn.onclick = () => toggleChoice(i, btn);
    }
    grid.appendChild(btn);
  }

  if (timeLimitSec) {
    timerTotal = timeLimitSec;
    document.getElementById('timer-label').style.display = 'block';
    document.getElementById('timer-bar-wrap').style.display = 'block';
    startTimer(timeLimitSec);
  } else {
    document.getElementById('timer-label').style.display = 'none';
    document.getElementById('timer-bar-wrap').style.display = 'none';
  }

  showScreen('screen-question');
}

function selectAndSubmit(i, btn) {
  if (btn.disabled) return;
  selectedChoices.clear();
  selectedChoices.add(i);
  document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  submitAnswer();
}

function toggleChoice(i, btn) {
  if (btn.disabled) return;
  if (selectedChoices.has(i)) {
    selectedChoices.delete(i);
    btn.classList.remove('selected');
  } else {
    selectedChoices.add(i);
    btn.classList.add('selected');
  }
  document.getElementById('confirm-row').style.display = selectedChoices.size > 0 ? 'flex' : 'none';
}

function clearSelection() {
  selectedChoices.clear();
  document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('confirm-row').style.display = 'none';
}

function startTimer(seconds) {
  const label = document.getElementById('timer-label');
  const bar = document.getElementById('timer-bar');
  let remaining = seconds;
  const tick = () => {
    label.textContent = remaining + 's';
    bar.style.width = ((remaining / timerTotal) * 100) + '%';
    if (remaining <= 5) { label.classList.add('urgent'); bar.classList.add('urgent'); }
    if (remaining <= 0) { clearInterval(timerInterval); autoSubmit(); }
    remaining--;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

function autoSubmit() {
  if (selectedChoices.size === 0) selectedChoices.add(-1);
  submitAnswer();
}

// ------- REPONSE (solo & live) -------

async function submitAnswer() {
  clearInterval(timerInterval);
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
  document.getElementById('confirm-row').style.display = 'none';

  const qId = currentQuestion.question_id || currentQuestion.id;

  const res = await fetch(`${API}/sessions/${sessionCode}/questions/${qId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participant_id: participantId,
      selected_choices: Array.from(selectedChoices).filter(x => x >= 0),
    })
  });
  const answer = await res.json();

  if (mode === 'solo') {
    showResultSolo(answer);
  } else {
    document.getElementById('q-hint').textContent = 'Réponse envoyée — attends le résultat…';
  }
}

// ------- RESULTATS SOLO -------

function showResultSolo(answer) {
  scoreTotal++;
  if (answer.is_correct) scoreCorrect++;

  const bq = currentQuestion.bank_question;
  const correct = currentQuestion.correct_choices_real;

  markSeen(soloTheme, bq.id);

  document.querySelectorAll('.choice-btn').forEach(btn => {
    const i = parseInt(btn.dataset.index);
    if (correct.includes(i)) btn.classList.add('correct');
    else if (selectedChoices.has(i)) btn.classList.add('wrong');
  });

  if (!answer.is_correct) {
    const correctLabels = correct.map(i =>
      bq.choices_text ? `${letters[i]}) ${bq.choices_text[i]}` : letters[i]
    );
    wrongAnswers.push({ text: bq.text, correctLabels });
  }

  updateScoreBar();

  setTimeout(() => {
    soloIndex++;
    loadSoloQuestion();
  }, 1200);
}

function showResultFromReveal(msg) {
  const myAnswer = msg.stats.results.find(r => r.display_name === document.getElementById('name-input').value.trim());
  const isCorrect = myAnswer ? myAnswer.is_correct : false;
  scoreTotal++;
  if (isCorrect) scoreCorrect++;
  showResultScreen(isCorrect);
}

function showResultScreen(isCorrect) {
  document.getElementById('result-icon').textContent = isCorrect ? '🎉' : '❌';
  document.getElementById('result-title').textContent = isCorrect ? 'Bonne réponse !' : 'Raté…';
  document.getElementById('result-title').className = 'result-title ' + (isCorrect ? 'correct-text' : 'wrong-text');
  document.getElementById('result-sub').textContent = isCorrect ? 'Continue comme ça !' : 'Retente au prochain coup.';
  document.getElementById('score-correct').textContent = scoreCorrect;
  document.getElementById('score-total').textContent = scoreTotal;
  document.getElementById('score-wrong').textContent = scoreTotal - scoreCorrect;
  document.getElementById('next-hint').textContent = 'En attente de la prochaine question…';

  const old = document.querySelector('#screen-result .btn');
  if (old) old.remove();

  showScreen('screen-result');
}

// ------- RECAP FINAL SOLO -------

function showRecap() {
  document.getElementById('solo-score-bar').style.display = 'none';
  document.getElementById('btn-stop-solo').style.display = 'none';

  const pct = scoreTotal > 0 ? Math.round((scoreCorrect / scoreTotal) * 100) : 0;

  document.getElementById('recap-correct').textContent = scoreCorrect;
  document.getElementById('recap-wrong').textContent = scoreTotal - scoreCorrect;
  document.getElementById('recap-pct').textContent = pct + '%';

  const list = document.getElementById('recap-wrong-list');
  list.innerHTML = '';
  if (wrongAnswers.length === 0) {
    list.innerHTML = '<p style="color:var(--green);text-align:center;">🎉 Aucune erreur !</p>';
  } else {
    wrongAnswers.forEach((w, idx) => {
      const div = document.createElement('div');
      div.className = 'recap-item';
      div.innerHTML = `
        <div class="q-text">${idx + 1}. ${w.text}</div>
        <div class="correct-ans">✓ ${w.correctLabels.join(' / ')}</div>
      `;
      list.appendChild(div);
    });
  }

  if (wrongAnswers.length > 0) {
    const promptText = buildPrompt();
    document.getElementById('recap-prompt').textContent = promptText;
    document.getElementById('recap-prompt-section').style.display = 'flex';
  } else {
    document.getElementById('recap-prompt-section').style.display = 'none';
  }

  showScreen('screen-recap');
}

function buildPrompt() {
  const lines = wrongAnswers.map((w, i) =>
    `${i + 1}. "${w.text}"\n   → Bonne réponse : ${w.correctLabels.join(' / ')}`
  ).join('\n\n');

  return `Je prépare la certification ${soloTheme.toUpperCase()} et j'ai raté ces questions lors d'une session d'entraînement :\n\n${lines}\n\nPour chacune de ces questions, explique-moi :\n1. Pourquoi cette réponse est correcte\n2. Le concept Azure sous-jacent à retenir\n3. Comment ne pas se faire piéger à l'examen`;
}

function copyPrompt() {
  const text = document.getElementById('recap-prompt').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = '✓ Copié !';
    setTimeout(() => btn.textContent = 'Copier', 2000);
  });
}

// ============================================================
// MODE BATTLE
// ============================================================

function startBattleGame(msg) {
  // On reçoit : { type, time_limit_seconds, started_at, questions: [...] }
  battleQuestions = msg.questions;  // liste ordonnée, corrects inclus
  battleIndex = 0;
  battleCorrect = 0;
  battleTimeUp = false;
  battleTimeLimitSec = msg.time_limit_seconds || null;
  battleStartedAt = new Date(msg.started_at);

  // Démarrer le timer global si défini
  if (battleTimeLimitSec) {
    startBattleGlobalTimer();
  }

  loadBattleQuestion();
}

function loadBattleQuestion() {
  if (battleIndex >= battleQuestions.length) {
    // Plus de questions : envoyer finish au serveur
    finishBattle();
    return;
  }

  const q = battleQuestions[battleIndex];

  // Mettre à jour le compteur et la barre de progression
  document.getElementById('bq-counter').textContent = `Q${battleIndex + 1}/${battleQuestions.length}`;
  const pct = Math.round((battleIndex / battleQuestions.length) * 100);
  document.getElementById('battle-progress-bar').style.width = pct + '%';
  document.getElementById('bq-score-live').textContent = `${battleCorrect} / ${battleIndex}`;

  // Texte de la question
  document.getElementById('bq-text').innerHTML = renderText(q.question_text || '');

  // Reset sélection
  battleSelectedChoices.clear();
  document.getElementById('bq-confirm-row').style.display = 'none';
  document.getElementById('bq-hint').textContent = q.correct_choices.length > 1
    ? 'Plusieurs bonnes réponses possibles'
    : 'Sélectionne ta réponse';

  // Construire la grille de choix
  const grid = document.getElementById('bq-choices-grid');
  grid.innerHTML = '';

  const numCorrect = q.correct_choices.length;

  for (let i = 0; i < q.num_choices; i++) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.dataset.index = i;
    btn.textContent = q.choices_text ? q.choices_text[i] : letters[i];

    if (q.choices_text) {
      btn.style.fontSize = '0.9rem';
      btn.style.aspectRatio = 'auto';
      btn.style.padding = '16px';
      btn.style.textAlign = 'left';
      btn.style.justifyContent = 'flex-start';
    }

    if (numCorrect === 1) {
      // Choix unique : clic direct
      btn.onclick = () => battleSelectAndSubmit(i, btn);
    } else {
      // Multi-choix : sélection + valider
      btn.onclick = () => battleToggleChoice(i, btn);
    }
    grid.appendChild(btn);
  }

  showScreen('screen-battle-question');
}

function battleToggleChoice(i, btn) {
  if (btn.disabled) return;
  if (battleSelectedChoices.has(i)) {
    battleSelectedChoices.delete(i);
    btn.classList.remove('selected');
  } else {
    battleSelectedChoices.add(i);
    btn.classList.add('selected');
  }
  document.getElementById('bq-confirm-row').style.display = battleSelectedChoices.size > 0 ? 'flex' : 'none';
}

function battleClearSelection() {
  battleSelectedChoices.clear();
  document.querySelectorAll('#bq-choices-grid .choice-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('bq-confirm-row').style.display = 'none';
}

function battleSelectAndSubmit(i, btn) {
  if (btn.disabled) return;
  battleSelectedChoices.clear();
  battleSelectedChoices.add(i);
  document.querySelectorAll('#bq-choices-grid .choice-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  battleSubmitAnswer();
}

async function battleSubmitAnswer() {
  document.querySelectorAll('#bq-choices-grid .choice-btn').forEach(b => b.disabled = true);
  document.getElementById('bq-confirm-row').style.display = 'none';

  const q = battleQuestions[battleIndex];
  const selected = Array.from(battleSelectedChoices).filter(x => x >= 0);

  // Appel HTTP à /answer (les questions sont déjà en status active côté serveur)
  const res = await fetch(`${API}/sessions/${sessionCode}/questions/${q.question_id}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participant_id: participantId,
      selected_choices: selected,
    })
  });
  const answer = await res.json();

  // Colorer les boutons (feedback immédiat comme en solo)
  document.querySelectorAll('#bq-choices-grid .choice-btn').forEach(btn => {
    const i = parseInt(btn.dataset.index);
    if (q.correct_choices.includes(i)) btn.classList.add('correct');
    else if (battleSelectedChoices.has(i)) btn.classList.add('wrong');
  });

  if (answer.is_correct) battleCorrect++;

  // Passer à la question suivante après 1.2s, sauf si le temps global est écoulé
  setTimeout(() => {
    if (battleTimeUp) {
      finishBattle();   // temps écoulé : on termine au lieu de continuer
      return;
    }
    battleIndex++;
    loadBattleQuestion();
  }, 1200);
}

async function finishBattle() {
  // Stopper le timer global
  clearInterval(battleGlobalTimerInterval);

  // Calculer le temps écoulé
  const elapsedMs = Date.now() - battleStartedAt.getTime();
  const elapsedSec = Math.round(elapsedMs / 1000);

  // Afficher l'écran de score perso en attente
  const total = battleQuestions.length;
  const pct = total > 0 ? Math.round((battleCorrect / total) * 100) : 0;

  document.getElementById('battle-score-correct').textContent = battleCorrect;
  document.getElementById('battle-score-wrong').textContent = total - battleCorrect;
  document.getElementById('battle-score-pct').textContent = pct + '%';

  const min = Math.floor(elapsedSec / 60);
  const sec = elapsedSec % 60;
  document.getElementById('battle-score-time').textContent = min > 0
    ? `Temps : ${min}m${sec.toString().padStart(2,'0')}s`
    : `Temps : ${sec}s`;

  showScreen('screen-battle-score');

  // Appel au serveur pour enregistrer la fin et déclencher éventuellement le classement
  await fetch(`${API}/sessions/${sessionCode}/battle/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participant_id: participantId }),
  });
  // Le classement arrivera via WebSocket (battle_ranking) quand tout le monde aura fini
}

function startBattleGlobalTimer() {
  const timerEl = document.getElementById('battle-global-timer');
  timerEl.style.display = 'block';
  timerEl.classList.remove('urgent');

  const tick = () => {
    const elapsed = (Date.now() - battleStartedAt.getTime()) / 1000;
    const remaining = Math.max(0, battleTimeLimitSec - elapsed);
    const min = Math.floor(remaining / 60);
    const sec = Math.floor(remaining % 60);
    timerEl.textContent = min > 0
      ? `${min}:${sec.toString().padStart(2,'0')}`
      : `${Math.floor(remaining)}s`;

    if (remaining <= 60) timerEl.classList.add('urgent');

    if (remaining <= 0) {
      clearInterval(battleGlobalTimerInterval);
      battleTimeUp = true;   // signale à battleSubmitAnswer de terminer après soumission
      // Temps écoulé : soumettre la question en cours puis finir
      if (battleIndex < battleQuestions.length) {
        if (battleSelectedChoices.size === 0) battleSelectedChoices.add(-1);
        battleSubmitAnswer();
      } else {
        finishBattle();
      }
    }
  };

  tick();
  battleGlobalTimerInterval = setInterval(tick, 1000);
}

function showBattleRanking(ranking, isLive) {
  if (!isLive) {
    // Classement final : on coupe la reconnexion auto et le timer.
    wsShouldReconnect = false;
    clearInterval(battleGlobalTimerInterval);
  }

  const medals = ['🥇','🥈','🥉'];
  const classes = ['gold','silver','bronze'];
  const table = document.getElementById('student-ranking-table');
  table.innerHTML = '';

  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  ranking.forEach((entry, i) => {
    const row = document.createElement('div');
    const isMe = entry.display_name === battleDisplayName;
    row.className = `ranking-row ${classes[i] || ''} ${isMe ? 'ranking-me' : ''}`;

    const elapsed = Math.round(entry.elapsed_seconds);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    const timeStr = min > 0 ? `${min}m${sec.toString().padStart(2,'0')}s` : `${sec}s`;

    row.innerHTML = `
      <span class="ranking-pos">${medals[i] || '#' + (i + 1)}</span>
      <span class="ranking-name">${esc(entry.display_name)}${isMe ? ' 👤' : ''}</span>
      <span class="ranking-score">${entry.score}/${entry.total}</span>
      <span class="ranking-time">${timeStr}</span>
    `;
    table.appendChild(row);
  });

  const titleEl = document.getElementById('student-ranking-title');
  if (titleEl) {
    titleEl.textContent = isLive ? '⚔️ CLASSEMENT EN COURS…' : '⚔️ CLASSEMENT FINAL';
  }

  showScreen('screen-battle-ranking');
}



// Affiche un énoncé structuré (contexte + requirements + question)
// Échappe le HTML pour éviter le XSS, convertit \n en <br>
function renderText(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}



// ================= REVISION : flashcards =================

const REVISION_PSEUDO_KEY = 'revision_pseudo';
const PSEUDO_RE = /^[A-Za-z0-9_-]{2,30}$/;   // miroir de l'allowlist backend
let revisionPseudo = null;

let revCards = [];      // cartes du pool courant
let revIndex = 0;       // index de la carte affichee
let revProgress = {};   // map flashcard_id -> status
let revCategory = 'az-900-module-1';
let revPool = 'all';

// --- affichage des erreurs inline (remplace les alert) ---
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }
function clearError(el) { el.textContent = ''; el.style.display = 'none'; el.style.color = 'var(--red)'; }

// Lit le message renvoye par l'API. FastAPI met le texte dans "detail".
// Erreur de validation (422) -> "detail" est une liste -> message lisible.
async function readApiError(res, fallback) {
  try {
    const data = await res.json();
    if (Array.isArray(data.detail)) {
      return 'Pseudo invalide : 2 a 30 caracteres, lettres, chiffres, - ou _ seulement.';
    }
    return data.detail || fallback;
  } catch { return fallback; }
}

// --- ecran login ---
function showRevisionLogin() {
  const e = document.getElementById('revision-login-error');
  clearError(e);
  const saved = localStorage.getItem(REVISION_PSEUDO_KEY);
  if (saved) document.getElementById('revision-pseudo-input').value = saved;
  showScreen('screen-revision-login');
}

async function createPseudo() {
  const e = document.getElementById('revision-login-error');
  clearError(e);
  const pseudo = document.getElementById('revision-pseudo-input').value.trim();
  if (!PSEUDO_RE.test(pseudo)) {
    showError(e, 'Pseudo invalide : 2 a 30 caracteres, lettres, chiffres, - ou _ seulement.');
    return;
  }
  const res = await fetch(`${API}/study/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo })
  });
  if (!res.ok) { showError(e, await readApiError(res, 'Creation impossible.')); return; }
  const data = await res.json();
  onPseudoReady(data.pseudo);
}

async function enterPseudo() {
  const e = document.getElementById('revision-login-error');
  clearError(e);
  const pseudo = document.getElementById('revision-pseudo-input').value.trim();
  if (!PSEUDO_RE.test(pseudo)) { showError(e, 'Pseudo invalide.'); return; }
  const res = await fetch(`${API}/study/users/${encodeURIComponent(pseudo)}`);
  if (!res.ok) { showError(e, await readApiError(res, 'Pseudo introuvable.')); return; }
  const data = await res.json();
  onPseudoReady(data.pseudo);
}

function onPseudoReady(pseudo) {
  revisionPseudo = pseudo;
  localStorage.setItem(REVISION_PSEUDO_KEY, pseudo);
  document.getElementById('revision-current-pseudo').textContent = pseudo;
  showScreen('screen-revision-setup');
}

function revisionLogout() {
  revisionPseudo = null;
  showRevisionLogin();
}

// --- ecran setup : module + pool ---
function revSelectCategory(cat, el) {
  revCategory = cat;
  document.querySelectorAll('#rev-module-grid .module-chip').forEach(c => c.classList.remove('selected-chip'));
  el.classList.add('selected-chip');
}

function revSelectPool(pool, el) {
  revPool = pool;
  document.querySelectorAll('#rev-pool-row .type-btn').forEach(b => b.classList.remove('selected-type'));
  el.classList.add('selected-type');
}

function shuffleRev(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function filterByPool(cards, pool) {
  if (pool === 'all') return cards.slice();
  if (pool === 'new') return cards.filter(c => !(c.id in revProgress));
  return cards.filter(c => revProgress[c.id] === pool);  // to_review | medium | acquired
}

async function startRevision() {
  const e = document.getElementById('revision-setup-error');
  clearError(e);

  // 1) cartes de la categorie
  const cardsRes = await fetch(`${API}/flashcards?category=${encodeURIComponent(revCategory)}`);
  if (!cardsRes.ok) { showError(e, 'Impossible de charger les cartes.'); return; }
  const allCards = await cardsRes.json();

  // 2) progression de l'utilisateur
  const progRes = await fetch(`${API}/study/users/${encodeURIComponent(revisionPseudo)}/progress`);
  revProgress = {};
  if (progRes.ok) {
    (await progRes.json()).forEach(p => { revProgress[p.flashcard_id] = p.status; });
  }

  // 3) filtrage par pool
  revCards = filterByPool(allCards, revPool);
  if (revCards.length === 0) { showError(e, 'Aucune carte dans ce pool. Choisis-en un autre.'); return; }

  shuffleRev(revCards);
  revIndex = 0;
  renderRevCard();
  showScreen('screen-revision-card');
}

// --- rendu d'une carte ---
function tagLabel(s) { return s === 'to_review' ? 'A revoir' : s === 'medium' ? 'Moyen' : 'Acquis'; }

function renderRevCard() {
  const card = revCards[revIndex];
  const isNotion = card.card_type !== 'scenario';
  const typeLabel = isNotion ? 'Notion' : 'Mise en situation';
  const cls = isNotion ? 'rev-notion' : 'rev-scenario';

  document.getElementById('rev-progress').textContent = `${revIndex + 1} / ${revCards.length}`;

  const analogyHtml = card.analogy
    ? `<div class="rev-analogy">${escapeHtml(card.analogy)}</div>` : '';
  const currentTag = revProgress[card.id]
    ? `<div class="rev-current-tag">Tag actuel : ${tagLabel(revProgress[card.id])}</div>` : '';

  document.getElementById('rev-card-slot').innerHTML = `
    <div class="rev-flip ${cls}" id="rev-flip" onclick="flipRevCard()">
      <div class="rev-flip-inner">
        <div class="rev-side rev-front">
          <span class="rev-chip">${typeLabel}</span>
          <span class="rev-concept">${escapeHtml(card.front)}</span>
          <span class="rev-tap">toucher pour retourner</span>
          ${currentTag}
        </div>
        <div class="rev-side rev-back">
          <span class="rev-ans-label">Reponse</span>
          <span class="rev-ans">${escapeHtml(card.back)}</span>
          ${analogyHtml}
          <div class="rev-tags">
            <button class="rev-tag rev-tag-red" onclick="tagCard(event,'to_review')">A revoir</button>
            <button class="rev-tag rev-tag-orange" onclick="tagCard(event,'medium')">Moyen</button>
            <button class="rev-tag rev-tag-green" onclick="tagCard(event,'acquired')">Acquis</button>
          </div>
        </div>
      </div>
    </div>`;
}

function flipRevCard() {
  document.getElementById('rev-flip').classList.toggle('flipped');
}

async function tagCard(ev, status) {
  ev.stopPropagation();  // ne pas declencher le flip de la carte
  const card = revCards[revIndex];
  const prev = revProgress[card.id];
  revProgress[card.id] = status;   // mise a jour optimiste

  const res = await fetch(`${API}/study/users/${encodeURIComponent(revisionPseudo)}/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flashcard_id: card.id, status })
  });
  if (!res.ok) {
    // echec : on annule la mise a jour locale
    if (prev === undefined) delete revProgress[card.id]; else revProgress[card.id] = prev;
    console.error('Echec enregistrement du tag');
  }
  nextRevCard();
}

function revSkip() { nextRevCard(); }

function nextRevCard() {
  if (revIndex < revCards.length - 1) { revIndex++; renderRevCard(); }
  else { showScreen('screen-revision-done'); }
}
