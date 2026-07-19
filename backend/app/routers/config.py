import os
import platform
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel
from typing import Optional

from app.auth.dependencies import get_current_user
from app.db import transcriber_config_dao
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R
from app.utils.logger import get_logger
from app.utils.path_helper import get_model_dir
from ffmpeg_helper import ensure_ffmpeg_or_raise

logger = get_logger(__name__)

router = APIRouter()


class CookieUpdateRequest(BaseModel):
    platform: str
    cookie: str


class CookieGoneResponse(BaseModel):
    code: int = 41001
    msg: str = "此接口已下线，Cookie 配置迁移到管理员后台的「Cookie 池」管理"


@router.get("/get_downloader_cookie/{platform}", deprecated=True)
def get_cookie(platform: str):
    """Deprecated: 个人 cookie 配置已下线. 改为管理员后台 Cookie 池统一管理.

    返回 41001 让前端 axios 拦截器看到非 0 code 时能识别为「已下线, 不要重试」.
    """
    return R.error(
        code=41001,
        msg=f"个人 {platform} cookie 配置已下线，请联系管理员在「Cookie 池」后台维护",
    )


@router.post("/update_downloader_cookie", deprecated=True)
def update_cookie(data: CookieUpdateRequest):
    """Deprecated: 个人 cookie 配置已下线."""
    return R.error(
        code=41001,
        msg=f"个人 {data.platform} cookie 配置已下线，请联系管理员在「Cookie 池」后台维护",
    )


class TranscriberConfigRequest(BaseModel):
    transcriber_type: str
    whisper_model_size: Optional[str] = None


AVAILABLE_TRANSCRIBER_TYPES = [
    {"value": "fast-whisper", "label": "Faster Whisper（本地）"},
    {"value": "bcut", "label": "必剪（在线）"},
    {"value": "kuaishou", "label": "快手（在线）"},
    {"value": "groq", "label": "Groq（在线）"},
    {"value": "mlx-whisper", "label": "MLX Whisper（仅macOS）"},
]

WHISPER_MODEL_SIZES = ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"]


@router.get("/transcriber_config")
def get_transcriber_config(current_user: User = Depends(get_current_user)):
    try:
        from app.transcriber.transcriber_provider import MLX_WHISPER_AVAILABLE

        config = transcriber_config_dao.get_transcriber_config(current_user.id)
        return R.success(data={
            **config,
            "available_types": AVAILABLE_TRANSCRIBER_TYPES,
            "whisper_model_sizes": WHISPER_MODEL_SIZES,
            "mlx_whisper_available": MLX_WHISPER_AVAILABLE,
        })
    except Exception as e:
        logger.error(f"获取转写配置失败: {e}", exc_info=True)
        return R.error(msg="获取转写配置失败，请刷新页面重试")


@router.post("/transcriber_config")
def update_transcriber_config(data: TranscriberConfigRequest, current_user: User = Depends(get_current_user)):
    try:
        config = transcriber_config_dao.update_transcriber_config(
            user_id=current_user.id,
            transcriber_type=data.transcriber_type,
            whisper_model_size=data.whisper_model_size,
        )
        return R.success(data=config)
    except Exception as e:
        logger.error(f"更新转写配置失败: {e}", exc_info=True)
        return R.error(msg="更新转写配置失败，请重试")


# ---- Whisper 模型下载状态 & 下载触发 ----

_downloading: dict[str, str] = {}


def _check_whisper_model_exists(model_size: str, subdir: str = "whisper") -> bool:
    model_dir = Path(get_model_dir(subdir))
    hf_repo_dir = model_dir / f"models--Systran--faster-whisper-{model_size}" / "snapshots"
    if hf_repo_dir.exists():
        for snapshot in hf_repo_dir.iterdir():
            if (snapshot / "model.bin").exists():
                return True
    legacy = model_dir / f"whisper-{model_size}" / "model.bin"
    return legacy.exists()


def _check_mlx_whisper_model_exists(model_size: str) -> bool:
    try:
        from app.transcriber.mlx_whisper_transcriber import MLX_MODEL_MAP
    except Exception:
        return False
    repo_id = MLX_MODEL_MAP.get(model_size)
    if not repo_id:
        return False
    model_dir = get_model_dir("mlx-whisper")
    model_path = os.path.join(model_dir, repo_id)
    return (Path(model_path) / "config.json").exists()


@router.get("/transcriber_models_status")
def get_transcriber_models_status():
    statuses = []
    for size in WHISPER_MODEL_SIZES:
        downloaded = _check_whisper_model_exists(size, "whisper")
        download_status = _downloading.get(size)
        statuses.append({
            "model_size": size,
            "downloaded": downloaded,
            "downloading": download_status == "downloading",
        })

    mlx_available = platform.system() == "Darwin"
    mlx_statuses = []
    if mlx_available:
        try:
            from app.transcriber.mlx_whisper_transcriber import MLX_MODEL_MAP
        except Exception:
            # macOS 但未安装 mlx_whisper（如非 Apple Silicon 或未装依赖）：
            # 视为不可用，返回空列表而非抛错。
            MLX_MODEL_MAP = None
            mlx_available = False
        if MLX_MODEL_MAP is not None:
            for size in WHISPER_MODEL_SIZES:
                mlx_key = f"mlx-{size}"
                repo_id = MLX_MODEL_MAP.get(size)
                downloaded = _check_mlx_whisper_model_exists(size)
                mlx_statuses.append({
                    "model_size": size,
                    "downloaded": downloaded,
                    "downloading": _downloading.get(mlx_key) == "downloading",
                    "available": repo_id is not None,
                })

    return R.success(data={
        "whisper": statuses,
        "mlx_whisper": mlx_statuses,
        "mlx_available": mlx_available,
    })


