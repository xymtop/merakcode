import type { FilePartInput, PermissionMode } from "@merakcode/sdk/client"
import ArrowUp from "lucide-solid/icons/arrow-up"
import Brain from "lucide-solid/icons/brain"
import Eye from "lucide-solid/icons/eye"
import FileText from "lucide-solid/icons/file-text"
import Folder from "lucide-solid/icons/folder"
import Hand from "lucide-solid/icons/hand"
import Paperclip from "lucide-solid/icons/paperclip"
import Square from "lucide-solid/icons/square"
import SquareSlash from "lucide-solid/icons/square-slash"
import X from "lucide-solid/icons/x"
import Zap from "lucide-solid/icons/zap"
import { createEffect, createResource, createSignal, For, on, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { t } from "../../i18n"
import { bridge, mac } from "../../lib/bridge"
import { call, client } from "../../state/client"
import { choice, choiceKey, choose, find, usage } from "../../state/models"
import { connected, session } from "../../state/store"
import { setUi } from "../../state/ui"
import { Select } from "../../ui/select"
import { ModelPicker } from "./model-picker"
import { COMPACT, loadCommands } from "./send"
import { apply, fileUrl, trigger, type Trigger } from "./suggest"
import { Avatar, mentionChoices, type Product } from "./members"

const MODES: PermissionMode[] = ["readonly", "ask", "auto"]
export const modeOptions = () => [
  { value: "readonly" as const, label: t("mode.plan"), description: t("mode.plan.desc"), icon: Eye },
  { value: "ask" as const, label: t("mode.default"), description: t("mode.default.desc"), icon: Hand },
  { value: "auto" as const, label: t("mode.auto"), description: t("mode.auto.desc"), icon: Zap },
]

export type Submission = { text: string; files: FilePartInput[] }

/**
 * Text pushed into the composer from outside (when editing a sent message), keyed by conversation; an open composer
 * picks it up immediately
 */
const [fills, setFills] = createStore<Record<string, { text: string; at: number }>>({})
export const fill = (key: string, text: string) => setFills(key, { text, at: Date.now() })

type Option = {
  value: string
  label: string
  detail?: string
  section: "member" | "file" | "command"
  directory?: boolean
  seat?: boolean
}

const sectionLabel = (section: Option["section"]) =>
  section === "member" ? t("prompt.members") : section === "file" ? t("prompt.files") : t("prompt.commands")

/** Context usage: share of the model's context window used by the latest reply; hover for tokens and cost */
function Usage(props: { sessionID: string }) {
  const value = () => usage(props.sessionID)
  return (
    <Show when={value()?.percent !== undefined && value()}>
      {(info) => (
        <span
          class="usage"
          role="status"
          aria-label={t("prompt.usage", { percent: info().percent! })}
          title={t("prompt.usageDetail", {
            tokens: info().tokens.toLocaleString(),
            limit: (info().limit ?? 0).toLocaleString(),
            cost: info().cost.toFixed(4),
          })}
          data-level={info().percent! >= 80 ? "high" : undefined}
        >
          <span class="usage-bar">
            <span style={{ width: `${info().percent}%` }} />
          </span>
          {info().percent}%
        </span>
      )}
    </Show>
  )
}

/**
 * Composer: Enter sends, Shift+Enter adds a newline (nothing is sent during IME composition), Shift+Tab switches the
 * permission mode. @ mentions files, / runs commands; pasted or dropped images and files become attachments.
 */
export function Composer(props: {
  sessionID?: string
  directory: string
  busy: boolean
  compact?: boolean
  autofocus?: boolean
  placeholder?: string
  /** Coworker chats and collaboration groups inherit their execution settings from their configuration */
  hideModelControls?: boolean
  /** Group members offered by @ */
  seats?: readonly { name: string; product: string; role?: string }[]
  products?: readonly Product[]
  onSubmit: (submission: Submission) => Promise<unknown> | void
  onStop?: () => void
  onMode?: (mode: PermissionMode) => void
}) {
  let input!: HTMLTextAreaElement
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<FilePartInput[]>([])
  /** Files mentioned with @; only those whose "@path" is still in the text are sent */
  const [mentions, setMentions] = createSignal<{ path: string; part: FilePartInput }[]>([])
  const [sending, setSending] = createSignal(false)
  const [at, setAt] = createSignal<Trigger>()
  const [active, setActive] = createSignal(0)
  const current = () => choice(props.sessionID, props.directory)
  const variants = () => Object.keys(find(current().model)?.model.variants ?? {})
  /** For a conversation in a worktree, files and commands are looked up in the worktree directory */
  const dir = () => (props.sessionID ? session(props.sessionID)?.directory : undefined) ?? props.directory
  const key = () => choiceKey(props.sessionID, props.directory)

  onMount(() => props.autofocus && input.focus())
  createEffect(
    on(
      () => fills[key()]?.at,
      (stamp) => {
        if (!stamp) return
        setText(fills[key()]!.text)
        queueMicrotask(() => {
          resize()
          input.focus()
          input.setSelectionRange(input.value.length, input.value.length)
        })
      },
    ),
  )

  const [options] = createResource(
    () =>
      at() && {
        ...at()!,
        dir: dir(),
        seats: props.seats ?? [],
        products: props.products ?? [],
      },
    async (trigger): Promise<Option[]> => {
      if (trigger.kind === "command") {
        const list = await loadCommands(trigger.dir)
        const query = trigger.query.toLowerCase()
        return [
          { value: COMPACT, label: COMPACT, detail: t("prompt.compact"), section: "command" as const },
          ...list.map((item) => ({
            value: item.name,
            label: item.name,
            detail: item.description,
            section: "command" as const,
          })),
        ].filter((item) => item.value.toLowerCase().includes(query))
      }
      const found = await call(client(trigger.dir).find.files({ query: trigger.query, limit: 8 })).catch(() => [])
      const mentions = mentionChoices(trigger.query, trigger.seats, trigger.products).map((choice) => ({
        value: choice.name,
        label: choice.name,
        detail: choice.detail,
        section: "member" as const,
        seat: true,
      }))
      return [
        ...mentions,
        ...found.map((path) => ({
          value: path.replace(/\\/g, "/"),
          label: path.replace(/\\/g, "/"),
          section: "file" as const,
          directory: /[\\/]$/.test(path),
        })),
      ]
    },
  )
  const open = () => !!at() && (options()?.length ?? 0) > 0

  const detect = () => setAt(trigger(input.value, input.selectionStart ?? input.value.length))

  const resize = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 320)}px`
  }

  const select = (option: Option | undefined) => {
    const hit = at()
    if (!option || !hit) return
    const next = apply(text(), hit, option.value)
    setText(next.text)
    if (hit.kind === "file" && !option.seat) {
      const absolute = `${dir().replace(/[\\/]+$/, "")}/${option.value}`
      setMentions((list) => [
        ...list.filter((item) => item.path !== option.value),
        {
          path: option.value,
          part: {
            type: "file",
            mime: "text/plain",
            filename: option.value,
            url: fileUrl(absolute),
            source: { type: "file", path: option.value, text: { start: 0, end: 0, value: "" } },
          },
        },
      ])
    }
    setAt(undefined)
    setActive(0)
    queueMicrotask(() => {
      input.value = next.text
      input.setSelectionRange(next.caret, next.caret)
      input.focus()
      resize()
    })
  }

  const submit = async () => {
    const value = text().trim()
    if ((!value && !files().length) || sending()) return
    setSending(true)
    try {
      const referenced = mentions()
        .filter((item) => value.includes(`@${item.path}`))
        .map((item) => item.part)
      await props.onSubmit({ text: value, files: [...files(), ...referenced] })
      setText("")
      setFiles([])
      setMentions([])
      setAt(undefined)
      resize()
    } finally {
      setSending(false)
    }
  }

  const setMode = (mode: PermissionMode) => {
    choose(props.sessionID, props.directory, { mode })
    props.onMode?.(mode)
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return
    if (open()) {
      const list = options() ?? []
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        select(list[active()])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setAt(undefined)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
    if (event.key === "Tab" && event.shiftKey && !props.hideModelControls) {
      event.preventDefault()
      const index = MODES.indexOf(current().mode)
      setMode(MODES[(index + 1) % MODES.length]!)
    }
  }

  const attach = (file: File) => {
    const path = bridge?.getPathForFile(file)
    if (path) {
      setFiles((list) => [
        ...list,
        { type: "file", mime: file.type || "text/plain", filename: file.name, url: fileUrl(path) },
      ])
      return
    }
    const reader = new FileReader()
    reader.onload = () =>
      setFiles((list) => [
        ...list,
        { type: "file", mime: file.type, filename: file.name || "image.png", url: String(reader.result) },
      ])
    reader.readAsDataURL(file)
  }

  const paste = (event: ClipboardEvent) => {
    const items = [...(event.clipboardData?.files ?? [])]
    if (!items.length) return
    event.preventDefault()
    items.forEach(attach)
  }

  const pick = async () => {
    const picked = await bridge?.openFilePicker({ multiple: true })
    const list = Array.isArray(picked) ? picked : picked ? [picked] : []
    setFiles((current) => [
      ...current,
      ...list.map((path) => ({
        type: "file" as const,
        mime: "text/plain",
        filename: path.split(/[\\/]/).pop() ?? path,
        url: fileUrl(path),
      })),
    ])
  }

  // Preload the command list so typing / does not wait
  createEffect(() => void loadCommands(dir()))

  return (
    <div
      class="composer"
      classList={{ compact: props.compact }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        ;[...(event.dataTransfer?.files ?? [])].forEach(attach)
      }}
    >
      <Show when={open()}>
        <div
          class="suggest popover scroll"
          role="listbox"
          id="composer-suggest"
          aria-label={at()?.kind === "file" ? t("prompt.mention") : t("prompt.command")}
        >
          <For each={options()}>
            {(option, index) => {
              const previous = () => (index() > 0 ? options()![index() - 1]?.section : undefined)
              return (
                <>
                  <Show when={previous() !== option.section}>
                    <div class="suggest-section">{sectionLabel(option.section)}</div>
                  </Show>
                  <div
                    id={`composer-suggest-${index()}`}
                    class="menu-item suggest-item"
                    role="option"
                    aria-selected={index() === active()}
                    data-highlighted={index() === active() ? "" : undefined}
                    onMouseEnter={() => setActive(index())}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      select(option)
                    }}
                  >
                    <Show
                      when={option.section === "member"}
                      fallback={
                        <span class="suggest-icon">
                          <Show
                            when={option.section === "command"}
                            fallback={
                              option.directory ? <Folder class="icon icon-sm" /> : <FileText class="icon icon-sm" />
                            }
                          >
                            <SquareSlash class="icon icon-sm" />
                          </Show>
                        </span>
                      }
                    >
                      <Avatar id={option.value} name={option.label} />
                    </Show>
                    <span class="suggest-copy">
                      <span class="suggest-name ellipsis" classList={{ mono: option.section !== "member" }}>
                        {option.label}
                      </span>
                      <Show when={option.detail}>
                        <span class="suggest-detail ellipsis">{option.detail}</span>
                      </Show>
                    </span>
                  </div>
                </>
              )
            }}
          </For>
        </div>
      </Show>
      <Show when={files().length}>
        <div class="attachments composer-files">
          <For each={files()}>
            {(file, index) => (
              <span class="attachment">
                <Paperclip class="icon icon-xs" />
                <span class="ellipsis">{file.filename}</span>
                <button
                  class="icon-button sm"
                  aria-label={t("prompt.removeAttachment", { name: file.filename ?? "" })}
                  onClick={() => setFiles((list) => list.filter((_, i) => i !== index()))}
                >
                  <X class="icon icon-xs" />
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <textarea
        ref={input}
        class="composer-input selectable"
        rows={props.compact ? 1 : 3}
        aria-label={t("prompt.label")}
        aria-controls={open() ? "composer-suggest" : undefined}
        aria-activedescendant={open() ? `composer-suggest-${active()}` : undefined}
        placeholder={props.placeholder ?? (props.busy ? t("prompt.placeholderBusy") : t("prompt.placeholder"))}
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value)
          setActive(0)
          detect()
          resize()
        }}
        onClick={detect}
        onBlur={() => setAt(undefined)}
        onKeyDown={keydown}
        onPaste={paste}
      />
      <div class="composer-bar">
        <button class="icon-button" aria-label={t("prompt.attach")} onClick={() => void pick()}>
          <Paperclip class="icon" />
        </button>
        <Show when={!connected() && !props.hideModelControls}>
          <button class="chip accent" onClick={() => setUi("settings", "models")}>
            {t("prompt.noModel")}
          </button>
        </Show>
        <span class="spacer" />
        <Show when={props.sessionID}>{(id) => <Usage sessionID={id()} />}</Show>
        <Show when={connected() && !props.hideModelControls}>
          <ModelPicker
            value={current().model}
            onChange={(model) => choose(props.sessionID, props.directory, { model, variant: undefined })}
          />
        </Show>
        <Show when={variants().length && !props.hideModelControls}>
          <Select
            label={t("model.variant")}
            options={[
              { value: "default", label: t("model.variant.default") },
              ...variants().map((value) => ({ value, label: value })),
            ]}
            value={current().variant ?? "default"}
            onChange={(variant) =>
              choose(props.sessionID, props.directory, { variant: variant === "default" ? undefined : variant })
            }
            display={(option) => (
              <>
                <Brain class="icon icon-sm" />
                <span>{option && option.value !== "default" ? option.label : t("model.variant")}</span>
              </>
            )}
          />
        </Show>
        <Show when={!props.hideModelControls}>
          <Select label={t("mode.label")} options={modeOptions()} value={current().mode} onChange={setMode} />
        </Show>
        <Show
          when={props.busy && !text().trim()}
          fallback={
            <button
              class="icon-button solid"
              aria-label={t("prompt.send")}
              title={`${t("prompt.send")} (Enter)`}
              disabled={(!text().trim() && !files().length) || sending()}
              onClick={() => void submit()}
            >
              <ArrowUp class="icon" />
            </button>
          }
        >
          <button
            class="icon-button solid stop"
            aria-label={t("prompt.stop")}
            title={mac ? "⌘." : "Esc"}
            onClick={() => props.onStop?.()}
          >
            <Square class="icon icon-xs" />
          </button>
        </Show>
      </div>
    </div>
  )
}
