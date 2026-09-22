import { describe, it, expect } from "vitest"
import { isScorepostRegex, playerRegex, beatmapRegex, accRegex, tailRegex, scoreV2Regex, parenthesisRegex, bracketsRegex } from "../src/core/scorepost/consts"

describe("isScorepostRegex", () => {
    it("matches standard scorepost titles", () => {
        expect(isScorepostRegex.test("mrekk | xi - Blue Zenith [FOUR DIMENSIONS] +HDDT 98.56%")).toBe(true)
    })

    it("matches titles with 丨 (fullwidth pipe)", () => {
        expect(isScorepostRegex.test("Player丨Artist - Title [Diff] 99%")).toBe(true)
    })

    it("matches titles with various accuracy formats", () => {
        expect(isScorepostRegex.test("Player | Artist - Title [Diff] 99.5%")).toBe(true)
        expect(isScorepostRegex.test("Player | Artist - Title [Diff] 100%")).toBe(true)
    })

    it("matches FC titles", () => {
        expect(isScorepostRegex.test("Player | Artist - Title [Diff] FC 99%")).toBe(true)
    })

    it("matches titles with mods", () => {
        expect(isScorepostRegex.test("Player | Artist - Title [Diff] +HDDT 98%")).toBe(true)
    })

    it("rejects non-scorepost titles", () => {
        expect(isScorepostRegex.test("just some random text")).toBe(false)
        expect(isScorepostRegex.test("this has no pipe or brackets")).toBe(false)
    })

    it("rejects titles missing required parts", () => {
        // no brackets
        expect(isScorepostRegex.test("Player | Artist - Title 99%")).toBe(false)
        // no dash after artist
        expect(isScorepostRegex.test("Player | Title [Diff] 99%")).toBe(false)
    })
})

describe("playerRegex", () => {
    it("extracts player name from standard title", () => {
        const match = playerRegex.exec("mrekk | xi - Blue Zenith [FOUR DIMENSIONS] +HDDT 98.56%")
        // regex captures trailing space, code uses .trim()
        expect(match?.[1]?.trim()).toBe("mrekk")
    })

    it("extracts player with spaces in name", () => {
        const match = playerRegex.exec("WhiteCat | Artist - Title [Diff] 99%")
        expect(match?.[1]?.trim()).toBe("WhiteCat")
    })

    it("handles fullwidth pipe", () => {
        const match = playerRegex.exec("Player Name丨Artist - Title [Diff] 99%")
        expect(match?.[1]?.trim()).toBe("Player Name")
    })

    it("trims whitespace from player name", () => {
        const match = playerRegex.exec("  Player  | Artist - Title [Diff] 99%")
        expect(match?.[1]?.trim()).toBe("Player")
    })

    it("captures full player name with special chars", () => {
        const match = playerRegex.exec("_index | Artist - Title [Diff] 99%")
        expect(match?.[1]?.trim()).toBe("_index")
    })

    // leading bracketed tags must be stripped, otherwise the username lookup fails and the bot silently never comments on those posts
    it("strips a leading bracketed tag from the player name", () => {
        const cases: [string, string][] = [
            ["[osu!taiko] Shige | Artist - Title [Diff] 99.5%", "Shige"],
            ["[History] Cyclone | IOSYS - Marisa wa Taihen na Mono wo Nusunde Ikimashita [Hard] (93,82%) | Old Replay from 08'", "Cyclone"],
            ["[5.82 ⭐] Kyuki | UNDEAD CORPORATION - Everything will freeze [Lunatic] 58.53%", "Kyuki"],
            ["[History, earliest Cookiezi replay] Cookiezi | Hirano Aya - Lost My Music [Ace Of Trades' Insane] +HD (DJPop, 5.32*) 97.09% FC", "Cookiezi"]
        ]
        for (const [title, expected] of cases) {
            expect(playerRegex.exec(title)?.[1]?.trim()).toBe(expected)
        }
    })

    it("keeps a player name that is entirely a bracketed username", () => {
        const match = playerRegex.exec("[Karcher] | BABYMETAL - Road of Resistance [Return of the Ancients] +HR (Maaadbot, 9*) 99.58% FC #2")
        expect(match?.[1]?.trim()).toBe("[Karcher]")
    })

    it("keeps player names containing brackets later in the name", () => {
        const match = playerRegex.exec("A [B] C | Artist - Title [Diff] 99%")
        expect(match?.[1]?.trim()).toBe("A [B] C")
    })

    // unbracketed mode tags as their own pipe segment hide the player ("osu!mania | player | map")
    it("strips a leading unbracketed mode tag that is its own pipe segment", () => {
        const cases: [string, string][] = [
            ["osu!mania | AiDanGaMin04 | phonon - polyriddim [[4k] nsv vip] (*3.3) 89.26% 299x | 39pp", "AiDanGaMin04"],
            ["osu! | NVnog | Camellia - Flamewall [Akitoshi's NORMAL] | 83.80% accuracy 38 misses 4 pp", "NVnog"],
            ["osu!taiko | Player | Artist - Title [Diff] 99%", "Player"],
            ["Osu!mania | Player | Artist - Title [Diff] 99%", "Player"],
            ["o!m | Player | Artist - Title [Diff] 99%", "Player"],
            ["o!t | Player | Artist - Title [Diff] 99%", "Player"],
            ["o! | Player | Artist - Title [Diff] 99%", "Player"]
        ]
        for (const [title, expected] of cases) {
            expect(playerRegex.exec(title)?.[1]?.trim()).toBe(expected)
        }
    })
})

