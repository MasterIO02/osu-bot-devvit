import { PostV2 } from "@devvit/web/shared"
import { isScorepostRegex } from "./scorepost/consts"
import { processScorepost } from "./scorepost/process_scorepost"

export async function processPost(post: PostV2) {
    const isScorepost = isScorepostRegex.test(post.title)
    if (!isScorepost) return

    console.log(`Detected a scorepost: ${post.title}`)
    await processScorepost(post)
}
