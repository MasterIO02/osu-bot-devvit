import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { submitScoreRender, pollRender, addVideoToComment } from "../src/core/replay_video/process_replay_video"
import { buildVideoHeading, isVideoHeading, LINK_TEXT } from "../src/core/replay_video/rtjson"
import { GET_RENDERS_POLL_INTERVAL_MS, RENDER_JOB_NAME, RENDER_TIMEOUT_MS, RENDER_GUARD_TTL_SECONDS, RENDER_VIDEO_TTL_SECONDS, renderGuardKey, renderVideoKey, type SchedulerOrdrPollInput } from "../src/core/replay_video/consts"
import { redis } from "@devvit/redis"
import { reddit, scheduler } from "@devvit/web/server"
import type { Score } from "../src/core/requests/osu_api"

// in-memory redis state shared with the mocked @devvit/redis (hoisted so the vi.mock factory can use it)
const state = vi.hoisted(() => ({ strings: new Map<string, string>() }))

vi.mock("@devvit/redis", () => ({
    redis: {
        get: vi.fn(async (key: string) => state.strings.get(key)),
        set: vi.fn(async (key: string, value: string, options?: { nx?: boolean; expiration?: Date }) => {
            // mimic redis SET NX: fails (empty value) when the key already exists
            if (options?.nx && state.strings.has(key)) return ""
            state.strings.set(key, value)
            return "OK"
        }),
        del: vi.fn(async (...keys: string[]) => {
            for (const key of keys) state.strings.delete(key)
        })
    }
}))

const editMock = vi.hoisted(() => vi.fn())
const runJobMock = vi.hoisted(() => vi.fn())

vi.mock("@devvit/web/server", async importOriginal => {
    const actual = await importOriginal<typeof import("@devvit/web/server")>()
    return {
        ...actual,
        settings: {
            get: vi.fn(async () => "test-ordr-key")
        },
        reddit: {
            getAppUser: vi.fn(async () => ({ id: "t2_bot", username: "osu-bot" })),
            getComments: vi.fn(() => ({ all: async () => [{ id: "t1_own", authorId: "t2_bot", edit: editMock }] }))
        },
        scheduler: {
            runJob: runJobMock
        }
    }
})

/** a minimal normalized score, lazer (solo) by default */
function makeScore(overrides: Partial<Score> = {}): Score {
    return {
        id: 456,
        legacy_score_id: null,
        has_replay: true,
        user_id: 1,
        username: "TestPlayer",
        accuracy: 0.99,
        mods: [],
        max_combo: 500,
        is_perfect_combo: false,
        pp: 400,
        ended_at: "2024-01-01T00:00:00Z",
        miss_count: 0,
        total_score: 1000000,
        is_stable: false,
        beatmap: undefined,
        beatmapset: undefined,
        ...overrides
    }
}

/** a minimal scorepost comment RTJSON document: content, horizontal rule, footer */
function makeStoredDocument() {
    return { document: [{ e: "par", c: [{ t: "map header and tables" }] }, { e: "hr" }, { e: "par", c: [{ t: "footer" }] }] }
}

/** store the comment's RTJSON for a post, like processScorepost does when it posts */
function storeDocument(postId = "t3_post1") {
    state.strings.set(`comment:rtjson:${postId}`, JSON.stringify(makeStoredDocument()))
}

/** the payload of a poll job for a render of score 456 on t3_post1 */
function makePayload(overrides: Partial<SchedulerOrdrPollInput> = {}): SchedulerOrdrPollInput {
    return { renderID: 95, postId: "t3_post1", scoreId: 456, scoreType: "solo", submittedAt: Date.now(), ...overrides }
}

/** store the guard of an in-progress render of score 456, holding the given waiting posts */
function storeGuard(postIds: string[]) {
    state.strings.set(renderGuardKey("solo", 456), JSON.stringify(postIds))
}

/** a response from the o!rdr renders list */
const renderResponse = (renders: Record<string, unknown>[]) => ({ ok: true, json: async () => ({ renders, maxRenders: renders.length }) }) as Response

/** the document our comment was edited with in the given edit call */
function editedDocument(call = 0) {
    const edited = vi.mocked(editMock).mock.calls[call]![0] as { richtext: { document: unknown[] } }
    return edited.richtext.document
}

/** assert a redis.set call wrote the key with an expiration around the given TTL */
function expectSetWithTtl(key: string, ttlSeconds: number) {
    const call = vi.mocked(redis.set).mock.calls.find(args => args[0] === key)
    expect(call, `redis.set was not called with key ${key}`).toBeDefined()
    const expiration = call![2]!.expiration!
    expect(expiration.getTime()).toBeGreaterThan(Date.now() + ttlSeconds * 1000 - 1000)
    expect(expiration.getTime()).toBeLessThanOrEqual(Date.now() + ttlSeconds * 1000)
}

