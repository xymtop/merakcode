import type { Session } from "@merakcode/sdk/client"
import CircleHelp from "lucide-solid/icons/circle-question-mark"
import Ellipsis from "lucide-solid/icons/ellipsis"
import FolderOpen from "lucide-solid/icons/folder-open"
import GitBranch from "lucide-solid/icons/git-branch"
import LoaderCircle from "lucide-solid/icons/loader-circle"
import MessageSquare from "lucide-solid/icons/message-square"
import Plus from "lucide-solid/icons/plus"
import Users from "lucide-solid/icons/users"
import BookUser from "lucide-solid/icons/book-user"
import Search from "lucide-solid/icons/search"
import Settings from "lucide-solid/icons/settings"
import SquarePen from "lucide-solid/icons/square-pen"
import ArrowUpCircle from "lucide-solid/icons/circle-arrow-up"
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { A, useNavigate } from "@solidjs/router"
import { ago, t } from "../../i18n"
import { bridge } from "../../lib/bridge"
import { coworkerIdOf, isCoworkerSession } from "../../lib/coworker"
import { baseName, coworkerChatPath, coworkerPath, sameDir, sessionPath } from "../../lib/route"
import { call, client } from "../../state/client"
import {
  allSessionsOf,
  closeFolder,
  listen,
  loadMore,
  openFolder,
  state,
  statusOf,
  type Folder,
} from "../../state/store"
import { setUi, ui } from "../../state/ui"
import { updateState } from "../update/state"
import { Confirm } from "../../ui/dialog"
import { Menu } from "../../ui/menu"
import { toast } from "../../ui/toast"
import { Rename } from "./rename"
import { GroupCreate } from "../conversation/group-create"

/** Picks a folder and opens it as a project */
export async function pickFolder(navigate: (path: string) => void) {
  const picked = await bridge?.openDirectoryPicker({ title: t("sidebar.openProject") })
  const directory = Array.isArray(picked) ? picked[0] : picked
  if (!directory) return
  await openFolder(directory)
  navigate(sessionPath(directory))
}

function Status(props: { status: ReturnType<typeof statusOf> }) {
  return (
    <span class="status" data-state={props.status}>
      <Switch fallback={<span class="dot" />}>
        <Match when={props.status === "running"}>
          <LoaderCircle class="icon icon-sm spinner" />
        </Match>
        <Match when={props.status === "approval"}>
          <span class="dot warning" />
        </Match>
        <Match when={props.status === "question"}>
          <CircleHelp class="icon icon-sm" />
        </Match>
      </Switch>
    </span>
  )
}

function GroupNames(props: { sessionID: string; directory: string }) {
  const [names, setNames] = createSignal("")
  const load = () => {
    void call(client(props.directory).collaboration.get({ sessionID: props.sessionID, directory: props.directory }))
      .then((group) => setNames(group.seats.map((seat) => seat.name).join("、")))
      .catch(() => undefined)
  }
  onMount(() => {
    load()
    onCleanup(
      listen((_directory, event) => {
        if (event.type === "collaboration.updated" && event.properties.sessionID === props.sessionID) load()
      }),
    )
  })
  return (
    <Show when={names()}>
      <span class="ellipsis">{names()}</span>
    </Show>
  )
}

function tone(id: string) {
  const hash = [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) | 0, 0)
  return ["blue", "green", "purple", "orange"][Math.abs(hash) % 4]
}

function initials(title?: string) {
  return [...(title?.replace(/^[^\p{L}\p{N}]+/u, "").trim() ?? "")][0]?.toUpperCase() ?? ""
}

