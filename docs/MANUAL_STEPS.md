# 사용자가 직접 해야 할 작업

아래 작업은 이번 구현에서 실행하지 않았다.

1. Cloudflare Pages에 `OPENAI_API_KEY`, `OPENAI_MODEL`, `AUTOMATION_TOKEN`,
   `MANUAL_AUTOMATION_TOKEN`, `PUBLISHER_TOKEN`을 encrypted secret으로 등록한다.
2. Scheduler Worker에도 Pages와 **같은** `AUTOMATION_TOKEN`을 secret으로 등록한다.
3. 운영 D1을 백업·확인한 뒤 `0003_final_mvp.sql` migration을 적용한다.
4. Pages와 Scheduler Worker를 배포하고 5분 Cron을 확인한다.
5. `publisher-app`에서 `npm install`을 실행하고 로컬 환경에 API 주소와
   `PUBLISHER_TOKEN`만 설정한다. 네이버 아이디/비밀번호는 어디에도 설정하지 않는다.
6. `npm start -- --login-check`로 열린 Chrome에서 네이버에 직접 로그인한다.
7. 네이버 에디터 변경 후에는 테스트 초안으로 기본 임시저장 동작을 먼저 확인한다.
8. 실제 공개 발행이 필요할 때만 `--publish`를 사용하고 화면의 추가 확인을 수행한다.

Secret 설정·원격 migration·배포 예시는 다음과 같다. 실행 전 프로젝트 이름을 확인한다.

```bash
npx wrangler pages secret put AUTOMATION_TOKEN --project-name blog-test2
npx wrangler pages secret put PUBLISHER_TOKEN --project-name blog-test2
npx wrangler secret put AUTOMATION_TOKEN --config scheduler-worker/wrangler.jsonc
npx wrangler d1 migrations apply blog-news-db --remote
npx wrangler deploy --config scheduler-worker/wrangler.jsonc
```
