import { FormatRange } from "@devvit/web/server"
import { BeatmapExtended, BeatmapOwner, Gamemode, Mod, Score, User } from "../requests/osu_api"
import type { PerformanceResponse } from "../requests/osu_tools"
import { memes } from "./consts"
import { RichTextBuilder } from "@devvit/shared-types/richtext/RichTextBuilder.js"
import { makeFormatting } from "@devvit/shared-types/richtext/elements.js"

const OSU_URL = "https://osu.ppy.sh"

/** data needed to build a scorepost comment */
export interface CommentData {
    beatmap: BeatmapExtended | null
    player: User | null
    mode: Gamemode
    /** mods the modded row is computed with: the scorepost's mods, plus CL for stable plays */
    mods: Mod[]
    /** mods the NoMod row is computed with: empty for the plain "NoMod" label, CL for stable nomod plays (labeled "+CL") */
    nomodMods: Mod[]
    acc: number | null
    guestMapper: BeatmapOwner | null
    topScore: Score | null
    playerTopScore: Score | null
    maxCombo: number | null
    /** modded difficulty + performance data from the osu-tools API; null when no mods or API call failed */
    moddedDifficulty: PerformanceResponse | null
    /** accuracy percentages used for PP calculation (e.g. [95, 98, 99, 100]) */
    ppAccuracies: number[]
    /** PP values for NoMod at each accuracy; null when the API call failed */
    nomodPp: (number | null)[]
    /** PP values for modded at each accuracy; null when the API call failed or no mods */
    moddedPp: (number | null)[]
}

/** build the full scorepost comment as a RichTextBuilder instance */
export function buildComment(data: CommentData): RichTextBuilder | null {
    if (!data.beatmap && !data.player) return null

    const builder = new RichTextBuilder()
    let hasContent = false

    if (data.beatmap) {
        buildMapHeader(builder, data.beatmap, data.mode, data.guestMapper)
        buildSubheader(builder, data.beatmap, data.topScore, data.maxCombo)
        buildDifficultyTable(builder, data.beatmap, data.nomodMods, data.mods, data.moddedDifficulty, data.ppAccuracies, data.nomodPp, data.moddedPp)
        hasContent = true
    }

    if (data.player?.statistics) {
        buildPlayerTable(builder, data.player, data.playerTopScore)
        hasContent = true
    }

    if (!hasContent) return null

    builder.horizontalRule()
    buildFooter(builder)

    return builder
}

// formatting flag constants from the RTJSON spec
const BOLD = 1
const SUPERSCRIPT = 32

/** helper to create a FormatRange for RTJSON text formatting */
function fmt(flags: number, start: number, length: number): FormatRange {
    const opts: { bold?: boolean; superscript?: boolean; startIndex: number; length: number } = { startIndex: start, length }
    if (flags & BOLD) opts.bold = true
    if (flags & SUPERSCRIPT) opts.superscript = true
    return makeFormatting(opts)
}

/** format a number with locale-appropriate thousand separators */
function sep(n: number): string {
    return n.toLocaleString("en-US")
}

/** format mods to a human-readable string like "+HDDT" */
function combineMods(mods: Mod[]): string {
    // TODO: maybe also handle DT rate change + DA (difficulty adjust) attribute changes
    if (mods.length === 0) return ""
    return `+${mods.map(m => m.acronym).join("")}`
}

/** format a score's accuracy as a percentage string with 2 decimal places */
function calcAccuracy(score: Score): string {
    return (score.accuracy * 100).toFixed(2)
}

/** convert an API gamemode string to the display string used in comments */
function gamemodeToStr(mode: Gamemode): string {
    const map: Record<Gamemode, string> = {
        osu: "osu!standard",
        mania: "osu!mania",
        taiko: "osu!taiko",
        fruits: "osu!catch"
    }
    return map[mode]!
}

/** build the h4 header with map link, mapper link, optional GD, and mode */
function buildMapHeader(b: RichTextBuilder, beatmap: BeatmapExtended, mode: Gamemode, guestMapper: BeatmapOwner | null) {
    const mapUrl = `${OSU_URL}/beatmapsets/${beatmap.beatmapset_id}#${mode}/${beatmap.id}`
    const artist = beatmap.beatmapset?.artist ?? "Unknown"
    const title = beatmap.beatmapset?.title ?? "Unknown"
    const mapStr = `${artist} - ${title} [${beatmap.version}]`
    const mapperUrl = `${OSU_URL}/u/${beatmap.user_id}`
    const mapperName = beatmap.beatmapset?.creator ?? "Unknown"

    b.heading({ level: 4 }, h => {
        h.link({ text: mapStr, url: mapUrl })
        h.rawText(" by ")
        h.link({ text: mapperName, url: mapperUrl })
        if (guestMapper) {
            h.rawText(" (GD by ")
            h.link({ text: guestMapper.username, url: `${OSU_URL}/u/${guestMapper.id}` })
            h.rawText(")")
        }
        h.rawText(` || ${gamemodeToStr(mode)}`)
    })
}

