import type { Text } from "@merakcode/util/text"

export const Mode = {
  Owner: "owner",
  Pool: "pool",
  DAG: "dag",
} as const
export type Mode = (typeof Mode)[keyof typeof Mode]
export const MODES = Object.values(Mode)

export const Status = {
  Backlog: "backlog",
  Blocked: "blocked",
  Ready: "ready",
  Running: "running",
  Done: "done",
  Failed: "failed",
  Cancelled: "cancelled",
} as const
export type Status = (typeof Status)[keyof typeof Status]
export const STATUSES = Object.values(Status)

export type Task = {
  id: string
  title: string
  description: string
  status: Status
  /** A member's name; empty until the scheduler assigns the task */
  assignee?: string
  /** Preferred member role, such as 产品 or 测试; assignment falls back to the least-loaded member */
  role?: string
  /** Task ids that must be done before this one is ready */
  dependencies: string[]
  /** Files or directories this task may change */
  paths: string[]
  /** "user", "merak", or the id of the member that created the task */
  createdBy: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  /** The member's reply */
  result?: string
  /** Why the last run failed; the user can retry the task */
  error?: string
  /** Handoff tasks deeper than this are refused, so members cannot create an endless chain */
  depth: number
}

export type Message = {
  id: string
  at: number
  from: string
  to: string
  kind: "inform" | "ask" | "handoff"
  text: string
  taskID?: string
}

export type Seat = { id: string; name: string; leader: boolean; role?: string }

export type TaskInput = {
  title: string
  description?: string
  dependencies?: string[]
  assignee?: string
  role?: string
  paths?: string[]
}

export type TaskPatch = Partial<TaskInput> & { status?: Status }

export type SopStep = {
  key: string
  title: Text.Pair
  description: Text.Pair
  dependencies: string[]
  role?: string
}

export type Sop = {
  id: string
  title: Text.Pair
  description: Text.Pair
  steps: SopStep[]
}

export const MAX_HANDOFF_DEPTH = 8

/**
 * The three user-facing scheduling adapters. They share one task state machine and one admission layer:
 * - owner: the leader creates and assigns work from the conversation.
 * - pool: the user fills a pool; ready tasks are matched to idle members.
 * - dag: task dependencies decide which tasks are ready; SOPs are templates for this mode.
 */
export const SOPS: Sop[] = [
  {
    id: "feature",
    title: { zh: "功能开发", en: "Feature development" },
    description: {
      zh: "从需求到验收的标准开发流程",
      en: "Standard flow from requirements to acceptance",
    },
    steps: [
      {
        key: "requirements",
        title: { zh: "梳理需求", en: "Clarify requirements" },
        description: { zh: "明确范围、验收标准和约束", en: "Define scope, acceptance criteria and constraints" },
        dependencies: [],
        role: "产品",
      },
      {
        key: "design",
        title: { zh: "技术设计", en: "Technical design" },
        description: { zh: "根据需求给出实现方案", en: "Produce an implementation plan from the requirements" },
        dependencies: ["requirements"],
        role: "架构",
      },
      {
        key: "implement",
        title: { zh: "实现功能", en: "Implement" },
        description: { zh: "按技术设计完成代码", en: "Build the feature from the technical design" },
        dependencies: ["design"],
        role: "开发",
      },
      {
        key: "test",
        title: { zh: "测试验收", en: "Test and acceptance" },
        description: { zh: "验证功能和验收标准", en: "Verify the feature against the acceptance criteria" },
        dependencies: ["implement"],
        role: "测试",
      },
    ],
  },
  {
    id: "bugfix",
    title: { zh: "Bug 修复", en: "Bug fix" },
    description: { zh: "复现、定位、修复并回归", en: "Reproduce, diagnose, fix and verify" },
    steps: [
      {
        key: "reproduce",
        title: { zh: "复现问题", en: "Reproduce" },
        description: { zh: "记录复现步骤和实际结果", en: "Record reproduction steps and the actual result" },
        dependencies: [],
        role: "测试",
      },
      {
        key: "diagnose",
        title: { zh: "定位原因", en: "Diagnose" },
        description: { zh: "找到根因和影响范围", en: "Find the root cause and affected area" },
        dependencies: ["reproduce"],
        role: "开发",
      },
      {
        key: "fix",
        title: { zh: "实施修复", en: "Fix" },
        description: { zh: "修复根因并补充必要测试", en: "Fix the root cause and add necessary tests" },
        dependencies: ["diagnose"],
        role: "开发",
      },
      {
        key: "verify",
        title: { zh: "回归验证", en: "Verify" },
        description: { zh: "验证问题已解决且没有回归", en: "Verify the bug is fixed without regressions" },
        dependencies: ["fix"],
        role: "测试",
      },
    ],
  },
  {
    id: "review",
    title: { zh: "代码审查", en: "Code review" },
    description: { zh: "初审、修改和复审", en: "Initial review, revisions and re-review" },
    steps: [
      {
        key: "review",
        title: { zh: "初审代码", en: "Initial review" },
        description: { zh: "检查正确性、风险和测试覆盖", en: "Check correctness, risks and test coverage" },
        dependencies: [],
        role: "审查",
      },
      {
        key: "revise",
        title: { zh: "修改问题", en: "Revise" },
        description: { zh: "处理审查意见", en: "Address review findings" },
        dependencies: ["review"],
        role: "开发",
      },
      {
        key: "rereview",
        title: { zh: "复审", en: "Re-review" },
        description: { zh: "确认修改后可以合并", en: "Confirm the changes are ready to merge" },
        dependencies: ["revise"],
        role: "审查",
      },
    ],
  },
]

