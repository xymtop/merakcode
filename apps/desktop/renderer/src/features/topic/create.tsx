import type { Coworker } from "@merakcode/sdk/client"
import { createEffect, createResource, createSignal, For, on, Show } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { AgentAvatar } from "../coworker/avatar"
import { Dialog } from "../../ui/dialog"
import { toast } from "../../ui/toast"

export function TopicCreate(props: {
  directory: string
  open: boolean
  onClose: () => void
  onCreated: (sessionID: string) => void
}) {
  const [title, setTitle] = createSignal("")
  const [body, setBody] = createSignal("")
  const [participants, setParticipants] = createSignal<string[]>([])
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
        setBody("")
        setParticipants([])
      },
    ),
  )

  const toggle = (item: Coworker) => {
    setParticipants((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
    )
  }

  const create = async () => {
    if (!title().trim() || !body().trim() || !participants().length) return
    setBusy(true)
    try {
      const topic = await call(
        client(props.directory).topic.create({
          title: title().trim(),
          body: body().trim(),
          participants: participants(),
        }),
      )
      props.onCreated(topic.id)
      props.onClose()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      title={t("topic.create.title")}
      description={t("topic.create.lead")}
      class="topic-create"
      footer={
        <>
          <button class="button secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button
            class="button primary"
            disabled={busy() || !title().trim() || !body().trim() || !participants().length}
            onClick={() => void create()}
          >
            {t("topic.create.submit")}
          </button>
        </>
      }
    >
      <div class="dialog-body topic-create-form">
        <label class="field">
          <span>{t("topic.create.name")}</span>
          <input
            class="input"
            autofocus
            placeholder={t("topic.create.namePlaceholder")}
            value={title()}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>{t("topic.create.description")}</span>
          <textarea
            class="input"
            rows={4}
            placeholder={t("topic.create.descriptionPlaceholder")}
            value={body()}
            onInput={(event) => setBody(event.currentTarget.value)}
          />
        </label>
        <section class="topic-invite">
          <header>
            <strong>{t("topic.create.members")}</strong>
            <span>{t("topic.create.membersLead")}</span>
          </header>
          <div class="topic-invite-list scroll">
            <For each={coworkers() ?? []} fallback={<p class="subtle">{t("topic.create.empty")}</p>}>
              {(item) => (
                <label class="topic-invite-row">
                  <input type="checkbox" checked={participants().includes(item.id)} onChange={() => toggle(item)} />
                  <AgentAvatar id={item.id} name={item.name} />
                  <span class="topic-invite-copy">
                    <strong>{item.name}</strong>
                    <small>{item.duty || t("coworker.contacts.none")}</small>
                  </span>
                  <Show when={participants().includes(item.id)}>
                    <span class="topic-invite-check">✓</span>
                  </Show>
                </label>
              )}
            </For>
          </div>
        </section>
      </div>
    </Dialog>
  )
}
