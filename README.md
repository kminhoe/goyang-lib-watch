# 고양 도서관 알리미

고양시도서관센터에서 책을 검색하고, 원하는 책이 **대출 가능해지거나 예약 자리가 생기면** 텔레그램으로 알려주는 개인용 사이트입니다.
Cloudflare Workers 무료 플랜 하나로 돌아가므로 PC를 켜둘 필요가 없습니다.

- **책 검색**: 사이트에서 제목을 검색하면 도서관별 대출·예약 상태가 바로(실시간) 나옵니다. 화정, 아람누리처럼 원하는 도서관만 골라 볼 수 있습니다.
- **알림 받기**: 검색 결과에서 버튼을 누르면 30분마다 확인합니다. 도서관을 골라둔 상태면 그 도서관만 확인합니다.
- **내 책**: 알림 받는 책들의 마지막 확인 결과를 봅니다. 새로고침 버튼을 누르면 지금 바로 다시 확인합니다.

## 알림이 오는 경우

- **📗 대출 가능해짐**: 대출 중이던 책이 반납되어 대출 가능 상태가 됨
- **🔔 예약 자리 생김**: 예약이 꽉 차 있던 책(예: 2/2명)에 빈자리가 생김
- 책을 처음 추가하면 "알림 시작" 메시지로 현재 상태를 한 번 보내줍니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `public/index.html` | 사이트 화면 |
| `src/index.js` | 서버(Worker): 도서관 검색, 알림 목록 저장, 30분마다 확인, 텔레그램 전송 |
| `wrangler.toml` | Cloudflare 설정 (화면 폴더, 저장소(KV), 30분 예약 실행) |
| `test/` | 파싱·알림 조건 테스트 (`npm test`) |

## 처음 배포하기

Node.js(18 이상)가 설치된 PC에서 합니다.

### 1. 준비

```bash
git pull
npm install
npx wrangler login
```

`wrangler login`을 실행하면 브라우저가 열립니다. Cloudflare 계정(무료)으로 로그인하고 허용을 누릅니다.

### 2. 저장소(KV) 만들기

```bash
npx wrangler kv namespace create KV
```

출력에 나오는 `id = "..."` 값을 `wrangler.toml`의 `여기에_KV_ID_붙여넣기` 자리에 붙여넣습니다.

### 3. 텔레그램 봇 만들기

1. 텔레그램에서 **@BotFather**를 찾아 `/newbot`을 보냅니다.
2. 봇 이름과 아이디(`..._bot`으로 끝나야 함)를 정하면 **봇 토큰**을 받습니다. 예: `123456:ABC-...`
3. 방금 만든 봇과 대화방을 열고 아무 메시지나 하나 보냅니다.
4. 브라우저에서 아래 주소를 열고 `"chat":{"id":숫자` 부분의 숫자를 찾습니다. 그 숫자가 **채팅 ID**입니다.
   ```
   https://api.telegram.org/bot<봇토큰>/getUpdates
   ```

### 4. 비밀값 넣기

명령마다 값을 물어보면 붙여넣고 엔터를 누릅니다.

```bash
npx wrangler secret put ADMIN_PASSWORD
```

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

```bash
npx wrangler secret put TELEGRAM_CHAT_ID
```

`ADMIN_PASSWORD`는 사이트에 들어갈 때 쓸 비밀번호입니다. 마음대로 정하면 됩니다.

### 5. 배포

```bash
npm run deploy
```

끝나면 `https://goyang-lib-watch.<계정이름>.workers.dev` 주소가 나옵니다. 열어서 비밀번호를 넣고 책을 검색해 보세요.

> **꼭 확인할 것**: 검색이 "도서관 사이트에 접속하지 못했습니다"로 실패하면, 도서관 사이트가 해외(Cloudflare 서버) 접속을 막고 있는 것입니다. 이 경우 알려주세요.

### 6. 예전 GitHub Actions 끄기

사이트에서 검색이 잘 되고 알림 받을 책을 다시 추가했다면, 예전 방식(`watch.py`, `watch.json`, `.github/workflows/watch.yml`)은 지워야 합니다. 둘 다 돌면 알림이 두 번 옵니다.

## 고친 뒤 다시 배포하기

```bash
npm run deploy
```

## 내 PC에서 테스트

```bash
npm test
```

```bash
npm run dev
```

`npm run dev`를 쓰려면 먼저 `.dev.vars` 파일에 `ADMIN_PASSWORD=아무거나`를 적어둡니다(저장소에는 올라가지 않음). `http://localhost:8787`로 열리고, `http://localhost:8787/__scheduled`를 열면 30분 확인을 바로 한 번 실행합니다.

화면만 보고 싶으면 `public/index.html`을 브라우저에서 더블클릭하세요. 샘플 데이터로 움직이는 데모 모드로 열립니다.

## 참고

- 도서관 서버에 부담을 주지 않도록 30분 간격으로 책마다 검색 1번만 합니다.
- 책 제목은 "포함" 방식으로 비교합니다. "급류"로 알림을 켜면 제목에 '급류'가 들어간 책이 모두 잡힙니다.
- 무료 플랜 한도(요청 하루 10만 회, KV 쓰기 하루 1,000회) 안에서 넉넉히 돌아갑니다.
