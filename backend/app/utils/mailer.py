"""
简单的 SMTP 邮件发送封装。

设计取舍: 用标准库 smtplib，不引入第三方邮件 SDK；发信失败只记日志，
绝不向上抛异常影响主流程 (笔记生成不能因为发邮件失败而报错)。
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.header import Header
from email.utils import formataddr, parseaddr

from app.utils.logger import get_logger

logger = get_logger(__name__)


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not domain:
        return "*" * len(email)
    if len(local) <= 2:
        masked_local = local[:1] + "*"
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked_local}@{domain}"


def send_email(to: str, subject: str, html_body: str) -> bool:
    """
    发送一封 HTML 邮件。

    :param to: 收件人邮箱地址
    :param subject: 邮件主题
    :param html_body: HTML 格式正文
    :return: 是否发送成功 (失败只记日志，不抛异常)
    """
    host = os.getenv("SMTP_HOST")
    port = os.getenv("SMTP_PORT")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM") or user

    if not host or not port or not user or not password:
        logger.warning("SMTP 未配置 (SMTP_HOST/PORT/USER/PASSWORD 缺失)，跳过发送邮件")
        return False

    if not to:
        logger.warning("收件人邮箱为空，跳过发送邮件")
        return False

    name, addr = parseaddr(sender)
    msg = MIMEText(html_body, "html", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr((str(Header(name, "utf-8")), addr)) if name else addr
    msg["To"] = to

    try:
        with smtplib.SMTP_SSL(host, int(port), timeout=10) as server:
            server.login(user, password)
            server.sendmail(addr, [to], msg.as_string())
        logger.info(f"邮件已发送: to={_mask_email(to)}, subject={subject}")
        return True
    except Exception as e:
        logger.error(f"邮件发送失败: to={_mask_email(to)}, subject={subject}, error={e}")
        return False


def send_task_completed_email(to: str, title: str, task_id: str) -> bool:
    """笔记生成完成通知邮件。"""
    frontend_url = os.getenv("FRONTEND_URL", "http://127.0.0.1:3015")
    link = f"{frontend_url}/tasks"
    subject = f"笔记生成完成：{title}" if title else "笔记生成完成"
    html_body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #167a6e;">你的笔记已生成完成</h2>
      <p><strong>{title or '未命名视频'}</strong> 的笔记已经生成好了。</p>
      <p><a href="{link}" style="color: #167a6e;">点击查看笔记</a></p>
      <p style="color: #999; font-size: 12px;">来自 BiliNote AI 笔记系统</p>
    </div>
    """
    return send_email(to=to, subject=subject, html_body=html_body)


def send_update_log_email(to: str, title: str, summary: str, version: str = None) -> bool:
    """系统公告 (更新日志发布) 通知邮件。"""
    frontend_url = os.getenv("FRONTEND_URL", "http://127.0.0.1:3015")
    link = f"{frontend_url}/update-logs"
    subject = f"系统公告：{title}" if title else "系统公告"
    version_html = f'<p style="color: #666; font-size: 13px;">版本 {version}</p>' if version else ""
    html_body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #167a6e;">系统公告：{title or '更新通知'}</h2>
      {version_html}
      <p>{summary or ''}</p>
      <p><a href="{link}" style="color: #167a6e;">查看完整更新日志</a></p>
      <p style="color: #999; font-size: 12px;">来自 BiliNote AI 笔记系统</p>
    </div>
    """
    return send_email(to=to, subject=subject, html_body=html_body)


def send_verification_code_email(to: str, code: str) -> bool:
    """登录/绑定验证码邮件。"""
    subject = "BiliNote 验证码"
    html_body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #167a6e;">你的验证码</h2>
      <p style="font-size: 28px; font-weight: 600; letter-spacing: 4px; color: #0f172a;">{code}</p>
      <p style="color: #666; font-size: 13px;">验证码 5 分钟内有效，请勿告知他人。</p>
      <p style="color: #999; font-size: 12px;">来自 BiliNote AI 笔记系统</p>
    </div>
    """
    return send_email(to=to, subject=subject, html_body=html_body)
