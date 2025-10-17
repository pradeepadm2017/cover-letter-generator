// Script to update custom monthly limit for a specific user
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Using service role key for admin access
);

async function updateUserLimit(email, newLimit) {
  try {
    console.log(`Updating monthly limit for ${email} to ${newLimit}...`);

    // Update the custom_monthly_limit field
    const { data, error } = await supabase
      .from('profiles')
      .update({ custom_monthly_limit: newLimit })
      .eq('email', email)
      .select();

    if (error) {
      console.error('Error updating user limit:', error);
      return;
    }

    if (data && data.length > 0) {
      console.log('✅ Successfully updated user limit!');
      console.log('Updated user:', data[0]);
    } else {
      console.log('⚠️ No user found with email:', email);
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

// Run the update
updateUserLimit('pradeepadm2017@gmail.com', 1000)
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
  });
