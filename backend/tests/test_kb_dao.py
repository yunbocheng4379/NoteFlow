"""kb_dao.py 集成测试 - 走真实 DB"""
import time

import app.db.init_db  # noqa: F401
from app.db import kb_dao


def test_create_and_list_conversation():
    conv = kb_dao.create_conversation(user_id=999001)
    assert conv["title"] is None

    conversations = kb_dao.list_conversations(user_id=999001)
    assert any(c["id"] == conv["id"] for c in conversations)

    kb_dao.delete_conversation(conv["id"], user_id=999001)


def test_add_and_list_messages_ordering():
    conv = kb_dao.create_conversation(user_id=999002)
    kb_dao.add_message(conv["id"], "user", "第一条问题")
    kb_dao.add_message(conv["id"], "assistant", "第一条回答", sources=[{"task_id": "abc", "title": "笔记A"}])

    messages = kb_dao.list_messages(conv["id"])
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["sources"] == [{"task_id": "abc", "title": "笔记A"}]

    kb_dao.delete_conversation(conv["id"], user_id=999002)


def test_delete_conversation_cascades_messages():
    conv = kb_dao.create_conversation(user_id=999003)
    kb_dao.add_message(conv["id"], "user", "问题")

    ok = kb_dao.delete_conversation(conv["id"], user_id=999003)
    assert ok is True
    assert kb_dao.get_conversation(conv["id"], user_id=999003) is None
    assert kb_dao.list_messages(conv["id"]) == []


def test_touch_and_update_conversation_meta():
    conv = kb_dao.create_conversation(user_id=999004)
    kb_dao.update_conversation_meta(conv["id"], title="测试标题", provider_id="deepseek", model_name="deepseek-chat")

    fetched = kb_dao.get_conversation(conv["id"], user_id=999004)
    assert fetched["title"] == "测试标题"
    assert fetched["provider_id"] == "deepseek"
    assert fetched["model_name"] == "deepseek-chat"

    kb_dao.delete_conversation(conv["id"], user_id=999004)


def test_list_conversations_orders_by_updated_at_desc():
    conv_a = kb_dao.create_conversation(user_id=999005)
    time.sleep(1.1)  # kb_conversations.updated_at is DATETIME (second precision)
    conv_b = kb_dao.create_conversation(user_id=999005)

    conversations = kb_dao.list_conversations(user_id=999005)
    ids = [c["id"] for c in conversations]
    assert ids.index(conv_b["id"]) < ids.index(conv_a["id"])

    # touch_conversation should bump conv_a back to the front
    time.sleep(1.1)
    kb_dao.touch_conversation(conv_a["id"])
    conversations = kb_dao.list_conversations(user_id=999005)
    ids = [c["id"] for c in conversations]
    assert ids.index(conv_a["id"]) < ids.index(conv_b["id"])

    kb_dao.delete_conversation(conv_a["id"], user_id=999005)
    kb_dao.delete_conversation(conv_b["id"], user_id=999005)
