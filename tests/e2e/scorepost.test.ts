import { describe, it, expect, vi, beforeEach } from "vitest"
import { processScorepost } from "../../src/core/scorepost/process_scorepost"
import { buildComment, type CommentData } from "../../src/core/scorepost/rtjson"
import * as osuApi from "../../src/core/requests/osu_api"
import * as osuTools from "../../src/core/requests/osu_tools"
import * as beatmapSearch from "../../src/core/scorepost/beatmap_search"
import { reddit } from "@devvit/web/server"
import type { BeatmapExtended, User, Gamemode } from "../../src/core/requests/osu_api"

// Mock all external dependencies
vi.mock("../../src/core/requests/osu_api")
vi.mock("../../src/core/requests/osu_tools")
vi.mock("../../src/core/scorepost/beatmap_search")
vi.mock("@devvit/redis")
vi.mock("@devvit/web/server", () => ({
    reddit: {
        submitComment: vi.fn().mockResolvedValue({
            distinguish: vi.fn().mockResolvedValue(undefined)
        }),
        getAppUser: vi.fn().mockResolvedValue({ id: "t2_app", username: "osu-bot" }),
        getComments: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue([]) })
    }
}))

// Helper to create mock objects
function makeBeatmap(overrides: Partial<BeatmapExtended> = {}): BeatmapExtended {
    return {
        id: 123456,
        beatmapset_id: 789,
        mode: "osu",
        total_length: 240,
        max_combo: 500,
        user_id: 1,
        difficulty_rating: 5.5,
        ar: 9,
        cs: 4,
        accuracy: 8,
        drain: 6,
        bpm: 180,
        version: "Hard",
        status: "Ranked",
        playcount: 1000,
        beatmapset: {
            artist: "Test Artist",
            title: "Test Song",
            creator: "Test Mapper",
            ranked_date: "2023-01-01T00:00:00Z"
        },
        owners: [{ id: 1, username: "Test Mapper" }],
        ...overrides
    } as BeatmapExtended
}

function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: 123,
        username: "TestPlayer",
        country_code: "US",
        statistics: {
            global_rank: 100,
            country_rank: 50,
            pp: 5000,
            accuracy: 0.985,
            play_count: 2000
        },
        ...overrides
    } as User
}

function makeCommentData(overrides: Partial<CommentData> = {}): CommentData {
    return {
        beatmap: null,
        player: null,
        mode: "osu",
        mods: [],
        acc: null,
        guestMapper: null,
        topScore: null,
        playerTopScore: null,
        maxCombo: null,
        moddedDifficulty: null,
        ppAccuracies: [],
        nomodPp: [],
        moddedPp: [],
        ...overrides
    }
}

function makePost(title: string) {
    return { id: "t3_test", title, subreddit: { name: "osugame" } } as any
}

// Helper to extract text from RTJSON
function extractText(doc: any): string {
    if (!doc) return ""

    // If doc is the full RTJSON object, get the document array
    const document = doc.document || doc
    if (!Array.isArray(document)) return ""

    let text = ""
    for (const node of document) {
        // RTJSON uses 't' for text
        if (node?.t && typeof node.t === "string") {
            text += node.t
        }

        // Also check for 'insert' (used in some RTJSON versions)
        if (node?.insert && typeof node.insert === "string") {
            text += node.insert
        }

        // Handle content arrays - this is the main structure
        if (node?.c && Array.isArray(node.c)) {
            // For tables, the 'c' property contains rows (arrays of cells)
            // Each cell has its own 'c' property with content
            // We need to handle both cases
            for (const child of node.c) {
                if (Array.isArray(child)) {
                    // This is a table row - process each cell
                    for (const cell of child) {
                        if (cell?.c && Array.isArray(cell.c)) {
                            text += extractText(cell.c)
                        } else if (typeof cell?.t === "string") {
                            text += cell.t
                        }
                    }
                } else {
                    // Regular nested element
                    if (child?.t && typeof child.t === "string") {
                        text += child.t
                    }
                    if (child?.insert && typeof child.insert === "string") {
                        text += child.insert
                    }
                    if (child?.c && Array.isArray(child.c)) {
                        text += extractText(child.c)
                    }
                }
            }
        }

        // Document array
        if (node?.document && Array.isArray(node.document)) {
            text += extractText(node.document)
        }

        // Also check for 'content' (might be used in some versions)
        if (node?.content && Array.isArray(node.content)) {
            text += extractText(node.content)
        }

        // For table headers (h), recursively extract text from header cells
        if (node?.h && Array.isArray(node.h)) {
            for (const header of node.h) {
                if (header?.c && Array.isArray(header.c)) {
                    text += extractText(header.c)
                }
            }
        }
    }
    return text
}

