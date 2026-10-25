import { randomUUID } from "node:crypto"
import { Text } from "../util/text"
import { A2AAuth } from "./auth"
import type { A2ABinding } from "./binding"

export namespace A2AClient {
  export class Error extends globalThis.Error {
    constructor(readonly text: Text.Pair) {
      super(text.en)
    }
  }

  export type SendResult = {
    text: string
    taskId?: string
    contextId?: string
  }

  type JsonRpc = {
    jsonrpc?: string
    id?: string | number
    result?: unknown
    error?: { code?: number; message?: string; data?: unknown }
  }

  function textFromParts(parts: unknown): string {
    if (!Array.isArray(parts)) return ""
    const chunks: string[] = []
    for (const part of parts) {
      if (!part || typeof part !== "object") continue
      const record = part as Record<string, unknown>
      if (typeof record.text === "string") chunks.push(record.text)
      else if (typeof record.data === "string") chunks.push(record.data)
    }
    return chunks.join("\n").trim()
  }

  function textFromMessage(message: unknown): string {
    if (!message || typeof message !== "object") return ""
    return textFromParts((message as { parts?: unknown }).parts)
  }

  function textFromTask(task: unknown): string {
    if (!task || typeof task !== "object") return ""
    const record = task as {
      status?: { message?: unknown; state?: string }
      artifacts?: Array<{ parts?: unknown; name?: string }>
      history?: unknown[]
    }
    const fromStatus = textFromMessage(record.status?.message)
    const fromArtifacts = (record.artifacts ?? [])
      .map((artifact) => textFromParts(artifact.parts))
      .filter(Boolean)
      .join("\n\n")
    const fromHistory = [...(record.history ?? [])]
      .reverse()
      .map(textFromMessage)
      .find((text) => text.length > 0)
    return [fromArtifacts, fromStatus, fromHistory].filter(Boolean).join("\n\n").trim()
  }

  function extract(result: unknown): SendResult {
    if (!result || typeof result !== "object") {
      throw new A2AClient.Error({ zh: "A2A 返回为空", en: "Empty A2A response" })
    }
    const record = result as { message?: unknown; task?: unknown }
    if (record.message) {
      const text = textFromMessage(record.message)
      if (!text) throw new A2AClient.Error({ zh: "A2A 消息无文本", en: "A2A message had no text" })
      return { text }
    }
    if (record.task) {
      const task = record.task as { id?: string; contextId?: string; status?: { state?: string } }
      const text = textFromTask(record.task)
      const state = String(task.status?.state ?? "")
      if (/FAILED|REJECTED|CANCELED|CANCELLED/i.test(state) && !text) {
        throw new A2AClient.Error({
          zh: `A2A 任务失败：${state}`,
          en: `A2A task failed: ${state}`,
        })
      }
      return {
        text: text || `(task ${state || "unknown"})`,
        taskId: typeof task.id === "string" ? task.id : undefined,
        contextId: typeof task.contextId === "string" ? task.contextId : undefined,
      }
    }
    // Some servers return the Task or Message at the top level
    if ("status" in record || "artifacts" in record) {
      const task = record as { id?: string; contextId?: string }
      return {
        text: textFromTask(record) || "(empty task)",
        taskId: typeof task.id === "string" ? task.id : undefined,
        contextId: typeof task.contextId === "string" ? task.contextId : undefined,
      }
    }
    if ("parts" in record) {
      const text = textFromMessage(record)
      if (text) return { text }
    }
    throw new A2AClient.Error({ zh: "无法解析 A2A 响应", en: "Could not parse A2A response" })
  }

  async function rpc(input: {
    rpcUrl: string
    method: string
    params: Record<string, unknown>
    coworkerID?: string
    protocolVersion?: string
    signal?: AbortSignal
  }) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    }
    if (input.protocolVersion) headers["A2A-Version"] = input.protocolVersion
    if (input.coworkerID) {
      const token = await A2AAuth.bearer(input.coworkerID)
      if (token) headers.Authorization = `Bearer ${token}`
    }
    const id = randomUUID()
    const response = await fetch(input.rpcUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: input.method,
        params: input.params,
      }),
      signal: input.signal,
    })
    const body = (await response.json().catch(() => undefined)) as JsonRpc | undefined
    if (!response.ok) {
      const message = body?.error?.message ?? `HTTP ${response.status}`
      throw new A2AClient.Error({ zh: `A2A 请求失败：${message}`, en: `A2A request failed: ${message}` })
    }
    if (body?.error) {
      const message = body.error.message ?? `code ${body.error.code}`
      throw new A2AClient.Error({ zh: `A2A 错误：${message}`, en: `A2A error: ${message}` })
    }
    return body?.result
  }

  export async function sendMessage(input: {
    binding: A2ABinding.Info
    coworkerID: string
    text: string
    contextId?: string
    signal?: AbortSignal
  }): Promise<SendResult> {
    const message: Record<string, unknown> = {
      role: "ROLE_USER",
      messageId: randomUUID(),
      parts: [{ kind: "text", text: input.text }],
    }
    if (input.contextId) message.contextId = input.contextId
    const params = {
      message,
      configuration: {
        acceptedOutputModes: ["text/plain", "text/markdown"],
      },
    }
    // Prefer current PascalCase; fall back to legacy slash form once.
    try {
      const result = await rpc({
        rpcUrl: input.binding.rpcUrl,
        method: "SendMessage",
        params,
        coworkerID: input.coworkerID,
        protocolVersion: input.binding.protocolVersion,
        signal: input.signal,
      })
      return extract(result)
    } catch (error) {
      if (input.signal?.aborted) throw error
      const result = await rpc({
        rpcUrl: input.binding.rpcUrl,
        method: "message/send",
        params,
        coworkerID: input.coworkerID,
        protocolVersion: input.binding.protocolVersion,
        signal: input.signal,
      })
      return extract(result)
    }
  }

  export async function cancelTask(input: {
    binding: A2ABinding.Info
    coworkerID: string
    taskId: string
    signal?: AbortSignal
  }) {
    try {
      await rpc({
        rpcUrl: input.binding.rpcUrl,
        method: "CancelTask",
        params: { id: input.taskId },
        coworkerID: input.coworkerID,
        protocolVersion: input.binding.protocolVersion,
        signal: input.signal,
      })
    } catch {
      await rpc({
        rpcUrl: input.binding.rpcUrl,
        method: "tasks/cancel",
        params: { id: input.taskId },
        coworkerID: input.coworkerID,
        protocolVersion: input.binding.protocolVersion,
        signal: input.signal,
      }).catch(() => undefined)
    }
  }
}
