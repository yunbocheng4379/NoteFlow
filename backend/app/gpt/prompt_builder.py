from app.gpt.prompt import BASE_PROMPT

note_formats = [
    {'label': '目录', 'value': 'toc'},
    {'label': '原片跳转', 'value': 'link'},
    {'label': '原片截图', 'value': 'screenshot'},
    {'label': 'AI总结', 'value': 'summary'}
]

# note_styles is kept as a fallback list for cases where DB is unavailable.
# The canonical source of truth is the note_styles table in the DB.
note_styles = [
    {'label': '精简', 'value': 'minimal'},
    {'label': '详细', 'value': 'detailed'},
    {'label': '学术', 'value': 'academic'},
    {'label': '教程', 'value': 'tutorial'},
    {'label': '小红书', 'value': 'xiaohongshu'},
    {'label': '生活向', 'value': 'life_journal'},
    {'label': '任务导向', 'value': 'task_oriented'},
    {'label': '商业风格', 'value': 'business'},
    {'label': '会议纪要', 'value': 'meeting_minutes'}
]


def generate_base_prompt(title, segment_text, tags, _format=None, style=None, extras=None):
    prompt = BASE_PROMPT.format(
        video_title=title,
        segment_text=segment_text,
        tags=tags
    )

    if _format:
        prompt += "\n" + "\n".join([get_format_function(f) for f in _format])

    if style:
        prompt += "\n" + get_style_format(style)

    if extras:
        prompt += "\n" + extras

    return prompt


def get_format_function(format_type):
    format_map = {
        'toc': get_toc_format,
        'link': get_link_format,
        'screenshot': get_screenshot_format,
        'summary': get_summary_format
    }
    return format_map.get(format_type, lambda: '')()


def get_style_format(style):
    try:
        from app.db.note_style_dao import get_style_by_value
        record = get_style_by_value(style)
        if record and record.get("prompt"):
            return record["prompt"]
    except Exception:
        pass

    _fallback = {
        'minimal': '**精简信息**: 仅记录最重要的内容，简洁明了。',
        'detailed': '**详细记录**: 包含完整的内容和每个部分的详细讨论。需要尽可能多的记录视频内容，最好详细的笔记',
        'academic': '**学术风格**: 适合学术报告，正式且结构化。',
        'tutorial': '**教程笔记**: 尽可能详细的记录教程，特别是关键点和一些重要的结论步骤',
        'life_journal': '**生活向**: 记录个人生活感悟，情感化表达。',
        'task_oriented': '**任务导向**: 强调任务、目标，适合工作和待办事项。',
        'business': '**商业风格**: 适合商业报告、会议纪要，正式且精准。',
        'meeting_minutes': '**会议纪要**: 适合商业报告、会议纪要，正式且精准。',
    }
    return _fallback.get(style, '')


def get_toc_format():
    return '''
    9. **目录**: 在文章主标题（H1）下方插入一个二级标题 `## 目录`，其下逐条列出全部章节。
    要求：
    - 每个条目必须使用 Markdown 链接语法，例如 `- [章节标题](#章节标题)`，不要用加粗（**）或纯文本代替链接。
    - 锚点（# 之后的内容）使用对应章节标题原文去掉空格与标点后的文本。
    - 目录仅依据 `##` / `###` 级标题生成，不要包含原片跳转时间标记。
    '''


def get_link_format():
    return '''
    10. **原片跳转**: 为每个主要章节添加时间戳，使用格式 `*Content-[mm:ss]`。
    重要：**始终**在章节标题前加上 `*Content` 前缀，例如：`AI 的发展史 *Content-[01:23]`。一定是标题在前 插入标记在后
    '''


def get_screenshot_format():
    return '''
11. **原片截图**:你收到的截图一般是一个网格，网格的每张图片就是一个时间点，左上角会包含时间mm:ss的格式，请你结合我发你的图片插入截图提示，请你帮助用户更好的理解视频内容，请你认真的分析每个图片和对应的转写文案，插入最合适的内容来备注用户理解，请一定按照这个格式 返回否则系统无法解析：
- 格式：`*Screenshot-[mm:ss]`

    '''


def get_summary_format():
    return '''
    12. **AI总结**: 在笔记末尾加入简短的AI生成总结,并且二级标题 就是 AI 总结 例如 ## AI 总结。
    '''
