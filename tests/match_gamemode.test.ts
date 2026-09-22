import { describe, it, expect } from "vitest"
import { matchGamemode } from "../src/core/scorepost/helpers/match_gamemode"

describe("matchGamemode", () => {
    describe("defaults to osu", () => {
        it("returns osu for standard scorepost", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] 99%")).toBe("osu")
        })

        it("returns osu for empty title", () => {
            expect(matchGamemode("")).toBe("osu")
        })

        it("returns osu for title with no brackets or parens", () => {
            expect(matchGamemode("some random text")).toBe("osu")
        })
    })

    describe("parenthesis detection", () => {
        it("detects mania in parentheses", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (mania) 99%")).toBe("mania")
        })

        it("detects taiko in parentheses", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (taiko) 99%")).toBe("taiko")
        })

        it("detects catch in parentheses", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (catch) 99%")).toBe("fruits")
        })

        it("detects ctb in parentheses", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (ctb) 99%")).toBe("fruits")
        })
    })

    describe("osu! standard aliases", () => {
        it("detects std", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (std) 99%")).toBe("osu")
        })

        it("detects standard", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (standard) 99%")).toBe("osu")
        })

        it("detects osu! by itself", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!) 99%")).toBe("osu")
        })

        it("detects osu!std", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!std) 99%")).toBe("osu")
        })

        it("detects o!std", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (o!std) 99%")).toBe("osu")
        })

        it("detects osu!standard", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!standard) 99%")).toBe("osu")
        })
    })

    describe("mania aliases", () => {
        it("detects osu!mania", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!mania) 99%")).toBe("mania")
        })

        it("detects osu!m", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!m) 99%")).toBe("mania")
        })

        it("detects o!mania", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (o!mania) 99%")).toBe("mania")
        })

        it("detects o!m", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (o!m) 99%")).toBe("mania")
        })
    })

    describe("taiko aliases", () => {
        it("detects osu!taiko", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!taiko) 99%")).toBe("taiko")
        })

        it("detects osu!t", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!t) 99%")).toBe("taiko")
        })

        it("detects o!taiko", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (o!taiko) 99%")).toBe("taiko")
        })

        it("detects o!t", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (o!t) 99%")).toBe("taiko")
        })
    })

    describe("fruits/catch aliases", () => {
        it("detects osu!catch", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!catch) 99%")).toBe("fruits")
        })

        it("detects osu!ctb", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (osu!ctb) 99%")).toBe("fruits")
        })

        it("detects o!catch", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (o!catch) 99%")).toBe("fruits")
        })

        it("detects o!ctb", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (o!ctb) 99%")).toBe("fruits")
        })
    })

    describe("case insensitivity", () => {
        it("detects MANIA uppercase", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (MANIA) 99%")).toBe("mania")
        })

        it("detects mixed case Taiko", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (Taiko) 99%")).toBe("taiko")
        })

        it("detects CATCH uppercase", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (CATCH) 99%")).toBe("fruits")
        })
    })

    describe("mode in difficulty bracket", () => {
        it("detects mania in difficulty name", () => {
            expect(matchGamemode("Player | Artist - Title [mania] 99%")).toBe("mania")
        })

        it("detects taiko in difficulty name", () => {
            expect(matchGamemode("Player | Artist - Title [taiko] 99%")).toBe("taiko")
        })

        it("detects catch in difficulty name", () => {
            expect(matchGamemode("Player | Artist - Title [catch] 99%")).toBe("fruits")
        })

        it("detects ctb in difficulty name", () => {
            expect(matchGamemode("Player | Artist - Title [ctb] 99%")).toBe("fruits")
        })

        it("detects std in difficulty name", () => {
            expect(matchGamemode("Player | Artist - Title [std] 99%")).toBe("osu")
        })

        it("detects standard in difficulty name", () => {
            expect(matchGamemode("Player | Artist - Title [standard] 99%")).toBe("osu")
        })
    })

    describe("leading mode tag", () => {
        it("detects mania from a leading mode tag", () => {
            expect(matchGamemode("osu!mania | AiDanGaMin04 | phonon - polyriddim [[4k] nsv vip] (*3.3) 89.26% 299x | 39pp")).toBe("mania")
        })

        it("detects osu from a bare leading osu! tag", () => {
            expect(matchGamemode("osu! | NVnog | Camellia - Flamewall [Akitoshi's NORMAL] | 83.80% accuracy 38 misses 4 pp")).toBe("osu")
        })

        it("detects taiko from a leading mode tag", () => {
            expect(matchGamemode("osu!taiko | Player | Artist - Title [Diff] 99%")).toBe("taiko")
        })

        it("detects mania from the osu!m short form", () => {
            expect(matchGamemode("osu!m | Player | Artist - Title [Diff] 99%")).toBe("mania")
        })

        it("detects modes from o! shorthand tags", () => {
            expect(matchGamemode("o!m | Player | Artist - Title [Diff] 99%")).toBe("mania")
            expect(matchGamemode("o!t | Player | Artist - Title [Diff] 99%")).toBe("taiko")
            expect(matchGamemode("o!ctb | Player | Artist - Title [Diff] 99%")).toBe("fruits")
        })

        it("defaults to osu for a bare o! tag", () => {
            expect(matchGamemode("o! | Player | Artist - Title [Diff] 99%")).toBe("osu")
        })

        it("is case-insensitive", () => {
            expect(matchGamemode("Osu!Mania | Player | Artist - Title [Diff] 99%")).toBe("mania")
        })

        it("ignores an 'osu!' token that is not a standalone pipe segment", () => {
            // usernames can't contain "!", so this is prose rather than a player name, but either way it is not a mode tag since no pipe follows the token
            expect(matchGamemode("osu!player | Artist - Title [Diff] 99%")).toBe("osu")
        })
    })

    // a mode word inside random text must not set the gamemode, only the alias itself counts
    describe("mode words in random text", () => {
        it("ignores a mode word inside a longer difficulty name", () => {
            expect(matchGamemode("Player | Artist - Title [Catch the Rainbow] 99%")).toBe("osu")
        })

        it("ignores a mode word in prose parentheses", () => {
            expect(matchGamemode("Player | Artist - Title [Diff] (converted from mania) 99%")).toBe("osu")
        })
    })
})
