import type { Coworker, Task as TaskInfo } from "@merakcode/sdk/client"
import ArrowUp from "lucide-solid/icons/arrow-up"
import Check from "lucide-solid/icons/check"
import Circle from "lucide-solid/icons/circle"
import CircleDotDashed from "lucide-solid/icons/circle-dot-dashed"
import ListTodo from "lucide-solid/icons/list-todo"
import Plus from "lucide-solid/icons/plus"
import Search from "lucide-solid/icons/search"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js"
import { Navigate, useNavigate, useParams } from "@solidjs/router"
import { ago, t } from "../../i18n"
import { decodeDir, taskPath } from "../../lib/route"
import { call, client } from "../../state/client"
import { listen, openFolder } from "../../state/store"
import { AgentAvatar } from "../coworker/avatar"
import { Frame } from "../shell/frame"
import { PrimaryNav } from "../shell/sidebar"
import { Select } from "../../ui/select"
import { toast } from "../../ui/toast"
import { TaskCreate } from "./create"

type Filter = "all" | TaskInfo["status"]
type Status = TaskInfo["status"]

const statuses: Status[] = ["todo", "doing", "done"]

function statusIcon(status: Status) {
  if (status === "done") return Check
  if (status === "doing") return CircleDotDashed
  return Circle
}

function priorityLabel(priority: TaskInfo["priority"]) {
  return t(`task.priority.${priority}`)
}

function statusLabel(status: Status) {
  return t(`task.status.${status}`)
}

function TaskList(props: {
  current?: string
  tasks: readonly TaskInfo[]
  filter: Filter
  query: string
  onFilter: (filter: Filter) => void
  onQuery: (query: string) => void
  onCreate: () => void
  onSelect: (id: string) => void
}) {
  const counts = createMemo(() => ({
    all: props.tasks.length,
    todo: props.tasks.filter((task) => task.status === "todo").length,
    doing: props.tasks.filter((task) => task.status === "doing").length,
    done: props.tasks.filter((task) => task.status === "done").length,
  }))
  const visible = createMemo(() => {
    const needle = props.query.trim().toLocaleLowerCase()
    return props.tasks.filter(
      (task) =>
        (props.filter === "all" || task.status === props.filter) &&
        (!needle ||
          `${task.title} ${task.description} ${task.assignee?.name ?? ""}`.toLocaleLowerCase().includes(needle)),
    )
  })

  return (
    <aside class="task-list" aria-label={t("task.nav")}>
      <header class="task-list-head">
        <div>
          <span class="page-kicker">{t("task.kicker")}</span>
          <h1>{t("task.title")}</h1>
          <p>{t("task.lead")}</p>
        </div>
        <button class="icon-button solid" aria-label={t("task.new")} title={t("task.new")} onClick={props.onCreate}>
          <Plus class="icon" />
        </button>
      </header>
      <label class="task-search">
        <Search class="icon icon-sm" />
        <input
          value={props.query}
          aria-label={t("task.search")}
          placeholder={t("task.search")}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
        />
      </label>
      <div class="task-filters" role="tablist" aria-label={t("task.filters")}>
        <For each={["all", ...statuses] as Filter[]}>
          {(filter) => (
            <button role="tab" aria-selected={props.filter === filter} onClick={() => props.onFilter(filter)}>
              <span>{filter === "all" ? t("task.filter.all") : statusLabel(filter)}</span>
              <small>{counts()[filter]}</small>
            </button>
          )}
        </For>
      </div>
      <div class="task-list-scroll scroll">
        <For
          each={visible()}
          fallback={
            <div class="task-list-empty">
              <ListTodo class="icon" />
              <strong>{props.query || props.filter !== "all" ? t("task.noMatch") : t("task.empty")}</strong>
              <span>{t("task.emptyLead")}</span>
            </div>
          }
        >
          {(task) => {
            const Icon = statusIcon(task.status)
            return (
              <button
                class="task-card"
                aria-current={props.current === task.id ? "page" : undefined}
                onClick={() => props.onSelect(task.id)}
              >
                <span class="task-card-check" data-status={task.status}>
                  <Icon class="icon icon-sm" />
                </span>
                <span class="task-card-copy">
                  <strong>{task.title}</strong>
                  <Show when={task.description}>
                    <span class="task-card-desc">{task.description}</span>
                  </Show>
                  <span class="task-card-meta">
                    <span class="task-priority" data-priority={task.priority}>
                      {priorityLabel(task.priority)}
                    </span>
                    <Show when={task.assignee}>{(assignee) => <span>{assignee().name}</span>}</Show>
                    <time>{ago(task.updatedAt)}</time>
                  </span>
                </span>
              </button>
            )
          }}
        </For>
      </div>
    </aside>
  )
}

