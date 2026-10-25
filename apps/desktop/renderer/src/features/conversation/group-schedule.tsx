import type { CollaborationGroup } from "@merakcode/sdk/client"
import ChevronRight from "lucide-solid/icons/chevron-right"
import Pencil from "lucide-solid/icons/pencil"
import Play from "lucide-solid/icons/play"
import Plus from "lucide-solid/icons/plus"
import RotateCcw from "lucide-solid/icons/rotate-ccw"
import Trash2 from "lucide-solid/icons/trash"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { Confirm, Dialog } from "../../ui/dialog"
import { Select } from "../../ui/select"
import { toast } from "../../ui/toast"

type Task = CollaborationGroup["tasks"][number]
type Message = CollaborationGroup["messages"][number]
type Sop = {
  id: string
  title: string
  description: string
  steps: { title: string; description: string; role?: string }[]
}

function statusLabel(status: Task["status"]) {
  if (status === "backlog") return t("group.schedule.status.backlog")
  if (status === "blocked") return t("group.schedule.status.blocked")
  if (status === "ready") return t("group.schedule.status.ready")
  if (status === "running") return t("group.schedule.status.running")
  if (status === "done") return t("group.schedule.status.done")
  if (status === "failed") return t("group.schedule.status.failed")
  return t("group.schedule.status.cancelled")
}

function errorToast(error: unknown) {
  toast({
    kind: "error",
    title: t("error.request", { message: error instanceof Error ? error.message : String(error) }),
    error,
  })
}

