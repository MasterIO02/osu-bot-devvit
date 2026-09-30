import type { CommentV2 } from "@devvit/web/shared"
import { processVideoLinks } from "./video_links/process_video_links"

/**
 * process a comment created in the subreddit
 */
export async function processComment(comment: CommentV2) {
    await processVideoLinks(comment)
}
