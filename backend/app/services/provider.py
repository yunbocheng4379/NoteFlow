from fastapi.encoders import jsonable_encoder
from kombu import uuid
from typing import Optional

from app.db.models.providers import Provider
from app.db.provider_dao import (
    insert_provider,
    get_all_providers,
    get_provider_by_name,
    get_provider_by_id,
    update_provider,
    delete_provider,
    get_enabled_providers,
)
from app.gpt.gpt_factory import GPTFactory
from app.models.model_config import ModelConfig


class ProviderService:

    @staticmethod
    def serialize_provider(row: Provider) -> dict:
        if not row:
            return None
        row = ProviderService.provider_to_dict(row)
        return {
            "id": row.get("id"),
            "name": row.get("name"),
            "logo": row.get("logo"),
            "type": row.get("type"),
            "enabled": row.get("enabled"),
            "base_url": row.get("base_url"),
            "api_key": row.get("api_key"),
            "created_at": jsonable_encoder(row.get("created_at")),
        }

    @staticmethod
    def serialize_provider_safe(row: Provider) -> dict:
        if not row:
            return None
        row = ProviderService.provider_to_dict(row)
        return {
            "id": row.get("id"),
            "name": row.get("name"),
            "logo": row.get("logo"),
            "type": row.get("type"),
            "enabled": row.get("enabled"),
            "base_url": row.get("base_url"),
            "api_key": ProviderService.mask_key(row.get("api_key")),
            "created_at": jsonable_encoder(row.get("created_at")),
        }

    @staticmethod
    def mask_key(key: str) -> str:
        if not key or len(key) < 8:
            return '*' * len(key)
        return key[:4] + '*' * (len(key) - 8) + key[-4:]

    @staticmethod
    def add_provider(name: str, api_key: str, base_url: str, logo: str, type_: str,
                     enabled: int = 1, user_id: Optional[int] = None):
        """新增全局供应商（仅管理员可调用）；user_id 记录配置人，仅用于追溯"""
        try:
            if type_ != 'custom':
                type_ = 'custom'
            existing = get_provider_by_name(name)
            if existing is not None:
                raise ValueError(f'供应商名称已存在: {name}')
            id = uuid().lower()
            logo = 'custom'
            return insert_provider(id, name, api_key, base_url, logo, type_, enabled, user_id=user_id)
        except Exception as e:
            print('创建模式失败', e)
            raise

    @staticmethod
    def provider_to_dict(p: Provider):
        return {
            "id": p.id,
            "name": p.name,
            "logo": p.logo,
            "type": p.type,
            "api_key": p.api_key,
            "base_url": p.base_url,
            "enabled": p.enabled,
            "created_at": p.created_at,
        }

    @staticmethod
    def get_all_providers():
        rows = get_all_providers()
        if rows is None:
            return []
        return [ProviderService.serialize_provider(row) for row in rows] if rows else []

    @staticmethod
    def get_all_providers_safe():
        rows = get_all_providers()
        return [ProviderService.serialize_provider(row) for row in rows] if rows else []

    @staticmethod
    def get_provider_by_name(name: str):
        row = get_provider_by_name(name)
        return ProviderService.serialize_provider(row)

    @staticmethod
    def get_provider_by_id(id: str):
        row = get_provider_by_id(id)
        return ProviderService.serialize_provider(row)

    @staticmethod
    def get_provider_by_id_safe(id: str):
        row = get_provider_by_id(id)
        return ProviderService.serialize_provider_safe(row)

    @staticmethod
    def update_provider(id: str, data: dict, user_id: Optional[int] = None) -> str | None:
        """更新全局供应商（仅管理员可调用）；user_id 记录最近编辑人，仅用于追溯"""
        try:
            filtered_data = {k: v for k, v in data.items() if v is not None and k != 'id'}
            if 'api_key' in filtered_data and '*' in str(filtered_data.get('api_key', '')):
                filtered_data.pop('api_key')
            print('更新模型供应商', filtered_data)
            update_provider(id, user_id=user_id, **filtered_data)
            updated_provider = get_provider_by_id(id)
            if not updated_provider:
                return None
            return {
                'id': id,
                'enabled': updated_provider.enabled,
            }
        except Exception as e:
            print('更新模型供应商失败：', e)
            return None

    @staticmethod
    def delete_provider(id: str):
        return delete_provider(id)
