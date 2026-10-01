const { app, BrowserWindow, Menu, globalShortcut, ipcMain } = require('electron');
const { execSync } = require('child_process');
const path = require('path');

// ── 윈도우 키 비활성화 (Windows 전용) ──────────────────────
// Win+E, Win+R, Win+L, Win+D, Win+Tab 등 "조합키"는 레지스트리로
// 확실히 막을 수 있지만, Win 키만 딱 눌러 시작 메뉴를 여는 동작은
// 최신 Windows(10/11)에서는 이 방법으로도 완전히 막히지 않을 수 있습니다.
// 레지스트리를 즉시 반영시키기 위해 탐색기(explorer.exe)를 재시작하므로,
// 적용/해제 시 바탕화면·작업표시줄이 한 번 깜빡입니다.
const WINKEY_REG_PATH =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer';

function restartExplorer() {
  try {
    execSync('taskkill /IM explorer.exe /F', { stdio: 'ignore' });
  } catch (e) {
    /* 이미 꺼져 있으면 무시 */
  }
  try {
    execSync('start explorer.exe', { stdio: 'ignore', shell: 'cmd.exe' });
  } catch (e) {
    console.error('탐색기 재시작 실패:', e.message);
  }
}

function disableWinKey() {
  if (process.platform !== 'win32') return;
  try {
    execSync(`reg add "${WINKEY_REG_PATH}" /v NoWinKeys /t REG_DWORD /d 1 /f`);
    restartExplorer();
  } catch (e) {
    console.error('윈도우 키 비활성화 실패:', e.message);
  }
}

function restoreWinKey() {
  if (process.platform !== 'win32') return;
  try {
    execSync(`reg delete "${WINKEY_REG_PATH}" /v NoWinKeys /f`);
    restartExplorer();
  } catch (e) {
    /* 애초에 값이 없었을 수도 있으므로 조용히 무시 */
  }
}

// ── 시작 페이지 ───────────────────────────────────────────
const START_URL = 'https://ihw.riroschool.kr/';

// ── 메인 도메인(ihw.riroschool.kr)에서 허용할 "페이지 경로" ────
// 이 버전은 리로스쿨(ihw.riroschool.kr 및 그 서브도메인)의 모든 페이지를
// 허용합니다. 다른 사이트(구글 검색, 유튜브, 게임 사이트 등)로의 이동만
// 차단됩니다.
function isAllowedUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return false;
  }
  const host = u.hostname;

  if (host === 'ihw.riroschool.kr') return true;
  if (host === 'riroschool.kr' || host.endsWith('.riroschool.kr')) {
    return true;
  }
  return false;
}

function commonWebPreferences(extra = {}) {
  return {
    devTools: false,       // 콘솔로 우회하는 것 방지
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false,
    ...extra,
  };
}

// 이 앱이 직접 띄운 창들(메인 창 + 로그인 팝업 등)을 추적합니다.
// blur 시 "우리 앱의 다른 창으로 넘어간 것"과 "완전히 다른 프로그램으로
// 넘어간 것"을 구분하기 위해 필요합니다.
const knownWindows = new Set();
app.on('browser-window-created', (_event, win) => {
  knownWindows.add(win);
  win.on('closed', () => knownWindows.delete(win));
});

// ── 시험 화면 이탈 감지 + 경고 팝업 ────────────────────────
let exitCount = 0;
let warningWin = null;
let mainWindowRef = null;

