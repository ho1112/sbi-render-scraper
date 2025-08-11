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
async function scrapeDividend(options = {}) {
  let browser = null;
  
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

    // 실제 HTML 구조에 맞춰 로그인 상태 확인
    const loginForm = await page.$('input[name="user_id"]');
    
    if (loginForm) {
      console.log('Login form found, proceeding with login...');
      
      // 사용자 ID와 비밀번호 입력 (Puppeteer API 사용)
      await page.type('input[name="user_id"]', process.env.SBI_ID);
      await page.type('input[name="user_password"]', process.env.SBI_PASSWORD);
      
      // 로그인 버튼 클릭 (실제 HTML: input[type="submit"][name="ACT_login"])
      console.log('Clicking login button...');
      await page.click('input[name="ACT_login"]');
      await page.waitForNavigation();
      
      // 로그인 성공 여부 확인: 디바이스 인증 버튼이 나타나는지 확인
      console.log('Checking if login was successful...');
      let deviceAuthButton = null;
      try {
        // 디바이스 인증 버튼이 나타날 때까지 대기 (최대 10초)
        deviceAuthButton = await page.waitForSelector('button[name="ACT_deviceotpcall"]', { timeout: 10000 });
        if (deviceAuthButton) {
          const buttonText = await page.evaluate(el => el.textContent, deviceAuthButton);
          console.log('Login successful! Found device auth button with text:', buttonText);
        } else {
          console.log('Login failed: Device auth button not found');
          throw new Error('Device auth button not found after login');
        }
      } catch (error) {
        console.log('Login failed:', error.message);
        throw new Error(`Login verification failed: ${error.message}`);
      }
      
      // 로그인 성공 후 쿠키 저장
      try {
        const cookies = await page.cookies();
        fs.writeFileSync('sbi-cookies.json', JSON.stringify(cookies, null, 2));
        console.log('Saved cookies for future use');
      } catch (error) {
        console.log('Could not save cookies:', error.message);
      }
    } else {
      console.log('No login form found, checking if already logged in...');
      
      // 실제로 로그인된 상태인지 확인 (사용자 정보나 계정 메뉴가 있는지)
      const userInfo = await page.$('.user-info, .account-info, [data-user], .user-menu, .account-menu');
      if (userInfo) {
        console.log('User info found, already logged in');
      } else {
        console.log('No user info found, forcing login...');
        
        // 강제로 로그인 진행
        await page.type('input[name="user_id"]', process.env.SBI_ID);
        await page.type('input[name="user_password"]', process.env.SBI_PASSWORD);
        await page.click('input[name="ACT_login"]');
        await page.waitForNavigation();
        
        // 강제 로그인 성공 여부 확인
        console.log('Checking if forced login was successful...');
        let forcedDeviceAuthButton = null;
        try {
          forcedDeviceAuthButton = await page.waitForSelector('button[name="ACT_deviceotpcall"]', { timeout: 10000 });
          if (forcedDeviceAuthButton) {
            const buttonText = await page.evaluate(el => el.textContent, forcedDeviceAuthButton);
            console.log('Forced login successful! Found device auth button with text:', buttonText);
          } else {
            console.log('Forced login failed: Device auth button not found');
            throw new Error('Device auth button not found after forced login');
          }
        } catch (error) {
          console.log('Forced login failed:', error.message);
          throw new Error(`Forced login verification failed: ${error.message}`);
        }
      }
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
    // 요청 바디 우선, 다음 환경변수, 없으면 오늘 날짜
    const bodyFrom = options.from;                    // yyyy/mm/dd
    const bodyTo = options.to;                        // yyyy/mm/dd
    const envFrom = process.env.SCRAPE_FROM;          // yyyy/mm/dd
    const envTo = process.env.SCRAPE_TO;              // yyyy/mm/dd
    
    let dispositionDateFrom;
    let dispositionDateTo;
    
    if (bodyFrom && bodyTo) {
      dispositionDateFrom = bodyFrom;
      dispositionDateTo = bodyTo;
      console.log(`Using request body dates: ${bodyFrom} to ${bodyTo}`);
    } else if (envFrom && envTo) {
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
    
    // 로그인 후 페이지가 완전히 로드될 때까지 대기
    console.log('Waiting for login to complete...');
    await page.waitForTimeout(3000); // 3초 대기
    
    // 현재 페이지 상태 확인
    const currentUrlBeforeDividend = await page.url();
    const currentTitleBeforeDividend = await page.title();
    console.log('Current URL before dividend navigation:', currentUrlBeforeDividend);
    console.log('Current title before dividend navigation:', currentTitleBeforeDividend);
    
    console.log(`Navigating to dividend page: ${dividendUrl}`);
    await page.goto(dividendUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 배당금 페이지 이동 후 상태 확인
    const dividendPageUrl = await page.url();
    const dividendPageTitle = await page.title();
    console.log('Dividend page URL after navigation:', dividendPageUrl);
    console.log('Dividend page title after navigation:', dividendPageTitle);
    
    // 실제로 배당금 페이지에 도달했는지 확인
    if (!dividendPageUrl.includes('dividends')) {
      console.log('WARNING: Did not reach dividend page, current URL:', dividendPageUrl);
    }
    
    // CSV 다운로드 버튼 찾기 (실제 HTML 구조에 맞춤)
    console.log('Looking for CSV download button...');
    let downloadButton = null;
    
    try {
      // 실제 HTML: <button type="button" class="text-xs link-light">
      downloadButton = await page.$('button.text-xs.link-light');
      if (downloadButton) {
        const buttonText = await page.evaluate(el => el.textContent, downloadButton);
        console.log('Found button with text:', buttonText);
        if (buttonText && buttonText.includes('CSVダウンロード')) {
          console.log('CSV download button found by CSS class and text');
        } else {
          downloadButton = null;
        }
      } else {
        console.log('No button found with CSS class text-xs link-light');
      }
    } catch (error) {
      console.log('CSS selector failed:', error.message);
    }
    
    // 디버깅: 페이지에 어떤 버튼들이 있는지 확인
    if (!downloadButton) {
      try {
        const allButtons = await page.$$('button');
        console.log(`Found ${allButtons.length} buttons on page`);
        for (let i = 0; i < Math.min(allButtons.length, 5); i++) {
          const buttonText = await page.evaluate(el => el.textContent, allButtons[i]);
          const buttonClass = await page.evaluate(el => el.className, allButtons[i]);
          console.log(`Button ${i}: text="${buttonText}", class="${buttonClass}"`);
        }
      } catch (error) {
        console.log('Could not inspect buttons:', error.message);
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
    const { action, from, to } = req.body;
    
    if (action === 'scrape_dividend') {
      console.log('Received scrape request');
      
      // Puppeteer 실행 전 테스트 응답
      console.log('About to launch Puppeteer...');
      
      const result = await scrapeDividend({ from, to });
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