export function normalizeMode(mode: unknown): Mode {
  return MODES.includes(mode as Mode) ? (mode as Mode) : Mode.Owner
}

/** Old groups predate tasks and scheduling; they keep their original leader-driven behaviour. */
export function normalize(input: {
  scheduler?: unknown
  sop?: unknown
  tasks?: unknown
  messages?: unknown
}): { scheduler: Mode; sop?: string; tasks: Task[]; messages: Message[] } {
  return {
    scheduler: normalizeMode(input.scheduler),
    ...(typeof input.sop === "string" && input.sop ? { sop: input.sop } : {}),
    tasks: Array.isArray(input.tasks) ? input.tasks.map((task) => normalizeTask(task as Partial<Task>)) : [],
    messages: Array.isArray(input.messages)
      ? input.messages.map((message) => normalizeMessage(message as Partial<Message>))
      : [],
  }
}

function normalizeTask(task: Partial<Task>): Task {
  return {
    id: task.id ?? crypto.randomUUID(),
    title: task.title ?? "",
    description: task.description ?? "",
    status: STATUSES.includes(task.status as Status) ? (task.status as Status) : Status.Backlog,
    ...(task.assignee ? { assignee: task.assignee } : {}),
    ...(task.role ? { role: task.role } : {}),
    dependencies: Array.isArray(task.dependencies) ? task.dependencies.filter((id) => typeof id === "string") : [],
    paths: Array.isArray(task.paths) ? task.paths.filter((path) => typeof path === "string") : [],
    createdBy: task.createdBy ?? "user",
    createdAt: task.createdAt ?? Date.now(),
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
    ...(task.result ? { result: task.result } : {}),
    ...(task.error ? { error: task.error } : {}),
    depth: typeof task.depth === "number" ? task.depth : 0,
  }
}

function normalizeMessage(message: Partial<Message>): Message {
  return {
    id: message.id ?? crypto.randomUUID(),
    at: message.at ?? Date.now(),
    from: message.from ?? "user",
    to: message.to ?? "",
    kind: message.kind === "ask" || message.kind === "handoff" ? message.kind : "inform",
    text: message.text ?? "",
    ...(message.taskID ? { taskID: message.taskID } : {}),
  }
}

export function createTask(input: TaskInput, options: {
  mode: Mode
  tasks: readonly Task[]
  createdBy?: string
  depth?: number
}): Task {
  const title = input.title.trim()
  if (!title) throw new Error("Task title is required")
  const dependencies = unique(input.dependencies ?? [])
  validateDependencies(options.tasks, undefined, dependencies)
  const depth = options.depth ?? 0
  if (depth > MAX_HANDOFF_DEPTH) throw new Error(`Handoff depth exceeds ${MAX_HANDOFF_DEPTH}`)
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    description: input.description?.trim() ?? "",
    status: Status.Backlog,
    ...(input.assignee ? { assignee: input.assignee } : {}),
    ...(input.role?.trim() ? { role: input.role.trim() } : {}),
    dependencies,
    paths: unique(input.paths ?? []),
    createdBy: options.createdBy ?? "user",
    createdAt: Date.now(),
    depth,
  }
  return normalizeStatus(options.mode, task, [...options.tasks, task])
}