function showExitWarning() {
  // 이미 경고 팝업이 떠 있는 상태라면 중복으로 띄우지 않습니다.
  if (warningWin && !warningWin.isDestroyed()) return;

  exitCount += 1;

  warningWin = new BrowserWindow({
    width: 1900,
    height: 1000,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'exam-warning-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  warningWin.setAlwaysOnTop(true, 'screen-saver');

  const html = `
    <html><body style="margin:0;display:flex;flex-direction:column;align-items:center;
      justify-content:center;height:100vh;background:#1f2937;color:#f3f4f6;
      font-family:'Malgun Gothic',sans-serif;text-align:center;padding:0 24px;
      box-sizing:border-box;">
      <div style="font-size:20px;font-weight:bold;margin-bottom:10px;">
        시험 화면을 벗어났습니다
      </div>
      <div style="font-size:20px;line-height:1.6;color:#fca5a5;margin-bottom:6px;">
        이탈 ${exitCount}회째입니다.
      </div>
      <div style="font-size:20px;line-height:1.6;color:#d1d5db;margin-bottom:20px;">
        이 행동은 기록되어 선생님께 전달됩니다.
      </div>
      <button onclick="window.examAPI.backToExam()" style="padding:10px 20px;
        border:none;border-radius:6px;background:#2563eb;color:white;
        font-size:20px;cursor:pointer;">
        시험 화면으로 돌아가기
      </button>
    </body></html>`;
  warningWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  warningWin.on('closed', () => {
    warningWin = null;
  });
}

ipcMain.on('back-to-exam', () => {
  if (warningWin && !warningWin.isDestroyed()) {
    warningWin.close();
  }
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    if (!mainWindowRef.isKiosk()) mainWindowRef.setKiosk(true);
    mainWindowRef.show();
    mainWindowRef.focus();
  }
});

// 페이지 오른쪽 상단에 작은 새로고침/종료 버튼을 얹습니다.
// 버튼을 누르면 (사이트의 alert/confirm과는 무관한) 우리가 직접 그린
// 확인 팝업이 뜨고, "확인"을 눌러야 examctl:// 링크로 이동해서
// will-navigate에서 실제 동작(새로고침/종료)을 처리합니다.
const TOOLBAR_INJECT_SCRIPT = `
(function() {
  if (window.__examToolbarInjected) return;
  window.__examToolbarInjected = true;

  function showConfirmModal(message, onConfirm) {
    var old = document.getElementById('__exam_confirm_overlay__');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = '__exam_confirm_overlay__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;' +
      'background:rgba(0,0,0,0.55);display:flex;align-items:center;' +
      'justify-content:center;font-family:"Malgun Gothic",sans-serif;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#111;padding:22px 26px;' +
      'border-radius:10px;min-width:280px;max-width:80vw;text-align:center;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.3);';
    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:15px;line-height:1.6;margin-bottom:18px;';
    msg.textContent = message;
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';
    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = '확인';
    okBtn.style.cssText = 'padding:8px 20px;border:none;border-radius:6px;' +
      'background:#2563eb;color:#fff;font-size:14px;cursor:pointer;';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '취소';
    cancelBtn.style.cssText = 'padding:8px 20px;border:none;border-radius:6px;' +
      'background:#9ca3af;color:#fff;font-size:14px;cursor:pointer;';
    okBtn.onclick = function() { overlay.remove(); onConfirm(); };
    cancelBtn.onclick = function() { overlay.remove(); };
    btnRow.appendChild(okBtn);
    btnRow.appendChild(cancelBtn);
    box.appendChild(msg);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;' +
    'display:flex;gap:6px;font-family:"Malgun Gothic",sans-serif;';
  function makeBtn(label, title, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.textContent = label;
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
      'width:30px;height:30px;border-radius:6px;background:rgba(31,41,55,0.7);' +
      'border:none;color:#fff;font-size:16px;font-weight:bold;' +
      'cursor:pointer;user-select:none;';
    b.onclick = onClick;
    return b;
  }
  window.__examConfirmRefresh = function() {
    showConfirmModal('정말 새로고침 하시겠습니까?', function() {
      location.href = 'examctl://refresh';
    });
  };
  window.__examConfirmExit = function() {
    showConfirmModal('정말 종료하시겠습니까?', function() {
      location.href = 'examctl://exit';
    });
  };

  bar.appendChild(makeBtn('⟳', '새로고침', window.__examConfirmRefresh));
  bar.appendChild(makeBtn('✕', '종료', window.__examConfirmExit));
  (document.body || document.documentElement).appendChild(bar);

  // ── 붙여넣기 차단 ──────────────────────────────────────
  document.addEventListener('paste', function(e) {
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
`;

function attachGuards(win) {
  // 페이지가 새로 로드될 때마다 버튼/붙여넣기 차단을 다시 적용합니다.
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(TOOLBAR_INJECT_SCRIPT).catch(() => {});
  });

  // 화이트리스트 밖 주소로 "이동"하려는 시도 차단
  win.webContents.on('will-navigate', (event, url) => {
    // 우리가 얹은 새로고침/종료 버튼 클릭 처리
    if (url === 'examctl://refresh') {
      event.preventDefault();
      win.loadURL(START_URL);
      return;
    }
    if (url === 'examctl://exit') {
      event.preventDefault();
      app.quit();
      return;
    }
    if (!isAllowedUrl(url)) {
      event.preventDefault();
    }
  });

  // 새 창/팝업 요청 처리 (로그인 팝업 등만 허용)
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (isAllowedUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 500,
            height: 650,
            webPreferences: commonWebPreferences(),
          },
        };
      }
    } catch (e) {
      /* fallthrough to deny */
    }
    return { action: 'deny' };
  });

  // 우클릭 메뉴 차단 (개발자 도구 접근 경로 차단)
  win.webContents.on('context-menu', (e) => e.preventDefault());

  // 개발자 도구 + 전체화면 이탈 관련 단축키 차단.
  // (창 최소화/닫기 등 일반 창 조작 자체는 막지 않습니다.)
  win.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();

    // F5 / Ctrl+R: 바로 새로고침하지 않고, 툴바 버튼과 동일한 확인
    // 팝업을 띄운 뒤 "확인"을 눌러야 메인 페이지로 이동합니다.
    if ((key === 'f5' || (input.control && key === 'r')) && input.type === 'keyDown') {
      event.preventDefault();
      win.webContents
        .executeJavaScript('window.__examConfirmRefresh && window.__examConfirmRefresh()')
        .catch(() => {});
      return;
    }

    const blocked =
      (input.control && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
      key === 'f12' ||
      key === 'f11' ||               // 전체화면 토글로 키오스크 이탈 방지
      (input.alt && key === 'enter') || // Alt+Enter로 전체화면 토글 시도 방지
      (input.alt && key === 'f4') ||    // Alt+F4로 강제 종료 시도 방지
      (input.control && key === 'v') || // Ctrl+V 붙여넣기 차단
      (input.shift && key === 'insert'); // Shift+Insert 붙여넣기 차단
    if (blocked) {
      event.preventDefault();
    }
  });

  // 창이 포커스를 잃으면(다른 창/작업으로 전환되면) 이탈 경고 팝업을 띄웁니다.
  // 단, 새로 포커스를 받은 창이 "이 앱 자신의 다른 창"(로그인 팝업, 경고 팝업
  // 자신 등)이라면 이탈로 취급하지 않습니다.
  win.on('blur', () => {
    if (win.isDestroyed()) return;
    setTimeout(() => {
      if (win.isDestroyed()) return;
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && knownWindows.has(focused)) return; // 우리 앱 자신의 창 → 이탈 아님
      showExitWarning();
    }, 150);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: '해원고 전용 브라우저',
    fullscreen: true,   // 전체화면으로 시작
    kiosk: true,        // 작업표시줄까지 가리는 완전 전체화면 모드
    autoHideMenuBar: true,
    webPreferences: commonWebPreferences(),
  });

  // 주소창이 없는 전용 브라우저이므로 메뉴바만 숨깁니다.
  Menu.setApplicationMenu(null);

  win.loadURL(START_URL);
  attachGuards(win);

  mainWindowRef = win;
  win.on('closed', () => {
    if (mainWindowRef === win) mainWindowRef = null;
  });
}

