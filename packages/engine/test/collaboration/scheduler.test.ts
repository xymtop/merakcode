import { expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  Mode,
  SOPS,
  Status,
  applySop,
  assignReady,
  createTask,
  finish,
  mentions,
  ready,
  start,
  updateTask,
} from "../../src/collaboration/scheduler"
import { addTask, changeTask, create, load, prepareTasks } from "../../src/collaboration/store"
import { tmpdir } from "../fixture/fixture"

const seats = [
  { id: "s1", name: "小主", leader: true },
  { id: "s2", name: "小红", leader: false },
  { id: "s3", name: "小刚", leader: false },
]

test("task pool makes tasks ready and assigns each to the least-loaded member", () => {
  const tasks = [
    createTask({ title: "做登录" }, { mode: Mode.Pool, tasks: [] }),
    createTask({ title: "做支付" }, { mode: Mode.Pool, tasks: [] }),
  ]
  expect(tasks.map((task) => task.status)).toEqual([Status.Ready, Status.Ready])
  const assigned = assignReady(Mode.Pool, tasks, seats)
  expect(new Set(assigned.map((task) => task.assignee))).toEqual(new Set(["小红", "小刚"]))
})

test("a DAG task stays blocked until every dependency is done", () => {
  const first = createTask({ title: "设计" }, { mode: Mode.DAG, tasks: [] })
  const second = createTask(
    { title: "实现", dependencies: [first.id] },
    { mode: Mode.DAG, tasks: [first] },
  )
  expect(first.status).toBe(Status.Ready)
  expect(second.status).toBe(Status.Blocked)
  const running = start(Mode.DAG, [first, second], first.id, "小红")
  const done = finish(Mode.DAG, running, first.id, { result: "设计好了" })
  expect(done.find((task) => task.id === second.id)?.status).toBe(Status.Ready)
  expect(ready(Mode.DAG, done).map((task) => task.id)).toEqual([second.id])
})

test("cycles and dependencies on missing tasks are refused", () => {
  const first = createTask({ title: "一" }, { mode: Mode.DAG, tasks: [] })
  const second = createTask({ title: "二", dependencies: [first.id] }, { mode: Mode.DAG, tasks: [first] })
  expect(() => updateTask(Mode.DAG, [first, second], first.id, { dependencies: [second.id] })).toThrow(/cycle/i)
  expect(() =>
    updateTask(Mode.DAG, [first, second], first.id, { dependencies: [crypto.randomUUID()] }),
  ).toThrow("Dependency not found")
})

test("an SOP compiles into a localized DAG with dependencies", () => {
  const sop = SOPS.find((item) => item.id === "feature")!
  const result = applySop(Mode.DAG, [], sop, "user", "zh")
  expect(result.tasks.map((task) => task.title)).toEqual(["梳理需求", "技术设计", "实现功能", "测试验收"])
  expect(result.tasks.map((task) => task.status)).toEqual([
    Status.Ready,
    Status.Blocked,
    Status.Blocked,
    Status.Blocked,
  ])
  expect(result.tasks[1]!.dependencies).toEqual([result.tasks[0]!.id])
})

test("@ messages distinguish information, questions and handoffs without matching unknown names", () => {
  const found = mentions({
    from: "s2",
    seats,
    taskID: "t1",
    text: ["完成", "@小刚: 接口在 src/api.ts", "@小刚 ask: 要兼容旧版吗", "@小主 handoff: 做验收", "@没人: 忽略"].join(
      "\n",
    ),
  })
  expect(found.map((message) => message.kind)).toEqual(["inform", "ask", "handoff"])
  expect(found.map((message) => message.to)).toEqual(["s3", "s3", "s1"])
})

test("the group record stores scheduler, tasks and assignments", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ metadata: { group: true } })
      await create(session.id, {
        leader: { name: "小主" },
        seats: [{ name: "小红", product: "merak" }],
        scheduler: Mode.Pool,
      })
      await addTask(session.id, { title: "写测试" })
      await changeTask(session.id, (await load(session.id))!.tasks[0]!.id, { assignee: "" })
      await prepareTasks(session.id)
      const group = await load(session.id)
      expect(group).toMatchObject({
        scheduler: Mode.Pool,
        tasks: [{ title: "写测试", status: Status.Ready, assignee: "小红" }],
      })
    },
  })
})
