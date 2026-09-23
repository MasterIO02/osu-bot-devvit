import { describe, it, expect } from "vitest"
import { getMods, sameMods } from "../src/core/scorepost/helpers/get_mods"
import type { Mod } from "../src/core/requests/osu_api"

describe("getMods", () => {
    describe("standard format (+MODS)", () => {
        it("parses +HD", () => {
            expect(getMods("Player | Artist - Title [Diff] +HD 99.5%")).toEqual([{ acronym: "HD" }])
        })

        it("parses +DT", () => {
            expect(getMods("Player | Artist - Title [Diff] +DT 99.5%")).toEqual([{ acronym: "DT" }])
        })

        it("parses +HDDT", () => {
            expect(getMods("Player | Artist - Title [Diff] +HDDT 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "DT" }])
        })

        it("parses +HDHR", () => {
            expect(getMods("Player | Artist - Title [Diff] +HDHR 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "HR" }])
        })

        it("parses +HDDTHRFL", () => {
            expect(getMods("Player | Artist - Title [Diff] +HDDTHRFL 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "DT" }, { acronym: "HR" }, { acronym: "FL" }])
        })

        it("parses +NF", () => {
            expect(getMods("Player | Artist - Title [Diff] +NF 95%")).toEqual([{ acronym: "NF" }])
        })

        it("parses +EZ", () => {
            expect(getMods("Player | Artist - Title [Diff] +EZHD 95%")).toEqual([{ acronym: "EZ" }, { acronym: "HD" }])
        })

        it("parses +NC (lazer)", () => {
            expect(getMods("Player | Artist - Title [Diff] +NC 99%")).toEqual([{ acronym: "NC" }])
        })

        it("parses +HT", () => {
            expect(getMods("Player | Artist - Title [Diff] +HT 95%")).toEqual([{ acronym: "HT" }])
        })

        it("parses +SD", () => {
            expect(getMods("Player | Artist - Title [Diff] +SD 100%")).toEqual([{ acronym: "SD" }])
        })

        it("parses +PF", () => {
            expect(getMods("Player | Artist - Title [Diff] +PF 100%")).toEqual([{ acronym: "PF" }])
        })

        it("parses +SO", () => {
            expect(getMods("Player | Artist - Title [Diff] +SO 99%")).toEqual([{ acronym: "SO" }])
        })

        it("parses +FL", () => {
            expect(getMods("Player | Artist - Title [Diff] +FL 99%")).toEqual([{ acronym: "FL" }])
        })

        it("parses +RX", () => {
            expect(getMods("Player | Artist - Title [Diff] +RX 99%")).toEqual([{ acronym: "RX" }])
        })

        it("parses +AP", () => {
            expect(getMods("Player | Artist - Title [Diff] +AP 99%")).toEqual([{ acronym: "AP" }])
        })
    })

    describe("spaced mod forms", () => {
        it("parses + HD DT with spaces after the plus", () => {
            expect(getMods("Player | Artist - Title [Diff] + HD DT 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "DT" }])
        })

        it("parses spaced mods without a plus", () => {
            expect(getMods("Player | Artist - Title [Diff] HD HR 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "HR" }])
        })

        it("parses comma-space mods without a plus", () => {
            expect(getMods("Player | Artist - Title [Diff] HD, HR 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "HR" }])
        })

        it("parses +HD, HR comma-space after the plus", () => {
            expect(getMods("Player | Artist - Title [Diff] +HD, HR 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "HR" }])
        })

        it("merges spaced mods with settings attached", () => {
            expect(getMods("Player | Artist - Title [Diff] + HD DT(x1.1) 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "DT", settings: { speed_change: "1.1" } }])
        })

        it("keeps settings with spaces after commas in one group", () => {
            expect(getMods("Player | Artist - Title [Diff] +DA(AR8, OD9) 99.01%")).toEqual([{ acronym: "DA", settings: { approach_rate: "8", overall_difficulty: "9" } }])
        })

        it("stops merging at a group that isn't a mod run", () => {
            expect(getMods("Player | Artist - Title [Diff] + HD SS #1 99.5%")).toEqual([{ acronym: "HD" }])
        })
    })

    describe("no mods", () => {
        it("returns empty for no-mod score", () => {
            expect(getMods("Player | Artist - Title [Diff] 99.5%")).toEqual([])
        })

        it("returns empty for FC notation without mods", () => {
            expect(getMods("Player | Artist - Title [Diff] FC 99.5%")).toEqual([])
        })

        it("returns empty for +NM (explicit nomod)", () => {
            expect(getMods("huyanh68 | Ariabl'eyeS - Souzou no Idea [Eternity] +NM (Maaadbot, 8.24*) 98.92% S-rank 1588/2405x #2")).toEqual([])
        })

        it("returns empty for unknown mod acronyms (typos like +DB)", () => {
            expect(getMods("Player | Artist - Title [Diff] +DB FC #1")).toEqual([])
        })
    })

    describe("lazer mods", () => {
        it("parses +DA", () => {
            expect(getMods("Player | Artist - Title [Diff] +DA 99%")).toEqual([{ acronym: "DA" }])
        })

        it("parses +CL", () => {
            expect(getMods("Player | Artist - Title [Diff] +CL 99%")).toEqual([{ acronym: "CL" }])
        })

        it("parses +TD", () => {
            expect(getMods("Player | Artist - Title [Diff] +TD 99%")).toEqual([{ acronym: "TD" }])
        })

        it("parses +V2", () => {
            expect(getMods("Player | Artist - Title [Diff] +V2 99%")).toEqual([{ acronym: "V2" }])
        })

        it("parses SV2 as V2", () => {
            expect(getMods("Player | Artist - Title [Diff] +SV2 99%")).toEqual([{ acronym: "V2" }])
        })

        it("parses 10K", () => {
            expect(getMods("[osu!mania] Player | Artist - Title [Diff] +10K 99%")).toEqual([{ acronym: "10K" }])
        })
    })

    describe("mod settings", () => {
        it("parses DA with approach rate", () => {
            expect(getMods("EZChamp | Black Hole - Pluto [EX EX] (Duck Wings, 8.96*) +DA(AR9) 98.42% 609/618 FC")).toEqual([{ acronym: "DA", settings: { approach_rate: "9" } }])
        })

        it("parses DT with custom rate in x-prefix notation", () => {
            expect(getMods("Player | Artist - Title [Diff] +DT(x1.1) 98.5%")).toEqual([{ acronym: "DT", settings: { speed_change: "1.1" } }])
        })

        it("parses DT with custom rate in x-suffix notation and the word 'rate'", () => {
            expect(getMods("Player | Artist - Title [Diff] +DT(1.1x rate) 98.5%")).toEqual([{ acronym: "DT", settings: { speed_change: "1.1" } }])
        })

        it("parses multiple mods with settings attached to the right one", () => {
            expect(getMods("Player | Artist - Title [Diff] +HDDT(2x)HRFL 96.29% FC")).toEqual([{ acronym: "HD" }, { acronym: "DT", settings: { speed_change: "2" } }, { acronym: "HR" }, { acronym: "FL" }])
        })

        it("parses several mod groups each with their own settings", () => {
            expect(getMods("Player | Artist - Title [Diff] +DT(x1.1)DA(AR8, OD9) 99.01%")).toEqual([
                { acronym: "DT", settings: { speed_change: "1.1" } },
                { acronym: "DA", settings: { approach_rate: "8", overall_difficulty: "9" } }
            ])
        })

        it("parses DA with decimal values and comma-separated settings", () => {
            expect(getMods("Player | Artist - Title [Diff] +DA(CS4.5, AR7, OD9) 98.74%")).toEqual([{ acronym: "DA", settings: { circle_size: "4.5", approach_rate: "7", overall_difficulty: "9" } }])
        })

        it("continues parsing mods after a settings group", () => {
            expect(getMods("Player | Artist - Title [Diff] +HDHRDT(x1.4)RX 88.76%")).toEqual([{ acronym: "HD" }, { acronym: "HR" }, { acronym: "DT", settings: { speed_change: "1.4" } }, { acronym: "RX" }])
        })

        it("ignores unrecognized settings tokens", () => {
            expect(getMods("Player | Artist - Title [Diff] +HDDT(CL) 99.01%")).toEqual([{ acronym: "HD" }, { acronym: "DT" }])
        })

        it("ignores rate settings on mods that have none", () => {
            expect(getMods("Player | Artist - Title [Diff] +HD(2x) 99%")).toEqual([{ acronym: "HD" }])
        })
    })

    describe("case insensitivity", () => {
        it("parses lowercase mods", () => {
            expect(getMods("Player | Artist - Title [Diff] +hd 99.5%")).toEqual([{ acronym: "HD" }])
        })

        it("parses mixed case mods", () => {
            expect(getMods("Player | Artist - Title [Diff] +HdDt 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "DT" }])
        })

        it("parses lowercase mod settings", () => {
            expect(getMods("Player | Artist - Title [Diff] +dt(x1.1)da(ar9) 99%")).toEqual([
                { acronym: "DT", settings: { speed_change: "1.1" } },
                { acronym: "DA", settings: { approach_rate: "9" } }
            ])
        })
    })

    describe("fallback parsing", () => {
        it("parses mods without + prefix when space-separated", () => {
            expect(getMods("Player | Artist - Title [Diff] HDDT 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "DT" }])
        })

        it("parses single mod without + prefix", () => {
            expect(getMods("Player | Artist - Title [Diff] HD 99.5%")).toEqual([{ acronym: "HD" }])
        })

        it("parses mods after a + with leading whitespace", () => {
            expect(getMods("MALISZEWSKI | Function Phantom - Neuronecia [Ethereal] (Skystar, 8.88*) + DT (1281/1281) FC | 837pp")).toEqual([{ acronym: "DT" }])
        })
    })

    describe("commentary false positives", () => {
        it("does not parse common words in commentary as mods", () => {
            expect(getMods("Tikkanen | Omoi - Snow Drive [SnowDrive] (Arieeru, 8.02*) 100% FC #3 | 617pp if ranked | FIRST SS IN 10 YEARS!")).toEqual([])
        })

        it("does not parse words like 'Blinds' in commentary as mod runs", () => {
            expect(getMods("Tranquanto | Koji Kondo - Enemy Battle [beef wellington's 16-Bit Hidden Expert] (Ldnz, 7.98*) +HDDTBLMT 98.61% FC #1 on Lazer | 670pp | Low AR + Blinds PP meta!?")).toEqual([])
        })

        it("does not parse 'NON DT' in commentary as the DT mod", () => {
            expect(getMods("mrekk | Demonic Resurrection - The Eye Of Eternity [Greater than Gods] (NaPiii_, 9.63*) 99.63% FC | 1572pp | NON DT PP-RECORD")).toEqual([])
        })

        it("still finds key-mode tokens in the score segment", () => {
            expect(getMods("[osu!mania] wonder5193 | yax03 - down [G O D] 4K (aspen, 3.02*) 94.49% 1305x/3206x, 10xMiss #47 | 54pp")).toEqual([{ acronym: "4K" }])
        })

        it("still finds real mods in the score segment via the + path", () => {
            expect(getMods("decaten | Aoi vs. siqlo - Mirzam [HEAVEN // HELL] + HR ([ VII ], 8.45*) 96.97% 735/1410x S-RANK | FIRST S-RANK ON LEADERBOARD")).toEqual([{ acronym: "HR" }])
        })
    })

    describe("comma handling", () => {
        it("strips commas from mod strings", () => {
            expect(getMods("Player | Artist - Title [Diff] +HD,DT 99.5%")).toEqual([{ acronym: "HD" }, { acronym: "DT" }])
        })
    })

    describe("scorev2", () => {
        it("parses SCOREV2 as V2", () => {
            expect(getMods("Player | Artist - Title [Diff] +SCOREV2 99%")).toEqual([{ acronym: "V2" }])
        })

        it("parses Sv2 mixed case", () => {
            expect(getMods("Player | Artist - Title [Diff] +Sv2 99%")).toEqual([{ acronym: "V2" }])
        })
    })

    describe("edge cases", () => {
        it("returns empty for title with no tail", () => {
            expect(getMods("Player | Artist - Title [Diff]")).toEqual([])
        })

        it("returns empty for completely invalid title", () => {
            expect(getMods("just some random text")).toEqual([])
        })

        it("handles + at end of title", () => {
            expect(getMods("Player | Artist - Title [Diff] +")).toEqual([])
        })

        it("handles odd-length mod strings gracefully", () => {
            // odd length can't be parsed as 2-char chunks, should fall through
            expect(getMods("Player | Artist - Title [Diff] +HDX 99%")).toEqual([])
        })

        it("handles unknown mod acronyms", () => {
            expect(getMods("Player | Artist - Title [Diff] +XX 99%")).toEqual([])
        })

        it("handles a + followed by junk", () => {
            expect(getMods("Player | Artist - Title [Diff] + 99.5% FC")).toEqual([])
        })
    })

    describe("realistic scorepost titles", () => {
        it("parses mrekk HDDT score", () => {
            expect(getMods("mrekk | xi - Blue Zenith [FOUR DIMENSIONS] +HDDT 98.56% 1423x/1634x 1xMiss")).toEqual([{ acronym: "HD" }, { acronym: "DT" }])
        })

        it("parses WhiteCat HDHR score", () => {
            expect(getMods("WhiteCat | Chino (CV: Minase Inori) - Shinsaku no Shiawase wa Kochira! [Happy~!] +HDHR 99.82% FC")).toEqual([{ acronym: "HD" }, { acronym: "HR" }])
        })

        it("parses accolibed NM score", () => {
            expect(getMods("accolibed | Camellia - Exit This Earth's Atomosphere [Cosmic] 99.12% FC")).toEqual([])
        })

        it("parses lifeline EZDTFL score", () => {
            expect(getMods("lifeline | Kuba Oms - My Love [Easy] +EZDTFL 100% FC")).toEqual([{ acronym: "EZ" }, { acronym: "DT" }, { acronym: "FL" }])
        })

        it("parses score with percentage at end", () => {
            expect(getMods("Player | Artist - Song [Hard] +HD 97.3%")).toEqual([{ acronym: "HD" }])
        })

        it("parses NFHT score", () => {
            expect(getMods("Player | Artist - Song [Hard] +NFHT 85%")).toEqual([{ acronym: "NF" }, { acronym: "HT" }])
        })

        it("parses mrekk DT with custom rate score", () => {
            expect(getMods("mrekk | Mentalecho - Bam Bam [Dom vs. Ciyus Miapah : Rastafara Trip Flavor] (d0m, 9.90*) +DT(x1.1) 98.52% 2057/3932 4xMiss")).toEqual([{ acronym: "DT", settings: { speed_change: "1.1" } }])
        })

        it("parses Saiyku DA with circle size score", () => {
            expect(getMods("Saiyku | wuk - Sidetracked Day [Maaadbot's Sidetracked Week] (sytho, 12.19*) +DA(CS7.5) 99.11% 307/633x 2miss")).toEqual([{ acronym: "DA", settings: { circle_size: "7.5" } }])
        })
    })
})

describe("sameMods", () => {
    const mods = (...acronyms: string[]): Mod[] => acronyms.map(acronym => ({ acronym }))

    it("matches identical mod sets", () => {
        expect(sameMods(mods("HD", "DT"), mods("HD", "DT"))).toBe(true)
    })

    it("is order-insensitive", () => {
        expect(sameMods(mods("DT", "HD", "HR"), mods("HD", "HR", "DT"))).toBe(true)
    })

    it("is settings-insensitive", () => {
        expect(sameMods(mods("HD", "DT"), [{ acronym: "HD" }, { acronym: "DT", settings: { speed_change: "1.1" } }])).toBe(true)
    })

    it("matches two empty mod sets", () => {
        expect(sameMods([], [])).toBe(true)
    })

    it("ignores CL on both sides (titles can carry it, API mods never do)", () => {
        expect(sameMods(mods("HD", "DT", "CL"), mods("HD", "DT"))).toBe(true)
        expect(sameMods(mods("CL"), [])).toBe(true)
    })

    it("rejects different mod sets", () => {
        expect(sameMods(mods("HD"), mods("HD", "DT"))).toBe(false)
        expect(sameMods(mods("HD", "DT"), mods("HD", "HR"))).toBe(false)
    })

    it("rejects a score against an empty title", () => {
        expect(sameMods(mods("HD"), [])).toBe(false)
    })
})
