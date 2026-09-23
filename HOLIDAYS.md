# 한국 공휴일 데이터

`holidays.js`의 `KOREAN_HOLIDAYS`에 `YYYY-MM-DD: 이름`으로 저장한다.
현재 지원 범위는 **2026~2027년**이다. 미등록 연도/날짜는 공휴일로 표시하지 않는다.
일반 일요일은 추가로 색칠하지 않으며, 설날·추석·대체공휴일·선거일은 개별 날짜로 등록한다.
API, API 키, 음력 변환 라이브러리는 사용하지 않는다.

확인 기준: 2026-09-23. 출처:

- [우주항공청 2026년 월력요항](https://www.kasa.go.kr/prog/bbsArticle/BBSMSTR_000000000010/view.do?bbsId=B000000000010&nttId=B000000001860Pe2zT3)
- [우주항공청 2027년 월력요항](https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431)
- [인사혁신처: 2026년 노동절·제헌절 공휴일 지정](https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&cntId=4250&mode=view&pageIdx=1)

새해 월력요항이나 임시공휴일이 발표되면 해당 날짜와 이름을 추가한다.
2026년 추석 마지막 날은 토요일이지만 9월 28일은 대체공휴일이 아니다.
데이터 변경 시 `index.html`의 자산 버전과 `service-worker.js`의 캐시 버전 및
APP_SHELL 쿼리 버전을 함께 올려 오프라인 사용자에게도 갱신한다.

`getKoreanHolidayName(formatDateKey(date))`는 로컬 달력 날짜로 조회하고,
이름 또는 `null`을 반환한다. UI에 이름/tooltip을 추가하지 않는다.
Todo가 하나라도 있으면 기존 Category/전체 완료 표시를 그대로 사용한다.
Todo가 없고 공휴일인 경우에만 `holiday` 클래스를 적용하여 숫자를 `#c96f78`로 표시한다.
selected outline과 today 밑줄은 그대로 유지한다.

검증: `node --test tests/auth.test.cjs tests/categories.test.cjs`,
`node tests/visual-check.cjs`, `node tests/pwa-check.cjs`.
