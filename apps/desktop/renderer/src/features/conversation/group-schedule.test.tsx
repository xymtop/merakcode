import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, beforeEach, expect, test } from "vitest"
import type { CollaborationGroup } from "@merakcode/sdk/client"
import { setLocale } from "../../i18n"
import { GroupSchedule } from "./group-schedule"

let cleanup = () => {}

beforeEach(() => setLocale("zh"))

afterEach(() => {
  cleanup()
  cleanup = () => {}
})

function mount(node: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(node, host)
  cleanup = () => {
    dispose()
    host.remove()
  }
  return host
}

const group: CollaborationGroup = {
  scheduler: "pool",
  seats: [
    { id: "s1", name: "小主", role: "", duty: "", product: "merak", leader: true },
    { id: "s2", name: "小红", role: "产品经理", duty: "", product: "claude", leader: false },
    { id: "s3", name: "小刚", role: "开发", duty: "", product: "codex", leader: false },
  ],
  events: [],
  results: [],
  baseline: [],
  seq: 4,
  tasks: [
    {
      id: "t1",
      title: "分析登录需求",
      description: "整理已有接口",
      status: "done",
      assignee: "小红",
      dependencies: [],
      paths: [],
      createdBy: "user",
      createdAt: 1,
      result: "需求已经整理",
      depth: 0,
    },
    {
      id: "t2",
      title: "实现登录",
      description: "",
      status: "ready",
      assignee: "小刚",
      dependencies: ["t1"],
      paths: ["src/auth/**"],
      createdBy: "user",
      createdAt: 2,
      depth: 0,
    },
  ],
  messages: [
    {
      id: "m1",
      at: 3,
      from: "s2",
      to: "s3",
      kind: "handoff",
      text: "接口约定在 docs/auth.md",
      taskID: "t1",
    },
  ],
}

test("the pool shows progress, assignments, dependencies, results and member messages", () => {
  const host = mount(() => (
    <GroupSchedule
      sessionID="s"
      directory="/project"
      group={group}
      busy={false}
      onRun={async () => undefined}
    />
  ))
  expect(host.textContent).toContain("群任务")
  expect(host.textContent).toContain("1/2 已完成")
  expect(host.textContent).toContain("分析登录需求")
  expect(host.textContent).toContain("实现登录")
  expect(host.textContent).toContain("小刚")
  expect(host.textContent).toContain("前置：分析登录需求")
  expect(host.textContent).toContain("需求已经整理")
  expect(host.textContent).toContain("小红")
  expect(host.textContent).toContain("小刚")
  expect(host.textContent).toContain("接口约定在 docs/auth.md")
  expect(host.querySelector("button")?.textContent).toContain("群任务")
})

test("the add task form exposes a title, description, paths and an automatic assignee", () => {
  const host = mount(() => (
    <GroupSchedule
      sessionID="s"
      directory="/project"
      group={group}
      busy={false}
      onRun={async () => undefined}
    />
  ))
  const add = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("添加任务"))!
  add.click()
  const dialog = document.body.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain("任务标题")
  expect(dialog.querySelector('[aria-label="负责人"]')).not.toBeNull()
  expect(dialog.textContent).toContain("允许修改的路径")
})
