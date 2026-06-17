from datetime import datetime, timezone

from sqlalchemy import ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class QuestionBank(Base):
    __tablename__ = "question_bank"

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str]
    num_choices: Mapped[int]
    choices_text: Mapped[list] = mapped_column(JSON)        # ex: ["Paris", "Londres", "Berlin"]
    correct_choices: Mapped[list] = mapped_column(JSON)     # ex: [0, 2]
    time_limit_seconds: Mapped[int | None] = mapped_column(default=None)
    category: Mapped[str | None] = mapped_column(default=None)  # tag libre ("Azure", "Linux"...)

    questions: Mapped[list["Question"]] = relationship(back_populates="bank_question")


class QuizSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(unique=True, index=True)
    mode: Mapped[str] = mapped_column(default="live")       # live | solo
    status: Mapped[str] = mapped_column(default="waiting")  # waiting | active | ended
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    questions: Mapped[list["Question"]] = relationship(back_populates="session")
    participants: Mapped[list["Participant"]] = relationship(back_populates="session")


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    bank_question_id: Mapped[int | None] = mapped_column(ForeignKey("question_bank.id"), default=None)
    order_index: Mapped[int]
    num_choices: Mapped[int]
    correct_choices: Mapped[list] = mapped_column(JSON)
    time_limit_seconds: Mapped[int | None] = mapped_column(default=None)
    started_at: Mapped[datetime | None] = mapped_column(default=None)
    status: Mapped[str] = mapped_column(default="pending")  # pending | active | revealed

    session: Mapped["QuizSession"] = relationship(back_populates="questions")
    bank_question: Mapped["QuestionBank | None"] = relationship(back_populates="questions")
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
    selected_choices: Mapped[list] = mapped_column(JSON)
    is_correct: Mapped[bool]
    answered_at: Mapped[datetime] = mapped_column(default=utcnow)

    question: Mapped["Question"] = relationship(back_populates="answers")
    participant: Mapped["Participant"] = relationship(back_populates="answers")