describe("E2E: Scorepost Processing", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // default mock: all getPerformance calls succeed with a generic response
        vi.mocked(osuTools.getPerformance).mockResolvedValue({
            error: false,
            data: {
                performance: 400,
                difficulty: {
                    starRating: 6,
                    approachRate: 9,
                    overallDifficulty: 8,
                    circleSize: 4,
                    drainRate: 6,
                    maxCombo: 1000,
                    bpm: 180,
                    length: 240,
                    drainLength: 240,
                    attributes: {}
                },
                score: {
                    rulesetId: 0,
                    beatmapId: 123456,
                    beatmapName: "Test",
                    accuracy: 100,
                    combo: 1000,
                    statistics: {}
                },
                performanceAttributes: {
                    total: 400,
                    aim: 200,
                    speed: 100,
                    accuracyPp: 100,
                    flashlight: 0,
                    effectiveMissCount: 0,
                    extra: {}
                }
            }
        })
    })

    describe("Full Pipeline", () => {
        it("processes standard NM scorepost", async () => {
            const post = makePost("mrekk | xi - Blue Zenith [Hard] 99.5%")

            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser({ username: "mrekk" }) })
            vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: makeBeatmap(), topPlay: null })
            vi.mocked(osuApi.getBeatmapScores).mockResolvedValue({ error: false, data: { scores: [] } })
            vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })

            await processScorepost(post)

            expect(osuApi.lookupUser).toHaveBeenCalledWith("mrekk", "osu")
            expect(beatmapSearch.searchBeatmap).toHaveBeenCalled()
        })

        it("processes scorepost with mods", async () => {
            const post = makePost("Player | Artist - Song [Insane] +HDDT 98.5% FC")

            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser() })
            vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: makeBeatmap(), topPlay: null })
            vi.mocked(osuApi.getBeatmapScores).mockResolvedValue({ error: false, data: { scores: [] } })
            vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })
            vi.mocked(osuTools.getPerformance).mockResolvedValue({
                error: false,
                data: {
                    performance: 488.06,
                    difficulty: {
                        starRating: 7.25,
                        approachRate: 9.6,
                        overallDifficulty: 8.8,
                        circleSize: 5.2,
                        drainRate: 5.7,
                        maxCombo: 2153,
                        bpm: 270,
                        length: 161,
                        drainLength: 161,
                        attributes: {}
                    },
                    score: {
                        rulesetId: 0,
                        beatmapId: 123456,
                        beatmapName: "Test",
                        accuracy: 98.5,
                        combo: 2153,
                        statistics: {}
                    },
                    performanceAttributes: {
                        total: 488.06,
                        aim: 205.9,
                        speed: 152.8,
                        accuracyPp: 121.3,
                        flashlight: 0,
                        effectiveMissCount: 0,
                        extra: {}
                    }
                }
            })

            await processScorepost(post)

            expect(osuTools.getPerformance).toHaveBeenCalled()
        })
    })

    describe("Error Handling", () => {
        it("returns early when no player match", async () => {
            const post = makePost("Invalid Title Without Pipe")

            await processScorepost(post)

            expect(osuApi.lookupUser).not.toHaveBeenCalled()
            expect(beatmapSearch.searchBeatmap).not.toHaveBeenCalled()
        })

        it("returns early when no beatmap match", async () => {
            // note: in practice the player gate fires first here.
            // beatmapRegex's lazy backtracking matches almost any title that passes playerRegex, so this covers the title-format gate rather than a beatmap-specific one
            const post = makePost("Player | Invalid[Title")

            await processScorepost(post)

            expect(osuApi.lookupUser).not.toHaveBeenCalled()
        })

        it("handles player not found", async () => {
            const post = makePost("Nobody | Artist - Song [Hard] 99%")

            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: true })

            await processScorepost(post)

            expect(beatmapSearch.searchBeatmap).not.toHaveBeenCalled()
        })

        it("posts a player-only comment when the beatmap isn't found", async () => {
            const post = makePost("Player | Artist - Song [Hard] 99%")

            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser({ username: "mrekk" }) })
            vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: null, topPlay: null })

            await processScorepost(post)

            // no beatmap means no leaderboard/difficulty data to fetch
            expect(osuApi.getBeatmapScores).not.toHaveBeenCalled()
            const submitted = vi.mocked(reddit.submitComment).mock.calls[0]?.[0]
            expect(submitted).toBeDefined()
            // CommentSubmissionOptions is a text|richtext union; the bot always submits richtext
            const text = extractText(JSON.parse((submitted as any).richtext.build()))
            expect(text).toContain("mrekk")
            expect(text).not.toContain("Song [Hard]")
        })
    })

    describe("Gamemodes", () => {
        const modes: [string, Gamemode][] = [
            ["(osu!)", "osu"],
            ["(taiko)", "taiko"],
            ["(catch)", "fruits"],
            ["(mania)", "mania"]
        ]

        modes.forEach(([titleSuffix, mode]) => {
            it(`detects and processes ${mode} mode`, async () => {
                const post = makePost(`Player | Artist - Song [Hard] ${titleSuffix} 99%`)

                vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser() })
                vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: makeBeatmap(), topPlay: null })
                vi.mocked(osuApi.getBeatmapScores).mockResolvedValue({ error: false, data: { scores: [] } })
                vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })

                await processScorepost(post)

                expect(beatmapSearch.searchBeatmap).toHaveBeenCalledWith(expect.any(Number), expect.any(String), mode)
            })
        })
    })

    describe("Comment Building", () => {
        it("builds comment with all components", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap({
                    version: "FOUR DIMENSIONS",
                    difficulty_rating: 7.5,
                    beatmapset: {
                        artist: "xi",
                        title: "Blue Zenith",
                        creator: "MapperName",
                        ranked_date: "2023-01-01T00:00:00Z"
                    }
                }),
                player: makeUser({
                    username: "mrekk",
                    country_code: "FI",
                    statistics: {
                        global_rank: 1,
                        country_rank: 1,
                        pp: 18000,
                        accuracy: 0.992,
                        play_count: 5000
                    }
                }),
                mode: "osu",
                acc: 99.83
            })

            const comment = buildComment(data)

            expect(comment).not.toBeNull()
            const json = JSON.parse(comment!.build())
            expect(Array.isArray(json.document)).toBe(true)

            const text = extractText(json)

            // Map header
            expect(text).toContain("xi - Blue Zenith [FOUR DIMENSIONS]")
            expect(text).toContain("MapperName")
            expect(text).toContain("osu!standard")

            // Player table
            expect(text).toContain("mrekk")
            expect(text).toContain("FI")

            // Footer
            expect(text).toContain("Source")
            expect(text).toContain("Developer")
        })

        it("handles missing beatmapset gracefully", () => {
            const beatmap = makeBeatmap()
            beatmap.beatmapset = null as any

            const data = makeCommentData({ beatmap, player: makeUser() })

            const comment = buildComment(data)
            const text = extractText(JSON.parse(comment!.build()))

            expect(text).toContain("Unknown - Unknown")
        })

        it("handles unranked player", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap({
                    beatmapset: {
                        artist: "Artist",
                        title: "Song",
                        creator: "Mapper"
                    }
                }),
                player: {
                    id: 999,
                    username: "UnrankedPlayer",
                    country_code: "US",
                    statistics: {
                        pp: 0,
                        accuracy: 0,
                        play_count: 0
                    }
                } as User
            })

            const comment = buildComment(data)
            const text = extractText(JSON.parse(comment!.build()))

            expect(text).toContain("Unranked")
            expect(text).not.toContain("#0")
        })

        it("handles guest mapper", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap({
                    owners: [
                        { id: 1, username: "Original" },
                        { id: 2, username: "Guest" }
                    ]
                }),
                player: makeUser(),
                guestMapper: { id: 2, username: "Guest" }
            })

            const comment = buildComment(data)
            const text = extractText(JSON.parse(comment!.build()))

            expect(text).toContain("GD by")
            expect(text).toContain("Guest")
        })
    })

    describe("Accuracy Parsing", () => {
        const setupHappyMocks = () => {
            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser() })
            vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: makeBeatmap(), topPlay: null })
            vi.mocked(osuApi.getBeatmapScores).mockResolvedValue({ error: false, data: { scores: [] } })
            vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })
        }

        /** accuracies getPerformance was called with (4th argument, always passed by processScorepost) */
        const requestedAccuracies = () => vi.mocked(osuTools.getPerformance).mock.calls.map(c => c[3] as number)

        it("ignores the percentage in a map name and keeps the real accuracy", async () => {
            // real ranked map: https://osu.ppy.sh/beatmapsets/25589 (Hikaru Genji - Yuuki 100%).
            const post = makePost("Player | Hikaru Genji - Yuuki 100% [AHard] +HDDT 98.5% FC")
            setupHappyMocks()

            await processScorepost(post)

            // once per accuracy for NoMod and once for the modded row
            expect([...new Set(requestedAccuracies())].sort((a, b) => a - b)).toEqual([95, 98, 98.5, 99, 100])
        })

        it("drops an out-of-range accuracy value", async () => {
            const post = makePost("Player | Artist - Title [Diff] +HDDT 300% FC")
            setupHappyMocks()

            await expect(processScorepost(post)).resolves.toBeUndefined()

            // once per accuracy for NoMod and once for the modded row
            expect([...new Set(requestedAccuracies())].sort((a, b) => a - b)).toEqual([95, 98, 99, 100])
        })

        it("keeps the score accuracy over a later commentary percentage", async () => {
            const post = makePost("Player | Artist - Title [Diff] +HDDT 98.5% FC | gave it 110%")
            setupHappyMocks()

            await processScorepost(post)

            expect(requestedAccuracies()).toContain(98.5)
            expect(requestedAccuracies()).not.toContain(110)
        })
    })

    describe("Real-World Examples", () => {
        it("processes mrekk HDDT scorepost", async () => {
            const post = makePost("mrekk | xi - Blue Zenith [FOUR DIMENSIONS] +HDDT 98.56% 1423x/1634x 1xMiss")

            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser({ username: "mrekk" }) })
            vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: makeBeatmap(), topPlay: null })
            vi.mocked(osuApi.getBeatmapScores).mockResolvedValue({ error: false, data: { scores: [] } })
            vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })

            await processScorepost(post)

            expect(osuApi.lookupUser).toHaveBeenCalledWith("mrekk", "osu")
        })

        it("processes WhiteCat HDHR scorepost", async () => {
            const post = makePost("WhiteCat | Chino(CV.Minase Inori) - Shinsaku no Shiawase wa Kochira! [Happy~!] +HDHR 99.82% FC")

            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser({ username: "WhiteCat" }) })
            vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: makeBeatmap(), topPlay: null })
            vi.mocked(osuApi.getBeatmapScores).mockResolvedValue({ error: false, data: { scores: [] } })
            vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })

            await processScorepost(post)

            expect(beatmapSearch.searchBeatmap).toHaveBeenCalled()
        })
    })

    describe("Duplicate Comment Guard", () => {
        const setupHappyMocks = () => {
            vi.mocked(osuApi.lookupUser).mockResolvedValue({ error: false, data: makeUser() })
            vi.mocked(beatmapSearch.searchBeatmap).mockResolvedValue({ beatmap: makeBeatmap(), topPlay: null })
            vi.mocked(osuApi.getBeatmapScores).mockResolvedValue({ error: false, data: { scores: [] } })
            vi.mocked(osuApi.getUserBestScores).mockResolvedValue({ error: false, data: [] })
        }

        it("skips processing when the bot's comment already exists on the post", async () => {
            const post = makePost("Player | Artist - Song [Hard] +HDDT 98.5% FC")

            vi.mocked(reddit.getComments).mockReturnValueOnce({
                all: vi.fn().mockResolvedValue([{ authorId: "t2_app", distinguish: vi.fn() }])
            } as any)

            await processScorepost(post)

            expect(osuApi.lookupUser).not.toHaveBeenCalled()
            expect(reddit.submitComment).not.toHaveBeenCalled()
        })

        it("adopts the comment a failed attempt created instead of retrying", async () => {
            const post = makePost("Player | Artist - Song [Hard] +HDDT 98.5% FC")
            setupHappyMocks()

            vi.mocked(reddit.submitComment).mockRejectedValueOnce(new Error("timeout"))
            const distinguish = vi.fn().mockResolvedValue(undefined)
            // first call: the top-of-function check finds nothing; second call (after the failed attempt): the comment the failed attempt created is there
            vi.mocked(reddit.getComments)
                .mockReturnValueOnce({ all: vi.fn().mockResolvedValue([]) } as any)
                .mockReturnValueOnce({ all: vi.fn().mockResolvedValue([{ authorId: "t2_app", distinguish }]) } as any)

            await processScorepost(post)

            expect(reddit.submitComment).toHaveBeenCalledTimes(1)
            expect(distinguish).toHaveBeenCalledWith(true)
        })
    })
})
