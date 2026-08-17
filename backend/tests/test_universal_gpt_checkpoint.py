import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from pathlib import Path


def _install_stubs():
    app_mod = types.ModuleType("app")
    gpt_pkg = types.ModuleType("app.gpt")
    models_pkg = types.ModuleType("app.models")

    base_mod = types.ModuleType("app.gpt.base")

    class _GPT:
        pass

    base_mod.GPT = _GPT

    prompt_builder_mod = types.ModuleType("app.gpt.prompt_builder")

    def _generate_base_prompt(**_kwargs):
        return "prompt"

    prompt_builder_mod.generate_base_prompt = _generate_base_prompt

    prompt_mod = types.ModuleType("app.gpt.prompt")
    prompt_mod.BASE_PROMPT = ""
    prompt_mod.AI_SUM = ""
    prompt_mod.SCREENSHOT = ""
    prompt_mod.LINK = ""
    prompt_mod.MERGE_PROMPT = "merge"

    utils_mod = types.ModuleType("app.gpt.utils")

    def _fix_markdown(text):
        return text

    utils_mod.fix_markdown = _fix_markdown

    request_chunker_mod = types.ModuleType("app.gpt.request_chunker")

    class _RequestChunker:
        def __init__(self, *_args, **_kwargs):
            pass

        def group_texts_by_budget(self, texts, _builder, **_kwargs):
            return [texts]

    request_chunker_mod.RequestChunker = _RequestChunker

    gpt_model_mod = types.ModuleType("app.models.gpt_model")

    class _GPTSource:
        pass

    gpt_model_mod.GPTSource = _GPTSource

    transcriber_model_mod = types.ModuleType("app.models.transcriber_model")

    class _TranscriptSegment:
        def __init__(self, **kwargs):
            self.start = kwargs.get("start", 0)
            self.end = kwargs.get("end", 0)
            self.text = kwargs.get("text", "")

    transcriber_model_mod.TranscriptSegment = _TranscriptSegment

    sys.modules.setdefault("app", app_mod)
    sys.modules.setdefault("app.gpt", gpt_pkg)
    sys.modules.setdefault("app.models", models_pkg)
    sys.modules["app.gpt.base"] = base_mod
    sys.modules["app.gpt.prompt_builder"] = prompt_builder_mod
    sys.modules["app.gpt.prompt"] = prompt_mod
    sys.modules["app.gpt.utils"] = utils_mod
    sys.modules["app.gpt.request_chunker"] = request_chunker_mod
    sys.modules["app.models.gpt_model"] = gpt_model_mod
    sys.modules["app.models.transcriber_model"] = transcriber_model_mod


def _load_universal_gpt_class():
    stubbed_names = [
        "app",
        "app.gpt",
        "app.models",
        "app.gpt.base",
        "app.gpt.prompt_builder",
        "app.gpt.prompt",
        "app.gpt.utils",
        "app.gpt.request_chunker",
        "app.models.gpt_model",
        "app.models.transcriber_model",
    ]
    previous_modules = {name: sys.modules.get(name) for name in stubbed_names}
    _install_stubs()
    root = pathlib.Path(__file__).resolve().parents[1]
    module_path = root / "app" / "gpt" / "universal_gpt.py"
    spec = importlib.util.spec_from_file_location("universal_gpt", module_path)
    if spec is None or spec.loader is None:
        raise ImportError("universal_gpt module spec not found")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        return module.UniversalGPT
    finally:
        for name, previous in previous_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


UniversalGPT = _load_universal_gpt_class()


class _FailingCompletions:
    def create(self, **_kwargs):
        raise Exception("Error code: 524 - bad_response_status_code")


class _DummyChat:
    def __init__(self):
        self.completions = _FailingCompletions()


class _DummyModels:
    @staticmethod
    def list():
        return []


class _DummyClient:
    def __init__(self):
        self.chat = _DummyChat()
        self.models = _DummyModels()


class _Message:
    def __init__(self, content):
        self.content = content


class _Choice:
    def __init__(self, content):
        self.message = _Message(content)


class _Response:
    def __init__(self, content):
        self.choices = [_Choice(content)]


class _SequenceCompletions:
    def __init__(self, contents):
        self.contents = list(contents)
        self.calls = 0

    def create(self, **_kwargs):
        self.calls += 1
        return _Response(self.contents.pop(0))


class _SequenceClient:
    def __init__(self, contents):
        self.completions = _SequenceCompletions(contents)
        self.chat = types.SimpleNamespace(completions=self.completions)
        self.models = _DummyModels()


class TestUniversalGPTCheckpoint(unittest.TestCase):
    def test_merge_524_error_persists_checkpoint(self):
        original_attempts = os.environ.get("OPENAI_RETRY_ATTEMPTS")
        os.environ["OPENAI_RETRY_ATTEMPTS"] = "1"
        gpt = UniversalGPT(_DummyClient(), model="mock-model")
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                gpt.checkpoint_dir = Path(tmp_dir)

                with self.assertRaises(Exception):
                    gpt._merge_partials(["part-a", "part-b"], "task-1", "sig-1")

                checkpoint_path = gpt._checkpoint_path("task-1")
                self.assertTrue(checkpoint_path.exists())
                payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
                self.assertEqual(payload["phase"], "merge")
                self.assertEqual(payload["partials"], ["part-a", "part-b"])
        finally:
            if original_attempts is None:
                os.environ.pop("OPENAI_RETRY_ATTEMPTS", None)
            else:
                os.environ["OPENAI_RETRY_ATTEMPTS"] = original_attempts

    def test_empty_completion_content_retries_before_returning(self):
        original_attempts = os.environ.get("OPENAI_RETRY_ATTEMPTS")
        original_backoff = os.environ.get("OPENAI_RETRY_BACKOFF_SECONDS")
        os.environ["OPENAI_RETRY_ATTEMPTS"] = "2"
        os.environ["OPENAI_RETRY_BACKOFF_SECONDS"] = "0"
        client = _SequenceClient(["   ", "# note"])
        gpt = UniversalGPT(client, model="mock-model")
        try:
            content = gpt._chat_completion_content([{"role": "user", "content": "prompt"}])
        finally:
            if original_attempts is None:
                os.environ.pop("OPENAI_RETRY_ATTEMPTS", None)
            else:
                os.environ["OPENAI_RETRY_ATTEMPTS"] = original_attempts
            if original_backoff is None:
                os.environ.pop("OPENAI_RETRY_BACKOFF_SECONDS", None)
            else:
                os.environ["OPENAI_RETRY_BACKOFF_SECONDS"] = original_backoff

        self.assertEqual(content, "# note")
        self.assertEqual(client.completions.calls, 2)


if __name__ == "__main__":
    unittest.main()
