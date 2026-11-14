#!/usr/bin/env bash
# Remove the Cloud Run service created by deploy.sh. Data and the token secret are
# kept unless you ask for them to be deleted. Use --dry-run to see the commands.
set -euo pipefail

SECRET_NAME="vibe-crypto-mcp-token"

usage() {
  cat <<'USAGE'
Usage: deploy/gcp/teardown.sh [options]

Deletes the Cloud Run service. Keeps the data bucket and the token secret unless told otherwise.

Options:
  --project ID      Google Cloud project (default: gcloud config get-value project;
                    required with --dry-run)
  --region REGION   Cloud Run region (default: us-central1)
  --service NAME    Cloud Run service name (default: vibe-crypto-mcp)
  --bucket NAME     Data bucket (default: <project>-vibe-crypto-data)
  --delete-data     Also delete the bucket and everything in it (paper runs, settings,
                    broker JSON files). Asks you to type the bucket name unless --yes.
  --delete-secret   Also delete the token secret (vibe-crypto-mcp-token)
  --yes             Do not ask for confirmation
  --dry-run         Print every command (prefixed with "+ ") and run no gcloud command
  -h, --help        Show this help
USAGE
}

PROJECT=""
REGION="us-central1"
SERVICE="vibe-crypto-mcp"
BUCKET=""
DELETE_DATA=0
DELETE_SECRET=0
YES=0
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
    --delete-data) DELETE_DATA=1; shift ;;
    --delete-secret) DELETE_SECRET=1; shift ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

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

run gcloud run services delete "$SERVICE" --project "$PROJECT" --region "$REGION" --quiet

KEPT=()

if [ "$DELETE_DATA" = 1 ]; then
  if [ "$YES" = 0 ] && [ "$DRY_RUN" = 0 ]; then
    echo "This deletes gs://$BUCKET and everything in it (paper runs, settings, broker files)."
    printf 'Type the bucket name to confirm: '
    read -r answer
    if [ "$answer" != "$BUCKET" ]; then
      echo "Name did not match. Nothing else was deleted." >&2
      exit 1
    fi
  fi
  run gcloud storage rm --recursive "gs://$BUCKET"
else
  KEPT+=("data bucket gs://$BUCKET (use --delete-data to remove it)")
fi

if [ "$DELETE_SECRET" = 1 ]; then
  run gcloud secrets delete "$SECRET_NAME" --project "$PROJECT" --quiet
else
  KEPT+=("secret $SECRET_NAME (use --delete-secret to remove it)")
fi

echo
if [ "${#KEPT[@]}" -gt 0 ]; then
  echo "Kept:"
  for item in "${KEPT[@]}"; do
    echo "  - $item"
  done
else
  echo "Nothing kept: service, data and secret are gone."
fi
echo "Not removed: container images in Artifact Registry (delete them in the console to save storage)."
