"""
历史迁移脚本: 把老的 ``user_cookies`` 数据迁到 ``platform_cookies``.

2026-07-10: ``user_cookies`` 表与对应 model/dao 全部下线, 本脚本变成 noop
保留只为不破坏历史 CI / 文档链接; 重复执行不会报错.
"""


def run():
    print("[migrate] user_cookies → platform_cookies 历史迁移已完成且 user_cookies 已下线, 本脚本为 noop.")
    return


if __name__ == "__main__":
    run()
