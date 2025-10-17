// Initialize Supabase
const SUPABASE_URL = 'https://igliqzsokxeknkiozkrj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbGlxenNva3hla25raW96a3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MjYzNjcsImV4cCI6MjA3NTQwMjM2N30.NasThZulDuYEbRZiVsIXTMt2dLWRwtveY6_GPVULv98';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global variables
let savedResume = '';
let currentSession = null;
let currentUser = null;
let isLoggingOut = false;

// Helper function to get auth headers
async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '/';
        throw new Error('Not authenticated');
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
    };
}

// Initialize auth on page load
async function initAuth() {
    if (isLoggingOut) {
        console.log('Logout in progress, skipping auth check');
        return false;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        console.log('No session found, redirecting to home');
        window.location.href = '/';
        return false;
    }

    currentSession = session;
    currentUser = session.user;

    console.log('Session found for user:', currentUser.email);

    // Update UI with user info
    await loadUserInfo();
    return true;
}

// Load user information
async function loadUserInfo() {
    try {
        if (!currentSession) {
            console.error('No current session available');
            return;
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.access_token}`
        };

        const response = await fetch('/api/auth/status', {
            headers
        });

        const data = await response.json();

        if (data.authenticated) {
            document.getElementById('user-email').textContent = data.user.email;
            document.getElementById('user-tier').textContent = data.user.tier.charAt(0).toUpperCase() + data.user.tier.slice(1);

            const tierBadge = document.getElementById('user-tier');
            tierBadge.className = 'tier-badge';
            if (data.user.tier !== 'free') {
                tierBadge.classList.add('tier-paid');
            }
        }
    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

// Logout function
async function logout() {
    try {
        console.log('=== LOGOUT CLICKED ===');
        isLoggingOut = true;

        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) {
            console.error('Logout error:', error);
        }

        // Clear storage
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('sb-')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        localStorage.clear();
        sessionStorage.clear();

        await new Promise(resolve => setTimeout(resolve, 300));
        window.location.replace('/?logout=true');
    } catch (error) {
        console.error('Logout failed:', error);
        window.location.replace('/?logout=true');
    }
}

// Load saved resume
function loadSavedResume() {
    savedResume = sessionStorage.getItem('savedResume');

    const preview = document.getElementById('resume-preview');

    if (!savedResume || savedResume.trim().length === 0) {
        preview.innerHTML = `
            <p style="color: #dc2626; font-size: 13px;">
                ⚠️ No resume found. Please <a href="/app" style="color: #2563eb; text-decoration: underline;">go back to the main page</a> and enter your resume first.
            </p>
        `;
        return false;
    }

    // Show first 500 characters of resume
    const previewText = savedResume.length > 500
        ? savedResume.substring(0, 500) + '...'
        : savedResume;

    preview.innerHTML = `
        <p style="color: #059669; font-size: 12px; font-weight: 600; margin-bottom: 8px;">
            ✓ Resume loaded (${savedResume.length} characters)
        </p>
        <pre style="white-space: pre-wrap; font-size: 11px; color: #374151; font-family: inherit; margin: 0;">${previewText}</pre>
    `;

    return true;
}

// Add a manual job input
function addManualJob() {
    const container = document.getElementById('manual-jobs-container');
    const currentCount = container.querySelectorAll('.manual-job-card').length;

    const jobCard = document.createElement('div');
    jobCard.className = 'manual-job-card';
    jobCard.setAttribute('data-index', currentCount);
    jobCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0; font-size: 16px; color: #111827;">Job #${currentCount + 1}</h3>
            ${currentCount > 0 ? `
                <button
                    type="button"
                    class="remove-btn"
                    onclick="removeManualJob(this)"
                    style="background: #dc2626; color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                    Remove
                </button>
            ` : ''}
        </div>
        <input
            type="text"
            placeholder="Job Title (e.g., Senior Software Engineer)"
            class="manual-job-title"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 10px; font-size: 14px;"
        >
        <input
            type="text"
            placeholder="Company Name (e.g., Microsoft)"
            class="manual-job-company"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 10px; font-size: 14px;"
        >
        <textarea
            placeholder="Paste the full job description here...

Example:
We are seeking an experienced Senior Software Engineer...

Responsibilities:
- Design and develop scalable applications
- Lead technical discussions...

Requirements:
- 5+ years of experience...
- Strong knowledge of..."
            class="manual-job-description"
            rows="12"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical;"
        ></textarea>
    `;

    container.appendChild(jobCard);

    // Add event listeners
    const inputs = jobCard.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', validateForm);
    });

    validateForm();
}

// Remove a manual job input
function removeManualJob(button) {
    const jobCard = button.closest('.manual-job-card');
    const container = document.getElementById('manual-jobs-container');

    if (container.querySelectorAll('.manual-job-card').length > 1) {
        jobCard.remove();

        // Renumber remaining jobs
        container.querySelectorAll('.manual-job-card').forEach((card, index) => {
            card.setAttribute('data-index', index);
            card.querySelector('h3').textContent = `Job #${index + 1}`;
        });

        validateForm();
    }
}

// Validate form and enable/disable generate button
function validateForm() {
    const generateBtn = document.getElementById('generate-btn');
    const jobCards = document.querySelectorAll('.manual-job-card');

    let hasValidJob = false;

    jobCards.forEach(card => {
        const title = card.querySelector('.manual-job-title').value.trim();
        const company = card.querySelector('.manual-job-company').value.trim();
        const description = card.querySelector('.manual-job-description').value.trim();

        if (title && company && description && description.length >= 50) {
            hasValidJob = true;
        }
    });

    generateBtn.disabled = !(savedResume && hasValidJob);
}

