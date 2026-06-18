# --- Stage 1 : build des dépendances ---
# Image slim pour réduire la taille du container
FROM python:3.12-slim AS builder

# Répertoire de travail pour l'installation
WORKDIR /app

# On copie uniquement requirements.txt d'abord
# Optimisation cache : si requirements.txt ne change pas, cette couche est réutilisée
COPY requirements.txt .

# Installation dans /install (préfixe isolé) pour ne pas polluer l'image finale
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# --- Stage 2 : image finale ---
# Nouvelle image propre, sans les outils de build
FROM python:3.12-slim

# WORKDIR /app : app/ et static/ seront des sous-dossiers de /app
WORKDIR /app

# On récupère uniquement les packages installés depuis le stage builder
COPY --from=builder /install /usr/local

# Copie du code Python (FastAPI, routes, models...)
COPY app/ ./app/

# Copie des fichiers statiques (host.html, student.html)
# main.py fait : StaticFiles(directory="static") → cherche /app/static
COPY static/ ./static/

# Empêche Python de créer des fichiers .pyc (inutiles en container)
ENV PYTHONDONTWRITEBYTECODE=1

# Force Python à écrire les logs immédiatement sans buffer
ENV PYTHONUNBUFFERED=1

# Port exposé — Azure Container Apps utilise cette info
EXPOSE 8000

# Lancement : uvicorn depuis /app, importe app/main.py comme module app.main
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]