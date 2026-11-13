# goyang-lib-watch

고양시도서관센터에서 원하는 책의 대출·예약 상태를 30분마다 확인하고, 바뀌면 텔레그램으로 알려줍니다.
GitHub Actions에서 돌아가므로 PC를 켜둘 필요가 없습니다.

## 알림이 오는 경우

- **📗 대출 가능해짐**: 대출 중이던 책이 반납되어 대출 가능 상태가 됨
- **🔔 예약 자리 생김**: 예약이 꽉 차 있던 책(예: 2/2명)에 빈자리가 생김
- 책을 처음 등록했을 때는 "감시 시작" 메시지로 현재 상태를 한 번 보내줍니다.

## 처음 설정

### 1. 텔레그램 봇 만들기

1. 텔레그램에서 **@BotFather**를 찾아 `/newbot`을 보냅니다.
2. 봇 이름과 아이디(`..._bot`으로 끝나야 함)를 정하면 **봇 토큰**을 받습니다. 예: `123456:ABC-...`
3. 방금 만든 봇과 대화방을 열고 아무 메시지나 하나 보냅니다.
4. 브라우저에서 아래 주소를 열고 `"chat":{"id":숫자` 부분의 숫자를 찾습니다. 그 숫자가 **채팅 ID**입니다.
   ```
   https://api.telegram.org/bot<봇토큰>/getUpdates
   ```

### 2. GitHub 저장소에 비밀값 넣기

저장소 → **Settings → Secrets and variables → Actions → New repository secret**에서 두 개를 추가합니다.

| 이름 | 값 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 채팅 ID |

### 3. 처음 실행해보기

저장소 → **Actions → library-watch → Run workflow**를 누릅니다.
텔레그램으로 "감시 시작" 메시지가 오면 설정이 끝난 것입니다. 이후에는 30분마다 자동으로 실행됩니다.

## 감시할 책 바꾸기

`watch.json`을 수정합니다.

```json
{
  "books": [
    {
      "keyword": "한국사 이상현상 연구원",
      "title_contains": "한국사 이상현상 연구원",
      "libraries": ["식사", "마두"]
    }
  ]
}
```

- `keyword`: 도서관 사이트 검색창에 넣을 검색어
- `title_contains`: 검색 결과 중 제목에 이 글자가 들어간 책만 감시합니다. 띄어쓰기는 무시합니다. 비워두면 검색 결과 전체를 감시합니다.
- `libraries`: 특정 도서관만 보고 싶을 때 씁니다. 사이트에 `[식사]`, `[마두]`처럼 표시되는 이름을 넣습니다. 비워두면 모든 도서관을 감시합니다.

책을 여러 권 감시하려면 `books` 목록에 항목을 더 추가하면 됩니다.

## 여러 PC에서 작업하기

```bash
git clone https://github.com/<내아이디>/goyang-lib-watch.git
```

- 작업 시작 전: `git pull` (Actions가 `state.json`을 계속 커밋하므로 꼭 먼저 받기)
- 작업 후: `git add .` → `git commit -m "..."` → `git push`

## 내 PC에서 테스트

텔레그램 설정 없이 실행하면 알림 내용이 화면에 출력됩니다.

```bash
python watch.py
```

현재 상태 전체를 보고 싶으면 `REPORT=1`을 붙입니다. Actions에서는 Run workflow의 `report` 체크박스가 같은 역할을 합니다.

## 참고

- 도서관 서버에 부담을 주지 않도록 30분 간격으로 책마다 검색 1번만 합니다.
- 공개 저장소에서 60일 동안 활동이 없으면 GitHub이 예약 실행을 멈출 수 있습니다. 메일이 오면 Actions 탭에서 다시 켜면 됩니다.
- 실행이 실패하면(사이트 장애, 접속 차단 등) GitHub에서 실패 메일이 옵니다.
