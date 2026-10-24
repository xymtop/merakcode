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

function mount(hideModelControls: boolean) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <Composer directory="/project" busy={false} hideModelControls={hideModelControls} onSubmit={() => undefined} />
    ),
    host,
  )
  cleanup = () => {
    dispose()
    host.remove()
  }
  return host
}

test("coworker and group chats hide model, reasoning, and permission controls", () => {
  const hidden = mount(true)
  const hiddenBar = hidden.querySelector(".composer-bar")!
  expect(hiddenBar.textContent).not.toContain("询问")
  expect(hiddenBar.textContent).not.toContain("推理")
  expect(hiddenBar.querySelector('[aria-label="权限模式"]')).toBeNull()
  cleanup()

  const visible = mount(false)
  expect(visible.querySelector('.composer-bar [aria-label="权限模式"]')).not.toBeNull()
})
