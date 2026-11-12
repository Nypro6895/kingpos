/* QA build only: native interception covers HTTP resources. Document WebSockets
 * use only local Next HMR or the isolated Supabase realtime endpoint. */
(() => {
  if (window.__reylumiQaNetworkGuard) return;
  window.__reylumiQaNetworkGuard = true;
  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    window.WebSocket = class extends NativeWebSocket {
      constructor(value, ...args) {
        const url = new URL(String(value), location.href);
        const hmr = url.hostname === 'localhost' && url.port === '3117' && url.pathname === '/_next/webpack-hmr';
        const realtime = url.hostname === '127.0.0.1' && url.port === '55421' && url.pathname === '/realtime/v1/websocket';
        if (url.protocol !== 'ws:' || !(hmr || realtime) || url.username || url.password || url.hash) {
          throw new DOMException('Local QA blocks external WebSockets.', 'SecurityError');
        }
        super(value, ...args);
      }
    };
  }
})();
