const supabase = require('./supabase-admin'); // Use admin client for server-side operations

// User operations
const userOps = {
  findByEmail: async (email) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding user by email:', error);
      return null;
    }
    return data;
  },

  findById: async (id) => {
    const { data, error} = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding user by ID:', error);
      return null;
    }
    return data;
  },

  // Ensure profile exists, create if not (fallback for when triggers don't work)
  ensureProfile: async (userId) => {
    // Check if profile already exists
    let profile = await userOps.findById(userId);
    if (profile) return profile;

    // Profile doesn't exist, get user from auth and create profile
    try {
      const { data: authData } = await supabase.auth.admin.listUsers();
      const authUser = authData.users.find(u => u.id === userId);

      if (!authUser) {
        console.error('User not found in auth.users:', userId);
        return null;
      }

      // Create profile
      const { data: newProfile, error } = await supabase
        .from('profiles')
        .insert({
          id: authUser.id,
          email: authUser.email,
          subscription_tier: 'free',
          custom_monthly_limit: null // Will use default 3
        })
        .select()
        .single();

      if (error) {
        console.error('Error auto-creating profile:', error);
        return null;
      }

      console.log('Auto-created profile for user:', authUser.email);
      return newProfile;
    } catch (err) {
      console.error('Error in ensureProfile:', err);
      return null;
    }
  },

  updateSubscription: async (userId, tier, expiresAt) => {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        subscription_tier: tier,
        subscription_expires_at: expiresAt
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating subscription:', error);
      throw error;
    }
    return data;
  },

  getSubscriptionStatus: async (userId) => {
    const user = await userOps.findById(userId);
    if (!user) return null;

    if (user.subscription_tier === 'free') {
      return { tier: 'free', isActive: true };
    }

    const now = new Date();
    const expiresAt = user.subscription_expires_at ? new Date(user.subscription_expires_at) : null;
    const isActive = expiresAt && expiresAt > now;

    return {
      tier: user.subscription_tier,
      isActive: isActive,
      expiresAt: expiresAt
    };
  },

  applyPromoCode: async (userId, promoCode) => {
    const user = await userOps.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if promo code already used
    const usedCodes = user.promo_codes_used || [];
    if (usedCodes.includes(promoCode)) {
      throw new Error('Promo code already used');
    }

    // Validate promo code
    if (promoCode === 'FIRST999') {
      // Add promo code to used list and set custom limit to 30
      const updatedCodes = [...usedCodes, promoCode];

      const { data, error } = await supabase
        .from('profiles')
        .update({
          promo_codes_used: updatedCodes,
          custom_monthly_limit: 30
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        console.error('Error applying promo code:', error);
        throw error;
      }

      return {
        success: true,
        newLimit: 30,
        message: 'Promo code applied! You now have 30 cover letters for this month.'
      };
    } else {
      throw new Error('Invalid promo code');
    }
  }
};

// Usage operations
const usageOps = {
  getCurrentMonth: () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },

  getUsage: async (userId) => {
    const month = usageOps.getCurrentMonth();

    const { data, error } = await supabase
      .from('usage')
      .select('count')
      .eq('user_id', userId)
      .eq('month', month)
      .single();

    if (error && error.code === 'PGRST116') {
      // No record found, create one
      const { data: newData, error: insertError } = await supabase
        .from('usage')
        .insert({ user_id: userId, month: month, count: 0 })
        .select('count')
        .single();

      if (insertError) {
        console.error('Error creating usage record:', insertError);
        return 0;
      }
      return newData?.count || 0;
    }

    if (error) {
      console.error('Error getting usage:', error);
      return 0;
    }

    return data?.count || 0;
  },

  incrementUsage: async (userId) => {
    const month = usageOps.getCurrentMonth();

    // Try to update existing record
    const { data: existing } = await supabase
      .from('usage')
      .select('id, count')
      .eq('user_id', userId)
      .eq('month', month)
      .single();

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('usage')
        .update({ count: existing.count + 1 })
        .eq('id', existing.id);

      if (error) {
        console.error('Error incrementing usage:', error);
      }
    } else {
      // Create new
      const { error } = await supabase
        .from('usage')
        .insert({ user_id: userId, month: month, count: 1 });

      if (error) {
        console.error('Error creating usage record:', error);
      }
    }

    return usageOps.getUsage(userId);
  },

  canGenerate: async (userId) => {
    // Ensure profile exists (auto-create if trigger failed)
    const user = await userOps.ensureProfile(userId);
    const subscription = await userOps.getSubscriptionStatus(userId);

    // Paid users with active subscription have unlimited access
    if (subscription && subscription.tier !== 'free' && subscription.isActive) {
      return { allowed: true, remaining: -1, tier: subscription.tier };
    }

    // Check if user has custom monthly limit from promo code
    const monthlyLimit = user?.custom_monthly_limit || 3;

    // Free users get 3 per month (or custom limit from promo code)
    const usage = await usageOps.getUsage(userId);
    const allowed = usage < monthlyLimit;
    const remaining = Math.max(0, monthlyLimit - usage);

    return { allowed, remaining, tier: 'free', used: usage, limit: monthlyLimit };
  }
};

