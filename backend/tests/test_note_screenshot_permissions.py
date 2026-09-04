from pathlib import Path


NOTE_ROUTER_SOURCE = Path(__file__).parents[1].joinpath("app/routers/note.py").read_text()


def test_generation_routes_guard_screenshot_before_billing():
    single_start = NOTE_ROUTER_SOURCE.index("def generate_note(")
    batch_start = NOTE_ROUTER_SOURCE.index("def generate_notes_batch(")

    single_source = NOTE_ROUTER_SOURCE[single_start:batch_start]
    batch_source = NOTE_ROUTER_SOURCE[batch_start:]

    for route_source in (single_source, batch_source):
        guard = route_source.index('require_pro(current_user, "原片截图")')
        billing = route_source.index("credit_ledger.consume")
        assert guard < billing
        assert 'if "screenshot" in (data.format or []):' in route_source
