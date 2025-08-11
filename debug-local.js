// 로컬에서 Inspector 모드로 디버깅하는 스크립트
// server.js를 실행하여 중복 코드 제거

require('dotenv').config({ path: '.env.local' });

// server.js의 scrapeDividend 함수를 가져와서 실행
const { scrapeDividend } = require('./server');

async function debugLocal() {
  console.log('로컬 Inspector 모드로 디버깅을 시작합니다...');
  
  try {
    // server.js의 scrapeDividend 함수 실행
    console.log('server.js의 scrapeDividend 함수를 실행합니다...');
    
    const result = await scrapeDividend({
      debugAuthOnly: true, // 인증만 테스트
      overrideDates: {
        from: '2025/08/01',
        to: '2025/08/06'
      }
    });
    
    console.log('디버깅 결과:', result);
    
  } catch (error) {
    console.error('디버깅 중 오류 발생:', error);
  }
}

// 스크립트 실행
debugLocal().catch(console.error);
