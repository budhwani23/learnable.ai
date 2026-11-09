# learnable.ai: one image with the Django API and the built React frontend.
#   docker build -t learnable .
#   docker run -p 8000:8000 --env-file backend/.env -e DJANGO_SECRET_KEY=... learnable
# The app listens on $PORT (default 8000); /healthz is the health check.

# ---- 1. Build the React frontend ----------------------------------------------------
FROM node:20-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Public build-time settings (baked into the JS bundle; never put secrets here).
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
RUN npm run build

# ---- 2. Python runtime -------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_DEBUG=false \
    FRONTEND_DIST=/app/frontend/dist \
    PORT=8000

WORKDIR /app/backend

# Explainer videos: manim needs Cairo/Pango, ffmpeg for media, and a compact LaTeX for
# MathTex. Build headers are removed in the same layer once the Python wheels are built.
COPY backend/requirements.txt backend/requirements-video.txt ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
      texlive-latex-base texlive-latex-extra texlive-fonts-recommended texlive-science dvisvgm \
      build-essential pkg-config libcairo2-dev libpango1.0-dev \
 && pip install -r requirements.txt -r requirements-video.txt \
 && apt-get purge -y build-essential pkg-config libcairo2-dev libpango1.0-dev \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*

# Cloud defaults: 720p final render, 480p quality-check previews (override per environment).
ENV EXPLAINER_FINAL_QUALITY=-qm \
    EXPLAINER_PREVIEW_QUALITY=-ql \
    EXPLAINER_MAX_CONCURRENT=1

COPY backend/ ./
COPY --from=frontend /src/frontend/dist /app/frontend/dist

# collectstatic needs a key at build time only; the real one comes from the environment.
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput \
 && useradd --create-home --uid 10001 app \
 && mkdir -p logs media temp \
 && chown -R app:app /app/backend/logs /app/backend/media /app/backend/temp \
 && chmod +x docker-entrypoint.sh
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/healthz', timeout=4)"

ENTRYPOINT ["./docker-entrypoint.sh"]
