import { getUserBestScores, getUserRecentScores, getBeatmap, type Score, type BeatmapExtended, type Gamemode } from "../requests/osu_api"
import { parensRegex } from "./consts"

export interface SearchResult {
    /** the scorepost's beatmap, if it was identified in the player's plays */
    beatmap: BeatmapExtended | null
    /** the play the beatmap was identified from: plausibly the posted play itself */
    matchedScore: Score | null
    /** the player's highest-pp score */
    topPlay: Score | null
}

/** a beatmap identified from one of the player's scores, with the score it was found through */
interface BeatmapMatch {
    beatmap: BeatmapExtended
    score: Score
}

/**
 * search for a beatmap in the player's recent best and recent plays.
 * the old python bot also checked player events first (rank achievements), but v1 included events inline in get_user responses for free.
 * in v2, events require a separate /recent_activity call and only return beatmap title/url (no id), so it's not worth the extra request.
 */
export async function searchBeatmap(userId: number, beatmapStr: string, mode: Gamemode): Promise<SearchResult> {
    // TODO: if we don't find the beatmap in the player's play maybe try to find the beatmap without the player so we at least have some info about it

    const bestScores = await getUserBestScores(userId, mode, 100)

    // best scores are sorted by pp, so the first one is the player's top play
    const topPlay = !bestScores.error && bestScores.data.length > 0 ? bestScores.data[0]! : null

    const match = (await searchBest(bestScores, beatmapStr)) ?? (await searchRecent(userId, beatmapStr, mode))
    return { beatmap: match?.beatmap ?? null, matchedScore: match?.score ?? null, topPlay }
}

/** search the player's top 100 scores from the last week */
async function searchBest(bestScores: { error: true } | { error: false; data: Score[] }, beatmapStr: string): Promise<BeatmapMatch | null> {
    if (bestScores.error) return null

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    // skip scores older than a week. if score is missing ended_at then it gets computed as NaN and is kept
    const candidates = bestScores.data.filter(score => !(new Date(score.ended_at).getTime() < oneWeekAgo) && Boolean(score.beatmap && score.beatmapset))

    return findMatch(candidates, beatmapStr)
}

/** search the player's 50 most recent plays */
async function searchRecent(userId: number, beatmapStr: string, mode: Gamemode): Promise<BeatmapMatch | null> {
    const recentScores = await getUserRecentScores(userId, mode, 50)
    if (recentScores.error) return null

    const seen = new Set<number>()
    const candidates = recentScores.data.filter(score => {
        if (!score.beatmap || !score.beatmapset) return false
        if (seen.has(score.beatmap.id)) return false
        seen.add(score.beatmap.id)
        return true
    })

    return findMatch(candidates, beatmapStr)
}

/**
 * find the first candidate whose map matches and fetch its beatmap data
 */
async function findMatch(candidates: Score[], beatmapStr: string): Promise<BeatmapMatch | null> {
    // try to match all beatmaps on matchesBeatmap first, then matchesBeatmapStripped
    // matchesBeatmapStripped is used for the edge case where scoreposter adds more data to a beatmap title, while it's not there in the actual beatmap
    // example: scoreposter adds "(new remix)" while map doesn't have that, we'll try to match the map without that "(new remix)"
    for (const matches of [matchesBeatmap, matchesBeatmapStripped]) {
        for (const score of candidates) {
            if (!matches(scoreMapStr(score.beatmap!, score.beatmapset!), beatmapStr)) continue

            const bmap = await getBeatmap(score.beatmap!.id)
            if (!bmap.error) return { beatmap: bmap.data, score }
        }
    }
    return null
}

/** build a beatmap display string from score-level beatmap + beatmapset data */
function scoreMapStr(beatmap: { version: string }, beatmapset: { artist: string; title: string }): string {
    return `${beatmapset.artist} - ${beatmapset.title} [${beatmap.version}]`
}

/** check if two beatmap strings match (case-insensitive, partial match) */
function matchesBeatmap(apiStr: string, titleStr: string): boolean {
    const a = apiStr.toLowerCase()
    const t = titleStr.toLowerCase()
    return a === t || a.includes(t) || t.includes(a)
}

/** like matchesBeatmap, but with parenthesized decorations removed from the title ("Song (new remix)" -> "Song") */
function matchesBeatmapStripped(apiStr: string, titleStr: string): boolean {
    const stripped = titleStr.replace(parensRegex, "").trim()
    return stripped !== titleStr && matchesBeatmap(apiStr, stripped)
}
