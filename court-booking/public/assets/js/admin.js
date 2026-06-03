function adminApp() {
  return {
    bookings: [],
    detail: null,
    error: null,
    filters: { date: '', status: 'active', phone: '' },
    view: 'grid',          // 'grid'(현황판) | 'list'(목록)
    gridData: null,        // { date, courts:[{court_id,name_mn,slots:[{start,end,status,booking}]}], summary }

    async init() {
      this.filters.date = new Date().toISOString().slice(0, 10);
      await this.refresh();
    },

    // 현재 뷰에 맞춰 다시 로드 (날짜 변경 시 등)
    async refresh() {
      if (this.view === 'grid') await this.loadGrid();
      else await this.load();
    },

    async switchView(v) {
      this.view = v;
      await this.refresh();
    },

    async loadGrid() {
      this.error = null;
      try {
        this.gridData = await api.get(`${window.PATH_PREFIX}/api/admin/grid?date=${this.filters.date}`);
      } catch (e) {
        if (e.error_code === 'NO_TOKEN' || e.error_code === 'INVALID_TOKEN') {
          location.href = '/staff-manager/login?next=' + encodeURIComponent(location.pathname);
        } else {
          this.error = e.message_mn || e.message || '로드 실패';
        }
      }
    },

    // 현황판 시간 행: 코트들이 같은 운영시간이라 첫 코트 기준으로 행 구성
    gridRows() {
      if (!this.gridData || !this.gridData.courts.length) return [];
      const times = this.gridData.courts[0].slots.map(s => ({ start: s.start, end: s.end }));
      return times.map(t => ({
        start: t.start,
        cells: this.gridData.courts.map(c => c.slots.find(s => s.start === t.start) || { status: 'available' })
      }));
    },

    cellClass(status) {
      return {
        available: 'bg-slate-50 text-slate-300 hover:bg-slate-100',
        blocked:   'bg-slate-200 text-slate-400',
        pending:   'bg-amber-300 text-amber-950 font-semibold',
        confirmed: 'bg-emerald-500 text-white font-semibold'
      }[status] || 'bg-slate-100';
    },

    cellLabel(status) {
      return { available: '○', blocked: '✕', pending: '대기', confirmed: '예약' }[status] || status;
    },

    // 셀 내용: 예약/대기는 손님 이름, 차단은 ✕, 빈자리는 공백 (색으로 상태 구분)
    cellText(cell) {
      if (cell.booking) return cell.booking.name || (cell.status === 'pending' ? '대기' : '예약');
      return cell.status === 'blocked' ? '✕' : '';
    },

    // 코트 헤더 종목별 색: 테니스 초록 / 농구 주황 / 배구 파랑
    courtTint(g) {
      if (!g) return 'text-slate-600';
      if (g.indexOf('basketball') >= 0) return 'text-orange-600';
      if (g.indexOf('volleyball') >= 0) return 'text-blue-600';
      return 'text-emerald-700';
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
