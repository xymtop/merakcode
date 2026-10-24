import type { Topic as TopicInfo, TopicParticipant } from "@merakcode/sdk/client"
import ArrowUp from "lucide-solid/icons/arrow-up"
import MessagesSquare from "lucide-solid/icons/messages-square"
import Plus from "lucide-solid/icons/plus"
import Search from "lucide-solid/icons/search"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Navigate, useNavigate, useParams } from "@solidjs/router"
import { ago, t } from "../../i18n"
import { decodeDir, topicPath } from "../../lib/route"
import { call, client } from "../../state/client"
import { listen, openFolder } from "../../state/store"
import { AgentAvatar } from "../coworker/avatar"
import { Frame } from "../shell/frame"
import { PrimaryNav } from "../shell/sidebar"
import { Markdown } from "../../ui/markdown"
import { toast } from "../../ui/toast"
import { apply, trigger } from "../conversation/suggest"
import { TopicCreate } from "./create"

type MentionTarget = {
  id: string
  name: string
  role: string
  type: "user" | "agent"
}

function TopicList(props: {
  current?: string
  topics: readonly TopicInfo[]
  query: string
  onQuery: (value: string) => void
  onCreate: () => void
  onSelect: (id: string) => void
}) {
  const visible = createMemo(() => {
    const value = props.query.trim().toLocaleLowerCase()
    if (!value) return props.topics
    return props.topics.filter((topic) =>
      `${topic.title} ${topic.body} ${topic.participants.map((item) => item.name).join(" ")}`
        .toLocaleLowerCase()
        .includes(value),
    )
  })
  return (
    <aside class="topic-list" aria-label={t("topic.title")}>
      <header class="topic-list-head">
        <div>
          <h1>{t("topic.title")}</h1>
          <p>{t("topic.lead")}</p>
        </div>
        <button class="icon-button" aria-label={t("topic.new")} title={t("topic.new")} onClick={props.onCreate}>
          <Plus class="icon" />
        </button>
      </header>
      <label class="topic-search">
        <Search class="icon icon-sm" />
        <input
          value={props.query}
          placeholder={t("topic.search")}
          aria-label={t("topic.search")}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
        />
      </label>
      <div class="topic-list-scroll scroll">
        <For
          each={visible()}
          fallback={<div class="topic-list-empty">{props.query ? t("topic.noMatch") : t("topic.empty")}</div>}
        >
          {(topic) => (
            <button
              class="topic-card"
              aria-current={props.current === topic.id ? "page" : undefined}
              onClick={() => props.onSelect(topic.id)}
            >
              <span class="topic-card-title">{topic.title}</span>
              <span class="topic-card-desc">{topic.body}</span>
              <span class="topic-card-foot">
                <span class="topic-avatar-stack">
                  <For each={topic.participants.slice(0, 3)}>
                    {(participant) => <AgentAvatar id={participant.coworkerID} name={participant.name} />}
                  </For>
                  <AgentAvatar id="user" name={t("topic.user")} />
                </span>
                <span>{t("topic.comments", { count: topic.comments.length })}</span>
                <span class="topic-card-time">{ago(topic.updatedAt)}</span>
              </span>
            </button>
          )}
        </For>
      </div>
    </aside>
  )
}

