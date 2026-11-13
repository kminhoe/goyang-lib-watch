# 다음 작업: 웹사이트로 확장

지금 저장소에는 **GitHub Actions + 텔레그램 감시 버전**이 있다(`watch.py`, `.github/workflows/watch.yml`).
텔레그램 Secrets는 아직 등록하지 않았으므로 알림은 오지 않는다.

이걸 **직접 쓰는 웹사이트**로 바꾸는 게 다음 목표다.

## 원하는 기능

1. **감시 현황 보기**: 감시 중인 책의 도서관별 대출·예약 상태(예약 n/m, 반납예정일)를 한 화면에서 본다.
2. **사이트에서 책 검색**: 검색창에 제목을 넣으면 고양시도서관 소장·대출 현황이 바로 나온다.
3. **감시 목록 추가/삭제**: 검색 결과에서 버튼으로 감시 목록에 넣고 뺀다. `watch.json`을 직접 고치지 않아도 된다.
4. 빈자리가 생기거나 대출 가능해지면 **텔레그램 알림**을 보낸다(기존과 동일).

## 구조: Cloudflare Workers 하나로 통합 (무료 플랜)

정적 사이트(GitHub Pages)나 브라우저에서는 도서관 사이트를 직접 불러올 수 없다(CORS). 그래서 서버 역할을 할 Worker가 필요하다.

- **Worker 정적 자산**(`public/index.html`): 사이트 화면. 현황, 검색, 감시 목록을 보여준다.
- **API**
  - `GET /api/search?q=` : Worker가 도서관 검색 페이지를 가져와서 파싱한 뒤 JSON으로 돌려준다.
  - `GET /api/watch` / `POST /api/watch` / `DELETE /api/watch` : 감시 목록 조회·추가·삭제
  - `GET /api/status` : 마지막 감시 결과
- **Cron Trigger** `*/30 * * * *` : 감시 목록을 검색하고 직전 상태와 비교한 뒤, 바뀐 게 있으면 텔레그램으로 보낸다.
- **Workers KV**: 감시 목록(`watch`)과 직전 상태(`state`)를 저장한다. 바뀐 경우에만 써서 무료 쓰기 한도(하루 1,000회)를 넉넉히 지킨다.
- **Secrets**(`wrangler secret put`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_PASSWORD`
- **보안**: `/api/*`는 전부 비밀번호를 요구한다. 브라우저 localStorage에 저장한 값을 헤더로 보낸다. 개인용이고, 도서관 사이트의 무료 프록시로 악용되는 것도 막는다.

## 구현 메모

- 파싱 로직은 `watch.py`의 `parse_items`를 JS로 옮긴다. 검증된 패턴은 아래와 같다.
  - 책 한 권 = `<div class="bookArea">` 블록. 고유 ID는 `fnDetail('(\d+)'`의 첫 번째 인자다.
  - 도서관: `book_info info03"> <p class="kor on">` 안의 텍스트. 예: `[식사] 식사종합자료실`
  - 예약: `예약 : 2/2명`, 반납예정: `반납예정일 : 2026.11.26`
  - 상태: `<span class="status"><strong>…</strong>`. 텍스트가 `대출가능` 또는 `대출불가 (대출중)`이다.
  - 예약 가능 여부: 블록 안에 `도서예약불가`가 없고 예약 인원 < 최대 인원
- 검색 URL: `https://www.goyanglib.or.kr/center/menu/10003/program/30001/searchResultList.do?searchType=SIMPLE&viewType=LIST&searchPubFormCode=ALL&currentPageNo=1&searchKeyword=<검색어>&searchLibraryAll=ALL&searchArticle=SCORE&searchOrder=ASC&searchDisplay=80`
- 알림 조건은 `watch.py`의 `changes()`와 같다. 대출불가에서 대출가능으로 바뀌거나, 예약 불가에서 예약 가능으로 바뀔 때다.
- 도서관 서버 부담을 줄이려고 감시는 30분 간격, 책마다 검색 1번만 한다.

## 할 일

- [ ] 다른 PC에 Node.js를 설치하고 Cloudflare 계정을 만든다(무료). `npx wrangler login`
- [x] Worker 프로젝트 생성: `wrangler.toml`(assets, kv_namespaces, triggers.crons), `src/index.js`, `public/index.html`
- [x] `wrangler dev`로 로컬 테스트한다. cron은 `--test-scheduled`로 확인한다.
- [ ] 배포 후 **Cloudflare 서버에서 도서관 사이트 접속이 되는지 꼭 확인**한다. 해외 접속 차단 가능성이 있다.
- [ ] 텔레그램 봇을 만들고(@BotFather) Secrets를 등록한다.
- [ ] 기존 GitHub Actions 감시(`.github/workflows/watch.yml`, `watch.py`, `watch.json`)를 삭제한다. 둘 다 돌면 알림이 중복된다.
- [x] README를 새 구조에 맞게 다시 쓴다.
