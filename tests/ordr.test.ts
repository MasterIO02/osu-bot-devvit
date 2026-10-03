import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { submitRender, getRender, SKIN_NOMOD, SKIN_EZ, SKIN_DT } from "../src/core/requests/ordr"
import type { Score } from "../src/core/requests/osu_api"

vi.mock("@devvit/web/server", async importOriginal => {
    const actual = await importOriginal<typeof import("@devvit/web/server")>()
    return {
        ...actual,
        settings: {
            get: vi.fn(async (name: string) => (name === "ordrApiKey" ? "test-ordr-key" : undefined))
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

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
    vi.unstubAllGlobals()
})

/** the request init of the first fetch call */
function firstCallInit(): RequestInit {
    return vi.mocked(fetch).mock.calls[0]![1] as RequestInit
}

describe("submitRender", () => {
    it("submits the score's required fields and returns the render ID", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ message: "Render added successfully", renderID: 95, errorCode: 0 }) } as Response)

        const result = await submitRender(makeScore({ mods: [{ acronym: "HD" }, { acronym: "DT" }] }))

        expect(result).toEqual({ error: false, data: { renderID: 95 } })
        // only the fields o!rdr needs are pinned; the render settings (resolution, overlays, skin, ...) are free to change
        const form = firstCallInit().body as FormData
        expect(form.get("replayScoreId")).toBe("456")
        expect(form.get("replayScoreIdType")).toBe("solo")
        expect(form.get("verificationKey")).toBe("test-ordr-key")
    })

    it.each([
        ["nomod plays", [], SKIN_NOMOD],
        ["DT plays", ["DT"], SKIN_DT],
        ["NC plays", ["NC"], SKIN_DT],
        ["EZ plays, including EZDT", ["EZ", "DT"], SKIN_EZ]
    ] as [string, string[], string][])("selects the %s skin by the play's mods", async (_name, modAcronyms, expectedSkin) => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ renderID: 95, errorCode: 0 }) } as Response)

        await submitRender(makeScore({ mods: modAcronyms.map(acronym => ({ acronym })) }))

        const form = firstCallInit().body as FormData
        // the mapping is pinned through the skin constants, so changing a skin ID doesn't break the test, breaking the mapping does
        expect(form.get("skin")).toBe(expectedSkin)
        // and the skin only applies because custom skins are enabled
        expect(form.get("customSkin")).toBe("true")
    })

    it("submits stable plays using the score's ID under the legacy type", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ renderID: 96, errorCode: 0 }) } as Response)

        const result = await submitRender(makeScore({ is_stable: true }))

        expect(result.error).toBe(false)
        const form = firstCallInit().body as FormData
        expect(form.get("replayScoreId")).toBe("456")
        expect(form.get("replayScoreIdType")).toBe("legacy")
    })

    it("errors on a non-2xx response (o!rdr signals every refusal that way, with errorCode/message in the body)", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 400, text: async () => JSON.stringify({ message: "Cannot parse replay.", errorCode: 2 }) } as Response)

        const result = await submitRender(makeScore())

        expect(result.error).toBe(true)
    })

    it("errors when the o!rdr API key isn't configured", async () => {
        const { settings } = await import("@devvit/web/server")
        vi.mocked(settings.get).mockResolvedValueOnce(undefined)

        const result = await submitRender(makeScore())

        expect(result.error).toBe(true)
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe("getRender", () => {
    it("polls the render by ID (the API returns just that render)", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ renders: [], maxRenders: 0 }) } as Response)

        await getRender(95)

        expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("https://apis.issou.best/ordr/renders?renderID=95")
    })

    it("reports done when the render's progress is Done.", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ renders: [{ progress: "Done.", videoUrl: "https://link.issou.best/VJ6qLr", errorCode: 0 }], maxRenders: 1 })
        } as Response)

        const result = await getRender(95)

        expect(result).toEqual({ error: false, data: { status: "done", videoUrl: "https://link.issou.best/VJ6qLr" } })
    })

    it("reports failed when the render carries an error code", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ renders: [{ progress: "", videoUrl: "", errorCode: 44 }] })
        } as Response)

        const result = await getRender(95)

        expect(result).toEqual({ error: false, data: { status: "failed", reason: "errorCode 44" } })
    })

    it("reports pending while the render is in progress", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ renders: [{ progress: "Rendering... (50%)", videoUrl: "None", errorCode: 0 }] })
        } as Response)

        const result = await getRender(95)

        expect(result).toEqual({ error: false, data: { status: "pending" } })
    })

    it("errors when the render isn't in the list", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ renders: [], maxRenders: 0 }) } as Response)

        const result = await getRender(95)

        expect(result.error).toBe(true)
    })

    it("errors on a non-2xx response", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, text: async () => "oops" } as Response)

        const result = await getRender(95)

        expect(result.error).toBe(true)
    })
})
