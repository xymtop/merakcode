import { z } from "zod"
import { Text } from "../util/text"
import { A2ABinding } from "./binding"

export namespace A2ACard {
  export class Error extends globalThis.Error {
    constructor(readonly text: Text.Pair) {
      super(text.en)
    }
  }

  const Skill = z.object({
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })

  const Interface = z.object({
    url: z.string(),
    protocolBinding: z.string().optional(),
    protocolVersion: z.string().optional(),
    transport: z.string().optional(),
  })

  /** Accept both current Agent Cards and older url-at-root cards. */
  const Raw = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      version: z.string().optional(),
      url: z.string().optional(),
      supportedInterfaces: z.array(Interface).optional(),
      skills: z.array(Skill).optional(),
      securitySchemes: z.record(z.string(), z.unknown()).optional(),
      security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
      securityRequirements: z.array(z.record(z.string(), z.array(z.string()))).optional(),
      capabilities: z.record(z.string(), z.unknown()).optional(),
      defaultInputModes: z.array(z.string()).optional(),
      defaultOutputModes: z.array(z.string()).optional(),
      protocolVersion: z.string().optional(),
    })
    .passthrough()

  export const Preview = A2ABinding.Info.extend({
    capabilities: z.record(z.string(), z.unknown()).optional(),
  }).meta({ ref: "A2ACardPreview" })
  export type Preview = z.infer<typeof Preview>

  const WELL_KNOWN = ["/.well-known/agent-card.json", "/.well-known/agent.json"] as const

  /** Resolve user input to candidate card URLs (exact path first, then well-known fallbacks). */
  export function candidateUrls(input: string): string[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    let base: URL
    try {
      base = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
    } catch {
      return []
    }
    const path = base.pathname.replace(/\/+$/, "") || "/"
    if (path !== "/" && !path.endsWith("/.well-known/agent-card.json") && !path.endsWith("/.well-known/agent.json")) {
      return [base.toString()]
    }
    if (path.endsWith("/.well-known/agent-card.json") || path.endsWith("/.well-known/agent.json")) {
      const other =
        path.endsWith("agent-card.json")
          ? new URL("/.well-known/agent.json", base.origin).toString()
          : new URL("/.well-known/agent-card.json", base.origin).toString()
      return [base.toString(), other]
    }
    return WELL_KNOWN.map((suffix) => new URL(suffix, base.origin).toString())
  }

  function authKind(raw: z.infer<typeof Raw>): A2ABinding.Info["authKind"] {
    const schemes = raw.securitySchemes ?? {}
    const keys = Object.keys(schemes)
    if (keys.length === 0) return "none"
    for (const value of Object.values(schemes)) {
      const type = typeof value === "object" && value && "type" in value ? String((value as { type: unknown }).type) : ""
      if (/oauth/i.test(type)) return "oauth2"
    }
    return "apiKey"
  }

  function pickInterface(raw: z.infer<typeof Raw>) {
    const interfaces = raw.supportedInterfaces ?? []
    const preferred =
      interfaces.find((item) => /jsonrpc/i.test(item.protocolBinding ?? item.transport ?? "")) ?? interfaces[0]
    if (preferred?.url) {
      return {
        rpcUrl: preferred.url,
        protocolVersion: preferred.protocolVersion ?? raw.protocolVersion,
        interfaces: interfaces.map((item) => ({
          url: item.url,
          protocolBinding: item.protocolBinding ?? item.transport,
          protocolVersion: item.protocolVersion,
        })),
      }
    }
    if (raw.url) {
      return {
        rpcUrl: raw.url,
        protocolVersion: raw.protocolVersion,
        interfaces: [{ url: raw.url, protocolVersion: raw.protocolVersion }],
      }
    }
    throw new globalThis.Error("Agent Card has no RPC URL")
  }

  export function normalize(cardUrl: string, raw: unknown): Preview {
    const parsed = Raw.safeParse(raw)
    if (!parsed.success) {
      throw new A2ACard.Error({
        zh: "Agent Card 格式无效",
        en: "Invalid Agent Card",
      })
    }
    const data = parsed.data
    let iface: ReturnType<typeof pickInterface>
    try {
      iface = pickInterface(data)
    } catch {
      throw new A2ACard.Error({
        zh: "Agent Card 缺少 RPC 地址",
        en: "Agent Card has no RPC URL",
      })
    }
    return Preview.parse({
      cardUrl,
      rpcUrl: iface.rpcUrl,
      protocolVersion: iface.protocolVersion,
      interfaces: iface.interfaces,
      name: data.name,
      description: data.description ?? "",
      skills: (data.skills ?? []).map((skill, index) => ({
        id: skill.id ?? `skill-${index}`,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
      })),
      authKind: authKind(data),
      version: data.version,
      capabilities: data.capabilities,
    })
  }

  async function fetchJson(url: string, signal?: AbortSignal) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
      redirect: "follow",
    })
    if (!response.ok) throw new globalThis.Error(`HTTP ${response.status}`)
    return response.json()
  }

  export async function discover(input: string, signal?: AbortSignal): Promise<Preview> {
    const urls = candidateUrls(input)
    if (!urls.length) {
      throw new A2ACard.Error({
        zh: "请输入有效的 Agent Card URL 或域名",
        en: "Enter a valid Agent Card URL or domain",
      })
    }
    const errors: string[] = []
    for (const url of urls) {
      try {
        const json = await fetchJson(url, signal)
        return normalize(url, json)
      } catch (error) {
        if (error instanceof A2ACard.Error) throw error
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new A2ACard.Error({
      zh: `无法发现 Agent Card（${errors[0] ?? "unknown"}）`,
      en: `Could not discover Agent Card (${errors[0] ?? "unknown"})`,
    })
  }

  export function toBinding(preview: Preview): A2ABinding.Info {
    const { capabilities: _capabilities, ...binding } = preview
    return A2ABinding.Info.parse(binding)
  }
}
