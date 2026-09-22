import { bracketsRegex, parenthesisRegex, modeTagRegex } from "../consts"
import { Gamemode } from "../../requests/osu_api"

const matchableGamemodes: {
    gamemode: Gamemode
    matchable: string
}[] = [
    // non-osu game modes must come first so that "osu!mania" matches mania
    // before the bare "osu!" substring could match it as osu standard.

    { gamemode: "mania", matchable: "osu!mania" },
    { gamemode: "mania", matchable: "osu!m" },
    { gamemode: "mania", matchable: "o!mania" },
    { gamemode: "mania", matchable: "mania" },
    { gamemode: "mania", matchable: "o!m" },

    { gamemode: "taiko", matchable: "osu!taiko" },
    { gamemode: "taiko", matchable: "osu!t" },
    { gamemode: "taiko", matchable: "o!taiko" },
    { gamemode: "taiko", matchable: "taiko" },
    { gamemode: "taiko", matchable: "o!t" },

    { gamemode: "fruits", matchable: "osu!catch" },
    { gamemode: "fruits", matchable: "osu!ctb" },
    { gamemode: "fruits", matchable: "o!catch" },
    { gamemode: "fruits", matchable: "o!ctb" },
    { gamemode: "fruits", matchable: "catch" },
    { gamemode: "fruits", matchable: "ctb" },

    { gamemode: "osu", matchable: "osu!standard" },
    { gamemode: "osu", matchable: "osu!std" },
    { gamemode: "osu", matchable: "standard" },
    { gamemode: "osu", matchable: "o!std" },
    { gamemode: "osu", matchable: "std" },
    { gamemode: "osu", matchable: "osu" } // just in case
]

/**
 * @description try to match the gamemode of the scorepost title. if none, return osu (standard)
 */
export function matchGamemode(title: string): Gamemode {
    // a leading unbracketed mode tag ("osu!mania | player | map") could live in the first pipe segment
    if (modeTagRegex.test(title)) {
        const tag = title.split(/[|丨]/)[0]!.trim().toLowerCase()
        for (const { gamemode, matchable } of matchableGamemodes) {
            if (tag.includes(matchable)) return gamemode
        }
    }

    const bracketMatch = bracketsRegex.exec(title)
    const parenthesisMatch = parenthesisRegex.exec(title)
    const bracketContent = bracketMatch?.[1]?.toLowerCase()
    const parenthesisContent = parenthesisMatch?.[1]?.toLowerCase()

    for (const { gamemode, matchable } of matchableGamemodes) {
        // the bracket/parenthesis content must be the alias itself
        if (bracketContent === matchable) return gamemode
        if (parenthesisContent === matchable) return gamemode
    }

    return "osu"
}
