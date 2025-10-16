/**
 * Advanced Scraping Service with 3-Tier Hybrid Approach
 *
 * Tier 1: Enhanced basic fetch (FREE) - ~75% success
 * Tier 2: Apify with job board actors - ~90% success
 * Tier 3: Puppeteer fallback (future) - ~98% success
 *
 * Target: 95%+ overall success rate
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { ApifyClient } = require('apify-client');

// Initialize Apify client if enabled
let apifyClient = null;
if (process.env.ENABLE_APIFY_SCRAPING === 'true' && process.env.APIFY_API_TOKEN) {
  apifyClient = new ApifyClient({
    token: process.env.APIFY_API_TOKEN
  });
  console.log('✅ Apify scraping enabled');
} else {
  console.log('ℹ️  Apify scraping disabled (using basic fetch only)');
}

/**
 * TIER 1: Enhanced Basic Fetch with Smart URL Parsing
 * Handles Indeed URL parsing and enhanced headers
 */
async function tier1_enhancedBasicFetch(url) {
  console.log('🔍 Tier 1: Trying enhanced basic fetch...');

  // Parse Indeed URLs to get direct job posting URL
  let fetchUrl = url;
  if (url.includes('indeed.com')) {
    const vjkMatch = url.match(/[?&]vjk=([a-f0-9]+)/i);
    if (vjkMatch) {
      const jobKey = vjkMatch[1];
      // Determine domain (ca.indeed.com vs www.indeed.com)
      const domain = url.includes('ca.indeed.com') ? 'ca.indeed.com' : 'www.indeed.com';
      fetchUrl = `https://${domain}/viewjob?jk=${jobKey}`;
      console.log(`   📍 Converted Indeed URL: ${fetchUrl}`);
    }
  }

  // Enhanced headers to mimic real browser
  const enhancedHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'DNT': '1'
  };

  // Add referer for specific sites
  if (url.includes('indeed.com')) {
    enhancedHeaders['Referer'] = 'https://www.indeed.com/';
  } else if (url.includes('linkedin.com')) {
    enhancedHeaders['Referer'] = 'https://www.linkedin.com/';
  }

  const response = await axios.get(fetchUrl, {
    headers: enhancedHeaders,
    maxRedirects: 5,
    timeout: 10000
  });

  const $ = cheerio.load(response.data);

  // Remove unwanted elements
  $('script, style, nav, header, footer, .cookie-banner, .cookies, .gdpr, .privacy-notice, .advertisement').remove();

  // Try to extract specific job information
  let jobTitle = '';
  let jobDescription = '';
  let companyName = '';

  // Extract job title (with Indeed-specific selectors)
  const titleSelectors = [
    'h1.jobsearch-JobInfoHeader-title',  // Indeed specific
    'h1',
    '.job-title',
    '[data-automation="job-title"]',
    '.posting-title',
    '.jobTitle'
  ];

  for (const selector of titleSelectors) {
    const title = $(selector).first().text().trim();
    if (title && title.length > jobTitle.length && title.length < 200) {
      jobTitle = title;
    }
  }

  // Extract company name (with Indeed-specific selectors)
  const companySelectors = [
    '[data-company-name="true"]',  // Indeed specific
    '.jobsearch-CompanyInfoContainer',  // Indeed specific
    '.company-name',
    '.employer-name',
    '[data-automation="company-name"]'
  ];

  for (const selector of companySelectors) {
    const company = $(selector).first().text().trim();
    if (company && company.length > companyName.length && company.length < 100) {
      companyName = company;
    }
  }

  // Extract job description (with Indeed-specific selectors)
  const descriptionSelectors = [
    '#jobDescriptionText',  // Indeed specific
    '.jobsearch-jobDescriptionText',  // Indeed specific
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

  // If we still don't have good content, fall back to body
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

  console.log(`   ✅ Tier 1 Success - Extracted:`);
  console.log(`      📋 Job Title: ${jobTitle || 'Not found'}`);
  console.log(`      🏢 Company: ${companyName || 'Not found'}`);
  console.log(`      📄 Description: ${jobDescription.length} chars`);

  return finalText;
}

