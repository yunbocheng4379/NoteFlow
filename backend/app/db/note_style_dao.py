from typing import Optional, List

from sqlalchemy import or_

from app.db.engine import get_db
from app.db.models.note_style import NoteStyle
from app.db.models.note_style_versions import NoteStyleVersion


def _fmt(value):
    return value.isoformat() if hasattr(value, "isoformat") and value else value


def _version_dict(version: NoteStyleVersion) -> dict:
    return {
        "version_id": version.id,
        "version_no": version.version_no,
        "name": version.name,
        "value": version.value,
        "description": version.description,
        "prompt": version.prompt,
        "icon": version.icon,
        "version_status": version.status,
        "ai_status": version.ai_status,
        "ai_risk_level": version.ai_risk_level,
        "ai_categories": version.ai_categories,
        "ai_summary": version.ai_summary,
        "ai_recommendations": version.ai_recommendations,
        "submitted_at": _fmt(version.submitted_at),
    }


def _to_dict(s: NoteStyle, version: Optional[NoteStyleVersion] = None) -> dict:
    payload = {
        "id": s.id,
        "name": s.name,
        "value": s.value,
        "description": s.description,
        "prompt": s.prompt,
        "source": s.source,
        "user_id": s.user_id,
        "is_public": bool(s.published_version_id) and not bool(s.is_deleted),
        "moderation_status": s.moderation_status,
        "published_version_id": s.published_version_id,
        "pending_version_id": s.pending_version_id,
        "review_reason": s.review_reason,
        "reviewed_at": _fmt(s.reviewed_at),
        "icon": s.icon,
        "created_at": _fmt(s.created_at),
    }
    if version is not None:
        payload.update(_version_dict(version))
    return payload


def _content_version(db, style: NoteStyle, *, public: bool = False) -> Optional[NoteStyleVersion]:
    version_id = style.published_version_id if public else style.pending_version_id
    if version_id:
        version = db.query(NoteStyleVersion).filter(NoteStyleVersion.id == version_id).first()
        if version:
            return version
    return None


def _visible_dict(db, style: NoteStyle, user_id: Optional[int]) -> dict:
    if style.source == "system":
        return _to_dict(style)
    is_owner = style.user_id == user_id
    if is_owner:
        version = _content_version(db, style, public=False)
        return _to_dict(style, version=version)
    version = _content_version(db, style, public=True)
    return _to_dict(style, version=version)


def get_styles(
    user_id: Optional[int],
    category: Optional[str] = None,  # system | user | public
    keyword: Optional[str] = None,
) -> List[dict]:
    db = next(get_db())
    try:
        q = db.query(NoteStyle)
        q = q.filter(NoteStyle.is_deleted.is_(False))

        if category == "system":
            q = q.filter(NoteStyle.source == "system")
        elif category == "user":
            q = q.filter(NoteStyle.source == "user", NoteStyle.user_id == user_id)
        elif category == "public":
            q = q.filter(
                NoteStyle.source == "user",
                NoteStyle.published_version_id.isnot(None),
            )
        else:
            # "all" — system + this user's custom + public
            q = q.filter(
                or_(
                    NoteStyle.source == "system",
                    NoteStyle.user_id == user_id,
                    NoteStyle.published_version_id.isnot(None),
                )
            )

        if keyword:
            kw = f"%{keyword}%"
            q = q.filter(
                or_(NoteStyle.name.like(kw), NoteStyle.description.like(kw))
            )

        styles = q.order_by(NoteStyle.source.asc(), NoteStyle.id.asc()).all()
        return [_visible_dict(db, s, user_id) for s in styles]
    finally:
        db.close()


def get_style_by_value(value: str, user_id: Optional[int] = None) -> Optional[dict]:
    db = next(get_db())
    try:
        system = (
            db.query(NoteStyle)
            .filter(NoteStyle.value == value, NoteStyle.source == "system", NoteStyle.is_deleted.is_(False))
            .first()
        )
        if system:
            return _to_dict(system)

        if user_id is not None:
            own = (
                db.query(NoteStyle)
                .filter(
                    NoteStyle.value == value,
                    NoteStyle.source == "user",
                    NoteStyle.user_id == user_id,
                    NoteStyle.is_deleted.is_(False),
                )
                .first()
            )
            if own:
                return _visible_dict(db, own, user_id)

        published = (
            db.query(NoteStyle, NoteStyleVersion)
            .join(NoteStyleVersion, NoteStyleVersion.id == NoteStyle.published_version_id)
            .filter(
                NoteStyleVersion.value == value,
                NoteStyleVersion.status == "PUBLISHED",
                NoteStyle.source == "user",
                NoteStyle.is_deleted.is_(False),
            )
            .order_by(NoteStyleVersion.id.desc())
            .first()
        )
        if published:
            return _to_dict(published[0], version=published[1])
        return None
    finally:
        db.close()


