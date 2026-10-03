import { RichTextBuilder } from "@devvit/web/server"
import { BOLD, fmt } from "../rtjson"

export const LINK_TEXT = "Video replay of this score"

/**
 * build the o!rdr video heading on its own.
 * used when editing an already-posted comment to add the heading at the top of the document
 */
export function buildVideoHeading(url: string): RichTextBuilder {
    const builder = new RichTextBuilder()
    builder.heading({ level: 1 }, h => {
        h.link({ text: LINK_TEXT, url, formatting: [fmt(BOLD, 0, LINK_TEXT.length)] })
    })
    return builder
}

/** check whether an RTJSON block is the video heading */
export function isVideoHeading(node: unknown): boolean {
    // the video heading is a level-1 heading whose first child is a link with our link text
    const block = node as { e?: string; l?: number; c?: { e?: string; t?: unknown }[] }
    return block?.e === "h" && block.l === 1 && block.c?.[0]?.e === "link" && typeof block.c[0]?.t === "string" && block.c[0].t.startsWith(LINK_TEXT)
}
