import type { CoworkerWorldNode } from "@merakcode/sdk/client"
import ChevronRight from "lucide-solid/icons/chevron-right"
import FilePlus from "lucide-solid/icons/file-plus"
import FolderPlus from "lucide-solid/icons/folder-plus"
import Search from "lucide-solid/icons/search"
import Trash2 from "lucide-solid/icons/trash"
import { createEffect, createResource, createSignal, For, Show } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { Confirm } from "../../ui/dialog"
import { toast } from "../../ui/toast"

const SLOT_ROOTS = new Set(["01-duty", "02-rules", "03-memory", "04-facts", "05-decisions"])

function TreeNode(props: {
  node: CoworkerWorldNode
  selected?: string
  onSelect: (relative: string) => void
  depth?: number
}) {
  const [open, setOpen] = createSignal(true)
  const depth = () => props.depth ?? 0
  return (
    <div class="coworker-tree-node">
      <button
        class="coworker-tree-row"
        style={{ "padding-left": `${8 + depth() * 12}px` }}
        data-active={props.selected === props.node.relative ? "true" : undefined}
        onClick={() => {
          if (props.node.type === "directory") setOpen(!open())
          else props.onSelect(props.node.relative)
        }}
      >
        <Show when={props.node.type === "directory"}>
          <ChevronRight class="icon icon-sm" style={{ transform: open() ? "rotate(90deg)" : undefined }} />
        </Show>
        <span class="ellipsis">{props.node.name}</span>
      </button>
      <Show when={props.node.type === "directory" && open()}>
        <For each={props.node.children ?? []}>
          {(child) => <TreeNode node={child} selected={props.selected} onSelect={props.onSelect} depth={depth() + 1} />}
        </For>
      </Show>
    </div>
  )
}

export function WorldEditor(props: { directory: string; coworkerID: string }) {
  const c = () => client(props.directory).coworker
  const [selected, setSelected] = createSignal<string>()
  const [content, setContent] = createSignal("")
  const [dirty, setDirty] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [removing, setRemoving] = createSignal<string>()
  const [tree, { refetch: refetchTree }] = createResource(
    () => ({ directory: props.directory, id: props.coworkerID }),
    ({ id }) => call(c().world.tree({ coworkerID: id })),
  )
  const [hits] = createResource(
    () => ({ q: query().trim(), id: props.coworkerID, directory: props.directory }),
    async ({ q, id }) => {
      if (!q) return []
      return call(c().world.search({ coworkerID: id, q }))
    },
  )

  const loadFile = async (relative: string) => {
    if (dirty() && !confirm(t("coworker.world.discard"))) return
    try {
      const file = await call(c().world.read({ coworkerID: props.coworkerID, path: relative }))
      setSelected(relative)
      setContent(file.content)
      setDirty(false)
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  createEffect(() => {
    props.coworkerID
    setSelected(undefined)
    setContent("")
    setDirty(false)
    setQuery("")
  })

  const save = async () => {
    const path = selected()
    if (!path) return
    try {
      await call(c().world.write({ coworkerID: props.coworkerID, path, content: content() }))
      setDirty(false)
      toast({ kind: "success", title: t("coworker.world.saved") })
      void refetchTree()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  const parentDir = () => {
    const path = selected()
    if (!path) return "04-facts"
    if (path.includes("/")) return path.slice(0, path.lastIndexOf("/"))
    return path
  }

  const createFile = async () => {
    const name = prompt(t("coworker.world.newFilePrompt"))
    if (!name?.trim()) return
    const file = name.trim().endsWith(".md") ? name.trim() : `${name.trim()}.md`
    const path = `${parentDir()}/${file}`.replace(/\/+/g, "/")
    try {
      await call(c().world.createFile({ coworkerID: props.coworkerID, path }))
      void refetchTree()
      await loadFile(path)
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  const createFolder = async () => {
    const name = prompt(t("coworker.world.newFolderPrompt"))
    if (!name?.trim()) return
    const path = `${parentDir()}/${name.trim()}`.replace(/\/+/g, "/")
    try {
      await call(c().world.mkdir({ coworkerID: props.coworkerID, path }))
      void refetchTree()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  const remove = async (ok: boolean) => {
    const path = removing()
    setRemoving(undefined)
    if (!ok || !path) return
    if (SLOT_ROOTS.has(path)) {
      toast({ kind: "error", title: t("coworker.world.slotWarn") })
      return
    }
    try {
      await call(c().world.remove({ coworkerID: props.coworkerID, path }))
      if (selected() === path || selected()?.startsWith(`${path}/`)) {
        setSelected(undefined)
        setContent("")
        setDirty(false)
      }
      void refetchTree()
    } catch (error) {
      toast({ kind: "error", title: t("error.request", { message: (error as Error).message }) })
    }
  }

  return (
    <div class="coworker-world">
      <aside class="coworker-world-side">
        <div class="coworker-world-toolbar">
          <label class="coworker-search">
            <Search class="icon icon-sm" />
            <input
              class="input"
              placeholder={t("coworker.world.search")}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
          <button class="button ghost sm" title={t("coworker.world.newFile")} onClick={() => void createFile()}>
            <FilePlus class="icon icon-sm" />
          </button>
          <button class="button ghost sm" title={t("coworker.world.newFolder")} onClick={() => void createFolder()}>
            <FolderPlus class="icon icon-sm" />
          </button>
          <button
            class="button ghost sm"
            title={t("common.remove")}
            disabled={!selected()}
            onClick={() => selected() && setRemoving(selected())}
          >
            <Trash2 class="icon icon-sm" />
          </button>
        </div>
        <Show
          when={query().trim()}
          fallback={
            <div class="coworker-tree scroll">
              <For each={tree() ?? []} fallback={<div class="subtle">{t("coworker.loading")}</div>}>
                {(node) => <TreeNode node={node} selected={selected()} onSelect={(p) => void loadFile(p)} />}
              </For>
            </div>
          }
        >
          <div class="coworker-tree scroll">
            <For each={hits() ?? []} fallback={<div class="subtle">{t("coworker.world.noHits")}</div>}>
              {(hit) => (
                <button class="coworker-tree-row" onClick={() => void loadFile(hit.relative)}>
                  <span class="ellipsis">{hit.relative}</span>
                  <span class="subtle">{hit.kind}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </aside>
      <div class="coworker-world-editor">
        <Show when={selected()} fallback={<div class="coworker-world-empty subtle">{t("coworker.world.pick")}</div>}>
          <div class="coworker-world-editor-head">
            <span class="ellipsis">{selected()}</span>
            <button class="button primary sm" disabled={!dirty()} onClick={() => void save()}>
              {t("common.save")}
            </button>
          </div>
          <textarea
            class="coworker-world-textarea"
            value={content()}
            onInput={(e) => {
              setContent(e.currentTarget.value)
              setDirty(true)
            }}
          />
        </Show>
      </div>
      <Confirm
        open={!!removing()}
        title={t("coworker.world.deleteTitle")}
        description={
          removing() && SLOT_ROOTS.has(removing()!.split("/")[0]!)
            ? t("coworker.world.slotWarn")
            : t("coworker.world.deleteDetail", { path: removing() ?? "" })
        }
        confirm={t("common.remove")}
        cancel={t("common.cancel")}
        danger
        onResult={(ok) => void remove(ok)}
      />
    </div>
  )
}
