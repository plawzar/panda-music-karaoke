"""Build an editable Genius transcription from source lyrics and an optional AI outline."""

from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from itertools import groupby
import re


LABELS = {
    "intro": ("Интро", "Intro"),
    "verse": ("Куплет", "Verse"),
    "pre-chorus": ("Пред-припев", "Pre-Chorus"),
    "chorus": ("Припев", "Chorus"),
    "post-chorus": ("Постприпев", "Post-Chorus"),
    "refrain": ("Рефрен", "Refrain"),
    "hook": ("Хук", "Hook"),
    "bridge": ("Бридж", "Bridge"),
    "interlude": ("Интерлюдия", "Interlude"),
    "outro": ("Аутро", "Outro"),
}
ALIASES = {label.casefold(): kind for kind, labels in LABELS.items() for label in labels}
ALIASES.update({
    "вступление": "intro", "припевка": "chorus", "переход": "bridge", "финал": "outro",
    "предприпев": "pre-chorus", "пост-припев": "post-chorus",
})
HEADER = re.compile(r"\[\s*([^\[\]]+?)\s*\]\s*(:)?")
SECTION_PREFIX = re.compile(
    r"(" + "|".join(re.escape(label) for label in sorted(ALIASES, key=len, reverse=True))
    + r")(?=\s|:|$)(?:\s+(\d+)(?=\s|:|$))?(.*)",
    re.I,
)
LYRIC_TITLE = re.compile(r"\[(?:текст (?:трека|песни)|lyrics (?:to|for))\s+[^\[\]]+\]", re.I)
PERFORMER_LIST = re.compile(r"\[\s*(?:исполнители|артисты|performers|artists)\s*:\s*([^\[\]]+)\]", re.I)
VOICE_TAG = re.compile(r"</?[ib]>", re.I)
WHOLE_PARENTHETICAL = re.compile(r"\(([^()]+)\)")
STANDALONE_HANDLE = re.compile(r"[A-Za-z0-9_@][A-Za-z0-9_.@-]{0,39}")
NAME_WORD = re.compile(r"@?[\w]+(?:[.'’_-][\w]+)*")
ORDINARY_PREFIX = re.compile(
    r"(?:говор\w*|сказа\w*|дум\w*|слышу|знаю|смотри|помни\w*|ответ\w*|вопрос\w*|"
    r"стой|послушай|запомни|знаешь|например|потом|сначала|последнее|внимание|слова|я|ты|он|она|мы|вы|они|нет|да|"
    r"said|says|think|remember|listen|look|question|answer|i|you|he|she|we|they)",
    re.I,
)
LINE_END_PUNCTUATION = re.compile(r"""(?:(?<!\.)\.|,)+(?=(?:\s|[)»"'”’]|</[ib]>)*$)""", re.I)
QUOTES = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'})
GAP_WARNING = "Проверь на слух границы секций, особенно короткие переходы."
INTEGRITY_WARNING = "Автоматическая разметка не прошла проверку. Оставлен текст для ручной правки."
VOICE_WARNING = "Проверь подписи исполнителей в черновике."


@dataclass(frozen=True)
class Lyric:
    number: int
    text: str
    after_break: bool
    voices: tuple[str, ...]


@dataclass(frozen=True)
class Section:
    kind: str
    legend: str = ""
    number: str = ""


def parse_header(line, known_names=()):
    bracket = HEADER.fullmatch(line)
    match = SECTION_PREFIX.fullmatch(bracket[1]) if bracket else None
    if not match:
        return None
    label, number, tail = match.groups()
    tail = tail.strip()
    if not tail or tail.startswith(":"):
        legend = tail.removeprefix(":").strip()
    elif bracket[2] or (known_names and all(name.casefold() in known_names for name in voice_names(tail))):
        legend = tail
    else:
        return None
    return Section(ALIASES[label.casefold()], legend, number or "")


def voice_names(legend):
    return tuple(name.strip() for name in re.split(r"\s+&\s+|,\s*", VOICE_TAG.sub("", legend)) if name.strip())


def looks_like_handle(name):
    return (
        STANDALONE_HANDLE.fullmatch(name)
        and any(character.isalpha() for character in name)
        and (name.startswith("@") or "_" in name or any(character.isdigit() for character in name))
    )


def looks_like_name(name):
    words = name.split()
    return (
        1 <= len(words) <= 4 and not ORDINARY_PREFIX.fullmatch(words[0])
        and all(
            NAME_WORD.fullmatch(word)
            and (word[0].isupper() or looks_like_handle(word) or index > 0 and word.casefold() in {"de", "da", "van", "von"})
            for index, word in enumerate(words)
        )
    )