function Conversation(props: { session: Session; folder: Folder; current?: string }) {
  const navigate = useNavigate()
  const [deleting, setDeleting] = createSignal(false)
  const [renaming, setRenaming] = createSignal(false)
  const status = () => statusOf(props.session.id)
  /** A conversation running in a worktree shows its branch */
  const worktree = () =>
    props.folder.project?.vcs === "git" && !sameDir(props.session.directory, props.folder.directory)
  const label = () =>
    ({ running: t("status.running"), approval: t("status.approval"), question: t("status.question"), idle: "" })[
      status()
    ]
  const c = () => client(props.session.directory)
  const href = () => {
    const coworkerID = coworkerIdOf(props.session)
    if (isCoworkerSession(props.session) && coworkerID)
      return coworkerChatPath(props.folder.directory, coworkerID, props.session.id)
    return sessionPath(props.folder.directory, props.session.id)
  }
  const remove = async () => {
    setDeleting(false)
    await call(c().session.delete({ sessionID: props.session.id })).catch((error: Error) =>
      toast({ kind: "error", title: error.message, error }),
    )
    if (props.current === props.session.id) navigate(sessionPath(props.folder.directory))
  }
  return (
    <div class="conversation-row">
      <A href={href()} class="conversation" aria-current={props.current === props.session.id ? "page" : undefined}>
        <span
          class="conversation-avatar"
          data-group={props.session.metadata?.group === true ? "" : undefined}
          data-tone={tone(props.session.id)}
          aria-hidden="true"
        >
          <Show
            when={props.session.metadata?.group === true}
            fallback={
              <span class="conversation-initial">
                {initials(props.session.title) || <MessageSquare class="icon icon-sm" />}
              </span>
            }
          >
            <Users class="icon" />
          </Show>
          <Show when={status() !== "idle"}>
            <span class="conversation-presence">
              <Status status={status()} />
            </span>
          </Show>
        </span>
        <span class="body">
          <span class="title">
            {props.session.title || t("sidebar.untitled")}
            <Show when={props.session.metadata?.group === true}>
              <span class="chip group-chip">
                <Users class="icon icon-xs" />
                {t("sidebar.groupMark")}
              </span>
            </Show>
          </span>
          <span class="meta">
            <Show when={isCoworkerSession(props.session)}>
              <span class="agent-label">{t("coworker.agent")}</span>
            </Show>
            <Show when={label()}>
              <span class="state" data-state={status()}>
                {label()}
              </span>
            </Show>
            <Show when={worktree()}>
              <GitBranch class="icon icon-xs" />
              <span class="ellipsis">{state.branch[props.session.directory] ?? t("sidebar.worktree")}</span>
            </Show>
            <Show when={props.session.metadata?.group === true}>
              <GroupNames sessionID={props.session.id} directory={props.session.directory} />
            </Show>
          </span>
        </span>
        <span class="time">{ago(props.session.time.updated)}</span>
      </A>
      <Menu
        class="icon-button sm row-menu"
        label={t("sidebar.conversationMenu")}
        trigger={<Ellipsis class="icon icon-sm" />}
        items={[
          { label: t("sidebar.rename"), onSelect: () => setRenaming(true) },
          { label: t("sidebar.delete"), danger: true, onSelect: () => setDeleting(true) },
        ]}
      />
      <Rename session={props.session} open={renaming()} onClose={() => setRenaming(false)} />
      <Confirm
        open={deleting()}
        title={t("sidebar.deleteConfirm", { title: props.session.title })}
        description={t("sidebar.deleteDetail")}
        confirm={t("sidebar.delete")}
        cancel={t("common.cancel")}
        danger
        onResult={(ok) => (ok ? void remove() : setDeleting(false))}
      />
    </div>
  )
}

function Group(props: { folder: Folder; current?: string; route?: string; query?: string }) {
  const navigate = useNavigate()
  const name = () => baseName(props.folder.directory)
  const list = () => {
    const query = props.query?.trim().toLocaleLowerCase()
    return allSessionsOf(props.folder).filter(
      (session) => !query || (session.title || t("sidebar.untitled")).toLocaleLowerCase().includes(query),
    )
  }
  const remove = () => {
    const directory = props.folder.directory
    const openHere = props.route !== undefined && sameDir(props.route, directory)
    closeFolder(directory)
    if (!openHere) return
    const next = state.folders[0]
    navigate(next ? sessionPath(next.directory) : "/")
  }
  return (
    <section
      class="group"
      classList={{ current: !!props.route && sameDir(props.route, props.folder.directory) }}
      aria-label={name()}
    >
      <div class="group-title">
        <FolderOpen class="icon icon-sm" />
        <span class="ellipsis">{name()}</span>
        <span class="count">{list().length || ""}</span>
        <Menu
          class="icon-button sm row-menu"
          label={t("sidebar.projectMenu")}
          trigger={<Ellipsis class="icon icon-sm" />}
          items={[
            {
              label: t("sidebar.newIn", { name: name() }),
              icon: Plus,
              onSelect: () => navigate(sessionPath(props.folder.directory)),
            },
            "separator",
            { label: t("sidebar.removeProject"), onSelect: remove },
          ]}
        />
      </div>
      <For
        each={list()}
        fallback={
          <Show when={!!props.route && sameDir(props.route, props.folder.directory)}>
            <div class="group-empty subtle">{t("sidebar.empty")}</div>
          </Show>
        }
      >
        {(session) => <Conversation session={session} folder={props.folder} current={props.current} />}
      </For>
      <Show when={props.folder.more}>
        <button class="button ghost sm more" onClick={() => void loadMore(props.folder.directory)}>
          {t("sidebar.more")}
        </button>
      </Show>
    </section>
  )
}

