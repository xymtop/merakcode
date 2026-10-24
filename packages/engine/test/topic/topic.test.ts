import { expect, test } from "vitest"
import { Instance } from "@merakcode/engine/project/instance"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { Session } from "@merakcode/engine/session/index"
import { create as createGroup } from "@merakcode/engine/collaboration/store"
import { Topic } from "@merakcode/engine/topic/topic"
import { tmpdir } from "../fixture/fixture"

test("a topic stores a main post, invited agents, and comments", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const architect = await Coworker.create({ name: "林澈", duty: "负责架构评审" })
      const writer = await Coworker.create({ name: "苏简", duty: "负责整理结论" })
      const created = await Topic.create(
        {
          title: "发布流程讨论",
          body: "确定回滚边界",
          participants: [architect.id, writer.id],
        },
        { type: "user", id: "local", name: "User" },
        { dispatch: false },
      )

      expect(created.title).toBe("发布流程讨论")
      expect(created.body).toBe("确定回滚边界")
      expect(created.participants).toEqual([
        { coworkerID: architect.id, name: "林澈", duty: "负责架构评审" },
        { coworkerID: writer.id, name: "苏简", duty: "负责整理结论" },
      ])
      expect(created.working.map((item) => item.name)).toEqual(["林澈", "苏简"])

      const commented = await Topic.comment(
        created.id,
        "先从回滚窗口开始讨论。",
        { type: "user", id: "local", name: "User" },
        { dispatch: false },
      )
      expect(commented.comments).toHaveLength(1)
      expect(commented.comments[0]).toMatchObject({
        author: { type: "user", id: "local" },
        content: "先从回滚窗口开始讨论。",
      })
      expect((await Topic.get(created.id))?.title).toBe("发布流程讨论")
      expect((await Topic.list()).map((item) => item.id)).toContain(created.id)
    },
  })
})

test("a topic needs a title and existing participants", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Topic.create({ title: "", body: "Body", participants: [] })).rejects.toThrow(/title/i)
      await expect(Topic.create({ title: "Empty", body: "Body", participants: [] })).rejects.toThrow(/agent/i)
      await expect(Topic.create({ title: "Missing", body: "Body", participants: ["missing"] })).rejects.toThrow(
        /no longer exist/i,
      )
    },
  })
})

test("topic conversations from the first implementation migrate into posts", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Coworker.create({ name: "林澈", duty: "负责架构" })
      const session = await Session.create({
        title: "旧话题",
        metadata: { group: true, kind: "topic", description: "旧的正文" },
      })
      await createGroup(session.id, {
        leader: { name: "主持人" },
        seats: [{ name: agent.name, duty: agent.duty, product: "merak", coworkerID: agent.id }],
      })

      const migrated = await Topic.get(session.id)
      expect(migrated).toMatchObject({
        id: session.id,
        title: "旧话题",
        body: "旧的正文",
        participants: [{ coworkerID: agent.id, name: "林澈", duty: "负责架构" }],
      })
    },
  })
})
