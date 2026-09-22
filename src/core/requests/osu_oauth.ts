import { settings } from "@devvit/web/server"
import { redis } from "@devvit/redis"
import z from "zod"
import { USER_AGENT, REQUEST_TIMEOUT_MS } from "../scorepost/consts"

const TOKEN_REDIS_KEY = "osu:access_token"

const TokenResponseSchema = z.object({
    access_token: z.string(),
    expires_in: z.number()
})

export async function getAccessToken(): Promise<string> {
    // check Redis cache first if we can use a still-valid token
    const cached = await redis.get(TOKEN_REDIS_KEY)
    if (cached) {
        // expireTime returns remaining TTL in seconds in Devvit's Redis wrapper
        const ttl = await redis.expireTime(TOKEN_REDIS_KEY)
        if (ttl > 60) return cached
    }

    // we have no token in cache we can use, fetch a new one
    const clientId = await settings.get("osuClientId")
    const clientSecret = await settings.get("osuClientSecret")

    if (!clientId || !clientSecret) {
        throw new Error("osu! API credentials not configured. Set them using the Devvit CLI.")
    }

    const response = await fetch("https://osu.ppy.sh/oauth/token", {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "client_credentials",
            scope: "public"
        })
    })

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        throw new Error(`osu! API token refresh failed: ${response.status} ${errorBody}`)
    }

    const rawData = await response.json()
    const data = TokenResponseSchema.parse(rawData)

    // cache the token in Redis with TTL matching the token lifetime
    await redis.set(TOKEN_REDIS_KEY, data.access_token)
    await redis.expire(TOKEN_REDIS_KEY, data.expires_in)

    console.log("Regenerated the osu! API v2 access_token")
    return data.access_token
}
