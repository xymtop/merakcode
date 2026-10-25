import path from "path"
import { Instance } from "../project/instance"

/** Disk layout for all-chat coworkers under the project. */
export namespace CoworkerPath {
  export const ROOT_SEGMENTS = [".merakcode", "coworkers"] as const
  export const TRASH = ".trash"
  export const PROFILE = "PROFILE.md"
  export const BINDINGS = "bindings.json"
  export const A2A = "a2a.json"
  export const WORLD = "world"
  export const DUTY = "01-duty"
  export const RULES = "02-rules"
  export const MEMORY = "03-memory"
  export const FACTS = "04-facts"
  export const DECISIONS = "05-decisions"

  export function root() {
    return path.join(Instance.directory, ...ROOT_SEGMENTS)
  }

  export function trashRoot() {
    return path.join(root(), TRASH)
  }

  export function coworkerDir(id: string) {
    return path.join(root(), id)
  }

  export function profile(id: string) {
    return path.join(coworkerDir(id), PROFILE)
  }

  export function bindings(id: string) {
    return path.join(coworkerDir(id), BINDINGS)
  }

  export function a2a(id: string) {
    return path.join(coworkerDir(id), A2A)
  }

  export function worldRoot(id: string) {
    return path.join(coworkerDir(id), WORLD)
  }

  export function dutyDir(id: string) {
    return path.join(worldRoot(id), DUTY)
  }

  export function rulesDir(id: string) {
    return path.join(worldRoot(id), RULES)
  }

  export function memoryDir(id: string) {
    return path.join(worldRoot(id), MEMORY)
  }

  export function factsDir(id: string) {
    return path.join(worldRoot(id), FACTS)
  }

  export function decisionsDir(id: string) {
    return path.join(worldRoot(id), DECISIONS)
  }

  export function agentMd(id: string) {
    return path.join(Instance.directory, ".merakcode", "agents", `${id}.md`)
  }

  export function projectRulesDir() {
    return path.join(Instance.directory, ".merakcode", "rules")
  }

  /** Synced rule files for one coworker: coworker-<id>-*.mdc */
  export function syncedRulePrefix(id: string) {
    return `coworker-${id}-`
  }

  export function isUnsafePath(filePath: string) {
    if (filePath.includes("\0")) return true
    if (/^[\\/]{2}/.test(filePath)) return true
    if (/^[A-Za-z]:$/.test(filePath)) return true
    return false
  }

  /** Relative path stays inside base (no traversal). */
  export function isInside(base: string, filePath: string) {
    if (isUnsafePath(filePath)) return false
    const rootAbs = path.resolve(base)
    const target = path.resolve(filePath)
    const relative = path.relative(rootAbs, target)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }
}