function TaskEditor(props: {
  sessionID: string
  directory: string
  group: CollaborationGroup
  task?: Task
  open: boolean
  onClose: () => void
}) {
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [paths, setPaths] = createSignal("")
  const [assignee, setAssignee] = createSignal("")
  const [role, setRole] = createSignal("")
  const [dependencies, setDependencies] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const members = () => props.group.seats.filter((seat) => !seat.leader)
  const available = () => props.group.tasks.filter((task) => task.id !== props.task?.id)

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
        const task = props.task
        setTitle(task?.title ?? "")
        setDescription(task?.description ?? "")
        setPaths((task?.paths ?? []).join("\n"))
        setAssignee(task?.assignee ?? "")
        setRole(task?.role ?? "")
        setDependencies(task?.dependencies ?? [])
      },
    ),
  )

  const toggleDependency = (id: string) =>
    setDependencies((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))

  const save = async () => {
    if (!title().trim()) return
    setBusy(true)
    try {
      const body = {
        title: title().trim(),
        description: description().trim(),
        paths: paths()
          .split(/\r?\n/)
          .map((path) => path.trim())
          .filter(Boolean),
        dependencies: dependencies(),
        role: role().trim(),
        ...(assignee() ? { assignee: assignee() } : {}),
      }
      if (props.task) {
        await call(
          client(props.directory).collaboration.task.update({
            sessionID: props.sessionID,
            taskID: props.task.id,
            ...body,
          }),
        )
      } else {
        await call(
          client(props.directory).collaboration.task.add({
            sessionID: props.sessionID,
            ...body,
          }),
        )
      }
      props.onClose()
    } catch (error) {
      errorToast(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      title={props.task ? t("group.schedule.edit") : t("group.schedule.add")}
      footer={
        <>
          <button class="button secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" disabled={busy() || !title().trim()} onClick={() => void save()}>
            {t("group.schedule.save")}
          </button>
        </>
      }
    >
      <div class="dialog-body form group-task-editor">
        <label class="field">
          <span>{t("group.schedule.title")}</span>
          <input
            class="input"
            value={title()}
            placeholder={t("group.schedule.titlePlaceholder")}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>{t("group.schedule.description")}</span>
          <textarea
            class="input"
            rows={4}
            value={description()}
            placeholder={t("group.schedule.descriptionPlaceholder")}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </label>
        <div class="field">
          <span>{t("group.schedule.assignee")}</span>
          <Select
            label={t("group.schedule.assignee")}
            value={assignee()}
            onChange={setAssignee}
            options={[
              { value: "", label: t("group.schedule.unassigned") },
              ...members().map((seat) => ({
                value: seat.name,
                label: seat.name,
                description: [seat.role, seat.product].filter(Boolean).join(" · "),
              })),
            ]}
          />
        </div>
        <label class="field">
          <span>{t("group.role")}</span>
          <input
            class="input"
            value={role()}
            placeholder={t("group.rolePlaceholder")}
            onInput={(event) => setRole(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>{t("group.schedule.paths")}</span>
          <textarea
            class="input"
            rows={3}
            value={paths()}
            placeholder={t("group.schedule.pathsHint")}
            onInput={(event) => setPaths(event.currentTarget.value)}
          />
        </label>
        <Show when={props.group.scheduler === "dag" && available().length}>
          <fieldset class="group-task-deps">
            <legend>{t("group.schedule.dependencies")}</legend>
            <For each={available()}>
              {(task) => (
                <label class="group-task-dep">
                  <input
                    type="checkbox"
                    checked={dependencies().includes(task.id)}
                    onChange={() => toggleDependency(task.id)}
                  />
                  <span>{task.title}</span>
                  <span class="subtle">{statusLabel(task.status)}</span>
                </label>
              )}
            </For>
          </fieldset>
        </Show>
      </div>
    </Dialog>
  )
}

/** A task pool or DAG above the group chat, plus the member-to-member @ messages they produce. */
export function GroupSchedule(props: {
  sessionID: string
  directory: string
  group: CollaborationGroup
  busy: boolean
  onRun: () => Promise<unknown>
}) {
  const [open, setOpen] = createSignal(true)
  const [editing, setEditing] = createSignal<Task>()
  const [adding, setAdding] = createSignal(false)
  const [removing, setRemoving] = createSignal<Task>()
  const [sops, setSops] = createSignal<Sop[]>([])
  const [sop, setSop] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [applying, setApplying] = createSignal(false)
  const tasks = () => props.group.tasks
  const done = () => tasks().filter((task) => task.status === "done").length
  const ready = () => tasks().filter((task) => task.status === "ready")
  const names = createMemo(() => new Map(props.group.seats.map((seat) => [seat.id, seat.name])))
  const namesByID = createMemo(() => new Map(tasks().map((task) => [task.id, task.title])))

  createEffect(
    on(
      () => props.group.scheduler,
      (mode) => {
        if (mode !== "dag") return
        void call(client(props.directory).collaboration.sop.list())
          .then((list) => {
            setSops(list)
            if (!sop() && list[0]) setSop(list[0].id)
          })
          .catch(() => undefined)
      },
    ),
  )

  const run = async () => {
    setRunning(true)
    try {
      const prepared = await call(
        client(props.directory).collaboration.task.prepare({ sessionID: props.sessionID }),
      )
      if (!prepared.tasks.some((task) => task.status === "ready")) {
        toast({ kind: "info", title: t("group.schedule.noReady") })
        return
      }
      await props.onRun()
    } catch (error) {
      errorToast(error)
    } finally {
      setRunning(false)
    }
  }

  const apply = async () => {
    if (!sop()) return
    setApplying(true)
    try {
      await call(client(props.directory).collaboration.sop.apply({ sessionID: props.sessionID, sop: sop() }))
    } catch (error) {
      errorToast(error)
    } finally {
      setApplying(false)
    }
  }

  const reset = async (task: Task) => {
    await call(client(props.directory).collaboration.task.reset({ sessionID: props.sessionID, taskID: task.id })).catch(
      errorToast,
    )
  }

  return (
    <section class="group-schedule" aria-label={t("group.schedule.tasks")}>
      <div class="group-schedule-card">
        <div class="group-schedule-head">
          <button class="group-schedule-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
            <ChevronRight class="icon icon-sm chevron" />
            <strong>{t("group.schedule.tasks")}</strong>
            <span class="subtle">{t("group.schedule.progress", { done: done(), total: tasks().length })}</span>
          </button>
          <span class="spacer" />
          <Show when={props.group.scheduler === "dag"}>
            <Select
              class="chip outlined"
              label={t("group.schedule.sop")}
              value={sop() || undefined}
              onChange={setSop}
              placeholder={t("group.schedule.sop")}
              options={sops().map((item) => ({
                value: item.id,
                label: item.title,
                description: item.description,
              }))}
            />
            <button class="button secondary sm" disabled={applying() || !sop()} onClick={() => void apply()}>
              {t("group.schedule.applySop")}
            </button>
          </Show>
          <button class="button secondary sm" disabled={props.busy || !ready().length || running()} onClick={() => void run()}>
            <Play class="icon icon-xs" />
            {running() ? t("group.schedule.running") : t("group.schedule.run")}
          </button>
          <button class="button secondary sm" onClick={() => setAdding(true)}>
            <Plus class="icon icon-xs" />
            {t("group.schedule.add")}
          </button>
        </div>
        <Show when={open()}>
          <Show
            when={tasks().length || props.group.messages.length}
            fallback={<p class="group-schedule-empty subtle">{t("group.schedule.none")}</p>}
          >
            <div class="group-schedule-body">
              <div class="group-task-list">
                <For each={tasks()}>
                  {(task) => (
                    <article class="group-task" data-status={task.status}>
                      <div class="group-task-main">
                        <span class="group-task-status" data-status={task.status}>
                          {statusLabel(task.status)}
                        </span>
                        <strong class="group-task-title">{task.title}</strong>
                        <span class="spacer" />
                        <Show when={task.status === "failed" || task.status === "cancelled"}>
                          <button
                            class="icon-button sm"
                            aria-label={t("group.schedule.retry")}
                            title={t("group.schedule.retry")}
                            onClick={() => void reset(task)}
                          >
                            <RotateCcw class="icon icon-xs" />
                          </button>
                        </Show>
                        <button
                          class="icon-button sm"
                          aria-label={t("group.schedule.edit")}
                          title={t("group.schedule.edit")}
                          disabled={task.status === "running"}
                          onClick={() => setEditing(task)}
                        >
                          <Pencil class="icon icon-xs" />
                        </button>
                        <button
                          class="icon-button sm"
                          aria-label={t("group.schedule.delete")}
                          title={t("group.schedule.delete")}
                          disabled={task.status === "running"}
                          onClick={() => setRemoving(task)}
                        >
                          <Trash2 class="icon icon-xs" />
                        </button>
                      </div>
                      <Show when={task.description}>
                        <p class="group-task-description">{task.description}</p>
                      </Show>
                      <div class="group-task-meta">
                        <span>{task.assignee ?? t("group.schedule.unassigned")}</span>
                        <Show when={task.role}>
                          <span>{task.role}</span>
                        </Show>
                        <Show when={task.dependencies.length}>
                          <span>
                            {t("group.schedule.after", {
                              tasks: task.dependencies.map((id) => namesByID().get(id) ?? id).join(", "),
                            })}
                          </span>
                        </Show>
                        <Show when={task.paths.length}>
                          <span class="ellipsis">{task.paths.join(", ")}</span>
                        </Show>
                      </div>
                      <Show when={task.error}>
                        {(error) => <p class="group-task-error">{error()}</p>}
                      </Show>
                      <Show when={task.result}>
                        {(result) => (
                          <details class="group-task-result">
                            <summary>{t("group.schedule.result")}</summary>
                            <p>{result()}</p>
                          </details>
                        )}
                      </Show>
                    </article>
                  )}
                </For>
              </div>
              <Show when={props.group.messages.length}>
                <aside class="group-messages" aria-label={t("group.schedule.messages")}>
                  <span class="group-messages-title">{t("group.schedule.messages")}</span>
                  <For each={props.group.messages.slice(-12)}>
                    {(message) => <MessageLine message={message} names={names()} />}
                  </For>
                </aside>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
      <TaskEditor
        sessionID={props.sessionID}
        directory={props.directory}
        group={props.group}
        task={editing()}
        open={adding() || !!editing()}
        onClose={() => {
          setAdding(false)
          setEditing(undefined)
        }}
      />
      <Confirm
        open={!!removing()}
        title={t("group.schedule.deleteTitle", { title: removing()?.title ?? "" })}
        description={t("group.schedule.deleteDetail")}
        confirm={t("group.schedule.delete")}
        cancel={t("common.cancel")}
        danger
        onResult={(ok) => {
          const task = removing()
          setRemoving(undefined)
          if (!ok || !task) return
          void call(
            client(props.directory).collaboration.task.remove({ sessionID: props.sessionID, taskID: task.id }),
          ).catch(errorToast)
        }}
      />
    </section>
  )
}

function MessageLine(props: { message: Message; names: Map<string, string> }) {
  const kind = () => (props.message.kind === "ask" ? "?" : props.message.kind === "handoff" ? "→" : "·")
  return (
    <p class="group-message" data-kind={props.message.kind}>
      <span class="group-message-route">
        {props.names.get(props.message.from) ?? props.message.from}
        <span aria-hidden="true">{kind()}</span>
        {props.names.get(props.message.to) ?? props.message.to}
      </span>
      <span>{props.message.text}</span>
    </p>
  )
}
