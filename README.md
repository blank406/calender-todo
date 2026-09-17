# Calendar Todo

달력에서 날짜를 선택해 할 일을 기록하고 관리하는 간단한 Todo 웹앱입니다.  
복잡한 기능은 줄이고, 한 화면에서 월간 일정과 하루의 할 일을 함께 확인할 수 있도록 만들었습니다.

## 주요 기능

- 월·연도 이동이 가능한 월간 캘린더
- 날짜별 할 일 추가, 완료 체크 및 개별 삭제
- 선택한 날짜의 할 일 전체 삭제
- 할 일을 다른 날짜로 이동
- 카테고리 추가·수정·삭제 및 색상 지정
- 할 일이 있는 날짜와 모두 완료한 날짜 표시
- 이메일·비밀번호 회원가입, 로그인 및 로그아웃
- Supabase를 이용한 사용자별 카테고리와 Todo 저장
- 기본 폰트와 커스텀 폰트 선택
- PC와 모바일 화면 대응

## 사용 기술

- HTML5
- CSS3
- Vanilla JavaScript
- Supabase JS v2
- Supabase Auth / Database / Row Level Security

별도의 프레임워크나 빌드 도구 없이 동작합니다.

## 실행 방법

1. 저장소를 내려받습니다.

   ```bash
   git clone https://github.com/blank406/calender-todo.git
   cd calender-todo
   ```

2. Live Server와 같은 로컬 웹 서버로 `index.html`을 실행합니다.

3. 로그인과 데이터 저장 기능을 사용하려면 Supabase 프로젝트 및 데이터베이스 설정이 필요합니다. 자세한 내용은 [AUTH_SETUP.md](./AUTH_SETUP.md)를 참고하세요.

> `index.html` 파일을 직접 여는 것보다 로컬 웹 서버를 사용하는 것을 권장합니다.

## 프로젝트 구조

```text
calender-todo/
├── assets/             # 파비콘과 이미지 리소스
├── index.html          # 화면 구조
├── style.css           # 전체 UI와 반응형 스타일
├── script.js           # 캘린더 및 Todo 동작
├── supabase.js         # 인증과 데이터베이스 연동
├── font-settings.js    # 폰트 설정
├── AUTH_SETUP.md       # Supabase 연결 및 검증 안내
└── README.md           # 프로젝트 소개
```

## 데이터 저장 구조

로그인한 사용자의 카테고리와 Todo는 Supabase에 저장됩니다. 각 데이터에는 사용자 ID가 연결되며, RLS 정책으로 사용자마다 자신의 데이터만 접근하도록 구성합니다.

- `categories`: 카테고리 이름과 색상
- `todos`: 날짜, 내용, 완료 여부, 카테고리
- `auth.users`: 이메일·비밀번호 기반 사용자 인증

## 테스트

저장소에 포함된 테스트는 다음 명령으로 실행할 수 있습니다.

```bash
node --test tests/auth.test.cjs tests/categories.test.cjs
node tests/visual-check.cjs
node tests/live-category-check.cjs
node tests/live-todo-check.cjs
```

실계정 테스트에는 환경 변수 `CATEGORY_TEST_EMAIL`, `CATEGORY_TEST_PASSWORD`를 사용하며, 자격 증명은 프로젝트 파일에 저장하지 않습니다.