/**
 * TIER 2: Apify with Job Board Actors
 * Uses specialized actors for Indeed, LinkedIn, etc.
 */
async function tier2_apifyFetch(url) {
  if (!apifyClient) {
    throw new Error('Apify client not initialized');
  }

  console.log('🚀 Tier 2: Trying Apify scraping...');

  // Detect job board and use appropriate actor
  if (url.includes('indeed.com')) {
    return await apifyFetchIndeed(url);
  } else if (url.includes('linkedin.com')) {
    return await apifyFetchLinkedIn(url);
  } else {
    // Use generic web scraper for other sites
    return await apifyFetchGeneric(url);
  }
}

/**
 * Apify: Indeed-specific scraping
 */
async function apifyFetchIndeed(url) {
  console.log('   📍 Using Apify Indeed actor...');

  // Extract job key from URL
  const vjkMatch = url.match(/[?&]vjk=([a-f0-9]+)/i);
  if (!vjkMatch) {
    throw new Error('Could not extract Indeed job key from URL');
  }

  const jobKey = vjkMatch[1];
  const country = url.includes('ca.indeed.com') ? 'CA' : 'US';

  try {
    // Use Apify's web scraper actor with Indeed-specific configuration
    const run = await apifyClient.actor('apify/cheerio-scraper').call({
      startUrls: [{ url: `https://${country === 'CA' ? 'ca' : 'www'}.indeed.com/viewjob?jk=${jobKey}` }],
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 3,
      pageFunction: async function pageFunction(context) {
        const { $, request } = context;

        // Remove unwanted elements
        $('script, style, nav, header, footer').remove();

        // Extract job information
        const jobTitle = $('h1.jobsearch-JobInfoHeader-title, h1').first().text().trim();
        const companyName = $('[data-company-name="true"], .jobsearch-CompanyInfoContainer').first().text().trim();
        const jobDescription = $('#jobDescriptionText, .jobsearch-jobDescriptionText, .job-description').first().text().trim();

        return {
          url: request.url,
          jobTitle,
          companyName,
          jobDescription: jobDescription || $('body').text().trim().substring(0, 5000)
        };
      }
    });

    // Wait for actor to finish and get results
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

    if (!items || items.length === 0) {
      throw new Error('Apify returned no results');
    }

    const data = items[0];

    // Construct response
    let finalText = '';
    if (data.jobTitle) finalText += `Job Title: ${data.jobTitle}\n\n`;
    if (data.companyName) finalText += `Company: ${data.companyName}\n\n`;
    finalText += `Job Description:\n${data.jobDescription}`;

    console.log(`   ✅ Tier 2 Success (Apify Indeed) - Extracted:`);
    console.log(`      📋 Job Title: ${data.jobTitle || 'Not found'}`);
    console.log(`      🏢 Company: ${data.companyName || 'Not found'}`);
    console.log(`      📄 Description: ${data.jobDescription?.length || 0} chars`);

    return finalText;
  } catch (error) {
    console.error(`   ❌ Tier 2 Failed (Apify Indeed):`, error.message);
    throw error;
  }
}

/**
 * Apify: LinkedIn-specific scraping
 */
async function apifyFetchLinkedIn(url) {
  console.log('   📍 Using Apify LinkedIn actor...');

  // LinkedIn is challenging - for now use generic scraper
  // TODO: Implement LinkedIn-specific actor when authentication is available
  return await apifyFetchGeneric(url);
}

/**
 * Apify: Generic web scraper for other sites
 */
