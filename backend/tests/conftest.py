import os


# pytest 运行的是模拟 Provider/用户，不得把测试调用写入生产 AI 审计表。
os.environ.setdefault("AI_USAGE_AUDIT_ENABLED", "false")