def inline_roster(rows, headers, metadata_rows):
    """Ground unlisted cues in the source instead of interpreting every colon as a voice change."""
    found = []
    for index, line in enumerate(rows):
        if index in headers or index in metadata_rows or LYRIC_TITLE.fullmatch(line):
            continue
        prefix, separator, body = line.partition(":")
        if not separator or not body.strip():
            continue
        names = voice_names(prefix)
        if names and all(looks_like_name(name) for name in names):
            found.append((index, names))

    result = {}
    counts = Counter(tuple(name.casefold() for name in names) for _, names in found)
    positions = {index for index, _ in found}
    for index, names in found:
        group = tuple(name.casefold() for name in names)
        if (len(names) > 1 or counts[group] > 1 or looks_like_handle(names[0])
            or index - 1 in positions or index + 1 in positions):
            for name in names:
                result.setdefault(name.casefold(), name)
    return result


def format_line(line):
    # A final period or comma is formatting, including just inside a closing quote or ad-lib.
    # Keep ellipses, interior punctuation and the actual words.
    return LINE_END_PUNCTUATION.sub("", line.translate(QUOTES)).rstrip() or line


def parse_lyrics(rows, artists):
    supplied = voice_names(artists.replace("\n", ","))
    headers = {index: header for index, line in enumerate(rows) if (header := parse_header(line))}
    performer_rows = {index: match[1] for index, line in enumerate(rows) if (match := PERFORMER_LIST.fullmatch(line))}
    roster = {
        name.casefold(): name
        for name in (*supplied, *(name for legend in performer_rows.values() for name in voice_names(legend)),
                     *(name for header in headers.values() for name in voice_names(header.legend)))
    }
    for key, name in inline_roster(rows, headers, performer_rows).items():
        roster.setdefault(key, name)
    for index, line in enumerate(rows):
        if index not in headers and (header := parse_header(line, roster)):
            headers[index] = header
    title = next((line for index, line in enumerate(rows) if line and index not in performer_rows), "")
    if not LYRIC_TITLE.fullmatch(title):
        title = ""
    lyrics, starts = [], {}
    pending = None
    previous_header = None
    after_break = True
    last_nonempty = max((index for index, line in enumerate(rows) if line), default=-1)
    for index, line in enumerate(rows):
        if index in performer_rows:
            continue
        if index in headers:
            pending = headers[index]
            after_break = True
        elif not line or not lyrics and line == title:
            after_break = True
        else:
            candidate, colon, body = line.partition(":")
            names = voice_names(candidate)
            voices = ()
            known = names and all(name.casefold() in roster for name in names)
            if colon and not body.strip() and after_break and index < last_nonempty:
                # A handle on its own line can introduce the following stanza.
                bare_handle = (
                    looks_like_handle(candidate.strip()) and
                    (index == 0 or previous_header and previous_header.legend or not rows[index + 1])
                )
                if known or bare_handle:
                    for name in names:
                        roster.setdefault(name.casefold(), name)
                    legend = " & ".join(roster[name.casefold()] for name in names)
                    pending = replace(pending or Section("verse"), legend=legend)
                    continue
            if colon and body.strip() and known:
                voices = tuple(dict.fromkeys(roster[name.casefold()] for name in names))
                line = body.strip()
            if pending:
                starts[len(lyrics)] = pending
                previous_header = pending
                pending = None
            lyrics.append(Lyric(index + 1, format_line(line), after_break, voices))
            after_break = False
    return lyrics, starts, roster, title


def outline_lines(lyrics, source_sections):
    """Protect authored passages, while allowing the model to find where an intro ends."""
    current = None
    allowed = []
    for index, line in enumerate(lyrics):
        if index in source_sections:
            current = source_sections[index]
        elif line.after_break and (current is None or current.kind == "intro"):
            allowed.append(line.number)
    return allowed


def refrain_blocks(lyrics, source_sections):
    """Find full, repeated stanzas using exact words and original line breaks."""
    starts = [i for i, line in enumerate(lyrics) if line.after_break]
    groups = defaultdict(list)
    authored_structure = any(section.kind != "verse" for section in source_sections.values())
    for start, end in zip(starts, starts[1:] + [len(lyrics)]):
        known = source_sections.get(start)
        if (known and known.kind not in ("chorus", "refrain")) or (not known and authored_structure):
            continue
        words = tuple(tuple(re.findall(r"\w+", VOICE_TAG.sub("", row.text).casefold())) for row in lyrics[start:end])
        if len(words) >= 2 and sum(map(len, words)) >= 4:
            groups[words].append(start)
    return {start for positions in groups.values() if len(positions) > 1 for start in positions}


