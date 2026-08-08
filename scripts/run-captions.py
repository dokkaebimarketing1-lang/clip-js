"""clip-js CF pipeline: import clip -> add 10 captions -> approve -> render -> verify MP4."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("CLIPJS_BASE_URL", "http://localhost:3000").rstrip("/")
AGENT = os.environ.get("CLIPJS_AGENT_TOKEN")
OWNER = os.environ.get("CLIPJS_APPROVAL_TOKEN")
VIDEO_URL = os.environ.get(
    "CLIPJS_VIDEO_URL",
    "https://d2ol7oe51mr4n9.cloudfront.net/user_3DzfmNvPzcjGNDaadbCEIUKmEEz/a8d6e439-956f-4b92-952f-ecd11d1c9467.mp4",
)
OUTPUT = Path(os.environ.get("CLIPJS_OUTPUT", "../호랑이-최종-30s-v3.mp4"))
REQUEST_TIMEOUT_SECONDS = 600

if not AGENT or not OWNER:
    raise SystemExit("CLIPJS_AGENT_TOKEN and CLIPJS_APPROVAL_TOKEN are required.")


def req(path: str, payload: object, extra: dict[str, str] | None = None) -> tuple[int, object]:
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {AGENT}"}
    if extra:
        headers.update(extra)
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")[:1000]


def preview_apply(project: dict, command: dict, label: str) -> dict:
    status, response = req("/api/agent/commands/preview", {"project": project, "command": command})
    if status != 200 or not isinstance(response, dict):
        raise SystemExit(f"[{label}] PREVIEW FAIL {status}: {response}")
    change_set = {key: response[key] for key in ("token", "baseProjectHash", "summary", "command", "proposedProject")}
    if response.get("serverSignature"):
        change_set["serverSignature"] = response["serverSignature"]
    apply_status, apply_response = req(
        "/api/agent/commands/apply",
        {"project": project, "changeSet": change_set, "approvalToken": change_set["token"]},
        {"x-clipjs-approval-token": OWNER},
    )
    if apply_status != 200:
        raise SystemExit(f"[{label}] APPLY FAIL {apply_status}: {apply_response}")
    print(f"[{label}] OK - {response.get('summary')}")
    return apply_response if isinstance(apply_response, dict) and "workflow" in apply_response else response["proposedProject"]


def download_and_verify(download_url: str) -> Path:
    absolute_url = urllib.parse.urljoin(f"{BASE}/", download_url)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(OUTPUT.suffix + ".part")
    try:
        with urllib.request.urlopen(absolute_url, timeout=REQUEST_TIMEOUT_SECONDS) as response, temporary.open("wb") as target:
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
        header = temporary.read_bytes()[:12]
        size = temporary.stat().st_size
        if size < 100_000 or len(header) < 8 or header[4:8] != b"ftyp":
            raise RuntimeError(f"Rendered download is not a valid MP4 container (size={size}).")
        ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            raise RuntimeError("ffprobe is required to verify the rendered MP4.")
        probe = subprocess.run(
            [
                ffprobe,
                "-v", "error",
                "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration",
                "-of", "json",
                str(temporary),
            ],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        metadata = json.loads(probe.stdout)
        streams = metadata.get("streams", [])
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
        audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
        duration = float(metadata.get("format", {}).get("duration", 0))
        if not video or video.get("codec_name") != "h264" or video.get("width") != 1920 or video.get("height") != 1080:
            raise RuntimeError(f"Unexpected video stream metadata: {video}")
        if video.get("r_frame_rate") != "30/1" or not 29.5 <= duration <= 30.5 or not audio:
            raise RuntimeError(f"Unexpected render timing/audio metadata: duration={duration}, video={video}, audio={audio}")
        temporary.replace(OUTPUT)
        return OUTPUT.resolve()
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


with Path("scripts/initial-project.json").open(encoding="utf-8") as source:
    project = json.load(source)

project = preview_apply(
    project,
    {
        "type": "import_clip",
        "url": VIDEO_URL,
        "provider": "higgsfield",
        "model": "seedance_2_5",
        "cutId": "CUT12",
        "shotId": "S1",
        "role": "clip",
        "durationSeconds": 30,
        "positionStart": 0,
    },
    "import_clip",
)
media_id = project["mediaFiles"][0]["id"]
print("mediaId:", media_id, "| mediaFiles:", len(project["mediaFiles"]))

# Dialogue stays in the bottom lane; the concurrent brand message uses the top lane.
# This prevents same-lane collisions while preserving every spoken caption verbatim.
captions = [
    ("보시면 아시겠지만 제가 급해요. 상담 좀 해주세요.", 4.4, 6.4, "dialogue", "dialogue-clean", "bottom"),
    ("네 대기 사십칠번이세요.", 6.8, 8.6, "dialogue", "dialogue-clean", "bottom"),
    ("사십칠번이요?", 9.2, 10.4, "dialogue", "dialogue-clean", "bottom"),
    ("다들 그러세요.", 10.8, 12.2, "dialogue", "dialogue-clean", "bottom"),
    ("저 오늘 고민 꼭 해결해야된다구요.", 20.0, 22.6, "dialogue", "dialogue-clean", "bottom"),
    ("기다리지 말고 바로 상담해.", 22.9, 24.8, "dialogue", "dialogue-clean", "bottom"),
    ("네. 사주천궁입니다.", 26.0, 26.6, "dialogue", "dialogue-clean", "bottom"),
    ("네 대기 사십칠번이세요.", 28.0, 28.6, "dialogue", "dialogue-clean", "bottom"),
    ("네. 고객님은 사십팔번입니다.", 28.8, 29.4, "dialogue", "dialogue-clean", "bottom"),
    ("고민에 물리셨나요? 24시간 언제나 이용하는 사주천궁 고민상담.", 28.0, 30.0, "dialogue", "dialogue-cinematic", "top"),
]
for index, (text, start, end, kind, preset, position) in enumerate(captions, start=1):
    project = preview_apply(
        project,
        {
            "type": "add_caption",
            "text": text,
            "startSeconds": start,
            "endSeconds": end,
            "kind": kind,
            "preset": preset,
            "position": position,
        },
        f"caption {index}/{len(captions)}",
    )
print("captions total:", len(project["workflow"]["captions"]))

approval_status, approval_response = req(
    "/api/approval/storyboard",
    {
        "projectId": project["id"],
        "storyboard": project["workflow"]["storyboard"],
        "production": project["workflow"]["production"],
    },
    {"x-clipjs-approval-token": OWNER},
)
print("APPROVAL status:", approval_status)
if approval_status != 200 or not isinstance(approval_response, dict):
    raise SystemExit(f"APPROVAL FAIL: {approval_response}")
project["workflow"]["approval"] = approval_response.get("approval", approval_response)

render_status, render_response = req(
    "/api/render",
    {"project": project},
    {"x-clipjs-approval-token": OWNER},
)
print("RENDER status:", render_status)
if render_status != 200 or not isinstance(render_response, dict) or not isinstance(render_response.get("downloadUrl"), str):
    raise SystemExit(f"RENDER FAIL: {render_response}")
output = download_and_verify(render_response["downloadUrl"])
print(f"VERIFIED MP4: {output} ({output.stat().st_size} bytes)")
