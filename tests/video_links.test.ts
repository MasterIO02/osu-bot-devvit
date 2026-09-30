import { describe, it, expect, vi, beforeEach } from "vitest"
import { addYouTubeLinks, clearYouTubeLinks } from "../src/core/video_links/process_video_links"
import { youtubeUrlRegex } from "../src/core/video_links/consts"
import { processComment } from "../src/core/process_comment"
import { redis } from "@devvit/redis"
import { reddit } from "@devvit/web/server"
import type { CommentV2 } from "@devvit/web/shared"

// in-memory redis state shared with the mocked @devvit/redis (hoisted so the vi.mock factory can use it)
const state = vi.hoisted(() => ({
    strings: new Map<string, string>(),
    zsets: new Map<string, { member: string; score: number }[]>()
}))

vi.mock("@devvit/redis", () => ({
    redis: {
        get: vi.fn(async (key: string) => state.strings.get(key)),
        set: vi.fn(async (key: string, value: string) => {
            state.strings.set(key, value)
        }),
        zScore: vi.fn(async (key: string, member: string) => state.zsets.get(key)?.find(e => e.member === member)?.score),
        zAdd: vi.fn(async (key: string, entry: { member: string; score: number }) => {
            const zset = state.zsets.get(key) ?? []
            if (!zset.some(e => e.member === entry.member)) zset.push(entry)
            state.zsets.set(key, zset)
        }),
        zRange: vi.fn(async (key: string) => [...(state.zsets.get(key) ?? [])].sort((a, b) => a.score - b.score)),
        del: vi.fn(async (key: string) => {
            state.zsets.delete(key)
            state.strings.delete(key)
        }),
        expire: vi.fn(async () => {})
    }
}))

const editMock = vi.hoisted(() => vi.fn())

vi.mock("@devvit/web/server", async importOriginal => {
    const actual = await importOriginal<typeof import("@devvit/web/server")>()
    return {
        ...actual,
        reddit: {
            getAppUser: vi.fn(async () => ({ id: "t2_bot", username: "osu-bot" })),
            getComments: vi.fn(() => ({ all: async () => [{ id: "t1_own", authorId: "t2_bot", edit: editMock }] }))
        }
    }
})

/** a minimal scorepost comment RTJSON document: content, horizontal rule, footer */
function makeStoredDocument() {
    return {
        document: [{ e: "par", c: [{ t: "map header and tables" }] }, { e: "hr" }, { e: "par", c: [{ t: "footer" }] }]
    }
}

function makeComment(body: string, overrides: Partial<CommentV2> = {}): CommentV2 {
    return { id: "t1_new", parentId: "t3_post1", postId: "t3_post1", author: "somebody", body, ...overrides } as CommentV2
}

/** the YouTube links paragraph block inside a spliced document (the paragraph right before the hr) */
function youtubeParagraph(doc: { document: unknown[] }) {
    const idx = doc.document.findIndex((n: any) => n.e === "hr")
    return idx > 0 ? (doc.document[idx - 1] as any) : null
}

/** the link nodes of the YouTube links paragraph */
function youtubeLinks(paragraph: any) {
    return paragraph?.c?.filter((n: any) => n.e === "link") ?? []
}

beforeEach(() => {
    state.strings.clear()
    state.zsets.clear()
    editMock.mockReset()
    vi.mocked(redis.set).mockClear()
    vi.mocked(redis.zAdd).mockClear()
    vi.mocked(redis.expire).mockClear()
    vi.mocked(redis.del).mockClear()
})

