// Relay of the hub's events to a gadget over USB: one JSON line per event or usage report on the ESP32's serial port.
// Line: {"type":"event"|"usage","body":{...}}\n  (body = the POST body, same wire format as over Wi-Fi).
// The hub owns the COM port: release() lets another tool (pio upload, hmi_bridge) take it, reopen() takes it back.
// Needs the optional `serialport` package, loaded only when the port is opened.

export const SETTLE_MS = 2500;      // opening the port resets the ESP32: it needs about 2.5 s before it reads again
export const RETRY_MS = 5000;       // reconnect delay when the port is missing or lost

async function defaultOpen(path, baud) {
  let mod;
  try { mod = await import('serialport'); } catch { throw new Error('serialport package not installed (run: npm install serialport, in agent-hub)'); }
  return new Promise((resolve, reject) => {
    const port = new mod.SerialPort({ path, baudRate: baud, autoOpen: false });
    port.open((err) => (err ? reject(err) : resolve(port)));
  });
}

/**
 * @param {{path: string, baud?: number, open?: (path: string, baud: number) => Promise<object>, settleMs?: number, retryMs?: number, maxQueue?: number}} opts
 * `open` returns a port with write(data, cb), close(cb) and on('error'|'close', fn).
 * @returns {{start: () => void, send: (route: '/event'|'/usage', body: object) => void, release: () => void, reopen: () => void,
 *   status: () => {ok: boolean, connected: boolean, released: boolean, lastError: string, queued: number}}}
 */
export function createSerialRelay({ path, baud = 115200, open = defaultOpen, settleMs = SETTLE_MS, retryMs = RETRY_MS, maxQueue = 50 }) {
  let port = null;
  let connecting = false;
  let ready = false;                  // the settle time after open has passed
  let released = false;
  let lastError = '';
  let queue = [];
  let retryTimer = null;
  let settleTimer = null;

  const unref = (t) => { t.unref?.(); return t; };

  function scheduleRetry() {
    if (released || retryTimer) return;
    retryTimer = unref(setTimeout(() => { retryTimer = null; connect(); }, retryMs));
  }

  function drop(error) {
    if (!port) return;
    port = null;
    ready = false;
    lastError = error;
    clearTimeout(settleTimer);
    scheduleRetry();
  }

  function flush() {
    while (port && ready && queue.length) {
      const item = queue.shift();
      const p = port;
      p.write(`${JSON.stringify({ type: item.type, body: item.body })}\n`, (err) => { if (err && port === p) drop(String(err.message ?? err)); });
    }
  }

  function connect() {
    if (released || connecting || port) return;
    connecting = true;
    open(path, baud).then((p) => {
      connecting = false;
      if (released) { p.close?.(() => {}); return; }
      port = p;
      lastError = '';
      p.on('error', (e) => { if (port === p) drop(String(e?.message ?? e)); });
      p.on('close', () => { if (port === p) drop('port closed'); });
      settleTimer = unref(setTimeout(() => { ready = true; flush(); }, settleMs));
    }).catch((e) => {
      connecting = false;
      lastError = String(e?.message ?? e);
      scheduleRetry();
    });
  }

  function coalesce() {               // keep the latest item per key, in order
    const seen = new Set();
    const kept = [];
    for (let i = queue.length - 1; i >= 0; i--) if (!seen.has(queue[i].key)) { seen.add(queue[i].key); kept.push(queue[i]); }
    queue = kept.reverse();
  }

  return {
    start: connect,
    send(route, body) {
      queue.push({ type: route === '/usage' ? 'usage' : 'event', body, key: route === '/usage' ? 'usage' : `${body.session}:${body.agent}` });
      if (queue.length > maxQueue) { coalesce(); if (queue.length > maxQueue) queue = queue.slice(-maxQueue); }
      flush();
    },
    release() {
      released = true;
      clearTimeout(retryTimer);
      retryTimer = null;
      clearTimeout(settleTimer);
      ready = false;
      if (port) { const p = port; port = null; p.close?.(() => {}); }
    },
    reopen() { released = false; connect(); },
    status: () => ({ ok: port !== null && lastError === '', connected: port !== null, released, lastError, queued: queue.length }),
  };
}
