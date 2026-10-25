import fs from "fs/promises"
import path from "path"
import matter from "gray-matter"
import { Filesystem } from "@merakcode/util/filesystem"
import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { Rule } from "../rule/rule"
import { RuleTemplate } from "../rule/template"
import { Text } from "../util/text"
import { CoworkerBindings } from "./bindings"
import { CoworkerPath } from "./path"

export namespace CoworkerSync {
  async function readMdFiles(dir: string): Promise<{ name: string; content: string }[]> {
    if (!(await Filesystem.isDir(dir))) return []
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out: { name: string; content: string }[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue
      const content = await Filesystem.readText(path.join(dir, entry.name))
      out.push({ name: entry.name, content })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  function permissionBlock(bindings: CoworkerBindings.Info) {
    const skill: Record<string, "allow" | "deny"> = { "*": "deny" }
    for (const name of bindings.skills) {
      if (name.trim()) skill[name.trim()] = "allow"
    }
    const mcp: Record<string, "allow" | "deny"> = { "*": "deny", "merak-apps": "allow" }
    for (const name of bindings.mcp) {
      if (name.trim()) mcp[name.trim()] = "allow"
    }
    return { skill, mcp }
  }

  /** Write `.merakcode/agents/<id>.md` from PROFILE + duty + bindings. Skip A2A coworkers. */
  export async function syncAgent(id: string) {
    if (await Filesystem.exists(CoworkerPath.a2a(id))) {
      await fs.rm(CoworkerPath.agentMd(id), { force: true })
      return
    }
    const [profile, dutyFiles, bindings] = await Promise.all([
      Filesystem.readText(CoworkerPath.profile(id)).catch(() => ""),
      readMdFiles(CoworkerPath.dutyDir(id)),
      CoworkerBindings.read(id),
    ])
    const duty = dutyFiles
      .map((f) => f.content.trim())
      .filter(Boolean)
      .join("\n\n")
    const body = [profile.trim(), duty].filter(Boolean).join("\n\n")
    const data: Record<string, unknown> = {
      mode: "primary",
      description: profile
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 0)
        ?.slice(0, 120),
      permission: permissionBlock(bindings),
    }
    if (bindings.model?.trim()) data.model = bindings.model.trim()

    const text = matter.stringify(`\n${body || " "}\n`, data)
    await Filesystem.write(CoworkerPath.agentMd(id), text)
  }

  /** Replace synced `.mdc` rules for this coworker from world/02-rules. Skip A2A coworkers. */
  export async function syncRules(id: string) {
    const rulesDir = CoworkerPath.projectRulesDir()
    await fs.mkdir(rulesDir, { recursive: true })
    const prefix = CoworkerPath.syncedRulePrefix(id)
    const existing = await fs.readdir(rulesDir).catch(() => [] as string[])
    for (const name of existing) {
      if (name.startsWith(prefix) && name.endsWith(".mdc")) {
        await fs.rm(path.join(rulesDir, name), { force: true })
      }
    }

    if (await Filesystem.exists(CoworkerPath.a2a(id))) return

    const lang = await Text.lang()
    const sources = await readMdFiles(CoworkerPath.rulesDir(id))
    for (const source of sources) {
      const stem = source.name.replace(/\.md$/i, "")
      // Skip empty README placeholders that only have a title heading
      const body = source.content.trim()
      if (!body) continue
      const file = path.join(rulesDir, `${prefix}${stem}.mdc`)
      await Filesystem.write(
        file,
        RuleTemplate.build(
          {
            alwaysApply: true,
            agents: [id],
            name: `${id}/${stem}`,
            description: `Coworker ${id} rule: ${stem}`,
            body,
          },
          lang,
        ),
      )
    }
  }

  export async function sync(id: string) {
    await syncAgent(id)
    await syncRules(id)
    Config.invalidateScope("project")
    Agent.invalidate()
    Rule.invalidate()
  }

  export async function removeSynced(id: string) {
    await fs.rm(CoworkerPath.agentMd(id), { force: true })
    const rulesDir = CoworkerPath.projectRulesDir()
    const prefix = CoworkerPath.syncedRulePrefix(id)
    const existing = await fs.readdir(rulesDir).catch(() => [] as string[])
    for (const name of existing) {
      if (name.startsWith(prefix) && name.endsWith(".mdc")) {
        await fs.rm(path.join(rulesDir, name), { force: true })
      }
    }
    Config.invalidateScope("project")
    Agent.invalidate()
    Rule.invalidate()
  }
}
