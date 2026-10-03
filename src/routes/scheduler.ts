import { Hono } from "hono"
import { scheduler as schedulerClient, type TaskRequest, type TaskResponse } from "@devvit/web/server"
import { pollRender } from "../core/replay_video/process_replay_video"
import { GET_RENDERS_POLL_INTERVAL_MS, RENDER_JOB_NAME, RENDER_TIMEOUT_MS, type SchedulerOrdrPollInput } from "../core/replay_video/consts"

export const schedulerRoutes = new Hono()

schedulerRoutes.post(`/${RENDER_JOB_NAME}`, async c => {
    const input = await c.req.json<TaskRequest<SchedulerOrdrPollInput>>()

    try {
        await pollRender(input.data)
    } catch (err) {
        // a transient failure (redis hiccup, unexpected error) shouldn't break the poll chain: requeue like a pending result.
        // but only until the render timeout: a persistent failure must not requeue forever
        if (Date.now() - input.data.submittedAt > RENDER_TIMEOUT_MS) {
            console.error(`Failed to poll render ${input.data.renderID} and it's past the render timeout, giving up:`, err)
            return c.json<TaskResponse>({}, 200)
        }
        console.error(`Failed to poll render ${input.data.renderID}, requeueing the poll:`, err)
        try {
            await schedulerClient.runJob({ name: RENDER_JOB_NAME, data: input.data, runAt: new Date(Date.now() + GET_RENDERS_POLL_INTERVAL_MS) })
        } catch (requeueErr) {
            console.error(`Failed to requeue the poll of render ${input.data.renderID}, the render is orphaned:`, requeueErr)
        }
    }

    return c.json<TaskResponse>({}, 200)
})
