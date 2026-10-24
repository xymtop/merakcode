import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Coworker } from "../../coworker/coworker"
import { CoworkerSync } from "../../coworker/sync"
import { CoworkerWorld } from "../../coworker/world"
import { Text } from "../../util/text"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { validator } from "../validator"

const WorldNode: z.ZodType<CoworkerWorld.Node> = z.lazy(() =>
  z
    .object({
      name: z.string(),
      path: z.string(),
      relative: z.string(),
      type: z.enum(["file", "directory"]),
      children: z.array(WorldNode).optional(),
    })
    .meta({ ref: "CoworkerWorldNode" }),
)

async function fail(error: unknown) {
  if (error instanceof Coworker.Error) return { message: await Text.pick(error.text) }
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}

export const CoworkerRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List coworkers",
        description: "List all-chat coworkers in the current project (contacts).",
        operationId: "coworker.list",
        responses: {
          200: {
            description: "Coworkers",
            content: { "application/json": { schema: resolver(Coworker.Info.array()) } },
          },
        },
      }),
      async (c) => c.json(await Coworker.list()),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create coworker",
        description:
          "Create a coworker with a world folder skeleton, sync custom agent + rules, and return the contact card.",
        operationId: "coworker.create",
        responses: {
          200: {
            description: "Created coworker",
            content: { "application/json": { schema: resolver(Coworker.Info) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          duty: z.string().optional(),
          id: z.string().optional(),
          bindings: z
            .object({
              model: z.string().optional(),
              skills: z.array(z.string()).optional(),
              mcp: z.array(z.string()).optional(),
            })
            .optional(),
        }),
      ),
      async (c) => {
        try {
          return c.json(await Coworker.create(c.req.valid("json")))
        } catch (error) {
          return c.json(await fail(error), 400)
        }
      },
    )
    .get(
      "/:coworkerID",
      describeRoute({
        summary: "Get coworker",
        operationId: "coworker.get",
        responses: {
          200: {
            description: "Coworker",
            content: { "application/json": { schema: resolver(Coworker.Info) } },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const info = await Coworker.get(c.req.param("coworkerID"))
        if (!info) return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        return c.json(info)
      },
    )
    .patch(
      "/:coworkerID",
      describeRoute({
        summary: "Update coworker",
        description: "Update display name and duty summary in PROFILE.md, then re-sync the agent prompt.",
        operationId: "coworker.update",
        responses: {
          200: {
            description: "Updated coworker",
            content: { "application/json": { schema: resolver(Coworker.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ name: z.string().optional(), duty: z.string().optional() })),
      async (c) => {
        try {
          return c.json(await Coworker.update(c.req.param("coworkerID"), c.req.valid("json")))
        } catch (error) {
          if (error instanceof Coworker.Error && error.text.en.includes("not found")) {
            return c.json(await fail(error), 404)
          }
          return c.json(await fail(error), 400)
        }
      },
    )
    .delete(
      "/:coworkerID",
      describeRoute({
        summary: "Delete coworker",
        description: "Move the coworker folder to .trash and remove synced agent/rules files.",
        operationId: "coworker.delete",
        responses: {
          200: {
            description: "Deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ id: z.string(), trash: z.string() })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        try {
          return c.json(await Coworker.remove(c.req.param("coworkerID")))
        } catch (error) {
          return c.json(await fail(error), 404)
        }
      },
    )
    .get(
      "/:coworkerID/profile",
      describeRoute({
        summary: "Read coworker PROFILE.md",
        operationId: "coworker.profile.read",
        responses: {
          200: {
            description: "Profile",
            content: {
              "application/json": {
                schema: resolver(z.object({ path: z.string(), content: z.string() })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        try {
          return c.json(await Coworker.readProfile(c.req.param("coworkerID")))
        } catch (error) {
          return c.json(await fail(error), 404)
        }
      },
    )
    .put(
      "/:coworkerID/profile",
      describeRoute({
        summary: "Write coworker PROFILE.md",
        operationId: "coworker.profile.write",
        responses: {
          200: {
            description: "Saved",
            content: { "application/json": { schema: resolver(z.object({ path: z.string() })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ content: z.string() })),
      async (c) => {
        try {
          return c.json(await Coworker.writeProfile(c.req.param("coworkerID"), c.req.valid("json").content))
        } catch (error) {
          if (error instanceof Coworker.Error && error.text.en.includes("not found")) {
            return c.json(await fail(error), 404)
          }
          return c.json(await fail(error), 400)
        }
      },
    )
    .put(
      "/:coworkerID/bindings",
      describeRoute({
        summary: "Update coworker bindings",
        description:
          "Set model / selected skills / selected MCP servers from the project inventory, then sync agent permissions.",
        operationId: "coworker.bindings.update",
        responses: {
          200: {
            description: "Updated coworker",
            content: { "application/json": { schema: resolver(Coworker.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          model: z.string().optional(),
          skills: z.array(z.string()).optional(),
          mcp: z.array(z.string()).optional(),
        }),
      ),
      async (c) => {
        try {
          return c.json(await Coworker.setBindings(c.req.param("coworkerID"), c.req.valid("json")))
        } catch (error) {
          if (error instanceof Coworker.Error && error.text.en.includes("not found")) {
            return c.json(await fail(error), 404)
          }
          return c.json(await fail(error), 400)
        }
      },
    )
    .post(
      "/:coworkerID/sync",
      describeRoute({
        summary: "Re-sync coworker agent and rules",
        operationId: "coworker.sync",
        responses: {
          200: {
            description: "Synced",
            content: { "application/json": { schema: resolver(z.object({ ok: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        await CoworkerSync.sync(id)
        return c.json({ ok: true as const })
      },
    )
    .get(
      "/:coworkerID/world",
      describeRoute({
        summary: "Coworker world tree",
        operationId: "coworker.world.tree",
        responses: {
          200: {
            description: "Tree",
            content: { "application/json": { schema: resolver(WorldNode.array()) } },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        return c.json(await CoworkerWorld.tree(id))
      },
    )
    .get(
      "/:coworkerID/world/file",
      describeRoute({
        summary: "Read a world file",
        operationId: "coworker.world.read",
        responses: {
          200: {
            description: "File",
            content: {
              "application/json": {
                schema: resolver(z.object({ path: z.string(), relative: z.string(), content: z.string() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        const result = await CoworkerWorld.read(id, c.req.valid("query").path)
        if (!result.ok) return c.json({ message: result.error }, 400)
        return c.json(result.data)
      },
    )
    .put(
      "/:coworkerID/world/file",
      describeRoute({
        summary: "Write a world file",
        operationId: "coworker.world.write",
        responses: {
          200: {
            description: "Saved",
            content: {
              "application/json": {
                schema: resolver(z.object({ path: z.string(), relative: z.string() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ path: z.string(), content: z.string() })),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        const body = c.req.valid("json")
        const result = await CoworkerWorld.write(id, body.path, body.content)
        if (!result.ok) return c.json({ message: result.error }, 400)
        return c.json(result.data)
      },
    )
    .post(
      "/:coworkerID/world/mkdir",
      describeRoute({
        summary: "Create a world folder",
        operationId: "coworker.world.mkdir",
        responses: {
          200: {
            description: "Created",
            content: {
              "application/json": {
                schema: resolver(z.object({ path: z.string(), relative: z.string() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ path: z.string() })),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        const result = await CoworkerWorld.mkdir(id, c.req.valid("json").path)
        if (!result.ok) return c.json({ message: result.error }, 400)
        return c.json(result.data)
      },
    )
    .post(
      "/:coworkerID/world/file",
      describeRoute({
        summary: "Create an empty world Markdown file",
        operationId: "coworker.world.createFile",
        responses: {
          200: {
            description: "Created",
            content: {
              "application/json": {
                schema: resolver(z.object({ path: z.string(), relative: z.string() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ path: z.string() })),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        const result = await CoworkerWorld.createFile(id, c.req.valid("json").path)
        if (!result.ok) return c.json({ message: result.error }, 400)
        return c.json(result.data)
      },
    )
    .delete(
      "/:coworkerID/world/file",
      describeRoute({
        summary: "Delete a world file or folder",
        operationId: "coworker.world.remove",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.object({ relative: z.string() })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        const result = await CoworkerWorld.remove(id, c.req.valid("query").path)
        if (!result.ok) return c.json({ message: result.error }, 400)
        return c.json(result.data)
      },
    )
    .get(
      "/:coworkerID/world/search",
      describeRoute({
        summary: "Search coworker world files",
        operationId: "coworker.world.search",
        responses: {
          200: {
            description: "Hits",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      relative: z.string(),
                      path: z.string(),
                      kind: z.enum(["name", "content"]),
                    })
                    .array(),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("query", z.object({ q: z.string() })),
      async (c) => {
        const id = c.req.param("coworkerID")
        if (!(await Coworker.get(id))) {
          return c.json({ message: await Text.pick({ zh: "同事不存在", en: "Coworker not found" }) }, 404)
        }
        return c.json(await CoworkerWorld.search(id, c.req.valid("query").q))
      },
    ),
)
