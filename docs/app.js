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

function toPlainDate(iso) {
  return (iso || '').replace(/-/g, '');
}
function toIsoDate(plain) {
  const digits = (plain || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}
function formatDueDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `~${Number(parts[1])}/${Number(parts[2])}`;
}

function weekOfMonthLabel(weekId) {
  const monday = weekIdToMonday(weekId);
  const year = monday.getUTCFullYear();
  const month = monday.getUTCMonth() + 1;
  // "1주차" = 그 달 1일이 속한 월~일 주(전달에서 넘어온 날짜가 섞여 있어도 그 주가 1주차).
  // 예: 2026-09-01(화)이 속한 주는 8/31(월)~9/6(일) -> 9월 1주차, 그 다음 9/7~9/13이 2주차.
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = (firstOfMonth.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  const firstWeekMonday = new Date(firstOfMonth);
  firstWeekMonday.setUTCDate(firstOfMonth.getUTCDate() - firstDow);
  const weekOfMonth = Math.round((monday - firstWeekMonday) / (7 * 86400000)) + 1;
  return `${year}년 ${month}월 ${weekOfMonth}주차`;
}

function weekLabel(weekId) {
  const monday = weekIdToMonday(weekId);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${weekOfMonthLabel(weekId)} (${fmt(monday)}~${fmt(sunday)})`;
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
  activeTrendAuthor: null,
  presentTeamFilter: null, // null = 전체 팀 포함, Set이면 그 안에 든 teamKey만 발표모드에 포함(2026-09-18: 2개 팀씩 묶어서 발표하는 경우 대비)
};
let workDragSrcIdx = null;
let adminSessionPassword = null; // 로그인 성공 시 세션 동안만 메모리 보관 (재입력 방지용)
// 페이지 열람 자체를 비밀번호로 막는다(2026-09-23 요청, "비밀번호 하나 있어야 되지 않을까?") —
// 이전엔 관리자(수정)만 비번이 있고 그냥 보는 건 누구나 가능했다. sessionStorage에 넣어서
// 브라우저 탭을 닫기 전까진 다시 안 물어보게 한다(관리자 비번은 탭 새로고침마다 다시 물어보는
// 기존 방식과 다르게, 매주 보는 화면이라 세션 동안은 유지되는 게 나을 것 같아 sessionStorage 씀).
let viewSessionPassword = sessionStorage.getItem('viewPw') || null;

// ---------------- API 호출 ----------------
async function apiGet(path) {
  const res = await fetch(API + path, { headers: { 'X-View-Password': viewSessionPassword || '' } });
  if (res.status === 401) { viewSessionPassword = null; sessionStorage.removeItem('viewPw'); showViewGate(); throw new Error('비밀번호가 만료되었습니다. 다시 입력해 주세요.'); }
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
  document.getElementById('weekLabel').textContent = weekOfMonthLabel(state.week);
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
      state.activeTrendAuthor = null;
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

  const groups = (state.work[team.key] || (state.work[team.key] = { items: [] })).items;
  groups.forEach((group, gIdx) => {
    group.tasks = group.tasks || [];
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-top">
        <span class="item-drag-handle" data-drag-handle title="드래그해서 순서 변경">⠿</span>
        <div class="field-group category-field"><label>카테고리</label><input placeholder="카테고리 작성" value="${escapeAttr(group.category)}" data-cat /></div>
        <button class="btn-danger-icon" data-del-group title="카테고리 삭제">✕</button>
      </div>
      <div class="task-list" data-tasks></div>
      <button class="btn btn-ghost btn-xs" data-add-task type="button">+ 세부 업무 추가</button>
    `;
    card.querySelector('[data-cat]').addEventListener('input', (e) => { group.category = e.target.value; renderWorkPreview(); });
    card.querySelector('[data-del-group]').addEventListener('click', () => {
      groups.splice(gIdx, 1);
      renderWorkEdit();
      renderWorkPreview();
    });
    card.querySelector('[data-add-task]').addEventListener('click', () => {
      group.tasks.push({ title: '', detail: '', dueDate: '', ongoing: false });
      renderWorkEdit();
      renderWorkPreview();
    });

    const tasksWrap = card.querySelector('[data-tasks]');
    group.tasks.forEach((task, tIdx) => {
      const block = document.createElement('div');
      block.className = 'task-block';
      block.innerHTML = `
        <div class="task-block-top">
          <span class="task-block-label">업무 ${tIdx + 1}</span>
          <button class="btn-danger-icon" data-del-task title="이 업무 삭제">✕</button>
        </div>
        <div class="field-row task-title-row">
          <div class="field-group"><label>업무 제목</label><input placeholder="업무 제목 작성" value="${escapeAttr(task.title)}" data-f="title" /></div>
          <div class="field-group">
            <label>완료예정일</label>
            <div class="due-date-row">
              <input type="text" inputmode="numeric" maxlength="8" placeholder="YYYYMMDD" value="${escapeAttr(toPlainDate(task.dueDate))}" data-f="dueDate" data-date-input ${task.ongoing ? 'disabled' : ''} />
              <button class="btn btn-toggle btn-xs ${task.ongoing ? 'active' : ''}" data-toggle-ongoing type="button">계속</button>
            </div>
          </div>
        </div>
        <div class="field-row">
          <div class="field-group full">
            <label>상세내용</label>
            <div class="rich-toolbar rich-toolbar-sm">
              <button type="button" class="rich-btn" data-cmd="bold" title="굵게"><b>B</b></button>
              <button type="button" class="rich-color-btn" data-color="#171717" title="검정" style="--dot:#171717"></button>
              <button type="button" class="rich-color-btn" data-color="#FF571F" title="포인트색" style="--dot:#FF571F"></button>
              <button type="button" class="rich-highlight-btn" data-highlight="#FFF3A0" title="하이라이트" style="--dot:#FFF3A0"></button>
              <button type="button" class="rich-btn" data-cmd="removeFormat" title="서식 지우기">지우기</button>
            </div>
            <div class="rich-editable rich-editable-sm" contenteditable="true" data-placeholder="업무 상세내용 작성" data-f="detail"></div>
          </div>
        </div>
      `;
      block.querySelectorAll('[data-f]').forEach((el) => {
        if (el.dataset.f === 'dueDate') {
          el.addEventListener('input', () => {
            el.value = el.value.replace(/\D/g, '').slice(0, 8);
            task.dueDate = toIsoDate(el.value);
            renderWorkPreview();
          });
        } else if (el.dataset.f === 'detail') {
          // 업무 상세내용도 하이라이트를 넣을 수 있게 트렌드 내용과 같은 방식(contenteditable +
          // 정제)으로 바꿨다(2026-09-23 "업무내용에 하이라이트 치게 가능한가" 요청). 예전엔
          // <textarea>라 줄바꿈이 그냥 문자 "\n"으로 저장돼 있었는데, HTML로 취급하는 이 칸은
          // "\n"을 줄바꿈으로 안 쳐줘서 예전 글이 한 줄로 붙어버리는 문제가 있었다(2026-09-23
          // 실측, "이전에 작성한 글 엔터가 안먹혀") -- 처음 불러올 때만 "\n"을 <br>로 바꿔준다
          // (새로 입력한 내용은 sanitizeRichContent가 이미 <br>로 저장해서 중복 변환 안 됨).
          el.innerHTML = (task.detail || '').replace(/\n/g, '<br>');
          el.oninput = () => { task.detail = sanitizeRichContent(el); renderWorkPreview(); };
          el.onblur = () => { el.innerHTML = task.detail; };
          wireRichToolbar(el);
        } else {
          el.addEventListener('input', () => { task[el.dataset.f] = el.value; renderWorkPreview(); });
        }
      });
      block.querySelector('[data-del-task]').addEventListener('click', () => {
        group.tasks.splice(tIdx, 1);
        renderWorkEdit();
        renderWorkPreview();
      });
      block.querySelector('[data-toggle-ongoing]').addEventListener('click', () => {
        task.ongoing = !task.ongoing;
        if (task.ongoing) task.dueDate = '';
        renderWorkEdit();
        renderWorkPreview();
      });
      tasksWrap.appendChild(block);
    });

    const handle = card.querySelector('[data-drag-handle]');
    handle.addEventListener('mousedown', () => { card.draggable = true; });
    card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('dragging'); });
    card.addEventListener('dragstart', (e) => {
      workDragSrcIdx = gIdx;
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => { card.classList.remove('drag-over'); });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (workDragSrcIdx === null || workDragSrcIdx === gIdx) return;
      const [moved] = groups.splice(workDragSrcIdx, 1);
      groups.splice(gIdx, 0, moved);
      workDragSrcIdx = null;
      renderWorkEdit();
      renderWorkPreview();
    });
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
      el.addEventListener('input', () => { vacItems[idx][el.dataset.f] = el.value; renderWorkPreview(); });
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      vacItems.splice(idx, 1);
      renderWorkEdit();
      renderWorkPreview();
    });
    vacWrap.appendChild(row);
  });
}

