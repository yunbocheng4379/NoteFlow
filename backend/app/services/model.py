from typing import Optional, TYPE_CHECKING

from app.db.model_dao import insert_model, get_all_models, get_model_by_provider_and_name, delete_model, update_model
from app.db.provider_dao import get_enabled_providers
from app.enmus.exception import ProviderErrorEnum
from app.exceptions.provider import ProviderError
from app.gpt.gpt_factory import GPTFactory
from app.gpt.provider.OpenAI_compatible_provider import OpenAICompatibleProvider
from app.models.model_config import ModelConfig
from app.services.provider import ProviderService
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.db.models.users import User

logger = get_logger(__name__)


class ModelService:

    @staticmethod
    def _build_model_config(provider: dict) -> ModelConfig:
        return ModelConfig(
            api_key=provider["api_key"],
            base_url=provider["base_url"],
            provider=provider["name"],
            model_name='',
            name=provider["name"],
        )

    @staticmethod
    def get_model_list(provider_id: int, verbose: bool = False):
        provider = ProviderService.get_provider_by_id(provider_id)
        if not provider:
            return []
        return ModelService.get_model_list_with_provider(provider, verbose=verbose)

    @staticmethod
    def get_model_list_with_provider(provider: dict, verbose: bool = False):
        try:
            config = ModelService._build_model_config(provider)
            gpt = GPTFactory().from_config(config)
            models = gpt.list_models()
            if verbose:
                print(f"[{provider['name']}] 模型列表: {models}")
            return models
        except Exception as e:
            print(f"[{provider['name']}] 获取模型失败: {e}")
            return []

    @staticmethod
    def get_all_models(verbose: bool = False, tier_filter: Optional[list] = None):
        try:
            raw_models = get_all_models(tier_filter=tier_filter)
            if verbose:
                print(f"所有模型列表: {raw_models}")
            return ModelService._format_models(raw_models)
        except Exception as e:
            print(f"获取所有模型失败: {e}")
            return []

    @staticmethod
    def get_all_models_safe(verbose: bool = False, tier_filter: Optional[list] = None):
        try:
            raw_models = get_all_models(tier_filter=tier_filter)
            if verbose:
                print(f"所有模型列表: {raw_models}")
            return ModelService._format_models(raw_models)
        except Exception as e:
            print(f"获取所有模型失败: {e}")
            return []

    @staticmethod
    def _format_models(raw_models: list) -> list:
        formatted = []
        for model in raw_models:
            formatted.append({
                "id": model.get("id"),
                "provider_id": model.get("provider_id"),
                "model_name": model.get("model_name"),
                "tier": model.get("tier", "normal"),
                "supports_reasoning": bool(model.get("supports_reasoning", False)),
                "supports_vision": bool(model.get("supports_vision", False)),
                "created_at": model.get("created_at", None),
            })
        return formatted

    @staticmethod
    def get_enabled_models_by_provider(provider_id: str | int, tier_filter: Optional[list] = None):
        from app.db.model_dao import get_models_by_provider
        return get_models_by_provider(provider_id, tier_filter=tier_filter)

    @staticmethod
    def get_all_models_by_id(provider_id: str, verbose: bool = False, user_id: Optional[int] = None,
                              api_key: Optional[str] = None):
        try:
            provider = ProviderService.get_provider_by_id(provider_id)
            if not provider:
                return {"models": []}

            # use passed api_key (unsaved form value) if DB value is empty
            if api_key:
                provider = {**provider, "api_key": api_key}

            raw = ModelService.get_model_list_with_provider(provider, verbose=verbose)

            if isinstance(raw, list):
                items = raw
            else:
                items = list(getattr(raw, 'data', []))

            serializable_models = []
            for m in items:
                if hasattr(m, 'model_dump'):
                    serializable_models.append(m.model_dump())
                elif hasattr(m, 'dict'):
                    serializable_models.append(m.dict())
                else:
                    serializable_models.append(dict(m))

            logger.info(f"[{provider['name']}] 获取模型成功, 共 {len(serializable_models)} 个")
            return {"models": serializable_models}
        except Exception as e:
            logger.error(f"[{provider_id}] 获取模型失败: {e}")
            return {"models": []}

    @staticmethod
    def connect_test(id: str, model: str | None = None, user_id: Optional[int] = None,
                     api_key: Optional[str] = None, base_url: Optional[str] = None) -> bool:
        provider = ProviderService.get_provider_by_id(id)
        if not provider:
            raise ProviderError(
                code=ProviderErrorEnum.NOT_FOUND.code,
                message=ProviderErrorEnum.NOT_FOUND.message,
            )

        # prefer values passed directly (e.g. unsaved form state) over DB values
        effective_api_key = api_key or provider.get('api_key')
        effective_base_url = base_url or provider.get('base_url')

        if not effective_api_key:
            raise ProviderError(
                code=ProviderErrorEnum.WRONG_PARAMETER.code,
                message="请先填写 API Key 再测试连通性",
            )

        if not model:
            saved_models = ModelService.get_enabled_models_by_provider(provider["id"])
            if not saved_models:
                raise ProviderError(
                    code=ProviderErrorEnum.WRONG_PARAMETER.code,
                    message="请先为该供应商添加至少一个模型再测试连通性",
                )
            model = saved_models[0]["model_name"]

        ok = OpenAICompatibleProvider.test_connection(
            api_key=effective_api_key,
            base_url=effective_base_url,
            model=model,
            user_id=user_id,
            provider_id=provider["id"],
            provider_name=provider.get("name", ""),
        )
        if ok:
            return True
        raise ProviderError(
            code=ProviderErrorEnum.WRONG_PARAMETER.code,
            message=ProviderErrorEnum.WRONG_PARAMETER.message,
        )

    @staticmethod
    def delete_model_by_id(model_id: int) -> bool:
        try:
            delete_model(model_id)
            return True
        except Exception as e:
            print(f"[{model_id}] 删除失败: {e}")
            return False

    @staticmethod
    def add_new_model(provider_id: int, model_name: str, tier: str = "normal", supports_reasoning: bool = False,
                      supports_vision: bool = False, created_by: Optional[int] = None) -> str:
        """新增或更新全局模型（仅管理员可调用）；created_by 记录操作的管理员 id
        模型已存在时视为「保存模型」的修改场景，直接更新其 tier / supports_reasoning / supports_vision，而不是报错拒绝
        返回 "ok" / "updated" / "provider_not_found" / "error"，供路由层区分提示文案"""
        try:
            provider = ProviderService.get_provider_by_id(provider_id)
            if not provider:
                print(f"供应商ID {provider_id} 不存在，无法添加模型")
                return "provider_not_found"

            existing = get_model_by_provider_and_name(provider_id, model_name)
            if existing:
                update_model(existing["id"], tier=tier, supports_reasoning=int(supports_reasoning),
                             supports_vision=int(supports_vision))
                print(f"模型 {model_name} 已存在于供应商ID {provider_id} 下，已更新等级/深度思考/视觉配置")
                return "updated"

            insert_model(provider_id=provider_id, model_name=model_name, tier=tier,
                         supports_reasoning=int(supports_reasoning), supports_vision=int(supports_vision),
                         created_by=created_by)
            print(f"模型 {model_name} 已成功添加到供应商ID {provider_id}")
            return "ok"
        except Exception as e:
            print(f"添加模型失败: {e}")
            return "error"

    @staticmethod
    def set_model_tier(model_id: int, tier: str) -> bool:
        from app.db.model_dao import update_model_tier
        if tier not in ("normal", "pro"):
            raise ValueError("tier 只能是 normal 或 pro")
        return update_model_tier(model_id, tier)

    @staticmethod
    def set_model_supports_reasoning(model_id: int, enabled: bool) -> bool:
        from app.db.model_dao import update_model_supports_reasoning
        return update_model_supports_reasoning(model_id, enabled)

    @staticmethod
    def set_model_supports_vision(model_id: int, enabled: bool) -> bool:
        from app.db.model_dao import update_model_supports_vision
        return update_model_supports_vision(model_id, enabled)

    @staticmethod
    def assert_model_accessible(provider_id: str, model_name: str, user: "User") -> None:
        """校验当前用户是否有权限使用该模型；Pro 模型仅 Pro 会员可用"""
        from app.db.model_dao import get_model_by_provider_and_name
        model = get_model_by_provider_and_name(provider_id, model_name)
        if model and model.get("tier") == "pro" and not user.active_subscription_id:
            raise ProviderError(
                code=ProviderErrorEnum.WRONG_PARAMETER.code,
                message="该模型仅限 Pro 会员使用，请先升级 Pro",
            )
