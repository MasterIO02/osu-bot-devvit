import { z } from "zod"
import { getAccessToken } from "./osu_oauth"
import { USER_AGENT, REQUEST_TIMEOUT_MS } from "../scorepost/consts"

const BASE_URL = "https://osu.ppy.sh/api/v2"

/**
 * @see https://osu.ppy.sh/docs/index.html#userstatistics
 */
const UserStatisticsSchema = z.object({
    // the API returns explicit null for ranks when the player is unranked/inactive
    country_rank: z.number().nullable().optional(),
    accuracy: z.number(),
    play_count: z.number(),
    pp: z.number(),
    global_rank: z.number().nullable().optional()
})

/**
 * @see https://osu.ppy.sh/docs/index.html#user
 */
const UserSchema = z.object({
    id: z.number(),
    username: z.string(),
    country_code: z.string(),
    previous_usernames: z.array(z.string()).optional(),
    statistics: UserStatisticsSchema.optional()
})

/**
 * @see https://osu.ppy.sh/docs/index.html#beatmapset
 */
const BeatmapsetSchema = z.object({
    artist: z.string(),
    creator: z.string(),
    title: z.string(),
    ranked_date: z.string().nullable().optional()
})

/**
 * @see https://osu.ppy.sh/docs/index.html#beatmapowner
 */
const BeatmapOwnerSchema = z.object({
    id: z.number(),
    username: z.string()
})

/** display names of the osu! API rank statuses */
type RankStatus = "Graveyard" | "WIP" | "Pending" | "Ranked" | "Approved" | "Qualified" | "Loved"

/** map the osu! API rank status, in integer or lowercase string form, to its display name; null for unknown values */
function rankStatus(ranked: number | string): RankStatus | null {
    const key = typeof ranked === "string" ? ranked.toLowerCase() : ranked
    const statuses: Record<number | string, RankStatus> = {
        [-2]: "Graveyard",
        [-1]: "WIP",
        [0]: "Pending",
        [1]: "Ranked",
        [2]: "Approved",
        [3]: "Qualified",
        [4]: "Loved",
        graveyard: "Graveyard",
        wip: "WIP",
        pending: "Pending",
        ranked: "Ranked",
        approved: "Approved",
        qualified: "Qualified",
        loved: "Loved"
    }
    return statuses[key] ?? null
}

/**
 * @see https://osu.ppy.sh/docs/index.html#beatmapextended
 * the raw `ranked` status (integer or string) is replaced by `status`, its display name (e.g. 1 → "Ranked"), null for unknown values
 */
const BeatmapExtendedSchema = z
    .object({
        beatmapset_id: z.number(),
        difficulty_rating: z.number(),
        id: z.number(),
        mode: z.string(),
        total_length: z.number(),
        user_id: z.number(),
        version: z.string(),
        max_combo: z.number().optional(),
        accuracy: z.number(),
        ar: z.number(),
        bpm: z.number().nullable().optional(),
        cs: z.number(),
        drain: z.number(),
        /** can be number or string: https://osu.ppy.sh/docs/#beatmapset-rank-status */
        ranked: z.union([z.number(), z.string()]),
        playcount: z.number(),
        beatmapset: BeatmapsetSchema.nullable().optional(),
        owners: z.array(BeatmapOwnerSchema).optional()
    })
    .transform(({ ranked, ...beatmap }) => ({ ...beatmap, status: rankStatus(ranked) }))

/**
 * @see https://osu.ppy.sh/docs/index.html#mod
 */
const ModSchema = z.object({
    acronym: z.string(),
    settings: z.record(z.string(), z.unknown()).optional()
})

/**
 * minimal beatmap fields embedded in user score responses.
 */
const EmbeddedBeatmapSchema = z.object({
    id: z.number(),
    version: z.string(),
    beatmapset_id: z.number(),
    mode: z.string()
})

/**
 * raw score schema that handles both beatmap leaderboard and user score formats.
 * leaderboard scores: mods are objects, is_perfect_combo/ended_at present.
 * user scores: mods are strings, is_perfect_combo/ended_at absent, beatmap embedded.
 * @see https://osu.ppy.sh/docs/index.html#score
 */
const RawScoreSchema = z.object({
    user_id: z.number(),
    accuracy: z.number(),
    mods: z.array(z.union([ModSchema, z.string()])),
    max_combo: z.number(),
    is_perfect_combo: z.boolean().optional(),
    pp: z.number().nullish(),
    ended_at: z.string().optional(),
    beatmap: EmbeddedBeatmapSchema.optional(),
    beatmapset: BeatmapsetSchema.optional(),
    user: z.object({ username: z.string() }).optional()
})

/** normalize a raw score into a consistent shape (see comment on RawScoreSchema for the why, great and consistent api :wink:) */
function normalizeScore(raw: z.infer<typeof RawScoreSchema>): Score {
    return {
        user_id: raw.user_id,
        username: raw.user?.username,
        accuracy: raw.accuracy,
        mods: raw.mods.map(m => (typeof m === "string" ? { acronym: m } : m)),
        max_combo: raw.max_combo,
        is_perfect_combo: raw.is_perfect_combo ?? false,
        pp: raw.pp ?? undefined,
        ended_at: raw.ended_at ?? "",
        beatmap: raw.beatmap ?? undefined,
        beatmapset: raw.beatmapset ?? undefined
    }
}

/**
 * @see https://osu.ppy.sh/docs/index.html#beatmapscores
 */
const BeatmapScoresSchema = z.object({
    scores: z.array(RawScoreSchema)
})

/** gamemodes as expected/received from the osu api */
export type Gamemode = "osu" | "taiko" | "fruits" | "mania"

