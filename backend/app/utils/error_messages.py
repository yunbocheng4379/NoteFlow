"""
error_messages.py — 统一错误消息翻译工具

规则：
- 每个业务场景有专属的翻译函数，输入原始异常，返回用户可读的中文字符串。
- 调用前必须先用标准 logger 打印完整原始异常（exc_info=True），本模块只负责翻译，不做日志。
- 所有函数均为纯函数，不会抛出异常。
"""
from __future__ import annotations

import traceback
from typing import Optional


def _str(exc: BaseException) -> str:
    return str(exc)


# ─────────────────────────────────────────────
# 通用辅助
# ─────────────────────────────────────────────

def _contains(text: str, *keywords: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in keywords)


# ─────────────────────────────────────────────
# 供应商 / API 连通性
# ─────────────────────────────────────────────

def translate_connect_error(exc: BaseException, provider_name: str = "") -> str:
    raw = _str(exc)
    suffix = f"（{provider_name}）" if provider_name else ""

    if _contains(raw, "401", "unauthorized", "authentication", "invalid api key", "incorrect api key"):
        return f"API Key 无效或已过期，请检查供应商配置{suffix}"
    if _contains(raw, "403", "forbidden"):
        return f"API Key 权限不足，请确认该 Key 是否有调用权限{suffix}"
    if _contains(raw, "429", "rate limit", "quota", "too many requests"):
        return f"请求频率超限或额度不足，请稍后重试{suffix}"
    if _contains(raw, "404", "not found", "model_not_found", "no such model"):
        return f"模型不存在，请检查模型名称是否正确{suffix}"
    if _contains(raw, "connection", "connect", "refused", "timeout", "timed out", "unreachable", "network"):
        return f"无法连接到 API 服务，请检查 Base URL 是否正确，以及网络是否可用{suffix}"
    if _contains(raw, "ssl", "certificate"):
        return f"SSL 证书验证失败，请检查 Base URL 协议{suffix}"
    if _contains(raw, "api key not configured", "api key 未配置", "未配置"):
        return f"未配置 API Key，请先在供应商页面填写 API Key{suffix}"
    if _contains(raw, "供应商不存在", "provider not found", "not_found"):
        return f"供应商不存在或尚未保存，请先保存供应商信息{suffix}"
    if _contains(raw, "请先为该供应商", "no model"):
        return "请先为该供应商添加至少一个模型，再进行连通性测试"

    return f"连通性测试失败，请检查 API Key 和 Base URL 是否正确{suffix}"


# ─────────────────────────────────────────────
# 下载错误
# ─────────────────────────────────────────────

def translate_download_error(exc: BaseException, platform: str = "") -> str:
    raw = _str(exc)
    plat = f"（{platform}）" if platform else ""
    # 结构化标记，前端用正则提取后弹出 Cookie 配置弹窗
    cookie_marker = f"[NEED_COOKIE:{platform}]" if platform else "[NEED_COOKIE]"

    # B站 412 / 登录验证
    if _contains(raw, "412", "precondition failed") and _contains(raw, "bilibili", "b站", "b站"):
        return f"{cookie_marker} 下载失败：B 站要求登录验证，请配置哔哩哔哩 Cookie 后重试"
    if _contains(raw, "412", "precondition failed"):
        return f"{cookie_marker} 下载失败：视频平台返回 412 错误，可能需要登录验证，请配置对应平台的 Cookie{plat}"

    # 登录 / Cookie 类
    if _contains(raw, "login required", "sign in", "cookie", "需要登录", "会员", "ttwid", "风控", "空响应"):
        return f"{cookie_marker} 该视频需要登录或风控触发，请配置对应平台的 Cookie 后重试{plat}"

    # 版权 / 地区限制
    if _contains(raw, "copyright", "geo", "region", "not available in your country", "地区限制"):
        return f"该视频因版权或地区限制无法下载{plat}"

    # 视频不存在 / 已删除
    if _contains(raw, "404", "not found", "video not found", "该视频不存在", "已删除", "unavailable"):
        return f"视频不存在或已被删除，请确认链接是否有效{plat}"

    # 网络超时
    if _contains(raw, "timeout", "timed out", "connection", "network"):
        return f"下载超时或网络异常，请检查网络连接后重试{plat}"

    # 平台不支持
    if _contains(raw, "unsupported url", "不支持", "platform"):
        return f"不支持该视频链接，请确认链接格式是否正确{plat}"

    # yt-dlp 通用提取失败
    if _contains(raw, "unable to extract", "extraction failed", "extractor"):
        return f"视频信息提取失败，可能是平台规则变更或链接格式不支持{plat}"

    return f"视频下载失败，请稍后重试或检查链接是否有效{plat}"


# ─────────────────────────────────────────────
# 音频转写错误
# ─────────────────────────────────────────────

