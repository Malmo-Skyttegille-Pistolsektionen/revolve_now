"""MkDocs hook: fills docs/site/lists.md with a list of figures and a list of tables.

Built from the pages at build time, so the lists cannot drift from them. A
figure is an image or a mermaid diagram; a table is a Markdown pipe table.
Each entry links to the section it sits in.
"""

import re
from pathlib import Path

from markdown.extensions.toc import slugify

LISTS_PAGE = "lists.md"
MARKER = "<!-- lists -->"

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)")
_TABLE_RULE = re.compile(r"^\|?\s*:?-{3,}")


def _plain(text):
    """Heading text as the toc extension slugifies it: no links, emphasis or code ticks."""
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    return re.sub(r"[*_`]", "", text).strip()


def _cells(row):
    return [c.strip() for c in row.strip().strip("|").split("|")]


def _scan(path):
    """Yield (kind, label, page title, anchor) for each figure and table, in page order."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    title, anchor, section = None, "", None
    seen = {}
    fence = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if fence:
            if stripped.startswith(fence):
                fence = None
            continue
        if stripped.startswith(("```", "~~~")):
            fence = stripped[:3]
            if stripped[3:].strip() == "mermaid":
                yield "figure", f"Diagram: {section or title}", title, anchor
            continue

        heading = _HEADING.match(line)
        if heading:
            text = _plain(heading.group(2))
            if len(heading.group(1)) == 1 and title is None:
                title = text
                continue
            slug = slugify(text, "-")
            # The toc extension de-duplicates repeated headings with a counter.
            count = seen.get(slug, 0)
            seen[slug] = count + 1
            anchor = slug if count == 0 else f"{slug}_{count}"
            section = text
            continue

        for match in _IMAGE.finditer(line):
            yield "figure", match.group(1) or match.group(2), title, anchor

        if stripped.startswith("|") and i + 1 < len(lines) and _TABLE_RULE.match(lines[i + 1].strip()):
            columns = " · ".join(_plain(c) for c in _cells(line))
            label = f"{section}: {columns}" if section else columns
            yield "table", label, title, anchor


def _nav_files(nav):
    for item in nav:
        value = next(iter(item.values())) if isinstance(item, dict) else item
        if isinstance(value, list):
            yield from _nav_files(value)
        elif isinstance(value, str) and value.endswith(".md"):
            yield value


def _render(entries, kind, noun):
    rows = [e for e in entries if e[0] == kind]
    if not rows:
        return f"No {noun.lower()}s.\n"
    out = [f"| # | {noun} | Page |", "|---:|---|---|"]
    for n, (_, label, title, anchor, src) in enumerate(rows, 1):
        target = f"{src}#{anchor}" if anchor else src
        label = label.replace("|", "\\|")
        out.append(f"| {n} | [{label}]({target}) | {title} |")
    return "\n".join(out) + "\n"


def on_page_markdown(markdown, page, config, files):
    if page.file.src_uri != LISTS_PAGE:
        return markdown
    docs_dir = Path(config["docs_dir"])
    entries = []
    for src in _nav_files(config["nav"] or []):
        if src == LISTS_PAGE:
            continue
        for kind, label, title, anchor in _scan(docs_dir / src):
            entries.append((kind, label, title or src, anchor, src))
    lists = (
        "## Figures\n\n"
        + _render(entries, "figure", "Figure")
        + "\n## Tables\n\n"
        + _render(entries, "table", "Table")
    )
    return markdown.replace(MARKER, lists)