class ModelDownloadRequest(BaseModel):
    model_size: str
    transcriber_type: str = "fast-whisper"


def _do_download_whisper(model_size: str):
    from huggingface_hub import snapshot_download

    try:
        _downloading[model_size] = "downloading"
        model_dir = get_model_dir("whisper")

        if _check_whisper_model_exists(model_size, "whisper"):
            _downloading[model_size] = "done"
            return
        repo_id = f"Systran/faster-whisper-{model_size}"
        logger.info(f"开始下载 whisper 模型: {repo_id}")
        snapshot_download(
            repo_id,
            cache_dir=model_dir,
            allow_patterns=["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"],
        )
        logger.info(f"whisper 模型下载完成: {model_size}")
        _downloading[model_size] = "done"
    except Exception as e:
        logger.error(f"whisper 模型下载失败: {model_size}, {e}")
        _downloading[model_size] = "failed"


def _do_download_mlx_whisper(model_size: str):
    key = f"mlx-{model_size}"
    try:
        _downloading[key] = "downloading"
        from huggingface_hub import snapshot_download as hf_download
        from app.transcriber.mlx_whisper_transcriber import resolve_mlx_repo_id

        try:
            repo_id = resolve_mlx_repo_id(model_size)
        except ValueError as e:
            logger.error(str(e))
            _downloading[key] = "failed"
            return

        model_dir = get_model_dir("mlx-whisper")
        model_path = os.path.join(model_dir, repo_id)
        if (Path(model_path) / "config.json").exists():
            _downloading[key] = "done"
            return
        logger.info(f"开始下载 mlx-whisper 模型: {model_size} ← {repo_id}")
        hf_download(repo_id, local_dir=model_path, local_dir_use_symlinks=False)
        logger.info(f"mlx-whisper 模型下载完成: {model_size}")
        _downloading[key] = "done"
    except Exception as e:
        logger.error(f"mlx-whisper 模型下载失败: {model_size}, {e}")
        _downloading[key] = "failed"


@router.post("/transcriber_download")
def download_transcriber_model(data: ModelDownloadRequest, background_tasks: BackgroundTasks):
    if data.model_size not in WHISPER_MODEL_SIZES:
        return R.error(msg=f"不支持的模型大小: {data.model_size}")

    if data.transcriber_type == "mlx-whisper":
        if platform.system() != "Darwin":
            return R.error(msg="MLX Whisper 仅支持 macOS")
        key = f"mlx-{data.model_size}"
        if _downloading.get(key) == "downloading":
            return R.success(msg="模型正在下载中")
        background_tasks.add_task(_do_download_mlx_whisper, data.model_size)
    else:
        if _downloading.get(data.model_size) == "downloading":
            return R.success(msg="模型正在下载中")
        background_tasks.add_task(_do_download_whisper, data.model_size)

    return R.success(msg="模型下载已开始")


@router.get("/sys_health")
async def sys_health():
    ffmpeg_status = "ok"
    try:
        ensure_ffmpeg_or_raise()
    except Exception:
        ffmpeg_status = "missing"

    db_status = "ok"
    try:
        from app.db.engine import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    whisper_info: dict = {"size": None, "type": None, "downloaded": False, "checked": False}
    try:
        # sys_health 使用 user_id=1 的配置（系统级健康检查，不依赖当前用户）
        cfg = transcriber_config_dao.get_transcriber_config(1)
        size = cfg["whisper_model_size"]
        ttype = cfg["transcriber_type"]
        whisper_info["size"] = size
        whisper_info["type"] = ttype
        if ttype == "fast-whisper":
            whisper_info["downloaded"] = _check_whisper_model_exists(size, "whisper")
            whisper_info["checked"] = True
        elif ttype == "mlx-whisper":
            whisper_info["downloaded"] = _check_mlx_whisper_model_exists(size)
            whisper_info["checked"] = True
    except Exception:
        pass

    return R.success(data={
        "backend": "ok",
        "ffmpeg": ffmpeg_status,
        "db": db_status,
        "whisper_model": whisper_info,
    })


@router.get("/sys_check")
async def sys_check():
    return R.success()


@router.get("/deploy_status")
async def deploy_status():
    import os

    try:
        import torch
        cuda_available = torch.cuda.is_available()
        cuda_info = {
            "available": cuda_available,
            "torch_installed": True,
            "version": torch.version.cuda if cuda_available else None,
            "gpu_name": torch.cuda.get_device_name(0) if cuda_available else None,
        }
    except Exception:
        cuda_info = {"available": False, "torch_installed": False, "version": None, "gpu_name": None}

    try:
        cfg = transcriber_config_dao.get_transcriber_config(1)
        size = cfg["whisper_model_size"]
        ttype = cfg["transcriber_type"]
        if ttype == "fast-whisper":
            downloaded = _check_whisper_model_exists(size, "whisper")
        elif ttype == "mlx-whisper":
            downloaded = _check_mlx_whisper_model_exists(size)
        else:
            downloaded = False
        whisper_info = {"model_size": size, "transcriber_type": ttype, "downloaded": downloaded}
    except Exception:
        whisper_info = {"model_size": None, "transcriber_type": None, "downloaded": False}

    try:
        ensure_ffmpeg_or_raise()
        ffmpeg_ok = True
    except Exception:
        ffmpeg_ok = False

    return R.success(data={
        "backend": {"status": "running", "port": int(os.getenv("BACKEND_PORT", 8483))},
        "cuda": cuda_info,
        "whisper": whisper_info,
        "ffmpeg": {"available": ffmpeg_ok},
    })
