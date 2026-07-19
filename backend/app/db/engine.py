import os
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "环境变量 DATABASE_URL 未配置。"
        "请在 .env 中设置，例如：DATABASE_URL=mysql+pymysql://user:pass@host:3306/noteflow"
    )


def _quote_mysql_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


def _ensure_mysql_database_exists(database_url: str) -> None:
    url = make_url(database_url)
    if not url.drivername.startswith("mysql"):
        return
    if not url.database:
        return

    database_name = url.database
    server_url = url.set(database="")
    server_engine = create_engine(
        server_url,
        echo=os.getenv("SQLALCHEMY_ECHO", "false").lower() == "true",
        pool_pre_ping=True,
        isolation_level="AUTOCOMMIT",
    )
    try:
        with server_engine.connect() as conn:
            conn.execute(
                text(
                    "CREATE DATABASE IF NOT EXISTS "
                    f"{_quote_mysql_identifier(database_name)} "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
    finally:
        server_engine.dispose()


_ensure_mysql_database_exists(DATABASE_URL)

engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("SQLALCHEMY_ECHO", "false").lower() == "true",
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_engine():
    return engine


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
