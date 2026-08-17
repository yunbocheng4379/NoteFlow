from app.utils.error_messages import translate_download_error


def test_translate_youtube_drm_error_explains_po_token_requirement():
    message = translate_download_error(
        RuntimeError(
            "YouTube requires a GVS PO Token; ERROR: This video is DRM protected"
        ),
        platform="youtube",
    )

    assert "DRM" in message
    assert "PO Token" in message
