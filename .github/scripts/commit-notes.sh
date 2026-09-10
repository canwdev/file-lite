#!/usr/bin/env bash
# 从提交记录生成预发布（master 构建）的 Release 正文，写入 RELEASE_NOTES.md。
# 用法：bash .github/scripts/commit-notes.sh v1.4.4-pre.42
# 需要完整历史与 tags（actions/checkout 使用 fetch-depth: 0）。
set -euo pipefail

TAG="${1:?usage: commit-notes.sh <tag>}"
OUT="RELEASE_NOTES.md"
REPO="${GITHUB_REPOSITORY:-canwdev/file-lite}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"

# 最近的一个版本 tag 作为范围起点（排除本次要创建的 tag，忽略 archive/* 等非版本 tag）。
PREV="$(git tag --merged HEAD --sort=-v:refname | grep -E '^v[0-9]' | grep -Fvx "$TAG" | head -n1 || true)"

{
  echo "Automated pre-release build from \`master\` (\`${SHA:0:7}\`)."
  echo
  echo "### Commits"
  echo
  if [ -n "$PREV" ]; then
    git log "${PREV}..HEAD" --no-merges --pretty=format:'- %s (%h)'
  else
    git log --no-merges --pretty=format:'- %s (%h)'
  fi
  echo
  echo
  if [ -n "$PREV" ]; then
    echo "**Full Changelog**: https://github.com/${REPO}/compare/${PREV}...${SHA}"
  else
    echo "**Full Changelog**: https://github.com/${REPO}/commits/${SHA}"
  fi
} > "$OUT"

# 只有空行也算没生成出来，交给调用方回退到自动生成
if ! grep -q '[^[:space:]]' "$OUT"; then
  rm -f "$OUT"
fi