function SessionList(props: { directory?: string; current?: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = createSignal("")
  const count = () => state.folders.reduce((total, folder) => total + allSessionsOf(folder).length, 0)
  const folders = () => {
    const needle = query().trim().toLocaleLowerCase()
    if (!needle) return state.folders
    return state.folders.filter(
      (folder) =>
        baseName(folder.directory).toLocaleLowerCase().includes(needle) ||
        allSessionsOf(folder).some((session) =>
          (session.title || t("sidebar.untitled")).toLocaleLowerCase().includes(needle),
        ),
    )
  }
  return (
    <div class="sessions-pane">
      <div class="sessions-head drag">
        <div class="sessions-heading">
          <div class="sessions-title">
            <span>{t("sidebar.messages")}</span>
            <span class="sessions-count">{count()}</span>
          </div>
          <span class="sessions-subtitle">{t("sidebar.summary", { count: count() })}</span>
        </div>
        <Menu
          class="icon-button drag-none"
          label={t("sidebar.new")}
          trigger={<SquarePen class="icon" />}
          items={[
            {
              label: t("sidebar.new"),
              icon: Plus,
              disabled: !props.directory,
              onSelect: () => props.directory && navigate(sessionPath(props.directory)),
            },
            {
              label: t("sidebar.group"),
              icon: Users,
              disabled: !props.directory,
              onSelect: () => setUi("newTeam", true),
            },
            {
              label: t("sidebar.openWorkspace"),
              icon: FolderOpen,
              onSelect: () => void pickFolder(navigate),
            },
          ]}
        />
      </div>
      <label class="session-search">
        <Search class="icon icon-sm" />
        <input
          value={query()}
          aria-label={t("sidebar.search")}
          placeholder={t("sidebar.searchConversations")}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div class="sessions-scroll scroll">
        <For each={folders()} fallback={<div class="sessions-empty subtle">{t("sidebar.empty")}</div>}>
          {(folder) => <Group folder={folder} current={props.current} route={props.directory} query={query()} />}
        </For>
      </div>
      <UpdateNotice />
    </div>
  )
}

/** A new version is out: one line above the settings button that opens About & updates */
function UpdateNotice() {
  const text = () => {
    const state = updateState()
    if (state.kind === "available") return t("update.notice.available", { version: state.version })
    if (state.kind === "ready") return t("update.notice.ready", { version: state.version })
    if (state.kind === "manual") return t("update.notice.manual", { version: state.version })
    return undefined
  }
  return (
    <Show when={text()}>
      {(label) => (
        <button class="nav-row update-notice" onClick={() => setUi("settings", "about")}>
          <ArrowUpCircle class="icon" />
          <span class="ellipsis">{label()}</span>
        </button>
      )}
    </Show>
  )
}

/** Primary navigation is shared by the chat and settings screens so the Feishu sidebar never changes identity */
export function PrimaryNav(props: {
  directory?: string
  current?: string
  active?: "messages" | "settings" | "coworker"
  close?: () => void
}) {
  const navigate = useNavigate()
  const directory = () => props.directory ?? state.folders[0]?.directory
  const leave = () => props.close?.()
  return (
    <div class="primary-nav">
      <div class="primary-brand drag" title={t("app.name")}>
        <img src="/logo.svg" alt="" />
        <span>{t("app.name")}</span>
      </div>
      <div class="primary-links">
        <button
          class="primary-link"
          aria-current={props.active === "messages" || props.active === undefined ? "page" : undefined}
          disabled={!directory()}
          onClick={() => {
            leave()
            if (directory()) navigate(sessionPath(directory()!, props.current))
          }}
        >
          <MessageSquare class="icon" />
          <span>{t("sidebar.messages")}</span>
        </button>
        <button
          class="primary-link"
          aria-current={props.active === "coworker" ? "page" : undefined}
          disabled={!directory()}
          onClick={() => {
            leave()
            if (directory()) navigate(coworkerPath(directory()!))
          }}
        >
          <BookUser class="icon" />
          <span>{t("coworker.nav")}</span>
        </button>
      </div>
      <span class="spacer" />
      <button
        class="primary-link primary-settings"
        aria-current={props.active === "settings" ? "page" : undefined}
        onClick={() => {
          if (props.active !== "settings") leave()
          setUi("settings", "general")
        }}
      >
        <Settings class="icon" />
        <span>{t("sidebar.settings")}</span>
      </button>
    </div>
  )
}

/** Chat shell: fixed navigation, conversation list, and the routed chat in the main area */
export function Sidebar(props: { directory?: string; current?: string }) {
  const navigate = useNavigate()
  const directory = () => props.directory ?? state.folders[0]?.directory
  return (
    <nav class="sidebar" aria-label={t("sidebar.label")}>
      <PrimaryNav directory={directory()} current={props.current} active="messages" />
      <SessionList directory={directory()} current={props.current} />
      <Show when={directory()}>
        {(dir) => (
          <GroupCreate
            directory={dir()}
            open={ui.newTeam}
            onClose={() => setUi("newTeam", false)}
            onCreated={(sessionID) => navigate(sessionPath(dir(), sessionID))}
          />
        )}
      </Show>
    </nav>
  )
}
