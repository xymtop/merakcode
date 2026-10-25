import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { Activity } from "../activity/activity"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionNotification } from "../session/notification"
import { SessionNotificationDelivery } from "../session/notification-delivery"
import { Storage } from "../storage/storage"
import { Text } from "../util/text"

export namespace Monitor {
  export const Severity = z.enum(["info", "warning", "error"]).meta({ ref: "MonitorSeverity" })
  export type Severity = z.infer<typeof Severity>

  export const Signal = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      coworkerID: z.string().optional(),
      title: z.string(),
      message: z.string(),
      severity: Severity,
      source: z.string(),
      data: z.unknown().optional(),
      dedupeKey: z.string().optional(),
      createdAt: z.number(),
    })
    .meta({ ref: "MonitorSignal" })
  export type Signal = z.infer<typeof Signal>

  export const SendInput = z
    .object({
      sessionID: z.string(),
      title: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(20_000),
      severity: Severity.optional(),
      source: z.string().trim().min(1).max(200).optional(),
      data: z.unknown().optional(),
      dedupeKey: z.string().trim().min(1).max(200).optional(),
    })
    .meta({ ref: "MonitorSendInput" })
  export type SendInput = z.input<typeof SendInput>

  export const Received = BusEvent.define(
    "monitor.received",
    z.object({
      signalID: z.string(),
      sessionID: z.string(),
      coworkerID: z.string().optional(),
    }),
  )

  export class Error extends globalThis.Error {
    constructor(readonly text: Text.Pair) {
      super(text.en)
    }
  }

  const capabilitySecret = randomBytes(32)
  const key = (sessionID: string, id: string) => ["monitor", sessionID, id]

  function capability(sessionID: string) {
    return createHmac("sha256", capabilitySecret).update(sessionID).digest("base64url")
  }

  export function authorize(sessionID: string, authorization: string | undefined) {
    if (!authorization?.startsWith("Bearer ")) return false
    const provided = Buffer.from(authorization.slice("Bearer ".length))
    const expected = Buffer.from(capability(sessionID))
    return provided.length === expected.length && timingSafeEqual(provided, expected)
  }

  export function environment(sessionID: string, server: URL, directory: string) {
    const endpoint = new URL(`/monitor/${encodeURIComponent(sessionID)}`, server)
    endpoint.searchParams.set("directory", directory)
    return {
      MERAKCODE_MONITOR_URL: endpoint.toString(),
      MERAKCODE_MONITOR_TOKEN: capability(sessionID),
    }
  }

  function stableID(sessionID: string, source: string, dedupeKey: string) {
    return `signal_${createHash("sha256").update(`${sessionID}\0${source}\0${dedupeKey}`).digest("hex").slice(0, 24)}`
  }

  function escape(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  function prompt(signal: Signal) {
    const serialized = signal.data === undefined ? undefined : JSON.stringify(signal.data, null, 2)
    if (serialized && serialized.length > 32_000)
      throw new Error({
        zh: "监测数据过大，data 序列化后不能超过 32KB",
        en: "Monitoring data is too large: serialized data must not exceed 32KB",
      })
    return [
      "<monitor-signal>",
      `<id>${escape(signal.id)}</id>`,
      `<title>${escape(signal.title)}</title>`,
      `<source>${escape(signal.source)}</source>`,
      `<severity>${signal.severity}</severity>`,
      `<message>${escape(signal.message)}</message>`,
      serialized ? `<data>\n${serialized}\n</data>` : "",
      "</monitor-signal>",
    ]
      .filter(Boolean)
      .join("\n")
  }

  async function coworkerID(sessionID: string) {
    const current = await Session.get(sessionID)
    if (!current)
      throw new Error({
        zh: "接收监测数据的会话不存在",
        en: "The session receiving this monitoring signal does not exist",
      })
    if (current.metadata?.kind !== "coworker" || typeof current.metadata.coworkerId !== "string") return
    return current.metadata.coworkerId
  }

  export async function send(input: SendInput, options: { dispatch?: boolean } = {}) {
    const parsed = SendInput.parse(input)
    const owner = await coworkerID(parsed.sessionID)
    const source = parsed.source ?? "external"
    const signal: Signal = {
      id: parsed.dedupeKey ? stableID(parsed.sessionID, source, parsed.dedupeKey) : `signal_${randomUUID()}`,
      sessionID: parsed.sessionID,
      coworkerID: owner,
      title: parsed.title,
      message: parsed.message,
      severity: parsed.severity ?? "info",
      source,
      data: parsed.data,
      dedupeKey: parsed.dedupeKey,
      createdAt: Date.now(),
    }
    const existing = await Storage.read<Signal>(key(signal.sessionID, signal.id)).catch(() => undefined)
    if (existing) return existing

    const text = prompt(signal)
    await Storage.write(key(signal.sessionID, signal.id), signal)
    await SessionNotification.enqueue({
      id: `monitor_${signal.id}`,
      sessionID: signal.sessionID,
      type: "monitor.signal",
      text,
      metadata: {
        signalID: signal.id,
        source: signal.source,
        severity: signal.severity,
        coworkerID: signal.coworkerID,
      },
    })
    if (options.dispatch !== false) SessionNotificationDelivery.request(signal.sessionID, { delay: 0 })
    if (signal.coworkerID) {
      await Activity.record({
        coworkerID: signal.coworkerID,
        direction: "received",
        kind: "monitor.signal",
        title: `收到监测数据：${signal.title}`,
        detail: signal.message,
        resource: { type: "monitor", id: signal.id, title: signal.title },
      })
    }
    if (Instance.has()) {
      await Bus.publish(Received, {
        signalID: signal.id,
        sessionID: signal.sessionID,
        coworkerID: signal.coworkerID,
      }).catch(() => undefined)
    }
    return signal
  }

  export async function get(sessionID: string, signalID: string) {
    return Storage.read<Signal>(key(sessionID, signalID)).catch(() => undefined)
  }

  export async function list(sessionID: string, limit = 100) {
    const values = (
      await Promise.all(
        (await Storage.list(["monitor", sessionID]))
          .map((item) => item.at(-1))
          .filter((id): id is string => !!id)
          .map((id) => get(sessionID, id)),
      )
    ).filter((signal): signal is Signal => !!signal)
    return values.toSorted((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }
}
