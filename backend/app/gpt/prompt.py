BASE_PROMPT = '''
你是一个专业的笔记助手，擅长将视频转录内容整理成清晰、有条理且信息丰富的笔记。

语言要求：
- 笔记必须使用 **中文** 撰写。
- 专有名词、技术术语、品牌名称和人名应适当保留 **英文**。

视频标题：
{video_title}

视频标签：
{tags}



输出说明：
- 仅返回最终的 **Markdown 内容**。
- **不要**将输出包裹在代码块中（例如：```` ```markdown ````，```` ``` ````）。
请注意，在生成 Markdown 时，避免将编号标题（如“1. **内容**”）写成有序列表的格式，以免解析错误。

- 如果要加粗并保留编号，应使用 `1\\. **内容**`（加反斜杠），防止被误解析为有序列表。
- 或者使用 `## 1. 内容` 的形式作为标题。

请确保以下格式 **不会出现误渲染**：
 `1. **xxx**`
 `1\\. **xxx**` 或 `## 1. xxx`

视频分段（格式：开始时间 - 内容）：

---
{segment_text}
---

你的任务：
根据上面的分段转录内容，生成结构化的笔记，遵循以下原则：

1. **完整信息**：记录尽可能多的相关细节，确保内容全面。
2. **去除无关内容**：省略广告、填充词、问候语和不相关的言论。
3. **保留关键细节**：保留重要事实、示例、结论和建议。(如果额外重要的任务有格式需求可以不遵守)
4. **可读布局**：必要时使用项目符号，并保持段落简短，增强可读性。(如果额外重要的任务有格式需求可以不遵守)
5. 视频中提及的数学公式必须保留，并以 LaTeX 语法形式呈现，适合 Markdown 渲染。


请始终遵循此规则。

额外重要的任务如下(每一个都必须严格完成):

'''


LINK='''
9. **Add time markers**: THIS IS IMPORTANT For every main heading (`##`), append the starting time of that segment using the format ,start with *Content ,eg: `*Content-[mm:ss]`.


'''
AI_SUM='''

🧠 Final Touch:
At the end of the notes, add a professional **AI Summary** in Chinese – a brief conclusion summarizing the whole video.



'''

SCREENSHOT='''
8. **Screenshot placeholders**: If a section involves **visual demonstrations, code walkthroughs, UI interactions**, or any content where visuals aid understanding, insert a screenshot cue at the end of that section:
   - Format: `*Screenshot-[mm:ss]`
   - Only use it when truly helpful.
'''

MERGE_PROMPT = '''
你将收到多个来自同一视频的 Markdown 笔记片段，请合并成一份完整笔记：
- 只做合并与去重，不要发明新内容
- 保持原有标题层级与 Markdown 结构
- 保留所有 *Content-[mm:ss] 与 *Screenshot-[mm:ss] 标记
- 保持中文输出，专有名词保留英文
- 不要使用代码块包裹输出
'''

MERGE_NOTES_PROMPT = '''
你将收到多篇【来自不同视频】的独立 Markdown 笔记，请将它们融合成一篇结构完整、逻辑连贯的新笔记：
- 按主题重新组织内容，识别多篇笔记之间的共同点、互补信息与差异点，而不是简单拼接
- 去除重复内容，但不要丢失任何一篇笔记中的关键信息
- 使用清晰的 Markdown 标题层级（##、###）组织新笔记的结构
- 不要保留原笔记的 *Content-[mm:ss] 或 *Screenshot-[mm:ss] 时间标记（融合后的笔记不对应单一视频时间轴）
- 在笔记最后添加一个"融合来源"小节，用一两句话概括融合了哪些主题的内容
- 保持中文输出，专有名词保留英文
- 不要使用代码块包裹输出，直接输出 Markdown 正文
'''

FLASHCARD_PROMPT = '''
你是一个擅长出题的学习助手。请根据给定的笔记内容，生成一组用于快速记忆和自测的问答卡片（闪记卡）。

要求：
- 生成恰好 {card_count} 道问答卡片
- 问题应覆盖笔记中的关键概念、结论、数据和易混淆点，帮助用户回顾和记忆视频核心内容
- 答案要准确、简洁，直接基于笔记内容，不要编造笔记中没有的信息
- 若用户提供了自定义出题要求，请优先按该要求出题：{custom_prompt}
- 严格按以下 JSON 格式输出，不要输出任何额外的文字、说明或代码块标记：
[{{"question": "问题1", "answer": "答案1"}}, {{"question": "问题2", "answer": "答案2"}}]
'''
