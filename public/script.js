// Initialize Supabase
const SUPABASE_URL = 'https://igliqzsokxeknkiozkrj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbGlxenNva3hla25raW96a3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MjYzNjcsImV4cCI6MjA3NTQwMjM2N30.NasThZulDuYEbRZiVsIXTMt2dLWRwtveY6_GPVULv98';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global variables
let resumeText = '';
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
        // Use current session instead of fetching again
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

            // Update tier badge color
            const tierBadge = document.getElementById('user-tier');
            tierBadge.className = 'tier-badge';
            if (data.user.tier !== 'free') {
                tierBadge.classList.add('tier-paid');
            }
        } else {
            console.error('User not authenticated on backend');
            // Don't redirect here - session exists on frontend
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        // Don't redirect on error
    }
}

// Logout function
async function logout() {
    try {
        console.log('=== LOGOUT CLICKED ===');
        console.log('Starting logout process...');
        isLoggingOut = true;

        // Sign out with scope: 'local' to clear all local session data
        console.log('Calling supabase.auth.signOut()...');
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) {
            console.error('Logout error:', error);
        } else {
            console.log('SignOut successful');
        }

        // Manually clear all Supabase storage keys
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('sb-')) {
                keysToRemove.push(key);
            }
        }
        console.log('Removing Supabase keys:', keysToRemove);
        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
        });

        // Clear all storage
        console.log('Clearing all storage...');
        localStorage.clear();
        sessionStorage.clear();

        // Wait to ensure signOut fully completes
        console.log('Waiting 300ms...');
        await new Promise(resolve => setTimeout(resolve, 300));

        // Force redirect with logout parameter
        console.log('Redirecting to /?logout=true');
        window.location.replace('/?logout=true');
    } catch (error) {
        console.error('Logout failed:', error);
        window.location.replace('/?logout=true');
    }
}

// Tab switching function
function switchResumeTab(tabType) {
    const textTab = document.getElementById('text-resume-tab');
    const fileTab = document.getElementById('file-resume-tab');
    const tabBtns = document.querySelectorAll('.tab-btn');

    if (tabType === 'text') {
        textTab.classList.add('active');
        textTab.classList.remove('hidden');
        fileTab.classList.remove('active');
        fileTab.classList.add('hidden');
        tabBtns[0].classList.add('active');
        tabBtns[1].classList.remove('active');
    } else {
        fileTab.classList.add('active');
        fileTab.classList.remove('hidden');
        textTab.classList.remove('active');
        textTab.classList.add('hidden');
        tabBtns[1].classList.add('active');
        tabBtns[0].classList.remove('active');
    }
    updateGenerateButtonState();
}

// Handle file upload
async function handleResumeFileUpload(input) {
    const file = input.files[0];
    const fileStatus = document.getElementById('file-status');
    const fileNameDisplay = document.getElementById('file-name');

    if (!file) {
        return;
    }

    // Check if file is PDF
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        fileStatus.classList.remove('hidden', 'success');
        fileStatus.classList.add('error');
        fileStatus.textContent = '✕ PDF files are not supported. Please upload DOC, DOCX, or TXT format.';
        fileNameDisplay.textContent = 'Click to upload or drag & drop';
        input.value = ''; // Clear the file input
        resumeText = '';
        updateGenerateButtonState();
        return;
    }

    fileNameDisplay.textContent = file.name;
    fileStatus.classList.remove('hidden', 'success', 'error');
    fileStatus.textContent = 'Processing file...';

    try {
        const formData = new FormData();
        formData.append('resume', file);

        const response = await fetch('/api/upload-resume', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to process file');
        }

        resumeText = result.text;
        fileStatus.classList.add('success');
        fileStatus.textContent = `✓ File uploaded successfully (${result.text.length} characters)`;
        updateGenerateButtonState();
    } catch (error) {
        fileStatus.classList.add('error');
        // Improve error message for common issues
        let errorMsg = error.message;
        if (errorMsg.includes('DOMMatrix') || errorMsg.includes('Failed to process file')) {
            errorMsg = 'Unable to process this file. Please use DOC, DOCX, or TXT format, or copy and paste your resume text instead.';
        }
        fileStatus.textContent = `✕ ${errorMsg}`;
        resumeText = '';
        updateGenerateButtonState();
    }
}

