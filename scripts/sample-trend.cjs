const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');

const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString();

const items = Array.from({ length: 6 }).map((_, i) => ({
  id: `xhs_demo${i}`,
  platform: "xiaohongshu",
  title: ["人类丰容生活改造", "观鸟成为新潮户外方式", "Sofffit柔和穿搭风格", "Sportique运动风格日常化", "AI科技内容科普", "毛边美学日常记录"][i],
  sourceUrl: `https://www.xiaohongshu.com/explore/demo${i}`,
  source: i < 4 ? "scraper" : "agent_websearch",
  scrapedAt: now,
  cover: { url: `https://example.com/cover${i}.jpg`, aspect: "9:16", cachedPath: `/Users/x/.autoviral/trends/xiaohongshu/covers/xhs_demo${i}.jpg` },
  metrics: i < 4
    ? { views: 1200000 + i * 100000, likes: 50000 + i * 5000, comments: 1200 + i * 100, shares: null, fetchedAt: now }
    : null,
  analysis: {
    heat: 5 - Math.floor(i / 2),
    competition: ["中", "低", "高"][i % 3],
    opportunity: ["金矿", "蓝海", "红海"][i % 3],
    description: "Trending topic demo description for testing the new pipeline rendering path with adequate length to satisfy schema requirements.",
    tags: [`tag${i}a`, `tag${i}b`, `tag${i}c`],
    contentAngles: [`angle${i}-1`, `angle${i}-2`],
    exampleHook: `Hook example ${i}`,
    category: "lifestyle",
  },
}));

const collection = {
  platform: "xiaohongshu",
  items,
  collectedAt: now,
  pipelineStatus: "ok",
  errors: [],
  validation: { passed: true, issues: [] },
};

// e2e-report F184: this script's output used to land at `${today}.yaml` and
// shadow real research output (latest-yaml-wins in GET /api/trends/:platform).
// "Hook example N" and "xhs_demo*" ids leaked into /explore as if they were
// real research. Underscore prefix signals "fixture, not collected output";
// the API endpoint skips `_*` files so this can't leak again.
const dir = path.join(os.homedir(), '.autoviral', 'trends', 'xiaohongshu');
fs.mkdirSync(dir, { recursive: true });
const outName = `__sample-${today}.yaml`;
fs.writeFileSync(path.join(dir, outName), yaml.dump(collection, { lineWidth: -1 }), 'utf-8');
console.log('wrote', path.join(dir, outName));

// also write a sample cover jpg for one item
const coversDir = path.join(dir, 'covers');
fs.mkdirSync(coversDir, { recursive: true });
// minimal valid 1x1 jpeg
const minJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9,
]);
for (let i = 0; i < 6; i++) {
  fs.writeFileSync(path.join(coversDir, `xhs_demo${i}.jpg`), minJpeg);
}
console.log('wrote 6 covers to', coversDir);