function buildWorkPreviewHtml(team) {
  const groups = (state.work[team.key] || { items: [] }).items;
  const vacItems = (state.vacation[team.key] || { items: [] }).items;
  const hasAny = groups.some((g) => (g.tasks || []).length) || vacItems.length > 0;

  let body = '';
  if (!hasAny) {
    body = '<p class="preview-empty">작성된 내용이 없습니다.</p>';
  } else {
    if (groups.some((g) => (g.tasks || []).length)) {
      body += '<div class="preview-block"><p class="preview-block-title">이번주 업무</p>';
      body += groups.filter((g) => (g.tasks || []).length).map((g) => `
        <div class="preview-work-group">
          <div class="preview-work-groupchip"><span class="preview-chip">${escapeHtml(g.category || '-')}</span></div>
          <div class="preview-work-tasks">
            ${(g.tasks || []).map((it) => `
              <div class="preview-work-item">
                <div class="preview-work-titleline">
                  <span class="preview-work-title">${escapeHtml(it.title || '(제목 없음)')}</span>
                  <span class="due">${it.ongoing ? '계속' : formatDueDate(it.dueDate)}</span>
                </div>
                ${it.detail ? `<p class="preview-work-detail">${it.detail}</p>` : ''}
              </div>`).join('')}
          </div>
        </div>`).join('');
      body += '</div>';
    }
    if (vacItems.length) {
      body += '<div class="preview-block"><p class="preview-block-title">이번 주 휴가자</p>';
      body += vacItems.map((it) => `<p class="preview-vac-line">${escapeHtml(it.name || '-')} (${escapeHtml(it.period || '-')})</p>`).join('');
      body += '</div>';
    }
  }

  return `
    <p class="print-dept-header">리테일기획부 주간업무</p>
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
function findOrCreateTrendItem(team, authorName) {
  const items = (state.trend[team.key] || (state.trend[team.key] = { items: [] })).items;
  let item = items.find((it) => it.author === authorName);
  if (!item) {
    item = { author: authorName, title: '', content: '', images: [], layout: 'row' };
    items.push(item);
  }
  return item;
}

function renderTrendEdit() {
  const team = currentTeam();
  const tabsWrap = document.getElementById('trendPersonTabs');
  const authorLine = document.getElementById('trendAuthorLine');
  const noMemberHint = document.getElementById('trendNoMemberHint');
  const editBody = document.getElementById('trendEditBody');
  tabsWrap.innerHTML = '';
  if (!team) return;

  const members = team.members || [];
  if (!members.length) {
    noMemberHint.classList.remove('hidden');
    editBody.classList.add('hidden');
    authorLine.textContent = '';
    return;
  }
  noMemberHint.classList.add('hidden');
  editBody.classList.remove('hidden');

  if (!state.activeTrendAuthor || !members.includes(state.activeTrendAuthor)) {
    state.activeTrendAuthor = members[0];
  }

  members.forEach((name) => {
    const btn = document.createElement('button');
    btn.className = 'person-tab-btn' + (name === state.activeTrendAuthor ? ' active' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => {
      state.activeTrendAuthor = name;
      renderTrendEdit();
      renderTrendPreview();
    });
    tabsWrap.appendChild(btn);
  });

  const item = findOrCreateTrendItem(team, state.activeTrendAuthor);
  authorLine.innerHTML = `작성자 <b>${escapeHtml(item.author)}</b>님의 트렌드보고`;

  editBody.querySelectorAll('[data-layout]').forEach((btn) => {
    btn.classList.toggle('active', (item.layout || 'row') === btn.dataset.layout);
    btn.onclick = () => { item.layout = btn.dataset.layout; renderTrendEdit(); renderTrendPreview(); };
  });

  const titleInput = document.getElementById('trendTitleInput');
  titleInput.value = item.title || '';
  titleInput.oninput = () => { item.title = titleInput.value; renderTrendPreview(); };

  const contentInput = document.getElementById('trendContentInput');
  contentInput.innerHTML = item.content || '';
  // sanitizeRichContent는 DOM을 읽기만 하고 건드리지 않으므로, 타이핑 중(input)마다
  // 바로 정제해서 item.content에 반영해도 커서 위치가 안 튄다 -- blur 시점까지 기다리면
  // (예전 방식) 저장 버튼 클릭 타이밍에 따라 정제 전 raw HTML(줄바꿈 div, 잡다한 스타일
  // 포함)이 그대로 저장되는 문제가 있었다(2026-09-18).
  contentInput.oninput = () => { item.content = sanitizeRichContent(contentInput); renderTrendPreview(); };
  contentInput.onblur = () => { contentInput.innerHTML = item.content; };
  wireRichToolbar(contentInput);

  renderTrendImages(item);
}

function renderTrendImages(item) {
  const grid = document.getElementById('trendImagesGrid');
  grid.innerHTML = '';
  (item.images || []).forEach((src, i) => {
    const box = document.createElement('div');
    box.className = 'trend-img-box';
    box.innerHTML = `<img src="${src}" /><button class="trend-img-remove" type="button">✕</button>`;
    box.querySelector('button').addEventListener('click', () => {
      item.images.splice(i, 1);
      renderTrendImages(item);
      renderTrendPreview();
    });
    grid.appendChild(box);
  });
  const addBox = document.createElement('label');
  addBox.className = 'trend-img-add';
  addBox.innerHTML = `🖼 이미지 추가<input type="file" accept="image/*" multiple hidden />`;
  addBox.querySelector('input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      try {
        const dataUrl = await compressImage(f);
        item.images = item.images || [];
        item.images.push(dataUrl);
      } catch (err) { alert('이미지 처리 실패: ' + err.message); }
    }
    renderTrendImages(item);
    renderTrendPreview();
  });
  grid.appendChild(addBox);
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

function buildTrendPreviewHtml(team, authorFilter) {
  const allItems = (state.trend[team.key] || { items: [] }).items;
  const members = team.members || [];
  let ordered = members.length
    ? members.map((m) => allItems.find((it) => it.author === m)).filter(Boolean)
    : allItems;
  // authorFilter가 있으면(=편집 패널 옆 실시간 미리보기) 지금 선택된 팀원 것만 보여준다 --
  // 없으면(=팀별로 각각 인쇄 등 전체보기) 팀 전체 팀원을 다 합쳐서 보여준다.
  if (authorFilter) ordered = ordered.filter((t) => t.author === authorFilter);
  const hasContent = ordered.some((t) => t.title || t.content || (t.images || []).length);

  let body = '<p class="preview-empty">작성된 내용이 없습니다.</p>';
  if (hasContent) {
    body = ordered.filter((t) => t.title || t.content || (t.images || []).length).map((t) => {
      const imgsHtml = (t.images || []).map((src) => `<img src="${src}" />`).join('');
      const layoutClass = t.layout === 'col' ? 'preview-trend-col' : 'preview-trend-row';
      return `
        <div class="preview-trend-item">
          <p class="preview-trend-title">${escapeHtml(t.title || '(제목 없음)')}</p>
          <div class="preview-trend-body ${layoutClass}">
            ${imgsHtml ? `<div class="preview-trend-imgs">${imgsHtml}</div>` : ''}
            <p class="preview-trend-content">${t.content || ''}</p>
          </div>
        </div>`;
    }).join('');
  }
  return `
    <div class="preview-title-row">
      <h2 class="preview-title">${escapeHtml(team.label)} 트렌드보고</h2>
      <span class="print-dept-header">${escapeHtml(state.activeTrendAuthor || '')}</span>
    </div>
    <p class="preview-subtitle">${escapeHtml(weekLabel(state.week))}</p>
    <hr class="preview-divider" />
    ${body}
  `;
}

function renderTrendPreview() {
  const team = currentTeam();
  const el = document.getElementById('trendPreview');
  if (!team) { el.innerHTML = ''; return; }
  el.innerHTML = buildTrendPreviewHtml(team, state.activeTrendAuthor);
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
    renderWorkPreview();
  } catch (e) { alert('저번주 업무를 불러오지 못했습니다: ' + e.message); }
}

// ---------------- 발표 순서 (업무보고: 팀 단위 / 트렌드보고: 팀원 단위) ----------------
let activeOrderType = 'work';

function defaultWorkOrder() { return state.teams.map((t) => t.key); }

// 트렌드보고 순서는 "팀 순서" + "그 팀 안에서의 팀원 순서" 2단계 구조다 --
// [{teamKey, members:[이름, ...]}, ...] -- 팀 블록 자체의 위치를 옮기면 그 팀에 속한
// 팀원 전체가 같이 움직이고, 팀원 순서는 같은 팀 블록 안에서만 바뀐다(다른 팀으로 못 넘어감).
function ensureOrderShape() {
  if (!state.order || Array.isArray(state.order)) state.order = {};
  if (!Array.isArray(state.order.work) || !state.order.work.length) state.order.work = defaultWorkOrder();

  // 예전 형식(문자열 "팀key::이름" 낱개 배열)이거나 비어있으면 팀 블록 구조로 새로 만든다.
  const isBlockShape = Array.isArray(state.order.trend)
    && state.order.trend.every((b) => b && typeof b === 'object' && Array.isArray(b.members));
  const existing = isBlockShape ? state.order.trend : [];
  const byTeam = new Map(existing.map((b) => [b.teamKey, b]));

  // 팀 블록 순서: 기존에 저장된 팀 순서를 최대한 유지하고, 새로 생긴 팀만 뒤에 붙인다.
  const orderedTeamKeys = [
    ...existing.map((b) => b.teamKey).filter((k) => state.teams.some((t) => t.key === k)),
    ...state.teams.map((t) => t.key).filter((k) => !byTeam.has(k)),
  ];

  state.order.trend = orderedTeamKeys.map((teamKey) => {
    const team = state.teams.find((t) => t.key === teamKey);
    const currentMembers = (team && team.members) || [];
    const prevMembers = (byTeam.get(teamKey) || {}).members || [];
    const kept = prevMembers.filter((m) => currentMembers.includes(m));
    const added = currentMembers.filter((m) => !kept.includes(m));
    return { teamKey, members: [...kept, ...added] };
  });
}

// 발표 대상 팀 다중선택 -- 매주 전체 팀이 아니라 2개 팀씩 묶어서 발표하는 경우가 있어서
// (2026-09-18) 추가. null이면 "전체 포함"으로 취급하고, 체크를 하나라도 해제하는 순간부터
// Set을 만들어 그 안에 든 팀만 발표모드에 포함시킨다. 서버에 저장하지 않는 이 세션 한정
// 설정이다(매주/매 발표마다 묶음이 달라질 수 있어서).
function isTeamIncluded(teamKey) {
  return !state.presentTeamFilter || state.presentTeamFilter.has(teamKey);
}
function toggleTeamIncluded(teamKey) {
  if (!state.presentTeamFilter) state.presentTeamFilter = new Set(state.teams.map((t) => t.key));
  if (state.presentTeamFilter.has(teamKey)) state.presentTeamFilter.delete(teamKey);
  else state.presentTeamFilter.add(teamKey);
}

function renderOrderList() {
  ensureOrderShape();
  const wrap = document.getElementById('orderList');
  wrap.innerHTML = '';

  if (activeOrderType === 'work') {
    const order = state.order.work;
    order.forEach((teamKey, idx) => {
      const team = state.teams.find((t) => t.key === teamKey);
      if (!team) return;
      const el = document.createElement('div');
      el.className = 'order-item';
      el.innerHTML = `
        <label class="order-item-name order-checkbox-label">
          <input type="checkbox" data-include ${isTeamIncluded(teamKey) ? 'checked' : ''} />
          ${idx + 1}. ${escapeHtml(team.label)}
        </label>
        <span class="order-item-btns">
          <button class="btn btn-outline btn-xs" data-up>▲</button>
          <button class="btn btn-outline btn-xs" data-down>▼</button>
        </span>
      `;
      el.querySelector('[data-include]').addEventListener('change', () => {
        toggleTeamIncluded(teamKey);
      });
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
  } else {
    const blocks = state.order.trend;
    blocks.forEach((block, bIdx) => {
      const team = state.teams.find((t) => t.key === block.teamKey);
      if (!team) return;

      const groupEl = document.createElement('div');
      groupEl.className = 'order-team-group';
      groupEl.innerHTML = `
        <div class="order-item order-team-header">
          <label class="order-item-name order-checkbox-label">
            <input type="checkbox" data-include ${isTeamIncluded(block.teamKey) ? 'checked' : ''} />
            ${bIdx + 1}. ${escapeHtml(team.label)}
          </label>
          <span class="order-item-btns">
            <button class="btn btn-outline btn-xs" data-team-up>▲</button>
            <button class="btn btn-outline btn-xs" data-team-down>▼</button>
          </span>
        </div>
        <div class="order-member-list"></div>
      `;
      groupEl.querySelector('[data-include]').addEventListener('change', () => {
        toggleTeamIncluded(block.teamKey);
      });
      groupEl.querySelector('[data-team-up]').addEventListener('click', () => {
        if (bIdx === 0) return;
        [blocks[bIdx - 1], blocks[bIdx]] = [blocks[bIdx], blocks[bIdx - 1]];
        renderOrderList();
        saveOrder();
      });
      groupEl.querySelector('[data-team-down]').addEventListener('click', () => {
        if (bIdx === blocks.length - 1) return;
        [blocks[bIdx + 1], blocks[bIdx]] = [blocks[bIdx], blocks[bIdx + 1]];
        renderOrderList();
        saveOrder();
      });

      const memberWrap = groupEl.querySelector('.order-member-list');
      block.members.forEach((member, mIdx) => {
        const memberEl = document.createElement('div');
        memberEl.className = 'order-item order-member-item';
        memberEl.innerHTML = `
          <span class="order-item-name">${mIdx + 1}. ${escapeHtml(member)}</span>
          <span class="order-item-btns">
            <button class="btn btn-outline btn-xs" data-m-up>▲</button>
            <button class="btn btn-outline btn-xs" data-m-down>▼</button>
          </span>
        `;
        memberEl.querySelector('[data-m-up]').addEventListener('click', () => {
          if (mIdx === 0) return;
          [block.members[mIdx - 1], block.members[mIdx]] = [block.members[mIdx], block.members[mIdx - 1]];
          renderOrderList();
          saveOrder();
        });
        memberEl.querySelector('[data-m-down]').addEventListener('click', () => {
          if (mIdx === block.members.length - 1) return;
          [block.members[mIdx + 1], block.members[mIdx]] = [block.members[mIdx], block.members[mIdx + 1]];
          renderOrderList();
          saveOrder();
        });
        memberWrap.appendChild(memberEl);
      });

      wrap.appendChild(groupEl);
    });
  }
}

async function saveOrder() {
  try {
    await apiWrite('/api/order', 'PUT', { week: state.week, order: state.order });
  } catch (e) { alert('발표순서 저장 실패: ' + e.message); }
}

// ---------------- 발표모드 ----------------
let presentIdx = 0;

// 발표모드는 A4 가로 한 장 분량으로 고정된 화면이라, 업무 항목이 많으면 한 페이지에
// 다 안 들어간다. 정확한 픽셀 측정(DOM 렌더 후 높이 재기) 대신 페이지당 최대 업무
// 개수를 고정해서 나누는 단순한 방식을 쓴다 -- 상세내용이 길면 가끔 여유가 빡빡할 수
// 있지만, 측정 기반보다 훨씬 안정적이고 유지보수하기 쉽다.
const MAX_WORK_ROWS_PER_PAGE = 7;

function flattenWorkRows(workGroups) {
  const rows = [];
  workGroups.filter((g) => (g.tasks || []).length).forEach((g, gi) => {
    (g.tasks || []).forEach((task) => { rows.push({ groupIdx: gi, category: g.category, task }); });
  });
  return rows;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function withPageRowspans(pageRows) {
  const result = [];
  let i = 0;
  while (i < pageRows.length) {
    const gi = pageRows[i].groupIdx;
    let count = 1;
    while (i + count < pageRows.length && pageRows[i + count].groupIdx === gi) count++;
    for (let k = 0; k < count; k++) {
      result.push({ task: pageRows[i + k].task, category: pageRows[i].category, rowspan: k === 0 ? count : 0 });
    }
    i += count;
  }
  return result;
}

function buildPresentSlides() {
  ensureOrderShape();
  const slides = [];

  state.order.work.forEach((teamKey) => {
    if (!isTeamIncluded(teamKey)) return;
    const team = state.teams.find((t) => t.key === teamKey);
    if (!team) return;
    const workGroups = (state.work[teamKey] || { items: [] }).items;
    const vacation = (state.vacation[teamKey] || { items: [] }).items;

    const flatRows = flattenWorkRows(workGroups);
    if (!flatRows.length && !vacation.length) return;
    const pages = flatRows.length ? chunkArray(flatRows, MAX_WORK_ROWS_PER_PAGE) : [[]];
    pages.forEach((pageRows, pi) => {
      const isLastPage = pi === pages.length - 1;
      slides.push({
        type: 'work', team,
        rows: withPageRowspans(pageRows),
        vacation: isLastPage ? vacation : [],
        showVacation: isLastPage,
        pageLabel: pages.length > 1 ? ` (${pi + 1}/${pages.length})` : '',
      });
    });
  });

  // 트렌드보고는 팀 단위가 아니라 팀원(발표자) 단위로 순서를 따로 정할 수 있어야 한다는
  // 요청(2026-09-18)에 따라, 팀별로 묶어서 한 슬라이드에 여러 명을 보여주던 방식에서
  // "발표자 1명 = 슬라이드 1장"으로 바꿨다 -- order.trend에 담긴 "팀key::이름" 순서 그대로.
  state.order.trend.forEach((block) => {
    if (!isTeamIncluded(block.teamKey)) return;
    const team = state.teams.find((t) => t.key === block.teamKey);
    if (!team) return;
    const items = (state.trend[block.teamKey] || { items: [] }).items;
    block.members.forEach((member) => {
      const entry = items.find((it) => it.author === member);
      if (!entry) return;
      if (!(entry.title || entry.content || (entry.images || []).length)) return;
      slides.push({ type: 'trend', team, member, trend: [entry] });
    });
  });

  return slides;
}

function renderPresentDots(slides) {
  const wrap = document.getElementById('presentDots');
  wrap.innerHTML = '';
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'present-dot' + (i === presentIdx ? ' active' : '');
    dot.addEventListener('click', () => { presentIdx = i; renderPresentSlide(); });
    wrap.appendChild(dot);
  });
}

function renderPresentSlide() {
  const slides = buildPresentSlides();
  if (slides.length === 0) return;
  presentIdx = (presentIdx + slides.length) % slides.length;
  const s = slides[presentIdx];
  document.getElementById('presentPageNum').textContent = presentIdx + 1;
  document.getElementById('presentPageTotal').textContent = slides.length;
  document.getElementById('presentWeekLabel').textContent = weekOfMonthLabel(state.week);
  renderPresentDots(slides);

  if (s.type === 'work') {
    const workRowsHtml = s.rows.map((r) => `
          <tr class="${r.rowspan ? 'group-start' : ''}">
            ${r.rowspan ? `<td class="col-category" rowspan="${r.rowspan}"><span class="preview-chip">${escapeHtml(r.category || '-')}</span></td>` : ''}
            <td>
              <span class="present-work-title">${escapeHtml(r.task.title || '(제목 없음)')}</span>
              ${r.task.detail ? `<p class="present-work-detail">${r.task.detail}</p>` : ''}
            </td>
            <td class="col-date">${r.task.ongoing ? '계속 진행' : (formatDueDate(r.task.dueDate) ? formatDueDate(r.task.dueDate).replace('~', '') : '-')}</td>
          </tr>`).join('');

    const workHtml = s.rows.length
      ? `<table class="present-work-table">
          <thead><tr><th class="col-category">카테고리</th><th class="col-task">업무</th><th class="col-date">진행날짜</th></tr></thead>
          <tbody>${workRowsHtml}</tbody>
        </table>`
      : '<p class="present-empty-note">등록된 업무보고가 없습니다.</p>';

    const vacHtml = !s.showVacation ? '' : (s.vacation.length
      ? `<div class="present-vac-line"><span class="label">이번 주 휴가자</span><span class="val">${s.vacation.map((v) => `${escapeHtml(v.name || '-')} (${escapeHtml(v.period || '-')})`).join(', ')}</span></div>`
      : `<div class="present-vac-line"><span class="label">이번 주 휴가자</span><span class="val">없음</span></div>`);

    document.getElementById('presentSlide').innerHTML = `
      <h2>${escapeHtml(s.team.label)} 주간업무 보고${escapeHtml(s.pageLabel || '')}</h2>
      <hr class="present-divider" />
      ${workHtml}
      ${vacHtml}
    `;
  } else {
    const t = s.trend[0] || {};
    const layoutClass = t.layout === 'col' ? 'present-trend-col' : 'present-trend-row';
    const imgsHtml = (t.images || []).map((src) => `<img src="${src}" />`).join('');

    document.getElementById('presentSlide').innerHTML = `
      <div class="present-trend-header">
        <h2>${escapeHtml(s.team.label)} 트렌드보고</h2>
        <span class="present-trend-meta">${escapeHtml(s.team.label)} · ${escapeHtml(s.member || '')}</span>
      </div>
      <hr class="present-divider" />
      <div class="present-trend-scroll">
        <p class="present-trend-title-text">${escapeHtml(t.title || '(제목 없음)')}</p>
        <div class="present-trend-body ${layoutClass}">
          ${imgsHtml ? `<div class="present-trend-imgs">${imgsHtml}</div>` : ''}
          <p class="present-trend-content-text">${t.content || ''}</p>
        </div>
      </div>
    `;
  }
}

function startPresent() {
  presentIdx = 0;
  renderPresentSlide();
  document.getElementById('presentOverlay').classList.remove('hidden');
}
function exitPresent() {
  document.getElementById('presentOverlay').classList.add('hidden');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

// ---------------- 복사 / 다운로드 / 인쇄 ----------------
function previewToText(team, type) {
  if (type === 'work') {
    const groups = (state.work[team.key] || { items: [] }).items;
    const vac = (state.vacation[team.key] || { items: [] }).items;
    let out = `${team.label} 주간업무 보고 - ${weekLabel(state.week)}\n\n`;
    out += '■ 이번주 업무\n';
    const hasTasks = groups.some((g) => (g.tasks || []).length);
    if (!hasTasks) out += '  (등록된 업무 없음)\n';
    groups.forEach((g) => {
      (g.tasks || []).forEach((it) => {
        const due = it.ongoing ? '계속' : (it.dueDate || '-');
        out += `  - [${g.category || '-'}] ${it.title || ''} ${richToPlainText(it.detail)} (예정일: ${due})\n`;
      });
    });
    out += '\n■ 이번 주 휴가자\n';
    if (!vac.length) out += '  (없음)\n';
    vac.forEach((v) => { out += `  - ${v.name || '-'} (${v.period || '-'})\n`; });
    return out;
  }
  const items = (state.trend[team.key] || { items: [] }).items;
  let out = `${team.label} 트렌드보고 - ${weekLabel(state.week)}\n\n`;
  if (!items.length) out += '(등록된 트렌드 없음)\n';
  items.forEach((t) => { out += `■ ${t.author ? t.author + ' - ' : ''}${t.title || '(제목 없음)'}\n${richToPlainText(t.content)}\n\n`; });
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

// 브라우저 인쇄 대화상자의 "머리글/바닥글" 옵션이 켜져 있으면 문서 제목("리테일기획부
// 주간업무")이 각 페이지 상단에 자동으로 찍힌다 -- 우리 쪽 CSS로는 손댈 수 없는 브라우저
// 자체 영역이라, 인쇄하는 순간만 document.title을 비워서 그 문구가 안 뜨게 우회한다.
function withBlankTitle(fn) {
  const orig = document.title;
  document.title = '';
  fn();
  document.title = orig;
}

function printPreview(type) {
  withBlankTitle(() => window.print());
}

function printAllPreview(type) {
  const area = document.getElementById('printAllArea');
  area.innerHTML = state.teams.map((team) => `<div class="preview-card">${type === 'work' ? buildWorkPreviewHtml(team) : buildTrendPreviewHtml(team)}</div>`).join('');
  area.classList.add('active');
  withBlankTitle(() => window.print());
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
      <input value="${escapeAttr(team.label)}" placeholder="팀 이름" data-f="label" style="flex:1" />
      <input value="${escapeAttr((team.members || []).join(', '))}" placeholder="팀원(쉼표로 구분)" data-f="members" style="flex:2" />
      <button class="btn-danger-icon" data-del>✕</button>
    `;
    row.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('input', () => {
        if (el.dataset.f === 'members') {
          team.members = el.value.split(',').map((s) => s.trim()).filter(Boolean);
        } else {
          team[el.dataset.f] = el.value;
        }
      });
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
    state.teams.push({ key: '', label: '', members: [] });
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

  document.getElementById('viewChangePasswordBtn').addEventListener('click', async () => {
    const p1 = document.getElementById('viewNewPassword1').value;
    const p2 = document.getElementById('viewNewPassword2').value;
    const msg = document.getElementById('viewActionMsg');
    if (!p1 || p1 !== p2) { msg.textContent = '새 비밀번호가 일치하지 않습니다.'; return; }
    try {
      await apiWrite('/api/view/password', 'PUT', { oldPassword: viewSessionPassword, newPassword: p1 });
      viewSessionPassword = p1;
      sessionStorage.setItem('viewPw', p1);
      msg.textContent = '열람 비밀번호가 변경되었습니다. 다른 팀원들에게 새 비밀번호를 알려주세요.';
    } catch (e) { msg.textContent = '변경 실패: ' + e.message; }
  });
}

