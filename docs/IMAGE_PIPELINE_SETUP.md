# 이미지 파이프라인 수동 설정

운영 D1 migration과 Pages/Scheduler 배포는 실행했다. R2 생성은 계정에서 R2가 활성화되지 않아 Cloudflare 오류 10042로 실패했고, Secret 변경과 네이버 로그인은 실행하지 않았다.

## R2와 D1

```bash
npx wrangler r2 bucket create naver-news-images
npx wrangler d1 migrations apply blog-news-db --remote
```

`wrangler.jsonc`에는 `IMAGES_BUCKET` → `naver-news-images` 바인딩이 준비돼 있다. 버킷은 비공개로 유지하며 공개 개발 URL을 켜지 않는다. Publisher는 기존 `PUBLISHER_TOKEN` 인증 API로만 짧게 객체를 조회한다.

정리는 보존 정책을 확인한 뒤 키를 개별 삭제한다.

```bash
npx wrangler r2 object delete naver-news-images/private/original/GROUP_ID/IMAGE_ID.jpg
npx wrangler r2 object delete naver-news-images/private/processed/GROUP_ID/IMAGE_ID.jpg
```

## Windows publisher-app

PowerShell에서 다음을 실행한다.

```powershell
cd publisher-app
npm install
Copy-Item .env.example .env
npm run login-check
npm run dry-run
npm run save-draft
npm run watch
```

`.env`에 `NAVER_BLOG_CATEGORY`를 네이버에 표시되는 정확한 카테고리 이름으로 설정한다. 비밀번호는 파일에 넣지 않는다. 로그인 만료 시 `npm run login-check`로 브라우저에서 직접 재로그인한다.

이미지 권한은 관리자에서 문구를 체크한 뒤 별도 승인 동작을 해야 한다. 승인 전에는 Sharp 처리와 R2 저장이 거부된다. `bodyBlocks` 일곱 칸과 태그 열 칸을 수정하면 각 문장과 전체 글자 수를 확인하고 저장한다.

Sharp는 `npm install`로 설치된다. 자동 처리는 JPG/PNG/WebP, 높이 500px 이상만 대상으로 하며 하단 `min(round(height*0.15),180)` 픽셀을 자르고 JPEG 품질 88로 만든다. 워터마크·기자명·출처·얼굴·주요 피사체 손상 우려가 있으면 처리하지 말고 `review_required`로 둔다.

임시저장은 먼저 `npm run dry-run`으로 선택자를 확인한 후 테스트 초안에서만 수행한다. 성공 메시지와 버튼 상태가 모두 확인돼야 성공으로 기록된다.
