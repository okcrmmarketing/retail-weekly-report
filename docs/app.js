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
  activeTeamKey: null,
  activeType: 'work',
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
function stripUiState(items) {
  return (items || []).map((it) => {
    const copy = Object.assign({}, it);
    delete copy.__noteOpen;
    return copy;
  });
}

async function loadWeek() {
  document.getElementById('weekLabel').textContent = weekLabel(state.week).split(' ')[0];
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
  if (!state.activeTeamKey || !state.teams.find((t) => t.key === state.activeTeamKey)) {
    state.activeTeamKey = state.teams[0] ? state.teams[0].key : null;
  }
  renderTeamTabs();
  renderWorkEdit();
  renderWorkPreview();
  renderTrendEdit();
  renderTrendPreview();
  renderOrderList();
}

// ---------------- 팀 탭 ----------------
function renderTeamTabs() {
  const wrap = document.getElementById('teamTabs');
  wrap.innerHTML = '';
  state.teams.forEach((team, idx) => {
    const btn = document.createElement('button');
    btn.className = 'team-tab-btn' + (team.key === state.activeTeamKey ? ' active' : '');
    btn.innerHTML = `<span class="team-tab-num">${String(idx + 1).padStart(2, '0')}</span>${escapeHtml(team.label)}`;
    btn.addEventListener('click', () => {
      state.activeTeamKey = team.key;
      renderTeamTabs();
      renderWorkEdit();
      renderWorkPreview();
      renderTrendEdit();
      renderTrendPreview();
    });
    wrap.appendChild(btn);
  });
}

function currentTeam() {
  return state.teams.find((t) => t.key === state.activeTeamKey) || null;
}

// ---------------- 업무보고(편집) ----------------
function renderWorkEdit() {
  const team = currentTeam();
  const itemsWrap = document.getElementById('workItemsWrap');
  const vacWrap = document.getElementById('vacationRowsWrap');
  itemsWrap.innerHTML = '';
  vacWrap.innerHTML = '';
  if (!team) return;

  const items = (state.work[team.key] || (state.work[team.key] = { items: [] })).items;
  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    const noteOpen = item.__noteOpen || !!item.note;
    card.innerHTML = `
      <div class="item-card-top">
        <span class="item-drag-handle">⠿</span>
        <button class="btn-danger-icon" data-del title="삭제">✕</button>
      </div>
      <div class="field-row">
        <div class="field-group"><label>카테고리</label><input placeholder="카테고리 작성" value="${escapeAttr(item.category)}" data-f="category" /></div>
        <div class="field-group"><label>완료예정일</label><input type="date" value="${escapeAttr(item.dueDate)}" data-f="dueDate" /></div>
      </div>
      <div class="field-row">
        <div class="field-group full"><label>업무 제목</label><input placeholder="업무 제목 작성" value="${escapeAttr(item.title)}" data-f="title" /></div>
      </div>
      <div class="field-row">
        <div class="field-group full"><label>상세내용</label><textarea rows="2" placeholder="업무 상세내용 작성" data-f="detail">${escapeHtml(item.detail)}</textarea></div>
      </div>
      <div class="field-row ${noteOpen ? '' : 'hidden'}" data-note-row>
        <div class="field-group full"><label>비고</label><input placeholder="비고" value="${escapeAttr(item.note)}" data-f="note" /></div>
      </div>
      <button class="note-toggle ${noteOpen ? 'hidden' : ''}" data-note-toggle>⌄ 비고 추가</button>
    `;
    card.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('input', () => { items[idx][el.dataset.f] = el.value; });
    });
    card.querySelector('[data-del]').addEventListener('click', () => {
      items.splice(idx, 1);
      renderWorkEdit();
    });
    const toggleBtn = card.querySelector('[data-note-toggle]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        item.__noteOpen = true;
        card.querySelector('[data-note-row]').classList.remove('hidden');
        toggleBtn.classList.add('hidden');
      });
    }
    itemsWrap.appendChild(card);
  });

  const vacItems = (state.vacation[team.key] || (state.vacation[team.key] = { items: [] })).items;
  vacItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'vac-row';
    row.innerHTML = `
      <input value="${escapeAttr(item.name)}" placeholder="이름" data-f="name" />
      <input value="${escapeAttr(item.period)}" placeholder="예: 8/25(월)~8/27(수)" data-f="period" />
      <button class="btn-danger-icon" data-del title="삭제">✕</button>
    `;
    row.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('input', () => { vacItems[idx][el.dataset.f] = el.value; });
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      vacItems.splice(idx, 1);
      renderWorkEdit();
    });
    vacWrap.appendChild(row);
  });
}

