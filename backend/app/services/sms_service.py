"""
阿里云短信 (SMS) 发送封装.
=====================================
配置来自环境变量:
  ALIYUN_SMS_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_ID
  ALIYUN_SMS_ACCESS_KEY_SECRET / ALIBABA_CLOUD_ACCESS_KEY_SECRET
  ALIYUN_SMS_SIGN_NAME       短信签名 (需在阿里云控制台审核通过)
  ALIYUN_SMS_TEMPLATE_CODE   短信模板 code, 模板内容需含 ${code} 变量
  ALIYUN_SMS_ENDPOINT         默认 dysmsapi.aliyuncs.com
  ALIYUN_SMS_REGION          默认 cn-hangzhou

设计取舍: 与 mailer.py 一致 —— 发送失败只记日志返回 False, 不抛异常;
由调用方 (auth.py 路由) 决定是否转换为业务错误返回给前端。
"""
import json
import os

from alibabacloud_dysmsapi20170525.client import Client as DysmsapiClient
from alibabacloud_dysmsapi20170525 import models as dysmsapi_models
from alibabacloud_tea_openapi import models as open_api_models

from app.utils.logger import get_logger

logger = get_logger(__name__)


def _mask_phone(phone: str) -> str:
    if len(phone) < 7:
        return "*" * len(phone)
    return phone[:3] + "****" + phone[-4:]


def _get_client() -> DysmsapiClient | None:
    # 优先使用项目专用变量，同时兼容阿里云官方示例使用的标准变量名。
    access_key_id = os.getenv("ALIYUN_SMS_ACCESS_KEY_ID") or os.getenv(
        "ALIBABA_CLOUD_ACCESS_KEY_ID"
    )
    access_key_secret = os.getenv("ALIYUN_SMS_ACCESS_KEY_SECRET") or os.getenv(
        "ALIBABA_CLOUD_ACCESS_KEY_SECRET"
    )
    if not access_key_id or not access_key_secret:
        logger.warning(
            "阿里云短信未配置 (ALIYUN_SMS_ACCESS_KEY_ID/SECRET 或 "
            "ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET 缺失)，跳过发送短信"
        )
        return None

    region = os.getenv("ALIYUN_SMS_REGION", "cn-hangzhou")
    endpoint = os.getenv("ALIYUN_SMS_ENDPOINT", "dysmsapi.aliyuncs.com")
    config = open_api_models.Config(
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        region_id=region,
        endpoint=endpoint,
        connect_timeout=5_000,
        read_timeout=10_000,
    )
    return DysmsapiClient(config)


def send_verification_sms(phone: str, code: str) -> bool:
    """发送验证码短信. 失败只记日志, 返回 False (调用方负责转换为业务错误)."""
    client = _get_client()
    if client is None:
        return False

    sign_name = os.getenv("ALIYUN_SMS_SIGN_NAME")
    template_code = os.getenv("ALIYUN_SMS_TEMPLATE_CODE")
    if not sign_name or not template_code:
        logger.warning(
            "阿里云短信签名/模板未配置 "
            "(ALIYUN_SMS_SIGN_NAME/TEMPLATE_CODE 缺失)，跳过发送短信"
        )
        return False

    request = dysmsapi_models.SendSmsRequest(
        phone_numbers=phone,
        sign_name=sign_name,
        template_code=template_code,
        template_param=json.dumps({"code": code}),
    )
    try:
        response = client.send_sms(request)
        body = getattr(response, "body", None)
        response_code = getattr(body, "code", None)
        response_message = getattr(body, "message", None)
        if response_code == "OK":
            logger.info(f"短信验证码已发送: phone={_mask_phone(phone)}")
            return True
        logger.error(
            f"短信发送失败: phone={_mask_phone(phone)}, "
            f"code={response_code}, message={response_message}"
        )
        return False
    except Exception as e:
        logger.error(f"短信发送异常: phone={_mask_phone(phone)}, error={e}")
        return False
