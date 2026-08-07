# Agent API

Preview and render requests require `Authorization: Bearer $CLIPJS_AGENT_TOKEN`. Apply and storyboard approval require the separate owner-only `x-clipjs-approval-token: $CLIPJS_APPROVAL_TOKEN` header.

## Preview a change

`POST /api/agent/commands/preview`

```json
{
  "project": {"...": "ProjectState JSON"},
  "command": {
    "type": "import_clip",
    "url": "https://cdn.example.com/CUT01-S1.mp4",
    "model": "seedance_2_0",
    "cutId": "CUT01",
    "shotId": "S1",
    "role": "clip",
    "durationSeconds": 5
  }
}
```

Supported mutation commands:

- `import_clip` — Higgsfield video or audio/SFX with cut/shot provenance
- `trim_clip`
- `set_playback_speed`
- `add_transition`
- `add_effect` — add a bounded official Remotion effect to visual media only
- `add_caption`
- `upsert_production_asset` — add or replace a bounded character/location/prop/crowd state asset
- `upsert_continuity_lock` — add or replace a scene geometry, axis, lighting and palette lock
- `upsert_shot_spec` — add or replace a structured generation spec compiled into the canonical prompt skeleton
- `record_generation_take` — record provider/model/output/verdict while computing provenance hashes server-side

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
- an asset has no persistent HTTPS `remoteUrl`;
- a URL is local/private, outside `CLIPJS_MEDIA_HOSTS`, or DNS resolves to a private network;
- the production API token is absent or invalid.

A successful response returns `{renderId, downloadUrl}`. Download URLs use strict UUID filenames plus a 10-minute HMAC signature. Rendering is capped at 4K, 60fps, one hour, 500 media items, 1,000 text items, 5,000 captions, 100,000 caption words, 500 transitions, and 1,000 effects.
