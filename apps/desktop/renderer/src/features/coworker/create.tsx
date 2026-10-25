import type { A2aCardPreview } from "@merakcode/sdk/client"
import { createEffect, createResource, createSignal, For, on, Show } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { available } from "../../state/models"
import { Dialog } from "../../ui/dialog"
import { Segmented } from "../../ui/segmented"
import { Select } from "../../ui/select"
import { toast } from "../../ui/toast"

type Runtime = "local" | "a2a"

export function CoworkerCreate(props: {
  directory: string
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [runtime, setRuntime] = createSignal<Runtime>("local")
  const [name, setName] = createSignal("")
  const [duty, setDuty] = createSignal("")
  const [model, setModel] = createSignal("")
  const [skills, setSkills] = createSignal<string[]>([])
  const [mcp, setMcp] = createSignal<string[]>([])
  const [cardUrl, setCardUrl] = createSignal("")
  const [preview, setPreview] = createSignal<A2aCardPreview>()
  const [apiKey, setApiKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [discovering, setDiscovering] = createSignal(false)
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
        setRuntime("local")
        setName("")
        setDuty("")
        setModel("")
        setSkills([])
        setMcp([])
        setCardUrl("")
        setPreview(undefined)
        setApiKey("")
      },
    ),
  )

  const toggle = (list: () => string[], set: (value: string[]) => void, item: string) => {
    const next = new Set(list())
    if (next.has(item)) next.delete(item)
    else next.add(item)
    set([...next].sort())
  }

  const discover = async () => {
    const url = cardUrl().trim()
    if (!url) return
    setDiscovering(true)
    try {
      const card = await call(client(props.directory).a2A.discover({ url }))
      setPreview(card)
      if (!name().trim()) setName(card.name)
      if (!duty().trim()) setDuty(card.description || "")
    } catch (error) {
      setPreview(undefined)
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    } finally {
      setDiscovering(false)
    }
  }

  const canSubmit = () => {
    if (!name().trim() || busy()) return false
    if (runtime() === "local") return true
    const card = preview()
    if (!card) return false
    if (card.authKind === "apiKey" && !apiKey().trim()) return false
    return true
  }

  const create = async () => {
    const trimmed = name().trim()
    if (!trimmed || !canSubmit()) return
    setBusy(true)
    try {
      if (runtime() === "a2a") {
        const card = preview()!
        const created = await call(
          client(props.directory).coworker.create({
            name: trimmed,
            duty: duty().trim() || undefined,
            runtime: "a2a",
            a2a: {
              cardUrl: card.cardUrl,
              rpcUrl: card.rpcUrl,
              protocolVersion: card.protocolVersion,
              interfaces: card.interfaces,
              name: card.name,
              description: card.description,
              skills: card.skills,
              authKind: card.authKind,
              version: card.version,
            },
            ...(card.authKind === "apiKey" && apiKey().trim()
              ? { auth: { type: "apiKey" as const, key: apiKey().trim() } }
              : {}),
          }),
        )
        props.onCreated(created.id)
        props.onClose()
        return
      }
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
      description={runtime() === "a2a" ? t("coworker.create.a2a.lead") : t("coworker.create.lead")}
      class="coworker-create"
      footer={
        <>
          <button class="button secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" disabled={!canSubmit()} onClick={() => void create()}>
            {t("coworker.create.submit")}
          </button>
        </>
      }
    >
      <div class="dialog-body coworker-create-form">
        <Segmented
          label={t("coworker.create.runtime")}
          value={runtime()}
          onChange={setRuntime}
          options={[
            { value: "local", label: t("coworker.create.runtime.local") },
            { value: "a2a", label: t("coworker.create.runtime.a2a") },
          ]}
        />

        <Show when={runtime() === "a2a"}>
          <section class="coworker-create-section">
            <label class="field">
              <span>{t("coworker.create.a2a.url")}</span>
              <div class="coworker-create-url-row">
                <input
                  class="input"
                  value={cardUrl()}
                  placeholder={t("coworker.create.a2a.urlHint")}
                  onInput={(e) => setCardUrl(e.currentTarget.value)}
                />
                <button
                  class="button secondary"
                  disabled={discovering() || !cardUrl().trim()}
                  onClick={() => void discover()}
                >
                  {discovering() ? t("coworker.create.a2a.discovering") : t("coworker.create.a2a.discover")}
                </button>
              </div>
            </label>
            <Show when={preview()}>
              {(card) => (
                <div class="coworker-create-preview">
                  <strong>{card().name}</strong>
                  <Show when={card().description}>
                    <p>{card().description}</p>
                  </Show>
                  <Show when={card().skills.length}>
                    <ul>
                      <For each={card().skills}>{(skill) => <li>{skill.name}</li>}</For>
                    </ul>
                  </Show>
                  <span class="subtle">
                    {t("coworker.create.a2a.auth", {
                      kind:
                        card().authKind === "none"
                          ? t("coworker.create.a2a.auth.none")
                          : card().authKind === "apiKey"
                            ? t("coworker.create.a2a.auth.apiKey")
                            : t("coworker.create.a2a.auth.oauth2"),
                    })}
                  </span>
                </div>
              )}
            </Show>
            <Show when={preview()?.authKind === "apiKey"}>
              <label class="field">
                <span>{t("coworker.create.a2a.apiKey")}</span>
                <input
                  class="input"
                  type="password"
                  autocomplete="off"
                  value={apiKey()}
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                />
              </label>
            </Show>
            <Show when={preview()?.authKind === "oauth2"}>
              <p class="subtle">{t("coworker.create.a2a.oauthLater")}</p>
            </Show>
          </section>
        </Show>

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

        <Show when={runtime() === "local"}>
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
        </Show>
      </div>
    </Dialog>
  )
}