// ---------------- 트렌드 내용 서식(굵게/색상) ----------------
// contenteditable에서 나오는 HTML은 브라우저/붙여넣기에 따라 지저분할 수 있어(중첩 div,
// 임의 style, 붙여넣은 이미지/스크립트 등) 그대로 저장하면 안전하지 않다 -- 굵게(b)와
// 글자색(span의 color만) 딱 두 가지만 허용하고 나머지 태그는 벗겨서 텍스트/줄바꿈만 남긴다.
// 타이핑 중(매 입력마다)이 아니라 blur(포커스 벗어날 때) 시점에만 정제해서 커서 위치가
// 안 튀게 한다.
function sanitizeRichContent(root) {
  function walk(node) {
    let out = '';
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += escapeHtml(child.textContent);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          out += '<br>';
        } else if (tag === 'b' || tag === 'strong') {
          out += `<b>${walk(child)}</b>`;
        } else if (tag === 'span' || tag === 'font') {
          const color = (child.style && child.style.color) || child.getAttribute('color');
          // 하이라이트(형광펜, 2026-09-23 "업무내용에 하이라이트 치게 가능한가" 요청)도 글자색과
          // 같은 span에 얹혀서 올 수 있어(둘 다 선택한 뒤 순서대로 적용하면) 같이 허용한다.
          const bg = child.style && child.style.backgroundColor;
          const inner = walk(child);
          const styles = [];
          if (color) styles.push(`color:${color}`);
          if (bg) styles.push(`background-color:${bg}`);
          out += styles.length ? `<span style="${styles.join(';')}">${inner}</span>` : inner;
        } else if (tag === 'div' || tag === 'p') {
          // 컨텐트에디터블은 첫 줄만 루트에 맨 텍스트로 두고, 엔터로 나뉜 그 다음 줄부터
          // <div>로 감싸는 경우가 많다(크롬/엣지 공통) -- 그래서 div 앞에 줄바꿈이 이미
          // 있는지가 아니라 "이 div 앞에 뭔가 내용이 있었는지"로 판단해서 줄바꿈을 넣어야
          // 첫 줄과 둘째 줄이 안 붙는다. 뒤에 또 붙이면(기존 방식) 마지막에 빈 줄이
          // 계속 쌓여서 아래 trailing-<br> 정리로 따로 걷어낸다.
          if (out !== '') out += '<br>';
          out += walk(child);
        } else {
          out += walk(child);
        }
      }
    });
    return out;
  }
  let html = walk(root);
  html = html.replace(/(<br>)+$/g, ''); // 맨 끝 빈 줄들 정리
  return html;
}

