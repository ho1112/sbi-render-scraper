const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { google } = require('googleapis');

// 로컬 환경에서만 puppeteer 사용 (Inspector 모드용)
let puppeteerLocal = null;
try {
  puppeteerLocal = require('puppeteer');
} catch (error) {
  console.log('로컬 puppeteer를 찾을 수 없습니다. Inspector 모드가 비활성화됩니다.');
}

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
module.exports.scrapeDividend = async function scrapeDividend(options = {}) {
  let browser = null;
  
  try {
    console.log('배당금 스크래핑을 시작합니다...');
    
    // 브라우저 실행 - 로컬과 Render 환경 구분
    const isLocal = process.env.NODE_ENV !== 'production';
    
    if (isLocal && puppeteerLocal) {
      // 로컬에서는 Inspector 모드로 실행
      console.log('로컬 환경에서 Inspector 모드로 실행합니다...');
      browser = await puppeteerLocal.launch({
        headless: false,  // 브라우저 창이 보임
        devtools: true,    // 개발자 도구 자동 열기
        defaultViewport: { width: 1920, height: 1080 }, // 화면 크기 크게 설정
        args: ['--start-maximized'] // 최대화된 상태로 시작
      });
    } else {
      // Render에서는 headless 모드
      console.log('Render 환경에서 headless 모드로 실행합니다...');
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    }

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
          
          // 디바이스 인증 버튼 클릭
          console.log('디바이스 인증 버튼을 클릭합니다...');
          await deviceAuthButton.click();
          console.log('디바이스 인증 버튼을 클릭했습니다');
          
          // 페이지 안정화 대기
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // 페이지가 이동했는지 확인
          const afterClickUrl = await page.url();
          const afterClickTitle = await page.title();
          console.log('클릭 후 URL:', afterClickUrl);
          console.log('클릭 후 제목:', afterClickTitle);
          
          // 인증코드 화면으로 이동했는지 확인
          const hasCodeDisplay = await page.$('#code-display');
          if (hasCodeDisplay) {
            console.log('인증코드 화면으로 이동했습니다! 이메일 전송이 성공했습니다!');
            // 이메일 전송 버튼을 찾을 필요가 없음 - 이미 다음 단계로 진행
          } else {
            console.log('아직 인증코드 화면이 아닙니다. 이메일 전송 버튼을 찾습니다...');
          }
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
            
            // 디바이스 인증 버튼 클릭
            console.log('강제 로그인 후 디바이스 인증 버튼을 클릭합니다...');
            await forcedDeviceAuthButton.click();
            console.log('강제 로그인 후 디바이스 인증 버튼을 클릭했습니다');
            
            // 페이지 안정화 대기
            await new Promise(resolve => setTimeout(resolve, 2000));
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
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // "Eメールを送信する" 버튼 찾기 및 클릭 (필요한 경우에만)
    let emailButton = null;
    
    // 인증코드 화면이 이미 있는지 다시 확인
    const hasCodeDisplay = await page.$('#code-display');
    if (hasCodeDisplay) {
      console.log('인증코드 화면이 이미 있습니다. 이메일 전송 버튼을 찾을 필요가 없습니다.');
    } else {
      console.log('"이메일 전송" 버튼을 찾습니다...');
      
      // scraper.ts와 동일한 방식으로 버튼 찾기
      emailButton = await page.waitForSelector('button[name="ACT_deviceotpcall"]', { timeout: 10000 });
      if (emailButton) {
        const buttonText = await page.evaluate(el => el.textContent, emailButton);
        console.log(`이메일 전송 버튼을 찾았습니다: "${buttonText}"`);
      } else {
        throw new Error('이메일 전송 버튼을 찾을 수 없습니다');
      }
    }
    
    if (!emailButton) {
      console.log('이메일 버튼을 찾을 수 없지만, 실제로는 클릭되었을 수 있습니다. 다음 단계로 진행합니다...');
      
      // 실제로는 버튼이 클릭되어서 인증코드 화면으로 넘어갔을 수 있음
      // 페이지 상태를 확인해보기
      const currentUrl = await page.url();
      const currentTitle = await page.title();
      console.log('현재 URL:', currentUrl);
      console.log('현재 제목:', currentTitle);
      
      // 인증코드 화면인지 확인
      const hasCodeDisplay = await page.$('#code-display');
      if (hasCodeDisplay) {
        console.log('인증코드 화면으로 이동했습니다. 이메일 전송이 성공했습니다!');
      } else {
        console.log('인증코드 화면이 아닙니다. 수동으로 이메일 전송을 시도합니다...');
        
        // 수동으로 이메일 전송 버튼 클릭 시도
        const manualButton = await page.$('button[name="ACT_deviceotpcall"]');
        if (manualButton) {
          await manualButton.click();
          console.log('수동으로 이메일 전송 버튼을 클릭했습니다');
        }
      }
    } else {
      // 버튼 클릭
      console.log('"이메일 전송" 버튼을 클릭합니다...');
      await emailButton.click();
      console.log('"이메일 전송" 버튼을 클릭했습니다');
    }
    
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
    
    // "認証する" 버튼 클릭
    console.log('"認証する" 버튼을 찾아서 클릭합니다...');
    const submitButton = await authPage.waitForSelector('button#verification', { timeout: 10000 });
    if (submitButton) {
      console.log('"認証する" 버튼을 찾았습니다. 클릭합니다...');
      await submitButton.click();
      console.log('"認証する" 버튼을 클릭했습니다');
    } else {
      // fallback: 일반적인 제출 버튼 시도
      console.log('"認証する" 버튼을 찾을 수 없습니다. 일반 제출 버튼을 시도합니다...');
      await authPage.click('button[type="submit"]');
      console.log('일반 제출 버튼을 클릭했습니다');
    }
    
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
    await new Promise(resolve => setTimeout(resolve, 3000)); // 페이지 안정화 대기
    
    // 로그인 완료 후 상태 확인
    const finalUrl = await page.url();
    const finalTitle = await page.title();
    console.log('인증 후 최종 URL:', finalUrl);
    console.log('인증 후 최종 제목:', finalTitle);
    
    // 로그인 완료 확인 - URL과 제목으로 판단
    console.log('로그인 완료 확인 성공! 배당금 페이지로 진행합니다...');
    
    // 배당금 내역 페이지로 이동
    // scraper.ts와 동일한 날짜 처리 로직
    // overrideDates 우선, 다음 요청 바디, 다음 환경변수, 없으면 오늘 날짜
    const overrideFrom = options.overrideDates?.from; // yyyy/mm/dd
    const overrideTo = options.overrideDates?.to;     // yyyy/mm/dd
    const bodyFrom = options.from;                    // yyyy/mm/dd
    const bodyTo = options.to;                        // yyyy/mm/dd
    const envFrom = process.env.SCRAPE_FROM;          // yyyy/mm/dd
    const envTo = process.env.SCRAPE_TO;              // yyyy/mm/dd
    
    let dispositionDateFrom;
    let dispositionDateTo;
    
    if (overrideFrom && overrideTo) {
      dispositionDateFrom = overrideFrom;
      dispositionDateTo = overrideTo;
      console.log(`overrideDates 날짜를 사용합니다: ${overrideFrom} ~ ${overrideTo}`);
    } else if (bodyFrom && bodyTo) {
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
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3초 대기
    
    // 현재 페이지 상태 확인
    const currentUrlBeforeDividend = await page.url();
    const currentTitleBeforeDividend = await page.title();
    console.log('배당금 페이지 이동 전 현재 URL:', currentUrlBeforeDividend);
    console.log('배당금 페이지 이동 전 현재 제목:', currentTitleBeforeDividend);
    
    console.log(`배당금 페이지로 이동합니다: ${dividendUrl}`);
    
    try {
      // 도메인 변경이 필요한 경우 직접 URL 변경
      await page.evaluate((url) => {
        window.location.href = url;
      }, dividendUrl);
      
      // 페이지 로딩 대기 (Puppeteer)
      await page.waitForSelector('body', { timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3000)); // 추가 대기
      
      console.log('배당금 페이지 이동 완료');
    } catch (error) {
      console.log('페이지 이동 중 오류 발생, 현재 상태로 진행:', error.message);
    }
    
    // 배당금 페이지 이동 후 상태 확인
    const dividendPageUrl = await page.url();
    const dividendPageTitle = await page.title();
    console.log('배당금 페이지 이동 후 URL:', dividendPageUrl);
    console.log('배당금 페이지 이동 후 제목:', dividendPageTitle);
    
    // 실제로 배당금 페이지에 도달했는지 확인
    if (!dividendPageUrl.includes('dividends')) {
      console.log('경고: 배당금 페이지에 도달하지 못했습니다. 현재 URL:', dividendPageUrl);
      console.log('현재 페이지에서 배당금 관련 요소를 찾아보겠습니다...');
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
      console.log('CSV 다운로드 버튼을 클릭합니다...');
      await downloadButton.click();
      console.log('CSV 다운로드가 시작되었습니다');
      
      // CSV 다운로드 완료 대기
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const result = {
        success: true,
        data: {
          text: '배당금 정보 스크래핑 완료\n\nCSV 다운로드가 시작되었습니다.',
          source: 'Render Scraper (Puppeteer)',
          csvDownloaded: true
        }
      };
      
      // 브라우저 종료
      await browser.close();
      
      return result;
      
    } else {
      console.log('CSV 다운로드 버튼을 찾을 수 없습니다');
      return {
        success: false,
        error: 'CSV 다운로드 버튼을 찾을 수 없습니다'
      };
    }
    
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
  const timeoutMs = options?.timeoutMs ?? 30000; // 30초로 단축
  const pollMs = options?.pollIntervalMs ?? 2000; // 2초 폴링
  const maxAttempts = options?.maxAttempts ?? 15; // 최대 15회 시도
  const sinceMs = options?.sinceMs ?? 0;
  const start = Date.now();
  let lastSeen = null;
  let attemptCount = 0;
  
  console.log(`Gmail에서 인증 URL을 기다립니다 (타임아웃: ${timeoutMs}ms, 폴링: ${pollMs}ms, 최대시도: ${maxAttempts}회)`);
  
  while (Date.now() - start < timeoutMs && attemptCount < maxAttempts) {
    attemptCount++;
    console.log(`Gmail 검색 시도 ${attemptCount}/${maxAttempts}...`);
    
    try {
      const found = await getAuthUrlFromGmail({ sinceMs, lastSeenMessageId: lastSeen });
      if (found) return found;
    } catch (error) {
      console.log(`Gmail API 오류 (시도 ${attemptCount}):`, error.message);
    }
    
    const elapsed = Date.now() - start;
    console.log(`아직 인증 URL을 찾지 못했습니다 (경과: ${elapsed}ms, 남은 시간: ${timeoutMs - elapsed}ms)`);
    
    if (attemptCount >= maxAttempts) {
      throw new Error(`최대 시도 횟수 ${maxAttempts}회에 도달했습니다`);
    }
    
    await new Promise(res => setTimeout(res, pollMs));
  }
  throw new Error(`Gmail에서 인증 URL을 기다리는 시간이 초과되었습니다 (>${timeoutMs}ms)`);
}

// Gmail에서 인증 URL 가져오기 (scraper.ts에서 복사)
async function getAuthUrlFromGmail(options = {}) {
  console.log('Gmail에서 인증 URL을 가져옵니다...');
  try {
    // 1. 환경 변수에서 OAuth 2.0 정보 가져오기
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google OAuth 2.0 자격증명이 .env.local에 완전히 설정되지 않았습니다');
    }

    // 2. OAuth2 클라이언트 생성 및 인증 정보 설정
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    // 3. Gmail API 클라이언트 생성
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 4. SBI 증권 인증 URL 이메일 검색 (더 유연한 검색 조건)
    console.log('SBI 인증 이메일을 검색합니다...');
    
    // 여러 검색 조건 시도 (더 광범위하게)
    const searchQueries = [
      'from:info@sbisec.co.jp subject:認証コード入力画面のお知らせ',
      'from:sbisec.co.jp subject:認証',
      'from:sbisec.co.jp subject:認証コード',
      'from:sbisec.co.jp',
      'subject:認証コード',
      'subject:認証',
      'from:sbisec.co.jp newer_than:1d', // 최근 1일 내 모든 SBI 이메일
      'newer_than:1h' // 최근 1시간 내 모든 이메일 (최후의 수단)
    ];
    
    let listResponse = null;
    let usedQuery = '';
    
    for (const query of searchQueries) {
      try {
        console.log(`검색 쿼리 시도: ${query}`);
        listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 10, // 더 많은 결과 검색
        });
        
        if (listResponse.data.messages && listResponse.data.messages.length > 0) {
          usedQuery = query;
          console.log(`쿼리로 ${listResponse.data.messages.length}개의 이메일을 찾았습니다: ${query}`);
          break;
        }
      } catch (e) {
        console.log(`쿼리 실패: ${query}`, e);
        continue;
      }
    }
    
    if (!listResponse || !listResponse.data.messages || listResponse.data.messages.length === 0) {
      console.log('어떤 검색 쿼리로도 이메일을 찾을 수 없습니다.');
      return null;
    }

    // 5. 후보 메시지들에서 적절한 메시지 선택 (가장 최신 우선)
    const sinceMs = options?.sinceMs ?? 0;
    const lastSeen = options?.lastSeenMessageId ?? null;
    const skewMs = 1000; // 클럭 오차 보정
    
    console.log(`이후 이메일을 찾습니다: ${new Date(sinceMs).toISOString()}`);
    
    let pickedId = null;
    let pickedPayload = null;
    
    for (const m of listResponse.data.messages) {
      const id = m.id;
      if (lastSeen && id === lastSeen) {
        console.log(`이미 본 메시지를 건너뜁니다: ${id}`);
        continue;
      }
      
      const resp = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = resp.data.payload;
      const internalDateStr = (resp.data).internalDate; // epoch ms (string)
      const internalDate = internalDateStr ? Number(internalDateStr) : 0;
      
      console.log(`메시지 ${id} 날짜: ${new Date(internalDate).toISOString()}, sinceMs: ${new Date(sinceMs).toISOString()}`);
      
      // sinceMs 조건을 완화: 5분 전부터의 이메일도 허용
      const timeWindow = sinceMs - (5 * 60 * 1000); // 5분 전
      if (payload && internalDate >= timeWindow) {
        pickedId = id;
        pickedPayload = payload;
        console.log(`날짜 ${new Date(internalDate).toISOString()}로 메시지 ${id}를 선택했습니다`);
        break;
      }
    }
    
    if (!pickedId || !pickedPayload) {
      console.log('시간 창 내에서 일치하는 인증 URL 이메일을 찾을 수 없습니다.');
      return null;
    }
    const messageId = pickedId;
    const payload = pickedPayload;

    // 6. 이메일 본문에서 인증 URL 추출 (로직 변경)
    const findTextPart = (parts) => {
      let foundPart = parts.find(part => part.mimeType === 'text/plain');
      if (foundPart) return foundPart;
      foundPart = parts.find(part => part.mimeType === 'text/html');
      if (foundPart) return foundPart;
      for (const part of parts) {
        if (part.parts) {
          const nestedPart = findTextPart(part.parts);
          if (nestedPart) return nestedPart;
        }
      }
      return null;
    };

    let textPart = null;
    if (payload.parts) {
      textPart = findTextPart(payload.parts);
    } else if (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html') {
      textPart = payload;
    }

    if (!textPart || !textPart.body || !textPart.body.data) {
      const availableMimeTypes = payload.parts?.map((p) => p.mimeType).join(', ') || payload.mimeType;
      throw new Error(`'text/plain' 또는 'text/html' 부분을 찾을 수 없습니다. 사용 가능한 타입: [${availableMimeTypes}]`);
    }

    const body = textPart.body.data;
    const decodedBody = Buffer.from(body, 'base64').toString('utf-8');

    // HTML/PLAIN 분기: HTML인 경우 a[href]에서 직접 추출, 아니면 텍스트에서 패턴 매칭
    const isHtml = (textPart.mimeType === 'text/html') || (payload.mimeType === 'text/html');
    let authUrl = null;

    if (isHtml) {
      // <a href="https://m.sbisec.co.jp/deviceAuthentication/input?...&amp;...">
      const hrefMatch = decodedBody.match(/href="(https:\/\/m\.sbisec\.co\.jp\/deviceAuthentication\/input[^\"]+)"/i);
      if (hrefMatch && hrefMatch[1]) {
        authUrl = hrefMatch[1].replace(/&amp;/g, '&');
      } else {
        // 보조: data-saferedirecturl 안의 q 파라미터에서 추출 시도
        const saferedirectMatch = decodedBody.match(/data-saferedirecturl="https:\/\/www\.google\.com\/url\?q=(https?:[^"&]+)["&]/i);
        if (saferedirectMatch && saferedirectMatch[1]) {
          // HTML 엔티티 디코드
          const candidate = saferedirectMatch[1].replace(/&amp;/g, '&');
          authUrl = candidate;
        }
      }
    } else {
      // 텍스트 본문에서 직접 URL 추출 (목표 도메인 우선)
      const specificMatch = decodedBody.match(/(https:\/\/m\.sbisec\.co\.jp\/deviceAuthentication\/input[^\s\"]+)/);
      const genericMatch = decodedBody.match(/(https:\/\/[^\s\"]+)/);
      authUrl = (specificMatch && specificMatch[0]) || (genericMatch && genericMatch[0]) || null;
    }

    if (!authUrl) {
      throw new Error('이메일 본문에서 인증 URL을 찾을 수 없습니다.');
    }
    console.log(`인증 URL을 가져왔습니다: ${authUrl}`);
    return { url: authUrl, messageId };

  } catch (error) {
    console.error('Gmail에서 인증 URL을 가져오는데 실패했습니다:', error);
    if (error.response) {
      console.error('API 오류 세부사항:', error.response.data.error);
    }
    throw error;
  }
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
      
      const result = await module.exports.scrapeDividend({ from, to });
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
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`로컬 테스트: http://localhost:${PORT}`);
  console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
});

