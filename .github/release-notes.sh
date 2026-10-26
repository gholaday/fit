#!/usr/bin/env bash
# Release notes from the tagged "Release x.y.z" commit: its message without the title line or
# the Co-Authored-By trailer, then a link to every commit since the previous release.
# Prints nothing when the commit has no description, so the workflow can fall back to
# GitHub's generated notes. Usage: release-notes.sh <tag>
set -euo pipefail

tag="$1"
body=$(git log -1 --format=%B "$tag" | tail -n +2 | grep -v '^Co-Authored-By:' | sed '/./,$!d')
# Drop trailing blank lines.
body=$(printf '%s\n' "$body" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')
[ -n "$body" ] || exit 0

printf '%s\n' "$body"
prev=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true)
if [ -n "$prev" ]; then
  printf '\n**All commits:** https://github.com/%s/compare/%s...%s\n' "${GITHUB_REPOSITORY:-gholaday/fit}" "$prev" "$tag"
fi
