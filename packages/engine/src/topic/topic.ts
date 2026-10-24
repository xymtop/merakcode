import { Log } from "@merakcode/log/logger"
import { z } from "zod"
import { Activity } from "../activity/activity"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { load as loadGroup } from "../collaboration/store"
import { Coworker } from "../coworker/coworker"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionRunner } from "../session/runner"
import { Storage } from "../storage/storage"
import { Text } from "../util/text"

export namespace Topic {
  const log = Log.create({ service: "topic" })
  const MAX_REPLY_DEPTH = 2
  const MAX_REPLIES_PER_COMMENT = 6
  const MAX_CONTEXT_COMMENTS = 30

  export const Actor = z
    .object({
      type: z.enum(["user", "agent"]),
      id: z.string(),
      name: z.string(),
    })
    .meta({ ref: "TopicActor" })

  export type Actor = z.infer<typeof Actor>

  export const Participant = z
    .object({
      coworkerID: z.string(),
      name: z.string(),
      duty: z.string(),
    })
    .meta({ ref: "TopicParticipant" })

  export type Participant = z.infer<typeof Participant>

  export const Comment = z
    .object({
      id: z.string(),
      author: Actor,
      content: z.string(),
      mentions: Actor.array(),
      createdAt: z.number(),
    })
    .meta({ ref: "TopicComment" })

  export type Comment = z.infer<typeof Comment>

  export const Working = z
    .object({
      coworkerID: z.string(),
      name: z.string(),
    })
    .meta({ ref: "TopicWorkingAgent" })

  export const Info = z
    .object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      author: Actor,
      participants: Participant.array(),
      comments: Comment.array(),
      working: Working.array(),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .meta({ ref: "Topic" })

  export type Info = z.infer<typeof Info>

  type Job = {
    id: string
    coworkerID: string
    rootCommentID: string
    depth: number
    status: "pending" | "running" | "error"
    reason: "topic" | "mentioned" | "participant"
    createdAt: number
    sessionID?: string
  }

  type Record = Omit<Info, "working"> & {
    jobs: Job[]
  }

  export const Event = {
    Updated: BusEvent.define("topic.updated", z.object({ topicID: z.string() })),
  }

  export class Error extends globalThis.Error {
    constructor(readonly text: Text.Pair) {
      super(text.en)
    }
  }

  const key = (id: string) => ["topic", id]
  const active = new Set<string>()
  const migrated = new Set<string>()
  const user: Actor = { type: "user", id: "local", name: "User" }

  function info(record: Record): Info {
    const { jobs, ...value } = record
    return {
      ...value,
      working: jobs
        .filter((job) => job.status === "pending" || job.status === "running")
        .flatMap((job) => {
          const participant = record.participants.find((item) => item.coworkerID === job.coworkerID)
          return participant ? [{ coworkerID: participant.coworkerID, name: participant.name }] : []
        })
        .filter((item, index, list) => list.findIndex((other) => other.coworkerID === item.coworkerID) === index),
    }
  }

  async function publish(id: string) {
    if (Instance.has()) await Bus.publish(Event.Updated, { topicID: id }).catch(() => undefined)
  }

  async function readRecord(id: string) {
    return Storage.read<Record>(key(id)).catch(() => undefined)
  }

