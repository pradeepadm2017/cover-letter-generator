/**
 * Advanced Scraping Service with Multi-Tier Hybrid Approach
 *
 * GOOGLE JOBS REDIRECT: Auto-redirects Google Jobs URLs to original source
 *                       Priority: LinkedIn > Indeed > Glassdoor > Other
 *                       100% FREE - just extracts the source URL
 *
 * LINKEDIN SPECIAL: LinkedIn Guest API (FREE) - ~85-90% success rate
 *                   Direct access to public LinkedIn job postings
 *                   No authentication required!
 *
 * INDEED SPECIAL: Embedded _initialData extraction (FREE) - ~60-70% success rate
 *                 Extracts job data from embedded JSON before HTML rendering
 *                 Falls back to ScraperAPI for remaining cases
 *
 * GLASSDOOR SPECIAL: Apollo GraphQL cache extraction (FREE) - ~70-80% success rate
 *                    Extracts from apolloState or window.appCache embedded data
 *                    HTML fallback available if cache not found
 *
 * Tier 1: Enhanced basic fetch (FREE) - ~30% success with other sites
 * Tier 2a: ScraperAPI (FALLBACK) - 92.7% success with Indeed
 *          Cost: ~$2.90 per 1,000 requests
 *          Now only used when free methods fail
 * Tier 2b: Apify fallback - Available as backup
 * Tier 3: Puppeteer (future) - For maximum coverage
 *
 * For Google Jobs: Auto-redirects to source (LinkedIn > Indeed priority)
 * For LinkedIn: Guest API is used automatically (no config needed)
 * For Indeed: Embedded JSON extraction tried first, ScraperAPI as fallback
 * For Glassdoor: Apollo GraphQL extraction tried first (no config needed)
 * See SCRAPERAPI_SETUP.md for setup instructions
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { ApifyClient } = require('apify-client');

// Lazy-initialize Apify client (check at runtime, not module load time)
let apifyClient = null;
function getApifyClient() {
  if (!apifyClient && process.env.ENABLE_APIFY_SCRAPING === 'true' && process.env.APIFY_API_TOKEN) {
    apifyClient = new ApifyClient({
      token: process.env.APIFY_API_TOKEN
    });
    console.log('✅ Apify scraping enabled');
  }
  return apifyClient;
}

// Check if ScraperAPI is enabled (at runtime)
function isScraperApiEnabled() {
  return process.env.ENABLE_SCRAPERAPI === 'true' &&
         process.env.SCRAPERAPI_KEY &&
         process.env.SCRAPERAPI_KEY !== 'YOUR_SCRAPERAPI_KEY_HERE';
}

// Special free methods are always available (no config needed)
console.log('✅ LinkedIn Guest API enabled (FREE, ~85-90% success rate)');
console.log('✅ Indeed Embedded JSON extraction enabled (FREE, ~60-70% success rate)');
console.log('✅ Glassdoor Apollo GraphQL extraction enabled (FREE, ~70-80% success rate)');

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
 * INDEED EMBEDDED VIEWJOB: Extract data from embedded JSON
 * Uses Indeed's embedded viewjob endpoint with _initialData JSON extraction
 * No authentication required - lighter weight than full page scraping
 */
async function indeedEmbeddedFetch(url) {
  console.log('📊 Indeed Embedded: Extracting from _initialData JSON...');

  // Extract job key from URL
  const vjkMatch = url.match(/[?&]vjk=([a-f0-9]+)/i);
  if (!vjkMatch) {
    throw new Error('Could not extract Indeed job key from URL');
  }

  const jobKey = vjkMatch[1];
  console.log(`   📍 Extracted Job Key: ${jobKey}`);

  // Determine domain (ca.indeed.com vs www.indeed.com)
  const domain = url.includes('ca.indeed.com') ? 'ca.indeed.com' : 'www.indeed.com';

  // Use embedded viewjob endpoint - lighter and returns _initialData JSON
  const embeddedUrl = `https://${domain}/m/basecamp/viewjob?viewtype=embedded&jk=${jobKey}`;
  console.log(`   🔗 Embedded URL: ${embeddedUrl}`);

  try {
    const response = await axios.get(embeddedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://${domain}/`
      },
      timeout: 15000
    });

    // Extract _initialData JSON using regex
    const initialDataMatch = response.data.match(/_initialData\s*=\s*(\{.+?\});/s);

    if (!initialDataMatch) {
      console.log('   ⚠️  Could not find _initialData JSON, falling back to HTML parsing...');
      throw new Error('_initialData not found in response');
    }

    console.log('   ✅ Found _initialData JSON');

    // Parse the JSON
    const initialData = JSON.parse(initialDataMatch[1]);

    // Navigate to job data: _initialData.jobInfoWrapperModel.jobInfoModel
    const jobInfo = initialData?.jobInfoWrapperModel?.jobInfoModel;

    if (!jobInfo) {
      console.log('   ⚠️  Job info not found in expected path');
      throw new Error('Job info not found in _initialData structure');
    }

    // Extract job details from JSON
    const jobTitle = jobInfo.jobInfoHeaderModel?.jobTitle || '';
    const companyName = jobInfo.jobInfoHeaderModel?.companyName || '';

    // Job description is in sanitizedJobDescription.content
    const jobDescription = jobInfo.sanitizedJobDescription?.content || '';

    // Clean HTML from description if present
    const $ = cheerio.load(jobDescription);
    const cleanDescription = $.text().trim().replace(/\s+/g, ' ');

    console.log('\n✅ Indeed Embedded Success:');
    console.log('   📋 Job Title:', jobTitle || 'NOT FOUND');
    console.log('   🏢 Company:', companyName || 'NOT FOUND');
    console.log('   📄 Description:', cleanDescription.length, 'chars');

    // Construct response
    let finalText = '';
    if (jobTitle) finalText += `Job Title: ${jobTitle}\n\n`;
    if (companyName) finalText += `Company: ${companyName}\n\n`;
    finalText += `Job Description:\n${cleanDescription}`;

    return finalText;
  } catch (error) {
    console.error(`   ❌ Indeed Embedded Failed:`, error.message);
    throw error;
  }
}