/** add the bold subheader: #1 score + max combo + rank status + playcount */
function buildSubheader(b: RichTextBuilder, beatmap: BeatmapExtended, topScore: Score | null, maxCombo: number | null) {
    const tokens: string[] = []

    if (topScore) {
        const acc = calcAccuracy(topScore)
        const mods = combineMods(topScore.mods)
        let buf = ""
        if (mods) buf += `${mods} - `
        buf += `${acc}%`
        if (topScore.pp != null) buf += ` - ${sep(Math.round(topScore.pp))}pp`
        tokens.push(buf)
    }

    if (maxCombo) tokens.push(`${sep(maxCombo)}x max combo`)
    const statusStr = beatmap.status
    if (statusStr) {
        const rankedDate = beatmap.beatmapset?.ranked_date
        if (rankedDate && statusStr !== "Qualified") {
            const year = new Date(rankedDate).getFullYear()
            tokens.push(isNaN(year) ? statusStr : `${statusStr} (${year})`)
        } else {
            tokens.push(statusStr)
        }
    }
    if (beatmap.playcount) tokens.push(`${sep(beatmap.playcount)} plays`)

    if (tokens.length === 0) return

    const statsStr = tokens.join(" || ")

    b.paragraph(p => {
        if (topScore) {
            const username = topScore.username ?? "Unknown"
            p.text({ text: "#1: ", formatting: [fmt(BOLD, 0, 4)] })
            p.link({ text: username, url: `${OSU_URL}/u/${topScore.user_id}` })
            p.text({ text: ` (${statsStr})`, formatting: [fmt(BOLD, 0, statsStr.length + 3)] })
        } else {
            p.text({ text: statsStr, formatting: [fmt(BOLD, 0, statsStr.length)] })
        }
    })
}

/** format an accuracy value for the PP column label (e.g. 95 → "95%", 98.56 → "98.56%") */
function formatAcc(a: number): string {
    return Number.isInteger(a) ? `${a}%` : `${a.toFixed(2)}%`
}

/** separator smaller than the standard pipe "|", because it doesn't look very good in the table and in the footer (not centered vertically) */
const SMALL_SEP = " \u01C0 "

/** format PP values for a table cell: rounded integers joined by separator, "-" for nulls */
function formatPpCell(ppValues: (number | null)[]): string {
    return ppValues.map(pp => (pp === null ? "-" : sep(Math.round(pp)))).join(SMALL_SEP)
}

/** add a difficulty stats table (mods as rows, attributes + pp as columns) */
function buildDifficultyTable(b: RichTextBuilder, beatmap: BeatmapExtended, nomodMods: Mod[], mods: Mod[], moddedDifficulty: PerformanceResponse | null, ppAccuracies: number[], nomodPp: (number | null)[], moddedPp: (number | null)[]) {
    const hasPp = ppAccuracies.length > 0 && nomodPp.some(pp => pp !== null)

    b.table(t => {
        const headers = ["Mod", "CS", "AR", "OD", "HP", "SR", "BPM", "Length"]
        if (hasPp) headers.push(`pp (${ppAccuracies.map(formatAcc).join(SMALL_SEP)})`)
        for (const h of headers) {
            t.headerCell({ columnAlignment: "center" }, c => c.text({ text: h }))
        }

        // NoMod row (labeled with "+CL" when score was done on stable)
        t.row(r => {
            r.cell(c => c.text({ text: nomodMods.length > 0 ? combineMods(nomodMods) : "NoMod" }))
            r.cell(c => c.text({ text: roundTo(beatmap.cs, 1) }))
            r.cell(c => c.text({ text: roundTo(beatmap.ar, 1) }))
            r.cell(c => c.text({ text: roundTo(beatmap.accuracy, 1) }))
            r.cell(c => c.text({ text: roundTo(beatmap.drain, 1) }))
            r.cell(c => c.text({ text: roundTo(beatmap.difficulty_rating, 2) }))
            r.cell(c => c.text({ text: String(Math.round(beatmap.bpm ?? 0)) }))
            r.cell(c => c.text({ text: sToTs(beatmap.total_length) }))
            if (hasPp) {
                r.cell(c => c.text({ text: formatPpCell(nomodPp) }))
            }
        })

        // Modded row
        if (moddedDifficulty) {
            const d = moddedDifficulty.difficulty
            t.row(r => {
                r.cell(c => c.text({ text: combineMods(mods) }))
                r.cell(c => c.text({ text: roundTo(d.circleSize, 1) }))
                r.cell(c => c.text({ text: roundTo(d.approachRate, 1) }))
                r.cell(c => c.text({ text: roundTo(d.overallDifficulty, 1) }))
                r.cell(c => c.text({ text: roundTo(d.drainRate, 1) }))
                r.cell(c => c.text({ text: roundTo(d.starRating, 2) }))
                r.cell(c => c.text({ text: String(Math.round(d.bpm)) }))
                r.cell(c => c.text({ text: sToTs(d.length) }))
                if (hasPp) {
                    r.cell(c => c.text({ text: formatPpCell(moddedPp) }))
                }
            })
        }
    })
}

