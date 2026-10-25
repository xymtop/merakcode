import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, expect, test } from "vitest"
import { Instance } from "@merakcode/engine/project/instance"
import { Server } from "@merakcode/engine/server/server"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { CoworkerPath } from "@merakcode/engine/coworker/path"
import { Filesystem } from "@merakcode/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

test("discover and create an a2a coworker through HTTP", async () => {
  const card = {
    name: "Recipe Bot",
    description: "Helps with recipes",
    url: "http://127.0.0.1/rpc",
    skills: [{ id: "cook", name: "Cook" }],
  }
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(card))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  const cardUrl = `http://127.0.0.1:${port}/.well-known/agent-card.json`

  try {
    await using tmp = await tmpdir({ git: true })
    const query = `?directory=${encodeURIComponent(tmp.path)}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const discovered = await app.request(`/a2a/discover${query}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: `http://127.0.0.1:${port}` }),
        })
        expect(discovered.status).toBe(200)
        const preview = await discovered.json()
        expect(preview).toMatchObject({
          name: "Recipe Bot",
          rpcUrl: "http://127.0.0.1/rpc",
          authKind: "none",
        })

        const created = await app.request(`/coworker${query}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Recipe Bot",
            runtime: "a2a",
            a2a: { url: cardUrl },
          }),
        })
        expect(created.status).toBe(200)
        const coworker = await created.json()
        expect(coworker.runtime).toBe("a2a")
        expect(coworker.a2a?.name).toBe("Recipe Bot")
        expect(await Filesystem.exists(CoworkerPath.a2a(coworker.id))).toBe(true)
        expect(await Filesystem.exists(CoworkerPath.agentMd(coworker.id))).toBe(false)
        expect(await Coworker.get(coworker.id)).toMatchObject({ runtime: "a2a" })
      },
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