// execCommand는 브라우저에 따라 <font color>처럼 정제 로직이 못 알아보는 형태로 결과물을
// 만들 때가 있어(2026-09-18, 색상이 미리보기에 반영 안 되던 문제) -- 직접 선택영역을
// <span style="color:...">/<b>로 감싸서 결과 HTML 구조를 확실히 통제한다.
function applyInlineWrap(makeWrapper) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const wrapper = makeWrapper();
  try {
    range.surroundContents(wrapper);
  } catch (e) {
    // 선택 영역이 여러 태그에 걸쳐 있으면 surroundContents가 실패한다(표준 제약) --
    // 그럴 땐 선택된 내용을 통째로 꺼내 새 wrapper 안에 넣는 방식으로 우회한다.
    const frag = range.extractContents();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
  }
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(wrapper);
  sel.addRange(newRange);
  return true;
}

function wireRichToolbar(contentInput) {
  const toolbar = contentInput.previousElementSibling;
  if (!toolbar || !toolbar.classList.contains('rich-toolbar')) return;
  toolbar.querySelectorAll('[data-cmd="bold"]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault(); // 클릭해도 에디터 포커스/선택영역이 안 풀리게
    btn.onclick = () => {
      if (!applyInlineWrap(() => document.createElement('b'))) { alert('먼저 굵게 처리할 글자를 드래그해서 선택해주세요.'); return; }
      contentInput.dispatchEvent(new Event('input'));
    };
  });
  toolbar.querySelectorAll('[data-cmd="removeFormat"]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { alert('먼저 서식을 지울 글자를 드래그해서 선택해주세요.'); return; }
      const range = sel.getRangeAt(0);
      const text = range.toString();
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      // 선택 범위가 서식 태그(굵게/색/하이라이트) "안쪽"이었으면(예: 하이라이트된 글자만 선택)
      // 그 태그는 내용만 비워진 채 빈 껍데기로 남아서, 방금 다시 넣은 글자를 도로 감싸버리는
      // 문제가 있었다(2026-09-23 실측, "지우기가 안먹히는데") -- 남은 빈 서식 태그를 마저 풀어준다.
      let wrapper = textNode.parentElement;
      while (wrapper && wrapper !== contentInput && (wrapper.tagName === 'B' || wrapper.tagName === 'SPAN')) {
        const parent = wrapper.parentElement;
        while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
        parent.removeChild(wrapper);
        wrapper = textNode.parentElement;
      }
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(textNode);
      sel.addRange(newRange);
      contentInput.dispatchEvent(new Event('input'));
    };
  });
  toolbar.querySelectorAll('[data-color]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      const ok = applyInlineWrap(() => {
        const span = document.createElement('span');
        span.style.color = btn.dataset.color;
        return span;
      });
      if (!ok) { alert('먼저 색을 바꿀 글자를 드래그해서 선택해주세요.'); return; }
      contentInput.dispatchEvent(new Event('input'));
    };
  });
  // 하이라이트(형광펜, 2026-09-23 "발표할 때 주요 내용에 하이라이트" 요청) — 색상 버튼과 같은
  // applyInlineWrap 방식이지만 글자색이 아니라 배경색을 입힌다.
  toolbar.querySelectorAll('[data-highlight]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      const ok = applyInlineWrap(() => {
        const span = document.createElement('span');
        span.style.backgroundColor = btn.dataset.highlight;
        return span;
      });
      if (!ok) { alert('먼저 하이라이트할 글자를 드래그해서 선택해주세요.'); return; }
      contentInput.dispatchEvent(new Event('input'));
    };
  });
}

function richToPlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n');
  return div.textContent || '';
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
  document.getElementById('presentFullscreenBtn').addEventListener('click', toggleFullscreen);
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
    activeOrderType = 'work';
    document.querySelectorAll('.order-type-btn').forEach((b) => b.classList.toggle('active', b.dataset.orderType === 'work'));
    renderOrderList();
    document.getElementById('orderModal').classList.remove('hidden');
  });
  document.getElementById('orderCloseBtn').addEventListener('click', () => {
    document.getElementById('orderModal').classList.add('hidden');
  });
  document.querySelectorAll('.order-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeOrderType = btn.dataset.orderType;
      document.querySelectorAll('.order-type-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderOrderList();
    });
  });
}

function wireWorkPanel() {
  document.getElementById('addWorkItemBtn').addEventListener('click', () => {
    const team = currentTeam();
    if (!team) return;
    state.work[team.key].items.push({ category: '', tasks: [{ title: '', detail: '', dueDate: '', ongoing: false }] });
    renderWorkEdit();
    renderWorkPreview();
  });
  document.getElementById('addVacationBtn').addEventListener('click', () => {
    const team = currentTeam();
    if (!team) return;
    state.vacation[team.key].items.push({ name: '', period: '' });
    renderWorkEdit();
    renderWorkPreview();
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

// ---------------- 열람 비밀번호 게이트 ----------------
function showViewGate() {
  document.getElementById('viewGateModal').classList.remove('hidden');
  document.getElementById('viewGateError').classList.add('hidden');
  const input = document.getElementById('viewPasswordInput');
  input.value = '';
  setTimeout(() => input.focus(), 50);
}
function hideViewGate() {
  document.getElementById('viewGateModal').classList.add('hidden');
}
async function tryViewLogin(startAppFn) {
  const pw = document.getElementById('viewPasswordInput').value;
  const errEl = document.getElementById('viewGateError');
  try {
    const r = await fetch(API + '/api/view/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
    });
    const res = await r.json();
    if (!res.ok) { errEl.textContent = '비밀번호가 틀렸습니다.'; errEl.classList.remove('hidden'); return; }
    viewSessionPassword = pw;
    sessionStorage.setItem('viewPw', pw);
    hideViewGate();
    startAppFn();
  } catch (e) {
    errEl.textContent = '서버에 연결하지 못했습니다: ' + e.message;
    errEl.classList.remove('hidden');
  }
}
function wireViewGate(startAppFn) {
  document.getElementById('viewGateBtn').addEventListener('click', () => tryViewLogin(startAppFn));
  document.getElementById('viewPasswordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryViewLogin(startAppFn);
  });
}

function startApp() {
  wireTypeTabs();
  wireWeekNav();
  wirePresent();
  wireOrderModal();
  wireWorkPanel();
  wireTrendPanel();
  wireGlobalToolbar();
  wireAdmin();
  loadWeek();
}

(function init() {
  if (!CFG.WORKER_BASE_URL || CFG.WORKER_BASE_URL.startsWith('여기에')) {
    alert('config.js에 Cloudflare Worker 주소/API_KEY를 먼저 설정해주세요.');
  }
  wireViewGate(startApp);
  if (viewSessionPassword) {
    // 이미 이번 세션에 인증했으면 게이트 없이 바로 시작 — 실패하면(비번이 바뀐 경우 등)
    // apiGet이 401을 감지해 다시 게이트를 띄운다.
    hideViewGate();
    startApp();
  } else {
    showViewGate();
  }
})();
