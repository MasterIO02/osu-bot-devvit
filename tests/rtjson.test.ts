import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildComment, type CommentData } from "../src/core/scorepost/rtjson"
import type { BeatmapExtended, User, Score, Mod, BeatmapOwner, Gamemode } from "../src/core/requests/osu_api"
import type { PerformanceResponse } from "../src/core/requests/osu_tools"

// deterministic random for footer meme tests
beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0)
})

function makeBeatmap(overrides: Partial<BeatmapExtended> = {}): BeatmapExtended {
    return {
        beatmapset_id: 1,
        difficulty_rating: 5.5,
        id: 123,
        mode: "osu",
        total_length: 240,
        user_id: 100,
        version: "Insane",
        accuracy: 7,
        ar: 9,
        bpm: 180,
        cs: 4,
        drain: 6,
        status: "Ranked",
        playcount: 50000,
        beatmapset: {
            artist: "Artist",
            creator: "Mapper",
            title: "Song Title",
            ranked_date: "2023-06-15T00:00:00Z"
        },
        ...overrides
    }
}

function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: 50,
        username: "TestPlayer",
        country_code: "US",
        statistics: {
            global_rank: 1000,
            country_rank: 50,
            accuracy: 0.995,
            play_count: 100000,
            pp: 12000
        },
        ...overrides
    }
}

function makeScore(overrides: Partial<Score> = {}): Score {
    return {
        user_id: 50,
        username: "TestPlayer",
        accuracy: 0.9856,
        mods: [{ acronym: "HD" }, { acronym: "DT" }],
        max_combo: 1423,
        is_perfect_combo: false,
        pp: 800,
        ended_at: "2024-01-01T00:00:00Z",
        miss_count: 0,
        total_score: 1000000,
        is_stable: false,
        beatmap: undefined,
        beatmapset: undefined,
        ...overrides
    }
}

function makeMod(acronym: string, settings?: Record<string, unknown>): Mod {
    return { acronym, settings }
}

function makeModdedDifficulty(overrides: Partial<PerformanceResponse> = {}): PerformanceResponse {
    return {
        performance: 488.06,
        difficulty: {
            starRating: 7.23,
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
            beatmapId: 123,
            beatmapName: "Test",
            accuracy: 100,
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
        },
        ...overrides
    }
}

