import { scheduler } from "@devvit/web/server"
import { redis } from "@devvit/redis"
import { submitRender, getRender, scoreIdType, replayScoreId, type ScoreIdType } from "../requests/ordr"
import type { Score, Gamemode } from "../requests/osu_api"
import { findOwnComment } from "../find_own_comment"
import { isVideoHeading, buildVideoHeading } from "./rtjson"
import { GET_RENDERS_POLL_INTERVAL_MS, RENDER_GUARD_TTL_SECONDS, RENDER_JOB_NAME, RENDER_TIMEOUT_MS, RENDER_VIDEO_TTL_SECONDS, renderGuardKey, renderVideoKey, type SchedulerOrdrPollInput } from "./consts"
import { loadCommentRichtext, storeCommentRichtext } from "../process_comment"

/**
 * @description submit a matched scorepost play's replay to o!rdr, or add the video link right away when the score was already rendered before.
 * @param postId the scorepost's ID
 * @param postedPlay the matched score, plausibly the posted play itself (its mods matched the title)
 * @param gamemode the play's gamemode
 */
export async function submitScoreRender(postId: `t3_${string}`, postedPlay: Score, gamemode: Gamemode): Promise<void> {
    // only osu!standard plays
    if (gamemode !== "osu") return
    if (postedPlay.has_replay === false) {
        console.log(`Not rendering the replay on ${postId}: the score has no online replay`)
        return
    }

    const scoreId = replayScoreId(postedPlay)
    const scoreType = scoreIdType(postedPlay)

    // the score was rendered before: add the cached video link to the comment
    const cachedUrl = await redis.get(renderVideoKey(scoreType, scoreId))
    if (cachedUrl) {
        console.log(`Score ${scoreId} was already rendered, adding the cached video link to the comment on ${postId}`)
        await addVideoToComment(postId, cachedUrl)
        return
    }

    // the guard holds until the render completes or times out; its value is the list of posts waiting on the render, this one first.
    // this is so we can give the same render for multiple scoreposts of the same score that could get posted at the same time
    const guardSet = await redis.set(renderGuardKey(scoreType, scoreId), JSON.stringify([postId]), {
        nx: true,
        expiration: new Date(Date.now() + RENDER_GUARD_TTL_SECONDS * 1000)
    })
    if (!guardSet) {
        // another scorepost of the same score is being rendered: wait for it instead of submitting a duplicate render.
        // queue this post so the poll adds the video link to its comment once the render completes
        const waiting = await getWaitingPosts(scoreType, scoreId)
        if (!waiting.includes(postId)) {
            waiting.push(postId)
            // plain SET overwrites the TTL, so re-apply it
            await redis.set(renderGuardKey(scoreType, scoreId), JSON.stringify(waiting), {
                expiration: new Date(Date.now() + RENDER_GUARD_TTL_SECONDS * 1000)
            })
        }
        console.log(`A render of score ${scoreId} is already in progress, its video will be added to the comment on ${postId} when it completes`)
        return
    }

    const result = await submitRender(postedPlay)
    if (result.error) {
        // release the guard so a future scorepost of the same score can retry
        await redis.del(renderGuardKey(scoreType, scoreId))
        return
    }

    const { renderID } = result.data
    try {
        await scheduler.runJob({ name: RENDER_JOB_NAME, data: { renderID, postId, scoreId, scoreType, submittedAt: Date.now() }, runAt: new Date(Date.now() + GET_RENDERS_POLL_INTERVAL_MS) })
    } catch (err) {
        // the poll chain never started: release the guard so a future scorepost of the same score can retry
        console.error(`Failed to schedule the poll of render ${renderID}, releasing the render guard of score ${scoreId}:`, err)
        await redis.del(renderGuardKey(scoreType, scoreId))
    }
}

/**
 * @description poll an in-progress render once: complete the render flow when it's done or failed, requeue the poll otherwise.
 * @param data the poll job's payload, carrying everything the render flow needs
 */
