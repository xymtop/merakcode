import type { Coworker } from "@merakcode/sdk/client"
import BookUser from "lucide-solid/icons/book-user"
import MessageSquare from "lucide-solid/icons/message-square"
import Plus from "lucide-solid/icons/plus"
import Search from "lucide-solid/icons/search"
import Settings2 from "lucide-solid/icons/settings-2"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ago, t } from "../../i18n"
import { coworkerChatPath, coworkerPath } from "../../lib/route"
import { call, client } from "../../state/client"
import { coworkerSessionsOf, folderOf, statusOf } from "../../state/store"
import { toast } from "../../ui/toast"
import { AgentAvatar } from "./avatar"
import { CoworkerCreate } from "./create"
import { AgentSettings } from "./settings"
import { startCoworkerChat } from "./start-chat"

function activityLabel(status: ReturnType<typeof statusOf>) {
  if (status === "running") return t("status.running")
  if (status === "approval") return t("status.approval")
  if (status === "question") return t("status.question")
  return t("coworker.contacts.none")
}

export function Contacts(props: { directory: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [editing, setEditing] = createSignal<Coworker>()
  const [list, { refetch }] = createResource(
    () => props.directory,
    (directory) => call(client(directory).coworker.list()),
  )
  const filtered = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    if (!needle) return list() ?? []
    return (list() ?? []).filter((item) =>
      `${item.name} ${item.duty} ${item.bindings.skills.join(" ")} ${item.bindings.mcp.join(" ")} ${(item.a2a?.skills ?? []).map((skill) => skill.name).join(" ")}`
        .toLocaleLowerCase()
        .includes(needle),
    )
  })
  const latest = (id: string) => {
    const folder = folderOf(props.directory)
    return folder ? coworkerSessionsOf(folder, id)[0] : undefined
  }
  const chat = async (item: Coworker) => {
    try {
      const session = await startCoworkerChat(props.directory, item.id, item.name)
      navigate(coworkerChatPath(props.directory, item.id, session.id))
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  return (
    <div class="contacts-page scroll">
      <header class="contacts-page-head">
        <div class="contacts-heading">
          <span class="page-kicker">{t("coworker.contacts.kicker")}</span>
          <h1>{t("coworker.nav")}</h1>
          <p>{t("coworker.contacts.lead")}</p>
        </div>
        <div class="contacts-tools">
          <label class="page-search">
            <Search class="icon" />
            <input
              value={query()}
              aria-label={t("coworker.contacts.search")}
              placeholder={t("coworker.contacts.search")}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <button class="button primary" onClick={() => setCreating(true)}>
            <Plus class="icon" />
            {t("coworker.create.title")}
          </button>
        </div>
      </header>

      <div class="contacts-summary">
        <span>{t("coworker.contacts.summary", { count: filtered().length })}</span>
        <span>{t("coworker.contacts.current")}</span>
      </div>

      <section class="agent-table" aria-label={t("coworker.nav")}>
        <div class="agent-table-head" aria-hidden="true">
          <span>Agent</span>
          <span>{t("coworker.contacts.current")}</span>
          <span>{t("coworker.bindings.skills")}</span>
          <span>{t("coworker.bindings.mcp")}</span>
          <span />
        </div>
        <For
          each={filtered()}
          fallback={
            <div class="agent-table-empty">
              <BookUser class="icon" />
              <span>{list.loading ? t("coworker.loading") : t("coworker.contacts.empty")}</span>
            </div>
          }
        >
          {(item) => {
            const session = () => latest(item.id)
            return (
              <article class="agent-table-row">
                <button class="agent-profile" onClick={() => navigate(coworkerPath(props.directory, item.id))}>
                  <AgentAvatar id={item.id} name={item.name} size="lg" />
                  <span class="agent-profile-copy">
                    <strong>
                      {item.name}
                      <Show when={item.runtime === "a2a"}>
                        <span class="coworker-a2a-badge">{t("coworker.a2a.badge")}</span>
                      </Show>
                    </strong>
                    <span>{item.duty || t("coworker.contacts.none")}</span>
                  </span>
                </button>
                <button class="agent-work" disabled={!session()} onClick={() => session() && void chat(item)}>
                  <span>{session()?.title ?? t("coworker.contacts.none")}</span>
                  <small>
                    <span class="status-dot" data-active={statusOf(session()?.id ?? "") !== "idle" ? "" : undefined} />
                    {activityLabel(statusOf(session()?.id ?? ""))}
                    <Show when={session()?.time.updated}>{(time) => <span> · {ago(time())}</span>}</Show>
                  </small>
                </button>
                <div class="agent-capabilities">
                  <Show
                    when={item.runtime === "a2a"}
                    fallback={
                      <>
                        <span>{item.bindings.skills.length}</span>
                        <small>{item.bindings.skills.slice(0, 2).join(" · ") || "—"}</small>
                      </>
                    }
                  >
                    <span>{item.a2a?.skills.length ?? 0}</span>
                    <small>
                      {item.a2a?.skills
                        .slice(0, 2)
                        .map((skill) => skill.name)
                        .join(" · ") || t("coworker.a2a.badge")}
                    </small>
                  </Show>
                </div>
                <div class="agent-capabilities">
                  <Show
                    when={item.runtime === "a2a"}
                    fallback={
                      <>
                        <span>{item.bindings.mcp.length}</span>
                        <small>{item.bindings.mcp.slice(0, 2).join(" · ") || "—"}</small>
                      </>
                    }
                  >
                    <span>—</span>
                    <small>{t("coworker.a2a.remote")}</small>
                  </Show>
                </div>
                <div class="agent-actions">
                  <button class="button secondary sm" onClick={() => setEditing(item)}>
                    <Settings2 class="icon icon-sm" />
                    {t("sidebar.settings")}
                  </button>
                  <button class="button secondary sm" onClick={() => navigate(coworkerPath(props.directory, item.id))}>
                    <BookUser class="icon icon-sm" />
                    {t("coworker.contacts.profile")}
                  </button>
                  <button class="button primary sm" onClick={() => void chat(item)}>
                    <MessageSquare class="icon icon-sm" />
                    {t("coworker.chat")}
                  </button>
                </div>
              </article>
            )
          }}
        </For>
      </section>

      <CoworkerCreate
        directory={props.directory}
        open={creating()}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void refetch()
          navigate(coworkerPath(props.directory, id))
        }}
      />
      <Show when={editing()}>
        {(item) => (
          <AgentSettings
            directory={props.directory}
            coworkerID={item().id}
            initial={item()}
            onClose={() => setEditing(undefined)}
            onSaved={() => void refetch()}
          />
        )}
      </Show>
    </div>
  )
}
