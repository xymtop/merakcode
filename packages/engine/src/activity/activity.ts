import { z } from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionStore } from "../session/store"
import { Storage } from "../storage/storage"

export namespace Activity {
  export const Entry = z
    .object({
      id: z.string(),
      coworkerID: z.string(),
      direction: z.enum(["received", "sent", "action"]),
      kind: z.string(),
      title: z.string(),
      detail: z.string().optional(),
      resource: z
        .object({
          type: z.string(),
          id: z.string(),
          title: z.string().optional(),
        })
        .optional(),
      createdAt: z.number(),
    })
    .meta({ ref: "AgentActivity" })

  export type Entry = z.infer<typeof Entry>
  export type Input = Omit<Entry, "id" | "createdAt">

  export const Updated = BusEvent.define("activity.updated", z.object({ coworkerID: z.string() }))

  const key = (coworkerID: string, id: string) => ["agent_activity", coworkerID, id]

  async function publish(coworkerID: string) {
    if (Instance.has()) await Bus.publish(Updated, { coworkerID }).catch(() => undefined)
  }

  export async function record(input: Input) {
    const entry: Entry = { ...input, id: crypto.randomUUID(), createdAt: Date.now() }
    await Storage.write(key(input.coworkerID, entry.id), entry)
    await publish(input.coworkerID)
    return entry
  }

  export async function recordMany(inputs: Input[]) {
    if (!inputs.length) return
    const entries = inputs.map((input) => ({ ...input, id: crypto.randomUUID(), createdAt: Date.now() }))
    await Promise.all(entries.map((entry) => Storage.write(key(entry.coworkerID, entry.id), entry)))
    await Promise.all([...new Set(inputs.map((input) => input.coworkerID))].map(publish))
  }

  function summary(text: string, limit = 240) {
    const value = text.replace(/\s+/g, " ").trim()
    return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
  }

  async function conversationEvents(coworkerID: string) {
    const sessions = SessionStore.search({ roots: true })
      .filter(({ session }) => session.metadata?.kind === "coworker" && session.metadata?.coworkerId === coworkerID)
      .toSorted((a, b) => b.session.time.updated - a.session.time.updated)
      .slice(0, 12)
    const entries: Entry[] = []
    for (const { session } of sessions) {
      const messages = await Session.messages({ sessionID: session.id, limit: 100 }).catch(() => [])
      for (const message of messages) {
        const text = message.parts
          .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text.trim()] : []))
          .filter(Boolean)
          .join("\n")
        if (text) {
          entries.push({
            id: `${message.info.id}:${message.info.role}`,
            coworkerID,
            direction: message.info.role === "user" ? "received" : "sent",
            kind: message.info.role === "user" ? "conversation.message" : "conversation.reply",
            title: message.info.role === "user" ? "收到消息" : "发送回复",
            detail: summary(text),
            resource: { type: "session", id: session.id, title: session.title },
            createdAt: message.info.time.created,
          })
        }
        if (message.info.role !== "assistant") continue
        for (const part of message.parts) {
          if (part.type !== "tool") continue
          const time =
            part.state.status === "pending"
              ? message.info.time.created
              : part.state.status === "running" || part.state.status === "completed"
                ? part.state.time.start
                : part.state.time.end
          entries.push({
            id: `${part.id}:tool`,
            coworkerID,
            direction: "action",
            kind: "conversation.tool",
            title: `执行工具 ${part.tool}`,
            detail: part.state.status === "completed" && part.state.title ? summary(part.state.title) : undefined,
            resource: { type: "session", id: session.id, title: session.title },
            createdAt: time,
          })
        }
      }
    }
    return entries
  }

  export async function list(coworkerID: string, limit = 300) {
    const stored = (
      await Promise.all(
        (await Storage.list(["agent_activity", coworkerID]))
          .map((item) => item.at(-1))
          .filter((id): id is string => !!id)
          .map((id) => Storage.read<Entry>(key(coworkerID, id)).catch(() => undefined)),
      )
    ).filter((entry): entry is Entry => !!entry)
    const conversations = await conversationEvents(coworkerID)
    return [...stored, ...conversations].toSorted((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }
}
