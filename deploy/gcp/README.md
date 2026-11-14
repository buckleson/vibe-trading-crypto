# Run Vibe Crypto on Google Cloud Run

This deploys the Vibe Crypto MCP server to your own Google Cloud project so ChatGPT (and Claude Code) can reach it over HTTPS without your computer being on. Part of the [share with friends guide](../../guides/share-with-friends.md).

## Read this first

- A hosted server **holds your broker keys** and can act on your accounts. Anyone who has the URL or the token controls it. Never share them.
- **Each person deploys their own copy.** There is no shared multi-user server (see [ADR 0008](../../docs/vibe-crypto/ADR/0008-sharing-and-remote-mcp.md)). Send friends the guide, not your server.
- It is untested against a real project so far: the scripts were checked with `--dry-run` and `shellcheck` only. Expect to fix small things on the first run and tell us.
- Order tools are off unless you deploy with `--enable-orders`. Live orders still need a mandate and pass the kill switch.
- This is not financial advice.

## Prerequisites

- The [gcloud CLI](https://cloud.google.com/sdk/docs/install), signed in with `gcloud auth login`.
- A Google Cloud project with billing enabled. Set it with `gcloud config set project <id>` or pass `--project`.
- A clone of this repo (the scripts live in it):

```bash
git clone https://github.com/buckleson/vibe-trading-crypto && cd vibe-trading-crypto
```

## Deploy

Look at what it will do first. `--dry-run` prints every command and runs no gcloud command:

```bash
deploy/gcp/deploy.sh --project my-project --dry-run
```

Then deploy:

```bash
deploy/gcp/deploy.sh --project my-project --region us-central1
```

It enables the APIs, creates a private bucket, creates a random access token in Secret Manager (secret `vibe-crypto-mcp-token`), grants the Cloud Run service account access to both, builds the image from [Dockerfile](Dockerfile) with Cloud Build, and deploys the service. At the end it prints your ChatGPT URL and the Claude Code command.

Options: `--region`, `--service`, `--bucket`, `--ref` (git branch, tag or commit to install, default `main`), `--with keyring,alpaca-py` (extra Python packages, for your brokers), `--enable-orders`, `--memory`. Run `deploy/gcp/deploy.sh --help`.

What it sets up:

| Setting | Value | Why |
|---|---|---|
| Authentication | `--allow-unauthenticated` | ChatGPT cannot sign in with Google IAM. The server's own token guard is the access control: requests without the token get 401. |
| Instances | min 1, max 1 | MCP sessions live in memory, and the bucket has no file locking. Min 1 avoids cold starts. |
| Data folder | bucket mounted at `/home/vibe/.vibe-trading` | Paper runs, settings and broker files survive restarts. Mounted for uid 1000 with `mount-options=uid=1000;gid=1000;implicit-dirs`. |
| Environment | second generation, 1 CPU, 2Gi, 3600 s timeout | Cloud Storage volumes need the second generation environment. |
| Orders | `VIBE_CRYPTO_MCP_ENABLE_ORDERS=0` | Off unless `--enable-orders`. |

If your gcloud is too old to accept `mount-options`, update it (`gcloud components update`). As a fallback, remove the `mount-options=...` part from the `--add-volume` argument in the script and add `uid=1000;gid=1000` through `gcloud run services update --add-volume ...` once your gcloud supports it. Without the uid option the container cannot write to the bucket and the server fails to save anything.

## Connect your apps

- **ChatGPT:** in Settings > Apps & Connectors > Advanced settings, turn on Developer mode, then create a connector with the MCP server URL `https://<service-url>/<token>/mcp` and Authentication set to "No authentication". Details in the [guide](../../guides/share-with-friends.md#chatgpt-option-b-google-cloud-run).
- **Claude Code:** `claude mcp add --transport http vibe-crypto https://<service-url>/mcp --header "Authorization: Bearer <token>"`

Read the token again later with:

```bash
gcloud secrets versions access latest --secret vibe-crypto-mcp-token --project my-project
```

## Broker keys on Cloud Run

There is no OS keychain in the container, so `vibe-crypto connector setup` (which stores secrets in the keychain) does not apply. What the code supports:

1. **A connector JSON file in the bucket root.** Each connector reads `~/.vibe-trading/<connector>.json`, for example `alpaca.json`, `binance.json`, `okx.json` or `dhan.json`. The keys are the credential field names from `agent/src/trading/onboarding.py`. Example for Alpaca paper:

   ```json
   {"api_key": "PK...", "secret_key": "...", "profile": "paper"}
   ```

   Upload it with `gcloud storage cp alpaca.json gs://<bucket>/alpaca.json` and delete your local copy. Other fields are in each connector's `sdk.py` (for example Binance `api_secret`, OKX `api_secret` and `passphrase`, Dhan `client_id` and `access_token`). The file format is confirmed only for alpaca, binance, okx and dhan; check `agent/src/trading/connectors/<name>/sdk.py` for the others before relying on it.
2. **A `.env` file in the bucket root.** `gcloud storage cp my.env gs://<bucket>/.env` is loaded as `~/.vibe-trading/.env`. The only broker variable the code confirms is `FUTU_TRADE_PWD_MD5` (Futu live trade unlock). Other `.env` entries are app settings such as LLM keys. There are no per-broker API key environment variables.
3. **`--set-secrets`** adds a Secret Manager secret as an environment variable, for example `gcloud run services update vibe-crypto-mcp --region us-central1 --update-secrets FUTU_TRADE_PWD_MD5=my-futu-secret:latest`. Same limit: only for variables the app reads.

Keys in a bucket file are readable by anyone with bucket access in your project. The bucket is private (public access prevention, uniform access). Prefer paper or read-only keys with no withdrawal permission. Add broker packages with `--with`, for example `--with keyring,alpaca-py,python-okx`; the package for each broker is in the [broker table](../../guides/share-with-friends.md#connect-a-broker). IBKR needs TWS or Gateway on the same machine and MetaTrader 5 is Windows only, so neither works on Cloud Run.

## Logs

```bash
gcloud run services logs read vibe-crypto-mcp --region us-central1 --project my-project
```

## Update

Re-run `deploy/gcp/deploy.sh` with the same options. It reuses the bucket and token. Use `--ref <tag-or-commit>` to pin a version instead of `main`. If `main` is broken, so is your next deploy: pin a commit that worked.

## Rotate the token

```bash
printf %s "$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" | \
  gcloud secrets versions add vibe-crypto-mcp-token --data-file=- --project my-project
deploy/gcp/deploy.sh --project my-project
```

Update the URL in ChatGPT and the header in Claude Code afterwards. Old versions stay in Secret Manager until you disable them.

## Tear down

```bash
deploy/gcp/teardown.sh --project my-project --dry-run
deploy/gcp/teardown.sh --project my-project
```

This deletes the Cloud Run service and keeps the bucket and the secret. Add `--delete-data` to delete the bucket and its contents (you type the bucket name to confirm, or pass `--yes`) and `--delete-secret` to delete the token. Container images in Artifact Registry are not removed; delete them in the console to stop storage charges.

## Costs

`--min-instances 1` keeps one instance running, so it bills around the clock even when idle. The bucket, Secret Manager and Cloud Build add small amounts. See the [Cloud Run pricing page](https://cloud.google.com/run/pricing) and use the pricing calculator for your region. Tear it down when you are done.

## Limits

- The token is part of the URL path in the ChatGPT form, and Cloud Run request logs record request paths, so the token appears in your project's logs. Anyone with log access can read it. Prefer the header form (`Authorization: Bearer`) wherever the client supports it, and rotate the token if the logs are shared.
- Cloud Storage has no file locking. That is why there is one instance. Do not edit bucket files while the service runs.
- Backtests run without the vibe-sandbox UID drop, so they run as the container user. Check a backtest after the first deploy.
- Nothing here was run against a real project or ChatGPT yet. Report problems in the repo issues.
