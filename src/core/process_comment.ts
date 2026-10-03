import type { CommentV2 } from "@devvit/web/shared"
import { processVideoLinks } from "./video_links/process_video_links"
import { redis } from "@devvit/redis"
import { COMMENT_KEY_TTL_SECONDS, commentRtjsonKey } from "./video_links/consts"

/**
 * process a comment created in the subreddit
 */
export async function processComment(comment: CommentV2) {
    await processVideoLinks(comment)
}

/** load the stored RTJSON document of our comment on a post, undefined when it was never stored (or expired) */
export async function loadCommentRichtext(postId: string): Promise<string | undefined> {
    return redis.get(commentRtjsonKey(postId))
}

/** store (or update) the RTJSON document of our comment on a post */
export async function storeCommentRichtext(postId: string, richtext: string): Promise<void> {
    await redis.set(commentRtjsonKey(postId), richtext, { expiration: new Date(Date.now() + COMMENT_KEY_TTL_SECONDS * 1000) })
}
