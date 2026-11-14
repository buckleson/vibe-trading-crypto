# Pixel Office

The `/pixel-office` page, `vibe-crypto office` CLI and `pixel_office` agent tool
share a manual research-task board. Assigning a task does not launch an agent or
place an order. Organizational ranks grant no trading permissions. Completion
requires an explicit result; recorded results are not an execution audit.

State is stored transactionally in `pixel-office.sqlite3` under the runtime root
(default `~/.vibe-trading`), outside the repository. No sample task is treated as
real work. Separate CLI processes and the Web API see the same state.

```bash
vibe-crypto office list
vibe-crypto office task --id morning-brief --title "Morning research brief" --description "Summarize today's sources and risks"
vibe-crypto office assign --task-id morning-brief --agent-id research-analyst
vibe-crypto office complete --task-id morning-brief --result "Reviewed the brief; findings are in the research session."
vibe-crypto office rank --agent-id research-analyst --rank Senior
```

For an isolated board, pass `--storage /absolute/path/office.sqlite3` before or
after the office subcommand. REST clients use authenticated `GET /api/pixel-office`
and `POST /api/pixel-office/actions` with `{ "action": "create|assign|complete|rank",
"arguments": { ... } }`. Writes use the settings authentication guard.
