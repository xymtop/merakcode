import path from "path"
import { Filesystem } from "@merakcode/util/filesystem"
import { Text } from "../util/text"
import { CoworkerBindings } from "./bindings"
import { CoworkerPath } from "./path"

export namespace CoworkerSkeleton {
  async function slotReadme(title: Text.Pair, body: Text.Pair) {
    const lang = await Text.lang()
    return `# ${title[lang]}\n\n${body[lang]}\n`
  }

  export async function create(input: { id: string; name: string; duty: string }) {
    const dir = CoworkerPath.coworkerDir(input.id)
    if (await Filesystem.exists(dir)) {
      throw new Error(`coworker already exists: ${input.id}`)
    }

    const profile = `# ${input.name}\n\n${input.duty.trim() || (await Text.pick({ zh: "一句话职责待补充。", en: "Duty TBD." }))}\n`
    await Filesystem.write(CoworkerPath.profile(input.id), profile)
    await CoworkerBindings.write(input.id, CoworkerBindings.empty())

    await Filesystem.write(
      path.join(CoworkerPath.dutyDir(input.id), "README.md"),
      await slotReadme(
        { zh: "职责与目标", en: "Duty & goals" },
        {
          zh: input.duty.trim() || "在此填写详细工作说明。",
          en: input.duty.trim() || "Write the detailed duty here.",
        },
      ),
    )
    await Filesystem.write(
      path.join(CoworkerPath.rulesDir(input.id), "README.md"),
      await slotReadme(
        { zh: "规则与边界", en: "Rules & boundaries" },
        { zh: "在此填写该同事应遵守的规则。", en: "Write rules this coworker should follow." },
      ),
    )
    await Filesystem.write(
      path.join(CoworkerPath.memoryDir(input.id), "README.md"),
      await slotReadme(
        { zh: "长期记忆", en: "Long-term memory" },
        { zh: "偏好、反馈与跨会话要点。", en: "Preferences, feedback, and cross-session notes." },
      ),
    )
    await Filesystem.write(path.join(CoworkerPath.factsDir(input.id), ".gitkeep"), "")
    await Filesystem.write(path.join(CoworkerPath.decisionsDir(input.id), ".gitkeep"), "")
  }
}
