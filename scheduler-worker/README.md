# blog-test2 Cron Scheduler

이 Worker는 5분마다 D1의 `automation_settings`(`id = 1`)를 확인하고, 활성화 상태,
Asia/Seoul 운영 시간, `next_run_at` 조건을 모두 만족할 때만 Pages 자동화 API를 호출합니다.

## 사전 설정

`wrangler.jsonc`의 `PAGES_BASE_URL`을 실제 Pages 기본 주소(커스텀 도메인을 쓰는 경우
그 주소)로 확인합니다. `AUTOMATION_TOKEN`은 저장소나 설정 파일에 쓰지 않고 Worker
secret과 Pages secret에 **동일한 값**으로 등록합니다.

```bash
# 저장소 루트에서 Worker secret 등록
npx wrangler secret put AUTOMATION_TOKEN --config scheduler-worker/wrangler.jsonc

# Pages 프로젝트에도 같은 값을 secret으로 등록
npx wrangler pages secret put AUTOMATION_TOKEN --project-name blog-test2

# 브라우저의 "지금 1회 실행" 전용 별도 secret
npx wrangler pages secret put MANUAL_AUTOMATION_TOKEN --project-name blog-test2
```

Pages 대시보드를 사용한다면 **Workers & Pages → blog-test2 → Settings → Variables and
Secrets**에서 `AUTOMATION_TOKEN`, `MANUAL_AUTOMATION_TOKEN`을 encrypted secret으로
등록해도 됩니다. 두 토큰은 서로 다른 충분히 긴 무작위 값을 사용하세요.

## 배포

```bash
npx wrangler deploy --config scheduler-worker/wrangler.jsonc
```

배포 후 Cloudflare 대시보드에서 `blog-test2-scheduler`의 Cron Trigger가
`*/5 * * * *`인지 확인합니다.

## 로컬 테스트

루트 `.dev.vars`에는 Pages용 secret을, `scheduler-worker/.dev.vars`에는 Worker용
secret을 둡니다. `.dev.vars`는 Git에서 제외됩니다.

```dotenv
# 루트 .dev.vars
AUTOMATION_TOKEN=replace-with-a-random-secret
MANUAL_AUTOMATION_TOKEN=replace-with-another-random-secret
```

```dotenv
# scheduler-worker/.dev.vars
AUTOMATION_TOKEN=replace-with-the-same-automation-secret
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
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'
```

Pages API 인증도 별도로 확인할 수 있습니다.

```bash
# 예약 실행용 엔드포인트: AUTOMATION_TOKEN 필요
curl -X POST 'http://localhost:8788/api/automation/run' \
  -H 'Authorization: Bearer replace-with-the-same-automation-secret' \
  -H 'Content-Type: application/json' \
  -d '{"force":false}'

# 수동 실행용 엔드포인트: MANUAL_AUTOMATION_TOKEN 필요
curl -X POST 'http://localhost:8788/api/automation/manual-run' \
  -H 'X-Manual-Automation-Token: replace-with-another-random-secret'
```

API 호출이 실패하면 Worker는 `last_run_at`을 변경하지 않고 `next_run_at`을 실행 시각의
5분 뒤로 설정합니다. Worker 로그는 다음 명령으로 확인합니다.

```bash
npx wrangler tail blog-test2-scheduler
```
