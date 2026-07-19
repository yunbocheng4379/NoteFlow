# middlewares/exception_handler.py

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse

from app.enmus.exception import NoteErrorEnum
from app.exceptions.biz_exception import BizException
from app.exceptions.note import NoteError
from app.exceptions.provider import ProviderError
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R
import traceback

logger = get_logger(__name__)

def register_exception_handlers(app: FastAPI):
    @app.exception_handler(BizException)
    async def biz_exception_handler(request: Request, exc: BizException):
        logger.error(f"BizException: {exc.code} - {exc.message}")
        return R.error(code=exc.code, msg=str(exc.message))
    @app.exception_handler(NoteError)
    async def note_exception_handler(request: Request, exc: NoteError):
        logger.error(f"NoteError: {exc.code} - {exc.message}")
        return R.error(code=exc.code, msg=str(exc.message))
    @app.exception_handler(ProviderError)
    async def provider_exception_handler(request: Request, exc: ProviderError):
        logger.error(f"供应商模块错误: {exc.code} - {exc.message}")
        return R.error(code=exc.code, msg=str(exc.message))

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        # 将 FastAPI 默认的 {"detail": ...} 包成统一的 {code, msg, data}
        # 这样前端 axios 响应拦截器能从 res.msg 拿到精确的错误话术并 toast.error。
        msg = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.status_code, "msg": msg, "data": None},
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        logger.error(f"系统异常: {str(exc)}\n{traceback.format_exc()}")
        return R.error(code=500000, msg="系统异常")