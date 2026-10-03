import { z } from "zod"
import { settings } from "@devvit/web/server"
import { USER_AGENT, REQUEST_TIMEOUT_MS } from "../scorepost/consts"
import type { Score } from "./osu_api"

const BASE_URL = "https://apis.issou.best"

// custom skin IDs to use on o!rdr depending on mods (exported for the tests, so they can pin the mod-to-skin mapping without pinning the IDs)
export const SKIN_NOMOD = "21042"
export const SKIN_EZ = "21043"
export const SKIN_DT = "21045"

/** the o!rdr score ID type: "legacy" for scores set on stable, "solo" for lazer scores */
export type ScoreIdType = "legacy" | "solo"

/**
 * @description the score ID type to send to o!rdr, matching the client the score was set on
 */
export function scoreIdType(score: Score): ScoreIdType {
    return score.is_stable ? "legacy" : "solo"
}

/**
 * @description the score ID in the scheme o!rdr needs: the legacy scheme for stable plays, the solo scheme for lazer plays.
 * stable plays without a legacy ID fall back to the score's own ID (the osu! API puts the legacy ID in the id field anyway)
 */
export function replayScoreId(score: Score): number {
    // probably useless. but at least we use legacy_score_id when it's there
    return score.is_stable ? score.legacy_score_id || score.id : score.id
}

/**
 * response of the render creation endpoint on success: the created render's ID, with errorCode 0.
 * refusals always come as a non-2xx HTTP status carrying errorCode/message, handled before the body is parsed
 * @see https://ordr.issou.best/docs#operation/3
 */
const PostRenderResponseSchema = z.object({
    renderID: z.number(),
    errorCode: z.literal(0),
    message: z.string().optional()
})

/**
 * @description submit a score's replay to o!rdr for rendering
 * @param score the matched score to render
 * @returns the created render's ID, or an error
 */
export async function submitRender(score: Score): Promise<{ error: false; data: { renderID: number } } | { error: true }> {
    const apiKey = await settings.get<string>("ordrApiKey")
    if (!apiKey) {
        console.error("o!rdr API key not configured. Set ordrApiKey using the Devvit CLI.")
        return { error: true }
    }

    const scoreId = replayScoreId(score)

    // select the skin from the play's mods
    let skin = SKIN_NOMOD
    if (score.mods.some(m => m.acronym === "EZ")) {
        skin = SKIN_EZ // EZDT uses the EZ skin
    } else if (score.mods.some(m => m.acronym === "DT" || m.acronym === "NC")) {
        skin = SKIN_DT
    }

    // every value must be a string, even the booleans (o!rdr's API requirement)
    const formData = new FormData()
    formData.append("replayScoreId", String(scoreId))
    formData.append("replayScoreIdType", scoreIdType(score))
    formData.append("verificationKey", apiKey)
    formData.append("customSkin", "true")
    formData.append("skin", skin)
    formData.append("resolution", "1920x1080")
    formData.append("inGameBGDim", "90")
    formData.append("showHitCounter", "true")
    formData.append("showAimErrorMeter", "true")
    formData.append("showScoreboard", "true")
    formData.append("showStrainGraph", "true")
    formData.append("showSliderBreaks", "true")
    formData.append("useBeatmapColors", "false")
    formData.append("useSkinColors", "true")

    const url = `${BASE_URL}/ordr/renders`
    console.log(`Submitting replay of score ${scoreId} to o!rdr`)

    try {
        const response = await fetch(url, {
            method: "POST",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
                "User-Agent": USER_AGENT
            },
            body: formData
        })

        if (!response.ok) {
            try {
                const responseBody = await response.text()
                console.error(`Couldn't submit the render to o!rdr, got status ${response.status}: ${responseBody}`)
            } catch {
                console.error(`Couldn't submit the render to o!rdr, got status ${response.status}, no response body`)
            }
            return { error: true }
        }

        const data = PostRenderResponseSchema.parse(await response.json())

        console.log(`Replay of score ${scoreId} submitted to o!rdr (renderID ${data.renderID})`)
        return { error: false, data: { renderID: data.renderID } }
    } catch (err) {
        console.error("Couldn't submit the render to o!rdr:", err)
        return { error: true }
    }
}

export type RenderStatus = { status: "done"; videoUrl: string } | { status: "failed"; reason: string } | { status: "pending" }

/**
 * a render in the renders list
 * @see https://ordr.issou.best/docs#operation/2
 */
const RenderSchema = z.object({
    progress: z.string(),
    videoUrl: z.string(),
    errorCode: z.number()
})

const RendersResponseSchema = z.object({
    renders: z.array(RenderSchema),
    maxRenders: z.number().optional()
})

/**
 * @description get a render's state from the renders list
 * @returns the render's status or an error
 */
export async function getRender(renderId: number): Promise<{ error: false; data: RenderStatus } | { error: true }> {
    const url = `${BASE_URL}/ordr/renders?renderID=${renderId}`
    console.log(`Polling o!rdr render: GET ${url}`)

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
                "User-Agent": USER_AGENT
            }
        })

        if (!response.ok) {
            try {
                const responseBody = await response.text()
                console.error(`Couldn't poll o!rdr render ${renderId}, got status ${response.status}: ${responseBody}`)
            } catch {
                console.error(`Couldn't poll o!rdr render ${renderId}, got status ${response.status}, no response body`)
            }
            return { error: true }
        }

        const data = RendersResponseSchema.parse(await response.json())
        const render = data.renders[0]
        if (!render) {
            console.error(`Couldn't find o!rdr render ${renderId} while polling!`)
            return { error: true }
        }

        let renderStatus: RenderStatus = { status: "pending" }
        if (render.progress === "Done.") renderStatus = { status: "done", videoUrl: render.videoUrl }
        if (render.errorCode !== 0) renderStatus = { status: "failed", reason: `errorCode ${render.errorCode}` }

        return { error: false, data: renderStatus }
    } catch (err) {
        console.error(`Couldn't poll o!rdr render ${renderId}:`, err)
        return { error: true }
    }
}
