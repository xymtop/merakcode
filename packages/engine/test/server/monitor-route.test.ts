import { afterEach, expect, test } from "vitest"
import { setLocalSecretForTest } from "@merakcode/engine/auth/local-secret"
import { Monitor } from "@merakcode/engine/monitor/monitor"
import { Instance } from "@merakcode/engine/project/instance"
import { Server } from "@merakcode/engine/server/server"
import { Session } from "@merakcode/engine/session/index"
import { SessionNotification } from "@merakcode/engine/session/notification"
import { SessionStatus } from "@merakcode/engine/session/status"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  setLocalSecretForTest(undefined)
  await Instance.disposeAll().catch(() => undefined)
})

test("a session-scoped monitoring token can post a signal without the engine password", async () => {
  await using tmp = await tmpdir({ git: true })
  const session = await Instance.provide({
    directory: tmp.path,
    fn: () => Session.create({ title: "monitor route" }),
  })
  const environment = Monitor.environment(session.id, new URL("http://localhost"))
  setLocalSecretForTest("engine-password")

  const app = Server.App()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      SessionStatus.set(session.id, { type: "busy" })
      const response = await app.request(
        `http://localhost/monitor/${encodeURIComponent(session.id)}?directory=${encodeURIComponent(tmp.path)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${environment.MERAKCODE_MONITOR_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "构建完成",
            message: "dist 已更新",
            severity: "info",
            source: "watch-test",
            data: { files: 3 },
          }),
        },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        sessionID: session.id,
        title: "构建完成",
        source: "watch-test",
        severity: "info",
      })
      expect(await SessionNotification.list(session.id)).toHaveLength(1)
      await SessionNotification.drain(session.id)
    },
  })
})

test("a monitoring token cannot target another session", async () => {
  await using tmp = await tmpdir({ git: true })
  const sessions = await Instance.provide({
    directory: tmp.path,
    fn: () => Promise.all([Session.create({ title: "one" }), Session.create({ title: "two" })]),
  })
  const environment = Monitor.environment(sessions[0]!.id, new URL("http://localhost"))
  setLocalSecretForTest("engine-password")

  const response = await Server.App().request(
    `http://localhost/monitor/${encodeURIComponent(sessions[1]!.id)}?directory=${encodeURIComponent(tmp.path)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${environment.MERAKCODE_MONITOR_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "forged", message: "should not arrive" }),
    },
  )

  expect(response.status).toBe(401)
  expect(await SessionNotification.list(sessions[1]!.id)).toEqual([])
})
