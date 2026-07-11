# Cloudflare Pages 블로그 생성기

정적 화면은 `index.html`, OpenAI 호출은 `functions/api/generate.js`에서 처리합니다.
브라우저에는 OpenAI API 키가 전달되지 않습니다.

## 처음 시작하는 순서

1. Node.js 20 이상을 설치합니다.
2. 로컬 D1 migration을 적용합니다: `npx wrangler d1 migrations apply blog-news-db --local`
3. `.dev.vars`에 필요한 로컬 secret을 넣습니다. 이 파일은 Git에 포함되지 않습니다.
4. `npx wrangler pages dev .`로 대시보드를 엽니다.
5. 수집 → 그룹화 → 초안 생성 → 검토 → 발행 대기 순서로 확인합니다.

자동화 실행은 실제 네이버 발행을 하지 않습니다. `publish` 자동화 모드는 승인된 초안을
`queued` 상태로 만드는 의미입니다. 실제 네이버 조작은 별도 `publisher-app`이 로컬
Chrome에서 수행하며 기본 동작도 임시저장까지만입니다.

운영과 장애 확인은 `docs/OPERATIONS.md`, 사람이 직접 해야 하는 배포·Secret·로그인 작업은
`docs/MANUAL_STEPS.md`, 구현 기준선과 호환성 판단은 `docs/FINAL_IMPLEMENTATION_PLAN.md`를
참고하세요.

2026-07-11에 추가된 광고 점수, 3단계 AI 검증, 구조화 초안, 권리 승인 이미지 처리의 감사 결과는
`docs/NON_DUPLICATE_GAP_REPORT.md`, 사용자가 직접 해야 하는 R2/Windows 설정은
`docs/IMAGE_PIPELINE_SETUP.md`를 참고하세요. 기존 migration은 수정하지 않았으며 신규 변경은
`migrations/0004_editorial_validation_images.sql`에만 들어 있습니다.

Windows에서 승인된 초안을 5분 간격으로 임시저장 처리하려면 `publisher-app`의 `.env`에
`AUTO_SAVE_DRAFT=YES`, `NAVER_BLOG_CATEGORY`를 설정하고 `npm run watch`를 실행합니다.

## D1 기사 API

다음 Pages Functions가 `DB` D1 binding의 `articles` 테이블을 사용합니다.

- `functions/api/articles/index.js`: `GET /api/articles`, `POST /api/articles`
- `functions/api/articles/[id].js`: `GET /api/articles/:id`, `DELETE /api/articles/:id`
- `functions/api/news/collect.js`: `POST /api/news/collect` (고정 RSS 수집 및 D1 저장)
- `functions/api/news/group.js`: `POST /api/news/group` (새 기사 유사도 분석 및 그룹 생성)
- `functions/api/groups/index.js`: `GET /api/groups` (최신 이슈 그룹 목록)
- `functions/api/groups/[id].js`: `GET /api/groups/:id` (그룹 기사와 요약 조회)
- `functions/api/groups/[id]/generate.js`: `POST /api/groups/:id/generate` (기사 교차 비교, 초안 생성 및 저장)
- `functions/api/drafts/index.js`: `GET /api/drafts` (최신 초안 최대 100개)
- `functions/api/drafts/[id].js`: `GET`, `PUT`, `DELETE /api/drafts/:id`
- `index.html`: 기사 제목, URL, 출처, 요약 저장 폼과 최근 기사 목록 테스트 영역

