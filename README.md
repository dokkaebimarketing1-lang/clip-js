# ClipJS — Higgsfield + Storyboard + Remotion fork

A browser video editor built with Next.js, React, Remotion, IndexedDB and FFmpeg.wasm. This fork adds a fail-closed production workflow for Higgsfield-generated media and a frame-accurate server renderer.

## Added in this fork

- Storyboard-v2 JSON import/export with deterministic SHA-256 hash and owner-only server HMAC approval
- Approval invalidation whenever a different storyboard is imported
- Higgsfield clip, START/END frame, storyboard sheet and audio/SFX provenance
- Automatic SFX placement at the mapped storyboard cut/shot time
- Persistent project JSON (`*.clipjs.json`)
- Official `@remotion/captions` SRT parsing plus a bounded dialogue/effect/variety Caption Registry
- Self-hosted Noto Sans KR Variable rendering with deterministic word timing and font-load gating
- Frame-accurate native transitions plus Remotion Dreamy Zoom, Film Burn and Linear Blur
- MIT gl-transitions-derived Ripple, Crosswarp, Dissolve and Cross Zoom through Remotion's WebGL2 presentations
- Timeline-bounded official Remotion Blur, Chromatic Aberration, Vignette, Film Noise, Pixelate and Glow effects
- Media playback speed from 0.1× to 4×
- One pure Remotion Composition shared by editor preview and final render
- Server-side H.264/AAC MP4 rendering through `@remotion/renderer`
- One canonical Remotion export path; the legacy FFmpeg renderer is not exposed by the editor
- Agent preview API plus owner-token-gated Apply with stale-change protection
- SSRF protection, including private-IP/DNS checks and a production media-host allowlist
- Production bearer-token protection
- HMAC-signed 10-minute render downloads and bounded render resources
- Hell Grind-inspired Asset Registry V2, scene continuity locks, structured shot prompt compiler and generation Take Ledger
- Owner approval binds both the storyboard and exact production manifest hash

## Installation

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run dev` first creates `remotion-bundle/`, then starts Next.js at <http://localhost:3000>. The first server render downloads Remotion's Chrome Headless Shell.

Production:

```bash
npm run test
npm run type-check
npm run build
CLIPJS_AGENT_TOKEN='a-long-random-secret' \
CLIPJS_APPROVAL_TOKEN='a-different-owner-only-secret' \
CLIPJS_MEDIA_HOSTS='assets.higgsfield.ai,*.cloudfront.net' \
npm start
```

## Workflow

1. The user chooses the video topic and core concept.
2. Produce the cut-by-cut storyboard-v2 document and exact storyboard sheets.
3. Import the approved JSON from [`docs/storyboard-example.json`](docs/storyboard-example.json).
4. Build the production blueprint: lock stress-tested asset states, scene geometry/lighting, and structured shot specs.
5. Preview the deterministically compiled prompt, then click **Approve exact version**. Any storyboard or production-manifest change invalidates approval.
6. Generate the approved shots with Higgsfield/Seedance, record each take and import accepted HTTPS result URLs.
7. Import Korean SRT captions and SFX/audio, then add transitions and timeline-bounded effects.
8. Preview with the same Composition used by the final renderer.
9. Render. The endpoint refuses an unapproved or modified storyboard/production manifest.

### Caption Registry

The browser Player and server renderer share these deterministic presets in `ProjectComposition`:

- Dialogue: clean, speaker label, cinematic
- Effect: word highlight, karaoke, typewriter, bounce, glow, impact
- Variety: sticker, shock, shake, reaction, thought bubble, name tag, quote card

Caption specs allow only a registered kind/preset pair, position, `0..1` intensity, six-digit accent color and cue-bounded word timings. Arbitrary CSS, fonts and animation code are not accepted. Noto Sans KR Variable is bundled locally from `@fontsource-variable/noto-sans-kr` and rendering fails closed if the font cannot load.

Local IndexedDB media remains available to the FFmpeg.wasm exporter. The server Remotion renderer intentionally requires persistent public HTTPS URLs so a local object URL cannot silently produce a broken server render.

## Agent API

See [`docs/agent-api.md`](docs/agent-api.md). Mutations always follow:

```text
preview command → show summary/proposed project → user approves exact token → apply
```

Rendering is the separate `POST /api/render` endpoint and retains the storyboard approval gate.

## Quality gates

```bash
npm test          # Vitest domain tests
npm run type-check
npm run build     # Remotion prebundle + Next production build
```

## Security and deployment

- Set distinct `CLIPJS_AGENT_TOKEN` and `CLIPJS_APPROVAL_TOKEN` values in every environment; final render requests require both credentials.
- Authentication fails closed by default, including development. For an isolated loopback-only demo, `CLIPJS_ALLOW_INSECURE_LOCALHOST=true` explicitly enables tokenless local API access; never expose that mode on a network interface.
- Rendering is intended for a self-hosted Node server. Remotion does not support placing `@remotion/bundler` inside a Next API route, so this project prebundles the Composition during build.
- The self-hosted renderer requires `ffprobe` on `PATH` (or `CLIPJS_FFPROBE_PATH`) and rejects staged audio/video whose actual streams do not match the declared media kind.
- For Vercel/cloud rendering, replace the local renderer with Remotion Lambda or the official Remotion-on-Vercel architecture.
- Review the [Remotion license](https://www.remotion.dev/license) for your organization size and usage.
- `gl-transitions` is MIT-licensed; the selected shaders are rendered through Remotion's maintained WebGL2 presentation wrappers.
- `@remotion/captions` declares MIT; Noto Sans KR is bundled under OFL-1.1.
- The upstream ClipJS code and this fork remain subject to the repository's MIT license.

## Upstream editor features

- Multi-track video, audio, image and text timeline
- Trim, split, duplicate and layer controls
- Remotion real-time preview
- IndexedDB local project/media storage
- FFmpeg.wasm 1080p export
- Keyboard shortcuts

Upstream: <https://github.com/mohyware/clip-js>
