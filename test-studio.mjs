import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// Go to dashboard
await page.goto('http://localhost:3271');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/av-01-dashboard.png' });
console.log('1. Dashboard loaded');

// Click on the new work "性感自拍日记"
const workCard = page.locator('text=性感自拍日记');
await workCard.click();
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/av-02-studio-init.png' });
console.log('2. Studio page opened, agent should be starting...');

// Wait for agent to stream (up to 120s for first step)
console.log('3. Waiting for agent to work on step 1 (话题调研)...');
let lastBlockCount = 0;
let stableCount = 0;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(5000);
  const blocks = await page.locator('.stream-block, .thinking-toggle, .result-toggle').count();
  const streamingDots = await page.locator('.streaming-indicator').count();
  const nextStepBtn = await page.locator('.next-step-btn, .start-step-btn').count();
  console.log(`   tick ${i}: blocks=${blocks}, streaming=${streamingDots > 0}, nextStepBtn=${nextStepBtn}`);
  
  if (blocks > 0 && streamingDots === 0 && blocks === lastBlockCount) {
    stableCount++;
    if (stableCount >= 3) {
      console.log('   Agent seems idle');
      break;
    }
  } else {
    stableCount = 0;
  }
  lastBlockCount = blocks;
}

await page.screenshot({ path: '/tmp/av-03-step1-done.png', fullPage: false });
console.log('4. Step 1 state captured');

// Check left sidebar for step statuses
const steps = await page.locator('.step-item').allTextContents();
console.log('5. Pipeline steps:', steps.map(s => s.trim()).join(' | '));

// Check if there's a next step button, click it to advance
const nextBtn = page.locator('.next-step-btn');
if (await nextBtn.count() > 0) {
  console.log('6. Clicking "Next Step" button...');
  await nextBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/av-04-step2-start.png' });
  
  // Wait for step 2
  console.log('7. Waiting for step 2...');
  stableCount = 0;
  lastBlockCount = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(5000);
    const blocks = await page.locator('.stream-block, .thinking-toggle, .result-toggle').count();
    const streamingDots = await page.locator('.streaming-indicator').count();
    console.log(`   tick ${i}: blocks=${blocks}, streaming=${streamingDots > 0}`);
    
    if (blocks > 0 && streamingDots === 0 && blocks === lastBlockCount) {
      stableCount++;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
    }
    lastBlockCount = blocks;
  }
  await page.screenshot({ path: '/tmp/av-05-step2-done.png' });
  console.log('8. Step 2 state captured');
}

// Now test: click on the FIRST step (已完成) to verify review mode
console.log('9. Clicking first step to test review mode...');
const firstStep = page.locator('.step-item').first();
await firstStep.click();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/av-06-review-mode.png' });

// Check for review banner
const reviewBanner = await page.locator('.review-banner').count();
console.log(`10. Review banner visible: ${reviewBanner > 0}`);

// Check step history API
const workId = 'w_20260318_1533_6d8';
const histRes = await page.evaluate(async (id) => {
  const r = await fetch(`/api/works/${id}/steps/research/history`);
  return { status: r.status, ok: r.ok };
}, workId);
console.log(`11. Step history API for research: status=${histRes.status}, ok=${histRes.ok}`);

// Final screenshot
await page.screenshot({ path: '/tmp/av-07-final.png' });
console.log('12. Test complete!');

await browser.close();