// Analytics operations
const analyticsOps = {
  // Track a scraping attempt
  trackScrapingAttempt: async (userId, jobUrl, method, isFree, success, errorMessage = null) => {
    try {
      const { error } = await supabase
        .from('scraping_analytics')
        .insert({
          user_id: userId,
          job_url: jobUrl,
          scraping_method: method,
          is_free_method: isFree,
          success: success,
          error_message: errorMessage
        });

      if (error) {
        console.error('Error tracking scraping attempt:', error);
      }
    } catch (err) {
      console.error('Error tracking scraping attempt:', err);
    }
  },

  // Track a cover letter generation attempt
  trackGenerationAttempt: async (userId, jobUrl, isManual, success, errorMessage = null, timeMs = null) => {
    try {
      const { error } = await supabase
        .from('generation_analytics')
        .insert({
          user_id: userId,
          job_url: jobUrl,
          is_manual_paste: isManual,
          success: success,
          error_message: errorMessage,
          generation_time_ms: timeMs
        });

      if (error) {
        console.error('Error tracking generation attempt:', error);
      }
    } catch (err) {
      console.error('Error tracking generation attempt:', err);
    }
  },

  // Get scraping analytics (grouped by method and free/paid)
  getScrapingAnalytics: async (rangeType = 'all') => {
    try {
      let query = supabase
        .from('scraping_analytics')
        .select('scraping_method, is_free_method, success');

      // Apply date filter based on range type
      if (rangeType === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        query = query.gte('created_at', today.toISOString());
      } else if (rangeType === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        query = query.gte('created_at', weekAgo.toISOString());
      } else if (rangeType === 'month') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        query = query.gte('created_at', monthAgo.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting scraping analytics:', error);
        return { total: 0, freeMethods: {}, paidMethods: {} };
      }

      // Aggregate the data
      const stats = {
        total: data.length,
        freeMethods: {},
        paidMethods: {}
      };

      data.forEach(row => {
        const method = row.scraping_method;
        const isFree = row.is_free_method;
        const category = isFree ? 'freeMethods' : 'paidMethods';

        if (!stats[category][method]) {
          stats[category][method] = { total: 0, successful: 0, failed: 0 };
        }

        stats[category][method].total++;
        if (row.success) {
          stats[category][method].successful++;
        } else {
          stats[category][method].failed++;
        }
      });

      return stats;
    } catch (err) {
      console.error('Error getting scraping analytics:', err);
      return { total: 0, freeMethods: {}, paidMethods: {} };
    }
  },

  // Get user activity analytics (grouped by user)
  getUserActivity: async (rangeType = 'all') => {
    try {
      let query = supabase
        .from('generation_analytics')
        .select('user_id, job_url, is_manual_paste, success');

      // Apply date filter based on range type
      if (rangeType === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        query = query.gte('created_at', today.toISOString());
      } else if (rangeType === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        query = query.gte('created_at', weekAgo.toISOString());
      } else if (rangeType === 'month') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        query = query.gte('created_at', monthAgo.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting user activity:', error);
        return { data: [] };
      }

      // Aggregate by user
      const userMap = {};

      data.forEach(row => {
        const userId = row.user_id;

        if (!userMap[userId]) {
          userMap[userId] = {
            userId: userId,
            totalAttempts: 0,
            successfulGenerations: 0,
            failedGenerations: 0,
            methodBreakdown: {
              url: 0,
              manual: 0
            }
          };
        }

        userMap[userId].totalAttempts++;

        if (row.success) {
          userMap[userId].successfulGenerations++;
        } else {
          userMap[userId].failedGenerations++;
        }

        if (row.is_manual_paste) {
          userMap[userId].methodBreakdown.manual++;
        } else {
          userMap[userId].methodBreakdown.url++;
        }
      });

      return {
        data: Object.values(userMap)
      };
    } catch (err) {
      console.error('Error getting user activity:', err);
      return { data: [] };
    }
  },

  // Get top 10 users by successful cover letter generations
  getTopUsers: async () => {
    try {
      // Get all successful generations from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('generation_analytics')
        .select('user_id, success')
        .eq('success', true)
        .gte('created_at', thirtyDaysAgo.toISOString());

      if (error) {
        console.error('Error getting top users:', error);
        return { data: [] };
      }

      // Count successful runs per user
      const userCounts = {};
      data.forEach(row => {
        const userId = row.user_id;
        userCounts[userId] = (userCounts[userId] || 0) + 1;
      });

      // Convert to array and sort by count
      const topUsers = Object.entries(userCounts)
        .map(([userId, count]) => ({ userId, successfulRuns: count }))
        .sort((a, b) => b.successfulRuns - a.successfulRuns)
        .slice(0, 10); // Top 10

      return { data: topUsers };
    } catch (err) {
      console.error('Error getting top users:', err);
      return { data: [] };
    }
  },

  // Get user segmentation by usage tiers in past 30 days
  getUserSegmentation: async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('generation_analytics')
        .select('user_id')
        .gte('created_at', thirtyDaysAgo.toISOString());

      if (error) {
        console.error('Error getting user segmentation:', error);
        return {
          tier1: 0,  // < 10 runs
          tier2: 0,  // 11-30 runs
          tier3: 0,  // 31-100 runs
          tier4: 0   // > 100 runs
        };
      }

      // Count runs per user
      const userCounts = {};
      data.forEach(row => {
        const userId = row.user_id;
        userCounts[userId] = (userCounts[userId] || 0) + 1;
      });

      // Segment users by usage tiers
      const segmentation = {
        tier1: 0,  // < 10 runs
        tier2: 0,  // 11-30 runs
        tier3: 0,  // 31-100 runs
        tier4: 0   // > 100 runs
      };

      Object.values(userCounts).forEach(count => {
        if (count < 10) {
          segmentation.tier1++;
        } else if (count >= 11 && count <= 30) {
          segmentation.tier2++;
        } else if (count >= 31 && count <= 100) {
          segmentation.tier3++;
        } else {
          segmentation.tier4++;
        }
      });

      return segmentation;
    } catch (err) {
      console.error('Error getting user segmentation:', err);
      return {
        tier1: 0,
        tier2: 0,
        tier3: 0,
        tier4: 0
      };
    }
  }
};

module.exports = {
  userOps,
  usageOps,
  analyticsOps
};
