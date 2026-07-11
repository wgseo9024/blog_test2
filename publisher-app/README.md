# Windows 네이버 발행 도우미

이 프로그램은 Cloudflare Pages의 발행 대기 초안 한 건을 가져와 사용자가 직접 로그인한
네이버 블로그 편집기에 입력합니다. 기본 동작은 **임시저장**이며, 공개 발행은 세 가지
보호 조건을 모두 통과해야만 가능합니다.

네이버 아이디와 비밀번호는 입력받거나 저장하지 않습니다. 로그인과 2단계 인증은 열린
Playwright Chromium에서 사용자가 직접 수행합니다. 로그인 프로필은
`.session/naver-profile/`에만 저장되며 Git에서 제외됩니다.

## 1. 설치

Windows PowerShell에서 저장소의 `publisher-app` 폴더로 이동합니다.

```powershell
cd publisher-app
node --version
npm --version
npm install
npx playwright install chromium
```

권장 환경은 현재 지원되는 Node.js LTS입니다. 설치 명령은 공개 발행을 실행하지 않습니다.

## 2. 환경변수 작성

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env`의 `PUBLISHER_TOKEN=` 뒤에 Cloudflare Pages에 설정한 발행 프로그램 토큰을 직접
입력합니다. 토큰을 채팅, 화면 공유, 명령행 인수 또는 Git에 올리지 마세요.
`NAVER_BLOG_WRITE_URL`은 특정 블로그의 글쓰기 주소가 필요할 때만 입력하며, 비어 있으면
네이버 기본 글쓰기 주소를 사용합니다. `HEADLESS=false`는 그대로 유지합니다.

네이버 아이디와 비밀번호 환경변수는 사용하지 않습니다. `.env`, `.session/`,
`artifacts/`, `screenshots/`, `logs/`는 모두 Git 제외 대상입니다.

## 3. 로그인 세션 생성

```powershell
npm run login-check
```

열린 Chromium에서 사용자가 직접 로그인과 2단계 인증을 마친 뒤 터미널에서 Enter를
누릅니다. 프로그램이 URL, 로그인 버튼, 사용자 메뉴 신호를 함께 검사합니다. 성공하면
`로그인 세션 저장 완료`를 표시하고 브라우저를 닫습니다. 이 단계에서는 서버 초안 조회,
글 입력, 임시저장 또는 발행을 하지 않습니다.

## 4. Dry Run

```powershell
npm run dry-run
```

다음 항목만 검사합니다.

- `PUBLISHER_TOKEN` 존재 여부와 서버 인증
- `GET /api/publisher/queued` 응답
- 저장된 네이버 로그인 세션
- 네이버 글쓰기 페이지 접근
- 제목과 본문 입력 필드 선택자

Dry Run은 lease를 획득하지 않으며 내용을 입력하거나 임시저장·공개 발행하지 않습니다.
대기 초안이 있으면 첫 초안의 ID, 제목, 상태만 출력하며 본문과 토큰은 출력하지 않습니다.

## 5. 임시저장 테스트

Dry Run이 성공한 뒤에만 실행합니다.

```powershell
npm run save-draft
```

터미널에서 정확히 `임시저장 테스트 진행`을 입력해야 lease를 획득합니다. 프로그램은 제목,
본문, 태그를 입력한 뒤 **임시저장 버튼만** 누릅니다. 성공 신호를 확인하면 서버에
`released` 결과를 기록하여 초안을 다시 `queued` 상태로 돌려놓습니다. 브라우저에서
임시저장 글을 확인한 뒤 Enter를 누르면 종료합니다. 이미지 자동 업로드는 하지 않습니다.

`npm start`도 안전한 기본값인 `npm run save-draft`와 같습니다.

## 6. 실제 공개 발행

일반 테스트에서는 실행하지 마세요. 공개 발행에는 다음 세 조건이 모두 필요합니다.

1. `npm run publish`가 코드에 `--publish`를 전달해야 합니다.
2. 현재 PowerShell 세션에 `$env:PUBLISH_CONFIRM = "YES"`가 있어야 합니다.
3. 초안 ID, 제목, 태그 개수와 공개 여부를 확인한 뒤 터미널에 정확히
   `공개 발행합니다`를 입력해야 합니다.

```powershell
$env:PUBLISH_CONFIRM = "YES"
npm run publish
Remove-Item Env:PUBLISH_CONFIRM
```

셋 중 하나라도 없으면 공개 발행 버튼을 누르지 않고 종료합니다. 캡차, 재로그인,
2단계 인증 또는 비정상 접근 경고가 나타나도 즉시 중단합니다. 성공이 화면에서 확인된
경우에만 서버에 `published` 결과를 기록합니다.

## 문제 확인 위치

- `.session/naver-profile/`: 로컬 로그인 프로필. 공유하거나 커밋하지 마세요.
- `artifacts/`: 실패 화면 PNG와 입력값을 제거한 진단용 HTML 일부
- `logs/`: 실행 단계, 선택자 탐지 결과, 안전한 오류 요약

화면 요소를 찾지 못하면 프로그램은 추측해서 클릭하지 않고 진단 파일을 남긴 뒤
중단합니다. 로그에는 토큰, 쿠키, 네이버 비밀번호 또는 초안 본문을 기록하지 않습니다.

## 명령 요약

| 명령 | 동작 |
|---|---|
| `npm run login-check` | 로그인 세션만 생성·확인 |
| `npm run dry-run` | 서버, 세션, 글쓰기 선택자만 검사 |
| `npm run save-draft` | 명시적 승인 후 임시저장 |
| `npm run publish` | 3중 보호 조건 후에만 공개 발행 |
| `npm run check` | JavaScript 문법 검사 |
