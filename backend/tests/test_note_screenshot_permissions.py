from pathlib import Path


NOTE_ROUTER_SOURCE = Path(__file__).parents[1].joinpath("app/routers/note.py").read_text()


def test_generation_routes_guard_screenshot_before_billing():
    single_start = NOTE_ROUTER_SOURCE.index("def generate_note(")
    batch_start = NOTE_ROUTER_SOURCE.index("def generate_notes_batch(")

    single_source = NOTE_ROUTER_SOURCE[single_start:batch_start]
    batch_source = NOTE_ROUTER_SOURCE[batch_start:]

    single_guard = single_source.index('require_pro(current_user, "原片截图")')
    single_billing = single_source.index("credit_ledger.consume")
    assert single_guard < single_billing
    assert 'if data.screenshot or "screenshot" in (data.format or []):' in single_source

    batch_guard = batch_source.index('require_pro(current_user, "原片截图")')
    batch_billing = batch_source.index("credit_ledger.consume")
    assert batch_guard < batch_billing
    assert 'if "screenshot" in (data.format or []):' in batch_source
