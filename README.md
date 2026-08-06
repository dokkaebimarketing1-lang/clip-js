# ClipJS — Higgsfield + Storyboard + Remotion fork

A browser video editor built with Next.js, React, Remotion, IndexedDB and FFmpeg.wasm. This fork adds a fail-closed production workflow for Higgsfield-generated media and a frame-accurate server renderer.

## Added in this fork

- Storyboard-v2 JSON import/export with deterministic SHA-256 hash and owner-only server HMAC approval
- Approval invalidation whenever a different storyboard is imported
- Higgsfield clip, START/END frame, storyboard sheet and audio/SFX provenance
- Automatic SFX placement at the mapped storyboard cut/shot time
- Persistent project JSON (`*.clipjs.json`)
- Korean SRT captions with Pretendard/Noto Sans KR-safe rendering and emphasis
- Frame-accurate clip-to-clip fade, wipe, slide, whip-pan, flash, blur, push and zoom transitions
- Media playback speed from 0.1× to 4×
- One pure Remotion Composition shared by editor preview and final render
- Server-side H.264/AAC MP4 rendering through `@remotion/renderer`
- One canonical Remotion export path; the legacy FFmpeg renderer is not exposed by the editor
- Agent preview API plus owner-token-gated Apply with stale-change protection
- SSRF protection, including private-IP/DNS checks and a production media-host allowlist
- Production bearer-token protection
- HMAC-signed 10-minute render downloads and bounded render resources

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
4. Click **Approve exact version**. Any different storyboard import invalidates approval.
5. Generate the approved shots with Higgsfield/Seedance and import their HTTPS result URLs.
6. Import Korean SRT captions, SFX/audio and transitions.
7. Preview with the same Composition used by the final renderer.
8. Render. The endpoint refuses an unapproved or modified storyboard.

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

- Set `CLIPJS_AGENT_TOKEN` in every production environment.
- Rendering is intended for a self-hosted Node server. Remotion does not support placing `@remotion/bundler` inside a Next API route, so this project prebundles the Composition during build.
- For Vercel/cloud rendering, replace the local renderer with Remotion Lambda or the official Remotion-on-Vercel architecture.
- Review the [Remotion license](https://www.remotion.dev/license) for your organization size and usage.
- The upstream ClipJS code and this fork remain subject to the repository's MIT license.

## Upstream editor features

- Multi-track video, audio, image and text timeline
- Trim, split, duplicate and layer controls
- Remotion real-time preview
- IndexedDB local project/media storage
- FFmpeg.wasm 1080p export
- Keyboard shortcuts

Upstream: <https://github.com/mohyware/clip-js>