function TaskDetail(props: {
  directory: string
  task: TaskInfo
  coworkers: readonly Coworker[]
  busy: boolean
  onUpdate: (patch: { status?: Status; priority?: TaskInfo["priority"]; assigneeID?: string | null }) => Promise<void>
  onComment: (content: string) => Promise<void>
}) {
  const [comment, setComment] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const submit = async () => {
    const content = comment().trim()
    if (!content || sending()) return
    setSending(true)
    try {
      await props.onComment(content)
      setComment("")
    } finally {
      setSending(false)
    }
  }
  return (
    <section class="task-detail">
      <div class="task-detail-scroll scroll">
        <article class="task-detail-card">
          <header class="task-detail-head">
            <div class="task-detail-title">
              <span class="task-detail-state" data-status={props.task.status}>
                {statusLabel(props.task.status)}
              </span>
              <h2>{props.task.title}</h2>
              <p>{t("task.updatedAt", { time: ago(props.task.updatedAt) })}</p>
            </div>
            <div class="task-detail-controls">
              <Select
                class="chip select-field"
                label={t("task.status")}
                value={props.task.status}
                options={statuses.map((status) => ({ value: status, label: statusLabel(status) }))}
                onChange={(status) => void props.onUpdate({ status })}
                disabled={props.busy}
              />
              <Select
                class="chip select-field"
                label={t("task.priority")}
                value={props.task.priority}
                options={[
                  { value: "high", label: t("task.priority.high") },
                  { value: "medium", label: t("task.priority.medium") },
                  { value: "low", label: t("task.priority.low") },
                ]}
                onChange={(priority) => void props.onUpdate({ priority })}
                disabled={props.busy}
              />
              <Select
                class="chip select-field"
                label={t("task.assignee")}
                value={props.task.assignee?.coworkerID ?? "none"}
                options={[
                  { value: "none", label: t("task.assignee.none") },
                  ...props.coworkers.map((item) => ({
                    value: item.id,
                    label: item.name,
                    description: item.duty,
                  })),
                ]}
                onChange={(assigneeID) =>
                  void props.onUpdate({ assigneeID: assigneeID === "none" ? null : assigneeID })
                }
                disabled={props.busy}
              />
            </div>
          </header>

          <div class="task-detail-body">
            <Show when={props.task.description} fallback={<p class="task-detail-none">{t("task.noDescription")}</p>}>
              <p>{props.task.description}</p>
            </Show>
          </div>

          <div class="task-detail-meta">
            <span>
              <small>{t("task.creator")}</small>
              <strong>{props.task.creator.type === "user" ? t("topic.user") : props.task.creator.name}</strong>
            </span>
            <span>
              <small>{t("task.assignee")}</small>
              <Show when={props.task.assignee} fallback={<strong class="subtle">{t("task.assignee.none")}</strong>}>
                {(assignee) => (
                  <strong class="task-assignee">
                    <AgentAvatar id={assignee().coworkerID} name={assignee().name} />
                    {assignee().name}
                  </strong>
                )}
              </Show>
            </span>
            <span>
              <small>{t("task.createdAt")}</small>
              <strong>{ago(props.task.createdAt)}</strong>
            </span>
          </div>
        </article>

        <section class="task-comments">
          <header>
            <h3>{t("task.comments", { count: props.task.comments.length })}</h3>
            <span>{t("task.commentsLead")}</span>
          </header>
          <For each={props.task.comments} fallback={<div class="task-comments-empty">{t("task.noComments")}</div>}>
            {(item) => (
              <article class="task-comment">
                <Show when={item.author.type === "agent"} fallback={<span class="task-user-avatar">你</span>}>
                  <AgentAvatar id={item.author.id} name={item.author.name} />
                </Show>
                <div>
                  <header>
                    <strong>{item.author.type === "user" ? t("topic.user") : item.author.name}</strong>
                    <time>{ago(item.createdAt)}</time>
                  </header>
                  <p>{item.content}</p>
                </div>
              </article>
            )}
          </For>
        </section>
      </div>
      <div class="task-compose-wrap">
        <div class="task-composer">
          <textarea
            class="task-composer-input selectable"
            rows={2}
            value={comment()}
            placeholder={t("task.commentPlaceholder")}
            onInput={(event) => setComment(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <div class="task-composer-foot">
            <span>{t("task.commentHint")}</span>
            <button
              class="icon-button solid"
              aria-label={t("task.comment")}
              disabled={!comment().trim() || sending()}
              onClick={() => void submit()}
            >
              <ArrowUp class="icon" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Routed todo application: list and detail share the same task service as agents and MCP. */
export function TaskWorkspace() {
  const params = useParams()
  const navigate = useNavigate()
  const directory = createMemo(() => decodeDir(params.dir ?? ""))
  const [filter, setFilter] = createSignal<Filter>("all")
  const [query, setQuery] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [tasks, { refetch }] = createResource(directory, (value) => call(client(value).task.list()))
  const [coworkers] = createResource(directory, (value) => call(client(value).coworker.list()))
  const [task, { refetch: refetchTask }] = createResource(
    () => (params.id ? { directory: directory(), id: params.id } : undefined),
    (key) => (key?.directory ? call(client(key.directory).task.get({ taskID: key.id })) : undefined),
  )
  const refresh = () => Promise.all([refetch(), refetchTask()])

  createEffect(() => {
    const dir = directory()
    if (!dir) return
    void openFolder(dir)
  })
  createEffect(() => {
    if (params.id && task.state === "ready" && !task()) navigate(taskPath(directory()!), { replace: true })
  })
  onMount(() => {
    const off = listen((_directory, event) => {
      if (event.type === "task.updated") void refresh()
    })
    onCleanup(off)
  })

  const update = async (patch: { status?: Status; priority?: TaskInfo["priority"]; assigneeID?: string | null }) => {
    if (!params.id || !directory()) return
    setBusy(true)
    try {
      await call(client(directory()!).task.update({ taskID: params.id, ...patch }))
      await refresh()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    } finally {
      setBusy(false)
    }
  }

  const comment = async (content: string) => {
    if (!params.id || !directory()) return
    try {
      await call(client(directory()!).task.comment({ taskID: params.id, content }))
      await refresh()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
      throw error
    }
  }

  return (
    <Show when={directory()} fallback={<Navigate href="/" />}>
      {(dir) => (
        <div class="app">
          <nav class="sidebar sidebar-tasks" aria-label={t("task.nav")}>
            <PrimaryNav directory={dir()} active="tasks" />
          </nav>
          <Frame title={<span class="title">{t("task.title")}</span>} directory={dir()} folder={dir()} tools={false}>
            <div class="task-workspace">
              <TaskList
                current={params.id}
                tasks={tasks() ?? []}
                filter={filter()}
                query={query()}
                onFilter={setFilter}
                onQuery={setQuery}
                onCreate={() => setCreating(true)}
                onSelect={(id) => navigate(taskPath(dir(), id))}
              />
              <Show
                when={params.id ? task() : undefined}
                fallback={
                  <div class="task-welcome">
                    <span class="task-welcome-icon">
                      <ListTodo class="icon" />
                    </span>
                    <Switch fallback={<p>{t("task.select")}</p>}>
                      <Match when={task.loading}>
                        <p>{t("coworker.loading")}</p>
                      </Match>
                      <Match when={!params.id}>
                        <h2>{t("task.title")}</h2>
                        <p>{t("task.select")}</p>
                        <button class="button primary" onClick={() => setCreating(true)}>
                          <Plus class="icon" />
                          {t("task.new")}
                        </button>
                      </Match>
                    </Switch>
                  </div>
                }
              >
                {(value) => (
                  <TaskDetail
                    directory={dir()}
                    task={value()}
                    coworkers={coworkers() ?? []}
                    busy={busy()}
                    onUpdate={update}
                    onComment={comment}
                  />
                )}
              </Show>
            </div>
          </Frame>
          <TaskCreate
            directory={dir()}
            open={creating()}
            onClose={() => setCreating(false)}
            onCreated={(created) => {
              void refetch()
              navigate(taskPath(dir(), created.id))
            }}
          />
        </div>
      )}
    </Show>
  )
}
