import json
import random
import string
from datetime import datetime, timezone

import os
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request, Header
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import Base, engine, get_db
import models, schemas

# Crée la table question_bank si elle n'existe pas
Base.metadata.create_all(bind=engine)

app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/healthz")
async def healthz():
    """Sonde legere pour le front : detection du cold start (scale-to-zero).

    Repond des que le process est demarre. Le front l'appelle au chargement
    de la page et affiche un ecran de reveil tant qu'elle ne repond pas.
    """
    import asyncio  # TEMPORAIRE : a retirer une fois le test de declenchement fait
    await asyncio.sleep(3)  # TEMPORAIRE : force le cold start pour verifier le JS
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Structures de données en mémoire (sessions, participants, questions, réponses)
# Ces données sont éphémères : elles disparaissent quand le container redémarre.
# C'est voulu : les sessions live sont temporaires.
# ---------------------------------------------------------------------------

class QuestionState:
    """État d'une question active dans une session live."""
    def __init__(self, id, order_index, num_choices, correct_choices, time_limit_seconds, bank_question_id, question_text=None, choices_text=None):
        self.id = id
        self.order_index = order_index
        self.num_choices = num_choices
        self.correct_choices = correct_choices
        self.time_limit_seconds = time_limit_seconds
        self.bank_question_id = bank_question_id
        self.question_text = question_text
        self.choices_text = choices_text or []
        self.status = "pending"     # pending | active | revealed
        self.started_at = None      # datetime UTC quand la question est lancée
        # Réponses : dict participant_id -> {selected_choices, is_correct, display_name}
        self.answers: dict[int, dict] = {}


class SessionState:
    """État complet d'une session live en mémoire."""
    def __init__(self, code: str, mode: str):
        self.code = code
        self.mode = mode
        self.status = "waiting"                         # waiting | active | ended
        self.participants: dict[int, str] = {}          # participant_id -> display_name
        self.questions: dict[int, QuestionState] = {}   # question_id -> QuestionState
        self._next_participant_id = 1
        self._next_question_id = 1

        # --- Mode Battle ---
        self.battle_time_limit_seconds: int | None = None
        self.battle_started_at = None
        self.battle_roster: list[int] = []   # joueurs figés au lancement
        self.finished: dict[int, dict] = {}  # pid -> {score, total, elapsed, finished_at}

    def add_participant(self, display_name: str) -> int:
        pid = self._next_participant_id
        self._next_participant_id += 1
        self.participants[pid] = display_name
        return pid

    def get_participant_by_name(self, display_name: str) -> int | None:
        for pid, name in self.participants.items():
            if name == display_name:
                return pid
        return None

    def add_question(self, order_index, num_choices, correct_choices, time_limit_seconds, bank_question_id, question_text=None, choices_text=None) -> QuestionState:
        qid = self._next_question_id
        self._next_question_id += 1
        q = QuestionState(qid, order_index, num_choices, correct_choices, time_limit_seconds, bank_question_id, question_text=question_text, choices_text=choices_text)
        self.questions[qid] = q
        return q


# Stockage global des sessions actives : code -> SessionState
sessions: dict[str, SessionState] = {}


