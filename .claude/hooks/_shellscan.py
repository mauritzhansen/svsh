#!/usr/bin/env python3
"""Single source of truth for shell tokenization used by the DBP Claude
Code Bash hooks (allow-safe-commands.sh, block-bad-shell.sh).

ONE quote/escape/heredoc-aware state machine, one pass, three outputs:

  ops      Skeleton with single- AND double-quoted spans, backslash-escaped
           chars, and heredoc BODIES blanked to spaces. The heredoc
           OPERATOR + delimiter token are kept literally (so `<<` is still
           detectable). Newlines are preserved. Use for structural denies:
           real-file redirects, process substitution, dangerous commands,
           git verbs, sed -i, find -delete, heredoc-to-file headers, loop
           keywords. (A real one of those is never inside quotes or a
           heredoc body — it would not execute.)

  csub     Like ops but DOUBLE-quoted content is KEPT, and a heredoc body
           is kept only when its delimiter is UNquoted (an unquoted
           `<<EOF` body still expands `$(...)`/backticks; a quoted
           `<<'EOF'` body is literal). Use only for command-substitution
           detection.

  segments Original command text split on the shell control operators
           `&& || ; | <newline>` in normal (unquoted, non-heredoc) state.
           Heredoc bodies are absorbed into the declaring segment (never
           split); the line after a heredoc terminator starts a fresh
           segment so a trailing real command is independently checked.
           Subshell parens are left intact (peeled by the caller).

Importable: `from _shellscan import scan` -> (ops, csub, segments).
CLI: `_shellscan.py {ops|csub|segs} "<cmd>"` -> prints that artifact
(segs are NUL-joined). Pure and deterministic, so multiple CLI calls are
as consistent as one in-process call (no drift — single code path).
"""
import sys

_DELIM_STOP = set(" \t\n;|&<>()")


def scan(s):
    ops, csub, buf, out = [], [], [], []
    i, n, st = 0, len(s), "N"
    heredocs = []  # pending [(delim, strip_tabs, quoted)] on the line

    while i < n:
        c = s[i]

        if st == "N":
            # backslash-escaped char: blanked in skeletons, kept in segment
            if c == "\\" and i + 1 < n:
                ops.append("  "); csub.append("  ")
                buf.append(c); buf.append(s[i + 1]); i += 2; continue
            if c == "'":
                st = "S"; ops.append(" "); csub.append(" ")
                buf.append(c); i += 1; continue
            if c == '"':
                st = "D"; ops.append(" "); csub.append(" ")
                buf.append(c); i += 1; continue

            # Heredoc intro `<< [-] [\] DELIM` / `<<'DELIM'` / `<<"DELIM"`,
            # but NOT the `<<<` here-string. Keep the intro literal in all
            # three; only the BODY is special (consumed when the line ends).
            if (c == "<" and i + 1 < n and s[i + 1] == "<"
                    and not (i + 2 < n and s[i + 2] == "<")):
                ops.append("<<"); csub.append("<<"); buf.append("<<")
                j = i + 2
                strip_tabs = False
                quoted = False
                if j < n and s[j] == "-":
                    strip_tabs = True
                    ops.append("-"); csub.append("-"); buf.append("-"); j += 1
                while j < n and s[j] in " \t":
                    ops.append(s[j]); csub.append(s[j]); buf.append(s[j]); j += 1
                if j < n and s[j] == "\\":
                    quoted = True
                    ops.append(s[j]); csub.append(s[j]); buf.append(s[j]); j += 1
                delim = []
                if j < n and s[j] in ("'", '"'):
                    quoted = True
                    q = s[j]
                    ops.append(s[j]); csub.append(s[j]); buf.append(s[j]); j += 1
                    while j < n and s[j] != q:
                        delim.append(s[j])
                        ops.append(s[j]); csub.append(s[j]); buf.append(s[j])
                        j += 1
                    if j < n:
                        ops.append(s[j]); csub.append(s[j]); buf.append(s[j])
                        j += 1
                else:
                    while j < n and s[j] not in _DELIM_STOP:
                        delim.append(s[j])
                        ops.append(s[j]); csub.append(s[j]); buf.append(s[j])
                        j += 1
                if delim:
                    heredocs.append(("".join(delim), strip_tabs, quoted))
                i = j
                continue

            # Operators: split segments; keep literally in skeletons.
            if c == "&" and i + 1 < n and s[i + 1] == "&":
                ops.append("&&"); csub.append("&&")
                out.append("".join(buf)); buf = []; i += 2; continue
            if c == "|" and i + 1 < n and s[i + 1] == "|":
                ops.append("||"); csub.append("||")
                out.append("".join(buf)); buf = []; i += 2; continue

            if c == "\n" and heredocs:
                # End of the command line: consume each pending heredoc
                # body up to & incl. its terminator line — data, no split.
                ops.append("\n"); csub.append("\n"); buf.append("\n")
                i += 1
                for delim, strip_tabs, quoted in heredocs:
                    while i < n:
                        ls = i
                        while i < n and s[i] != "\n":
                            i += 1
                        line = s[ls:i]
                        if i < n:
                            i += 1
                        chunk = s[ls:i]
                        ops.append(" " * len(chunk))
                        csub.append(" " * len(chunk) if quoted else chunk)
                        buf.append(chunk)
                        test = line.lstrip("\t") if strip_tabs else line
                        if test == delim:
                            break
                heredocs = []
                # Terminator ends the command ⇒ split so anything after is
                # independently adjudicated.
                out.append("".join(buf)); buf = []
                continue

            if c in "|;\n":
                ops.append(c); csub.append(c)
                out.append("".join(buf)); buf = []; i += 1; continue

            ops.append(c); csub.append(c); buf.append(c); i += 1; continue

        if st == "S":
            ops.append(" "); csub.append(" "); buf.append(c)
            if c == "'":
                st = "N"
            i += 1
            continue

        # st == "D"
        if c == "\\" and i + 1 < n and s[i + 1] in '"\\$`':
            ops.append("  "); csub.append("  ")
            buf.append(c); buf.append(s[i + 1]); i += 2; continue
        ops.append(" "); csub.append(c); buf.append(c)
        if c == '"':
            st = "N"
        i += 1

    out.append("".join(buf))
    return "".join(ops), "".join(csub), out


def _main(argv):
    if len(argv) < 3:
        return 2
    mode, cmd = argv[1], argv[2]
    ops, csub, segs = scan(cmd)
    if mode == "ops":
        sys.stdout.write(ops)
    elif mode == "csub":
        sys.stdout.write(csub)
    elif mode == "segs":
        sys.stdout.write("\0".join(segs))
    else:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
