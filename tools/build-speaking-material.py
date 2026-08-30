#!/usr/bin/env python3
"""Build a responsive, read-only HTML view from the speaking DOCX.

The converter accepts tracked insertions and omits tracked deletions in a
temporary copy, matching the text Word shows in the source document.  Output
is deterministic so the scheduled task only commits real source changes.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import shutil
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from docx.document import Document as DocumentObject
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from lxml import etree


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


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


def _accepted_copy(source: Path, destination: Path) -> None:
    """Create a temporary DOCX with tracked changes accepted."""
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
                    nodes = root.xpath(f".//w:{tag}", namespaces=NS)
                    for node in reversed(nodes):
                        _unwrap(node)
                data = etree.tostring(
                    root, xml_declaration=True, encoding="UTF-8", standalone=True
                )
            output_zip.writestr(item, data)


def iter_block_items(parent):
    if isinstance(parent, DocumentObject):
        parent_element = parent.element.body
    elif isinstance(parent, _Cell):
        parent_element = parent._tc
    else:
        raise TypeError(f"Unsupported parent: {type(parent)!r}")

    for child in parent_element.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def run_html(run: Run) -> str:
    value = html.escape(run.text or "").replace("\t", "&emsp;").replace("\n", "<br>")
    if not value:
        return ""

    styles: list[str] = []
    color = run.font.color.rgb
    if color:
        styles.append(f"color:#{color}")
    if run.font.size:
        size = max(9.0, min(30.0, run.font.size.pt))
        styles.append(f"font-size:{size:g}pt")

    attrs = f' style="{";".join(styles)}"' if styles else ""
    value = f"<span{attrs}>{value}</span>"
    if run.underline:
        value = f"<u>{value}</u>"
    if run.italic:
        value = f"<em>{value}</em>"
    if run.bold:
        value = f"<strong>{value}</strong>"
    return value


def paragraph_inner_html(paragraph: Paragraph) -> str:
    parts: list[str] = []
    for item in paragraph.iter_inner_content():
        if isinstance(item, Run):
            parts.append(run_html(item))
            continue
        url = getattr(item, "url", "")
        text = "".join(run_html(run) for run in getattr(item, "runs", []))
        if url:
            parts.append(
                f'<a href="{html.escape(url, quote=True)}" rel="noopener noreferrer">{text}</a>'
            )
        else:
            parts.append(text)
    return "".join(parts)


def paragraph_class(paragraph: Paragraph) -> str:
    style_name = (paragraph.style.name or "").lower()
    style_id = (paragraph.style.style_id or "").lower()
    if "title" in style_name or style_id == "title":
        return "doc-title"
    if "heading 1" in style_name or "标题 1" in style_name or style_id == "heading1":
        return "doc-heading doc-heading-1"
    if "heading 2" in style_name or "标题 2" in style_name or style_id == "heading2":
        return "doc-heading doc-heading-2"
    if "heading 3" in style_name or "标题 3" in style_name or style_id == "heading3":
        return "doc-heading doc-heading-3"
    return "doc-paragraph"


def list_kind(paragraph: Paragraph) -> str:
    style_name = (paragraph.style.name or "").lower()
    if "list bullet" in style_name:
        return "bullet"
    if "list number" in style_name:
        return "number"
    return ""


def paragraph_html(
    paragraph: Paragraph, in_table: bool = False, list_number: int | None = None
) -> str:
    content = paragraph_inner_html(paragraph)
    if not content:
        return "" if in_table else '<div class="doc-spacer" aria-hidden="true"></div>'

    class_name = "doc-table-paragraph" if in_table else paragraph_class(paragraph)
    kind = "" if in_table else list_kind(paragraph)
    if kind:
        class_name += " doc-list-item"
        marker = "•" if kind == "bullet" else f"{list_number or 1}."
        content = (
            f'<span class="doc-list-marker" aria-hidden="true">{marker}</span>'
            f'<span class="doc-list-content">{content}</span>'
        )
    styles: list[str] = []
    alignment = paragraph.alignment
    if alignment == WD_ALIGN_PARAGRAPH.CENTER:
        styles.append("text-align:center")
    elif alignment == WD_ALIGN_PARAGRAPH.RIGHT:
        styles.append("text-align:right")
    elif alignment == WD_ALIGN_PARAGRAPH.JUSTIFY:
        styles.append("text-align:justify")

    left_indent = paragraph.paragraph_format.left_indent
    first_indent = paragraph.paragraph_format.first_line_indent
    if left_indent:
        styles.append(f"--doc-left-indent:{max(0, min(48, left_indent.pt)):g}pt")
    if first_indent:
        styles.append(f"--doc-first-indent:{max(-24, min(48, first_indent.pt)):g}pt")

    style_attr = f' style="{";".join(styles)}"' if styles else ""
    return f'<p class="{class_name}"{style_attr}>{content}</p>'


def table_html(table: Table) -> str:
    rows: list[str] = []
    for row in table.rows:
        cells: list[str] = []
        for cell in row.cells:
            contents = "".join(paragraph_html(p, in_table=True) for p in cell.paragraphs)
            cells.append(f"<td>{contents}</td>")
        rows.append("<tr>" + "\n".join(cells) + "</tr>")
    return '<div class="doc-table-wrap"><table><tbody>' + "\n".join(rows) + "</tbody></table></div>"


def document_html(document: DocumentObject, source_hash: str) -> str:
    blocks: list[str] = []
    paragraph_count = 0
    table_count = 0
    number_counter = 0
    for block in iter_block_items(document):
        if isinstance(block, Paragraph):
            kind = list_kind(block)
            if kind == "number":
                number_counter += 1
            elif block.text.strip():
                number_counter = 0
            blocks.append(paragraph_html(block, list_number=number_counter or None))
            paragraph_count += 1
        else:
            blocks.append(table_html(block))
            table_count += 1

    body = "\n      ".join(blocks)
    return f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'">
  <title>口语材料</title>
  <link rel="stylesheet" href="./speaking-material.css">
</head>
<body>
  <!-- source-sha256: {source_hash} -->
  <!-- source-blocks: {paragraph_count} paragraphs, {table_count} tables -->
  <article class="speaking-document">
      {body}
  </article>
</body>
</html>
'''


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--copy-docx", type=Path)
    args = parser.parse_args()

    source = args.source.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    source_hash = sha256(source)

    with tempfile.TemporaryDirectory(prefix="wordbook-speaking-") as temp_dir:
        accepted = Path(temp_dir) / "accepted.docx"
        _accepted_copy(source, accepted)
        document = Document(accepted)
        output = document_html(document, source_hash)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding="utf-8", newline="\n")

    if args.copy_docx:
        args.copy_docx.parent.mkdir(parents=True, exist_ok=True)
        if not args.copy_docx.exists() or sha256(args.copy_docx) != source_hash:
            shutil.copy2(source, args.copy_docx)

    print(f"source_sha256={source_hash}")
    print(f"output={args.output}")
    if args.copy_docx:
        print(f"docx_copy={args.copy_docx}")


if __name__ == "__main__":
    main()
