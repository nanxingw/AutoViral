/**
 * AutoViral desktop shell — Electron main process.
 *
 * Compiles (CommonJS) to `desktop/out/main.js`; root package.json points
 * `"main"` at it. This process is a thin supervisor: it resolves a writable
 * per-user data dir + the bundled native toolchain (ffmpeg / ffprobe / Chrome
 * Headless Shell / pre-built Remotion bundle), spawns the AutoViral daemon as a
 * child Node process, health-checks it over HTTP, then opens a BrowserWindow on
 * the daemon's origin. The Studio UI (and the in-Studio agent it drives) all
 * run inside that single daemon — main.ts owns its lifecycle.
 *
 * Architecture note: the daemon is ESM (`dist/index.js` + `dist/package.json`'s
 * `"type":"module"`), but Electron's main process is CJS. They are SEPARATE OS
 * processes — we spawn the daemon with `process.execPath` and
 * `ELECTRON_RUN_AS_NODE=1`, which turns the Electron binary into a plain Node
 * runtime, so the daemon never inherits Electron's module system.
 */

import {
  app,
  BrowserWindow,
  shell,
  dialog,
  type BrowserWindowConstructorOptions,
} from "electron";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { request } from "node:http";

// electron-updater + electron-log are CJS and ship as runtime `dependencies`
// (they MUST survive `npm prune --production`). They are only ever touched when
// `app.isPackaged`, but the import itself is cheap and side-effect-free.
import { autoUpdater } from "electron-updater";
import log from "electron-log";

// ── Constants ────────────────────────────────────────────────────────────────

/** Fixed port the daemon binds and we health-check. The daemon honors
 *  AUTOVIRAL_PORT (src/cli.ts resolveBindPort); we set both to this value. */
const DAEMON_PORT = 3271;
const HEALTH_HOST = "127.0.0.1";
const HEALTH_INTERVAL_MS = 250;
const HEALTH_ATTEMPTS = 40; // 250ms × 40 = 10s
const DAEMON_TERM_GRACE_MS = 4000;
const RELEASES_URL = "https://github.com/nanxingw/AutoViral/releases";

// ── Module state ──────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let daemonProcess: ChildProcess | null = null;
/** True only when WE spawned the daemon. If we reused an external daemon
 *  (the port was already held), we must NOT kill it on quit. */
let daemonOwnedByUs = false;
let daemonStderr = "";
let quitting = false;

// ── Resource resolution (dev vs packaged) ─────────────────────────────────────

/**
 * Repo root in dev. `__dirname` is `desktop/out/`, so the repo root is two
 * levels up. In a packaged app this path is meaningless — every packaged branch
 * uses `process.resourcesPath` instead.
 */
const repoRoot = join(__dirname, "..", "..");

interface ResourcePaths {
  /** ESM daemon entry passed to `node` as argv[1]. */
  daemonEntry: string;
  /** Absolute ffmpeg binary → FFMPEG_PATH. */
  ffmpeg: string;
  /** Absolute ffprobe binary → FFPROBE_PATH. */
  ffprobe: string;
  /** Dir containing ffmpeg/ffprobe (prepended to child PATH). */
  ffmpegDir: string;
  /** Absolute Chrome Headless Shell exec → AUTOVIRAL_CHROMIUM_PATH (may be ""). */
  chromium: string;
  /** Pre-built Remotion bundle dir → AUTOVIRAL_REMOTION_BUNDLE (may be ""). */
  remotionBundle: string;
  /** Dir holding the `autoviral` CLI shim (prepended to child PATH). */
  cliBinDir: string;
}

/**
 * Locate the Chrome Headless Shell executable inside a staged `chromium/`
 * directory. Remotion lays it out as `<root>/<platform>/chrome-headless-shell-*
 * /chrome-headless-shell[.exe]`; the staging script (scripts/ensure-chromium.mjs)
 * copies that subtree verbatim. We walk for the exec rather than hardcode the
 * version-stamped folder so a Chromium bump doesn't break resolution.
 */
function findChromiumExecutable(root: string): string {
  if (!existsSync(root)) return "";
  const targetNames =
    process.platform === "win32"
      ? ["chrome-headless-shell.exe", "headless_shell.exe", "chrome.exe"]
      : ["chrome-headless-shell", "headless_shell", "chrome"];

  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (targetNames.includes(name)) {
        return full;
      }
    }
  }
  return "";
}