# ---------------------------------------------------------------------------
# Gestionnaire de connexions WebSocket
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, session_code: str):
        await websocket.accept()
        self.active.setdefault(session_code, []).append(websocket)

    def disconnect(self, websocket: WebSocket, session_code: str):
        if session_code in self.active:
            self.active[session_code].remove(websocket)

    async def broadcast(self, session_code: str, message: dict):
        payload = json.dumps(message)
        dead = []
        for ws in self.active.get(session_code, []):
            try:
                await ws.send_text(payload)
            except Exception:
                # WS mort ou en cours de fermeture : on le marque sans bloquer les autres
                dead.append(ws)
        # Nettoyage des connexions mortes
        for ws in dead:
            try:
                self.active[session_code].remove(ws)
            except (KeyError, ValueError):
                pass


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def generate_code(length: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


def compute_is_correct(selected: list[int], correct: list[int]) -> bool:
    return sorted(selected) == sorted(correct)


# ---------------------------------------------------------------------------
# Routes : Question Bank (DB persistante)
# ---------------------------------------------------------------------------

def verify_admin_key(x_api_key: str | None = Header(default=None)):
    """
    Vérifie que le header X-Api-Key correspond à ADMIN_API_KEY (variable d'environnement).
    Si ADMIN_API_KEY n'est pas définie, la route est ouverte (dev local).
    """
    admin_key = os.getenv("ADMIN_API_KEY")
    if admin_key and x_api_key != admin_key:
        raise HTTPException(status_code=401, detail="Clé API invalide ou manquante")


@app.post("/bank/questions", response_model=schemas.QuestionBankOut)
def create_bank_question(
    payload: schemas.QuestionBankCreate,
    db: Session = Depends(get_db),
    _: None = Depends(verify_admin_key),  # vérifie la clé avant d'accéder à la DB
):
    q = models.QuestionBank(**payload.model_dump())
    db.add(q); db.commit(); db.refresh(q)
    return q


@app.get("/bank/questions", response_model=list[schemas.QuestionBankOut])
def list_bank_questions(category: str | None = None, db: Session = Depends(get_db)):
    query = db.query(models.QuestionBank)
    if category:
        query = query.filter(models.QuestionBank.category == category)
    return query.all()


# ---------------------------------------------------------------------------
# Routes : Sessions (mémoire)
# ---------------------------------------------------------------------------

@app.post("/sessions", response_model=schemas.SessionOut)
@limiter.limit("10/minute")
async def create_session(request: Request, payload: schemas.SessionCreate):
    code = generate_code()
    # S'assurer que le code est unique
    while code in sessions:
        code = generate_code()
    sessions[code] = SessionState(code=code, mode=payload.mode)
    s = sessions[code]
    return schemas.SessionOut(code=s.code, mode=s.mode, status=s.status)


@app.get("/sessions/{code}", response_model=schemas.SessionOut)
def get_session(code: str):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    return schemas.SessionOut(code=s.code, mode=s.mode, status=s.status)


# ---------------------------------------------------------------------------
# Routes : Questions live (mémoire)
# ---------------------------------------------------------------------------

@app.post("/sessions/{code}/questions", response_model=schemas.QuestionOut)
def add_question(code: str, payload: schemas.QuestionCreate):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    q = s.add_question(
        order_index=payload.order_index,
        num_choices=payload.num_choices,
        correct_choices=payload.correct_choices,
        time_limit_seconds=payload.time_limit_seconds,
        bank_question_id=payload.bank_question_id,
        question_text=getattr(payload, 'question_text', None),
        choices_text=getattr(payload, 'choices_text', None),
    )
    return schemas.QuestionOut(
        id=q.id, order_index=q.order_index, num_choices=q.num_choices,
        correct_choices=q.correct_choices, time_limit_seconds=q.time_limit_seconds,
        started_at=None, status=q.status, bank_question_id=q.bank_question_id,
    )


@app.post("/sessions/{code}/questions/{question_id}/start", response_model=schemas.QuestionOut)
async def start_question(code: str, question_id: int):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    q = s.questions.get(question_id)
    if not q:
        raise HTTPException(404, "Question introuvable")

    q.status = "active"
    q.started_at = datetime.now(timezone.utc)

    await manager.broadcast(code, {
        "type": "question_start",
        "question_id": q.id,
        "order_index": q.order_index,
        "num_choices": q.num_choices,
        "time_limit_seconds": q.time_limit_seconds,
        "started_at": q.started_at.isoformat(),
        "question_text": q.question_text,
        "choices_text": q.choices_text,
    })
    return schemas.QuestionOut(
        id=q.id, order_index=q.order_index, num_choices=q.num_choices,
        correct_choices=q.correct_choices, time_limit_seconds=q.time_limit_seconds,
        started_at=q.started_at.isoformat(), status=q.status, bank_question_id=q.bank_question_id,
    )


@app.post("/sessions/{code}/questions/{question_id}/reveal", response_model=schemas.QuestionStats)
async def reveal_question(code: str, question_id: int):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    q = s.questions.get(question_id)
    if not q:
        raise HTTPException(404, "Question introuvable")

    q.status = "revealed"

    # Calcul des stats depuis les réponses en mémoire
    breakdown: dict[int, int] = {i: 0 for i in range(q.num_choices)}
    results = []
    correct_count = 0

    for pid, answer in q.answers.items():
        for choice in answer["selected_choices"]:
            breakdown[choice] = breakdown.get(choice, 0) + 1
        if answer["is_correct"]:
            correct_count += 1
        results.append(schemas.ParticipantResult(
            display_name=answer["display_name"],
            selected_choices=answer["selected_choices"],
            is_correct=answer["is_correct"],
        ))

    stats = schemas.QuestionStats(
        question_id=q.id,
        total_answers=len(q.answers),
        correct_count=correct_count,
        choices_breakdown=breakdown,
        results=results,
    )

    await manager.broadcast(code, {
        "type": "question_reveal",
        "question_id": q.id,
        "correct_choices": q.correct_choices,
        "stats": stats.model_dump(),
    })
    return stats


# ---------------------------------------------------------------------------
# Routes : Participants (mémoire)
# ---------------------------------------------------------------------------

@app.post("/sessions/{code}/join", response_model=schemas.ParticipantOut)
@limiter.limit("20/minute")
async def join_session(request: Request, code: str, payload: schemas.ParticipantCreate):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")

    # Reconnexion : si le participant existe déjà, on le retourne et on broadcast
    existing_pid = s.get_participant_by_name(payload.display_name)
    if existing_pid:
        await manager.broadcast(code, {
            "type": "participant_join",
            "participant_id": existing_pid,
            "display_name": payload.display_name,
        })
        return schemas.ParticipantOut(id=existing_pid, display_name=payload.display_name)

    # Nouveau participant
    pid = s.add_participant(payload.display_name)
    await manager.broadcast(code, {
        "type": "participant_join",
        "participant_id": pid,
        "display_name": payload.display_name,
    })
    return schemas.ParticipantOut(id=pid, display_name=payload.display_name)


# ---------------------------------------------------------------------------
# Routes : Réponses (mémoire)
# ---------------------------------------------------------------------------

@app.post("/sessions/{code}/questions/{question_id}/answer", response_model=schemas.AnswerOut)
@limiter.limit("30/minute")
async def submit_answer(request: Request, code: str, question_id: int, payload: schemas.AnswerCreate):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    q = s.questions.get(question_id)
    if not q:
        raise HTTPException(404, "Question introuvable")
    if q.status != "active":
        raise HTTPException(400, "La question n'est pas active")

    # Vérification du timer (uniquement en mode live, pas en battle où le timer est global)
    if q.time_limit_seconds and q.started_at:
        elapsed = (datetime.now(timezone.utc) - q.started_at).total_seconds()
        if elapsed > q.time_limit_seconds:
            raise HTTPException(400, "Temps écoulé")

    is_correct = compute_is_correct(payload.selected_choices, q.correct_choices)
    display_name = s.participants.get(payload.participant_id, "Anonyme")

    # Stockage en mémoire (écrase si le participant répond à nouveau)
    q.answers[payload.participant_id] = {
        "selected_choices": payload.selected_choices,
        "is_correct": is_correct,
        "display_name": display_name,
    }

    await manager.broadcast(code, {
        "type": "answer_received",
        "question_id": question_id,
        "total_answers": len(q.answers),
    })
    return schemas.AnswerOut(
        participant_id=payload.participant_id,
        selected_choices=payload.selected_choices,
        is_correct=is_correct,
    )


# ---------------------------------------------------------------------------
# Routes : Mode Battle (mémoire) -- self-paced, classement agrégé
# ---------------------------------------------------------------------------

def _battle_score(s: SessionState, pid: int) -> tuple[int, int]:
    """Score d'un joueur = nb de bonnes réponses sur l'ensemble du set."""
    total = len(s.questions)
    score = sum(
        1 for q in s.questions.values()
        if (a := q.answers.get(pid)) and a["is_correct"]
    )
    return score, total


def _battle_ranking(s: SessionState) -> list[schemas.BattleRankEntry]:
    entries = [
        schemas.BattleRankEntry(
            display_name=s.participants.get(pid, "Anonyme"),
            score=info["score"],
            total=info["total"],
            elapsed_seconds=info["elapsed"],
        )
        for pid, info in s.finished.items()
    ]
    # Meilleur score d'abord, puis temps le plus court (départage Kahoot)
    entries.sort(key=lambda e: (-e.score, e.elapsed_seconds))
    return entries


def _battle_ranking_final(s: SessionState) -> list[schemas.BattleRankEntry]:
    """Classement complet : tout le roster. Les non-finisseurs ont leur
    score partiel (questions non répondues = fausses) et le temps max
    (chrono global ou temps écoulé) pour finir derrière les finisseurs."""
    # Temps de référence pour les abandons : chrono global, sinon temps écoulé
    if s.battle_time_limit_seconds:
        max_elapsed = float(s.battle_time_limit_seconds)
    elif s.battle_started_at:
        max_elapsed = (datetime.now(timezone.utc) - s.battle_started_at).total_seconds()
    else:
        max_elapsed = 0.0

    entries = []
    for pid in s.battle_roster:
        if pid in s.finished:
            info = s.finished[pid]
            entries.append(schemas.BattleRankEntry(
                display_name=s.participants.get(pid, "Anonyme"),
                score=info["score"],
                total=info["total"],
                elapsed_seconds=info["elapsed"],
            ))
        else:
            # Non-finisseur : score calculé sur le set complet, temps max
            score, total = _battle_score(s, pid)
            entries.append(schemas.BattleRankEntry(
                display_name=s.participants.get(pid, "Anonyme"),
                score=score,
                total=total,
                elapsed_seconds=max_elapsed,
            ))
    entries.sort(key=lambda e: (-e.score, e.elapsed_seconds))
    return entries


@app.post("/sessions/{code}/battle/setup")
def battle_setup(code: str, payload: schemas.BattleSetup):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    s.battle_time_limit_seconds = payload.time_limit_seconds
    # Précharge le set partagé : identique pour tous les joueurs
    for q in payload.questions:
        s.add_question(
            order_index=q.order_index,
            num_choices=q.num_choices,
            correct_choices=q.correct_choices,
            time_limit_seconds=None,          # pas de timer par question en battle
            bank_question_id=q.bank_question_id,
            question_text=q.question_text,
            choices_text=q.choices_text,
        )
    return {"ok": True, "question_count": len(s.questions)}


@app.post("/sessions/{code}/battle/start")
async def battle_start(code: str):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    s.status = "active"
    s.battle_started_at = datetime.now(timezone.utc)
    s.battle_roster = list(s.participants.keys())   # fige les joueurs présents

    ordered = sorted(s.questions.values(), key=lambda q: q.order_index)
    questions_payload = []
    for q in ordered:
        q.status = "active"                          # débloque /answer pour tout le set
        questions_payload.append({
            "question_id": q.id,
            "order_index": q.order_index,
            "num_choices": q.num_choices,
            "correct_choices": q.correct_choices,    # envoyé au client comme en solo
            "question_text": q.question_text,
            "choices_text": q.choices_text,
        })

    await manager.broadcast(code, {
        "type": "battle_start",
        "time_limit_seconds": s.battle_time_limit_seconds,
        "started_at": s.battle_started_at.isoformat(),
        "questions": questions_payload,
    })
    return {"ok": True}


@app.post("/sessions/{code}/battle/finish", response_model=schemas.BattleResult)
async def battle_finish(code: str, payload: schemas.BattleFinish):
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    pid = payload.participant_id

    score, total = _battle_score(s, pid)
    elapsed = (
        (datetime.now(timezone.utc) - s.battle_started_at).total_seconds()
        if s.battle_started_at else 0.0
    )
    # Plafonner l'elapsed au chrono global si défini
    if s.battle_time_limit_seconds:
        elapsed = min(elapsed, float(s.battle_time_limit_seconds))

    s.finished[pid] = {
        "score": score,
        "total": total,
        "elapsed": elapsed,
        "finished_at": datetime.now(timezone.utc),
    }

    # Le dernier joueur du roster à finir déclenche le classement final.
    # Sinon, on pousse un classement LIVE partiel (ceux qui ont déjà fini).
    all_finished = set(s.battle_roster).issubset(s.finished.keys())
    ranking = None
    if all_finished:
        ranking = _battle_ranking_final(s)
        await manager.broadcast(code, {
            "type": "battle_ranking",
            "ranking": [e.model_dump() for e in ranking],
        })
    else:
        live = _battle_ranking(s)
        await manager.broadcast(code, {
            "type": "battle_ranking_update",
            "ranking": [e.model_dump() for e in live],
        })

    return schemas.BattleResult(
        participant_id=pid,
        score=score,
        total=total,
        elapsed_seconds=elapsed,
        all_finished=all_finished,
        ranking=ranking,
    )


@app.post("/sessions/{code}/battle/ranking", response_model=list[schemas.BattleRankEntry])
async def battle_force_ranking(code: str):
    """Échappatoire : force le classement FINAL complet (inclut les non-finisseurs
    avec leur score partiel et le temps max)."""
    s = sessions.get(code)
    if not s:
        raise HTTPException(404, "Session introuvable")
    ranking = _battle_ranking_final(s)
    await manager.broadcast(code, {
        "type": "battle_ranking",
        "ranking": [e.model_dump() for e in ranking],
    })
    return ranking


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws/{session_code}")
async def websocket_endpoint(websocket: WebSocket, session_code: str):
    await manager.connect(websocket, session_code)
    try:
        # Rejoindre/reconnexion en cours de route : on renvoie l'état courant
        # UNIQUEMENT à ce client, pour qu'il rattrape la question active.
        s = sessions.get(session_code)
        if s:
            # Mode live : une question active à la fois -> on la rejoue
            for q in s.questions.values():
                if q.status == "active" and s.mode != "battle":
                    await websocket.send_text(json.dumps({
                        "type": "question_start",
                        "question_id": q.id,
                        "order_index": q.order_index,
                        "num_choices": q.num_choices,
                        "time_limit_seconds": q.time_limit_seconds,
                        "started_at": q.started_at.isoformat() if q.started_at else None,
                        "question_text": q.question_text,
                        "choices_text": q.choices_text,
                    }))
                    break

            # Mode battle déjà lancé : on rejoue tout le set à ce client
            if s.mode == "battle" and s.status == "active" and s.battle_started_at:
                ordered = sorted(s.questions.values(), key=lambda q: q.order_index)
                questions_payload = [{
                    "question_id": q.id,
                    "order_index": q.order_index,
                    "num_choices": q.num_choices,
                    "correct_choices": q.correct_choices,
                    "question_text": q.question_text,
                    "choices_text": q.choices_text,
                } for q in ordered]
                await websocket.send_text(json.dumps({
                    "type": "battle_start",
                    "time_limit_seconds": s.battle_time_limit_seconds,
                    "started_at": s.battle_started_at.isoformat(),
                    "questions": questions_payload,
                }))

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, session_code)


