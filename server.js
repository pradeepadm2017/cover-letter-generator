require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Document, Paragraph, TextRun, Packer } = require('docx');
const multer = require('multer');
// Lazy load pdf-parse to avoid canvas issues in serverless
let pdfParse = null;
const mammoth = require('mammoth');
const supabase = require('./supabase-client');
const { userOps, usageOps, analyticsOps } = require('./supabase-db');

// Import advanced scraping service (feature-flagged)
const scrapingService = require('./scraping-service');

const app = express();
let PORT = process.env.PORT || 3000;

// Middleware to verify Supabase session
async function verifySupabaseSession(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No auth header or invalid format');
    req.user = null;
    return next();
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    console.log('Verifying token with Supabase...');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error('Supabase auth error:', error.message, error.status);
      req.user = null;
      return next();
    }

    if (!user) {
      console.log('No user found for token');
      req.user = null;
      return next();
    }

    console.log('User authenticated:', user.id, user.email);
    // Get user profile from database
    const profile = await userOps.findById(user.id);

    // Merge profile but NEVER overwrite the auth email
    // The email in profiles is for cover letter display only
    const { email: profileEmail, ...profileWithoutEmail } = profile || {};
    req.user = { ...user, ...profileWithoutEmail };
    next();
  } catch (error) {
    console.error('Error verifying session:', error);
    req.user = null;
    next();
  }
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use(verifySupabaseSession);

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Basic request logging middleware
app.use((req, res, next) => {
  console.log(`🌐 ${new Date().toISOString()} ${req.method} ${req.url}`);
  if (req.method === 'POST') {
    console.log('📦 POST body keys:', Object.keys(req.body || {}));
  }
  next();
});

// Initialize OpenAI (for extraction only)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Claude (for cover letter generation)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Job Description Cache (24-hour TTL)
const jobDescriptionCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedJobDescription(url) {
  const cached = jobDescriptionCache.get(url);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL_MS) {
    // Cache expired
    jobDescriptionCache.delete(url);
    return null;
  }

  console.log(`💾 Cache HIT for ${url} (age: ${((now - cached.timestamp) / 1000 / 60).toFixed(1)}min)`);
  return cached.description;
}

function setCachedJobDescription(url, description) {
  jobDescriptionCache.set(url, {
    description,
    timestamp: Date.now()
  });
  console.log(`💾 Cached job description for ${url} (cache size: ${jobDescriptionCache.size})`);
}

// Resume Cache (24-hour TTL) - keyed by user ID + resume hash
const resumeCache = new Map();

