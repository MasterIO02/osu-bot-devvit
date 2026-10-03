/** how long we keep the stored RTJSON and video list for comments */
export const COMMENT_KEY_TTL_SECONDS = 7 * 24 * 60 * 60

/** redis key holding the RTJSON document of the comment we posted on a scorepost */
export const commentRtjsonKey = (postId: string) => `comment:rtjson:${postId}`

/** redis key holding the video IDs linked on a post */
export const commentVideosKey = (postId: string) => `comment:videos:${postId}`

/**
 * matches a YouTube video URL in a comment body, capturing the video ID
 */
export const youtubeUrlRegex = /https?:\/\/(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/))([\w-]+)/i
