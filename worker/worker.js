/**
 * 리테일기획부 주간업무 - Cloudflare Worker 백엔드
 *
 * KV 네임스페이스 바인딩 이름: RETAIL_WEEKLY  (Cloudflare 대시보드에서 이 이름으로 바인딩해야 함)
 *
 * 저장 키 구조:
 *   config:teams                -> [{key,label}, ...]
 *   config:adminHash            -> SHA-256(관리자 비밀번호) hex 문자열
 *   week:{weekId}:work:{team}   -> {items:[{category,dueDate,detail,note}, ...]}
 *   week:{weekId}:trend:{team}  -> {items:[{title,content,images:[dataURL,...]}, ...]}
 *   week:{weekId}:vacation:{team} -> {items:[{name,date,type,note}, ...]}
 *   week:{weekId}:order         -> [team, team, ...]  (발표 순서)
 *
 * 보안: 쓰기(PUT) 요청은 전부 X-Api-Key 헤더가 API_KEY 환경변수와 일치해야 통과.
 *       내부용 도구 수준의 최소 방어이며, 진짜 민감정보를 담는 용도로는 부족함.
 */

const DEFAULT_TEAMS = [
  { key: 'crm_marketing', label: 'CRM마케팅팀', members: [] },
  { key: 'digital_ops', label: '디지털운영팀', members: [] },
  { key: 'retail_planning', label: '리테일기획팀', members: [] },
  { key: 'digital_data', label: '디지털데이터팀', members: [] },
];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, X-View-Password',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function checkApiKey(request, env) {
  const key = request.headers.get('X-Api-Key') || '';
  return env.API_KEY && key === env.API_KEY;
}

// 열람(조회) 비밀번호 확인 — 2026-09-23 "비밀번호 하나 있어야 되지 않을까?" 요청으로, 그동안
// 인증 없이 아무나 볼 수 있던 /api/bootstrap, /api/config에 건다. config:viewHash가 아직
// 없으면(한 번도 등록 안 됐으면) 무조건 막는다 — 등록은 /api/view/login에서만 한다.
async function checkViewPassword(request, env) {
  const storedHash = await env.RETAIL_WEEKLY.get('config:viewHash');
  if (!storedHash) return false;
  const pw = request.headers.get('X-View-Password') || '';
  const hash = await sha256Hex(pw);
  return hash === storedHash;
}

