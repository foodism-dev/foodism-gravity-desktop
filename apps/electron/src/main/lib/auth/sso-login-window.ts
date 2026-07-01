export const SSO_LOGIN_CLOSE_URL = 'foodism-gravity://sso-login/close'

export interface SsoLoginWindowBounds {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export const SSO_LOGIN_WINDOW_BOUNDS: SsoLoginWindowBounds = {
  width: 560,
  height: 760,
  minWidth: 480,
  minHeight: 620,
}

export function isSsoLoginCloseUrl(url: string): boolean {
  return url === SSO_LOGIN_CLOSE_URL
}

export function buildSsoLoginCloseButtonScript(): string {
  return `
(() => {
  const closeUrl = ${JSON.stringify(SSO_LOGIN_CLOSE_URL)};
  const buttonId = 'proma-sso-close-button';
  const styleId = 'proma-sso-close-button-style';
  const desktopStyleId = 'proma-sso-desktop-style';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '#' + buttonId + ' {',
      '  all: initial;',
      '  box-sizing: border-box;',
      '  position: fixed;',
      '  top: max(14px, env(safe-area-inset-top));',
      '  right: max(14px, env(safe-area-inset-right));',
      '  z-index: 2147483647;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: auto;',
      '  max-width: 88px;',
      '  height: 32px;',
      '  min-width: 32px;',
      '  border: 0;',
      '  border-radius: 999px;',
      '  padding: 0 12px;',
      '  background: rgba(17, 24, 39, 0.82);',
      '  color: #fff;',
      '  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.22);',
      '  cursor: pointer;',
      '  font: 500 13px/32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '  backdrop-filter: blur(10px);',
      '}',
      '#' + buttonId + ':hover { background: rgba(17, 24, 39, 0.94); }',
      '#' + buttonId + ':focus-visible { outline: 2px solid rgba(22, 163, 74, 0.78); outline-offset: 2px; }',
      '@media (max-width: 420px) { #' + buttonId + ' { top: 10px; right: 10px; } }',
    ].join('\\n');
    document.documentElement.appendChild(style);
  }

  if (!document.getElementById(desktopStyleId)) {
    const desktopStyle = document.createElement('style');
    desktopStyle.id = desktopStyleId;
    desktopStyle.textContent = [
      'html, body {',
      '  width: 100% !important;',
      '  min-width: 0 !important;',
      '  overflow-x: hidden !important;',
      '  background: #f7fbf9 !important;',
      '}',
      'body {',
      '  margin: 0 !important;',
      '}',
      '#root, #app, main, body > div:first-child {',
      '  max-width: min(100vw, 560px) !important;',
      '  margin-left: auto !important;',
      '  margin-right: auto !important;',
      '}',
      '@media (min-width: 481px) {',
      '  body {',
      '    display: flex !important;',
      '    justify-content: center !important;',
      '  }',
      '}',
    ].join('\\n');
    document.documentElement.appendChild(desktopStyle);
  }

  const existingButton = document.getElementById(buttonId);
  if (existingButton) return;

  const button = document.createElement('button');
  button.id = buttonId;
  button.type = 'button';
  button.textContent = '关闭';
  button.setAttribute('aria-label', '关闭登录窗口');
  button.addEventListener('click', () => {
    window.location.href = closeUrl;
  });
  document.documentElement.appendChild(button);
})();
`
}
