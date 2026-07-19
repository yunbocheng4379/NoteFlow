import enum


class ProviderErrorEnum(enum.Enum):
    CONNECTION_TEST_FAILED = (200101, "供应商连接测试失败")
    SAVE_FAILED = (200102, "供应商保存失败")
    CREATE_FAILED = (200103, "供应商创建失败")
    NOT_FOUND = (200104, "供应商不存在/未保存")
    WRONG_PARAMETER = (200105, "API / API 地址不正确")
    UNKNOW_ERROR = (200106, "未知错误")

    def __init__(self, code, message):
        self.code = code
        self.message = message

class NoteErrorEnum(enum.Enum):
    PLATFORM_NOT_SUPPORTED = (300101, "选择的平台不受支持")
    DOWNLOAD_FAILED        = (300102, "视频下载失败")
    TRANSCRIBE_FAILED      = (300103, "语音转写失败")
    LLM_FAILED             = (300104, "AI 笔记生成失败")
    PROVIDER_NOT_FOUND     = (300105, "未找到对应的 AI 供应商")
    COOKIE_REQUIRED        = (300106, "下载失败：需要配置平台 Cookie")

    def __init__(self, code, message):
        self.code = code
        self.message = message