async function getJSON(env, key, fallback) {
  const v = await env.RETAIL_WEEKLY.get(key);
  if (v === null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

async function putJSON(env, key, value) {
  await env.RETAIL_WEEKLY.put(key, JSON.stringify(value));
}

async function ensureTeams(env) {
  const existing = await env.RETAIL_WEEKLY.get('config:teams');
  if (existing === null) {
    await putJSON(env, 'config:teams', DEFAULT_TEAMS);
    return DEFAULT_TEAMS;
  }
  try { return JSON.parse(existing); } catch { return DEFAULT_TEAMS; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // ---- 부트스트랩: 특정 주차의 모든 팀 데이터를 한 번에 ----
      if (path === '/api/bootstrap' && request.method === 'GET') {
        if (!(await checkViewPassword(request, env))) return json({ error: '인증 실패' }, 401);
        const week = url.searchParams.get('week');
        if (!week) return json({ error: 'week 파라미터 필요' }, 400);

        const teams = await ensureTeams(env);
        const work = {}, trend = {}, vacation = {};
        await Promise.all(teams.map(async (t) => {
          work[t.key] = await getJSON(env, `week:${week}:work:${t.key}`, { items: [] });
          trend[t.key] = await getJSON(env, `week:${week}:trend:${t.key}`, { items: [] });
          vacation[t.key] = await getJSON(env, `week:${week}:vacation:${t.key}`, { items: [] });
        }));
        const defaultOrder = teams.map((t) => t.key);
        const order = await getJSON(env, `week:${week}:order`, { work: defaultOrder, trend: defaultOrder });

        return json({ week, teams, work, trend, vacation, order });
      }

      // ---- 팀 목록만 조회 ----
      if (path === '/api/config' && request.method === 'GET') {
        if (!(await checkViewPassword(request, env))) return json({ error: '인증 실패' }, 401);
        const teams = await ensureTeams(env);
        return json({ teams });
      }

      // ---- 특정 팀의 특정 섹션 저장 ----
      // 주의: 전체 배열을 통째로 덮어쓴다 — work/vacation은 아직 이 방식뿐이라, 같은 팀의
      // 여러 팀원이 비슷한 시간대에 각자 저장하면 먼저 저장된 다른 사람의 편집분이 나중 저장에
      // 덮여 사라질 수 있다(2026-10-12 확인된 실제 버그, 아래 /api/trend-item 참고). work는
      // 팀 전체가 공유하는 카테고리별 목록이라(개인별로 안 나뉨) 안전하게 병합할 "소유자 키"가
      // 없어서 당장은 고치지 않음 — 여러 명이 동시에 업무보고를 저장하는 일이 드물다면 체감
      // 위험은 trend보다 낮지만, 구조적으로는 같은 문제를 안고 있다.
      if (path === '/api/save' && request.method === 'PUT') {
        if (!checkApiKey(request, env)) return json({ error: '인증 실패' }, 401);
        const body = await request.json();
        const { week, section, team, data } = body || {};
        if (!week || !section || !team) return json({ error: 'week/section/team 필요' }, 400);
        if (!['work', 'trend', 'vacation'].includes(section)) return json({ error: '잘못된 section' }, 400);

        await putJSON(env, `week:${week}:${section}:${team}`, data);
        return json({ ok: true });
      }

      // ---- 트렌드보고 "내 항목 하나만" 서버에서 병합 저장 ----
      // 같은 팀 트렌드보고를 여러 팀원이 각자 작성하는데, 기존 /api/save는 자기가 불러온 시점의
      // 팀 전체 배열(다른 사람 항목 포함)을 통째로 다시 저장해서 — A가 불러온 뒤 B가 저장하고,
      // 그 다음 A가 저장하면 B의 항목이 A가 들고 있던 옛 배열로 덮여 사라졌다("왜 계속 삭제되냐"는
      // 반복 제보, 2026-10-12 코드로 재현 원인 확인). 이제 클라이언트는 자기 항목(author로 식별)
      // 하나만 보내고, 서버가 그 시점의 최신 배열을 직접 읽어 그 항목만 찾아 바꾸거나 새로 추가한
      // 뒤 저장한다 — 다른 사람 항목은 절대 건드리지 않는다.
      if (path === '/api/trend-item' && request.method === 'PUT') {
        if (!checkApiKey(request, env)) return json({ error: '인증 실패' }, 401);
        const body = await request.json();
        const { week, team, item } = body || {};
        if (!week || !team || !item || !item.author) return json({ error: 'week/team/item.author 필요' }, 400);

        const key = `week:${week}:trend:${team}`;
        const current = await getJSON(env, key, { items: [] });
        const items = Array.isArray(current.items) ? current.items.slice() : [];
        const idx = items.findIndex((it) => it.author === item.author);
        if (idx >= 0) items[idx] = item; else items.push(item);
        await putJSON(env, key, { items });
        return json({ ok: true });
      }

      // ---- 발표 순서 저장 (업무보고/트렌드보고 각각 독립적으로) ----
      if (path === '/api/order' && request.method === 'PUT') {
        if (!checkApiKey(request, env)) return json({ error: '인증 실패' }, 401);
        const body = await request.json();
        const { week, order } = body || {};
        if (!week || !order || !Array.isArray(order.work) || !Array.isArray(order.trend)) {
          return json({ error: 'week/order.work/order.trend 필요' }, 400);
        }
        await putJSON(env, `week:${week}:order`, order);
        return json({ ok: true });
      }

      // ---- 열람 비밀번호 로그인(최초 1회는 등록) ----
      if (path === '/api/view/login' && request.method === 'POST') {
        const { password } = await request.json();
        const storedHash = await env.RETAIL_WEEKLY.get('config:viewHash');
        if (!storedHash) {
          const hash = await sha256Hex(password || '');
          await env.RETAIL_WEEKLY.put('config:viewHash', hash);
          return json({ ok: true, firstSetup: true });
        }
        const hash = await sha256Hex(password || '');
        return json({ ok: hash === storedHash });
      }

      // ---- 열람 비밀번호 변경 ----
      if (path === '/api/view/password' && request.method === 'PUT') {
        if (!checkApiKey(request, env)) return json({ error: '인증 실패' }, 401);
        const { oldPassword, newPassword } = await request.json();
        const storedHash = await env.RETAIL_WEEKLY.get('config:viewHash');
        const oldHash = await sha256Hex(oldPassword || '');
        if (storedHash && oldHash !== storedHash) return json({ error: '기존 비밀번호 불일치' }, 401);
        const newHash = await sha256Hex(newPassword || '');
        await env.RETAIL_WEEKLY.put('config:viewHash', newHash);
        return json({ ok: true });
      }

      // ---- 관리자 로그인 검증 ----
      if (path === '/api/admin/login' && request.method === 'POST') {
        const { password } = await request.json();
        const storedHash = await env.RETAIL_WEEKLY.get('config:adminHash');
        if (!storedHash) {
          // 최초 1회: 아직 비밀번호가 설정된 적 없으면 이번 로그인 시도한 비번을 그대로 등록
          const hash = await sha256Hex(password || '');
          await env.RETAIL_WEEKLY.put('config:adminHash', hash);
          return json({ ok: true, firstSetup: true });
        }
        const hash = await sha256Hex(password || '');
        return json({ ok: hash === storedHash });
      }

      // ---- 관리자 비밀번호 변경 ----
      if (path === '/api/admin/password' && request.method === 'PUT') {
        if (!checkApiKey(request, env)) return json({ error: '인증 실패' }, 401);
        const { oldPassword, newPassword } = await request.json();
        const storedHash = await env.RETAIL_WEEKLY.get('config:adminHash');
        const oldHash = await sha256Hex(oldPassword || '');
        if (storedHash && oldHash !== storedHash) return json({ error: '기존 비밀번호 불일치' }, 401);
        const newHash = await sha256Hex(newPassword || '');
        await env.RETAIL_WEEKLY.put('config:adminHash', newHash);
        return json({ ok: true });
      }

      // ---- 팀 목록 변경(추가/삭제/이름수정) ----
      if (path === '/api/admin/teams' && request.method === 'PUT') {
        if (!checkApiKey(request, env)) return json({ error: '인증 실패' }, 401);
        const { password, teams } = await request.json();
        const storedHash = await env.RETAIL_WEEKLY.get('config:adminHash');
        const hash = await sha256Hex(password || '');
        if (storedHash && hash !== storedHash) return json({ error: '비밀번호 불일치' }, 401);
        if (!Array.isArray(teams) || teams.length === 0) return json({ error: 'teams 배열 필요' }, 400);
        await putJSON(env, 'config:teams', teams);
        return json({ ok: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};
