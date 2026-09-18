# 리테일기획부 주간업무

`https://okgroup-uxui.github.io/okai/` (AX마케팅부 주간업무)를 참고해서 만든, 리테일기획부 전용 주간업무 보고/발표 사이트입니다.

- **팀**: CRM마케팅팀, 디지털운영팀, 리테일기획팀, 디지털데이터팀
- **기능**: 업무보고, 트렌드보고(이미지 첨부), 휴가자현황, 발표모드(전체화면 슬라이드), 인쇄/다운로드, 관리자(팀 관리·비밀번호 변경)
- **프론트엔드**: 순수 HTML/CSS/JS, `docs/` 폴더 그대로 GitHub Pages로 호스팅
- **백엔드**: Cloudflare Worker + KV (완전 서버리스, 로컬 PC와 무관하게 상시 운영)

## 배포 순서

### 1) Cloudflare Worker 만들기

1. https://dash.cloudflare.com 무료 가입 (이미 계정 있으면 로그인)
2. 왼쪽 메뉴 **Workers & Pages** → **Create application** → **Create Worker**
3. 이름은 아무거나(예: `retail-weekly-report`) 정하고 배포 → 생성된 편집기에서 기본 코드를 지우고 이 저장소의 `worker/worker.js` 내용을 통째로 붙여넣기 → **Deploy**
4. 배포 후 나오는 주소를 메모해두세요. 예: `https://retail-weekly-report.<계정이름>.workers.dev`

### 2) KV(데이터 저장소) 만들고 연결하기

1. **Workers & Pages** → **KV** → **Create a namespace** → 이름 `RETAIL_WEEKLY` 로 생성
2. 방금 만든 Worker → **Settings** → **Variables** → **KV Namespace Bindings** → **Add binding**
   - Variable name: `RETAIL_WEEKLY` (반드시 이 이름 그대로)
   - KV namespace: 방금 만든 것 선택
3. 저장

### 3) 쓰기 인증용 API 키 등록

1. 아무 문자열이나 길고 무작위인 값을 하나 만드세요 (예: 비밀번호 생성기로 32자리)
2. Worker → **Settings** → **Variables** → **Environment Variables** → **Add variable**
   - Name: `API_KEY`
   - Value: 위에서 만든 값
   - **꼭 "Encrypt" 체크** (Secret으로 저장)
3. 저장 → 재배포

### 4) 프론트엔드 설정값 채우기

`docs/config.js` 파일을 열어서:

```js
window.APP_CONFIG = {
  WORKER_BASE_URL: 'https://retail-weekly-report.<계정이름>.workers.dev',  // 1번에서 메모한 주소
  API_KEY: '<3번에서 만든 값과 정확히 동일하게>',
};
```

### 5) GitHub Pages로 사이트 올리기

1. GitHub에 새 저장소 생성 (예: `retail-weekly-report`), 이 프로젝트 폴더 전체를 push
2. 저장소 **Settings** → **Pages** → Source: `Deploy from a branch` → Branch: `main`, 폴더: `/docs` 선택 → Save
3. 몇 분 뒤 `https://<계정>.github.io/retail-weekly-report/` 로 접속 확인

### 6) 최초 실행

- 접속 후 **관리자** 버튼 클릭 → 원하는 비밀번호 입력 → 로그인 (최초 1회는 입력한 값이 그대로 비밀번호로 등록됩니다)
- 필요하면 관리자 패널에서 팀 이름/구성을 수정하세요

## 알아둘 점

- **API_KEY는 클라이언트(`config.js`)에 그대로 노출됩니다.** 레퍼런스 사이트(okai)도 동일한 방식이라 맞췄지만, 이건 "URL/키를 모르는 외부인이 함부로 못 쓰게" 하는 최소한의 방어이지 강력한 보안은 아닙니다. 진짜 민감한 정보는 올리지 마세요.
- 트렌드보고 이미지는 업로드 시 자동으로 압축(최대 가로 1200px, JPEG 72%)되어 저장됩니다. KV 값 하나의 용량 제한은 25MB라 웬만한 용도로는 충분합니다.
- 발표 순서는 각 팀 카드가 아니라 "발표모드" 탭에서 ▲▼ 버튼으로 조정합니다. 조정하는 즉시 저장됩니다.
- 데이터는 ISO 주차(`YYYY-Www`) 단위로 분리 저장됩니다. 상단 "이전주/이번주/다음주"로 이동해서 지난 주 기록도 그대로 볼 수 있습니다.
