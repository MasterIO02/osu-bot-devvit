import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { getMods } from "../src/core/scorepost/helpers/get_mods"
import { isScorepostRegex, playerRegex, beatmapRegex } from "../src/core/scorepost/consts"
import { matchGamemode } from "../src/core/scorepost/helpers/match_gamemode"

// read real scorepost titles from reference file and deduplicate
const samplesPath = "./tests/scorepost-samples.txt"
const allTitles = readFileSync(samplesPath, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
const titles = [...new Set(allTitles)]

// these assertions only cover invariants that hold for every title in the corpus.
// badly formatted titles (combo-only accuracy, mod typos like +DB) are rare and handled best-effort by the parser, their exact expected output is pinned in get_mods.test.ts instead.
describe("real scorepost titles from reference file", () => {
    it(`loaded ${titles.length} unique titles`, () => {
        expect(titles.length).toBeGreaterThan(900)
    })

    // every title is detected as a scorepost
    it("every title matches isScorepostRegex", () => {
        const failures: string[] = []
        for (const title of titles) {
            if (!isScorepostRegex.test(title)) failures.push(title)
        }
        expect(failures).toEqual([])
    })

    // every title has a parseable player name
    it("every title has a player name", () => {
        const failures: string[] = []
        for (const title of titles) {
            if (!playerRegex.exec(title)?.[1]?.trim()) failures.push(title)
        }
        expect(failures).toEqual([])
    })

    // leading [tags] (mode tags like "[osu!taiko]", "[History]") must be stripped from the player name, unless the whole player is a bracketed username like "[Karcher]"
    it("player names never contain a leading tag before the actual name", () => {
        const failures: string[] = []
        for (const title of titles) {
            const player = playerRegex.exec(title)?.[1]?.trim() ?? ""
            if (/^\[[^\]]*\]\s*\S/.test(player)) failures.push(title)
        }
        expect(failures).toEqual([])
    })

    // every title has a parseable beatmap string
    it("every title has a beatmap string", () => {
        const failures: string[] = []
        for (const title of titles) {
            if (!beatmapRegex.exec(title)?.[1]?.trim()) failures.push(title)
        }
        expect(failures).toEqual([])
    })

    // getMods never throws on any title
    it("getMods never throws", () => {
        for (const title of titles) {
            expect(() => getMods(title)).not.toThrow()
        }
    })

    // matchGamemode never throws on any title
    it("matchGamemode never throws", () => {
        for (const title of titles) {
            expect(() => matchGamemode(title)).not.toThrow()
        }
    })

    // gamemode: titles with [osu!X] prefix detect the correct mode
    it("gamemode prefixes are detected", () => {
        const modeMap: Record<string, string> = {
            "[osu!catch]": "fruits",
            "[osu!taiko]": "taiko",
            "[osu!mania]": "mania",
            "[osu!]": "osu"
        }
        const failures: string[] = []
        for (const title of titles) {
            for (const [prefix, expected] of Object.entries(modeMap)) {
                if (title.startsWith(prefix)) {
                    const detected = matchGamemode(title)
                    if (detected !== expected) failures.push(`${title} (expected ${expected}, got ${detected})`)
                }
            }
        }
        expect(failures).toEqual([])
    })
})
