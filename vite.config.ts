import { defineConfig } from "vitest/config"
import { devvit } from "@devvit/start/vite"

export default defineConfig({
    plugins: [devvit()],
    test: {
        exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/reference/**"]
    }
})
