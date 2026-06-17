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

WORKDIR /app

# Copie les dépendances installées depuis le stage builder
COPY --from=builder /install /usr/local

# Copie le code de l'application
COPY app/ ./app/
COPY static/ ./static/

# Variable d'environnement pour que Python n'écrive pas de .pyc
# et affiche les logs directement (pas de buffer)
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Port exposé (documentaire, pas obligatoire)
EXPOSE 8000

# Commande de démarrage
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
