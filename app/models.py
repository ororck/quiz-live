from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import JSON

from database import Base


class QuestionBank(Base):
    """
    Table permanente : banque de questions pour le mode solo et les sessions live.
    Seule table persistée en DB -- tout le reste (sessions, participants, réponses) vit en mémoire.
    """
    __tablename__ = "question_bank"

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str]                                        # énoncé de la question
    num_choices: Mapped[int]                                 # nombre de choix (2 à 6)
    choices_text: Mapped[list] = mapped_column(JSON)         # ex: ["Paris", "Londres", "Berlin"]
    correct_choices: Mapped[list] = mapped_column(JSON)      # ex: [0, 2]
    time_limit_seconds: Mapped[int | None] = mapped_column(default=None)
    category: Mapped[str | None] = mapped_column(default=None)  # tag : "az-900", "az-104", etc.
