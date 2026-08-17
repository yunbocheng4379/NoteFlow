from types import SimpleNamespace

import pytest


def test_run_note_task_marks_success_only_after_result_is_saved(monkeypatch):
    from app.routers import note as note_router

    events = []

    class FakeGenerator:
        def __init__(self, user_id=None):
            pass

        def generate(self, **kwargs):
            return SimpleNamespace(
                markdown="# note",
                transcript=None,
                audio_meta=SimpleNamespace(title="title"),
            )

        def _update_status(self, task_id, status, message=None):
            events.append(("status", status.value if hasattr(status, "value") else status))

        def _notify_task_completed(self, **kwargs):
            events.append(("notify", kwargs["task_id"]))

    class FakeExecutor:
        def run(self, func):
            return func()

    monkeypatch.setattr(note_router, "NoteGenerator", FakeGenerator)
    monkeypatch.setattr(note_router, "task_serial_executor", FakeExecutor())
    monkeypatch.setattr(
        note_router,
        "save_note_to_file",
        lambda task_id, note: events.append(("save", task_id)),
    )
    monkeypatch.setattr(note_router, "_index_note_for_kb", lambda task_id: None)

    note_router.run_note_task(
        "task-1", "https://example.com/video", "local", "medium",
        model_name="model", provider_id="provider",
    )

    assert events.index(("save", "task-1")) < events.index(("status", "SUCCESS"))
    assert events.index(("status", "SUCCESS")) < events.index(("notify", "task-1"))


def test_summarize_text_rejects_empty_markdown(monkeypatch, tmp_path):
    from app.services.llm_fallback import LLMFallbackableError
    from app.models.transcriber_model import TranscriptResult
    from app.services.note import NoteGenerator

    generator = object.__new__(NoteGenerator)
    monkeypatch.setattr(generator, "_update_status", lambda *args, **kwargs: None)

    gpt = SimpleNamespace(summarize=lambda source: "   \n")
    audio_meta = SimpleNamespace(title="title", raw_info={})
    transcript = TranscriptResult(language="zh", full_text="一段有效转写", segments=[])
    markdown_cache_file = tmp_path / "task-1_markdown.md"

    with pytest.raises(LLMFallbackableError, match="AI 生成的笔记内容为空"):
        generator._summarize_text(
            audio_meta=audio_meta,
            transcript=transcript,
            gpt=gpt,
            markdown_cache_file=markdown_cache_file,
            link=False,
            screenshot=False,
            formats=[],
            style=None,
            extras=None,
            video_img_urls=[],
        )

    assert not markdown_cache_file.exists()


def test_summarize_with_fallback_tries_next_provider_when_markdown_is_empty(
    monkeypatch, tmp_path
):
    from app.models.transcriber_model import TranscriptResult
    from app.services.note import NoteGenerator

    generator = object.__new__(NoteGenerator)
    attempts = []

    monkeypatch.setattr(generator, "_update_status", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        generator,
        "_build_fallback_candidates",
        lambda **kwargs: [("empty-provider", "model-a"), ("ok-provider", "model-b")],
    )

    def fake_get_gpt(model_name, provider_id):
        attempts.append(provider_id)
        if provider_id == "empty-provider":
            return SimpleNamespace(summarize=lambda source: "\n")
        return SimpleNamespace(summarize=lambda source: "# 正常笔记")

    monkeypatch.setattr(generator, "_get_gpt", fake_get_gpt)

    audio_meta = SimpleNamespace(title="title", raw_info={})
    transcript = TranscriptResult(language="zh", full_text="一段有效转写", segments=[])

    markdown = generator._summarize_with_fallback(
        audio_meta=audio_meta,
        transcript=transcript,
        primary_provider_id="empty-provider",
        primary_model_name="model-a",
        markdown_cache_file=tmp_path / "task-1_markdown.md",
        link=False,
        screenshot=False,
        formats=[],
        style=None,
        extras=None,
        video_img_urls=[],
    )

    assert attempts == ["empty-provider", "ok-provider"]
    assert markdown == "# 正常笔记"