const VIDEO_URL = "https://link.issou.best/VJ6qLr"

beforeEach(() => {
    state.strings.clear()
    editMock.mockReset()
    runJobMock.mockReset()
    vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("buildVideoHeading", () => {
    it("builds a level-1 heading with a bold link", () => {
        const heading = JSON.parse(buildVideoHeading(VIDEO_URL).build()).document[0] as any
        expect(heading.e).toBe("h")
        expect(heading.l).toBe(1)
        expect(heading.c).toHaveLength(1)
        expect(heading.c[0].e).toBe("link")
        expect(heading.c[0].t).toBe(LINK_TEXT)
        expect(heading.c[0].u).toBe(VIDEO_URL)
        expect(heading.c[0].f).toHaveLength(1)
    })
})

describe("isVideoHeading", () => {
    it("detects the video heading block", () => {
        const heading = JSON.parse(buildVideoHeading(VIDEO_URL).build()).document[0]
        expect(isVideoHeading(heading)).toBe(true)
    })

    it("rejects other headings, paragraphs and links", () => {
        expect(isVideoHeading({ e: "h", l: 4, c: [{ e: "link", t: LINK_TEXT, u: VIDEO_URL }] })).toBe(false)
        expect(isVideoHeading({ e: "par", c: [{ t: LINK_TEXT }] })).toBe(false)
        expect(isVideoHeading({ e: "h", l: 1, c: [{ t: LINK_TEXT }] })).toBe(false)
        expect(isVideoHeading({ e: "h", l: 1, c: [{ e: "link", t: "something else", u: VIDEO_URL }] })).toBe(false)
    })
})

describe("addVideoToComment", () => {
    it("splices the heading at the top of the document, stores it and edits the comment", async () => {
        storeDocument()

        await addVideoToComment("t3_post1", VIDEO_URL)

        expect(editMock).toHaveBeenCalledTimes(1)
        const document = editedDocument()
        expect(document).toHaveLength(4)
        expect(isVideoHeading(document[0])).toBe(true)
        expect(document.slice(1)).toEqual(makeStoredDocument().document)
        // the stored document round-trips: it's the same one the comment was edited with
        const stored = JSON.parse(state.strings.get("comment:rtjson:t3_post1")!)
        expect(stored.document).toEqual(document)
    })

    it("doesn't duplicate an existing video heading", async () => {
        storeDocument()

        await addVideoToComment("t3_post1", VIDEO_URL)
        await addVideoToComment("t3_post1", "https://link.issou.best/other")

        expect(editMock).toHaveBeenCalledTimes(1)
        const stored = JSON.parse(state.strings.get("comment:rtjson:t3_post1")!)
        expect(stored.document.filter(isVideoHeading)).toHaveLength(1)
    })

    it("skips when the comment's document isn't stored anymore", async () => {
        await addVideoToComment("t3_expired", VIDEO_URL)

        expect(editMock).not.toHaveBeenCalled()
    })

    it("doesn't edit when our comment is gone, but keeps the stored document updated", async () => {
        storeDocument()
        vi.mocked(reddit.getComments).mockReturnValueOnce({ all: async () => [] } as any)

        await addVideoToComment("t3_post1", VIDEO_URL)

        expect(editMock).not.toHaveBeenCalled()
        const stored = JSON.parse(state.strings.get("comment:rtjson:t3_post1")!)
        expect(isVideoHeading(stored.document[0])).toBe(true)
    })
})

describe("submitScoreRender", () => {
    it("submits the replay, holds the guard with this post waiting and schedules the first poll", async () => {
        storeDocument()
        vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ renderID: 95, errorCode: 0, message: "Render added successfully" }) } as Response)

        await submitScoreRender("t3_post1", makeScore(), "osu")

        expect(fetch).toHaveBeenCalledTimes(1)
        // the guard's value is the list of posts waiting on the render, this one first, stored with a TTL
        expect(JSON.parse(state.strings.get(renderGuardKey("solo", 456))!)).toEqual(["t3_post1"])
        expectSetWithTtl(renderGuardKey("solo", 456), RENDER_GUARD_TTL_SECONDS)
        // the poll is scheduled with everything the render flow needs
        expect(runJobMock).toHaveBeenCalledTimes(1)
        const job = vi.mocked(scheduler.runJob).mock.calls[0]![0] as { name: string; data: SchedulerOrdrPollInput; runAt: Date }
        expect(job.name).toBe(RENDER_JOB_NAME)
        expect(job.data).toEqual({ renderID: 95, postId: "t3_post1", scoreId: 456, scoreType: "solo", submittedAt: expect.any(Number) })
        expect(job.data.submittedAt).toBeGreaterThan(Date.now() - 5000)
        expect(job.runAt.getTime()).toBeGreaterThan(Date.now())
        expect(job.runAt.getTime()).toBeLessThanOrEqual(Date.now() + GET_RENDERS_POLL_INTERVAL_MS + 100)
    })

    it("adds the cached video link to the comment without a new render", async () => {
        storeDocument()
        state.strings.set(renderVideoKey("solo", 456), VIDEO_URL)

        await submitScoreRender("t3_post1", makeScore(), "osu")

        expect(fetch).not.toHaveBeenCalled()
        expect(runJobMock).not.toHaveBeenCalled()
        expect(editMock).toHaveBeenCalledTimes(1)
        expect(isVideoHeading(editedDocument()[0])).toBe(true)
        // no guard was taken
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
    })

    it("queues the post on the in-progress guard instead of submitting a duplicate render", async () => {
        storeDocument()
        storeGuard(["t3_other"])

        await submitScoreRender("t3_post1", makeScore(), "osu")

        expect(fetch).not.toHaveBeenCalled()
        expect(runJobMock).not.toHaveBeenCalled()
        // this post now waits on the in-progress render alongside the other scorepost
        expect(JSON.parse(state.strings.get(renderGuardKey("solo", 456))!)).toEqual(["t3_other", "t3_post1"])
        expectSetWithTtl(renderGuardKey("solo", 456), RENDER_GUARD_TTL_SECONDS)
    })

    it("doesn't queue the same post twice", async () => {
        storeDocument()
        storeGuard(["t3_post1"])

        await submitScoreRender("t3_post1", makeScore(), "osu")

        expect(JSON.parse(state.strings.get(renderGuardKey("solo", 456))!)).toEqual(["t3_post1"])
    })

    it("releases the guard when o!rdr refuses the render", async () => {
        storeDocument()
        vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ errorCode: 43, message: "this score does not exist" }) } as Response)

        await submitScoreRender("t3_post1", makeScore(), "osu")

        expect(runJobMock).not.toHaveBeenCalled()
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
    })

    it("releases the guard when scheduling the poll fails", async () => {
        storeDocument()
        vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ renderID: 95, errorCode: 0 }) } as Response)
        runJobMock.mockRejectedValueOnce(new Error("scheduler down"))

        await submitScoreRender("t3_post1", makeScore(), "osu")

        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
    })

    it.each([
        ["non-osu gamemode", "taiko", makeScore()],
        ["score without replay", "osu", makeScore({ has_replay: false })]
    ] as const)("%s", async (_name, gamemode, postedPlay) => {
        storeDocument()

        await submitScoreRender("t3_post1", postedPlay, gamemode)

        expect(fetch).not.toHaveBeenCalled()
        expect(runJobMock).not.toHaveBeenCalled()
        expect(editMock).not.toHaveBeenCalled()
    })

    it("submits stable plays using the score's ID under the legacy type", async () => {
        storeDocument()
        vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ renderID: 95, errorCode: 0 }) } as Response)

        await submitScoreRender("t3_post1", makeScore({ is_stable: true }), "osu")

        // the render is submitted for the score's ID under the legacy scheme, and the poll job carries the same IDs
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(JSON.parse(state.strings.get(renderGuardKey("legacy", 456))!)).toEqual(["t3_post1"])
        const job = vi.mocked(scheduler.runJob).mock.calls[0]![0] as { name: string; data: SchedulerOrdrPollInput; runAt: Date }
        expect(job.data.scoreId).toBe(456)
        expect(job.data.scoreType).toBe("legacy")
    })

    it("submits the replay when has_replay is unknown (the osu! API doesn't always supply it)", async () => {
        storeDocument()
        vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ renderID: 95, errorCode: 0 }) } as Response)

        await submitScoreRender("t3_post1", makeScore({ has_replay: undefined }), "osu")

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(runJobMock).toHaveBeenCalledTimes(1)
    })
})

