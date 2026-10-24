import { test, expect } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "@merakcode/engine/project/instance"
import { Agent } from "@merakcode/engine/agent/agent"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { CoworkerPath } from "@merakcode/engine/coworker/path"
import { CoworkerWorld } from "@merakcode/engine/coworker/world"
import { CoworkerSync } from "@merakcode/engine/coworker/sync"
import { Filesystem } from "@merakcode/util/filesystem"

test("creates coworker skeleton and syncs agent + rules", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const created = await Coworker.create({ name: "Researcher", duty: "Find sources" })
      expect(created.name).toBe("Researcher")
      expect(created.duty).toContain("Find sources")
      expect(await Filesystem.exists(CoworkerPath.profile(created.id))).toBe(true)
      expect(await Filesystem.isDir(CoworkerPath.dutyDir(created.id))).toBe(true)
      expect(await Filesystem.exists(CoworkerPath.agentMd(created.id))).toBe(true)

      const agent = await Agent.get(created.id)
      expect(agent).toBeDefined()
      expect(agent?.mode).toBe("primary")
      expect(agent?.prompt).toContain("Find sources")

      const list = await Coworker.list()
      expect(list.map((c) => c.id)).toContain(created.id)
    },
  })
})

test("bindings select skills and mcp into agent permission", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const created = await Coworker.create({ name: "Ops", duty: "Ops" })
      await Coworker.setBindings(created.id, {
        model: "test/model",
        skills: ["deploy"],
        mcp: ["github"],
      })
      const agentFile = await Filesystem.readText(CoworkerPath.agentMd(created.id))
      expect(agentFile).toContain("model: test/model")
      expect(agentFile).toContain("deploy")
      expect(agentFile).toContain("github")

      const agent = await Agent.get(created.id)
      expect(agent?.model).toEqual({ providerID: "test", modelID: "model" })
    },
  })
})

test("world file CRUD and search", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const created = await Coworker.create({ name: "Writer", duty: "Write" })
      const made = await CoworkerWorld.createFile(created.id, "04-facts/alpha.md")
      expect(made.ok).toBe(true)
      await CoworkerWorld.write(created.id, "04-facts/alpha.md", "# Alpha\n\nsecret-token-xyz\n")
      const read = await CoworkerWorld.read(created.id, "04-facts/alpha.md")
      expect(read.ok && read.data.content).toContain("secret-token-xyz")

      const hits = await CoworkerWorld.search(created.id, "secret-token")
      expect(hits.some((h) => h.relative === "04-facts/alpha.md")).toBe(true)

      const tree = await CoworkerWorld.tree(created.id)
      expect(tree.some((n) => n.name === "04-facts")).toBe(true)
    },
  })
})

test("sync rules from 02-rules into project rules with agents filter", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const created = await Coworker.create({ name: "Guard", duty: "Guard" })
      await CoworkerWorld.write(created.id, "02-rules/boundary.md", "# Boundary\n\nNever commit secrets.\n")
      await CoworkerSync.sync(created.id)
      const rulesDir = CoworkerPath.projectRulesDir()
      const files = await fs.readdir(rulesDir)
      const matched = files.find(
        (f) => f.startsWith(`coworker-${created.id}-`) && f.includes("boundary") && f.endsWith(".mdc"),
      )
      expect(matched).toBeTruthy()
      const body = await Filesystem.readText(path.join(rulesDir, matched!))
      expect(body).toContain("agents:")
      expect(body).toContain(created.id)
      expect(body).toContain("Never commit secrets")
    },
  })
})

test("delete moves coworker to trash and removes synced files", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const created = await Coworker.create({ name: "Temp", duty: "Temp" })
      const agentPath = CoworkerPath.agentMd(created.id)
      expect(await Filesystem.exists(agentPath)).toBe(true)
      const result = await Coworker.remove(created.id)
      expect(await Filesystem.exists(CoworkerPath.coworkerDir(created.id))).toBe(false)
      expect(await Filesystem.exists(result.trash)).toBe(true)
      expect(await Filesystem.exists(agentPath)).toBe(false)
      expect(await Coworker.get(created.id)).toBeUndefined()
    },
  })
})
