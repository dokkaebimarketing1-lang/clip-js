# ClipJS — Seedance 2.5 production and post-production

ClipJS is a Next.js 16 / React 19 / Remotion editor that combines the original Seedance 28-axis directing logic with BytePlus ModelArk's official Seedance 2.5 API. The builder decides creative direction; ClipJS owns projects, approvals, jobs, assets, Takes, timeline edits, post-production and rendering.

```text
Original 28-axis builder  -> directing rules and deterministic prompt blocks
ClipJS                    -> durable project, authorization, jobs, assets, QC, edit and render
BytePlus ModelArk          -> Seedance 2.5 generation provider
```

The original HTML builder is **not** embedded in an iframe and does not maintain a parallel state system. Its 28 axis IDs, `requires` rules, five task classifications and prompt-block order are represented as typed, tested ClipJS data. Provider model names, endpoints, authentication and supported request fields come only from official BytePlus documentation.

## Safety model

Four approvals have different meanings and signatures:

1. **Creative approval** — the current storyboard.
2. **GenerationAuthorization** — `projectId + attemptId + canonical requestHash` for one exact provider request.
3. **Take approval** — `takeId + generatedAssetId + contentSha256` after QC.
4. **ReleaseApproval** — the complete semantic render snapshot.

Changing the storyboard invalidates all downstream approvals. Changing immutable generation input invalidates generation and release approvals. Adding a Take or changing timeline, captions, effects, text, post-production or export settings invalidates only ReleaseApproval.

A provider task is never submitted before an atomic `SubmissionClaim`. The same provider-scoped `projectId + attemptId + requestHash` can reach provider submission at most once. Network timeouts, response loss and receipt-write failure become `uncertain`; they are never automatically resubmitted. Recovery stays disabled until an authoritative provider-side receipt lookup is available.

## Seedance 2.5 official request policy

- BytePlus endpoint: `https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`
- Model candidate: `dreamina-seedance-2-5-260628` (account entitlement must be confirmed before a paid canary)
- Resolution: `480p` or `720p`
- Duration: 4–30 seconds; the first ClipJS paid slice is restricted to 20 or 30 seconds
- Reference-to-video: up to 30 images, 10 videos and 10 audio files, maximum 50 total
- Seedance 2.5 supports pure-audio reference input
- Direct real-person image/video references are blocked unless the asset came through an official private portrait solution
- Unsupported legacy fields such as `seed`, `camera_fixed`, Higgsfield CLI flags and `doubao-*` model IDs are never emitted
- Generated source footage must contain no readable text, numbers, logos, UI or watermark; exact Korean dialogue, captions, app UI, branding and CTA are composed in ClipJS

Result transport URLs are temporary and are not asset identity. The generation worker begins server-side ingest as soon as the provider reports success. Downloads are HTTPS-only, host-allowlisted, DNS-resolved and IP-pinned again on every redirect, byte-capped by both `Content-Length` and streaming count, magic-byte checked, probed with `ffprobe`, decode-smoked with `ffmpeg`, hashed and committed to the GeneratedAssetStore.

## Durable pipeline

```text
Storyboard
-> Production Blueprint
-> 28-axis Seedance settings
-> Creative approval
-> canonical BytePlus request preview
-> GenerationAuthorization
-> atomic SubmissionClaim
-> provider submit at most once
-> lease worker polling
-> provider_succeeded -> ingesting -> ready
-> qc_pending Take
-> signed Take approval
-> IndexedDB transaction commit
-> Redux projection
-> one timeline placement
-> Korean dialogue / ambience / SFX / optional BGM / captions / verified app UI / ending card
-> ReleaseApproval
-> durable RenderJob
-> dedicated Remotion worker
-> H.264 MP4
```

Provider polling and ingest never run in a GET route. Generation status GET routes are read-only projections of the server repository. `POST /api/render` validates and enqueues a durable RenderJob, returns HTTP 202, and never starts Chrome or ffmpeg in the request lifecycle.

## Project persistence

Project document schema and IndexedDB schema have independent versions. All ingress follows:

```text
unknown -> versioned migration -> strict validation
```

Legacy project bytes are backed up before migration. Legacy single approvals and incomplete pre-authorization generation approvals are invalidated. Multi-tab writes use Web Locks when available plus IndexedDB revision/CAS. `ProjectSaveCoordinator` reports failures to the UI instead of claiming success. Take import performs an IndexedDB read-modify-write transaction first and updates Redux only after commit acknowledgement.

Media placement IDs are separate from binary IDs:

```text
MediaFile.id                    timeline placement
MediaFile.source.fileId         IndexedDB local binary
MediaFile.source.generatedAssetId server GeneratedAsset
GenerationTake.id               QC candidate
providerJobId                   provider receipt
contentSha256                   immutable binary identity
```

## Post-production release gate

Generated footage cannot receive ReleaseApproval until all of the following are true:

