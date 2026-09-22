import { scoreV2Regex, tailRegex } from "../consts"
import type { Mod } from "../../requests/osu_api"

/** known mod acronyms (all gamemodes) from the osu! mods.json file (https://raw.githubusercontent.com/ppy/osu-web/master/database/mods.json) */
// prettier-ignore
const KNOWN_MODS = new Set([
    "NF", "EZ", "TD", "HD", "HR", "SD", "DT", "RX", "HT", "NC", "FL", "AT",
    "SO", "AP", "PF", "V2", "SV2", "DA", "CL", "BL", "ST", "AC", "TP", "MR",
    "AL", "SG", "CN", "TR", "WG", "SI", "GR", "DF", "WU", "WD", "BR", "AD",
    "MU", "NS", "MG", "RP", "AS", "FR", "BU", "SY", "DP", "BM", "DC", "SR", "SW",
    "RD", "TC", "FF", "MF", "NR", "FI", "CO", "DS", "IN", "HO", "CS",
    "1K", "2K", "3K", "4K", "5K", "6K", "7K", "8K", "9K", "10K",
])

/** "+NM" means the score has no mods */
const NOMOD_ACRONYM = "NM"

/** mods whose rate can be customized in the title, like "+DT(x1.1)" */
const RATE_MODS = new Set(["DT", "NC", "HT", "DC"])

/** difficulty adjust (DA) settings: "AR9" in the title maps to "approach_rate" for the API */
const DIFFICULTY_ADJUST_KEYS: Record<string, string> = {
    AR: "approach_rate",
    CS: "circle_size",
    OD: "overall_difficulty",
    HP: "drain_rate"
}

/**
 * @description match the mods in the scorepost title
 * @returns array of mods with their acronym and optional settings (e.g. [{ acronym: "HD" }, { acronym: "DT", settings: { speed_change: "1.5" } }])
 */
export function getMods(title: string): Mod[] {
    const match = tailRegex.exec(title)
    if (!match) return [] // nothing in title tail? play should be nomod
    const tail = match[1]
    if (!tail) return []

    // get everything after the "+" in title
    const plusIdx = tail.indexOf("+")
    if (plusIdx !== -1 && plusIdx < tail.length - 1) {
        // the mod expression is everything right after the "+", like "HDDT(2x)HRFL"
        const mods = parseModGroups(splitGroups(tail.slice(plusIdx + 1).trimStart()))
        if (mods !== null) return mods
    }

    // fallback: scan each whitespace-delimited token in the first pipe-delimited segment of the tail.
    // the score's mods live in the score segment; later segments are commentary whose words
    // can false-positive as mod acronyms (e.g. "FIRST SS IN 10 YEARS!" parsed as the IN mod)
    const groups = splitGroups(tail.split(/[|丨]/)[0]!)
    for (let i = 0; i < groups.length; i++) {
        const mods = parseModGroups(groups.slice(i))
        if (mods !== null) return mods
    }

    return []
}

/**
 * split a string into whitespace-separated groups, ignoring whitespace inside parentheses,
 * so settings with several tokens like "DA(AR8, OD9)" stay in one group
 */
function splitGroups(input: string): string[] {
    const groups: string[] = []
    let current = ""
    let depth = 0
    for (const ch of input) {
        if (ch === "(") depth++
        if (ch === ")") depth = Math.max(0, depth - 1)
        if (depth === 0 && /\s/.test(ch)) {
            if (current) groups.push(current)
            current = ""
        } else {
            current += ch
        }
    }
    if (current) groups.push(current)
    return groups
}

/**
 * parse a sequence of whitespace-separated mod groups, merging them while they are valid mod runs.
 * needed for spaced forms like "+ HD DT" or "HD, HR" where each mod is its own group.
 * @param groups the mod groups (already split, see splitGroups), like ["HD", "DT(x1.1)", "99.5%"]
 * @returns the merged mods, or null if the first group isn't a valid mod run
 */
function parseModGroups(groups: string[]): Mod[] | null {
    const mods: Mod[] = []
    for (const group of groups) {
        const parsed = parseModExpression(group)
        // an invalid or empty run (like "99.5%", "FC" or pure punctuation) ends the sequence
        if (parsed === null || parsed.length === 0) break
        mods.push(...parsed)
    }
    return mods.length > 0 ? mods : null
}

/**
 * @param input the start of a mod expression, like "HDDT(2x)HRFL 99.5% FC"
 * @returns the parsed mods with their optional settings, or null if the expression isn't a valid mod string
 */
function parseModExpression(input: string): Mod[] | null {
    input = input.toUpperCase().replace(scoreV2Regex, "V2")

    const mods: Mod[] = []
    let i = 0

    while (i < input.length) {
        // the mod expression ends at the first whitespace or "|", everything after belongs to the title
        if (input[i] === " " || input[i] === "\t" || input[i] === "|") break
        // commas between mods are allowed, like "+HD,DT"
        if (input[i] === ",") {
            i++
            continue
        }

        // "10K" is the only 3-character mod acronym, try it before the 2-character chunk
        const chunk = input.slice(i, i + 3) === "10K" ? "10K" : input.slice(i, i + 2)
        if (!KNOWN_MODS.has(chunk)) return null
        i += chunk.length

        // "+NM" means the score is nomod, stop parsing
        if (chunk === NOMOD_ACRONYM) break

        // optional settings in parentheses attached to the mod, like "+DT(x1.1)" or "+DA(AR9, OD9)"
        let settings: Record<string, string> | undefined
        if (input[i] === "(") {
            const closeIdx = input.indexOf(")", i)
            if (closeIdx === -1) return null
            settings = parseModSettings(chunk, input.slice(i + 1, closeIdx))
            i = closeIdx + 1
        }

        if (settings && Object.keys(settings).length > 0) mods.push({ acronym: chunk, settings })
        else mods.push({ acronym: chunk })
    }

    return mods
}

/**
 * @description parse the settings inside a mod's parentheses, like "x1.1" for DT or "AR8, OD9" for DA
 * @returns the recognized settings as standard lazer values for the osu-tools API
 */
function parseModSettings(acronym: string, raw: string): Record<string, string> {
    const settings: Record<string, string> = {}

    for (const token of raw.split(/[,\s]+/)) {
        if (!token) continue

        // rate notation: "x1.1", "1.1x", "2x" for DT/NC/HT/DC custom rates
        const rate = /^(?:X(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)X)$/.exec(token)
        if (rate && RATE_MODS.has(acronym)) {
            settings.speed_change = (rate[1] ?? rate[2])!.replace(",", ".")
            continue
        }

        // difficulty adjust notation: "AR9", "CS4.5", "OD9", "HP7"
        const attr = /^(AR|CS|OD|HP)(\d+(?:[.,]\d+)?)$/.exec(token)
        if (attr && acronym === "DA") {
            settings[DIFFICULTY_ADJUST_KEYS[attr[1]!]!] = attr[2]!.replace(",", ".")
            continue
        }

        // anything else (like the word "rate" in "1.1x rate") is ignored
    }

    return settings
}
