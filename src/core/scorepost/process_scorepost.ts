import type { PostV2 } from "@devvit/web/shared"
import { reddit, type Comment } from "@devvit/web/server"
import { playerRegex, beatmapRegex, accRegex, tailRegex, parensRegex } from "./consts"
import { getMods, sameMods } from "./helpers/get_mods"
import { matchGamemode } from "./helpers/match_gamemode"
import { lookupUser, getBeatmapScores, type Mod, type Score, type BeatmapOwner } from "../requests/osu_api"
import { getPerformance } from "../requests/osu_tools"
import { searchBeatmap } from "./beatmap_search"
import { buildComment, type CommentData } from "./rtjson"

export async function processScorepost(post: PostV2) {
    const playerMatch = playerRegex.exec(post.title)
    if (!playerMatch) {
        console.log(`No player in scorepost title: ${post.title}`)
        return
    }

    // strip parenthesized annotations from the player name ("Player (old name)"):
    const playerName = playerMatch[1]!.replace(parensRegex, "").trim()

    const beatmapMatch = beatmapRegex.exec(post.title)
    if (!beatmapMatch) {
        console.log(`No beatmap in scorepost title: ${post.title}`)
        return
    }
    // the regex matches beatmaps like "Artist - Title [Difficulty]", so beatmapStr is of this format
    const beatmapStr = beatmapMatch[1]!.trim()

    // will return "osu" (standard) if no match
    const gamemode = matchGamemode(post.title)

    // parse accuracy with both dot and comma notation, from the title tail (everything after the difficulty bracket):
    // running accRegex on the whole title would let percentages in map names (like the ranked map "Hikaru Genji - Yuuki 100%") show as the score accuracy.
    // the score segment usually comes first in the tail, so the score accuracy wins over commentary percentages
    const tailMatch = tailRegex.exec(post.title)
    const accuracyMatch = tailMatch?.[1] ? accRegex.exec(tailMatch[1]) : null
    let acc = accuracyMatch ? parseFloat(accuracyMatch[1]!.replace(",", ".")) : null
    // don't accept out-of-range acc values
    if (acc !== null && (acc < 0 || acc > 100)) acc = null

    const mods: Mod[] = getMods(post.title)

    const postId = post.id as `t3_${string}`

    // we already guard for comments we already successfully processed in the triggers
    // but this guards against fake failures in case reddit throws some: if the submitComment throws below but the comment is already posted, we don't want to re-post it!
    if (await findOwnComment(postId)) {
        console.log(`Comment already posted on ${postId}, skipping`)
        return
    }

    // fetch player from osu! API with stats for the detected gamemode (std by default)
    const playerResult = await lookupUser(playerName, gamemode)
    if (!playerResult || playerResult.error) {
        console.log(`Player "${playerName}" not found`)
        return
    }
    const player = playerResult.data

    // search for the beatmap via player's plays
    // when the beatmap isn't found (score too old to be in the player's recent/best lists) we will fall back to a player-only comment
    // the matched score is the play the beatmap was found through: plausibly the posted play itself
    const { beatmap, topPlay, matchedScore } = await searchBeatmap(player.id, beatmapStr, gamemode)
    if (!beatmap) console.log(`Beatmap "${beatmapStr}" not found for player "${playerName}", building a player-only comment`)

    // get map leaderboard and max combo
    let topScore: Score | null = null
    let maxCombo: number | null = null
    let guestMapper: BeatmapOwner | null = null
    if (beatmap) {
        maxCombo = beatmap.max_combo ?? null
        const mapScores = await getBeatmapScores(beatmap.id, gamemode)
        if (!mapScores.error && mapScores.data.scores.length > 0) {
            topScore = mapScores.data.scores[0]!
        }

        // detect guest mapper from beatmap owners (no parsing of "'s" in diff name like the old osu bot, most GDs have their mapper on the osu! API directly now)
        const setCreator = beatmap.beatmapset?.creator
        guestMapper = beatmap.owners?.find(o => o.username !== setCreator) ?? null
    }

    // the matched play, when it plausibly IS the posted play (same mods as parsed from the title)
    const postedPlay = matchedScore !== null && sameMods(matchedScore.mods, mods) ? matchedScore : null

    // when the play was done on stable, we want to add +CL to the NoMod row (yeah it's a bit weird to have nomod mods but if we want accurate calc for potential PP on the same client we need to do that)
    // and also add the CL mod for the row with the score mods
    const playRowMods: Mod[] = postedPlay !== null && postedPlay.is_stable ? [...mods, { acronym: "CL" }] : mods
    const nomodRowMods: Mod[] = postedPlay !== null && postedPlay.is_stable ? [{ acronym: "CL" }] : []

    // compute PP at multiple accuracies (95, 98, 99, 100 + the scorepost's acc if present),
    // for the difficulty table that only exists when the beatmap was found
    let ppAccuracies: number[] = []
    let nomodPp: (number | null)[] = []
    let moddedPp: (number | null)[] = []
    let moddedDifficulty = null
    if (beatmap) {
        const accuracySet = new Set<number>([95, 98, 99, 100])
        if (acc !== null) accuracySet.add(acc)
        ppAccuracies = [...accuracySet].sort((a, b) => a - b)

        // determine if the accuracy we pass is supposed to be the one of the actual score. if yes, that means we should pass the combo + misses + legacy score (for stable) so we get the accurate pp
        const playOpts = (isPlayRow: boolean, a: number) => {
            if (postedPlay === null || !isPlayRow || a !== acc) return undefined
            return postedPlay.is_stable ? { combo: postedPlay.max_combo, misses: postedPlay.miss_count ?? undefined, legacyTotalScore: postedPlay.total_score ?? undefined } : { combo: postedPlay.max_combo, misses: postedPlay.miss_count ?? undefined }
        }

        // fetch NoMod PP at each accuracy (always needed for the PP row)
        const nomodResults = await Promise.all(ppAccuracies.map(a => getPerformance(beatmap.id, nomodRowMods, gamemode, a, playOpts(mods.length === 0, a))))
        nomodPp = nomodResults.map(r => (r.error ? null : r.data.performance))

        // get max combo from the nomod difficulty attributes when the beatmap response doesn't include it
        if (maxCombo === null) {
            const firstSuccess = nomodResults.find(r => !r.error)
            if (firstSuccess && !firstSuccess.error) maxCombo = firstSuccess.data.difficulty.maxCombo
        }

        // fetch modded PP + difficulty at each accuracy (only when mods are present)
        if (mods.length > 0) {
            const moddedResults = await Promise.all(ppAccuracies.map(a => getPerformance(beatmap.id, playRowMods, gamemode, a, playOpts(true, a))))
            moddedPp = moddedResults.map(r => (r.error ? null : r.data.performance))
            const firstSuccess = moddedResults.find(r => !r.error)
            if (firstSuccess && !firstSuccess.error) moddedDifficulty = firstSuccess.data
        }
    }

    // at this point we (should) have all data we need, we can try to build the comment
    const data: CommentData = {
        beatmap,
        player,
        mode: gamemode,
        mods: playRowMods,
        nomodMods: nomodRowMods,
        acc,
        topScore,
        playerTopScore: topPlay,
        guestMapper,
        maxCombo,
        moddedDifficulty,
        ppAccuracies,
        nomodPp,
        moddedPp
    }

    const richtext = buildComment(data)
    if (!richtext) {
        console.log("Not enough data to build the comment")
        return
    }

    console.log("Generated comment:", richtext.build())

    // post the comment, 3 attempts total
    const MAX_RETRIES = 2
    let lastError: unknown
    let comment: Comment | null = null
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
            comment = await reddit.submitComment({ id: postId, richtext })
            console.log(`Comment posted on ${postId} (attempt ${attempt})`)
            break
        } catch (err) {
            lastError = err
            console.error(`Failed to post comment on ${postId} (attempt ${attempt}/${MAX_RETRIES + 1}):`, err)

            if (attempt <= MAX_RETRIES) {
                // the failed attempt may have created the comment anyway: don't retry in this case
                const existing = await findOwnComment(postId)
                if (existing) {
                    console.log(`Comment from attempt ${attempt} exists on ${postId}, not retrying`)
                    comment = existing
                    break
                }

                // wait a bit before retrying
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            }
        }
    }

    if (!comment) {
        console.error(`Failed to post comment on ${postId} after ${MAX_RETRIES + 1} attempts. Giving up.`, lastError)
        throw new Error(`Failed to post comment after retries: ${lastError}`)
    }

    // distinguish is not retried: the comment is already posted, and a distinguish failure usually means the bot isn't mod of the subreddit, which retrying wouldn't fix
    try {
        await comment.distinguish(true)
        console.log(`Comment pinned on ${postId}`)
    } catch (err) {
        console.error(`Failed to pin comment on ${postId}:`, err)
    }
}

/**
 * find a top-level comment on the post authored by the app account, if one exists.
 * used to avoid posting a duplicate: a submitComment call that reported failure may still have created the comment server-side (e.g. a timeout after Reddit received it)
 */
async function findOwnComment(postId: `t3_${string}`): Promise<Comment | null> {
    try {
        const appUser = await reddit.getAppUser()
        if (!appUser) return null
        // the bot comments within moments of the post's creation, so if its comment exists it's among the oldest: sort "old" with a small limit is enough to find it
        const comments = await reddit.getComments({ postId, depth: 1, limit: 10, sort: "old" }).all()
        return comments.find(c => c.authorId === appUser.id) ?? null
    } catch (err) {
        // a failed check shouldn't block posting: the trigger's redis claim still guards against concurrent duplicates
        console.error(`Couldn't check for existing comments on ${postId}:`, err)
        return null
    }
}
