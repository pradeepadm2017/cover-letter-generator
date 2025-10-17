# Complete Parallel Processing Implementation

## Critical Fixes Needed

### 1. URL Extraction Bug (Line 606)
**Current:**
```javascript
const jobUrl = isManualJob ? `manual-${i}` : jobItem;
```

**Fixed:**
```javascript
const jobUrl = isManualJob ? `manual-${i}` : (jobItem.url || jobItem);
```

### 2. Hybrid Scraper Return Format Bug (Line 658)
**Current:**
```javascript
jobDescription = await scrapingService.fetchJobDescriptionHybrid(jobUrl);
```

**Issue:** Returns `{ content: "...", method: "..." }` but code expects string.

**Fixed:**
```javascript
const hybridResult = await scrapingService.fetchJobDescriptionHybrid(jobUrl);
if (typeof hybridResult === 'object' && hybridResult.content) {
  jobDescription = hybridResult.content;
} else {
  jobDescription = hybridResult;
}
```

### 3. Parallel Processing Implementation

**Replace lines 601-486** (the entire for-loop) with:

```javascript
console.log(`📊 Processing ${jobUrls.length} jobs with parallel processing (batch size: 5)`);
const startTime = Date.now();

const results = [];
const BATCH_SIZE = 5;

// Helper function to process a single job
const processJob = async (jobItem, index) => {
  const isManualJob = typeof jobItem === 'object' && jobItem.isManual;
  const jobUrl = isManualJob ? `manual-${index}` : (jobItem.url || jobItem);  // ← FIX #1

  const jobStartTime = Date.now();
  console.log(`🚀 [Job ${index + 1}/${jobUrls.length}] Starting: ${isManualJob ? 'MANUAL' : jobUrl}`);

  // Check usage limits
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
    let jobDescription;

    if (isManualJob) {
      console.log(`📝 [Job ${index + 1}] Using manual paste data`);

      if (jobItem.description.length < 100) {
        return {
          jobUrl: jobUrl,
          success: false,
          error: 'Job description is too short. Please provide at least 100 characters.'
        };
      }

      if (jobItem.description.length > 10000) {
        return {
          jobUrl: jobUrl,
          success: false,
          error: 'Job description is too long. Please keep it under 10,000 characters.'
        };
      }

      jobDescription = `Job Title: ${jobItem.title}\n\nCompany: ${jobItem.company}\n\nJob Description:\n${jobItem.description}`;
    } else {
      try {
        if (process.env.ENABLE_APIFY_SCRAPING === 'true' || process.env.ENABLE_PUPPETEER_FALLBACK === 'true') {
          console.log(`🚀 [Job ${index + 1}] Using HYBRID scraping`);
          const hybridResult = await scrapingService.fetchJobDescriptionHybrid(jobUrl);  // ← FIX #2 START

          if (typeof hybridResult === 'object' && hybridResult.content) {
            jobDescription = hybridResult.content;
            console.log(`✅ [Job ${index + 1}] Hybrid scraper successful, method: ${hybridResult.method}`);
          } else {
            jobDescription = hybridResult;
          }  // ← FIX #2 END
        } else {
          console.log(`📡 [Job ${index + 1}] Using BASIC scraping`);
          jobDescription = await fetchJobDescription(jobUrl);
        }

        const descriptionOnly = jobDescription.split('Job Description:')[1] || jobDescription;
        if (descriptionOnly.length < 500 ||
            descriptionOnly.toLowerCase().includes('sign in') && descriptionOnly.length < 1000 ||
            descriptionOnly.toLowerCase().includes('keep me logged in')) {
          console.log(`⚠️ [Job ${index + 1}] Invalid content (too short or login page)`);
          return {
            jobUrl: jobUrl,
            success: false,
            error: 'Could not extract meaningful job description from URL'
          };
        }
      } catch (fetchError) {
        console.log(`⚠️ [Job ${index + 1}] Scraping failed: ${fetchError.message}`);
        return {
          jobUrl: jobUrl,
          success: false,
          error: fetchError.message
        };
      }
    }

    // [REST OF THE EXISTING CODE FOR COVER LETTER GENERATION GOES HERE]
    // Including: extractCandidateName, OpenAI call, Word doc generation, etc.
    // This is the same code that was in the try block of the original for-loop

    const candidateName = extractCandidateName(resume);
    // ... (all the existing cover letter generation code)

    const jobDuration = ((Date.now() - jobStartTime) / 1000).toFixed(2);
    console.log(`✅ [Job ${index + 1}] Completed in ${jobDuration}s`);

    await usageOps.incrementUsage(req.user.id);

    return {
      jobUrl: jobUrl,
      coverLetter: coverLetter,
      fileData: fileData,
      fileName: fileName,
      success: true
    };

  } catch (error) {
    const jobDuration = ((Date.now() - jobStartTime) / 1000).toFixed(2);
    console.error(`❌ [Job ${index + 1}] Failed after ${jobDuration}s:`, error.message);
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
```

## Expected Performance Improvement

**Before (Sequential):**
- 8 jobs: ~199 seconds (3 min 19 sec)

**After (Parallel - Batch of 5):**
- 8 jobs: ~60-80 seconds (~1 min)
- **3x faster** processing time

## Testing

Test with the same 8 URLs that previously took 2.5 minutes:
1. LinkedIn, Workopolis, Aplin, Summit Search, Indeed, WRHA, The Ladders, Eluta
2. Expected completion: Under 1 minute
3. All 8 cover letters should generate successfully

## Implementation Status

- ✅ Apify concurrency limits analyzed (SAFE for 5 concurrent)
- ✅ Design completed
- ⏳ **READY TO IMPLEMENT** - Replace for-loop in server.js lines 601-486
