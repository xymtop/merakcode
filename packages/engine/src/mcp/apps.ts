import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { z } from "zod/v4"
import { Installation } from "../installation"

export namespace AppMCP {
  export const NAME = "merak-apps"

  type ActorMeta = {
    type: "agent"
    id: string
    sessionID?: string
  }

  function actor(meta: Record<string, unknown> | undefined): ActorMeta | undefined {
    const value = meta?.["merakcode/actor"]
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (record.type !== "agent" || typeof record.id !== "string") return
    return {
      type: "agent",
      id: record.id,
      ...(typeof record.sessionID === "string" ? { sessionID: record.sessionID } : {}),
    }
  }

  function text(value: string, error = false) {
    return {
      content: [{ type: "text" as const, text: value }],
      ...(error ? { isError: true } : {}),
    }
  }

  async function agent(meta: Record<string, unknown> | undefined) {
    const { Coworker } = await import("../coworker/coworker")
    const current = actor(meta)
    if (!current) throw new Error("Missing MerakCode agent identity")
    const coworker = await Coworker.get(current.id)
    if (!coworker) throw new Error("The calling agent no longer exists")
    return coworker
  }

  export async function create() {
    const server = new McpServer({ name: NAME, version: Installation.VERSION })

    server.registerTool(
      "topic_list",
      {
        title: "List discussion topics",
        description: "List all topics in the current project with participants, comment counts, and timestamps.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () => {
        try {
          const { Topic } = await import("../topic/topic")
          const topics = await Topic.list()
          return text(
            JSON.stringify(
              topics.map((topic) => ({
                id: topic.id,
                title: topic.title,
                author: topic.author,
                participants: topic.participants,
                comments: topic.comments.length,
                updatedAt: topic.updatedAt,
              })),
              null,
              2,
            ),
          )
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "topic_read",
      {
        title: "Read a discussion topic",
        description: "Read a topic's main post, participants, comments, and agents currently preparing replies.",
        inputSchema: z.object({ topicID: z.string() }),
        annotations: { readOnlyHint: true },
      },
      async ({ topicID }) => {
        try {
          const { Topic } = await import("../topic/topic")
          const topic = await Topic.get(topicID)
          if (!topic) return text("Topic not found", true)
          return text(JSON.stringify(topic, null, 2))
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "topic_create",
      {
        title: "Create a discussion topic",
        description:
          "Publish a new topic. Participants are coworker ids from Contacts. The calling agent is added automatically.",
        inputSchema: z.object({
          title: z.string(),
          body: z.string(),
          participants: z.array(z.string()).optional(),
        }),
      },
      async (input, extra) => {
        try {
          const { Topic } = await import("../topic/topic")
          const coworker = await agent(extra._meta)
          const topic = await Topic.create(
            {
              title: input.title,
              body: input.body,
              participants: [...new Set([coworker.id, ...(input.participants ?? [])])],
            },
            { type: "agent", id: coworker.id, name: coworker.name },
          )
          return text(`Created topic "${topic.title}" (${topic.id}).`)
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "topic_comment",
      {
        title: "Comment on a discussion topic",
        description:
          "Add a comment as the calling agent. Mention participants as @Name, or the human as @用户 / @User.",
        inputSchema: z.object({ topicID: z.string(), content: z.string() }),
      },
      async ({ topicID, content }, extra) => {
        try {
          const { Topic } = await import("../topic/topic")
          const coworker = await agent(extra._meta)
          const topic = await Topic.comment(topicID, content, {
            type: "agent",
            id: coworker.id,
            name: coworker.name,
          })
          return text(`Comment added to "${topic.title}".`)
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "todo_list",
      {
        title: "List assigned todos",
        description: "List tasks assigned to the calling agent, newest first.",
        inputSchema: z.object({
          status: z.enum(["todo", "doing", "done"]).optional(),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ status }, extra) => {
        try {
          const coworker = await agent(extra._meta)
          const { Task } = await import("../task/task")
          const tasks = (await Task.list()).filter(
            (task) => task.assignee?.coworkerID === coworker.id && (status === undefined || task.status === status),
          )
          return text(JSON.stringify(tasks, null, 2))
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "todo_read",
      {
        title: "Read a todo",
        description: "Read a task, including its description, status, assignee, and comments.",
        inputSchema: z.object({ taskID: z.string() }),
        annotations: { readOnlyHint: true },
      },
      async ({ taskID }) => {
        try {
          const { Task } = await import("../task/task")
          const task = await Task.get(taskID)
          if (!task) return text("Task not found", true)
          return text(JSON.stringify(task, null, 2))
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "todo_create",
      {
        title: "Create a todo",
        description: "Create a task. It is assigned to the calling agent by default.",
        inputSchema: z.object({
          title: z.string(),
          description: z.string().optional(),
          priority: z.enum(["low", "medium", "high"]).optional(),
          assigneeID: z.string().optional(),
        }),
      },
      async (input, extra) => {
        try {
          const coworker = await agent(extra._meta)
          const { Task } = await import("../task/task")
          const task = await Task.create(
            { ...input, assigneeID: input.assigneeID ?? coworker.id },
            { type: "agent", id: coworker.id, name: coworker.name },
          )
          return text(`Created task "${task.title}" (${task.id}).`)
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "todo_update",
      {
        title: "Update an assigned todo",
        description:
          "Change status, priority, title, description, or assignment of a task assigned to the calling agent.",
        inputSchema: z.object({
          taskID: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(["todo", "doing", "done"]).optional(),
          priority: z.enum(["low", "medium", "high"]).optional(),
          assigneeID: z.string().nullable().optional(),
        }),
      },
      async ({ taskID, ...patch }, extra) => {
        try {
          const coworker = await agent(extra._meta)
          const { Task } = await import("../task/task")
          const task = await Task.update(taskID, patch, {
            type: "agent",
            id: coworker.id,
            name: coworker.name,
          })
          return text(`Updated task "${task.title}".`)
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "todo_comment",
      {
        title: "Comment on an assigned todo",
        description: "Add a progress note or question to a task assigned to the calling agent.",
        inputSchema: z.object({ taskID: z.string(), content: z.string() }),
      },
      async ({ taskID, content }, extra) => {
        try {
          const coworker = await agent(extra._meta)
          const { Task } = await import("../task/task")
          const task = await Task.comment(taskID, content, {
            type: "agent",
            id: coworker.id,
            name: coworker.name,
          })
          return text(`Comment added to task "${task.title}".`)
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "monitor_send",
      {
        title: "Send monitoring data to this session",
        description:
          "Queue structured monitoring data for the calling agent's current session. The data is delivered as a system notification after the current turn becomes idle.",
        inputSchema: z.object({
          title: z.string(),
          message: z.string(),
          severity: z.enum(["info", "warning", "error"]).optional(),
          source: z.string().optional(),
          data: z.unknown().optional(),
          dedupeKey: z.string().optional(),
        }),
      },
      async (input, extra) => {
        try {
          const current = actor(extra._meta)
          if (!current?.sessionID) return text("Missing MerakCode session identity", true)
          const coworker = await agent(extra._meta)
          const { Monitor } = await import("../monitor/monitor")
          const signal = await Monitor.send({
            ...input,
            sessionID: current.sessionID,
            source: input.source ?? `agent:${coworker.id}`,
          })
          return text(`Queued monitoring signal "${signal.title}" (${signal.id}).`)
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    server.registerTool(
      "activity_list",
      {
        title: "List my activity",
        description: "List recent events received or actions performed by the calling agent.",
        inputSchema: z.object({ limit: z.number().int().positive().max(1000).optional() }),
        annotations: { readOnlyHint: true },
      },
      async ({ limit }, extra) => {
        try {
          const coworker = await agent(extra._meta)
          const { Activity } = await import("../activity/activity")
          return text(JSON.stringify(await Activity.list(coworker.id, limit), null, 2))
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), true)
        }
      },
    )

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: "merakcode", version: Installation.VERSION })
    await client.connect(clientTransport)
    return { client, server }
  }
}
