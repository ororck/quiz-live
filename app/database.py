import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# DATABASE_URL peut être surchargée par variable d'environnement (Azure File Share + SQLite, ou PostgreSQL plus tard)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./quiz.db")

# check_same_thread=False uniquement nécessaire pour SQLite (FastAPI utilise plusieurs threads)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
