from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import JSON, ForeignKey, UniqueConstraint, func

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
    explanation: Mapped[str | None] = mapped_column(default=None)  # corrigé (examens blancs)


class Flashcard(Base):
    """
    Table permanente : cartes de révision atomiques (une notion OU une mise en situation par carte).
    Indépendante du quiz live : mode self-paced, aucun état en mémoire, pas de WebSocket.
    """
    __tablename__ = "flashcards"

    id: Mapped[int] = mapped_column(primary_key=True)
    front: Mapped[str]                                       # recto : la notion / la question
    back: Mapped[str]                                        # verso : la réponse
    analogy: Mapped[str | None] = mapped_column(default=None)  # analogie optionnelle
    category: Mapped[str] = mapped_column(index=True)        # ex: "az-900-module-1"
    theme: Mapped[str | None] = mapped_column(default=None, index=True)  # sous-categorie : slug du theme officiel
    card_type: Mapped[str] = mapped_column(default="notion")   # "notion" | "scenario"


class StudyUser(Base):
    """
    Identité légère pour la révision : un pseudo, sans mot de passe.
    L'unicité du pseudo est garantie par la base (UNIQUE), pas par une vérif manuelle.
    """
    __tablename__ = "study_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    pseudo: Mapped[str] = mapped_column(unique=True, index=True)  # UNIQUE = la vérif du nom
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class UserProgress(Base):
    """
    Progression de révision : un tag (status) par paire (utilisateur, carte).
    La contrainte UNIQUE empêche deux lignes pour la même carte d'un même user -> upsert propre.
    """
    __tablename__ = "user_progress"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("study_users.id"))
    flashcard_id: Mapped[int] = mapped_column(ForeignKey("flashcards.id"))
    status: Mapped[str]                                      # "to_review" | "medium" | "acquired"
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("user_id", "flashcard_id"),)
