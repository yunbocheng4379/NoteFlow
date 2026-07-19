import json
import os
import sys
from typing import Optional

from app.db.models.providers import Provider
from app.utils.logger import get_logger
from app.db.engine import get_engine, Base, get_db

logger = get_logger(__name__)


def get_builtin_providers_path():
    if getattr(sys, 'frozen', False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(__file__)
    return os.path.join(base_path, 'builtin_providers.json')


def seed_default_providers():
    """供应商是全局资源；仅在表为空时做首次播种，不按用户区分。"""
    db = next(get_db())
    try:
        if db.query(Provider).count() > 0:
            logger.info("Providers already exist, skipping seed.")
            return

        json_path = get_builtin_providers_path()
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                providers = json.load(f)
        except Exception as e:
            logger.error(f"Failed to read builtin_providers.json: {e}")
            return

        for p in providers:
            db.add(Provider(
                id=p['id'],
                name=p['name'],
                api_key=p['api_key'],
                base_url=p['base_url'],
                logo=p['logo'],
                type=p['type'],
                enabled=p.get('enabled', 1)
            ))
        db.commit()
        logger.info("Default providers seeded successfully.")
    except Exception as e:
        logger.error(f"Failed to seed default providers: {e}")
    finally:
        db.close()


def insert_provider(id: str, name: str, api_key: str, base_url: str, logo: str, type_: str,
                    enabled: int = 1, user_id: Optional[int] = None):
    """新增全局供应商（仅管理员可调用）；user_id 记录配置人，仅用于追溯"""
    db = next(get_db())
    try:
        provider = Provider(id=id, user_id=user_id, name=name, api_key=api_key,
                            base_url=base_url, logo=logo, type=type_, enabled=enabled)
        db.add(provider)
        db.commit()
        logger.info(f"Provider inserted successfully. id: {id}, name: {name}, type: {type_}")
        return id
    except Exception as e:
        logger.error(f"Failed to insert provider: {e}")
    finally:
        db.close()


def get_enabled_providers():
    db = next(get_db())
    try:
        return db.query(Provider).filter(Provider.enabled == 1).all()
    finally:
        db.close()


def get_provider_by_name(name: str):
    db = next(get_db())
    try:
        return db.query(Provider).filter_by(name=name).first()
    finally:
        db.close()


def get_provider_by_id(id: str):
    db = next(get_db())
    try:
        return db.query(Provider).filter_by(id=id).first()
    finally:
        db.close()


def get_all_providers():
    db = next(get_db())
    try:
        return db.query(Provider).all()
    finally:
        db.close()


def update_provider(id: str, user_id: Optional[int] = None, **kwargs):
    """更新全局供应商（仅管理员可调用）；user_id 记录最近编辑人，仅用于追溯"""
    db = next(get_db())
    try:
        provider = db.query(Provider).filter_by(id=id).first()
        if not provider:
            logger.warning(f"Provider {id} not found for update.")
            return
        for key, value in kwargs.items():
            if hasattr(provider, key):
                setattr(provider, key, value)
        if user_id is not None:
            provider.user_id = user_id
        db.commit()
        logger.info(f"Provider updated successfully. id: {id}, updated_fields: {list(kwargs.keys())}")
    except Exception as e:
        logger.error(f"Failed to update provider: {e}")
    finally:
        db.close()


def delete_provider(id: str):
    db = next(get_db())
    try:
        provider = db.query(Provider).filter_by(id=id).first()
        if provider:
            db.delete(provider)
            db.commit()
            logger.info(f"Provider deleted successfully. id: {id}")
    except Exception as e:
        logger.error(f"Failed to delete provider: {e}")
    finally:
        db.close()