// Proxy utility function for web scraping
async function fetchWithProxy(url, options = {}) {
    try {
        const proxyUrl = '/api/proxy';
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                method: options.method || 'GET',
                headers: options.headers || {}
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        return {
            ok: true,
            data: result.data,
            contentType: result.contentType,
            text: () => Promise.resolve(result.data),
            json: () => Promise.resolve(typeof result.data === 'string' ? JSON.parse(result.data) : result.data)
        };
    } catch (error) {
        console.error('Proxy fetch error:', error);
        throw error;
    }
}

function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => {
        errorDiv.classList.add('hidden');
    }, 5000);
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    document.querySelector('.container').appendChild(successDiv);
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

function addJobUrl() {
    const container = document.getElementById('job-urls-container');
    const currentCount = container.querySelectorAll('.job-url-input').length;
    const newInput = document.createElement('div');
    newInput.className = 'job-url-input';
    newInput.setAttribute('data-index', currentCount);
    newInput.innerHTML = `
        <div class="url-input-wrapper">
            <input
                type="url"
                placeholder="Enter job posting URL..."
                class="job-url"
            >
            <span class="url-status"></span>
        </div>
        <button type="button" class="remove-btn" onclick="removeJobUrl(this)">
            ✕
        </button>
    `;
    container.appendChild(newInput);
    updateGenerateButtonState();
}

function removeJobUrl(button) {
    const jobUrlInput = button.closest('.job-url-input');
    jobUrlInput.remove();
    updateGenerateButtonState();
}

function getJobUrls() {
    const jobUrlInputs = document.querySelectorAll('.job-url');
    const urls = [];

    jobUrlInputs.forEach(input => {
        const url = input.value.trim();
        if (url) {
            urls.push(url);
        }
    });

    return urls;
}

function updateGenerateButtonState() {
    const generateBtn = document.getElementById('generate-all-btn');
    const textTab = document.getElementById('text-resume-tab');
    const fileTab = document.getElementById('file-resume-tab');
    const jobUrls = getJobUrls();

    let hasResume = false;
    if (textTab.classList.contains('active')) {
        hasResume = document.getElementById('resume').value.trim().length > 0;
    } else if (fileTab.classList.contains('active')) {
        hasResume = resumeText.length > 0;
    }

    generateBtn.disabled = !(hasResume && jobUrls.length > 0);
}

function getResumeText() {
    const textTab = document.getElementById('text-resume-tab');
    if (textTab.classList.contains('active')) {
        return document.getElementById('resume').value.trim();
    } else {
        return resumeText;
    }
}

function updateUrlStatus(index, status, tooltip = '') {
    const urlInputs = document.querySelectorAll('.job-url-input');
    if (index < urlInputs.length) {
        const statusSpan = urlInputs[index].querySelector('.url-status');
        statusSpan.className = 'url-status ' + status;
        if (tooltip) {
            statusSpan.title = tooltip;
        }
    }
}

