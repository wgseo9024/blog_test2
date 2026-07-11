#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8788}"
failures=0

check() {
  local name="$1" method="$2" path="$3" expected="$4" data="${5:-}"
  local args=(--silent --show-error --output /tmp/blog-smoke-body.json --write-out '%{http_code}' --request "$method" "$BASE_URL$path")
  if [[ -n "$data" ]]; then args+=(--header 'Content-Type: application/json' --data "$data"); fi
  local code
  code="$(curl "${args[@]}")" || code="000"
  if [[ "$code" == "$expected" ]]; then printf 'PASS %-32s HTTP %s\n' "$name" "$code"; else
    printf 'FAIL %-32s expected=%s actual=%s\n' "$name" "$expected" "$code"; failures=$((failures + 1))
  fi
}

check 'automation settings' GET /api/automation/settings 200
check 'automation stats' GET /api/automation/stats 200
check 'articles list' GET /api/articles 200
check 'groups list' GET /api/groups 200
check 'drafts list' GET /api/drafts 200
check 'invalid draft filter' GET '/api/drafts?status=unknown' 400
check 'scheduler requires token' POST /api/automation/run 401 '{}'
check 'publisher requires token' GET /api/publisher/queued 401

if [[ "${RUN_MUTATING_TESTS:-0}" == "1" ]]; then
  check 'grouping run' POST /api/news/group 200 '{}'
fi

exit "$failures"
