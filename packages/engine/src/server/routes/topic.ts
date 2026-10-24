import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Topic } from "../../topic/topic"
import { Text } from "../../util/text"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { validator } from "../validator"

async function fail(error: unknown) {
  if (error instanceof Topic.Error) return { message: await Text.pick(error.text) }
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}

export const TopicRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List discussion topics",
        operationId: "topic.list",
        responses: {
          200: {
            description: "Topics in the current project",
            content: { "application/json": { schema: resolver(Topic.Info.array()) } },
          },
        },
      }),
      async (c) => c.json(await Topic.list()),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create a discussion topic",
        operationId: "topic.create",
        responses: {
          200: {
            description: "Created topic",
            content: { "application/json": { schema: resolver(Topic.Info) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          title: z.string(),
          body: z.string(),
          participants: z.string().array(),
        }),
      ),
      async (c) => {
        try {
          return c.json(await Topic.create(c.req.valid("json")))
        } catch (error) {
          return c.json(await fail(error), 400)
        }
      },
    )
    .get(
      "/:topicID",
      describeRoute({
        summary: "Get a discussion topic",
        operationId: "topic.get",
        responses: {
          200: {
            description: "Topic",
            content: { "application/json": { schema: resolver(Topic.Info) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ topicID: z.string() })),
      async (c) => {
        const topic = await Topic.get(c.req.valid("param").topicID)
        if (!topic) return c.json({ message: await Text.pick({ zh: "话题不存在", en: "Topic not found" }) }, 404)
        return c.json(topic)
      },
    )
    .post(
      "/:topicID/comment",
      describeRoute({
        summary: "Comment on a discussion topic",
        operationId: "topic.comment",
        responses: {
          200: {
            description: "Updated topic",
            content: { "application/json": { schema: resolver(Topic.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ topicID: z.string() })),
      validator("json", z.object({ content: z.string() })),
      async (c) => {
        try {
          return c.json(await Topic.comment(c.req.valid("param").topicID, c.req.valid("json").content))
        } catch (error) {
          return c.json(await fail(error), 400)
        }
      },
    ),
)