# ---------------------------------------------------------------------------
# Fichiers statiques (front) - monté en dernier
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Routes : Flashcards (revision, DB persistante, self-paced)
# Securite : pseudo et status valides par schema (allowlist), ORM parametre
# (pas d'injection SQL), ecritures rate-limitees. Pas de mot de passe :
# modele de confiance assume (promo d'environ 12 personnes).
# ---------------------------------------------------------------------------

@app.post("/flashcards", response_model=schemas.FlashcardOut)
def create_flashcard(
    payload: schemas.FlashcardCreate,
    db: Session = Depends(get_db),
    _: None = Depends(verify_admin_key),  # meme protection que la banque de questions
):
    card = models.Flashcard(**payload.model_dump())
    db.add(card); db.commit(); db.refresh(card)
    return card


@app.get("/flashcards", response_model=list[schemas.FlashcardOut])
def list_flashcards(category: str | None = None, db: Session = Depends(get_db)):
    query = db.query(models.Flashcard)
    if category:
        query = query.filter(models.Flashcard.category == category)
    return query.all()


@app.post("/study/users", response_model=schemas.StudyUserOut)
@limiter.limit("10/minute")
def create_study_user(request: Request, payload: schemas.StudyUserCreate, db: Session = Depends(get_db)):
    pseudo = payload.pseudo.strip().lower()  # normalisation : "Bob" et "bob" = meme user
    user = models.StudyUser(pseudo=pseudo)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # la contrainte UNIQUE a refuse le doublon
        raise HTTPException(409, "Ce pseudo existe deja, choisis-en un autre ou connecte-toi")
    db.refresh(user)
    return user


