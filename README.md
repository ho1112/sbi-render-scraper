# Cha-Line Render Scraper

SBI 증권 배당금 정보를 스크래핑하는 Render 서버입니다.

## 배포 방법

### 1. Render 계정 생성
- [Render.com](https://render.com)에서 계정 생성
- GitHub 계정으로 로그인

### 2. 새 Web Service 생성
- "New +" → "Web Service" 선택
- GitHub 저장소 연결
- `render-scraper` 폴더를 저장소에 푸시

### 3. 환경 변수 설정
Render 대시보드에서 다음 환경 변수들을 설정:

```
SBI_ID=your_sbi_id
SBI_PASSWORD=your_sbi_password
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REFRESH_TOKEN=your_google_refresh_token
```

### 4. 배포
- "Create Web Service" 클릭
- 자동으로 빌드 및 배포 시작
- 배포 완료 후 URL 확인 (예: `https://cha-line-scraper.onrender.com`)

## API 사용법

### 스크래핑 요청
```bash
POST https://your-render-url.com/scrape
Content-Type: application/json
Authorization: Bearer your_api_key

{
  "action": "scrape_dividend"
}
```

### 응답 형식
```json
{
  "success": true,
  "data": {
    "text": "배당금 정보 스크래핑 완료...",
    "source": "Render Scraper",
    "csvData": []
  }
}
```

## Vercel 연동

Vercel의 `.env.local`에 다음 환경 변수 추가:

```
RENDER_SCRAPER_URL=https://your-render-url.com/scrape
RENDER_API_KEY=your_api_key_here
```

## 주의사항

- Render 무료 플랜은 15분 동안 요청이 없으면 슬립 모드로 전환됩니다
- 첫 요청 시 약간의 지연이 있을 수 있습니다
- 환경 변수는 반드시 보안을 위해 Render 대시보드에서 설정해야 합니다

