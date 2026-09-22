import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { createServer, getServerPort } from "@devvit/web/server"
import { api } from "./routes/api"
import { triggers } from "./routes/triggers"

const app = new Hono()
const internal = new Hono()

// routes triggered by reddit when something happens
internal.route("/triggers", triggers)

// these were in the devvit template they may be required..?
app.route("/api", api)
app.route("/internal", internal)

serve({
    fetch: app.fetch,
    createServer,
    port: getServerPort()
})
