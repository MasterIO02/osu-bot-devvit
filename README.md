# osu-bot (Devvit)

Reddit bot for r/osugame that automatically comments on scoreposts with beatmap info, leaderboard stats, and player data.

Built on [Devvit](https://developers.reddit.com/), Reddit's platform for building apps. Replaces the [legacy Python/PRAW bot](https://github.com/christopher-dG/osu-bot).

## What it does

When a scorepost is submitted to r/osugame, the bot:

1. Parses the post title for player name, beatmap, gamemode, accuracy and mods
2. Finds the beatmap by searching the player's recent top plays and fetches other data to show from the osu! API v2. If the beatmap isn't found (e.g. the score is too old to still be in the player's lists), the bot still posts a player-only comment
3. Fetches modded difficulty attributes and PP at multiple accuracies from the [osu-tools API](https://github.com/issoudotbest/osu-tools-api) (issou.best instance)
4. Builds a rich text comment with:
    - **Map header**: beatmap link, mapper link, optional guest mapper (GD), gamemode
    - **Subheader**: #1 leaderboard score (mods, accuracy, pp), max combo, ranked status with year, playcount
    - **Difficulty table**: CS, AR, OD, HP, SR, BPM, Length for NoMod and the modded combination, plus a pp column at 95%, 98%, 99%, 100% and the scorepost's own accuracy
    - **Player table**: global rank, country rank, pp, accuracy, playcount, top play
    - **Footer**: meme + attribution links
5. Posts the comment and pins it (as moderator)

## Mod support

The title parser handles full mod expressions:

- standard acronyms (`+HDDT`, `+HDHR`), spaced (`+ HD DT`) and comma-separated (`+HD,DT`) forms
- mod settings: `+DT(x1.1)` custom rates, `+DA(AR9, OD8.5)` difficulty adjust attributes
- `SCOREV2`/`SV2` normalized to V2, key mods (`1K`–`10K`), and `+NM` (explicit nomod)

Modded difficulty attributes (CS, AR, OD, HP, SR, BPM, Length) and PP at every accuracy are computed by the osu-tools API, so custom rates and difficulty adjust settings are reflected in the table. NoMod PP always comes from the same endpoint; the #1 score's and top play's pp come from the osu! API's `Score.pp`.

Plays done on stable are calculated with the classic mod + legacy total score, so their PP matches the osu! website. Those plays' rows are labeled with the CL mod (`+CL` instead of `NoMod`).

## Capabilities vs. the old Python bot

This new osu-bot is at parity with the old Python bot (with a few caveats).

Beyond the old bot:

- **Full lazer support**: scores done on lazer are supported, along with new mods and mod settings (difficulty adjust, rate change), with calculations done by the [osu-tools API](https://github.com/issoudotbest/osu-tools-api). Running calculations locally with rosu-pp is not easily possible because it compiles to WASM, which Devvit has a hard time running. And local calculation is generally out of date. With osu-tools wrapped, we can use the actual game's calculation and easily update the API when reworks happen, without updating the bot.
- **More robust regexes and title parsing**: rulesets (gamemodes) are more accurately detected, mod settings in titles (like `+DT(x1.1)` rate changes and `+DA(AR9, OD8.5)` attribute overrides)
- **Cleaner and simpler code**: all data comes from the osu! API v2. The old bot scraped user profiles to detect playstyles and inferred guest mappers by parsing `'s` out of difficulty names; the API now exposes beatmap owners directly. Playstyles are no longer shown, since tooltips can't be shown with RTJSON comments (see limitations below).
- **Spaced and comma-separated mods**: the old bot parsed `HD HR` and `HD, HR` as HD only; this bot handles both
- **Parser tested against real titles**: the title parsing (player, beatmap, gamemode, mods) is run against a corpus of ~950 real scorepost titles collected from r/osugame (`tests/scorepost-samples.txt`), so title-format regressions are caught by the test suite instead of in production

TODO: o!rdr implementation

### Limitations

These come from Reddit's RTJSON format and its conversion to markdown on old Reddit, not from this bot:

1. **No tooltips on links**: RTJSON has a field to add tooltips but it doesn't work, not even on old Reddit. So the old bot's hover text (mapper rename, player stats, map attributes) can't be reproduced
2. **Bold breaks on old Reddit**: Reddit's RTJSON -> markdown conversion inserts stray `**` markers between the intended pair, so bold text only renders correctly on new Reddit
3. **Table cells are not centered**: the same conversion breaks table column alignment, so there are no centered cells, they're all aligned to the left

These issues were already reported to Reddit.

## Testing

It will be hard for anyone to test the bot, as Devvit is a platform that's very restrictive.
The bot runs as a microservice on Reddit's own servers, with functions triggered by Reddit events (see [triggers](src/routes/triggers.ts)).

You may need to contact Reddit Devvit support to get domains in the `devvit.json` approved (the osu.ppy.sh domain for the osu! API can be auto-approved, but a self-hosted osu-tools-api domain has to be manually approved by a Reddit admin).

You will also have to change the test subreddit in the `devvit.json` file, and set the app secrets declared in `devvit.json` with your own credentials: `osuClientId` and `osuClientSecret` (from an osu! API v2 client at https://osu.ppy.sh/home/account/edit) and `osuToolsApiKey` (from your own self-hosted instance's key). These can be set with the `npx devvit settings set` command. The domain for osu-tools-api is hardcoded to be `apis.issou.best`, so you should change that.

### Development

```sh
npm install
npm run login        # log in to Reddit via Devvit (once)
npm run dev          # playtest the bot in the test subreddit set in devvit.json
npm test             # run the test suite
npm run type-check   # tsc --build
```

## Contact

You can contact MasterIO about this Reddit bot in the [o!rdr Discord server](https://discord.gg/9PUKa9qBZD) #reddit-osu-bot channel.

## License

BSD-3-Clause, see [LICENSE](LICENSE).