- every generated timeline media item maps to an approved, server-signed Take with matching asset ID and SHA-256;
- reviewed Korean dialogue cues reference real audio media;
- every referenced local dialogue/audio/UI media item has been promoted to a server-managed asset with SHA-256 and decode validation;
- each dialogue cue has an exact matching caption and timing;
- generated source audio is muted or ducked when dialogue is present;
- ambience or SFX is present; BGM is forbidden when the approved storyboard says no BGM;
- app UI overlays reference actual visual media;
- brand and CTA reference actual TextElements on the timeline;
- Korean dialogue, captions, audio mix, app UI and CTA checklist flags are all confirmed.

## Local setup

Requirements:

- Node.js 22.x
- Chrome or Chromium
- ffmpeg and ffprobe

```bash
npm ci
npm test
npm run type-check
npm run lint
npm run build
```

Paid-provider-free real media/render E2E (Windows example):

```bash
CLIPJS_RUN_FULL_FAKE_E2E=1 REMOTION_BROWSER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npx vitest run app/lib/generation/fake-provider-e2e.server.test.ts
```

Create `.env.local` from `.env.example`. Keep every credential server-only; never use a `NEXT_PUBLIC_` prefix.

```dotenv
CLIPJS_AGENT_TOKEN=replace-with-a-long-random-value
CLIPJS_APPROVAL_TOKEN=replace-with-a-different-long-random-value
CLIPJS_APPROVAL_SIGNING_SECRET=replace-with-a-third-high-entropy-server-only-value
CLIPJS_APPROVAL_SIGNING_KEY_ID=primary
CLIPJS_TRANSPORT_URL_ENCRYPTION_KEY=replace-with-a-fourth-high-entropy-server-only-value
CLIPJS_ASSET_CAPABILITY_SECRET=replace-with-another-long-random-value
CLIPJS_RENDER_DOWNLOAD_SECRET=replace-with-another-long-random-value
REMOTION_BROWSER_EXECUTABLE_PATH=/path/to/chrome

CLIPJS_GENERATION_PROVIDER=disabled
BYTEPLUS_GENERATION_SUBMIT_ENABLED=false
BYTEPLUS_ARK_API_KEY=
BYTEPLUS_RESULT_HOSTS=
CLIPJS_MEDIA_HOSTS=cdn.example.com
```

Start the web app and workers in separate processes on the same self-hosted machine:

```bash
npm run dev
npm run worker:generation
npm run worker:render
```

`worker:generation` requires `CLIPJS_GENERATION_PROVIDER=fake` in non-production tests or `byteplus` with an API key. A paid submit additionally requires `BYTEPLUS_GENERATION_SUBMIT_ENABLED=true`, a current signed GenerationAuthorization and a newly approved attempt ID.

## Docker single-host deployment

`Dockerfile` is pinned to Node 22 and installs Chromium, ffmpeg and Noto CJK fonts. `compose.yaml` runs the web process and render worker against one shared durable volume. The generation worker is in the `generation` profile so it cannot start accidentally.

```bash
docker compose up --build web render-worker
docker compose --profile generation up generation-worker
```

This filesystem repository is supported only for a single self-hosted host. Do not deploy paid generation or durable rendering to Vercel or a multi-instance service with host-local state. Migrate jobs, leases and assets to shared durable storage before horizontal scaling. CI may run tests, build and fake-provider workflows, but must not perform paid video generation.

## Browser preview and render assets

Generated and managed asset preview uses a short-lived project/asset capability URL with `HEAD`, byte ranges, `Content-Length` and `ETag`. Capability URLs are runtime-only and are never persisted in IndexedDB or project exports. Use **Stage referenced local media** to promote browser-local TTS, ambience, SFX, BGM and app UI files before ReleaseApproval. For server-owned generated and managed assets, the Remotion worker verifies project ownership, asset kind and SHA-256, then stages the asset store's local bytes without reusing a browser capability URL. Legacy external media instead requires a persistent HTTPS `remoteUrl` allowed by `CLIPJS_MEDIA_HOSTS`; the worker downloads and verifies it before rendering.

Legacy Higgsfield assets remain readable for migration. The Higgsfield paid route rejects BytePlus-scoped authorization and is not the default generation path.

## Verification

The repository includes tests for:

- all 28 source axis IDs and original `requires` behavior;
- official BytePlus payload fields, 30/10/10 references and pure-audio input;
- request hashing independent of expiring transport URLs;
- atomic claim/idempotency and fail-closed uncertain locking;
- lease competition, fencing and worker takeover;
- secure ingest, rich media probe, decode and asset quotas;
- qc_pending Take recovery and exactly-once durable import;
- post-production and Take-signature ReleaseApproval preflight;
- durable RenderJob competition and takeover;
- IndexedDB migration backup, CAS and autosave error propagation.

## Licensing

ClipJS and its upstream repository are MIT licensed; preserve `LICENSE` and upstream copyright notices in distributions. Noto Sans KR is OFL-1.1. Review Remotion's license for your organization size and usage.
