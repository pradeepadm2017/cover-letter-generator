const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

// Initialize database
const db = new Database(path.join(__dirname, 'users.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    provider TEXT,
    provider_id TEXT,
    password TEXT,
    subscription_tier TEXT DEFAULT 'free',
    subscription_expires_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, month)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage(user_id, month);
`);

// User operations
const userOps = {
  findByEmail: (email) => {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  findById: (id) => {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  create: (email, provider, providerId) => {
    const result = db.prepare(`
      INSERT INTO users (email, provider, provider_id, subscription_tier)
      VALUES (?, ?, ?, 'free')
    `).run(email, provider, providerId);
    return result.lastInsertRowid;
  },

  createLocal: async (email, password) => {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare(`
      INSERT INTO users (email, provider, password, subscription_tier)
      VALUES (?, 'local', ?, 'free')
    `).run(email, hashedPassword);
    return result.lastInsertRowid;
  },

  validatePassword: async (email, password) => {
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND provider = ?').get(email, 'local');
    if (!user || !user.password) return null;

    const isValid = await bcrypt.compare(password, user.password);
    return isValid ? user : null;
  },

  updateSubscription: (userId, tier, expiresAt) => {
    return db.prepare(`
      UPDATE users
      SET subscription_tier = ?, subscription_expires_at = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `).run(tier, expiresAt, userId);
  },

  getSubscriptionStatus: (userId) => {
    const user = db.prepare('SELECT subscription_tier, subscription_expires_at FROM users WHERE id = ?').get(userId);
    if (!user) return null;

    if (user.subscription_tier === 'free') {
      return { tier: 'free', isActive: true };
    }

    const now = Math.floor(Date.now() / 1000);
    const isActive = user.subscription_expires_at && user.subscription_expires_at > now;

    return {
      tier: user.subscription_tier,
      isActive: isActive,
      expiresAt: user.subscription_expires_at
    };
  }
};

// Usage operations
const usageOps = {
  getCurrentMonth: () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },

  getUsage: (userId) => {
    const month = usageOps.getCurrentMonth();
    let usage = db.prepare('SELECT count FROM usage WHERE user_id = ? AND month = ?').get(userId, month);

    if (!usage) {
      db.prepare('INSERT INTO usage (user_id, month, count) VALUES (?, ?, 0)').run(userId, month);
      usage = { count: 0 };
    }

    return usage.count;
  },

  incrementUsage: (userId) => {
    const month = usageOps.getCurrentMonth();

    // Try to increment existing record
    const result = db.prepare(`
      UPDATE usage
      SET count = count + 1
      WHERE user_id = ? AND month = ?
    `).run(userId, month);

    // If no existing record, create one
    if (result.changes === 0) {
      db.prepare('INSERT INTO usage (user_id, month, count) VALUES (?, ?, 1)').run(userId, month);
    }

    return usageOps.getUsage(userId);
  },

  canGenerate: (userId) => {
    const subscription = userOps.getSubscriptionStatus(userId);

    // Paid users with active subscription have unlimited access
    if (subscription && subscription.tier !== 'free' && subscription.isActive) {
      return { allowed: true, remaining: -1, tier: subscription.tier };
    }

    // Free users get 3 per month
    const usage = usageOps.getUsage(userId);
    const allowed = usage < 3;
    const remaining = Math.max(0, 3 - usage);

    return { allowed, remaining, tier: 'free', used: usage };
  }
};

module.exports = {
  db,
  userOps,
  usageOps
};
