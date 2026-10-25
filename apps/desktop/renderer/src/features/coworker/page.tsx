import type { CollaborationGroupSummary, Coworker } from "@merakcode/sdk/client"
import MessageSquare from "lucide-solid/icons/message-square"
import Settings2 from "lucide-solid/icons/settings-2"
import Users from "lucide-solid/icons/users"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch, untrack } from "solid-js"
import { Navigate, useNavigate, useParams } from "@solidjs/router"
import { t } from "../../i18n"
import { decodeDir, coworkerChatPath, coworkerPath, sameDir, sessionPath } from "../../lib/route"
import { call, client } from "../../state/client"
import { choose } from "../../state/models"
import { openFolder } from "../../state/store"
import { ui } from "../../state/ui"
import { Frame } from "../shell/frame"
import { PrimaryNav, Sidebar } from "../shell/sidebar"
import { toast } from "../../ui/toast"
import { Conversation } from "../conversation/page"
import { AgentAvatar } from "./avatar"
import { AgentActivity } from "./activity"
import { Contacts } from "./contacts"
import { AgentSettings } from "./settings"
import { startCoworkerChat } from "./start-chat"
import { WorldEditor } from "./world"

type AgentTab = "world" | "activity" | "groups" | "bindings"

function AgentHeader(props: { info?: Coworker; coworkerID: string }) {
  return (
    <span class="agent-title">
      <AgentAvatar id={props.coworkerID} name={props.info?.name ?? props.coworkerID} />
      <span class="agent-title-copy">
        <span class="title ellipsis">{props.info?.name ?? props.coworkerID}</span>
        <span class="agent-title-meta">
          <span class="status-dot" data-active="" />
          {t("coworker.ready")}
        </span>
      </span>
    </span>
  )
}

function AgentTabs(props: {
  directory: string
  coworkerID: string
  runtime?: "local" | "a2a"
  active: "chat" | "world" | "activity" | "groups"
  onChat: () => void
}) {
  const navigate = useNavigate()
  return (
    <nav class="agent-tabs" aria-label={t("coworker.agent")}>
      <button class="agent-tab" aria-current={props.active === "chat" ? "page" : undefined} onClick={props.onChat}>
        {t("coworker.privateChat")}
      </button>
      <Show when={props.runtime !== "a2a"}>
        <button
          class="agent-tab"
          aria-current={props.active === "world" ? "page" : undefined}
          onClick={() => navigate(coworkerPath(props.directory, props.coworkerID, "world"))}
        >
          {t("coworker.world")}
        </button>
      </Show>
      <button
        class="agent-tab"
        aria-current={props.active === "activity" ? "page" : undefined}
        onClick={() => navigate(coworkerPath(props.directory, props.coworkerID, "activity"))}
      >
        {t("coworker.activity")}
      </button>
      <button
        class="agent-tab"
        aria-current={props.active === "groups" ? "page" : undefined}
        onClick={() => navigate(coworkerPath(props.directory, props.coworkerID, "groups"))}
      >
        {t("coworker.groups")}
      </button>
    </nav>
  )
}

function AgentGroups(props: { directory: string; coworkerID: string }) {
  const navigate = useNavigate()
  const [groups] = createResource(
    () => props.directory,
    (directory) => call(client(directory).collaboration.list()),
  )
  const mine = createMemo(() =>
    (groups() ?? []).filter(
      (group: CollaborationGroupSummary) =>
        group.kind !== "topic" &&
        sameDir(group.directory, props.directory) &&
        group.seats.some((seat) => seat.coworkerID === props.coworkerID),
    ),
  )
  return (
    <section class="agent-groups">
      <header class="agent-section-head">
        <div>
          <h2>{t("coworker.groups")}</h2>
          <p>{t("coworker.groups.lead")}</p>
        </div>
      </header>
      <For each={mine()} fallback={<div class="agent-empty">{t("coworker.groups.empty")}</div>}>
        {(group) => (
          <button class="agent-group-row" onClick={() => navigate(sessionPath(props.directory, group.sessionID))}>
            <span class="agent-group-icon">
              <Users class="icon" />
            </span>
            <span class="agent-group-copy">
              <strong>{group.title}</strong>
              <small>{group.seats.map((seat) => seat.name).join("、")}</small>
            </span>
            <MessageSquare class="icon icon-sm" />
          </button>
        )}
      </For>
    </section>
  )
}

