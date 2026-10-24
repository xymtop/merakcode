import fs from "fs/promises"
import path from "path"
import { Filesystem } from "@merakcode/util/filesystem"
import { Text } from "../util/text"
import { CoworkerPath } from "./path"
import { CoworkerSync } from "./sync"

const ILLEGAL = /[<>:"|?*\u0000-\u001f]/
const SLOT_DIRS = new Set([
  CoworkerPath.DUTY,
  CoworkerPath.RULES,
  CoworkerPath.MEMORY,
  CoworkerPath.FACTS,
  CoworkerPath.DECISIONS,
])

export namespace CoworkerWorld {
  export type Node = {
    name: string
    path: string
    relative: string
    type: "file" | "directory"
    children?: Node[]
  }

  export type SearchHit = {
    relative: string
    path: string
    kind: "name" | "content"
  }

  function resolveRelative(id: string, relative: string) {
    const cleaned = relative.replace(/\\/g, "/").replace(/^\/+/, "")
    if (cleaned.includes("..") || ILLEGAL.test(cleaned)) {
      throw new Error("invalid path")
    }
    // World root itself: empty or "."
    if (!cleaned || cleaned === ".") return CoworkerPath.worldRoot(id)
    // PROFILE lives next to world/, allow "PROFILE.md" as special
    if (cleaned === CoworkerPath.PROFILE || cleaned.startsWith(`${CoworkerPath.PROFILE}/`)) {
      throw new Error("use profile endpoints for PROFILE.md")
    }
    const abs = path.join(CoworkerPath.worldRoot(id), cleaned)
    if (!CoworkerPath.isInside(CoworkerPath.worldRoot(id), abs)) {
      throw new Error("path escapes world root")
    }
    return abs
  }

  export function isSlotPath(relative: string) {
    const first = relative.replace(/\\/g, "/").split("/").filter(Boolean)[0]
    return first !== undefined && SLOT_DIRS.has(first)
  }

  async function walk(dir: string, base: string): Promise<Node[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const nodes: Node[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".gitkeep") continue
      const abs = path.join(dir, entry.name)
      const relative = path.relative(base, abs).replace(/\\/g, "/")
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: abs,
          relative,
          type: "directory",
          children: await walk(abs, base),
        })
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: abs, relative, type: "file" })
      }
    }
    return nodes
  }

  export async function tree(id: string): Promise<Node[]> {
    const root = CoworkerPath.worldRoot(id)
    if (!(await Filesystem.isDir(root))) return []
    return walk(root, root)
  }

  export async function read(id: string, relative: string) {
    const abs = resolveRelative(id, relative)
    if (!(await Filesystem.isFile(abs))) {
      return { ok: false as const, error: await Text.pick({ zh: "文件不存在", en: "File not found" }) }
    }
    return { ok: true as const, data: { path: abs, relative, content: await Filesystem.readText(abs) } }
  }

  export async function write(id: string, relative: string, content: string) {
    const abs = resolveRelative(id, relative)
    if (!abs.toLowerCase().endsWith(".md") && path.basename(abs) !== ".gitkeep") {
      return {
        ok: false as const,
        error: await Text.pick({ zh: "仅支持 Markdown 文件", en: "Only Markdown files are allowed" }),
      }
    }
    await Filesystem.write(abs, content)
    if (relative.startsWith(`${CoworkerPath.DUTY}/`) || relative.startsWith(`${CoworkerPath.RULES}/`)) {
      await CoworkerSync.sync(id)
    }
    return { ok: true as const, data: { path: abs, relative } }
  }

  export async function mkdir(id: string, relative: string) {
    const abs = resolveRelative(id, relative)
    const name = path.basename(abs)
    if (ILLEGAL.test(name) || name === "." || name === "..") {
      return { ok: false as const, error: await Text.pick({ zh: "非法文件夹名", en: "Invalid folder name" }) }
    }
    await fs.mkdir(abs, { recursive: true })
    return { ok: true as const, data: { path: abs, relative } }
  }

  export async function createFile(id: string, relative: string) {
    const cleaned = relative.replace(/\\/g, "/")
    if (!cleaned.toLowerCase().endsWith(".md")) {
      return {
        ok: false as const,
        error: await Text.pick({ zh: "文件名需以 .md 结尾", en: "Filename must end with .md" }),
      }
    }
    const abs = resolveRelative(id, cleaned)
    if (await Filesystem.exists(abs)) {
      return { ok: false as const, error: await Text.pick({ zh: "文件已存在", en: "File already exists" }) }
    }
    const title = path.basename(cleaned, ".md")
    await Filesystem.write(abs, `# ${title}\n\n`)
    if (cleaned.startsWith(`${CoworkerPath.DUTY}/`) || cleaned.startsWith(`${CoworkerPath.RULES}/`)) {
      await CoworkerSync.sync(id)
    }
    return { ok: true as const, data: { path: abs, relative: cleaned } }
  }

  export async function remove(id: string, relative: string) {
    const cleaned = relative.replace(/\\/g, "/")
    if (SLOT_DIRS.has(cleaned) || cleaned === "") {
      return {
        ok: false as const,
        error: await Text.pick({
          zh: "不能删除约定槽位根目录，可能影响自动注入",
          en: "Cannot delete a reserved world slot; it may break injection",
        }),
      }
    }
    const abs = resolveRelative(id, cleaned)
    if (!(await Filesystem.exists(abs))) {
      return { ok: false as const, error: await Text.pick({ zh: "路径不存在", en: "Path not found" }) }
    }
    await fs.rm(abs, { recursive: true, force: true })
    if (cleaned.startsWith(`${CoworkerPath.DUTY}/`) || cleaned.startsWith(`${CoworkerPath.RULES}/`)) {
      await CoworkerSync.sync(id)
    }
    return { ok: true as const, data: { relative: cleaned } }
  }

  export async function search(id: string, query: string): Promise<SearchHit[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const root = CoworkerPath.worldRoot(id)
    if (!(await Filesystem.isDir(root))) return []
    const hits: SearchHit[] = []

    async function visit(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === ".gitkeep") continue
        const abs = path.join(dir, entry.name)
        const relative = path.relative(root, abs).replace(/\\/g, "/")
        if (entry.name.toLowerCase().includes(q)) {
          hits.push({ relative, path: abs, kind: "name" })
        }
        if (entry.isDirectory()) {
          await visit(abs)
          continue
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          const text = await Filesystem.readText(abs).catch(() => "")
          if (text.toLowerCase().includes(q)) {
            hits.push({ relative, path: abs, kind: "content" })
          }
        }
      }
    }

    await visit(root)
    return hits
  }
}
