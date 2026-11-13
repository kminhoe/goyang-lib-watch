"""고양시도서관센터 소장 도서의 대출/예약 상태를 감시하고 변화가 있으면 텔레그램으로 알린다.

- 감시할 책은 watch.json 에 적는다.
- 직전 상태는 state.json 에 저장해서, 바뀐 것만 알린다.
- TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 환경변수가 없으면 알림 대신 화면에 출력한다.
- REPORT=1 이면 변화가 없어도 현재 상태 전체를 보낸다.
"""

import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
WATCH_FILE = BASE / "watch.json"
STATE_FILE = BASE / "state.json"

SEARCH_URL = (
    "https://www.goyanglib.or.kr/center/menu/10003/program/30001/searchResultList.do"
)
USER_AGENT = "Mozilla/5.0 (goyang-lib-watch; personal use)"


# ---------------------------------------------------------------- 가져오기/파싱

def fetch_search(keyword: str) -> str:
    params = {
        "searchType": "SIMPLE",
        "viewType": "LIST",
        "searchPubFormCode": "ALL",
        "currentPageNo": "1",
        "searchKeyword": keyword,
        "searchLibraryAll": "ALL",
        "searchArticle": "SCORE",
        "searchOrder": "ASC",
        "searchDisplay": "80",
    }
    url = SEARCH_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _text(fragment: str) -> str:
    """태그를 지우고 공백을 정리한 텍스트."""
    no_tags = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(no_tags)).strip()


def parse_items(page: str) -> list[dict]:
    items = []
    for block in page.split('<div class="bookArea">')[1:]:
        m_id = re.search(r"fnDetail\('(\d+)'", block)
        if not m_id:
            continue

        m_title = re.search(r'<div class="book_name">.*?title="([^"]*)"', block, re.S)
        title = _text(m_title.group(1)) if m_title else "(제목 없음)"

        # info03 첫 번째 kor 단락 = 소장 도서관/자료실
        m_lib = re.search(
            r'book_info info03">\s*<p class="kor on">(.*?)</p>', block, re.S
        )
        library = _text(m_lib.group(1)) if m_lib else ""

        m_res = re.search(r"예약\s*:\s*(\d+)\s*/\s*(\d+)\s*명", block)
        reserved, reserve_max = (int(m_res.group(1)), int(m_res.group(2))) if m_res else (0, 0)

        m_due = re.search(r"반납예정일\s*:\s*([\d.]+)", block)
        due = m_due.group(1) if m_due else ""

        m_status = re.search(r'<span class="status">\s*<strong>(.*?)</strong>', block, re.S)
        status = _text(m_status.group(1)) if m_status else ""

        items.append(
            {
                "id": m_id.group(1),
                "title": title,
                "library": library,
                "status": status,  # 예: "대출가능", "대출불가 (대출중)"
                "available": status.startswith("대출가능"),
                "reserved": reserved,
                "reserve_max": reserve_max,
                "can_reserve": "도서예약불가" not in block and reserved < reserve_max,
                "due": due,
            }
        )
    return items


def matches(item: dict, book: dict) -> bool:
    want_title = book.get("title_contains")
    if want_title and want_title.replace(" ", "") not in item["title"].replace(" ", ""):
        return False
    libs = book.get("libraries") or []
    if libs and not any(f"[{lib}]" in item["library"] for lib in libs):
        return False
    return True


# ---------------------------------------------------------------- 알림

def describe(item: dict) -> str:
    parts = [item["library"], item["status"] or "상태 알 수 없음"]
    if item["reserve_max"]:
        parts.append(f"예약 {item['reserved']}/{item['reserve_max']}")
    if item["due"]:
        parts.append(f"반납예정 {item['due']}")
    return " · ".join(parts)


def changes(old: dict | None, new: dict) -> list[str]:
    """알릴 만한 변화만 골라낸다."""
    if old is None:
        return []
    found = []
    if new["available"] and not old.get("available"):
        found.append("📗 대출 가능해짐")
    if new["can_reserve"] and not old.get("can_reserve"):
        found.append("🔔 예약 자리 생김")
    return found


def send(text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("----- (텔레그램 설정 없음, 화면 출력) -----")
        print(text)
        return
    data = urllib.parse.urlencode(
        {"chat_id": chat_id, "text": text, "disable_web_page_preview": "true"}
    ).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=data
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def search_link(keyword: str) -> str:
    return SEARCH_URL + "?" + urllib.parse.urlencode(
        {"searchType": "SIMPLE", "searchKeyword": keyword, "searchLibraryAll": "ALL"}
    )


# ---------------------------------------------------------------- main

def main() -> int:
    books = json.loads(WATCH_FILE.read_text(encoding="utf-8"))["books"]
    state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.exists() else {}
    report = os.environ.get("REPORT") == "1"
    new_state: dict = {}
    failed = False

    for book in books:
        keyword = book["keyword"]
        try:
            items = [i for i in parse_items(fetch_search(keyword)) if matches(i, book)]
        except Exception as exc:  # 사이트 장애 등: 이전 상태 유지
            print(f"[오류] '{keyword}' 검색 실패: {exc}", file=sys.stderr)
            new_state[keyword] = state.get(keyword, {})
            failed = True
            continue

        old_items = state.get(keyword)
        first_run = old_items is None
        old_items = old_items or {}
        new_state[keyword] = {i["id"]: i for i in items}

        alerts = []
        for item in items:
            for change in changes(old_items.get(item["id"]), item):
                alerts.append(f"{change}\n  {describe(item)}")

        if alerts:
            send(f"📚 {keyword}\n\n" + "\n\n".join(alerts) + f"\n\n{search_link(keyword)}")
        elif first_run or report:
            head = "감시 시작" if first_run else "현재 상태"
            lines = "\n".join(f"• {describe(i)}" for i in items) or "검색 결과 없음"
            send(f"📚 {keyword} — {head} ({len(items)}권)\n\n{lines}")

        print(f"'{keyword}': {len(items)}권, 알림 {len(alerts)}건")

    STATE_FILE.write_text(
        json.dumps(new_state, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
