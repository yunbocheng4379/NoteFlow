import logging
import os
import sys
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path


def _positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


# 日志目录。Docker 中由 backend_logs 卷挂载到 /app/logs，宿主机运行时可通过
# NOTEFLOW_LOG_DIR 指定绝对路径，避免因为启动目录不同而写到意外位置。
LOG_DIR = Path(os.getenv("NOTEFLOW_LOG_DIR", "logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_RETENTION_DAYS = _positive_int_env("NOTEFLOW_LOG_RETENTION_DAYS", 14)
LOG_LEVEL_NAME = os.getenv("NOTEFLOW_LOG_LEVEL", "INFO").upper()
LOG_LEVEL = getattr(logging, LOG_LEVEL_NAME, logging.INFO)
if not isinstance(LOG_LEVEL, int):
    LOG_LEVEL = logging.INFO

# 日志格式
formatter = logging.Formatter(
    fmt="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

def _build_file_handler(path: Path, level: int) -> TimedRotatingFileHandler:
    handler = TimedRotatingFileHandler(
        path,
        when="midnight",
        interval=1,
        backupCount=LOG_RETENTION_DAYS,
        encoding="utf-8",
        delay=True,
    )
    handler.setLevel(level)
    handler.setFormatter(formatter)
    handler._noteflow_handler = True
    return handler


def configure_logging() -> None:
    """统一配置根日志器，让业务、标准库和 Uvicorn 日志进入同一套文件。"""
    root_logger = logging.getLogger()
    root_logger.setLevel(LOG_LEVEL)

    managed_kinds = {
        getattr(handler, "_noteflow_kind", None)
        for handler in root_logger.handlers
        if getattr(handler, "_noteflow_handler", False)
    }

    if "console" not in managed_kinds:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(LOG_LEVEL)
        console_handler.setFormatter(formatter)
        console_handler._noteflow_handler = True
        console_handler._noteflow_kind = "console"
        root_logger.addHandler(console_handler)

    if "app" not in managed_kinds:
        app_handler = _build_file_handler(LOG_DIR / "app.log", LOG_LEVEL)
        app_handler._noteflow_kind = "app"
        root_logger.addHandler(app_handler)

    if "error" not in managed_kinds:
        error_handler = _build_file_handler(LOG_DIR / "error.log", logging.ERROR)
        error_handler._noteflow_kind = "error"
        root_logger.addHandler(error_handler)

    # uvicorn 的默认 log_config 可能给自己的 logger 绑定独立 handler；这里让
    # 其日志向 root 传播，避免 access/error 日志只存在 docker logs 中。
    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        named_logger = logging.getLogger(logger_name)
        named_logger.setLevel(LOG_LEVEL)
        named_logger.propagate = True


configure_logging()

def get_logger(name: str) -> logging.Logger:
    configure_logging()
    logger = logging.getLogger(name)
    logger.setLevel(logging.NOTSET)
    logger.propagate = True
    return logger