def translate_transcribe_error(exc: BaseException) -> str:
    raw = _str(exc)

    if _contains(raw, "model not found", "模型文件", "model.bin", "尚未下载"):
        return "语音转写模型未下载，请先在「设置 → 音频转写配置」页下载所需模型"
    if _contains(raw, "cuda", "gpu", "out of memory", "oom"):
        return "GPU 内存不足，请尝试切换为更小的 Whisper 模型（如 tiny / base）"
    if _contains(raw, "ffmpeg", "no such file", "not found") and _contains(raw, "ffmpeg"):
        return "FFmpeg 未安装或未找到，请先安装 FFmpeg 并配置系统路径"
    if _contains(raw, "audio", "wav", "mp3", "无法读取", "decode"):
        return "音频文件损坏或格式不支持，请重试或检查视频来源"
    if _contains(raw, "groq", "401", "api key"):
        return "Groq API Key 无效，请在设置中检查 Groq 配置"
    if _contains(raw, "timeout", "timed out"):
        return "语音转写超时，请检查网络或尝试较小的模型"

    return "语音转写失败，请检查转写配置或重试"


# ─────────────────────────────────────────────
# LLM / 笔记生成错误
# ─────────────────────────────────────────────

def translate_llm_error(exc: BaseException, provider_name: str = "") -> str:
    raw = _str(exc)
    suffix = f"（{provider_name}）" if provider_name else ""

    if _contains(raw, "401", "unauthorized", "authentication", "invalid api key", "incorrect api key"):
        return f"AI 模型 API Key 无效或已过期，请重新配置{suffix}"
    if _contains(raw, "402", "insufficient balance", "insufficient_balance", "余额不足", "支付"):
        return (
            f"AI 服务账号余额不足（HTTP 402），请联系管理员充值或切换至其他可用供应商后再试{suffix}"
        )
    if _contains(raw, "429", "rate limit", "quota", "too many requests"):
        return f"AI 服务请求频率超限或额度不足，请稍后重试{suffix}"
    if _contains(raw, "context length", "context window", "max_tokens", "too long", "超出长度"):
        return f"视频内容过长，超出模型上下文限制，请尝试更换支持更长上下文的模型{suffix}"
    if _contains(raw, "connection", "connect", "refused", "timeout", "timed out", "network"):
        return f"无法连接到 AI 服务，请检查网络或代理配置{suffix}"
    if _contains(raw, "404", "model_not_found", "no such model", "not found"):
        return f"模型不存在，请检查模型名称是否正确{suffix}"
    if _contains(raw, "api key not configured", "api key 未配置", "未配置", "未设置"):
        return f"未配置 API Key，请先在供应商页面填写 API Key{suffix}"
    if _contains(raw, "供应商不存在", "provider not found"):
        return "未找到对应的 AI 供应商，请检查供应商配置是否完整"

    return f"AI 笔记生成失败，请检查模型配置或稍后重试{suffix}"


# ─────────────────────────────────────────────
# 模型管理错误
# ─────────────────────────────────────────────

def translate_model_error(exc: BaseException) -> str:
    raw = _str(exc)

    if _contains(raw, "401", "unauthorized", "authentication", "invalid api key"):
        return "API Key 无效，无法获取模型列表，请检查供应商 API Key 配置"
    if _contains(raw, "429", "rate limit"):
        return "请求频率超限，请稍后重试"
    if _contains(raw, "connection", "timeout", "network", "refused"):
        return "无法连接到供应商服务，请检查 Base URL 和网络配置"
    if _contains(raw, "not found", "404"):
        return "模型接口未找到，请检查 Base URL 是否正确"
    if _contains(raw, "duplicate", "already exists", "已存在"):
        return "该模型已添加过，无需重复添加"

    return f"模型操作失败：{raw[:80]}"


# ─────────────────────────────────────────────
# Chat / RAG 问答错误
# ─────────────────────────────────────────────

def translate_chat_error(exc: BaseException) -> str:
    raw = _str(exc)

    if _contains(raw, "not indexed", "未索引", "index"):
        return "该任务的内容尚未完成索引，请稍后再试或重新触发索引"
    if _contains(raw, "401", "unauthorized", "api key"):
        return "AI 问答服务 API Key 无效，请检查所选供应商的配置"
    if _contains(raw, "429", "rate limit", "quota"):
        return "AI 服务请求频率超限，请稍后重试"
    if _contains(raw, "connection", "timeout", "network"):
        return "无法连接到 AI 服务，请检查网络或代理配置"
    if _contains(raw, "供应商不存在", "provider not found"):
        return "未找到对应的 AI 供应商，请检查供应商配置"

    return "AI 问答失败，请稍后重试"


# ─────────────────────────────────────────────
# Cookie / 配置错误
# ─────────────────────────────────────────────

def translate_cookie_error(exc: BaseException) -> str:
    raw = _str(exc)

    if _contains(raw, "platform", "不支持", "unsupported"):
        return "不支持该平台的 Cookie 配置"
    if _contains(raw, "database", "db", "数据库"):
        return "保存 Cookie 失败，数据库写入异常，请重试"

    return f"Cookie 配置操作失败：{raw[:80]}"


# ─────────────────────────────────────────────
# 文件上传错误
# ─────────────────────────────────────────────

def translate_upload_error(exc: BaseException) -> str:
    raw = _str(exc)

    if _contains(raw, "too large", "size", "超出大小"):
        return "上传文件过大，请压缩后重试"
    if _contains(raw, "format", "type", "格式不支持"):
        return "不支持的文件格式，请上传音视频文件"
    if _contains(raw, "permission", "denied", "权限"):
        return "服务器文件写入权限不足，请联系管理员"

    return f"文件上传失败：{raw[:80]}"
