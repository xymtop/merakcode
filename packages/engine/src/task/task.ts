import { z } from "zod"
import { Activity } from "../activity/activity"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Coworker } from "../coworker/coworker"
import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { Text } from "../util/text"

export namespace Task {
  export const Actor = z
    .object({
      type: z.enum(["user", "agent"]),
      id: z.string(),
      name: z.string(),
    })
    .meta({ ref: "TaskActor" })

  export const Assignee = z
    .object({
      coworkerID: z.string(),
      name: z.string(),
    })
    .meta({ ref: "TaskAssignee" })

  export const Comment = z
    .object({
      id: z.string(),
      author: Actor,
      content: z.string(),
      createdAt: z.number(),
    })
    .meta({ ref: "TaskComment" })

  export const Info = z
    .object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      status: z.enum(["todo", "doing", "done"]),
      priority: z.enum(["low", "medium", "high"]),
      assignee: Assignee.optional(),
      creator: Actor,
      comments: Comment.array(),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .meta({ ref: "Task" })

  export type Actor = z.infer<typeof Actor>
  export type Info = z.infer<typeof Info>

  export const Updated = BusEvent.define("task.updated", z.object({ taskID: z.string() }))

  export class Error extends globalThis.Error {
    constructor(readonly text: Text.Pair) {
      super(text.en)
    }
  }

  const key = (id: string) => ["task", id]
  const user: Actor = { type: "user", id: "local", name: "User" }

  async function publish(id: string) {
    if (Instance.has()) await Bus.publish(Updated, { taskID: id }).catch(() => undefined)
  }

  async function read(id: string) {
    return Storage.read<Info>(key(id)).catch(() => undefined)
  }

  export async function list() {
    const tasks = (
      await Promise.all(
        (await Storage.list(["task"]))
          .map((item) => item[1])
          .filter((id): id is string => !!id)
          .map(read),
      )
    ).filter((task): task is Info => !!task)
    return tasks.toSorted((a, b) => b.updatedAt - a.updatedAt)
  }

  export async function get(id: string) {
    return read(id)
  }

  async function resolveAssignee(coworkerID?: string) {
    if (!coworkerID) return
    const coworker = await Coworker.get(coworkerID)
    if (!coworker) throw new Error({ zh: "指定的智能体不存在", en: "The assigned agent does not exist" })
    return { coworkerID: coworker.id, name: coworker.name }
  }

  export async function create(
    input: {
      title: string
      description?: string
      priority?: Info["priority"]
      assigneeID?: string
    },
    actor: Actor = user,
  ) {
    const title = input.title.trim()
    if (!title) throw new Error({ zh: "待办标题必填", en: "Task title is required" })
    const assignee = await resolveAssignee(input.assigneeID)
    const now = Date.now()
    const task: Info = {
      id: crypto.randomUUID(),
      title,
      description: input.description?.trim() ?? "",
      status: "todo",
      priority: input.priority ?? "medium",
      assignee,
      creator: actor,
      comments: [],
      createdAt: now,
      updatedAt: now,
    }
    await Storage.write(key(task.id), task)
    await publish(task.id)
    if (actor.type === "agent") {
      await Activity.record({
        coworkerID: actor.id,
        direction: "sent",
        kind: "task.created",
        title: `创建待办：${task.title}`,
        detail: task.description,
        resource: { type: "task", id: task.id, title: task.title },
      })
    }
    if (assignee && assignee.coworkerID !== actor.id) {
      await Activity.record({
        coworkerID: assignee.coworkerID,
        direction: "received",
        kind: "task.assigned",
        title: `收到待办：${task.title}`,
        detail: task.description,
        resource: { type: "task", id: task.id, title: task.title },
      })
    }
    return task
  }

  async function authorize(id: string, actor: Actor) {
    const current = await read(id)
    if (!current) throw new Error({ zh: "待办不存在", en: "Task not found" })
    if (actor.type === "agent" && current.assignee?.coworkerID !== actor.id)
      throw new Error({ zh: "只能修改分配给自己的待办", en: "Agents may only change tasks assigned to them" })
    return current
  }

  export async function update(
    id: string,
    input: {
      status?: Info["status"]
      priority?: Info["priority"]
      assigneeID?: string | null
      title?: string
      description?: string
    },
    actor: Actor = user,
  ) {
    await authorize(id, actor)
    const nextAssignee =
      input.assigneeID === undefined
        ? undefined
        : input.assigneeID === null
          ? null
          : await resolveAssignee(input.assigneeID)
    const task = await Storage.update<Info>(key(id), (draft) => {
      if (input.title !== undefined && input.title.trim()) draft.title = input.title.trim()
      if (input.description !== undefined) draft.description = input.description.trim()
      if (input.status !== undefined) draft.status = input.status
      if (input.priority !== undefined) draft.priority = input.priority
      if (nextAssignee !== undefined) {
        if (nextAssignee) draft.assignee = nextAssignee
        else delete draft.assignee
      }
      draft.updatedAt = Date.now()
    })
    await publish(id)
    if (nextAssignee && nextAssignee.coworkerID !== actor.id) {
      await Activity.record({
        coworkerID: nextAssignee.coworkerID,
        direction: "received",
        kind: "task.assigned",
        title: `收到待办：${task.title}`,
        detail: task.description,
        resource: { type: "task", id: task.id, title: task.title },
      })
    }
    if (actor.type === "agent") {
      await Activity.record({
        coworkerID: actor.id,
        direction: "sent",
        kind: "task.updated",
        title: `更新待办：${task.title}`,
        detail: input.status ? `状态：${input.status}` : undefined,
        resource: { type: "task", id: task.id, title: task.title },
      })
    } else if (task.assignee) {
      await Activity.record({
        coworkerID: task.assignee.coworkerID,
        direction: "received",
        kind: "task.updated",
        title: `待办有更新：${task.title}`,
        detail: input.status ? `状态：${input.status}` : undefined,
        resource: { type: "task", id: task.id, title: task.title },
      })
    }
    return task
  }

  export async function comment(id: string, content: string, actor: Actor = user) {
    const text = content.trim()
    if (!text) throw new Error({ zh: "评论内容不能为空", en: "Comment cannot be empty" })
    const current = await authorize(id, actor)
    const task = await Storage.update<Info>(key(id), (draft) => {
      draft.comments.push({
        id: crypto.randomUUID(),
        author: actor,
        content: text,
        createdAt: Date.now(),
      })
      draft.updatedAt = Date.now()
    })
    await publish(id)
    if (actor.type === "agent") {
      await Activity.record({
        coworkerID: actor.id,
        direction: "sent",
        kind: "task.comment",
        title: `评论待办：${task.title}`,
        detail: text,
        resource: { type: "task", id: task.id, title: task.title },
      })
    } else if (current.assignee) {
      await Activity.record({
        coworkerID: current.assignee.coworkerID,
        direction: "received",
        kind: "task.comment",
        title: `收到待办评论：${task.title}`,
        detail: text,
        resource: { type: "task", id: task.id, title: task.title },
      })
    }
    return task
  }
}
