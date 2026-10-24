# Agent Monitoring

Use this skill when the user asks you to watch a folder, log, process, metric, API, or other external source and notify an agent when something changes.

## How delivery works

The engine exposes a session-scoped monitoring endpoint. Bash commands started by an agent receive:

```text
MERAKCODE_MONITOR_URL   Complete URL for this session
MERAKCODE_MONITOR_TOKEN Session-scoped Bearer token
```

Do not print `MERAKCODE_MONITOR_TOKEN`. Do not reuse it for another session or API.

## Workflow

1. Confirm that both environment variables exist:

   ```bash
   test -n "$MERAKCODE_MONITOR_URL" && test -n "$MERAKCODE_MONITOR_TOKEN"
   ```

   If they are missing, explain that monitoring must be started from an agent session with Bash access.

2. Write the monitor under `.merakcode/monitors/<purpose>/` in the project. Prefer Node.js built-in modules so it has no installation step.
3. Debounce noisy sources. A folder watcher should batch changes for 200-500 ms and send one summary, not one notification per file event.
4. Send JSON with this shape:

   ```json
   {
     "title": "Deployment folder changed",
     "message": "3 files changed in dist/",
     "severity": "info",
     "source": "folder-watch:dist",
     "data": {
       "changes": []
     },
     "dedupeKey": "sha256-of-this-event"
   }
   ```

   - `title` and `message` are required.
   - `severity` is `info`, `warning`, or `error`.
   - `source` identifies the script or upstream system.
   - `data` can contain structured details, but serialized data must stay below 32 KB.
   - `dedupeKey` is an idempotency key. Reuse it only for the same logical event.

5. Start long-running monitors with `bash_background`; do not block the foreground turn. The monitor must remain running while it watches.
6. Test with one real change and verify that the agent receives a `monitor.signal` follow-up. If the session is busy, delivery waits until it becomes idle.

## Reference watcher

`watch-folder.mjs` is a dependency-free example. Read it with the built-in skill path, copy it into the project, and adapt the filters, debounce interval, and message format.

Usage:

```bash
node .merakcode/monitors/folder/watch-folder.mjs /absolute/path/to/watch
```

## Guardrails

- Do not send secrets, tokens, full environment dumps, or unrelated file contents.
- Do not create a feedback loop where the monitor watches a file that its own notification writes.
- Ignore build caches and high-noise paths unless the user explicitly asks for them.
- Avoid polling when a native watcher is available.
- Tell the user which source is monitored, where the script lives, and how to stop it.
- One signal starts a model turn. Aggregate aggressively to avoid unnecessary cost and notification spam.