function makeCommentData(overrides: Partial<CommentData> = {}): CommentData {
    return {
        beatmap: null,
        player: null,
        mode: "osu",
        mods: [],
        nomodMods: [],
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

/** get the RTJSON document array from a built comment */
function getDoc(comment: NonNullable<ReturnType<typeof buildComment>>): any[] {
    const json = JSON.parse(comment.build())
    return json.document
}

/** recursively extract all text content from RTJSON nodes */
function extractText(doc: any[]): string {
    let text = ""
    for (const node of doc) {
        if (node.t) text += node.t
        if (node.c) {
            // handle table rows (arrays of arrays)
            if (Array.isArray(node.c[0])) {
                for (const row of node.c) {
                    text += extractText(row)
                }
            } else {
                text += extractText(node.c)
            }
        }
        // handle table headers
        if (node.h) text += extractText(node.h)
    }
    return text
}

/** find all nodes with a given element type recursively */
function findNodes(doc: any[], e: string): any[] {
    const results: any[] = []
    for (const node of doc) {
        if (node.e === e) results.push(node)
        if (node.c) {
            if (Array.isArray(node.c[0])) {
                for (const row of node.c) {
                    results.push(...findNodes(row, e))
                }
            } else {
                results.push(...findNodes(node.c, e))
            }
        }
        if (node.h) results.push(...findNodes(node.h, e))
    }
    return results
}

describe("buildComment", () => {
    describe("map header", () => {
        it("contains artist - title [version]", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const links = findNodes(doc, "link")
            const mapLink = links.find((l: any) => l.u?.includes("#osu/123"))
            expect(mapLink?.t).toBe("Artist - Song Title [Insane]")
        })

        it("contains mapper link", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const links = findNodes(doc, "link")
            const mapperLink = links.find((l: any) => l.u?.includes("/u/100"))
            expect(mapperLink?.t).toBe("Mapper")
        })

        it("includes GD link when guest mapper present", () => {
            const guestMapper: BeatmapOwner = { id: 200, username: "GDMapper" }
            const data = makeCommentData({ beatmap: makeBeatmap(), guestMapper })
            const doc = getDoc(buildComment(data)!)
            const links = findNodes(doc, "link")
            const gdLink = links.find((l: any) => l.t === "GDMapper")
            expect(gdLink).toBeDefined()
            expect(gdLink.u).toContain("/u/200")
        })

        it("includes mode string in map header", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), mode: "mania" as Gamemode })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("osu!mania")
        })

        it("includes detected mode in map URL hash", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), mode: "taiko" as Gamemode })
            const doc = getDoc(buildComment(data)!)
            const links = findNodes(doc, "link")
            const mapLink = links.find((l: any) => l.u?.includes("/beatmapsets/"))
            expect(mapLink?.u).toContain("#taiko/123")
        })
    })

    describe("subheader", () => {
        it("contains #1 score info with mods", () => {
            const topScore = makeScore()
            const data = makeCommentData({ beatmap: makeBeatmap(), topScore })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("#1:")
            expect(text).toContain("+HDDT")
            expect(text).toContain("98.56%")
            expect(text).toContain("800pp")
        })

        it("contains max combo", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), maxCombo: 1634 })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("1,634x max combo")
        })

        it("contains ranked status with year", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("Ranked (2023)")
        })

        it("contains playcount", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("50,000 plays")
        })

        it("handles no top score", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), topScore: null })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("Ranked (2023)")
            expect(text).toContain("50,000 plays")
        })

        it("handles score without pp", () => {
            const topScore = makeScore({ pp: undefined })
            const data = makeCommentData({ beatmap: makeBeatmap(), topScore })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("98.56%")
            // pp should not appear in the subheader stats (but may appear in player table)
            // check that the subheader format doesn't include "pp" after accuracy
            const subheaderPart = text.split("98.56%")[1]?.split("||")[0]
            expect(subheaderPart).not.toContain("pp")
        })

        it("shows a 0 pp score as 0pp instead of omitting", () => {
            const topScore = makeScore({ pp: 0 })
            const data = makeCommentData({ beatmap: makeBeatmap(), topScore })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("0pp")
        })

        it("handles score with empty mods (NM)", () => {
            const topScore = makeScore({ mods: [] })
            const data = makeCommentData({ beatmap: makeBeatmap(), topScore })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            // no "+" prefix for NM scores
            expect(text).toContain("98.56%")
        })

        it("shows Qualified status without year", () => {
            const b = makeBeatmap({ status: "Qualified", beatmapset: { artist: "A", creator: "C", title: "T", ranked_date: null } })
            const data = makeCommentData({ beatmap: b })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("Qualified")
            expect(text).not.toContain("Qualified (")
        })

        it("shows status without year when no ranked_date", () => {
            const b = makeBeatmap({ status: "Ranked", beatmapset: { artist: "A", creator: "C", title: "T", ranked_date: null } })
            const data = makeCommentData({ beatmap: b })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("Ranked")
            expect(text).not.toContain("Ranked (")
        })

        it("handles null status gracefully", () => {
            const b = makeBeatmap({ status: null })
            const data = makeCommentData({ beatmap: b })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("50,000 plays")
        })
    })

    describe("difficulty table", () => {
        it("contains NoMod row with base values", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("NoMod")
            expect(text).toContain("5.5") // SR
            expect(text).toContain("180") // BPM
            expect(text).toContain("04:00") // length
        })

        it("labels the first row with its mods instead of NoMod when set (stable nomod plays: +CL)", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), nomodMods: [makeMod("CL")] })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("+CL")
            expect(text).not.toContain("NoMod")
        })

        it("shows modded row when difficulty mods present", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                mods: [makeMod("HD"), makeMod("DT")],
                moddedDifficulty: makeModdedDifficulty(),
                ppAccuracies: [95, 98, 99, 100],
                nomodPp: [200, 300, 350, 400],
                moddedPp: [300, 400, 450, 488]
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("+HDDT")
            expect(text).toContain("270") // BPM from API
        })

        it("shows modded SR from API when provided", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                mods: [makeMod("HD"), makeMod("DT")],
                moddedDifficulty: makeModdedDifficulty({ difficulty: { starRating: 7.23, approachRate: 9.6, overallDifficulty: 8.8, circleSize: 5.2, drainRate: 5.7, maxCombo: 2153, bpm: 270, length: 161, drainLength: 161, attributes: {} } })
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("7.23")
        })

        it("shows only NoMod row when no modded difficulty data", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                mods: [makeMod("HD"), makeMod("DT")],
                moddedDifficulty: null
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            // NoMod row should always be present
            expect(text).toContain("NoMod")
            // modded row should not appear without API data
            expect(text).not.toContain("+HDDT")
        })

        it("shows only NoMod row for non-difficulty mods", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                mods: [makeMod("HD"), makeMod("FL")]
            })
            const doc = getDoc(buildComment(data)!)
            const tables = findNodes(doc, "table")
            expect(tables.length).toBeGreaterThanOrEqual(1)
        })

        it("handles HR modded values from API", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap({ cs: 4, ar: 9, accuracy: 7, drain: 6 }),
                mods: [makeMod("HR")],
                moddedDifficulty: makeModdedDifficulty({ difficulty: { starRating: 6.5, approachRate: 10, overallDifficulty: 9.8, circleSize: 5.2, drainRate: 8.4, maxCombo: 500, bpm: 180, length: 240, drainLength: 240, attributes: {} } })
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("+HR")
        })

        it("handles EZ modded values from API", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap({ cs: 4, ar: 8 }),
                mods: [makeMod("EZ")],
                moddedDifficulty: makeModdedDifficulty({ difficulty: { starRating: 2.5, approachRate: 4, overallDifficulty: 3.5, circleSize: 2, drainRate: 3, maxCombo: 500, bpm: 180, length: 240, drainLength: 240, attributes: {} } })
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("+EZ")
        })

        it("shows PP column with accuracies and values", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                ppAccuracies: [95, 98, 99, 100],
                nomodPp: [200, 300, 350, 400]
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("pp (95% \u01C0 98% \u01C0 99% \u01C0 100%)")
            expect(text).toContain("200 \u01C0 300 \u01C0 350 \u01C0 400")
        })

        it("shows PP column with modded values when mods present", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                mods: [makeMod("HD"), makeMod("DT")],
                moddedDifficulty: makeModdedDifficulty(),
                ppAccuracies: [95, 98, 99, 100],
                nomodPp: [200, 300, 350, 400],
                moddedPp: [300, 400, 450, 488]
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("pp (95% \u01C0 98% \u01C0 99% \u01C0 100%)")
            expect(text).toContain("200 \u01C0 300 \u01C0 350 \u01C0 400")
            expect(text).toContain("300 \u01C0 400 \u01C0 450 \u01C0 488")
        })

        it("includes scorepost accuracy in PP column when non-standard", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                acc: 98.56,
                ppAccuracies: [95, 98, 98.56, 99, 100],
                nomodPp: [200, 300, 320, 350, 400]
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("98.56%")
        })

        it("omits PP column when all PP values are null", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                ppAccuracies: [95, 98, 99, 100],
                nomodPp: [null, null, null, null]
            })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).not.toContain("pp (")
        })
    })

    describe("player table", () => {
        it("contains player info when statistics present", () => {
            const data = makeCommentData({ player: makeUser() })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("TestPlayer")
            expect(text).toContain("Country")
            expect(text).toContain("#1,000")
            expect(text).toContain("#50 US")
            expect(text).toContain("12,000") // pp
            expect(text).toContain("99.50%")
            expect(text).toContain("100,000") // playcount
        })

        it("contains player link", () => {
            const data = makeCommentData({ player: makeUser() })
            const doc = getDoc(buildComment(data)!)
            const links = findNodes(doc, "link")
            const playerLink = links.find((l: any) => l.t === "TestPlayer")
            expect(playerLink).toBeDefined()
            expect(playerLink.u).toContain("/u/50")
        })

        it("shows top play from the score's embedded beatmap and beatmapset", () => {
            // score responses carry the beatmap (id/version/beatmapset_id/mode) and the beatmapset (artist/title) as two separate embedded objects
            const topScore = makeScore({
                beatmap: { id: 456, version: "Expert", beatmapset_id: 789, mode: "osu" },
                beatmapset: { artist: "TopArtist", creator: "M", title: "TopSong", ranked_date: null }
            })
            const data = makeCommentData({ player: makeUser(), playerTopScore: topScore })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("Top Play")
            expect(text).toContain("TopArtist - TopSong [Expert]")
            const links = findNodes(doc, "link")
            const topPlayLink = links.find((l: any) => l.t?.includes("TopSong"))
            expect(topPlayLink?.u).toBe("https://osu.ppy.sh/beatmapsets/789#osu/456")
        })

        it("shows a 0 pp top play as 0pp", () => {
            const topScore = makeScore({
                pp: 0,
                beatmap: { id: 456, version: "Expert", beatmapset_id: 789, mode: "osu" },
                beatmapset: { artist: "TopArtist", creator: "M", title: "TopSong", ranked_date: null }
            })
            const data = makeCommentData({ player: makeUser(), playerTopScore: topScore })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("0pp")
        })

        it("handles missing country_rank", () => {
            const player = makeUser({ statistics: { global_rank: 500, accuracy: 0.99, play_count: 50000, pp: 10000 } })
            const data = makeCommentData({ player })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("#500")
            expect(text).toContain("Unranked")
        })
    })

    describe("footer", () => {
        it("contains Source link", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const links = findNodes(doc, "link")
            const sourceLink = links.find((l: any) => l.t === "Source")
            expect(sourceLink).toBeDefined()
            expect(sourceLink.u).toContain("github.com")
        })

        it("contains Developer link", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const links = findNodes(doc, "link")
            const devLink = links.find((l: any) => l.t === "Developer")
            expect(devLink).toBeDefined()
            expect(devLink.u).toContain("reddit.com/u/MasterIO02")
        })

        it("contains a meme", () => {
            vi.spyOn(Math, "random").mockReturnValue(0)
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const text = extractText(doc)
            expect(text).toContain("pls enjoy gaem")
        })

        it("contains a horizontal rule before footer", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const doc = getDoc(buildComment(data)!)
            const hrs = findNodes(doc, "hr")
            expect(hrs.length).toBe(1)
        })
    })

    describe("gamemode display", () => {
        it("shows osu!standard for osu mode", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), mode: "osu" as Gamemode })
            const doc = getDoc(buildComment(data)!)
            expect(extractText(doc)).toContain("osu!standard")
        })

        it("shows osu!mania for mania mode", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), mode: "mania" as Gamemode })
            const doc = getDoc(buildComment(data)!)
            expect(extractText(doc)).toContain("osu!mania")
        })

        it("shows osu!taiko for taiko mode", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), mode: "taiko" as Gamemode })
            const doc = getDoc(buildComment(data)!)
            expect(extractText(doc)).toContain("osu!taiko")
        })

        it("shows osu!catch for fruits mode", () => {
            const data = makeCommentData({ beatmap: makeBeatmap(), mode: "fruits" as Gamemode })
            const doc = getDoc(buildComment(data)!)
            expect(extractText(doc)).toContain("osu!catch")
        })
    })

    describe("full comment", () => {
        it("builds complete comment with all data present", () => {
            const data = makeCommentData({
                beatmap: makeBeatmap(),
                player: makeUser(),
                mode: "osu" as Gamemode,
                mods: [makeMod("HD"), makeMod("DT")],
                acc: 98.56,
                topScore: makeScore(),
                playerTopScore: makeScore({
                    beatmap: { id: 999, version: "Top Diff", beatmapset_id: 789, mode: "osu" },
                    beatmapset: { artist: "TopArtist", creator: "M", title: "TopSong", ranked_date: null }
                }),
                guestMapper: { id: 200, username: "GDMapper" },
                maxCombo: 1634,
                moddedDifficulty: makeModdedDifficulty(),
                ppAccuracies: [95, 98, 98.56, 99, 100],
                nomodPp: [200, 300, 320, 350, 400],
                moddedPp: [300, 400, 420, 450, 488]
            })
            const comment = buildComment(data)
            expect(comment).not.toBeNull()
            const doc = getDoc(comment!)
            const text = extractText(doc)
            // header
            expect(text).toContain("Artist - Song Title [Insane]")
            expect(text).toContain("Mapper")
            expect(text).toContain("GDMapper")
            expect(text).toContain("osu!standard")
            // subheader
            expect(text).toContain("#1:")
            expect(text).toContain("1,634x max combo")
            expect(text).toContain("Ranked (2023)")
            expect(text).toContain("50,000 plays")
            // difficulty table
            expect(text).toContain("NoMod")
            expect(text).toContain("+HDDT")
            // player table
            expect(text).toContain("TestPlayer")
            expect(text).toContain("12,000")
            // footer
            expect(text).toContain("Source")
            expect(text).toContain("Developer")
        })

        it("builds comment with only beatmap (no player)", () => {
            const data = makeCommentData({ beatmap: makeBeatmap() })
            const comment = buildComment(data)
            expect(comment).not.toBeNull()
            const doc = getDoc(comment!)
            const text = extractText(doc)
            expect(text).toContain("Artist - Song Title [Insane]")
            expect(text).toContain("Source")
        })

        it("builds comment with only player (no beatmap)", () => {
            const data = makeCommentData({ player: makeUser() })
            const comment = buildComment(data)
            expect(comment).not.toBeNull()
            const doc = getDoc(comment!)
            const text = extractText(doc)
            expect(text).toContain("TestPlayer")
            expect(text).toContain("Source")
        })
    })
})