export function updateTask(
  mode: Mode,
  tasks: readonly Task[],
  id: string,
  patch: TaskPatch,
): Task[] {
  const current = tasks.find((task) => task.id === id)
  if (!current) throw new Error("Task not found")
  if (current.status === Status.Running && (patch.dependencies || patch.status || patch.title || patch.description))
    throw new Error("A running task cannot be edited")
  let dependencies = current.dependencies
  if (patch.dependencies) {
    dependencies = unique(patch.dependencies)
    validateDependencies(tasks, id, dependencies)
  }
  const next = tasks.map((task) => {
    if (task.id !== id) return task
    const status = patch.status ?? task.status
    return {
      ...task,
      ...(patch.title !== undefined ? { title: requiredTitle(patch.title) } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.assignee !== undefined ? { assignee: patch.assignee.trim() || undefined } : {}),
      ...(patch.role !== undefined ? { role: patch.role.trim() || undefined } : {}),
      ...(patch.paths !== undefined ? { paths: unique(patch.paths) } : {}),
      dependencies,
      status,
    }
  })
  return recompute(mode, next)
}

export function removeTask(mode: Mode, tasks: readonly Task[], id: string): Task[] {
  const task = tasks.find((item) => item.id === id)
  if (!task) throw new Error("Task not found")
  if (task.status === Status.Running) throw new Error("A running task cannot be removed")
  return recompute(
    mode,
    tasks
      .filter((item) => item.id !== id)
      .map((item) => ({ ...item, dependencies: item.dependencies.filter((dependency) => dependency !== id) })),
  )
}

/** Computes blocked/ready from dependencies. Running and terminal tasks keep their state. */
export function recompute(mode: Mode, tasks: readonly Task[]): Task[] {
  return tasks.map((task) => normalizeStatus(mode, task, tasks))
}

function normalizeStatus(mode: Mode, task: Task, tasks: readonly Task[]): Task {
  if (
    task.status === Status.Running ||
    task.status === Status.Done ||
    task.status === Status.Failed ||
    task.status === Status.Cancelled
  )
    return task
  if (mode === Mode.Owner) return task
  if (mode === Mode.Pool) return { ...task, status: Status.Ready }
  const ready =
    task.dependencies.length === 0 ||
    task.dependencies.every((id) => tasks.find((candidate) => candidate.id === id)?.status === Status.Done)
  return { ...task, status: ready ? Status.Ready : Status.Blocked }
}

/** Chooses a member for each ready task: an explicit assignee wins, otherwise the least-loaded member. */
export function assignReady(mode: Mode, tasks: readonly Task[], seats: readonly Seat[]): Task[] {
  if (mode === Mode.Owner) return [...tasks]
  const workers = seats.filter((seat) => !seat.leader)
  if (!workers.length) return recompute(mode, tasks)
  const load = new Map(workers.map((seat) => [seat.name, 0]))
  for (const task of tasks)
    if (task.status === Status.Running && task.assignee && load.has(task.assignee))
      load.set(task.assignee, (load.get(task.assignee) ?? 0) + 1)
  return recompute(mode, tasks).map((task) => {
    if (task.status !== Status.Ready || task.assignee) return task
    const matching = task.role
      ? workers.filter((seat) => {
          const role = seat.role ?? ""
          return role === task.role || role.includes(task.role) || task.role.includes(role)
        })
      : []
    const candidates = matching.length ? matching : workers
    const seat = candidates.toSorted(
      (left, right) =>
        (load.get(left.name) ?? 0) - (load.get(right.name) ?? 0) || left.name.localeCompare(right.name),
    )[0]!
    load.set(seat.name, (load.get(seat.name) ?? 0) + 1)
    return { ...task, assignee: seat.name }
  })
}