function TopicComposer(props: {
  participants: readonly TopicParticipant[]
  busy: boolean
  onSubmit: (content: string) => Promise<unknown>
}) {
  let input!: HTMLTextAreaElement
  const [text, setText] = createSignal("")
  const [mention, setMention] = createSignal<{ query: string; start: number; end: number }>()
  const [active, setActive] = createSignal(0)
  const targets = createMemo<MentionTarget[]>(() => {
    const needle = mention()?.query.trim().toLocaleLowerCase() ?? ""
    return [
      ...props.participants.map((item) => ({
        id: item.coworkerID,
        name: item.name,
        role: item.duty,
        type: "agent" as const,
      })),
      { id: "user", name: t("topic.user"), role: t("topic.owner"), type: "user" as const },
    ].filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle))
  })
  const open = () => !!mention() && targets().length > 0

  const detect = () => {
    const at = trigger(input.value, input.selectionStart ?? input.value.length)
    setMention(at?.kind === "file" ? { query: at.query, start: at.start, end: at.end } : undefined)
    setActive(0)
  }
  const resize = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`
  }
  const choose = (target: MentionTarget | undefined) => {
    const at = mention()
    if (!target || !at) return
    const next = apply(text(), { kind: "file", ...at }, target.name)
    setText(next.text)
    setMention(undefined)
    queueMicrotask(() => {
      input.value = next.text
      input.setSelectionRange(next.caret, next.caret)
      input.focus()
      resize()
    })
  }
  const submit = async () => {
    const content = text().trim()
    if (!content || props.busy) return
    await props.onSubmit(content)
    setText("")
    resize()
  }
  const keydown = (event: KeyboardEvent) => {
    if (open()) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const size = targets().length
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + size) % size)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        choose(targets()[active()])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMention(undefined)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void submit().catch(() => undefined)
    }
  }

  return (
    <div class="topic-composer">
      <Show when={open()}>
        <div class="topic-mentions popover" role="listbox">
          <div class="suggest-section">{t("topic.members")}</div>
          <For each={targets()}>
            {(target, index) => (
              <button
                class="topic-mention-item"
                role="option"
                aria-selected={index() === active()}
                onMouseEnter={() => setActive(index())}
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(target)
                }}
                onClick={() => choose(target)}
              >
                <AgentAvatar id={target.id} name={target.name} />
                <span>
                  <strong>{target.name}</strong>
                  <small>{target.role}</small>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <textarea
        ref={input}
        class="topic-composer-input selectable"
        rows={2}
        value={text()}
        placeholder={t("topic.commentPlaceholder")}
        onInput={(event) => {
          setText(event.currentTarget.value)
          detect()
          resize()
        }}
        onClick={detect}
        onBlur={() => window.setTimeout(() => setMention(undefined), 120)}
        onKeyDown={keydown}
      />
      <div class="topic-composer-foot">
        <span>{t("topic.commentHint")}</span>
        <button
          class="icon-button solid"
          aria-label={t("topic.comment")}
          disabled={!text().trim() || props.busy}
          onClick={() => void submit().catch(() => undefined)}
        >
          <ArrowUp class="icon" />
        </button>
      </div>
    </div>
  )
}

function TopicDiscussion(props: { directory: string; topicID: string }) {
  const navigate = useNavigate()
  const [topic, { refetch }] = createResource(
    () => ({ directory: props.directory, id: props.topicID }),
    ({ directory, id }) => call(client(directory).topic.get({ topicID: id })),
  )
  const [sending, setSending] = createSignal(false)
  createEffect(() => {
    if (topic.state === "errored" || (topic.state === "ready" && !topic()))
      navigate(topicPath(props.directory), { replace: true })
  })
  onMount(() => {
    const off = listen((_directory, event) => {
      if (event.type === "topic.updated" && event.properties.topicID === props.topicID) void refetch()
    })
    onCleanup(off)
  })
  const comment = async (content: string) => {
    setSending(true)
    try {
      await call(client(props.directory).topic.comment({ topicID: props.topicID, content }))
      await refetch()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
      throw error
    } finally {
      setSending(false)
    }
  }

  return (
    <section class="topic-thread">
      <Show when={topic()} fallback={<div class="topic-thread-loading">{t("coworker.loading")}</div>}>
        {(value) => (
          <>
            <div class="topic-detail-scroll scroll">
              <article class="topic-post">
                <header class="topic-post-author">
                  <AgentAvatar
                    id={value().author.id}
                    name={value().author.type === "user" ? t("topic.user") : value().author.name}
                  />
                  <span>
                    <strong>{value().author.type === "user" ? t("topic.user") : value().author.name}</strong>
                    <small>{ago(value().createdAt)}</small>
                  </span>
                  <div class="topic-participants">
                    <span class="topic-avatar-stack">
                      <For each={value().participants}>
                        {(participant) => <AgentAvatar id={participant.coworkerID} name={participant.name} />}
                      </For>
                    </span>
                    <span>{t("topic.participants", { count: value().participants.length + 1 })}</span>
                  </div>
                </header>
                <h2>{value().title}</h2>
                <div class="topic-post-body markdown selectable">
                  <Markdown text={value().body} />
                </div>
              </article>

              <section class="topic-comments" aria-label={t("topic.comments", { count: value().comments.length })}>
                <header class="topic-comments-head">
                  <span>{t("topic.comments", { count: value().comments.length })}</span>
                  <Show when={value().working.length}>
                    <span class="topic-thinking">
                      {value()
                        .working.map((item) => t("topic.thinking", { name: item.name }))
                        .join(" · ")}
                    </span>
                  </Show>
                </header>
                <For each={value().comments} fallback={<div class="topic-no-comments">{t("topic.noComments")}</div>}>
                  {(item) => {
                    const role = () =>
                      value().participants.find((participant) => participant.coworkerID === item.author.id)?.duty ??
                      t("topic.owner")
                    return (
                      <article class="topic-comment">
                        <AgentAvatar
                          id={item.author.id}
                          name={item.author.type === "user" ? t("topic.user") : item.author.name}
                        />
                        <div class="topic-comment-main">
                          <header>
                            <strong>{item.author.type === "user" ? t("topic.user") : item.author.name}</strong>
                            <span>{item.author.type === "user" ? t("topic.owner") : role()}</span>
                            <time>{ago(item.createdAt)}</time>
                          </header>
                          <div class="markdown selectable">
                            <Markdown text={item.content} />
                          </div>
                        </div>
                      </article>
                    )
                  }}
                </For>
              </section>
            </div>
            <div class="topic-compose-wrap">
              <TopicComposer participants={value().participants} busy={sending()} onSubmit={comment} />
            </div>
          </>
        )}
      </Show>
    </section>
  )
}

/** Routed topic application: forum-style topics with posts and agent comments */
export function TopicWorkspace() {
  const params = useParams()
  const navigate = useNavigate()
  const directory = createMemo(() => decodeDir(params.dir ?? ""))
  const [query, setQuery] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [topics, { refetch }] = createResource(directory, (value) => call(client(value).topic.list()))

  createEffect(() => {
    const dir = directory()
    if (!dir) return
    void openFolder(dir)
  })
  onMount(() => {
    const off = listen((_directory, event) => {
      if (event.type === "topic.updated") void refetch()
    })
    onCleanup(off)
  })

  return (
    <Show when={directory()} fallback={<Navigate href="/" />}>
      {(dir) => (
        <div class="app">
          <nav class="sidebar sidebar-topics" aria-label={t("topic.title")}>
            <PrimaryNav directory={dir()} active="topics" />
          </nav>
          <Frame title={<span class="title">{t("topic.title")}</span>} directory={dir()} folder={dir()} tools={false}>
            <div class="topic-workspace">
              <TopicList
                current={params.id}
                topics={topics() ?? []}
                query={query()}
                onQuery={setQuery}
                onCreate={() => setCreating(true)}
                onSelect={(id) => navigate(topicPath(dir(), id))}
              />
              <Show
                when={params.id}
                fallback={
                  <div class="topic-welcome">
                    <span class="topic-welcome-icon">
                      <MessagesSquare class="icon" />
                    </span>
                    <h2>{t("topic.title")}</h2>
                    <p>{t("topic.select")}</p>
                    <button class="button primary" onClick={() => setCreating(true)}>
                      <Plus class="icon" />
                      {t("topic.new")}
                    </button>
                  </div>
                }
              >
                {(topicID) => <TopicDiscussion directory={dir()} topicID={topicID()} />}
              </Show>
            </div>
          </Frame>
          <TopicCreate
            directory={dir()}
            open={creating()}
            onClose={() => setCreating(false)}
            onCreated={(id) => {
              void refetch()
              navigate(topicPath(dir(), id))
            }}
          />
        </div>
      )}
    </Show>
  )
}
