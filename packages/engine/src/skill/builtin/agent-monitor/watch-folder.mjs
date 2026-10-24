#!/usr/bin/env node
import { createHash } from "node:crypto"
import { watch } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"

const folder = path.resolve(process.argv[2] ?? ".")
const endpoint = process.env.MERAKCODE_MONITOR_URL
const token = process.env.MERAKCODE_MONITOR_TOKEN
const debounce = Number(process.env.MONITOR_DEBOUNCE_MS ?? 400)
const ignored = [/[/\\]node_modules[/\\]/, /[/\\]\.git[/\\]/, /[/\\]dist[/\\]/, /[/\\]\.cache[/\\]/]

if (!endpoint || !token) {
  console.error("MERAKCODE_MONITOR_URL and MERAKCODE_MONITOR_TOKEN are required")
  process.exit(1)
}

const pending = new Map()
let timer

async function send(body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`monitor endpoint returned ${response.status}: ${await response.text()}`)
}

async function flush() {
  timer = undefined
  const events = [...pending]
  pending.clear()
  if (!events.length) return

  const changes = await Promise.all(
    events.map(async ([file, event]) => {
      const absolute = path.join(folder, file || ".")
      const info = await stat(absolute).catch(() => undefined)
      return {
        event,
        path: path.relative(folder, absolute) || ".",
        size: info?.size,
        modifiedAt: info?.mtimeMs,
      }
    }),
  )
  const dedupeKey = createHash("sha256").update(JSON.stringify(changes)).digest("hex")

  await send({
    title: `Folder changed: ${path.basename(folder)}`,
    message: `${changes.length} change${changes.length === 1 ? "" : "s"} detected in ${folder}`,
    severity: "info",
    source: `folder-watch:${path.basename(folder)}`,
    data: { directory: folder, changes },
    dedupeKey,
  })
}

const watcher = watch(folder, { recursive: true }, (event, file) => {
  const relative = file?.toString() ?? "."
  if (ignored.some((pattern) => pattern.test(`/${relative}`))) return
  pending.set(relative, event)
  clearTimeout(timer)
  timer = setTimeout(() => void flush().catch((error) => console.error(error.message)), debounce)
})

watcher.on("error", (error) => {
  void send({
    title: `Folder watcher failed: ${path.basename(folder)}`,
    message: error.message,
    severity: "error",
    source: `folder-watch:${path.basename(folder)}`,
  }).catch((failure) => console.error(failure.message))
})

console.log(`Watching ${folder}`)
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    watcher.close()
    process.exit(0)
  })
}
