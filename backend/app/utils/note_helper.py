import re


# 视为“目录”小节的标题文本（小写、去标点后比较）
_TOC_TITLES = {
    "目录", "目錄", "目录导航", "章节目录", "本文目录",
    "toc", "contents", "tableofcontents",
}


def _strip_markers(text: str) -> str:
    """去除标题中的 *Content-[mm:ss] / *Screenshot-[mm:ss] 标记及原片跳转链接。"""
    text = re.sub(r"\*?Content-\[?\d{1,2}:\d{2}\]?\*?", "", text)
    text = re.sub(r"\*?Screenshot-\[?\d{1,2}:\d{2}\]?\*?", "", text)
    text = re.sub(r"\[原片[^\]]*\]\([^)]*\)", "", text)
    return text


def _clean_title(text: str) -> str:
    """目录展示文本：去掉标记、原片链接与 markdown 强调符号。"""
    text = _strip_markers(text)
    text = re.sub(r"[*_`~]", "", text)
    return text.strip()


def _toc_anchor(text: str) -> str:
    """
    生成锚点：去掉标记后，仅保留字母/数字/各种文字（含中日韩），转小写。
    与前端目录跳转的模糊匹配（去除标点空格后比对 heading 文本）保持一致。
    """
    text = _strip_markers(text).lower()
    return re.sub(r"[\W_]+", "", text, flags=re.UNICODE)


def rebuild_toc(markdown: str) -> str:
    """
    将 LLM 生成的（可能是加粗文本/纯文本/链接等不一致格式的）目录，
    统一重建为基于真实 `##` / `###` 标题、可点击跳转的 Markdown 链接目录。

    - 锚点使用标题归一化文本，配合前端模糊匹配实现稳定跳转；
    - 会移除原有的“目录”小节，避免重复；
    - 若无显式“目录”小节，则插入到文章主标题（H1）之后。
    """
    if not markdown:
        return markdown

    lines = markdown.split("\n")
    n = len(lines)

    # 标记代码块，避免把代码中的 # 当作标题
    headings: list = [None] * n  # 每行: (level, raw_title) 或 None
    in_code = False
    for i, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        m = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if m:
            headings[i] = (len(m.group(1)), m.group(2).strip())

    # 定位已有“目录”小节（标题 + 其下直到下一个同级/更高级标题）
    toc_start = None
    toc_end = None
    for i in range(n):
        h = headings[i]
        if not h:
            continue
        level, title = h
        if _clean_title(title).lower() in _TOC_TITLES:
            toc_start = i
            toc_end = n
            for j in range(i + 1, n):
                hj = headings[j]
                if hj and hj[0] <= level:
                    toc_end = j
                    break
            break

    # 收集章节标题（排除 H1 主标题与“目录”标题本身）
    entries = []  # (level, clean_title, anchor)
    for i in range(n):
        h = headings[i]
        if not h or i == toc_start:
            continue
        level, title = h
        if level == 1:
            continue
        ct = _clean_title(title)
        if not ct or ct.lower() in _TOC_TITLES:
            continue
        anchor = _toc_anchor(title)
        if not anchor:
            continue
        entries.append((level, ct, anchor))

    if not entries:
        return markdown

    min_level = min(e[0] for e in entries)
    toc_block = ["## 目录", ""]
    for level, ct, anchor in entries:
        indent = "  " * (level - min_level)
        toc_block.append(f"{indent}- [{ct}](#{anchor})")
    toc_block.append("")

    # 移除旧目录小节后，在原位插入；否则插到 H1 之后
    if toc_start is not None:
        del lines[toc_start:toc_end]
        insert_at = toc_start
    else:
        insert_at = 0
        for i, h in enumerate(headings):
            if h and h[0] == 1:
                insert_at = i + 1
                break
        toc_block = [""] + toc_block

    lines[insert_at:insert_at] = toc_block
    return "\n".join(lines)


