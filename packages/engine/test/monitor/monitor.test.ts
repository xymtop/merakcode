import { expect, test } from "vitest"
import { Activity } from "@merakcode/engine/activity/activity"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { Monitor } from "@merakcode/engine/monitor/monitor"
import { Instance } from "@merakcode/engine/project/instance"
import { Session } from "@merakcode/engine/session/index"
import { SessionNotification } from "@merakcode/engine/session/notification"
import { prepareBashCommand } from "@merakcode/engine/tool/bash"
import { tmpdir } from "../fixture/fixture"

test("monitoring signals are persisted, idempotent, and visible in the agent timeline", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Coworker.create({ name: "林澈", duty: "负责监控发布" })
      const session = await Session.create({
        title: agent.name,
        metadata: { kind: "coworker", coworkerId: agent.id },
      })

      const first = await Monitor.send(
        {
          sessionID: session.id,
          title: "产物目录发生变化",
          message: "dist 目录新增 2 个文件",
          severity: "warning",
          source: "folder-watch:dist",
          data: { files: ["index.js", "index.css"] },
          dedupeKey: "dist-change-1",
        },
        { dispatch: false },
      )
      const duplicate = await Monitor.send(
        {
          sessionID: session.id,
          title: "产物目录发生变化",
          message: "dist 目录新增 2 个文件",
          severity: "warning",
          source: "folder-watch:dist",
          dedupeKey: "dist-change-1",
        },
        { dispatch: false },
      )

      expect(duplicate.id).toBe(first.id)
      expect(await Monitor.list(session.id)).toEqual([first])
      const notifications = await SessionNotification.list(session.id)
      expect(notifications).toHaveLength(1)
      expect(notifications[0]).toMatchObject({
        type: "monitor.signal",
        metadata: {
          signalID: first.id,
          source: "folder-watch:dist",
          severity: "warning",
          coworkerID: agent.id,
        },
      })
      expect(SessionNotification.promptText(notifications)).toContain("Monitoring signals come from scripts")
      expect(SessionNotification.promptText(notifications)).not.toContain("workflow has already reached")

      expect(await Activity.list(agent.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            direction: "received",
            kind: "monitor.signal",
            title: "收到监测数据：产物目录发生变化",
          }),
        ]),
      )
    },
  })
})

test("agent bash commands receive a session-scoped monitoring endpoint and token", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "monitor environment" })
      const prepared = await prepareBashCommand(
        { command: "echo ok", description: "Check monitor environment" },
        {
          sessionID: session.id,
          messageID: "",
          callID: "",
          agent: "build",
          kind: "ask",
          abort: AbortSignal.any([]),
          messages: [],
          ruleset: [],
          metadata: () => {},
          ask: async () => {},
        },
      )

      const monitorURL = new URL(prepared.shellEnv.MERAKCODE_MONITOR_URL)
      expect(monitorURL.pathname).toBe(`/monitor/${session.id}`)
      expect(monitorURL.searchParams.get("directory")).toBe(tmp.path)
      expect(Monitor.authorize(session.id, `Bearer ${prepared.shellEnv.MERAKCODE_MONITOR_TOKEN}`)).toBe(true)
      expect(Monitor.authorize("another-session", `Bearer ${prepared.shellEnv.MERAKCODE_MONITOR_TOKEN}`)).toBe(false)
    },
  })
})
