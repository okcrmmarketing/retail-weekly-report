// 리테일기획부 주간업무 - 프론트엔드 로직 (프레임워크 없음, 순수 JS)

const CFG = window.APP_CONFIG;
const API = CFG.WORKER_BASE_URL.replace(/\/$/, '');

// ---------------- ISO 주차 유틸 ----------------
function getISOWeekId(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 그 주의 목요일
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function weekIdToMonday(weekId) {
  const [y, w] = weekId.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (w - 1) * 7);
  return monday;
}

function addWeeks(weekId, delta) {
  const monday = weekIdToMonday(weekId);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return getISOWeekId(monday);
}

function weekLabel(weekId) {
  const monday = weekIdToMonday(weekId);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${weekId} (${fmt(monday)}~${fmt(sunday)})`;
}

// ---------------- 전역 상태 ----------------
let state = {
  week: getISOWeekId(new Date()),
  teams: [],
  work: {},
  trend: {},
  vacation: {},
  order: [],
};
let adminSessionPassword = null; // 로그인 성공 시 세션 동안만 메모리 보관 (재입력 방지용)

// ---------------- API 호출 ----------------
async function apiGet(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('서버 오류 (' + res.status + ')');
  return res.json();
}
async function apiWrite(path, method, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': CFG.API_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || ('서버 오류 (' + res.status + ')'));
  return data;
}

async function loadWeek() {
  document.getElementById('weekLabel').textContent = weekLabel(state.week);
  try {
    const data = await apiGet('/api/bootstrap?week=' + encodeURIComponent(state.week));
    state.teams = data.teams;
    state.work = data.work;
    state.trend = data.trend;
    state.vacation = data.vacation;
    state.order = data.order;
  } catch (e) {
    alert('데이터를 불러오지 못했습니다: ' + e.message + '\n(config.js의 WORKER_BASE_URL 설정을 확인하세요)');
    return;
  }
  renderWork();
  renderTrend();
  renderVacation();
  renderOrderList();
}

// ---------------- 업무보고 ----------------
function renderWork() {
  const container = document.getElementById('workTeamsContainer');
  container.innerHTML = '';
  state.teams.forEach((team) => {
    const data = state.work[team.key] || { items: [] };
    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <div class="team-card-header">
        <span class="team-card-title">${escapeHtml(team.label)}</span>
        <button class="btn btn-primary btn-sm" data-save-work="${team.key}">저장</button>
      </div>
      <div class="row-head">
        <span>카테고리</span><span>예정일</span><span>상세내용</span><span class="head-note">비고</span><span></span>
      </div>
      <div class="work-rows" data-rows-for="${team.key}"></div>
      <button class="btn btn-secondary btn-sm add-row-btn" data-add-work="${team.key}">+ 항목 추가</button>
    `;
    container.appendChild(card);
    renderWorkRows(team.key, data.items);
  });

  container.querySelectorAll('[data-add-work]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.addWork;
      state.work[key] = state.work[key] || { items: [] };
      state.work[key].items.push({ category: '', dueDate: '', detail: '', note: '' });
      renderWorkRows(key, state.work[key].items);
    });
  });
  container.querySelectorAll('[data-save-work]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.saveWork;
      btn.disabled = true;
      try {
        await apiWrite('/api/save', 'PUT', { week: state.week, section: 'work', team: key, data: state.work[key] });
        flashSaved(btn);
      } catch (e) { alert('저장 실패: ' + e.message); }
      btn.disabled = false;
    });
  });
}

