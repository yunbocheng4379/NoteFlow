import os
import re
from urllib.parse import quote
from markdown_pdf import MarkdownPdf, Section
from dotenv import load_dotenv

load_dotenv()

# 项目根路径（无论你在哪里运行）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 从 .env 获取 DATA_DIR，相对于 BASE_DIR 解析
DATA_DIR_NAME = os.getenv("DATA_DIR", "data")
DATA_DIR = os.path.join(BASE_DIR, DATA_DIR_NAME)
SAVE_PATH = os.path.join(DATA_DIR, "note_output")
IMAGE_BASE_URL = os.getenv("IMAGE_BASE_URL")
STATIC_BASE = os.path.join(BASE_DIR, IMAGE_BASE_URL) if IMAGE_BASE_URL else BASE_DIR


class ExportUtils:
    def __init__(self, **kwargs):
        print(f"保存路径: {SAVE_PATH}")
        print(f"静态文件路径: {STATIC_BASE}")
        if not os.path.exists(SAVE_PATH):
            os.makedirs(SAVE_PATH)

    def _embed_image_as_base64(self, img_path: str) -> str:
        import base64
        import mimetypes

        try:
            mime_type, _ = mimetypes.guess_type(img_path)
            if not mime_type:
                ext = os.path.splitext(img_path)[1].lower()
                mime_map = {
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.bmp': 'image/bmp',
                    '.webp': 'image/webp',
                    '.svg': 'image/svg+xml'
                }
                mime_type = mime_map.get(ext, 'image/png')

            with open(img_path, 'rb') as f:
                img_data = f.read()

            base64_data = base64.b64encode(img_data).decode('utf-8')
            return f"data:{mime_type};base64,{base64_data}"

        except Exception as e:
            print(f"图片 base64 编码失败 {img_path}: {str(e)}")
            return None

    def _get_normalized_path(self, path: str) -> str:
        return os.path.normpath(os.path.abspath(path))

    def _replace_static_paths_with_absolute(self, content: str) -> str:
        def repl(match):
            alt_text = match.group(1) if match.group(1) else ""
            img_path = match.group(2).strip()

            print(f"处理图片路径: {img_path}")

            if img_path.startswith("/static/"):
                relative_path = img_path.lstrip("/")
                abs_path = os.path.join(BASE_DIR, relative_path)
                abs_path = self._get_normalized_path(abs_path)

                if os.path.exists(abs_path):
                    base64_uri = self._embed_image_as_base64(abs_path)
                    if base64_uri:
                        return f"![{alt_text}]({base64_uri})"
                    return f"![{alt_text}](图片转换失败: {img_path})"
                return f"![{alt_text}](图片不存在: {img_path})"

            elif not img_path.startswith(('http://', 'https://', 'data:')):
                possible_paths = [
                    os.path.join(STATIC_BASE, img_path),
                    os.path.abspath(img_path),
                    os.path.join(BASE_DIR, img_path)
                ]

                for abs_path in possible_paths:
                    abs_path = self._get_normalized_path(abs_path)
                    if os.path.exists(abs_path):
                        base64_uri = self._embed_image_as_base64(abs_path)
                        if base64_uri:
                            return f"![{alt_text}]({base64_uri})"
                        break

                return f"![{alt_text}](图片未找到: {img_path})"

            return match.group(0)

        pattern = r'!\[([^\]]*)\]\(([^)]+)\)'
        return re.sub(pattern, repl, content)

    def _strip_internal_anchors(self, content: str) -> str:
        """
        去除指向文档内部锚点的链接（如目录跳转 [标题](#标题)）。

        markdown_pdf 底层用 pymupdf Story 渲染，会把 `#xxx` 当作命名目标解析，
        但其自动生成的 heading id 与中文锚点 slug 往往对不上，导致
        `No destination with id=...` 直接报错。这里把这类链接降级为纯文本，
        保留可见标题文字，仅去掉无法定位的内部跳转。
        外部链接（http/https）与图片不受影响。
        """
        # [可见文字](#锚点) -> 可见文字；(?<!!) 避免误伤图片 ![alt](...)
        return re.sub(r'(?<!!)\[([^\]]+)\]\(#[^)]*\)', r'\1', content)

    def _to_pdf(self, content: str, title: str) -> str:
        content = self._strip_internal_anchors(content)
        try:
            pdf = MarkdownPdf(optimize=True)
            pdf.add_section(Section(content))
            save_path = os.path.join(SAVE_PATH, f"{title}.pdf")
            pdf.save(save_path)
            return save_path
        except Exception:
            pdf = MarkdownPdf()
            pdf.add_section(Section(content))
            save_path = os.path.join(SAVE_PATH, f"{title}.pdf")
            pdf.save(save_path)
            return save_path

    def _to_html(self, content: str, title: str) -> str:
        import markdown

        html_body = markdown.markdown(
            content,
            extensions=["extra", "toc", "tables", "fenced_code"],
        )

        full_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           max-width: 860px; margin: 40px auto; padding: 0 24px;
           color: #1a1a1a; line-height: 1.7; }}
    h1,h2,h3,h4 {{ font-weight: 600; margin-top: 1.5em; }}
    h1 {{ border-bottom: 2px solid #e5e7eb; padding-bottom: .4em; }}
    h2 {{ border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }}
    pre {{ background: #f6f8fa; border-radius: 6px; padding: 16px; overflow-x: auto; }}
    code {{ background: #f6f8fa; border-radius: 3px; padding: 2px 5px; font-size: .9em; }}
    pre code {{ background: none; padding: 0; }}
    blockquote {{ border-left: 4px solid #d1d5db; margin: 0; padding-left: 16px; color: #6b7280; }}
    table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
    th,td {{ border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }}
    th {{ background: #f9fafb; }}
    img {{ max-width: 100%; border-radius: 6px; }}
    a {{ color: #0f766e; }}
  </style>
</head>
<body>
{html_body}
</body>
</html>"""

        save_path = os.path.join(SAVE_PATH, f"{title}.html")
        with open(save_path, "w", encoding="utf-8") as f:
            f.write(full_html)
        return save_path

    def _to_word(self, content: str, title: str) -> str:
        from docx import Document
        from docx.shared import Pt, RGBColor, Inches
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        import re as _re

        doc = Document()

        # 基础样式
        style = doc.styles["Normal"]
        style.font.name = "微软雅黑"
        style.font.size = Pt(11)

        lines = content.split("\n")
        i = 0
        while i < len(lines):
            line = lines[i]

            # 标题
            heading_match = _re.match(r'^(#{1,6})\s+(.*)', line)
            if heading_match:
                level = len(heading_match.group(1))
                text = heading_match.group(2).strip()
                doc.add_heading(text, level=min(level, 4))
                i += 1
                continue

            # 代码块
            if line.strip().startswith("```"):
                code_lines = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    code_lines.append(lines[i])
                    i += 1
                para = doc.add_paragraph("\n".join(code_lines))
                para.style = doc.styles["Normal"]
                for run in para.runs:
                    run.font.name = "Courier New"
                    run.font.size = Pt(9)
                i += 1
                continue

            # 引用
            if line.startswith(">"):
                text = line.lstrip("> ").strip()
                para = doc.add_paragraph(text)
                para.paragraph_format.left_indent = Inches(0.4)
                for run in para.runs:
                    run.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
                i += 1
                continue

            # 无序列表
            ul_match = _re.match(r'^[\*\-\+]\s+(.*)', line)
            if ul_match:
                doc.add_paragraph(ul_match.group(1).strip(), style="List Bullet")
                i += 1
                continue

            # 有序列表
            ol_match = _re.match(r'^\d+\.\s+(.*)', line)
            if ol_match:
                doc.add_paragraph(ol_match.group(1).strip(), style="List Number")
                i += 1
                continue

            # 分隔线
            if _re.match(r'^[\-\*_]{3,}\s*$', line):
                doc.add_paragraph("─" * 40)
                i += 1
                continue

            # 普通段落（处理内联 bold/italic）
            if line.strip():
                para = doc.add_paragraph()
                # 简单处理 **bold** 和 *italic*
                parts = _re.split(r'(\*\*[^*]+\*\*|\*[^*]+\*)', line)
                for part in parts:
                    if part.startswith("**") and part.endswith("**"):
                        run = para.add_run(part[2:-2])
                        run.bold = True
                    elif part.startswith("*") and part.endswith("*"):
                        run = para.add_run(part[1:-1])
                        run.italic = True
                    else:
                        para.add_run(part)
            else:
                doc.add_paragraph()

            i += 1

        save_path = os.path.join(SAVE_PATH, f"{title}.docx")
        doc.save(save_path)
        return save_path

    def _find_chrome(self) -> str | None:
        """按优先级查找可用的 Chrome/Chromium 可执行文件"""
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
        ]
        import shutil
        for c in candidates:
            if os.path.isfile(c) and os.access(c, os.X_OK):
                return c
            found = shutil.which(c)
            if found:
                return found
        return None

    def _to_image(self, content: str, title: str) -> str:
        """Markdown → HTML → Chrome headless 截图 → PNG，不依赖 WeasyPrint"""
        import subprocess
        import tempfile

        chrome = self._find_chrome()
        if not chrome:
            raise RuntimeError(
                "图片导出需要 Chrome 或 Chromium，未在系统中找到。"
                "请安装 Google Chrome 后重试。"
            )

        html_path = self._to_html(content, f"_tmp_{title}")
        save_path = os.path.join(SAVE_PATH, f"{title}.png")

        try:
            # Chrome headless 截图：--screenshot 输出整页 PNG
            result = subprocess.run(
                [
                    chrome,
                    "--headless=new",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--hide-scrollbars",
                    "--window-size=1200,800",
                    f"--screenshot={save_path}",
                    f"file://{os.path.abspath(html_path)}",
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0 or not os.path.exists(save_path):
                raise RuntimeError(f"Chrome 截图失败：{result.stderr[:300]}")
        finally:
            try:
                os.remove(html_path)
            except Exception:
                pass

        return save_path

    def export(self, output_format: str, title: str, content: str) -> str:
        content = content.strip()
        print("开始处理图片路径...")
        content = self._replace_static_paths_with_absolute(content)
        output_format = output_format.lower()

        if output_format == "pdf":
            return self._to_pdf(content, title)
        elif output_format == "html":
            return self._to_html(content, title)
        elif output_format in ["word", "docx"]:
            return self._to_word(content, title)
        elif output_format in ["image", "png"]:
            return self._to_image(content, title)
        elif output_format == "md":
            save_path = os.path.join(SAVE_PATH, f"{title}.md")
            with open(save_path, "w", encoding="utf-8") as f:
                f.write(content)
            return save_path
        else:
            raise ValueError(f"不支持的导出格式: {output_format}")

    def get_supported_formats(self):
        return {
            "md": "Markdown 文档",
            "pdf": "PDF 文档",
            "html": "HTML 网页",
            "docx": "Word 文档 (.docx)",
            "png": "PNG 图片",
        }

