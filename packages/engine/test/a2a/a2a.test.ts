import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { expect, test } from "vitest"
import { A2AAuth } from "@merakcode/engine/a2a/auth"
import { A2ACard } from "@merakcode/engine/a2a/card"
import { A2AClient } from "@merakcode/engine/a2a/client"
import { A2ASession } from "@merakcode/engine/a2a/session"
import { Coworker } from "@merakcode/engine/coworker/coworker"
import { CoworkerPath } from "@merakcode/engine/coworker/path"
import { Agent } from "@merakcode/engine/agent/agent"
import { Instance } from "@merakcode/engine/project/instance"
import { Session } from "../../src/session"
import { SessionRunner } from "../../src/session/runner"
import { Filesystem } from "@merakcode/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const binding = {
  cardUrl: "https://example.com/.well-known/agent-card.json",
  rpcUrl: "https://example.com/rpc",
  name: "Recipe",
  description: "Cooks",
  skills: [{ id: "cook", name: "Cook" }],
  authKind: "none" as const,
  interfaces: [{ url: "https://example.com/rpc", protocolBinding: "JSONRPC" }],
}

test("agent card urls fall back between well-known paths", () => {
  expect(A2ACard.candidateUrls("https://example.com")).toEqual([
    "https://example.com/.well-known/agent-card.json",
    "https://example.com/.well-known/agent.json",
  ])
  expect(A2ACard.candidateUrls("https://example.com/cards/mine.json")).toEqual(["https://example.com/cards/mine.json"])
})

test("normalize accepts interface cards and legacy url cards", () => {
  const modern = A2ACard.normalize("https://example.com/.well-known/agent-card.json", {
    name: "Recipe",
    description: "Cooks",
    supportedInterfaces: [{ url: "https://example.com/rpc", protocolBinding: "JSONRPC", protocolVersion: "0.3" }],
    skills: [{ name: "Cook" }],
    securitySchemes: { key: { type: "apiKey" } },
  })
  expect(modern.rpcUrl).toBe("https://example.com/rpc")
  expect(modern.authKind).toBe("apiKey")
  expect(modern.skills[0]?.name).toBe("Cook")

  const legacy = A2ACard.normalize("https://example.com/.well-known/agent.json", {
    name: "Old",
    url: "https://example.com/a2a",
  })
  expect(legacy.rpcUrl).toBe("https://example.com/a2a")
  expect(legacy.authKind).toBe("none")
})

test("a2a coworker is stored without a local agent file", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const created = await Coworker.create({
        name: "Recipe",
        runtime: "a2a",
        a2a: binding,
      })
      expect(created.runtime).toBe("a2a")
      expect(created.a2a?.rpcUrl).toBe(binding.rpcUrl)
      expect(await Filesystem.exists(CoworkerPath.a2a(created.id))).toBe(true)
      expect(await Filesystem.exists(CoworkerPath.agentMd(created.id))).toBe(false)
      expect(await Agent.get(created.id)).toBeUndefined()
      await expect(Coworker.setBindings(created.id, { skills: ["deploy"] })).rejects.toThrow(/local model/i)
    },
  })
})

test("client sends a message and a dm skips the local model", async () => {
  const methods: string[] = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      const parsed = JSON.parse(body) as { method?: string }
      methods.push(parsed.method ?? "")
      res.setHeader("content-type", "application/json")
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            message: { role: "ROLE_AGENT", parts: [{ kind: "text", text: "simmered" }] },
            contextId: "ctx-1",
          },
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  const rpcUrl = `http://127.0.0.1:${address.port}/`

  try {
    const direct = await A2AClient.sendMessage({
      binding: { ...binding, rpcUrl },
      coworkerID: "recipe",
      text: "boil water",
    })
    expect(direct.text).toBe("simmered")
    expect(methods).toContain("SendMessage")

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const created = await Coworker.create({
          name: "Recipe",
          runtime: "a2a",
          a2a: { ...binding, rpcUrl },
          auth: { type: "apiKey", key: "secret" },
        })
        await A2AAuth.set(created.id, { type: "apiKey", key: "secret" })
        const session = await Session.create({
          title: created.name,
          metadata: { kind: "coworker", coworkerId: created.id },
        })
        const reply = await SessionRunner.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "make soup" }],
        })
        expect(reply.info.role).toBe("assistant")
        const text = reply.parts.find((part) => part.type === "text")
        expect(text && text.type === "text" ? text.text : "").toBe("simmered")
        expect(await A2ASession.isA2ASession(session.id)).toBe(true)
      },
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
