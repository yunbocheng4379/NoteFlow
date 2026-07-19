"""
平台级 cookie 池 DAO.

DAO 层职责:
- 接收明文 cookie 字符串, 入库前加密.
- 返回给上层 (Service / 路由) 的 dict 中, cookie 字段是明文 (因为调用方要么是
  downloader 用, 要么是管理员 UI 查看, 都需要明文).
- 加密失败抛 CookieEncryptionError, 不吞.

DAO 不缓存; 缓存由 ``CookiePoolManager`` 在更上层做.
"""
import json
from datetime import datetime
from typing import List, Optional, Tuple

from app.db.engine import get_db
from app.db.models.platform_cookies import PlatformCookie
from app.utils.encryption import CookieEncryption


def _parse_tier_list(raw) -> List[str]:
    """reserved_for_tier 在 DB 里是 TEXT (JSON). 解析失败/None → [] 表示全部 tier."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        v = json.loads(raw)
        if isinstance(v, list):
            return [str(x) for x in v]
    except Exception:
        pass
    return []


def _iso(dt) -> Optional[str]:
    """datetime / None → ISO 字符串. 跨 SQLite/MySQL 兼容 — MySQL 返回 datetime 对象,
    SQLite 返回 ISO 字符串, 统一转成 ISO 字符串再交给前端 / JSONResponse."""
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    try:
        return dt.isoformat(timespec="seconds")
    except Exception:
        return str(dt)


def _to_dict(row: PlatformCookie, include_plaintext_cookie: bool = True) -> dict:
    d = {
        "id": row.id,
        "platform": row.platform,
        "name": row.name,
        "remark": row.remark,
        "cohort": getattr(row, "cohort", "default") or "default",
        "reserved_for_tier": _parse_tier_list(getattr(row, "reserved_for_tier", None)),
        "max_concurrent_uses": getattr(row, "max_concurrent_uses", 0) or 0,
        "in_use_count": getattr(row, "in_use_count", 0) or 0,
        "is_enabled": row.is_enabled,
        "is_marked_invalid": row.is_marked_invalid,
        "weight": row.weight,
        "failure_count": row.failure_count,
        "success_count": row.success_count,
        "usage_count": row.usage_count,
        "last_used_at": _iso(row.last_used_at),
        "last_failure_at": _iso(row.last_failure_at),
        "configured_by": row.configured_by,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }
    if include_plaintext_cookie:
        try:
            d["cookie"] = CookieEncryption.decrypt(row.cookie_value_encrypted)
        except Exception:
            # 解密失败时用 None 顶, 不让上游 try/except 撞坏; 调用方按 None 走.
            d["cookie"] = None
    return d


def create_cookie(
    *,
    platform: str,
    name: str,
    cookie: str,
    weight: int = 100,
    remark: Optional[str] = None,
    configured_by: Optional[int] = None,
    cohort: str = "default",
    reserved_for_tier: Optional[List[str]] = None,
    max_concurrent_uses: int = 0,
) -> dict:
    """新增平台 cookie. cookie 必须是明文; 入库前加密."""
    if not cookie or not cookie.strip():
        raise ValueError("cookie 不能为空")
    enc = CookieEncryption.encrypt(cookie.strip())

    tier_json = json.dumps(list(reserved_for_tier or []), ensure_ascii=False)

    db = next(get_db())
    try:
        row = PlatformCookie(
            platform=platform,
            name=name.strip(),
            cookie_value_encrypted=enc,
            remark=(remark or None),
            cohort=(cohort or "default").strip(),
            reserved_for_tier=tier_json,
            max_concurrent_uses=max(0, int(max_concurrent_uses or 0)),
            is_enabled=1,
            is_marked_invalid=0,
            weight=max(1, min(int(weight or 100), 1000)),
            configured_by=configured_by,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def bulk_create(*, platform: str, items: list, configured_by: Optional[int] = None) -> int:
    """批量导入同平台的 cookie 池. items = [{name, cookie, weight?, remark?}, ...]
    返回实际写入行数. name 重复时去重 (同导入批次内 + DB 已有).
    """
    if not items:
        return 0
    db = next(get_db())
    try:
        # 读取已存在 name, 用于去重
        existing = {
            r.name for r in
            db.query(PlatformCookie.name).filter(PlatformCookie.platform == platform).all()
        }

        inserted = 0
        skipped = []
        seen_in_batch = set()
        for it in items:
            name = (it.get("name") or "").strip()
            cookie = (it.get("cookie") or "").strip()
            if not name or not cookie:
                skipped.append(name or "<unnamed>")
                continue
            if name in existing or name in seen_in_batch:
                skipped.append(name)
                continue
            seen_in_batch.add(name)
            tier_json = json.dumps(list(it.get("reserved_for_tier") or []), ensure_ascii=False)
            db.add(PlatformCookie(
                platform=platform,
                name=name,
                cookie_value_encrypted=CookieEncryption.encrypt(cookie),
                remark=it.get("remark"),
                cohort=(it.get("cohort") or "default").strip(),
                reserved_for_tier=tier_json,
                max_concurrent_uses=max(0, int(it.get("max_concurrent_uses") or 0)),
                is_enabled=1,
                is_marked_invalid=0,
                weight=max(1, min(int(it.get("weight") or 100), 1000)),
                configured_by=configured_by,
            ))
            inserted += 1
        db.commit()
        return inserted
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_by_id(cookie_id: int) -> Optional[dict]:
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        return _to_dict(row) if row else None
    finally:
        db.close()


def list_filter(
    *,
    platform: Optional[str] = None,
    include_invalid: bool = True,
    page: int = 1,
    page_size: int = 20,
    keyword: Optional[str] = None,
    cohort: Optional[str] = None,
) -> Tuple[List[dict], int]:
    """分页查询. include_invalid=False 时过滤掉 is_marked_invalid=1 的.
    返回 (items, total). items 中包含明文 cookie (管理员视图).
    """
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 20

    db = next(get_db())
    try:
        q = db.query(PlatformCookie)
        if platform:
            q = q.filter(PlatformCookie.platform == platform)
        if not include_invalid:
            q = q.filter(PlatformCookie.is_marked_invalid == 0)
        if cohort:
            q = q.filter(PlatformCookie.cohort == cohort)
        if keyword:
            like = f"%{keyword.strip()}%"
            q = q.filter(
                (PlatformCookie.name.like(like)) | (PlatformCookie.remark.like(like))
            )

        total = q.count()
        rows = (
            q.order_by(PlatformCookie.platform.asc(), PlatformCookie.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return [_to_dict(r) for r in rows], total
    finally:
        db.close()


def list_available(platform: str, *, tier: Optional[str] = None) -> List[dict]:
    """仅返回可用 cookie (is_enabled=1 && is_marked_invalid=0), 返回明文 cookie.

    - ``tier`` 非空: 过滤 reserved_for_tier 包含该 tier 或为空 (表示全部 tier 开放)
    - 自动过滤: max_concurrent_uses>0 且 in_use_count >= max_concurrent_uses 的
    """
    db = next(get_db())
    try:
        rows = (
            db.query(PlatformCookie)
            .filter(
                PlatformCookie.platform == platform,
                PlatformCookie.is_enabled == 1,
                PlatformCookie.is_marked_invalid == 0,
            )
            .all()
        )
        result = []
        for r in rows:
            # tier 过滤
            tiers = _parse_tier_list(getattr(r, "reserved_for_tier", None))
            if tier is not None and tiers and tier not in tiers:
                continue
            # 并发配额过滤
            quota = getattr(r, "max_concurrent_uses", 0) or 0
            in_use = getattr(r, "in_use_count", 0) or 0
            if quota > 0 and in_use >= quota:
                continue
            result.append(_to_dict(r))
        return result
    finally:
        db.close()


def update_cookie(
    *,
    cookie_id: int,
    name: Optional[str] = None,
    remark: Optional[str] = None,
    is_enabled: Optional[bool] = None,
    weight: Optional[int] = None,
    cohort: Optional[str] = None,
    reserved_for_tier: Optional[List[str]] = None,
    max_concurrent_uses: Optional[int] = None,
) -> Optional[dict]:
    """可更新字段: name / remark / is_enabled / weight / cohort / tier / quota.
    cookie_value 单独走 set_cookie_value 接口. tier 传 [] 表示对所有 tier 开放.
    """
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        if not row:
            return None
        if name is not None:
            row.name = name.strip()
        if remark is not None:
            row.remark = remark or None
        if is_enabled is not None:
            row.is_enabled = 1 if is_enabled else 0
        if weight is not None:
            row.weight = max(1, min(int(weight), 1000))
        if cohort is not None:
            row.cohort = (cohort or "default").strip()
        if reserved_for_tier is not None:
            row.reserved_for_tier = json.dumps(list(reserved_for_tier), ensure_ascii=False)
        if max_concurrent_uses is not None:
            row.max_concurrent_uses = max(0, int(max_concurrent_uses))
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def reset_state(cookie_id: int) -> bool:
    """管理员重置: 清失效标记 + 连续失败次数 + in_use 计数."""
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        if not row:
            return False
        row.is_marked_invalid = 0
        row.failure_count = 0
        row.in_use_count = 0
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def delete_cookie(cookie_id: int) -> bool:
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        if not row:
            return False
        db.delete(row)
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def summary_by_platform() -> dict:
    """返回每个平台的 total / available / invalid 数. 用于 Dashboard.
    返回: {platform: {total, available, invalid, enabled}}.
    """
    db = next(get_db())
    try:
        rows = db.query(PlatformCookie).all()
        result = {}
        for r in rows:
            slot = result.setdefault(
                r.platform,
                {"total": 0, "enabled": 0, "available": 0, "invalid": 0},
            )
            slot["total"] += 1
            if r.is_enabled:
                slot["enabled"] += 1
            if r.is_marked_invalid:
                slot["invalid"] += 1
            elif r.is_enabled:
                slot["available"] += 1
        return result
    finally:
        db.close()


# ===== 失败/成功上报 (Service 层调用) =====

def increment_success(cookie_id: int) -> None:
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        if not row:
            return
        row.success_count = (row.success_count or 0) + 1
        row.usage_count = (row.usage_count or 0) + 1
        # 一次成功就抹平连续失败
        row.failure_count = 0
        row.is_marked_invalid = 0
        # 释放 in_use
        in_use = getattr(row, "in_use_count", 0) or 0
        if in_use > 0:
            row.in_use_count = in_use - 1
        row.last_used_at = datetime.now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def increment_failure(cookie_id: int, *, threshold: int = 3) -> bool:
    """失败自增. 当 failure_count 达到 threshold 时自动置为 invalid.
    返回: True 表示这次失败导致「cookie 被标记为失效」 (供调用方 publish notification).
    """
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        if not row:
            return False
        row.failure_count = (row.failure_count or 0) + 1
        row.usage_count = (row.usage_count or 0) + 1
        row.last_used_at = datetime.now()
        row.last_failure_at = datetime.now()
        # 失败 = 释放一次 in_use 占用
        if (row.in_use_count or 0) > 0:
            row.in_use_count = row.in_use_count - 1
        newly_invalid = False
        if row.failure_count >= threshold and not row.is_marked_invalid:
            row.is_marked_invalid = 1
            newly_invalid = True
        db.commit()
        return newly_invalid
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def increment_in_use(cookie_id: int) -> bool:
    """pick 时 +1, 表示此 cookie 正在被一个任务使用. 配额已满时返回 False.
    若字段缺失 (旧 schema 升级) — 静默视为 0, 不阻塞 pick.
    """
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        if not row:
            return False
        quota = getattr(row, "max_concurrent_uses", 0) or 0
        in_use = getattr(row, "in_use_count", 0) or 0
        if quota > 0 and in_use >= quota:
            return False
        row.in_use_count = in_use + 1
        row.last_used_at = datetime.now()
        db.commit()
        return True
    except Exception:
        db.rollback()
        return False
    finally:
        db.close()


def decrement_in_use(cookie_id: int) -> None:
    """success/failure 时 -1, 释放一次占用."""
    db = next(get_db())
    try:
        row = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
        if not row:
            return
        in_use = getattr(row, "in_use_count", 0) or 0
        if in_use > 0:
            row.in_use_count = in_use - 1
        db.commit()
    except Exception:
        db.rollback()
        pass
    finally:
        db.close()
