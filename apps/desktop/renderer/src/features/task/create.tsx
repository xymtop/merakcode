import type { Coworker, Task } from "@merakcode/sdk/client"
import { createEffect, createResource, createSignal, on, Show } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { AgentAvatar } from "../coworker/avatar"
import { Dialog } from "../../ui/dialog"
import { Select } from "../../ui/select"
import { toast } from "../../ui/toast"

export function TaskCreate(props: {
  directory: string
  open: boolean
  onClose: () => void
  onCreated: (task: Task) => void
}) {
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [priority, setPriority] = createSignal<Task["priority"]>("medium")
  const [assigneeID, setAssigneeID] = createSignal("none")
  const [busy, setBusy] = createSignal(false)
  const [coworkers] = createResource(
    () => (props.open ? props.directory : undefined),
    (directory) => call(client(directory).coworker.list()),
  )

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
        setTitle("")
        setDescription("")
        setPriority("medium")
        setAssigneeID("none")
      },
    ),
  )

  const create = async () => {
    if (!title().trim()) return
    setBusy(true)
    try {
      const task = await call(
        client(props.directory).task.create({
          title: title().trim(),
          description: description().trim() || undefined,
          priority: priority(),
          assigneeID: assigneeID() === "none" ? undefined : assigneeID(),
        }),
      )
      props.onCreated(task)
      props.onClose()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    } finally {
      setBusy(false)
    }
  }

  const assignee = () => (coworkers() ?? []).find((item) => item.id === assigneeID())

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      title={t("task.create.title")}
      description={t("task.create.lead")}
      class="task-create"
      footer={
        <>
          <button class="button secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" disabled={busy() || !title().trim()} onClick={() => void create()}>
            {t("task.create.submit")}
          </button>
        </>
      }
    >
      <div class="dialog-body task-create-form">
        <label class="field">
          <span>{t("task.create.name")}</span>
          <input
            class="input"
            autofocus
            value={title()}
            placeholder={t("task.create.namePlaceholder")}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>{t("task.create.description")}</span>
          <textarea
            class="input"
            rows={4}
            value={description()}
            placeholder={t("task.create.descriptionPlaceholder")}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </label>
        <div class="task-create-row">
          <label class="field">
            <span>{t("task.priority")}</span>
            <Select
              class="select-field"
              label={t("task.priority")}
              value={priority()}
              options={[
                { value: "high", label: t("task.priority.high") },
                { value: "medium", label: t("task.priority.medium") },
                { value: "low", label: t("task.priority.low") },
              ]}
              onChange={setPriority}
            />
          </label>
          <label class="field">
            <span>{t("task.assignee")}</span>
            <Select
              class="select-field"
              label={t("task.assignee")}
              value={assigneeID()}
              options={[
                { value: "none", label: t("task.assignee.none") },
                ...(coworkers() ?? []).map((item: Coworker) => ({
                  value: item.id,
                  label: item.name,
                  description: item.duty,
                })),
              ]}
              onChange={setAssigneeID}
            />
          </label>
        </div>
        <Show when={assignee()}>
          {(item) => (
            <div class="task-create-assignee">
              <AgentAvatar id={item().id} name={item().name} />
              <span>
                <strong>{t("task.assignee.assigned", { name: item().name })}</strong>
                <small>{item().duty || t("coworker.contacts.none")}</small>
              </span>
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  )
}
