import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { SessionStore } from "../session/store"
import { z } from "zod"
import { Text } from "../util/text"
import {
  GroupError,
  addResult,
  addSeat,
  createGroup,
  normalizeGroup,
  removeSeat,
  setPrivateSession,
  updateSeat,
  type Group,
  type Result,
  type SeatInput,
} from "./board"
import {
  Mode,
  Status,
  applySop as compileSop,
  assignReady,
  createTask as makeTask,
  finish,
  normalizeMode,
  recompute,
  removeTask as dropTask,
  start,
  updateTask as patchTask,
  type Message,
  type Sop,
  type Task,
  type TaskInput,
  type TaskPatch,
} from "./scheduler"

/** A group record changed; the chat reloads it */
export const Updated = BusEvent.define(
  "collaboration.updated",
  z.object({
    sessionID: z.string(),
  }),
)

const key = (sessionID: string) => ["collaboration", sessionID]

async function published(sessionID: string, group: Group) {
  if (Instance.has()) await Bus.publish(Updated, { sessionID }).catch(() => undefined)
  return group
}

/** Applies a change to the stored group in one transaction, so concurrent changes are not lost */
async function mutate(sessionID: string, fn: (group: Group) => Group) {
  if (!(await load(sessionID))) throw new GroupError({ zh: "没有这个群", en: "Group not found" })
  const group = await Storage.update<Group>(key(sessionID), (draft) => {
    Object.assign(draft, fn(normalizeGroup(draft as Group)))
  })
  return published(sessionID, group)
}

export async function load(sessionID: string) {
  return Storage.read<Group>(key(sessionID))
    .then((group) => normalizeGroup(group))
    .catch(() => undefined)
}

/** Groups of every project with their sessions, most recently active first */
export async function all() {
  const sessions = SessionStore.search({ roots: true }).filter(({ session }) => session.metadata?.group === true)
  const found = await Promise.all(sessions.map(async ({ session }) => ({ session, group: await load(session.id) })))
  return found.flatMap(({ session, group }) => (group ? [{ session, group }] : []))
}

export async function open(sessionID: string) {
  const group = await load(sessionID)
  if (!group) throw new GroupError({ zh: "没有这个群", en: "Group not found" })
  return group
}

export async function create(
  sessionID: string,
  input: { leader: SeatInput; seats?: (SeatInput & { product: string })[]; scheduler?: Mode },
  baseline: string[] = [],
) {
  const group = { ...createGroup(input.leader, input.seats, normalizeMode(input.scheduler)), baseline }
  await Storage.write(key(sessionID), group)
  return published(sessionID, group)
}

export async function join(sessionID: string, input: SeatInput & { product: string }) {
  return mutate(sessionID, (group) => addSeat(group, input))
}

export async function leave(sessionID: string, seatID: string) {
  return mutate(sessionID, (group) => removeSeat(group, seatID))
}

export async function update(sessionID: string, seatID: string, input: Partial<SeatInput>) {
  return mutate(sessionID, (group) => updateSeat(group, seatID, input))
}

/** Keeps the session id a member's product returned, so its next task resumes it */
export async function remember(sessionID: string, seatID: string, privateSessionID: string) {
  return mutate(sessionID, (group) => setPrivateSession(group, seatID, privateSessionID))
}

export async function record(sessionID: string, result: Omit<Result, "at">) {
  return mutate(sessionID, (group) => addResult(group, result))
}

export async function schedule(sessionID: string, mode: Mode, sop?: string) {
  return mutate(sessionID, (group) => ({
    ...group,
    scheduler: normalizeMode(mode),
    ...(sop ? { sop } : {}),
    tasks: recompute(normalizeMode(mode), group.tasks),
  }))
}

export async function addTask(sessionID: string, input: TaskInput, createdBy = "user", depth = 0) {
  return mutate(sessionID, (group) => {
    const task = makeTask(input, {
      mode: group.scheduler,
      tasks: group.tasks,
      createdBy,
      depth,
    })
    return { ...group, tasks: recompute(group.scheduler, [...group.tasks, task]) }
  })
}

export async function changeTask(sessionID: string, taskID: string, patch: TaskPatch) {
  return mutate(sessionID, (group) => ({
    ...group,
    tasks: patchTask(group.scheduler, group.tasks, taskID, patch),
  }))
}

export async function removeTask(sessionID: string, taskID: string) {
  return mutate(sessionID, (group) => ({
    ...group,
    tasks: dropTask(group.scheduler, group.tasks, taskID),
  }))
}

export async function applySop(sessionID: string, sop: Sop) {
  const lang = await Text.lang()
  return mutate(sessionID, (group) => {
    const result = compileSop(group.scheduler, group.tasks, sop, "user", lang)
    return { ...group, ...result }
  })
}

/** Makes every currently runnable task ready and assigns it to the least-loaded member. */
export async function prepareTasks(sessionID: string) {
  return mutate(sessionID, (group) => ({
    ...group,
    tasks: assignReady(group.scheduler, group.tasks, group.seats),
  }))
}

/** Claims a task for the member that is about to run it; the admission layer handles file conflicts separately. */
export async function startTask(sessionID: string, taskID: string, assignee: string) {
  return mutate(sessionID, (group) => ({
    ...group,
    tasks: start(group.scheduler, group.tasks, taskID, assignee),
  }))
}

export async function finishTask(
  sessionID: string,
  taskID: string,
  result: { result: string } | { error: string },
) {
  return mutate(sessionID, (group) => ({
    ...group,
    tasks: finish(group.scheduler, group.tasks, taskID, result),
  }))
}

export async function addMessage(
  sessionID: string,
  input: Omit<Message, "id" | "at">,
  at = Date.now(),
) {
  return mutate(sessionID, (group) => ({
    ...group,
    messages: [...group.messages, { ...input, id: crypto.randomUUID(), at }],
  }))
}

export async function resetTask(sessionID: string, taskID: string) {
  return mutate(sessionID, (group) => ({
    ...group,
    tasks: recompute(
      group.scheduler,
      group.tasks.map((task) =>
        task.id === taskID && (task.status === Status.Failed || task.status === Status.Cancelled)
          ? {
              ...task,
              status: Status.Backlog,
              assignee: undefined,
              startedAt: undefined,
              finishedAt: undefined,
              error: undefined,
            }
          : task,
      ),
    ),
  }))
}

export type { Task }
