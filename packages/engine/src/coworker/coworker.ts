import fs from "fs/promises"
import path from "path"
import { ulid } from "ulid"
import { z } from "zod"
import { Filesystem } from "@merakcode/util/filesystem"
import { Text } from "../util/text"
import { CoworkerBindings } from "./bindings"
import { CoworkerPath } from "./path"
import { CoworkerSkeleton } from "./skeleton"
import { CoworkerSync } from "./sync"

export namespace Coworker {
  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      duty: z.string(),
      profilePath: z.string(),
      worldPath: z.string(),
      bindings: CoworkerBindings.Info,
    })
    .meta({ ref: "Coworker" })
  export type Info = z.infer<typeof Info>

  export class Error extends globalThis.Error {
    constructor(readonly text: Text.Pair) {
      super(text.en)
    }
  }

  function slugify(name: string) {
    const ascii = name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
    return ascii || "coworker"
  }

  export async function allocateId(name: string) {
    const base = slugify(name)
    let id = base
    let n = 0
    while (await Filesystem.exists(CoworkerPath.coworkerDir(id))) {
      n += 1
      id = `${base}-${ulid().slice(-6).toLowerCase()}`
      if (n > 20) throw new Error({ zh: "无法分配同事 ID", en: "Could not allocate coworker id" })
    }
    return id
  }

  async function parseProfile(id: string) {
    const raw = await Filesystem.readText(CoworkerPath.profile(id)).catch(() => "")
    const lines = raw.split("\n")
    let name = id
    const body: string[] = []
    for (const line of lines) {
      if (name === id && /^#\s+/.test(line)) {
        name = line.replace(/^#\s+/, "").trim() || id
        continue
      }
      body.push(line)
    }
    return { name, duty: body.join("\n").trim() }
  }

  export async function get(id: string): Promise<Info | undefined> {
    if (!(await Filesystem.isDir(CoworkerPath.coworkerDir(id)))) return undefined
    if (id === CoworkerPath.TRASH || id.startsWith(".")) return undefined
    const profile = await parseProfile(id)
    const bindings = await CoworkerBindings.read(id)
    return {
      id,
      name: profile.name,
      duty: profile.duty,
      profilePath: CoworkerPath.profile(id),
      worldPath: CoworkerPath.worldRoot(id),
      bindings,
    }
  }

  export async function list(): Promise<Info[]> {
    const root = CoworkerPath.root()
    if (!(await Filesystem.isDir(root))) return []
    const entries = await fs.readdir(root, { withFileTypes: true })
    const out: Info[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === CoworkerPath.TRASH || entry.name.startsWith(".")) continue
      const info = await get(entry.name)
      if (info) out.push(info)
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  export async function create(input: { name: string; duty?: string; id?: string }) {
    const name = input.name.trim()
    if (!name) throw new Error({ zh: "名称必填", en: "Name is required" })
    const id = input.id?.trim() || (await allocateId(name))
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      throw new Error({
        zh: "ID 只能包含字母、数字、下划线和连字符",
        en: "Id may only contain letters, digits, _ and -",
      })
    }
    if (await Filesystem.exists(CoworkerPath.coworkerDir(id))) {
      throw new Error({ zh: "同事已存在", en: "Coworker already exists" })
    }
    const duty = (input.duty ?? "").trim()
    await CoworkerSkeleton.create({ id, name, duty })
    await CoworkerSync.sync(id)
    const info = await get(id)
    if (!info) throw new Error({ zh: "创建失败", en: "Create failed" })
    return info
  }

  export async function update(id: string, input: { name?: string; duty?: string }) {
    const current = await get(id)
    if (!current) throw new Error({ zh: "同事不存在", en: "Coworker not found" })
    const name = input.name?.trim() || current.name
    const duty = input.duty !== undefined ? input.duty.trim() : current.duty
    await Filesystem.write(CoworkerPath.profile(id), `# ${name}\n\n${duty}\n`)
    await CoworkerSync.sync(id)
    return (await get(id))!
  }

  export async function remove(id: string) {
    const current = await get(id)
    if (!current) throw new Error({ zh: "同事不存在", en: "Coworker not found" })
    const trash = path.join(CoworkerPath.trashRoot(), `${id}-${Date.now()}`)
    await fs.mkdir(CoworkerPath.trashRoot(), { recursive: true })
    await fs.rename(CoworkerPath.coworkerDir(id), trash)
    await CoworkerSync.removeSynced(id)
    return { id, trash }
  }

  export async function readProfile(id: string) {
    const current = await get(id)
    if (!current) throw new Error({ zh: "同事不存在", en: "Coworker not found" })
    return {
      path: CoworkerPath.profile(id),
      content: await Filesystem.readText(CoworkerPath.profile(id)),
    }
  }

  export async function writeProfile(id: string, content: string) {
    const current = await get(id)
    if (!current) throw new Error({ zh: "同事不存在", en: "Coworker not found" })
    await Filesystem.write(CoworkerPath.profile(id), content)
    await CoworkerSync.sync(id)
    return { path: CoworkerPath.profile(id) }
  }

  export async function setBindings(id: string, input: Partial<CoworkerBindings.Info>) {
    const current = await get(id)
    if (!current) throw new Error({ zh: "同事不存在", en: "Coworker not found" })
    const bindings = await CoworkerBindings.write(id, input)
    await CoworkerSync.sync(id)
    return { ...current, bindings }
  }
}
