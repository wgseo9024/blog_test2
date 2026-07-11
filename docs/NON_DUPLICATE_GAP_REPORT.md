# Non-duplicate Gap Audit

감사 기준: 2026-07-11의 저장소 파일, `migrations/0001~0003`, Pages Functions, `index.html`, Scheduler Worker, publisher-app을 확인했다. 아래 상태는 `0004` 구현 전 기준이며 결과 열에 이번 변경을 기록한다.

| 요구 | 감사 상태 | 근거 및 이번 처리 |
|---|---|---|
| 연예 RSS 4개, URL 중복 제거 | ALREADY_IMPLEMENTED | `news/collect.js`; **SKIPPED_ALREADY_IMPLEMENTED** |
| 언론사별 최신 5개 | PARTIALLY_IMPLEMENTED | 기존 30개를 5개로 변경 |
| 원문 추출/RSS fallback, 그룹화·합치기·분리 | ALREADY_IMPLEMENTED | 기존 Functions; **SKIPPED_ALREADY_IMPLEMENTED** |
| OpenAI Responses API와 기존 Secret | ALREADY_IMPLEMENTED | 기존 fetch 래퍼 방식과 `OPENAI_MODEL` 유지; **SKIPPED_ALREADY_IMPLEMENTED** |
| 광고 점수와 관리자 가시성 | MISSING | 점수·사유 컬럼, 수집 시 계산, 생성 제외 구현. 기사 API/DB에서는 확인 가능하며 전용 필터 UI는 남음 |
| Fact→Writer→Validator, 1회 수정 | MISSING | 그룹 generate 내부에 구현. 2차 실패는 `review` + `review_required` |
| 6 blocks/700~800자/태그 10개 | PARTIALLY_IMPLEMENTED | 기존 단일 content/태그 10개에서 구조화 검증·저장·렌더링으로 확장 |
| 초안 신규 메타데이터 | MISSING | `0004`에만 추가, 기존 `content`, `tags` 유지 |
| 이미지 URL 후보 수집 | ALREADY_IMPLEMENTED | `article_images`, RSS/OG 후보; **SKIPPED_ALREADY_IMPLEMENTED** |
| 이미지 메타·중복·품질 검사 | MISSING | 스키마와 로컬 SHA-256/dHash/크기·치수 검사 구현. 후보 전체를 사전 스캔하는 배치 실행은 남음 |
| 이미지 권리 승인 상태 | MISSING | 이중 확인 API와 승인된 이미지만 lease/R2 저장하도록 구현. 관리자 전용 이미지 카드 UI는 남음 |
| Sharp 로컬 처리 | MISSING | EXIF 회전, 형식, 100KB/치수, 15%/180px, 품질 88 모듈 구현 |
| 비공개 R2 | MISSING | `IMAGES_BUCKET`, private key, 인증 Publisher 업로드/조회 API 준비. 버킷은 생성하지 않음 |
| Publisher queued/lease/result | ALREADY_IMPLEMENTED | 인증과 lease 유지; **SKIPPED_ALREADY_IMPLEMENTED**, 응답만 blocks/images로 확장 |
| 별도 local-agent job/새 토큰 | CONFLICT_WITH_CURRENT_ARCHITECTURE | 요청대로 생성하지 않음 |
| 제목/본문 재생성·AI 재검수 API | MISSING | 기존 Responses 호출과 기사 근거를 재사용하는 draft AI action API로 구현 |
| 관리자 구조화 편집·글자 수·검수 이유·입력 미리보기 | MISSING | 기존 디자인 안에 blocks/tags 편집, 글자 수, 검수 이유, 입력 순서 미리보기 구현 |
| 관리자 원문 비교·이미지 워크플로 UI | PARTIALLY_IMPLEMENTED | 기존 그룹 원문 비교에 권리 승인·거절·최대 4개·순서·처리/중복/제외 상태를 추가. 실제 처리 전후 이미지는 R2 활성화 후 확인 가능 |
| persistent context/로그인 비저장/임시저장 | ALREADY_IMPLEMENTED | publisher-app; **SKIPPED_ALREADY_IMPLEMENTED** |
| 네이버 선택자 중앙화 | MISSING | `naver-selectors.js`로 이동, role→placeholder→text/attribute→fallback 순서 |
| 이미지 업로드·카테고리 선택 | MISSING | 중앙 선택자와 publisher 실행 흐름에 연결. 실제 네이버 조작은 실행하지 않아 현재 DOM 호환성은 Windows dry-run 필요 |
| 5분 Cron·동적 간격·일 30개·잠금/로그 | ALREADY_IMPLEMENTED | Scheduler/automation; **SKIPPED_ALREADY_IMPLEMENTED** |
| 기존 smoke/운영 문서 | ALREADY_IMPLEMENTED | 재작성하지 않음; **SKIPPED_ALREADY_IMPLEMENTED** |

## 구조 충돌 판단

- `ADMIN_API_TOKEN`, `LOCAL_AGENT_TOKEN`, `/api/local-agent/jobs`, 별도 publish job은 기존 인증/lease 구조와 충돌하므로 추가하지 않았다.
- `review_required`를 새 draft status로 넣으면 기존 허용 상태와 충돌하므로 `drafts.status='review'`, `validation_status='review_required'`를 사용했다.
- 워터마크·기자명·출처 제거 및 회피 크롭은 요구와 저작권 원칙에 충돌하므로 구현하지 않았다.
