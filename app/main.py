import json
import random
import string
from datetime import datetime, timezone

import os
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request, Header
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
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


# ---------------------------------------------------------------------------
# Structures de données en mémoire (sessions, participants, questions, réponses)
# Ces données sont éphémères : elles disparaissent quand le container redémarre.
# C'est voulu : les sessions live sont temporaires.
# ---------------------------------------------------------------------------

class QuestionState:
    """État d'une question active dans une session live."""
    def __init__(self, id, order_index, num_choices, correct_choices, time_limit_seconds, bank_question_id):
        self.id = id
        self.order_index = order_index
        self.num_choices = num_choices
        self.correct_choices = correct_choices
        self.time_limit_seconds = time_limit_seconds
        self.bank_question_id = bank_question_id
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

    def add_question(self, order_index, num_choices, correct_choices, time_limit_seconds, bank_question_id) -> QuestionState:
        qid = self._next_question_id
        self._next_question_id += 1
        q = QuestionState(qid, order_index, num_choices, correct_choices, time_limit_seconds, bank_question_id)
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
        for ws in self.active.get(session_code, []):
            await ws.send_text(json.dumps(message))


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

    # Vérification du timer
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
# WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws/{session_code}")
async def websocket_endpoint(websocket: WebSocket, session_code: str):
    await manager.connect(websocket, session_code)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, session_code)


# ---------------------------------------------------------------------------
# Fichiers statiques (front) - monté en dernier
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory="static", html=True), name="static")
