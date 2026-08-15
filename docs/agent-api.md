# Agent API

Preview requests require `Authorization: Bearer $CLIPJS_AGENT_TOKEN`. Render requests require both that bearer token and the separate owner-only `x-clipjs-approval-token: $CLIPJS_APPROVAL_TOKEN` header. Apply and storyboard approval require the owner token.

## Preview a change

`POST /api/agent/commands/preview`

The URL below is an example. Its hostname must be included in the deployment's `CLIPJS_MEDIA_HOSTS` allowlist before legacy external media can render.

```json
{
  "project": {"...": "ProjectState JSON"},
  "command": {
    "type": "import_clip",
    "url": "https://cdn.example.com/CUT01-S1.mp4",
    "model": "seedance_2_5",
    "cutId": "CUT01",
    "shotId": "S1",
    "role": "clip",
    "durationSeconds": 5
  }
}
```

Supported mutation commands:

- `import_clip` — legacy external HTTPS video or audio/SFX with cut/shot provenance
- `trim_clip`
- `set_playback_speed`
- `add_transition`
- `add_effect` — add a bounded official Remotion effect to visual media only
- `add_caption`
- `upsert_production_asset` — add or replace a bounded character/location/prop/crowd state asset
- `upsert_continuity_lock` — add or replace a scene geometry, axis, lighting and palette lock
- `upsert_shot_spec` — add or replace a structured generation spec compiled into the canonical prompt skeleton
- `record_generation_take` — record provider/model/output/verdict while computing provenance hashes server-side. Seedance 2.5: optional `mode` (`t2v`/`omni_reference`/`video_edit`/`video_extension`), `resolution` (`480p`/`720p`), `extensionMode` (`backward`/`forward` — `video_extension` 전용)

Production mutations invalidate owner approval. A `locked` asset requires exactly 10 passed stress tests. Prompt compilation and take recording fail closed unless all active references and the selected continuity lock are locked. Agents cannot submit provenance hashes directly.

Example effect command:

```json
{
  "type": "add_effect",
  "mediaId": "clip-id",
  "effect": "chromatic-aberration",
  "intensity": 0.4,
  "startSeconds": 2,
  "endSeconds": 3
}
```

Effects are limited to `blur`, `chromatic-aberration`, `vignette`, `noise`, `pixelate`, and `glow`. The range must remain inside the target video or image timeline range. Omitting the range applies the effect to the full clip.

Example Korean variety caption:

```json
{
  "type": "add_caption",
  "text": "이게 된다고?!",
  "startSeconds": 4.2,
  "endSeconds": 5.1,
  "kind": "variety",
  "preset": "variety-shock",
  "position": "center",
  "intensity": 0.7,
  "accentColor": "#ffd43b"
}
```

Allowed caption presets:

- `dialogue`: `dialogue-clean`, `dialogue-speaker`, `dialogue-cinematic` plus legacy `clean`, `bold-highlight`, `cinematic`, `shorts`
- `effect`: `word-highlight`, `karaoke`, `typewriter`, `bounce`, `glow`, `impact`
- `variety`: `variety-sticker`, `variety-shock`, `variety-shake`, `reaction`, `thought`, `name-tag`, `quote-card`

The server rejects kind/preset mismatches, invalid ranges, intensity outside `0..1`, invalid colors and word timings outside the cue. Agents cannot provide CSS, fonts, React components or arbitrary animation code.

The response is a complete `AgentChangeSet` containing `summary`, `proposedProject`, `baseProjectHash`, a SHA-256 integrity `token`, and an owner-secret-backed `serverSignature`. No state is changed by preview; Apply rejects any payload not signed by the Preview endpoint.

## Apply an explicitly approved preview

`POST /api/agent/commands/apply`

This endpoint requires `x-clipjs-approval-token`; the agent bearer token is intentionally not accepted.

```json
{
  "project": {"...": "current ProjectState JSON"},
  "changeSet": {"...": "exact preview response"},
  "approvalToken": "exact token shown to and approved by the user"
}
```

The apply endpoint recomputes the token and rejects stale or modified previews. Editable project changes invalidate the preview; playback position and UI selection do not, and their current values are preserved on apply.

## Render

`POST /api/render` with `{ "project": <approved ProjectState> }`. Rendering fails closed when:

- no storyboard is present;
- the exact storyboard hash was not explicitly approved;
- the exact production manifest hash was not explicitly approved;
- the approval was not server-signed with the owner-only approval secret;
- the storyboard or production manifest changed after approval;
- a media item is neither a matching server-owned generated/managed asset nor legacy external media with a persistent HTTPS `remoteUrl`;
- a legacy external URL is local/private, outside `CLIPJS_MEDIA_HOSTS`, or DNS resolves to a private network;
- the agent bearer token or owner approval token is absent or invalid.

A successful enqueue returns HTTP 202 with `{jobId, status, statusUrl, reused}`. Polling `statusUrl` with the agent bearer token returns `downloadUrl` after the job succeeds. Render downloads use a UUID-shaped `.mp4` filename and an HMAC-SHA-256 token that expires after 10 minutes by default. Rendering is capped at 1920×1080, 60fps, 180 seconds, 500 media items, 1,000 text items, 5,000 captions, 100,000 caption words, 500 transitions, 1,000 effects, and 13,000 combined production assets, continuity locks, shot specs, and takes.