describe("beatmapRegex", () => {
    it("extracts beatmap string from standard title", () => {
        const match = beatmapRegex.exec("mrekk | xi - Blue Zenith [FOUR DIMENSIONS] +HDDT 98.56%")
        // regex captures leading space, code uses .trim()
        expect(match?.[1]?.trim()).toBe("xi - Blue Zenith [FOUR DIMENSIONS]")
    })

    it("handles fullwidth pipe", () => {
        const match = beatmapRegex.exec("Player丨Artist - Title [Diff] 99%")
        expect(match?.[1]?.trim()).toBe("Artist - Title [Diff]")
    })

    it("extracts beatmap with complex difficulty name", () => {
        const match = beatmapRegex.exec("Player | Camellia - Exit This Earth's Atomosphere [Cosmic] 99% FC")
        expect(match?.[1]?.trim()).toBe("Camellia - Exit This Earth's Atomosphere [Cosmic]")
    })

    it("handles long artist and title names", () => {
        const match = beatmapRegex.exec("Player | Hatsune Miku - World is Mine (Sped Up Ver.) [Insane] 95%")
        expect(match?.[1]?.trim()).toBe("Hatsune Miku - World is Mine (Sped Up Ver.) [Insane]")
    })

    // greedy matching used to swallow later brackets (mapper credits, commentary) into the beatmap string
    it("stops at the difficulty bracket, ignoring later brackets", () => {
        const cases: [string, string][] = [
            [
                "Kwal1976 | Synestia, Disembodied Tyrant - The Poetic Edda (feat. Ben Duerr) [Sanguine Annihilation] +DT (Karliah, 21.1*) 45.92% 114/2920x 282xMiss | highest star rating ranked pass [raketapped]",
                "Synestia, Disembodied Tyrant - The Poetic Edda (feat. Ben Duerr) [Sanguine Annihilation]"
            ],
            ["cryshina | goreshit - Satori De Pon! [Gezocore 2.5] ([CSGA]Ar3sgice, 11.22*) +DT 92.69% 343/1404 14xMiss", "goreshit - Satori De Pon! [Gezocore 2.5]"],
            ["Umbre | ReoNa - JAMMER [Isolation] ([Karcher], 8.68*) +HD 99.39% FC 883pp #1", "ReoNa - JAMMER [Isolation]"]
        ]
        for (const [title, expected] of cases) {
            expect(beatmapRegex.exec(title)?.[1]?.trim()).toBe(expected)
        }
    })

    it("keeps a bracket nested in the difficulty name (mania key modes)", () => {
        const match = beatmapRegex.exec("osu!mania | AiDanGaMin04 | phonon - polyriddim [[4k] nsv vip] (*3.3) 89.26% 299x | 39pp")
        expect(match?.[1]?.trim()).toBe("phonon - polyriddim [[4k] nsv vip]")
    })

    it("keeps a bracket that is part of the map title", () => {
        // the set title is literally "FREEDOM DiVE [METAL DIMENSIONS]" (diff "Extra"), still matchable via the beatmap search's partial matching
        const match = beatmapRegex.exec("Ivaxa | xi remixed by cosMo@bousouP - FREEDOM DiVE [METAL DIMENSIONS] [Extra] +DT (Cherry Blossom, 11.19*) 98.75%")
        expect(match?.[1]?.trim()).toBe("xi remixed by cosMo@bousouP - FREEDOM DiVE [METAL DIMENSIONS]")
    })
})

