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
    const subscription = await userOps.getSubscriptionStatus(userId);

    // Paid users with active subscription have unlimited access
    if (subscription && subscription.tier !== 'free' && subscription.isActive) {
      return { allowed: true, remaining: -1, tier: subscription.tier };
    }

    // Free users get 30 per month (temporarily increased for testing)
    const usage = await usageOps.getUsage(userId);
    const allowed = usage < 30;
    const remaining = Math.max(0, 30 - usage);

    return { allowed, remaining, tier: 'free', used: usage };
  }
};

module.exports = {
  userOps,
  usageOps
};