// 시스템 전역 단축키를 가로채 무력화합니다 (창이 포커스를 잃은
// 상태에서도 동작). Alt+Tab 자체는 OS가 보호하는 조합이라 Electron
// 수준에서 완전히 못 막을 수 있지만, 등록되는 조합은 최대한 막습니다.
function registerGlobalGuards() {
  const combos = [
    'Alt+Tab',
    'Alt+Escape',
    'Super+D',
    'Super+E',
    'Super+R',
    'Super+S',
    'Super+X',
    'Super+Tab',
    'Control+Escape',
  ];
  combos.forEach((combo) => {
    try {
      globalShortcut.register(combo, () => {
        /* 아무 동작도 하지 않음 = 해당 단축키 무력화 */
      });
    } catch (e) {
      /* 일부 조합은 OS/환경에 따라 등록이 거부될 수 있음 — 무시 */
    }
  });
}

app.whenReady().then(() => {
  disableWinKey();
  createWindow();
  registerGlobalGuards();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 앱이 어떤 경로로 종료되든(정상 종료, 강제 종료 시도 등) 윈도우 키
// 설정을 원래대로 되돌립니다.
app.on('will-quit', () => {
  restoreWinKey();
  globalShortcut.unregisterAll();
});
app.on('before-quit', restoreWinKey);