function buildWorkPreviewHtml(team) {
  const items = (state.work[team.key] || { items: [] }).items;
  const vacItems = (state.vacation[team.key] || { items: [] }).items;
  const hasAny = items.length > 0 || vacItems.length > 0;

  let body = '';
  if (!hasAny) {
    body = '<p class="preview-empty">작성된 내용이 없습니다.</p>';
  } else {
    if (items.length) {
      body += '<div class="preview-block"><p class="preview-block-title">이번주 업무</p>';
      body += items.map((it) => `
        <div class="preview-work-row">
          <span class="cat">${escapeHtml(it.category || '-')}</span>
          <span>${escapeHtml(it.title || it.detail || '')}${it.title && it.detail ? ' - ' + escapeHtml(it.detail) : ''}${it.note ? ' <span class="hint">(' + escapeHtml(it.note) + ')</span>' : ''}</span>
          <span class="due">${escapeHtml(it.dueDate || '')}</span>
        </div>`).join('');
      body += '</div>';
    }
    if (vacItems.length) {
      body += '<div class="preview-block"><p class="preview-block-title">이번 주 휴가자</p>';
      body += vacItems.map((it) => `<p class="preview-vac-line">${escapeHtml(it.name || '-')} · ${escapeHtml(it.period || '-')}</p>`).join('');
      body += '</div>';
    }
  }

  return `
    <h2 class="preview-title">${escapeHtml(team.label)} 주간업무 보고</h2>
    <p class="preview-subtitle">${escapeHtml(weekLabel(state.week))}</p>
    <hr class="preview-divider" />
    ${body}
  `;
}

function renderWorkPreview() {
  const team = currentTeam();
  const el = document.getElementById('workPreview');
  if (!team) { el.innerHTML = ''; return; }
  el.innerHTML = buildWorkPreviewHtml(team);
}

