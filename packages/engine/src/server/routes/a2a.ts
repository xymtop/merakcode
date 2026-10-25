import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { A2ACard } from "../../a2a/card"
import { Text } from "../../util/text"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { validator } from "../validator"

async function fail(error: unknown) {
  if (error instanceof A2ACard.Error) return { message: await Text.pick(error.text) }
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}

export const A2ARoutes = lazy(() =>
  new Hono().post(
    "/discover",
    describeRoute({
      summary: "Discover an A2A Agent Card",
      description:
        "Fetch and normalize an Agent Card from a URL or domain (tries /.well-known/agent-card.json then agent.json).",
      operationId: "a2a.discover",
      responses: {
        200: {
          description: "Agent Card preview",
          content: { "application/json": { schema: resolver(A2ACard.Preview) } },
        },
        ...errors(400),
      },
    }),
    validator("json", z.object({ url: z.string() })),
    async (c) => {
      try {
        return c.json(await A2ACard.discover(c.req.valid("json").url))
      } catch (error) {
        return c.json(await fail(error), 400)
      }
    },
  ),
)
