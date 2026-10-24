import { expect, test } from "vitest"
import { AppMCP } from "@merakcode/engine/mcp/apps"
import { MCP } from "@merakcode/engine/mcp/index"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { Instance } from "@merakcode/engine/project/instance"
import { Topic } from "@merakcode/engine/topic/topic"
import { Task } from "@merakcode/engine/task/task"
import { tmpdir } from "../fixture/fixture"

test("the built-in app MCP server exposes and executes topic tools with agent identity", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Coworker.create({ name: "林澈", duty: "负责架构" })
      const peer = await Coworker.create({ name: "苏简", duty: "负责整理" })
      const { client, server } = await AppMCP.create()
      try {
        const listed = await client.listTools()
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
          "activity_list",
          "todo_comment",
          "todo_create",
          "todo_list",
          "todo_read",
          "todo_update",
          "topic_comment",
          "topic_create",
          "topic_list",
          "topic_read",
        ])

        const mine = {
          "merakcode/actor": { type: "agent", id: agent.id },
        }
        await client.callTool({
          name: "topic_create",
          arguments: {
            title: "MCP 话题",
            body: "通过 MCP 创建主帖。",
            participants: [peer.id],
          },
          _meta: mine,
        })
        const [topic] = await Topic.list()
        expect(topic).toMatchObject({
          title: "MCP 话题",
          author: { type: "agent", id: agent.id, name: "林澈" },
        })

        await client.callTool({
          name: "topic_comment",
          arguments: { topicID: topic!.id, content: "@苏简 请补充结论。" },
          _meta: mine,
        })
        expect((await Topic.get(topic!.id))?.comments.at(-1)).toMatchObject({
          author: { type: "agent", id: agent.id },
          content: "@苏简 请补充结论。",
        })

        await client.callTool({
          name: "todo_create",
          arguments: { title: "补充发布检查", priority: "high" },
          _meta: mine,
        })
        const [task] = await Task.list()
        expect(task).toMatchObject({
          title: "补充发布检查",
          assignee: { coworkerID: agent.id, name: "林澈" },
        })
        await client.callTool({
          name: "todo_update",
          arguments: { taskID: task!.id, status: "done" },
          _meta: mine,
        })
        expect((await Task.get(task!.id))?.status).toBe("done")
      } finally {
        await client.close()
        await server.close()
      }
    },
  })
})

test("the MCP manager automatically exposes the built-in app server", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Coworker.create({ name: "林澈", duty: "负责架构" })
      const tools = await MCP.tools(agent.id)
      expect(Object.keys(tools).sort()).toEqual([
        "merak-apps_activity_list",
        "merak-apps_todo_comment",
        "merak-apps_todo_create",
        "merak-apps_todo_list",
        "merak-apps_todo_read",
        "merak-apps_todo_update",
        "merak-apps_topic_comment",
        "merak-apps_topic_create",
        "merak-apps_topic_list",
        "merak-apps_topic_read",
      ])
    },
  })
})
