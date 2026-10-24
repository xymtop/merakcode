import type { Event } from "@merakcode/sdk/client"
import { produce } from "solid-js/store"
import { applyEvent } from "@merakcode/sdk/store"
import { coworkerMetadata } from "../../lib/coworker"
import { call, client } from "../../state/client"
import { coworkerSessionsOf, folderOf, setState } from "../../state/store"
import { choose } from "../../state/models"

/** Reuse the latest DM with this coworker, or create a new session tagged for all-chat. */
export async function startCoworkerChat(directory: string, coworkerID: string, title?: string) {
  const coworker = await call(client(directory).coworker.get({ coworkerID }))
  const applyBindings = (sessionID: string) => {
    const at = coworker.bindings.model?.indexOf("/") ?? -1
    choose(sessionID, directory, {
      model:
        at > 0
          ? {
              providerID: coworker.bindings.model!.slice(0, at),
              modelID: coworker.bindings.model!.slice(at + 1),
            }
          : undefined,
      variant: undefined,
    })
  }
  const folder = folderOf(directory)
  if (folder) {
    const existing = coworkerSessionsOf(folder, coworkerID)[0]
    if (existing) {
      applyBindings(existing.id)
      return existing
    }
  }

  const info = await call(
    client(directory).session.create({
      title: title ?? coworker.name,
      metadata: coworkerMetadata(coworkerID),
    }),
  )
  setState(
    "sessions",
    produce((draft) => applyEvent(draft, { type: "session.created", properties: { info } } as Event)),
  )

  applyBindings(info.id)

  return info
}
