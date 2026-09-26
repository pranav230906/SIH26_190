"""Deterministic text comparison. This does not call a model or invent wording."""

import difflib
import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree

UNSUPPORTED = "Visual/content diff is not available for this file type."
_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_TOKEN = re.compile(r"\s+|\w+|[^\w\s]", re.UNICODE)


def extract_text(filename: str, mime_type: str, content: bytes) -> str | None:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension in {"txt", "md", "csv"} or mime_type.startswith("text/"):
        return content.decode("utf-8", errors="replace")
    if extension == "docx" or mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _docx_text(content)
    return None


def compare_texts(parent: str, current: str) -> list[dict[str, str]]:
    left = _TOKEN.findall(parent)
    right = _TOKEN.findall(current)
    changes: list[dict[str, str]] = []
    matcher = difflib.SequenceMatcher(a=left, b=right, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            _append(changes, "unchanged", "".join(left[i1:i2]))
        elif tag == "delete":
            _append(changes, "removed", "".join(left[i1:i2]))
        elif tag == "insert":
            _append(changes, "added", "".join(right[j1:j2]))
        else:
            _append(changes, "removed", "".join(left[i1:i2]))
            _append(changes, "added", "".join(right[j1:j2]))
    return [item for item in changes if item["text"]]


def _append(changes: list[dict[str, str]], kind: str, text: str) -> None:
    if not text:
        return
    if changes and changes[-1]["type"] == kind:
        changes[-1]["text"] += text
        return
    changes.append({"type": kind, "text": text})


def _docx_text(content: bytes) -> str | None:
    try:
        with zipfile.ZipFile(BytesIO(content)) as package:
            xml = package.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile):
        return None
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        return None
    parts = [node.text for node in root.iter(f"{_WORD_NS}t") if node.text]
    return "\n".join(parts)