목록 API는 최신순으로 최대 100건을 반환하며 `status`, `source`, `keyword` 쿼리
파라미터를 지원합니다. 모든 기사 API 응답은 아래 형식 중 하나입니다.

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": { "message": "오류 메시지" } }
```

## Cloudflare Pages 배포

1. Cloudflare 대시보드에서 **Workers & Pages → Create → Pages → Connect to Git**를 선택합니다.
2. 이 GitHub 저장소를 연결합니다.
3. 프레임워크 프리셋은 `None`, 빌드 명령은 비워 두고, 빌드 출력 디렉터리는 `/`로 설정합니다.
4. 프로젝트의 **Settings → Variables and Secrets**에서 다음 값을 추가합니다.
   - `OPENAI_API_KEY`: OpenAI API 키. 반드시 **Secret/Encrypt**로 저장합니다.
   - `OPENAI_MODEL`: 사용할 Responses API 모델 이름입니다. 그룹 초안 생성에 필수입니다.
   - `AUTOMATION_TOKEN`: Scheduler와 동일한 긴 무작위 secret입니다.
   - `MANUAL_AUTOMATION_TOKEN`: 대시보드 수동 실행 전용 secret입니다.
   - `PUBLISHER_TOKEN`: 로컬 발행 도우미 전용 secret입니다.
5. 새 배포를 실행합니다.

배포 후 화면에 연예뉴스 기사 제목과 본문을 붙여 넣고 **블로그 글 작성**을 누르면
`/api/generate` Pages Function이 OpenAI Responses API를 호출합니다. 웹 검색 없이
사용자가 제공한 기사 내용 안에서만 제목, 700~800자 분량의 본문, 태그 10개를 생성합니다.

## 로컬 실행

`.dev.vars` 파일을 만들고 키를 넣습니다. 이 파일은 Git에서 제외됩니다.

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6-sol
```

그다음 Wrangler로 Pages 개발 서버를 실행합니다.

```bash
npx wrangler pages dev .
```

로컬 D1에 테이블이 없다면 최초 한 번 migration을 적용합니다.

```bash
npx wrangler d1 migrations apply blog-news-db --local
```

### 테스트 방법

1. 개발 서버에서 화면 하단의 **D1 기사 저장 테스트** 영역을 엽니다.
2. 필수 항목인 기사 제목과 URL을 입력하고 **기사 저장**을 누릅니다.
3. **저장된 기사 목록 불러오기**를 눌러 제목, 출처, 발행일, 상태 표시를 확인합니다.
4. 같은 URL을 다시 저장했을 때 HTTP 409 오류 메시지가 표시되는지 확인합니다.
5. API를 직접 확인하려면 다음 요청을 사용할 수 있습니다.

```bash
curl 'http://localhost:8788/api/articles?status=new&source=테스트&keyword=AI'

curl -X POST 'http://localhost:8788/api/articles' \
  -H 'Content-Type: application/json' \
  -d '{"title":"테스트 기사","url":"https://example.com/article-1","source":"테스트","summary":"요약"}'

curl 'http://localhost:8788/api/articles/1'
curl -X DELETE 'http://localhost:8788/api/articles/1'
```

## RSS 뉴스 수집 API

`POST /api/news/collect`는 다음 4개 연예뉴스 RSS를 `fetch`로 요청하고, 피드별
최대 30개 기사를 `articles` 테이블에 저장합니다. 외부 패키지를 사용하지 않으며
RSS 2.0의 `item`과 Atom의 `entry`를 처리합니다.

- `sports-khan`: 스포츠경향 연예
- `mydaily`: 마이데일리 스타
- `newsis`: 뉴시스 연예
- `mbn`: MBN 연예

본문이 없으면 4개 피드를 모두 수집합니다.

```bash
curl -X POST 'http://localhost:8788/api/news/collect'
```

`sources` 배열에는 위 소스 ID를 지정합니다. 소스 이름이나 등록된 RSS URL도 사용할
수 있습니다.

```bash
curl -X POST 'http://localhost:8788/api/news/collect' \
  -H 'Content-Type: application/json' \
  -d '{"sources":["sports-khan","newsis"]}'
```

성공 응답은 전체 집계와 피드별 `fetched`, `inserted`, `duplicates`, `failed`를
반환합니다. HTTP 403/404, 타임아웃, XML 해석 오류는 해당 피드의 `error.type`과
안전한 사용자 메시지로 구분됩니다. 한 피드가 실패해도 나머지 피드 수집은 계속됩니다.

### RSS 수집 테스트

1. 로컬 D1 migration을 적용하고 `npx wrangler pages dev .`를 실행합니다.
2. 화면의 **RSS 뉴스 수집**에서 네 소스가 기본 선택되어 있는지 확인합니다.
3. **뉴스 수집**을 눌러 피드별 저장·중복·실패 수와 자동 갱신된 기사 목록을 확인합니다.
4. 같은 선택으로 다시 수집해 기존 URL이 `duplicates`로 집계되는지 확인합니다.
5. 위 `curl` 예제로 무본문 전체 수집과 `sources` 선택 수집을 각각 확인합니다.
6. `sources`를 빈 배열로 보내면 HTTP 400, GET 요청은 HTTP 405인지 확인합니다.

