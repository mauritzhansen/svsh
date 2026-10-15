#!/usr/bin/env python3
"""Regression suite for the SVSH Claude Code Bash hooks.

Run after ANY change to allow-safe-commands.sh / block-bad-shell.sh /
block-stash.sh / block-bare-commit.sh / _shellscan.py:

    python3 .claude/hooks/tests/run_tests.py

A Python entrypoint (not a .sh) so it rides the already-trusted `python3`
leader and never triggers a permission prompt. Exits non-zero if any
case fails.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SUITES = ["test_allow_safe_commands.py", "test_block_bad_shell.py",
          "test_block_bare_commit.py", "test_block_stash.py"]

failed = False
for suite in SUITES:
    print(f"=== {suite} ===")
    rc = subprocess.run([sys.executable, os.path.join(HERE, suite)]).returncode
    if rc != 0:
        failed = True

print("SOME SUITES FAILED" if failed else "ALL HOOK SUITES PASS")
sys.exit(1 if failed else 0)
