import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getBeatmap, lookupUser } from "../src/core/requests/osu_api"

vi.mock("../src/core/requests/osu_oauth", () => ({
    getAccessToken: vi.fn().mockResolvedValue("test-token")
}))

/** raw beatmap payload as returned by the osu! API, with an overridable rank status (integer or string form) */
function rawBeatmap(ranked: number | string): Record<string, unknown> {
    return {
        beatmapset_id: 789,
        difficulty_rating: 5.5,
        id: 123456,
        mode: "osu",
        total_length: 240,
        user_id: 100,
        version: "Hard",
        max_combo: 500,
        accuracy: 8,
        ar: 9,
        bpm: 180,
        cs: 4,
        drain: 6,
        ranked,
        playcount: 1000
    }
}

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("getBeatmap", () => {
    it("maps the ranked status integer to its display name", async () => {
        const statuses: [number, string][] = [
            [-2, "Graveyard"],
            [-1, "WIP"],
            [0, "Pending"],
            [1, "Ranked"],
            [2, "Approved"],
            [3, "Qualified"],
            [4, "Loved"]
        ]
        for (const [ranked, label] of statuses) {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => rawBeatmap(ranked)
            } as Response)
            const result = await getBeatmap(123456)
            expect(result.error).toBe(false)
            if (!result.error) {
                expect(result.data.status).toBe(label)
            }
        }
    })

    it("maps the string status form to its display name", async () => {
        const statuses: [string, string][] = [
            ["graveyard", "Graveyard"],
            ["wip", "WIP"],
            ["pending", "Pending"],
            ["ranked", "Ranked"],
            ["approved", "Approved"],
            ["qualified", "Qualified"],
            ["loved", "Loved"]
        ]
        for (const [ranked, label] of statuses) {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => rawBeatmap(ranked)
            } as Response)
            const result = await getBeatmap(123456)
            expect(result.error).toBe(false)
            if (!result.error) {
                expect(result.data.status).toBe(label)
            }
        }
    })

    it("returns null status for unknown ranked values", async () => {
        for (const ranked of [99, "someFutureStatus"]) {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => rawBeatmap(ranked)
            } as Response)
            const result = await getBeatmap(123456)
            expect(result.error).toBe(false)
            if (!result.error) {
                expect(result.data.status).toBeNull()
            }
        }
    })

    it("strips the raw ranked integer from the parsed beatmap", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => rawBeatmap(1)
        } as Response)
        const result = await getBeatmap(123456)
        expect(result.error).toBe(false)
        if (!result.error) {
            expect("ranked" in result.data).toBe(false)
        }
    })
})

describe("lookupUser", () => {
    it("accepts an unranked player with explicit null global_rank and country_rank", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: 123,
                username: "TestUser",
                country_code: "US",
                statistics: {
                    country_rank: null,
                    accuracy: 0.985,
                    play_count: 2000,
                    pp: 5000,
                    global_rank: null
                }
            })
        } as Response)
        const result = await lookupUser("TestUser")
        expect(result.error).toBe(false)
        if (!result.error) {
            expect(result.data.statistics?.global_rank).toBeNull()
            expect(result.data.statistics?.country_rank).toBeNull()
        }
    })
})
