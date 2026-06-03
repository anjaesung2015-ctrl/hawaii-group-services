async function bootI18n() { await loadLocale(); }
document.addEventListener('alpine:init', bootI18n);

function bookingApp() {
  return {
    step: 1,
    selected: { court: null, date: null, slot: null },
    grid: [],          // 선택 날짜의 전 코트 가용현황 [{court_id,name_mn,price_per_hour,slots:[{start,end,available}]}]
    config: { bank: {}, deposit_rate: 0.5 },   // 계좌이체 안내 (계약금 비율 + 입금 계좌)
    form: { guest_name: '', guest_phone: '', guest_email: '', agree: false },
    booking: null,
    pollTimer: null,
    countdownTimer: null,
    expiresAt: null,
    countdown: '15:00',
    submitting: false,
    error: null,

    // i18n 반응성: locale은 fetch로 비동기 로드되고 window.__i18n.messages는 Alpine 반응형이 아니라,
    // 로드 완료 전 평가된 t() 바인딩이 키 문자열로 굳는다. _lv를 반응형 의존성으로 끼워넣고
    // 로드 완료 시 _lv++ 하면 t()를 호출하는 모든 바인딩이 재평가된다.
    _lv: 0,
    lang: 'mn',
    t(key, vars) { this._lv; return window.t(key, vars); },

    // 언어 전환: locale 다시 로드 → localStorage 저장 → _lv++로 전체 재렌더(달력 요일/월 라벨 포함)
    async setLang(l) {
      if (l === this.lang) return;
      await loadLocale(l);
      this.lang = window.__i18n.lang;
      try { localStorage.setItem('booking_lang', this.lang); } catch (e) {}
      this._lv++;
    },

    async init() {
      await bootI18n();
      this.lang = window.__i18n.lang;
      this._lv++;   // locale 로드 완료 → 모든 t() 바인딩 재렌더
      try { this.config = await api.get(`${window.PATH_PREFIX}/api/config`); } catch (e) {}
    },

    // 계약금 = 예약금액 × 비율 (나머지는 현장)
    depositAmount() {
      const amt = this.booking?.amount || this.calcAmount();
      return Math.round(amt * (this.config.deposit_rate || 0.5));
    },

    // 코트 이름: 현재 언어(mn/ko)에 따라 표시. _lv로 언어전환 반응성 확보.
    courtName(c) {
      this._lv;
      if (!c) return '';
      return (this.lang === 'ko' ? (c.name_ko || c.name_mn) : (c.name_mn || c.name_ko)) || '';
    },

    // 현지화 요일 헤더 (일요일 시작). locale에 없으면 한국어 폴백
    weekdays() {
      this._lv;
      return window.__i18n.messages.weekdays || ['일','월','화','수','목','금','토'];
    },

    // 이번 달 + 다음 달, 각 달을 {label, cells}로. 세로로 이어서 표시.
    // 1일 앞은 빈칸(blank)으로 패딩해 요일 정렬. selectable: 오늘 이후(오늘 포함)만.
    months() {
      this._lv;
      const today = dayjs();
      const todayStr = today.format('YYYY-MM-DD');
      const result = [];
      for (let mo = 0; mo < 2; mo++) {             // 0=이번 달, 1=다음 달
        const base = today.add(mo, 'month').startOf('month');
        const firstDow = base.day();               // 0=일
        const daysInMonth = base.daysInMonth();
        const cells = [];
        for (let i = 0; i < firstDow; i++) cells.push({ blank: true });
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = base.date(d).format('YYYY-MM-DD');
          cells.push({
            blank: false,
            date: dateStr,
            day: d,
            isToday: dateStr === todayStr,
            selectable: dateStr >= todayStr,        // YYYY-MM-DD 문자열 비교 = 날짜 비교
          });
        }
        result.push({
          key: base.format('YYYY-MM'),
          label: t('month_label', { year: base.year(), month: base.month() + 1 }),
          cells,
        });
      }
      return result;
    },

    async selectDate(date) {
      this.selected.date = date;
      this.selected.slot = null;
      this.selected.court = null;
      await this.loadGrid();
    },

    // 선택 날짜의 전 코트 가용현황 로드
    async loadGrid() {
      if (!this.selected.date) return;
      this.error = null;
      try {
        const r = await api.get(`${window.PATH_PREFIX}/api/availability?date=${this.selected.date}`);
        this.grid = r.courts || [];
      } catch (e) {
        this.error = e.message_mn || t('err_internal');
      }
    },

    // 그리드 행: 시간 × 코트 셀. 모든 코트가 같은 운영시간이라 첫 코트 기준으로 시간 행 구성.
    gridRows() {
      if (!this.grid.length) return [];
      const times = this.grid[0].slots.map(s => ({ start: s.start, end: s.end }));
      return times.map(t => ({
        start: t.start, end: t.end,
        cells: this.grid.map(c => {
          const slot = c.slots.find(s => s.start === t.start);
          return { court: c, available: !!(slot && slot.available), start: t.start, end: t.end };
        })
      }));
    },

    // 빈 셀 탭 → 코트+시간 확정하고 정보입력(step 3)으로
    selectCell(cell) {
      if (!cell.available) return;
      this.selected.court = { id: cell.court.court_id, name_mn: cell.court.name_mn, name_ko: cell.court.name_ko, price_per_hour: cell.court.price_per_hour };
      this.selected.slot = { start: cell.start, end: cell.end };
      this.step = 3;
    },

    calcAmount() {
      if (!this.selected.court || !this.selected.slot) return 0;
      const [sh, sm] = this.selected.slot.start.split(':').map(Number);
      const [eh, em] = this.selected.slot.end.split(':').map(Number);
      const hours = (eh * 60 + em - sh * 60 - sm) / 60;
      return Math.round(this.selected.court.price_per_hour * hours);
    },

    canSubmit() {
      return this.form.guest_name && /^[0-9+\-\s]{6,20}$/.test(this.form.guest_phone) && this.form.agree;
    },

    async submit() {
      if (!this.canSubmit() || this.submitting) return;
      this.submitting = true;
      this.error = null;
      try {
        const res = await api.post(`${window.PATH_PREFIX}/api/bookings`, {
          court_id: this.selected.court.id,
          booking_date: this.selected.date,
          start_time: this.selected.slot.start,
          end_time: this.selected.slot.end,
          guest_name: this.form.guest_name,
          guest_phone: this.form.guest_phone,
          guest_email: this.form.guest_email || null
        });
        this.booking = res;
        this.expiresAt = res.expires_at ? new Date(res.expires_at).getTime() : Date.now() + 15 * 60_000;
        this.step = 4;
        this.startPolling();
        this.startCountdown();
      } catch (e) {
        if (e.error_code === 'SLOT_CONFLICT') {
          this.error = t('err_slot_taken');
          this.step = 1;
          await this.loadGrid();
        } else {
          this.error = e.message_mn || t('err_internal');
        }
      } finally {
        this.submitting = false;
      }
    },

    startPolling() {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(async () => {
        try {
          const s = await api.get(`${window.PATH_PREFIX}/api/bookings/${this.booking.public_code}/payment-status`);
          if (s.status === 'paid') {
            clearInterval(this.pollTimer); clearInterval(this.countdownTimer);
            this.step = 5;
          } else if (s.status === 'cancelled') {
            clearInterval(this.pollTimer); clearInterval(this.countdownTimer);
            this.error = t('err_payment_expired');
            this.step = 3;
          }
        } catch (e) {}
      }, 3000);
    },

    startCountdown() {
      clearInterval(this.countdownTimer);
      this.countdownTimer = setInterval(() => {
        const remain = Math.max(0, this.expiresAt - Date.now());
        const m = String(Math.floor(remain / 60_000)).padStart(2, '0');
        const s = String(Math.floor((remain % 60_000) / 1000)).padStart(2, '0');
        this.countdown = `${m}:${s}`;
        if (remain <= 30_000 && remain > 28_000 && navigator.vibrate) navigator.vibrate(200);
        if (remain <= 0) { clearInterval(this.countdownTimer); }
      }, 500);
    },

    async cancelDuringPayment() {
      const last4 = (this.form.guest_phone || '').slice(-4);
      try {
        await api.post(`${window.PATH_PREFIX}/api/bookings/${this.booking.public_code}/cancel`, { phone_last4: last4 });
        clearInterval(this.pollTimer); clearInterval(this.countdownTimer);
        this.step = 1;
        this.selected.slot = null;
      } catch (e) {
        this.error = e.message_mn || t('err_internal');
      }
    }
  };
}
window.bookingApp = bookingApp;