def prepare_genius(rows, artists):
    lyrics, source_sections, roster, title = parse_lyrics(rows, artists)
    repeats = refrain_blocks(lyrics, source_sections)
    data = {
        "lyrics": [[line.number, line.text] for line in lyrics],
        "blank_before": [line.number for line in lyrics[1:] if line.after_break],
        "source_headers": [
            [lyrics[index].number, section.kind, section.legend] for index, section in source_sections.items()
        ],
        "confirmed_repeated_stanzas": [lyrics[index].number for index in sorted(repeats)],
        "provided_voice_cues": [[line.number, list(line.voices)] for line in lyrics if line.voices],
        "allowed_section_starts": outline_lines(lyrics, source_sections),
    }
    return lyrics, source_sections, roster, repeats, title, data


def choose_sections(lyrics, source_sections, repeats, proposed):
    index_by_number = {line.number: index for index, line in enumerate(lyrics)}
    accepted = dict(source_sections)
    for index in sorted(repeats):
        accepted.setdefault(index, Section("chorus"))
    stanza_starts = [i for i, line in enumerate(lyrics) if line.after_break]
    next_stanza = dict(zip(stanza_starts, stanza_starts[1:]))
    allowed = set(outline_lines(lyrics, source_sections))
    refrain_interior = {
        position for start in repeats
        for position in range(start + 1, next_stanza.get(start, len(lyrics)))
    }
    proposals = defaultdict(set)
    for item in proposed or ():
        if not isinstance(item, dict):
            continue
        number, kind = item.get("line"), item.get("kind")
        if type(number) is not int or number not in allowed or not isinstance(kind, str) or kind not in LABELS:
            continue
        position = index_by_number.get(number)
        if (
            position is not None and position not in refrain_interior
            and (kind != "intro" or position == 0) and (kind != "outro" or position > 0)
        ):
            if kind == "intro":
                end = next_stanza.get(position, len(lyrics))
                opening = "\n".join(VOICE_TAG.sub("", row.text) for row in lyrics[position:end])
                if not WHOLE_PARENTHETICAL.fullmatch(opening):
                    continue
            proposals[position].add(kind)
    inferred = {
        position: Section(kinds.pop()) for position, kinds in proposals.items() if len(kinds) == 1
    }
    last_known_start = max(inferred.keys() | accepted.keys(), default=-1)
    inferred = {
        index: section for index, section in inferred.items()
        if section.kind != "outro" or index == last_known_start
    }

    for index in sorted(repeats):
        following = next_stanza.get(index)
        if following is None or following in accepted or index in source_sections:
            continue
        proposal = inferred.get(following)
        if proposal is None or proposal.kind in ("chorus", "refrain"):
            passage = "\n".join(row.text for row in lyrics[following:])
            is_parenthesized_ending = (
                following not in next_stanza and following + 1 < len(lyrics)
                and WHOLE_PARENTHETICAL.fullmatch(VOICE_TAG.sub("", passage))
            )
            accepted[following] = Section("outro" if is_parenthesized_ending else "verse")

    combined = {**inferred, **accepted}
    chosen = {0: Section("verse")} if combined and 0 not in combined else {}
    has_ai = False
    for index, section in sorted(combined.items()):
        if index not in accepted and chosen:
            previous_index = next(reversed(chosen))
            previous = chosen[previous_index]
            same_kind = section.kind == previous.kind
            singer_changed = (
                lyrics[index - 1].voices and lyrics[index].voices
                and not set(lyrics[index - 1].voices).intersection(lyrics[index].voices)
            )
            if same_kind and not (section.kind == "verse" and lyrics[index].after_break and singer_changed):
                continue
        chosen[index] = section
        has_ai |= index not in accepted
    return chosen, has_ai


def style_voice(text, index):
    if index == 0:
        return text
    left, right = (("", ""), ("<i>", "</i>"), ("<b>", "</b>"), ("<i><b>", "</b></i>"))[index]
    match = WHOLE_PARENTHETICAL.fullmatch(text)
    return "(" + left + match[1] + right + ")" if match else left + text + right


def format_voices(section, lyrics, roster):
    legend = section.legend
    names = voice_names(legend)
    # A supplied single-voice header grounds unlabeled lines. Preserve a preformatted shared legend.
    default = names if len(names) == 1 else ()
    groups = [line.voices or default for line in lyrics]
    counts = Counter(group for group in groups if group)
    can_format = bool(counts) and all(groups) and len(counts) <= 4 and not any(VOICE_TAG.search(row.text) for row in lyrics)
    if can_format:
        slots = {group: index for index, (group, _) in enumerate(counts.most_common())}
        voices = [style_voice(" & ".join(group), slot) for group, slot in slots.items()]
        if len(voices) > 1:
            legend = ", ".join(voices[:-1]) + " & " + voices[-1]
        elif legend or len(roster) > 1 or any(line.voices for line in lyrics):
            legend = voices[0]
        output = []
        for group, items in groupby(zip(lyrics, groups), key=lambda item: item[1]):
            passage = "\n".join(row.text for row, _ in items)
            output.append(style_voice(passage, slots[group]))
        return legend, "\n".join(output), False

    blurred = bool(counts) or (len(roster) > 1 and not legend)
    if legend and len(names) > 1 and not any(VOICE_TAG.search(row.text) for row in lyrics):
        blurred = True
    # Keep the editor's cues visible whenever we cannot safely convert them to voice markup.
    output = [
        (" & ".join(row.voices) + ": " if row.voices else "") + row.text
        for row in lyrics
    ]
    return legend, "\n".join(output), blurred


