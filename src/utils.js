


// Helper: Load/Save novels in localStorage
export function loadNovels() {
  try {
    const raw = localStorage.getItem('novels');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Failed to load novels from localStorage:", error);
    showConfirm({ title: 'Data Load Error', message: 'Could not load your saved novels. Your data might be corrupted, or localStorage is unavailable. Any new work might not be saved correctly if the issue persists.', okText: 'OK' });
    return [];
  }
}

export function saveNovels(novels) {
  try {
    localStorage.setItem('novels', JSON.stringify(novels));
  } catch (error) {
    console.error("Failed to save novels to localStorage:", error);
    showConfirm({ title: 'Save Error', message: 'Could not save your changes. Please ensure localStorage is enabled and not full. Further edits might be lost if this issue is not resolved.', okText: 'OK' });
  }
}

const APP_SETTINGS_KEY = 'novelCreatorAppSettings';

// Helper: Load Application Settings
export function loadAppSettings() {
  const defaults = {
    defaultAuthor: '',
    autoOpenDrawerDesktop: true,
    theme: 'dark', // Default theme is dark
  };
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    const loadedSettings = raw ? JSON.parse(raw) : {};
    // Ensure theme is always one of the valid options, defaulting to 'dark'
    if (!['light', 'dark'].includes(loadedSettings.theme)) {
        loadedSettings.theme = defaults.theme;
    }
    return { ...defaults, ...loadedSettings };
  } catch (error) {
    console.error("Failed to load app settings from localStorage:", error);
    return defaults;
  }
}

// Helper: Save Application Settings
export function saveAppSettings(settings) {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save app settings to localStorage:", error);
  }
}


// Helper: Sanitize a filename
export function sanitizeFilename(str) {
  if (!str) return 'untitled';
  return str
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .substring(0, 100);
}

// Helper: Convert File -> DataURL
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = err => {
      console.error("File to DataURL error:", err);
      reject(err);
    };
    reader.readAsDataURL(file);
  });
}

// Helper function to convert HTML to plain text
export function htmlToPlainText(htmlString) {
  if (!htmlString) return '';
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;

  // Attempt to add newlines for block elements for better readability
  // This is a simplified approach; complex HTML might need more sophisticated handling.
  tempDiv.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, li, blockquote, pre, hr').forEach(el => {
    if (el.tagName === 'HR') {
        el.parentNode.insertBefore(document.createTextNode('\n---\n'), el.nextSibling);
    } else {
        const newline = document.createTextNode('\n');
        el.parentNode.insertBefore(newline, el.nextSibling);
    }
  });
  tempDiv.querySelectorAll('br').forEach(br => {
    br.parentNode.insertBefore(document.createTextNode('\n'), br);
  });
  
  let text = tempDiv.textContent || tempDiv.innerText || "";
  
  // Normalize multiple newlines (possibly introduced by block element handling and existing text)
  // Replace 3 or more newlines with 2
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');
  // Trim leading/trailing whitespace and newlines
  return text.trim();
}


const FOCUSABLE_ELEMENTS_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Helper function for haptic feedback
export function triggerHapticFeedback(pattern = [10]) { // Default to a very short tap
  if (navigator.vibrate && window.matchMedia("(hover: none)").matches) { // Check for touch device
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      // console.warn("Haptic feedback failed:", e); // Optional: log if needed
    }
  }
}

// Helper: Custom prompt/modal
export function showPrompt({ title = 'Enter value:', placeholder = '', initialValue = '' }) {
  return new Promise(resolve => {
    const triggeringElement = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-labelledby="promptTitle" aria-modal="true">
        <h2 id="promptTitle">${title}</h2>
        <input type="text" id="promptInput" placeholder="${placeholder}" value="${initialValue}" class="w-full p-2 mb-4 bg-color-input-bg border border-color-border rounded text-color-onSurface">
        <div class="actions">
          <button id="promptCancelBtn" class="btn btn-secondary">Cancel</button>
          <button id="promptOkBtn" class="btn btn-primary">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('body-modal-open');

    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    const modalElement = overlay.querySelector('.modal');
    const inputEl = overlay.querySelector('#promptInput');
    const okBtn = overlay.querySelector('#promptOkBtn');
    const cancelBtn = overlay.querySelector('#promptCancelBtn');
    
    const focusableElements = Array.from(modalElement.querySelectorAll(FOCUSABLE_ELEMENTS_SELECTOR)).filter(el => el.offsetParent !== null);
    const firstFocusableElement = focusableElements[0] || inputEl;
    const lastFocusableElement = focusableElements[focusableElements.length - 1] || okBtn;

    inputEl.focus();
    inputEl.select();

    const handleSubmit = () => {
      triggerHapticFeedback([20]);
      const value = inputEl.value.trim();
      cleanup();
      resolve(value || null); // Resolve with null if empty string after trim, consistent with cancel
    };

    const handleCancel = () => {
      triggerHapticFeedback([10]);
      cleanup();
      resolve(null);
    };
    
    const handleKeyDown = (ev) => {
        if (ev.key === 'Enter' && ev.target === inputEl) {
            ev.preventDefault();
            handleSubmit();
        } else if (ev.key === 'Escape') {
            handleCancel();
        } else if (ev.key === 'Tab') {
            if (focusableElements.length === 0) {
                ev.preventDefault();
                return;
            }
            if (ev.shiftKey) {
                if (document.activeElement === firstFocusableElement) {
                    ev.preventDefault();
                    lastFocusableElement.focus();
                }
            } else {
                if (document.activeElement === lastFocusableElement) {
                    ev.preventDefault();
                    firstFocusableElement.focus();
                }
            }
        }
    };

    okBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', ev => {
      if (ev.target === overlay) {
        handleCancel();
      }
    });
    overlay.addEventListener('keydown', handleKeyDown);

    function cleanup() {
      overlay.classList.remove('active');
      document.body.classList.remove('body-modal-open');
      okBtn.removeEventListener('click', handleSubmit);
      cancelBtn.removeEventListener('click', handleCancel);
      overlay.removeEventListener('click', handleCancel); // Changed from handleCancel to the correct specific handler
      overlay.removeEventListener('keydown', handleKeyDown);
      
      setTimeout(() => {
          if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
          }
          if (triggeringElement && typeof triggeringElement.focus === 'function') {
            triggeringElement.focus();
          }
      }, 200); 
    }
  });
}

