import { createEffect, createSignal, on } from "solid-js"
import { t } from "../../i18n"
import { call, client } from "../../state/client"
import { Dialog } from "../../ui/dialog"
import { toast } from "../../ui/toast"

export function CoworkerCreate(props: {
  directory: string
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = createSignal("")
  const [duty, setDuty] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
        setName("")
        setDuty("")
      },
    ),
  )

  const create = async () => {
    const trimmed = name().trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const created = await call(
        client(props.directory).coworker.create({
          name: trimmed,
          duty: duty().trim() || undefined,
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
      <label class="field">
        <span>{t("coworker.create.name")}</span>
        <input class="input" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
      </label>
      <label class="field">
        <span>{t("coworker.create.duty")}</span>
        <textarea class="input" rows={3} value={duty()} onInput={(e) => setDuty(e.currentTarget.value)} />
      </label>
    </Dialog>
  )
}
