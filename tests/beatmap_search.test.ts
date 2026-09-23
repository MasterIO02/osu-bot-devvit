import { describe, it, expect, vi, beforeEach } from "vitest"
import { searchBeatmap } from "../src/core/scorepost/beatmap_search"
import * as osuApi from "../src/core/requests/osu_api"
import type { BeatmapExtended, Score } from "../src/core/requests/osu_api"

// mock the osu! API module so no real requests are made; every test sets the mocks it needs
vi.mock("../src/core/requests/osu_api")

function makeBeatmap(overrides: Partial<BeatmapExtended> = {}): BeatmapExtended {
    return {
        beatmapset_id: 789,
        difficulty_rating: 5.5,
        id: 123456,
        mode: "osu",
        total_length: 240,
        user_id: 100,
        version: "Hard",
        accuracy: 8,
        ar: 9,
        bpm: 180,
        cs: 4,
        drain: 6,
        status: "Ranked",
        playcount: 1000,
        ...overrides
    }
}

/** the score's map display string is `${beatmapset.artist} - ${beatmapset.title} [${beatmap.version}]` */
function embeddedBeatmap(id: number, version: string) {
    return { id, version, beatmapset_id: 123456, mode: "osu" }
}

function makeScore(overrides: Partial<Score> = {}): Score {
    return {
        user_id: 1,
        username: "TestPlayer",
        accuracy: 0.99,
        mods: [],
        max_combo: 500,
        is_perfect_combo: false,
        pp: 100,
        ended_at: new Date().toISOString(),
        miss_count: 0,
        total_score: 1000000,
        is_stable: false,
        beatmap: embeddedBeatmap(123456, "Hard"),
        beatmapset: { artist: "Artist", creator: "Mapper", title: "Title", ranked_date: null },
        ...overrides
    }
}

const MATCHING_MAP = "Artist - Title [Hard]"

beforeEach(() => {
    vi.clearAllMocks()
    // defaults: no scores anywhere, getBeatmap echoes the requested id
    vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })
    vi.mocked(osuApi.getUserRecentScores).mockResolvedValue({ error: false, data: [] })
    vi.mocked(osuApi.getBeatmap).mockImplementation(async (id: number) => ({ error: false, data: makeBeatmap({ id }) }))
})

