# --- Stage 1 : build des dépendances ---
FROM python:3.12-slim AS builder

WORKDIR /app

# Copie uniquement le fichier de dépendances d'abord
# (optimisation cache Docker : si requirements.txt ne change pas,
# cette couche est réutilisée sans réinstaller)
COPY requirements.txt .

RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# --- Stage 2 : image finale ---
FROM python:3.12-slim

WORKDIR /app/app

COPY --from=builder /install /usr/local
COPY app/ .
COPY static/ ../static/

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]