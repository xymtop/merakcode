import { expect, test } from "vitest"
import { Activity } from "@merakcode/engine/activity/activity"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { Instance } from "@merakcode/engine/project/instance"
import { Task } from "@merakcode/engine/task/task"
import { tmpdir } from "../fixture/fixture"

test("tasks keep status, assignment, and comments in the shared business service", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Coworker.create({ name: "林澈", duty: "负责发布" })
      const task = await Task.create({
        title: "检查发布清单",
        description: "确认版本号和变更说明。",
        priority: "high",
        assigneeID: agent.id,
      })

      expect(task).toMatchObject({
        status: "todo",
        priority: "high",
        assignee: { coworkerID: agent.id, name: agent.name },
      })

      await Task.comment(task.id, "版本号已确认。", { type: "agent", id: agent.id, name: agent.name })
      const updated = await Task.update(task.id, { status: "done" }, { type: "agent", id: agent.id, name: agent.name })

      expect(updated.status).toBe("done")
      expect(updated.comments.at(-1)).toMatchObject({
        author: { type: "agent", id: agent.id },
        content: "版本号已确认。",
      })
      expect((await Task.list())[0]?.id).toBe(task.id)

      const activity = await Activity.list(agent.id)
      expect(activity.map((entry) => entry.title)).toEqual(
        expect.arrayContaining(["收到待办：检查发布清单", "评论待办：检查发布清单", "更新待办：检查发布清单"]),
      )
    },
  })
})

test("agents cannot change tasks assigned to another agent", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const owner = await Coworker.create({ name: "林澈", duty: "负责发布" })
      const other = await Coworker.create({ name: "苏简", duty: "负责整理" })
      const task = await Task.create({ title: "检查发布清单", assigneeID: owner.id })

      await expect(
        Task.update(task.id, { status: "done" }, { type: "agent", id: other.id, name: other.name }),
      ).rejects.toThrow("only change tasks assigned")
      expect((await Task.get(task.id))?.status).toBe("todo")
    },
  })
})