async function generateAllCoverLetters() {
    console.log('🎯 FRONTEND: generateAllCoverLetters() called');

    const resume = getResumeText();
    const jobUrls = getJobUrls();

    console.log('📝 FRONTEND: Resume length:', resume.length);
    console.log('🔗 FRONTEND: Job URLs:', jobUrls);

    if (!resume) {
        console.log('❌ FRONTEND: No resume provided');
        showError('Please enter your resume');
        return;
    }

    if (jobUrls.length === 0) {
        console.log('❌ FRONTEND: No job URLs provided');
        showError('Please enter at least one job URL');
        return;
    }

    console.log('🚀 FRONTEND: About to make API call');
    showLoading();

    // Clear all URL statuses
    jobUrls.forEach((_, index) => {
        updateUrlStatus(index, '', '');
    });

    const coverLettersContainer = document.getElementById('cover-letters-container');
    coverLettersContainer.innerHTML = '';

    try {
        console.log('📡 FRONTEND: Sending fetch request to /api/generate-cover-letters');
        const headers = await getAuthHeaders();
        const response = await fetch('/api/generate-cover-letters', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                resume: resume,
                jobUrls: jobUrls
            }),
        });
        console.log('📡 FRONTEND: Received response:', response.status);

        const data = await response.json();

        if (!response.ok) {
            // Special handling for usage limit errors
            if (response.status === 403 && data.error === 'Usage limit reached') {
                hideLoading();

                // Process any successful results before showing the limit message
                if (data.results && data.results.length > 0) {
                    // Display the partial results first
                    data.results.forEach((result, index) => {
                        if (result.success) {
                            updateUrlStatus(index, 'success', 'Cover letter generated successfully');
                            if (result.fileData) {
                                // Download immediately, no delay needed
                                downloadFile(result.fileName, result.fileData);
                            }
                        }
                    });

                    // Add summary for partial results
                    const successCount = data.results.filter(r => r.success).length;
                    const summaryDiv = document.createElement('div');
                    summaryDiv.className = 'generation-summary';
                    summaryDiv.innerHTML = `
                        <div class="summary-content">
                            <h3>Generation Summary</h3>
                            <div class="summary-stats">
                                <div class="stat-item success">
                                    <span class="stat-icon">✓</span>
                                    <span class="stat-text">${successCount} cover letter${successCount !== 1 ? 's' : ''} generated successfully</span>
                                </div>
                                <div class="stat-item warning">
                                    <span class="stat-icon">⚠</span>
                                    <span class="stat-text">Stopped: Monthly limit reached</span>
                                </div>
                            </div>
                        </div>
                    `;
                    coverLettersContainer.appendChild(summaryDiv);

                    if (successCount > 0) {
                        showSuccess(`${successCount} cover letter${successCount > 1 ? 's' : ''} generated successfully!`);
                    }
                }

                // Show modal after a short delay to let downloads start
                setTimeout(() => {
                    const shouldOpenModal = confirm('You have reached your monthly limit.\n\nWould you like to:\n• Enter a promo code for more free cover letters\n• Or upgrade to a paid plan for unlimited access?\n\nClick OK to view options or Cancel to return.');
                    if (shouldOpenModal) {
                        toggleSubscriptionModal();
                    }
                }, 500);

                return;
            }
            throw new Error(data.error || 'Failed to generate cover letters');
        }

        // Display results and update URL statuses
        data.results.forEach((result, index) => {
            if (result.success) {
                // Update URL status to success
                updateUrlStatus(index, 'success', 'Cover letter generated successfully');

                // Auto-download the file
                if (result.fileData) {
                    setTimeout(() => {
                        downloadFile(result.fileName, result.fileData);
                    }, 300 * (index + 1));
                }
            } else {
                // Only show error/fallback messages in the container
                const coverLetterDiv = document.createElement('div');
                coverLetterDiv.className = 'cover-letter';

                // Check if this is a fallback case (failed to fetch job description)
                if (result.usedFallback) {
                    // Update URL status to fallback/warning
                    updateUrlStatus(index, 'fallback', result.fallbackReason);

                    // Check if this is a login wall issue
                    const isLoginWall = result.fallbackReason &&
                        (result.fallbackReason.includes('login wall') ||
                         result.fallbackReason.includes('login page') ||
                         result.fallbackReason.includes('invalid page'));

                    let helpContent = '';
                    if (isLoginWall) {
                        // Non-technical explanation for login walls
                        helpContent = `
                            <div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px; margin-top: 15px; border-radius: 4px;">
                                <p style="font-size: 13px; color: #92400e; font-weight: 600; margin-bottom: 8px;">🔒 Why This Happened</p>
                                <p style="font-size: 12px; color: #78350f; margin-bottom: 8px;">
                                    The job posting page requires you to be logged in to view it. Our tool cannot access pages that are behind a login.
                                </p>
                                <p style="font-size: 12px; color: #78350f; font-weight: 600; margin-bottom: 4px;">✅ What You Can Do:</p>
                                <p style="font-size: 12px; color: #78350f; margin-bottom: 4px;">
                                    • Make sure you're logged into the job site and can see the full job description
                                </p>
                                <p style="font-size: 12px; color: #78350f; margin-bottom: 4px;">
                                    • Try copying the job description text directly and pasting it into a document
                                </p>
                                <p style="font-size: 12px; color: #78350f;">
                                    • Some job sites don't allow automated access - you may need to manually copy the content
                                </p>
                            </div>
                        `;
                    } else {
                        // Generic help for other fetch failures
                        helpContent = `
                            <div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px; margin-top: 15px; border-radius: 4px;">
                                <p style="font-size: 13px; color: #92400e; font-weight: 600; margin-bottom: 8px;">💡 What This Means</p>
                                <p style="font-size: 12px; color: #78350f; margin-bottom: 8px;">
                                    We couldn't access or read the job posting from this URL. This can happen if the page has restrictions or the link has expired.
                                </p>
                                <p style="font-size: 12px; color: #78350f; font-weight: 600; margin-bottom: 4px;">✅ Try This:</p>
                                <p style="font-size: 12px; color: #78350f; margin-bottom: 4px;">
                                    • Check if the URL still works in your browser
                                </p>
                                <p style="font-size: 12px; color: #78350f; margin-bottom: 4px;">
                                    • Make sure the link goes directly to a single job posting
                                </p>
                                <p style="font-size: 12px; color: #78350f;">
                                    • Try refreshing the job page and copying the URL again
                                </p>
                            </div>
                        `;
                    }

                    coverLetterDiv.innerHTML = `
                        <h3 style="color: #f59e0b;">⚠️ Job ${index + 1} - Cover Letter Not Generated</h3>
                        <p style="color: #f59e0b; font-size: 14px; margin-bottom: 10px;">
                            We couldn't access this job posting.
                        </p>
                        <p style="font-size: 12px; color: #666;">URL: ${result.jobUrl}</p>
                        ${helpContent}
                    `;
                } else {
                    // Update URL status to error
                    updateUrlStatus(index, 'error', result.error);

                    coverLetterDiv.innerHTML = `
                        <h3 style="color: #dc2626;">Error for Job ${index + 1}</h3>
                        <p style="color: #dc2626;">${result.error}</p>
                        <p style="font-size: 12px; color: #666;">URL: ${result.jobUrl}</p>
                    `;
                }

                coverLettersContainer.appendChild(coverLetterDiv);
            }
        });

        const successCount = data.results.filter(r => r.success).length;
        const fallbackCount = data.results.filter(r => r.usedFallback).length;
        const totalCount = data.results.length;

        // Add summary section at the bottom
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'generation-summary';
        summaryDiv.innerHTML = `
            <div class="summary-content">
                <h3>Generation Summary</h3>
                <div class="summary-stats">
                    <div class="stat-item success">
                        <span class="stat-icon">✓</span>
                        <span class="stat-text">${successCount} cover letter${successCount !== 1 ? 's' : ''} generated successfully</span>
                    </div>
                    ${fallbackCount > 0 ? `
                    <div class="stat-item warning">
                        <span class="stat-icon">⚠</span>
                        <span class="stat-text">${fallbackCount} URL${fallbackCount !== 1 ? 's' : ''} failed</span>
                    </div>
                    ` : ''}
                    <div class="stat-item total">
                        <span class="stat-icon">📊</span>
                        <span class="stat-text">Total: ${successCount} of ${totalCount} successful</span>
                    </div>
                </div>
            </div>
        `;
        coverLettersContainer.appendChild(summaryDiv);

        if (successCount > 0) {
            let successMsg = `${successCount} cover letter${successCount > 1 ? 's' : ''} generated successfully!`;
            showSuccess(successMsg);
        }

        if (fallbackCount > 0) {
            showError(`${fallbackCount} URL${fallbackCount > 1 ? 's' : ''} failed - could not extract job description`);
        }

    } catch (error) {
        showError('Error generating cover letters: ' + error.message);
    } finally {
        hideLoading();
    }
}


