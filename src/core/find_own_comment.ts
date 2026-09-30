import { reddit, type Comment } from "@devvit/web/server"

/**
 * find a top-level comment on the post authored by the app account, if one exists.
 */
export async function findOwnComment(postId: `t3_${string}`): Promise<Comment | null> {
    try {
        const appUser = await reddit.getAppUser()
        if (!appUser) return null
        // the bot comments within moments of the post's creation, so if its comment exists it's among the oldest: sort "old" with a small limit is enough to find it
        const comments = await reddit.getComments({ postId, depth: 1, limit: 10, sort: "old" }).all()
        return comments.find(c => c.authorId === appUser.id) ?? null
    } catch (err) {
        // a failed check shouldn't block the caller: the trigger's redis claim still guards against concurrent duplicates
        console.error(`Couldn't check for existing comments on ${postId}:`, err)
        return null
    }
}