@app.get("/study/users/{pseudo}", response_model=schemas.StudyUserOut)
@limiter.limit("20/minute")
def get_study_user(request: Request, pseudo: str, db: Session = Depends(get_db)):
    user = db.query(models.StudyUser).filter(models.StudyUser.pseudo == pseudo.strip().lower()).first()
    if not user:
        raise HTTPException(404, "Pseudo introuvable")
    return user


@app.post("/study/users/{pseudo}/progress", response_model=schemas.ProgressOut)
@limiter.limit("60/minute")
def set_progress(request: Request, pseudo: str, payload: schemas.ProgressUpsert, db: Session = Depends(get_db)):
    user = db.query(models.StudyUser).filter(models.StudyUser.pseudo == pseudo.strip().lower()).first()
    if not user:
        raise HTTPException(404, "Pseudo introuvable")
    card = db.query(models.Flashcard).filter(models.Flashcard.id == payload.flashcard_id).first()
    if not card:
        raise HTTPException(404, "Carte introuvable")

    # Upsert : couple (user, carte) unique -> on recupere la ligne, sinon on la cree
    row = (
        db.query(models.UserProgress)
        .filter(
            models.UserProgress.user_id == user.id,
            models.UserProgress.flashcard_id == payload.flashcard_id,
        )
        .first()
    )
    if row:
        row.status = payload.status  # on ecrase le tag precedent
    else:
        row = models.UserProgress(user_id=user.id, flashcard_id=payload.flashcard_id, status=payload.status)
        db.add(row)
    db.commit(); db.refresh(row)
    return row


@app.get("/study/users/{pseudo}/progress", response_model=list[schemas.ProgressOut])
def get_progress(pseudo: str, db: Session = Depends(get_db)):
    user = db.query(models.StudyUser).filter(models.StudyUser.pseudo == pseudo.strip().lower()).first()
    if not user:
        raise HTTPException(404, "Pseudo introuvable")
    return db.query(models.UserProgress).filter(models.UserProgress.user_id == user.id).all()


app.mount("/", StaticFiles(directory="static", html=True), name="static")
