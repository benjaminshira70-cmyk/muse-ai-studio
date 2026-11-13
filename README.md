# Muse AI Studio

A tool pack that lets an AI assistant (like Muse) build websites, generate images and videos, and edit videos.
Zero dependencies. Needs Node 18+ and `ffmpeg`.

## Tools

| Tool | What it does |
|---|---|
| `build_website` | Builds a responsive static site (`index.html` + `assets/`, works offline). 5 themes: modern, minimal, bold (dark), elegant (cream), playful. 14 section types: hero, features, stats, steps, logos, gallery, video, team, testimonials, pricing, faq, contact, cta, text |
| `generate_image` | Text to image. Providers: `mock`, `openai`, `replicate` |
| `generate_video` | Text/image to short video. Providers: `mock`, `replicate` |
| `edit_video` | Chain of edits in one call: trim, reframe (16:9 / 9:16 / 1:1), speed, fade, mute, append, **text** (titles/captions), **subtitles** (cues or .srt), **add_audio** (music with loop, fades, start offset, ducking under speech) |
| `video_info` | Duration, resolution, audio check |
| `check_setup` | Diagnoses ffmpeg, fonts, providers and missing API keys (never shows key values). Run it first if something fails |

All files are read and written inside `MUSE_WORKSPACE` only. Paths that try to escape it are rejected, and websites only copy image/video files.

## Use it as an MCP server (Muse, Claude, any MCP client)

```bash
npx -y github:benjaminshira70-cmyk/muse-ai-studio
```

```json
{
  "mcpServers": {
    "muse-ai-studio": {
      "command": "npx",
      "args": ["-y", "github:benjaminshira70-cmyk/muse-ai-studio"],
      "env": {
        "MUSE_WORKSPACE": "/path/to/workspace",
        "MUSE_IMAGE_PROVIDER": "auto",
        "MUSE_VIDEO_PROVIDER": "auto",
        "OPENAI_API_KEY": "...",
        "REPLICATE_API_TOKEN": "...",
        "MUSE_VIDEO_MODEL": "owner/video-model"
      }
    }
  }
}
```

Files go to `MUSE_WORKSPACE` (default `~/muse-workspace`). The machine running the server needs `ffmpeg`.

## Turn on real image and video generation

By default both use offline `mock` placeholders.

**Free option (images only):** set `MUSE_IMAGE_PROVIDER=pollinations`. No key and no cost, but it is rate limited (about one image per 15 seconds), may add a watermark, is meant for light use, and your prompts go to a public service. It is never picked by `auto`. If you get a Pollinations key from enter.pollinations.ai, set `POLLINATIONS_API_KEY` and it uses their official keyed API instead (whether free keys remove the watermark depends on their current plans). There is no free video generation, but all video *editing* is free.

**Paid setup:** OpenAI for images, Replicate for video.

| Setting | What it does |
|---|---|
| `MUSE_IMAGE_PROVIDER` / `MUSE_VIDEO_PROVIDER` | `mock`, `pollinations` (free, image only), `openai` (image only), `replicate`, or **`auto`** (use whichever you have keys for, else mock) |
| `OPENAI_API_KEY` | Real images via OpenAI (model `gpt-image-1`, override with `MUSE_IMAGE_MODEL`) |
| `REPLICATE_API_TOKEN` | One token for Replicate images and videos |
| `MUSE_VIDEO_MODEL` | Replicate video model as `owner/name` (required for video) |
| `MUSE_IMAGE_MODEL` | Replicate image model as `owner/name` (only if images use Replicate) |
| `MUSE_VIDEO_DURATIONS` | Lengths the model accepts, e.g. `4,6,8`. Requested seconds snap to the nearest |
| `MUSE_VIDEO_EXTRA_INPUT` / `MUSE_IMAGE_EXTRA_INPUT` | JSON of extra model options, e.g. `{"resolution":"720p","generate_audio":false}` |

Video models differ in which options they accept. The adapter always sends `prompt`, `duration`, `aspect_ratio` (and `image` when you give one); check your model's API page on Replicate for the rest and add them with `MUSE_VIDEO_EXTRA_INPUT`. If a request is rejected, the error from Replicate is shown as-is.

Keep keys out of chat history and out of git: enter them through your platform's secret/credential prompt, or in a local `.env` (already git-ignored). Then call `check_setup` to confirm nothing is missing. Both providers charge per generation, so set a spend limit in each dashboard.

## Use it in code

```js
import { listTools, callToolSafe } from "./src/index.js";

const tools = listTools("anthropic");            // or "openai"
const out = await callToolSafe(name, input, { workDir: "./workspace" });
// { ok: true, result: {...} } or { ok: false, error: "..." }
```

Add your own tool with `registerTool({ name, description, input_schema, handler })`.

## Develop

```bash
cp .env.example .env
npm test                # 26 tests, run offline
node src/cli.js list    # print tool definitions
node src/cli.js call generate_image '{"prompt":"a red fox"}'
```

Text overlays need an ffmpeg with the `drawtext` filter and a font file. A font is found automatically on Linux, macOS and Termux; otherwise set `MUSE_FONT` to a `.ttf`/`.otf` path. Windows paths are not supported for text overlays yet.

## Status

- Tested offline: registry, MCP protocol, path safety, website builder (all themes and sections), all video edits, mock providers.
- Provider adapters are tested against local fake OpenAI/Replicate servers (request shape, polling, duration snapping, error handling).
- **Not yet run against the live APIs.** Generate one image and one short video with real keys and check the results.
