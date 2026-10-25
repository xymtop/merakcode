import { Identifier } from "@merakcode/util/id"
import { NamedError } from "@merakcode/util/error"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { Message } from "../session/message"
import { Coworker } from "../coworker/coworker"
import { Text } from "../util/text"
import { A2AClient } from "./client"
import { A2AAuth } from "./auth"

export namespace A2ASession {
  const CONTEXT_KEY = "a2aContextId"

  function coworkerIdOf(session: Session.Info) {
    const id = session.metadata?.coworkerId
    return typeof id === "string" && id.length > 0 ? id : undefined
  }

  export async function coworkerForSession(sessionID: string) {
    const session = await Session.get(sessionID).catch(() => undefined)
    if (!session) return undefined
    const coworkerID = coworkerIdOf(session)
    if (!coworkerID) return undefined
    const coworker = await Coworker.get(coworkerID)
    if (!coworker || coworker.runtime !== "a2a") return undefined
    return coworker
  }

  export async function isA2ASession(sessionID: string) {
    return !!(await coworkerForSession(sessionID))
  }

  function userText(parts: Message.Part[]) {
    return parts
      .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
      .join("\n")
      .trim()
  }

  async function writeAssistant(input: {
    sessionID: string
    userID: string
    coworkerID: string
    text: string
    error?: Message.AssistantInfo["error"]
  }) {
    const now = Date.now()
    const info = (await Session.updateInfo({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.userID,
      sessionID: input.sessionID,
      mode: input.coworkerID,
      agent: input.coworkerID,
      path: { cwd: Instance.directory, root: Instance.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "a2a",
      providerID: "a2a",
      time: { created: now, completed: now },
      finish: "stop",
      ...(input.error ? { error: input.error } : {}),
    })) as Message.AssistantInfo
    const part = await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: info.id,
      sessionID: info.sessionID,
      type: "text",
      text: input.text,
    })
    return { info, parts: [part] }
  }

  /** Run one A2A turn for an already-persisted user message; skips the local LLM loop. */
  export async function reply(input: {
    sessionID: string
    user: Message.UserInfo
    parts: Message.Part[]
    abort: AbortSignal
  }): Promise<Message.FullMsg> {
    const session = await Session.get(input.sessionID)
    if (!session) throw new Error(`Session not found: ${input.sessionID}`)
    const coworker = await coworkerForSession(input.sessionID)
    if (!coworker?.a2a) throw new Error("Session is not bound to an A2A coworker")
    const coworkerID = coworker.id

    if (coworker.a2a.authKind !== "none") {
      const status = await A2AAuth.status(coworkerID)
      if (!status.configured) {
        return writeAssistant({
          sessionID: input.sessionID,
          userID: input.user.id,
          coworkerID,
          text: await Text.pick({
            zh: "请先为该 A2A 智能体配置鉴权",
            en: "Configure authentication for this A2A agent first",
          }),
        })
      }
    }

    const text = userText(input.parts)
    if (!text) {
      return writeAssistant({
        sessionID: input.sessionID,
        userID: input.user.id,
        coworkerID,
        text: await Text.pick({
          zh: "A2A 智能体只支持文本消息",
          en: "A2A agents only support text messages",
        }),
      })
    }

    const contextId =
      typeof session.metadata?.[CONTEXT_KEY] === "string" ? (session.metadata[CONTEXT_KEY] as string) : undefined

    let taskId: string | undefined
    const onAbort = () => {
      if (!taskId || !coworker.a2a) return
      void A2AClient.cancelTask({
        binding: coworker.a2a,
        coworkerID,
        taskId,
      })
    }
    input.abort.addEventListener("abort", onAbort, { once: true })

    try {
      const result = await A2AClient.sendMessage({
        binding: coworker.a2a,
        coworkerID,
        text,
        contextId,
        signal: input.abort,
      })
      taskId = result.taskId
      if (result.contextId && result.contextId !== contextId) {
        await Session.update(session.id, (draft) => {
          draft.metadata = { ...(draft.metadata ?? {}), [CONTEXT_KEY]: result.contextId }
        })
      }
      return writeAssistant({
        sessionID: input.sessionID,
        userID: input.user.id,
        coworkerID,
        text: result.text,
      })
    } catch (error) {
      if (input.abort.aborted) throw error
      const message =
        error instanceof A2AClient.Error
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error)
      return writeAssistant({
        sessionID: input.sessionID,
        userID: input.user.id,
        coworkerID,
        text: message,
        error: new NamedError.Unknown({ message }).toObject() as Message.AssistantInfo["error"],
      })
    } finally {
      input.abort.removeEventListener("abort", onAbort)
    }
  }
}
