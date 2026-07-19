# backend/app/db/redis_client.py
"""Redis 连接单例, 供验证码等短生命周期数据使用."""
import os
from functools import lru_cache

import redis
from dotenv import load_dotenv

load_dotenv()


@lru_cache(maxsize=1)
def get_redis() -> redis.Redis:
    url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    return redis.Redis.from_url(url, decode_responses=True)
