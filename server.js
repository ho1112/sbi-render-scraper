const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 미들웨어
app.use(cors());
app.use(express.json());

// 환경 변수 검증
const requiredEnvVars = [
  'SBI_USERNAME',
  'SBI_PASSWORD', 
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

// 스크래핑 함수
async function scrapeDividend() {
  let browser;
  
  try {
    console.log('Starting dividend scraping...');
    
    // Playwright 브라우저 실행
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    // SBI 증권 로그인 페이지로 이동
    console.log('Navigating to SBI Securities login page...');
    await page.goto('https://www.sbisec.co.jp/ETGate');
    
    // 로그인 폼 입력
    await page.fill('input[name="user_id"]', process.env.SBI_USERNAME);
    await page.fill('input[name="user_password"]', process.env.SBI_PASSWORD);
    
    // 로그인 버튼 클릭
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    
    console.log('Login successful, proceeding to 2FA...');
    
    // 2단계 인증 처리
    // 디바이스 인증 팝업에서 코드 추출
    const deviceCode = await page.locator('#code-display').textContent();
    console.log('Device code extracted:', deviceCode);
    
    // Gmail에서 인증 URL 가져오기 (간단한 구현)
    // 실제로는 Gmail API를 사용해야 함
    const authUrl = await getAuthUrlFromGmail();
    
    // 새 탭에서 인증 URL 열기
    const authPage = await context.newPage();
    await authPage.goto(authUrl);
    
    // 인증 코드 입력
    await authPage.fill('input[name="verifyCode"]', deviceCode);
    await authPage.click('button[type="submit"]');
    
    // 인증 완료 후 탭 닫기
    await authPage.close();
    
    // 원래 페이지로 돌아가서 최종 확인
    await page.check('#device-checkbox');
    await page.click('#device-auth-otp');
    
    console.log('2FA completed, navigating to dividend page...');
    
    // 배당금 내역 페이지로 이동
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '/');
    
    const dividendUrl = `https://www.sbisec.co.jp/ETGate?_ControlID=WPLETmgR001Control&_DataStoreID=DSWPLETmgR001Control&_PageID=WPLETmgR001Ktkg010&_ActionID=urlDefault&getFlg=on&_UserID=WPLETmgR001Control&_UserName=WPLETmgR001Control&_PageName=WPLETmgR001Ktkg010&_PageTitle=WPLETmgR001Ktkg010&_PageID=WPLETmgR001Ktkg010&_ActionID=urlDefault&getFlg=on&_UserID=WPLETmgR001Control&_UserName=WPLETmgR001Control&_PageName=WPLETmgR001Ktkg010&_PageTitle=WPLETmgR001Ktkg010&dispositionDateFrom=${dateStr}&dispositionDateTo=${dateStr}&period=TODAY`;
    
    await page.goto(dividendUrl);
    await page.waitForLoadState('networkidle');
    
    // CSV 다운로드 버튼 클릭
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /CSVダウンロード/ }).click();
    const download = await downloadPromise;
    
    // CSV 파일 저장
    const csvPath = await download.path();
    console.log('CSV downloaded to:', csvPath);
    
    // CSV 파싱 (간단한 구현)
    const csvContent = await parseCSV(csvPath);
    
    // 브라우저 종료
    await browser.close();
    
    return {
      success: true,
      data: {
        text: `배당금 정보 스크래핑 완료\n\n${csvContent.summary}`,
        source: 'Render Scraper',
        csvData: csvContent.data
      }
    };
    
  } catch (error) {
    console.error('Scraping failed:', error);
    
    if (browser) {
      await browser.close();
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

// Gmail에서 인증 URL 가져오기 (간단한 구현)
async function getAuthUrlFromGmail() {
  // 실제로는 Gmail API를 사용해야 함
  // 여기서는 간단한 예시
  return 'https://example.com/auth';
}

// CSV 파싱 (간단한 구현)
async function parseCSV(filePath) {
  // 실제로는 csv-parse 라이브러리를 사용해야 함
  return {
    summary: '배당금 정보 파싱 완료',
    data: []
  };
}

// API 엔드포인트
app.post('/scrape', async (req, res) => {
  try {
    const { action } = req.body;
    
    if (action === 'scrape_dividend') {
      console.log('Received scrape request');
      const result = await scrapeDividend();
      res.json(result);
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 헬스체크
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Scraper server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});

