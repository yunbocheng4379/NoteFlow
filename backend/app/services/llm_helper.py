"""轻量 LLM 调用封装，用于非视频管线的一次性文本生成（融合笔记、闪记卡等）。

与 UniversalGPT.summarize 不同，这里不涉及分片、截图、checkpoint 等视频笔记特有逻辑，
直接复用 chat_service.chat() 里验证过的 provider -> ModelConfig -> GPTFactory 调用方式。
"""
from app.gpt.gpt_factory import GPTFactory
from app.models.model_config import ModelConfig
from app.services.provider import ProviderService


def simple_completion(provider_id: str, model_name: str, messages: list[dict], temperature: float = 0.7) -> str:
    """执行一次不带工具调用的 chat completion，返回纯文本内容。"""
    provider = ProviderService.get_provider_by_id(provider_id)
    if not provider:
        raise ValueError(f"未找到模型供应商: {provider_id}")

    config = ModelConfig(
        api_key=provider["api_key"],
        base_url=provider["base_url"],
        model_name=model_name,
        provider=provider["type"],
        name=provider["name"],
    )
    gpt = GPTFactory.from_config(config)
    response = gpt.client.chat.completions.create(
        model=gpt.model,
        messages=messages,
        temperature=temperature,
    )
    return response.choices[0].message.content or ""