describe("addYouTubeLinks", () => {
    it("inserts the paragraph right before the horizontal rule", () => {
        const stored = makeStoredDocument()
        const doc = addYouTubeLinks(stored.document, ["dQw4w9WgXcQ"]) as any[]
        expect(doc[0]).toEqual({ e: "par", c: [{ t: "map header and tables" }] })
        expect(doc[1].e).toBe("par")
        expect(doc[1].c[0].t).toBe("YouTube links:")
        expect(doc[1].c[1]).toEqual({ e: "text", t: " " })
        expect(doc[2]).toEqual({ e: "hr" })
        expect(doc[3]).toEqual({ e: "par", c: [{ t: "footer" }] })
    })

    it("numbers the links in video order", () => {
        const doc = addYouTubeLinks(makeStoredDocument().document, ["dQw4w9WgXcQ", "abcdefghijk"])
        const links = youtubeLinks(youtubeParagraph({ document: doc }))
        expect(links.map((l: any) => l.t)).toEqual(["[1]", "[2]"])
        expect(links.map((l: any) => l.u)).toEqual(["https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/abcdefghijk"])
    })

    it("replaces an existing YouTube links paragraph in place, before the horizontal rule", () => {
        const first = addYouTubeLinks(makeStoredDocument().document, ["dQw4w9WgXcQ"])
        const second = addYouTubeLinks(first, ["dQw4w9WgXcQ", "abcdefghijk"]) as any[]
        const withHeader = second.filter(n => n.e === "par" && typeof n.c[0]?.t === "string" && n.c[0].t.startsWith("YouTube links:"))
        expect(withHeader).toHaveLength(1)
        expect(withHeader[0].c.map((n: any) => n.t)).toEqual(["YouTube links:", " ", "[1]", " ", "[2]"])
        // the paragraph stays right before the horizontal rule
        expect(second[second.findIndex(n => n.e === "hr") - 1]).toBe(withHeader[0])
    })

    it("appends at the end when the document has no horizontal rule", () => {
        const doc = addYouTubeLinks([{ e: "par", c: [{ t: "content" }] }], ["dQw4w9WgXcQ"]) as any[]
        expect(doc).toHaveLength(2)
        expect(doc[1].c[0].t).toBe("YouTube links:")
    })

    it("does not mutate the input document", () => {
        const stored = makeStoredDocument()
        addYouTubeLinks(stored.document, ["dQw4w9WgXcQ"])
        expect(stored.document).toHaveLength(3)
    })
})

