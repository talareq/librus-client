/**
 * Angular dev proxy (Node ustawia nagłówki po stronie serwera proxy).
 *
 * Wiadomości Librus „na desktopie”: przeglądarka NIE może wysłać własnego Cookie
 * do wiadomosci.librus.pl (zakaz Forbidden header). Trzeba nadać Cookie w proxy.
 *
 * Terminal (macOS/Linux):
 *   export LIBRU_WIAD_COOKIE='cookiesession1=...; DZIENNIKSID=...'
 *   npx ng serve
 *
 * Windows (PowerShell):
 *   $env:LIBRU_WIAD_COOKIE='cookiesession1=...; DZIENNIKSID=...'; npx ng serve
 */
module.exports = {
  '/api': {
    target: 'https://api.librus.pl',
    secure: false,
    changeOrigin: true,
    pathRewrite: {
      '^/api': '',
    },
  },
  '/lw-msg': {
    target: 'https://wiadomosci.librus.pl',
    secure: true,
    changeOrigin: true,
    pathRewrite: {
      '^/lw-msg': '/api/inbox/messages',
    },
    onProxyReq(proxyReq) {
      const c = process.env.LIBRU_WIAD_COOKIE || '';
      if (c.trim().length > 0) {
        proxyReq.setHeader('Cookie', c.trim());
      }
    },
  },
};