def prepend_source_link(markdown: str | None, source_url: str) -> str | None:
    """
    在笔记开头添加来源链接；若首个非空行已包含来源链接，则更新该行并避免重复。
    """
    if markdown is None:
        return None

    source = (source_url or "").strip()
    if not source:
        return markdown

    header = f"> 来源链接：{source}"
    lines = markdown.splitlines()
    first_non_empty_idx = None
    for idx, line in enumerate(lines):
        if line.strip():
            first_non_empty_idx = idx
            break

    if first_non_empty_idx is not None:
        first_line = lines[first_non_empty_idx].strip()
        if first_line.startswith("> 来源链接：") or first_line.startswith("来源链接："):
            lines[first_non_empty_idx] = header
            return "\n".join(lines)

    if markdown.strip():
        return f"{header}\n\n{markdown}"
    return header


def replace_content_markers(markdown: str, video_id: str, platform: str = 'bilibili') -> str:
    """
    替换 *Content-04:16*、Content-04:16 或 Content-[04:16] 为超链接，跳转到对应平台视频的时间位置。

    为了避免 markdown 渲染器把孤立的 `*` 当成斜体/粗体标记（之前会在链接后面残留 `*`，
    渲染为黑色字符/方块），正则同时吞掉标记前后的任意数量的 `*`。
    """
    # 匹配前缀可选 `*`（包括 markdown 加粗 `**`）+ Content- + 时间戳（带或不带方括号） + 后缀可选 `*`
    pattern = r"[*]*Content-(?:\[(\d{2}):(\d{2})\]|(\d{2}):(\d{2}))[*]*"

    safe_video_id = video_id

    def replacer(match):
        mm = match.group(1) or match.group(3)
        ss = match.group(2) or match.group(4)
        total_seconds = int(mm) * 60 + int(ss)

        if platform == 'bilibili':
            # 多 P 视频 id 形如 BVxxx_p2 -> BVxxx?p=2；分隔符按是否已有 query 决定 ? / &
            parsed_video_id = safe_video_id.replace("_p", "?p=")
            sep = "&" if "?" in parsed_video_id else "?"
            url = f"https://www.bilibili.com/video/{parsed_video_id}{sep}t={total_seconds}"
        elif platform == 'youtube':
            url = f"https://www.youtube.com/watch?v={safe_video_id}&t={total_seconds}s"
        elif platform == 'douyin':
            # 抖音网页版没有官方文档说明的跳转参数，start_time（秒）是分享链接里实测可用的非官方参数
            url = f"https://www.douyin.com/video/{safe_video_id}?start_time={total_seconds}"
        else:
            return f"({mm}:{ss})"

        return f"[原片 @ {mm}:{ss}]({url})"

    markdown = re.sub(pattern, replacer, markdown)
    return strip_trailing_asterisks_after_links(markdown)


def strip_trailing_asterisks_after_links(markdown: str) -> str:
    """
    清理紧跟在 markdown 链接末尾 `](url)` 后面的孤立 `*` / `**`。

    历史模型输出 `*Content-[mm:ss]*` 时，旧版正则只吞前一个 `*`，导致链接末尾
    留下一个孤立的 `*`，被前端 markdown 渲染器当成斜体/粗体的起始符，
    在标题行末尾渲染为黑色字符/方块。本函数对已经替换过 Content 标记的 markdown
    做一次兜底清理。

    **只会**删除紧跟在 `](...)` 后面、且后接空白/换行/标点/字符串结尾的连续 `*`；
    不影响正文里紧跟其他字符（如加粗 **重要**）的 markdown 强调标记。
    """
    if not markdown:
        return markdown

    SAFE_AFTER = (" ", "\t", "\n", "\r", "，", "。", ",", ".", "；", ";", "、", ":", "：", "）", ")", "!", "！", "?", "？")

    def replacer(match: re.Match) -> str:
        link_part = match.group(1)  # 形如 "](BVxxx?t=0)" 的链接主体（不含末尾 *）
        asterisks = match.group(2)
        after = match.group(3)
        # *+ 之后是空白/换行/标点/字符串结尾 ⇒ 视为孤立，删掉
        if not after or after in SAFE_AFTER:
            return link_part + after
        # 否则保留（如**加粗**）
        return match.group(0)

    # 匹配 ](非右括号)+ + [*]+ + 后面的 0~1 个字符（用于决定后面是什么）
    return re.sub(r"(]\([^)]*\))([*]+)([^\n]?)", replacer, markdown)

