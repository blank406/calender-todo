# Category 드래그 순서 변경

기존 `sql/category-order.sql`을 실행한 DB를 사용합니다. 이번 드래그 변경에는 추가 SQL 실행이나 새 컬럼이 필요하지 않습니다.
기존 categories의 id, user_id, created_at 컬럼 및 사용자별 SELECT/INSERT/UPDATE RLS 정책을 그대로 사용합니다.

- 최초 실행: 사용자별 created_at, id 오름차순으로 0부터 초기화합니다.
- SQL 재실행: 유효한 기존 순서는 보존하고 null·중복이 있는 사용자의 순서만 정리합니다.
- 조회: sort_order 오름차순, null은 뒤로, 동률은 created_at과 id로 정렬합니다.
- 이동: ⋮⋮ 핸들의 Pointer Events로 마우스·터치를 지원합니다. 6px 이상 이동하면 행을 흐리게 표시하고 삽입 위치에 선을 표시합니다. 드롭 직후 관리 목록과 상단 필터를 갱신합니다.
- 저장: 새 배열 순서대로 0부터 연속된 sort_order를 부여하고, 각 행을 id와 현재 user_id 조건으로 UPDATE합니다. 기존 swap_category_order RPC는 사용하지 않습니다.
- 저장 실패: 시도한 행을 조건부 복원하고 서버 데이터를 다시 읽습니다. 재조회도 실패하면 Category 변경을 잠그고 다시 불러오기 버튼을 표시합니다.
- 저장은 여러 HTTP 요청이므로 단일 DB 트랜잭션이 아닙니다. 여러 기기의 동시 순서 변경이나 저장 중 탭 종료 시 원자성은 보장하지 않습니다.
- 추가: 클라이언트가 최대값+1을 보내며, INSERT 트리거가 서버의 최신 최대값+1을 확정합니다. 비어 있으면 0입니다.
- 기존 INSERT 트리거의 사용자별 잠금은 유지합니다. 드래그 저장 완료 후 null·중복·빈 번호는 연속 번호로 정리됩니다. 기존 RLS를 우회하지 않습니다.
- 삭제: 기존 삭제 동작을 유지하며 번호의 빈칸을 허용합니다.
- UNIQUE 제약은 추가하지 않습니다. 여러 행을 저장하는 도중 충돌할 수 있으므로 별도로 추가하지 마세요.
- 서버 작업 또는 SQL Editor에서 Category를 INSERT하는 경우에도 해당 사용자의 인증 문맥이 필요합니다.

핸들만 44px 터치 영역과 touch-action: none을 사용합니다. 이름·편집 영역의 세로 스크롤과 상단 필터 클릭은 유지하며, dialog 가장자리에서는 자동 스크롤합니다. dialog 밖에 놓기, pointercancel, 캡처 손실, Escape, dialog 닫기는 저장 없이 취소합니다. 키보드 사용자는 핸들에서 ↑ / ↓ 방향키로 이동할 수 있습니다. PWA 캐시 버전은 v15입니다.

검증 명령: `node --test tests/auth.test.cjs tests/categories.test.cjs`
DOM과 Supabase 모의 테스트로 mouse/touch 드래그, 첫↔마지막/중간 이동, 필터 반영, 재조회, 편집, 취소, 저장 실패 복원, 키보드 이동을 확인합니다. 실제 모바일 터치와 실제 Supabase 연결 검증은 별도로 필요합니다.
