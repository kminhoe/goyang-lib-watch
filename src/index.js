// 고양 도서관 알리미 — Cloudflare Worker
//
// - public/ 의 화면(정적 자산)은 Cloudflare가 바로 내보낸다. 이 코드는 /api/* 만 처리한다.
// - 30분마다(cron) 알림 목록의 책을 확인하고, 대출 가능해지거나 예약 자리가 생기면 텔레그램으로 보낸다.
// - KV 키
//     watch : { books: [{ keyword, title_contains, libraries }] }
//     state : { checked_at, books: { [keyword]: { [id]: item } } }
// - Secrets: ADMIN_PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const SEARCH_URL =
  "https://www.goyanglib.or.kr/center/menu/10003/program/30001/searchResultList.do";
const USER_AGENT = "Mozilla/5.0 (goyang-lib-watch; personal use)";

// ---------------------------------------------------------------- 가져오기/파싱

export function searchUrl(keyword) {
  const params = new URLSearchParams({
    searchType: "SIMPLE",
    viewType: "LIST",
    searchPubFormCode: "ALL",
    currentPageNo: "1",
    searchKeyword: keyword,
    searchLibraryAll: "ALL",
    searchArticle: "SCORE",
    searchOrder: "ASC",
    searchDisplay: "80",
  });
  return `${SEARCH_URL}?${params}`;
}

async function fetchSearch(keyword) {
  let res;
  try {
    res = await fetch(searchUrl(keyword), {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9" },
      cf: { cacheTtl: 0 },
    });
  } catch (err) {
    console.log("도서관 사이트 접속 실패", err);
    throw new Error("도서관 사이트에 접속하지 못했습니다.");
  }
  if (!res.ok) throw new Error(`도서관 사이트 응답 ${res.status}`);
  return res.text();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };

function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** 태그를 지우고 공백을 정리한 텍스트 */
function text(fragment) {
  return unescapeHtml(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** watch.py 의 parse_items 를 그대로 옮긴 것 */
export function parseItems(page) {
  const items = [];
  for (const block of page.split('<div class="bookArea">').slice(1)) {
    const mId = block.match(/fnDetail\('(\d+)'/);
    if (!mId) continue;

    const mTitle = block.match(/<div class="book_name">[\s\S]*?title="([^"]*)"/);
    const title = mTitle ? text(mTitle[1]) : "(제목 없음)";

    // info03 첫 번째 kor 단락 = 소장 도서관/자료실
    const mLib = block.match(/book_info info03">\s*<p class="kor on">([\s\S]*?)<\/p>/);
    const library = mLib ? text(mLib[1]) : "";

    const mRes = block.match(/예약\s*:\s*(\d+)\s*\/\s*(\d+)\s*명/);
    const reserved = mRes ? Number(mRes[1]) : 0;
    const reserveMax = mRes ? Number(mRes[2]) : 0;

    const mDue = block.match(/반납예정일\s*:\s*([\d.]+)/);
    const due = mDue ? mDue[1] : "";

    const mStatus = block.match(/<span class="status">\s*<strong>([\s\S]*?)<\/strong>/);
    const status = mStatus ? text(mStatus[1]) : "";

    items.push({
      id: mId[1],
      title,
      library,
      status, // 예: "대출가능", "대출불가 (대출중)"
      available: status.startsWith("대출가능"),
      reserved,
      reserve_max: reserveMax,
      can_reserve: !block.includes("도서예약불가") && reserved < reserveMax,
      due,
    });
  }
  return items;
}

const squash = (s) => (s || "").replace(/\s/g, "");

export function matches(item, book) {
  const want = squash(book.title_contains);
  if (want && !squash(item.title).includes(want)) return false;
  const libs = book.libraries || [];
  if (libs.length && !libs.some((lib) => item.library.includes(`[${lib}]`))) return false;
  return true;
}

// ---------------------------------------------------------------- 알림

function describe(item) {
  const parts = [item.library, item.status || "상태 알 수 없음"];
  if (item.reserve_max) parts.push(`예약 ${item.reserved}/${item.reserve_max}`);
  if (item.due) parts.push(`반납예정 ${item.due}`);
  return parts.join(" · ");
}

/** 알릴 만한 변화만 골라낸다 (watch.py 의 changes 와 같음) */
export function changes(old, now) {
  if (!old) return [];
  const found = [];
  if (now.available && !old.available) found.push("📗 대출 가능해짐");
  if (now.can_reserve && !old.can_reserve) found.push("🔔 예약 자리 생김");
  return found;
}

async function sendTelegram(env, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log("(텔레그램 설정 없음)\n" + message);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true }),
  });
  if (!res.ok) console.log("텔레그램 전송 실패", res.status, await res.text());
}

