# 최종 MVP 구현 계획과 감사 기준선

작성일: 2026-07-11  
원칙: 기존 `0001`, `0002` 마이그레이션과 기존 API 성공/실패 응답 형식을 변경하지 않고, 새 기능은 추가 마이그레이션과 호환 필드로 확장한다.

## 1. 현재 구조

- 정적 대시보드: `index.html`
- Cloudflare Pages Functions: `functions/api/**`
- 공통 자동화 로직: `functions/lib/automation.js`
- D1: `migrations/0001_init.sql`, `0002_automation_settings.sql`
- Cron Worker: `scheduler-worker/src/index.js`, 5분 Cron
- 배포 설정: `wrangler.jsonc`, `scheduler-worker/wrangler.jsonc`

현재 API는 대부분 성공 시 `{ "success": true, "data": ... }`, 실패 시
`{ "success": false, "error": { "message": ... } }`를 반환한다. 그룹 초안 생성은
오류에 `code`도 포함한다. 이 형식을 유지한다.

## 2. 완료된 기능

- 기사 CRUD 일부, URL UNIQUE 기반 중복 제거
- 고정 RSS 4개 병렬 수집과 피드별 실패 격리
- 제목 Jaccard 유사도와 공통 토큰 기반 그룹화, 다른 언론사 2곳 요구
- 그룹 상세/목록 및 최대 5개 기사 기반 OpenAI Responses API 초안 생성
- drafts 조회·수정·삭제, 그룹별 중복 초안 방지 옵션
- 자동화 설정, KST 하루 집계, 서버 측 1~30개 제한
- Bearer `AUTOMATION_TOKEN`, 별도 수동 토큰, 5분 Scheduler
- 미리보기·전체 복사·모바일 CSS가 있는 단일 페이지 대시보드

## 3. 불완전 기능과 위험

- D1 실행 잠금과 stale-lock 복구가 없어 Cron 중복 실행 가능
- 자동화 단계/실패를 전용 실행 로그에 남기지 않으며 성공 응답이 부분 실패에도 항상 200
- Scheduler와 Pages가 모두 실행 시각을 갱신해 일정 계산 책임이 중복됨
- 자정을 넘는 운영 시간과 `next_run_at` 계산의 경계 검증이 부족함
- 그룹 임계값이 `0.55`로 고정되고 엔티티/발행 시간 가중치가 없음
- 그룹 병합/해제 수단 없음
- RSS 이미지 파싱 및 원문 핵심 추출 없음
- 기사 전문에 가까운 RSS content가 저장될 수 있어 저장 길이·목적을 더 제한할 필요
- 초안 상태 수정이 임의 문자열을 허용하고 `failed` 선택지가 없음
- queued 전용 보안 API, lease, 발행 결과 기록 API 없음
- 브라우저 수동 실행이 토큰 입력을 요구해 비개발자 UX와 secret 취급이 불편함
- `.github/workflows/deploy-pages.yml`은 GitHub Pages 정적 배포라 Cloudflare Functions 배포와 무관하며 혼동 가능
- API 응답 helper와 ID/텍스트 검증 코드가 여러 파일에 중복됨(호환성 위험 때문에 이번 MVP에서는 점진 정리)
- 자동 테스트와 운영/수동 단계 문서가 부족함

## 4. 단계별 구현 계획

1. 이 문서를 감사 기준선으로 확정하고 기존 파일/응답/DB를 보존한다.
2. `0003_final_mvp.sql`에 실행 잠금·실행 로그·그룹 설정을 추가하고, Pages가 잠금의 단일 책임자가 되도록 한다. KST 일정과 30개 제한을 테스트한다.
3. 제목 토큰, 핵심 엔티티, 발행 시간 가중 점수를 설정값으로 계산한다. 그룹 항목 이동/해제 및 그룹 병합 API/UI를 추가한다.
4. 타임아웃·UA·길이 제한·제거 선택자를 갖춘 원문 핵심 추출 모듈을 추가하고 RSS fallback을 유지한다.
5. 서로 다른 언론사 최대 5개의 추출 핵심을 교차 비교 프롬프트에 제공하고 그룹별 초안 유일성을 보장한다.
6. RSS 및 `og:image` 후보를 출처/원문과 함께 별도 테이블에 저장하고 저작권 안내와 무이미지/대체이미지 상태를 제공한다.
7. 상태를 `draft/review/queued/published/failed`로 제한하고 queued 보안 조회, 원자적 lease, 결과 기록 API를 추가한다.
8. `publisher-app`에 persistent Chrome 프로필 기반 Playwright CLI를 만든다. 기본은 임시저장이고 실제 발행은 `--publish`와 대화형 재확인을 모두 요구한다.
9. 상단 5개 운영 지표와 설정/이슈/편집/대기열 구역을 분리하고 쉬운 한국어 처리 상태를 표시한다. 기존 미리보기/복사는 유지한다.
10. 모든 JS 문법 검사, 로컬 D1 적용, API smoke script를 수행하고 README/운영/수동 문서를 완성한다.

## 5. 데이터 보호 전략

- 기존 테이블/열을 삭제하거나 이름 변경하지 않는다.
- 새 열은 nullable 또는 안전한 default를 사용한다.
- 기존 그룹과 초안은 마이그레이션 중 수정하지 않는다.
- 그룹 수정은 명시적 사용자 API 요청에서만 수행한다.
- 원격 migration, 배포, secret 설정, 네이버 로그인/입력은 실행하지 않는다.
