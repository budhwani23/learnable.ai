#!/bin/sh
# Container start: apply database migrations, then serve with gunicorn.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  python manage.py migrate --noinput
fi

# Long timeout: summaries/quizzes call Gemini and file uploads can be large.
# Threads: Presenton's slide-text calls (llm-proxy) each hold a thread for a few
# seconds while a deck is written, so leave room for normal page requests.
exec gunicorn api.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${GUNICORN_WORKERS:-2}" \
  --threads "${GUNICORN_THREADS:-12}" \
  --timeout "${GUNICORN_TIMEOUT:-300}" \
  --access-logfile - \
  --error-logfile -
