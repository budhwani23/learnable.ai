#!/bin/bash
# Runs ON the EC2 host (sent by the GitHub Actions workflow through SSM Run Command).
# Expects IMAGE (full ECR image URI) and AWS_REGION in the environment.
# Pulls the image, swaps the container, waits for /healthz, and rolls back on failure.
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${AWS_REGION:?AWS_REGION is required}"
NAME=learnable
PARAM=/learnable/dev/env
STATE_DIR=/etc/learnable
REGISTRY="${IMAGE%%/*}"

mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"

# App settings (secrets) live encrypted in SSM Parameter Store, never in this command.
umask 077
aws ssm get-parameter --region "$AWS_REGION" --name "$PARAM" --with-decryption \
  --query Parameter.Value --output text > "$STATE_DIR/app.env.new"
mv "$STATE_DIR/app.env.new" "$STATE_DIR/app.env"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker pull -q "$IMAGE"

previous="$(cat "$STATE_DIR/current-image" 2>/dev/null || true)"

start() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped \
    -p 80:8000 --env-file "$STATE_DIR/app.env" \
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
