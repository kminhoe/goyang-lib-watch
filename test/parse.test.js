// 도서관 검색 결과 HTML 파싱 테스트 (실제 페이지 구조를 본뜬 예시)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItems, matches, changes } from "../src/index.js";

const book = ({ id, title, lib, status, resv, due, noResv }) => `
<div class="bookArea">
  <div class="book_name"><a href="#" onclick="fnDetail('${id}','X'); return false;" title="${title}">${title}</a></div>
  <div class="book_info info03">
    <p class="kor on">${lib}</p>
    <p class="kor on">청구기호 : 813.7-최68ㅎ</p>
  </div>
  <div class="book_info info04">
    <p>예약 : ${resv}명</p>
    ${due ? `<p>반납예정일 : ${due}</p>` : ""}
  </div>
  <span class="status"><strong>${status}</strong></span>
  ${noResv ? '<span class="btn">도서예약불가</span>' : '<a class="btn">도서예약</a>'}
</div>`;

const page =
  "<html><body>" +
  book({ id: "1123095547", title: "한국사 이상현상 연구원 : 최인서 소설", lib: "[아람누리] 아람종합자료실", status: "대출불가 (대출중)", resv: "2/2", due: "2026.11.27" }) +
  book({ id: "1123145789", title: "한국사 이상현상 연구원 : 최인서 소설", lib: "[화정] 화정종합자료실1", status: "대출가능", resv: "0/2", noResv: true }) +
  book({ id: "1123999999", title: "급류 &amp; 다른 이야기", lib: "[가좌] &lt;가좌&gt;종합자료실", status: "대출불가 (대출중)", resv: "1 / 2", due: "2026.12.03" }) +
  "</body></html>";

test("parseItems: 책 정보를 뽑아낸다", () => {
  const items = parseItems(page);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    id: "1123095547",
    title: "한국사 이상현상 연구원 : 최인서 소설",
    library: "[아람누리] 아람종합자료실",
    status: "대출불가 (대출중)",
    available: false,
    reserved: 2,
    reserve_max: 2,
    can_reserve: false,
    due: "2026.11.27",
  });
  assert.equal(items[1].available, true);
  assert.equal(items[1].can_reserve, false); // 도서예약불가
  assert.equal(items[2].title, "급류 & 다른 이야기");
  assert.equal(items[2].library, "[가좌] <가좌>종합자료실");
  assert.equal(items[2].can_reserve, true);
});

test("matches: 제목은 포함(띄어쓰기 무시), 도서관은 [이름]으로 거른다", () => {
  const [a, b] = parseItems(page);
  assert.ok(matches(a, { title_contains: "한국사이상현상", libraries: [] }));
  assert.ok(!matches(a, { title_contains: "급류", libraries: [] }));
  assert.ok(matches(a, { title_contains: "", libraries: ["아람누리", "화정"] }));
  assert.ok(!matches(a, { title_contains: "", libraries: ["화정"] }));
  assert.ok(matches(b, { libraries: ["화정"] }));
});

test("changes: 대출 가능/예약 자리 생김만 알린다", () => {
  const base = { available: false, can_reserve: false };
  assert.deepEqual(changes(undefined, { available: true, can_reserve: true }), []);
  assert.deepEqual(changes(base, { available: true, can_reserve: false }), ["📗 대출 가능해짐"]);
  assert.deepEqual(changes(base, { available: false, can_reserve: true }), ["🔔 예약 자리 생김"]);
  assert.deepEqual(changes({ available: true, can_reserve: true }, { available: false, can_reserve: false }), []);
});
