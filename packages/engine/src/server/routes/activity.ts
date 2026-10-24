import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Activity } from "../../activity/activity"
import { lazy } from "../../util/lazy"
import { validator } from "../validator"

export const ActivityRoutes = lazy(() =>
  new Hono().get(
    "/:coworkerID",
    describeRoute({
      summary: "Get an agent activity timeline",
      operationId: "activity.list",
      responses: {
        200: {
          description: "Activity events, newest first",
          content: { "application/json": { schema: resolver(Activity.Entry.array()) } },
        },
      },
    }),
    validator("param", z.object({ coworkerID: z.string() })),
    validator("query", z.object({ limit: z.coerce.number().int().positive().max(1000).optional() })),
    async (c) => c.json(await Activity.list(c.req.valid("param").coworkerID, c.req.valid("query").limit)),
  ),
)
