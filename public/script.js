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

// Tab switching function for resume
function switchResumeTab(tabType) {
    const textTab = document.getElementById('text-resume-tab');
    const fileTab = document.getElementById('file-resume-tab');
    const tabBtns = document.querySelectorAll('.resume-input-options .tab-btn');

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

// Mode switching function (URL vs Manual)
function switchInputMode(mode) {
    const urlSection = document.getElementById('url-mode-section');
    const manualSection = document.getElementById('manual-mode-section');

    if (mode === 'url') {
        urlSection.classList.remove('hidden');
        manualSection.classList.add('hidden');
    } else {
        urlSection.classList.add('hidden');
        manualSection.classList.remove('hidden');
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

// Show alert modal popup
function showAlertModal(title, message, buttonText = 'OK', onButtonClick = null) {
    const modal = document.getElementById('alert-modal');
    const modalTitle = document.getElementById('alert-modal-title');
    const modalMessage = document.getElementById('alert-modal-message');
    const modalButton = document.getElementById('alert-modal-button');

    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalButton.textContent = buttonText;

    // Set up button click handler
    const handleButtonClick = () => {
        modal.classList.add('hidden');
        if (onButtonClick) {
            onButtonClick();
        }
    };

    // Remove old event listener and add new one
    const newButton = modalButton.cloneNode(true);
    modalButton.parentNode.replaceChild(newButton, modalButton);
    newButton.addEventListener('click', handleButtonClick);

    modal.classList.remove('hidden');
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
                placeholder="Enter job posting URL (Indeed, LinkedIn, etc.)..."
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
    // Check which mode is active
    const urlSection = document.getElementById('url-mode-section');
    if (!urlSection.classList.contains('hidden')) {
        // URL mode - get URLs
        const urlInputs = document.querySelectorAll('.job-url');
        const urls = [];
        urlInputs.forEach(input => {
            const url = input.value.trim();
            if (url) {
                urls.push({ url: url, isManual: false });
            }
        });
        return urls;
    } else {
        // Manual mode - get manual jobs
        return getManualJobs();
    }
}

function updateGenerateButtonState() {
    // Button is always enabled now
    // Validation will be done when user clicks the button and shown as modal
}

function getResumeText() {
    const textTab = document.getElementById('text-resume-tab');
    if (textTab.classList.contains('active')) {
        return document.getElementById('resume').value.trim();
    } else {
        return resumeText;
    }
}

// Mode switching removed - extension-only mode now

// Add a manual job input card
function addManualJob() {
    const container = document.getElementById('manual-jobs-container');
    const currentCount = container.querySelectorAll('.manual-job-card').length;

    const jobCard = document.createElement('div');
    jobCard.className = 'manual-job-card';
    jobCard.setAttribute('data-index', currentCount);
    jobCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0; font-size: 16px; color: #111827;">Job #${currentCount + 1}</h3>
            <button type="button" class="remove-btn" onclick="removeManualJob(this)">✕</button>
        </div>
        <input
            type="text"
            placeholder="Job Title (optional - AI will extract if empty)"
            class="manual-job-title"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 10px; font-size: 14px;"
        >
        <input
            type="text"
            placeholder="Company Name (optional - AI will extract if empty)"
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

    // Update remove button visibility on first job
    updateRemoveButtonsVisibility();
    updateGenerateButtonState();
}

// Remove a manual job input card
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

        updateRemoveButtonsVisibility();
        updateGenerateButtonState();
    }
}

// Update visibility of remove buttons on manual jobs
function updateRemoveButtonsVisibility() {
    const container = document.getElementById('manual-jobs-container');
    const jobCards = container.querySelectorAll('.manual-job-card');

    jobCards.forEach((card, index) => {
        const removeBtn = card.querySelector('.remove-btn');
        if (jobCards.length === 1) {
            removeBtn.style.display = 'none';
        } else {
            removeBtn.style.display = 'block';
        }
    });
}

// Get manual jobs from form
function getManualJobs() {
    const jobCards = document.querySelectorAll('.manual-job-card');
    const jobs = [];

    jobCards.forEach((card, index) => {
        const title = card.querySelector('.manual-job-title').value.trim();
        const company = card.querySelector('.manual-job-company').value.trim();
        const description = card.querySelector('.manual-job-description').value.trim();

        // Only description is required - title and company are optional (AI will extract if missing)
        if (description) {
            jobs.push({
                isManual: true,
                title,
                company,
                description
            });
        }
    });

    return jobs;
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
        showAlertModal('Resume Required', 'Please upload or paste your resume before generating cover letters.', 'OK');
        return;
    }

    if (jobUrls.length === 0) {
        console.log('❌ FRONTEND: No job URLs provided');

        // Check which mode is active to show appropriate error message
        const urlSection = document.getElementById('url-mode-section');
        const isUrlMode = !urlSection.classList.contains('hidden');

        const errorTitle = 'Job Information Required';
        const errorMessage = isUrlMode
            ? 'Please enter at least one job URL before generating cover letters.'
            : 'Please enter at least one job description before generating cover letters.';

        showAlertModal(errorTitle, errorMessage, 'OK');
        return;
    }

    // Check if mandatory profile fields are filled
    const profileValidation = await validateMandatoryProfileFields();
    if (!profileValidation.isValid) {
        showAlertModal('Complete Your Profile', profileValidation.message, 'Open Profile Settings', () => {
            toggleProfileSettingsModal();
        });
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

                    let helpContent = `
                        <div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px; margin-top: 15px; border-radius: 4px;">
                            <p style="font-size: 13px; color: #92400e; font-weight: 600; margin-bottom: 8px;">💡 Error Details</p>
                            <p style="font-size: 12px; color: #78350f; margin-bottom: 8px;">
                                ${result.fallbackReason || result.error || 'This URL cannot be accessed due to the website\'s policies (login requirements, access restrictions, etc.).'}
                            </p>
                        </div>
                    `;

                    coverLetterDiv.innerHTML = `
                        <h3 style="color: #f59e0b;">⚠️ Job ${index + 1} - Cover Letter Not Generated</h3>
                        <p style="color: #f59e0b; font-size: 14px; margin-bottom: 10px;">
                            We couldn't access this job posting.
                        </p>
                        ${helpContent}
                    `;
                } else {
                    // Update URL status to error
                    updateUrlStatus(index, 'error', result.error);

                    coverLetterDiv.innerHTML = `
                        <h3 style="color: #dc2626;">Error for Job ${index + 1}</h3>
                        <p style="color: #dc2626;">${result.error}</p>
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
        showError('Unable to generate cover letters. Please check your inputs and try again.');
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

// Validate mandatory profile fields before generating cover letters
async function validateMandatoryProfileFields() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/user/profile', { headers });

        if (!response.ok) {
            // Profile doesn't exist or error fetching - treat as missing profile
            return {
                isValid: false,
                message: 'Please set up your profile before generating cover letters. Click "Profile Settings" to add your Full Name, Email, and Phone Number.'
            };
        }

        const profile = await response.json();

        // Check if mandatory fields are filled
        const missingFields = [];
        if (!profile.full_name || profile.full_name.trim() === '') {
            missingFields.push('Full Name');
        }
        if (!profile.phone || profile.phone.trim() === '') {
            missingFields.push('Phone Number');
        }

        // Email is always filled from account, but let's check anyway
        const email = currentUser?.email || '';
        if (!email || email.trim() === '') {
            missingFields.push('Email');
        }

        if (missingFields.length > 0) {
            return {
                isValid: false,
                message: `Please complete your profile before generating cover letters. Missing required fields: ${missingFields.join(', ')}. Click "Profile Settings" to fill in these details.`
            };
        }

        return { isValid: true };
    } catch (error) {
        console.error('Error validating profile fields:', error);
        // Network error or other issue - be clear about what to do
        return {
            isValid: false,
            message: 'Please set up your profile before generating cover letters. Click "Profile Settings" to add your Full Name, Email, and Phone Number.'
        };
    }
}

// Profile Settings Modal Functions
function toggleProfileSettingsModal() {
    const modal = document.getElementById('profile-settings-modal');
    const isHidden = modal.classList.contains('hidden');

    if (isHidden) {
        // Opening modal - load current settings and reset button
        resetSaveButton();
        loadProfileSettings();
    }

    modal.classList.toggle('hidden');
}

function resetSaveButton() {
    const saveButton = document.querySelector('.btn-save-profile');
    if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Settings';
        saveButton.classList.remove('has-changes');
    }
}

async function loadProfileSettings() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/user/profile', { headers });

        if (response.ok) {
            const profile = await response.json();

            // Populate form fields
            document.getElementById('profile-fullname').value = profile.full_name || '';
            document.getElementById('profile-credentials').value = profile.credentials || '';
            document.getElementById('profile-city').value = profile.city || '';
            document.getElementById('profile-email').value = currentUser?.email || '';
            document.getElementById('profile-phone').value = profile.phone || '';
            document.getElementById('profile-linkedin').value = profile.linkedin_url || '';

            // Set header template
            const templateRadio = document.querySelector(`input[name="header-template"][value="${profile.header_template}"]`);
            if (templateRadio) {
                templateRadio.checked = true;
            }

            // Set header color
            const colorRadio = document.querySelector(`input[name="header-color"][value="${profile.header_color}"]`);
            if (colorRadio) {
                colorRadio.checked = true;
            }

            // Set font settings
            console.log('📝 Loading font settings:', {
                header_font: profile.header_font,
                header_font_size: profile.header_font_size,
                body_font: profile.body_font,
                body_font_size: profile.body_font_size,
                page_border: profile.page_border
            });

            document.getElementById('header-font').value = profile.header_font || 'Calibri';
            document.getElementById('header-font-size').value = profile.header_font_size || 16;
            document.getElementById('body-font').value = profile.body_font || 'Calibri';
            document.getElementById('body-font-size').value = profile.body_font_size || 12;

            // Set page border
            const borderRadio = document.querySelector(`input[name="page-border"][value="${profile.page_border || 'narrow'}"]`);
            if (borderRadio) {
                borderRadio.checked = true;
            }

            console.log('✅ Font settings loaded - Header:', document.getElementById('header-font').value, document.getElementById('header-font-size').value, '| Body:', document.getElementById('body-font').value, document.getElementById('body-font-size').value);

            // Update preview
            updateHeaderPreview();

            // Store initial settings and reset save button
            storeInitialProfileSettings();
            updateSaveButtonState();
        }
    } catch (error) {
        console.error('Error loading profile settings:', error);
        // Still populate email even if profile fetch fails
        document.getElementById('profile-email').value = currentUser?.email || '';
    }
}

async function saveProfileSettings() {
    const saveButton = document.querySelector('.btn-save-profile');
    const originalButtonText = saveButton.textContent;

    try {
        const saveMessage = document.getElementById('profile-save-message');
        saveMessage.classList.add('hidden');

        // Disable button and show loading state
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';

        // Get form values
        const profileData = {
            full_name: document.getElementById('profile-fullname').value.trim(),
            credentials: document.getElementById('profile-credentials').value.trim(),
            city: document.getElementById('profile-city').value.trim(),
            phone: document.getElementById('profile-phone').value.trim(),
            linkedin_url: document.getElementById('profile-linkedin').value.trim(),
            header_template: document.querySelector('input[name="header-template"]:checked').value,
            header_color: document.querySelector('input[name="header-color"]:checked').value,
            header_font: document.getElementById('header-font').value,
            header_font_size: parseInt(document.getElementById('header-font-size').value) || 16,
            body_font: document.getElementById('body-font').value,
            body_font_size: parseInt(document.getElementById('body-font-size').value) || 12,
            page_border: document.querySelector('input[name="page-border"]:checked').value
        };

        const headers = await getAuthHeaders();
        const response = await fetch('/api/user/profile', {
            method: 'POST',
            headers,
            body: JSON.stringify(profileData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Update initial settings to current settings (reset change tracking)
            storeInitialProfileSettings();

            // Reset button before closing
            saveButton.disabled = false;
            saveButton.textContent = 'Save Settings';

            // Show success message briefly
            showSuccess('Profile settings saved!');

            // Close modal immediately
            toggleProfileSettingsModal();
        } else {
            saveMessage.textContent = data.error || 'Failed to save profile settings';
            saveMessage.className = 'profile-save-message error';
            saveMessage.classList.remove('hidden');

            // Re-enable button on error
            saveButton.disabled = false;
            saveButton.textContent = originalButtonText;
        }
    } catch (error) {
        console.error('Error saving profile settings:', error);
        const saveMessage = document.getElementById('profile-save-message');
        saveMessage.textContent = 'Failed to save profile settings';
        saveMessage.className = 'profile-save-message error';
        saveMessage.classList.remove('hidden');

        // Re-enable button on error
        saveButton.disabled = false;
        saveButton.textContent = originalButtonText;
    }
}

// Track profile settings changes
let initialProfileSettings = null;

function getCurrentProfileSettings() {
    const settings = {
        full_name: document.getElementById('profile-fullname')?.value.trim() || '',
        credentials: document.getElementById('profile-credentials')?.value.trim() || '',
        city: document.getElementById('profile-city')?.value.trim() || '',
        phone: document.getElementById('profile-phone')?.value.trim() || '',
        linkedin_url: document.getElementById('profile-linkedin')?.value.trim() || '',
        header_template: document.querySelector('input[name="header-template"]:checked')?.value || 'center',
        header_color: document.querySelector('input[name="header-color"]:checked')?.value || '#000000',
        header_font: document.getElementById('header-font')?.value || 'Calibri',
        header_font_size: document.getElementById('header-font-size')?.value || '16',
        body_font: document.getElementById('body-font')?.value || 'Calibri',
        body_font_size: document.getElementById('body-font-size')?.value || '12',
        page_border: document.querySelector('input[name="page-border"]:checked')?.value || 'narrow'
    };
    return settings;
}

function storeInitialProfileSettings() {
    initialProfileSettings = getCurrentProfileSettings();
}

function updateSaveButtonState() {
    const saveButton = document.querySelector('.btn-save-profile');
    if (!saveButton) return;

    if (!initialProfileSettings) {
        // If we don't have initial settings yet, button should be grey
        saveButton.classList.remove('has-changes');
        return;
    }

    const currentSettings = getCurrentProfileSettings();
    const hasChanges = JSON.stringify(currentSettings) !== JSON.stringify(initialProfileSettings);

    console.log('🔄 Checking for changes:', hasChanges);
    console.log('Initial:', initialProfileSettings);
    console.log('Current:', currentSettings);

    if (hasChanges) {
        saveButton.classList.add('has-changes');
    } else {
        saveButton.classList.remove('has-changes');
    }
}

function updateHeaderPreview() {
    const preview = document.getElementById('header-preview');
    const template = document.querySelector('input[name="header-template"]:checked').value;
    const color = document.querySelector('input[name="header-color"]:checked').value;

    const fullName = document.getElementById('profile-fullname').value.trim();
    const credentials = document.getElementById('profile-credentials').value.trim();
    const city = document.getElementById('profile-city').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const linkedin = document.getElementById('profile-linkedin').value.trim();

    if (template === 'none') {
        preview.innerHTML = '<p class="preview-message">No header will be added to your cover letters</p>';
        return;
    }

    // Build header lines
    let line1 = fullName || 'Your Name';
    if (credentials) {
        line1 += ', ' + credentials;
    }

    // Build line 2 with smart separators
    const line2Parts = [];
    if (city) line2Parts.push(city);
    if (email) line2Parts.push(email);
    if (phone) line2Parts.push(phone);
    if (linkedin) {
        // Show shortened LinkedIn URL in preview
        const linkedinDisplay = linkedin.replace(/^(https?:\/\/)?(www\.)?/, '');
        line2Parts.push(linkedinDisplay);
    }

    const line2 = line2Parts.length > 0 ? line2Parts.join(' | ') : 'Contact info will appear here';

    const alignment = template === 'center' ? 'center' : 'left';

    preview.innerHTML = `
        <div style="text-align: ${alignment}; color: ${color}; font-family: Calibri, sans-serif;">
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">${line1}</div>
            <div style="font-size: 12px; margin-bottom: 8px;">${line2}</div>
            <hr style="border: none; border-top: 1px solid ${color}; opacity: 0.5;">
        </div>
    `;
}

// Close modals when clicking outside
window.onclick = function(event) {
    const subscriptionModal = document.getElementById('subscription-modal');
    const profileModal = document.getElementById('profile-settings-modal');

    if (event.target === subscriptionModal) {
        toggleSubscriptionModal();
    }
    if (event.target === profileModal) {
        toggleProfileSettingsModal();
    }
}

// Event listeners
document.getElementById('resume').addEventListener('input', updateGenerateButtonState);

// Add event listener for URL inputs and manual job inputs
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('job-url') ||
        e.target.classList.contains('manual-job-title') ||
        e.target.classList.contains('manual-job-company') ||
        e.target.classList.contains('manual-job-description')) {
        updateGenerateButtonState();
    }

    // Update profile header preview when profile inputs change
    if (e.target.classList.contains('profile-input')) {
        updateHeaderPreview();
        updateSaveButtonState();
    }
});

// Add event listener for template, color, and border radio buttons
document.addEventListener('change', function(e) {
    if (e.target.name === 'header-template' || e.target.name === 'header-color') {
        updateHeaderPreview();
        updateSaveButtonState();
    }
    // Also update preview when page margins change
    if (e.target.name === 'page-border') {
        console.log('📐 Page margins changed to:', e.target.value);
        updateSaveButtonState();
    }
    // Update preview when font settings change
    if (e.target.id === 'header-font' || e.target.id === 'body-font' ||
        e.target.id === 'header-font-size' || e.target.id === 'body-font-size') {
        console.log('🔤 Font setting changed:', e.target.id, '=', e.target.value);
        updateHeaderPreview();
    }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', async function() {
    await initAuth(); // Initialize Supabase auth first
    updateGenerateButtonState();
    loadUserData();
});