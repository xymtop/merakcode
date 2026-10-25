import type { CollaborationGroup, Coworker, PermissionMode } from "@merakcode/sdk/client"
import ChevronsLeft from "lucide-solid/icons/chevrons-left"
import ChevronsRight from "lucide-solid/icons/chevrons-right"
import Plus from "lucide-solid/icons/plus"
import { createSignal, For, Show } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { choice } from "../../state/models"
import { Confirm } from "../../ui/dialog"
import { Segmented } from "../../ui/segmented"
import { toast } from "../../ui/toast"
import { modeOptions } from "./composer"
import { Avatar, MemberList, type Product, type Seat } from "./members"

/** Members of a group conversation, beside the chat; collapses to a strip of avatars */
export function MemberColumn(props: {
  sessionID: string
  directory: string
  group: CollaborationGroup
  products: readonly Product[]
  coworkers?: readonly Coworker[]
  busy: (seatID: string) => boolean
  collapsed: boolean
  onCollapsed: (collapsed: boolean) => void
  /** Opens a member, or the add form when target is "new" */
  open?: { target: string; at: number }
  /** Expands the column on a member, or on the add form when target is "new" */
  onOpen: (request: { target: string; at: number }) => void
  onMode?: (mode: PermissionMode) => void
  onSchedule?: (mode: CollaborationGroup["scheduler"]) => void
}) {
  const mode = () => choice(props.sessionID, props.directory).mode
  const [removing, setRemoving] = createSignal<Seat>()
  const api = () => client(props.directory)
  // The record reloads on its own when the change is published; a failure keeps the form open
  const apply = (request: Promise<unknown>) =>
    request.catch((error: Error) => {
      toast({ kind: "error", title: t("error.request", { message: error.message }), error })
      throw error
    })
  const expand = (target: string) => props.onOpen({ target, at: Date.now() })

  return (
    <aside class="members" classList={{ collapsed: props.collapsed }} aria-label={t("group.column")}>
      <div class="members-head">
        <Show when={!props.collapsed}>
          <span class="members-title">{t("group.column.title")}</span>
        </Show>
        <button
          class="icon-button sm"
          aria-label={props.collapsed ? t("group.expand") : t("group.collapse")}
          title={props.collapsed ? t("group.expand") : t("group.collapse")}
          onClick={() => props.onCollapsed(!props.collapsed)}
        >
          {props.collapsed ? <ChevronsLeft class="icon icon-sm" /> : <ChevronsRight class="icon icon-sm" />}
        </button>
      </div>
      <Show
        when={!props.collapsed}
        fallback={
          <div class="members-strip">
            <For each={props.group.seats}>
              {(seat) => (
                <button class="members-face" aria-label={seat.name} title={seat.name} onClick={() => expand(seat.id)}>
                  <Avatar id={seat.id} name={seat.name} />
                  <Show when={props.busy(seat.id)}>
                    <span class="member-busy" />
                  </Show>
                </button>
              )}
            </For>
            <button
              class="icon-button sm"
              aria-label={t("group.addMember")}
              title={t("group.addMember")}
              onClick={() => expand("new")}
            >
              <Plus class="icon icon-sm" />
            </button>
          </div>
        }
      >
        <div class="members-body scroll">
          <div class="members-mode">
            <span class="members-mode-label">{t("group.schedule")}</span>
            <p class="members-mode-desc">{t("group.schedule.desc")}</p>
            <Segmented
              label={t("group.schedule")}
              options={[
                {
                  value: "owner",
                  label: t("group.schedule.owner"),
                  hint: t("group.schedule.ownerDesc"),
                },
                {
                  value: "pool",
                  label: t("group.schedule.pool"),
                  hint: t("group.schedule.poolDesc"),
                },
                {
                  value: "dag",
                  label: t("group.schedule.dag"),
                  hint: t("group.schedule.dagDesc"),
                },
              ]}
              value={props.group.scheduler}
              onChange={(value) => props.onSchedule?.(value)}
            />
          </div>
          <div class="members-mode">
            <span class="members-mode-label">{t("mode.label")}</span>
            <p class="members-mode-desc">{t("group.permission.desc")}</p>
            <Segmented
              label={t("mode.label")}
              options={modeOptions()}
              value={mode()}
              onChange={(value) => props.onMode?.(value)}
            />
          </div>
          <MemberList
            seats={props.group.seats}
            products={props.products}
            coworkers={props.coworkers}
            busy={props.busy}
            open={props.open}
            onSave={(seat, draft) =>
              apply(
                call(
                  api().collaboration.seat.update({
                    sessionID: props.sessionID,
                    seatID: seat.id,
                    name: draft.name,
                    role: draft.role,
                    duty: draft.duty,
                  }),
                ),
              )
            }
            onAdd={(draft) => apply(call(api().collaboration.seat.add({ sessionID: props.sessionID, ...draft })))}
            onRemove={setRemoving}
          />
        </div>
      </Show>
      <Confirm
        open={!!removing()}
        title={t("group.removeTitle", { name: removing()?.name ?? "" })}
        description={t("group.removeDetail", { name: removing()?.name ?? "" })}
        confirm={t("group.remove")}
        cancel={t("common.cancel")}
        danger
        onResult={(ok) => {
          const seat = removing()
          setRemoving(undefined)
          if (!ok || !seat) return
          void apply(call(api().collaboration.seat.remove({ sessionID: props.sessionID, seatID: seat.id }))).catch(
            () => undefined,
          )
        }}
      />
    </aside>
  )
}
