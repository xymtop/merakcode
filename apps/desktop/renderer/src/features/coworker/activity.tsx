import type { AgentActivity as AgentActivityEntry } from "@merakcode/sdk/client"
import ActivityIcon from "lucide-solid/icons/activity"
import Inbox from "lucide-solid/icons/inbox"
import Send from "lucide-solid/icons/send"
import Sparkles from "lucide-solid/icons/sparkles"
import { createResource, For, onCleanup, onMount, Show } from "solid-js"
import { ago, locale, t } from "../../i18n"
import { call, client } from "../../state/client"
import { listen, session } from "../../state/store"

function directionLabel(direction: AgentActivityEntry["direction"]) {
  return t(`coworker.activity.${direction}`)
}

function directionIcon(direction: AgentActivityEntry["direction"]) {
  if (direction === "received") return Inbox
  if (direction === "sent") return Send
  return Sparkles
}

function dateKey(time: number) {
  const date = new Date(time)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dateLabel(time: number) {
  const date = new Date(time)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (dateKey(time) === dateKey(today.getTime())) return t("coworker.activity.today")
  if (dateKey(time) === dateKey(yesterday.getTime())) return t("coworker.activity.yesterday")
  return new Intl.DateTimeFormat(locale() === "zh" ? "zh-CN" : "en", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date)
}

function group(entries: readonly AgentActivityEntry[]) {
  const groups: { key: string; label: string; entries: AgentActivityEntry[] }[] = []
  for (const entry of entries) {
    const key = dateKey(entry.createdAt)
    const current = groups.at(-1)
    if (current?.key === key) current.entries.push(entry)
    else groups.push({ key, label: dateLabel(entry.createdAt), entries: [entry] })
  }
  return groups
}

export function AgentActivity(props: { directory: string; coworkerID: string }) {
  const [activity, { refetch }] = createResource(
    () => ({ directory: props.directory, coworkerID: props.coworkerID }),
    ({ directory, coworkerID }) => call(client(directory).activity.list({ coworkerID, limit: 300 })),
  )
  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refreshSession = (sessionID: string) => {
      const current = session(sessionID)
      if (current?.metadata?.kind !== "coworker" || current.metadata.coworkerId !== props.coworkerID) return
      clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 140)
    }
    const off = listen((_directory, event) => {
      if (event.type === "activity.updated" && event.properties.coworkerID === props.coworkerID) void refetch()
      if (event.type === "message.updated") refreshSession(event.properties.sessionID)
      if (event.type === "message.part.updated") refreshSession(event.properties.part.sessionID)
      if (event.type === "message.part.removed") refreshSession(event.properties.sessionID)
    })
    onCleanup(() => {
      clearTimeout(timer)
      off()
    })
  })

  return (
    <section class="agent-activity">
      <header class="agent-section-head">
        <div>
          <h2>{t("coworker.activity")}</h2>
          <p>{t("coworker.activity.lead")}</p>
        </div>
        <span class="agent-activity-count">{t("coworker.activity.count", { count: activity()?.length ?? 0 })}</span>
      </header>
      <For each={group(activity() ?? [])} fallback={<ActivityEmpty loading={activity.loading} />}>
        {(day) => (
          <section class="agent-timeline-day">
            <h3>{day.label}</h3>
            <div class="agent-timeline">
              <For each={day.entries}>
                {(entry) => {
                  const Icon = directionIcon(entry.direction)
                  return (
                    <article class="agent-timeline-event" data-direction={entry.direction}>
                      <span class="agent-timeline-dot" aria-hidden="true">
                        <Icon class="icon icon-sm" />
                      </span>
                      <div class="agent-timeline-card">
                        <header>
                          <span class="agent-timeline-kind">{directionLabel(entry.direction)}</span>
                          <time dateTime={new Date(entry.createdAt).toISOString()}>{ago(entry.createdAt)}</time>
                        </header>
                        <strong>{entry.title}</strong>
                        <Show when={entry.detail}>
                          <p>{entry.detail}</p>
                        </Show>
                        <Show when={entry.resource?.title}>
                          <span class="agent-timeline-resource">{entry.resource!.title}</span>
                        </Show>
                      </div>
                    </article>
                  )
                }}
              </For>
            </div>
          </section>
        )}
      </For>
    </section>
  )
}

function ActivityEmpty(props: { loading: boolean }) {
  return (
    <div class="agent-activity-empty">
      <span>
        <ActivityIcon class="icon" />
      </span>
      <strong>{props.loading ? t("coworker.loading") : t("coworker.activity.empty")}</strong>
      <p>{t("coworker.activity.emptyLead")}</p>
    </div>
  )
}
