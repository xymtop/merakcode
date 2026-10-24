import type { Coworker as CoworkerInfo } from "@merakcode/sdk/client"
import { createEffect, createResource, createSignal, For, Show } from "solid-js"
import { t } from "../../i18n"
import { available } from "../../state/models"
import { call, client } from "../../state/client"
import { Select } from "../../ui/select"
import { toast } from "../../ui/toast"

export function BindingsEditor(props: { directory: string; coworkerID: string }) {
  const [info, { refetch }] = createResource(
    () => ({ directory: props.directory, id: props.coworkerID }),
    ({ id }) => call(client(props.directory).coworker.get({ coworkerID: id })),
  )
  const [skills] = createResource(
    () => props.directory,
    (directory) => call(client(directory).app.skills()),
  )
  const [mcp] = createResource(
    () => props.directory,
    (directory) => call(client(directory).mcp.status()),
  )

  const [model, setModel] = createSignal("")
  const [selectedSkills, setSelectedSkills] = createSignal<string[]>([])
  const [selectedMcp, setSelectedMcp] = createSignal<string[]>([])
  const [saving, setSaving] = createSignal(false)

  createEffect(() => {
    const data: CoworkerInfo | undefined = info()
    if (!data) return
    setModel(data.bindings.model ?? "")
    setSelectedSkills([...(data.bindings.skills ?? [])])
    setSelectedMcp([...(data.bindings.mcp ?? [])])
  })

  const models = () => [
    { value: "", label: t("coworker.bindings.modelDefault") },
    ...available().map((item) => ({ value: item.key, label: `${item.provider.name} / ${item.model.name}` })),
  ]

  const toggle = (list: () => string[], set: (v: string[]) => void, name: string) => {
    const next = new Set(list())
    if (next.has(name)) next.delete(name)
    else next.add(name)
    set([...next].sort())
  }

  const save = async () => {
    setSaving(true)
    try {
      await call(
        client(props.directory).coworker.bindings.update({
          coworkerID: props.coworkerID,
          model: model(),
          skills: selectedSkills(),
          mcp: selectedMcp(),
        }),
      )
      toast({ kind: "success", title: t("coworker.bindings.saved") })
      void refetch()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    } finally {
      setSaving(false)
    }
  }

  const mcpNames = () => Object.keys(mcp() ?? {}).sort()

  return (
    <div class="coworker-bindings scroll">
      <Show when={info()} fallback={<div class="subtle">{t("coworker.loading")}</div>}>
        <section class="coworker-bindings-section">
          <h2>{t("coworker.bindings.core")}</h2>
          <p class="muted">{t("coworker.bindings.coreLead")}</p>
          <label class="field">
            <span>{t("coworker.bindings.model")}</span>
            <Select
              label={t("coworker.bindings.model")}
              options={models()}
              value={model()}
              onChange={(value) => setModel(value)}
            />
          </label>
          <p class="subtle">
            {t("coworker.bindings.profileHint")} · {info()!.profilePath}
          </p>
        </section>

        <section class="coworker-bindings-section">
          <h2>{t("coworker.bindings.skills")}</h2>
          <p class="muted">{t("coworker.bindings.skillsLead")}</p>
          <For each={skills() ?? []} fallback={<div class="subtle">{t("coworker.bindings.skillsEmpty")}</div>}>
            {(skill) => (
              <label class="coworker-check">
                <input
                  type="checkbox"
                  checked={selectedSkills().includes(skill.name)}
                  onChange={() => toggle(selectedSkills, setSelectedSkills, skill.name)}
                />
                <span>
                  <strong>{skill.name}</strong>
                  <Show when={skill.description}>
                    <span class="subtle"> — {skill.description}</span>
                  </Show>
                </span>
              </label>
            )}
          </For>
        </section>

        <section class="coworker-bindings-section">
          <h2>{t("coworker.bindings.mcp")}</h2>
          <p class="muted">{t("coworker.bindings.mcpLead")}</p>
          <For each={mcpNames()} fallback={<div class="subtle">{t("coworker.bindings.mcpEmpty")}</div>}>
            {(name) => (
              <label class="coworker-check">
                <input
                  type="checkbox"
                  checked={selectedMcp().includes(name)}
                  onChange={() => toggle(selectedMcp, setSelectedMcp, name)}
                />
                <span>{name}</span>
              </label>
            )}
          </For>
        </section>

        <div class="coworker-bindings-foot">
          <button class="button primary" disabled={saving()} onClick={() => void save()}>
            {t("common.save")}
          </button>
        </div>
      </Show>
    </div>
  )
}
