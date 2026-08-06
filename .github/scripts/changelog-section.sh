#!/usr/bin/env bash
# 从 CHANGELOG.md 抠出指定版本那一节，写入 RELEASE_NOTES.md 作为 Release 正文。
# 用法：bash .github/scripts/changelog-section.sh 1.4.2
# 标题允许带后缀（如 "## 1.4.2（UI 收敛）"），所以用前缀匹配而非全等。
# 找不到对应小节时不产出文件，由调用方回退到自动生成的 Release notes。
set -euo pipefail

VERSION="${1:?usage: changelog-section.sh <version>}"
OUT="RELEASE_NOTES.md"

awk -v v="$VERSION" '
  index($0, "## " v) == 1 { found = 1; next }
  found && /^## / { exit }
  found { print }
' CHANGELOG.md > "$OUT"

# 只有空行也算没抠到
if ! grep -q '[^[:space:]]' "$OUT"; then
  echo "CHANGELOG.md 中没有 ${VERSION} 小节，Release 正文回退到自动生成" >&2
  rm -f "$OUT"
fi
