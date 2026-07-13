# blog-test2 Cron Scheduler

이 Worker는 30분마다 Pages의 `/api/news/collect`를 호출해 네이트 연예 일간 랭킹
1위부터 10위까지 확인합니다. 초안 승인 여부와 관계없이 랭킹 확인은 계속되며,
동시 실행은 D1의 `nate-entertainment-collection` 잠금으로 차단합니다.

## 사전 설정

`wrangler.jsonc`의 `PAGES_BASE_URL`을 실제 Pages 기본 주소(커스텀 도메인을 쓰는 경우
그 주소)로 확인합니다. 글과 홈판을 생성하는 `OPENAI_API_KEY`, `OPENAI_MODEL`,
`OPENAI_IMAGE_MODEL`은 Scheduler가 아니라 Pages 프로젝트의 secret/variable로 둡니다.

## 배포

```bash
npx wrangler deploy --config scheduler-worker/wrangler.jsonc
```

배포 후 Cloudflare 대시보드에서 `blog-test2-scheduler`의 Cron Trigger가
`*/30 * * * *`인지 확인합니다.

## 로컬 테스트

루트 `.dev.vars`에는 Pages용 OpenAI 설정을 둡니다. `.dev.vars`는 Git에서 제외됩니다.

```dotenv
# 루트 .dev.vars
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6-sol
OPENAI_IMAGE_MODEL=gpt-image-2
```

터미널 두 개에서 Pages와 Worker를 실행합니다.

```bash
npx wrangler pages dev .
npx wrangler dev --config scheduler-worker/wrangler.jsonc --test-scheduled
```

로컬 Pages 주소가 설정값과 다르면 Worker 실행 시 임시로 덮어씁니다.

```bash
npx wrangler dev --config scheduler-worker/wrangler.jsonc --test-scheduled \
  --var PAGES_BASE_URL:http://localhost:8788
```

그다음 scheduled 핸들러를 직접 호출합니다.

```bash
curl 'http://localhost:8787/__scheduled?cron=*/30+*+*+*+*'
```

Pages API 인증도 별도로 확인할 수 있습니다.

```bash
# 예약 실행용 엔드포인트: AUTOMATION_TOKEN 필요
curl -X POST 'http://localhost:8788/api/automation/run' \
  -H 'Authorization: Bearer replace-with-the-same-automation-secret' \
  -H 'Content-Type: application/json' \
  -d '{"force":false}'

# 화면의 "지금 1회 실행"과 같은 수동 실행 엔드포인트
curl -X POST 'http://localhost:8788/api/automation/manual-run'
```

API 호출이 실패하면 Worker는 `last_run_at`을 변경하지 않고 `next_run_at`을 실행 시각의
5분 뒤로 설정합니다. Worker 로그는 다음 명령으로 확인합니다.

```bash
npx wrangler tail blog-test2-scheduler
```
