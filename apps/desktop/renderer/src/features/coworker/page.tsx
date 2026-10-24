import ArrowLeft from "lucide-solid/icons/arrow-left"
import MessageSquare from "lucide-solid/icons/message-square"
import { createEffect, createMemo, createResource, Match, Show, Switch, untrack } from "solid-js"
import { A, Navigate, useNavigate, useParams } from "@solidjs/router"
import { t } from "../../i18n"
import { decodeDir, coworkerChatPath, coworkerPath } from "../../lib/route"
import { call, client } from "../../state/client"
import { openFolder } from "../../state/store"
import { ui } from "../../state/ui"
import { Frame } from "../shell/frame"
import { PrimaryNav } from "../shell/sidebar"
import { toast } from "../../ui/toast"
import { Conversation } from "../conversation/page"
import { BindingsEditor } from "./bindings"
import { Contacts } from "./contacts"
import { startCoworkerChat } from "./start-chat"
import { WorldEditor } from "./world"

function CoworkerShell(props: {
  directory: string
  coworkerID?: string
  tab?: "world" | "bindings"
  sessionID?: string
}) {
  const navigate = useNavigate()
  const [info] = createResource(
    () => (props.coworkerID ? { directory: props.directory, id: props.coworkerID } : undefined),
    (key) => (key ? call(client(key.directory).coworker.get({ coworkerID: key.id })) : undefined),
  )

  const chat = async () => {
    if (!props.coworkerID) return
    try {
      const session = await startCoworkerChat(props.directory, props.coworkerID, info()?.name)
      navigate(coworkerChatPath(props.directory, props.coworkerID, session.id))
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  return (
    <div class="app">
      <Show when={!ui.maximized}>
        <nav class="sidebar" aria-label={t("coworker.nav")}>
          <PrimaryNav directory={props.directory} active="coworker" />
          <Contacts directory={props.directory} current={props.coworkerID} />
        </nav>
      </Show>
      <Show
        when={props.coworkerID}
        fallback={
          <Frame
            title={<span class="title">{t("coworker.contacts")}</span>}
            directory={props.directory}
            folder={props.directory}
          >
            <div class="coworker-home">
              <h1 class="compose-heading">{t("coworker.home.title")}</h1>
              <p class="compose-lead">{t("coworker.home.lead")}</p>
            </div>
          </Frame>
        }
      >
        {(id) => (
          <Show
            when={props.sessionID}
            fallback={
              <Frame
                title={
                  <span class="title row">
                    <A class="icon-button" href={coworkerPath(props.directory)} aria-label={t("coworker.back")}>
                      <ArrowLeft class="icon" />
                    </A>
                    <span class="ellipsis">{info()?.name ?? id()}</span>
                  </span>
                }
                directory={props.directory}
                folder={props.directory}
                actions={
                  <button class="button secondary sm" onClick={() => void chat()}>
                    <MessageSquare class="icon icon-sm" />
                    {t("coworker.chat")}
                  </button>
                }
              >
                <div class="coworker-detail">
                  <div class="coworker-tabs">
                    <A
                      href={coworkerPath(props.directory, id(), "world")}
                      class="coworker-tab"
                      aria-current={(!props.tab || props.tab === "world") && !props.sessionID ? "page" : undefined}
                    >
                      {t("coworker.world")}
                    </A>
                    <A
                      href={coworkerPath(props.directory, id(), "bindings")}
                      class="coworker-tab"
                      aria-current={props.tab === "bindings" ? "page" : undefined}
                    >
                      {t("coworker.bindings")}
                    </A>
                  </div>
                  <Switch>
                    <Match when={props.tab === "bindings"}>
                      <BindingsEditor directory={props.directory} coworkerID={id()} />
                    </Match>
                    <Match when={true}>
                      <WorldEditor directory={props.directory} coworkerID={id()} />
                    </Match>
                  </Switch>
                </div>
              </Frame>
            }
          >
            {(sessionID) => <Conversation id={sessionID()} directory={props.directory} />}
          </Show>
        )}
      </Show>
    </div>
  )
}

/** Routed all-chat workspace */
export function CoworkerWorkspace() {
  const params = useParams()
  const directory = createMemo(() => decodeDir(params.dir ?? ""))
  createEffect(() => {
    const dir = directory()
    if (!dir) return
    untrack(() => {
      void openFolder(dir)
    })
  })
  const tab = createMemo((): "world" | "bindings" | undefined => {
    if (params.tab === "bindings") return "bindings"
    if (params.tab === "world") return "world"
    return undefined
  })
  return (
    <Show when={directory()} fallback={<Navigate href="/" />}>
      {(dir) => (
        <CoworkerShell directory={dir()} coworkerID={params.coworkerID} tab={tab()} sessionID={params.sessionID} />
      )}
    </Show>
  )
}
