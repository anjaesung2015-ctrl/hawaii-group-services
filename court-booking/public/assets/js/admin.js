function adminApp() {
  return {
    bookings: [],
    detail: null,
    error: null,
    filters: { date: '', status: '', phone: '' },

    async init() {
      this.filters.date = new Date().toISOString().slice(0, 10);
      await this.load();
    },

    async load() {
      this.error = null;
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(this.filters)) if (v) q.set(k, v);
      try {
        this.bookings = await api.get(`${window.PATH_PREFIX}/api/admin/bookings?${q.toString()}`);
      } catch (e) {
        if (e.error_code === 'NO_TOKEN' || e.error_code === 'INVALID_TOKEN') {
          location.href = '/staff-manager/login?next=' + encodeURIComponent(location.pathname);
        } else {
          this.error = e.message_mn || e.message || '로드 실패';
        }
      }
    },

    statusColor(s) {
      return {
        pending: 'bg-yellow-100 text-yellow-800',
        confirmed: 'bg-emerald-100 text-emerald-800',
        cancelled: 'bg-red-100 text-red-700',
        no_show: 'bg-orange-100 text-orange-700',
        completed: 'bg-slate-100 text-slate-700'
      }[s] || 'bg-slate-100';
    },

    async openDetail(b) {
      try {
        this.detail = await api.get(`${window.PATH_PREFIX}/api/admin/bookings/${b.id}`);
      } catch (e) {
        this.error = e.message_mn || '상세 로드 실패';
      }
    },

    async cancelBooking() {
      const reason = prompt('취소 사유:');
      if (!reason || reason.length < 2) return;
      try {
        await api.post(`${window.PATH_PREFIX}/api/admin/bookings/${this.detail.id}/cancel`, { reason });
        this.detail = null;
        await this.load();
      } catch (e) { this.error = e.message_mn || '취소 실패'; }
    },

    async markNoShow() {
      if (!confirm('노쇼 처리하시겠습니까?')) return;
      try {
        await api.post(`${window.PATH_PREFIX}/api/admin/bookings/${this.detail.id}/no-show`);
        this.detail = null;
        await this.load();
      } catch (e) { this.error = e.message_mn || '실패'; }
    },

    async confirmCash() {
      if (!confirm('현금 수납 처리하시겠습니까?')) return;
      try {
        await api.post(`${window.PATH_PREFIX}/api/admin/bookings/${this.detail.id}/confirm-cash`);
        this.detail = null;
        await this.load();
      } catch (e) { this.error = e.message_mn || '실패'; }
    }
  };
}
window.adminApp = adminApp;
