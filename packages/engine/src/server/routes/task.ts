import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Task } from "../../task/task"
import { Text } from "../../util/text"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { validator } from "../validator"

async function fail(error: unknown) {
  if (error instanceof Task.Error) return { message: await Text.pick(error.text) }
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}

export const TaskRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List tasks",
        operationId: "task.list",
        responses: {
          200: {
            description: "Tasks in the current project",
            content: { "application/json": { schema: resolver(Task.Info.array()) } },
          },
        },
      }),
      async (c) => c.json(await Task.list()),
    )
    .get(
      "/:taskID",
      describeRoute({
        summary: "Get a task",
        operationId: "task.get",
        responses: {
          200: {
            description: "Task",
            content: { "application/json": { schema: resolver(Task.Info) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: z.string() })),
      async (c) => {
        const task = await Task.get(c.req.valid("param").taskID)
        if (!task) return c.json({ message: await Text.pick({ zh: "待办不存在", en: "Task not found" }) }, 404)
        return c.json(task)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create a task",
        operationId: "task.create",
        responses: {
          200: {
            description: "Created task",
            content: { "application/json": { schema: resolver(Task.Info) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          title: z.string(),
          description: z.string().optional(),
          priority: z.enum(["low", "medium", "high"]).optional(),
          assigneeID: z.string().optional(),
        }),
      ),
      async (c) => {
        try {
          return c.json(await Task.create(c.req.valid("json")))
        } catch (error) {
          return c.json(await fail(error), 400)
        }
      },
    )
    .patch(
      "/:taskID",
      describeRoute({
        summary: "Update a task",
        operationId: "task.update",
        responses: {
          200: {
            description: "Updated task",
            content: { "application/json": { schema: resolver(Task.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: z.string() })),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(["todo", "doing", "done"]).optional(),
          priority: z.enum(["low", "medium", "high"]).optional(),
          assigneeID: z.string().nullable().optional(),
        }),
      ),
      async (c) => {
        try {
          return c.json(await Task.update(c.req.valid("param").taskID, c.req.valid("json")))
        } catch (error) {
          return c.json(await fail(error), 400)
        }
      },
    )
    .post(
      "/:taskID/comment",
      describeRoute({
        summary: "Comment on a task",
        operationId: "task.comment",
        responses: {
          200: {
            description: "Updated task",
            content: { "application/json": { schema: resolver(Task.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: z.string() })),
      validator("json", z.object({ content: z.string() })),
      async (c) => {
        try {
          return c.json(await Task.comment(c.req.valid("param").taskID, c.req.valid("json").content))
        } catch (error) {
          return c.json(await fail(error), 400)
        }
      },
    ),
)
