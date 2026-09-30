/**
 * matches a YouTube video URL in a comment body, capturing the video ID
 */
export const youtubeUrlRegex = /https?:\/\/(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/))([\w-]+)/i
