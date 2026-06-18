import json
import random
import string
from datetime import datetime, timezone

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import Base, engine, get_db
import models, schemas

Base.metadata.create_all(bind=engine)

app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


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
# Routes : Question Bank
# ---------------------------------------------------------------------------

@app.post("/bank/questions", response_model=schemas.QuestionBankOut)
def create_bank_question(payload: schemas.QuestionBankCreate, db: Session = Depends(get_db)):
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
# Routes : Sessions
# ---------------------------------------------------------------------------

@app.post("/sessions", response_model=schemas.SessionOut)
@limiter.limit("10/minute")
async def create_session(request: Request, payload: schemas.SessionCreate, db: Session = Depends(get_db)):
    code = generate_code()
    session = models.QuizSession(code=code, mode=payload.mode)
    db.add(session); db.commit(); db.refresh(session)
    return session


@app.get("/sessions/{code}", response_model=schemas.SessionOut)
def get_session(code: str, db: Session = Depends(get_db)):
    session = db.query(models.QuizSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(404, "Session introuvable")
    return session


# ---------------------------------------------------------------------------
# Routes : Questions (mode live - creees par le formateur)
# ---------------------------------------------------------------------------

@app.post("/sessions/{code}/questions", response_model=schemas.QuestionOut)
def add_question(code: str, payload: schemas.QuestionCreate, db: Session = Depends(get_db)):
    session = db.query(models.QuizSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(404, "Session introuvable")
    q = models.Question(session_id=session.id, **payload.model_dump())
    db.add(q); db.commit(); db.refresh(q)
    return q


@app.post("/sessions/{code}/questions/{question_id}/start", response_model=schemas.QuestionOut)
async def start_question(code: str, question_id: int, db: Session = Depends(get_db)):
    q = db.query(models.Question).filter_by(id=question_id).first()
    if not q:
        raise HTTPException(404, "Question introuvable")
    q.status = "active"
    q.started_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(q)

    await manager.broadcast(code, {
        "type": "question_start",
        "question_id": q.id,
        "order_index": q.order_index,
        "num_choices": q.num_choices,
        "time_limit_seconds": q.time_limit_seconds,
        "started_at": q.started_at.isoformat(),
    })
    return q


@app.post("/sessions/{code}/questions/{question_id}/reveal", response_model=schemas.QuestionStats)
async def reveal_question(code: str, question_id: int, db: Session = Depends(get_db)):
    q = db.query(models.Question).filter_by(id=question_id).first()
    if not q:
        raise HTTPException(404, "Question introuvable")
    q.status = "revealed"
    db.commit()

    breakdown: dict[int, int] = {i: 0 for i in range(q.num_choices)}
    results = []
    correct_count = 0

    for answer in q.answers:
        for choice in answer.selected_choices:
            breakdown[choice] = breakdown.get(choice, 0) + 1
        if answer.is_correct:
            correct_count += 1
        results.append(schemas.ParticipantResult(
            display_name=answer.participant.display_name,
            selected_choices=answer.selected_choices,
            is_correct=answer.is_correct,
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
# Routes : Participants
# ---------------------------------------------------------------------------

@app.post("/sessions/{code}/join", response_model=schemas.ParticipantOut)
@limiter.limit("20/minute")
async def join_session(request: Request, code: str, payload: schemas.ParticipantCreate, db: Session = Depends(get_db)):
    session = db.query(models.QuizSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(404, "Session introuvable")

    existing = db.query(models.Participant).filter_by(
        session_id=session.id,
        display_name=payload.display_name
    ).first()
    if existing:
        await manager.broadcast(code, {
           "type": "participant_join",
           "participant_id": existing.id,
           "display_name": existing.display_name,
    })
        return existing

    p = models.Participant(session_id=session.id, display_name=payload.display_name)
    db.add(p); db.commit(); db.refresh(p)

    await manager.broadcast(code, {
        "type": "participant_join",
        "participant_id": p.id,
        "display_name": p.display_name,
    })
    return p


# ---------------------------------------------------------------------------
# Routes : Reponses
# ---------------------------------------------------------------------------

@app.post("/sessions/{code}/questions/{question_id}/answer", response_model=schemas.AnswerOut)
@limiter.limit("30/minute")
async def submit_answer(request: Request, code: str, question_id: int, payload: schemas.AnswerCreate, db: Session = Depends(get_db)):
    q = db.query(models.Question).filter_by(id=question_id).first()
    if not q:
        raise HTTPException(404, "Question introuvable")
    if q.status != "active":
        raise HTTPException(400, "La question n'est pas active")

    if q.time_limit_seconds and q.started_at:
        elapsed = (datetime.now(timezone.utc) - q.started_at.replace(tzinfo=timezone.utc)).total_seconds()
        if elapsed > q.time_limit_seconds:
            raise HTTPException(400, "Temps ecoule")

    is_correct = compute_is_correct(payload.selected_choices, q.correct_choices)
    answer = models.Answer(
        question_id=question_id,
        participant_id=payload.participant_id,
        selected_choices=payload.selected_choices,
        is_correct=is_correct,
    )
    db.add(answer); db.commit(); db.refresh(answer)

    await manager.broadcast(code, {
        "type": "answer_received",
        "question_id": question_id,
        "total_answers": len(q.answers),
    })
    return answer


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
# Fichiers statiques (front) - monte en dernier
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory="static", html=True), name="static")