function getResumeHash(resumeText) {
  // Simple hash function for resume content
  let hash = 0;
  for (let i = 0; i < resumeText.length; i++) {
    const char = resumeText.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

function getCachedResume(userId, resumeText) {
  const resumeHash = getResumeHash(resumeText);
  const cacheKey = `${userId}:${resumeHash}`;
  const cached = resumeCache.get(cacheKey);

  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL_MS) {
    // Cache expired
    resumeCache.delete(cacheKey);
    return null;
  }

  console.log(`💾 Resume cache HIT for user ${userId} (age: ${((now - cached.timestamp) / 1000 / 60).toFixed(1)}min)`);
  return cached;
}

function setCachedResume(userId, resumeText, candidateName) {
  const resumeHash = getResumeHash(resumeText);
  const cacheKey = `${userId}:${resumeHash}`;

  resumeCache.set(cacheKey, {
    candidateName,
    timestamp: Date.now()
  });
  console.log(`💾 Cached resume for user ${userId} (cache size: ${resumeCache.size})`);
}

// Clear expired cache entries every hour
setInterval(() => {
  const now = Date.now();
  let clearedJobs = 0;
  let clearedResumes = 0;

  for (const [url, cached] of jobDescriptionCache.entries()) {
    if (now - cached.timestamp > CACHE_TTL_MS) {
      jobDescriptionCache.delete(url);
      clearedJobs++;
    }
  }

  for (const [key, cached] of resumeCache.entries()) {
    if (now - cached.timestamp > CACHE_TTL_MS) {
      resumeCache.delete(key);
      clearedResumes++;
    }
  }

  if (clearedJobs > 0 || clearedResumes > 0) {
    console.log(`🧹 Cleared ${clearedJobs} job descriptions, ${clearedResumes} resumes (remaining: ${jobDescriptionCache.size} jobs, ${resumeCache.size} resumes)`);
  }
}, 60 * 60 * 1000); // Run every hour

// Authentication middleware
function ensureAuthenticated(req, res, next) {
  if (req.user && req.user.id) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Auth status endpoint
app.get('/api/auth/session', async (req, res) => {
  if (!req.user) {
    return res.json({ user: null, session: null });
  }

  try {
    const usage = await usageOps.canGenerate(req.user.id);
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        subscription_tier: req.user.subscription_tier || 'free'
      },
      session: { access_token: req.headers.authorization?.substring(7) },
      usage
    });
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Logout endpoint (for backwards compatibility)
app.get('/auth/logout', (req, res) => {
  res.redirect('/');
});

// Legacy auth status endpoint (for backwards compatibility)
app.get('/api/auth/status', async (req, res) => {
  if (req.user) {
    const usage = await usageOps.canGenerate(req.user.id);
    res.json({
      authenticated: true,
      user: {
        email: req.user.email,
        tier: req.user.subscription_tier || 'free'
      },
      usage: usage
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Update subscription plan
app.post('/api/subscription/change', ensureAuthenticated, async (req, res) => {
  try {
    const { tier } = req.body;

    if (!tier || !['free', 'monthly', 'quarterly', 'annual'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    let expiresAt = null;
    if (tier !== 'free') {
      const now = new Date();
      if (tier === 'monthly') {
        now.setMonth(now.getMonth() + 1);
        expiresAt = now.toISOString();
      } else if (tier === 'quarterly') {
        now.setMonth(now.getMonth() + 3);
        expiresAt = now.toISOString();
      } else if (tier === 'annual') {
        now.setFullYear(now.getFullYear() + 1);
        expiresAt = now.toISOString();
      }
    }

    await userOps.updateSubscription(req.user.id, tier, expiresAt);

    // Return updated user info
    const updatedUser = await userOps.findById(req.user.id);
    const usage = await usageOps.canGenerate(req.user.id);

    res.json({
      success: true,
      user: {
        email: updatedUser.email,
        tier: updatedUser.subscription_tier
      },
      usage: usage
    });
  } catch (error) {
    console.error('Error changing subscription:', error);
    res.status(500).json({ error: 'Failed to change subscription' });
  }
});

// Cancel subscription
app.post('/api/subscription/cancel', ensureAuthenticated, async (req, res) => {
  try {
    await userOps.updateSubscription(req.user.id, 'free', null);

    // Return updated user info
    const updatedUser = await userOps.findById(req.user.id);
    const usage = await usageOps.canGenerate(req.user.id);

    res.json({
      success: true,
      user: {
        email: updatedUser.email,
        tier: updatedUser.subscription_tier
      },
      usage: usage
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Apply promo code
app.post('/api/promo-code/apply', ensureAuthenticated, async (req, res) => {
  try {
    const { promoCode } = req.body;

    if (!promoCode) {
      return res.status(400).json({ error: 'Promo code is required' });
    }

    const result = await userOps.applyPromoCode(req.user.id, promoCode);

    // Return updated usage info
    const usage = await usageOps.canGenerate(req.user.id);

    res.json({
      success: true,
      message: result.message,
      usage: usage
    });
  } catch (error) {
    console.error('Error applying promo code:', error);

    // Send user-friendly error messages
    if (error.message === 'Promo code already used') {
      return res.status(400).json({ error: 'You have already used this promo code' });
    } else if (error.message === 'Invalid promo code') {
      return res.status(400).json({ error: 'Invalid promo code' });
    } else if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(500).json({ error: 'Failed to apply promo code' });
  }
});

// Route to serve the landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route to serve the main app (client-side handles auth)
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Route to serve the manual paste page (client-side handles auth)
app.get('/manual-paste', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manual-paste.html'));
});

// Route to serve the analytics dashboard
app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// Analytics API endpoints
app.get('/api/scraping-analytics', async (req, res) => {
  try {
    const rangeType = req.query.rangeType || 'all';
    const stats = await analyticsOps.getScrapingAnalytics(rangeType);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching scraping analytics:', error);
    res.status(500).json({ error: 'Failed to fetch scraping analytics' });
  }
});

app.get('/api/user-activity', async (req, res) => {
  try {
    const rangeType = req.query.rangeType || 'all';
    const activity = await analyticsOps.getUserActivity(rangeType);
    res.json(activity);
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
});

app.get('/api/top-users', async (req, res) => {
  try {
    const topUsers = await analyticsOps.getTopUsers();
    res.json(topUsers);
  } catch (error) {
    console.error('Error fetching top users:', error);
    res.status(500).json({ error: 'Failed to fetch top users' });
  }
});

app.get('/api/user-segmentation', async (req, res) => {
  try {
    const segmentation = await analyticsOps.getUserSegmentation();
    res.json(segmentation);
  } catch (error) {
    console.error('Error fetching user segmentation:', error);
    res.status(500).json({ error: 'Failed to fetch user segmentation' });
  }
});

// Get user profile header settings
app.get('/api/user/profile', ensureAuthenticated, async (req, res) => {
  try {
    const profile = await userOps.getProfile(req.user.id);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile settings' });
  }
});

// Update user profile header settings
app.post('/api/user/profile', ensureAuthenticated, async (req, res) => {
  try {
    const {
      email, full_name, credentials, city, phone, linkedin_url,
      header_template, header_color,
      header_font, header_font_size,
      body_font, body_font_size,
      page_border
    } = req.body;

    // Validate header_template
    if (header_template && !['none', 'center', 'left'].includes(header_template)) {
      return res.status(400).json({ error: 'Invalid header template. Must be none, center, or left.' });
    }

    // Validate header_color (basic hex color validation)
    if (header_color && !/^#[0-9A-Fa-f]{6}$/.test(header_color)) {
      return res.status(400).json({ error: 'Invalid header color. Must be a valid hex color (e.g., #000000).' });
    }

    // Validate fonts
    const allowedFonts = ['Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana'];
    if (header_font && !allowedFonts.includes(header_font)) {
      return res.status(400).json({ error: 'Invalid header font. Must be one of: ' + allowedFonts.join(', ') });
    }
    if (body_font && !allowedFonts.includes(body_font)) {
      return res.status(400).json({ error: 'Invalid body font. Must be one of: ' + allowedFonts.join(', ') });
    }

    // Validate font sizes
    if (header_font_size && (header_font_size < 10 || header_font_size > 24)) {
      return res.status(400).json({ error: 'Invalid header font size. Must be between 10 and 24.' });
    }
    if (body_font_size && (body_font_size < 8 || body_font_size > 16)) {
      return res.status(400).json({ error: 'Invalid body font size. Must be between 8 and 16.' });
    }

    // Validate page border
    if (page_border && !['none', 'narrow'].includes(page_border)) {
      return res.status(400).json({ error: 'Invalid page border. Must be none or narrow.' });
    }

    // Validate email format
    if (email) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(email)) {
        return res.status(400).json({ error: 'Invalid email format. Please enter a valid email address.' });
      }
    }

    // Validate phone number (allow various formats)
    if (phone && phone.trim()) {
      const phonePattern = /^[\d\s\-\(\)\+\.]+$/;
      const cleanPhone = phone.replace(/[\s\-\(\)\.]/g, '');
      if (!phonePattern.test(phone) || cleanPhone.length < 10 || cleanPhone.length > 15) {
        return res.status(400).json({ error: 'Invalid phone number. Must be 10-15 digits and can contain spaces, dashes, or parentheses.' });
      }
    }

    // Validate LinkedIn URL format
    if (linkedin_url && linkedin_url.trim()) {
      const linkedinPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/(in|pub|profile)\/[\w\-]+\/?$/i;
      if (!linkedinPattern.test(linkedin_url)) {
        return res.status(400).json({ error: 'Invalid LinkedIn URL. Must be in format: https://www.linkedin.com/in/your-profile' });
      }
    }

    const profileData = {
      email: email || req.user.email || '',
      full_name: full_name || '',
      credentials: credentials || '',
      city: city || '',
      phone: phone || '',
      linkedin_url: linkedin_url || '',
      header_template: header_template || 'center',
      header_color: header_color || '#000000',
      header_font: header_font || 'Calibri',
      header_font_size: header_font_size || 16,
      body_font: body_font || 'Calibri',
      body_font_size: body_font_size || 12,
      page_border: page_border || 'narrow'
    };

    console.log('💾 Saving profile data:', profileData);
    const updatedProfile = await userOps.updateProfile(req.user.id, profileData);
    console.log('✅ Profile saved successfully:', updatedProfile);

    res.json({
      success: true,
      profile: updatedProfile
    });
  } catch (error) {
    console.error('❌ Error updating user profile:', error);
    console.error('Error details:', error.message, error.code);
    res.status(500).json({ error: 'Failed to update profile settings: ' + error.message });
  }
});

// Route to handle resume file upload
app.post('/api/upload-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const fileExtension = path.extname(file.originalname).toLowerCase();
    let resumeText = '';

    console.log(`📄 Processing uploaded file: ${file.originalname} (${fileExtension})`);

    if (fileExtension === '.pdf') {
      // Lazy load pdf-parse only when needed (avoids canvas issues in serverless)
      if (!pdfParse) {
        pdfParse = require('pdf-parse');
      }
      // Parse PDF
      const pdfData = await pdfParse(file.buffer);
      resumeText = pdfData.text;
    } else if (fileExtension === '.txt') {
      // Parse TXT
      resumeText = file.buffer.toString('utf-8');
    } else if (fileExtension === '.docx') {
      // Parse DOCX using mammoth
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      resumeText = result.value;
    } else if (fileExtension === '.doc') {
      // Old DOC format is not supported
      return res.status(400).json({
        error: 'Old .doc format is not supported. Please convert to .docx, PDF, or TXT format.'
      });
    } else {
      return res.status(400).json({
        error: 'Unsupported file format. Please use PDF, DOCX, or TXT.'
      });
    }

    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({
        error: 'Could not extract text from file or content too short'
      });
    }

    console.log(`✅ Successfully extracted ${resumeText.length} characters from ${file.originalname}`);

    res.json({
      success: true,
      text: resumeText,
      fileName: file.originalname
    });

  } catch (error) {
    console.error('Error processing resume file:', error);
    res.status(500).json({
      error: 'Failed to process file: ' + error.message
    });
  }
});

// Helper function to fetch job description from URL
async function fetchJobDescription(url) {
  console.log(`🔍 Fetching job description from: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

  const $ = cheerio.load(response.data);

  // Remove unwanted elements
  $('script, style, nav, header, footer, .cookie-banner, .cookies, .gdpr, .privacy-notice, .advertisement').remove();

  // Try to extract specific job information
  let jobTitle = '';
  let jobDescription = '';
  let companyName = '';

  // Extract job title
  const titleSelectors = ['h1', '.job-title', '[data-automation="job-title"]', '.posting-title'];
  for (const selector of titleSelectors) {
    const title = $(selector).first().text().trim();
    if (title && title.length > jobTitle.length) {
      jobTitle = title;
    }
  }

  // Extract company name
  const companySelectors = ['.company-name', '.employer-name', '[data-automation="company-name"]'];
  for (const selector of companySelectors) {
    const company = $(selector).first().text().trim();
    if (company && company.length > companyName.length) {
      companyName = company;
    }
  }

  // Extract job description - try multiple approaches
  const descriptionSelectors = [
    '.job-description',
    '.job-details',
    '.description',
    '[data-automation="job-description"]',
    '.posting-content',
    '.job-content',
    'main',
    '.main-content'
  ];

  for (const selector of descriptionSelectors) {
    const desc = $(selector).text().trim();
    if (desc && desc.length > jobDescription.length && desc.length > 200) {
      jobDescription = desc;
    }
  }

  // If we still don't have good content, fall back to body but filter out common junk
  if (jobDescription.length < 200) {
    jobDescription = $('body').text().trim();
  }

  // Clean up text
  jobDescription = jobDescription.replace(/\s+/g, ' ').trim();

  // Filter out cookie/privacy notices
  const unwantedPatterns = [
    /we use cookies.*?accept.*?cookies/gi,
    /privacy policy.*?terms.*?conditions/gi,
    /cookie preferences.*?local storage/gi,
    /advertising cookies.*?provider.*?description/gi
  ];

  unwantedPatterns.forEach(pattern => {
    jobDescription = jobDescription.replace(pattern, '');
  });

  // Construct the final job information
  let finalText = '';
  if (jobTitle) finalText += `Job Title: ${jobTitle}\n\n`;
  if (companyName) finalText += `Company: ${companyName}\n\n`;
  finalText += `Job Description:\n${jobDescription}`;

  console.log(`✅ Extracted content summary:`);
  console.log(`   📋 Job Title: ${jobTitle || 'Not found'}`);
  console.log(`   🏢 Company: ${companyName || 'Not found'}`);
  console.log(`   📄 Description Length: ${jobDescription.length} characters`);
  console.log(`   📝 First 200 chars: ${jobDescription.substring(0, 200)}...`);

  // Debug the final text structure
  console.log(`🔍 EXTRACTION DEBUG - Final structured text first 300 chars:`, finalText.substring(0, 300));

  return finalText;
  } catch (error) {
    console.log(`⚠️  Basic fetch CAUGHT ERROR: ${error.message}`);
    console.log(`⚠️  Error has response object: ${error.response ? 'YES' : 'NO'}`);
    console.log(`⚠️  Response status: ${error.response?.status}`);

    // SMART BLOCKING DETECTION: Check for known-blocked sites
    const domain = new URL(url).hostname;
    const isHttp403 = error.message.includes('403') || error.response?.status === 403;
    const isHttp999 = error.message.includes('999') || error.response?.status === 999;

    // Known sites that consistently block scraping
    const knownBlockedSites = [
      'theladders.com'
    ];

    const isKnownBlocked = knownBlockedSites.some(site => domain.includes(site));

    if ((isHttp403 || isHttp999) && isKnownBlocked) {
      console.log(`🚫 ${domain} is on known-blocked list (HTTP ${isHttp403 ? '403' : '999'})`);
      console.log('   💡 This site consistently blocks scraping');

      throw new Error(
        `${domain} appears to be blocking automated access. ` +
        `This is common with certain job boards after repeated requests. ` +
        `Please use the "Manual Paste" feature instead, or try again in 1-2 hours when the block may reset.`
      );
    }

    // For other errors, re-throw the original error
    throw error;
  }
}

// Helper function to extract job title and company name using GPT-4o-mini
async function extractJobTitleAndCompany(jobDescription) {
  console.log('🤖 Using GPT-4o-mini to extract job title and company name...');

  let totalTokenUsage = { input: 0, output: 0, total: 0 };

  try {
    // First attempt: Use first 2000 characters
    console.log('📝 First attempt: Using first 2000 characters...');
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a job posting analyzer. Extract the job title and company name from job descriptions. Respond ONLY with valid JSON in this exact format: {\"jobTitle\": \"extracted title\", \"companyName\": \"extracted company\"}. If you cannot find either field, use null for that field."
        },
        {
          role: "user",
          content: `Extract the job title and company name from this job posting:\n\n${jobDescription.substring(0, 2000)}`
        }
      ],
      max_tokens: 150,
      temperature: 0.1
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('🤖 GPT-4o-mini raw response:', responseText);

    // Capture token usage
    const tokenUsage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    totalTokenUsage.input += tokenUsage.prompt_tokens;
    totalTokenUsage.output += tokenUsage.completion_tokens;
    totalTokenUsage.total += tokenUsage.total_tokens;
    console.log(`📊 Token usage (attempt 1) - Input: ${tokenUsage.prompt_tokens}, Output: ${tokenUsage.completion_tokens}, Total: ${tokenUsage.total_tokens}`);

    // Parse JSON response
    const extracted = JSON.parse(responseText);

    let jobTitle = extracted.jobTitle || null;
    let companyName = extracted.companyName || null;

    console.log(`✅ First attempt result - Job Title: "${jobTitle}", Company: "${companyName}"`);

    // Second attempt: If either is null, retry with full job description
    if (!jobTitle || !companyName) {
      console.log('⚠️ Missing data from first attempt. Retrying with FULL job description...');
      console.log(`📏 Full job description length: ${jobDescription.length} characters`);

      try {
        const retryCompletion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a job posting analyzer. Extract the job title and company name from job descriptions. Respond ONLY with valid JSON in this exact format: {\"jobTitle\": \"extracted title\", \"companyName\": \"extracted company\"}. If you cannot find either field, use null for that field."
            },
            {
              role: "user",
              content: `Extract the job title and company name from this job posting:\n\n${jobDescription}`
            }
          ],
          max_tokens: 150,
          temperature: 0.1
        });

        const retryResponseText = retryCompletion.choices[0].message.content.trim();
        console.log('🤖 GPT-4o-mini retry response:', retryResponseText);

        // Capture retry token usage
        const retryTokenUsage = retryCompletion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        totalTokenUsage.input += retryTokenUsage.prompt_tokens;
        totalTokenUsage.output += retryTokenUsage.completion_tokens;
        totalTokenUsage.total += retryTokenUsage.total_tokens;
        console.log(`📊 Token usage (attempt 2) - Input: ${retryTokenUsage.prompt_tokens}, Output: ${retryTokenUsage.completion_tokens}, Total: ${retryTokenUsage.total_tokens}`);

        // Parse retry JSON response
        const retryExtracted = JSON.parse(retryResponseText);

        // Use retry results if they're not null, otherwise keep first attempt results
        if (!jobTitle && retryExtracted.jobTitle) {
          jobTitle = retryExtracted.jobTitle;
          console.log(`✅ Found job title on retry: "${jobTitle}"`);
        }
        if (!companyName && retryExtracted.companyName) {
          companyName = retryExtracted.companyName;
          console.log(`✅ Found company name on retry: "${companyName}"`);
        }

      } catch (retryError) {
        console.error('❌ Retry extraction failed:', retryError.message);
        // Continue with first attempt results
      }
    }

    console.log(`📊 Total token usage - Input: ${totalTokenUsage.input}, Output: ${totalTokenUsage.output}, Total: ${totalTokenUsage.total}`);
    console.log(`✅ Final result - Job Title: "${jobTitle}", Company: "${companyName}"`);

    return {
      jobTitle,
      companyName,
      tokenUsage: totalTokenUsage
    };
  } catch (error) {
    console.error('❌ GPT-4o-mini extraction failed:', error.message);
    return {
      jobTitle: null,
      companyName: null,
      tokenUsage: totalTokenUsage
    };
  }
}

// Helper function to extract candidate name from resume
function extractCandidateName(resume, userProfile = null) {
  // First priority: Use profile full_name if available
  if (userProfile && userProfile.full_name) {
    let nameWithCredentials = userProfile.full_name.trim();
    if (userProfile.credentials) {
      nameWithCredentials += ', ' + userProfile.credentials.trim();
    }
    console.log(`✅ Using profile name: "${nameWithCredentials}"`);
    return nameWithCredentials;
  }

  const lines = resume.split('\n');

  console.log('🔍 Extracting name from resume. First 5 lines:');
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    console.log(`   ${i + 1}: "${lines[i].trim()}"`);
  }

  // Look for name patterns in the first few lines
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();

    // Skip empty lines, headers like "Executive Summary", phone numbers, emails, and addresses
    if (!line ||
        /executive summary/i.test(line) ||
        /summary/i.test(line) ||
        /professional/i.test(line) ||
        /experience/i.test(line) ||
        /^\d/.test(line) ||
        /@/.test(line) ||
        /phone|tel|mobile|cell/i.test(line) ||
        /address|street|city|state|zip/i.test(line)) {
      console.log(`   Skipped line ${i + 1}: "${line}"`);
      continue;
    }

    // Look for typical name patterns (2-4 words, first letter capitalized)
    const namePattern = /^[A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?(?:\s[A-Z][a-z]+)?$/;
    if (namePattern.test(line)) {
      console.log(`   ✅ Found name: "${line}"`);
      return line;
    }

    // Also check for names with titles/credentials
    const nameWithCredentials = line.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?),?\s*(MBA|PhD|MD|CPA|etc\.?)?$/i);
    if (nameWithCredentials) {
      const name = nameWithCredentials[1];
      console.log(`   ✅ Found name with credentials: "${name}"`);
      return name;
    }
  }

  // Fallback: look for any capitalized words in first 3 lines
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().includes('summary') || line.toLowerCase().includes('professional')) {
      continue;
    }

    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4) {
      const capitalizedWords = words.filter(word => /^[A-Z][a-z]+$/.test(word));
      if (capitalizedWords.length >= 2 && capitalizedWords.length === words.length) {
        const name = capitalizedWords.join(' ');
        console.log(`   ✅ Fallback name found: "${name}"`);
        return name;
      }
    }
  }

  console.log('   ❌ No name found in resume or profile');
  return '[Your Name]'; // Generic fallback instead of hardcoded name
}

// Helper function to extract company name and job title for filename
function extractJobDetailsForFilename(jobDescription, jobUrl = '') {
  let companyName = '';
  let jobTitle = '';

  console.log(`🔍 DEBUG: First 300 chars of job description:`, jobDescription.substring(0, 300));
  console.log(`🔍 DEBUG: Job URL:`, jobUrl);

  // Try to extract job title more precisely
  const jobTitlePatterns = [
    // Direct patterns
    /Job Title:\s*([^\n\r]+)/i,
    /Position:\s*([^\n\r]+)/i,
    /Role:\s*([^\n\r]+)/i,
    /Title:\s*([^\n\r]+)/i,
    // Look for job titles at the beginning of lines - stricter pattern with reasonable length
    /^([A-Z][A-Za-z\s,&-]{0,60}?(?:Director|Manager|Senior|Lead|Engineer|Analyst|Coordinator|Specialist|Associate|Executive|Officer)(?:\s+[A-Za-z\s,&-]{0,30})?)/im,
    // Fallback patterns for common job titles - with length limits
    /((?:Senior|Lead|Chief|VP|Vice President)\s+[A-Za-z\s,&-]{1,50}?(?:Director|Manager|Engineer|Analyst|Coordinator|Specialist|Associate|Executive|Officer))/i,
    /(Director(?:\s+of)?\s+[A-Za-z\s,&-]{1,40})/i,
    /(Manager(?:\s+of)?\s+[A-Za-z\s,&-]{1,40})/i,
  ];

  for (const pattern of jobTitlePatterns) {
    const match = jobDescription.match(pattern);
    if (match && match[1]) {
      let title = match[1].trim().replace(/\s+/g, ' ');

      // Additional cleanup: stop at common separators
      const stopWords = [' with ', ' who ', ' that ', ' for ', ' in ', ' at ', ' -', ' •', ' |'];
      for (const stopWord of stopWords) {
        const idx = title.toLowerCase().indexOf(stopWord);
        if (idx > 10) { // Only cut if we have at least 10 chars before the stop word
          title = title.substring(0, idx).trim();
          break;
        }
      }

      // Limit to reasonable length (max 80 chars)
      if (title.length > 80) {
        title = title.substring(0, 77) + '...';
      }

      jobTitle = title;
      console.log(`🎯 Found job title with pattern: "${jobTitle}"`);
      break;
    }
  }

  // If no job title found and we have a URL, try to extract from URL
  if (!jobTitle && jobUrl) {
    // Try to extract from Loblaw-style URLs: /sr-director-corporate-strategy/
    const urlMatch = jobUrl.match(/\/([a-z-]+(?:director|manager|lead|engineer|analyst|coordinator|specialist)[a-z-]*)\//i);
    if (urlMatch && urlMatch[1]) {
      // Convert kebab-case to Title Case
      jobTitle = urlMatch[1]
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      console.log(`🎯 Found job title from URL: "${jobTitle}"`);
    }
  }

  // Try to extract company name with better patterns
  const companyPatterns = [
    // Direct company indicators
    /Company:\s*([^\n\r]+)/i,
    /Organization:\s*([^\n\r]+)/i,
    /Employer:\s*([^\n\r]+)/i,
    // Look for company names with common suffixes
    /([A-Z][A-Za-z\s&,.']*(?:Inc|Ltd|Corp|Corporation|Company|Group|Limited|Investments|Holdings|Solutions|Technologies|Services|Systems|Consulting|Associates)\.?)/i,
    // Look for "at [Company Name]" patterns
    /\bat\s+([A-Z][A-Za-z\s&,.']+?)(?:\s+(?:Inc|Ltd|Corp|Corporation|Company|Group|Limited|Investments|Holdings|Solutions|Technologies|Services))?/i,
    // Look for company names before city names
    /([A-Z][A-Za-z\s&,.']+?)(?:\s+(?:Toronto|London|Vancouver|Montreal|Calgary|Ottawa|Winnipeg|Regina|Halifax|Quebec|Victoria|Saskatoon|Ontario|Alberta|BC|Quebec|Canada))/i
  ];

  for (const pattern of companyPatterns) {
    const match = jobDescription.match(pattern);
    if (match && match[1]) {
      companyName = match[1].trim().replace(/\s+/g, ' ');
      // Filter out common false positives
      if (companyName.length > 2 && companyName.length < 60 &&
          !companyName.toLowerCase().includes('apply') &&
          !companyName.toLowerCase().includes('job') &&
          !companyName.toLowerCase().includes('position')) {
        console.log(`🏢 Found company name with pattern: "${companyName}"`);
        break;
      }
    }
  }

  console.log(`📋 Final extraction - Company: "${companyName}", Job Title: "${jobTitle}"`);

  return { companyName, jobTitle };
}

// Helper function to clean filename for file system
function cleanFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .substring(0, 100); // Limit length
}

// Helper function to generate header based on profile settings
function generateHeaderForCoverLetter(profile, userEmail) {
  if (!profile || profile.header_template === 'none') {
    return null; // No header
  }

  const alignment = profile.header_template === 'center' ? 'center' : 'left';
  const color = profile.header_color || '#000000';

  // Build line 1: Name with credentials
  let line1 = profile.full_name || '';
  if (profile.credentials) {
    line1 += `, ${profile.credentials}`;
  }

  // Build line 2: Contact info with smart separators
  const line2Parts = [];
  if (profile.city) line2Parts.push(profile.city);
  if (userEmail) line2Parts.push(userEmail);
  if (profile.phone) line2Parts.push(profile.phone);
  if (profile.linkedin_url) {
    // Shorten LinkedIn URL for display
    const linkedinDisplay = profile.linkedin_url.replace(/^(https?:\/\/)?(www\.)?/, '');
    line2Parts.push(linkedinDisplay);
  }

  const line2 = line2Parts.join(' | ');

  return {
    line1,
    line2,
    alignment,
    color
  };
}

// Route to generate cover letters for multiple job URLs
app.post('/api/generate-cover-letters', ensureAuthenticated, async (req, res) => {
  console.log('🚀 API REQUEST RECEIVED: /api/generate-cover-letters');
  console.log('📝 Request body keys:', Object.keys(req.body));
  console.log('👤 User ID:', req.user?.id);
  console.log('📧 User email:', req.user?.email);

  try {
    const { resume, jobUrls } = req.body;

    console.log('📋 Resume received:', !!resume, resume ? `(${resume.length} characters)` : '');
    console.log('📋 Job URLs received:', Array.isArray(jobUrls), jobUrls ? `(${jobUrls.length} jobs)` : '');

    if (!resume || !jobUrls || !Array.isArray(jobUrls) || jobUrls.length === 0) {
      console.error('❌ Validation failed - Resume:', !!resume, 'JobUrls:', Array.isArray(jobUrls), jobUrls?.length);
      return res.status(400).json({ error: 'Resume and job URLs are required' });
    }

    // Fetch user profile for header settings
    let userProfile = null;
    try {
      userProfile = await userOps.getProfile(req.user.id);
      console.log('📋 User profile loaded for header generation:', userProfile ? 'success' : 'not found');
    } catch (profileError) {
      console.error('⚠️ Error loading user profile:', profileError);
      // Continue without header if profile fetch fails
    }

    console.log(`📊 Processing ${jobUrls.length} jobs with parallel processing (batch size: 10)`);
    const startTime = Date.now();

    const results = [];
    const BATCH_SIZE = 10;

    // Helper function to process a single job
    const processJob = async (jobItem, index) => {
      const isManualJob = typeof jobItem === 'object' && jobItem.isManual;
      const jobUrl = isManualJob ? `manual-${index}` : (jobItem.url || jobItem);

      const jobStartTime = Date.now();
      console.log(`🚀 [Job ${index + 1}/${jobUrls.length}] Starting: ${isManualJob ? 'MANUAL' : jobUrl}`);

      // Check usage limits before processing each URL
      const usageCheck = await usageOps.canGenerate(req.user.id);
      if (!usageCheck.allowed) {
        console.log(`⛔ [Job ${index + 1}] Usage limit reached`);
        return {
          jobUrl: jobUrl,
          success: false,
          error: 'Usage limit reached',
          limitReached: true
        };
      }

      try {
        let usedFallback = false;
        let fallbackReason = '';

        // Track token usage for this job (shared by both manual and URL jobs)
        let extractionTokens = { input: 0, output: 0, total: 0 };

        // Get job description (either from URL scraping or manual paste)
        let jobDescription;

        if (isManualJob) {
          // Manual job - use provided data
          console.log(`📝 [Job ${index + 1}] Using manually pasted job data`);

          // Validate description length
          if (jobItem.description.length < 100) {
            return {
              jobUrl: jobUrl,
              success: false,
              error: 'Job description is too short. Please provide at least 100 characters for a meaningful cover letter.'
            };
          }

          if (jobItem.description.length > 20000) {
            return {
              jobUrl: jobUrl,
              success: false,
              error: 'Job description is too long. Please keep it under 20,000 characters.'
            };
          }

          // Check if title or company are missing - extract using AI if needed
          let finalTitle = jobItem.title.trim();
          let finalCompany = jobItem.company.trim();

          if (!finalTitle || !finalCompany) {
            console.log(`🤖 [Job ${index + 1}] Missing ${!finalTitle ? 'title' : ''}${!finalTitle && !finalCompany ? ' and ' : ''}${!finalCompany ? 'company' : ''} - using AI extraction...`);

            const extracted = await extractJobTitleAndCompany(jobItem.description);

            // Capture extraction token usage
            extractionTokens = extracted.tokenUsage;

            if (!finalTitle) {
              finalTitle = extracted.jobTitle || '';
            }
            if (!finalCompany) {
              finalCompany = extracted.companyName || '';
            }

            // If AI extraction failed to find required fields, return error
            if (!finalTitle || !finalCompany) {
              const missingFields = [];
              if (!finalTitle) missingFields.push('job title');
              if (!finalCompany) missingFields.push('company name');

              await analyticsOps.trackGenerationAttempt(
                req.user.id,
                jobUrl,
                true, // manual
                false, // failed
                `Could not extract ${missingFields.join(' and ')} from job description`,
                Date.now() - jobStartTime,
                {
                  extractionInput: extractionTokens.input,
                  extractionOutput: extractionTokens.output,
                  generationInput: 0,
                  generationOutput: 0,
                  retryInput: 0,
                  retryOutput: 0
                }
              );

              return {
                jobUrl: jobUrl,
                success: false,
                error: `Could not extract ${missingFields.join(' or ')} from the job description. Please provide ${missingFields.join(' and ')} manually to generate a cover letter.`
              };
            }

            console.log(`✅ [Job ${index + 1}] AI extraction successful - Title: "${finalTitle}", Company: "${finalCompany}"`);
          }

          jobDescription = `Job Title: ${finalTitle}\n\nCompany: ${finalCompany}\n\nJob Description:\n${jobItem.description}`;
        } else {
          // URL-based job - scrape it
          let scrapingMethod = 'cached';
          let scrapingSuccess = false;
          let scrapingError = null;

          try {
            // Check cache first
            const cachedDescription = getCachedJobDescription(jobUrl);
            if (cachedDescription) {
              jobDescription = cachedDescription;
              scrapingMethod = 'cached';
              scrapingSuccess = true;
              console.log(`💾 Using cached job description (saved ~10-30s)`);
            } else {
              // Use hybrid scraping if enabled, otherwise use basic fetch
              scrapingMethod = 'basic-fetch';

              try {
                // Trim environment variables to handle any whitespace/newlines
                const enableApify = (process.env.ENABLE_APIFY_SCRAPING || '').trim();
                const enablePuppeteer = (process.env.ENABLE_PUPPETEER_FALLBACK || '').trim();

                console.log(`🔍 ENV CHECK: ENABLE_APIFY_SCRAPING="${enableApify}" (raw: "${process.env.ENABLE_APIFY_SCRAPING}"), ENABLE_PUPPETEER_FALLBACK="${enablePuppeteer}" (raw: "${process.env.ENABLE_PUPPETEER_FALLBACK}")`);
                if (enableApify === 'true' || enablePuppeteer === 'true') {
                  console.log('🚀 Using HYBRID scraping approach (feature-flagged)');
                  const hybridResult = await scrapingService.fetchJobDescriptionHybrid(jobUrl);

                  // Handle new return format { content, method }
                  if (typeof hybridResult === 'object' && hybridResult.content) {
                    jobDescription = hybridResult.content;
                    scrapingMethod = hybridResult.method || 'unknown';
                    console.log(`✅ Hybrid scraper successful, method: ${scrapingMethod}`);
                  } else {
                    // Backward compatibility - if service returns string instead of object
                    jobDescription = hybridResult;
                  }
                } else {
                  console.log('📡 Using BASIC scraping approach (default)');
                  jobDescription = await fetchJobDescription(jobUrl);
                }
                scrapingSuccess = true;

                // Cache the result
                setCachedJobDescription(jobUrl, jobDescription);
              } catch (scrapingErr) {
                scrapingError = scrapingErr.message;
                scrapingSuccess = false;
                throw scrapingErr;
              }
            }

            // Track scraping attempt (for ALL jobs, cached and non-cached)
            const isFreeMethod = !['apify', 'puppeteer', 'scraperapi'].includes(scrapingMethod);
            await analyticsOps.trackScrapingAttempt(
              req.user.id,
              jobUrl,
              scrapingMethod,
              isFreeMethod,
              scrapingSuccess,
              scrapingError
            );

            // Check if the fetched content is actually valid (not a login page or too short)
            const descriptionOnly = jobDescription.split('Job Description:')[1] || jobDescription;
            if (descriptionOnly.length < 500 ||
                descriptionOnly.toLowerCase().includes('sign in') && descriptionOnly.length < 1000 ||
                descriptionOnly.toLowerCase().includes('keep me logged in')) {
              console.log(`⚠️ [Job ${index + 1}] Fetched content appears invalid (too short or login page)`);

              // Track failed generation attempt
              await analyticsOps.trackGenerationAttempt(
                req.user.id,
                jobUrl,
                false, // not manual
                false, // failed
                'Could not extract meaningful job description from URL',
                Date.now() - jobStartTime,
                {
                  extractionInput: 0,
                  extractionOutput: 0,
                  generationInput: 0,
                  generationOutput: 0,
                  retryInput: 0,
                  retryOutput: 0
                }
              );

              return {
                jobUrl: jobUrl,
                success: false,
                usedFallback: true,
                fallbackReason: 'Could not extract meaningful job description from URL (possible login wall or invalid page)',
                error: 'Could not extract meaningful job description from URL (possible login wall or invalid page)'
              };
            }
          } catch (fetchError) {
            console.log(`⚠️ Failed to fetch job description: ${fetchError.message}`);

            // SMART BLOCKING DETECTION: Check for known-blocked sites
            try {
              const domain = new URL(jobUrl).hostname;
              const isHttp403 = fetchError.message.includes('403') || fetchError.response?.status === 403;
              const isHttp999 = fetchError.message.includes('999') || fetchError.response?.status === 999;

              const knownBlockedSites = ['theladders.com'];
              const isKnownBlocked = knownBlockedSites.some(site => domain.includes(site));

              if ((isHttp403 || isHttp999) && isKnownBlocked) {
                console.log(`🚫 ${domain} is on known-blocked list (HTTP ${isHttp403 ? '403' : '999'})`);
                fallbackReason = `${domain} appears to be blocking automated access. ` +
                  `This is common with certain job boards after repeated requests. ` +
                  `Please use the "Manual Paste" feature instead, or try again in 1-2 hours when the block may reset.`;
              } else {
                fallbackReason = fetchError.message;
              }
            } catch (urlError) {
              // If URL parsing fails, use original error message
              fallbackReason = fetchError.message;
            }

            usedFallback = true;

            // SMART BLOCKING DETECTION: Check for known-blocked sites
            let friendlyError = fetchError.message;
            try {
              const domain = new URL(jobUrl).hostname;
              const isHttp403 = fetchError.message.includes('403') || fetchError.response?.status === 403;
              const isHttp999 = fetchError.message.includes('999') || fetchError.response?.status === 999;

              const knownBlockedSites = ['theladders.com'];
              const isKnownBlocked = knownBlockedSites.some(site => domain.includes(site));

              if ((isHttp403 || isHttp999) && isKnownBlocked) {
                console.log(`🚫 ${domain} is on known-blocked list (HTTP ${isHttp403 ? '403' : '999'})`);
                friendlyError = `${domain} appears to be blocking automated access. ` +
                  `This is common with certain job boards after repeated requests. ` +
                  `Please use the "Manual Paste" feature instead, or try again in 1-2 hours when the block may reset.`;
              }
            } catch (urlError) {
              // If URL parsing fails, use original error message
            }

            // Track failed generation attempt
            await analyticsOps.trackGenerationAttempt(
              req.user.id,
              jobUrl,
              false, // not manual
              false, // failed
              friendlyError,
              Date.now() - jobStartTime,
              {
                extractionInput: 0,
                extractionOutput: 0,
                generationInput: 0,
                generationOutput: 0,
                retryInput: 0,
                retryOutput: 0
              }
            );

            return {
              jobUrl: jobUrl,
              success: false,
              usedFallback: true,
              fallbackReason: friendlyError,
              error: friendlyError
            };
          }
        }

        // Extract candidate name from resume (with caching)
        let candidateName;
        const cachedResume = getCachedResume(req.user.id, resume);
        if (cachedResume) {
          candidateName = cachedResume.candidateName;
          console.log(`💾 Using cached candidate name: ${candidateName}`);
        } else {
          candidateName = extractCandidateName(resume, req.user);
          setCachedResume(req.user.id, resume, candidateName);
        }

        // We already have the job title from our main extraction - let's use it
        // Look for job title in the already extracted summary
        const summaryLines = jobDescription.split('\n').slice(0, 5);
        let extractedJobTitle = '';
        let extractedCompanyName = '';

        // Extract job title from our structured summary
        for (const line of summaryLines) {
          if (line.includes('Job Title:')) {
            extractedJobTitle = line.replace('Job Title:', '').trim();
            break;
          }
        }

        // Extract company name from our structured summary
        for (const line of summaryLines) {
          if (line.includes('Company:')) {
            extractedCompanyName = line.replace('Company:', '').trim();

            // Clean up if job title got mixed in with company name (more aggressive)
            if (extractedJobTitle) {
              // Remove job title with or without comma
              const jobTitleVariations = [
                extractedJobTitle,
                extractedJobTitle.replace(',', ''),
                extractedJobTitle + ' ',
                extractedJobTitle.replace(',', '') + ' '
              ];

              for (const variation of jobTitleVariations) {
                if (extractedCompanyName.startsWith(variation)) {
                  extractedCompanyName = extractedCompanyName.replace(variation, '').trim();
                  console.log(`🧹 Removed "${variation}" from company name`);
                  break;
                }
              }
            }
            break;
          }
        }

        // Fallback to pattern extraction if structured data not found
        if (!extractedJobTitle || !extractedCompanyName) {
          const { companyName: fallbackCompany, jobTitle: fallbackTitle } = extractJobDetailsForFilename(jobDescription, jobUrl);
          if (!extractedJobTitle) extractedJobTitle = fallbackTitle;
          if (!extractedCompanyName) extractedCompanyName = fallbackCompany;
        }

        console.log(`📋 Using for filename - Company: "${extractedCompanyName}", Job Title: "${extractedJobTitle}"`);

        const companyName = extractedCompanyName;
        const jobTitle = extractedJobTitle;

        const requestId = Date.now();
        const prompt = `You are an expert cover letter writer. Create a compelling, targeted cover letter that demonstrates clear value to the employer.

FORMATTING RULES (must follow exactly):
- Start with: Dear Hiring Manager,
- End with: Best Regards, ${candidateName}
- No contact info, addresses, phone numbers, emails, or formatting symbols
- EXACTLY 4 paragraphs between greeting and closing (NOT 3, NOT 5 - EXACTLY 4)

CONTENT REQUIREMENTS:
1. ANALYZE the job posting thoroughly to identify:
   - Specific company name and exact job title
   - 3-4 key requirements/qualifications mentioned
   - Company values, mission, or culture references
   - Specific responsibilities and challenges

2. MATCH candidate experience to job requirements:
   - Extract relevant achievements from resume with specific metrics/results
   - Connect candidate's background directly to job needs
   - Use industry-relevant keywords from the job posting
   - Show understanding of the role and company

3. MANDATORY STRUCTURE - EXACTLY 4 PARAGRAPHS (3-4 sentences each, 300-350 words TOTAL):

PARAGRAPH 1: Strong opening (3-4 sentences)
- Mention the specific job title and company name
- State a brief value proposition
- Express interest in the role

PARAGRAPH 2: Most relevant experience (3-4 sentences)
- Highlight ONE impressive achievement with specific metrics
- Include quantifiable results
- Connect directly to job requirements

PARAGRAPH 3: Additional qualifications (3-4 sentences)
- Highlight 2-3 other relevant skills/experiences
- Show understanding of company values
- Demonstrate industry knowledge

PARAGRAPH 4: Enthusiastic closing (3-4 sentences)
- Express enthusiasm for role and company
- Mention key contribution you can make
- Request interview/next steps

CRITICAL REQUIREMENTS:
- EXACTLY 4 paragraphs (separated by blank lines)
- TOTAL LENGTH: 300-350 words (be concise and impactful)
- Each paragraph: 3-4 sentences (NOT more)
- Count your words and paragraphs before submitting

CANDIDATE RESUME:
${resume}

JOB POSTING CONTENT:
${jobDescription}

Create a highly targeted cover letter that could only work for this specific job. Make it compelling and results-focused. Remember: EXACTLY 4 PARAGRAPHS, 300-350 WORDS TOTAL, 3-4 SENTENCES PER PARAGRAPH. Request: ${requestId}`;

        console.log('🔍 Sending prompt to Claude Haiku 3.5:', prompt.substring(0, 300) + '...');
        console.log('📋 Resume length:', resume.length, 'characters');
        console.log('📋 Job description length:', jobDescription.length, 'characters');

        // Use Claude for cover letter generation
        let completion;
        try {
          completion = await anthropic.messages.create({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 2000,
            temperature: 0.3,
            system: "You are a professional cover letter writer. You must follow formatting instructions exactly. Never include contact information, asterisks, or content outside the specified format.",
            messages: [
              {
                role: "user",
                content: prompt
              }
            ]
          });
        } catch (apiError) {
          console.error('❌ Anthropic API call failed:', apiError.message);
          console.error('❌ API Error details:', apiError.response?.data || apiError);
          console.error('❌ API key configured:', !!process.env.ANTHROPIC_API_KEY);
          throw new Error(`Cover letter generation failed: ${apiError.message}`);
        }

        // Capture token usage from main generation (Claude uses input_tokens and output_tokens)
        const mainTokenUsage = completion.usage || { input_tokens: 0, output_tokens: 0 };
        const totalMainTokens = mainTokenUsage.input_tokens + mainTokenUsage.output_tokens;
        console.log(`📊 Main generation tokens (Claude Haiku 3.5) - Input: ${mainTokenUsage.input_tokens}, Output: ${mainTokenUsage.output_tokens}, Total: ${totalMainTokens}`);

        console.log('Claude Response:', JSON.stringify(completion, null, 2));

        let coverLetter = completion.content[0].text;

        // Initialize total token tracking
        let totalInputTokens = extractionTokens.input + mainTokenUsage.input_tokens;
        let totalOutputTokens = extractionTokens.output + mainTokenUsage.output_tokens;
        let totalTokens = extractionTokens.total + totalMainTokens;

        // Track retry tokens separately (Claude Haiku 3.5)
        let retryInputTokens = 0;
        let retryOutputTokens = 0;

        // PARAGRAPH VALIDATION WITH RETRY
        // Helper function to count content paragraphs (excluding greeting and closing)
        function countContentParagraphs(text) {
          if (!text) return 0;

          // Split by double newlines to get paragraphs
          const paragraphs = text.split('\n\n').filter(p => p.trim().length > 50);

          // Filter out greeting, closing, and candidate name
          const contentParagraphs = paragraphs.filter(p => {
            const lower = p.toLowerCase().trim();
            return !lower.startsWith('dear hiring manager') &&
                   !lower.startsWith('best regards') &&
                   !lower.startsWith('warm regards') &&
                   !lower.startsWith('sincerely') &&
                   !p.includes(candidateName);
          });

          return contentParagraphs.length;
        }

        // Validate paragraph count
        let paragraphCount = countContentParagraphs(coverLetter);
        console.log(`📊 Initial paragraph count: ${paragraphCount} (target: 4)`);

        // If not exactly 4 paragraphs, retry ONCE with enhanced prompt
        if (paragraphCount !== 4) {
          console.log(`⚠️ Wrong paragraph count: ${paragraphCount}. Retrying with enhanced prompt...`);

          const enhancedPrompt = `${prompt}

CRITICAL ALERT: You FAILED the paragraph count requirement. You MUST write EXACTLY 4 paragraphs of content between the greeting and closing.

Structure MUST be:
1. Dear Hiring Manager,
2. [PARAGRAPH 1 - Opening: 3-4 sentences]
3. [PARAGRAPH 2 - Main experience: 3-4 sentences]
4. [PARAGRAPH 3 - Additional qualifications: 3-4 sentences]
5. [PARAGRAPH 4 - Closing: 3-4 sentences]
6. Best Regards,
7. ${candidateName}

CRITICAL: EXACTLY 4 paragraphs, 3-4 sentences each, 300-350 words TOTAL. Count your words and paragraphs before submitting. If you write 3 or 5 paragraphs, you have FAILED.`;

          try {
            const retryCompletion = await anthropic.messages.create({
              model: "claude-3-5-haiku-20241022",
              max_tokens: 2000,
              temperature: 0.3,
              system: "You are a professional cover letter writer. You must follow formatting instructions exactly. CRITICAL: Write EXACTLY 4 paragraphs of content between greeting and closing. Never include contact information, asterisks, or content outside the specified format.",
              messages: [
                {
                  role: "user",
                  content: enhancedPrompt
                }
              ]
            });

            // Capture retry token usage (Claude uses input_tokens and output_tokens)
            const retryTokenUsage = retryCompletion.usage || { input_tokens: 0, output_tokens: 0 };
            const totalRetryTokens = retryTokenUsage.input_tokens + retryTokenUsage.output_tokens;
            console.log(`📊 Retry tokens (Claude Haiku 3.5) - Input: ${retryTokenUsage.input_tokens}, Output: ${retryTokenUsage.output_tokens}, Total: ${totalRetryTokens}`);

            const retryCoverLetter = retryCompletion.content[0].text;
            const retryParagraphCount = countContentParagraphs(retryCoverLetter);
            console.log(`📊 Retry paragraph count: ${retryParagraphCount} (target: 4)`);

            // Use retry result if it's exactly 4, otherwise use whichever is closer to 4
            if (retryParagraphCount === 4) {
              coverLetter = retryCoverLetter;
              paragraphCount = retryParagraphCount;
              console.log('✅ Retry successful! Using retry result with exactly 4 paragraphs.');
              // Update retry tokens since we're using the retry result
              retryInputTokens = retryTokenUsage.input_tokens;
              retryOutputTokens = retryTokenUsage.output_tokens;
              // Update totals
              totalInputTokens += retryInputTokens;
              totalOutputTokens += retryOutputTokens;
              totalTokens += totalRetryTokens;
            } else if (Math.abs(retryParagraphCount - 4) < Math.abs(paragraphCount - 4)) {
              coverLetter = retryCoverLetter;
              paragraphCount = retryParagraphCount;
              console.log(`⚠️ Retry produced ${retryParagraphCount} paragraphs (closer to 4). Using retry result.`);
              // Update retry tokens since we're using the retry result
              retryInputTokens = retryTokenUsage.input_tokens;
              retryOutputTokens = retryTokenUsage.output_tokens;
              // Update totals
              totalInputTokens += retryInputTokens;
              totalOutputTokens += retryOutputTokens;
              totalTokens += totalRetryTokens;
            } else {
              console.log(`⚠️ Retry produced ${retryParagraphCount} paragraphs. Keeping original with ${paragraphCount} paragraphs.`);
              // NOT adding retry tokens since we're not using the retry result
            }
          } catch (retryError) {
            console.error('❌ Retry failed:', retryError.message);
            console.log('⚠️ Using original result despite incorrect paragraph count.');
          }
        } else {
          console.log('✅ Perfect! Cover letter has exactly 4 paragraphs.');
        }

        // Post-process to ensure format requirements
        if (coverLetter) {
          console.log('🔧 Before post-processing:', coverLetter.substring(0, 200));

          // AGGRESSIVE CLEANING - Remove ALL unwanted content

          // 1. Remove all asterisk symbols and bold formatting
          coverLetter = coverLetter.replace(/\*\*/g, ''); // Remove **bold** formatting
          coverLetter = coverLetter.replace(/\*/g, ''); // Remove single asterisks
          coverLetter = coverLetter.replace(/[\u2022\u2023\u25E6\u2043\u204C\u204D]/g, ''); // Remove Unicode bullets

          // 2. Find "Dear Hiring Manager" and extract everything from there
          const dearIndex = coverLetter.toLowerCase().indexOf('dear hiring manager');
          if (dearIndex >= 0) {
            coverLetter = coverLetter.substring(dearIndex);
            console.log('🧹 Removed content before "Dear Hiring Manager"');
          }

          // 3. Split into lines and aggressively clean
          let lines = coverLetter.split('\n');
          let cleanLines = [];
          let inMainContent = false;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Start collecting from "Dear Hiring Manager"
            if (line.toLowerCase().startsWith('dear hiring manager')) {
              inMainContent = true;
              cleanLines.push('Dear Hiring Manager,');
              continue;
            }

            if (inMainContent) {
              // Skip unwanted patterns
              if (
                line.includes('@') || // emails
                line.match(/^\d{3}-\d{3}-\d{4}/) || // phone numbers
                line.includes('[Date]') ||
                line.includes('[LinkedIn]') ||
                line.includes('LinkedIn') ||
                line.includes('canada life assurance company') && line.length < 50 || // short company lines
                line.includes('london, on') && line.length < 20 || // address lines
                line.match(/^\[.*\]$/) || // bracketed placeholders
                line.toLowerCase().includes('hiring manager') && !line.toLowerCase().includes('dear')
              ) {
                console.log('🧹 Skipped unwanted line:', line);
                continue;
              }

              cleanLines.push(line);
            }
          }

          // 4. Fix the ending: find last substantial content and add proper ending
          let lastContentIndex = -1;
          for (let i = cleanLines.length - 1; i >= 0; i--) {
            const line = cleanLines[i].trim();
            // Look for substantial content (long lines that aren't closings/signatures)
            if (line.length > 50 &&
                !line.toLowerCase().includes('warm regards') &&
                !line.toLowerCase().includes('sincerely') &&
                !line.toLowerCase().includes('best regards') &&
                !line.toLowerCase().includes('thank you') &&
                !line.includes(candidateName) &&
                !line.includes('@') &&
                !line.includes('[')) {
              lastContentIndex = i;
              break;
            }
          }

          // Keep only up to last substantial content
          if (lastContentIndex >= 0) {
            cleanLines = cleanLines.slice(0, lastContentIndex + 1);
          }

          // Add proper ending
          cleanLines.push('');
          cleanLines.push('Best Regards,');
          cleanLines.push(candidateName);

          coverLetter = cleanLines.join('\n').trim();

          // Clean up extra whitespace
          coverLetter = coverLetter.replace(/\n\n\n+/g, '\n\n').trim();

          console.log('🔧 After post-processing:', coverLetter.substring(0, 200));
          console.log('🔧 Ending check:', coverLetter.substring(Math.max(0, coverLetter.length - 200)));
        }

        // Add header if profile is configured
        const headerData = generateHeaderForCoverLetter(userProfile, req.user.email);
        if (headerData) {
          console.log('📋 Adding header to cover letter:', headerData);

          // Build header text for plain text version
          let headerText = '';
          if (headerData.line1) {
            headerText += headerData.line1 + '\n';
          }
          if (headerData.line2) {
            headerText += headerData.line2 + '\n';
          }
          headerText += '________________________________\n\n'; // Separator line

          // Prepend header to cover letter
          coverLetter = headerText + coverLetter;
          console.log('✅ Header added to cover letter');
        }

        console.log('Cover letter content:', coverLetter);
        console.log('Cover letter length:', coverLetter ? coverLetter.length : 'null/undefined');

        // Create filename for download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 16); // Shorter timestamp

        // Create filename in format: 'job title-first word of company-date'
        let fileName = '';
        const dateOnly = timestamp.substring(0, 10); // Extract just the date part (YYYY-MM-DD)

        console.log(`🔍 FILENAME DEBUG - Job Title: "${jobTitle}", Company Name: "${companyName}"`);

        if (jobTitle) {
          // Clean job title and remove commas/special chars
          let cleanJobTitle = jobTitle.replace(/[,]/g, '').replace(/\s+/g, '_').replace(/[<>:"/\\|?*]/g, '');

          // Ensure the job title part isn't too long (max 60 chars)
          if (cleanJobTitle.length > 60) {
            cleanJobTitle = cleanJobTitle.substring(0, 60);
          }

          let companyFirstWord = '';

          if (companyName && companyName !== 'Not found') {
            // Extract first meaningful word of company name (skip common words)
            const words = companyName.split(/\s+/);
            for (const word of words) {
              const cleanWord = word.replace(/[,.:]/g, ''); // Remove punctuation
              if (cleanWord.length > 2 &&
                  !['the', 'and', 'inc', 'ltd', 'corp', 'company', 'group'].includes(cleanWord.toLowerCase())) {
                companyFirstWord = cleanWord;
                break;
              }
            }
          }

          console.log(`🔍 FILENAME DEBUG - Clean Job Title: "${cleanJobTitle}", Company First Word: "${companyFirstWord}"`);

          if (companyFirstWord) {
            fileName = `${cleanJobTitle}-${companyFirstWord}-${dateOnly}.docx`;
          } else {
            fileName = `${cleanJobTitle}-${dateOnly}.docx`;
          }

          // Final safety check: limit total filename to 150 chars
          if (fileName.length > 150) {
            fileName = fileName.substring(0, 147) + '.docx';
          }
        } else {
          // Fallback if no job title found
          fileName = `Cover_Letter-${dateOnly}.docx`;
        }

        console.log(`📄 Preparing cover letter as: ${fileName}`);

        let fileData = null; // Will store base64 encoded file

        try {
          // Split cover letter into paragraphs and handle ending properly
          const paragraphs = coverLetter.split('\n\n');
          const docParagraphs = [];

          // Get font settings from user profile (apply to body text)
          const bodyFontSize = (userProfile?.body_font_size || 12) * 2; // Convert points to half-points
          const bodyFont = userProfile?.body_font || 'Calibri';

          // Add header to Word document if configured
          if (headerData) {
            const { line1, line2, alignment, color } = headerData;
            const hexColor = color.replace('#', ''); // Remove # for docx

            // Add name/credentials line
            if (line1) {
              const headerFontSize = (userProfile?.header_font_size || 16) * 2; // Convert points to half-points
              const headerFont = userProfile?.header_font || 'Calibri';
              const credentialsFontSize = headerFontSize - 4; // Two points smaller (4 half-points)

              // Split name and credentials
              const parts = line1.split(', ');
              const name = parts[0];
              const credentials = parts.slice(1).join(', ');

              const textRuns = [
                new TextRun({
                  text: name,
                  size: headerFontSize,
                  font: headerFont,
                  color: hexColor,
                  bold: true
                })
              ];

              // Add credentials if present, with smaller font size
              if (credentials) {
                textRuns.push(new TextRun({
                  text: ', ' + credentials,
                  size: credentialsFontSize,
                  font: headerFont,
                  color: hexColor,
                  bold: true
                }));
              }

              docParagraphs.push(new Paragraph({
                children: textRuns,
                alignment: alignment === 'center' ? 'center' : 'left',
                spacing: {
                  after: 80, // Reduced spacing after name
                  line: 276
                }
              }));
            }

            // Add contact info line
            if (line2) {
              docParagraphs.push(new Paragraph({
                children: [new TextRun({
                  text: line2,
                  size: 24, // 12pt font
                  font: 'Calibri',
                  color: hexColor
                })],
                alignment: alignment === 'center' ? 'center' : 'left',
                spacing: {
                  after: 120, // Spacing after contact line
                  line: 276
                }
              }));
            }

            // Add horizontal line separator using border
            docParagraphs.push(new Paragraph({
              children: [new TextRun({ text: '' })],
              border: {
                top: {
                  color: hexColor,
                  space: 1,
                  style: 'single',
                  size: 18 // Increased from 6 to make it bolder
                }
              },
              spacing: {
                after: 300, // Match paragraph spacing (reduced from 400)
                line: 276
              }
            }));
          }

          for (let p = 0; p < paragraphs.length; p++) {
            const paragraphText = paragraphs[p].trim();

            // Skip the entire first paragraph if it contains the header (header lines are joined with \n)
            if (headerData && p === 0 && (
              paragraphText.includes(headerData.line1) ||
              paragraphText.includes('________________________________')
            )) {
              console.log('🧹 Skipping header paragraph in Word document (already added as formatted header)');
              continue;
            }

            // Check if this is the "Best Regards," line
            if (paragraphText === 'Best Regards,' && p === paragraphs.length - 1) {
              // This means "Best Regards," and name are on same line, split them
              const parts = paragraphText.split(',');

              // Add "Best Regards," paragraph
              docParagraphs.push(new Paragraph({
                children: [new TextRun({
                  text: 'Best Regards,',
                  size: bodyFontSize,
                  font: bodyFont,
                })],
                spacing: {
                  after: 200, // Increased spacing
                  line: 276, // 1.15 line spacing (240 = single, 276 = 1.15, 360 = 1.5, 480 = double)
                }
              }));

              // Add name paragraph separately
              // Split name and credentials for signature
              const nameParts = candidateName.split(', ');
              const signatureName = nameParts[0];
              const signatureCredentials = nameParts.slice(1).join(', ');
              const credentialsFontSize = bodyFontSize - 4; // Two points smaller (4 half-points)

              const signatureRuns = [
                new TextRun({
                  text: signatureName,
                  size: bodyFontSize,
                  font: bodyFont,
                })
              ];

              if (signatureCredentials) {
                signatureRuns.push(new TextRun({
                  text: ', ' + signatureCredentials,
                  size: credentialsFontSize,
                  font: bodyFont,
                }));
              }

              docParagraphs.push(new Paragraph({
                children: signatureRuns,
                spacing: {
                  after: 300, // Increased spacing
                  line: 276, // 1.15 line spacing
                }
              }));
            } else if (paragraphText.includes('Best Regards,') && paragraphText.includes(candidateName)) {
              // Handle case where they're combined in one line
              docParagraphs.push(new Paragraph({
                children: [new TextRun({
                  text: 'Best Regards,',
                  size: 24, // 12pt font
                  font: 'Calibri',
                })],
                spacing: {
                  after: 200,
                  line: 276,
                }
              }));

              // Split name and credentials for signature
              const nameParts = candidateName.split(', ');
              const signatureName = nameParts[0];
              const signatureCredentials = nameParts.slice(1).join(', ');
              const credentialsFontSize = bodyFontSize - 4; // Two points smaller (4 half-points)

              const signatureRuns = [
                new TextRun({
                  text: signatureName,
                  size: bodyFontSize,
                  font: bodyFont,
                })
              ];

              if (signatureCredentials) {
                signatureRuns.push(new TextRun({
                  text: ', ' + signatureCredentials,
                  size: credentialsFontSize,
                  font: bodyFont,
                }));
              }

              docParagraphs.push(new Paragraph({
                children: signatureRuns,
                spacing: {
                  after: 300,
                  line: 276,
                }
              }));
            } else if (paragraphText.includes('Warm Regards,')) {
              // Handle legacy "Warm Regards" and convert to "Best Regards"
              const updatedText = paragraphText.replace('Warm Regards,', 'Best Regards,');
              if (updatedText.includes(candidateName)) {
                // Split them
                docParagraphs.push(new Paragraph({
                  children: [new TextRun({
                    text: 'Best Regards,',
                    size: 24,
                    font: 'Calibri',
                  })],
                  spacing: {
                    after: 200,
                    line: 276,
                  }
                }));

                // Split name and credentials for signature
                const nameParts = candidateName.split(', ');
                const signatureName = nameParts[0];
                const signatureCredentials = nameParts.slice(1).join(', ');
                const credentialsFontSize = bodyFontSize - 4; // Two points smaller (4 half-points)

                const signatureRuns = [
                  new TextRun({
                    text: signatureName,
                    size: bodyFontSize,
                    font: bodyFont,
                  })
                ];

                if (signatureCredentials) {
                  signatureRuns.push(new TextRun({
                    text: ', ' + signatureCredentials,
                    size: credentialsFontSize,
                    font: bodyFont,
                  }));
                }

                docParagraphs.push(new Paragraph({
                  children: signatureRuns,
                  spacing: {
                    after: 300,
                    line: 276,
                  }
                }));
              } else {
                docParagraphs.push(new Paragraph({
                  children: [new TextRun({
                    text: 'Best Regards,',
                    size: 24,
                    font: 'Calibri',
                  })],
                  spacing: {
                    after: 200,
                    line: 276,
                  }
                }));
              }
            } else {
              // Regular paragraph
              docParagraphs.push(new Paragraph({
                children: [new TextRun({
                  text: paragraphText,
                  size: bodyFontSize,
                  font: bodyFont,
                })],
                spacing: {
                  after: 300, // Increased spacing after each paragraph
                  line: 276, // 1.15 line spacing
                }
              }));
            }
          }

          // Get page margin settings from user profile (using page_border field for backwards compatibility)
          const marginSetting = userProfile?.page_border || 'narrow';
          console.log(`📐 Applying page margins: ${marginSetting}`);

          // MS Word margin presets (in twips: 1 inch = 1440 twips)
          const marginSizes = {
            'none': 1440,      // Normal: 1 inch on all sides
            'narrow': 720,     // Narrow: 0.5 inches on all sides
            'moderate': 1440,  // Moderate: 1 inch on all sides (same as normal)
            'wide': 2160       // Wide: 1.5 inches on all sides
          };
          const marginSize = marginSizes[marginSetting] || 720;

          // Create section properties with page margins
          const sectionProperties = {
            page: {
              margin: {
                top: marginSize,
                right: marginSize,
                bottom: marginSize,
                left: marginSize
              }
            }
          };

          console.log(`✅ Page margins applied: ${marginSize} twips (${marginSetting} = ${(marginSize / 1440).toFixed(2)} inches)`);

          // Create Word document
          const doc = new Document({
            sections: [{
              properties: sectionProperties,
              children: docParagraphs
            }]
          });

          // Generate the document buffer
          const buffer = await Packer.toBuffer(doc);

          // Convert to base64 for sending to frontend
          fileData = buffer.toString('base64');
          console.log(`📄 Cover letter generated as Word document: ${fileName}`);
        } catch (saveError) {
          console.error('Error creating cover letter as Word document:', saveError);
        }

        const jobDuration = ((Date.now() - jobStartTime) / 1000).toFixed(2);
        console.log(`✅ [Job ${index + 1}] Completed in ${jobDuration}s`);

        await usageOps.incrementUsage(req.user.id);

        // Track successful generation with token data
        console.log(`📊 Total tokens for job ${index + 1} - Input: ${totalInputTokens}, Output: ${totalOutputTokens}, Total: ${totalTokens}`);

        // Pass model-specific token data
        await analyticsOps.trackGenerationAttempt(
          req.user.id,
          jobUrl,
          isManualJob,
          true,  // success
          null,  // error message
          Date.now() - jobStartTime,
          {
            extractionInput: extractionTokens.input,
            extractionOutput: extractionTokens.output,
            generationInput: mainTokenUsage.input_tokens,
            generationOutput: mainTokenUsage.output_tokens,
            retryInput: retryInputTokens,
            retryOutput: retryOutputTokens
          }
        );

        return {
          jobUrl: jobUrl,
          coverLetter: coverLetter,
          fileData: fileData,
          fileName: fileName,
          success: true,
          usedFallback: usedFallback,
          fallbackReason: fallbackReason
        };

      } catch (error) {
        const jobDuration = ((Date.now() - jobStartTime) / 1000).toFixed(2);
        console.error(`❌ [Job ${index + 1}] Failed after ${jobDuration}s:`, error.message);

        // Track failed generation
        await analyticsOps.trackGenerationAttempt(
          req.user.id,
          jobUrl,
          isManualJob,
          false,
          error.message,
          Date.now() - jobStartTime,
          {
            extractionInput: 0,
            extractionOutput: 0,
            generationInput: 0,
            generationOutput: 0,
            retryInput: 0,
            retryOutput: 0
          }
        );

        return {
          jobUrl: jobUrl,
          error: isManualJob
            ? 'Failed to generate cover letter. Please check your job details.'
            : 'Unable to process this job URL. Please try Manual Paste instead.',
          success: false
        };
      }
    };

    // Process jobs in batches
    for (let batchStart = 0; batchStart < jobUrls.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, jobUrls.length);
      const batch = jobUrls.slice(batchStart, batchEnd);

      console.log(`\n📦 Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: Jobs ${batchStart + 1}-${batchEnd}`);
      const batchStartTime = Date.now();

      // Process batch in parallel
      const batchPromises = batch.map((jobItem, batchIndex) =>
        processJob(jobItem, batchStart + batchIndex)
      );

      const batchResults = await Promise.allSettled(batchPromises);

      // Collect results
      batchResults.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);

          // Check if limit was reached mid-batch
          if (result.value.limitReached) {
            console.log('⛔ Usage limit reached - stopping processing');
            return res.status(403).json({
              error: 'Usage limit reached',
              message: 'You have reached your monthly limit.',
              results: results
            });
          }
        } else {
          console.error(`❌ Batch job ${batchStart + i + 1} rejected:`, result.reason);
          results.push({
            jobUrl: `job-${batchStart + i + 1}`,
            success: false,
            error: 'Unexpected error processing job'
          });
        }
      });

      const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2);
      const successCount = batchResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
      console.log(`✅ Batch completed in ${batchDuration}s (${successCount}/${batch.length} successful)\n`);
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    const totalSuccess = results.filter(r => r.success).length;
    console.log(`\n🎉 All jobs completed in ${totalDuration}s (${totalSuccess}/${jobUrls.length} successful)`);

    res.json({ results });
  } catch (error) {
    console.error('❌ CRITICAL ERROR generating cover letters:', error.message);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', error);
    res.status(500).json({ error: `Failed to generate cover letters: ${error.message}` });
  }
});

// Local proxy endpoint for testing (matches Vercel structure)
app.post('/api/proxy', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { url, method = 'GET', headers = {} } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const response = await axios({
      method,
      url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...headers
      }
    });

    res.json({
      data: response.data,
      contentType: response.headers['content-type']
    });

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch the requested URL',
      details: error.message
    });
  }
});

// Route to download cover letter
app.post('/api/download-cover-letter', (req, res) => {
  try {
    const { coverLetter, fileName } = req.body;

    // Get the user's Downloads folder
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const filePath = path.join(downloadsPath, fileName || 'cover-letter.txt');

    // Write the cover letter to file
    fs.writeFileSync(filePath, coverLetter);

    res.json({ success: true, filePath });
  } catch (error) {
    console.error('Error saving cover letter:', error);
    res.status(500).json({ error: 'Failed to save cover letter' });
  }
});

// Only start server if not in Vercel serverless environment
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT} (Auto-restart enabled)`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is busy, trying port ${PORT + 1}`);
      PORT = PORT + 1;
      app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    } else {
      console.error('Server error:', err);
    }
  });
}

// Export for Vercel serverless
module.exports = app;