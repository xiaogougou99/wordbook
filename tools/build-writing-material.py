#!/usr/bin/env python3
"""Merge the latest GTRT writing DOCX into the existing website guide.

The website keeps its reusable logic chains and four universal examples.  This
builder replaces only the GTRT demonstration section with the complete starred
answers from the DOCX, preserving every English answer sentence and its paired
Chinese explanation.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from lxml import etree


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


@dataclass
class Demo:
    number: str
    title: str
    direction: str
    chain: str
    example: str
    viewpoints: str
    prompt: str
    sentences: list[tuple[str, str, str]]
    word_count: str


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unwrap(element) -> None:
    parent = element.getparent()
    if parent is None:
        return
    index = parent.index(element)
    for child in list(element):
        parent.insert(index, child)
        index += 1
    parent.remove(element)


def accepted_copy(source: Path, destination: Path) -> None:
    """Create a temporary DOCX with visible tracked changes accepted."""
    with ZipFile(source, "r") as source_zip, ZipFile(
        destination, "w", compression=ZIP_DEFLATED
    ) as output_zip:
        for item in source_zip.infolist():
            data = source_zip.read(item.filename)
            if item.filename.startswith("word/") and item.filename.endswith(".xml"):
                root = etree.fromstring(data)
                for tag in ("del", "moveFrom"):
                    for node in root.xpath(f".//w:{tag}", namespaces=NS):
                        parent = node.getparent()
                        if parent is not None:
                            parent.remove(node)
                for tag in ("ins", "moveTo"):
                    for node in reversed(root.xpath(f".//w:{tag}", namespaces=NS)):
                        _unwrap(node)
                data = etree.tostring(
                    root, xml_declaration=True, encoding="UTF-8", standalone=True
                )
            output_zip.writestr(item, data)


def visible_paragraphs(source: Path) -> list[str]:
    with tempfile.TemporaryDirectory(prefix="wordbook-writing-") as temp_dir:
        accepted = Path(temp_dir) / "accepted.docx"
        accepted_copy(source, accepted)
        document = Document(accepted)
        return [p.text.strip() for p in document.paragraphs if p.text.strip()]


def value_after(text: str, prefix: str) -> str:
    if not text.startswith(prefix):
        raise ValueError(f"Expected {prefix!r}, got {text!r}")
    return text[len(prefix) :].strip()


def parse_note(text: str) -> tuple[str, str]:
    note = value_after(text, "思考")
    parts = re.split(r"\s+来源\s+", note, maxsplit=1)
    thinking = parts[0].strip()
    source = parts[1].strip() if len(parts) == 2 else ""
    return thinking, source


def parse_demos(paragraphs: list[str]) -> list[Demo]:
    starts = [i for i, text in enumerate(paragraphs) if re.match(r"^GTRT\s+\d+\s+⭐", text)]
    demos: list[Demo] = []
    for pos, start in enumerate(starts):
        end = starts[pos + 1] if pos + 1 < len(starts) else len(paragraphs)
        block = paragraphs[start:end]
        match = re.match(r"^GTRT\s+(\d+)\s+⭐\s+(.+)$", block[0])
        if not match:
            raise ValueError(f"Invalid GTRT heading: {block[0]}")

        number, title = match.groups()
        direction = value_after(block[1], "题目方向")
        chain = value_after(block[2], "主链")
        example = value_after(block[3], "复用例子")
        viewpoints = value_after(block[4], "同学观点")
        if block[5] != "题目" or block[7] != "完整答案与逐句思考":
            raise ValueError(f"Unexpected structure in GTRT {number}")
        prompt = block[6]

        sentences: list[tuple[str, str, str]] = []
        cursor = 8
        word_count = ""
        while cursor < len(block):
            if block[cursor].startswith("字数"):
                word_count = block[cursor]
                break
            sentence_match = re.match(r"^\d+\.\s*(.+)$", block[cursor])
            if not sentence_match or cursor + 1 >= len(block):
                raise ValueError(f"Unexpected answer line in GTRT {number}: {block[cursor]}")
            thinking, source_name = parse_note(block[cursor + 1])
            sentences.append((sentence_match.group(1).strip(), thinking, source_name))
            cursor += 2

        if len(sentences) != 8:
            raise ValueError(f"GTRT {number} contains {len(sentences)} sentences, expected 8")
        if not word_count:
            raise ValueError(f"Missing word count for GTRT {number}")

        demos.append(
            Demo(
                number=number,
                title=title,
                direction=direction,
                chain=chain,
                example=example,
                viewpoints=viewpoints,
                prompt=prompt,
                sentences=sentences,
                word_count=word_count,
            )
        )
    if len(demos) != 18:
        raise ValueError(f"Found {len(demos)} starred GTRT demos, expected 18")
    return demos


def e(value: str) -> str:
    return html.escape(value, quote=True)


def demo_html(demo: Demo) -> str:
    items: list[str] = []
    for sentence, thinking, source_name in demo.sentences:
        source_html = (
            f'｜<strong>来源：</strong>{e(source_name)}' if source_name else ""
        )
        items.append(
            '            <li><p class="memory-text">'
            + e(sentence)
            + '</p><p class="sentence-note"><strong>思考：</strong>'
            + e(thinking)
            + source_html
            + "</p></li>"
        )

    return f'''        <section class="demo-card" id="gtrt-{e(demo.number)}">
          <div class="card-heading"><span class="letter">{e(demo.number)}</span><h3>GTRT {e(demo.number)} ⭐ {e(demo.title)}</h3><span class="chain-tag">{e(demo.chain)}</span></div>
          <p class="prompt-summary">题目方向：{e(demo.direction)}</p>
          <p class="use-for"><strong>复用例子：</strong>{e(demo.example)}</p>
          <details class="mapping-details demo-prompt-details">
            <summary>展开原题与同学观点</summary>
            <div class="demo-prompt-body">
              <p><strong>同学观点：</strong>{e(demo.viewpoints)}</p>
              <p><strong>原题：</strong>{e(demo.prompt)}</p>
            </div>
          </details>
          <ol class="sentence-walkthrough">
{chr(10).join(items)}
          </ol>
          <p class="demo-word-count">{e(demo.word_count)}</p>
        </section>'''


def section_html(demos: list[Demo]) -> str:
    cards = "\n\n".join(demo_html(demo) for demo in demos)
    return f'''    <section class="material-section" aria-labelledby="gtrt-demos">
      <div class="section-heading">
        <p class="section-number">PART 03</p>
        <h2 id="gtrt-demos">18道GTRT带星题完整示范｜每句后写清思考</h2>
      </div>
      <div class="priority-note">
        <strong>优先背诵：</strong>第一优先 34 环境教育、61 远程工作；第二优先 04 社会规范、13 领导风格、41 最低工资、43 讲故事、57 艺术作用；其余带星题随后复习。
      </div>
      <p class="section-intro">以下内容来自最新Word。每题保留8句完整答案、逐句思考、来源、原题和同学观点；把8句英文连起来即可作为一篇完整答案。</p>

      <div class="demo-stack">
{cards}
      </div>
    </section>

'''


def build_page(template: str, demos: list[Demo], source_hash: str) -> str:
    start_marker = '    <section class="material-section" aria-labelledby="gtrt-demos">'
    end_marker = '    <section class="material-section" aria-labelledby="gtrt-map">'
    start = template.index(start_marker)
    end = template.index(end_marker, start)
    result = template[:start] + section_html(demos) + template[end:]

    result = result.replace(
        "<h1>9条高复用链＋GTRT示范</h1>",
        "<h1>9条高复用链＋18道GTRT带星题</h1>",
    )
    result = result.replace(
        "最后看GTRT示范。",
        "最后看18道GTRT带星题完整示范。",
    )
    result = re.sub(
        r'<article class="material-document writing-document" data-editor-version="[^"]+">',
        f'<article class="material-document writing-document" data-editor-version="{source_hash[:12]}">',
        result,
        count=1,
    )
    comment = f"  <!-- writing-source-sha256: {source_hash} -->\n"
    result = re.sub(r"\s*<!-- writing-source-sha256: [a-f0-9]+ -->\s*", "\n", result)
    result = result.replace("<body>\n", "<body>\n" + comment, 1)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("template", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--copy-docx", type=Path)
    args = parser.parse_args()

    source = args.source.resolve()
    template_path = args.template.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if not template_path.is_file():
        raise FileNotFoundError(template_path)

    source_hash = sha256(source)
    demos = parse_demos(visible_paragraphs(source))
    output = build_page(template_path.read_text(encoding="utf-8"), demos, source_hash)
    args.output.write_text(output, encoding="utf-8", newline="\n")

    if args.copy_docx:
        args.copy_docx.parent.mkdir(parents=True, exist_ok=True)
        if not args.copy_docx.exists() or sha256(args.copy_docx) != source_hash:
            shutil.copy2(source, args.copy_docx)

    print(f"source_sha256={source_hash}")
    print(f"demos={len(demos)}")
    print(f"output={args.output}")
    if args.copy_docx:
        print(f"docx_copy={args.copy_docx}")


if __name__ == "__main__":
    main()
