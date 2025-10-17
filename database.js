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

  CREATE TABLE IF NOT EXISTS scraping_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    month TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(method, month)
  );

  CREATE TABLE IF NOT EXISTS user_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    method TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage(user_id, month);
  CREATE INDEX IF NOT EXISTS idx_scraping_analytics_method_month ON scraping_analytics(method, month);
  CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at);
  CREATE INDEX IF NOT EXISTS idx_user_activity_status ON user_activity(status);
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

// Scraping analytics operations
const analyticsOps = {
  getCurrentMonth: () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },

  trackSuccess: (method) => {
    const month = analyticsOps.getCurrentMonth();

    // Try to increment existing record
    const result = db.prepare(`
      UPDATE scraping_analytics
      SET count = count + 1, updated_at = strftime('%s', 'now')
      WHERE method = ? AND month = ?
    `).run(method, month);

    // If no existing record, create one
    if (result.changes === 0) {
      db.prepare(`
        INSERT INTO scraping_analytics (method, month, count)
        VALUES (?, ?, 1)
      `).run(method, month);
    }
  },

  getStats: (month = null) => {
    const targetMonth = month || analyticsOps.getCurrentMonth();

    const stats = db.prepare(`
      SELECT method, count
      FROM scraping_analytics
      WHERE month = ?
      ORDER BY count DESC
    `).all(targetMonth);

    // Convert to object format
    const result = {
      month: targetMonth,
      total: 0,
      methods: {}
    };

    stats.forEach(row => {
      result.methods[row.method] = row.count;
      result.total += row.count;
    });

    return result;
  },

  getAllMonthsStats: () => {
    const stats = db.prepare(`
      SELECT month, method, count
      FROM scraping_analytics
      ORDER BY month DESC, count DESC
    `).all();

    // Group by month
    const result = {};
    stats.forEach(row => {
      if (!result[row.month]) {
        result[row.month] = {
          month: row.month,
          total: 0,
          methods: {}
        };
      }
      result[row.month].methods[row.method] = row.count;
      result[row.month].total += row.count;
    });

    return result;
  }
};

// User activity tracking operations
const userActivityOps = {
  track: (userId, activityType, method, status, errorMessage = null) => {
    db.prepare(`
      INSERT INTO user_activity (user_id, activity_type, method, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, activityType, method, status, errorMessage);
  },

  getStats: (startTimestamp = null, endTimestamp = null) => {
    let query = `
      SELECT
        user_id,
        activity_type,
        method,
        status,
        COUNT(*) as count
      FROM user_activity
      WHERE 1=1
    `;

    const params = [];

    if (startTimestamp) {
      query += ` AND created_at >= ?`;
      params.push(startTimestamp);
    }

    if (endTimestamp) {
      query += ` AND created_at <= ?`;
      params.push(endTimestamp);
    }

    query += ` GROUP BY user_id, activity_type, method, status ORDER BY user_id, count DESC`;

    return db.prepare(query).all(...params);
  },

  getUserStats: (userId, startTimestamp = null, endTimestamp = null) => {
    let query = `
      SELECT
        activity_type,
        method,
        status,
        COUNT(*) as count
      FROM user_activity
      WHERE user_id = ?
    `;

    const params = [userId];

    if (startTimestamp) {
      query += ` AND created_at >= ?`;
      params.push(startTimestamp);
    }

    if (endTimestamp) {
      query += ` AND created_at <= ?`;
      params.push(endTimestamp);
    }

    query += ` GROUP BY activity_type, method, status ORDER BY count DESC`;

    const rows = db.prepare(query).all(...params);

    // Format the data
    const result = {
      userId: userId,
      totalAttempts: 0,
      successfulGenerations: 0,
      failedGenerations: 0,
      methodBreakdown: {
        url: 0,
        manual: 0
      }
    };

    rows.forEach(row => {
      result.totalAttempts += row.count;

      if (row.status === 'success') {
        result.successfulGenerations += row.count;
      } else if (row.status === 'failed') {
        result.failedGenerations += row.count;
      }

      if (row.method) {
        if (row.method === 'url') {
          result.methodBreakdown.url += row.count;
        } else if (row.method === 'manual') {
          result.methodBreakdown.manual += row.count;
        }
      }
    });

    return result;
  },

  getAllUsersStats: (startTimestamp = null, endTimestamp = null) => {
    let query = `
      SELECT
        user_id,
        activity_type,
        method,
        status,
        COUNT(*) as count
      FROM user_activity
      WHERE 1=1
    `;

    const params = [];

    if (startTimestamp) {
      query += ` AND created_at >= ?`;
      params.push(startTimestamp);
    }

    if (endTimestamp) {
      query += ` AND created_at <= ?`;
      params.push(endTimestamp);
    }

    query += ` GROUP BY user_id, activity_type, method, status ORDER BY user_id`;

    const rows = db.prepare(query).all(...params);

    // Group by user
    const result = {};
    rows.forEach(row => {
      if (!result[row.user_id]) {
        result[row.user_id] = {
          userId: row.user_id,
          totalAttempts: 0,
          successfulGenerations: 0,
          failedGenerations: 0,
          methodBreakdown: {
            url: 0,
            manual: 0
          }
        };
      }

      result[row.user_id].totalAttempts += row.count;

      if (row.status === 'success') {
        result[row.user_id].successfulGenerations += row.count;
      } else if (row.status === 'failed') {
        result[row.user_id].failedGenerations += row.count;
      }

      if (row.method) {
        if (row.method === 'url') {
          result[row.user_id].methodBreakdown.url += row.count;
        } else if (row.method === 'manual') {
          result[row.user_id].methodBreakdown.manual += row.count;
        }
      }
    });

    return Object.values(result);
  }
};

// Enhanced analytics operations with date range support
const analyticsOpsEnhanced = {
  ...analyticsOps,

  getStatsByDateRange: (startTimestamp, endTimestamp) => {
    const query = `
      SELECT
        method,
        SUM(count) as total_count
      FROM scraping_analytics
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY method
      ORDER BY total_count DESC
    `;

    const rows = db.prepare(query).all(startTimestamp, endTimestamp);

    const result = {
      total: 0,
      methods: {}
    };

    rows.forEach(row => {
      result.methods[row.method] = row.total_count;
      result.total += row.total_count;
    });

    return result;
  }
};

module.exports = {
  db,
  userOps,
  usageOps,
  analyticsOps: analyticsOpsEnhanced,
  userActivityOps
};
