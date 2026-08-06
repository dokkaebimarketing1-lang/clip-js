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
- `add_caption`

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
- the approval was not server-signed with the owner-only approval secret;
- the storyboard changed after approval;
- an asset has no persistent HTTPS `remoteUrl`;
- a URL is local/private, outside `CLIPJS_MEDIA_HOSTS`, or DNS resolves to a private network;
- the production API token is absent or invalid.

A successful response returns `{renderId, downloadUrl}`. Download URLs use strict UUID filenames plus a 10-minute HMAC signature. Rendering is capped at 4K, 60fps, one hour, 500 media items, 1,000 text items, 5,000 captions, and 500 transitions.
