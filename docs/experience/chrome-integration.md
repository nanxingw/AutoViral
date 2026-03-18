# Chrome 集成与社媒连接经验

> 使用 Claude Code `--chrome` flag 操控用户浏览器

## --chrome 模式

Claude Code CLI 的 `--chrome` flag 可以直接操控用户正在运行的 Chrome 浏览器，无需 Playwright、CDP 端口、或额外浏览器实例。

```bash
claude -p "打开 https://example.com 并截图" --chrome --model haiku
```

### 优势

- 复用用户现有的 Cookie/登录态
- 不需要重启 Chrome
- 不需要 `--remote-debugging-port`
- 不需要 Playwright 依赖

### 限制

- 命令执行期间会操控用户的 Chrome 窗口（可能干扰用户操作）
- 无法并行操控多个标签页
- 需要 Chrome 在前台运行

## 社媒平台登录检测

### 检测逻辑

通过 `--chrome` 打开平台 URL，检查是否被重定向到登录页：

```typescript
const PLATFORM_CONFIG = {
  douyin: {
    checkPrompt: '使用Chrome打开 https://creator.douyin.com/ ，等待3秒...',
    // 如果看到"创作者登录"按钮 → NOT_LOGGED_IN
    // 如果看到仪表盘内容 → LOGGED_IN
  },
  xiaohongshu: {
    checkPrompt: '使用Chrome打开 https://creator.xiaohongshu.com/ ，等待3秒...',
    // 如果 URL 包含 /login → NOT_LOGGED_IN
    // 否则 → LOGGED_IN
  }
};
```

### 平台登录页特征（2026-03-17 测试）

| 平台 | URL | 未登录标志 | 登录方式 |
|------|-----|-----------|---------|
| 抖音创作者 | creator.douyin.com | 页面有"创作者登录"按钮 | QR 扫码（canvas 元素） |
| 小红书创作者 | creator.xiaohongshu.com | 重定向到 /login | SMS 默认，右上角切换 QR |
| 小红书主站 | xiaohongshu.com/explore | 弹出登录 modal | QR（img.qrcode-img） |

### 关键选择器

```
抖音：
- 登录按钮: div.btn-IDx0e8.personal-wZ47FL
- QR 容器: div.scan_qrcode_login-fkKM1f
- QR canvas: canvas (180x180)

小红书创作者：
- 登录框: .login-box-container
- 手机号: input[placeholder*="手机"]
- QR 切换: img.css-wemwzq

小红书主站：
- 登录 modal: div.reds-modal.login-modal
- QR 图片: img.qrcode-img (128x128, base64)
- 登录按钮: button.login-btn
```

## 防重复请求

### 问题

前端轮询 status API → 每次 spawn 新 CLI `--chrome` 进程 → 多个进程同时操控 Chrome → 混乱。

### 解决方案：三层保护

```typescript
// 1. 请求去重 — 同平台同时只有一个检查进程
const checkProcesses: Map<string, Promise<boolean>> = new Map();

// 2. 结果缓存 — 30 秒 TTL
const checkCache: Map<string, { result: boolean; timestamp: number }> = new Map();

// 3. 前端降频 — 15 秒间隔，最多 8 次轮询
setInterval(checkStatus, 15000);  // 不要用 5s
```

## 连接流程

1. 用户进入分析页 → `GET /api/platforms` 获取平台列表
2. 自动调用 `GET /api/platforms/:name/status` 检测登录态（缓存 30s）
3. 用户点"连接" → `POST /api/platforms/:name/login` → CLI --chrome 打开登录页
4. 用户扫码/输入验证码 → 登录成功
5. 前端每 15s 轮询一次 status → 检测到 LOGGED_IN → 卡片变绿

## Playwright vs --chrome 对比

| 特性 | Playwright | --chrome |
|------|-----------|---------|
| 安装依赖 | ~300MB chromium | 无 |
| Cookie | 需要 persistent context | 复用用户 Chrome |
| 并行 | 支持多实例 | 单实例 |
| headless | 支持 | 不支持（用户可见） |
| 稳定性 | 高（隔离环境） | 依赖 Chrome 状态 |
| 用户体验 | 弹出新窗口 | 在用户浏览器中操作 |

**结论**：社媒连接用 `--chrome`（复用登录态），自动化发布用 Playwright（稳定+headless）。
