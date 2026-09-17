# Supabase 연결 구조

- 기존 HTML/CSS/Vanilla JavaScript 구조를 유지하며 npm이나 빌드 도구를 사용하지 않습니다.
- `index.html`에서 Supabase JS v2를 브라우저 CDN으로 불러옵니다.
- `supabase.js`에는 브라우저용 Project URL과 Publishable Key만 사용합니다. `service_role` 또는 secret key는 사용하지 않습니다.
- 이메일/비밀번호 회원가입, 로그인, 로그아웃과 브라우저 새로고침 후 세션 복원을 지원합니다.
- SDK의 `persistSession`, `autoRefreshToken`, `detectSessionInUrl` 옵션을 사용합니다.

## Categories

- 로그인 후 `public.categories`에서 현재 사용자의 행만 `created_at`, `id` 순으로 불러옵니다.
- 추가할 때 `name`, `color`, 현재 사용자의 `user_id`를 저장합니다.
- 수정과 삭제는 `id`와 `user_id`를 함께 조건으로 사용합니다.
- 기존 `calendarCategories` localStorage 값은 읽거나 삭제하지 않으며 백업으로 남겨둡니다.

## Todos

- 로그인 후 `public.todos`에서 현재 사용자의 행만 불러오고 날짜별 객체로 구성합니다.
- 추가할 때 `user_id`, `todo_date`, `text`, `completed`, `category_id`를 INSERT합니다.
- 체크/해제는 기존 행의 `completed`를 UPDATE합니다.
- 날짜 이동은 기존 행 ID를 유지하며 `todo_date`만 UPDATE합니다.
- 개별 삭제는 `id`와 `user_id`, 하루 전체 삭제는 `user_id`와 `todo_date`를 조건으로 DELETE합니다.
- 서버 요청이 성공한 뒤에만 메모리와 UI를 갱신합니다. 실패하면 기존 화면 상태를 유지하고 재시도 메시지를 표시합니다.
- 기존 `calendarTodos` localStorage 값은 읽거나 수정하거나 삭제하지 않습니다. 자동 DB 마이그레이션도 수행하지 않습니다.
- 로그아웃과 사용자 전환 시 카테고리와 Todo 메모리를 즉시 비우고 입력을 잠급니다.

## 필요한 DB 권한

RLS 정책과 별도로 authenticated 역할에 테이블 권한이 필요합니다.

```sql
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.todos to authenticated;
```

ID가 sequence 기반이면 해당 sequence의 권한도 필요할 수 있습니다.

```sql
grant usage, select on all sequences in schema public to authenticated;
```

GRANT는 가능한 작업 종류만 허용하며, 각 사용자가 접근할 수 있는 행은 RLS 정책이 계속 제한해야 합니다.

## 검증

```text
node --test tests/auth.test.cjs tests/categories.test.cjs
node tests/visual-check.cjs
node tests/live-category-check.cjs
node tests/live-todo-check.cjs
```

실계정 테스트 파일은 환경 변수 `CATEGORY_TEST_EMAIL`, `CATEGORY_TEST_PASSWORD`를 사용합니다. 자격 증명을 프로젝트 파일에 저장하지 않습니다.