describe("pollRender", () => {
    it("re-adds the cached video link without polling when the score's video was already cached (e.g. a redelivered job)", async () => {
        storeDocument()
        state.strings.set(renderVideoKey("solo", 456), VIDEO_URL)

        await pollRender(makePayload())

        expect(fetch).not.toHaveBeenCalled()
        expect(runJobMock).not.toHaveBeenCalled()
        expect(editMock).toHaveBeenCalledTimes(1)
        expect(isVideoHeading(editedDocument()[0])).toBe(true)
    })

    it("re-runs the completion from the cache after a previous poll was interrupted partway through", async () => {
        // the previous poll cached the URL and edited the job's post, but died before draining the waiting list
        storeDocument("t3_post1")
        storeDocument("t3_post2")
        state.strings.set(renderVideoKey("solo", 456), VIDEO_URL)
        storeGuard(["t3_post1", "t3_post2"])
        await addVideoToComment("t3_post1", VIDEO_URL)

        await pollRender(makePayload())

        // both the job's post (no-op, it already has the link) and the waiting post got the link, guard released
        expect(editMock).toHaveBeenCalledTimes(2)
        expect(isVideoHeading(editedDocument(1)[0])).toBe(true)
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
    })

    it("adds the video link, caches the URL and releases the guard when the render is done", async () => {
        storeDocument()
        storeGuard(["t3_post1"])
        vi.mocked(fetch).mockResolvedValueOnce(renderResponse([{ progress: "Done.", videoUrl: VIDEO_URL, errorCode: 0 }]))

        await pollRender(makePayload())

        expect(editMock).toHaveBeenCalledTimes(1)
        const document = editedDocument()
        expect(isVideoHeading(document[0])).toBe(true)
        expect((document[0] as any).c[0].u).toBe(VIDEO_URL)
        expect(state.strings.get(renderVideoKey("solo", 456))).toBe(VIDEO_URL)
        expectSetWithTtl(renderVideoKey("solo", 456), RENDER_VIDEO_TTL_SECONDS)
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
        expect(runJobMock).not.toHaveBeenCalled()
    })

    it("adds the video link to every scorepost that arrived while the render was in progress", async () => {
        storeDocument("t3_post1")
        storeDocument("t3_post2")
        storeGuard(["t3_post1", "t3_post2"])
        vi.mocked(fetch).mockResolvedValueOnce(renderResponse([{ progress: "Done.", videoUrl: VIDEO_URL, errorCode: 0 }]))

        await pollRender(makePayload())

        // both comments got the heading (the job's own post isn't edited twice: addVideoToComment is idempotent)
        expect(editMock).toHaveBeenCalledTimes(2)
        expect(isVideoHeading(editedDocument(0)[0])).toBe(true)
        expect(isVideoHeading(editedDocument(1)[0])).toBe(true)
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
    })

    it("clears the state without editing when the render failed", async () => {
        storeDocument()
        storeGuard(["t3_post1"])
        vi.mocked(fetch).mockResolvedValueOnce(renderResponse([{ progress: "Failed.", videoUrl: "", errorCode: 44 }]))

        await pollRender(makePayload())

        expect(editMock).not.toHaveBeenCalled()
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
        expect(runJobMock).not.toHaveBeenCalled()
    })

    it("requeues the poll when the render is still in progress", async () => {
        storeGuard(["t3_post1"])
        vi.mocked(fetch).mockResolvedValueOnce(renderResponse([{ progress: "Rendering... (40%)", videoUrl: "None", errorCode: 0 }]))

        const payload = makePayload()
        await pollRender(payload)

        expect(runJobMock).toHaveBeenCalledTimes(1)
        const job = vi.mocked(scheduler.runJob).mock.calls[0]![0] as { name: string; data: SchedulerOrdrPollInput; runAt: Date }
        expect(job.name).toBe(RENDER_JOB_NAME)
        expect(job.data).toEqual(payload)
        expect(job.runAt.getTime()).toBeLessThanOrEqual(Date.now() + GET_RENDERS_POLL_INTERVAL_MS + 100)
        // the guard is kept so posts arriving meanwhile still wait on the render
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(true)
        expect(editMock).not.toHaveBeenCalled()
    })

    it("requeues the poll when the status request itself failed", async () => {
        storeGuard(["t3_post1"])
        vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, text: async () => "oops" } as Response)

        await pollRender(makePayload())

        expect(runJobMock).toHaveBeenCalledTimes(1)
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(true)
    })

    it("gives up after the render timeout", async () => {
        storeGuard(["t3_post1"])
        vi.mocked(fetch).mockResolvedValueOnce(renderResponse([{ progress: "Rendering... (10%)", videoUrl: "None", errorCode: 0 }]))

        await pollRender(makePayload({ submittedAt: Date.now() - RENDER_TIMEOUT_MS - 1000 }))

        expect(runJobMock).not.toHaveBeenCalled()
        expect(state.strings.has(renderGuardKey("solo", 456))).toBe(false)
        expect(editMock).not.toHaveBeenCalled()
    })

    it("polls without a guard (the guard expired but the chain is still alive)", async () => {
        storeDocument()
        vi.mocked(fetch).mockResolvedValueOnce(renderResponse([{ progress: "Done.", videoUrl: VIDEO_URL, errorCode: 0 }]))

        await pollRender(makePayload())

        // the job's own post still gets its link, only the waiting stragglers would be lost
        expect(editMock).toHaveBeenCalledTimes(1)
        expect(isVideoHeading(editedDocument()[0])).toBe(true)
        expect(runJobMock).not.toHaveBeenCalled()
    })
})
