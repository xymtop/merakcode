import type { Session } from "@merakcode/sdk/client"

const COWORKER_KIND = "coworker"

export function isCoworkerSession(session: Session | undefined) {
  return session?.metadata?.kind === COWORKER_KIND
}

export function coworkerIdOf(session: Session | undefined) {
  const id = session?.metadata?.coworkerId
  return typeof id === "string" && id.length > 0 ? id : undefined
}

export function coworkerMetadata(coworkerId: string) {
  return { kind: COWORKER_KIND, coworkerId }
}