// User authentication and subscription management
let currentUserData = null;

async function loadUserData() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/auth/status', { headers });
        const data = await response.json();

        if (data.authenticated) {
            currentUserData = data;
            updateUserUI(data);
        } else {
            console.error('Not authenticated, staying on page');
            // Don't redirect - user has session, backend issue
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        // Don't show error or redirect
    }
}

function updateUserUI(data) {
    document.getElementById('user-email').textContent = data.user.email;
    document.getElementById('user-tier').textContent = formatTierName(data.user.tier);
    document.getElementById('user-tier').className = 'tier-badge tier-' + data.user.tier;

    // Update plan buttons
    document.querySelectorAll('.plan-card').forEach(card => {
        const tier = card.getAttribute('data-tier');
        const button = card.querySelector('.btn-plan');

        if (tier === data.user.tier) {
            button.textContent = 'Current Plan';
            button.disabled = true;
        } else {
            button.textContent = tier === 'free' ? 'Downgrade' : 'Upgrade';
            button.disabled = false;
        }
    });

    // Show/hide cancel section
    const cancelSection = document.getElementById('cancel-section');
    if (data.user.tier !== 'free') {
        cancelSection.classList.remove('hidden');
    } else {
        cancelSection.classList.add('hidden');
    }
}

function formatTierName(tier) {
    const names = {
        'free': 'Free',
        'monthly': 'Monthly',
        'quarterly': 'Quarterly',
        'annual': 'Annual'
    };
    return names[tier] || tier;
}