// Helper: Custom confirm/modal
export function showConfirm({ title = 'Are you sure?', message = '', okText = 'OK', cancelText = 'Cancel' }) {
  return new Promise(resolve => {
    const triggeringElement = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="alertdialog" aria-labelledby="confirmTitle" aria-describedby="confirmMessage" aria-modal="true">
        <h2 id="confirmTitle">${title}</h2>
        ${message ? `<p id="confirmMessage" class="modal-message">${message}</p>` : ''}
        <div class="actions">
          <button id="confirmCancelBtn" class="btn btn-secondary">${cancelText}</button>
          <button id="confirmOkBtn" class="btn btn-primary">${okText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('body-modal-open');
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    const modalElement = overlay.querySelector('.modal');
    const okBtn = overlay.querySelector('#confirmOkBtn');
    const cancelBtn = overlay.querySelector('#confirmCancelBtn');
    
    const focusableElements = Array.from(modalElement.querySelectorAll(FOCUSABLE_ELEMENTS_SELECTOR)).filter(el => el.offsetParent !== null);
    const firstFocusableElement = focusableElements[0] || cancelBtn;
    const lastFocusableElement = focusableElements[focusableElements.length - 1] || okBtn;
    
    okBtn.focus(); 

    const handleOk = () => {
      triggerHapticFeedback([20]);
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      triggerHapticFeedback([10]);
      cleanup();
      resolve(false);
    };

    const handleKeyDown = (ev) => {
        if (ev.key === 'Enter' && document.activeElement !== cancelBtn) { 
            ev.preventDefault();
            handleOk();
        } else if (ev.key === 'Escape') {
            handleCancel();
        } else if (ev.key === 'Tab') {
             if (focusableElements.length === 0) {
                ev.preventDefault();
                return;
            }
            if (ev.shiftKey) {
                if (document.activeElement === firstFocusableElement) {
                    ev.preventDefault();
                    lastFocusableElement.focus();
                }
            } else {
                if (document.activeElement === lastFocusableElement) {
                    ev.preventDefault();
                    firstFocusableElement.focus();
                }
            }
        }
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', ev => {
      if (ev.target === overlay) {
        handleCancel();
      }
    });
    overlay.addEventListener('keydown', handleKeyDown);

    function cleanup() {
      overlay.classList.remove('active');
      document.body.classList.remove('body-modal-open');
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      overlay.removeEventListener('click', handleCancel); // Changed from handleCancel to the correct specific handler
      overlay.removeEventListener('keydown', handleKeyDown);

      setTimeout(() => {
         if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
          }
         if (triggeringElement && typeof triggeringElement.focus === 'function') {
            triggeringElement.focus();
          }
      }, 200); 
    }
  });
}

// Debounce function
export function debounce(func, wait) {
  let timeout;
  function debounced(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    debounced._timeoutId = timeout; 
  }
  debounced._timeoutId = null;
  return debounced;
}

// Format date to a relative time string
export function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const seconds = Math.round((now - date) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const weeks = Math.round(days / 7);
  const months = Math.round(days / 30.44);
  const years = Math.round(days / 365.25);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (weeks === 1) return '1 week ago';
  if (months < 1) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (years === 1) return '1 year ago';
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

// Format date to a simple HH:MM AM/PM string, with context
export function formatSimpleTime(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const inputDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeString = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (inputDateOnly.getTime() === today.getTime()) {
    return `at ${timeString}`;
  } else if (inputDateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday at ${timeString}`;
  } else {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2);
    return `on ${month}/${day}/${year} at ${timeString}`;
  }
}