## 유사 기사 그룹 API

`POST /api/news/group`는 `status = 'new'`인 최신 기사 최대 200건의 제목을
정규화한 뒤 Jaccard 유사도 0.55 이상인 후보를 묶습니다. 공통 고유명사 후보가 있고
서로 다른 언론사가 포함된 2건 이상의 그룹만 저장합니다. 저장된 기사는 `grouped`로
변경되며, 이미 그룹에 포함된 기사는 다시 처리하지 않습니다.

```bash
curl -X POST 'http://localhost:8788/api/news/group'
```

성공 응답 예시입니다.

```json
{
  "success": true,
  "data": {
    "processed": 120,
    "groupsCreated": 10,
    "articlesGrouped": 28,
    "remaining": 92
  }
}
```

최신 그룹 목록과 특정 그룹의 기사 목록은 다음처럼 조회합니다. 상세 API는 기사 원문
전체를 반환하지 않고 제목, 언론사, URL, 요약, 발행일과 유사도만 반환합니다.

```bash
curl 'http://localhost:8788/api/groups'
curl 'http://localhost:8788/api/groups/1'
```

화면의 **유사 기사 그룹화** 버튼으로 작업을 실행한 뒤 생성·그룹화·미그룹 건수를
확인할 수 있습니다. 그룹을 클릭하면 기사별 제목과 요약이 표시됩니다.

## 기사 그룹 기반 블로그 초안 API

`POST /api/groups/:id/generate`는 그룹에 기사 2개 이상이 있을 때 최근 기사 중 최대
5개를 OpenAI Responses API에 전달합니다. 서로 다른 언론사의 기사를 먼저 고르며,
전달 필드는 제목, 출처, 요약, RSS content로 제한됩니다. 생성된 제목, 본문, 태그
10개는 `drafts` 테이블에 즉시 저장되고 저장된 `draft.id`가 함께 반환됩니다.

```bash
curl -X POST 'http://localhost:8788/api/groups/1/generate'
```

성공 응답 예시입니다.

```json
{
  "success": true,
  "data": {
    "draft": {
      "id": 7,
      "article_group_id": 1,
      "title": "블로그 제목",
      "content": "블로그 본문",
      "tags": ["태그1", "태그2", "태그3", "태그4", "태그5", "태그6", "태그7", "태그8", "태그9", "태그10"],
      "status": "draft"
    },
    "article_count": 5
  }
}
```

OpenAI 호출 실패 응답은 `OPENAI_API_ERROR`, 사용할 수 없는 모델은
`OPENAI_MODEL_ERROR`, 사용량·요청 한도 문제는 `OPENAI_USAGE_ERROR` 코드로
구분합니다. 서버 로그에는 진단 정보를 남기지만 API 응답에는 내부 오류 상세나 키를
노출하지 않습니다.

## 저장된 초안 API

```bash
# 최신 초안 목록(최대 100개)과 단건 조회
curl 'http://localhost:8788/api/drafts'
curl 'http://localhost:8788/api/drafts/7'

# 제목, 본문, 태그, 상태 수정
curl -X PUT 'http://localhost:8788/api/drafts/7' \
  -H 'Content-Type: application/json' \
  -d '{"title":"수정 제목","content":"수정 본문","tags":["연예뉴스","방송"],"status":"review"}'

# 초안 삭제
curl -X DELETE 'http://localhost:8788/api/drafts/7'
```

화면에서는 각 그룹의 **이 그룹으로 블로그 초안 생성** 버튼으로 생성 상태를 확인할
수 있습니다. 완료된 초안은 기존 제목·본문·태그 편집기에 표시되며, **저장된 블로그
초안** 목록에서도 다시 불러올 수 있습니다. 저장된 초안을 편집한 뒤 상단 **임시 저장**
버튼을 누르면 제목, 본문, 태그, 상태가 D1에 반영됩니다.

## 검토와 로컬 발행 대기열

초안 상태는 `draft`, `review`, `queued`, `published`, `failed`만 사용합니다. 화면의
**승인** 버튼은 검토한 초안을 queued로 바꿉니다. 아래 API는
`Authorization: Bearer PUBLISHER_TOKEN`이 필수이며 lease는 15분 동안 한 프로그램만
초안을 가져가게 합니다.

