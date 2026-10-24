import { z } from "zod"
import { Filesystem } from "@merakcode/util/filesystem"
import { CoworkerPath } from "./path"

export namespace CoworkerBindings {
  export const Info = z
    .object({
      model: z.string().optional(),
      skills: z.array(z.string()).default([]),
      mcp: z.array(z.string()).default([]),
    })
    .meta({ ref: "CoworkerBindings" })
  export type Info = z.infer<typeof Info>

  export const empty = (): Info => ({ skills: [], mcp: [] })

  export async function read(id: string): Promise<Info> {
    const file = CoworkerPath.bindings(id)
    if (!(await Filesystem.exists(file))) return empty()
    const raw = await Filesystem.readJson(file).catch(() => ({}))
    const parsed = Info.safeParse(raw)
    return parsed.success ? parsed.data : empty()
  }

  export async function write(id: string, input: Partial<Info>) {
    const current = await read(id)
    const next = Info.parse({
      model: input.model !== undefined ? input.model || undefined : current.model,
      skills: input.skills ?? current.skills,
      mcp: input.mcp ?? current.mcp,
    })
    await Filesystem.write(CoworkerPath.bindings(id), JSON.stringify(next, null, 2) + "\n")
    return next
  }
}
