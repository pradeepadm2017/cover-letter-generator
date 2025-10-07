// Global variable to store extracted resume text
let resumeText = '';

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
        fileStatus.textContent = `✕ Error: ${error.message}`;
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
        const response = await fetch('/api/generate-cover-letters', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                resume: resume,
                jobUrls: jobUrls
            }),
        });
        console.log('📡 FRONTEND: Received response:', response.status);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to generate cover letters');
        }

        // Display results and update URL statuses
        data.results.forEach((result, index) => {
            const coverLetterDiv = document.createElement('div');
            coverLetterDiv.className = 'cover-letter';

            if (result.success) {
                // Update URL status to success
                updateUrlStatus(index, 'success', 'Cover letter generated successfully');

                coverLetterDiv.innerHTML = `
                    <h3>Cover Letter ${index + 1}</h3>
                    <p style="color: #059669; font-size: 14px; margin-bottom: 10px;">
                        ✅ Automatically saved to: ${result.filePath}
                    </p>
                `;
            } else {
                // Check if this is a fallback case (failed to fetch job description)
                if (result.usedFallback) {
                    // Update URL status to fallback/warning
                    updateUrlStatus(index, 'fallback', result.fallbackReason);

                    coverLetterDiv.innerHTML = `
                        <h3 style="color: #f59e0b;">⚠️ Job ${index + 1} - Cover Letter Not Generated</h3>
                        <p style="color: #f59e0b; font-size: 14px; margin-bottom: 10px;">
                            ${result.fallbackReason}
                        </p>
                        <p style="font-size: 12px; color: #666;">URL: ${result.jobUrl}</p>
                        <p style="font-size: 12px; color: #666; margin-top: 10px;">
                            Please verify the URL is accessible and points to a job posting page.
                        </p>
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
            }

            coverLettersContainer.appendChild(coverLetterDiv);
        });

        const successCount = data.results.filter(r => r.success).length;
        const fallbackCount = data.results.filter(r => r.usedFallback).length;

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
        const response = await fetch('/api/auth/status');
        const data = await response.json();

        if (data.authenticated) {
            currentUserData = data;
            updateUserUI(data);
        } else {
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        showError('Failed to load user information');
    }
}

function updateUserUI(data) {
    document.getElementById('user-email').textContent = data.user.email;
    document.getElementById('user-tier').textContent = formatTierName(data.user.tier);
    document.getElementById('user-tier').className = 'tier-badge tier-' + data.user.tier;

    // Update modal
    document.getElementById('modal-email').textContent = data.user.email;
    document.getElementById('modal-tier').textContent = formatTierName(data.user.tier);
    document.getElementById('modal-tier').className = 'value tier-badge tier-' + data.user.tier;

    // Update usage display
    if (data.usage.tier === 'free') {
        document.getElementById('modal-usage').textContent = `${data.usage.used} / 3`;
    } else {
        document.getElementById('modal-usage').textContent = 'Unlimited';
    }

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

function logout() {
    window.location.href = '/auth/logout';
}

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
            const response = await fetch('/api/subscription/change', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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
document.addEventListener('DOMContentLoaded', function() {
    updateGenerateButtonState();
    loadUserData();
});