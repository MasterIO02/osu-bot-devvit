import { makeFormatting } from "@devvit/shared-types/richtext/elements.js"
import { FormatRange } from "@devvit/web/server"

/**
 * shared RTJSON functions
 */

// formatting flag constants from the RTJSON spec
export const BOLD = 1
export const SUPERSCRIPT = 32

/** helper to create a FormatRange for RTJSON text formatting */
export function fmt(flags: number, start: number, length: number): FormatRange {
    const opts: { bold?: boolean; superscript?: boolean; startIndex: number; length: number } = { startIndex: start, length }
    if (flags & BOLD) opts.bold = true
    if (flags & SUPERSCRIPT) opts.superscript = true
    return makeFormatting(opts)
}
