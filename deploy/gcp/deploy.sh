#!/usr/bin/env bash
# Deploy your own Vibe Crypto MCP server to Google Cloud Run.
# One person, one deployment: the server holds that person's broker keys.
# See deploy/gcp/README.md. Use --dry-run first: it prints every command and runs no gcloud.
set -euo pipefail

SECRET_NAME="vibe-crypto-mcp-token"

usage() {
  cat <<'USAGE'
Usage: deploy/gcp/deploy.sh [options]

Deploys the Vibe Crypto MCP server (HTTP transport, token protected) to Cloud Run,
with the token in Secret Manager and a Cloud Storage bucket as the data folder.

Options:
  --project ID      Google Cloud project (default: gcloud config get-value project;
                    required with --dry-run)
  --region REGION   Cloud Run region (default: us-central1)
  --service NAME    Cloud Run service name (default: vibe-crypto-mcp)
  --bucket NAME     Data bucket (default: <project>-vibe-crypto-data)
  --ref REF         Git ref of vibe-trading-crypto to install (default: main)
  --with PKGS       Comma-separated extra Python packages, for example
                    keyring,alpaca-py (default: keyring)
  --enable-orders   Turn on the order tools (VIBE_CRYPTO_MCP_ENABLE_ORDERS=1).
                    Default: off. Live orders still need a mandate and the kill switch.
  --memory SIZE     Memory per instance (default: 2Gi)
  --dry-run         Print every command (prefixed with "+ ") and run no gcloud command
  -h, --help        Show this help
USAGE
}

PROJECT=""
REGION="us-central1"
SERVICE="vibe-crypto-mcp"
BUCKET=""
REF="main"
WITH="keyring"
ENABLE_ORDERS=0
MEMORY="2Gi"
DRY_RUN=0

need_value() {
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    echo "error: $1 needs a value" >&2
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) need_value "$@"; PROJECT="$2"; shift 2 ;;
    --region) need_value "$@"; REGION="$2"; shift 2 ;;
    --service) need_value "$@"; SERVICE="$2"; shift 2 ;;
    --bucket) need_value "$@"; BUCKET="$2"; shift 2 ;;
    --ref) need_value "$@"; REF="$2"; shift 2 ;;
    --with) need_value "$@"; WITH="$2"; shift 2 ;;
    --memory) need_value "$@"; MEMORY="$2"; shift 2 ;;
    --enable-orders) ENABLE_ORDERS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# Print the command (shell-quoted) and run it, or only print it with --dry-run.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

# a) gcloud present
if [ "$DRY_RUN" = 0 ] && ! command -v gcloud >/dev/null 2>&1; then
  echo "error: gcloud is not installed. See https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