// inferred types from zod schemas
export type User = z.infer<typeof UserSchema>
export type UserStatistics = z.infer<typeof UserStatisticsSchema>
export type BeatmapExtended = z.infer<typeof BeatmapExtendedSchema>
export type BeatmapOwner = z.infer<typeof BeatmapOwnerSchema>
export type Beatmapset = z.infer<typeof BeatmapsetSchema>
export type Mod = z.infer<typeof ModSchema>

/** minimal embedded beatmap data in user score responses */
export interface EmbeddedBeatmap {
    id: number
    version: string
    beatmapset_id: number
    mode: string
}

/** normalized score with mods always as objects and all fields present */
export interface Score {
    user_id: number
    username: string | undefined
    accuracy: number
    mods: Mod[]
    max_combo: number
    is_perfect_combo: boolean
    pp: number | undefined
    ended_at: string
    beatmap: EmbeddedBeatmap | undefined
    beatmapset: Beatmapset | undefined
}

/**
 * @description wrapper to make a request to the osu! API v2
 */
async function doRequest<T>(schema: z.ZodType<T>, path: string, params?: Record<string, string>, body?: unknown): Promise<{ error: false; data: T } | { error: true }> {
    const url = new URL(`${BASE_URL}${path}`)
    const method = body ? "POST" : "GET"

    console.log(`Requesting osu! API URL: ${method} ${url}`)

    if (params) {
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.append(key, value)
        }
    }

    let data: z.infer<typeof schema>
    try {
        const requestInit: RequestInit = {
            method,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
                "Authorization": `Bearer ${await getAccessToken()}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            }
        }
        if (body) requestInit.body = JSON.stringify(body)

        const response = await fetch(url.toString(), requestInit)

        if (!response.ok) {
            try {
                const responseBody = await response.text()
                console.error(`Couldn't request osu! API, got status ${response.status}: ${responseBody}`)
            } catch {
                console.error(`Couldn't request osu! API, got status ${response.status}, no response body`)
            }
            return { error: true }
        }

        const rawData = await response.json()
        data = schema.parse(rawData)
    } catch (err) {
        console.error("Couldn't request osu! API:", err)
        return { error: true }
    }

    console.log(`Received valid response from osu! API URL: ${url}`)
    return { error: false, data }
}

/**
 * @description get a user data by their numeric ID
 *
 * unused for now:
 * kept for the old bot's tooltip features (player stats by ID from a score, mapper rename detection via previous_usernames, mapper ranked-map counts)
 * in case RTJSON ever supports tooltips on links
 *
 * @param userId the user's numeric ID
 * @param mode optional game mode to include mode-specific stats
 * @see https://osu.ppy.sh/docs/index.html#get-user
 */
export async function getUser(userId: number, mode?: Gamemode) {
    let path = mode ? `/users/${userId}/${mode}` : `/users/${userId}`
    // the api says that using the key param is recommended to avoid looking up by username when we want ID, but it also says that the key param is deprecated...
    // still using it just in case, shouldn't break anything if they completely deprecate it
    path += `?key=id`
    return doRequest(UserSchema, path)
}

/**
 * @description lookup a user by username
 * @param username the user's display name
 * @param mode optional game mode to include mode-specific stats
 * @see https://osu.ppy.sh/docs/index.html#get-user
 */
export async function lookupUser(username: string, mode?: Gamemode) {
    // we shouldn't need the key parameter, using the @ tells the server we want to search with username ONLY
    const path = mode ? `/users/@${encodeURIComponent(username)}/${mode}` : `/users/@${encodeURIComponent(username)}`
    return doRequest(UserSchema, path)
}

/**
 * @description get a user's best (top pp) scores
 * @param userId the user's numeric ID
 * @param mode game mode to get scores for
 * @param limit max number of scores to return (default 100, max 100)
 * @see https://osu.ppy.sh/docs/index.html#get-user-scores
 */
export async function getUserBestScores(userId: number, mode: Gamemode, limit = 100) {
    const result = await doRequest(z.array(RawScoreSchema), `/users/${userId}/scores/best`, {
        mode,
        limit: String(limit),
        include_fails: "0",
        legacy_only: "0"
    })
    if (result.error) return result
    return { error: false as const, data: result.data.map(normalizeScore) }
}

/**
 * @description get a user's most recent scores
 * @param userId the user's numeric ID
 * @param mode game mode to get scores for
 * @param limit max number of scores to return (default 50, max 50)
 * @see https://osu.ppy.sh/docs/index.html#get-user-scores
 */
export async function getUserRecentScores(userId: number, mode: Gamemode, limit = 50) {
    const result = await doRequest(z.array(RawScoreSchema), `/users/${userId}/scores/recent`, {
        mode,
        limit: String(limit),
        include_fails: "0",
        legacy_only: "0"
    })
    if (result.error) return result
    return { error: false as const, data: result.data.map(normalizeScore) }
}

/**
 * @description get detailed info for a single beatmap including the beatmapset
 * @param beatmapId the beatmap's numeric ID
 * @see https://osu.ppy.sh/docs/index.html#get-beatmap
 */
export async function getBeatmap(beatmapId: number) {
    return doRequest(BeatmapExtendedSchema, `/beatmaps/${beatmapId}`)
}

/**
 * @description get the top scores for a beatmap (leaderboard)
 * @param beatmapId the beatmap's numeric ID
 * @param mode optional game mode filter
 * @see https://osu.ppy.sh/docs/index.html#get-beatmap-scores
 */
export async function getBeatmapScores(beatmapId: number, mode?: Gamemode) {
    const params: Record<string, string> = { legacy_only: "0" }
    if (mode) params.mode = mode
    const result = await doRequest(BeatmapScoresSchema, `/beatmaps/${beatmapId}/scores`, params)
    if (result.error) return result
    return { error: false as const, data: { scores: result.data.scores.map(normalizeScore) } }
}