function startMessage(book, items) {
  const lines = items.map((i) => `• ${describe(i)}`).join("\n") || "검색 결과 없음";
  return `📚 ${book.title_contains || book.keyword} — 알림 시작 (${items.length}권)\n\n${lines}`;
}

// ---------------------------------------------------------------- KV

async function getWatch(env) {
  return (await env.KV.get("watch", "json")) || { books: [] };
}

async function getState(env) {
  return (await env.KV.get("state", "json")) || { checked_at: null, books: {} };
}

async function findItems(book) {
  const items = parseItems(await fetchSearch(book.keyword));
  return items.filter((i) => matches(i, book));
}

const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

/** 알림 목록 전체를 확인하고, 바뀐 게 있으면 텔레그램으로 보낸다 */
async function runCheck(env) {
  const { books } = await getWatch(env);
  const state = await getState(env);
  const next = {};

  for (const book of books) {
    const key = book.keyword;
    const oldItems = state.books[key];
    let items;
    try {
      items = await findItems(book);
    } catch (err) {
      // 사이트 장애 등: 이전 상태 유지
      console.log(`'${key}' 검색 실패: ${err.message}`);
      if (oldItems) next[key] = oldItems;
      continue;
    }
    next[key] = byId(items);

    if (!oldItems) {
      await sendTelegram(env, startMessage(book, items));
      continue;
    }
    const alerts = [];
    for (const item of items) {
      for (const change of changes(oldItems[item.id], item)) alerts.push(`${change}\n  ${describe(item)}`);
    }
    if (alerts.length) {
      await sendTelegram(
        env,
        `📚 ${book.title_contains || key}\n\n${alerts.join("\n\n")}\n\n${searchUrl(key)}`,
      );
    }
  }

  const newState = { checked_at: new Date().toISOString(), books: next };
  await env.KV.put("state", JSON.stringify(newState));
  return newState;
}

// ---------------------------------------------------------------- API

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function statusView(state) {
  const books = {};
  for (const [k, v] of Object.entries(state.books)) books[k] = Object.values(v);
  return { checked_at: state.checked_at, books };
}

function authorized(request, env) {
  const given = request.headers.get("X-Password") || "";
  const want = env.ADMIN_PASSWORD || "";
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD가 설정되지 않았습니다." }, 500);
  if (!authorized(request, env)) return json({ error: "비밀번호가 맞지 않습니다." }, 401);

  // 책 검색 (실시간)
  if (path === "/api/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ items: [] });
    if (q.length > 100) return json({ error: "검색어가 너무 깁니다." }, 400);
    return json({ items: parseItems(await fetchSearch(q)) });
  }

  // 마지막 확인 결과
  if (path === "/api/status" && method === "GET") {
    return json(statusView(await getState(env)));
  }

  // 지금 바로 확인 (새로고침 버튼)
  if (path === "/api/check" && method === "POST") {
    return json(statusView(await runCheck(env)));
  }

  // 알림 목록
  if (path === "/api/watch") {
    const watch = await getWatch(env);

    if (method === "GET") return json(watch);

    if (method === "POST") {
      const body = await request.json().catch(() => null);
      const keyword = String(body?.keyword || "").trim();
      if (!keyword || keyword.length > 100) return json({ error: "책 제목이 필요합니다." }, 400);
      const book = {
        keyword,
        title_contains: String(body.title_contains ?? keyword).trim(),
        libraries: Array.isArray(body.libraries) ? body.libraries.map(String).slice(0, 30) : [],
      };
      watch.books = watch.books.filter((b) => b.keyword !== keyword);
      watch.books.push(book);
      await env.KV.put("watch", JSON.stringify(watch));

      // 바로 한 번 확인해서 화면에 보이게 하고, "알림 시작" 메시지를 보낸다
      try {
        const items = await findItems(book);
        const state = await getState(env);
        state.books[keyword] = byId(items);
        state.checked_at = state.checked_at || new Date().toISOString();
        await env.KV.put("state", JSON.stringify(state));
        await sendTelegram(env, startMessage(book, items));
      } catch (err) {
        console.log(`'${keyword}' 첫 확인 실패: ${err.message}`); // 다음 cron 때 다시 시도
      }
      return json(watch);
    }

    if (method === "DELETE") {
      const keyword = url.searchParams.get("keyword") || "";
      watch.books = watch.books.filter((b) => b.keyword !== keyword);
      await env.KV.put("watch", JSON.stringify(watch));
      const state = await getState(env);
      if (keyword in state.books) {
        delete state.books[keyword];
        await env.KV.put("state", JSON.stringify(state));
      }
      return json(watch);
    }
  }

  return json({ error: "없는 주소입니다." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        return json({ error: err.message || String(err) }, 502);
      }
    }
    // 정적 자산이 아닌 나머지 경로
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },
};