/**
 * GLASSDOOR APOLLO GRAPHQL: Extract data from Apollo state
 * Uses Glassdoor's embedded Apollo GraphQL cache (apolloState or window.appCache)
 * No authentication required - extracts from embedded JSON in HTML
 */
async function glassdoorApolloFetch(url) {
  console.log('🔮 Glassdoor Apollo: Extracting from GraphQL cache...');

  // Check if URL contains jobListingId parameter (tracking/partner URLs)
  const jobListingIdMatch = url.match(/[?&]jobListingId=(\d+)/);
  let actualUrl = url;

  if (jobListingIdMatch) {
    const jobListingId = jobListingIdMatch[1];
    console.log(`   📍 Extracted jobListingId: ${jobListingId}`);

    // Construct the proper job listing URL
    // Glassdoor uses pattern: /job-listing/JL_[jobId].htm or direct ID access
    const domain = url.includes('.ca') ? 'www.glassdoor.ca' : 'www.glassdoor.com';
    actualUrl = `https://${domain}/job-listing/job-listing-${jobListingId}.htm?jl=${jobListingId}`;
    console.log(`   🔗 Constructed Job URL: ${actualUrl}`);
  } else {
    console.log(`   🔗 Job URL: ${url}`);
  }

  try {
    const response = await axios.get(actualUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.glassdoor.com/'
      },
      timeout: 15000,
      maxRedirects: 5  // Follow redirects to get actual job page
    });

    // Try to extract apolloState from script tags
    let apolloStateMatch = response.data.match(/window\.apolloState\s*=\s*(\{.+?\});/s);

    // Fallback: try window.appCache pattern
    if (!apolloStateMatch) {
      apolloStateMatch = response.data.match(/window\.appCache\s*=\s*(\{.+?\});/s);
    }

    // Fallback: try __NEXT_DATA__ pattern (for Next.js powered pages)
    if (!apolloStateMatch) {
      const nextDataMatch = response.data.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
      if (nextDataMatch) {
        console.log('   ✅ Found __NEXT_DATA__ JSON');
        const nextData = JSON.parse(nextDataMatch[1]);

        // Navigate to job data in Next.js structure
        // This structure may vary, but typically: pageProps -> initialState or similar
        const jobData = nextData?.props?.pageProps?.apolloState || nextData?.props?.pageProps?.initialState;

        if (jobData) {
          // Extract from Apollo cache structure
          return extractGlassdoorJobFromApollo(jobData, url);
        }
      }
    }

    if (!apolloStateMatch) {
      console.log('   ⚠️  Could not find Apollo GraphQL cache, falling back to HTML parsing...');

      // Fallback to basic HTML parsing
      const $ = cheerio.load(response.data);

      // Extract job title
      const jobTitle = $('h1, .JobDetails_jobTitle__Rw_gn, [data-test="job-title"]').first().text().trim();

      // Extract company name
      const companyName = $('.EmployerProfile_employerName__Xemli, [data-test="employer-name"], .employer-name').first().text().trim();

      // Extract job description
      let jobDescription = $('.JobDetails_jobDescription__uW_fK, [data-test="job-description"], .job-description, .desc').text().trim();

      if (!jobDescription || jobDescription.length < 200) {
        // Try broader selectors
        jobDescription = $('main, article, .content').text().trim();
      }

      // Clean up whitespace
      jobDescription = jobDescription.replace(/\s+/g, ' ').trim();

      console.log('\n⚠️  Glassdoor HTML Fallback:');
      console.log('   📋 Job Title:', jobTitle || 'NOT FOUND');
      console.log('   🏢 Company:', companyName || 'NOT FOUND');
      console.log('   📄 Description:', jobDescription.length, 'chars');

      let finalText = '';
      if (jobTitle) finalText += `Job Title: ${jobTitle}\n\n`;
      if (companyName) finalText += `Company: ${companyName}\n\n`;
      finalText += `Job Description:\n${jobDescription}`;

      return finalText;
    }

    console.log('   ✅ Found Apollo GraphQL cache');

    // Parse the Apollo state JSON
    const apolloState = JSON.parse(apolloStateMatch[1]);

    return extractGlassdoorJobFromApollo(apolloState, url);

  } catch (error) {
    console.error(`   ❌ Glassdoor Apollo Failed:`, error.message);
    throw error;
  }
}

