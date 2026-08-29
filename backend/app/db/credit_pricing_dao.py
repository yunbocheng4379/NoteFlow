"""
模型计费率的 DAO 层，提供 CRUD 能力.
"""
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models.credit_pricing import CreditPricing

DEFAULT_MODEL_INITIAL_RATE = 3  # 新增模型时插入的默认电力单价 (与 __default__ 兜底一致)


def sync_add_model_rate(model_name: str) -> None:
    """
    模型新增时的镜像同步: credit_pricing 里若还没有这条 model_name, 就以默认单价插入.
    已存在则保持不动 (管理员可能已在「电力规则」页面调整过). 幂等.

    这个函数吞掉自身的异常, 不会影响调用方 (model 增删主流程).
    """
    if not model_name or model_name.startswith("__"):  # __default__ / __test_* 都不同步
        return
    # 延迟获取 SessionLocal，避免数据库引擎在测试隔离或热重载后仍引用旧连接。
    from app.db.engine import SessionLocal

    db = SessionLocal()
    try:
        dao = CreditPricingDAO(db)
        if not dao.get_by_model_name(model_name):
            dao.create(
                model_name=model_name,
                rate_per_minute=DEFAULT_MODEL_INITIAL_RATE,
                is_active=1,
                is_default=0,
                description=None,
            )
    except Exception:
        from app.utils.logger import get_logger
        get_logger(__name__).exception(f"sync_add_model_rate({model_name}) 失败, 已忽略")
    finally:
        db.close()


def sync_remove_model_rate_if_orphan(model_name: str) -> None:
    """
    模型删除时的镜像同步: 若 models 表里已经没有任何 provider 还持有这个 model_name,
    就把 credit_pricing 里对应的行也删掉. 若还有 provider 在用, 保留费率行.
    __default__ 永远不删. 幂等.
    """
    if not model_name or model_name.startswith("__"):
        return
    # 与新增同步保持一致，使用调用时当前的数据库引擎。
    from app.db.engine import SessionLocal

    db = SessionLocal()
    try:
        from app.db.models.models import Model
        still_used = db.execute(
            select(Model.id).where(Model.model_name == model_name).limit(1)
        ).first()
        if still_used:
            return
        CreditPricingDAO(db).delete(model_name)
    except Exception:
        from app.utils.logger import get_logger
        get_logger(__name__).exception(f"sync_remove_model_rate_if_orphan({model_name}) 失败, 已忽略")
    finally:
        db.close()


class CreditPricingDAO:
    def __init__(self, db: Session):
        self.db = db

    # ---- 查询 ----

    def get_all(self) -> list[CreditPricing]:
        from app.db.models.models import Model

        registered_names = {
            name for name in self.db.scalars(select(Model.model_name)).all() if name
        }
        rows = self.db.scalars(select(CreditPricing).order_by(CreditPricing.id.asc())).all()
        return [
            row for row in rows
            if row.model_name == "__default__" or row.model_name in registered_names
        ]

    def prune_orphan_model_rates(self) -> int:
        """删除费率表中已不存在于 models 表的孤儿模型费率。"""
        from app.db.models.models import Model

        registered_names = {
            name for name in self.db.scalars(select(Model.model_name)).all() if name
        }
        rows = self.db.scalars(select(CreditPricing)).all()
        orphans = [
            row for row in rows
            if row.model_name != "__default__" and row.model_name not in registered_names
        ]
        for row in orphans:
            self.db.delete(row)
        self.db.commit()
        return len(orphans)

    def get_by_model_name(self, model_name: str) -> Optional[CreditPricing]:
        stmt = select(CreditPricing).where(CreditPricing.model_name == model_name)
        return self.db.execute(stmt).scalars().first()

    # ---- 内部: 保证全表至多一条 is_default=1 ----

    def _clear_other_defaults(self, exclude_model_name: Optional[str] = None) -> None:
        stmt = update(CreditPricing).values(is_default=0)
        if exclude_model_name:
            stmt = stmt.where(CreditPricing.model_name != exclude_model_name)
        self.db.execute(stmt)

    # ---- 增 ----

    def create(
        self,
        model_name: str,
        rate_per_minute: int,
        is_active: int = 1,
        is_default: int = 0,
        description: Optional[str] = None,
    ) -> CreditPricing:
        if is_default:
            self._clear_other_defaults()
        row = CreditPricing(
            model_name=model_name,
            rate_per_minute=rate_per_minute,
            is_active=is_active,
            is_default=is_default,
            description=description,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    # ---- 改 ----

    def update(
        self,
        model_name: str,
        *,
        rate_per_minute: Optional[int] = None,
        is_active: Optional[int] = None,
        is_default: Optional[int] = None,
        description: Optional[str] = None,
    ) -> Optional[CreditPricing]:
        row = self.get_by_model_name(model_name)
        if not row:
            return None
        if is_default:
            self._clear_other_defaults(exclude_model_name=model_name)
        if rate_per_minute is not None:
            row.rate_per_minute = rate_per_minute
        if is_active is not None:
            row.is_active = is_active
        if is_default is not None:
            row.is_default = is_default
        if description is not None:
            row.description = description
        self.db.commit()
        self.db.refresh(row)
        return row

    # ---- 删 ----

    def delete(self, model_name: str) -> bool:
        row = self.get_by_model_name(model_name)
        if not row:
            return False
        self.db.delete(row)
        self.db.commit()
        return True
