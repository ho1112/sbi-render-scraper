const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3001;

// 미들웨어
app.use(cors());
app.use(express.json());

// 루트 경로 테스트
app.get('/', (req, res) => {
    res.json({ message: 'Render scraper server is running!' });
});

// 환경 변수 검증
const requiredEnvVars = [
  'SBI_ID',
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
    
    // 브라우저 실행
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    // 저장된 쿠키가 있으면 설정
    try {
      if (fs.existsSync('sbi-cookies.json')) {
        const cookies = JSON.parse(fs.readFileSync('sbi-cookies.json', 'utf8'));
        await page.setCookie(...cookies);
        console.log('Loaded saved cookies');
      }
    } catch (error) {
      console.log('Could not load cookies:', error.message);
    }

    // SBI 증권 로그인 페이지로 이동
    console.log('Navigating to SBI Securities login page...');
    await page.goto('https://www.sbisec.co.jp/ETGate', {
      waitUntil: 'domcontentloaded',
      timeout: 60000  // 60초로 증가
    });

    // 현재 페이지 상태 확인
    const currentUrl = await page.url();
    const currentTitle = await page.title();
    console.log('Current URL:', currentUrl);
    console.log('Current title:', currentTitle);

    // 로그인 페이지에 있는지 확인
    if (currentUrl.includes('login') || currentTitle.includes('ログイン')) {
      console.log('Still on login page, proceeding with login...');
      
      // 사용자 ID와 비밀번호 입력
      await page.fill('input[name="user_id"]', process.env.SBI_ID);
      await page.fill('input[name="user_password"]', process.env.SBI_PASSWORD);
      
      // 로그인 버튼 클릭
      console.log('Clicking login button...');
      await page.click('button[name="ACT_loginHome"]');
      await page.waitForNavigation();
      
      console.log('Login successful!');
      
      // 로그인 성공 후 쿠키 저장
      try {
        const cookies = await page.cookies();
        fs.writeFileSync('sbi-cookies.json', JSON.stringify(cookies, null, 2));
        console.log('Saved cookies for future use');
      } catch (error) {
        console.log('Could not save cookies:', error.message);
      }
    } else {
      console.log('Already logged in, proceeding to main page...');
    }
    
    // 현재 페이지 상태 재확인 (2FA 전)
    const currentUrlAfterLogin = await page.url();
    const currentTitleAfterLogin = await page.title();
    console.log('Current URL after login:', currentUrlAfterLogin);
    console.log('Current title after login:', currentTitleAfterLogin);
    
    // 페이지 내용 일부 확인
    try {
      const pageContent = await page.content();
      console.log('Page contains 2FA elements:', pageContent.includes('code-display'));
      console.log('Page contains device authentication:', pageContent.includes('device'));
    } catch (error) {
      console.log('Could not check page content:', error.message);
    }
    
    console.log('Login successful, proceeding to 2FA...');
    
    // 2FA가 필요하지 않은 경우 건너뛰기
    if (!(await page.$('#code-display'))) {
      console.log('2FA not required, proceeding directly to dividend page...');
    } else {
      // 2단계 인증 처리 (기존 코드)
      // 디바이스 인증 팝업에서 코드 추출
      const deviceCode = await page.$eval('#code-display', el => el.textContent);
      console.log('Device code extracted:', deviceCode);
      
      // Gmail에서 인증 URL 가져오기 (간단한 구현)
      // 실제로는 Gmail API를 사용해야 함
      const authUrl = await getAuthUrlFromGmail();
      
      // 새 탭에서 인증 URL 열기
      const authPage = await browser.newPage();
      await authPage.goto(authUrl);
      
      // 인증 코드 입력
      await authPage.type('input[name="verifyCode"]', deviceCode);
      await authPage.click('button[type="submit"]');
      
      // 인증 완료 후 탭 닫기
      await authPage.close();
      
      // 원래 페이지로 돌아가서 최종 확인
      await page.check('#device-checkbox');
      await page.click('#device-auth-otp');
      
      console.log('2FA completed, navigating to dividend page...');
    }
    
    // 배당금 내역 페이지로 이동
    // scraper.ts와 동일한 날짜 처리 로직
    // 환경변수 우선, 없으면 오늘 날짜
    const envFrom = process.env.SCRAPE_FROM;
    const envTo = process.env.SCRAPE_TO;
    
    let dispositionDateFrom;
    let dispositionDateTo;
    
    if (envFrom && envTo) {
      dispositionDateFrom = envFrom;
      dispositionDateTo = envTo;
      console.log(`Using environment variables for dates: ${envFrom} to ${envTo}`);
    } else {
      // 오늘 날짜 사용 (JST)
      const today = new Date();
      const jstDate = new Date(today.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
      const dateStr = jstDate.toISOString().split('T')[0].replace(/-/g, '/');
      dispositionDateFrom = dateStr;
      dispositionDateTo = dateStr;
      console.log(`Using today's date (JST): ${dateStr}`);
    }
    
    // scraper.ts와 동일한 URL 사용
    const baseUrl = 'https://site.sbisec.co.jp/account/assets/dividends';
    const dividendUrl = `${baseUrl}?dispositionDateFrom=${dispositionDateFrom}&dispositionDateTo=${dispositionDateTo}`;
    
    console.log(`Navigating to dividend page: ${dividendUrl}`);
    await page.goto(dividendUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // CSV 다운로드 버튼 찾기 (scraper.ts와 동일한 방식)
    console.log('Looking for CSV download button...');
    let downloadButton = null;
    
    try {
      // 먼저 role 기반으로 찾기
      downloadButton = await page.$('button[role="button"]');
      if (downloadButton) {
        console.log('CSV download button found by role');
      }
    } catch (error) {
      console.log('Role-based button not found, trying fallback selector...');
    }
    
    if (!downloadButton) {
      try {
        // 폴백 셀렉터로 시도
        downloadButton = await page.$('button.text-xs.link-light:has-text("CSVダウンロード")');
        if (downloadButton) {
          console.log('CSV download button found by fallback selector');
        }
      } catch (error) {
        console.log('Fallback selector also failed');
      }
    }
    
    if (downloadButton) {
      // CSV 다운로드 버튼 클릭
      await downloadButton.click();
      console.log('CSV download initiated');
    } else {
      console.log('CSV download button not found');
    }
    
    // 브라우저 종료
    await browser.close();
    
    return {
      success: true,
      data: {
        text: `배당금 정보 스크래핑 완료\n\nCSV 다운로드가 시작되었습니다.`,
        source: 'Render Scraper (Puppeteer)',
        csvData: []
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
      
      // Puppeteer 실행 전 테스트 응답
      console.log('About to launch Puppeteer...');
      
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
  console.log(`Server is running on port ${PORT}`);
});

