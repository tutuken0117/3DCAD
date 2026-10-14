import type { App } from './App';

/**
 * デスクトップ（PC・タブレット）のアプリとして使うための仕組み（PWA）。
 * - サービスワーカー: 一度開けばネットにつながっていなくても起動できる
 * - インストール: Chrome / Edge の「アプリとしてインストール」で、専用のウィンドウとアイコンで起動
 * - ファイルを開く: インストール後、.3dcad / .jww / .dxf / .sfc をダブルクリックで開ける
 */

declare const __BUILD_ID__: string;

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface LaunchParams {
  files?: { getFile(): Promise<File> }[];
}

let deferred: InstallPromptEvent | null = null;

/** インストール済み（専用ウィンドウで動いている）か */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** すぐに呼ぶ（インストールの案内イベントを取りこぼさないため） */
export function setupPwa(app: App): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(`./sw.js?v=${__BUILD_ID__}`).catch((e) => console.warn('サービスワーカーの登録に失敗', e));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    app.ui.setInstallable(true);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    app.ui.setInstallable(false);
    app.ui.toast('インストールしました。デスクトップ・スタートメニュー（Mac は Launchpad）の「3DCAD」から起動できます', 9000);
  });
  if (isStandalone()) document.documentElement.classList.add('standalone');
}

/** インストールの確認画面を出す（ブラウザが対応していなければ手順を案内） */
export async function promptInstall(app: App): Promise<void> {
  if (deferred) {
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    app.ui.setInstallable(false);
    return;
  }
  if (isStandalone()) {
    app.ui.toast('すでにアプリとして起動しています');
    return;
  }
  app.ui.showPanel('help');
  document.querySelector('#install-help')?.scrollIntoView({ behavior: 'smooth' });
}

/**
 * 起動時に渡されたファイル（ダブルクリック・アイコンへのドロップ）やショートカットを処理する。
 * ファイルを開いたら true（前回の続きの復元はしない）。
 */
export function handleLaunch(app: App): Promise<boolean> {
  const q = new URLSearchParams(location.search);
  if (q.get('sample') === 'house') {
    void app.loadHouseSample();
    return Promise.resolve(true);
  }
  const lq = (window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
  if (!lq || !isStandalone()) return Promise.resolve(false);
  return new Promise((resolve) => {
    // ファイルなしで起動した場合は、少し待っても何も来ない
    const timer = setTimeout(() => resolve(false), 500);
    lq.setConsumer(async (params) => {
      if (!params.files?.length) return;
      clearTimeout(timer);
      resolve(true);
      for (const h of params.files) await app.openAnyFile(await h.getFile());
    });
  });
}
