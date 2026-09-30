import { RichTextBuilder } from "@devvit/web/server"
import { BOLD, fmt } from "../rtjson"

/**
 * build the "YouTube links" paragraph on its own.
 * used when editing an already-posted comment to add the paragraph in front of the footer
 * the links are numbered: [1], [2], ... linking to https://youtu.be/<id>
 */
export function buildYouTubeLinksParagraph(videoIds: string[]): RichTextBuilder {
    const builder = new RichTextBuilder()
    builder.paragraph(p => {
        const header = "YouTube links:"
        p.text({ text: header, formatting: [fmt(BOLD, 0, header.length)] })
        p.text({ text: " " })
        videoIds.forEach((videoId, i) => {
            if (i > 0) p.text({ text: " " })
            // the old bot also put the video's title and channel in the link tooltip, but RTJSON tooltips don't work (see README limitations)
            // also that spares us youtube api requests
            p.link({ text: `[${i + 1}]`, url: `https://youtu.be/${videoId}` })
        })
    })
    return builder
}