describe("processComment", () => {
    it("adds the linked video to the scorepost comment and stores the updated document", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))

        await processComment(makeComment("look at this https://youtu.be/dQw4w9WgXcQ"))

        expect(editMock).toHaveBeenCalledTimes(1)
        const edited = vi.mocked(editMock).mock.calls[0]![0] as any
        const links = youtubeLinks(youtubeParagraph(edited.richtext))
        expect(links.map((l: any) => l.u)).toEqual(["https://youtu.be/dQw4w9WgXcQ"])
        // the stored document and the video list are written with a TTL, so the keys don't outlive the post's relevance
        expect(vi.mocked(redis.set)).toHaveBeenCalledWith("comment-rtjson:t3_post1", expect.any(String), expect.objectContaining({ expiration: expect.any(Date) }))
        expect(vi.mocked(redis.zAdd)).toHaveBeenCalledWith("comment-videos:t3_post1", { member: "dQw4w9WgXcQ", score: expect.any(Number) })
        expect(vi.mocked(redis.expire)).toHaveBeenCalledWith("comment-videos:t3_post1", 7 * 24 * 60 * 60)
        // the stored document is updated too, so the next link splices onto this version
        const stored = JSON.parse(state.strings.get("comment-rtjson:t3_post1")!)
        expect(youtubeLinks(youtubeParagraph(stored)).map((l: any) => l.u)).toEqual(["https://youtu.be/dQw4w9WgXcQ"])
    })

    it("numbers a second video after the first", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))

        await processComment(makeComment("https://youtu.be/dQw4w9WgXcQ"))
        await processComment(makeComment("https://www.youtube.com/watch?v=abcdefghijk"))

        expect(editMock).toHaveBeenCalledTimes(2)
        const edited = vi.mocked(editMock).mock.calls[1]![0] as any
        const links = youtubeLinks(youtubeParagraph(edited.richtext))
        expect(links.map((l: any) => l.t)).toEqual(["[1]", "[2]"])
    })

    it("ignores the same video posted again", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))

        await processComment(makeComment("https://youtu.be/dQw4w9WgXcQ"))
        await processComment(makeComment("https://www.youtube.com/watch?v=dQw4w9WgXcQ lol"))

        expect(editMock).toHaveBeenCalledTimes(1)
    })

    it("ignores comments that are replies, not top-level", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))

        await processComment(makeComment("https://youtu.be/dQw4w9WgXcQ", { parentId: "t1_other" }))

        expect(editMock).not.toHaveBeenCalled()
    })

    it("ignores comments without a youtube link", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))

        await processComment(makeComment("sick play dude"))

        expect(editMock).not.toHaveBeenCalled()
    })

    it("ignores our own comment", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))

        await processComment(makeComment("YouTube links: [1](https://youtu.be/dQw4w9WgXcQ)", { author: "osu-bot" }))

        expect(editMock).not.toHaveBeenCalled()
        // the video wasn't added to the post's list either
        expect(state.zsets.has("comment-videos:t3_post1")).toBe(false)
    })

    it("ignores posts we never commented on", async () => {
        await processComment(makeComment("https://youtu.be/dQw4w9WgXcQ", { postId: "t3_other", parentId: "t3_other" }))

        expect(editMock).not.toHaveBeenCalled()
        expect(vi.mocked(redis.set)).not.toHaveBeenCalled()
    })

    it("keeps the video and updates the stored document but doesn't edit when our comment is gone", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))
        // findOwnComment finds nothing: the bot's comment was deleted or never made it
        vi.mocked(reddit.getComments).mockReturnValueOnce({ all: async () => [] } as any)

        await processComment(makeComment("https://youtu.be/dQw4w9WgXcQ"))

        expect(editMock).not.toHaveBeenCalled()
        // the video stays in the post's list, so the next link rebuilds the paragraph from the full list (the self-healing path)
        expect(state.zsets.get("comment-videos:t3_post1")).toEqual([{ member: "dQw4w9WgXcQ", score: expect.any(Number) }])
        // and the stored document got the paragraph, so the next link splices onto the updated version
        const stored = JSON.parse(state.strings.get("comment-rtjson:t3_post1")!)
        expect(youtubeLinks(youtubeParagraph(stored)).map((l: any) => l.u)).toEqual(["https://youtu.be/dQw4w9WgXcQ"])
    })
})

describe("clearYouTubeLinks", () => {
    /** a bot comment stub with the same postId/edit surface clearYouTubeLinks uses */
    const ownComment = (postId = "t3_post1") => ({ postId, edit: editMock }) as any

    it("empties the video list and strips the paragraph from the comment without deleting it", async () => {
        const withLinks = addYouTubeLinks(makeStoredDocument().document, ["dQw4w9WgXcQ"])
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify({ document: withLinks }))
        state.zsets.set("comment-videos:t3_post1", [{ member: "dQw4w9WgXcQ", score: 1 }])

        const result = await clearYouTubeLinks(ownComment())

        expect(result).toBe("cleared")
        expect(editMock).toHaveBeenCalledTimes(1)
        const edited = vi.mocked(editMock).mock.calls[0]![0] as any
        expect(edited.richtext.document).toEqual(makeStoredDocument().document)
        // the video list is emptied so the next collected link starts a fresh paragraph
        expect(vi.mocked(redis.del)).toHaveBeenCalledWith("comment-videos:t3_post1")
        // and the stored document is updated too, so it stays in sync with the edited comment
        const stored = JSON.parse(state.strings.get("comment-rtjson:t3_post1")!)
        expect(stored.document).toEqual(makeStoredDocument().document)
    })

    it("returns nothing when the comment has no links and no collected videos", async () => {
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify(makeStoredDocument()))

        const result = await clearYouTubeLinks(ownComment())

        expect(result).toBe("nothing")
        expect(editMock).not.toHaveBeenCalled()
    })

    it("returns no-rtjson when the comment's document was never stored (or expired)", async () => {
        const result = await clearYouTubeLinks(ownComment("t3_never"))

        expect(result).toBe("no-rtjson")
        expect(editMock).not.toHaveBeenCalled()
    })

    it("still empties the video list when editing the comment fails", async () => {
        const withLinks = addYouTubeLinks(makeStoredDocument().document, ["dQw4w9WgXcQ"])
        state.strings.set("comment-rtjson:t3_post1", JSON.stringify({ document: withLinks }))
        state.zsets.set("comment-videos:t3_post1", [{ member: "dQw4w9WgXcQ", score: 1 }])
        editMock.mockRejectedValueOnce(new Error("edit failed"))

        const result = await clearYouTubeLinks(ownComment())

        expect(result).toBe("edit-failed")
        // the list was emptied first, so the paragraph can't come back on the next collected link
        expect(vi.mocked(redis.del)).toHaveBeenCalledWith("comment-videos:t3_post1")
    })
})

