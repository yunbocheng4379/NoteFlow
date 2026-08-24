from typing import Any, Mapping


def build_transcript_text(transcript: Mapping[str, Any]) -> str:
    """Return transcript text without timestamps or other subtitle metadata."""
    full_text = str(transcript.get("full_text") or "").strip()
    if full_text:
        return full_text

    segments = transcript.get("segments") or []
    lines = [
        str(segment.get("text") or "").strip()
        for segment in segments
        if str(segment.get("text") or "").strip()
    ]
    return "\n".join(lines)
