import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { createServer, getServerPort } from "@devvit/web/server"
import { api } from "./routes/api"
import { triggers } from "./routes/triggers"
import { menu } from "./routes/menu"
import { schedulerRoutes } from "./routes/scheduler"

const app = new Hono()
const internal = new Hono()

// routes triggered by reddit when something happens
internal.route("/triggers", triggers)

// actions shown in the comment's mod menu
internal.route("/menu", menu)

// one-off jobs scheduled with the Devvit scheduler
internal.route("/scheduler", schedulerRoutes)

// these were in the devvit template they may be required..?
app.route("/api", api)
app.route("/internal", internal)

serve({
    fetch: app.fetch,
    createServer,
    port: getServerPort()
})