function resolveResourcePaths(): ResourcePaths {
  if (app.isPackaged) {
    // Packaged layout: <resources>/ and the asar-unpacked daemon.
    const res = process.resourcesPath;
    const unpacked = join(res, "app.asar.unpacked");
    const ffmpegDir = join(res, "ffmpeg");
    return {
      daemonEntry: join(unpacked, "dist", "index.js"),
      ffmpeg: join(ffmpegDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
      ffprobe: join(ffmpegDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"),
      ffmpegDir,
      chromium: findChromiumExecutable(join(res, "chromium")),
      remotionBundle: join(res, "remotion-bundle"),
      cliBinDir: join(unpacked, "cli", "autoviral", "bin"),
    };
  }

  // Dev layout: resolve from node_modules / desktop/build-resources so
  // `desktop:dev` works without a packaging step.
  const ffmpegStatic = resolveDevFfmpeg();
  const ffprobeStatic = resolveDevFfprobe();
  return {
    daemonEntry: join(repoRoot, "dist", "index.js"),
    ffmpeg: ffmpegStatic.bin,
    ffprobe: ffprobeStatic,
    // In dev ffmpeg & ffprobe live in different node_modules dirs; prepend the
    // ffmpeg dir (PATH is a convenience — the daemon uses the explicit env vars).
    ffmpegDir: ffmpegStatic.dir,
    chromium: findChromiumExecutable(join(repoRoot, "desktop", "build-resources", "chromium")),
    remotionBundle: join(repoRoot, "desktop", "build-resources", "remotion-bundle"),
    cliBinDir: join(repoRoot, "cli", "autoviral", "bin"),
  };
}

/** Dev-only: ffmpeg-static default-exports the absolute binary path. */
function resolveDevFfmpeg(): { bin: string; dir: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegPath = require("ffmpeg-static") as string;
    return { bin: ffmpegPath, dir: join(ffmpegPath, "..") };
  } catch {
    return { bin: "ffmpeg", dir: "" };
  }
}

/** Dev-only: @ffprobe-installer/ffprobe exposes `{ path }`. */
function resolveDevFfprobe(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffprobe = require("@ffprobe-installer/ffprobe") as { path: string };
    return ffprobe.path;
  } catch {
    return "ffprobe";
  }
}

// ── Login-shell PATH recovery ─────────────────────────────────────────────────

/**
 * GUI-launched macOS apps inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`)
 * — NOT the user's login-shell PATH. The in-Studio agent spawns `claude`
 * (src/ws-bridge.ts spawnCli), so without the real PATH that exec is ENOENT and
 * the whole agent feature is dead in a packaged app.
 *
 * We recover the real PATH by running the user's login shell as an interactive
 * login shell and echoing $PATH. This is the same trick `shell-path`/`fix-path`
 * use, done inline so we add no ESM-only runtime dep (shell-path@3 is pure ESM
 * and can't be `require`d from this CJS process). Done once at startup; failures
 * degrade gracefully to process.env.PATH.
 */
function resolveLoginShellPath(): Promise<string> {
  // Windows GUI processes DO inherit the user PATH; skip the shell probe.
  if (process.platform === "win32") {
    return Promise.resolve(process.env.PATH ?? "");
  }
  return new Promise((resolve) => {
    const userShell = process.env.SHELL || "/bin/zsh";
    // `-ilc`: interactive + login so ~/.zprofile / ~/.zshrc (where users put
    // nvm / homebrew / volta PATH edits) are sourced. Echo a sentinel-wrapped
    // PATH so we can extract it cleanly from any shell banner noise.
    const child = execFile(
      userShell,
      ["-ilc", "echo __AV_PATH__$PATH__AV_PATH__"],
      { timeout: 5000, encoding: "utf-8" },
      (err, stdout) => {
        if (err || !stdout) {
          log.warn("[autoviral] login-shell PATH probe failed; using inherited PATH", err?.message);
          resolve(process.env.PATH ?? "");
          return;
        }
        const match = stdout.match(/__AV_PATH__(.*?)__AV_PATH__/s);
        const recovered = match?.[1]?.trim();
        if (recovered) {
          resolve(recovered);
        } else {
          resolve(process.env.PATH ?? "");
        }
      },
    );
    child.on("error", () => resolve(process.env.PATH ?? ""));
  });
}

// ── Port probe ────────────────────────────────────────────────────────────────