if [ -z "$PROJECT" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    echo "error: --project is required with --dry-run" >&2
    exit 2
  fi
  PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
  if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
    echo "error: no project. Pass --project ID or run: gcloud config set project ID" >&2
    exit 2
  fi
fi
[ -n "$BUCKET" ] || BUCKET="${PROJECT}-vibe-crypto-data"

echo "Project: $PROJECT | region: $REGION | service: $SERVICE | bucket: gs://$BUCKET | ref: $REF"
[ "$DRY_RUN" = 1 ] && echo "Dry run: nothing below is executed."

# b) APIs
run gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
  --project "$PROJECT"

# c) Bucket for the data folder (paper runs, settings, connector JSON files)
if [ "$DRY_RUN" = 1 ]; then
  echo "# create the bucket only if 'gcloud storage buckets describe gs://$BUCKET' fails"
  run gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
elif ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  run gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
else
  echo "Bucket gs://$BUCKET already exists, keeping it."
fi

# d) Access token in Secret Manager
if [ "$DRY_RUN" = 1 ]; then
  TOKEN="<token>"
  echo "# if the secret does not exist yet, generate a token and create it:"
  echo "+ printf %s '<token>' | gcloud secrets create $SECRET_NAME --data-file=- --replication-policy=automatic --project $PROJECT"
  echo "# otherwise read the existing token:"
  run gcloud secrets versions access latest --secret "$SECRET_NAME" --project "$PROJECT"
elif gcloud secrets describe "$SECRET_NAME" --project "$PROJECT" >/dev/null 2>&1; then
  echo "Secret $SECRET_NAME exists, reusing its latest version."
  TOKEN="$(gcloud secrets versions access latest --secret "$SECRET_NAME" --project "$PROJECT")"
else
  if command -v python3 >/dev/null 2>&1; then
    TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  else
    TOKEN="$(openssl rand -hex 32)"
  fi
  printf %s "$TOKEN" | gcloud secrets create "$SECRET_NAME" --data-file=- \
    --replication-policy=automatic --project "$PROJECT"
fi

# e) Let the Cloud Run service account read the secret and use the bucket
if [ "$DRY_RUN" = 1 ]; then
  PROJECT_NUMBER="<project-number>"
  run gcloud projects describe "$PROJECT" --format='value(projectNumber)'
else
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
fi
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
run gcloud secrets add-iam-policy-binding "$SECRET_NAME" --project "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$SA" --role roles/storage.objectUser

# f) Stage the build directory: the Dockerfile and a generated requirements.txt
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
cp "$(dirname "$0")/Dockerfile" "$BUILD_DIR/Dockerfile"
{
  echo "vibe-crypto[keyring] @ git+https://github.com/buckleson/vibe-trading-crypto@${REF}"
  IFS=',' read -r -a EXTRA <<<"$WITH"
  for pkg in "${EXTRA[@]}"; do
    [ -n "$pkg" ] && echo "$pkg"
  done
} >"$BUILD_DIR/requirements.txt"
echo "Staged $BUILD_DIR with requirements.txt:"
sed 's/^/    /' "$BUILD_DIR/requirements.txt"

# g) Deploy.
# --allow-unauthenticated: ChatGPT cannot sign in with Google IAM, so the Cloud Run
#   front door must be open. The access control is the server's own token guard
#   (VIBE_CRYPTO_MCP_TOKEN): requests without the token get 401.
# --max-instances 1: MCP sessions live in memory and the bucket has no file locking,
#   so a second instance would break sessions and could corrupt shared files.
# mount-options: the container runs as uid 1000, so the bucket mount must be owned by it.
run gcloud run deploy "$SERVICE" --source "$BUILD_DIR" --project "$PROJECT" --region "$REGION" \
  --port 8080 --allow-unauthenticated --min-instances 1 --max-instances 1 --cpu 1 \
  --memory "$MEMORY" --timeout 3600 --execution-environment gen2 \
  --set-secrets "VIBE_CRYPTO_MCP_TOKEN=${SECRET_NAME}:latest" \
  --set-env-vars "VIBE_CRYPTO_MCP_ENABLE_ORDERS=${ENABLE_ORDERS}" \
  --add-volume "name=data,type=cloud-storage,bucket=${BUCKET},mount-options=uid=1000;gid=1000;implicit-dirs" \
  --add-volume-mount "volume=data,mount-path=/home/vibe/.vibe-trading" \
  --quiet

# h) Print how to connect
if [ "$DRY_RUN" = 1 ]; then
  URL="https://<service-url>"
  run gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
else
  URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)')"
fi

cat <<EOF

Deployed. Connect your apps:

  ChatGPT (Settings > Apps & Connectors, Authentication: No authentication):
    MCP server URL:  $URL/$TOKEN/mcp

  Claude Code:
    claude mcp add --transport http vibe-crypto $URL/mcp --header "Authorization: Bearer $TOKEN"

WARNING
  This server holds your broker keys and can act on your accounts.
  - Never share the URL or the token. Anyone with either one controls your server.
  - Each friend deploys their own copy. Do not run a shared server.
  - Rotate the token: add a new secret version, then redeploy:
      printf %s "<new token>" | gcloud secrets versions add $SECRET_NAME --data-file=- --project $PROJECT
      deploy/gcp/deploy.sh --project $PROJECT --region $REGION

Cost: --min-instances 1 keeps one instance running, so it bills while idle. See the
Cloud Run pricing page: https://cloud.google.com/run/pricing
EOF
