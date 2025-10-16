require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function resetAll() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    console.log('🔄 Resetting all users...\n');

    // Get current month
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Reset usage counts
    const { error: usageError } = await supabase
        .from('usage')
        .update({ count: 0 })
        .eq('month', currentMonth);

    if (usageError) {
        console.error('❌ Error resetting usage:', usageError);
    } else {
        console.log('✅ Usage counts reset to 0');
    }

    // Reset promo codes and limits in profiles
    const { error: profileError } = await supabase
        .from('profiles')
        .update({
            promo_codes_used: [],
            custom_monthly_limit: null
        })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all rows

    if (profileError) {
        console.error('❌ Error resetting profiles:', profileError);
    } else {
        console.log('✅ Promo codes cleared and limits reset to 3 (default)');
    }

    // Verify
    const { data: usageData } = await supabase
        .from('usage')
        .select('user_id, count')
        .eq('month', currentMonth);

    const { data: profileData } = await supabase
        .from('profiles')
        .select('id, email, promo_codes_used, custom_monthly_limit');

    console.log('\n📊 Current state:');
    console.log('\nUsage records:');
    usageData?.forEach((u, i) => {
        console.log(`  ${i + 1}. User: ${u.user_id.substring(0, 8)}... Count: ${u.count}`);
    });

    console.log('\nProfile records:');
    profileData?.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.email} - Limit: ${p.custom_monthly_limit || 3} - Promo codes: ${(p.promo_codes_used || []).length}`);
    });

    console.log('\n✅ All users reset!');
}

resetAll();
