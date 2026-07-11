# 로컬 네이버 발행 도우미

네이버 아이디와 비밀번호를 받거나 저장하지 않습니다. `npm install` 후 `npm start --
--login-check`로 Chrome을 열고 사용자가 직접 로그인합니다. 로그인 세션은 Git에서 제외된
`.session/`에만 남습니다.

기본 `npm start`는 queued 초안 한 건을 가져와 **임시저장까지만** 수행합니다. 실제 공개
발행은 `npm start -- --publish`와 실행 중 `PUBLISH` 재확인이 모두 있어야 합니다.
서버 주소와 발행 API 토큰은 `BLOG_API_BASE_URL`, `PUBLISHER_TOKEN`에 로컬로 설정합니다.
화면 요소가 바뀌거나 지연되면 작업을 중단하고 `artifacts/`에 스크린샷을 남깁니다.
