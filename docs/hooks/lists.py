"""MkDocs hook: fills docs/site/lists.md with a list of figures and a list of tables.

Built from the pages at build time, so the lists cannot drift from them. A
figure is an image or a mermaid diagram; a table is a Markdown pipe table.
Each entry links to the section it sits in.

Runs once per language: the i18n plugin builds the Swedish site from the
`.sv.md` pages, falling back to English for a page without one, and the lists
are scanned from the same file for each nav entry.
"""

import re
from pathlib import Path

from markdown.extensions.toc import slugify

LISTS_PAGE = "lists.md"
MARKER = "<!-- lists -->"

_LISTS_PAGE = re.compile(r"^lists(\.[a-z]{2})?\.md$")
_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
# `## Heading { #anchor }` - attr_list pins the anchor, which is how a
# translated heading keeps the id the other pages link to.
_HEADING_ID = re.compile(r"\s*\{\s*#([^\s}]+)[^}]*\}\s*$")

_WORDS = {
    "en": {"figures": "Figures", "tables": "Tables", "figure": "Figure", "table": "Table",
           "page": "Page", "diagram": "Diagram", "none": "No {noun}."},
    "sv": {"figures": "Figurer", "tables": "Tabeller", "figure": "Figur", "table": "Tabell",
           "page": "Sida", "diagram": "Diagram", "none": "Inga {noun}."},
}
_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)")
_TABLE_RULE = re.compile(r"^\|?\s*:?-{3,}")


def _plain(text):
    """Heading text as the toc extension slugifies it: no links, emphasis or code ticks."""
    text = _HEADING_ID.sub("", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    return re.sub(r"[*_`]", "", text).strip()


def _cells(row):
    return [c.strip() for c in row.strip().strip("|").split("|")]


def _scan(path, words):
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
                yield "figure", f"{words['diagram']}: {section or title}", title, anchor
            continue

        heading = _HEADING.match(line)
        if heading:
            text = _plain(heading.group(2))
            if len(heading.group(1)) == 1 and title is None:
                title = text
                continue
            pinned = _HEADING_ID.search(heading.group(2))
            if pinned:
                anchor = pinned.group(1)
            else:
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


def _source(docs_dir, src, locale):
    """The page the i18n plugin builds for this locale: its translation if there is one."""
    localized = docs_dir / src.replace(".md", f".{locale}.md")
    return localized if localized.exists() else docs_dir / src


def _render(entries, kind, words):
    rows = [e for e in entries if e[0] == kind]
    if not rows:
        return words["none"].format(noun=words[kind + "s"].lower()) + "\n"
    out = [f"| # | {words[kind]} | {words['page']} |", "|---:|---|---|"]
    for n, (_, label, title, anchor, src) in enumerate(rows, 1):
        target = f"{src}#{anchor}" if anchor else src
        label = label.replace("|", "\\|")
        out.append(f"| {n} | [{label}]({target}) | {title} |")
    return "\n".join(out) + "\n"


def on_page_markdown(markdown, page, config, files):
    if not _LISTS_PAGE.match(page.file.src_uri):
        return markdown
    locale = getattr(page.file, "locale", "en")
    words = _WORDS[locale]
    docs_dir = Path(config["docs_dir"])
    entries = []
    for src in _nav_files(config["nav"] or []):
        if src == LISTS_PAGE:
            continue
        for kind, label, title, anchor in _scan(_source(docs_dir, src, locale), words):
            entries.append((kind, label, title or src, anchor, src))
    lists = (
        f"## {words['figures']}\n\n"
        + _render(entries, "figure", words)
        + f"\n## {words['tables']}\n\n"
        + _render(entries, "table", words)
    )
    return markdown.replace(MARKER, lists)
