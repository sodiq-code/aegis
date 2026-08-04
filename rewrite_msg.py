#!/usr/bin/env python3
"""Rewrite commit messages: remove task numbers and (Day N) references.

IMPORTANT: All whitespace tokens in the regexes below use ``[ \\t]``
(horizontal whitespace only) instead of ``\\s`` so that matches never cross
newline boundaries. This preserves blank lines that separate the commit
subject from the body (a previous version used ``\\s*`` which greedily
consumed the preceding newline and collapsed the subject into the body).
"""
import re
import sys

# Horizontal whitespace (space or tab) — never matches newlines.
_H = r'[ \t]'


def clean_message(msg: str) -> str:
    # 1. Remove "(Day N)" / "(day N)" patterns (with optional preceding horizontal space)
    msg = re.sub(_H + r'*\(Day' + _H + r'*\d+\)', '', msg, flags=re.IGNORECASE)

    # 2. Remove leading "taskNN:" style prefix at start of a line (lowercase, no space)
    #    e.g. "task34: CI workflow..." -> "CI workflow..."
    msg = re.sub(r'(?im)^' + _H + r'*task' + _H + r'*\d+' + _H + r'*:' + _H + r'*', '', msg)

    # 3. Remove "Task N" / "Tasks N" / "Tasks N & M" / "Tasks N-M" patterns
    #    Case-insensitive, with optional separator after the number(s)
    msg = re.sub(
        r'\b[Tt]asks?' + _H + r'*\d+(?:' + _H + r'*[-&]' + _H + r'*\d+)?' + _H + r'*',
        '',
        msg,
    )

    # 4. Clean up separators left after a conventional-commit type prefix.
    #    e.g. "feat:  — UI/UX..." -> "feat: UI/UX..."
    #         "feat:  - Hardening..." -> "feat: Hardening..."
    msg = re.sub(
        r'\b(feat|fix|docs|chore|style|refactor|perf|test|build|ci|revert)' + _H + r'*:'
        + _H + r'*[-–—]+' + _H + r'*',
        r'\1: ',
        msg,
    )

    # 5. Clean up leading em-dash separators (—, –) that linger at the start of
    #    the subject line after task removal, e.g. "— PMW integration" -> "PMW integration".
    #    NOTE: regular hyphens "-" are deliberately NOT touched here because they are
    #    legitimate markdown bullet markers in commit bodies.
    msg = re.sub(r'(?m)^[–—]+' + _H + r'*', '', msg)

    # 6. Also handle a leading ": " that may remain after "taskNN:" removal if the
    #    colon wasn't captured (defensive)
    msg = re.sub(r'(?m)^:' + _H + r'*', '', msg)

    # 7. Collapse multiple horizontal spaces (but keep newlines)
    msg = re.sub(r'[ \t]{2,}', ' ', msg)

    # 8. Strip trailing whitespace per line
    msg = '\n'.join(line.rstrip() for line in msg.split('\n'))

    # 9. Strip leading horizontal whitespace on each non-empty line (preserve blank lines)
    lines = msg.split('\n')
    cleaned_lines = []
    for line in lines:
        if line.strip():
            cleaned_lines.append(line.lstrip(' \t'))
        else:
            cleaned_lines.append('')
    msg = '\n'.join(cleaned_lines)

    # 10. Remove leading/trailing blank lines, ensure single trailing newline
    msg = msg.strip()
    if msg:
        msg = msg + '\n'

    return msg


if __name__ == '__main__':
    data = sys.stdin.read()
    sys.stdout.write(clean_message(data))