// Logout function is defined earlier in the file (line 92)

function toggleSubscriptionModal() {
    const modal = document.getElementById('subscription-modal');
    modal.classList.toggle('hidden');
}

async function changePlan(tier) {
    if (tier === currentUserData.user.tier) {
        return;
    }

    // For paid plans, show a message (in real app, this would integrate with Stripe)
    if (tier !== 'free') {
        alert(`Payment integration coming soon!\n\nThis would redirect you to checkout for the ${formatTierName(tier)} plan.`);
        // In production, you would:
        // 1. Create Stripe checkout session
        // 2. Redirect to Stripe checkout
        // 3. Handle webhook to update subscription
        return;
    }

    // For downgrading to free, just update directly
    if (confirm('Are you sure you want to downgrade to the Free plan? You will lose access to premium features.')) {
        try {
            showLoading();
            const headers = await getAuthHeaders();
            const response = await fetch('/api/subscription/change', {
                method: 'POST',
                headers,
                body: JSON.stringify({ tier })
            });

            const data = await response.json();

            if (data.success) {
                currentUserData = data;
                updateUserUI(data);
                showSuccess('Subscription updated successfully');
            } else {
                showError(data.error || 'Failed to update subscription');
            }
        } catch (error) {
            console.error('Error changing plan:', error);
            showError('Failed to update subscription');
        } finally {
            hideLoading();
        }
    }
}

async function cancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription? You will lose access to premium features.')) {
        return;
    }

    try {
        showLoading();
        const response = await fetch('/api/subscription/cancel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            currentUserData = data;
            updateUserUI(data);
            showSuccess('Subscription cancelled successfully');
            toggleSubscriptionModal();
        } else {
            showError(data.error || 'Failed to cancel subscription');
        }
    } catch (error) {
        console.error('Error canceling subscription:', error);
        showError('Failed to cancel subscription');
    } finally {
        hideLoading();
    }
}

async function applyPromoCode() {
    const promoCodeInput = document.getElementById('promo-code-input');
    const promoMessage = document.getElementById('promo-message');
    const promoCode = promoCodeInput.value.trim().toUpperCase();

    if (!promoCode) {
        promoMessage.textContent = 'Please enter a promo code';
        promoMessage.className = 'promo-message error';
        promoMessage.classList.remove('hidden');
        return;
    }

    try {
        showLoading();
        const headers = await getAuthHeaders();
        const response = await fetch('/api/promo-code/apply', {
            method: 'POST',
            headers,
            body: JSON.stringify({ promoCode })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            promoMessage.textContent = data.message;
            promoMessage.className = 'promo-message success';
            promoMessage.classList.remove('hidden');
            promoCodeInput.value = '';

            // Reload user data to update usage display
            await loadUserData();

            showSuccess('Promo code applied successfully!');
        } else {
            promoMessage.textContent = data.error || 'Failed to apply promo code';
            promoMessage.className = 'promo-message error';
            promoMessage.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error applying promo code:', error);
        promoMessage.textContent = 'Failed to apply promo code';
        promoMessage.className = 'promo-message error';
        promoMessage.classList.remove('hidden');
    } finally {
        hideLoading();
    }
}

// Function to download file from base64 data
function downloadFile(fileName, base64Data) {
    try {
        // Convert base64 to binary
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Create blob and download
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

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('subscription-modal');
    if (event.target === modal) {
        toggleSubscriptionModal();
    }
}

// Event listeners
document.getElementById('resume').addEventListener('input', updateGenerateButtonState);

// Add event listener for URL inputs
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('job-url')) {
        updateGenerateButtonState();
    }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', async function() {
    await initAuth(); // Initialize Supabase auth first
    updateGenerateButtonState();
    loadUserData();
});