// ---------------- 트렌드보고(편집) ----------------
function renderTrendEdit() {
  const team = currentTeam();
  const wrap = document.getElementById('trendItemsWrap');
  wrap.innerHTML = '';
  if (!team) return;
  const items = (state.trend[team.key] || (state.trend[team.key] = { items: [] })).items;

  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-top">
        <span class="item-drag-handle">⠿</span>
        <button class="btn-danger-icon" data-del title="삭제">✕</button>
      </div>
      <div class="field-row">
        <div class="field-group full"><label>제목</label><input placeholder="트렌드 제목" value="${escapeAttr(item.title)}" data-f="title" /></div>
      </div>
      <div class="field-row">
        <div class="field-group full"><label>내용</label><textarea rows="3" placeholder="트렌드 내용" data-f="content">${escapeHtml(item.content)}</textarea></div>
      </div>
      <div class="trend-images" data-imgs></div>
      <div class="trend-item-toolbar">
        <label class="btn btn-outline btn-xs">이미지 첨부<input type="file" accept="image/*" multiple hidden data-imgadd /></label>
      </div>
    `;
    card.querySelectorAll('[data-f]').forEach((inp) => {
      inp.addEventListener('input', () => { item[inp.dataset.f] = inp.value; });
    });
    card.querySelector('[data-del]').addEventListener('click', () => {
      items.splice(idx, 1);
      renderTrendEdit();
    });
    card.querySelector('[data-imgadd]').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        try {
          const dataUrl = await compressImage(f);
          item.images = item.images || [];
          item.images.push(dataUrl);
        } catch (err) { alert('이미지 처리 실패: ' + err.message); }
      }
      renderTrendImages(card.querySelector('[data-imgs]'), item);
      e.target.value = '';
    });
    renderTrendImages(card.querySelector('[data-imgs]'), item);
    wrap.appendChild(card);
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

function buildTrendPreviewHtml(team) {
  const items = (state.trend[team.key] || { items: [] }).items;
  let body = '<p class="preview-empty">작성된 내용이 없습니다.</p>';
  if (items.length) {
    body = items.map((t) => `
      <div class="preview-trend-item">
        <b>${escapeHtml(t.title || '(제목 없음)')}</b>
        <p>${escapeHtml(t.content || '')}</p>
        ${(t.images || []).map((src) => `<img src="${src}" />`).join('')}
      </div>`).join('');
  }
  return `
    <h2 class="preview-title">${escapeHtml(team.label)} 트렌드보고</h2>
    <p class="preview-subtitle">${escapeHtml(weekLabel(state.week))}</p>
    <hr class="preview-divider" />
    ${body}
  `;
}

function renderTrendPreview() {
  const team = currentTeam();
  const el = document.getElementById('trendPreview');
  if (!team) { el.innerHTML = ''; return; }
  el.innerHTML = buildTrendPreviewHtml(team);
}

// ---------------- 저장 / 새로고침 ----------------
async function saveCurrentWork() {
  const team = currentTeam();
  if (!team) return;
  const btn = document.getElementById('saveWorkBtn');
  btn.disabled = true;
  try {
    const workData = { items: stripUiState(state.work[team.key].items) };
    await apiWrite('/api/save', 'PUT', { week: state.week, section: 'work', team: team.key, data: workData });
    await apiWrite('/api/save', 'PUT', { week: state.week, section: 'vacation', team: team.key, data: state.vacation[team.key] });
    flashSaved(btn);
    renderWorkPreview();
  } catch (e) { alert('저장 실패: ' + e.message); }
  btn.disabled = false;
}

async function saveCurrentTrend() {
  const team = currentTeam();
  if (!team) return;
  const btn = document.getElementById('saveTrendBtn');
  btn.disabled = true;
  try {
    await apiWrite('/api/save', 'PUT', { week: state.week, section: 'trend', team: team.key, data: state.trend[team.key] });
    flashSaved(btn);
    renderTrendPreview();
  } catch (e) { alert('저장 실패: ' + e.message + (e.message.includes('413') ? ' (이미지 용량이 너무 큽니다)' : '')); }
  btn.disabled = false;
}

async function loadPreviousWeekWork() {
  const team = currentTeam();
  if (!team) return;
  const prevWeek = addWeeks(state.week, -1);
  try {
    const data = await apiGet('/api/bootstrap?week=' + encodeURIComponent(prevWeek));
    const prevItems = (data.work[team.key] || { items: [] }).items;
    if (!prevItems.length) { alert('저번주에 등록된 업무가 없습니다.'); return; }
    if (state.work[team.key].items.length && !confirm('현재 작성 중인 업무 항목을 저번주 업무로 덮어씁니다. 계속할까요?')) return;
    state.work[team.key].items = JSON.parse(JSON.stringify(prevItems));
    renderWorkEdit();
  } catch (e) { alert('저번주 업무를 불러오지 못했습니다: ' + e.message); }
}

// ---------------- 발표 순서 ----------------
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
        <button class="btn btn-outline btn-xs" data-up>▲</button>
        <button class="btn btn-outline btn-xs" data-down>▼</button>
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

// ---------------- 발표모드 ----------------
let presentIdx = 0;
function buildPresentSlides() {
  return state.order.map((teamKey) => {
    const team = state.teams.find((t) => t.key === teamKey);
    const work = (state.work[teamKey] || { items: [] }).items;
    const trend = (state.trend[teamKey] || { items: [] }).items;
    const vacation = (state.vacation[teamKey] || { items: [] }).items;
    return { team, work, trend, vacation };
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
    ? s.work.map((w) => `<div class="present-work-row"><b>${escapeHtml(w.category || '-')}</b> · ${escapeHtml(w.dueDate || '')} · ${escapeHtml(w.title || '')} ${escapeHtml(w.detail || '')} ${w.note ? '(' + escapeHtml(w.note) + ')' : ''}</div>`).join('')
    : '<p class="hint">등록된 업무보고가 없습니다.</p>';

  const trendHtml = s.trend.length
    ? s.trend.map((t) => `
        <div class="present-trend-block">
          <b>${escapeHtml(t.title || '(제목 없음)')}</b>
          <p>${escapeHtml(t.content || '')}</p>
          ${(t.images || []).map((src) => `<img src="${src}" />`).join('')}
        </div>`).join('')
    : '<p class="hint">등록된 트렌드보고가 없습니다.</p>';

  const vacHtml = s.vacation.length
    ? s.vacation.map((v) => `<div class="present-work-row">${escapeHtml(v.name || '-')} · ${escapeHtml(v.period || '-')}</div>`).join('')
    : '<p class="hint">이번 주 휴가자가 없습니다.</p>';

  document.getElementById('presentSlide').innerHTML = `
    <h2>${escapeHtml(s.team.label)}</h2>
    <h3>업무보고</h3>
    ${workHtml}
    <h3>휴가자현황</h3>
    ${vacHtml}
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

// ---------------- 복사 / 다운로드 / 인쇄 ----------------
function previewToText(team, type) {
  if (type === 'work') {
    const items = (state.work[team.key] || { items: [] }).items;
    const vac = (state.vacation[team.key] || { items: [] }).items;
    let out = `${team.label} 주간업무 보고 - ${weekLabel(state.week)}\n\n`;
    out += '■ 이번주 업무\n';
    if (!items.length) out += '  (등록된 업무 없음)\n';
    items.forEach((it) => {
      out += `  - [${it.category || '-'}] ${it.title || ''} ${it.detail || ''} (예정일: ${it.dueDate || '-'}${it.note ? ', 비고: ' + it.note : ''})\n`;
    });
    out += '\n■ 이번 주 휴가자\n';
    if (!vac.length) out += '  (없음)\n';
    vac.forEach((v) => { out += `  - ${v.name || '-'} (${v.period || '-'})\n`; });
    return out;
  }
  const items = (state.trend[team.key] || { items: [] }).items;
  let out = `${team.label} 트렌드보고 - ${weekLabel(state.week)}\n\n`;
  if (!items.length) out += '(등록된 트렌드 없음)\n';
  items.forEach((t) => { out += `■ ${t.title || '(제목 없음)'}\n${t.content || ''}\n\n`; });
  return out;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function copyPreview(type) {
  const team = currentTeam();
  if (!team) return;
  try {
    await navigator.clipboard.writeText(previewToText(team, type));
    alert('복사되었습니다.');
  } catch (e) { alert('복사 실패: ' + e.message); }
}

function downloadPreview(type) {
  const team = currentTeam();
  if (!team) return;
  const label = type === 'work' ? '업무보고' : '트렌드보고';
  downloadText(`${team.label}_${label}_${state.week}.txt`, previewToText(team, type));
}

function printPreview(type) {
  window.print();
}

function printAllPreview(type) {
  const area = document.getElementById('printAllArea');
  area.innerHTML = state.teams.map((team) => `<div class="preview-card">${type === 'work' ? buildWorkPreviewHtml(team) : buildTrendPreviewHtml(team)}</div>`).join('');
  area.classList.add('active');
  window.print();
  setTimeout(() => { area.classList.remove('active'); area.innerHTML = ''; }, 500);
}

async function downloadAllTeams() {
  for (const team of state.teams) {
    downloadText(`${team.label}_${previewFileTag()}_${state.week}.txt`, previewToText(team, state.activeType));
    await new Promise((r) => setTimeout(r, 350));
  }
}
function previewFileTag() { return state.activeType === 'work' ? '업무보고' : '트렌드보고'; }

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
      <button class="btn-danger-icon" data-del>✕</button>
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
function wireTypeTabs() {
  document.querySelectorAll('.type-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      state.activeType = btn.dataset.tab;
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

function wireOrderModal() {
  document.getElementById('openOrderBtn').addEventListener('click', () => {
    renderOrderList();
    document.getElementById('orderModal').classList.remove('hidden');
  });
  document.getElementById('orderCloseBtn').addEventListener('click', () => {
    document.getElementById('orderModal').classList.add('hidden');
  });
}

function wireWorkPanel() {
  document.getElementById('addWorkItemBtn').addEventListener('click', () => {
    const team = currentTeam();
    if (!team) return;
    state.work[team.key].items.push({ category: '', dueDate: '', title: '', detail: '', note: '' });
    renderWorkEdit();
  });
  document.getElementById('addVacationBtn').addEventListener('click', () => {
    const team = currentTeam();
    if (!team) return;
    state.vacation[team.key].items.push({ name: '', period: '' });
    renderWorkEdit();
  });
  document.getElementById('loadPrevWorkBtn').addEventListener('click', loadPreviousWeekWork);
  document.getElementById('saveWorkBtn').addEventListener('click', saveCurrentWork);
  document.getElementById('resetTeamBtn').addEventListener('click', () => { if (confirm('저장하지 않은 변경사항을 취소하고 서버 데이터로 되돌립니다. 계속할까요?')) loadWeek(); });
  document.getElementById('refreshBtn').addEventListener('click', loadWeek);

  document.getElementById('copyWorkBtn').addEventListener('click', () => copyPreview('work'));
  document.getElementById('downloadWorkBtn').addEventListener('click', () => downloadPreview('work'));
  document.getElementById('printWorkBtn').addEventListener('click', () => printPreview('work'));
  document.getElementById('printAllWorkBtn').addEventListener('click', () => printAllPreview('work'));
}

function wireTrendPanel() {
  document.getElementById('addTrendItemBtn').addEventListener('click', () => {
    const team = currentTeam();
    if (!team) return;
    state.trend[team.key].items.push({ title: '', content: '', images: [] });
    renderTrendEdit();
  });
  document.getElementById('saveTrendBtn').addEventListener('click', saveCurrentTrend);
  document.getElementById('resetTrendBtn').addEventListener('click', () => { if (confirm('저장하지 않은 변경사항을 취소하고 서버 데이터로 되돌립니다. 계속할까요?')) loadWeek(); });
  document.getElementById('refreshTrendBtn').addEventListener('click', loadWeek);

  document.getElementById('copyTrendBtn').addEventListener('click', () => copyPreview('trend'));
  document.getElementById('downloadTrendBtn').addEventListener('click', () => downloadPreview('trend'));
  document.getElementById('printTrendBtn').addEventListener('click', () => printPreview('trend'));
  document.getElementById('printAllTrendBtn').addEventListener('click', () => printAllPreview('trend'));
}

function wireGlobalToolbar() {
  document.getElementById('downloadAllBtn').addEventListener('click', downloadAllTeams);
}

(function init() {
  if (!CFG.WORKER_BASE_URL || CFG.WORKER_BASE_URL.startsWith('여기에')) {
    alert('config.js에 Cloudflare Worker 주소/API_KEY를 먼저 설정해주세요.');
  }
  wireTypeTabs();
  wireWeekNav();
  wirePresent();
  wireOrderModal();
  wireWorkPanel();
  wireTrendPanel();
  wireGlobalToolbar();
  wireAdmin();
  loadWeek();
})();