function renderWorkRows(teamKey, items) {
  const wrap = document.querySelector(`[data-rows-for="${teamKey}"]`);
  wrap.innerHTML = '';
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'work-row';
    row.innerHTML = `
      <input value="${escapeAttr(item.category)}" placeholder="카테고리" data-f="category" />
      <input type="date" value="${escapeAttr(item.dueDate)}" data-f="dueDate" />
      <textarea rows="1" placeholder="상세내용" data-f="detail">${escapeHtml(item.detail)}</textarea>
      <input class="work-note" value="${escapeAttr(item.note)}" placeholder="비고" data-f="note" />
      <button class="btn-danger" data-del="${idx}">✕</button>
    `;
    row.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('input', () => { items[idx][el.dataset.f] = el.value; });
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      items.splice(idx, 1);
      renderWorkRows(teamKey, items);
    });
    wrap.appendChild(row);
  });
}

// ---------------- 트렌드보고 ----------------
function renderTrend() {
  const container = document.getElementById('trendTeamsContainer');
  container.innerHTML = '';
  state.teams.forEach((team) => {
    const data = state.trend[team.key] || { items: [] };
    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <div class="team-card-header">
        <span class="team-card-title">${escapeHtml(team.label)}</span>
        <button class="btn btn-primary btn-sm" data-save-trend="${team.key}">저장</button>
      </div>
      <div class="trend-items" data-trend-for="${team.key}"></div>
      <button class="btn btn-secondary btn-sm add-row-btn" data-add-trend="${team.key}">+ 트렌드 추가</button>
    `;
    container.appendChild(card);
    renderTrendItems(team.key, data.items);
  });

  container.querySelectorAll('[data-add-trend]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.addTrend;
      state.trend[key] = state.trend[key] || { items: [] };
      state.trend[key].items.push({ title: '', content: '', images: [] });
      renderTrendItems(key, state.trend[key].items);
    });
  });
  container.querySelectorAll('[data-save-trend]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.saveTrend;
      btn.disabled = true;
      try {
        await apiWrite('/api/save', 'PUT', { week: state.week, section: 'trend', team: key, data: state.trend[key] });
        flashSaved(btn);
      } catch (e) { alert('저장 실패: ' + e.message + (e.message.includes('413') ? ' (이미지 용량이 너무 큽니다)' : '')); }
      btn.disabled = false;
    });
  });
}

function renderTrendItems(teamKey, items) {
  const wrap = document.querySelector(`[data-trend-for="${teamKey}"]`);
  wrap.innerHTML = '';
  items.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'trend-item';
    el.innerHTML = `
      <input class="trend-title" value="${escapeAttr(item.title)}" placeholder="제목" data-f="title" />
      <textarea class="trend-content" placeholder="내용" data-f="content">${escapeHtml(item.content)}</textarea>
      <div class="trend-images" data-imgs></div>
      <div class="trend-item-toolbar">
        <label class="btn btn-secondary btn-sm">이미지 첨부<input type="file" accept="image/*" multiple hidden data-imgadd /></label>
        <button class="btn-danger" data-deltrend>이 트렌드 삭제</button>
      </div>
    `;
    el.querySelectorAll('[data-f]').forEach((inp) => {
      inp.addEventListener('input', () => { item[inp.dataset.f] = inp.value; });
    });
    el.querySelector('[data-deltrend]').addEventListener('click', () => {
      items.splice(idx, 1);
      renderTrendItems(teamKey, items);
    });
    el.querySelector('[data-imgadd]').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        try {
          const dataUrl = await compressImage(f);
          item.images = item.images || [];
          item.images.push(dataUrl);
        } catch (err) { alert('이미지 처리 실패: ' + err.message); }
      }
      renderTrendImages(el.querySelector('[data-imgs]'), item);
      e.target.value = '';
    });
    renderTrendImages(el.querySelector('[data-imgs]'), item);
    wrap.appendChild(el);
  });
}

function renderTrendImages(wrapEl, item) {
  wrapEl.innerHTML = '';
  (item.images || []).forEach((src, i) => {
    const box = document.createElement('div');
    box.className = 'trend-img-wrap';
    box.innerHTML = `<img src="${src}" /><button class="trend-img-remove">✕</button>`;
    box.querySelector('button').addEventListener('click', () => {
      item.images.splice(i, 1);
      renderTrendImages(wrapEl, item);
    });
    wrapEl.appendChild(box);
  });
}

function compressImage(file, maxWidth = 1200, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지 디코딩 실패'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------- 휴가자현황 ----------------
function renderVacation() {
  const container = document.getElementById('vacationTeamsContainer');
  container.innerHTML = '';
  state.teams.forEach((team) => {
    const data = state.vacation[team.key] || { items: [] };
    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <div class="team-card-header">
        <span class="team-card-title">${escapeHtml(team.label)}</span>
        <button class="btn btn-primary btn-sm" data-save-vac="${team.key}">저장</button>
      </div>
      <div class="vac-rows" data-vacrows-for="${team.key}"></div>
      <button class="btn btn-secondary btn-sm add-row-btn" data-add-vac="${team.key}">+ 휴가자 추가</button>
    `;
    container.appendChild(card);
    renderVacRows(team.key, data.items);
  });

  container.querySelectorAll('[data-add-vac]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.addVac;
      state.vacation[key] = state.vacation[key] || { items: [] };
      state.vacation[key].items.push({ name: '', date: '', type: '연차', note: '' });
      renderVacRows(key, state.vacation[key].items);
    });
  });
  container.querySelectorAll('[data-save-vac]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.saveVac;
      btn.disabled = true;
      try {
        await apiWrite('/api/save', 'PUT', { week: state.week, section: 'vacation', team: key, data: state.vacation[key] });
        flashSaved(btn);
      } catch (e) { alert('저장 실패: ' + e.message); }
      btn.disabled = false;
    });
  });
}