// Get manual jobs from form
function getManualJobs() {
    const jobCards = document.querySelectorAll('.manual-job-card');
    const jobs = [];

    jobCards.forEach((card, index) => {
        const title = card.querySelector('.manual-job-title').value.trim();
        const company = card.querySelector('.manual-job-company').value.trim();
        const description = card.querySelector('.manual-job-description').value.trim();

        console.log(`Job #${index + 1} validation:`, {
            title: title ? `"${title}"` : 'EMPTY',
            company: company ? `"${company}"` : 'EMPTY',
            description: description ? `${description.length} chars` : 'EMPTY'
        });

        if (title && company && description) {
            jobs.push({
                isManual: true,
                title,
                company,
                description
            });
            console.log(`✓ Job #${index + 1} included`);
        } else {
            console.warn(`✗ Job #${index + 1} SKIPPED - missing fields:`,
                !title ? 'title' : '',
                !company ? 'company' : '',
                !description ? 'description' : ''
            );
        }
    });

    console.log(`📋 Total jobs to submit: ${jobs.length} of ${jobCards.length}`);
    return jobs;
}

// Show/hide loading
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => {
        errorDiv.classList.add('hidden');
    }, 5000);
}

// Show success message
function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    document.querySelector('.container').appendChild(successDiv);
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

// Download file from base64
function downloadFile(fileName, base64Data) {
    try {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        console.log(`✅ Downloaded: ${fileName}`);
    } catch (error) {
        console.error('Error downloading file:', error);
        showError('Failed to download file: ' + fileName);
    }
}

// Generate cover letters
async function generateManualCoverLetters() {
    console.log('🎯 Generating cover letters from manual paste');

    if (!savedResume) {
        showError('No resume found. Please go back to the main page.');
        return;
    }

    const manualJobs = getManualJobs();
    const totalJobCards = document.querySelectorAll('.manual-job-card').length;

    if (manualJobs.length === 0) {
        showError('Please fill in at least one job (title, company, and description)');
        return;
    }

    // Warn if some jobs were skipped
    if (manualJobs.length < totalJobCards) {
        const skippedCount = totalJobCards - manualJobs.length;
        const confirmMsg = `⚠️ Warning: ${skippedCount} job${skippedCount > 1 ? 's' : ''} ${skippedCount > 1 ? 'were' : 'was'} skipped because ${skippedCount > 1 ? 'they are' : 'it is'} incomplete.\n\nAll fields (Title, Company, Description) must be filled.\n\nDo you want to continue with ${manualJobs.length} job${manualJobs.length > 1 ? 's' : ''}?`;

        if (!confirm(confirmMsg)) {
            return;
        }
    }

    console.log('📝 Resume length:', savedResume.length);
    console.log('📋 Manual jobs:', manualJobs.length, 'of', totalJobCards);

    showLoading();

    const coverLettersContainer = document.getElementById('cover-letters-container');
    coverLettersContainer.innerHTML = '';

    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/generate-cover-letters', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                resume: savedResume,
                jobUrls: manualJobs  // Backend will detect isManual flag
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 403 && data.error === 'Usage limit reached') {
                hideLoading();
                alert('You have reached your monthly limit. Please upgrade your plan or use a promo code.');
                return;
            }
            throw new Error(data.error || 'Failed to generate cover letters');
        }

        // Display results
        data.results.forEach((result, index) => {
            const resultDiv = document.createElement('div');
            resultDiv.className = 'cover-letter';

            if (result.success) {
                resultDiv.innerHTML = `
                    <h3 style="color: #059669;">✓ Job #${index + 1} - ${manualJobs[index].title}</h3>
                    <p style="color: #059669; font-size: 14px;">${manualJobs[index].company}</p>
                    <p style="font-size: 12px; color: #666; margin-top: 8px;">Cover letter generated successfully!</p>
                `;

                // Auto-download
                if (result.fileData) {
                    setTimeout(() => {
                        downloadFile(result.fileName, result.fileData);
                    }, 300 * (index + 1));
                }
            } else {
                resultDiv.innerHTML = `
                    <h3 style="color: #dc2626;">✕ Job #${index + 1} - ${manualJobs[index].title}</h3>
                    <p style="color: #dc2626; font-size: 14px;">${result.error}</p>
                `;
            }

            coverLettersContainer.appendChild(resultDiv);
        });

        const successCount = data.results.filter(r => r.success).length;
        const totalCount = data.results.length;

        // Add summary
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'generation-summary';
        summaryDiv.innerHTML = `
            <div class="summary-content">
                <h3>Generation Summary</h3>
                <div class="summary-stats">
                    <div class="stat-item success">
                        <span class="stat-icon">✓</span>
                        <span class="stat-text">${successCount} of ${totalCount} cover letters generated successfully</span>
                    </div>
                </div>
            </div>
        `;
        coverLettersContainer.appendChild(summaryDiv);

        if (successCount > 0) {
            showSuccess(`${successCount} cover letter${successCount > 1 ? 's' : ''} generated successfully!`);
        }

    } catch (error) {
        console.error('Error:', error);
        showError('Unable to generate cover letters. Please check your inputs and try again.');
    } finally {
        hideLoading();
    }
}

// Initialize page
document.addEventListener('DOMContentLoaded', async function() {
    await initAuth();

    const hasResume = loadSavedResume();

    if (hasResume) {
        // Add first manual job input
        addManualJob();
    }
});
