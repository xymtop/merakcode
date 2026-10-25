import { render } from "solid-js/web"
import { afterEach, beforeEach, expect, test } from "vitest"
import { setLocale } from "../../i18n"
import { Composer } from "./composer"

let cleanup = () => {}

beforeEach(() => setLocale("zh"))

afterEach(() => {
  cleanup()
  cleanup = () => {}
})

function mount(flags: { hideModelControls?: boolean; hidePermissionControls?: boolean } = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <Composer
        directory="/project"
        busy={false}
        hideModelControls={flags.hideModelControls}
        hidePermissionControls={flags.hidePermissionControls}
        onSubmit={() => undefined}
      />
    ),
    host,
  )
  cleanup = () => {
    dispose()
    host.remove()
  }
  return host
}

test("group chats hide model and permission controls", () => {
  const host = mount({ hideModelControls: true, hidePermissionControls: true })
  const bar = host.querySelector(".composer-bar")!
  expect(bar.textContent).not.toContain("询问")
  expect(bar.textContent).not.toContain("推理")
  expect(bar.querySelector('[aria-label="权限模式"]')).toBeNull()
})

test("coworker chats hide model controls but keep permission mode", () => {
  const host = mount({ hideModelControls: true })
  const bar = host.querySelector(".composer-bar")!
  expect(bar.textContent).not.toContain("推理")
  expect(bar.querySelector('[aria-label="权限模式"]')).not.toBeNull()
})

test("ordinary chats show permission mode", () => {
  const host = mount()
  expect(host.querySelector('.composer-bar [aria-label="权限模式"]')).not.toBeNull()
})
