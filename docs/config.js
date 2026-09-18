// Cloudflare Worker 배포 후 아래 두 값을 실제 값으로 바꿔주세요.
// WORKER_BASE_URL: Worker 배포 후 대시보드에 나오는 주소 (예: https://retail-weekly-report.<계정>.workers.dev)
// API_KEY: worker.js 쪽 Secret 변수(API_KEY)와 반드시 동일한 값이어야 함
window.APP_CONFIG = {
  WORKER_BASE_URL: 'https://retail-weekly-report.ok-crm-marketing.workers.dev',
  API_KEY: '7f3d9a2c8e1b4f6a0d5c7e9b2a4f6c8d1e3a5b7c9d0f2e4a6c8b0d2f4a6c8e0b',
};