export function ready(mode: Mode, tasks: readonly Task[]) {
  return recompute(mode, tasks).filter((task) => task.status === Status.Ready)
}

export function start(mode: Mode, tasks: readonly Task[], id: string, assignee: string): Task[] {
  const current = tasks.find((task) => task.id === id)
  if (!current) throw new Error("Task not found")
  if (current.assignee && current.assignee !== assignee)
    throw new Error(`Task ${current.id} is assigned to ${current.assignee}`)
  const readyTasks = recompute(mode, tasks)
  const found = readyTasks.find((task) => task.id === id)
  if (!found) throw new Error("Task not found")
  if (found.status !== Status.Ready) throw new Error(`Task ${found.id} is not ready (${found.status})`)
  return readyTasks.map((task) =>
    task.id === id
      ? {
          ...task,
          status: Status.Running,
          assignee,
          startedAt: Date.now(),
          finishedAt: undefined,
          result: undefined,
          error: undefined,
        }
      : task,
  )
}

export function finish(
  mode: Mode,
  tasks: readonly Task[],
  id: string,
  input: { result: string } | { error: string },
): Task[] {
  const now = Date.now()
  const next = tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          status: "result" in input ? Status.Done : Status.Failed,
          ...("result" in input ? { result: input.result, error: undefined } : { error: input.error }),
          finishedAt: now,
        }
      : task,
  )
  return recompute(mode, next)
}

export function applySop(
  mode: Mode,
  tasks: readonly Task[],
  sop: Sop,
  createdBy = "user",
  lang: "zh" | "en" = "en",
): { tasks: Task[]; sop: string } {
  if (mode !== Mode.DAG) throw new Error("SOPs can only be applied to DAG scheduling")
  const ids = new Map(sop.steps.map((step) => [step.key, crypto.randomUUID()]))
  const added = sop.steps.map((step) => ({
    id: ids.get(step.key)!,
    title: step.title[lang],
    description: step.description[lang],
    status: Status.Blocked,
    dependencies: step.dependencies.map((key) => ids.get(key)!).filter(Boolean),
    ...(step.role ? { role: step.role } : {}),
    paths: [],
    createdBy,
    createdAt: Date.now(),
    depth: 0,
  }))
  return { tasks: recompute(mode, [...tasks, ...added]), sop: sop.id }
}

/** A member's reply can address another member. Handoffs create work; asks and notes are messages. */
export function mentions(input: {
  text: string
  from: string
  seats: readonly Seat[]
  taskID?: string
}): Omit<Message, "id" | "at">[] {
  const names = new Map(input.seats.map((seat) => [seat.name, seat.id]))
  const found: Omit<Message, "id" | "at">[] = []
  for (const line of input.text.split(/\r?\n/)) {
    const match = /^\s*@([^\s@:，,]+)\s*(?:(inform|ask|handoff)\s*[:：]\s*)?(.+?)\s*$/iu.exec(line)
    if (!match) continue
    const to = names.get(match[1]!)
    if (!to || match[1] === input.from) continue
    const kind = match[2]?.toLowerCase()
    found.push({
      from: input.from,
      to,
      kind: kind === "ask" ? "ask" : kind === "handoff" ? "handoff" : "inform",
      text: match[3]!,
      ...(input.taskID ? { taskID: input.taskID } : {}),
    })
  }
  return found
}

function validateDependencies(tasks: readonly Task[], id: string | undefined, dependencies: readonly string[]) {
  const byID = new Map(tasks.map((task) => [task.id, task]))
  for (const dependency of dependencies) {
    if (dependency === id) throw new Error("A task cannot depend on itself")
    if (!byID.has(dependency)) throw new Error(`Dependency not found: ${dependency}`)
  }
  if (!id) return
  const seen = new Set<string>()
  const visit = (current: string): void => {
    if (current === id) throw new Error("Task dependencies contain a cycle")
    if (seen.has(current)) return
    seen.add(current)
    for (const dependency of byID.get(current)?.dependencies ?? []) visit(dependency)
  }
  for (const dependency of dependencies) visit(dependency)
}

function requiredTitle(title: string) {
  const value = title.trim()
  if (!value) throw new Error("Task title is required")
  return value
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values.filter(Boolean))]
}

