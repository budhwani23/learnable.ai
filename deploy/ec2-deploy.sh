#!/bin/bash
# Runs ON the EC2 host (sent by the GitHub Actions workflow through SSM Run Command).
# Expects IMAGE (full ECR image URI) and AWS_REGION in the environment.
#
# Containers on a private Docker network "learnable":
#   presenton  slide-deck service (not published; the app reaches it at http://presenton)
#   learnable  the app, published on :80 for CloudFront
# The app container is swapped on every deploy, waits for /healthz, and rolls back on failure.
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${AWS_REGION:?AWS_REGION is required}"
NAME=learnable
PARAM=/learnable/dev/env
STATE_DIR=/etc/learnable
DATA_DIR=/var/lib/learnable
NETWORK=learnable
PRESENTON_IMAGE="${PRESENTON_IMAGE:-ghcr.io/presenton/presenton:latest}"
REGISTRY="${IMAGE%%/*}"

mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
# media/ keeps generated slide decks and job state across deploys (app runs as uid 10001).
mkdir -p "$DATA_DIR/media" "$DATA_DIR/presenton"
chown -R 10001:10001 "$DATA_DIR/media"
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

# App settings (secrets) live encrypted in SSM Parameter Store, never in this command.
umask 077
aws ssm get-parameter --region "$AWS_REGION" --name "$PARAM" --with-decryption \
  --query Parameter.Value --output text > "$STATE_DIR/app.env.new"
{
  echo "PRESENTON_URL=http://presenton"
  # One worker leaves memory for Presenton on the 2 GB host; threads keep requests concurrent.
  echo "GUNICORN_WORKERS=1"
  echo "GUNICORN_THREADS=8"
  echo "PRESENTATION_MAX_CONCURRENT=1"
} >> "$STATE_DIR/app.env.new"
mv "$STATE_DIR/app.env.new" "$STATE_DIR/app.env"

# ---- Presenton (recreated only when its settings or image change) ----
env_get() { grep -E "^$1=" "$STATE_DIR/app.env" | tail -1 | cut -d= -f2- || true; }
google_key="$(env_get GOOGLE_API_KEY)"
proxy_key="$(env_get PRESENTON_IMAGE_PROXY_KEY)"
cat > "$STATE_DIR/presenton.env.new" <<EOF
LLM=google
GOOGLE_API_KEY=$google_key
GOOGLE_MODEL=models/gemini-3.5-flash-lite
PRESENTON_PUBLIC_URL=http://presenton
PRESENTON_COMMUNITY_ENABLED=false
DISABLE_AUTH=true
EOF
if [ -n "$proxy_key" ] && [ -n "$(env_get NVIDIA_API_KEY)" ]; then
  # Slide images: Presenton -> the app's image proxy (NVIDIA FLUX, placeholder on failure).
  cat >> "$STATE_DIR/presenton.env.new" <<EOF
IMAGE_PROVIDER=openai_compatible
OPENAI_COMPAT_IMAGE_BASE_URL=http://$NAME:8000/api/presentations/image-proxy/v1
OPENAI_COMPAT_IMAGE_API_KEY=$proxy_key
OPENAI_COMPAT_IMAGE_MODEL=nvidia
EOF
else
  echo "NVIDIA_API_KEY or PRESENTON_IMAGE_PROXY_KEY not set: slide images use placeholders"
  echo "DISABLE_IMAGE_GENERATION=true" >> "$STATE_DIR/presenton.env.new"
fi
docker pull -q "$PRESENTON_IMAGE" >/dev/null
want="$(cat "$STATE_DIR/presenton.env.new" | sha256sum | cut -c1-16)-$(docker image inspect -f '{{.Id}}' "$PRESENTON_IMAGE" | cut -c8-23)"
have="$(docker inspect -f '{{index .Config.Labels "learnable.config"}}' presenton 2>/dev/null || true)"
running="$(docker inspect -f '{{.State.Running}}' presenton 2>/dev/null || echo false)"
mv "$STATE_DIR/presenton.env.new" "$STATE_DIR/presenton.env"
if [ "$want" != "$have" ] || [ "$running" != "true" ]; then
  echo "Starting Presenton"
  docker rm -f presenton >/dev/null 2>&1 || true
  # Not published on the host: only the app container can reach it (no auth needed).
  docker run -d --name presenton --network "$NETWORK" --restart unless-stopped \
    --env-file "$STATE_DIR/presenton.env" --label "learnable.config=$want" \
    -v "$DATA_DIR/presenton:/app_data" \
    --log-opt max-size=20m --log-opt max-file=3 \
    "$PRESENTON_IMAGE" >/dev/null
fi

# ---- App ----
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker pull -q "$IMAGE"

previous="$(cat "$STATE_DIR/current-image" 2>/dev/null || true)"

start() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --network "$NETWORK" --restart unless-stopped \
    -p 80:8000 --env-file "$STATE_DIR/app.env" \
    -v "$DATA_DIR/media:/app/backend/media" \
    --log-opt max-size=20m --log-opt max-file=5 \
    "$1" >/dev/null
}

healthy() {
  for _ in $(seq 1 40); do
    if curl -fsS -m 4 http://127.0.0.1/healthz >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}

start "$IMAGE"
if healthy; then
  echo "$IMAGE" > "$STATE_DIR/current-image"
  echo "Deployed $IMAGE"
  # Presenton can take a minute to boot; report but don't fail the deploy on it.
  for _ in $(seq 1 30); do
    if docker exec "$NAME" python -c "import urllib.request; urllib.request.urlopen('http://presenton/api/v1/auth/status', timeout=4)" >/dev/null 2>&1; then
      echo "Presenton reachable from the app"; break
    fi
    sleep 4
  done
  docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
  exit 0
fi

echo "New container failed its health check. Last log lines:"
docker logs --tail 80 "$NAME" 2>&1 || true
if [ -n "$previous" ] && [ "$previous" != "$IMAGE" ]; then
  echo "Rolling back to $previous"
  start "$previous"
  healthy && echo "Rollback healthy" || echo "Rollback also unhealthy"
fi
exit 1
