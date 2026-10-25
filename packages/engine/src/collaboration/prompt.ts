/** Prompts for a group: what a member reads on stdin. Model-facing text is English; names and duties stay verbatim. */
import type { Group, Seat } from "./board"
import { Mode, Status, type Task } from "./scheduler"

type TodoItem = { content: string; status: string }
type Artifact = { status: string; path: string; owner?: string }

const REQUEST_LIMIT = 4_000
const RESULT_LIMIT = 1_500
const ARTIFACT_LIMIT = 40

export function memberPrompt(input: {
  group: Group
  seat: Seat
  /** Display name of a product id */
  title: (product: string) => string
  request: { id: string; text: string }
  task: string
  paths: string[]
  todos: TodoItem[]
  artifacts: Artifact[]
  selectedTask?: Task
}) {
  const { group, seat } = input
  const leader = group.seats.find((item) => item.leader)
  const others = group.seats.filter((item) => !item.leader && item.id !== seat.id)
  const results = group.results.filter((item) => item.requestID === input.request.id && item.seatID !== seat.id)
  const lines = [
    `You are ${seat.name} (${input.title(seat.product)}), a member of a group chat in MerakCode.${role(seat)}`,
  ]
  if (seat.duty) lines.push("Your duty:", seat.duty)
  lines.push(
    "",
    `The leader is ${leader?.name ?? "the leader"}.${others.length ? ` Other members: ${others.map((item) => `${item.name} (${[input.title(item.product), item.role].filter(Boolean).join(", ")})`).join(", ")}.` : ""}`,
    "You cannot see the group chat. Everything you need is below; your earlier work is in your own session.",
    "You can message other members. Put one message per line at the end of your reply:",
    "- @Name: information to share",
    "- @Name ask: a question that needs an answer",
    "- @Name handoff: work that the other member should now own",
    "Do not start other members yourself. The group scheduler records these messages and decides what runs next.",
    input.paths.length
      ? `Only change files under: ${input.paths.join(", ")}`
      : "No path boundary was given, so no one else changes files while you work.",
    "",
    "User request:",
    clip(input.request.text, REQUEST_LIMIT),
    "",
  )
  if (results.length)
    lines.push("Results so far:", ...results.map((item) => `${item.name}: ${clip(item.text, RESULT_LIMIT)}`), "")
  lines.push(
    "Todo:",
    todoLines(input.todos) || "none",
    "",
    "Changed files:",
    artifactLines(input.artifacts),
    "",
    ...(input.selectedTask
      ? [
          "Selected task:",
          `${input.selectedTask.id} [${input.selectedTask.status}] ${input.selectedTask.title}`,
          input.selectedTask.description || "No additional description.",
          "",
        ]
      : []),
    "Your task:",
    input.task,
  )
  return lines.join("\n")
}

