"""
迁移：为 orders 表添加真实支付渠道所需字段.

- qrcode_url: 支付宝/微信下单后返回的二维码内容 (区别于 mock 的 mock_qrcode_token)
- trade_no: 支付渠道侧交易号, notify 验签通过后写入, 用于对账
- notify_payload: 最近一次异步通知的原始报文, 用于排查与防重放审计

用法:
    python -m app.db.migrate_add_order_trade_no

幂等: 重复执行不会报错，列已存在时会跳过。
新库部署可直接走 init_db() (Base.metadata.create_all 已包含这些列),
本脚本仅用于已有数据库的手动升级。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
        ),
        {"t": table_name, "c": column_name},
    ).scalar()
    return bool(row)


def run() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        if not _column_exists(conn, "orders", "qrcode_url"):
            conn.execute(
                text(
                    "ALTER TABLE orders "
                    "ADD COLUMN qrcode_url VARCHAR(512) NULL COMMENT '真实支付渠道返回的二维码内容' "
                    "AFTER mock_qrcode_token"
                )
            )
            print("  added column: orders.qrcode_url")
        else:
            print("  skipped (exists): orders.qrcode_url")

        if not _column_exists(conn, "orders", "trade_no"):
            conn.execute(
                text(
                    "ALTER TABLE orders "
                    "ADD COLUMN trade_no VARCHAR(64) NULL COMMENT '支付渠道侧交易号' "
                    "AFTER qrcode_url"
                )
            )
            print("  added column: orders.trade_no")
        else:
            print("  skipped (exists): orders.trade_no")

        if not _column_exists(conn, "orders", "notify_payload"):
            conn.execute(
                text(
                    "ALTER TABLE orders "
                    "ADD COLUMN notify_payload TEXT NULL COMMENT '最近一次异步通知的原始报文' "
                    "AFTER trade_no"
                )
            )
            print("  added column: orders.notify_payload")
        else:
            print("  skipped (exists): orders.notify_payload")

    print("Migration done.")


if __name__ == "__main__":
    run()
