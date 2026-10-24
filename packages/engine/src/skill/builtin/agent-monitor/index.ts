import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

function folder(here = import.meta.url) {
  const bundled = fileURLToPath(new URL("./skills/agent-monitor/", here))
  return existsSync(bundled) ? bundled : fileURLToPath(new URL("./", here))
}

const dir = folder()
const read = (file: string) => readFileSync(path.join(dir, file), "utf8")

export const AGENT_MONITOR_SKILL = {
  name: "agent-monitor",
  description:
    "Write and run scripts that watch folders, logs, processes, metrics, or APIs and send structured monitoring signals back to the current agent session",
  content: read("SKILL.md"),
  files: {
    "watch-folder.mjs": read("watch-folder.mjs"),
  },
  dir,
}
