import type { ScoreIdType } from "../requests/ordr"

/**
 * how often a render's state is polled. each poll is a one-off scheduled job
 * Devvit caps handler executions at ~30s, so a render that takes minutes can't be waited on in-process.
 */
export const GET_RENDERS_POLL_INTERVAL_MS = 10_000

/** give up polling a render after this long */
export const RENDER_TIMEOUT_MS = 60 * 60 * 1000

/** redis key caching a score's rendered video URL, so we don't render the same score twice */
export const renderVideoKey = (scoreType: string, scoreId: number) => `ordr:video:${scoreType}:${scoreId}`
/** how long a cached video URL is kept */
export const RENDER_VIDEO_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * redis key guarding a score against duplicate renders while one is in progress.
 * its value is the JSON list of the postIds waiting on the in-progress render, drained when the render completes
 */
export const renderGuardKey = (scoreType: string, scoreId: number) => `ordr:progress:${scoreType}:${scoreId}`
/** how long the in-progress guard blocks duplicate renders of the same score */
export const RENDER_GUARD_TTL_SECONDS = 2 * 60 * 60

/** the name of the scheduled job polling an o!rdr render. the scheduler route's path and devvit.json's task registration must use the same name */
export const RENDER_JOB_NAME = "poll-ordr-render"

/** the data carried by each poll-ordr-render scheduled job */
export type SchedulerOrdrPollInput = {
    /** the o!rdr render being polled */
    renderID: number
    /** the scorepost we commented on */
    postId: `t3_${string}`
    /** the rendered score's ID, in the scheme named by scoreType */
    scoreId: number
    /** the score ID's scheme */
    scoreType: ScoreIdType
    /** when the render was submitted, for the timeout */
    submittedAt: number
}