async function apifyFetchGeneric(url) {
  console.log('   📍 Using Apify generic web scraper...');

  try {
    const run = await apifyClient.actor('apify/cheerio-scraper').call({
      startUrls: [{ url }],
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 3,
      pageFunction: async function pageFunction(context) {
        const { $, request } = context;

        // Remove unwanted elements
        $('script, style, nav, header, footer, .cookie-banner').remove();

        // Try to extract job information
        const jobTitle = $('h1, .job-title, [data-automation="job-title"]').first().text().trim();
        const companyName = $('.company-name, .employer-name').first().text().trim();
        const jobDescription = $('.job-description, .description, main').first().text().trim();

        return {
          url: request.url,
          jobTitle,
          companyName,
          jobDescription: jobDescription || $('body').text().trim().substring(0, 5000)
        };
      }
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

    if (!items || items.length === 0) {
      throw new Error('Apify returned no results');
    }

    const data = items[0];

    let finalText = '';
    if (data.jobTitle) finalText += `Job Title: ${data.jobTitle}\n\n`;
    if (data.companyName) finalText += `Company: ${data.companyName}\n\n`;
    finalText += `Job Description:\n${data.jobDescription}`;

    console.log(`   ✅ Tier 2 Success (Apify Generic) - Extracted:`);
    console.log(`      📋 Job Title: ${data.jobTitle || 'Not found'}`);
    console.log(`      🏢 Company: ${data.companyName || 'Not found'}`);
    console.log(`      📄 Description: ${data.jobDescription?.length || 0} chars`);

    return finalText;
  } catch (error) {
    console.error(`   ❌ Tier 2 Failed (Apify Generic):`, error.message);
    throw error;
  }
}

/**
 * TIER 3: Puppeteer Fallback (Future Implementation)
 * For the most stubborn sites
 */
async function tier3_puppeteerFetch(url) {
  console.log('🎭 Tier 3: Puppeteer fallback not yet implemented');
  throw new Error('Puppeteer fallback not implemented yet');
}

/**
 * Validate extracted content
 * Returns true if content appears valid, false otherwise
 */
function validateExtractedContent(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }

  // Check minimum length
  const descriptionPart = content.split('Job Description:')[1] || content;
  if (descriptionPart.length < 500) {
    console.log(`   ⚠️  Content too short: ${descriptionPart.length} chars`);
    return false;
  }

  // Check for login walls
  const lowerContent = descriptionPart.toLowerCase();
  if (lowerContent.includes('sign in') && descriptionPart.length < 1000) {
    console.log(`   ⚠️  Detected login wall`);
    return false;
  }

  if (lowerContent.includes('keep me logged in')) {
    console.log(`   ⚠️  Detected login requirement`);
    return false;
  }

  return true;
}

/**
 * Main Hybrid Scraping Function
 * Tries each tier in sequence until success
 */
async function fetchJobDescriptionHybrid(url) {
  console.log(`\n🔄 Starting hybrid scraping for: ${url}`);

  // TIER 1: Enhanced Basic Fetch (always try first - it's free!)
  try {
    const result = await tier1_enhancedBasicFetch(url);
    if (validateExtractedContent(result)) {
      console.log('✅ Tier 1 SUCCESS - Using enhanced basic fetch result\n');
      return result;
    }
    console.log('⚠️  Tier 1 result invalid, trying next tier...');
  } catch (error) {
    console.log(`⚠️  Tier 1 failed: ${error.message}, trying next tier...`);
  }

  // TIER 2: Apify (only if enabled)
  if (process.env.ENABLE_APIFY_SCRAPING === 'true' && apifyClient) {
    try {
      const result = await tier2_apifyFetch(url);
      if (validateExtractedContent(result)) {
        console.log('✅ Tier 2 SUCCESS - Using Apify result\n');
        return result;
      }
      console.log('⚠️  Tier 2 result invalid, trying next tier...');
    } catch (error) {
      console.log(`⚠️  Tier 2 failed: ${error.message}, trying next tier...`);
    }
  }

  // TIER 3: Puppeteer (only if enabled - future implementation)
  if (process.env.ENABLE_PUPPETEER_FALLBACK === 'true') {
    try {
      const result = await tier3_puppeteerFetch(url);
      if (validateExtractedContent(result)) {
        console.log('✅ Tier 3 SUCCESS - Using Puppeteer result\n');
        return result;
      }
    } catch (error) {
      console.log(`⚠️  Tier 3 failed: ${error.message}`);
    }
  }

  // All tiers failed
  console.log('❌ ALL TIERS FAILED - Could not extract job description\n');
  throw new Error('Could not extract meaningful job description from URL');
}

module.exports = {
  fetchJobDescriptionHybrid,
  tier1_enhancedBasicFetch,
  tier2_apifyFetch
};
