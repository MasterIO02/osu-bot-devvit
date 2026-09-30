import { Hono } from "hono"
import { redis } from "@devvit/redis"
import type { OnAppInstallRequest, OnCommentCreateRequest, OnPostCreateRequest, TriggerResponse } from "@devvit/web/shared"
import { processPost } from "../core/process_post"
import { processComment } from "../core/process_comment"

export const triggers = new Hono()

triggers.post("/on-app-install", async c => {
    const input = await c.req.json<OnAppInstallRequest>()
    console.log(`App installed to subreddit: r/${input.subreddit?.name}`)

    return c.json<TriggerResponse>({ status: "ok" }, 200)
})

triggers.post("/on-post-create", async c => {
    const input = await c.req.json<OnPostCreateRequest>()
    console.log(`New post created in r/${input.subreddit?.name}: ${input.post?.title}`)

    if (!input.post) return c.json<TriggerResponse>({ status: "ok" }, 200)

    // claim the post before processing
    // triggers can fire more than once per event, so a simple "exists" test would let concurrent deliveries both process the post
    const postId = input.post.id
    const claimed = await redis.set(`processed:${postId}`, "1", {
        nx: true,
        // we can be pretty sure reddit will not trigger the trigger again for the same post after 24h
        expiration: new Date(Date.now() + 24 * 60 * 60 * 1000)
    })
    if (!claimed) {
        console.log(`Post ${postId} already processed, skipping`)
        return c.json<TriggerResponse>({ status: "ok" }, 200)
    }

    try {
        await processPost(input.post)
    } catch (err) {
        console.error(`Error processing post ${postId}:`, err)
        // release the claim so that a redelivered trigger can retry
        await redis.del(`processed:${postId}`)
    }

    return c.json<TriggerResponse>({ status: "ok" }, 200)
})

triggers.post("/on-comment-create", async c => {
    const input = await c.req.json<OnCommentCreateRequest>()

    if (!input.comment) return c.json<TriggerResponse>({ status: "ok" }, 200)

    try {
        await processComment(input.comment)
    } catch (err) {
        console.error(`Error processing comment ${input.comment.id}:`, err)
    }

    return c.json<TriggerResponse>({ status: "ok" }, 200)
})
