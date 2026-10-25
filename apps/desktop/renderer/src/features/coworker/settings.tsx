import type { Coworker } from "@merakcode/sdk/client"
import Plug from "lucide-solid/icons/plug"
import Settings2 from "lucide-solid/icons/settings-2"
import Sparkles from "lucide-solid/icons/sparkles"
import X from "lucide-solid/icons/x"
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show, Switch, Match } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { available } from "../../state/models"
import { trackOverlay } from "../../ui/overlay"
import { Select } from "../../ui/select"
import { toast } from "../../ui/toast"
import { AgentAvatar } from "./avatar"

type Tab = "profile" | "skills" | "mcp"

export function AgentSettings(props: {
  directory: string
  coworkerID: string
  initial?: Coworker
  onClose: () => void
  onSaved?: () => void
}) {
  const [tab, setTab] = createSignal<Tab>("profile")
  const [info, { refetch }] = createResource(
    () => ({ directory: props.directory, id: props.coworkerID }),
    ({ directory, id }) => call(client(directory).coworker.get({ coworkerID: id })),
  )
  const [skills] = createResource(
    () => props.directory,
    (directory) => call(client(directory).app.skills()),
  )
  const [mcp] = createResource(
    () => props.directory,
    (directory) => call(client(directory).mcp.status()),
  )
  const [name, setName] = createSignal("")
  const [duty, setDuty] = createSignal("")
  const [model, setModel] = createSignal("")
  const [selectedSkills, setSelectedSkills] = createSignal<string[]>([])
  const [selectedMcp, setSelectedMcp] = createSignal<string[]>([])
  const [saving, setSaving] = createSignal(false)
  const [apiKey, setApiKey] = createSignal("")
  const a2a = () => (info() ?? props.initial)?.runtime === "a2a"
  const [authStatus, { refetch: refetchAuth }] = createResource(
    () => (a2a() ? { directory: props.directory, id: props.coworkerID } : undefined),
    (key) => (key ? call(client(key.directory).coworker.a2A.auth.status({ coworkerID: key.id })) : undefined),
  )

  createEffect(() => {
    const value = info() ?? props.initial
    if (!value) return
    setName(value.name)
    setDuty(value.duty)
    setModel(value.bindings.model ?? "")
    setSelectedSkills([...value.bindings.skills])
    setSelectedMcp([...value.bindings.mcp])
    if (value.runtime === "a2a" && tab() !== "profile") setTab("profile")
  })

  const close = () => props.onClose()
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) close()
  }
  trackOverlay(() => true)
  onMount(() => document.addEventListener("keydown", escape))
  onCleanup(() => document.removeEventListener("keydown", escape))

  const finish = async (request: Promise<unknown>) => {
    setSaving(true)
    try {
      await request
      toast({ kind: "success", title: t("coworker.world.saved") })
      await refetch()
      props.onSaved?.()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    } finally {
      setSaving(false)
    }
  }

  const saveProfile = () => {
    const update = call(
      client(props.directory).coworker.update({
        coworkerID: props.coworkerID,
        name: name().trim() || undefined,
        duty: duty().trim(),
      }),
    )
    if (a2a()) return finish(update)
    return finish(
      Promise.all([
        update,
        call(
          client(props.directory).coworker.bindings.update({
            coworkerID: props.coworkerID,
            model: model(),
          }),
        ),
      ]),
    )
  }

  const refreshCard = () =>
    finish(call(client(props.directory).coworker.a2A.refresh({ coworkerID: props.coworkerID })))

  const saveKey = () => {
    const key = apiKey().trim()
    if (!key) return
    return finish(
      call(
        client(props.directory).coworker.a2A.auth.set({
          coworkerID: props.coworkerID,
          auth:
            (info() ?? props.initial)?.a2a?.authKind === "oauth2"
              ? { type: "oauth2", access: key }
              : { type: "apiKey", key },
        }),
      ).then(() => {
        setApiKey("")
        return refetchAuth()
      }),
    )
  }

  const clearKey = () =>
    finish(
      call(client(props.directory).coworker.a2A.auth.set({ coworkerID: props.coworkerID, auth: null })).then(() =>
        refetchAuth(),
      ),
    )

  const toggle = (list: () => string[], set: (next: string[]) => void, value: string) => {
    const next = new Set(list())
    if (next.has(value)) next.delete(value)
    else next.add(value)
    set([...next].sort())
  }

  const saveBindings = (patch: { skills?: string[]; mcp?: string[] }) =>
    finish(
      call(
        client(props.directory).coworker.bindings.update({
          coworkerID: props.coworkerID,
          model: model(),
          skills: selectedSkills(),
          mcp: selectedMcp(),
          ...patch,
        }),
      ),
    )

  return (
    <div class="agent-settings-layer">
      <button class="agent-settings-backdrop" aria-label={t("common.close")} onClick={close} />
      <aside class="agent-settings-drawer" role="dialog" aria-modal="true" aria-label={t("coworker.settings")}>
        <header class="agent-settings-head">
          <div>
            <span>{t("coworker.settings")}</span>
            <h2>{name() || props.coworkerID}</h2>
          </div>
          <button class="icon-button" aria-label={t("common.close")} onClick={close}>
            <X class="icon" />
          </button>
        </header>
        <div class="agent-settings-tabs" role="tablist">
          <button role="tab" aria-selected={tab() === "profile"} onClick={() => setTab("profile")}>
            <Settings2 class="icon icon-sm" />
            {t("coworker.settings.profile")}
          </button>
          <Show when={!a2a()}>
            <button role="tab" aria-selected={tab() === "skills"} onClick={() => setTab("skills")}>
              <Sparkles class="icon icon-sm" />
              {t("coworker.bindings.skills")}
            </button>
            <button role="tab" aria-selected={tab() === "mcp"} onClick={() => setTab("mcp")}>
              <Plug class="icon icon-sm" />
              {t("coworker.bindings.mcp")}
            </button>
          </Show>
        </div>
        <div class="agent-settings-body scroll">
          <div class="agent-settings-identity">
            <AgentAvatar id={props.coworkerID} name={name() || props.coworkerID} size="lg" />
            <span>
              <strong>{name() || props.coworkerID}</strong>
              <small>{t("coworker.agent")}</small>
            </span>
          </div>
          <Switch>
            <Match when={tab() === "profile"}>
              <section class="agent-settings-section">
                <label class="field">
                  <span>{t("coworker.settings.name")}</span>
                  <input class="input" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
                </label>
                <label class="field">
                  <span>{t("coworker.settings.duty")}</span>
                  <textarea
                    class="input"
                    rows={5}
                    value={duty()}
                    onInput={(event) => setDuty(event.currentTarget.value)}
                  />
                </label>
                <Show when={!a2a()}>
                  <label class="field">
                    <span>{t("coworker.bindings.model")}</span>
                    <Select
                      class="select-field"
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
                </Show>
                <Show when={a2a() && (info() ?? props.initial)?.a2a}>
                  {(card) => (
                    <section class="agent-settings-section">
                      <span class="coworker-a2a-badge">{t("coworker.a2a.badge")}</span>
                      <p class="muted">{card().cardUrl}</p>
                      <p class="subtle">
                        {authStatus()?.configured ? t("coworker.a2a.configured") : t("coworker.a2a.missing")}
                      </p>
                      <Show when={card().authKind !== "none"}>
                        <label class="field">
                          <span>{t("coworker.a2a.key")}</span>
                          <input
                            class="input"
                            type="password"
                            autocomplete="off"
                            value={apiKey()}
                            onInput={(event) => setApiKey(event.currentTarget.value)}
                          />
                        </label>
                        <div class="agent-settings-actions">
                          <button
                            class="button secondary"
                            disabled={saving() || !apiKey().trim()}
                            onClick={() => void saveKey()}
                          >
                            {t("coworker.a2a.saveKey")}
                          </button>
                          <button class="button ghost" disabled={saving()} onClick={() => void clearKey()}>
                            {t("coworker.a2a.clearKey")}
                          </button>
                        </div>
                      </Show>
                      <div class="agent-settings-actions">
                        <button class="button secondary" disabled={saving()} onClick={() => void refreshCard()}>
                          {t("coworker.a2a.refresh")}
                        </button>
                      </div>
                    </section>
                  )}
                </Show>
                <div class="agent-settings-actions">
                  <button
                    class="button primary"
                    disabled={saving() || !name().trim()}
                    onClick={() => void saveProfile()}
                  >
                    {t("common.save")}
                  </button>
                </div>
              </section>
            </Match>
            <Match when={tab() === "skills"}>
              <section class="agent-settings-section">
                <p class="muted">{t("coworker.bindings.skillsLead")}</p>
                <For each={skills() ?? []} fallback={<div class="subtle">{t("coworker.bindings.skillsEmpty")}</div>}>
                  {(skill) => (
                    <label class="agent-setting-row">
                      <input
                        type="checkbox"
                        checked={selectedSkills().includes(skill.name)}
                        onChange={() => toggle(selectedSkills, setSelectedSkills, skill.name)}
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
                <div class="agent-settings-actions">
                  <button
                    class="button primary"
                    disabled={saving()}
                    onClick={() => void saveBindings({ skills: selectedSkills() })}
                  >
                    {t("common.save")}
                  </button>
                </div>
              </section>
            </Match>
            <Match when={tab() === "mcp"}>
              <section class="agent-settings-section">
                <p class="muted">{t("coworker.bindings.mcpLead")}</p>
                <For
                  each={Object.keys(mcp() ?? {}).sort()}
                  fallback={<div class="subtle">{t("coworker.bindings.mcpEmpty")}</div>}
                >
                  {(item) => (
                    <label class="agent-setting-row">
                      <input
                        type="checkbox"
                        checked={selectedMcp().includes(item)}
                        onChange={() => toggle(selectedMcp, setSelectedMcp, item)}
                      />
                      <span>
                        <strong>{item}</strong>
                        <small>{t("coworker.bindings.mcp")}</small>
                      </span>
                    </label>
                  )}
                </For>
                <div class="agent-settings-actions">
                  <button
                    class="button primary"
                    disabled={saving()}
                    onClick={() => void saveBindings({ mcp: selectedMcp() })}
                  >
                    {t("common.save")}
                  </button>
                </div>
              </section>
            </Match>
          </Switch>
        </div>
      </aside>
    </div>
  )
}