/** add a player stats table */
function buildPlayerTable(b: RichTextBuilder, player: User, topScore: Score | null) {
    if (!player.statistics) return
    const stats = player.statistics
    const playerUrl = `${OSU_URL}/u/${player.id}`

    const topBeatmap = topScore?.beatmap ?? null
    const topBeatmapset = topScore?.beatmapset ?? null

    const globalRankStr = stats.global_rank ? `#${sep(stats.global_rank)}` : "Unranked"
    const countryRankStr = stats.country_rank ? `#${sep(stats.country_rank)} ${player.country_code}` : "Unranked"

    b.table(t => {
        t.headerCell({ columnAlignment: "center" }, c => c.text({ text: "Player" }))
        t.headerCell({ columnAlignment: "center" }, c => c.text({ text: "Rank" }))
        t.headerCell({ columnAlignment: "center" }, c => c.text({ text: "Country" }))
        t.headerCell({ columnAlignment: "center" }, c => c.text({ text: "pp" }))
        t.headerCell({ columnAlignment: "center" }, c => c.text({ text: "Accuracy" }))
        t.headerCell({ columnAlignment: "center" }, c => c.text({ text: "Playcount" }))

        if (topBeatmap) {
            t.headerCell({ columnAlignment: "center" }, c => c.text({ text: "Top Play" }))
        }

        t.row(r => {
            r.cell(c => c.link({ text: player.username, url: playerUrl }))
            r.cell(c => c.text({ text: globalRankStr }))
            r.cell(c => c.text({ text: countryRankStr }))
            r.cell(c => c.text({ text: sep(Math.round(stats.pp)) }))
            r.cell(c => c.text({ text: `${(stats.accuracy * 100).toFixed(2)}%` }))
            r.cell(c => c.text({ text: sep(stats.play_count) }))

            if (topBeatmap) {
                r.cell(c => {
                    const topMapUrl = `${OSU_URL}/beatmapsets/${topBeatmap.beatmapset_id}#${topBeatmap.mode}/${topBeatmap.id}`
                    const topArtist = topBeatmapset?.artist ?? "Unknown"
                    const topTitle = topBeatmapset?.title ?? "Unknown"
                    const topMapName = `${topArtist} - ${topTitle} [${topBeatmap.version}]`
                    c.link({ text: topMapName, url: topMapUrl })
                    const mods = combineMods(topScore!.mods)
                    const acc = calcAccuracy(topScore!)
                    let buf = ""
                    if (mods) buf += `${mods} | `
                    buf += `${acc}%`
                    if (topScore!.pp != null) buf += ` | ${sep(Math.round(topScore!.pp))}pp`
                    c.text({ text: ` ${buf}` })
                })
            }
        })
    })
}

/** add the footer: meme + superscript attribution links */
function buildFooter(b: RichTextBuilder) {
    const meme = memes[Math.floor(Math.random() * memes.length)]!
    // u2013 = en dash (–)
    const prefix = `${meme}\u00a0\u2013\u00a0`
    const sourceText = "Source"
    const devText = "Developer"

    b.paragraph(p => {
        p.text({ text: prefix, formatting: [fmt(SUPERSCRIPT, 0, prefix.length)] })
        p.link({ text: sourceText, url: "https://github.com/MasterIO02/osu-bot-devvit", formatting: [fmt(SUPERSCRIPT, 0, sourceText.length)] })
        p.text({ text: SMALL_SEP, formatting: [fmt(SUPERSCRIPT, 0, 3)] })
        p.link({ text: devText, url: "https://reddit.com/u/MasterIO02", formatting: [fmt(SUPERSCRIPT, 0, devText.length)] })
    })
}

/** round a number to p decimal places, omitting trailing zeros */
function roundTo(n: number, p: number): string {
    return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(p)
}

/** convert seconds to a timestamp string (mm:ss or hh:mm:ss) */
function sToTs(secs: number): string {
    secs = Math.round(secs)
    const hrs = Math.floor(secs / 3600)
    const mins = Math.floor((secs - hrs * 3600) / 60)
    const s = secs - hrs * 3600 - mins * 60
    const ts = `${String(mins).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    return hrs ? `${String(hrs).padStart(2, "0")}:${ts}` : ts
}
