import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { schedulerRoutes } from "../src/routes/scheduler"
import { GET_RENDERS_POLL_INTERVAL_MS, RENDER_JOB_NAME, RENDER_TIMEOUT_MS, type SchedulerOrdrPollInput } from "../src/core/replay_video/consts"
import type { TaskRequest } from "@devvit/web/server"

const runJobMock = vi.hoisted(() => vi.fn())
const pollRenderMock = vi.hoisted(() => vi.fn())

vi.mock("../src/core/replay_video/process_replay_video", () => ({
    pollRender: pollRenderMock
}))

vi.mock("@devvit/web/server", async importOriginal => {
    const actual = await importOriginal<typeof import("@devvit/web/server")>()
    return {
        ...actual,
        scheduler: {
            runJob: runJobMock
        }
    }
})

/** the request body of a poll-ordr-render job, as the Devvit scheduler delivers it */
function makeTaskBody(overrides: Partial<SchedulerOrdrPollInput> = {}): TaskRequest<SchedulerOrdrPollInput> {
    return { name: RENDER_JOB_NAME, data: { renderID: 95, postId: "t3_post1", scoreId: 456, scoreType: "solo", submittedAt: Date.now(), ...overrides } }
}

/** POST a job to the scheduler route, like the Devvit scheduler does */
function runTask(body: TaskRequest<SchedulerOrdrPollInput>) {
    return schedulerRoutes.request(`/${RENDER_JOB_NAME}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
}

beforeEach(() => {
    pollRenderMock.mockReset()
    runJobMock.mockReset()
})

describe("scheduler: poll-ordr-render", () => {
    it("polls the render with the job's data and returns ok", async () => {
        pollRenderMock.mockResolvedValue(undefined)
        const body = makeTaskBody()

        const response = await runTask(body)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({})
        expect(pollRenderMock).toHaveBeenCalledTimes(1)
        expect(pollRenderMock).toHaveBeenCalledWith(body.data)
    })

    it("requeues the poll when it fails, so a transient error doesn't break the poll chain", async () => {
        pollRenderMock.mockRejectedValue(new Error("redis hiccup"))
        runJobMock.mockResolvedValue("job-id")
        const body = makeTaskBody()

        const response = await runTask(body)

        expect(response.status).toBe(200)
        // the same job is scheduled again after one poll interval, keeping the original submittedAt for the timeout
        expect(runJobMock).toHaveBeenCalledTimes(1)
        const job = runJobMock.mock.calls[0]![0] as { name: string; data: SchedulerOrdrPollInput; runAt: Date }
        expect(job.name).toBe(RENDER_JOB_NAME)
        expect(job.data).toEqual(body.data)
        expect(job.runAt.getTime()).toBeGreaterThan(Date.now())
        expect(job.runAt.getTime()).toBeLessThanOrEqual(Date.now() + GET_RENDERS_POLL_INTERVAL_MS + 100)
    })

    it("is the job registered in devvit.json, pointing at this route", () => {
        // devvit.json can't import the constant, so this is the one seam a rename could silently break
        const devvitConfig = JSON.parse(readFileSync(new URL("../devvit.json", import.meta.url), "utf-8")) as {
            scheduler: { tasks: Record<string, { endpoint: string }> }
        }
        expect(devvitConfig.scheduler.tasks[RENDER_JOB_NAME]?.endpoint).toBe(`/internal/scheduler/${RENDER_JOB_NAME}`)
    })

    it("still returns ok when the requeue itself fails (the render is orphaned, but the endpoint doesn't error)", async () => {
        pollRenderMock.mockRejectedValue(new Error("redis hiccup"))
        runJobMock.mockRejectedValue(new Error("scheduler down"))
        const body = makeTaskBody()

        const response = await runTask(body)

        expect(response.status).toBe(200)
        expect(runJobMock).toHaveBeenCalledTimes(1)
    })

    it("gives up instead of requeueing when the poll keeps failing past the render timeout", async () => {
        // a persistent failure throws before pollRender's own timeout check, so the route must bound the chain itself
        pollRenderMock.mockRejectedValue(new Error("redis down"))
        runJobMock.mockResolvedValue("job-id")
        const body = makeTaskBody({ submittedAt: Date.now() - RENDER_TIMEOUT_MS - 1000 })

        const response = await runTask(body)

        expect(response.status).toBe(200)
        expect(pollRenderMock).toHaveBeenCalledTimes(1)
        expect(runJobMock).not.toHaveBeenCalled()
    })
})
