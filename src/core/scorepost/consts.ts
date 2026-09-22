/** user agent for external requests to APIs */
export const USER_AGENT = "Reddit u/osu-bot via Devvit (+https://github.com/MasterIO02/osu-bot-devvit)"

/** timeout for external API requests, so a hung fetch can't stall a whole trigger */
export const REQUEST_TIMEOUT_MS = 10_000

/** first-pass regex to make sure the post title is an osu! scorepost */
export const isScorepostRegex = /.+[|丨].+-.+\[.+\]/

/** mode tokens that can follow "osu!" in a leading mode tag, longest first */
const modeTagTokens = "mania|taiko|catch|ctb|standard|std|m|t"

/**
 * matches a leading unbracketed mode tag that is its own pipe-separated segment, like "osu!mania | player | map" or "o!m | player | map".
 * the segment requirement distinguishes the tag from prose that merely starts with "osu!".
 */
export const modeTagRegex = new RegExp(`^(?:osu!|o!)(?:${modeTagTokens})?\\s*[|丨]`, "i")

/**
 * matches the player username.
 * two kinds of leading tags are stripped when they hide the player:
 * - a bracketed tag (mode tags like "[osu!taiko]", or "[History]"-style tags), but only when actual player content follows it (the lookahead), so a username that is itself entirely bracketed like "[Karcher]" is kept intact
 * - an unbracketed mode tag, but only when it is its own pipe-separated segment (see modeTagRegex)
 */
export const playerRegex = new RegExp(`^(?:(?:\\[[^\\]]*\\]\\s*(?=[^\\s|丨]))|${modeTagRegex.source})?(.+)[|丨].+-.+\\[.+\\]`, "i")

/**
 * matches the beatmap WITH difficulty.
 * the difficulty bracket is matched as a balanced group allowing one nesting level (mania key modes like "[[4K] NSV VIP]"),
 * and the lazy quantifiers stop at the first bracket after the pipe instead of swallowing later brackets
 * from mapper credits or trailing commentary (like "[Diff] ([Mapper], 9*) ... [comment]")
 */
export const beatmapRegex = /.+[|丨](.+?-.+?\[(?:[^\[\]]|\[[^\]]*\])*\])/

/** matches the accuracy (any number before "%") */
export const accRegex = /(\d{1,3}(?:[\.,]\d+)?)%/

/** matches anything between parenthesis */
export const parenthesisRegex = /\((.+?)\)/

/** matches anything between brackets */
export const bracketsRegex = /\[(.+?)\]/

/** matches everything after player + beatmap + difficulty (finds the same difficulty bracket as beatmapRegex) */
export const tailRegex = /.+[\|丨].+?-.+?\[(?:[^\[\]]|\[[^\]]*\])*\](.+)/

/** matches if the scorepost is on scorev2, shouldn't be necessary when lazer becomes the only game client */
export const scoreV2Regex = /SV2|SCOREV2/gi

/** memes for the footer of the comments we post */
export const memes = [
    "pls enjoy gaem",
    "play more",
    "Ye XD",
    "imperial dead bicycle lol",
    "nice pass ecks dee",
    "kirito is legit",
    "can just shut up",
    "thank mr monstrata",
    "fc cry thunder and say that me again",
    "omg kappadar big fan",
    "reese get the camera",
    "cookiezi hdhr when",
    "hello there",
    "rrtyui :(",
    "0 pp if unranked",
    "these movements are from an algorithm designed in java",

    // suggested by u/Lettalosudroid
    "quit w",
    "permazoomer",
    "Cookiezi did it in 1485",
    "if fc (if ranked (if submitted))",
    "Blame top left",
    "Should have doubletapped",
    "Welcome to the new area",
    "When you see it",

    // suggested by u/Comfortable-Chip-740
    "what oh my god 😱 it's a stop sign 🛑 finding nemo 🐡 gold fish 🐠 Dory 🐟 NATIONAL GEOGRAPHIC 🟨 GODDAMN IT",
    "unironically cheating",
    "YIPPEEE",
    "check him hold times",

    // suggested by u/Chibu68_
    "check him pc",
    "I showed osu! to a girl at work",

    // suggested by u/helium1337
    "one of the best players in the world and spare",

    // suggested by u/nnamqahc_4821
    "tied with united",
    "see you next time",
    "infinite stamina",
    "ONE THOUSAND PP, what a time to be alive",
    "Azer isn't so great? Are you kidding me?"
]