function CoworkerWorkspacePane(props: { directory: string; coworkerID: string; tab?: AgentTab }) {
  const navigate = useNavigate()
  const [settings, setSettings] = createSignal(false)
  const [info, { refetch }] = createResource(
    () => ({ directory: props.directory, id: props.coworkerID }),
    ({ directory, id }) => call(client(directory).coworker.get({ coworkerID: id })),
  )
  const tab = () => props.tab ?? "world"
  const chat = async () => {
    try {
      const session = await startCoworkerChat(props.directory, props.coworkerID, info()?.name)
      navigate(coworkerChatPath(props.directory, props.coworkerID, session.id))
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }
  createEffect(() => {
    if (props.tab === "bindings") setSettings(true)
  })

  return (
    <>
      <Frame
        title={<AgentHeader info={info()} coworkerID={props.coworkerID} />}
        directory={props.directory}
        folder={props.directory}
        actions={
          <button class="button secondary sm" onClick={() => setSettings(true)}>
            <Settings2 class="icon icon-sm" />
            {t("sidebar.settings")}
          </button>
        }
      >
        <div class="agent-workspace">
          <div class="agent-servicebar">
            <span>{info()?.duty || t("coworker.contacts.none")}</span>
            <span class="agent-service-status">
              <span class="status-dot" data-active="" />
              {t("coworker.ready")}
            </span>
          </div>
          <AgentTabs
            directory={props.directory}
            coworkerID={props.coworkerID}
            runtime={info()?.runtime}
            active={props.tab === "groups" ? "groups" : props.tab === "activity" ? "activity" : "world"}
            onChat={() => void chat()}
          />
          <Switch>
            <Match when={tab() === "groups"}>
              <AgentGroups directory={props.directory} coworkerID={props.coworkerID} />
            </Match>
            <Match when={tab() === "activity"}>
              <AgentActivity directory={props.directory} coworkerID={props.coworkerID} />
            </Match>
            <Match when={info()?.runtime !== "a2a"}>
              <WorldEditor directory={props.directory} coworkerID={props.coworkerID} />
            </Match>
            <Match when={info()?.runtime === "a2a"}>
              <div class="agent-empty">{t("coworker.a2a.remote")}</div>
            </Match>
          </Switch>
        </div>
      </Frame>
      <Show when={settings()}>
        <AgentSettings
          directory={props.directory}
          coworkerID={props.coworkerID}
          initial={info()}
          onClose={() => setSettings(false)}
          onSaved={() => {
            void refetch()
            if (props.tab === "bindings") navigate(coworkerPath(props.directory, props.coworkerID, "world"))
          }}
        />
      </Show>
    </>
  )
}

function CoworkerShell(props: { directory: string; coworkerID?: string; tab?: AgentTab; sessionID?: string }) {
  const navigate = useNavigate()
  const [settings, setSettings] = createSignal(false)
  const [info, { refetch }] = createResource(
    () => (props.coworkerID ? { directory: props.directory, id: props.coworkerID } : undefined),
    (key) => (key ? call(client(key.directory).coworker.get({ coworkerID: key.id })) : undefined),
  )
  const chat = async () => {
    if (!props.coworkerID) return
    try {
      const session = await startCoworkerChat(props.directory, props.coworkerID, info()?.name)
      navigate(coworkerChatPath(props.directory, props.coworkerID, session.id))
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }
  createEffect(() => {
    const value = info()
    const sessionID = props.sessionID
    if (!value || !sessionID) return
    const model = value.bindings.model
    const at = model?.indexOf("/") ?? -1
    choose(sessionID, props.directory, {
      model: model && at > 0 ? { providerID: model.slice(0, at), modelID: model.slice(at + 1) } : undefined,
      variant: undefined,
    })
  })

  return (
    <div class="app">
      <Show when={!ui.maximized}>
        <Show
          when={props.coworkerID}
          fallback={
            <nav class="sidebar sidebar-contacts" aria-label={t("coworker.nav")}>
              <PrimaryNav directory={props.directory} active="coworker" />
            </nav>
          }
        >
          <Sidebar directory={props.directory} current={props.sessionID} />
        </Show>
      </Show>
      <Show
        when={props.coworkerID}
        fallback={
          <Frame
            title={<span class="title">{t("coworker.nav")}</span>}
            directory={props.directory}
            folder={props.directory}
            tools={false}
          >
            <Contacts directory={props.directory} />
          </Frame>
        }
      >
        {(id) => (
          <Show
            when={props.sessionID}
            fallback={
              <Show
                when={props.tab === "bindings"}
                fallback={<CoworkerWorkspacePane directory={props.directory} coworkerID={id()} tab={props.tab} />}
              >
                <CoworkerWorkspacePane directory={props.directory} coworkerID={id()} tab="bindings" />
              </Show>
            }
          >
            {(sessionID) => (
              <Conversation
                id={sessionID()}
                directory={props.directory}
                agent={info()}
                coworkerID={id()}
                onOpenSettings={() => setSettings(true)}
                onOpenWorld={() => navigate(coworkerPath(props.directory, id(), "world"))}
                onOpenActivity={() => navigate(coworkerPath(props.directory, id(), "activity"))}
                onOpenGroups={() => navigate(coworkerPath(props.directory, id(), "groups"))}
                onOpenChat={() => void chat()}
              />
            )}
          </Show>
        )}
      </Show>
      <Show when={props.coworkerID && settings() ? props.coworkerID : undefined}>
        {(id) => (
          <AgentSettings
            directory={props.directory}
            coworkerID={id()}
            initial={info()}
            onClose={() => setSettings(false)}
            onSaved={() => void refetch()}
          />
        )}
      </Show>
    </div>
  )
}

/** Routed all-chat workspace */
export function CoworkerWorkspace() {
  const params = useParams()
  const directory = createMemo(() => decodeDir(params.dir ?? ""))
  createEffect(() => {
    const dir = directory()
    if (!dir) return
    untrack(() => {
      void openFolder(dir)
    })
  })
  const tab = createMemo((): AgentTab | undefined => {
    if (params.tab === "bindings") return "bindings"
    if (params.tab === "groups") return "groups"
    if (params.tab === "activity") return "activity"
    if (params.tab === "world") return "world"
    return undefined
  })
  return (
    <Show when={directory()} fallback={<Navigate href="/" />}>
      {(dir) => (
        <CoworkerShell directory={dir()} coworkerID={params.coworkerID} tab={tab()} sessionID={params.sessionID} />
      )}
    </Show>
  )
}
