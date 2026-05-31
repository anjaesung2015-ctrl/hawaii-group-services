async function bootI18n() { await loadLocale('mn'); }
document.addEventListener('alpine:init', bootI18n);

function bookingApp() {
  return {
    step: 1,
    courts: [],
    selected: { court: null, date: null, slot: null },
    availability: [],
    form: { guest_name: '', guest_phone: '', guest_email: '', agree: false },
    booking: null,
    pollTimer: null,
    countdownTimer: null,
    expiresAt: null,
    countdown: '15:00',
    submitting: false,
    error: null,

    async init() {
      await bootI18n();
      try {
        this.courts = await api.get(`${window.PATH_PREFIX}/api/courts`);
        this.selected.court = this.courts[0] || null;
      } catch (e) {
        this.error = e.message_mn || t('err_internal');
      }
    },

    next14Days() {
      const arr = [];
      const today = dayjs();
      const dow = ['Ня','Да','Мя','Лх','Пү','Ба','Бя'];
      for (let i = 0; i < 14; i++) {
        const d = today.add(i, 'day');
        arr.push({ date: d.format('YYYY-MM-DD'), day: d.format('D'), dow: i === 0 ? t('today') : dow[d.day()] });
      }
      return arr;
    },

    async selectDate(date) {
      this.selected.date = date;
      this.selected.slot = null;
    },

    async goToSlots() {
      this.error = null;
      try {
        this.availability = await api.get(`${window.PATH_PREFIX}/api/availability?court_id=${this.selected.court.id}&date=${this.selected.date}`);
        this.step = 2;
      } catch (e) {
        this.error = e.message_mn || t('err_internal');
      }
    },

    selectSlot(slot) {
      this.selected.slot = slot;
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
          await this.goToSlots();
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
