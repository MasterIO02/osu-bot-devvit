import { z } from "zod"
import { settings } from "@devvit/web/server"
import { USER_AGENT, REQUEST_TIMEOUT_MS } from "../scorepost/consts"
import type { Gamemode, Mod } from "./osu_api"

const BASE_URL = "https://apis.issou.best"

/** a mod with its acronym and optional string-valued settings, as expected by the osu-tools API */
const PerformanceModSchema = z.object({
    acronym: z.string(),
    settings: z.record(z.string(), z.string()).optional()
})

/**
 * request body for the performance calculation endpoint.
 * @see https://apis.issou.best/osu/tools/performance
 */
export const PerformanceRequestSchema = z.object({
    beatmapId: z.number().int().min(0),
    rulesetId: z.number().int().min(-1).max(3).optional().default(-1),
    mods: z.array(PerformanceModSchema).optional().default([]),
    accuracy: z.number().min(0).max(100).optional().default(100),
    misses: z.number().int().min(0).optional().default(0),
    mehs: z.number().int().min(0).optional(),
    goods: z.number().int().min(0).optional(),
    oks: z.number().int().min(0).optional(),
    greats: z.number().int().min(0).optional(),
    combo: z.number().int().min(0).optional(),
    percentCombo: z.number().min(0).max(100).optional().default(100),
    largeTickMisses: z.number().int().min(0).optional().default(0),
    sliderTailMisses: z.number().int().min(0).optional().default(0),
    tinyDroplets: z.number().int().min(0).optional(),
    droplets: z.number().int().min(0).optional(),
    legacyTotalScore: z.number().int().optional()
})
export type PerformanceRequest = z.infer<typeof PerformanceRequestSchema>

/**
 * response from the performance calculation endpoint.
 */
const PerformanceResponseSchema = z.object({
    performance: z.number(),
    difficulty: z.object({
        starRating: z.number(),
        approachRate: z.number(),
        overallDifficulty: z.number(),
        circleSize: z.number(),
        drainRate: z.number(),
        maxCombo: z.number(),
        bpm: z.number(),
        length: z.number(),
        drainLength: z.number(),
        attributes: z.record(z.string(), z.unknown())
    }),
    score: z.object({
        rulesetId: z.number(),
        beatmapId: z.number(),
        beatmapName: z.string(),
        accuracy: z.number(),
        combo: z.number(),
        statistics: z.record(z.string(), z.number())
    }),
    performanceAttributes: z.object({
        total: z.number(),
        aim: z.number(),
        speed: z.number(),
        accuracyPp: z.number(),
        flashlight: z.number(),
        effectiveMissCount: z.number(),
        extra: z.record(z.string(), z.unknown())
    })
})
export type PerformanceResponse = z.infer<typeof PerformanceResponseSchema>

/** map a Gamemode string to the numeric ruleset ID expected by the API */
function gamemodeToRulesetId(mode: Gamemode): number {
    const map: Record<Gamemode, number> = { osu: 0, taiko: 1, fruits: 2, mania: 3 }
    return map[mode]
}

/**
 * @description calculate performance and difficulty attributes for a beatmap with mods via the osu-tools API
 * @param beatmapId the beatmap's numeric ID
 * @param mods mod objects to apply (e.g. [{ acronym: "HD" }, { acronym: "DT", settings: { speed_change: 1.5 } }])
 * @param mode game mode for the ruleset
 * @param accuracy accuracy percentage (0-100), defaults to 100
 * @param misses number of misses, defaults to 0
 * @returns the performance response, or an error
 */
export async function getPerformance(beatmapId: number, mods: Mod[], mode: Gamemode, accuracy?: number, misses?: number): Promise<{ error: false; data: PerformanceResponse } | { error: true }> {
    const apiKey = await settings.get("osuToolsApiKey")
    if (!apiKey) {
        console.error("osu-tools API key not configured. Set osuToolsApiKey using the Devvit CLI.")
        return { error: true }
    }

    // convert Mod[] (settings: Record<string, unknown>) to the API format (settings: Record<string, string>)
    const apiMods = mods.map(m => ({
        acronym: m.acronym,
        settings: m.settings ? Object.fromEntries(Object.entries(m.settings).map(([k, v]) => [k, String(v)])) : undefined
    }))

    const url = `${BASE_URL}/osu/tools/performance`
    console.log(`Requesting osu-tools API: POST ${url}`)

    try {
        // parsing inside the try so an invalid request body (e.g. an out-of-range accuracy in scorepost title) degrades to { error: true } like the other failure modes
        const body = PerformanceRequestSchema.parse({
            beatmapId,
            rulesetId: gamemodeToRulesetId(mode),
            mods: apiMods,
            accuracy: accuracy ?? 100,
            misses: misses ?? 0
        })

        const response = await fetch(url, {
            method: "POST",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": USER_AGENT
            },
            body: JSON.stringify(body)
        })

        if (!response.ok) {
            try {
                const responseBody = await response.text()
                console.error(`Couldn't request osu-tools API, got status ${response.status}: ${responseBody}`)
            } catch {
                console.error(`Couldn't request osu-tools API, got status ${response.status}, no response body`)
            }
            return { error: true }
        }

        const rawData = await response.json()
        const data = PerformanceResponseSchema.parse(rawData)
        console.log(`Received valid response from osu-tools API for beatmap ${beatmapId}`)
        return { error: false, data }
    } catch (err) {
        console.error("Couldn't request osu-tools API:", err)
        return { error: true }
    }
}
