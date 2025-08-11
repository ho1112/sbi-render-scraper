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
    
    // 4. 새로운 디바이스 인증 로직 (2025/8/9 이후 사양)
    console.log('Starting new device authentication flow...');
    
    // 페이지 안정화 대기
    await page.waitForTimeout(2000);
    
    // "Eメールを送信する" 버튼 찾기 및 클릭
    console.log('Looking for "Send Email" button...');
    let emailButton = null;
    try {
      // 1차: name 속성 기반
      emailButton = await page.waitForSelector('button[name="ACT_deviceotpcall"]', { timeout: 10000 });
      console.log('Found email button by name attribute');
    } catch (e) {
      console.log('Name-based button not found, trying text-based...');
      try {
        // 2차: 텍스트 기반
        emailButton = await page.waitForSelector('button:has-text("Eメールを送信する")', { timeout: 10000 });
        console.log('Found email button by text');
      } catch (e2) {
        console.log('Text-based button not found, trying generic selector...');
        try {
          // 3차: 일반적인 버튼 선택자
          const allButtons = await page.$$('button');
          for (let i = 0; i < allButtons.length; i++) {
            const buttonText = await page.evaluate(el => el.textContent, allButtons[i]);
            if (buttonText && buttonText.includes('Eメールを送信する')) {
              emailButton = allButtons[i];
              console.log('Found email button by generic selector');
              break;
            }
          }
        } catch (e3) {
          console.log('All button finding methods failed');
          throw new Error('Could not find email button on the page');
        }
      }
    }
    
    if (!emailButton) {
      throw new Error('Email button not found');
    }
    
    // 버튼 클릭
    console.log('Clicking "Send Email" button...');
    await emailButton.click();
    console.log('Clicked "Send Email" button');
    
    // 이메일에서 인증 URL을 기다림 (폴링 + 타임아웃)
    console.log('Waiting for auth URL from Gmail...');
    const triggerMs = Date.now();
    const authUrlResult = await waitForAuthUrlFromGmail({ sinceMs: triggerMs });
    
    if (!authUrlResult || !authUrlResult.url) {
      throw new Error('Failed to get auth URL from Gmail');
    }
    
    const authUrl = authUrlResult.url;
    console.log('Auth URL received from Gmail');
    
    // 5. 새 탭에서 인증 URL 열고 코드 입력
    console.log(`Opening auth URL in a new tab: ${authUrl}`);
    
    // 새 페이지 생성
    let authPage = null;
    let authTabAttempts = 0;
    const maxAuthTabAttempts = 5;
    
    while (authTabAttempts < maxAuthTabAttempts && !authPage) {
      try {
        authTabAttempts++;
        console.log(`Attempt ${authTabAttempts} to create auth tab...`);
        
        authPage = await browser.newPage();
        console.log('Auth tab created successfully');
        
        // 인증 URL로 이동
        console.log('Navigating to auth URL...');
        await authPage.goto(authUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 30000 
        });
        console.log('Successfully navigated to auth URL');
        break;
        
      } catch (e) {
        console.log(`Attempt ${authTabAttempts} failed:`, e);
        
        if (authPage) {
          try {
            await authPage.close();
          } catch (closeError) {
            console.log('Could not close failed auth page:', closeError);
          }
          authPage = null;
        }
        
        if (authTabAttempts >= maxAuthTabAttempts) {
          throw new Error(`Failed to create and navigate auth tab after ${maxAuthTabAttempts} attempts`);
        }
        
        console.log(`Waiting ${authTabAttempts * 1000}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, authTabAttempts * 1000));
      }
    }
    
    if (!authPage) {
      throw new Error('Could not create auth tab');
    }
    
    // 인증 코드 입력 필드가 활성화될 때까지 기다리기
    console.log('Waiting for verification code input field...');
    
    let inputField = null;
    let inputAttempts = 0;
    const maxInputAttempts = 10;
    
    while (inputAttempts < maxInputAttempts && !inputField) {
      try {
        inputAttempts++;
        console.log(`Attempt ${inputAttempts} to find input field...`);
        
        inputField = await authPage.waitForSelector('input[name="verifyCode"]', { timeout: 10000 });
        console.log('Input field found successfully');
        break;
      } catch (e) {
        console.log(`Attempt ${inputAttempts} failed:`, e);
        if (inputAttempts >= maxInputAttempts) {
          throw new Error(`Failed to find input field after ${maxInputAttempts} attempts`);
        }
        const waitTime = Math.min(inputAttempts * 1000, 3000);
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!inputField) {
      throw new Error('Could not find input field');
    }
    
    // 메인 페이지에서 최신 인증 코드 읽기 (40초마다 변경되므로)
    console.log('Reading latest auth code from main page...');
    
    let codeElement = null;
    let codeAttempts = 0;
    const maxCodeAttempts = 10;
    
    while (codeAttempts < maxCodeAttempts && !codeElement) {
      try {
        codeAttempts++;
        console.log(`Attempt ${codeAttempts} to find code display element...`);
        
        codeElement = await page.waitForSelector('#code-display', { timeout: 10000 });
        console.log('Code display element found successfully');
        break;
      } catch (e) {
        console.log(`Attempt ${codeAttempts} failed:`, e);
        if (codeAttempts >= maxCodeAttempts) {
          throw new Error(`Failed to find code display element after ${maxCodeAttempts} attempts`);
        }
        const waitTime = Math.min(codeAttempts * 1000, 3000);
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!codeElement) {
      throw new Error('Could not find code display element');
    }
    
    // 코드 읽기
    const latestCode = await page.evaluate(el => el.textContent, codeElement);
    if (!latestCode) {
      throw new Error('Could not read the latest auth code from the web page');
    }
    console.log('Auth code read successfully:', latestCode);
    
    // 인증 코드 입력
    console.log('Entering auth code...');
    await authPage.type('input[name="verifyCode"]', latestCode);
    
    // 제출 버튼 클릭
    console.log('Clicking submit button...');
    await authPage.click('button[type="submit"]');
    
    // 인증 완료 후 탭 닫기
    console.log('Closing auth tab...');
    await authPage.close();
    
    // 6. 원래 페이지로 돌아가서 최종 확인
    console.log('Returning to main page for final confirmation...');
    
    // 체크박스 확인 및 등록 버튼 클릭
    let checkbox = null;
    let checkboxAttempts = 0;
    const maxCheckboxAttempts = 10;
    
    while (checkboxAttempts < maxCheckboxAttempts && !checkbox) {
      try {
        checkboxAttempts++;
        console.log(`Attempt ${checkboxAttempts} to find checkbox...`);
        
        checkbox = await page.waitForSelector('#device-checkbox', { timeout: 10000 });
        console.log('Checkbox found successfully');
        break;
      } catch (e) {
        console.log(`Attempt ${checkboxAttempts} failed:`, e);
        if (checkboxAttempts >= maxCheckboxAttempts) {
          throw new Error(`Failed to find checkbox after ${maxCheckboxAttempts} attempts`);
        }
        const waitTime = Math.min(checkboxAttempts * 1000, 3000);
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!checkbox) {
      throw new Error('Could not find checkbox');
    }
    
    // 체크박스 클릭
    console.log('Clicking checkbox...');
    await page.click('#device-checkbox');
    
    // 등록 버튼 클릭
    console.log('Clicking registration button...');
    await page.click('#device-auth-otp');
    
    console.log('Device authentication completed successfully!');
    
    // 7. 로그인 완료 확인 - 실제로 로그인된 상태인지 확인
    console.log('Verifying login completion...');
    await page.waitForTimeout(3000); // 페이지 안정화 대기
    
    // 로그인 완료 후 상태 확인
    const finalUrl = await page.url();
    const finalTitle = await page.title();
    console.log('Final URL after authentication:', finalUrl);
    console.log('Final title after authentication:', finalTitle);
    
    // 로그인 완료 여부 확인 (사용자 정보나 계정 메뉴가 있는지)
    const userInfo = await page.$('.user-info, .account-info, [data-user], .user-menu, .account-menu');
    if (!userInfo) {
      throw new Error('Login verification failed: User info not found after authentication');
    }
    
    console.log('Login verification successful! Proceeding to dividend page...');
    
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

async function waitForAuthUrlFromGmail(options = {}) {
  const timeoutMs = options?.timeoutMs ?? 60000; // 코드는 40초 주기 → 여유를 두고 60초 타임아웃
  const pollMs = options?.pollIntervalMs ?? 1000; // 폴링 간격 단축
  const sinceMs = options?.sinceMs ?? 0;
  const start = Date.now();
  let lastSeen = null;
  let attemptCount = 0;
  
  console.log(`Waiting for auth URL from Gmail (timeout: ${timeoutMs}ms, poll: ${pollMs}ms)`);
  
  while (Date.now() - start < timeoutMs) {
    attemptCount++;
    console.log(`Gmail search attempt ${attemptCount}...`);
    
    const found = await getAuthUrlFromGmail({ sinceMs, lastSeenMessageId: lastSeen }).catch(() => null);
    if (found) return found;
    
    const elapsed = Date.now() - start;
    console.log(`No auth URL found yet (elapsed: ${elapsed}ms, remaining: ${timeoutMs - elapsed}ms)`);
    
    await new Promise(res => setTimeout(res, 2000)); // 2초 대기 (테스트용)
  }
  throw new Error(`Timed out waiting for auth URL from Gmail (>${timeoutMs}ms)`);
}

// Gmail에서 인증 URL 가져오기 (간단한 구현)
async function getAuthUrlFromGmail(options = {}) {
  // 실제로는 Gmail API를 사용해야 함
  // 여기서는 테스트용 더미 URL 반환
  console.log('Getting auth URL from Gmail (dummy implementation)');
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기 (테스트용)
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

