# 롤링 2주 예약 윈도우 설계 (2026-06-11)

## 목표
손님 예약 가능 날짜를 **오늘 포함 14일**(오늘 ~ 오늘+13)로 제한. 날짜가 지나면 자동으로 하루씩 새 날짜가 열리는 롤링 윈도우. 운영자 조작 불필요.

## 배경 (현재)
- 프론트 customer.js months(): 이번달+다음달, selectable: dateStr >= todayStr → 상한 없음.
- 백엔드 routes/public.js: /availability GET·예약 POST 모두 날짜 형식만 검증, 범위 제한 없음.

## 원칙: 백엔드가 단일 진실원
서버(UTC+8 울란바토르)가 윈도우 경계를 계산해 /api/config로 내려주고, 프론트는 그걸 사용, 서버는 예약 시 재검증. 손님 브라우저 시간대가 달라도 자정 근처 off-by-one 방지.

## 구성
1. booking-window.js (신규): UTC+8 today + bookingWindow(days) -> {min,max,days}, isWithinWindow(dateStr). days는 .env BOOKING_WINDOW_DAYS(기본 14). min=오늘, max=오늘+(days-1).
2. errors.js: DATE_OUT_OF_WINDOW(400) 추가 (mn/ko).
3. routes/public.js: /config에 booking_window_days·min_date·max_date 추가. /availability GET과 예약 POST에 isWithinWindow 검증.
4. customer.js months(): selectable을 min<=dateStr<=max로. min/max는 this.config에서(없으면 클라 계산 폴백).
5. index.html + locales(mn/ko): 달력 아래 안내문구 booking_window_hint.
6. test/booking-window.test.js (신규): 오늘 OK, 오늘+13 OK, 오늘+14 거절, 어제 거절, days 변경 반영.

## 비범위
자동취소 cron·QPay·floor-rule·어드민 변경 없음. 어드민은 윈도우 제한 안 받음(조회 자유). 검증은 손님 공개 라우트에만.
