# 운영 가이드

## 매일 확인

대시보드 상단의 오늘 수집·그룹·초안·발행 대기·실패 수를 확인한다. 자동화가 멈췄다면
`automation_run_logs`의 최근 `status`, `error_message`, `details`와 Scheduler 로그를 먼저
본다. `skipped`와 `RUN_IN_PROGRESS`는 이전 실행이 진행 중이라는 뜻이며 20분이 지나면
stale 잠금이 다음 호출에서 자동 제거된다.

```bash
npx wrangler d1 execute blog-news-db --remote --command \
  "SELECT * FROM automation_run_logs ORDER BY id DESC LIMIT 20"
npx wrangler d1 execute blog-news-db --remote --command \
  "SELECT * FROM automation_locks"
npx wrangler tail blog-test2-scheduler
```

## 장애 확인 순서

1. Pages와 Scheduler의 `AUTOMATION_TOKEN`이 동일한지 값 자체를 출력하지 않고 설정 여부만 확인한다.
2. `automation_settings`의 enabled, KST 운영 시간, next_run_at을 확인한다.
3. RSS 일부 실패는 정상적으로 격리된다. 해당 source 오류만 확인한다.
4. OpenAI 오류 코드를 확인하고 모델 접근 권한, 한도, API 사용량을 점검한다.
5. 발행 도우미 실패는 `draft_publish_events`와 `publisher-app/artifacts`를 확인한다.

## 비용 관리

- 하루 처리량을 1~30 사이로 유지하고 처음에는 3으로 운영한다.
- 한 그룹은 최대 5개 기사, 기사별 핵심 텍스트는 최대 12,000자로 제한된다.
- 그룹별 초안은 하나만 생성되어 중복 OpenAI 비용을 막는다.
- D1의 오래된 실행 로그와 발행 이벤트는 감사 보존 기간을 정한 뒤 수동 정리한다.

## Scheduler 로컬 검증

두 터미널에서 Pages와 Worker를 실행한 뒤 scheduled URL을 호출한다. 토큰은 각각의
`.dev.vars`에 같은 값으로 넣고 저장소에는 커밋하지 않는다.

```bash
npx wrangler pages dev .
npx wrangler dev --config scheduler-worker/wrangler.jsonc --test-scheduled \
  --var PAGES_BASE_URL:http://localhost:8788
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'
```

## migration 전후 확인

```bash
npx wrangler d1 migrations list blog-news-db --local
npx wrangler d1 migrations apply blog-news-db --local
npx wrangler d1 execute blog-news-db --local --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# 운영 적용은 DB 이름과 백업 정책을 확인한 뒤 사용자가 직접 실행
npx wrangler d1 migrations list blog-news-db --remote
npx wrangler d1 migrations apply blog-news-db --remote
```
