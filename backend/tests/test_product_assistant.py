from app.services.product_assistant_store import _chunk_product_markdown
from app.services.product_assistant_service import build_product_assistant_messages


def test_product_markdown_chunks_keep_section_metadata():
    chunks = _chunk_product_markdown(
        "# 快速开始\n\n简介内容足够长，说明 NoteFlow 的用途。\n\n"
        "## 视频转笔记\n\n把视频链接交给 NoteFlow 后会自动转写并生成结构化笔记。\n\n"
        "### 本地视频\n\n也可以上传本地视频进行转写和笔记生成。",
        "快速开始",
    )

    assert [item["metadata"]["section_title"] for item in chunks] == [
        "视频转笔记",
        "本地视频",
    ]
    assert all(item["metadata"]["source_type"] == "product_doc" for item in chunks)
    assert all(item["metadata"]["title"] == "快速开始" for item in chunks)


def test_product_markdown_ignores_short_heading_only_sections():
    assert _chunk_product_markdown("## 空标题\n\n太短", "测试") == []


def test_product_assistant_prompt_forbids_private_note_claims():
    messages = build_product_assistant_messages(
        "我的某条笔记里说了什么？",
        [],
        [
            {
                "text": "NoteFlow 可将视频转成结构化 Markdown 笔记。",
                "metadata": {"title": "快速开始", "section_title": "视频转笔记"},
            }
        ],
    )

    system = messages[0]["content"]
    assert "只依据产品资料" in system
    assert "不会读取用户私人笔记" in system
    assert messages[-1]["content"] == "我的某条笔记里说了什么？"


def test_product_assistant_messages_keep_only_recent_history():
    history = [{"role": "user", "content": str(i)} for i in range(25)]
    messages = build_product_assistant_messages("现在的问题", history, [])
    assert [item["content"] for item in messages[1:-1]] == [str(i) for i in range(5, 25)]