export async function pollRender(data: SchedulerOrdrPollInput): Promise<void> {
    // the render was already completed: run the completion again with the cached URL
    const cachedUrl = await redis.get(renderVideoKey(data.scoreType, data.scoreId))
    if (cachedUrl) {
        await finishRender(data, cachedUrl)
        return
    }

    const result = await getRender(data.renderID)
    if (!result.error && result.data.status === "done") {
        console.log(`Render ${data.renderID} of score ${data.scoreId} is done`)
        await finishRender(data, result.data.videoUrl)
        return
    }

    if (!result.error && result.data.status === "failed") {
        // rip
        console.log(`Render ${data.renderID} of score ${data.scoreId} failed: ${result.data.reason}`)
        await clearGuard(data.scoreType, data.scoreId)
        return
    }

    // still pending: give up after the render timeout
    if (Date.now() - data.submittedAt > RENDER_TIMEOUT_MS) {
        console.log(`Render ${data.renderID} of score ${data.scoreId} timed out after ${RENDER_TIMEOUT_MS / 1000}s, giving up`)
        await clearGuard(data.scoreType, data.scoreId)
        return
    }

    // render not done or check failed (!result.error === true, does not mean the render is errored!!), reschedule the check
    await scheduler.runJob({ name: RENDER_JOB_NAME, data, runAt: new Date(Date.now() + GET_RENDERS_POLL_INTERVAL_MS) })
}

/**
 * @description complete a finished render
 */
async function finishRender(data: SchedulerOrdrPollInput, videoUrl: string): Promise<void> {
    // cache the video URL first, so scoreposts of the same score arriving from now on get the link straight from it
    await redis.set(renderVideoKey(data.scoreType, data.scoreId), videoUrl, {
        expiration: new Date(Date.now() + RENDER_VIDEO_TTL_SECONDS * 1000)
    })
    await addVideoToComment(data.postId, videoUrl)
    // scoreposts of the same score that arrived while the render was in progress: their comments get the link too
    for (const postId of await getWaitingPosts(data.scoreType, data.scoreId)) {
        if (postId === data.postId) continue // ignore the post we're trying to process
        await addVideoToComment(postId as `t3_${string}`, videoUrl)
    }
    await clearGuard(data.scoreType, data.scoreId)
}

/** @returns the postIds waiting on a score's in-progress render */
async function getWaitingPosts(scoreType: ScoreIdType, scoreId: number): Promise<string[]> {
    const guard = await redis.get(renderGuardKey(scoreType, scoreId))
    if (!guard) return []
    try {
        return JSON.parse(guard) as string[]
    } catch {
        console.error(`Couldn't parse the waiting posts stored in the render guard of score ${scoreId}`)
        return []
    }
}

/** release the score's in-progress guard, dropping any posts still waiting on the render (they get nothing) */
async function clearGuard(scoreType: ScoreIdType, scoreId: number): Promise<void> {
    await redis.del(renderGuardKey(scoreType, scoreId))
}

/**
 * @description add the o!rdr video heading at the top of our scorepost comment, by editing it.
 * skips when the comment's RTJSON isn't stored anymore (expired) or the heading is already there
 * @param postId the scorepost's ID
 * @param url the rendered video's URL
 */
export async function addVideoToComment(postId: `t3_${string}`, url: string): Promise<void> {
    const storedRichtext = await loadCommentRichtext(postId)
    if (!storedRichtext) {
        console.log(`No stored comment RTJSON for ${postId}, can't add the video link`)
        return
    }

    const document = JSON.parse(storedRichtext).document as unknown[]
    if (document.some(isVideoHeading)) return

    const heading = JSON.parse(buildVideoHeading(url).build()).document[0]
    const doc = [heading, ...document]
    // store the updated document first, so the stored RTJSON stays in sync even if the edit below fails
    await storeCommentRichtext(postId, JSON.stringify({ document: doc }))

    const ownComment = await findOwnComment(postId)
    if (!ownComment) return

    try {
        await ownComment.edit({ richtext: { document: doc } })
        console.log(`Added the video link to the scorepost comment on ${postId}`)
    } catch (err) {
        console.error(`Failed to add the video link to the scorepost comment on ${postId}:`, err)
    }
}
