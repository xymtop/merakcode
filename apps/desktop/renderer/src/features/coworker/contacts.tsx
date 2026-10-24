import type { Coworker } from "@merakcode/sdk/client"
import BookUser from "lucide-solid/icons/book-user"
import MessageSquare from "lucide-solid/icons/message-square"
import Plus from "lucide-solid/icons/plus"
import Settings2 from "lucide-solid/icons/settings-2"
import FolderTree from "lucide-solid/icons/folder-tree"
import { createResource, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { t } from "../../i18n"
import { coworkerChatPath, coworkerPath } from "../../lib/route"
import { call, client } from "../../state/client"
import { toast } from "../../ui/toast"
import { CoworkerCreate } from "./create"
import { startCoworkerChat } from "./start-chat"

export function Contacts(props: { directory: string; current?: string }) {
  const navigate = useNavigate()
  const [creating, setCreating] = createSignal(false)
  const [list, { refetch }] = createResource(
    () => props.directory,
    (directory) => call(client(directory).coworker.list()),
  )

  const chat = async (item: Coworker) => {
    try {
      const session = await startCoworkerChat(props.directory, item.id, item.name)
      navigate(coworkerChatPath(props.directory, item.id, session.id))
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  return (
    <div class="coworker-contacts">
      <div class="coworker-contacts-head">
        <div class="sessions-title">
          <BookUser class="icon icon-sm" />
          <span>{t("coworker.contacts")}</span>
        </div>
        <button class="button ghost sm" onClick={() => setCreating(true)} title={t("coworker.create.title")}>
          <Plus class="icon icon-sm" />
        </button>
      </div>
      <div class="sessions-scroll scroll">
        <For
          each={list() ?? []}
          fallback={
            <div class="sessions-empty subtle">
              {list.loading ? t("coworker.loading") : t("coworker.contacts.empty")}
            </div>
          }
        >
          {(item) => (
            <div class="coworker-card" data-active={props.current === item.id ? "true" : undefined}>
              <button class="coworker-card-main" onClick={() => navigate(coworkerPath(props.directory, item.id))}>
                <span class="coworker-card-name ellipsis">{item.name}</span>
                <Show when={item.duty}>
                  <span class="coworker-card-duty ellipsis subtle">{item.duty}</span>
                </Show>
              </button>
              <div class="coworker-card-actions">
                <button class="button ghost sm" title={t("coworker.chat")} onClick={() => void chat(item)}>
                  <MessageSquare class="icon icon-sm" />
                </button>
                <button
                  class="button ghost sm"
                  title={t("coworker.world")}
                  onClick={() => navigate(coworkerPath(props.directory, item.id, "world"))}
                >
                  <FolderTree class="icon icon-sm" />
                </button>
                <button
                  class="button ghost sm"
                  title={t("coworker.bindings")}
                  onClick={() => navigate(coworkerPath(props.directory, item.id, "bindings"))}
                >
                  <Settings2 class="icon icon-sm" />
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
      <CoworkerCreate
        directory={props.directory}
        open={creating()}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void refetch()
          navigate(coworkerPath(props.directory, id))
        }}
      />
    </div>
  )
}
