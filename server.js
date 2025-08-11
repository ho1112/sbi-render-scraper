const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

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
    console.log('배당금 스크래핑을 시작합니다...');
    
    // 브라우저 실행
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    


    // SBI 증권 로그인 페이지로 이동
    console.log('SBI 증권 로그인 페이지로 이동합니다...');
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
      console.log('로그인 폼을 찾았습니다. 로그인을 진행합니다...');
      
      // 사용자 ID와 비밀번호 입력 (Puppeteer API 사용)
      await page.type('input[name="user_id"]', process.env.SBI_ID);
      await page.type('input[name="user_password"]', process.env.SBI_PASSWORD);
      
      // 로그인 버튼 클릭 (실제 HTML: input[type="submit"][name="ACT_login"])
      console.log('로그인 버튼을 클릭합니다...');
      await page.click('input[name="ACT_login"]');
      await page.waitForNavigation();
      
      // 로그인 성공 여부 확인: 디바이스 인증 버튼이 나타나는지 확인
      console.log('로그인이 성공했는지 확인합니다...');
      let deviceAuthButton = null;
      try {
        // 디바이스 인증 버튼이 나타날 때까지 대기 (최대 10초)
        deviceAuthButton = await page.waitForSelector('button[name="ACT_deviceotpcall"]', { timeout: 10000 });
        if (deviceAuthButton) {
          const buttonText = await page.evaluate(el => el.textContent, deviceAuthButton);
          console.log('로그인 성공! 디바이스 인증 버튼을 찾았습니다. 텍스트:', buttonText);
        } else {
                  console.log('로그인 실패: 디바이스 인증 버튼을 찾을 수 없습니다');
        throw new Error('로그인 후 디바이스 인증 버튼을 찾을 수 없습니다');
        }
      } catch (error) {
        console.log('로그인 실패:', error.message);
        throw new Error(`로그인 확인 실패: ${error.message}`);
      }
      

    } else {
      console.log('로그인 폼을 찾을 수 없습니다. 이미 로그인되어 있는지 확인합니다...');
      
      // 실제로 로그인된 상태인지 확인 (사용자 정보나 계정 메뉴가 있는지)
      const userInfo = await page.$('.user-info, .account-info, [data-user], .user-menu, .account-menu');
      if (userInfo) {
        console.log('사용자 정보를 찾았습니다. 이미 로그인되어 있습니다');
      } else {
                  console.log('사용자 정보를 찾을 수 없습니다. 강제 로그인을 진행합니다...');
        
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
            console.log('강제 로그인 성공! 디바이스 인증 버튼을 찾았습니다. 텍스트:', buttonText);
          } else {
            console.log('강제 로그인 실패: 디바이스 인증 버튼을 찾을 수 없습니다');
            throw new Error('강제 로그인 후 디바이스 인증 버튼을 찾을 수 없습니다');
          }
        } catch (error) {
          console.log('강제 로그인 실패:', error.message);
          throw new Error(`강제 로그인 확인 실패: ${error.message}`);
        }
      }
    }
    
    // 현재 페이지 상태 재확인 (2FA 전)
    const currentUrlAfterLogin = await page.url();
    const currentTitleAfterLogin = await page.title();
    console.log('로그인 후 현재 URL:', currentUrlAfterLogin);
    console.log('로그인 후 현재 제목:', currentTitleAfterLogin);
    
    // 페이지 내용 일부 확인
    try {
      const pageContent = await page.content();
      console.log('페이지에 2FA 요소 포함:', pageContent.includes('code-display'));
      console.log('페이지에 디바이스 인증 포함:', pageContent.includes('device'));
    } catch (error) {
      console.log('페이지 내용을 확인할 수 없습니다:', error.message);
    }
    
    console.log('로그인 성공, 2FA로 진행합니다...');
    
    // 4. 새로운 디바이스 인증 로직 (2025/8/9 이후 사양)
    console.log('새로운 디바이스 인증 플로우를 시작합니다...');
    
    // 페이지 안정화 대기
    await page.waitForTimeout(2000);
    
    // "Eメールを送信する" 버튼 찾기 및 클릭
    console.log('"이메일 전송" 버튼을 찾습니다...');
    let emailButton = null;
    try {
      // 1차: name 속성 기반
      emailButton = await page.waitForSelector('button[name="ACT_deviceotpcall"]', { timeout: 10000 });
      console.log('이름 속성으로 이메일 버튼을 찾았습니다');
    } catch (e) {
              console.log('이름 기반 버튼을 찾을 수 없습니다. 텍스트 기반으로 시도합니다...');
      try {
        // 2차: 텍스트 기반
        emailButton = await page.waitForSelector('button:has-text("Eメールを送信する")', { timeout: 10000 });
        console.log('텍스트로 이메일 버튼을 찾았습니다');
      } catch (e2) {
        console.log('텍스트 기반 버튼을 찾을 수 없습니다. 일반 선택자로 시도합니다...');
        try {
          // 3차: 일반적인 버튼 선택자
          const allButtons = await page.$$('button');
          for (let i = 0; i < allButtons.length; i++) {
            const buttonText = await page.evaluate(el => el.textContent, allButtons[i]);
            if (buttonText && buttonText.includes('Eメールを送信する')) {
              emailButton = allButtons[i];
              console.log('일반 선택자로 이메일 버튼을 찾았습니다');
              break;
            }
          }
        } catch (e3) {
                  console.log('모든 버튼 찾기 방법이 실패했습니다');
        throw new Error('페이지에서 이메일 버튼을 찾을 수 없습니다');
        }
      }
    }
    
    if (!emailButton) {
      throw new Error('이메일 버튼을 찾을 수 없습니다');
    }
    
    // 버튼 클릭
    console.log('"이메일 전송" 버튼을 클릭합니다...');
    await emailButton.click();
    console.log('"이메일 전송" 버튼을 클릭했습니다');
    
    // 이메일에서 인증 URL을 기다림 (폴링 + 타임아웃)
    console.log('Gmail에서 인증 URL을 기다립니다...');
    const triggerMs = Date.now();
    const authUrlResult = await waitForAuthUrlFromGmail({ sinceMs: triggerMs });
    
    if (!authUrlResult || !authUrlResult.url) {
      throw new Error('Gmail에서 인증 URL을 가져오는데 실패했습니다');
    }
    
    const authUrl = authUrlResult.url;
    console.log('Gmail에서 인증 URL을 받았습니다');
    
    // 5. 새 탭에서 인증 URL 열고 코드 입력
    console.log(`새 탭에서 인증 URL을 엽니다: ${authUrl}`);
    
    // 새 페이지 생성
    let authPage = null;
    let authTabAttempts = 0;
    const maxAuthTabAttempts = 5;
    
    while (authTabAttempts < maxAuthTabAttempts && !authPage) {
      try {
        authTabAttempts++;
        console.log(`인증 탭 생성 시도 ${authTabAttempts}...`);
        
        authPage = await browser.newPage();
        console.log('인증 탭이 성공적으로 생성되었습니다');
        
        // 인증 URL로 이동
        console.log('인증 URL로 이동합니다...');
        await authPage.goto(authUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 30000 
        });
        console.log('인증 URL로 성공적으로 이동했습니다');
        break;
        
      } catch (e) {
        console.log(`시도 ${authTabAttempts} 실패:`, e);
        
        if (authPage) {
          try {
            await authPage.close();
          } catch (closeError) {
            console.log('실패한 인증 페이지를 닫을 수 없습니다:', closeError);
          }
          authPage = null;
        }
        
        if (authTabAttempts >= maxAuthTabAttempts) {
          throw new Error(`인증 탭 생성 및 이동 시도 ${maxAuthTabAttempts}회 후 실패했습니다`);
        }
        
        console.log(`${authTabAttempts * 1000}ms 대기 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, authTabAttempts * 1000));
      }
    }
    
    if (!authPage) {
      throw new Error('인증 탭을 생성할 수 없습니다');
    }
    
    // 인증 코드 입력 필드가 활성화될 때까지 기다리기
    console.log('인증 코드 입력 필드를 기다립니다...');
    
    let inputField = null;
    let inputAttempts = 0;
    const maxInputAttempts = 10;
    
    while (inputAttempts < maxInputAttempts && !inputField) {
      try {
        inputAttempts++;
        console.log(`입력 필드 찾기 시도 ${inputAttempts}...`);
        
        inputField = await authPage.waitForSelector('input[name="verifyCode"]', { timeout: 10000 });
        console.log('입력 필드를 성공적으로 찾았습니다');
        break;
      } catch (e) {
        console.log(`시도 ${inputAttempts} 실패:`, e);
        if (inputAttempts >= maxInputAttempts) {
          throw new Error(`입력 필드 찾기 시도 ${maxInputAttempts}회 후 실패했습니다`);
        }
        const waitTime = Math.min(inputAttempts * 1000, 3000);
        console.log(`${waitTime}ms 대기 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!inputField) {
      throw new Error('입력 필드를 찾을 수 없습니다');
    }
    
    // 메인 페이지에서 최신 인증 코드 읽기 (40초마다 변경되므로)
    console.log('메인 페이지에서 최신 인증 코드를 읽습니다...');
    
    let codeElement = null;
    let codeAttempts = 0;
    const maxCodeAttempts = 10;
    
    while (codeAttempts < maxCodeAttempts && !codeElement) {
      try {
        codeAttempts++;
        console.log(`코드 표시 요소 찾기 시도 ${codeAttempts}...`);
        
        codeElement = await page.waitForSelector('#code-display', { timeout: 10000 });
        console.log('코드 표시 요소를 성공적으로 찾았습니다');
        break;
      } catch (e) {
        console.log(`시도 ${codeAttempts} 실패:`, e);
        if (codeAttempts >= maxCodeAttempts) {
          throw new Error(`코드 표시 요소 찾기 시도 ${maxCodeAttempts}회 후 실패했습니다`);
        }
        const waitTime = Math.min(codeAttempts * 1000, 3000);
        console.log(`${waitTime}ms 대기 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!codeElement) {
      throw new Error('코드 표시 요소를 찾을 수 없습니다');
    }
    
    // 코드 읽기
    const latestCode = await page.evaluate(el => el.textContent, codeElement);
    if (!latestCode) {
      throw new Error('웹 페이지에서 최신 인증 코드를 읽을 수 없습니다');
    }
    console.log('인증 코드를 성공적으로 읽었습니다:', latestCode);
    
    // 인증 코드 입력
    console.log('인증 코드를 입력합니다...');
    await authPage.type('input[name="verifyCode"]', latestCode);
    
    // 제출 버튼 클릭
    console.log('제출 버튼을 클릭합니다...');
    await authPage.click('button[type="submit"]');
    
    // 인증 완료 후 탭 닫기
    console.log('인증 탭을 닫습니다...');
    await authPage.close();
    
    // 6. 원래 페이지로 돌아가서 최종 확인
    console.log('메인 페이지로 돌아가서 최종 확인합니다...');
    
    // 체크박스 확인 및 등록 버튼 클릭
    let checkbox = null;
    let checkboxAttempts = 0;
    const maxCheckboxAttempts = 10;
    
    while (checkboxAttempts < maxCheckboxAttempts && !checkbox) {
      try {
        checkboxAttempts++;
        console.log(`체크박스 찾기 시도 ${checkboxAttempts}...`);
        
        checkbox = await page.waitForSelector('#device-checkbox', { timeout: 10000 });
        console.log('체크박스를 성공적으로 찾았습니다');
        break;
      } catch (e) {
        console.log(`시도 ${checkboxAttempts} 실패:`, e);
        if (checkboxAttempts >= maxCheckboxAttempts) {
          throw new Error(`체크박스 찾기 시도 ${maxCheckboxAttempts}회 후 실패했습니다`);
        }
        const waitTime = Math.min(checkboxAttempts * 1000, 3000);
        console.log(`${waitTime}ms 대기 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!checkbox) {
      throw new Error('체크박스를 찾을 수 없습니다');
    }
    
    // 체크박스 클릭
    console.log('체크박스를 클릭합니다...');
    await page.click('#device-checkbox');
    
    // 등록 버튼 클릭
    console.log('등록 버튼을 클릭합니다...');
    await page.click('#device-auth-otp');
    
    console.log('디바이스 인증이 성공적으로 완료되었습니다!');
    
    // 7. 로그인 완료 확인 - 실제로 로그인된 상태인지 확인
    console.log('로그인 완료를 확인합니다...');
    await page.waitForTimeout(3000); // 페이지 안정화 대기
    
    // 로그인 완료 후 상태 확인
    const finalUrl = await page.url();
    const finalTitle = await page.title();
    console.log('인증 후 최종 URL:', finalUrl);
    console.log('인증 후 최종 제목:', finalTitle);
    
    // 로그인 완료 여부 확인 (사용자 정보나 계정 메뉴가 있는지)
    const userInfo = await page.$('.user-info, .account-info, [data-user], .user-menu, .account-menu');
    if (!userInfo) {
      throw new Error('로그인 확인 실패: 인증 후 사용자 정보를 찾을 수 없습니다');
    }
    
    console.log('로그인 확인 성공! 배당금 페이지로 진행합니다...');
    
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
      console.log(`요청 바디 날짜를 사용합니다: ${bodyFrom} ~ ${bodyTo}`);
    } else if (envFrom && envTo) {
      dispositionDateFrom = envFrom;
      dispositionDateTo = envTo;
      console.log(`환경변수 날짜를 사용합니다: ${envFrom} ~ ${envTo}`);
    } else {
      // 오늘 날짜 사용 (JST)
      const today = new Date();
      const jstDate = new Date(today.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
      const dateStr = jstDate.toISOString().split('T')[0].replace(/-/g, '/');
      dispositionDateFrom = dateStr;
      dispositionDateTo = dateStr;
      console.log(`오늘 날짜를 사용합니다 (JST): ${dateStr}`);
    }
    
    // scraper.ts와 동일한 URL 사용
    const baseUrl = 'https://site.sbisec.co.jp/account/assets/dividends';
    const dividendUrl = `${baseUrl}?dispositionDateFrom=${dispositionDateFrom}&dispositionDateTo=${dispositionDateTo}`;
    
    // 로그인 후 페이지가 완전히 로드될 때까지 대기
    console.log('로그인이 완료될 때까지 대기합니다...');
    await page.waitForTimeout(3000); // 3초 대기
    
    // 현재 페이지 상태 확인
    const currentUrlBeforeDividend = await page.url();
    const currentTitleBeforeDividend = await page.title();
    console.log('배당금 페이지 이동 전 현재 URL:', currentUrlBeforeDividend);
    console.log('배당금 페이지 이동 전 현재 제목:', currentTitleBeforeDividend);
    
    console.log(`배당금 페이지로 이동합니다: ${dividendUrl}`);
    await page.goto(dividendUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 배당금 페이지 이동 후 상태 확인
    const dividendPageUrl = await page.url();
    const dividendPageTitle = await page.title();
    console.log('배당금 페이지 이동 후 URL:', dividendPageUrl);
    console.log('배당금 페이지 이동 후 제목:', dividendPageTitle);
    
    // 실제로 배당금 페이지에 도달했는지 확인
    if (!dividendPageUrl.includes('dividends')) {
      console.log('경고: 배당금 페이지에 도달하지 못했습니다. 현재 URL:', dividendPageUrl);
    }
    
    // CSV 다운로드 버튼 찾기 (실제 HTML 구조에 맞춤)
    console.log('CSV 다운로드 버튼을 찾습니다...');
    let downloadButton = null;
    
    try {
      // 실제 HTML: <button type="button" class="text-xs link-light">
      downloadButton = await page.$('button.text-xs.link-light');
      if (downloadButton) {
        const buttonText = await page.evaluate(el => el.textContent, downloadButton);
        console.log('텍스트가 있는 버튼을 찾았습니다:', buttonText);
        if (buttonText && buttonText.includes('CSVダウンロード')) {
          console.log('CSS 클래스와 텍스트로 CSV 다운로드 버튼을 찾았습니다');
        } else {
          downloadButton = null;
        }
      } else {
        console.log('CSS 클래스 text-xs link-light로 버튼을 찾을 수 없습니다');
      }
    } catch (error) {
      console.log('CSS 선택자가 실패했습니다:', error.message);
    }
    
    // 디버깅: 페이지에 어떤 버튼들이 있는지 확인
    if (!downloadButton) {
      try {
        const allButtons = await page.$$('button');
        console.log(`페이지에서 ${allButtons.length}개의 버튼을 찾았습니다`);
        for (let i = 0; i < Math.min(allButtons.length, 5); i++) {
          const buttonText = await page.evaluate(el => el.textContent, allButtons[i]);
          const buttonClass = await page.evaluate(el => el.className, allButtons[i]);
          console.log(`버튼 ${i}: 텍스트="${buttonText}", 클래스="${buttonClass}"`);
        }
      } catch (error) {
        console.log('버튼을 검사할 수 없습니다:', error.message);
      }
    }
    
    if (downloadButton) {
      // CSV 다운로드 버튼 클릭
      await downloadButton.click();
      console.log('CSV 다운로드가 시작되었습니다');
    } else {
      console.log('CSV 다운로드 버튼을 찾을 수 없습니다');
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
    console.error('스크래핑이 실패했습니다:', error);
    
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
  
  console.log(`Gmail에서 인증 URL을 기다립니다 (타임아웃: ${timeoutMs}ms, 폴링: ${pollMs}ms)`);
  
  while (Date.now() - start < timeoutMs) {
    attemptCount++;
    console.log(`Gmail 검색 시도 ${attemptCount}...`);
    
    const found = await getAuthUrlFromGmail({ sinceMs, lastSeenMessageId: lastSeen }).catch(() => null);
    if (found) return found;
    
    const elapsed = Date.now() - start;
    console.log(`아직 인증 URL을 찾지 못했습니다 (경과: ${elapsed}ms, 남은 시간: ${timeoutMs - elapsed}ms)`);
    
    await new Promise(res => setTimeout(res, 2000)); // 2초 대기 (테스트용)
  }
  throw new Error(`Gmail에서 인증 URL을 기다리는 시간이 초과되었습니다 (>${timeoutMs}ms)`);
}

// Gmail에서 인증 URL 가져오기 (간단한 구현)
async function getAuthUrlFromGmail(options = {}) {
  // 실제로는 Gmail API를 사용해야 함
  // 여기서는 테스트용 더미 URL 반환
  console.log('Gmail에서 인증 URL을 가져옵니다 (더미 구현)');
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
      console.log('스크래핑 요청을 받았습니다');
      
      // Puppeteer 실행 전 테스트 응답
      console.log('Puppeteer를 시작합니다...');
      
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

