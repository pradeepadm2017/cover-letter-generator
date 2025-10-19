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
          custom_monthly_limit: null // Will use default 10
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

    // Validate promo code and determine limit
    let customLimit;
    let promoMessage;
    let promoExpiryDate = null;

    if (promoCode === 'FIRST999') {
      customLimit = 30;
      promoMessage = 'Promo code applied! You now have 30 cover letters for this month.';
      // FIRST999 is permanent (no expiry)
    } else if (promoCode === 'ALLTHEBEST100') {
      customLimit = 100;
      // Set expiry to 30 days from now
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);
      promoExpiryDate = expiryDate.toISOString();
      promoMessage = `Promo code applied! You now have 100 cover letters for the next 30 days (until ${expiryDate.toLocaleDateString()}).`;
    } else {
      throw new Error('Invalid promo code');
    }

    // Add promo code to used list and set custom limit
    const updatedCodes = [...usedCodes, promoCode];

    const updateData = {
      promo_codes_used: updatedCodes,
      custom_monthly_limit: customLimit
    };

    // Add expiry date if applicable
    if (promoExpiryDate) {
      updateData.promo_expiry_date = promoExpiryDate;
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error applying promo code:', error);
      throw error;
    }

    return {
      success: true,
      newLimit: customLimit,
      expiryDate: promoExpiryDate,
      message: promoMessage
    };
  },

  // Get user profile header settings
  getProfile: async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('email, full_name, credentials, city, phone, linkedin_url, header_template, header_color, header_font, header_font_size, body_font, body_font_size, page_border')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error getting profile:', error);
      return null;
    }

    // Return profile with defaults if fields are null
    return {
      email: data.email || '',
      full_name: data.full_name || '',
      credentials: data.credentials || '',
      city: data.city || '',
      phone: data.phone || '',
      linkedin_url: data.linkedin_url || '',
      header_template: data.header_template || 'center',
      header_color: data.header_color || '#000000',
      header_font: data.header_font || 'Calibri',
      header_font_size: data.header_font_size || 16,
      body_font: data.body_font || 'Calibri',
      body_font_size: data.body_font_size || 12,
      page_border: data.page_border || 'narrow'
    };
  },

  // Update user profile header settings
  updateProfile: async (userId, profileData) => {
    // Use upsert to insert if doesn't exist or update if it does
    const { data, error} = await supabase
      .from('profiles')
      .upsert({
        id: userId, // Must include id for upsert
        email: profileData.email || null,
        full_name: profileData.full_name || null,
        credentials: profileData.credentials || null,
        city: profileData.city || null,
        phone: profileData.phone || null,
        linkedin_url: profileData.linkedin_url || null,
        header_template: profileData.header_template || 'center',
        header_color: profileData.header_color || '#000000',
        header_font: profileData.header_font || 'Calibri',
        header_font_size: profileData.header_font_size || 16,
        body_font: profileData.body_font || 'Calibri',
        body_font_size: profileData.body_font_size || 12,
        page_border: profileData.page_border || 'narrow'
      }, {
        onConflict: 'id' // Specify which column is the unique constraint
      })
      .select('email, full_name, credentials, city, phone, linkedin_url, header_template, header_color, header_font, header_font_size, body_font, body_font_size, page_border')
      .single();

    if (error) {
      console.error('Error updating/creating profile:', error);
      throw error;
    }

    return data;
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

    // Use atomic increment with raw SQL to avoid race conditions
    // First try to insert if not exists, then increment
    const { data, error } = await supabase.rpc('increment_usage', {
      p_user_id: userId,
      p_month: month
    });

    if (error) {
      // If RPC doesn't exist, fall back to manual approach with upsert
      console.log('RPC not available, using upsert approach');

      const { error: upsertError } = await supabase
        .from('usage')
        .upsert(
          { user_id: userId, month: month, count: 1 },
          {
            onConflict: 'user_id,month',
            ignoreDuplicates: false
          }
        );

      if (upsertError) {
        console.error('Error incrementing usage with upsert:', upsertError);

        // Last resort: try the old approach
        const { data: existing } = await supabase
          .from('usage')
          .select('id, count')
          .eq('user_id', userId)
          .eq('month', month)
          .single();

        if (existing) {
          await supabase
            .from('usage')
            .update({ count: existing.count + 1 })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('usage')
            .insert({ user_id: userId, month: month, count: 1 });
        }
      }
    }

    return usageOps.getUsage(userId);
  },

  decrementUsage: async (userId) => {
    const month = usageOps.getCurrentMonth();

    // Decrement usage (used when a job fails after reserving a slot)
    const { data: existing } = await supabase
      .from('usage')
      .select('id, count')
      .eq('user_id', userId)
      .eq('month', month)
      .single();

    if (existing && existing.count > 0) {
      const { error } = await supabase
        .from('usage')
        .update({ count: existing.count - 1 })
        .eq('id', existing.id);

      if (error) {
        console.error('Error decrementing usage:', error);
      }
    }

    return usageOps.getUsage(userId);
  },

  canGenerate: async (userId) => {
    // Ensure profile exists (auto-create if trigger failed)
    let user = await userOps.ensureProfile(userId);
    const subscription = await userOps.getSubscriptionStatus(userId);

    // Paid users with active subscription have unlimited access
    if (subscription && subscription.tier !== 'free' && subscription.isActive) {
      return { allowed: true, remaining: -1, tier: subscription.tier };
    }

    // Check if promo code has expired
    if (user?.promo_expiry_date) {
      const now = new Date();
      const expiryDate = new Date(user.promo_expiry_date);

      if (now > expiryDate) {
        // Promo has expired - reset to default free tier limit
        const { error } = await supabase
          .from('profiles')
          .update({
            custom_monthly_limit: 10,
            promo_expiry_date: null
          })
          .eq('id', userId);

        if (!error) {
          // Update local user object to reflect changes
          user.custom_monthly_limit = 10;
          user.promo_expiry_date = null;
        }
      }
    }

    // Check if user has custom monthly limit from promo code
    const monthlyLimit = user?.custom_monthly_limit || 10;

    // Free users get 10 per month (or custom limit from promo code)
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
  trackGenerationAttempt: async (userId, jobUrl, isManual, success, errorMessage = null, timeMs = null, tokenData = {}) => {
    try {
      // Extract token data with defaults
      const {
        extractionInput = 0,
        extractionOutput = 0,
        generationInput = 0,
        generationOutput = 0,
        retryInput = 0,
        retryOutput = 0
      } = tokenData;

      // Calculate costs using pricing:
      // GPT-4o-mini: $0.15/M input, $0.60/M output
      // Claude Haiku 3.5: $0.80/M input, $4.00/M output

      const extractionCost = (extractionInput * 0.15 / 1000000) + (extractionOutput * 0.60 / 1000000);
      const generationCost = (generationInput * 0.80 / 1000000) + (generationOutput * 4.00 / 1000000);
      const retryCost = (retryInput * 0.80 / 1000000) + (retryOutput * 4.00 / 1000000);
      const totalCost = extractionCost + generationCost + retryCost;

      // Calculate aggregate tokens for backward compatibility
      const totalInputTokens = extractionInput + generationInput + retryInput;
      const totalOutputTokens = extractionOutput + generationOutput + retryOutput;
      const totalTokens = totalInputTokens + totalOutputTokens;

      const { error } = await supabase
        .from('generation_analytics')
        .insert({
          user_id: userId,
          job_url: jobUrl,
          is_manual_paste: isManual,
          success: success,
          error_message: errorMessage,
          generation_time_ms: timeMs,
          // Model-specific tokens
          extraction_input_tokens: extractionInput,
          extraction_output_tokens: extractionOutput,
          generation_input_tokens: generationInput,
          generation_output_tokens: generationOutput,
          retry_input_tokens: retryInput,
          retry_output_tokens: retryOutput,
          // Costs
          extraction_cost: extractionCost,
          generation_cost: generationCost,
          retry_cost: retryCost,
          total_cost: totalCost,
          // Aggregate tokens (for backward compatibility)
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          total_tokens: totalTokens
        });

      if (error) {
        console.error('Error tracking generation attempt:', error);
      } else {
        // Log cost summary
        console.log(`💰 Cost Summary - Extraction: $${extractionCost.toFixed(6)}, Generation: $${generationCost.toFixed(6)}, Retry: $${retryCost.toFixed(6)}, Total: $${totalCost.toFixed(6)}`);
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

// Resume operations
const resumeOps = {
  // List all resumes for a user
  list: async (userId) => {
    const { data, error } = await supabase
      .from('user_resumes')
      .select('id, nickname, file_name, file_type, file_size, is_default, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error listing resumes:', error);
      throw error;
    }
    return data || [];
  },

  // Create new resume
  create: async (userId, resumeData) => {
    // Check count first
    const { count, error: countError } = await supabase
      .from('user_resumes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      console.error('Error checking resume count:', countError);
      throw countError;
    }

    if (count >= 10) {
      throw new Error('Maximum 10 resumes allowed per user');
    }

    const { data, error } = await supabase
      .from('user_resumes')
      .insert({
        user_id: userId,
        nickname: resumeData.nickname,
        file_name: resumeData.file_name,
        file_type: resumeData.file_type,
        resume_text: resumeData.resume_text,
        file_size: resumeData.file_size,
        is_default: count === 0 // First resume is default
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating resume:', error);
      throw error;
    }
    return data;
  },

  // Update resume (nickname or default status)
  update: async (userId, resumeId, updates) => {
    // If setting as default, first unset all others
    if (updates.is_default) {
      await supabase
        .from('user_resumes')
        .update({ is_default: false })
        .eq('user_id', userId);
    }

    const { data, error } = await supabase
      .from('user_resumes')
      .update(updates)
      .eq('id', resumeId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating resume:', error);
      throw error;
    }
    return data;
  },

  // Delete resume
  delete: async (userId, resumeId) => {
    const { data: resume, error: fetchError } = await supabase
      .from('user_resumes')
      .select('is_default')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError) {
      console.error('Error fetching resume:', fetchError);
      throw fetchError;
    }

    const { error } = await supabase
      .from('user_resumes')
      .delete()
      .eq('id', resumeId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting resume:', error);
      throw error;
    }

    // If deleted resume was default, set first remaining as default
    if (resume.is_default) {
      const { data: resumes } = await supabase
        .from('user_resumes')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (resumes && resumes.length > 0) {
        await resumeOps.update(userId, resumes[0].id, { is_default: true });
      }
    }

    return true;
  },

  // Get resume text by ID
  getText: async (userId, resumeId) => {
    const { data, error } = await supabase
      .from('user_resumes')
      .select('resume_text')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error getting resume text:', error);
      throw error;
    }
    return data.resume_text;
  },

  // Get default resume
  getDefault: async (userId) => {
    const { data, error } = await supabase
      .from('user_resumes')
      .select('*')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error getting default resume:', error);
      throw error;
    }
    return data || null;
  }
};

module.exports = {
  userOps,
  usageOps,
  analyticsOps,
  resumeOps
};
