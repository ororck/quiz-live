from typing import Literal

from pydantic import BaseModel, Field


# --- Question Bank ---

class QuestionBankCreate(BaseModel):
    text: str
    num_choices: int
    choices_text: list[str]
    correct_choices: list[int]
    time_limit_seconds: int | None = None
    category: str | None = None

class QuestionBankOut(BaseModel):
    id: int
    text: str
    num_choices: int
    choices_text: list[str]
    correct_choices: list[int]
    time_limit_seconds: int | None
    category: str | None

    model_config = {"from_attributes": True}


# --- Session (mémoire) ---

class SessionCreate(BaseModel):
    mode: str = "live"  # live | solo | battle

class SessionOut(BaseModel):
    code: str
    mode: str
    status: str  # waiting | active | ended


# --- Participant (mémoire) ---

class ParticipantCreate(BaseModel):
    display_name: str

class ParticipantOut(BaseModel):
    id: int
    display_name: str
    # Liste des pseudos deja presents dans la session au moment du join.
    # Permet au joueur qui arrive de peupler sa salle d'attente immediatement,
    # sans attendre les futurs messages WebSocket participant_join (qui ne
    # concernent que les arrivees APRES lui).
    existing_players: list[str] = []


# --- Question live (mémoire) ---

class QuestionCreate(BaseModel):
    order_index: int
    num_choices: int
    correct_choices: list[int]
    time_limit_seconds: int | None = None
    bank_question_id: int | None = None
    question_text: str | None = None
    choices_text: list[str] | None = None

class QuestionOut(BaseModel):
    id: int
    order_index: int
    num_choices: int
    correct_choices: list[int]
    time_limit_seconds: int | None
    started_at: str | None
    status: str  # pending | active | revealed
    bank_question_id: int | None
    question_text: str | None = None
    choices_text: list[str] | None = None


# --- Réponse (mémoire) ---

class AnswerCreate(BaseModel):
    participant_id: int
    selected_choices: list[int]

class AnswerOut(BaseModel):
    participant_id: int
    selected_choices: list[int]
    is_correct: bool


# --- Stats révélation ---

class ParticipantResult(BaseModel):
    display_name: str
    selected_choices: list[int]
    is_correct: bool

class QuestionStats(BaseModel):
    question_id: int
    total_answers: int
    correct_count: int
    choices_breakdown: dict[int, int]
    results: list[ParticipantResult]


# --- Battle (mémoire) ---

class BattleQuestionIn(BaseModel):
    order_index: int
    num_choices: int
    correct_choices: list[int]
    bank_question_id: int | None = None
    question_text: str | None = None
    choices_text: list[str] | None = None

class BattleSetup(BaseModel):
    time_limit_seconds: int | None = None  # chrono global ; None = sans chrono
    questions: list[BattleQuestionIn]

class BattleFinish(BaseModel):
    participant_id: int

class BattleRankEntry(BaseModel):
    display_name: str
    score: int
    total: int
    elapsed_seconds: float

class BattleResult(BaseModel):
    participant_id: int
    score: int
    total: int
    elapsed_seconds: float
    all_finished: bool
    ranking: list[BattleRankEntry] | None = None


# --- Flashcards (révision, DB persistante) ---

class FlashcardCreate(BaseModel):
    front: str
    back: str
    analogy: str | None = None
    category: str
    theme: str | None = None
    card_type: str = "notion"  # notion | scenario


class FlashcardOut(BaseModel):
    id: int
    front: str
    back: str
    analogy: str | None
    category: str
    theme: str | None
    card_type: str  # notion | scenario

    model_config = {"from_attributes": True}


# --- Study users (révision : pseudo sans mot de passe) ---
# Allowlist stricte : longueur bornée + jeu de caractères sûr.
# Coupe à la racine toute injection HTML/JS/SQL dans le pseudo.

class StudyUserCreate(BaseModel):
    pseudo: str = Field(min_length=2, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")

class StudyUserOut(BaseModel):
    id: int
    pseudo: str

    model_config = {"from_attributes": True}


# --- Progression / tags ---
# Le status ne peut valoir que 3 choses : aucune donnée arbitraire en base.

TagStatus = Literal["to_review", "medium", "acquired"]

class ProgressUpsert(BaseModel):
    flashcard_id: int
    status: TagStatus

class ProgressOut(BaseModel):
    flashcard_id: int
    status: TagStatus

    model_config = {"from_attributes": True}
