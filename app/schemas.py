from pydantic import BaseModel


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
    mode: str = "live"  # live | solo

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


# --- Question live (mémoire) ---

class QuestionCreate(BaseModel):
    order_index: int
    num_choices: int
    correct_choices: list[int]
    time_limit_seconds: int | None = None
    bank_question_id: int | None = None

class QuestionOut(BaseModel):
    id: int
    order_index: int
    num_choices: int
    correct_choices: list[int]
    time_limit_seconds: int | None
    started_at: str | None
    status: str  # pending | active | revealed
    bank_question_id: int | None


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
