import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Monitor } from "../../monitor/monitor"
import { Text } from "../../util/text"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { validator } from "../validator"

async function fail(error: unknown) {
  if (error instanceof Monitor.Error) return { message: await Text.pick(error.text) }
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}

export const MonitorRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID",
      describeRoute({
        summary: "List monitoring signals",
        description: "List recently received monitoring signals for a session, newest first.",
        operationId: "monitor.list",
        responses: {
          200: {
            description: "Monitoring signals",
            content: { "application/json": { schema: resolver(Monitor.Signal.array()) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("query", z.object({ limit: z.coerce.number().int().positive().max(500).optional() })),
      async (c) => c.json(await Monitor.list(c.req.valid("param").sessionID, c.req.valid("query").limit)),
    )
    .get(
      "/:sessionID/:signalID",
      describeRoute({
        summary: "Get a monitoring signal",
        operationId: "monitor.get",
        responses: {
          200: {
            description: "Monitoring signal",
            content: { "application/json": { schema: resolver(Monitor.Signal) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string(), signalID: z.string() })),
      async (c) => {
        const input = c.req.valid("param")
        const signal = await Monitor.get(input.sessionID, input.signalID)
        if (!signal) return c.json({ message: await Text.pick({ zh: "监测数据不存在", en: "Signal not found" }) }, 404)
        return c.json(signal)
      },
    )
    .post(
      "/:sessionID",
      describeRoute({
        summary: "Send a monitoring signal",
        description:
          "Queue structured monitoring data for a session. Scripts use the session-scoped Bearer token supplied in MERAKCODE_MONITOR_TOKEN.",
        operationId: "monitor.send",
        responses: {
          200: {
            description: "Stored monitoring signal",
            content: { "application/json": { schema: resolver(Monitor.Signal) } },
          },
          ...errors(400, 401),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator(
        "json",
        z.object({
          title: z.string(),
          message: z.string(),
          severity: Monitor.Severity.optional(),
          source: z.string().optional(),
          data: z.unknown().optional(),
          dedupeKey: z.string().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const authorization = c.req.header("authorization")
        if (authorization?.startsWith("Bearer ") && !Monitor.authorize(sessionID, authorization))
          return c.json(
            {
              name: "UnauthorizedError",
              code: "UNAUTHORIZED",
              message: await Text.pick({
                zh: "监测接口令牌无效",
                en: "Invalid monitoring endpoint token",
              }),
              data: {},
            },
            401,
          )
        try {
          return c.json(
            await Monitor.send({
              ...c.req.valid("json"),
              sessionID,
            }),
          )
        } catch (error) {
          return c.json(await fail(error), 400)
        }
      },
    ),
)