  /** Converts the first group-chat implementation of topics into forum posts without changing visible content. */
  async function migrateLegacy() {
    const directory = Instance.directory
    if (migrated.has(directory)) return
    for await (const session of Session.list()) {
      if (session.metadata?.kind !== "topic" || session.metadata?.group !== true) continue
      if (await readRecord(session.id)) continue
      const group = await loadGroup(session.id)
      if (!group) continue
      const participants = (
        await Promise.all(
          group.seats
            .filter((seat) => !!seat.coworkerID)
            .map(async (seat) => {
              const coworker = await Coworker.get(seat.coworkerID!)
              return coworker ? { coworkerID: coworker.id, name: coworker.name, duty: coworker.duty } : undefined
            }),
        )
      ).filter((item): item is Participant => !!item)
      const messages = await Session.messages({ sessionID: session.id }).catch(() => [])
      const comments: Comment[] = messages.flatMap((message) => {
        const content = message.parts
          .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text.trim()] : []))
          .filter(Boolean)
          .join("\n")
        if (!content) return []
        const author: Actor =
          message.info.role === "user"
            ? user
            : { type: "agent", id: "host", name: group.seats.find((seat) => seat.leader)?.name ?? "Host" }
        return [
          {
            id: crypto.randomUUID(),
            author,
            content,
            mentions: mentions(content, participants),
            createdAt: message.info.time.created,
          },
        ]
      })
      await Storage.write<Record>(key(session.id), {
        id: session.id,
        title: session.title,
        body:
          typeof session.metadata?.description === "string" && session.metadata.description.trim()
            ? session.metadata.description
            : session.title,
        author: user,
        participants,
        comments,
        createdAt: session.time.created,
        updatedAt: session.time.updated,
        jobs: [],
      })
    }
    migrated.add(directory)
  }

  export async function get(id: string) {
    let record = await readRecord(id)
    if (!record) {
      await migrateLegacy()
      record = await readRecord(id)
    }
    if (!record) return
    kick(id)
    return info(record)
  }

  export async function list() {
    await migrateLegacy()
    const records = await Promise.all(
      (await Storage.list(["topic"]))
        .map((item) => item[1])
        .filter((id): id is string => !!id)
        .map(readRecord),
    )
    for (const record of records) if (record) kick(record.id)
    return records
      .filter((record): record is Record => !!record)
      .map(info)
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
  }

  function referenced(content: string, participants: Participant[]) {
    return participants.filter((participant) => content.includes(`@${participant.name}`))
  }

  function mentions(content: string, participants: Participant[]): Actor[] {
    return [
      ...(content.includes("@用户") || content.includes("@User") ? [user] : []),
      ...referenced(content, participants).map((participant) => ({
        type: "agent" as const,
        id: participant.coworkerID,
        name: participant.name,
      })),
    ]
  }

  function snippet(content: string) {
    const text = content.replace(/\s+/g, " ").trim()
    return text.length > 180 ? `${text.slice(0, 179)}…` : text
  }

  async function received(record: Record, content: string, kind: string) {
    await Activity.recordMany(
      record.participants.map((participant) => ({
        coworkerID: participant.coworkerID,
        direction: "received" as const,
        kind,
        title: kind === "topic.invited" ? `收到话题邀请：${record.title}` : `收到话题评论：${record.title}`,
        detail: snippet(content),
        resource: { type: "topic", id: record.id, title: record.title },
      })),
    )
  }

  function enqueue(
    record: Record,
    content: string,
    rootCommentID: string,
    depth: number,
    options: { exclude?: string; participants?: boolean; reason?: Job["reason"] } = {},
  ) {
    if (depth > MAX_REPLY_DEPTH) return
    if (record.jobs.filter((job) => job.rootCommentID === rootCommentID).length >= MAX_REPLIES_PER_COMMENT) return
    const mentioned = referenced(content, record.participants)
    const targets = options.participants ? record.participants : mentioned
    for (const participant of targets) {
      if (participant.coworkerID === options.exclude) continue
      if (record.jobs.some((job) => job.rootCommentID === rootCommentID && job.coworkerID === participant.coworkerID))
        continue
      record.jobs.push({
        id: crypto.randomUUID(),
        coworkerID: participant.coworkerID,
        rootCommentID,
        depth,
        status: "pending",
        reason:
          options.reason ??
          (mentioned.some((item) => item.coworkerID === participant.coworkerID) ? "mentioned" : "participant"),
        createdAt: Date.now(),
      })
    }
  }

  export async function create(
    input: { title: string; body: string; participants: string[] },
    author: Actor = user,
    options: { dispatch?: boolean } = {},
  ): Promise<Info> {
    const title = input.title.trim()
    const body = input.body.trim()
    if (!title) throw new Error({ zh: "话题标题必填", en: "Topic title is required" })
    if (!body) throw new Error({ zh: "话题正文必填", en: "Topic body is required" })
    const ids = [...new Set(input.participants)]
    if (!ids.length) throw new Error({ zh: "至少邀请一位智能体", en: "Invite at least one agent" })
    const coworkers = await Promise.all(ids.map((id) => Coworker.get(id)))
    if (coworkers.some((item) => !item))
      throw new Error({ zh: "有智能体不存在", en: "One or more agents no longer exist" })
    const participants = coworkers.flatMap((item) =>
      item ? [{ coworkerID: item.id, name: item.name, duty: item.duty }] : [],
    )
    const now = Date.now()
    const rootCommentID = crypto.randomUUID()
    const record: Record = {
      id: crypto.randomUUID(),
      title,
      body,
      author,
      participants,
      comments: [],
      createdAt: now,
      updatedAt: now,
      jobs: [],
    }
    enqueue(record, body, rootCommentID, 0, { participants: true, reason: "topic" })
    await Storage.write(key(record.id), record)
    await publish(record.id)
    await received(record, body, "topic.invited")
    if (options.dispatch !== false) kick(record.id)
    return info(record)
  }

  export async function comment(
    id: string,
    content: string,
    author: Actor = user,
    options: { dispatch?: boolean } = {},
  ) {
    const text = content.trim()
    if (!text) throw new Error({ zh: "评论内容不能为空", en: "Comment cannot be empty" })
    const current = await readRecord(id)
    if (!current) throw new Error({ zh: "话题不存在", en: "Topic not found" })
    if (author.type === "agent" && !current.participants.some((item) => item.coworkerID === author.id))
      throw new Error({ zh: "该智能体不是话题参与者", en: "The agent is not a participant in this topic" })
    const commentID = crypto.randomUUID()
    const record = await Storage.update<Record>(key(id), (draft) => {
      draft.comments.push({
        id: commentID,
        author,
        content: text,
        mentions: mentions(text, draft.participants),
        createdAt: Date.now(),
      })
      draft.updatedAt = Date.now()
      const mentioned = referenced(text, draft.participants)
      enqueue(draft, text, commentID, 0, {
        exclude: author.type === "agent" ? author.id : undefined,
        participants: author.type === "user" && mentioned.length === 0,
      })
      for (const job of draft.jobs) {
        if (job.status === "running" && Date.now() - job.createdAt > 5 * 60_000) job.status = "pending"
      }
    })
    await publish(id)
    if (author.type === "agent") {
      await Activity.record({
        coworkerID: author.id,
        direction: "sent",
        kind: "topic.comment",
        title: `发表话题评论：${record.title}`,
        detail: snippet(text),
        resource: { type: "topic", id: record.id, title: record.title },
      })
    }
    const comment = record.comments.at(-1)!
    const targets = comment.mentions.flatMap((mention) => (mention.type === "agent" ? [mention] : []))
    if (targets.length) {
      await Activity.recordMany(
        targets.map((mention) => ({
          coworkerID: mention.id,
          direction: "received" as const,
          kind: "topic.mentioned",
          title: `话题中提到你：${record.title}`,
          detail: snippet(text),
          resource: { type: "topic", id: record.id, title: record.title },
        })),
      )
    } else if (author.type === "user") {
      await received(record, text, "topic.comment")
    }
    if (options.dispatch !== false) kick(id)
    return info(record)
  }

  function prompt(record: Record, coworker: Coworker.Info, reason: Job["reason"]) {
    const comments = record.comments
      .slice(-MAX_CONTEXT_COMMENTS)
      .map((item) => `${item.author.name}: ${item.content}`)
      .join("\n\n")
    return [
      `You are ${coworker.name}, participating in the written topic discussion "${record.title}".`,
      coworker.duty ? `Your responsibility: ${coworker.duty}` : "",
      "",
      "Main post:",
      record.body,
      "",
      `Participants: ${record.participants.map((item) => item.name).join(", ")}. The human user is named 用户 (User).`,
      "",
      "Recent comments:",
      comments || "(none yet)",
      "",
      "Write one concise comment that moves the discussion forward.",
      reason === "participant"
        ? "You were notified as a topic participant, not directly mentioned. Reply only if you can add distinct value; otherwise return exactly NO_REPLY."
        : reason === "topic"
          ? "You are invited to this new topic. Respond with a substantive comment that starts the discussion."
          : "You were directly mentioned. Respond with a substantive comment.",
      "You may mention a participant as @Name. Do not mention yourself.",
      "Return only the comment text, without a name prefix or markdown fence.",
    ]
      .filter((line) => line !== "")
      .join("\n")
  }

  async function reply(topicID: string, job: Job) {
    const record = await readRecord(topicID)
    if (!record) return
    const coworker = await Coworker.get(job.coworkerID)
    if (!coworker) throw new Error({ zh: "智能体不存在", en: "Agent not found" })
    let sessionID = job.sessionID
    if (!sessionID) {
      const session = await Session.create({
        title: `${record.title} · ${coworker.name}`,
        metadata: { kind: "topic-agent", topicID, coworkerID: coworker.id },
      })
      sessionID = session.id
      await Storage.update<Record>(key(topicID), (draft) => {
        const current = draft.jobs.find((item) => item.id === job.id)
        if (current) current.sessionID = sessionID
      })
    }
    const model = coworker.bindings.model
    const at = model?.indexOf("/") ?? -1
    const result = await SessionRunner.prompt({
      sessionID,
      agent: coworker.id,
      permissionMode: "readonly",
      ...(model && at > 0 ? { model: { providerID: model.slice(0, at), modelID: model.slice(at + 1) } } : {}),
      parts: [{ type: "text", text: prompt(record, coworker, job.reason) }],
    })
    const content = result.parts.findLast((part) => part.type === "text")?.text.trim()
    if (!content) throw new Error({ zh: "智能体没有返回内容", en: "The agent returned no content" })
    if (content.toUpperCase() === "NO_REPLY") {
      await Storage.update<Record>(key(topicID), (draft) => {
        draft.jobs = draft.jobs.filter((item) => item.id !== job.id)
      })
      await publish(topicID)
      await Activity.record({
        coworkerID: coworker.id,
        direction: "action",
        kind: "topic.reviewed",
        title: `浏览话题：${record.title}`,
        detail: "参与了讨论，但没有补充意见。",
        resource: { type: "topic", id: record.id, title: record.title },
      })
      return
    }
    const commentID = crypto.randomUUID()
    await Storage.update<Record>(key(topicID), (draft) => {
      draft.comments.push({
        id: commentID,
        author: { type: "agent", id: coworker.id, name: coworker.name },
        content,
        mentions: mentions(content, draft.participants),
        createdAt: Date.now(),
      })
      draft.updatedAt = Date.now()
      draft.jobs = draft.jobs.filter((item) => item.id !== job.id)
      enqueue(draft, content, job.rootCommentID, job.depth + 1, { exclude: coworker.id })
    })
    await publish(topicID)
    await Activity.record({
      coworkerID: coworker.id,
      direction: "sent",
      kind: "topic.comment",
      title: `发表话题评论：${record.title}`,
      detail: snippet(content),
      resource: { type: "topic", id: record.id, title: record.title },
    })
    await Activity.recordMany(
      referenced(content, record.participants)
        .filter((participant) => participant.coworkerID !== coworker.id)
        .map((participant) => ({
          coworkerID: participant.coworkerID,
          direction: "received" as const,
          kind: "topic.mentioned",
          title: `话题中提到你：${record.title}`,
          detail: snippet(content),
          resource: { type: "topic", id: record.id, title: record.title },
        })),
    )
  }

  async function run(topicID: string) {
    while (true) {
      const record = await readRecord(topicID)
      const job = record?.jobs.find((item) => item.status === "pending")
      if (!record || !job) return
      await Storage.update<Record>(key(topicID), (draft) => {
        const current = draft.jobs.find((item) => item.id === job.id)
        if (current) current.status = "running"
      })
      await publish(topicID)
      try {
        await reply(topicID, job)
      } catch (error) {
        log.error("topic reply failed", { topicID, coworkerID: job.coworkerID, error: String(error) })
        await Storage.update<Record>(key(topicID), (draft) => {
          const current = draft.jobs.find((item) => item.id === job.id)
          if (current) current.status = "error"
        })
        await publish(topicID)
      }
    }
  }

  export function kick(topicID: string) {
    if (active.has(topicID)) return
    if (!Instance.has()) return
    const directory = Instance.directory
    active.add(topicID)
    void (async () => {
      const record = await readRecord(topicID)
      if (!record) return
      await Instance.provide({ directory, fn: () => run(topicID) })
    })()
      .catch((error) => log.error("topic worker failed", { topicID, error: String(error) }))
      .finally(() => {
        active.delete(topicID)
        void readRecord(topicID).then((record) => {
          if (record?.jobs.some((job) => job.status === "pending")) kick(topicID)
        })
      })
  }
}
