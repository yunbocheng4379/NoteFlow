from openai import OpenAI

from app.gpt.base import GPT
from app.gpt.provider.OpenAI_compatible_provider import OpenAICompatibleProvider
from app.gpt.universal_gpt import UniversalGPT
from app.models.model_config import ModelConfig
from app.services.ai_usage_pricing import fingerprint_secret, mask_secret
from app.services.ai_usage_service import AIUsageContext


class GPTFactory:
    @staticmethod
    def from_config(
        config: ModelConfig,
        user_id: int | None = None,
        provider_id: str | None = None,
        usage_context: AIUsageContext | None = None,
    ) -> GPT:
        client = OpenAICompatibleProvider(api_key=config.api_key, base_url=config.base_url).get_client
        context: AIUsageContext = {
            "user_id": user_id,
            "provider_id": provider_id,
            "provider_name": config.name,
            "model_name": config.model_name,
            "key_fingerprint": fingerprint_secret(config.api_key),
            "key_masked": mask_secret(config.api_key),
        }
        if usage_context:
            context.update(usage_context)
        return UniversalGPT(client=client, model=config.model_name, user_id=user_id, usage_context=context)