/** Who the leader is and who it can delegate to; changes only when the members do */
export function leaderPrompt(input: { group: Group; title: (product: string) => string }) {
  const leader = input.group.seats.find((seat) => seat.leader)
  if (!leader) return ""
  const members = input.group.seats.filter((seat) => !seat.leader)
  const lines = [`This conversation is a group chat. You are ${leader.name} (MerakCode), the leader.${role(leader)}`]
  if (leader.duty) lines.push("Your duty:", leader.duty)
  lines.push("")
  if (members.length) {
    lines.push("Members (delegate to them by exact name with the delegate tool):")
    for (const seat of members) {
      lines.push(`- ${seat.name} (${[input.title(seat.product), seat.role].filter(Boolean).join(", ")})`)
      if (seat.duty) lines.push(`  Duty: ${seat.duty.replaceAll("\n", "\n  ")}`)
    }
    lines.push(
      "Members cannot see this chat. Give each task what it needs: the goal, the results it depends on, and the paths it may change.",
      "Members can address each other with @ messages; those are for information and do not start work by themselves.",
    )
    if (input.group.scheduler === Mode.Owner) {
      lines.push(
        "You own task decomposition and assignment. Independent tasks with separate paths can be delegated in the same step and run at the same time.",
        "If one task needs another's result, delegate the first, wait for its reply, then delegate the next.",
        "A reply may suggest work for someone else; you decide whether to do it.",
      )
    } else if (input.group.scheduler === Mode.Pool) {
      lines.push(
        "This group uses a task pool. The user owns the pool: do not add, remove or rewrite its tasks.",
        "Run only tasks whose status is ready. Use the delegate tool with the task's id and the member named by assignee.",
        "After a task finishes, continue with any other ready tasks. Stop when no ready task remains.",
      )
    } else {
      lines.push(
        "This group uses a task DAG. The user owns its tasks and dependencies: do not add, remove or rewrite them.",
        "Run only tasks whose status is ready. A finished task unlocks its dependants automatically.",
        "Use the delegate tool with the task's id and the member named by assignee, and continue until no ready task remains.",
      )
    }
  } else lines.push("No members have joined yet, so do the work yourself.")
  if (input.group.scheduler === Mode.Owner)
    lines.push(
      "Keep the group todo current with todowrite: owner as @name, paths in parentheses. Pass the item's id to delegate.",
    )
  if (input.group.tasks.length) lines.push("", "Group tasks:", ...taskLines(input.group.tasks))
  if (input.group.messages.length) {
    const names = new Map(input.group.seats.map((seat) => [seat.id, seat.name]))
    lines.push(
      "",
      "Member messages:",
      ...input.group.messages
        .slice(-20)
        .map(
          (message) =>
            `- ${names.get(message.from) ?? message.from} → ${names.get(message.to) ?? message.to} (${message.kind}): ${clip(message.text, 500)}`,
        ),
    )
  }
  return lines.join("\n")
}

/** Where the group stands: the todo and the files changed so far; changes as the work goes on */
export function groupState(input: {
  mode?: Mode
  tasks?: Task[]
  todos: (TodoItem & { id: string })[]
  artifacts: Artifact[]
}) {
  return [
    ...(input.mode && input.mode !== Mode.Owner
      ? [
          "Ready tasks:",
          (input.tasks ?? [])
            .filter((task) => task.status === Status.Ready)
            .map((task) => `- ${task.id}: ${task.title} → ${task.assignee ?? "unassigned"}`)
            .join("\n") || "none",
          "",
          "Task board:",
          (input.tasks ?? []).map((task) => `- [${task.status}] ${task.id} ${task.title}`).join("\n") || "none",
          "",
        ]
      : []),
    "Todo:",
    input.todos
      .filter((item) => item.status !== "cancelled")
      .map((item) => `${todoLines([item])} (id: ${item.id})`)
      .join("\n") || "none",
    "",
    "Changed files since the group was created:",
    artifactLines(input.artifacts),
  ].join("\n")
}

function taskLines(tasks: Task[]) {
  return tasks.slice(0, 40).map((task) => {
    const dependencies = task.dependencies.length ? ` after ${task.dependencies.join(", ")}` : ""
    const assignee = task.assignee ? `; assignee ${task.assignee}` : ""
    return `- ${task.id} [${task.status}] ${task.title}${dependencies}${assignee}`
  })
}

function role(seat: Seat) {
  return seat.role ? ` Your role: ${seat.role}.` : ""
}

function clip(text: string, limit: number) {
  const value = text.trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/** Checklist marks instead of status words; cancelled items are left out */
function todoLines(todos: TodoItem[]) {
  return todos
    .filter((item) => item.status !== "cancelled")
    .map(
      (item) =>
        `- ${item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[-]" : "[ ]"} ${item.content}`,
    )
    .join("\n")
}

/** Status, path and owner per changed file; past the limit the rest is counted by directory */
export function artifactLines(artifacts: Artifact[]) {
  if (artifacts.length === 0) return "none"
  const lines = artifacts
    .slice(0, ARTIFACT_LIMIT)
    .map((item) => `- ${item.status} ${item.path}${item.owner ? `  ${item.owner}` : ""}`)
  const rest = new Map<string, number>()
  for (const item of artifacts.slice(ARTIFACT_LIMIT)) {
    const dir = item.path.split("/").slice(0, -1).join("/") || "."
    rest.set(dir, (rest.get(dir) ?? 0) + 1)
  }
  for (const [dir, count] of rest) lines.push(`- … ${count} more under ${dir}`)
  return lines.join("\n")
}
