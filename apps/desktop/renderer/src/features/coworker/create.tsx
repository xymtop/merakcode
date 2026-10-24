import { createEffect, createResource, createSignal, For, on, Show } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { available } from "../../state/models"
import { Dialog } from "../../ui/dialog"
import { Select } from "../../ui/select"
import { toast } from "../../ui/toast"

export function CoworkerCreate(props: {
  directory: string
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = createSignal("")
  const [duty, setDuty] = createSignal("")
  const [model, setModel] = createSignal("")
  const [skills, setSkills] = createSignal<string[]>([])
  const [mcp, setMcp] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const [availableSkills] = createResource(
    () => (props.open ? props.directory : undefined),
    (directory) => call(client(directory).app.skills()),
  )
  const [availableMcp] = createResource(
    () => (props.open ? props.directory : undefined),
    (directory) => call(client(directory).mcp.status()),
  )

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
        setName("")
        setDuty("")
        setModel("")
        setSkills([])
        setMcp([])
      },
    ),
  )

  const toggle = (list: () => string[], set: (value: string[]) => void, item: string) => {
    const next = new Set(list())
    if (next.has(item)) next.delete(item)
    else next.add(item)
    set([...next].sort())
  }

  const create = async () => {
    const trimmed = name().trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const created = await call(
        client(props.directory).coworker.create({
          name: trimmed,
          duty: duty().trim() || undefined,
          bindings: {
            model: model() || undefined,
            skills: skills(),
            mcp: mcp(),
          },
        }),
      )
      props.onCreated(created.id)
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
      title={t("coworker.create.title")}
      description={t("coworker.create.lead")}
      class="coworker-create"
      footer={
        <>
          <button class="button secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" disabled={busy() || !name().trim()} onClick={() => void create()}>
            {t("coworker.create.submit")}
          </button>
        </>
      }
    >
      <div class="dialog-body coworker-create-form">
        <section class="coworker-create-section">
          <label class="field">
            <span>{t("coworker.create.name")}</span>
            <input class="input" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
          </label>
          <label class="field">
            <span>{t("coworker.create.duty")}</span>
            <textarea class="input" rows={4} value={duty()} onInput={(e) => setDuty(e.currentTarget.value)} />
          </label>
        </section>

        <section class="coworker-create-section">
          <header>
            <strong>{t("coworker.create.config")}</strong>
            <span>{t("coworker.create.configLead")}</span>
          </header>
          <label class="field">
            <span>{t("coworker.bindings.model")}</span>
            <Select
              class="select-field coworker-create-model"
              label={t("coworker.bindings.model")}
              value={model() || "default"}
              options={[
                { value: "default", label: t("coworker.bindings.modelDefault") },
                ...available().map((item) => ({
                  value: item.key,
                  label: `${item.provider.name} / ${item.model.name}`,
                })),
              ]}
              onChange={(value) => setModel(value === "default" ? "" : value)}
            />
          </label>
        </section>

        <section class="coworker-create-section">
          <header>
            <strong>{t("coworker.bindings.skills")}</strong>
            <span>{t("coworker.bindings.skillsLead")}</span>
          </header>
          <div class="coworker-create-options scroll">
            <For
              each={availableSkills() ?? []}
              fallback={<span class="subtle">{t("coworker.bindings.skillsEmpty")}</span>}
            >
              {(skill) => (
                <label class="coworker-create-option">
                  <input
                    type="checkbox"
                    checked={skills().includes(skill.name)}
                    onChange={() => toggle(skills, setSkills, skill.name)}
                  />
                  <span>
                    <strong>{skill.name}</strong>
                    <Show when={skill.description}>
                      <small>{skill.description}</small>
                    </Show>
                  </span>
                </label>
              )}
            </For>
          </div>
        </section>

        <section class="coworker-create-section">
          <header>
            <strong>{t("coworker.bindings.mcp")}</strong>
            <span>{t("coworker.bindings.mcpLead")}</span>
          </header>
          <div class="coworker-create-options scroll">
            <For
              each={Object.keys(availableMcp() ?? {}).sort()}
              fallback={<span class="subtle">{t("coworker.bindings.mcpEmpty")}</span>}
            >
              {(server) => (
                <label class="coworker-create-option">
                  <input
                    type="checkbox"
                    checked={mcp().includes(server)}
                    onChange={() => toggle(mcp, setMcp, server)}
                  />
                  <span>
                    <strong>{server}</strong>
                  </span>
                </label>
              )}
            </For>
          </div>
        </section>
      </div>
    </Dialog>
  )
}