- `GET /api/publisher/queued`: lease 가능한 대기 초안 최대 30개
- `POST /api/publisher/lease`: `{ "draft_id": 1 }`
- `POST /api/publisher/result`: draft_id, lease_token, result 기록

RSS와 원문의 `og:image`는 다운로드하지 않고 후보 URL만 저장합니다.
`GET /api/articles/:id/images`에서 출처와 원문 링크를 함께 확인할 수 있으며 사용 전
권리 확인이 필요합니다.

## 자동화 대시보드 적용

기존 `0001_init.sql`은 그대로 두고 다음 migration을 적용합니다.

```bash
# 로컬 D1
npx wrangler d1 migrations apply blog-news-db --local

# 운영 D1 (적용 전 대상 DB를 한 번 더 확인하세요)
npx wrangler d1 migrations apply blog-news-db --remote
```

`0002_automation_settings.sql`은 단일 설정 행(`id = 1`)을 갖는
`automation_settings`와 실행 이력을 기록하는 `publish_logs`를 만듭니다. Cloudflare
Pages의 D1 binding 이름은 기존과 동일한 `DB`입니다. 하루 처리량은 화면과 서버 모두
1~30개로 제한되며 실행 간격은 10, 30, 60, 120, 180, 360분만 허용합니다.

### 자동화 API 테스트

```bash
# 설정 조회
curl 'http://localhost:8788/api/automation/settings'

# 설정 저장
curl -X PUT 'http://localhost:8788/api/automation/settings' \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"mode":"review","interval_minutes":30,"daily_limit":3,"start_time":"09:00","end_time":"22:00","timezone":"Asia/Seoul"}'

# 한국 시간 기준 오늘 통계
curl 'http://localhost:8788/api/automation/stats'

# 예약 실행용 API (Pages와 Scheduler Worker에 같은 AUTOMATION_TOKEN 설정)
curl -X POST 'http://localhost:8788/api/automation/run' \
  -H 'Authorization: Bearer replace-with-automation-token' \
  -H 'Content-Type: application/json' \
  -d '{"force":false}'

# 브라우저 버튼과 같은 수동 실행용 API (별도 MANUAL_AUTOMATION_TOKEN 설정)
curl -X POST 'http://localhost:8788/api/automation/manual-run' \
  -H 'X-Manual-Automation-Token: replace-with-manual-token'
```

`mode`는 `draft`, `review`, `publish`를 받습니다. `publish`도 실제 네이버 발행을
수행하지 않으며 초안을 `queued` 상태로 저장하고 `publish_logs`에 `queued` 이력을
남깁니다. 수동 1회 실행은 기존 수집·그룹화 로직을 함수로 직접 재사용하므로 내부
HTTP 재호출이나 API 재귀가 없습니다. 한 단계가 실패해도 다음 단계를 가능한 범위에서
진행하고 응답의 `errors` 배열에 안전한 요약을 반환합니다.

Cron Worker의 secret 설정, 배포, scheduled 테스트 방법은
[`scheduler-worker/README.md`](scheduler-worker/README.md)를 참고하세요. 예약 실행 API는
Bearer 토큰만 허용하고, 화면의 **지금 1회 실행** 버튼은 매번 별도 수동 실행 토큰을
입력받습니다. 어느 토큰도 HTML이나 저장소에 보관하지 않습니다.

### 현재 한계

- 반복 실행은 `blog-test2-scheduler` Worker가 담당하므로 Pages와 Worker를 각각 배포하고
  동일한 D1 및 `AUTOMATION_TOKEN`을 연결해야 합니다.
- 네이버 자동 발행 연동은 구현되어 있지 않습니다. `publish` 방식은 발행 대기열 등록까지만
  수행합니다.
- RSS 제공처의 차단, 피드 형식 변경 또는 OpenAI 사용량 제한으로 일부 단계가 실패할 수
  있습니다. 이 경우 다른 단계의 결과와 오류 요약은 함께 반환됩니다.
- 기사 원문은 RSS에 제공된 범위에서 초안 작성의 근거로만 사용하며, 전체 원문을 그대로
  복제해 발행하지 않습니다.
