import type { CommentV2 } from "@devvit/web/shared"
import { reddit, type Comment } from "@devvit/web/server"
import { redis } from "@devvit/redis"
import { findOwnComment } from "../find_own_comment"
import { youtubeUrlRegex } from "./consts"
import { buildYouTubeLinksParagraph } from "./rtjson"

/**
 * the IDs of the videos linked on a post are kept in a redis sorted set (scored by discovery time, so the [1], [2]... numbering follows the order they were posted),
 * and the RTJSON of our scorepost comment is stored when it's posted, so the YouTube links paragraph can be added in front of the footer and the comment edited,
 * without refetching all the beatmap and player data the comment was built from.
 */

/** how long we keep the stored RTJSON and video list */
const KEY_TTL_SECONDS = 7 * 24 * 60 * 60

/** redis key holding the RTJSON document of the comment we posted on a scorepost */
const rtjsonKey = (postId: string) => `comment-rtjson:${postId}`

/** redis key holding the video IDs linked on a post */
const videosKey = (postId: string) => `comment-videos:${postId}`

/**
 * if the comment contains a video link we should add to the scorepost comment, add it
 */
export async function processVideoLinks(comment: CommentV2) {
    // only process comments on the root post, ignore comments on comments
    if (!comment.parentId?.startsWith("t3_")) return

    const videoMatch = youtubeUrlRegex.exec(comment.body)
    if (!videoMatch) return
    const videoId = videoMatch[1]!

    const postId = comment.postId as `t3_${string}`

    // no stored RTJSON means we never commented on this post (or the key expired): nothing to add the link to.
    // we comment the moment a scorepost goes up, so if the comment isn't there yet it will almost certainly never be
    const storedRichtext = await redis.get(rtjsonKey(postId))
    if (!storedRichtext) return

    // ignore our own comments
    try {
        if ((await reddit.getAppUser())?.username === comment.author) return
    } catch (err) {
        console.error("Couldn't fetch the app user to check if the comment is ours:", err)
    }

    const added = await addVideoId(postId, videoId)
    if (!added) return // the video is already linked

    console.log(`Found YouTube link ${videoId} on post ${postId}, adding it to the scorepost comment`)

    // rebuild the whole paragraph from the full video list and add it in front of the footer.
    // the sorted set is scored by discovery time, so zRange returns the IDs in the order they were posted
    const videoIds = (await redis.zRange(videosKey(postId), 0, -1)).map(m => m.member)
    const document = addYouTubeLinks(JSON.parse(storedRichtext).document, videoIds)

    // store the updated RTJSON document. if the edit below fails, the next video link will rebuild the paragraph from the full list anyway
    await storeCommentRichtext(postId, JSON.stringify({ document }))

    const ownComment = await findOwnComment(postId)
    if (!ownComment) return

    try {
        await ownComment.edit({ richtext: { document } })
        console.log(`Added YouTube link ${videoId} to the scorepost comment on ${postId}`)
    } catch (err) {
        console.error(`Failed to add YouTube link ${videoId} to the scorepost comment on ${postId}:`, err)
    }
}

/** store (or update) the RTJSON document of our comment on a post, so video links can be added into it later */
export async function storeCommentRichtext(postId: string, richtext: string): Promise<void> {
    await redis.set(rtjsonKey(postId), richtext, { expiration: new Date(Date.now() + KEY_TTL_SECONDS * 1000) })
}

/**
 * @description add a video ID (like youtube dQw4w9WgXcQ) to a post's video list
 * @returns false when it was already there so to guard against duplicate comments & redelivered events. true if added
 */
export async function addVideoId(postId: string, videoId: string): Promise<boolean> {
    const existing = await redis.zScore(videosKey(postId), videoId)
    if (existing !== undefined) return false
    // can't add key expiration directly in zAdd so using .expire() after instead
    await redis.zAdd(videosKey(postId), { member: videoId, score: Date.now() })
    await redis.expire(videosKey(postId), KEY_TTL_SECONDS)
    return true
}

/**
 * add the video links paragraph in a RTJSON document's block list, right before the horizontal rule that separates the tables from the footer.
 * replaces the old youtube links paragraph if there's one
 */
export function addYouTubeLinks(document: unknown[], videoIds: string[]): unknown[] {
    const paragraphBlock = JSON.parse(buildYouTubeLinksParagraph(videoIds).build()).document[0]
    const hrIndex = document.findIndex(node => (node as { e?: string }).e === "hr")
    const insertIndex = hrIndex === -1 ? document.length : hrIndex

    const doc = [...document]
    // the YouTube links paragraph always sits right before the horizontal rule: if the block there is ours, replace it in place.
    // inserting at insertIndex after removing the old paragraph would land after the rule, which has shifted left
    if (insertIndex > 0 && isYouTubeLinksParagraph(doc[insertIndex - 1])) {
        doc.splice(insertIndex - 1, 1, paragraphBlock)
    } else {
        doc.splice(insertIndex, 0, paragraphBlock)
    }
    return doc
}

/** check whether an RTJSON block is the YouTube links paragraph */
function isYouTubeLinksParagraph(node: unknown): boolean {
    // the youtube links paragraph is the one where the first text node is its header
    const firstChild = (node as { c?: { t?: unknown }[] })?.c?.[0]
    return (node as { e?: string })?.e === "par" && typeof firstChild?.t === "string" && firstChild.t.startsWith("YouTube links:")
}

/** what became of a clear request, mapped to a toast by the menu route */
export type ClearResult = "cleared" | "nothing" | "no-rtjson" | "edit-failed"

/**
 * remove every YouTube link collected on a post from our scorepost comment, without deleting the comment:
 * the post's video list is emptied and the YouTube links paragraph is stripped from the comment by editing it
 */
export async function clearYouTubeLinks(comment: Pick<Comment, "postId" | "edit">): Promise<ClearResult> {
    const postId = comment.postId

    // no stored RTJSON means the key expired (or we never commented on this post?): nothing to strip the paragraph from
    const storedRichtext = await redis.get(rtjsonKey(postId))
    if (!storedRichtext) return "no-rtjson"

    const document = JSON.parse(storedRichtext).document
    const cleared = (document as unknown[]).filter(node => !isYouTubeLinksParagraph(node))

    // nothing to clear when the comment has no links paragraph and no collected videos to rebuild it from
    const videos = await redis.zRange(videosKey(postId), 0, -1)
    if (cleared.length === document.length && videos.length === 0) return "nothing"

    // clear the video list first: if the edit below fails, the next video link rebuilds the paragraph from the (now empty) list anyway
    await redis.del(videosKey(postId))
    await storeCommentRichtext(postId, JSON.stringify({ document: cleared }))

    try {
        await comment.edit({ richtext: { document: cleared } })
    } catch (err) {
        console.error(`Failed to strip the YouTube links from the scorepost comment on ${postId}:`, err)
        return "edit-failed"
    }

    console.log(`Cleared the YouTube links from the scorepost comment on ${postId}`)
    return "cleared"
}