describe("searchBeatmap", () => {
    it("finds a matching beatmap in the player's best scores", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [makeScore()] })

        const result = await searchBeatmap(1, MATCHING_MAP, "osu")

        expect(result.beatmap?.id).toBe(123456)
        // the top play is the first best score, from the same request
        expect(result.topPlay?.beatmap?.id).toBe(123456)
        // the matched score is the play the beatmap was found through
        expect(result.matchedScore?.beatmap?.id).toBe(123456)
        // found in best scores, no need to look at recent plays
        expect(osuApi.getUserRecentScores).not.toHaveBeenCalled()
    })

    it("passes the player id and gamemode through to the API calls", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [makeScore()] })

        await searchBeatmap(42, MATCHING_MAP, "mania")

        expect(osuApi.getUserBestScores).toHaveBeenCalledWith(42, "mania", 100)
        expect(osuApi.getBeatmap).toHaveBeenCalledWith(123456)
    })

    it("matches case-insensitively and in both partial directions", async () => {
        // case-insensitive exact match
        vi.mocked(osuApi.getUserBestScores).mockResolvedValueOnce({ error: false, data: [makeScore()] })
        expect((await searchBeatmap(1, "artist - title [hard]", "osu")).beatmap?.id).toBe(123456)

        // title shorter than the API string:
        // FREEDOM DiVE case, where the set title holds a bracket so the regex capture "… - FREEDOM DiVE [METAL DIMENSIONS]" stops before the real "[Extra]" difficulty
        vi.mocked(osuApi.getUserBestScores).mockResolvedValueOnce({ error: false, data: [makeScore()] })
        expect((await searchBeatmap(1, "Artist - Tit", "osu")).beatmap?.id).toBe(123456)

        // API string shorter than the title: defensive reverse direction, matchesBeatmap also accepts the title containing the API string
        vi.mocked(osuApi.getUserBestScores).mockResolvedValueOnce({ error: false, data: [makeScore()] })
        expect((await searchBeatmap(1, "Artist - Title [Hard] [Extra]", "osu")).beatmap?.id).toBe(123456)
    })

    it("skips best scores older than one week", async () => {
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({
            error: false,
            data: [makeScore({ ended_at: eightDaysAgo, beatmap: embeddedBeatmap(111, "Old") }), makeScore({ beatmap: embeddedBeatmap(222, "Fresh") })]
        })

        // both scores' map strings match: "Artist - Title [Old]" and "Artist - Title [Fresh]" contain the partial title
        const result = await searchBeatmap(1, "Artist - Title", "osu")

        // the old score is filtered out, only the fresh one is fetched
        expect(osuApi.getBeatmap).toHaveBeenCalledTimes(1)
        expect(result.beatmap?.id).toBe(222)
    })

    it("treats a missing ended_at as recent (NaN date is not skipped)", async () => {
        // user score responses always include ended_at, but normalizeScore defaults it to "" when absent; new Date("") is NaN and NaN < oneWeekAgo is false, so the score is kept
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({
            error: false,
            data: [makeScore({ ended_at: "", beatmap: embeddedBeatmap(333, "NoDate") })]
        })

        const result = await searchBeatmap(1, "Artist - Title [NoDate]", "osu")

        expect(result.beatmap?.id).toBe(333)
    })

    it("tries the next score when getBeatmap fails for a match", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({
            error: false,
            data: [makeScore({ beatmap: embeddedBeatmap(1, "A") }), makeScore({ beatmap: embeddedBeatmap(2, "B") })]
        })
        vi.mocked(osuApi.getBeatmap).mockImplementation(async (id: number) => (id === 1 ? { error: true } : { error: false, data: makeBeatmap({ id }) }))

        const result = await searchBeatmap(1, "Artist - Title", "osu")

        expect(result.beatmap?.id).toBe(2)
    })

    it("ignores scores without embedded beatmap data", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({
            error: false,
            data: [makeScore({ beatmap: undefined, beatmapset: undefined })]
        })

        const result = await searchBeatmap(1, MATCHING_MAP, "osu")

        expect(result.beatmap).toBeNull()
        expect(osuApi.getBeatmap).not.toHaveBeenCalled()
    })

    it("falls back to recent scores when best scores have no match", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({
            error: false,
            data: [makeScore({ beatmap: embeddedBeatmap(111, "Other") })]
        })
        vi.mocked(osuApi.getUserRecentScores).mockResolvedValue({ error: false, data: [makeScore()] })

        const result = await searchBeatmap(1, MATCHING_MAP, "osu")

        expect(osuApi.getUserRecentScores).toHaveBeenCalledWith(1, "osu", 50)
        expect(result.beatmap?.id).toBe(123456)
        // the matched score is the one from the recent scores fallback
        expect(result.matchedScore?.beatmap?.id).toBe(123456)
    })

    it("falls back to recent scores when the best scores request errors", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: true })
        vi.mocked(osuApi.getUserRecentScores).mockResolvedValue({ error: false, data: [makeScore()] })

        const result = await searchBeatmap(1, MATCHING_MAP, "osu")

        expect(result.beatmap?.id).toBe(123456)
        // no best scores means no top play either
        expect(result.topPlay).toBeNull()
    })

    it("dedupes recent scores by beatmap id", async () => {
        vi.mocked(osuApi.getUserRecentScores).mockResolvedValue({
            error: false,
            data: [makeScore({ beatmap: embeddedBeatmap(111, "NoMatch") }), makeScore({ beatmap: embeddedBeatmap(111, "WouldMatch") }), makeScore({ beatmap: embeddedBeatmap(222, "Match") })]
        })

        const result = await searchBeatmap(1, "Artist - Title [Match]", "osu")

        // the duplicate id 111 is skipped entirely, so only id 222 is fetched
        expect(osuApi.getBeatmap).toHaveBeenCalledTimes(1)
        expect(result.beatmap?.id).toBe(222)
    })

    it("returns null when nothing matches in best or recent scores", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({
            error: false,
            data: [makeScore({ beatmap: embeddedBeatmap(111, "Other") })]
        })
        vi.mocked(osuApi.getUserRecentScores).mockResolvedValue({
            error: false,
            data: [makeScore({ beatmap: embeddedBeatmap(222, "AlsoOther") })]
        })

        const result = await searchBeatmap(1, MATCHING_MAP, "osu")

        expect(result.beatmap).toBeNull()
        expect(result.matchedScore).toBeNull()
    })

    it("returns null when both requests error", async () => {
        vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: true })
        vi.mocked(osuApi.getUserRecentScores).mockResolvedValue({ error: true })

        const result = await searchBeatmap(1, MATCHING_MAP, "osu")

        expect(result.beatmap).toBeNull()
    })
})