def manual_draft(lyrics, source_sections, roster, title, russian, reason=GAP_WARNING):
    lines = []
    for index, row in enumerate(lyrics):
        if index and row.after_break:
            lines.append("")
        section = source_sections.get(index)
        if section:
            label = LABELS[section.kind][0 if russian else 1]
            number = " " + section.number if section.number else ""
            legend = ": " + section.legend if section.legend else ""
            lines.append(f"[{label}{number}{legend}]")
        lines.append((" & ".join(row.voices) + ": " if row.voices else "") + row.text)
    return {
        "text": (title + "\n\n" if title else "") + "\n".join(lines),
        "mode": "fallback",
        "warnings": [reason, *([VOICE_WARNING] if len(roster) > 1 else [])],
    }


def valid_section_output(block, expected, lyrics, roster):
    header, separator, body = block.partition("\n")
    if not separator or parse_header(header) != expected:
        return False
    if any(name.casefold() not in roster for name in voice_names(expected.legend)):
        return False

    # Match every original line in order, ignoring only the supported voice formatting.
    actual = [line for line in body.splitlines() if line.strip()]
    if len(actual) != len(lyrics):
        return False
    for line, row in zip(actual, lyrics):
        if parse_header(line, roster):
            return False
        plain = VOICE_TAG.sub("", line)
        original = VOICE_TAG.sub("", row.text)
        if plain != original and (not row.voices or plain != " & ".join(row.voices) + ": " + original):
            return False

    for value in (expected.legend, body):
        opened = []
        for match in VOICE_TAG.finditer(value):
            tag = match[0].lower()
            if not tag.startswith("</"):
                opened.append(tag[1])
            elif not opened or opened.pop() != tag[2]:
                return False
        if opened:
            return False
    return True


def render_genius(prepared, proposed):
    lyrics, source_sections, roster, repeats, title, _ = prepared
    words = "".join(row.text for row in lyrics)
    russian = len(re.findall(r"[а-яё]", words, re.I)) >= max(1, len(re.findall(r"[a-z]", words, re.I)))
    starts, has_ai = choose_sections(lyrics, source_sections, repeats, proposed)
    if not starts and lyrics and all(row.voices for row in lyrics):
        starts = {0: Section("verse")}
    if not starts:
        return manual_draft(lyrics, source_sections, roster, title, russian)
    indexes = list(starts)
    joined = set()
    prior = None
    for index, end in zip(indexes, indexes[1:] + [len(lyrics)]):
        section = starts[index]
        if section.kind not in ("chorus", "refrain"):
            prior = None
            continue
        passage = (section, tuple((line.text.casefold(), line.voices) for line in lyrics[index:end]))
        if passage == prior:
            joined.add(index)
        prior = passage
    indexes = [index for index in indexes if index not in joined]
    verse_total = sum(section.kind == "verse" for section in starts.values())
    verse_count = 0
    output = [title] if title else []
    uncertain_voices = False
    for index, end in zip(indexes, indexes[1:] + [len(lyrics)]):
        section = starts[index]
        kind = "chorus" if section.kind == "hook" and not russian else section.kind
        label = LABELS[kind][0 if russian else 1]
        if section.kind == "verse":
            verse_count += 1
            number = section.number
            if not number and verse_total > 1 and (index not in source_sections or len(roster) > 1):
                number = str(verse_count)
            if number:
                label += f" {number}"
        legend, body, blurred = format_voices(section, lyrics[index:end], roster)
        uncertain_voices |= blurred
        block = f"[{label}{': ' + legend if legend else ''}]\n{body}"
        expected = Section(kind, legend, label.partition(" ")[2])
        if not valid_section_output(block, expected, lyrics[index:end], roster):
            return manual_draft(lyrics, source_sections, roster, title, russian, INTEGRITY_WARNING)
        output.append(block)
    mode = "ai" if has_ai else "source" if source_sections and not repeats.difference(source_sections) else "fallback"
    warnings = [GAP_WARNING] if mode != "source" or len(source_sections) < len(starts) else []
    if uncertain_voices:
        warnings.append(VOICE_WARNING)
    return {"text": "\n\n".join(output), "mode": mode, "warnings": warnings}
