#!/usr/bin/env bash
# One-time setup of the GitHub settings used by .github/workflows/deploy-dev.yml.
# Run it yourself (it reads secrets from backend/.env and never prints them):
#
#   bash scripts/setup-github-deploy.sh
#
# Requires the GitHub CLI (gh) logged in with admin access to the repository.
set -euo pipefail

REPO="${REPO:-budhwani23/learnable.ai}"
ENV_FILE="${ENV_FILE:-backend/.env}"
AWS_ROLE_ARN="${AWS_ROLE_ARN:-arn:aws:iam::123932467793:role/learnable-github-deploy-dev}"
ECR_REPOSITORY_URI="${ECR_REPOSITORY_URI:-123932467793.dkr.ecr.eu-west-1.amazonaws.com/learnable}"
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-i-037bead7d1163d110}"
APP_URL="${APP_URL:-https://dp2km8sq14xta.cloudfront.net}"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

env_value() {  # read KEY=value from the env file without sourcing it (empty if missing)
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- \
    | sed -e 's/\r$//' -e 's/^["'\'']//' -e 's/["'\'']$//'
}

FAILED=0
set_secret() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then echo "  skip $name (not in $ENV_FILE)"; return 0; fi
  # No --body: gh reads the value from stdin, so it never appears in the process list.
  if printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --env dev >/dev/null; then
    echo "  secret $name set"
  else
    echo "  FAILED to set $name"; FAILED=1
  fi
}

echo "Creating the 'dev' environment in $REPO (deployment branch: dev)"
gh api -X PUT "repos/$REPO/environments/dev" --silent \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST "repos/$REPO/environments/dev/deployment-branch-policies" --silent \
  -f name=dev -f type=branch 2>/dev/null || true

echo "Repository variables"
gh variable set AWS_ROLE_ARN --repo "$REPO" --body "$AWS_ROLE_ARN"
gh variable set ECR_REPOSITORY_URI --repo "$REPO" --body "$ECR_REPOSITORY_URI"
gh variable set EC2_INSTANCE_ID --repo "$REPO" --body "$EC2_INSTANCE_ID"
gh variable set APP_URL --repo "$REPO" --body "$APP_URL"

echo "Secrets (environment: dev)"
# A fresh Django secret for the deployed app. An existing one is kept unless
# ROTATE_DJANGO_SECRET=1 (rotating signs everyone out of the deployed app).
existing="$(gh secret list --repo "$REPO" --env dev | cut -f1 || true)"
if [ "${ROTATE_DJANGO_SECRET:-0}" = "1" ] || ! printf '%s\n' "$existing" | grep -qx DJANGO_SECRET_KEY; then
  set_secret DJANGO_SECRET_KEY "$(python -c 'import secrets; print(secrets.token_urlsafe(50))')"
fi
for key in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD GOOGLE_API_KEY GOOGLE_OAUTH_CLIENT_ID; do
  set_secret "$key" "$(env_value "$key")"
done
if [ "$FAILED" = "1" ]; then echo "Some secrets failed; fix the errors above and run again."; exit 1; fi
echo "Done. Push to dev (or run the 'Deploy dev' workflow) to deploy."