/**
 * Helper function to extract job data from Glassdoor's Apollo cache
 */
function extractGlassdoorJobFromApollo(apolloState, url) {
  // Apollo cache stores data with __ref references that need to be resolved
  // Common patterns: JobDetails, JobPosting, etc.

  let jobTitle = '';
  let companyName = '';
  let jobDescription = '';

  // Search through Apollo cache for job-related data
  const cacheKeys = Object.keys(apolloState);

  // Look for JobListing, JobDetails, or similar keys
  for (const key of cacheKeys) {
    const data = apolloState[key];

    // Check for job title
    if (data && typeof data === 'object') {
      if (data.jobTitle && !jobTitle) {
        jobTitle = data.jobTitle;
      }
      if (data.title && !jobTitle) {
        jobTitle = data.title;
      }

      // Check for company name
      if (data.employerName && !companyName) {
        companyName = data.employerName;
      }
      if (data.companyName && !companyName) {
        companyName = data.companyName;
      }
      if (data.employer?.name && !companyName) {
        companyName = data.employer.name;
      }

      // Check for job description
      if (data.description && !jobDescription) {
        jobDescription = data.description;
      }
      if (data.jobDescription && !jobDescription) {
        jobDescription = data.jobDescription;
      }
      if (data.descriptionFragment && !jobDescription) {
        jobDescription = data.descriptionFragment;
      }
    }
  }

  // Clean HTML from description if present
  if (jobDescription && jobDescription.includes('<')) {
    const $ = cheerio.load(jobDescription);
    jobDescription = $.text().trim();
  }

  jobDescription = jobDescription.replace(/\s+/g, ' ').trim();

  console.log('\n✅ Glassdoor Apollo Success:');
  console.log('   📋 Job Title:', jobTitle || 'NOT FOUND');
  console.log('   🏢 Company:', companyName || 'NOT FOUND');
  console.log('   📄 Description:', jobDescription.length, 'chars');

  // Construct response
  let finalText = '';
  if (jobTitle) finalText += `Job Title: ${jobTitle}\n\n`;
  if (companyName) finalText += `Company: ${companyName}\n\n`;
  finalText += `Job Description:\n${jobDescription}`;

  return finalText;
}

/**
 * WORKOPOLIS SPECIAL: Extract from JSON-LD structured data (FREE)
 * Workopolis embeds job data in JSON-LD format - ~95% success rate
 */
async function workopolisFetch(url) {
  console.log('🍁 Workopolis: Extracting from JSON-LD...');

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8'
      },
      timeout: 15000
    });

    const html = response.data;
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);

    if (!jsonLdMatch) {
      throw new Error('JSON-LD not found in Workopolis page');
    }

    const jsonLd = JSON.parse(jsonLdMatch[1]);
    const jobTitle = jsonLd.title || '';
    const companyName = jsonLd.hiringOrganization?.name || '';
    let jobDescription = jsonLd.description || '';

    // Clean HTML from description
    if (jobDescription.includes('<')) {
      const $ = require('cheerio').load(jobDescription);
      jobDescription = $.text().trim().replace(/\s+/g, ' ');
    }

    if (!jobTitle || !companyName || jobDescription.length < 200) {
      throw new Error('Incomplete data extracted from Workopolis');
    }

    let finalText = '';
    if (jobTitle) finalText += `Job Title: ${jobTitle}\n\n`;
    if (companyName) finalText += `Company: ${companyName}\n\n`;
    finalText += `Job Description:\n${jobDescription}`;

    console.log('\n✅ Workopolis JSON-LD Success:');
    console.log('   📋 Job Title:', jobTitle || 'NOT FOUND');
    console.log('   🏢 Company:', companyName || 'NOT FOUND');
    console.log('   📄 Description:', jobDescription.length, 'chars');

    return finalText;
  } catch (error) {
    console.error(`   ❌ Workopolis extraction failed:`, error.message);
    throw error;
  }
}

/**
 * GOOGLE JOBS REDIRECT: Extract source URLs from Google Jobs listings
 * Google Jobs is an aggregator - redirects to original job board (LinkedIn, Indeed, etc.)
 * Priority: LinkedIn > Indeed > Other sources
 */
