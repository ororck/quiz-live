from datetime import datetime, timezone

from sqlalchemy import ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class QuizSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(unique=True, index=True)
    status: Mapped[str] = mapped_column(default="waiting")  # waiting | active | ended
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    questions: Mapped[list["Question"]] = relationship(back_populates="session")
    participants: Mapped[list["Participant"]] = relationship(back_populates="session")


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    order_index: Mapped[int]                                # numero de la question (1, 2, 3...)
    num_choices: Mapped[int]                                # nombre de choix proposes (4 -> A,B,C,D)
    correct_choices: Mapped[list] = mapped_column(JSON)     # index corrects, ex: [0, 2]
    time_limit_seconds: Mapped[int | None] = mapped_column(default=None)  # None = pas de timer
    started_at: Mapped[datetime | None] = mapped_column(default=None)     # rempli au lancement
    status: Mapped[str] = mapped_column(default="pending")  # pending | active | revealed

    session: Mapped["QuizSession"] = relationship(back_populates="questions")
    answers: Mapped[list["Answer"]] = relationship(back_populates="question")


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    display_name: Mapped[str]
    joined_at: Mapped[datetime] = mapped_column(default=utcnow)

    session: Mapped["QuizSession"] = relationship(back_populates="participants")
    answers: Mapped[list["Answer"]] = relationship(back_populates="participant")


class Answer(Base):
    __tablename__ = "answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"))
    participant_id: Mapped[int] = mapped_column(ForeignKey("participants.id"))
    selected_choices: Mapped[list] = mapped_column(JSON)    # index choisis, ex: [1]
    is_correct: Mapped[bool]                                # calcule au moment de repondre
    answered_at: Mapped[datetime] = mapped_column(default=utcnow)

    question: Mapped["Question"] = relationship(back_populates="answers")
    participant: Mapped["Participant"] = relationship(back_populates="answers")