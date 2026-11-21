// Outgoing message safeguards shared by every member using a WhatsApp number.
// In-process state is authoritative because each WhatsApp number has exactly one session manager.
// These limits are configurable guard rails, NOT guaranteed-safe thresholds against WhatsApp enforcement.
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const LIMITS = {
  perNumberPerMinute: num(process.env.WA_SEND_LIMIT_PER_NUMBER_MIN, 30),
  perNumberPerHour: num(process.env.WA_SEND_LIMIT_PER_NUMBER_HOUR, 600),
  perMemberPerMinute: num(process.env.WA_SEND_LIMIT_PER_MEMBER_MIN, 20),
  duplicateWindowMs: num(process.env.WA_DUPLICATE_WINDOW_SEC, 10) * 1000
};

const windows = new Map();   // key -> [timestamps]
const recent = new Map();    // `${accountId}|${jid}|${text}` -> ts (identical-content guard)
const inflight = new Map();  // idempotency key -> { promise, at }

const hits = (key, spanMs, now) => {
  const list = (windows.get(key) || []).filter(t => now - t < spanMs);
  windows.set(key, list);
  return list;
};

function fail(message) {
  const err = new Error(message);
  err.status = 429;
  return err;
}

// Throws (status 429) when a send would exceed a limit; records it otherwise.
function check({ accountId, userId, jid, text }) {
  const now = Date.now();
  if (hits(`n:${accountId}`, 60000, now).length >= LIMITS.perNumberPerMinute ||
      hits(`h:${accountId}`, 3600000, now).length >= LIMITS.perNumberPerHour) {
    throw fail('Sending limit reached for this WhatsApp number. Please wait before sending more messages.');
  }
  if (hits(`m:${userId}`, 60000, now).length >= LIMITS.perMemberPerMinute) {
    throw fail('You are sending too quickly. Please wait a moment.');
  }
  if (text) {
    const dupKey = `${accountId}|${jid}|${text}`;
    if (now - (recent.get(dupKey) || 0) < LIMITS.duplicateWindowMs) {
      throw fail('This exact message was just sent to this chat. Duplicate blocked.');
    }
    recent.set(dupKey, now);
  }
  for (const k of [`n:${accountId}`, `h:${accountId}`, `m:${userId}`]) windows.get(k).push(now);
}

// Same idempotency key from the same user returns the original result instead of sending twice.
function once(userId, key, fn) {
  if (!key) return fn();
  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at > 10 * 60000) inflight.delete(k);
  const id = `${userId}|${String(key).slice(0, 100)}`;
  if (inflight.has(id)) return inflight.get(id).promise;
  const promise = Promise.resolve().then(fn);
  inflight.set(id, { promise, at: now });
  // Failed or blocked sends may be retried with the same key
  promise.then(r => { if (r == null) inflight.delete(id); }, () => inflight.delete(id));
  return promise;
}

const reset = () => { windows.clear(); recent.clear(); inflight.clear(); };

module.exports = { check, once, reset, LIMITS };
