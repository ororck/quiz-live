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
      '<div class="wr-empty">En attente…</div>';
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
  const empty = list.querySelector('.wr-empty');
  if (empty) empty.remove();

  // Avatar robot deterministe (robotSVG dans common.js) : genere localement,
  // aucune requete reseau. textContent pour le pseudo = pas d'injection HTML.
  const el = document.createElement('div');
  el.className = 'wr-player';
  const av = document.createElement('div');
  av.className = 'wr-avatar';
  av.innerHTML = robotSVG(name);
  const label = document.createElement('span');
  label.className = 'wr-name';
  label.textContent = name;
  el.appendChild(av);
  el.appendChild(label);
  list.appendChild(el);

  // toast d'arrivee
  const toast = document.getElementById('battle-host-toast');
  toast.textContent = `${name} a rejoint la partie`;
  toast.classList.add('show');
  clearTimeout(addBattleHostPlayer._t);
  addBattleHostPlayer._t = setTimeout(() => toast.classList.remove('show'), 1600);
}

// Meme logique qu'addBattleHostPlayer, mais pour l'ecran du joueur qui a
// REJOINT une battle (screen-battle-waiting). Les deux existent separement
// car ce sont deux ecrans HTML distincts avec des ids differents ; les
// fusionner demanderait de renommer les ids partages avec d'autres ecrans.
let battleWaitingPlayers = [];
function addBattleWaitingPlayer(name) {
  if (battleWaitingPlayers.includes(name)) return;
  battleWaitingPlayers.push(name);
  document.getElementById('battle-waiting-count').textContent = battleWaitingPlayers.length;
  const list = document.getElementById('battle-waiting-players');
  const empty = list.querySelector('.wr-empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'wr-player';
  const av = document.createElement('div');
  av.className = 'wr-avatar';
  av.innerHTML = robotSVG(name);
  const label = document.createElement('span');
  label.className = 'wr-name';
  label.textContent = name;
  el.appendChild(av);
  el.appendChild(label);
  list.appendChild(el);
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
    battleWaitingPlayers = [];
    document.getElementById('battle-waiting-count').textContent = '0';
    document.getElementById('battle-waiting-players').innerHTML = '<div class="wr-empty">En attente…</div>';
    showScreen('screen-battle-waiting');
    // Snapshot des joueurs deja presents (renvoye par /join) : on les affiche
    // tout de suite, sans attendre un futur message WebSocket qui ne parlera
    // que des PROCHAINES arrivees, pas de celles qui ont eu lieu avant nous.
    (data.existing_players || []).forEach(addBattleWaitingPlayer);
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
      // Un joueur qui a REJOINT (pas le créateur) voit aussi la liste s'animer
      if (!isBattleHost && document.getElementById('screen-battle-waiting').classList.contains('active')) {
        addBattleWaitingPlayer(msg.display_name || 'Anonyme');
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

  // BUG CORRIGE : un classement LIVE (battle_ranking_update) est diffuse a
  // TOUS les joueurs de la session des qu'un seul finit. Forcer l'ecran ici
  // arrachait les joueurs encore en train de repondre a leurs questions.
  // On ne bascule l'ecran que pour le classement FINAL (isLive=false) ; un
  // classement live ne fait que mettre a jour le tableau en arriere-plan,
  // visible seulement si le joueur est deja sur cet ecran (parce qu'il a
  // lui-meme deja fini, cf. screen-battle-score).
  if (!isLive) {
    showScreen('screen-battle-ranking');
  }
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
  loadRevisionSetup();
}

function revisionLogout() {
  revisionPseudo = null;
  showRevisionLogin();
}

// --- ecran setup : domaines -> themes (multi) -> pool ---
const REV_DOMAIN_ORDER = ['concepts', 'architecture', 'governance'];
const REV_DOMAIN_META = {
  concepts:     { label: 'Concepts',     color: 'var(--dom-concepts)',     weight: '25-30%' },
  architecture: { label: 'Architecture', color: 'var(--dom-architecture)', weight: '35-40%' },
  governance:   { label: 'Governance',   color: 'var(--dom-governance)',   weight: '30-35%' },
};
const REV_THEME_LABEL = {
  'cloud-computing': 'Cloud computing', 'cloud-benefits': 'Benefits of cloud services', 'service-types': 'Cloud service types',
  'core-components': 'Core architectural components', 'compute-networking': 'Compute and networking', 'storage': 'Storage services', 'identity-security': 'Identity, access, and security',
  'cost-management': 'Cost management', 'governance-compliance': 'Governance and compliance', 'resource-management': 'Managing and deploying resources', 'monitoring': 'Monitoring tools',
};
const REV_THEME_ORDER = {
  concepts: ['cloud-computing', 'cloud-benefits', 'service-types'],
  architecture: ['core-components', 'compute-networking', 'storage', 'identity-security'],
  governance: ['cost-management', 'governance-compliance', 'resource-management', 'monitoring'],
};

let revAllCards = [];               // toutes les flashcards (chargees une fois)
let revSelectedThemes = new Set();  // themes coches pour la session
let revOpenDomain = null;           // domaine deplie
let revMode = 'notion';             // notion | scenario | fiche

// charge cartes + progression, puis construit l'ecran setup
async function loadRevisionSetup() {
  const e = document.getElementById('revision-setup-error');
  clearError(e);
  const cardsRes = await fetch(`${API}/flashcards`);
  if (!cardsRes.ok) { showError(e, 'Impossible de charger les cartes.'); return; }
  revAllCards = await cardsRes.json();

  const progRes = await fetch(`${API}/study/users/${encodeURIComponent(revisionPseudo)}/progress`);
  revProgress = {};
  if (progRes.ok) { (await progRes.json()).forEach(p => { revProgress[p.flashcard_id] = p.status; }); }

  revSelectedThemes = new Set();
  revOpenDomain = null;
  revMode = 'notion';
  document.querySelectorAll('#rev-mode-row .rev-mode').forEach(el => el.classList.toggle('rev-mode-sel', el.dataset.mode === 'notion'));
  document.getElementById('rev-pool-wrap').classList.remove('rev-pool-off');
  renderDomainDecks();
  renderThemePanel();
  updateStartButton();
}

// {total, seen} pour un sous-ensemble de cartes ("vue" = deja taggee)
function revStats(cards) {
  let seen = 0;
  for (const c of cards) if (c.id in revProgress) seen++;
  return { total: cards.length, seen };
}

// le mode filtre le type de carte : notion/fiche -> notion, scenario -> scenario
function cardTypeForMode() { return revMode === 'scenario' ? 'scenario' : 'notion'; }
function cardsForMode(cards) {
  const t = cardTypeForMode();
  return cards.filter(c => (c.card_type || 'notion') === t);
}

function renderDomainDecks() {
  const row = document.getElementById('rev-domain-row');
  row.innerHTML = '';
  for (const key of REV_DOMAIN_ORDER) {
    const meta = REV_DOMAIN_META[key];
    const cards = cardsForMode(revAllCards.filter(c => c.category === key));
    const { total, seen } = revStats(cards);
    const pct = total ? Math.round(100 * seen / total) : 0;
    const open = revOpenDomain === key;
    const el = document.createElement('div');
    el.className = 'rev-dom' + (open ? ' open' : '');
    el.innerHTML =
      '<div class="rev-dom-stk2"></div><div class="rev-dom-stk1"></div>' +
      '<div class="rev-dom-face"' + (open ? ` style="border-color:${meta.color}"` : '') + '>' +
        `<div class="rev-dom-tab" style="background:${meta.color}"></div>` +
        `<div class="rev-dom-name">${meta.label}</div>` +
        `<div class="rev-dom-meta">${total} cartes - ${meta.weight}</div>` +
        `<div class="rev-dom-track"><span class="rev-dom-fill" style="width:${pct}%;background:${meta.color}"></span></div>` +
        `<div class="rev-dom-foot"><span class="rev-dom-prog">${seen} / ${total} vues</span><span class="rev-dom-chev">\u2304</span></div>` +
      '</div>';
    el.addEventListener('click', () => toggleDomain(key));
    row.appendChild(el);
  }
}

function toggleDomain(key) {
  revOpenDomain = (revOpenDomain === key) ? null : key;
  renderDomainDecks();
  renderThemePanel();
}

function renderThemePanel() {
  const panel = document.getElementById('rev-theme-panel');
  panel.innerHTML = '';
  if (!revOpenDomain) return;
  const meta = REV_DOMAIN_META[revOpenDomain];
  const wrap = document.createElement('div');
  wrap.className = 'rev-panel';
  let html = `<div class="rev-panel-h"><span class="rev-panel-dot" style="background:${meta.color}"></span>${meta.label} - choisis un ou plusieurs themes</div><div class="rev-tgrid">`;
  for (const slug of REV_THEME_ORDER[revOpenDomain]) {
    const cards = cardsForMode(revAllCards.filter(c => c.theme === slug));
    const { total, seen } = revStats(cards);
    const pct = total ? Math.round(100 * seen / total) : 0;
    const sel = revSelectedThemes.has(slug);
    html +=
      `<div class="rev-tdeck${sel ? ' sel' : ''}" data-slug="${slug}">` +
        '<div class="rev-tdeck-stk"></div>' +
        '<div class="rev-tdeck-face"' + (sel ? ` style="border-color:${meta.color}"` : '') + '>' +
          `<span class="rev-tdeck-check" style="color:${meta.color}">\u2713</span>` +
          `<div class="rev-tdeck-tab" style="background:${meta.color}"></div>` +
          `<div class="rev-tdeck-name">${escapeHtml(REV_THEME_LABEL[slug] || slug)}</div>` +
          `<div class="rev-tdeck-meta"><span>${total} cartes</span><span>${seen}/${total}</span></div>` +
          `<div class="rev-tdeck-track"><span class="rev-tdeck-fill" style="width:${pct}%;background:${meta.color}"></span></div>` +
        '</div>' +
      '</div>';
  }
  html += '</div>';
  wrap.innerHTML = html;
  panel.appendChild(wrap);
  wrap.querySelectorAll('.rev-tdeck').forEach(node => {
    node.addEventListener('click', () => toggleTheme(node.dataset.slug));
  });
}

function toggleTheme(slug) {
  if (revSelectedThemes.has(slug)) revSelectedThemes.delete(slug);
  else revSelectedThemes.add(slug);
  renderThemePanel();
  updateStartButton();
}

// bouton "Tout reviser" : tout cocher / tout decocher
function revSelectAllThemes() {
  const all = Object.values(REV_THEME_ORDER).flat();
  const everySelected = all.every(s => revSelectedThemes.has(s));
  revSelectedThemes = everySelected ? new Set() : new Set(all);
  renderThemePanel();
  updateStartButton();
}

function revSelectPool(pool, el) {
  revPool = pool;
  document.querySelectorAll('#rev-pool-row .type-btn').forEach(b => b.classList.remove('selected-type'));
  el.classList.add('selected-type');
  updateStartButton();
}

function revSelectedCards() {
  return cardsForMode(revAllCards.filter(c => revSelectedThemes.has(c.theme)));
}

function updateStartButton() {
  const btn = document.getElementById('rev-start-btn');
  if (!btn) return;
  const t = revSelectedThemes.size;
  if (t === 0) { btn.textContent = 'Choisis un theme'; return; }
  if (revMode === 'fiche') {
    const n = revSelectedCards().length;
    btn.textContent = `Ouvrir la fiche - ${t} theme${t > 1 ? 's' : ''} (${n})`;
    return;
  }
  const n = filterByPool(revSelectedCards(), revPool).length;
  btn.textContent = `Commencer - ${n} carte${n > 1 ? 's' : ''} - ${t} theme${t > 1 ? 's' : ''}`;
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
  if (revSelectedThemes.size === 0) { showError(e, 'Choisis au moins un theme.'); return; }
  if (revMode === 'fiche') { return startFiche(e); }
  revCards = filterByPool(revSelectedCards(), revPool);
  if (revCards.length === 0) { showError(e, 'Aucune carte dans ce pool. Choisis-en un autre.'); return; }
  shuffleRev(revCards);
  revIndex = 0;
  renderRevCard();
  showScreen('screen-revision-card');
}

// choix du mode d'etude (notion | scenario | fiche)
function revSelectMode(mode) {
  revMode = mode;
  document.querySelectorAll('#rev-mode-row .rev-mode').forEach(el => el.classList.toggle('rev-mode-sel', el.dataset.mode === mode));
  document.getElementById('rev-pool-wrap').classList.toggle('rev-pool-off', mode === 'fiche');
  renderDomainDecks();
  renderThemePanel();
  updateStartButton();
}

// --- fiche de revision : vue generee en lecture seule (agrege les notions des themes choisis) ---
function startFiche(e) {
  clearError(e);
  const cards = revSelectedCards();  // notions des themes selectionnes
  if (cards.length === 0) { showError(e, 'Aucune notion pour cette selection.'); return; }
  renderFiche(cards);
  showScreen('screen-revision-fiche');
}

function renderFiche(cards) {
  const byTheme = {};
  cards.forEach(c => { (byTheme[c.theme] = byTheme[c.theme] || []).push(c); });
  const ordered = REV_DOMAIN_ORDER.flatMap(d => REV_THEME_ORDER[d]).filter(t => byTheme[t]);

  let html = '';
  ordered.forEach(slug => {
    html += `<div class="fiche-theme"><h3 class="fiche-theme-h">${escapeHtml(REV_THEME_LABEL[slug] || slug)}</h3>`;
    byTheme[slug].forEach(c => {
      const analogy = c.analogy ? `<div class="fiche-analogy">${escapeHtml(c.analogy)}</div>` : '';
      html += `<div class="fiche-item"><div class="fiche-q">${escapeHtml(c.front)}</div><div class="fiche-a">${escapeHtml(c.back)}</div>${analogy}</div>`;
    });
    html += `</div>`;
  });

  document.getElementById('rev-fiche-slot').innerHTML = html;
  document.getElementById('rev-fiche-count').textContent =
    `${cards.length} notions - ${ordered.length} theme${ordered.length > 1 ? 's' : ''}`;
}

// --- rendu d'une carte ---
function tagLabel(s) { return s === 'to_review' ? 'A revoir' : s === 'medium' ? 'Moyen' : 'Acquis'; }

function renderRevCard() {
  const card = revCards[revIndex];
  const isNotion = card.card_type !== 'scenario';
  const typeLabel = isNotion ? 'Notion' : 'Mise en situation';
  const cls = isNotion ? 'rev-notion' : 'rev-scenario';

  document.getElementById('rev-progress').textContent = `${revIndex + 1} / ${revCards.length}`;
  document.getElementById('rev-bar-fill').style.width = `${((revIndex + 1) / revCards.length) * 100}%`;

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
  // Garde anti-conflit tap/drag : si le doigt vient de glisser, ce n'est pas un tap.
  if (Math.abs(revDrag.dx) > 5) { revDrag.dx = 0; return; }
  document.getElementById('rev-flip').classList.toggle('flipped');
}

// --- enregistrement d'un tag : commun aux boutons, au swipe et au clavier ---
// Optimiste : la progression locale est mise a jour et l'animation part tout
// de suite ; le POST court en parallele et on annule localement s'il echoue.
async function saveTag(status) {
  const card = revCards[revIndex];
  const prev = revProgress[card.id];
  revProgress[card.id] = status;

  const res = await fetch(`${API}/study/users/${encodeURIComponent(revisionPseudo)}/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flashcard_id: card.id, status })
  });
  if (!res.ok) {
    if (prev === undefined) delete revProgress[card.id]; else revProgress[card.id] = prev;
    console.error('Echec enregistrement du tag');
  }
}

let revAnimating = false;   // bloque tout geste pendant la sortie de carte

// Sortie animee : dir = 1 (droite/acquis), -1 (gauche/a revoir), 0 (bas/moyen ou skip).
// Le transform s'applique au conteneur .rev-flip (translateX/rotate) ; le flip
// vit sur .rev-flip-inner (rotateY) : les deux ne se marchent jamais dessus.
function animateCardOut(dir) {
  const flip = document.getElementById('rev-flip');
  if (!flip || revAnimating) return;
  revAnimating = true;
  flip.style.transition = 'transform 0.35s ease, opacity 0.3s ease';
  flip.style.transform = dir === 0 ? 'translateY(60px)' : `translateX(${dir * 560}px) rotate(${dir * 18}deg)`;
  flip.style.opacity = '0';
  setTimeout(nextRevCard, 300);
}

async function tagCard(ev, status) {
  ev.stopPropagation();  // ne pas declencher le flip de la carte
  if (revAnimating) return;
  saveTag(status);       // volontairement sans await : l'animation part immediatement
  animateCardOut(status === 'acquired' ? 1 : status === 'to_review' ? -1 : 0);
}

function revSkip() { if (!revAnimating) animateCardOut(0); }

function nextRevCard() {
  revAnimating = false;
  document.getElementById('rev-side-left').classList.remove('lit');
  document.getElementById('rev-side-right').classList.remove('lit');
  // renderRevCard() reconstruit le slot : transform et opacity repartent a neuf
  if (revIndex < revCards.length - 1) { revIndex++; renderRevCard(); }
  else { showScreen('screen-revision-done'); }
}

// --- swipe : delegation sur le slot, survit aux re-render de renderRevCard ---
// Pointer Events = souris ET tactile avec un seul jeu de listeners.
let revDrag = { active: false, startX: 0, dx: 0 };

document.getElementById('rev-card-slot').addEventListener('pointerdown', (e) => {
  const flip = document.getElementById('rev-flip');
  if (!flip || revAnimating) return;
  if (e.target.closest('.rev-tag')) return;   // laisser les boutons de tag cliquables
  revDrag = { active: true, startX: e.clientX, dx: 0 };
  flip.style.transition = 'none';             // suivi direct du doigt, pas d'animation
});

window.addEventListener('pointermove', (e) => {
  if (!revDrag.active) return;
  const flip = document.getElementById('rev-flip');
  if (!flip) return;
  revDrag.dx = e.clientX - revDrag.startX;
  flip.style.transform = `translateX(${revDrag.dx}px) rotate(${revDrag.dx / 18}deg)`;
  // feedback avant de lacher : bords teintes + label allume selon la direction
  flip.classList.toggle('swipe-ok', revDrag.dx > 40);
  flip.classList.toggle('swipe-ko', revDrag.dx < -40);
  document.getElementById('rev-side-right').classList.toggle('lit', revDrag.dx > 40);
  document.getElementById('rev-side-left').classList.toggle('lit', revDrag.dx < -40);
});

window.addEventListener('pointerup', () => {
  if (!revDrag.active) return;
  revDrag.active = false;
  const flip = document.getElementById('rev-flip');
  if (!flip) return;
  if (Math.abs(revDrag.dx) > 90) {
    // seuil franchi : swipe = auto-evaluation binaire (Moyen reste sur les boutons)
    const status = revDrag.dx > 0 ? 'acquired' : 'to_review';
    saveTag(status);
    animateCardOut(revDrag.dx > 0 ? 1 : -1);
  } else {
    // seuil non franchi : retour au centre
    flip.style.transition = 'transform 0.3s ease';
    flip.style.transform = '';
    flip.classList.remove('swipe-ok', 'swipe-ko');
    document.getElementById('rev-side-left').classList.remove('lit');
    document.getElementById('rev-side-right').classList.remove('lit');
  }
});

// --- clavier (desktop) : fleche gauche = a revoir, droite = acquis,
//     bas = moyen, espace = retourner la carte ---
window.addEventListener('keydown', (e) => {
  if (!document.getElementById('screen-revision-card').classList.contains('active')) return;
  if (revAnimating) return;
  if (e.key === 'ArrowRight')     { saveTag('acquired');  animateCardOut(1); }
  else if (e.key === 'ArrowLeft') { saveTag('to_review'); animateCardOut(-1); }
  else if (e.key === 'ArrowDown') { saveTag('medium');    animateCardOut(0); }
  else if (e.key === ' ')         { e.preventDefault(); document.getElementById('rev-flip').classList.toggle('flipped'); }
});


// ================= COLD START (scale-to-zero) =================
// Avec min-replicas 0, le premier visiteur apres une periode d'inactivite
// paie le demarrage a froid du Container App (5 a 30 s).
//
// L'overlay est visible DES LE HTML (display:flex par defaut, voir
// student.html), donc il n'y a jamais de flash de l'ecran d'accueil avant
// lui : le navigateur peint l'overlay AVANT que ce script ne s'execute.
//   - /healthz repond vite (< 500 ms) -> on masque l'overlay tout de suite,
//     l'utilisateur n'a quasiment rien vu.
//   - plus lent -> a 500 ms on bascule le message sur "Reveil du serveur"
//     et on demarre les animations (anneau, etapes, astuces), jusqu'a la
//     reponse.
// La progression de l'anneau est asymptotique : elle avance vite puis
// ralentit vers 90 % (la duree reelle est inconnue) et saute a 100 % a la
// reponse.

const CS_TIPS = [
  "Le scale-to-zero coupe les couts a zero quand l'app dort, au prix de ce demarrage a froid.",
  "Une Availability Zone = un ou plusieurs datacenters avec alimentation et reseau independants.",
  "OpEx vs CapEx : le cloud transforme un gros investissement initial en depense a l'usage.",
  "Azure Policy audite ou bloque, RBAC donne des permissions : deux reponses differentes a l'examen.",
  "99,9 % d'uptime = environ 8 h 45 d'indisponibilite par an. 99,99 % = 52 minutes.",
  "L'elasticite ajuste les ressources automatiquement a la demande ; la scalabilite est la capacite a le faire."
];

(function checkColdStart() {
  const overlay = document.getElementById('coldstart');
  let done = false, revealed = false, prog = 0, ticker = null, tipTimer = null;

  const probe = fetch(`${API}/healthz`).catch(() => null);

  function setProgress(p) {
    prog = p;
    // circonference = 2 * PI * 52 = 327 ; dashoffset 327 = anneau vide, 0 = plein
    document.getElementById('cs-fill').style.strokeDashoffset = 327 - (327 * p / 100);
    document.getElementById('cs-step-1').classList.toggle('done', p >= 30);
    document.getElementById('cs-step-2').classList.toggle('done', p >= 65);
    document.getElementById('cs-step-3').classList.toggle('done', p >= 98);
  }

  // Anneau et etapes tournent des le debut : si la reponse met 400ms, on
  // voit deja un peu de mouvement au lieu d'un ecran fige.
  ticker = setInterval(() => setProgress(prog + (90 - prog) * 0.05), 300);

  // A 500ms : si toujours pas de reponse, on affiche le vrai message et
  // les astuces -- ca ne se produit QUE dans un vrai cold start.
  const revealTimer = setTimeout(() => {
    if (done) return;
    revealed = true;
    document.querySelector('.cs-title').textContent = 'Réveil du serveur…';
    startTips();
  }, 500);

  function startTips() {
    let tipIdx = Math.floor(Math.random() * CS_TIPS.length);
    const body = document.getElementById('cs-tip-body');
    const text = document.getElementById('cs-tip-text');
    document.querySelector('.cs-tip').style.display = 'flex';
    text.textContent = CS_TIPS[tipIdx];
    tipTimer = setInterval(() => {
      body.classList.add('out');
      setTimeout(() => {
        tipIdx = (tipIdx + 1) % CS_TIPS.length;
        text.textContent = CS_TIPS[tipIdx];
        body.classList.remove('out');
      }, 380);
    }, 4500);
  }

  const pageLoadedAt = Date.now();
  const MIN_DISPLAY_MS = 2000;   // l'ecran reste visible au moins 2s, meme si le serveur est chaud

  probe.finally(() => {
    done = true;
    clearTimeout(revealTimer);
    clearInterval(ticker);
    clearInterval(tipTimer);
    // Plancher : /healthz peut repondre en 20ms, mais l'ecran doit rester
    // lisible au moins MIN_DISPLAY_MS depuis le tout premier affichage.
    // setProgress(100) est retarde jusqu'a juste avant la fermeture reelle,
    // sinon l'anneau sauterait a 100% puis resterait fige pendant l'attente.
    const elapsed = Date.now() - pageLoadedAt;
    const remaining = Math.max(MIN_DISPLAY_MS - elapsed, 0);
    setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; overlay.style.opacity = '1'; }, 400);
      }, 200);
    }, remaining);
  });
})();
