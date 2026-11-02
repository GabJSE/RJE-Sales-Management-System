export function sensitiveLimit({ limit = 5, windowMs = 15 * 60000, key = req => String(req.user?._id || req.ip) } = {}) {
  const entries = new Map();
  return (req, res, next) => {
    const now = Date.now(); const identity = key(req); let entry = entries.get(identity);
    if (!entry || entry.until <= now) { for (const [id, value] of entries) if (value.until <= now) entries.delete(id); if (entries.size >= 10000) entries.delete(entries.keys().next().value); entry = { count: 0, until: now + windowMs }; entries.set(identity, entry); }
    if (++entry.count > limit) { res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000))); return res.status(429).json({ message: "Too many attempts. Please try again later." }); }
    next();
  };
}