describe("youtubeUrlRegex", () => {
    it("matches youtu.be links", () => {
        expect(youtubeUrlRegex.exec("https://youtu.be/dQw4w9WgXcQ")?.[1]).toBe("dQw4w9WgXcQ")
    })

    it("matches youtube.com watch links", () => {
        expect(youtubeUrlRegex.exec("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.[1]).toBe("dQw4w9WgXcQ")
    })

    it("matches m. host", () => {
        expect(youtubeUrlRegex.exec("https://m.youtube.com/watch?v=dQw4w9WgXcQ")?.[1]).toBe("dQw4w9WgXcQ")
    })

    it("rejects music. host", () => {
        expect(youtubeUrlRegex.test("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false)
    })

    it("matches shorts links", () => {
        expect(youtubeUrlRegex.exec("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.[1]).toBe("dQw4w9WgXcQ")
    })

    it("matches with query params around the video id", () => {
        expect(youtubeUrlRegex.exec("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s")?.[1]).toBe("dQw4w9WgXcQ")
        expect(youtubeUrlRegex.exec("https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ")?.[1]).toBe("dQw4w9WgXcQ")
        expect(youtubeUrlRegex.exec("https://youtu.be/dQw4w9WgXcQ?feature=share")?.[1]).toBe("dQw4w9WgXcQ")
    })

    it("extracts IDs from URLs wrapped in markdown by reddit", () => {
        // reddit (new web client) autolinks bare URLs into [url](url) markdown in the stored body
        expect(youtubeUrlRegex.exec("[https://www.youtube.com/watch?v=dQw4w9WgXcQ](https://www.youtube.com/watch?v=dQw4w9WgXcQ)")?.[1]).toBe("dQw4w9WgXcQ")
        expect(youtubeUrlRegex.exec("[https://youtu.be/dQw4w9WgXcQ?si=abc](https://youtu.be/dQw4w9WgXcQ?si=abc)")?.[1]).toBe("dQw4w9WgXcQ")
        // markdown links written by the user, and old reddit's angle autolinks
        expect(youtubeUrlRegex.exec("[nice vid](https://youtu.be/dQw4w9WgXcQ) lol")?.[1]).toBe("dQw4w9WgXcQ")
        expect(youtubeUrlRegex.exec("<https://youtu.be/dQw4w9WgXcQ>")?.[1]).toBe("dQw4w9WgXcQ")
    })

    it("captures the first link only", () => {
        const body = "first https://youtu.be/dQw4w9WgXcQ then https://www.youtube.com/watch?v=abcdefghijk"
        expect(youtubeUrlRegex.exec(body)?.[1]).toBe("dQw4w9WgXcQ")
    })

    it("rejects text without a youtube link", () => {
        expect(youtubeUrlRegex.test("nice play man")).toBe(false)
        expect(youtubeUrlRegex.test("check https://osu.ppy.sh/beatmapsets/123")).toBe(false)
    })

    it("rejects similar parameter names", () => {
        expect(youtubeUrlRegex.test("https://www.youtube.com/watch?vi=dQw4w9WgXcQ")).toBe(false)
    })
})