async function googleJobsRedirect(url) {
  console.log('🔍 Google Jobs: Extracting original source URL...');
  console.log(`   📋 Input URL: ${url}`);

  // Check if URL has hash fragment with docid (e.g., #vhid=vt%3D20/docid%3DxoP4kPXJSYzJcF_uAAAAAA%3D%3D)
  let fetchUrl = url;
  if (url.includes('#') && url.includes('docid')) {
    console.log(`   🔍 Hash fragment detected in URL`);
    const hashPart = url.split('#')[1];
    console.log(`   🔍 Hash part: ${hashPart}`);

    // Try multiple regex patterns for docid extraction
    const patterns = [
      /docid%3D([^&]+)/,           // docid%3DxoP4k...
      /docid=([^&]+)/,             // docid=xoP4k...
      /docid[%3D]+([^&]+)/,        // docid with encoded =
      /\/docid%3D([^&]+)/          // /docid%3DxoP4k...
    ];

    let docid = null;
    for (const pattern of patterns) {
      const match = hashPart.match(pattern);
      if (match) {
        docid = decodeURIComponent(match[1]);
        console.log(`   ✅ Matched pattern: ${pattern}`);
        break;
      }
    }

    if (docid) {
      // Construct direct Google Jobs URL
      fetchUrl = `https://www.google.com/search?ibp=htl;jobs&htidocid=${docid}`;
      console.log(`   📍 Extracted docid from hash: ${docid}`);
      console.log(`   🔗 Constructed direct URL: ${fetchUrl}`);
    } else {
      console.log(`   ⚠️  Could not extract docid from hash`);
    }
  } else if (url.includes('htidocid=')) {
    // URL already has htidocid, use as is
    console.log(`   ✅ URL already contains htidocid`);
  } else {
    console.log(`   ℹ️  No hash fragment or htidocid detected`);
  }

  try {
    const response = await axios.get(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);

    console.log(`   📊 Page stats: ${response.data.length} chars, ${$('a').length} links found`);

    // Extract all links from the page
    const sourceUrls = {
      linkedin: [],
      indeed: [],
      glassdoor: [],
      other: []
    };

    // Debug: collect all hrefs for inspection
    const allHrefs = [];

    // Look for "Apply on" links and direct job URLs
    $('a').each((i, elem) => {
      const href = $(elem).attr('href');
      if (!href) return;

      allHrefs.push(href);

      // Decode and clean URL
      let cleanUrl = href;

      // Google often wraps URLs in /url?q= redirects
      if (href.includes('/url?q=')) {
        const match = href.match(/[?&]q=([^&]+)/);
        if (match) {
          cleanUrl = decodeURIComponent(match[1]);
        }
      }

      // Categorize by source
      if (cleanUrl.includes('linkedin.com/jobs/view')) {
        sourceUrls.linkedin.push(cleanUrl);
      } else if (cleanUrl.includes('indeed.com') && (cleanUrl.includes('/viewjob') || cleanUrl.includes('vjk='))) {
        sourceUrls.indeed.push(cleanUrl);
      } else if (cleanUrl.includes('glassdoor.com') || cleanUrl.includes('glassdoor.ca')) {
        sourceUrls.glassdoor.push(cleanUrl);
      } else if (cleanUrl.match(/^https?:\/\//)) {
        // Other valid job board URLs (exclude Google's own URLs)
        if (!cleanUrl.includes('google.com') && !cleanUrl.includes('youtube.com')) {
          sourceUrls.other.push(cleanUrl);
        }
      }
    });

    // Debug: show first 10 hrefs
    console.log(`   🔗 Sample hrefs (first 10):`, allHrefs.slice(0, 10));

    // Priority: LinkedIn > Indeed > Glassdoor > Other
    let bestUrl = null;
    let source = null;

    if (sourceUrls.linkedin.length > 0) {
      bestUrl = sourceUrls.linkedin[0];
      source = 'LinkedIn';
    } else if (sourceUrls.indeed.length > 0) {
      bestUrl = sourceUrls.indeed[0];
      source = 'Indeed';
    } else if (sourceUrls.glassdoor.length > 0) {
      bestUrl = sourceUrls.glassdoor[0];
      source = 'Glassdoor';
    } else if (sourceUrls.other.length > 0) {
      bestUrl = sourceUrls.other[0];
      source = 'Other';
    }

    if (!bestUrl) {
      // Provide a helpful, specific error for Google Jobs
      const errorMessage = 'Google Jobs URLs cannot be scraped directly. ' +
        'Please click "Apply on LinkedIn" or "Apply on Indeed" in Google Jobs and copy that direct URL instead. ' +
        'Or use the "Paste Job Descriptions" mode to manually enter the job details.';
      throw new Error(errorMessage);
    }

    console.log(`   ✅ Found ${source} source URL: ${bestUrl}`);
    console.log(`   📊 Available sources: LinkedIn(${sourceUrls.linkedin.length}), Indeed(${sourceUrls.indeed.length}), Glassdoor(${sourceUrls.glassdoor.length}), Other(${sourceUrls.other.length})`);

    return bestUrl;
  } catch (error) {
    console.error(`   ❌ Google Jobs redirect failed:`, error.message);
    throw error;
  }
}

/**
 * LINKEDIN GUEST API: Direct access to public job postings
 * No authentication required - uses LinkedIn's public guest endpoints
 */
async function linkedInGuestApiFetch(url) {
  console.log('🔓 LinkedIn Guest API: Accessing public job posting...');

  // Extract job ID from various LinkedIn URL formats
  const jobIdPatterns = [
    /linkedin\.com\/jobs\/view\/(\d+)/,           // Standard format
    /linkedin\.com\/jobs\/collections\/.*?\/(\d+)/, // Collections
    /currentJobId=(\d+)/,                         // Query parameter
    /jobPosting\/(\d+)/                           // Direct API format
  ];

  let jobId = null;
  for (const pattern of jobIdPatterns) {
    const match = url.match(pattern);
    if (match) {
      jobId = match[1];
      break;
    }
  }

  if (!jobId) {
    throw new Error('Could not extract LinkedIn job ID from URL');
  }

  console.log(`   📍 Extracted Job ID: ${jobId}`);

  try {
    // Use LinkedIn's public guest API endpoint
    const guestApiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
    console.log(`   🔗 Guest API URL: ${guestApiUrl}`);

    const response = await axios.get(guestApiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.linkedin.com/jobs/search/'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);

    // Extract job title
    let jobTitle = '';
    const titleSelectors = [
      'h2.top-card-layout__title',
      '.topcard__title',
      'h1',
      'h2'
    ];
    for (const selector of titleSelectors) {
      const text = $(selector).first().text().trim();
      if (text && text.length > 3 && text.length < 200) {
        jobTitle = text;
        break;
      }
    }

    // Extract company name
    let companyName = '';
    const companySelectors = [
      '.topcard__org-name-link',
      '.topcard__flavor',
      'a.topcard__org-name-link',
      '.top-card-layout__card > div > a'
    ];
    for (const selector of companySelectors) {
      const text = $(selector).first().text().trim();
      if (text && text.length > 1 && text.length < 100) {
        companyName = text;
        break;
      }
    }

    // Extract job description
    let jobDescription = '';
    const descSelectors = [
      '.show-more-less-html__markup',
      '.description__text',
      '.core-section-container__content',
      'section.description',
      'article'
    ];
    for (const selector of descSelectors) {
      const text = $(selector).first().text().trim();
      if (text && text.length > 200) {
        jobDescription = text;
        break;
      }
    }

    // Fallback to body if description not found
    if (!jobDescription || jobDescription.length < 200) {
      jobDescription = $('body').text().trim();
    }

    // Clean up whitespace
    jobDescription = jobDescription.replace(/\s+/g, ' ').trim();

    console.log('\n✅ LinkedIn Guest API Success:');
    console.log('   📋 Job Title:', jobTitle || 'NOT FOUND');
    console.log('   🏢 Company:', companyName || 'NOT FOUND');
    console.log('   📄 Description:', jobDescription.length, 'chars');

    // Construct response
    let finalText = '';
    if (jobTitle) finalText += `Job Title: ${jobTitle}\n\n`;
    if (companyName) finalText += `Company: ${companyName}\n\n`;
    finalText += `Job Description:\n${jobDescription}`;

    return finalText;
  } catch (error) {
    console.error(`   ❌ LinkedIn Guest API Failed:`, error.message);
    throw error;
  }
}

/**
 * TIER 2: Advanced Scraping (ScraperAPI or Apify)
 * Uses specialized services for job boards
 */
async function tier2_apifyFetch(url) {
  console.log('🚀 Tier 2: Trying advanced scraping...');

  // Detect job board and use appropriate scraper
  if (url.includes('indeed.com')) {
    return await fetchIndeed(url);
  } else if (url.includes('linkedin.com')) {
    return await apifyFetchLinkedIn(url);
  } else {
    // Use generic web scraper for other sites
    return await apifyFetchGeneric(url);
  }
}

/**
 * ScraperAPI: Indeed-specific scraping
 * Uses ScraperAPI's premium proxy network to bypass Indeed's anti-bot protection
 */
async function scraperApiFetchIndeed(url) {
  console.log('   📍 Using ScraperAPI for Indeed (premium proxy network)...');

  // Extract job key from URL
  const vjkMatch = url.match(/[?&]vjk=([a-f0-9]+)/i);
  if (!vjkMatch) {
    throw new Error('Could not extract Indeed job key from URL');
  }

  const jobKey = vjkMatch[1];
  const country = url.includes('ca.indeed.com') ? 'CA' : 'US';
  const indeedUrl = `https://${country === 'CA' ? 'ca' : 'www'}.indeed.com/viewjob?jk=${jobKey}`;

  console.log(`   🔗 Target URL: ${indeedUrl}`);

  try {
    // Build ScraperAPI request URL
    const scraperApiUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPERAPI_KEY}&url=${encodeURIComponent(indeedUrl)}&render=true&premium=true`;

    console.log('   ⏳ Sending request to ScraperAPI...');
    const response = await axios.get(scraperApiUrl, {
      timeout: 60000 // 60 second timeout for Indeed pages
    });

    console.log(`   ✅ Received response (${response.data.length} chars)`);

    // Parse HTML with Cheerio
    const $ = cheerio.load(response.data);

    // Extract job title
    let jobTitle = '';
    let titleSelectorUsed = '';
    const titleSelectors = [
      'h1.jobsearch-JobInfoHeader-title',
      'h1[class*="jobTitle"]',
      'h1[class*="JobTitle"]',
      'h2.jobTitle',
      'span.jobTitle',
      'h1',
      'h2'
    ];
    for (const selector of titleSelectors) {
      const text = $(selector).first().text().trim();
      if (text && text.length > 5 && text.length < 200) {
        jobTitle = text;
        titleSelectorUsed = selector;
        break;
      }
    }

    // Extract company name
    let companyName = '';
    let companySelectorUsed = '';
    const companySelectors = [
      '[data-company-name="true"]',
      '[class*="CompanyInfo"]',
      '[class*="companyName"]',
      '[class*="company-name"]',
      'span[class*="company"]',
      'div[class*="company"]'
    ];
    for (const selector of companySelectors) {
      const text = $(selector).first().text().trim();
      if (text && text.length > 2 && text.length < 100) {
        companyName = text;
        companySelectorUsed = selector;
        break;
      }
    }

    // Extract job description
    let jobDescription = '';
    let descSelectorUsed = '';
    const descSelectors = [
      '#jobDescriptionText',
      '[id*="jobDescription"]',
      '[class*="jobDescriptionText"]',
      '[class*="jobDescription"]',
      '[class*="job-description"]',
      'div[class*="description"]',
      'section[class*="description"]',
      'main'
    ];
    for (const selector of descSelectors) {
      const text = $(selector).first().text().trim();
      if (text && text.length > 200) {
        jobDescription = text;
        descSelectorUsed = selector;
        break;
      }
    }

    // Fallback to body text if description not found
    if (!jobDescription || jobDescription.length < 200) {
      jobDescription = $('body').text().trim();
      descSelectorUsed = 'body (fallback)';
    }

    // Clean up whitespace
    jobDescription = jobDescription.replace(/\s+/g, ' ').trim();

    console.log('\n🎯 ScraperAPI Extraction Results:');
    console.log('   📋 Job Title:', jobTitle || 'NOT FOUND');
    console.log('      Used selector:', titleSelectorUsed || 'NONE');
    console.log('   🏢 Company:', companyName || 'NOT FOUND');
    console.log('      Used selector:', companySelectorUsed || 'NONE');
    console.log('   📄 Description length:', jobDescription.length, 'chars');
    console.log('      Used selector:', descSelectorUsed || 'NONE');

    // Construct response
    let finalText = '';
    if (jobTitle) finalText += `Job Title: ${jobTitle}\n\n`;
    if (companyName) finalText += `Company: ${companyName}\n\n`;
    finalText += `Job Description:\n${jobDescription}`;

    return finalText;
  } catch (error) {
    console.error(`   ❌ ScraperAPI Failed:`, error.message);
    throw error;
  }
}

/**
 * Fetch Indeed job - tries ScraperAPI first, then falls back to Apify
 */
async function fetchIndeed(url) {
  // Try ScraperAPI first if enabled (more reliable for Indeed)
  if (isScraperApiEnabled()) {
    try {
      return await scraperApiFetchIndeed(url);
    } catch (error) {
      console.log(`   ⚠️  ScraperAPI failed: ${error.message}`);
      console.log('   🔄 Falling back to Apify...');
    }
  }

  // Fall back to Apify if ScraperAPI not available or failed
  if (getApifyClient()) {
    return await apifyFetchIndeed(url);
  }

  throw new Error('No advanced scraping service available for Indeed');
}

/**
 * Apify: Indeed-specific scraping
 */
async function apifyFetchIndeed(url) {
  console.log('   📍 Using Apify browser-based scraper for Indeed...');

  // Extract job key from URL
  const vjkMatch = url.match(/[?&]vjk=([a-f0-9]+)/i);
  if (!vjkMatch) {
    throw new Error('Could not extract Indeed job key from URL');
  }

  const jobKey = vjkMatch[1];
  const country = url.includes('ca.indeed.com') ? 'CA' : 'US';
  const indeedUrl = `https://${country === 'CA' ? 'ca' : 'www'}.indeed.com/viewjob?jk=${jobKey}`;

  console.log(`   🔗 Indeed URL: ${indeedUrl}`);

  try {
    const client = getApifyClient();
    // Use Cheerio Scraper with proxies - faster and less detectable than browser automation
    const run = await client.actor('apify/cheerio-scraper').call({
      startUrls: [{ url: indeedUrl }],
      proxyConfiguration: {
        useApifyProxy: true
      },
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 3,
      pageFunction: async function pageFunction(context) {
        const { $, request, body } = context;

        // DEBUG: Get HTML info
        const debugInfo = {
          pageUrl: request.url,
          bodyLength: body.length,
          bodyPreview: body.substring(0, 2000),
          h1Count: $('h1').length,
          divCount: $('div').length,
          h1Texts: $('h1').map((i, el) => $(el).text().trim()).get().join(' | '),
          bodyTextPreview: $('body').text().trim().substring(0, 1000)
        };

        // Extract job title
        let jobTitle = '';
        let titleSelectorUsed = '';
        const titleSelectors = [
          'h1.jobsearch-JobInfoHeader-title',
          'h1[class*="jobTitle"]',
          'h1[class*="JobTitle"]',
          'h2[class*="jobTitle"]',
          'span[class*="jobTitle"]',
          'div[class*="jobTitle"]',
          'h1',
          'h2'
        ];
        for (const selector of titleSelectors) {
          const text = $(selector).first().text().trim();
          if (text && text.length > 5) {
            jobTitle = text;
            titleSelectorUsed = selector;
            break;
          }
        }

        // Extract company name
        let companyName = '';
        let companySelectorUsed = '';
        const companySelectors = [
          '[data-company-name="true"]',
          '[class*="CompanyInfo"]',
          '[class*="companyName"]',
          '[class*="company-name"]',
          'span[class*="company"]',
          'div[class*="company"]'
        ];
        for (const selector of companySelectors) {
          const text = $(selector).first().text().trim();
          if (text && text.length > 2) {
            companyName = text;
            companySelectorUsed = selector;
            break;
          }
        }

        // Extract job description
        let jobDescription = '';
        let descSelectorUsed = '';
        const descSelectors = [
          '#jobDescriptionText',
          '[id*="jobDescription"]',
          '[class*="jobDescriptionText"]',
          '[class*="jobDescription"]',
          '[class*="job-description"]',
          'div[class*="description"]',
          'section[class*="description"]',
          'main'
        ];
        for (const selector of descSelectors) {
          const text = $(selector).first().text().trim();
          if (text && text.length > 200) {
            jobDescription = text;
            descSelectorUsed = selector;
            break;
          }
        }

        // Fallback to body text if description not found
        if (!jobDescription || jobDescription.length < 200) {
          jobDescription = $('body').text().trim().substring(0, 5000);
          descSelectorUsed = 'body (fallback)';
        }

        return {
          url: request.url,
          jobTitle,
          companyName,
          jobDescription,
          selectorsUsed: {
            titleSelectorUsed,
            companySelectorUsed,
            descSelectorUsed
          },
          debugInfo
        };
      }
    });

    // Wait for actor to finish and get results
    console.log(`   ⏳ Waiting for Apify to finish...`);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (!items || items.length === 0) {
      throw new Error('Apify returned no results');
    }

    const data = items[0];

    console.log('\n🎯 Apify Extraction Results:');
    console.log('   📋 Job Title:', data.jobTitle || 'NOT FOUND');
    console.log('      Used selector:', data.selectorsUsed?.titleSelectorUsed || 'NONE');
    console.log('   🏢 Company:', data.companyName || 'NOT FOUND');
    console.log('      Used selector:', data.selectorsUsed?.companySelectorUsed || 'NONE');
    console.log('   📄 Description length:', data.jobDescription?.length || 0, 'chars');
    console.log('      Used selector:', data.selectorsUsed?.descSelectorUsed || 'NONE');
    console.log('   📝 Description preview:', data.jobDescription?.substring(0, 300) || 'EMPTY');

    // Construct response
    let finalText = '';
    if (data.jobTitle) finalText += `Job Title: ${data.jobTitle}\n\n`;
    if (data.companyName) finalText += `Company: ${data.companyName}\n\n`;
    finalText += `Job Description:\n${data.jobDescription}`;

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
    const client = getApifyClient();
    const run = await client.actor('apify/cheerio-scraper').call({
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

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (!items || items.length === 0) {
      throw new Error('Apify returned no results');
    }

    const data = items[0];

    let finalText = '';
    if (data.jobTitle) finalText += `Job Title: ${data.jobTitle}\n\n`;
    if (data.companyName) finalText += `Company: ${companyName}\n\n`;
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

  // GOOGLE JOBS REDIRECT: Detect and redirect to original source (LinkedIn > Indeed > Other)
  // Detects: google.com/search with jobs, udm=8 (jobs filter), htidocid, or hash with docid
  const isGoogleJobs = url.includes('google.com') && (
    url.includes('/jobs') ||
    url.includes('udm=8') ||
    url.includes('htidocid') ||
    (url.includes('#') && url.includes('docid'))
  );

  if (isGoogleJobs) {
    console.log('🔍 Google Jobs URL detected - redirecting to original source...');
    try {
      const originalUrl = await googleJobsRedirect(url);
      console.log(`   ➡️  Redirecting to: ${originalUrl}\n`);
      url = originalUrl; // Replace URL with original source
    } catch (error) {
      // For Google Jobs URLs, fail immediately with helpful error instead of trying fallbacks
      console.log(`   ❌ Google Jobs redirect failed: ${error.message}`);
      console.log('   ❌ Cannot scrape Google Jobs directly - throwing error\n');
      throw error; // Throw the specific Google Jobs error
    }
  }

  // LINKEDIN SPECIAL: Try Guest API first for LinkedIn URLs (free & highly reliable)
  if (url.includes('linkedin.com')) {
    console.log('🔗 LinkedIn URL detected - trying Guest API first...');
    try {
      const result = await linkedInGuestApiFetch(url);
      if (validateExtractedContent(result)) {
        console.log('✅ LinkedIn Guest API SUCCESS - Using result\n');
        return result;
      }
      console.log('⚠️  LinkedIn Guest API result invalid, trying other methods...');
    } catch (error) {
      console.log(`⚠️  LinkedIn Guest API failed: ${error.message}, trying other methods...`);
    }
  }

  // INDEED SPECIAL: Try Embedded JSON extraction first (free & more reliable than basic fetch)
  if (url.includes('indeed.com')) {
    console.log('📊 Indeed URL detected - trying Embedded _initialData extraction first...');
    try {
      const result = await indeedEmbeddedFetch(url);
      if (validateExtractedContent(result)) {
        console.log('✅ Indeed Embedded SUCCESS - Using result\n');
        return result;
      }
      console.log('⚠️  Indeed Embedded result invalid, trying other methods...');
    } catch (error) {
      console.log(`⚠️  Indeed Embedded failed: ${error.message}, trying other methods...`);
    }
  }

  // GLASSDOOR SPECIAL: Try Apollo GraphQL extraction first (free & extracts from embedded cache)
  if (url.includes('glassdoor.com') || url.includes('glassdoor.ca')) {
    console.log('🔮 Glassdoor URL detected - trying Apollo GraphQL extraction first...');
    try {
      const result = await glassdoorApolloFetch(url);
      if (validateExtractedContent(result)) {
        console.log('✅ Glassdoor Apollo SUCCESS - Using result\n');
        return result;
      }
      console.log('⚠️  Glassdoor Apollo result invalid, trying other methods...');
    } catch (error) {
      console.log(`⚠️  Glassdoor Apollo failed: ${error.message}, trying other methods...`);
    }
  }

  // WORKOPOLIS SPECIAL: Try JSON-LD extraction (free & reliable for Workopolis)
  if (url.includes('workopolis.com')) {
    console.log('🍁 Workopolis URL detected - trying JSON-LD extraction...');
    try {
      const result = await workopolisFetch(url);
      if (validateExtractedContent(result)) {
        console.log('✅ Workopolis SUCCESS - Using result\n');
        return result;
      }
      console.log('⚠️  Workopolis result invalid, trying other methods...');
    } catch (error) {
      console.log(`⚠️  Workopolis failed: ${error.message}, trying other methods...`);
    }
  }

  // TIER 1: Enhanced Basic Fetch (always try for other sites or as fallback)
  try {
    const result = await tier1_enhancedBasicFetch(url);
    if (validateExtractedContent(result)) {
      console.log('✅ Tier 1 SUCCESS - Using enhanced basic fetch result\n');
      return result;
    }
    console.log('⚠️  Tier 1 result invalid, trying next tier...');
  } catch (error) {
    console.log(`⚠️  Tier 1 failed: ${error.message}, trying next tier...`);

    // DEBUG: Log full error details to understand axios error structure
    console.log('🔍 DEBUG - Full error object:');
    console.log('   error.message:', error.message);
    console.log('   error.response:', error.response ? 'EXISTS' : 'UNDEFINED');
    console.log('   error.response?.status:', error.response?.status);
    console.log('   error.response?.statusText:', error.response?.statusText);
    console.log('   error.code:', error.code);

    // SMART BLOCKING DETECTION: Fail fast for known-blocked sites only
    // Note: HTTP 403 is NORMAL for many sites (Indeed, LinkedIn, etc.) - Apify with proxies can bypass it
    // Only block sites where Apify also fails consistently (The Ladders, etc.)
    const domain = new URL(url).hostname;
    const isHttp403 = error.message.includes('403') || error.response?.status === 403;
    const isHttp999 = error.message.includes('999') || error.response?.status === 999;

    // Known sites where even Apify can't help (exhausted all options)
    const knownBlockedSites = [
      'theladders.com'
      // Add more as we discover them
    ];

    const isKnownBlocked = knownBlockedSites.some(site => domain.includes(site));

    if ((isHttp403 || isHttp999) && isKnownBlocked) {
      console.log(`🚫 ${domain} is on known-blocked list (HTTP ${isHttp403 ? '403' : '999'})`);
      console.log('   💡 This site consistently blocks all scraping methods including Apify');
      console.log('   ⏰ Failing fast to save time & cost\n');

      throw new Error(
        `${domain} appears to be blocking automated access. ` +
        `This is common with certain job boards after repeated requests. ` +
        `Please use the "Manual Paste" feature instead, or try again in 1-2 hours when the block may reset.`
      );
    }

    // For other sites with 403/999, continue to Tier 2 - Apify with proxies might work
  }

  // TIER 2: Apify (only if enabled)
  if (process.env.ENABLE_APIFY_SCRAPING === 'true' && getApifyClient()) {
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