describe("accRegex", () => {
    it("extracts standard accuracy", () => {
        const match = accRegex.exec("Player | Artist - Title [Diff] 99.56%")
        expect(match?.[1]).toBe("99.56")
    })

    it("extracts 100% accuracy", () => {
        const match = accRegex.exec("Player | Artist - Title [Diff] 100%")
        expect(match?.[1]).toBe("100")
    })

    it("extracts integer accuracy", () => {
        const match = accRegex.exec("Player | Artist - Title [Diff] 95%")
        expect(match?.[1]).toBe("95")
    })

    it("extracts accuracy with comma notation", () => {
        const match = accRegex.exec("Player | Artist - Title [Diff] 99,56%")
        expect(match?.[1]).toBe("99,56")
    })

    it("extracts accuracy with leading zeros", () => {
        const match = accRegex.exec("Player | Artist - Title [Diff] 0.01%")
        expect(match?.[1]).toBe("0.01")
    })

    it("handles accuracy in different position", () => {
        const match = accRegex.exec("98.5% FC")
        expect(match?.[1]).toBe("98.5")
    })

    it("does not match non-accuracy numbers", () => {
        const match = accRegex.exec("Player | Artist - Title [Diff] +HDDT 1423x")
        expect(match).toBeNull()
    })
})

describe("tailRegex", () => {
    it("extracts everything after the difficulty bracket", () => {
        const match = tailRegex.exec("Player | Artist - Title [Diff] +HDDT 98.56% FC")
        expect(match?.[1]).toBe(" +HDDT 98.56% FC")
    })

    it("extracts mods and accuracy", () => {
        const match = tailRegex.exec("Player | Artist - Title [Diff] +HD 99%")
        expect(match?.[1]).toBe(" +HD 99%")
    })

    it("returns no match when no tail after bracket", () => {
        // tailRegex requires at least one char after [Diff] due to (.+)
        const match = tailRegex.exec("Player | Artist - Title [Diff]")
        expect(match).toBeNull()
    })

    it("extracts FC notation", () => {
        const match = tailRegex.exec("Player | Artist - Title [Diff] FC 100%")
        expect(match?.[1]).toBe(" FC 100%")
    })

    it("captures the tail right after the difficulty bracket when later brackets exist", () => {
        const match = tailRegex.exec("Kwal1976 | Synestia, Disembodied Tyrant - The Poetic Edda (feat. Ben Duerr) [Sanguine Annihilation] +DT (Karliah, 21.1*) 45.92% 114/2920x 282xMiss | highest star rating ranked pass [raketapped]")
        expect(match?.[1]).toBe(" +DT (Karliah, 21.1*) 45.92% 114/2920x 282xMiss | highest star rating ranked pass [raketapped]")
    })

    it("captures the tail after a nested difficulty bracket", () => {
        const match = tailRegex.exec("osu!mania | AiDanGaMin04 | phonon - polyriddim [[4k] nsv vip] (*3.3) 89.26% 299x | 39pp")
        expect(match?.[1]).toBe(" (*3.3) 89.26% 299x | 39pp")
    })
})

describe("scoreV2Regex", () => {
    it("matches SV2", () => {
        expect("SV2".replace(scoreV2Regex, "V2")).toBe("V2")
    })

    it("matches SCOREV2", () => {
        expect("SCOREV2".replace(scoreV2Regex, "V2")).toBe("V2")
    })

    it("matches case-insensitive", () => {
        expect("scorev2".replace(scoreV2Regex, "V2")).toBe("V2")
        expect("ScoreV2".replace(scoreV2Regex, "V2")).toBe("V2")
        expect("sv2".replace(scoreV2Regex, "V2")).toBe("V2")
    })

    it("matches globally", () => {
        expect("SV2 + SCOREV2".replace(scoreV2Regex, "V2")).toBe("V2 + V2")
    })
})

describe("parenthesisRegex", () => {
    it("extracts content from parentheses", () => {
        expect(parenthesisRegex.exec("(mania)")?.[1]).toBe("mania")
    })

    it("extracts content with surrounding text", () => {
        expect(parenthesisRegex.exec("text (taiko) more")?.[1]).toBe("taiko")
    })

    it("extracts content with special chars", () => {
        expect(parenthesisRegex.exec("(osu!mania)")?.[1]).toBe("osu!mania")
    })

    it("captures first pair only", () => {
        expect(parenthesisRegex.exec("(first) (second)")?.[1]).toBe("first")
    })
})

describe("bracketsRegex", () => {
    it("extracts content from brackets", () => {
        expect(bracketsRegex.exec("[Diff]")?.[1]).toBe("Diff")
    })

    it("extracts content with surrounding text", () => {
        expect(bracketsRegex.exec("text [mania] more")?.[1]).toBe("mania")
    })

    it("extracts content with spaces", () => {
        expect(bracketsRegex.exec("[FOUR DIMENSIONS]")?.[1]).toBe("FOUR DIMENSIONS")
    })

    it("captures first pair only", () => {
        expect(bracketsRegex.exec("[first] [second]")?.[1]).toBe("first")
    })
})
