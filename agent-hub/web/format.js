// Text formats shared by the screen, the terminal view and the page. Same output as the firmware.

/** "999", "12k", "1.6M" (modelFormatTokens). */
export function formatTokens(t) {
  if (t < 1000) return String(t);
  if (t < 1000000) return `${Math.floor((t + 500) / 1000)}k`;
  const tenths = Math.floor((t + 50000) / 100000);
  return `${Math.floor(tenths / 10)}.${tenths % 10}M`;
}

/** "12s", "1m04", "2h05m" (modelFormatAge). */
export function formatAge(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60 < 10 ? '0' : ''}${sec % 60}`;
  return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

/** "45m", "1h20", "2d03h" (quota reset times of the bottom bar). */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.trunc(seconds));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.floor(s / 86400)}d${String(Math.floor((s % 86400) / 3600)).padStart(2, '0')}h`;
}

/** Status line under the screen for the relay to the gadget: {text, ok, why} or null when there is no relay. */
export function relayLabel(relay) {
  if (!relay || relay.mode === 'none') return null;
  if (relay.mode === 'serial') {
    const text = relay.released ? 'USB released' : relay.connected ? 'USB connected' : 'USB not connected';
    return { text, ok: Boolean(relay.connected), why: relay.lastError || '' };
  }
  return { text: relay.ok ? 'gadget connected' : 'gadget unreachable', ok: Boolean(relay.ok), why: relay.lastError || '' };
}