def create_style(
    name: str,
    value: str,
    prompt: str,
    user_id: int,
    description: Optional[str] = None,
    is_public: bool = False,
    icon: Optional[str] = None,
) -> dict:
    db = next(get_db())
    try:
        s = NoteStyle(
            name=name,
            value=value,
            prompt=prompt,
            user_id=user_id,
            description=description,
            is_public=is_public,
            icon=icon,
            source="user",
            moderation_status="DRAFT",
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        version = NoteStyleVersion(
            style_id=s.id,
            version_no=1,
            name=name,
            value=value,
            description=description,
            prompt=prompt,
            icon=icon,
            status="DRAFT",
        )
        db.add(version)
        db.flush()
        s.pending_version_id = version.id
        db.commit()
        db.refresh(s)
        return _visible_dict(db, s, user_id)
    finally:
        db.close()


def can_manage_style(style: NoteStyle, user_id: int, is_admin: bool = False) -> bool:
    """Return whether a user may mutate the supplied style record."""
    if style.source == "system":
        return bool(is_admin)
    return style.source == "user" and style.user_id == user_id


def _get_manageable_style(db, style_id: int, user_id: int, is_admin: bool) -> Optional[NoteStyle]:
    styles = db.query(NoteStyle).filter_by(id=style_id, is_deleted=False).all()
    for style in styles:
        if can_manage_style(style, user_id=user_id, is_admin=is_admin):
            return style
    return None


def update_style(style_id: int, user_id: int, is_admin: bool = False, **kwargs) -> Optional[dict]:
    db = next(get_db())
    try:
        s = _get_manageable_style(db, style_id, user_id=user_id, is_admin=is_admin)
        if not s:
            return None
        if s.source == "system":
            for k, v in kwargs.items():
                if hasattr(s, k) and v is not None:
                    setattr(s, k, v)
            db.commit()
            db.refresh(s)
            return _to_dict(s)

        content_fields = {"name", "description", "prompt", "icon"}
        changed = any(kwargs.get(field) is not None for field in content_fields)
        for k, v in kwargs.items():
            if k in content_fields and v is not None:
                setattr(s, k, v)

        version = _content_version(db, s, public=False)
        if changed:
            if s.moderation_status == "PUBLISHED" and s.published_version_id:
                next_no = (db.query(NoteStyleVersion.version_no)
                            .filter(NoteStyleVersion.style_id == s.id)
                            .order_by(NoteStyleVersion.version_no.desc()).first() or (0,))[0] + 1
                version = NoteStyleVersion(
                    style_id=s.id,
                    version_no=next_no,
                    name=s.name,
                    value=s.value,
                    description=s.description,
                    prompt=s.prompt,
                    icon=s.icon,
                    status="PENDING_REVIEW",
                )
                db.add(version)
                db.flush()
                s.pending_version_id = version.id
                s.moderation_status = "PENDING_REVIEW"
            else:
                if version is None:
                    next_no = (db.query(NoteStyleVersion.version_no)
                               .filter(NoteStyleVersion.style_id == s.id)
                               .order_by(NoteStyleVersion.version_no.desc()).first() or (0,))[0] + 1
                    version = NoteStyleVersion(style_id=s.id, version_no=next_no, status="DRAFT", value=s.value,
                                               name=s.name, description=s.description, prompt=s.prompt, icon=s.icon)
                    db.add(version)
                    db.flush()
                    s.pending_version_id = version.id
                version.name = s.name
                version.value = s.value
                version.description = s.description
                version.prompt = s.prompt
                version.icon = s.icon
                if version.status == "REJECTED":
                    version.status = "DRAFT"
        db.commit()
        db.refresh(s)
        return _visible_dict(db, s, user_id)
    finally:
        db.close()


def delete_style(style_id: int, user_id: int, is_admin: bool = False) -> bool:
    db = next(get_db())
    try:
        s = _get_manageable_style(db, style_id, user_id=user_id, is_admin=is_admin)
        if not s:
            return False
        if s.source == "system":
            s.is_deleted = True
        else:
            s.is_deleted = True
            s.is_public = False
            s.published_version_id = None
            s.pending_version_id = None
            s.review_reason = None
        db.commit()
        return True
    finally:
        db.close()


def toggle_public(style_id: int, user_id: int, is_public: bool) -> Optional[dict]:
    db = next(get_db())
    try:
        s = db.query(NoteStyle).filter_by(id=style_id, user_id=user_id, source="user").first()
        if not s:
            return None
        if is_public:
            # 公开提交由 moderation service 负责，避免前端绕过审核。
            return None
        s.is_public = False
        s.published_version_id = None
        s.pending_version_id = None
        s.moderation_status = "DRAFT"
        s.review_reason = None
        db.commit()
        db.refresh(s)
        return _visible_dict(db, s, user_id)
    finally:
        db.close()


# ── Seeding ─────────────────────────────────────────────────────────────────

SYSTEM_STYLES = [
    {
        "name": "精简",
        "value": "minimal",
        "description": "仅记录最重要的内容，简洁明了。",
        "prompt": "**精简信息**: 仅记录最重要的内容，简洁明了。",
        "icon": "streamline",
    },
    {
        "name": "详细",
        "value": "detailed",
        "description": "包含完整的内容和每个部分的详细讨论。",
        "prompt": "**详细记录**: 包含完整的内容和每个部分的详细讨论。需要尽可能多的记录视频内容，最好详细的笔记。",
        "icon": "detailed",
    },
    {
        "name": "学术",
        "value": "academic",
        "description": "适合学术报告，正式且结构化。",
        "prompt": "**学术风格**: 适合学术报告，正式且结构化。",
        "icon": "academic",
    },
    {
        "name": "教程",
        "value": "tutorial",
        "description": "尽可能详细的记录教程，特别是关键点和重要结论步骤。",
        "prompt": "**教程笔记**: 尽可能详细的记录教程，特别是关键点和一些重要的结论步骤。",
        "icon": "tutorial",
    },
    {
        "name": "小红书",
        "value": "xiaohongshu",
        "description": "小红书爆款风格，emoji + 吸睛标题 + 打卡感。",
        "icon": "book",
        "prompt": """**小红书风格**:
### 擅长使用下面的爆款关键词：
好用到哭，大数据，教科书般，小白必看，宝藏，绝绝子神器，都给我冲,划重点，笑不活了，YYDS，秘方，我不允许，压箱底，建议收藏，停止摆烂，上天在提醒你，挑战全网，手把手，揭秘，普通女生，沉浸式，有手就能做吹爆，好用哭了，搞钱必看，狠狠搞钱，打工人，吐血整理，家人们，隐藏，高级感，治愈，破防了，万万没想到，爆款，永远可以相信被夸爆手残党必备，正确姿势

### 采用二极管标题法创作标题：
- 正面刺激法:产品或方法+只需1秒 (短期)+便可开挂（逆天效果）
- 负面刺激法:你不XXX+绝对会后悔 (天大损失) +(紧迫感)

### 写作技巧
1. 使用惊叹号、省略号等标点符号增强表达力，营造紧迫感和惊喜感。
2. **使用emoji表情符号，来增加文字的活力**
3. 采用具有挑战性和悬念的表述，引发读者好奇心
4. 融入热点话题和实用工具，提高文章的实用性和时效性
5. 描述具体的成果和效果，强调标题中的关键词""",
    },
    {
        "name": "生活向",
        "value": "life_journal",
        "description": "记录个人生活感悟，情感化表达。",
        "prompt": "**生活向**: 记录个人生活感悟，情感化表达。",
        "icon": "life",
    },
    {
        "name": "任务导向",
        "value": "task_oriented",
        "description": "强调任务、目标，适合工作和待办事项。",
        "prompt": "**任务导向**: 强调任务、目标，适合工作和待办事项。",
        "icon": "task",
    },
    {
        "name": "商业风格",
        "value": "business",
        "description": "适合商业报告、会议纪要，正式且精准。",
        "prompt": "**商业风格**: 适合商业报告、会议纪要，正式且精准。",
        "icon": "business",
    },
    {
        "name": "会议纪要",
        "value": "meeting_minutes",
        "description": "适合商业报告、会议纪要，正式且精准。",
        "prompt": "**会议纪要**: 适合商业报告、会议纪要，正式且精准。",
        "icon": "meeting",
    },
]


def seed_system_styles():
    db = next(get_db())
    try:
        for item in SYSTEM_STYLES:
            existing = db.query(NoteStyle).filter_by(value=item["value"], source="system").first()
            if not existing:
                s = NoteStyle(
                    name=item["name"],
                    value=item["value"],
                    description=item["description"],
                    prompt=item["prompt"],
                    icon=item.get("icon"),
                    source="system",
                    user_id=None,
                    is_public=False,
                )
                db.add(s)
            elif not existing.is_deleted and not existing.icon and item.get("icon"):
                # 补齐旧版本 seed 遗留的空 icon 字段
                existing.icon = item["icon"]
        db.commit()
    finally:
        db.close()