function renderVacRows(teamKey, items) {
  const wrap = document.querySelector(`[data-vacrows-for="${teamKey}"]`);
  wrap.innerHTML = '';
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'vac-row';
    row.innerHTML = `
      <input value="${escapeAttr(item.name)}" placeholder="이름" data-f="name" />
      <input type="date" value="${escapeAttr(item.date)}" data-f="date" />
      <input value="${escapeAttr(item.type)}" placeholder="연차/반차" data-f="type" />
      <input class="vac-note" value="${escapeAttr(item.note)}" placeholder="비고" data-f="note" />
      <button class="btn-danger" data-del="${idx}">✕</button>
    `;
    row.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('input', () => { items[idx][el.dataset.f] = el.value; });
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      items.splice(idx, 1);
      renderVacRows(teamKey, items);
    });
    wrap.appendChild(row);
  });
}

// ---------------- 발표모드 ----------------
function renderOrderList() {
  const wrap = document.getElementById('orderList');
  wrap.innerHTML = '';
  const order = state.order.length ? state.order : state.teams.map((t) => t.key);
  order.forEach((teamKey, idx) => {
    const team = state.teams.find((t) => t.key === teamKey);
    if (!team) return;
    const el = document.createElement('div');
    el.className = 'order-item';
    el.innerHTML = `
      <span>${idx + 1}. ${escapeHtml(team.label)}</span>
      <span class="order-item-btns">
        <button class="btn btn-secondary btn-sm" data-up>▲</button>
        <button class="btn btn-secondary btn-sm" data-down>▼</button>
      </span>
    `;
    el.querySelector('[data-up]').addEventListener('click', () => {
      if (idx === 0) return;
      [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
      renderOrderList();
      saveOrder();
    });
    el.querySelector('[data-down]').addEventListener('click', () => {
      if (idx === order.length - 1) return;
      [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
      renderOrderList();
      saveOrder();
    });
    wrap.appendChild(el);
  });
  state.order = order;
}

async function saveOrder() {
  try {
    await apiWrite('/api/order', 'PUT', { week: state.week, order: state.order });
  } catch (e) { alert('발표순서 저장 실패: ' + e.message); }
}

let presentIdx = 0;
function buildPresentSlides() {
  return state.order.map((teamKey) => {
    const team = state.teams.find((t) => t.key === teamKey);
    const work = (state.work[teamKey] || { items: [] }).items;
    const trend = (state.trend[teamKey] || { items: [] }).items;
    return { team, work, trend };
  }).filter((s) => s.team);
}

function renderPresentSlide() {
  const slides = buildPresentSlides();
  if (slides.length === 0) return;
  presentIdx = (presentIdx + slides.length) % slides.length;
  const s = slides[presentIdx];
  document.getElementById('presentPageNum').textContent = presentIdx + 1;
  document.getElementById('presentPageTotal').textContent = slides.length;

  const workHtml = s.work.length
    ? s.work.map((w) => `<div class="present-work-row"><b>${escapeHtml(w.category || '-')}</b> · ${escapeHtml(w.dueDate || '')} · ${escapeHtml(w.detail || '')} ${w.note ? '(' + escapeHtml(w.note) + ')' : ''}</div>`).join('')
    : '<p class="hint">등록된 업무보고가 없습니다.</p>';

  const trendHtml = s.trend.length
    ? s.trend.map((t) => `
        <div class="present-trend-block">
          <b>${escapeHtml(t.title || '(제목 없음)')}</b>
          <p>${escapeHtml(t.content || '')}</p>
          ${(t.images || []).map((src) => `<img src="${src}" />`).join('')}
        </div>`).join('')
    : '<p class="hint">등록된 트렌드보고가 없습니다.</p>';

  document.getElementById('presentSlide').innerHTML = `
    <h2>${escapeHtml(s.team.label)}</h2>
    <h3>업무보고</h3>
    ${workHtml}
    <h3>트렌드보고</h3>
    ${trendHtml}
  `;
}

function startPresent() {
  presentIdx = 0;
  renderPresentSlide();
  document.getElementById('presentOverlay').classList.remove('hidden');
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}
function exitPresent() {
  document.getElementById('presentOverlay').classList.add('hidden');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

// ---------------- 인쇄 / 다운로드 ----------------
function downloadWeekAsText() {
  let out = `리테일기획부 주간업무 - ${weekLabel(state.week)}\n\n`;
  state.teams.forEach((team) => {
    out += `■ ${team.label}\n`;
    const items = (state.work[team.key] || { items: [] }).items;
    if (items.length === 0) out += '  (등록된 업무 없음)\n';
    items.forEach((it) => {
      out += `  - [${it.category || '-'}] ${it.detail || ''} (예정일: ${it.dueDate || '-'}${it.note ? ', 비고: ' + it.note : ''})\n`;
    });
    out += '\n';
  });
  const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `주간업무_${state.week}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------- 관리자 ----------------
function renderAdminTeamList() {
  const wrap = document.getElementById('adminTeamList');
  wrap.innerHTML = '';
  state.teams.forEach((team, idx) => {
    const row = document.createElement('div');
    row.className = 'admin-team-row';
    row.innerHTML = `
      <input value="${escapeAttr(team.key)}" placeholder="key(영문)" data-f="key" style="flex:1" />
      <input value="${escapeAttr(team.label)}" placeholder="팀 이름" data-f="label" style="flex:2" />
      <button class="btn-danger" data-del>✕</button>
    `;
    row.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('input', () => { team[el.dataset.f] = el.value; });
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      state.teams.splice(idx, 1);
      renderAdminTeamList();
    });
    wrap.appendChild(row);
  });
}

function wireAdmin() {
  const modal = document.getElementById('adminModal');
  document.getElementById('adminOpenBtn').addEventListener('click', () => {
    modal.classList.remove('hidden');
    document.getElementById('adminLoginPanel').classList.remove('hidden');
    document.getElementById('adminPanel').classList.add('hidden');
    document.getElementById('adminPasswordInput').value = '';
    document.getElementById('adminLoginError').classList.add('hidden');
  });
  document.getElementById('adminCloseBtn').addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('adminLoginBtn').addEventListener('click', async () => {
    const pw = document.getElementById('adminPasswordInput').value;
    const errEl = document.getElementById('adminLoginError');
    errEl.classList.add('hidden');
    try {
      // /api/admin/login은 공개 엔드포인트(비밀번호 자체가 인증 수단)라 X-Api-Key 없이 호출
      const r = await fetch(API + '/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      const res = await r.json();
      if (!res.ok) { errEl.textContent = '비밀번호가 틀렸습니다.'; errEl.classList.remove('hidden'); return; }
      adminSessionPassword = pw;
      document.getElementById('adminLoginPanel').classList.add('hidden');
      document.getElementById('adminPanel').classList.remove('hidden');
      renderAdminTeamList();
    } catch (e) {
      errEl.textContent = '로그인 실패: ' + e.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('adminAddTeamBtn').addEventListener('click', () => {
    state.teams.push({ key: '', label: '' });
    renderAdminTeamList();
  });

  document.getElementById('adminSaveTeamsBtn').addEventListener('click', async () => {
    const msg = document.getElementById('adminActionMsg');
    try {
      await apiWrite('/api/admin/teams', 'PUT', { password: adminSessionPassword, teams: state.teams });
      msg.textContent = '팀 목록이 저장되었습니다. 새로고침 후 반영됩니다.';
    } catch (e) { msg.textContent = '저장 실패: ' + e.message; }
  });

  document.getElementById('adminChangePasswordBtn').addEventListener('click', async () => {
    const p1 = document.getElementById('adminNewPassword1').value;
    const p2 = document.getElementById('adminNewPassword2').value;
    const msg = document.getElementById('adminActionMsg');
    if (!p1 || p1 !== p2) { msg.textContent = '새 비밀번호가 일치하지 않습니다.'; return; }
    try {
      await apiWrite('/api/admin/password', 'PUT', { oldPassword: adminSessionPassword, newPassword: p1 });
      adminSessionPassword = p1;
      msg.textContent = '비밀번호가 변경되었습니다.';
    } catch (e) { msg.textContent = '변경 실패: ' + e.message; }
  });
}

// ---------------- 공통 유틸 ----------------
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function flashSaved(btn) {
  const orig = btn.textContent;
  btn.textContent = '저장됨 ✓';
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

// ---------------- 초기화 ----------------
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

function wireWeekNav() {
  document.getElementById('prevWeekBtn').addEventListener('click', () => { state.week = addWeeks(state.week, -1); loadWeek(); });
  document.getElementById('nextWeekBtn').addEventListener('click', () => { state.week = addWeeks(state.week, 1); loadWeek(); });
  document.getElementById('thisWeekBtn').addEventListener('click', () => { state.week = getISOWeekId(new Date()); loadWeek(); });
}

function wirePresent() {
  document.getElementById('startPresentBtn').addEventListener('click', startPresent);
  document.getElementById('presentExitBtn').addEventListener('click', exitPresent);
  document.getElementById('presentPrevBtn').addEventListener('click', () => { presentIdx--; renderPresentSlide(); });
  document.getElementById('presentNextBtn').addEventListener('click', () => { presentIdx++; renderPresentSlide(); });
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('presentOverlay').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') { presentIdx--; renderPresentSlide(); }
    if (e.key === 'ArrowRight') { presentIdx++; renderPresentSlide(); }
    if (e.key === 'Escape') exitPresent();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) exitPresent();
  });
}

function wirePrintDownload() {
  document.getElementById('printWorkBtn').addEventListener('click', () => window.print());
  document.getElementById('downloadWorkBtn').addEventListener('click', downloadWeekAsText);
}

(function init() {
  if (!CFG.WORKER_BASE_URL || CFG.WORKER_BASE_URL.startsWith('여기에')) {
    alert('config.js에 Cloudflare Worker 주소/API_KEY를 먼저 설정해주세요.');
  }
  wireTabs();
  wireWeekNav();
  wirePresent();
  wirePrintDownload();
  wireAdmin();
  loadWeek();
})();
