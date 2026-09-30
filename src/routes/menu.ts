import { Hono } from "hono"
import type { MenuItemRequest, UiResponse } from "@devvit/web/shared"
import { reddit } from "@devvit/web/server"
import { clearYouTubeLinks } from "../core/video_links/process_video_links"

export const menu = new Hono()

menu.post("/clear-youtube-links", async c => {
    const input = await c.req.json<MenuItemRequest>()
    const toast = (text: string) => c.json<UiResponse>({ showToast: text }, 200)

    if (input.location !== "comment" || !input.targetId.startsWith("t1_")) {
        return toast("This action can only be used on comments.")
    }

    try {
        // the menu item appears on every comment in the subreddit: only act on the bot's own scorepost comment
        // this is a reddit limitation, we can't scope mod actions to the bot's comments
        const comment = await reddit.getCommentById(input.targetId as `t1_${string}`)
        const appUser = await reddit.getAppUser()
        if (!appUser || comment.authorId !== appUser.id) {
            return toast("This isn't the bot's scorepost comment.")
        }

        const result = await clearYouTubeLinks(comment)
        if (result === "cleared") return toast("Cleared the YouTube links from the scorepost comment.")
        if (result === "nothing") return toast("The scorepost comment has no YouTube links.")
        if (result === "no-rtjson") return toast("Couldn't clear: this comment's data is no longer stored (it may be too old).")
        return toast("Failed to edit the scorepost comment. Please try again.")
    } catch (err) {
        console.error("Couldn't clear the YouTube links from the scorepost comment:", err)
        return toast("Something went wrong while clearing the YouTube links.")
    }
})
