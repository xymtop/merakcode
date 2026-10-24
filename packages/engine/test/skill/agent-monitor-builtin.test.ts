import { expect, test } from "vitest"
import { getBuiltinSkill } from "@merakcode/engine/skill/builtin"

test("agent-monitor built-in skill includes instructions and a runnable folder watcher example", () => {
  const skill = getBuiltinSkill("agent-monitor")
  expect(skill).toBeDefined()
  expect(skill!.description).toContain("monitoring signals")
  expect(skill!.content).toContain("MERAKCODE_MONITOR_URL")
  expect(skill!.content).toContain("watch-folder.mjs")
  expect(skill!.files?.["watch-folder.mjs"]).toContain("MERAKCODE_MONITOR_TOKEN")
  expect(skill!.files?.["watch-folder.mjs"]).toContain("fs")
})
