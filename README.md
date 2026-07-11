# Cloudflare Pages 블로그 생성기

정적 화면은 `index.html`, OpenAI 호출은 `functions/api/generate.js`에서 처리합니다.
브라우저에는 OpenAI API 키가 전달되지 않습니다.

## D1 기사 API

다음 Pages Functions가 `DB` D1 binding의 `articles` 테이블을 사용합니다.

- `functions/api/articles/index.js`: `GET /api/articles`, `POST /api/articles`
- `functions/api/articles/[id].js`: `GET /api/articles/:id`, `DELETE /api/articles/:id`
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
   - `OPENAI_MODEL`: 선택 사항. 기본값은 `gpt-5.6-sol`입니다.
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
