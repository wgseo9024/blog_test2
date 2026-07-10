# Cloudflare Pages 블로그 생성기

정적 화면은 `index.html`, OpenAI 호출은 `functions/api/generate.js`에서 처리합니다.
브라우저에는 OpenAI API 키가 전달되지 않습니다.

## Cloudflare Pages 배포

1. Cloudflare 대시보드에서 **Workers & Pages → Create → Pages → Connect to Git**를 선택합니다.
2. 이 GitHub 저장소를 연결합니다.
3. 프레임워크 프리셋은 `None`, 빌드 명령은 비워 두고, 빌드 출력 디렉터리는 `/`로 설정합니다.
4. 프로젝트의 **Settings → Variables and Secrets**에서 다음 값을 추가합니다.
   - `OPENAI_API_KEY`: OpenAI API 키. 반드시 **Secret/Encrypt**로 저장합니다.
   - `OPENAI_MODEL`: 선택 사항. 기본값은 `gpt-5.4-mini`입니다.
5. 새 배포를 실행합니다.

배포 후 화면에서 키워드와 작성 지침을 입력하고 **자동화 실행**을 누르면
`/api/generate` Pages Function이 OpenAI Responses API를 호출합니다.

## 로컬 실행

`.dev.vars` 파일을 만들고 키를 넣습니다. 이 파일은 Git에서 제외됩니다.

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
```

그다음 Wrangler로 Pages 개발 서버를 실행합니다.

```bash
npx wrangler pages dev .
```