/**
 * Returns true if something is already listening on 127.0.0.1:port. Used to
 * detect an externally-launched daemon (e.g. `node dist/index.js start`) so we
 * REUSE it instead of spawning a second one that would EADDRINUSE.
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HEALTH_HOST, port });
    const done = (inUse: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

// ── Health check ──────────────────────────────────────────────────────────────

function httpProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      { host: HEALTH_HOST, port, path: "/", method: "GET", timeout: 2000 },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // drain
        resolve(status >= 200 && status < 400);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForDaemonHealthy(port: number): Promise<boolean> {
  for (let i = 0; i < HEALTH_ATTEMPTS; i++) {
    if (await httpProbe(port)) return true;
    await delay(HEALTH_INTERVAL_MS);
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Daemon spawn ──────────────────────────────────────────────────────────────

async function startDaemon(resources: ResourcePaths, loginPath: string): Promise<void> {
  const dataDir = join(app.getPath("userData"), "autoviral");

  // Compose the child PATH: bundled ffmpeg dir + CLI shim dir + the recovered
  // login-shell PATH + whatever we already inherited. Order matters: our
  // bundled tools win, then the user's tools (so `claude` resolves), then
  // fallbacks. de-dup is unnecessary — duplicates in PATH are harmless.
  const sep = process.platform === "win32" ? ";" : ":";
  const pathParts = [
    resources.ffmpegDir,
    resources.cliBinDir,
    loginPath,
    process.env.PATH ?? "",
  ].filter(Boolean);
  const childPath = pathParts.join(sep);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Turn the Electron binary into a plain Node runtime for the child.
    ELECTRON_RUN_AS_NODE: "1",
    AUTOVIRAL_PORT: String(DAEMON_PORT),
    AUTOVIRAL_DATA_DIR: dataDir,
    FFMPEG_PATH: resources.ffmpeg,
    FFPROBE_PATH: resources.ffprobe,
    PATH: childPath,
    // Mirror PATH into Path for Windows env-case safety.
    ...(process.platform === "win32" ? { Path: childPath } : {}),
  };
  if (resources.chromium) env.AUTOVIRAL_CHROMIUM_PATH = resources.chromium;
  if (resources.remotionBundle && existsSync(resources.remotionBundle)) {
    env.AUTOVIRAL_REMOTION_BUNDLE = resources.remotionBundle;
  }

  log.info("[autoviral] spawning daemon", {
    entry: resources.daemonEntry,
    port: DAEMON_PORT,
    dataDir,
    ffmpeg: resources.ffmpeg,
    ffprobe: resources.ffprobe,
    chromium: resources.chromium || "(none — Remotion will download)",
    remotionBundle: env.AUTOVIRAL_REMOTION_BUNDLE || "(none — runtime bundle)",
  });

  if (!existsSync(resources.daemonEntry)) {
    throw new Error(`Daemon entry not found: ${resources.daemonEntry}`);
  }

  daemonProcess = spawn(process.execPath, [resources.daemonEntry, "start", "--foreground"], {
    env,
    cwd: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked") : repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  daemonOwnedByUs = true;

  daemonProcess.stdout?.on("data", (d: Buffer) => log.info("[daemon]", d.toString().trimEnd()));
  daemonProcess.stderr?.on("data", (d: Buffer) => {
    const s = d.toString();
    daemonStderr += s;
    // Cap captured stderr so a crash-loop doesn't balloon memory.
    if (daemonStderr.length > 64_000) daemonStderr = daemonStderr.slice(-64_000);
    log.error("[daemon]", s.trimEnd());
  });
  daemonProcess.on("exit", (code, signal) => {
    log.warn("[autoviral] daemon exited", { code, signal });
    daemonProcess = null;
    daemonOwnedByUs = false;
    // If the daemon dies unexpectedly while the app is running, surface it.
    if (!quitting && mainWindow) {
      dialog.showErrorBox(
        "AutoViral engine stopped",
        `The AutoViral engine exited unexpectedly (code ${code ?? "?"}, signal ${signal ?? "?"}).\n\n` +
          `Recent log:\n${daemonStderr.slice(-2000)}`,
      );
      app.quit();
    }
  });
}

// ── Daemon teardown ───────────────────────────────────────────────────────────

function stopDaemon(): void {
  // Never touch a reused external daemon — we only own ones WE spawned.
  if (!daemonProcess || !daemonOwnedByUs) {
    daemonProcess = null;
    return;
  }
  const proc = daemonProcess;
  daemonProcess = null;
  try {
    proc.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  // Escalate to SIGKILL if it doesn't exit within the grace window.
  const killTimer = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, DAEMON_TERM_GRACE_MS);
  proc.once("exit", () => clearTimeout(killTimer));
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(port: number): void {
  const opts: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#0a0b0f",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.js"),
    },
  };
  if (process.platform === "darwin") {
    opts.titleBarStyle = "hiddenInset";
  }

  mainWindow = new BrowserWindow(opts);

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Route target=_blank / window.open and in-page external links to the OS
  // browser instead of opening Electron windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const origin = `http://${HEALTH_HOST}:${port}`;
    if (!url.startsWith(origin) && /^https?:\/\//.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(`http://${HEALTH_HOST}:${port}/`);
}

// ── Auto-update ───────────────────────────────────────────────────────────────

/**
 * Wire electron-updater. Guarded by `app.isPackaged` (never in dev).
 *
 * macOS subtlety (per the packaging verifier): we ship UNSIGNED for 0.1.0, and
 * Squirrel.Mac REFUSES to apply an unsigned update — it would download the zip
 * then fail at install, looping forever. So on darwin we disable autoDownload
 * and instead just check + notify + open the Releases page in the browser for a
 * manual download. Windows (NSIS) supports unsigned auto-update fine, so it gets
 * the full download+install flow.
 */
