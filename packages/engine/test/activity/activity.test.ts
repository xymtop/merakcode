import { expect, test } from "vitest"
import { Activity } from "@merakcode/engine/activity/activity"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { Instance } from "@merakcode/engine/project/instance"
import { Task } from "@merakcode/engine/task/task"
import { tmpdir } from "../fixture/fixture"

test("task assignment and completion appear in the agent timeline", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Coworker.create({ name: "林澈", duty: "负责架构" })
      const task = await Task.create(
        { title: "检查发布清单", assigneeID: agent.id },
        { type: "user", id: "local", name: "User" },
      )
      await Task.update(task.id, { status: "done" }, { type: "agent", id: agent.id, name: agent.name })

      const events = await Activity.list(agent.id)
      expect(events.map((event) => event.title)).toEqual(
        expect.arrayContaining(["收到待办：检查发布清单", "更新待办：检查发布清单"]),
      )
      expect(events.find((event) => event.title.startsWith("收到待办"))).toMatchObject({
        direction: "received",
        resource: { type: "task", id: task.id },
      })
      expect(events.find((event) => event.title.startsWith("更新待办"))).toMatchObject({
        direction: "sent",
        resource: { type: "task", id: task.id },
      })
    },
  })
})
