import { z } from "zod"
import { Filesystem } from "@merakcode/util/filesystem"
import { CoworkerPath } from "../coworker/path"

export namespace A2ABinding {
  export const Skill = z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .meta({ ref: "A2ASkill" })

  export const Interface = z
    .object({
      url: z.string(),
      protocolBinding: z.string().optional(),
      protocolVersion: z.string().optional(),
    })
    .meta({ ref: "A2AInterface" })

  export const Info = z
    .object({
      cardUrl: z.string(),
      rpcUrl: z.string(),
      protocolVersion: z.string().optional(),
      interfaces: z.array(Interface).default([]),
      name: z.string(),
      description: z.string().default(""),
      skills: z.array(Skill).default([]),
      authKind: z.enum(["none", "apiKey", "oauth2"]).default("none"),
      version: z.string().optional(),
    })
    .meta({ ref: "A2ABinding" })
  export type Info = z.infer<typeof Info>

  export async function read(id: string): Promise<Info | undefined> {
    const file = CoworkerPath.a2a(id)
    if (!(await Filesystem.exists(file))) return undefined
    const raw = await Filesystem.readJson(file).catch(() => undefined)
    const parsed = Info.safeParse(raw)
    return parsed.success ? parsed.data : undefined
  }

  export async function write(id: string, input: Info) {
    const next = Info.parse(input)
    await Filesystem.write(CoworkerPath.a2a(id), JSON.stringify(next, null, 2) + "\n")
    return next
  }
}
