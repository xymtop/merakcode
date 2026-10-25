import path from "path"
import { z } from "zod"
import { Auth } from "../auth"
import { Global } from "../global"

export namespace A2AAuth {
  export const Info = z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("apiKey"), key: z.string() }),
      z.object({
        type: z.literal("oauth2"),
        access: z.string(),
        refresh: z.string().optional(),
        expires: z.number().optional(),
      }),
    ])
    .meta({ ref: "A2AAuth" })
  export type Info = z.infer<typeof Info>

  export const Status = z
    .object({
      configured: z.boolean(),
      type: z.enum(["apiKey", "oauth2"]).optional(),
    })
    .meta({ ref: "A2AAuthStatus" })
  export type Status = z.infer<typeof Status>

  const store = Auth.create(path.join(Global.Path.data, "a2a-auth.json"))

  /** Map coworker auth into Auth.Info shapes stored on disk. */
  function toAuth(info: Info): Auth.Info {
    if (info.type === "apiKey") return { type: "api", key: info.key }
    return {
      type: "oauth",
      access: info.access,
      refresh: info.refresh ?? "",
      expires: info.expires ?? 0,
    }
  }

  function fromAuth(info: Auth.Info | undefined): Info | undefined {
    if (!info) return undefined
    if (info.type === "api") return { type: "apiKey", key: info.key }
    if (info.type === "oauth")
      return {
        type: "oauth2",
        access: info.access,
        refresh: info.refresh || undefined,
        expires: info.expires || undefined,
      }
    return undefined
  }

  export async function get(coworkerID: string) {
    return fromAuth(await store.get(coworkerID))
  }

  export async function set(coworkerID: string, info: Info) {
    await store.set(coworkerID, toAuth(info))
  }

  export async function remove(coworkerID: string) {
    await store.remove(coworkerID)
  }

  export async function status(coworkerID: string): Promise<Status> {
    const info = await get(coworkerID)
    if (!info) return { configured: false }
    return { configured: true, type: info.type }
  }

  /** Authorization header value for outbound A2A calls, if any. */
  export async function bearer(coworkerID: string): Promise<string | undefined> {
    const info = await get(coworkerID)
    if (!info) return undefined
    if (info.type === "apiKey") return info.key
    return info.access
  }
}