function setupAutoUpdate(): void {
  if (!app.isPackaged) return;

  log.transports.file.level = "info";
  autoUpdater.logger = log;

  if (process.platform === "darwin") {
    // Unsigned mac → check/notify only, never auto-download (avoids the
    // download-then-install-fail loop).
    autoUpdater.autoDownload = false;
    autoUpdater.on("update-available", (info) => {
      log.info("[autoviral] update available (mac, manual)", info.version);
      const win = mainWindow;
      if (!win) return;
      void dialog
        .showMessageBox(win, {
          type: "info",
          buttons: ["Download", "Later"],
          defaultId: 0,
          cancelId: 1,
          title: "Update available",
          message: `AutoViral ${info.version} is available.`,
          detail: "Open the releases page to download the new version.",
        })
        .then((res) => {
          if (res.response === 0) void shell.openExternal(RELEASES_URL);
        });
    });
    autoUpdater.on("error", (err) => log.error("[autoviral] updater error", err));
    void autoUpdater.checkForUpdates().catch((err) => log.error("[autoviral] checkForUpdates failed", err));
    return;
  }

  // Windows / others: full auto-download + notify-on-ready.
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (err) => log.error("[autoviral] updater error", err));
  autoUpdater.on("update-downloaded", (info) => {
    log.info("[autoviral] update downloaded", info.version);
    const win = mainWindow;
    if (!win) return;
    void dialog
      .showMessageBox(win, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `AutoViral ${info.version} has been downloaded.`,
        detail: "Restart the app to apply the update.",
      })
      .then((res) => {
        if (res.response === 0) {
          quitting = true;
          stopDaemon();
          autoUpdater.quitAndInstall();
        }
      });
  });
  void autoUpdater.checkForUpdatesAndNotify().catch((err) =>
    log.error("[autoviral] checkForUpdatesAndNotify failed", err),
  );
}

// ── Boot sequence ─────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  const resources = resolveResourcePaths();

  // Recover the real PATH before spawning, so `claude` resolves for the agent.
  const loginPath = await resolveLoginShellPath();

  const alreadyUp = await isPortInUse(DAEMON_PORT);
  if (alreadyUp) {
    // Reuse an externally-launched daemon. Do NOT spawn; do NOT kill on quit.
    log.info(`[autoviral] connected to existing AutoViral engine on :${DAEMON_PORT} (will not manage its lifecycle)`);
    daemonOwnedByUs = false;
  } else {
    try {
      await startDaemon(resources, loginPath);
    } catch (err) {
      dialog.showErrorBox(
        "AutoViral failed to start",
        `Could not launch the AutoViral engine.\n\n${(err as Error).message}`,
      );
      app.quit();
      return;
    }
  }

  const healthy = await waitForDaemonHealthy(DAEMON_PORT);
  if (!healthy) {
    dialog.showErrorBox(
      "AutoViral failed to start",
      `The AutoViral engine did not become ready within 10 seconds on port ${DAEMON_PORT}.\n\n` +
        `Daemon log:\n${daemonStderr.slice(-4000) || "(no output captured)"}`,
    );
    quitting = true;
    stopDaemon();
    app.quit();
    return;
  }

  createWindow(DAEMON_PORT);
  setupAutoUpdate();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// Single-instance: a second launch focuses the existing window instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot).catch((err) => {
    log.error("[autoviral] boot failed", err);
    dialog.showErrorBox("AutoViral failed to start", String(err));
    app.quit();
  });

  app.on("activate", () => {
    // macOS dock re-activate with no windows: re-open if the daemon is healthy.
    if (BrowserWindow.getAllWindows().length === 0 && (daemonProcess || !daemonOwnedByUs)) {
      createWindow(DAEMON_PORT);
    }
  });

  app.on("window-all-closed", () => {
    // Quit on all platforms (this is a single-window desktop app, not a
    // menubar/agent app); quit handlers tear the daemon down.
    app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopDaemon();
  });

  // Belt-and-braces: if the process is torn down by any other path, still
  // SIGTERM the daemon we own.
  process.on("exit", () => {
    if (daemonProcess && daemonOwnedByUs) {
      try {
        daemonProcess.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  });
}
