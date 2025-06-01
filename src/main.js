


import { 
    loadNovels, saveNovels, sanitizeFilename, fileToDataURL, 
    showPrompt, showConfirm, debounce, formatRelativeTime, formatSimpleTime, 
    loadAppSettings, saveAppSettings, htmlToPlainText, triggerHapticFeedback 
} from './utils.js';

let novels = [];
let currentNovelId = null;
let currentChapterId = null;
let editorInstance = null;
let chapterSortable = null;
let hammerInstances = { app: null, editor: null, chapterList: null };
let isEditorDirty = false;
let lastSuccessfulSaveTimestamp = null;

// DOM Element IDs (centralized for easier maintenance)
const APP_ELEMENT_ID = 'app';
const PAGE_TITLE_ID = 'pageTitle';
const EXPORT_BTN_ID = 'exportBtn';
const MENU_BTN_ID = 'menuBtn';
const THEME_TOGGLE_BTN_ID = 'themeToggleBtn';
const THEME_ICON_SUN_ID = 'themeIconSun';
const THEME_ICON_MOON_ID = 'themeIconMoon';
const SETTINGS_BTN_ID = 'settingsBtn';
const CHAPTER_DRAWER_ID = 'chapterDrawer';
const CONTENT_AREA_ID = 'contentArea';
const NOVEL_TITLE_DISPLAY_ID = 'novelTitleDisplay';
const EDIT_NOVEL_TITLE_BTN_ID = 'editNovelTitleBtn';
const CHAPTER_LIST_ID = 'chapterList';
// const ADD_CHAPTER_BTN_ID = 'addChapterBtn'; // Old button ID, no longer used from drawer
const ADD_CHAPTER_FAB_ID = 'addChapterFab'; // New FAB ID
const EDITOR_CONTAINER_ID = 'editor';
const EDITOR_STATUS_BAR_ID = 'editorStatusBar';
const WORD_COUNT_DISPLAY_ID = 'wordCountDisplay';
const CHARACTER_COUNT_DISPLAY_ID = 'characterCountDisplay';
const CHARACTER_COUNT_WITH_SPACES_DISPLAY_ID = 'characterCountWithSpacesDisplay';
const BACK_TO_LIBRARY_BTN_ID = 'backToLibraryBtn';
const SAVE_STATUS_ID = 'saveStatus';
const LAST_SAVED_STATUS_ID = 'lastSavedStatus';
const ACTIVE_CHAPTER_TITLE_DISPLAY_ID = 'activeChapterTitleDisplay';
const NOVEL_SEARCH_INPUT_ID = 'novelSearchInput';
const NOVEL_SEARCH_CLEAR_BTN_ID = 'novelSearchClearBtn';
const CHAPTER_SEARCH_INPUT_ID = 'chapterSearchInput';
const CHAPTER_SEARCH_CLEAR_BTN_ID = 'chapterSearchClearBtn';


let saveStatusTimeout;
let appSettings = loadAppSettings(); // Initial load
let currentNovelSearchTerm = '';
let currentChapterSearchTerm = '';

// References to search input elements (initialized when views are rendered)
let novelSearchInputEl, novelSearchClearBtnEl;
let chapterSearchInputEl, chapterSearchClearBtnEl;


// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  appSettings = loadAppSettings(); // Load settings first
  applyTheme(appSettings.theme); // Apply theme immediately
  applyEditorScale(appSettings.editorScale); // Apply editor scale

  novels = loadNovels().map(novel => ({ // Load novels and ensure structure
    ...novel,
    id: novel.id || crypto.randomUUID(), // Ensure ID exists
    title: novel.title || "Untitled Novel",
    author: novel.author || '',
    createdAt: novel.createdAt || new Date(0).toISOString(),
    updatedAt: novel.updatedAt || novel.createdAt || new Date(0).toISOString(),
    language: novel.language || 'en-US',
    coverDataURL: novel.coverDataURL || null,
    chapters: novel.chapters ? novel.chapters.map((chapter, index) => ({
        ...chapter,
        id: chapter.id || crypto.randomUUID(),
        title: chapter.title || `Chapter ${index + 1}`,
        order: chapter.order !== undefined ? chapter.order : index + 1,
        contentHTML: chapter.contentHTML || '<p></p>',
        createdAt: chapter.createdAt || new Date(0).toISOString(),
        updatedAt: chapter.updatedAt || chapter.createdAt || new Date(0).toISOString(),
    })) : []
  })).sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()); // Sort novels by most recently updated


  const urlParams = new URLSearchParams(window.location.search);
  const novelIdFromUrl = urlParams.get('novelId');

  if (novelIdFromUrl && novels.some(n => n.id === novelIdFromUrl)) {
    currentNovelId = novelIdFromUrl;
    const chapterIdFromUrl = urlParams.get('chapterId');
    if (chapterIdFromUrl) {
        const novel = novels.find(n => n.id === currentNovelId);
        if (novel && novel.chapters.some(c => c.id === chapterIdFromUrl)) {
            currentChapterId = chapterIdFromUrl;
        }
    }
    renderEditorView();
  } else {
    renderLibraryView();
  }
  setupGlobalEventListeners();
  setupGestures();
});

function applyTheme(theme) {
    const htmlEl = document.documentElement;
    const sunIcon = document.getElementById(THEME_ICON_SUN_ID);
    const moonIcon = document.getElementById(THEME_ICON_MOON_ID);

    if (theme === 'light') {
        htmlEl.classList.remove('dark');
        sunIcon?.classList.remove('hidden');
        moonIcon?.classList.add('hidden');
    } else { // 'dark' or any other case defaults to dark
        htmlEl.classList.add('dark');
        sunIcon?.classList.add('hidden');
        moonIcon?.classList.remove('hidden');
    }
    appSettings.theme = theme; // Update current appSettings object
}

function applyEditorScale(scale) {
    const validScale = Math.min(2, Math.max(0.75, parseFloat(scale) || 1));
    document.documentElement.style.setProperty('--editor-font-scale', validScale);
    appSettings.editorScale = validScale; // Update global appSettings object
}


function toggleTheme() {
    triggerHapticFeedback([10]);
    const newTheme = appSettings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    saveAppSettings(appSettings); // Save all settings including the new theme
}


function updateURL(novelId, chapterId) {
    const url = new URL(window.location);
    if (novelId) {
        url.searchParams.set('novelId', novelId);
        if (chapterId) {
            url.searchParams.set('chapterId', chapterId);
        } else {
            url.searchParams.delete('chapterId');
        }
    } else {
        url.searchParams.delete('novelId');
        url.searchParams.delete('chapterId');
        // Clear save status when navigating away from editor to library
        updateSaveStatus('', 'clear');
        updateLastSavedDisplay(); // Will hide it
    }
    // Use replaceState if only chapterId changes within the same novel to avoid too much history
    // Or if navigating back to library (novelId is null)
    const action = (novelId === currentNovelId && chapterId) || !novelId ? 'replaceState' : 'pushState';
    window.history[action]({ novelId, chapterId }, '', url);
}

function updateLastSavedDisplay() {
    const lastSavedEl = document.getElementById(LAST_SAVED_STATUS_ID);
    if (!lastSavedEl) return;

    const shouldShow = lastSuccessfulSaveTimestamp && currentNovelId && currentChapterId;

    if (shouldShow) {
        lastSavedEl.textContent = `Last saved ${formatSimpleTime(lastSuccessfulSaveTimestamp)}`;
        lastSavedEl.classList.remove('hidden');
    } else {
        lastSavedEl.textContent = '';
        lastSavedEl.classList.add('hidden');
    }
}


function updateSaveStatus(message = "", type = 'info', autoClearDelay = 2500) {
    const statusEl = document.getElementById(SAVE_STATUS_ID);
    const lastSavedEl = document.getElementById(LAST_SAVED_STATUS_ID);
    if (!statusEl) return;

    clearTimeout(saveStatusTimeout);
    statusEl.textContent = message;
    
    statusEl.classList.remove('text-color-text-secondary', 'text-[var(--secondary)]', 'text-color-error', 'text-yellow-400', 'scale-100', 'scale-105', 'opacity-0', 'opacity-100');
    statusEl.setAttribute('aria-live', 'polite');


    if (message) {
        statusEl.classList.add('opacity-100');
        let isPersistent = false;

        switch (type) {
            case 'saving':
                statusEl.classList.add('text-color-text-secondary', 'scale-100');
                statusEl.setAttribute('aria-live', 'off'); // Less assertive for ongoing
                isPersistent = true;
                if(lastSavedEl) lastSavedEl.classList.add('hidden');
                break;
            case 'success':
                statusEl.classList.add('text-[var(--secondary)]', 'scale-105');
                statusEl.setAttribute('aria-live', 'assertive');
                if(lastSavedEl) updateLastSavedDisplay();
                break;
            case 'error':
                statusEl.classList.add('text-color-error', 'scale-100');
                statusEl.setAttribute('aria-live', 'assertive');
                if(lastSavedEl) updateLastSavedDisplay();
                break;
            case 'warning':
                statusEl.classList.add('text-yellow-400', 'scale-100');
                isPersistent = true; // Keep warning until next action
                if(lastSavedEl) updateLastSavedDisplay();
                break;
            case 'clear': // Explicitly clear
                 statusEl.classList.add('opacity-0');
                 statusEl.setAttribute('aria-live', 'off');
                 if(lastSavedEl) updateLastSavedDisplay(); // Show last saved if available
                 return; // Exit early for clear
            default: // info
                statusEl.classList.add('text-color-text-secondary', 'scale-100');
                if(lastSavedEl) updateLastSavedDisplay();
                break;
        }

        if (!isPersistent) {
            saveStatusTimeout = setTimeout(() => {
                statusEl.classList.remove('opacity-100', 'scale-105');
                statusEl.classList.add('opacity-0'); 
                statusEl.setAttribute('aria-live', 'off');
                if(lastSavedEl) updateLastSavedDisplay(); // Ensure last saved status is accurate after message clears
            }, autoClearDelay);
        }
    } else { // No message, ensure it's hidden
        statusEl.classList.add('opacity-0');
        statusEl.setAttribute('aria-live', 'off');
        if(lastSavedEl) updateLastSavedDisplay();
    }
}


function touchNovel(novelId) {
    const novel = novels.find(n => n.id === novelId);
    if (novel) {
        novel.updatedAt = new Date().toISOString();
    }
}

async function confirmDiscardChanges() {
    if (isEditorDirty) {
        const confirmed = await showConfirm({
            title: 'Unsaved Changes',
            message: 'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.',
            okText: 'Leave',
            cancelText: 'Stay'
        });
        return confirmed;
    }
    return true; // No unsaved changes, or user confirmed
}


function setupGlobalEventListeners() {
    document.getElementById(MENU_BTN_ID)?.addEventListener('click', toggleChapterDrawer);
    document.getElementById(THEME_TOGGLE_BTN_ID)?.addEventListener('click', toggleTheme);
    document.getElementById(EXPORT_BTN_ID)?.addEventListener('click', openExportModal);
    document.getElementById(BACK_TO_LIBRARY_BTN_ID)?.addEventListener('click', async () => {
        if (!(await confirmDiscardChanges())) return;
        await saveCurrentChapterData(); // Ensure data is saved if any last-minute change happened
        currentNovelId = null;
        currentChapterId = null;
        isEditorDirty = false;
        renderLibraryView();
    });

     window.addEventListener('resize', debounce(() => {
        if (currentNovelId && window.innerWidth >= 768) { // md breakpoint
            const currentAppSettings = loadAppSettings(); 
            if (currentAppSettings.autoOpenDrawerDesktop) {
                openChapterDrawer();
            }
        }
    }, 200));

    window.addEventListener('beforeunload', (event) => {
        if (currentNovelId && isEditorDirty) {
            // Standard way to trigger "unsaved changes" dialog in browser
            event.preventDefault(); 
            event.returnValue = ''; // For older browsers
        }
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', (event) => {
        const state = event.state;
        if (state && state.novelId) {
            if (currentNovelId !== state.novelId || currentChapterId !== state.chapterId) {
                // Potentially confirm discard changes if navigating away from a dirty editor state
                // For simplicity here, directly navigate. A more robust solution would check isEditorDirty.
                currentNovelId = state.novelId;
                currentChapterId = state.chapterId;
                renderEditorView();
            }
        } else if (!state && currentNovelId) { // Navigating back to a state without novelId (e.g. library)
             // similar check for isEditorDirty could be added
            currentNovelId = null;
            currentChapterId = null;
            renderLibraryView();
        }
    });
}

// -------------------- SETTINGS MODAL --------------------
function openSettingsModal() {
    triggerHapticFeedback([10]);
    const currentSettings = loadAppSettings(); // Load fresh settings
    const triggeringElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const overlay = document.createElement('div');
    overlay.id = 'settingsModalOverlay';
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'settingsModalTitle');
    document.body.appendChild(overlay);

    overlay.innerHTML = `
        <div class="modal">
            <h2 id="settingsModalTitle">Application Settings</h2>

            <div class="mb-4">
                <label for="settingDefaultAuthor" class="block text-sm font-medium text-color-onSurface mb-1">Default Author Name</label>
                <input type="text" id="settingDefaultAuthor" value="${currentSettings.defaultAuthor || ''}" placeholder="Your Pen Name" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface">
            </div>
            
            <div class="mb-4">
                <label for="settingEditorScale" class="block text-sm font-medium text-color-onSurface mb-1">Editor Font Scale (${currentSettings.editorScale.toFixed(2)}x)</label>
                <input type="range" id="settingEditorScale" min="0.75" max="2" step="0.05" value="${currentSettings.editorScale}" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700">
            </div>

            <div class="mb-6">
                <div class="flex items-center">
                    <input type="checkbox" id="settingAutoOpenDrawerDesktop" class="h-4 w-4 text-color-accent bg-gray-700 border-gray-600 rounded focus:ring-color-accent focus:ring-2 cursor-pointer" ${currentSettings.autoOpenDrawerDesktop ? 'checked' : ''}>
                    <label for="settingAutoOpenDrawerDesktop" class="ml-2 block text-sm text-color-onSurface select-none cursor-pointer">
                        Automatically open chapter drawer on desktop
                    </label>
                </div>
            </div>

            <div class="actions">
                <button id="settingsCancelBtn" class="btn btn-secondary">Cancel</button>
                <button id="settingsSaveBtn" class="btn btn-primary">Save Settings</button>
            </div>
        </div>
    `;

    document.body.classList.add('body-modal-open');
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    const modalElement = overlay.querySelector('.modal');
    const saveBtn = overlay.querySelector('#settingsSaveBtn');
    const cancelBtn = overlay.querySelector('#settingsCancelBtn');
    const defaultAuthorInput = overlay.querySelector('#settingDefaultAuthor');
    const autoOpenDrawerCheckbox = overlay.querySelector('#settingAutoOpenDrawerDesktop');
    const editorScaleInput = overlay.querySelector('#settingEditorScale');
    const editorScaleLabel = overlay.querySelector('label[for="settingEditorScale"]');

    editorScaleInput.addEventListener('input', () => {
        editorScaleLabel.textContent = `Editor Font Scale (${parseFloat(editorScaleInput.value).toFixed(2)}x)`;
    });

    defaultAuthorInput?.focus();
    defaultAuthorInput?.select();

    const focusableElements = Array.from(modalElement.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null);
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements[focusableElements.length - 1];

    const handleSaveSettings = () => {
        triggerHapticFeedback([20]);
        const newEditorScale = parseFloat(editorScaleInput.value);
        const newSettings = {
            ...appSettings, // Preserve existing settings like theme
            defaultAuthor: defaultAuthorInput.value.trim(),
            autoOpenDrawerDesktop: autoOpenDrawerCheckbox.checked,
            editorScale: newEditorScale,
        };
        saveAppSettings(newSettings);
        appSettings = newSettings; // Update global appSettings
        applyEditorScale(newSettings.editorScale); // Apply scale immediately
        updateSaveStatus("Settings saved ✓", 'success');
        cleanupSettingsModal();
    };

    const handleCancelSettings = () => {
        triggerHapticFeedback([10]);
        cleanupSettingsModal();
    };

     const handleKeyDown = (ev) => {
        if (ev.key === 'Enter' && ev.target === defaultAuthorInput) {
             ev.preventDefault();
             handleSaveSettings(); // Allow enter on input to save
        } else if (ev.key === 'Escape') {
            handleCancelSettings();
        } else if (ev.key === 'Tab') {
            if (ev.shiftKey) {
                if (document.activeElement === firstFocusableElement) {
                    ev.preventDefault();
                    lastFocusableElement?.focus();
                }
            } else {
                if (document.activeElement === lastFocusableElement) {
                    ev.preventDefault();
                    firstFocusableElement?.focus();
                }
            }
        }
    };

    saveBtn?.addEventListener('click', handleSaveSettings);
    cancelBtn?.addEventListener('click', handleCancelSettings);
    overlay.addEventListener('click', ev => {
        if (ev.target === overlay) handleCancelSettings();
    });
    overlay.addEventListener('keydown', handleKeyDown);

    function cleanupSettingsModal() {
        overlay.classList.remove('active');
        document.body.classList.remove('body-modal-open');
        saveBtn?.removeEventListener('click', handleSaveSettings);
        cancelBtn?.removeEventListener('click', handleCancelSettings);
        overlay.removeEventListener('click', handleCancelSettings);
        overlay.removeEventListener('keydown', handleKeyDown);
        editorScaleInput?.removeEventListener('input', editorScaleLabel);


        setTimeout(() => {
            if (document.body.contains(overlay)) {
                document.body.removeChild(overlay);
            }
            if (triggeringElement && typeof triggeringElement.focus === 'function') {
                triggeringElement.focus();
            }
        }, 200);
    }
}

// -------------------- RENDER LIBRARY VIEW --------------------

function setupNovelSearch() {
    novelSearchInputEl = document.getElementById(NOVEL_SEARCH_INPUT_ID);
    novelSearchClearBtnEl = document.getElementById(NOVEL_SEARCH_CLEAR_BTN_ID);

    if (novelSearchInputEl) {
        novelSearchInputEl.value = currentNovelSearchTerm; // Restore search term on render
        novelSearchInputEl.addEventListener('input', () => {
            currentNovelSearchTerm = novelSearchInputEl.value.trim().toLowerCase();
            if (novelSearchClearBtnEl) novelSearchClearBtnEl.classList.toggle('hidden', !currentNovelSearchTerm);
            renderLibraryView(); 
        });
        novelSearchInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                currentNovelSearchTerm = '';
                novelSearchInputEl.value = '';
                if (novelSearchClearBtnEl) novelSearchClearBtnEl.classList.add('hidden');
                renderLibraryView();
            }
        });
    }
    if (novelSearchClearBtnEl) {
        novelSearchClearBtnEl.classList.toggle('hidden', !currentNovelSearchTerm);
        novelSearchClearBtnEl.addEventListener('click', () => {
            currentNovelSearchTerm = '';
            if (novelSearchInputEl) novelSearchInputEl.value = '';
            novelSearchClearBtnEl.classList.add('hidden');
            renderLibraryView();
            novelSearchInputEl?.focus();
        });
    }
}


function renderLibraryView() {
  updateURL(null, null); // Clear novel/chapter from URL
  destroyEditorInstance();
  isEditorDirty = false;
  lastSuccessfulSaveTimestamp = null; // No "last saved" in library
  updateLastSavedDisplay(); // Will hide it

  document.getElementById(PAGE_TITLE_ID).innerText = 'My Novels';
  document.getElementById(EXPORT_BTN_ID)?.classList.add('hidden');
  
  const menuBtn = document.getElementById(MENU_BTN_ID);
  if (menuBtn) {
    menuBtn.classList.add('md:hidden', 'hidden'); // Hide on library view
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  
  document.getElementById(CHAPTER_DRAWER_ID)?.classList.remove('open', 'translate-x-0');
  document.getElementById(CHAPTER_DRAWER_ID)?.classList.add('md:hidden', '-translate-x-full');
  document.getElementById(BACK_TO_LIBRARY_BTN_ID)?.classList.add('hidden');
  document.getElementById(EDIT_NOVEL_TITLE_BTN_ID)?.classList.add('hidden');
  
  const settingsBtn = document.getElementById(SETTINGS_BTN_ID);
  if (settingsBtn) {
    settingsBtn.classList.remove('hidden');
    settingsBtn.onclick = openSettingsModal;
  }
  document.getElementById(THEME_TOGGLE_BTN_ID)?.classList.remove('hidden');

  const addChapterFab = document.getElementById(ADD_CHAPTER_FAB_ID);
  if (addChapterFab) {
    addChapterFab.classList.add('hidden');
    addChapterFab.onclick = null; // Remove handler
  }


  const contentArea = document.getElementById(CONTENT_AREA_ID);
  if (!contentArea) return;

  const novelSearchHTML = `
    <div class="relative w-full sm:max-w-xs">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg class="w-4 h-4 text-gray-500 dark:text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
        </div>
        <input type="text" id="${NOVEL_SEARCH_INPUT_ID}" placeholder="Search novels..." aria-label="Search through your novels" class="block w-full pl-10 pr-8 py-2.5 border border-color-border rounded-md bg-color-input-bg text-color-onSurface placeholder-color-text-secondary focus:ring-color-accent focus:border-color-accent sm:text-sm">
        <div class="absolute inset-y-0 right-0 pr-3 flex items-center">
            <button id="${NOVEL_SEARCH_CLEAR_BTN_ID}" class="text-gray-500 dark:text-gray-400 hover:text-color-onSurface hidden" aria-label="Clear novel search">
                 <svg class="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
    </div>`;

  const headerActionsHTML = `
    <button id="restoreNovelsBtn" title="Restore Novels from Backup" aria-label="Restore novels from backup" class="bg-gray-600 dark:bg-gray-700 text-white px-3 py-2.5 rounded-md hover:bg-gray-500 dark:hover:bg-gray-600 transition-opacity text-xs font-medium flex items-center gap-x-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.002 0A4.5 4.5 0 0117.25 18H6.75z" /> <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25A2.25 2.25 0 0017.25 12a2.25 2.25 0 00-2.25 2.25m4.5 0v6.75a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25v-6.75a2.25 2.25 0 012.25-2.25h10.5a2.25 2.25 0 012.25 2.25z" /></svg>Restore
    </button>
    <input type="file" id="restoreFileInput" class="hidden" accept=".json" aria-hidden="true">
    <button id="backupNovelsBtn" title="Backup All Novels" aria-label="Backup all novels" class="bg-gray-600 dark:bg-gray-700 text-white px-3 py-2.5 rounded-md hover:bg-gray-500 dark:hover:bg-gray-600 transition-opacity text-xs font-medium flex items-center gap-x-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.002 0A4.5 4.5 0 0117.25 15H6.75z" /></svg>Backup All
    </button>
    <button id="newNovelBtn" class="bg-color-accent text-white px-4 py-2.5 rounded-md hover:opacity-80 transition-opacity text-sm font-medium flex items-center justify-center gap-x-1.5 sm:gap-x-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>New Novel
    </button>`;


  const filteredNovels = novels.filter(novel => {
      if (!currentNovelSearchTerm) return true;
      return (novel.title && novel.title.toLowerCase().includes(currentNovelSearchTerm)) ||
             (novel.author && novel.author.toLowerCase().includes(currentNovelSearchTerm));
  });


  if (novels.length === 0) {
    contentArea.innerHTML = `
        <div class="max-w-3xl mx-auto py-6 sm:py-8 flex flex-col items-center justify-center text-center h-full px-4">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-20 h-20 text-gray-500 dark:text-gray-400 mb-6" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6-2.292m0 0V12m0-3.75V6.042M12 12a2.25 2.25 0 0 0-2.25 2.25M12 12a2.25 2.25 0 0 1 2.25 2.25M12 12V9.75M12 9.75A2.25 2.25 0 0 1 9.75 7.5M12 9.75A2.25 2.25 0 0 0 14.25 7.5M12 15v2.25A2.25 2.25 0 0 0 14.25 19.5M12 15v2.25A2.25 2.25 0 0 1 9.75 19.5" />
            </svg>
            <h2 class="text-2xl font-semibold text-color-onBackground mb-3">Your Bookshelf Awaits</h2>
            <p class="text-color-text-secondary mb-8 max-w-md">Ready to bring your stories to life? Every great novel starts with a single word. Let's begin yours.</p>
            <button id="createFirstNovelBtnInPlaceholder" class="bg-color-accent text-white px-6 py-3 rounded-md hover:opacity-80 transition-opacity text-base font-medium flex items-center justify-center gap-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>Create Your First Novel
            </button>
            <div class="mt-12 flex items-center gap-x-2">
                ${headerActionsHTML.replace(/<button id="newNovelBtn".*?<\/button>/, '')} <!-- Remove new novel button if it's already primary action -->
            </div>
        </div>
    `;
    const createFirstNovelBtn = document.getElementById('createFirstNovelBtnInPlaceholder');
    if (createFirstNovelBtn) {
        createFirstNovelBtn.onclick = handleNewNovelClick;
        createFirstNovelBtn.focus();
    }
  } else {
      contentArea.innerHTML = `
        <div class="max-w-3xl mx-auto py-6 sm:py-8">
          <div class="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4 px-4 sm:px-0">
            <div class="w-full sm:w-auto flex-shrink-0">${novelSearchHTML}</div>
            <div class="flex items-center gap-x-1.5 sm:gap-x-2 self-stretch sm:self-center justify-end flex-grow">
                ${headerActionsHTML}
            </div>
          </div>
          <ul id="novelList" class="space-y-3 px-4 sm:px-0" role="listbox" aria-label="Novels list">
          </ul>
        </div>
      `;
      const listEl = document.getElementById('novelList');
      if (!listEl) return;

      if (filteredNovels.length === 0 && currentNovelSearchTerm) {
        const noResultsLi = document.createElement('li');
        noResultsLi.className = 'text-center text-color-text-secondary py-8';
        noResultsLi.setAttribute('role', 'status');
        noResultsLi.innerHTML = `<p>No novels match "<strong>${currentNovelSearchTerm}</strong>".</p><p class="text-xs mt-1">Try a different search term or clear the search.</p>`;
        listEl.appendChild(noResultsLi);
      } else {
        // Sort by updatedAt descending before rendering
        filteredNovels.sort((a,b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()).forEach(novel => {
          const li = document.createElement('li');
          li.className = 'bg-color-surface p-4 rounded-lg shadow hover:shadow-md transition-shadow flex justify-between items-center cursor-pointer group';
          li.setAttribute('aria-label', `Open novel: ${novel.title || 'Untitled Novel'}`);
          li.setAttribute('role', 'option'); // Use 'option' within 'listbox'
          li.tabIndex = 0; // Make focusable for keyboard navigation

          const lastUpdatedTimestamp = novel.updatedAt || novel.createdAt;
          const relativeTime = formatRelativeTime(lastUpdatedTimestamp);
          const timePrefix = (lastUpdatedTimestamp === novel.createdAt && novel.updatedAt === novel.createdAt) || !novel.updatedAt ? 'Created' : 'Updated';

          const coverImageHTML = novel.coverDataURL
            ? `<img src="${novel.coverDataURL}" alt="Cover for ${novel.title || 'Untitled Novel'}" class="w-10 h-14 object-cover rounded-sm mr-3 flex-shrink-0">`
            : `<div class="w-10 h-14 bg-gray-200 dark:bg-gray-700 rounded-sm mr-3 flex items-center justify-center text-gray-400 dark:text-gray-500 flex-shrink-0" aria-hidden="true">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6-2.292m0 0A9.043 9.043 0 0 0 9 7.5a9.043 9.043 0 0 0-3 1.5m0 0c0 1.657 1.343 3 3 3s3-1.343 3-3m0 0c0-1.657-1.343-3-3-3s-3 1.343-3 3m0 0-2.08.69A8.966 8.966 0 0 0 3 13.5v2.25m18 0v-2.25c0-.871-.239-1.683-.666-2.411l-2.08-.69M12 15V6.042" /></svg>
               </div>`;

          li.innerHTML = `
            <div class="flex items-center min-w-0"> <!-- min-w-0 for truncate -->
                ${coverImageHTML}
                <div class="truncate">
                  <h3 class="font-semibold text-color-onSurface text-lg truncate pointer-events-none">${novel.title || 'Untitled Novel'}</h3>
                  <p class="text-xs text-color-text-secondary pointer-events-none">Chapters: ${novel.chapters.length} | ${timePrefix}: ${relativeTime || new Date(lastUpdatedTimestamp).toLocaleDateString()}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0 ml-2">
                <button data-action="open" aria-label="Open novel ${novel.title || 'Untitled Novel'}" class="text-sm bg-color-accent/80 text-white px-3 py-1.5 rounded group-hover:bg-color-accent group-focus-within:bg-color-accent transition-colors">Open</button>
                <button data-action="delete" title="Delete Novel" aria-label="Delete novel ${novel.title || 'Untitled Novel'}" class="text-color-error p-1.5 rounded-full hover:bg-color-error/20 group-focus-within:bg-color-error/20 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 pointer-events-none" aria-hidden="true"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75H4.5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 0-1.5H14A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.531.096 2.182.275a.75.75 0 0 0 .541-.941A4.527 4.527 0 0 0 10 3c-.84 0-1.531.096-2.182.275a.75.75 0 0 0 .541.941A4.527 4.527 0 0 0 10 4ZM4.5 6.5A.75.75 0 0 0 3.75 7.25v7.5A2.75 2.75 0 0 0 6.5 17.5h7a2.75 2.75 0 0 0 2.75-2.75v-7.5A.75.75 0 0 0 15.5 6.5h-11Z" clip-rule="evenodd" /></svg>
                </button>
            </div>
          `;
          const openNovelAction = async () => {
            triggerHapticFeedback([10]);
            currentNovelId = novel.id;
            renderEditorView();
          };

          li.querySelector('button[data-action="open"]')?.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent li click from also firing
            openNovelAction();
          });
          li.querySelector('button[data-action="delete"]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const deleteMessage = novel.chapters.length > 0 ?
              `Are you sure you want to permanently delete the novel "${novel.title || 'Untitled Novel'}" and its ${novel.chapters.length} chapter(s)? This action cannot be undone.` :
              `Are you sure you want to permanently delete the novel "${novel.title || 'Untitled Novel'}"? This action cannot be undone.`;

            const confirmed = await showConfirm({
                title: 'Delete Novel',
                message: deleteMessage,
                okText: 'Delete',
                cancelText: 'Cancel'
            });
            if (confirmed) {
                triggerHapticFeedback([40]);
                novels = novels.filter(n => n.id !== novel.id);
                saveNovels(novels);
                renderLibraryView(); 
            }
          });
          li.addEventListener('click', openNovelAction);
          li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openNovelAction();
            }
          });
          listEl.appendChild(li);
        });
      }

      // Keyboard navigation for novel list
      if (listEl.children.length > 0 && !listEl.dataset.keyboardNavAttached && filteredNovels.length > 0) {
          listEl.dataset.keyboardNavAttached = 'true'; 
          listEl.addEventListener('keydown', (e) => { 
              const items = Array.from(listEl.querySelectorAll('li[tabindex="0"]'));
              if (!items.length) return;
              let currentIndex = items.findIndex(item => item === document.activeElement);
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                  e.preventDefault();
                  if (currentIndex === -1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                      items[0].focus(); return;
                  }
                  if (e.key === 'ArrowDown') currentIndex = (currentIndex + 1) % items.length;
                  else if (e.key === 'ArrowUp') currentIndex = (currentIndex - 1 + items.length) % items.length;
                  else if (e.key === 'Home') currentIndex = 0;
                  else if (e.key === 'End') currentIndex = items.length - 1;
                  items[currentIndex]?.focus();
              }
          });
      } else if (listEl.children.length === 0 || filteredNovels.length === 0) {
           delete listEl.dataset.keyboardNavAttached;
      }
      document.getElementById('newNovelBtn')?.addEventListener('click', handleNewNovelClick);
  }

  // Backup and Restore Buttons
  const backupBtn = document.getElementById('backupNovelsBtn');
  const restoreBtn = document.getElementById('restoreNovelsBtn');
  const restoreFileInput = document.getElementById('restoreFileInput');

  if(backupBtn) { 
    backupBtn.addEventListener('click', () => {
        triggerHapticFeedback([20]);
        if (novels.length === 0) {
            updateSaveStatus("No novels to backup.", "info", 3000);
            return;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `novels_backup_${timestamp}.json`;
        const dataStr = JSON.stringify(novels, null, 2); // Pretty print JSON
        const blob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateSaveStatus("All novels backed up!", "success");
        triggerHapticFeedback([40]);
    });
  }

  if(restoreBtn && restoreFileInput) { 
    restoreBtn.addEventListener('click', () => {
        triggerHapticFeedback([20]);
        restoreFileInput.click()
    });
    restoreFileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const fileContent = await file.text();
        try {
            const importedData = JSON.parse(fileContent);
            if (!Array.isArray(importedData) || !importedData.every(n => n && typeof n.id === 'string' && typeof n.title === 'string' && Array.isArray(n.chapters) && n.chapters.every(c => c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.order === 'number' && typeof c.contentHTML === 'string'))) {
                updateSaveStatus("Restore failed: Invalid backup file format.", 'error', 4000);
                restoreFileInput.value = ''; 
                return;
            }
            const confirmed = await showConfirm({
                title: "Restore Novels",
                message: `Restoring from "${file.name}" will overwrite all current novels and their chapters. This action cannot be undone. Are you sure?`,
                okText: "Restore",
                cancelText: "Cancel"
            });
            if (confirmed) {
                triggerHapticFeedback([40]);
                // Ensure all necessary fields, add defaults, and re-validate IDs
                novels = importedData.map(novel => ({ 
                    ...novel,
                    id: novel.id || crypto.randomUUID(),
                    title: novel.title || "Untitled Novel",
                    author: novel.author || '',
                    language: novel.language || 'en-US',
                    coverDataURL: novel.coverDataURL || null,
                    createdAt: novel.createdAt || new Date(0).toISOString(),
                    updatedAt: novel.updatedAt || novel.createdAt || new Date(0).toISOString(),
                    chapters: (novel.chapters || []).map((chapter, index) => ({
                        ...chapter,
                        id: chapter.id || crypto.randomUUID(),
                        title: chapter.title || `Chapter ${index + 1}`,
                        order: chapter.order !== undefined ? chapter.order : index + 1,
                        contentHTML: chapter.contentHTML || '<p></p>',
                        createdAt: chapter.createdAt || new Date(0).toISOString(),
                        updatedAt: chapter.updatedAt || chapter.createdAt || new Date(0).toISOString(),
                    }))
                }));
                saveNovels(novels);
                currentNovelSearchTerm = ''; 
                renderLibraryView();
                updateSaveStatus("Novels restored successfully!", "success");
            }
        } catch (e) {
            console.error("Restore error:", e, e.stack);
            updateSaveStatus("Restore failed: Could not parse backup file.", 'error', 4000);
        }
        restoreFileInput.value = ''; 
    });
  }
  setupNovelSearch(); 

  // Focus logic for library view
  if (filteredNovels.length > 0) {
    const firstLibraryItem = document.querySelector('#novelList li[tabindex="0"]');
    if (firstLibraryItem && (!document.activeElement || document.activeElement === document.body || document.activeElement === contentArea)) {
      firstLibraryItem.focus();
    }
  } else if (novels.length === 0) { 
    const createFirstBtn = document.getElementById('createFirstNovelBtnInPlaceholder');
    if (createFirstBtn && (!document.activeElement || document.activeElement === document.body)) {
      createFirstBtn.focus();
    }
  } else if (currentNovelSearchTerm && filteredNovels.length === 0) { 
    if (novelSearchInputEl && (!document.activeElement || document.activeElement === document.body)) {
      novelSearchInputEl.focus();
    }
  }
}


async function handleNewNovelClick() {
    const title = await showPrompt({ title: 'New Novel Title', placeholder: 'Enter novel title…' });
    if (title === null) return; // User cancelled
    triggerHapticFeedback([40]);
    const currentSettings = loadAppSettings(); 
    const now = new Date().toISOString();
    const newNovel = {
      id: crypto.randomUUID(),
      title: title || "Untitled Novel",
      author: currentSettings.defaultAuthor || '',
      createdAt: now,
      updatedAt: now,
      coverDataURL: null,
      language: 'en-US', 
      chapters: []
    };
    novels.unshift(newNovel); // Add to the beginning of the array for immediate visibility if sorted by update
    saveNovels(novels);
    currentNovelId = newNovel.id;
    renderEditorView(); // Switch to editor for the new novel
}

// -------------------- RENDER EDITOR VIEW --------------------

function setupChapterSearch(novel) {
    chapterSearchInputEl = document.getElementById(CHAPTER_SEARCH_INPUT_ID);
    chapterSearchClearBtnEl = document.getElementById(CHAPTER_SEARCH_CLEAR_BTN_ID);

    if (chapterSearchInputEl) {
        chapterSearchInputEl.value = currentChapterSearchTerm;
        chapterSearchInputEl.addEventListener('input', () => {
            currentChapterSearchTerm = chapterSearchInputEl.value.trim().toLowerCase();
            if(chapterSearchClearBtnEl) chapterSearchClearBtnEl.classList.toggle('hidden', !currentChapterSearchTerm);
            renderChapterList(novel); 
        });
         chapterSearchInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                currentChapterSearchTerm = '';
                chapterSearchInputEl.value = '';
                if (chapterSearchClearBtnEl) chapterSearchClearBtnEl.classList.add('hidden');
                renderChapterList(novel);
            }
        });
    }
    if (chapterSearchClearBtnEl) {
        chapterSearchClearBtnEl.classList.toggle('hidden', !currentChapterSearchTerm);
        chapterSearchClearBtnEl.addEventListener('click', () => {
            currentChapterSearchTerm = '';
            if(chapterSearchInputEl) chapterSearchInputEl.value = '';
            chapterSearchClearBtnEl.classList.add('hidden');
            renderChapterList(novel);
            chapterSearchInputEl?.focus();
        });
    }
}

async function renderEditorView() {
  const novel = novels.find(n => n.id === currentNovelId);
  if (!novel) {
      console.warn("Novel not found for editor view, redirecting to library.");
      return renderLibraryView();
  }

  appSettings = loadAppSettings(); 
  currentNovelSearchTerm = ''; 
  if (novelSearchInputEl) novelSearchInputEl.value = '';
  if (novelSearchClearBtnEl) novelSearchClearBtnEl.classList.add('hidden');


  updateURL(novel.id, currentChapterId);
  isEditorDirty = false; 

  document.getElementById(PAGE_TITLE_ID).innerText = novel.title || 'Untitled Novel';
  document.getElementById(EXPORT_BTN_ID)?.classList.remove('hidden');
  const menuBtn = document.getElementById(MENU_BTN_ID);
  menuBtn?.classList.remove('hidden', 'md:hidden'); 
  document.getElementById(CHAPTER_DRAWER_ID)?.classList.remove('md:hidden'); 
  document.getElementById(BACK_TO_LIBRARY_BTN_ID)?.classList.remove('hidden');
  document.getElementById(EDIT_NOVEL_TITLE_BTN_ID)?.classList.remove('hidden');
  document.getElementById(SETTINGS_BTN_ID)?.classList.add('hidden'); 
  document.getElementById(THEME_TOGGLE_BTN_ID)?.classList.remove('hidden'); 

  const addChapterFab = document.getElementById(ADD_CHAPTER_FAB_ID);
  if (addChapterFab) {
    addChapterFab.classList.remove('hidden');
    addChapterFab.onclick = handleNewChapterFabClick; // Attach new chapter logic
  }


  if (window.innerWidth >= 768 && appSettings.autoOpenDrawerDesktop) { // md breakpoint
    openChapterDrawer();
  } else {
    closeChapterDrawer(); 
  }

  renderChapterList(novel); 

  const contentArea = document.getElementById(CONTENT_AREA_ID);
  if (!contentArea) return;
  contentArea.innerHTML = `
    <h3 id="${ACTIVE_CHAPTER_TITLE_DISPLAY_ID}" class="text-lg font-semibold mb-3 text-color-onSurface truncate px-1" aria-live="polite"></h3>
    <div class="flex flex-col h-[calc(100%-2.5rem)]"> 
      <div id="${EDITOR_CONTAINER_ID}" class="outline-none flex-grow min-h-0" tabindex="-1" role="document" aria-label="Chapter content editor"></div>
      <div id="${EDITOR_STATUS_BAR_ID}" class="flex-shrink-0 p-2 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)] flex justify-end items-center gap-x-3" role="status" aria-live="polite">
        <span id="${CHARACTER_COUNT_DISPLAY_ID}">Chars: 0</span>
        <span class="text-gray-600 dark:text-gray-400" aria-hidden="true">|</span>
        <span id="${CHARACTER_COUNT_WITH_SPACES_DISPLAY_ID}">Chars (incl. spaces): 0</span>
        <span class="text-gray-600 dark:text-gray-400" aria-hidden="true">|</span>
        <span id="${WORD_COUNT_DISPLAY_ID}">Words: 0</span>
      </div>
    </div>
  `;
  applyEditorScale(appSettings.editorScale); // Ensure editor scale is applied when editor view renders


  if (!novel.chapters.length) {
    currentChapterId = null; 
    clearEditorPlaceholder();
  } else {
    let chapterToLoad;
    const sortedChapters = novel.chapters.slice().sort((a,b) => a.order - b.order);
    if (currentChapterId && sortedChapters.some(c => c.id === currentChapterId)) {
      chapterToLoad = sortedChapters.find(c => c.id === currentChapterId);
    } else { 
      chapterToLoad = sortedChapters[0];
      currentChapterId = chapterToLoad.id;
      updateURL(novel.id, currentChapterId); 
    }
    await loadChapterIntoEditor(chapterToLoad);
  }
}

async function handleNewChapterFabClick() {
    const novel = novels.find(n => n.id === currentNovelId);
    if (!novel) return;

    const chapterToSaveIdBeforeSwitch = currentChapterId;
    const editorContentBeforeSwitch = editorInstance ? editorInstance.getData() : null;

    if (isEditorDirty && chapterToSaveIdBeforeSwitch && editorContentBeforeSwitch !== null) {
        const novelToUpdate = novels.find(n => n.id === currentNovelId); // currentNovelId is still old here
        if (novelToUpdate) {
            const chapterObjectToUpdate = novelToUpdate.chapters.find(c => c.id === chapterToSaveIdBeforeSwitch);
            if (chapterObjectToUpdate) {
                chapterObjectToUpdate.contentHTML = editorContentBeforeSwitch;
                chapterObjectToUpdate.updatedAt = new Date().toISOString();
                touchNovel(novelToUpdate.id);
                saveNovels(novels);
                isEditorDirty = false; // Reset for the chapter just saved
                updateSaveStatus("Previous chapter saved", "success", 1000);
                lastSuccessfulSaveTimestamp = new Date(chapterObjectToUpdate.updatedAt);
                updateLastSavedDisplay();
            } else {
                console.error("BugFix: Failed to find chapter object to save:", chapterToSaveIdBeforeSwitch);
                // Potentially show error to user or handle more gracefully
            }
        } else {
            console.error("BugFix: Failed to find novel object for saving chapter:", currentNovelId);
        }
    }


    const nextOrder = novel.chapters.length + 1;
    const title = await showPrompt({
        title: `New Chapter Title`,
        placeholder: `Chapter ${nextOrder}`
    });
    if (title === null) return; // User cancelled prompt
    triggerHapticFeedback([40]);

    const now = new Date().toISOString();
    const newChapter = {
        id: crypto.randomUUID(),
        title: title.trim() || `Chapter ${nextOrder}`, // Default title if prompt is empty
        order: nextOrder,
        contentHTML: '<p></p>', // Start with empty paragraph
        createdAt: now,
        updatedAt: now,
    };
    novel.chapters.push(newChapter);
    touchNovel(novel.id); // Update novel's timestamp
    saveNovels(novels);
    updateSaveStatus("Chapter created", "success", 1500);

    currentChapterId = newChapter.id; // Switch to new chapter
    updateURL(novel.id, currentChapterId);

    renderChapterList(novel); // Re-render list to show new chapter & update active state
    await loadChapterIntoEditor(newChapter); // Load new chapter into editor
    
    closeChapterDrawerOnMobile(); // Close drawer if open on mobile after adding
    
    const chapterListEl = document.getElementById(CHAPTER_LIST_ID);
    const newChapterLi = chapterListEl?.querySelector(`li[data-chapter-id="${newChapter.id}"]`);
    newChapterLi?.focus(); // Focus the new chapter in the list
}


// -------------------- RENDER CHAPTER LIST --------------------
function renderChapterList(novel) {
  const novelTitleDisplay = document.getElementById(NOVEL_TITLE_DISPLAY_ID);
  if (novelTitleDisplay) novelTitleDisplay.innerText = novel.title || 'Untitled Novel';

  const editNovelTitleBtn = document.getElementById(EDIT_NOVEL_TITLE_BTN_ID);
  if (editNovelTitleBtn) {
    editNovelTitleBtn.onclick = async () => {
        const newTitle = await showPrompt({
            title: 'Edit Novel Title',
            initialValue: novel.title,
            placeholder: 'Enter novel title...'
        });
        if (newTitle !== null && newTitle.trim() !== novel.title) {
            novel.title = newTitle.trim() || 'Untitled Novel';
            touchNovel(novel.id);
            saveNovels(novels);
            updateSaveStatus("Novel title updated", "success");
            triggerHapticFeedback([20]);
            if (document.getElementById(PAGE_TITLE_ID)) {
                document.getElementById(PAGE_TITLE_ID).innerText = novel.title; 
            }
            if (novelTitleDisplay) novelTitleDisplay.innerText = novel.title; 
        }
    };
  }


  const listEl = document.getElementById(CHAPTER_LIST_ID);
  if (!listEl) return;
  listEl.innerHTML = ''; 
  delete listEl.dataset.keyboardNavAttached; 

  // Sort chapters by order before filtering for search
  const sortedNovelChapters = novel.chapters.slice().sort((a, b) => a.order - b.order);

  const chaptersToDisplay = sortedNovelChapters.filter(ch => {
      if (!currentChapterSearchTerm) return true;
      return ch.title.toLowerCase().includes(currentChapterSearchTerm);
  });


  if (novel.chapters.length === 0) {
    const emptyStateDiv = document.createElement('div');
    emptyStateDiv.className = 'flex flex-col items-center justify-center text-center p-6 h-full text-color-text-secondary';
    emptyStateDiv.setAttribute('role', 'status');
    emptyStateDiv.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 text-gray-500 dark:text-gray-400 mb-3" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m9.75 0A2.25 2.25 0 0 0 19.5 2.25m0 0A2.25 2.25 0 0 0 21.75 0M4.5 6.375A2.25 2.25 0 0 1 2.25 4.5m0 0A2.25 2.25 0 0 1 0 2.25m5.625 17.25a2.25 2.25 0 0 1-2.25-2.25V6.375c0-.621.504-1.125 1.125-1.125h12.75c.621 0 1.125.504 1.125 1.125V19.5a2.25 2.25 0 0 1-2.25-2.25M10.5 18.75h3" />
        </svg>
        <p class="text-base font-medium text-color-onSurface mb-1">No Chapters Here</p>
        <p class="text-xs">Use the floating '+' button to add your first one.</p>
    `;
    listEl.appendChild(emptyStateDiv);
    if (chapterSortable) { 
        chapterSortable.destroy();
        chapterSortable = null;
    }
  } else if (chaptersToDisplay.length === 0 && currentChapterSearchTerm) {
    const noResultsLi = document.createElement('li');
    noResultsLi.className = 'text-center text-color-text-secondary py-8 px-2';
    noResultsLi.setAttribute('role', 'status');
    noResultsLi.innerHTML = `<p>No chapters match "<strong>${currentChapterSearchTerm}</strong>".</p><p class="text-xs mt-1">Try a different search term or clear the search.</p>`;
    listEl.appendChild(noResultsLi);
    if (chapterSortable) { 
        chapterSortable.destroy();
        chapterSortable = null;
    }
  } else {
    let activeLi = null; 
    chaptersToDisplay.forEach(ch => {
      const li = document.createElement('li');
      li.dataset.chapterId = ch.id;
      li.className = `flex justify-between items-center p-2.5 rounded-md cursor-pointer group hover:bg-color-accent/10`;
      li.setAttribute('role', 'option'); 
      li.tabIndex = -1; // Initially not focusable, will be made 0 by keyboard nav logic
      li.setAttribute('aria-label', `Chapter ${ch.order}: ${ch.title || 'Untitled Chapter'}`);
      if (ch.id === currentChapterId) li.setAttribute('aria-selected', 'true');


      li.innerHTML = `
        <span class="chapter-title truncate flex-1 text-sm flex items-center">
            <svg viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="drag-handle-icon w-4 h-4 mr-2 text-gray-500 dark:text-gray-400 group-hover:text-color-accent group-[.active-chapter]:text-color-accent transition-colors flex-shrink-0" aria-hidden="true">
                <title>Drag to reorder chapter</title>
                <circle cx="2" cy="2" r="1.5"/> <circle cx="8" cy="2" r="1.5"/>
                <circle cx="2" cy="8" r="1.5"/> <circle cx="8" cy="8" r="1.5"/>
                <circle cx="2" cy="14" r="1.5"/> <circle cx="8" cy="14" r="1.5"/>
            </svg>
            ${ch.order}. ${ch.title || 'Untitled Chapter'}
        </span>
        <button data-action="delete" title="Delete Chapter" aria-label="Delete chapter ${ch.order}. ${ch.title || 'Untitled Chapter'}" class="delete-chapter-btn p-1 rounded-full hover:bg-color-error/20 group-focus-within:bg-color-error/20 opacity-60 hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 pointer-events-none text-color-error" aria-hidden="true">
            <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75H4.5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 0-1.5H14A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.531.096 2.182.275a.75.75 0 0 0 .541-.941A4.527 4.527 0 0 0 10 3c-.84 0-1.531.096-2.182.275a.75.75 0 0 0 .541.941A4.527 4.527 0 0 0 10 4ZM4.5 6.5A.75.75 0 0 0 3.75 7.25v7.5A2.75 2.75 0 0 0 6.5 17.5h7a2.75 2.75 0 0 0 2.75-2.75v-7.5A.75.75 0 0 0 15.5 6.5h-11Z" clip-rule="evenodd" />
          </svg>
        </button>
      `;
      listEl.appendChild(li);

      if (ch.id === currentChapterId) {
        activeLi = li; 
        li.classList.add('active-chapter', 'bg-color-accent/15'); 
        li.tabIndex = 0; // Make active chapter focusable
      }

      const loadThisChapter = async () => {
        if (!(await confirmDiscardChanges())) return;
        if (currentChapterId !== ch.id) { 
          triggerHapticFeedback([10]);
          await saveCurrentChapterData(); 
          currentChapterId = ch.id;
          updateURL(novel.id, ch.id);
          await loadChapterIntoEditor(ch); 
          listEl.querySelectorAll('li.active-chapter').forEach(item => {
              item.classList.remove('active-chapter', 'bg-color-accent/15');
              item.setAttribute('aria-selected', 'false');
              item.tabIndex = -1; // Make previously active item not focusable directly
          });
          li.classList.add('active-chapter', 'bg-color-accent/15');
          li.setAttribute('aria-selected', 'true');
          li.tabIndex = 0; // Make new active item focusable
          li.focus(); // Focus the newly selected chapter
        }
        closeChapterDrawerOnMobile();
      };

      li.addEventListener('click', (event) => {
        if (event.target.closest('button[data-action="delete"]')) return;
        loadThisChapter();
      });
      li.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === li) {
            e.preventDefault();
            loadThisChapter();
        }
      });


      li.querySelector('[data-action="delete"]')?.addEventListener('click', async ev => {
        ev.stopPropagation(); 
        const confirmed = await showConfirm({
          title: 'Delete Chapter',
          message: `Are you sure you want to delete chapter “${ch.title || 'Untitled Chapter'}”? This cannot be undone.`,
          okText: 'Delete',
          cancelText: 'Cancel'
        });
        if (!confirmed) return;
        triggerHapticFeedback([40]);
        const chapterWasActive = currentChapterId === ch.id;
        if(chapterWasActive) isEditorDirty = false; 

        novel.chapters = novel.chapters.filter(c => c.id !== ch.id);
        renumberChapters(novel.chapters);
        touchNovel(novel.id);
        saveNovels(novels);
        updateSaveStatus("Chapter deleted", 'success', 1500);
        renderChapterList(novel); // Re-render
        handlePostChapterDeletionFocus(); 

        if (chapterWasActive) { 
          currentChapterId = novel.chapters.sort((a,b) => a.order - b.order)[0]?.id || null; 
          updateURL(novel.id, currentChapterId);
          if (currentChapterId) {
            await loadChapterIntoEditor(novel.chapters.find(c => c.id === currentChapterId));
          } else {
            clearEditorPlaceholder(); 
          }
        }
      });
    });

    if (activeLi && typeof activeLi.scrollIntoView === 'function') {
        requestAnimationFrame(() => activeLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }

    // Keyboard navigation for chapter list items
    if (listEl.children.length > 0 && !listEl.dataset.keyboardNavAttached) {
        listEl.dataset.keyboardNavAttached = 'true';
        listEl.addEventListener('keydown', (e) => {
            const items = Array.from(listEl.querySelectorAll('li[role="option"]')); // Select by role
            if (!items.length) return;
            
            let currentFocusedIndex = items.findIndex(item => item === document.activeElement || item.tabIndex === 0);
            if (currentFocusedIndex === -1) currentFocusedIndex = 0; // Default to first if none focused

            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                items.forEach(item => item.tabIndex = -1); // Make all non-focusable initially

                if (e.key === 'ArrowDown') currentFocusedIndex = (currentFocusedIndex + 1) % items.length;
                else if (e.key === 'ArrowUp') currentFocusedIndex = (currentFocusedIndex - 1 + items.length) % items.length;
                else if (e.key === 'Home') currentFocusedIndex = 0;
                else if (e.key === 'End') currentFocusedIndex = items.length - 1;
                
                if (items[currentFocusedIndex]) {
                    items[currentFocusedIndex].tabIndex = 0; // Make target focusable
                    items[currentFocusedIndex].focus();
                }
            }
        });
        // Ensure at least one item is focusable if list is not empty
        const firstFocusableItem = listEl.querySelector('li[role="option"]:not([tabindex="0"])');
        if (firstFocusableItem && !listEl.querySelector('li[tabindex="0"]')) { // if no item has tabindex 0 yet
             if (!activeLi) firstFocusableItem.tabIndex = 0; // if no chapter is active, make first item focusable
        }
    }


    if (chapterSortable) chapterSortable.destroy();
    if (chaptersToDisplay.length > 0 && !currentChapterSearchTerm) { // Only init sortable if not searching and items exist
        chapterSortable = Sortable.create(listEl, {
          animation: 150,
          ghostClass: 'sortable-ghost', 
          chosenClass: 'sortable-chosen',
          dragClass: 'sortable-drag',
          handle: '.chapter-title', 
          onEnd: evt => {
            triggerHapticFeedback([20,30,20]);
            const { oldDraggableIndex, newDraggableIndex } = evt;

            const movedChapter = novel.chapters.splice(oldDraggableIndex, 1)[0];
            novel.chapters.splice(newDraggableIndex, 0, movedChapter);
            
            renumberChapters(novel.chapters); 
            touchNovel(novel.id);
            saveNovels(novels);
            updateSaveStatus("Order saved", 'success', 1500);
            listEl.classList.add('list-reordered-flash');
            setTimeout(() => {
                listEl.classList.remove('list-reordered-flash');
                renderChapterList(novel); 
                // Re-focus the moved item
                const movedLi = listEl.querySelector(`li[data-chapter-id="${movedChapter.id}"]`);
                movedLi?.focus();
            }, 700); 
          }
        });
    } else if (chapterSortable) { // Destroy if searching or no items
        chapterSortable.destroy();
        chapterSortable = null;
    }
  }

  // The old addChapterBtn logic is removed as the button is now a FAB handled in renderEditorView
   setupChapterListGestures(); 
   setupChapterSearch(novel); 
}

function renumberChapters(chapters) {
  chapters.sort((a,b) => a.order - b.order).forEach((ch, index) => {
    ch.order = index + 1;
  });
}

// -------------------- OPEN/CLOSE DRAWER --------------------
function openChapterDrawer() {
  const drawer = document.getElementById(CHAPTER_DRAWER_ID);
  const menuBtn = document.getElementById(MENU_BTN_ID);
  if (!drawer || !menuBtn) return;

  drawer.classList.add('open', 'translate-x-0');
  drawer.classList.remove('-translate-x-full');
  menuBtn.setAttribute('aria-expanded', 'true');

  setTimeout(() => { 
    const chapterSearchInput = document.getElementById(CHAPTER_SEARCH_INPUT_ID);
    const firstChapterItem = drawer.querySelector(`#${CHAPTER_LIST_ID} li[tabindex="0"], #${CHAPTER_LIST_ID} li[role="option"]`); // Prefer explicitly focusable or first option
    // const addChapterBtn = document.getElementById(ADD_CHAPTER_BTN_ID); // Old button, not relevant for focus here
    const editNovelTitleBtn = document.getElementById(EDIT_NOVEL_TITLE_BTN_ID);
    const backToLibraryBtn = document.getElementById(BACK_TO_LIBRARY_BTN_ID);

    if (chapterSearchInput && chapterSearchInput.offsetParent !== null) { 
        chapterSearchInput.focus();
    } else if (firstChapterItem) { 
        firstChapterItem.focus();
    } else if (editNovelTitleBtn && editNovelTitleBtn.offsetParent !== null) { // Focus edit title if no chapters & no search
      editNovelTitleBtn.focus();
    } else if (backToLibraryBtn && backToLibraryBtn.offsetParent !== null) {
      backToLibraryBtn.focus();
    }
  }, 100); 
}

function closeChapterDrawer() {
  const drawer = document.getElementById(CHAPTER_DRAWER_ID);
  const menuBtn = document.getElementById(MENU_BTN_ID);
  if (!drawer || !menuBtn) return;

  const originallyFocusedElement = document.activeElement; 

  drawer.classList.remove('open', 'translate-x-0');
  drawer.classList.add('-translate-x-full');
  menuBtn.setAttribute('aria-expanded', 'false');

  if (menuBtn && menuBtn.offsetParent !== null) { 
    if (drawer.contains(originallyFocusedElement) || originallyFocusedElement === drawer || originallyFocusedElement === menuBtn) {
        menuBtn.focus();
    }
  }
}

function toggleChapterDrawer() {
    triggerHapticFeedback([10]);
    const drawer = document.getElementById(CHAPTER_DRAWER_ID);
    if (!drawer) return;
    if (drawer.classList.contains('translate-x-0') || drawer.classList.contains('open')) {
        closeChapterDrawer();
    } else {
        openChapterDrawer();
    }
}

function closeChapterDrawerOnMobile() {
  if (window.innerWidth < 768) { // md breakpoint
    closeChapterDrawer();
  }
}

// -------------------- CKEDITOR: LOAD & SAVE --------------------
function calculateWordCount(htmlString) {
  if (!htmlString) return 0;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString; // Let browser parse HTML to text
  const text = tempDiv.textContent || tempDiv.innerText || "";
  // Regex for words: sequence of alphanumeric chars, possibly with hyphens/apostrophes in between
  const words = text.match(/\b[a-zA-Z0-9'-]+\b/g); 
  return words ? words.length : 0;
}

function calculateCharacterCount(htmlString, excludeSpaces = true) {
    if (!htmlString) return 0;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    let text = tempDiv.textContent || tempDiv.innerText || "";
    if (excludeSpaces) {
        text = text.replace(/\s+/g, ''); // Replace all whitespace (spaces, tabs, newlines)
    }
    return text.length;
}

const debouncedUpdateEditorStats = debounce(() => {
  if (editorInstance) {
    const htmlContent = editorInstance.getData();
    
    const wordCount = calculateWordCount(htmlContent);
    const wordCountEl = document.getElementById(WORD_COUNT_DISPLAY_ID);
    if (wordCountEl) wordCountEl.textContent = `Words: ${wordCount}`;

    const charCount = calculateCharacterCount(htmlContent, true); // Exclude spaces
    const charCountEl = document.getElementById(CHARACTER_COUNT_DISPLAY_ID);
    if (charCountEl) charCountEl.textContent = `Chars: ${charCount}`;

    const charCountWithSpaces = calculateCharacterCount(htmlContent, false); // Include spaces
    const charCountWithSpacesEl = document.getElementById(CHARACTER_COUNT_WITH_SPACES_DISPLAY_ID);
    if (charCountWithSpacesEl) charCountWithSpacesEl.textContent = `Chars (incl. spaces): ${charCountWithSpaces}`;
  }
}, 300);


async function saveChapterContentInternal() {
    if (!editorInstance || !currentChapterId || !currentNovelId) {
        return false; 
    }
    updateSaveStatus("Saving...", 'saving');
    const novel = novels.find(n => n.id === currentNovelId);
    if (!novel) {
        updateSaveStatus("Save failed: novel not found", 'error');
        return false;
    }
    const chapter = novel.chapters.find(c => c.id === currentChapterId);
    if (chapter) {
        chapter.contentHTML = editorInstance.getData();
        chapter.updatedAt = new Date().toISOString();
        touchNovel(novel.id); // Update novel's updatedAt timestamp as well
        saveNovels(novels); 
        updateSaveStatus("Saved ✓", 'success');
        triggerHapticFeedback([20]);
        isEditorDirty = false; 
        lastSuccessfulSaveTimestamp = new Date(chapter.updatedAt); 
        updateLastSavedDisplay(); 
        return true; 
    } else {
        updateSaveStatus("Save failed: chapter not found", 'error');
        isEditorDirty = true; // Remain dirty if save failed
        return false; 
    }
}

const debouncedSave = debounce(saveChapterContentInternal, 1000);

async function loadChapterIntoEditor(chapter) {
  const editorPlaceholderEl = document.getElementById(EDITOR_CONTAINER_ID);
  const activeChapterTitleDisplayEl = document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID);

  if (editorPlaceholderEl) {
    editorPlaceholderEl.innerHTML = `
        <div class="flex items-center justify-center h-full text-color-text-secondary p-8 text-center" role="status">
            <svg class="animate-spin w-5 h-5 mr-2 text-color-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>Loading chapter...
        </div>`;
  }
  if (activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = 'Loading...';

  debouncedUpdateEditorStats(); // Will update to 0 if editor is cleared or new
  isEditorDirty = false;

  if (!chapter) {
    clearEditorPlaceholder(); 
    return;
  }
  await destroyEditorInstance(); 

  if (!editorPlaceholderEl) { 
    console.error("Editor placeholder element not found after potential destroy.");
    if (activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = 'Error loading chapter';
    return;
  }

  if (activeChapterTitleDisplayEl) {
      activeChapterTitleDisplayEl.textContent = chapter.title || 'Untitled Chapter';
  }

  try {
    editorInstance = await ClassicEditor.create(editorPlaceholderEl, { 
      toolbar: {
        items: [
            'heading', '|', 'bold', 'italic', /* 'underline', 'strikethrough', */ '|',
            'link', 'blockQuote', 'insertTable', /* 'codeBlock', */ '|',
            'bulletedList', 'numberedList', '|', 'undo', 'redo' /*, '|', 'findAndReplace' */
        ],
        shouldNotGroupWhenFull: true // Improves toolbar responsiveness
      },
      table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
      codeBlock: { // This config is likely unused if codeBlock plugin isn't in the build
        languages: [ 
            { language: 'plaintext', label: 'Plain text' }, { language: 'javascript', label: 'JavaScript' },
            { language: 'python', label: 'Python' }, { language: 'html', label: 'HTML' },
            { language: 'css', label: 'CSS' }, { language: 'java', label: 'Java' }, { language: 'c', label: 'C' },
            { language: 'cpp', label: 'C++' }, { language: 'php', label: 'PHP' }, { language: 'ruby', label: 'Ruby' },
            { language: 'go', label: 'Go' }, { language: 'bash', label: 'Bash/Shell' }, { language: 'sql', label: 'SQL' },
            { language: 'json', label: 'JSON' }, { language: 'xml', label: 'XML' }, { language: 'markdown', label: 'Markdown' },
        ]
      },
      placeholder: 'Start writing your chapter here…'
    });

    if (editorInstance && editorInstance.ui && editorInstance.ui.element) {
        editorInstance.ui.element.classList.add('flex-grow', 'min-h-0', 'flex', 'flex-col');
    }
    
    editorInstance.setData(chapter.contentHTML || '<p></p>'); 
    isEditorDirty = false; 

    if (editorInstance.editing?.view?.focus) { // Safely access focus
        editorInstance.editing.view.focus();
    }
    if (editorInstance.ui?.view?.editable?.element) { // Safely access element
        setupEditorGestures(editorInstance.ui.view.editable.element);
    }

    debouncedUpdateEditorStats(); // Update stats with loaded content
    lastSuccessfulSaveTimestamp = new Date(chapter.updatedAt); 
    updateLastSavedDisplay();

    editorInstance.model.document.on('change:data', () => {
        isEditorDirty = true;
        updateSaveStatus("Unsaved changes", 'warning'); 
        debouncedSave(); 
        debouncedUpdateEditorStats();
    });
    updateSaveStatus('', 'clear'); 

    if (editorInstance?.ui?.view?.editable?.element) {
        requestAnimationFrame(() => { 
            if (editorInstance?.ui?.view?.editable?.element) { 
                 editorInstance.ui.view.editable.element.scrollTop = 0;
            }
        });
    }

  } catch (error) {
    console.error('CKEditor initialization error:', error, error.stack);
    const currentEditorContainer = document.getElementById(EDITOR_CONTAINER_ID);
    if (currentEditorContainer) currentEditorContainer.innerHTML = '<p class="text-color-error p-4">Error loading editor. Please try refreshing.</p>';
    if (activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = 'Error Loading Chapter';
    updateSaveStatus("Editor load failed", 'error');
    isEditorDirty = false;
    lastSuccessfulSaveTimestamp = null;
    updateLastSavedDisplay();
  }
}

async function saveCurrentChapterData() {
  if (editorInstance && currentChapterId && currentNovelId) {
    if (debouncedSave._timeoutId) { // Check if a debounced save is pending
        clearTimeout(debouncedSave._timeoutId); 
    }
    return await saveChapterContentInternal(); 
  }
  return false; 
}

async function destroyEditorInstance() {
    if (isEditorDirty) {
      await saveCurrentChapterData(); 
    }
    destroyEditorGestures(); 
    if (editorInstance) {
        try {
            await editorInstance.destroy();
        } catch (error) {
            console.error("Error destroying editor instance:", error, error.stack);
        }
        editorInstance = null;
    }
    isEditorDirty = false; 
}

function clearEditorPlaceholder() {
  const activeChapterTitleDisplayEl = document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID);
  destroyEditorInstance().then(() => { 
    const editorContainer = document.getElementById(EDITOR_CONTAINER_ID);
    if (editorContainer) {
        editorContainer.classList.add('flex-grow', 'min-h-0'); 
        const novel = novels.find(n => n.id === currentNovelId);
        if (novel && novel.chapters.length === 0) { 
            if(activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = "Write Your First Chapter";
            editorContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-center p-4 text-color-text-secondary" role="region" aria-label="First chapter creation prompt">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-16 h-16 text-gray-500 dark:text-gray-400 mb-4" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125.504 1.125 1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <h3 class="text-xl font-semibold text-color-onSurface mb-2">Let's begin your story!</h3>
                    <p class="mb-4 max-w-xs">Every great novel starts with a single chapter. What will yours be about?</p>
                    <button id="createFirstChapterBtnInPlaceholder" class="bg-color-accent text-white px-6 py-2.5 rounded-md hover:opacity-80 transition-opacity font-medium flex items-center gap-2">
                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        Create Your First Chapter
                    </button>
                </div>
            `;
            const createFirstChapterBtn = document.getElementById('createFirstChapterBtnInPlaceholder');
            const addChapterFab = document.getElementById(ADD_CHAPTER_FAB_ID); // Target FAB
            if (createFirstChapterBtn && addChapterFab) { 
                createFirstChapterBtn.onclick = () => addChapterFab.click(); // Trigger FAB click
                createFirstChapterBtn.focus(); 
            }
        } else { 
            if(activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = 'No Chapter Selected';
            editorContainer.innerHTML = '<div class="flex items-center justify-center h-full text-color-text-secondary p-8 text-center" role="status"><p>Select a chapter to start editing, or create a new one.</p></div>';
        }
    }
    debouncedUpdateEditorStats(); // Will show 0 counts
    updateSaveStatus('', 'clear'); 
    isEditorDirty = false;
    lastSuccessfulSaveTimestamp = null;
    updateLastSavedDisplay();
  });
}

// -------------------- EPUB Generation Helpers --------------------
function generateContainerXML() {
    return `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function generateStyleCSS() {
    // Basic CSS for EPUB. More advanced styling could be added.
    return `body { 
  font-family: sans-serif; 
  margin: 5%; 
  line-height: 1.5; 
  text-align: justify; 
}
h1, h2, h3, h4, h5, h6 { 
  margin-top: 1.5em; 
  margin-bottom: 0.5em; 
  line-height: 1.2; 
  text-align:left; 
  font-weight: bold;
}
p { 
  margin-top: 0.5em; 
  margin-bottom: 0.5em; 
}
img { 
  max-width: 100%; 
  height: auto; 
  display:block; 
  margin: 1em auto; 
  page-break-inside: avoid; /* Try to keep images from splitting across pages */
}
div.cover-image-container { 
  width: 100%; 
  height: 100vh; /* Full viewport height for cover */
  display: flex; 
  align-items: center; 
  justify-content: center; 
  margin:0; 
  padding:0; 
}
div.cover-image-container img { 
  max-width: 100%; 
  max-height: 100vh; 
  object-fit: contain; 
}
blockquote {
  margin: 1em 40px;
  padding: 0.5em 10px;
  border-left: 3px solid #ccc;
  font-style: italic;
}
pre {
  white-space: pre-wrap; /* CSS3 */
  white-space: -moz-pre-wrap; /* Mozilla, since 1999 */
  white-space: -pre-wrap; /* Opera 4-6 */
  white-space: -o-pre-wrap; /* Opera 7 */
  word-wrap: break-word; /* Internet Explorer 5.5+ */
  background-color: #f5f5f5;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow-x: auto;
}
code {
  font-family: monospace;
}
pre code {
  background-color: transparent;
  padding: 0;
  border: none;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  page-break-inside: auto;
}
th, td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}
th {
  background-color: #f2f2f2;
}
ul, ol {
  margin: 1em 0;
  padding-left: 40px;
}
li {
  margin-bottom: 0.5em;
}
`;
}

function generateCoverXHTML(coverFilename, language) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>Cover</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
  <div class="cover-image-container">
    <img src="images/${coverFilename}" alt="Cover Image"/>
  </div>
</body>
</html>`;
}


function generateContentOPF(novel, exportTitle, exportAuthor, exportLanguage, chaptersToExport, coverMeta) {
    const chapterItemsManifest = chaptersToExport.map(ch =>
        `<item id="chapter-${ch.id}" href="${sanitizeFilename(`chapter-${ch.order}_${ch.title || 'chapter-' + ch.order}`)}.xhtml" media-type="application/xhtml+xml"/>`
    ).join('\n        ');

    const chapterItemsSpine = chaptersToExport.map(ch =>
        `<itemref idref="chapter-${ch.id}"/>`
    ).join('\n        ');

    let coverImageManifest = '';
    let coverPageManifest = '';
    let coverMetaTag = '';
    let coverSpineItem = '';
    let coverGuideReference = '';

    if (coverMeta) {
        coverImageManifest = `<item id="cover-image" href="images/${coverMeta.filename}" media-type="${coverMeta.mimeType}"/>`;
        coverPageManifest = `<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`;
        coverMetaTag = `<meta name="cover" content="cover-image"/>`; // EPUB 2 cover convention
        coverSpineItem = `<itemref idref="cover-page" linear="yes"/>`; 
        coverGuideReference = `<guide><reference type="cover" title="Cover" href="cover.xhtml"/></guide>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:uuid:${novel.id}</dc:identifier>
    <dc:title>${exportTitle}</dc:title>
    <dc:creator opf:role="aut">${exportAuthor}</dc:creator>
    <dc:language>${exportLanguage}</dc:language>
    <dc:publisher>Novel Creator App</dc:publisher>
    <dc:date opf:event="modification">${(novel.updatedAt || novel.createdAt || new Date()).toISOString().split('T')[0]}</dc:date>
    <meta name="generator" content="Novel Creator App V (check metadata.json)" />
    ${coverMetaTag}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="css/style.css" media-type="text/css"/>
    ${coverImageManifest}
    ${coverPageManifest}
    ${chapterItemsManifest}
  </manifest>
  <spine toc="ncx">
    ${coverSpineItem}
    ${chapterItemsSpine}
  </spine>
  ${coverGuideReference}
</package>`;
}

function generateTocNCX(novel, exportTitle, chaptersToExport) {
    const navPoints = chaptersToExport.map((ch, index) => `
    <navPoint id="navpoint-${ch.order}" playOrder="${index + 1}"> <!-- playOrder should be sequential 1-based -->
      <navLabel><text>${ch.title || `Chapter ${ch.order}`}</text></navLabel>
      <content src="${sanitizeFilename(`chapter-${ch.order}_${ch.title || 'chapter-' + ch.order}`)}.xhtml"/>
    </navPoint>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${novel.id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/> <!-- Required by spec, 0 for reflowable -->
    <meta name="dtb:maxPageNumber" content="0"/> <!-- Required by spec, 0 for reflowable -->
  </head>
  <docTitle><text>${exportTitle}</text></docTitle>
  <navMap>${navPoints}
  </navMap>
</ncx>`;
}

function generateChapterXHTML(chapter, language) {
    const title = chapter.title || `Chapter ${chapter.order}`;
    // Basic HTML sanitization or structure adjustments can be done here if needed.
    // For now, assuming CKEditor output is reasonably clean for EPUB.
    const content = chapter.contentHTML || '<p></p>';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
  <h2>${title}</h2>
  ${content}
</body>
</html>`;
}

// -------------------- EXPORT MODAL --------------------
async function openExportModal() {
    if (!currentNovelId) return;
    await saveCurrentChapterData(); 
    const novel = novels.find(n => n.id === currentNovelId);
    if (!novel) return;

    if (novel.chapters.length === 0) {
        await showConfirm({title: "Export Error", message: "Please add at least one chapter to your novel before exporting.", okText: "OK"});
        return;
    }
    triggerHapticFeedback([10]);
    const triggeringElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let overlay = document.getElementById('exportModalOverlay');
    if (overlay) overlay.remove(); 

    overlay = document.createElement('div');
    overlay.id = 'exportModalOverlay';
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'exportModalTitle');


    const currentSettings = loadAppSettings(); 
    const languageOptions = [ // Common languages, can be expanded
        { value: 'en', text: 'English' }, { value: 'en-US', text: 'English (US)' }, { value: 'en-GB', text: 'English (UK)' },
        { value: 'es', text: 'Spanish' }, { value: 'es-ES', text: 'Spanish (Spain)' }, { value: 'es-MX', text: 'Spanish (Mexico)' },
        { value: 'fr', text: 'French' }, { value: 'fr-FR', text: 'French (France)' }, { value: 'de', text: 'German' },
        { value: 'it', text: 'Italian' }, { value: 'pt', text: 'Portuguese' }, { value: 'pt-BR', text: 'Portuguese (Brazil)' },
        { value: 'ja', text: 'Japanese' }, { value: 'zh', text: 'Chinese' },
        { value: 'other', text: 'Other (Specify BCP 47 code)' }
    ];
    
    let initialLanguageIsOther = false;
    let initialOtherLanguageValue = '';
    if (novel.language && !languageOptions.some(opt => opt.value === novel.language && opt.value !== 'other')) {
        initialLanguageIsOther = true;
        initialOtherLanguageValue = novel.language;
    }

    const languageSelectHTML = languageOptions.map(opt =>
        `<option value="${opt.value}" ${ (initialLanguageIsOther && opt.value === 'other') || (!initialLanguageIsOther && novel.language === opt.value) ? 'selected' : ''}>${opt.text}</option>`
    ).join('');

    const sortedChaptersForSelection = novel.chapters.slice().sort((a, b) => a.order - b.order);
    const chapterSelectionHTML = `
        <div class="mb-4">
            <label class="block text-sm font-medium text-color-onSurface mb-1">Chapters to Export</label>
            <div class="flex items-center mb-2">
                <input type="checkbox" id="exportSelectAllChapters" class="h-4 w-4 text-color-accent bg-gray-700 border-gray-600 rounded focus:ring-color-accent focus:ring-2 cursor-pointer" checked>
                <label for="exportSelectAllChapters" class="ml-2 text-sm text-color-onSurface select-none cursor-pointer">Select All Chapters</label>
            </div>
            <ul id="exportChapterList" class="max-h-48 overflow-y-auto border border-color-border rounded-md p-2 space-y-1 bg-color-input-bg/50">
                ${sortedChaptersForSelection.map(ch => `
                    <li class="flex items-center">
                        <input type="checkbox" id="export-ch-${ch.id}" data-chapter-id="${ch.id}" class="export-chapter-checkbox h-4 w-4 text-color-accent bg-gray-700 border-gray-600 rounded focus:ring-color-accent focus:ring-1 cursor-pointer" checked>
                        <label for="export-ch-${ch.id}" class="ml-2 text-sm text-color-onSurface select-none cursor-pointer truncate" title="${ch.title || `Chapter ${ch.order}`}">${ch.order}. ${ch.title || `Chapter ${ch.order}`}</label>
                    </li>
                `).join('')}
            </ul>
        </div>
    `;


    overlay.innerHTML = `
        <div class="modal" style="max-width: 500px;">
            <h2 id="exportModalTitle">Export “${novel.title || 'Untitled Novel'}”</h2>

            <div class="mb-3">
                <label for="exportTitleInput" class="block text-sm font-medium text-color-onSurface mb-1">Book Title</label>
                <input type="text" id="exportTitleInput" value="${novel.title || ''}" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface">
            </div>

            <div class="mb-3">
                <label for="exportAuthorInput" class="block text-sm font-medium text-color-onSurface mb-1">Author Name</label>
                <input type="text" id="exportAuthorInput" value="${novel.author || currentSettings.defaultAuthor || ''}" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface">
            </div>

            <div class="mb-3">
                <label for="exportLanguageInput" class="block text-sm font-medium text-color-onSurface mb-1">Language (BCP 47)</label>
                <select id="exportLanguageInput" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface">
                    ${languageSelectHTML}
                </select>
                <input type="text" id="exportLanguageOtherInput" placeholder="e.g., fr-CA, pt-PT" value="${initialLanguageIsOther ? initialOtherLanguageValue : ''}" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface mt-2 ${initialLanguageIsOther ? '' : 'hidden'}">
            </div>

            ${chapterSelectionHTML}

            <div class="mb-4">
                <label for="coverInput" class="block text-sm font-medium text-color-onSurface mb-1">Cover Image (PNG, JPG, GIF, max 2MB)</label>
                <div id="coverPreviewContainer" class="mb-2">
                    <img id="coverPreviewImage" src="#" alt="Cover Preview" class="hidden">
                    <div id="coverPreviewPlaceholder">No cover selected.</div>
                </div>
                <input type="file" id="coverInput" accept="image/png, image/jpeg, image/gif" class="w-full text-sm file:mr-2 file:py-1 file:px-2 file:rounded-md file:border file:border-color-border file:text-sm file:font-semibold file:bg-color-input-bg file:text-color-accent hover:file:bg-color-accent/10">
                <small id="coverFileNameDisplay" class="block text-xs text-color-text-secondary truncate mt-1 mb-0 hidden"></small>
                <button id="removeCoverBtn" class="btn btn-link text-color-error text-xs p-0 mt-1 hidden">Remove Cover</button>
            </div>

            <div class="actions mt-6 flex flex-col gap-2">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button id="downloadZIPBtn" class="btn btn-primary w-full">ZIP (Markdown)</button>
                    <button id="downloadTXTZipBtn" class="btn btn-primary w-full">ZIP (Plain Text)</button>
                </div>
                <button id="downloadEPUBBtn" class="btn btn-primary w-full">Download EPUB</button>
                <hr class="my-2 border-color-border">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button id="saveNovelDetailsBtn" class="btn btn-secondary w-full">Save Details to Novel</button>
                    <button id="closeExportBtn" class="btn btn-secondary w-full">Close</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('body-modal-open'); 
    requestAnimationFrame(() => overlay.classList.add('active')); 

    const titleInputEl = overlay.querySelector('#exportTitleInput');
    const authorInputEl = overlay.querySelector('#exportAuthorInput');
    const languageInputEl = overlay.querySelector('#exportLanguageInput');
    const languageOtherInputEl = overlay.querySelector('#exportLanguageOtherInput');
    const coverInputEl = overlay.querySelector('#coverInput');
    const coverPreviewImageEl = overlay.querySelector('#coverPreviewImage');
    const coverPreviewPlaceholderEl = overlay.querySelector('#coverPreviewPlaceholder');
    const coverFileNameDisplayEl = overlay.querySelector('#coverFileNameDisplay');
    const removeCoverBtnEl = overlay.querySelector('#removeCoverBtn');
    const saveDetailsBtn = overlay.querySelector('#saveNovelDetailsBtn');
    const selectAllChaptersCheckbox = overlay.querySelector('#exportSelectAllChapters');
    const chapterCheckboxes = overlay.querySelectorAll('.export-chapter-checkbox');
    const downloadEPUBBtn = overlay.querySelector('#downloadEPUBBtn');
    const downloadZIPBtn = overlay.querySelector('#downloadZIPBtn');
    const downloadTXTZipBtn = overlay.querySelector('#downloadTXTZipBtn');

    const updateExportButtonState = () => {
        const anyChapterSelected = Array.from(chapterCheckboxes).some(cb => cb.checked);
        downloadEPUBBtn.disabled = !anyChapterSelected;
        downloadZIPBtn.disabled = !anyChapterSelected;
        downloadTXTZipBtn.disabled = !anyChapterSelected;
    };
    
    selectAllChaptersCheckbox.addEventListener('change', () => {
        chapterCheckboxes.forEach(cb => cb.checked = selectAllChaptersCheckbox.checked);
        updateExportButtonState();
    });

    chapterCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(chapterCheckboxes).every(c => c.checked);
            const someChecked = Array.from(chapterCheckboxes).some(c => c.checked);
            if (allChecked) {
                selectAllChaptersCheckbox.checked = true;
                selectAllChaptersCheckbox.indeterminate = false;
            } else if (someChecked) {
                selectAllChaptersCheckbox.checked = false;
                selectAllChaptersCheckbox.indeterminate = true;
            } else {
                selectAllChaptersCheckbox.checked = false;
                selectAllChaptersCheckbox.indeterminate = false;
            }
            updateExportButtonState();
        });
    });
    updateExportButtonState(); // Initial state


    let currentCoverDataURL = novel.coverDataURL; 

    const updateCoverPreview = (dataURL) => {
        if (dataURL && (dataURL.startsWith('data:image/png') || dataURL.startsWith('data:image/jpeg') || dataURL.startsWith('data:image/gif'))) { 
            coverPreviewImageEl.src = dataURL;
            coverPreviewImageEl.classList.remove('hidden');
            coverPreviewPlaceholderEl.classList.add('hidden');
            removeCoverBtnEl.classList.remove('hidden');
        } else { 
            coverPreviewImageEl.src = '#'; 
            coverPreviewImageEl.classList.add('hidden');
            coverPreviewPlaceholderEl.textContent = 'No cover selected or preview unavailable.';
            coverPreviewPlaceholderEl.classList.remove('hidden');
            removeCoverBtnEl.classList.add('hidden');
            if (coverFileNameDisplayEl) { 
                coverFileNameDisplayEl.textContent = '';
                coverFileNameDisplayEl.classList.add('hidden');
            }
        }
    };
    
    languageInputEl.addEventListener('change', () => {
        if (languageInputEl.value === 'other') {
            languageOtherInputEl.classList.remove('hidden');
            languageOtherInputEl.focus();
        } else {
            languageOtherInputEl.classList.add('hidden');
            languageOtherInputEl.value = ''; 
        }
    });
    if (languageInputEl.value === 'other') { // Initial check
        languageOtherInputEl.classList.remove('hidden');
    }


    updateCoverPreview(currentCoverDataURL); 

    coverInputEl.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (coverFileNameDisplayEl) {
            coverFileNameDisplayEl.textContent = ''; 
            coverFileNameDisplayEl.classList.add('hidden');
        }


        if (file) {
            if (file.size > 2 * 1024 * 1024) { // 2MB limit
                await showConfirm({title: "File Too Large", message: "Cover image must be less than 2MB.", okText:"OK"});
                coverInputEl.value = ''; 
                return;
            }
            if (coverFileNameDisplayEl) {
                coverFileNameDisplayEl.textContent = file.name;
                coverFileNameDisplayEl.classList.remove('hidden');
            }
            if(coverPreviewPlaceholderEl) coverPreviewPlaceholderEl.textContent = "Processing image..."; 
            if(coverPreviewImageEl) coverPreviewImageEl.classList.add('hidden');
            if(coverPreviewPlaceholderEl) coverPreviewPlaceholderEl.classList.remove('hidden');
            try {
                currentCoverDataURL = await fileToDataURL(file); 
                updateCoverPreview(currentCoverDataURL);
            } catch (err) {
                console.error("Cover processing error:", err, err.stack);
                currentCoverDataURL = novel.coverDataURL; 
                updateCoverPreview(currentCoverDataURL);
                await showConfirm({title: "Image Error", message: "Could not process the selected image. Please try a different PNG, JPG, or GIF file.", okText:"OK"});
                if (coverFileNameDisplayEl) {
                    coverFileNameDisplayEl.textContent = ''; 
                    coverFileNameDisplayEl.classList.add('hidden');
                }
            }
        } else { 
            // Revert to novel's current cover if user cancels file dialog or no file selected
            currentCoverDataURL = novel.coverDataURL;
            updateCoverPreview(currentCoverDataURL);
        }
    });

    removeCoverBtnEl.addEventListener('click', () => {
        triggerHapticFeedback([10]);
        currentCoverDataURL = null; 
        coverInputEl.value = ''; 
        updateCoverPreview(null); 
    });

    const handleNovelMetadataUpdate = async () => {
        let changed = false;
        const newTitle = titleInputEl.value.trim() || 'Untitled Novel';
        if (newTitle !== novel.title) {
            novel.title = newTitle;
            changed = true;
        }
        const newAuthor = authorInputEl.value.trim();
        if (newAuthor !== novel.author) {
            novel.author = newAuthor;
            changed = true;
        }

        let newLanguage = languageInputEl.value;
        if (newLanguage === 'other') {
            newLanguage = languageOtherInputEl.value.trim();
            // Validate BCP 47 basic structure (e.g., xx or xx-XX)
            if (newLanguage && !/^[a-z]{2,3}(?:-[A-Z]{2,3})?(?:-[A-Za-z0-9]+)*$/.test(newLanguage)) { // Allow empty
                 await showConfirm({title: "Invalid Language Code", message: "Please enter a valid BCP 47 language code (e.g., 'en', 'fr-CA'), or leave empty to use default.", okText:"OK"});
                 languageOtherInputEl.focus();
                 return false; // Indicate validation failure, don't proceed with save/export
            }
            if (!newLanguage) newLanguage = novel.language || 'en'; // Default back if empty
        }
        if (newLanguage !== novel.language) {
            novel.language = newLanguage;
            changed = true;
        }

        if (currentCoverDataURL !== novel.coverDataURL) {
            novel.coverDataURL = currentCoverDataURL;
            changed = true;
        }

        if (changed) {
            touchNovel(novel.id); 
            saveNovels(novels); 
            document.getElementById(PAGE_TITLE_ID).innerText = novel.title;
            const novelTitleDisplayEl = document.getElementById(NOVEL_TITLE_DISPLAY_ID);
            if (novelTitleDisplayEl) novelTitleDisplayEl.innerText = novel.title;
        }
        return changed; 
    };

    saveDetailsBtn.addEventListener('click', async () => {
        const detailsChanged = await handleNovelMetadataUpdate();
        if (detailsChanged !== false) { // Check for explicit false (validation failure)
            if (detailsChanged) { // True means changed and saved
                triggerHapticFeedback([20]);
                updateSaveStatus("Novel details saved ✓", "success");
            } else { // No changes made
                updateSaveStatus("No changes to save.", "info", 1500);
            }
        }
    });

    const getSelectedChapters = () => {
        const selectedIds = Array.from(chapterCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.chapterId);
        return novel.chapters.filter(ch => selectedIds.includes(ch.id)).sort((a, b) => a.order - b.order);
    };


    downloadEPUBBtn.addEventListener('click', async () => {
        if (typeof JSZip === 'undefined') {
            await showConfirm({title: "Export Error", message: "EPUB generation library (JSZip) is not available. Please check your internet connection or try refreshing.", okText: "OK"});
            return;
        }
        const chaptersToExport = getSelectedChapters();
        if (chaptersToExport.length === 0) {
            await showConfirm({ title: "Export Error", message: "Please select at least one chapter to export.", okText: "OK" });
            return;
        }
        const updateSucceeded = await handleNovelMetadataUpdate(); 
        if (updateSucceeded === false) return; // Stop if metadata update failed validation

        const exportTitle = novel.title || 'Untitled Novel';
        const exportAuthor = novel.author || currentSettings.defaultAuthor || 'Unknown Author';
        let exportLanguage = novel.language || 'en';
        if (exportLanguage.includes(',')) exportLanguage = exportLanguage.split(',')[0].trim(); 

        const finalCoverDataURL = novel.coverDataURL;

        try {
            const zip = new JSZip();
            zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

            const oebpsFolder = zip.folder("OEBPS");
            zip.folder("META-INF").file("container.xml", generateContainerXML());
            
            const cssFolder = oebpsFolder.folder("css");
            cssFolder.file("style.css", generateStyleCSS());

            let coverMetaInfo = null;
            if (finalCoverDataURL && (finalCoverDataURL.startsWith('data:image/png') || finalCoverDataURL.startsWith('data:image/jpeg') || finalCoverDataURL.startsWith('data:image/gif'))) {
                const imagesFolder = oebpsFolder.folder("images");
                const mimeTypeMatch = finalCoverDataURL.match(/^data:(image\/(png|jpeg|gif));base64,/);
                if (mimeTypeMatch) {
                    const mimeType = mimeTypeMatch[1];
                    const extension = mimeTypeMatch[2] === 'jpeg' ? 'jpg' : mimeTypeMatch[2];
                    const base64Data = finalCoverDataURL.substring(mimeTypeMatch[0].length);
                    const coverFilename = `cover.${extension}`;
                    
                    imagesFolder.file(coverFilename, base64Data, { base64: true });
                    oebpsFolder.file("cover.xhtml", generateCoverXHTML(coverFilename, exportLanguage));
                    coverMetaInfo = { filename: coverFilename, mimeType: mimeType, id: "cover-image" };
                } else {
                    console.warn("Could not determine cover image type or invalid data URL.");
                     await showConfirm({title: "Cover Warning", message: "Could not process cover image for EPUB. It might be an unsupported format. EPUB will be generated without cover.", okText: "OK"});
                }
            } else if (finalCoverDataURL) { // Any other data URL type (e.g. SVG)
                console.warn("Unsupported cover image type for EPUB (e.g. SVG). Cover will be skipped.");
                await showConfirm({title: "Cover Warning", message: "Unsupported cover image format. Only PNG, JPG, GIF are reliably supported for EPUB covers. EPUB will be generated without cover.", okText: "OK"});
            }

            chaptersToExport.forEach(ch => {
                const chapterFilename = sanitizeFilename(`chapter-${ch.order}_${ch.title || 'chapter-' + ch.order}`) + ".xhtml";
                oebpsFolder.file(chapterFilename, generateChapterXHTML(ch, exportLanguage));
            });

            oebpsFolder.file("content.opf", generateContentOPF(novel, exportTitle, exportAuthor, exportLanguage, chaptersToExport, coverMetaInfo));
            oebpsFolder.file("toc.ncx", generateTocNCX(novel, exportTitle, chaptersToExport));

            const epubBlob = await zip.generateAsync({ type: 'blob', mimeType: "application/epub+zip" });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(epubBlob);
            link.download = `${sanitizeFilename(exportTitle)}.epub`;
            document.body.appendChild(link); // Required for Firefox
            link.click();
            document.body.removeChild(link); // Clean up
            URL.revokeObjectURL(link.href);
            updateSaveStatus("EPUB exported successfully!", "success");
            triggerHapticFeedback([40]);

        } catch (error) {
            console.error("EPUB Generation Error:", error, error.stack);
            await showConfirm({title: "EPUB Export Failed", message: `Could not generate EPUB. ${error.message}. Please check console for details.`, okText:"OK"});
        }
    });

    downloadZIPBtn.addEventListener('click', async () => {
        if (typeof JSZip === 'undefined' || typeof TurndownService === 'undefined') { 
            await showConfirm({title: "Export Error", message: "Required library (JSZip or Turndown) is not available for Markdown export. Please check your internet connection or try refreshing.", okText: "OK"});
            return;
        }
        const chaptersToExport = getSelectedChapters();
        if (chaptersToExport.length === 0) {
            await showConfirm({ title: "Export Error", message: "Please select at least one chapter to export.", okText: "OK" });
            return;
        }
        const updateSucceeded = await handleNovelMetadataUpdate(); 
        if (updateSucceeded === false) return;

        const exportTitle = novel.title || 'Untitled Novel';
        const exportAuthor = novel.author || currentSettings.defaultAuthor || 'Unknown Author';
        const exportLanguage = novel.language || 'en';

        try {
            const zip = new JSZip();
            const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' }); 

            const createdDate = novel.createdAt ? new Date(novel.createdAt).toLocaleDateString() : 'N/A';
            const updatedDate = novel.updatedAt ? new Date(novel.updatedAt).toLocaleDateString() : 'N/A';
            const metadataContent = `# ${exportTitle}\n\n**Author:** ${exportAuthor}\n**Language:** ${exportLanguage}\n**Created:** ${createdDate}\n**Last Updated:** ${updatedDate}\n**Exported Chapters:** ${chaptersToExport.length} (out of ${novel.chapters.length} total)\n---\n`;
            zip.file('novel_metadata.md', metadataContent.trim());


            chaptersToExport.forEach((ch) => {
                const base = `${String(ch.order).padStart(3,'0')}_${sanitizeFilename(ch.title || `chapter-${ch.order}`)}`; // Padded order
                const md = turndownService.turndown(ch.contentHTML || ''); 
                zip.file(`${base}.md`, md);
            });
            const blob = await zip.generateAsync({ type: 'blob' }); 
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${sanitizeFilename(exportTitle)}_Markdown.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href); 
            updateSaveStatus("ZIP (MD) exported successfully!", "success");
            triggerHapticFeedback([40]);
        } catch (error) {
             console.error("Markdown ZIP Generation Error:", error, error.stack);
            await showConfirm({title: "ZIP Export Failed", message: `Could not generate Markdown ZIP archive. ${error.message}. Please check console.`, okText:"OK"});
        }
    });

    downloadTXTZipBtn.addEventListener('click', async () => {
        if (typeof JSZip === 'undefined') {
            await showConfirm({title: "Export Error", message: "ZIP library (JSZip) is not available for Text export. Please check your internet connection or try refreshing.", okText: "OK"});
            return;
        }
        const chaptersToExport = getSelectedChapters();
        if (chaptersToExport.length === 0) {
            await showConfirm({ title: "Export Error", message: "Please select at least one chapter to export.", okText: "OK" });
            return;
        }
        const updateSucceeded = await handleNovelMetadataUpdate(); 
        if (updateSucceeded === false) return;

        const exportTitle = novel.title || 'Untitled Novel';
        const exportAuthor = novel.author || currentSettings.defaultAuthor || 'Unknown Author';
        const exportLanguage = novel.language || 'en';

        try {
            const zip = new JSZip();
            
            const createdDate = novel.createdAt ? new Date(novel.createdAt).toLocaleDateString() : 'N/A';
            const updatedDate = novel.updatedAt ? new Date(novel.updatedAt).toLocaleDateString() : 'N/A';
            const metadataContent = `Title: ${exportTitle}\nAuthor: ${exportAuthor}\nLanguage: ${exportLanguage}\nCreated: ${createdDate}\nLast Updated: ${updatedDate}\nExported Chapters: ${chaptersToExport.length} (out of ${novel.chapters.length} total)\n---\n`;
            zip.file('novel_metadata.txt', metadataContent);

            chaptersToExport.forEach((ch) => {
                const base = `${String(ch.order).padStart(3,'0')}_${sanitizeFilename(ch.title || `chapter-${ch.order}`)}`;
                const txt = htmlToPlainText(ch.contentHTML || ''); 
                zip.file(`${base}.txt`, `Chapter ${ch.order}: ${ch.title || 'Untitled Chapter'}\n\n${txt}`); // Add title to TXT content
            });

            const blob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${sanitizeFilename(exportTitle)}_PlainText.zip`; 
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            updateSaveStatus("ZIP (TXT) exported successfully!", "success");
            triggerHapticFeedback([40]);

        } catch (error) {
            console.error("TXT ZIP Generation Error:", error, error.stack);
            await showConfirm({title: "TXT ZIP Export Failed", message: `Could not generate TXT ZIP archive. ${error.message}. Please check console.`, okText:"OK"});
        }
    });


    const modalElement = overlay.querySelector('.modal');
    const focusableElements = Array.from(modalElement.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null); 
    const firstFocusableElement = focusableElements[0] || titleInputEl; 
    const lastFocusableElement = focusableElements[focusableElements.length - 1];
    
    if(firstFocusableElement) firstFocusableElement.focus(); 


    const closeBtn = overlay.querySelector('#closeExportBtn');
    const handleClose = () => {
        triggerHapticFeedback([10]);
        overlay.classList.remove('active'); 
        document.body.classList.remove('body-modal-open');
        setTimeout(() => {
            if (document.body.contains(overlay)) { 
                 document.body.removeChild(overlay);
            }
            if (triggeringElement && typeof triggeringElement.focus === 'function') { 
                triggeringElement.focus();
            }
        }, 200); 
    };

    const handleKeyDown = (ev) => {
        if (ev.key === 'Escape') {
            handleClose();
        } else if (ev.key === 'Tab') { 
            if (!focusableElements.length) { ev.preventDefault(); return; }
            if (ev.shiftKey) { 
                if (document.activeElement === firstFocusableElement) {
                    ev.preventDefault();
                    lastFocusableElement?.focus();
                }
            } else { 
                if (document.activeElement === lastFocusableElement) {
                    ev.preventDefault();
                    firstFocusableElement?.focus();
                }
            }
        }
    };

    closeBtn?.addEventListener('click', handleClose);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) handleClose(); }); 
    overlay.addEventListener('keydown', handleKeyDown); 
}

// -------------------- SINGLE CHAPTER EXPORT --------------------
function showSingleChapterExportOptions(chapter) {
  return new Promise(resolve => {
    const triggeringElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'singleChapterExportTitle');

    overlay.innerHTML = `
      <div class="modal" style="max-width: 320px;">
        <h2 id="singleChapterExportTitle">Export "${chapter.title || 'Untitled Chapter'}"</h2>
        <p class="modal-message">Select a format:</p>
        <div class="actions flex-col gap-y-2">
          <button id="exportChapterMD" class="btn btn-primary w-full">Markdown (.md)</button>
          <button id="exportChapterTXT" class="btn btn-primary w-full">Plain Text (.txt)</button>
          <button id="exportChapterCancel" class="btn btn-secondary w-full mt-2">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('body-modal-open');
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    const modalElement = overlay.querySelector('.modal');
    const mdBtn = overlay.querySelector('#exportChapterMD');
    const txtBtn = overlay.querySelector('#exportChapterTXT');
    const cancelBtn = overlay.querySelector('#exportChapterCancel');
    
    const focusableElements = Array.from(modalElement.querySelectorAll('button')).filter(el => el.offsetParent !== null);
    const firstFocusableElement = focusableElements[0] || mdBtn;
    const lastFocusableElement = focusableElements[focusableElements.length - 1] || cancelBtn;
    
    firstFocusableElement?.focus(); 

    const handleFormatSelection = (format) => {
      triggerHapticFeedback([20]);
      cleanup();
      resolve(format);
    };

    const handleKeyDown = (ev) => {
        if (ev.key === 'Escape') {
            handleFormatSelection(null); // Cancel
        } else if (ev.key === 'Tab') {
             if (!focusableElements.length) { ev.preventDefault(); return; }
            if (ev.shiftKey) {
                if (document.activeElement === firstFocusableElement) {
                    ev.preventDefault();
                    lastFocusableElement?.focus();
                }
            } else {
                if (document.activeElement === lastFocusableElement) {
                    ev.preventDefault();
                    firstFocusableElement?.focus();
                }
            }
        }
    };

    mdBtn?.addEventListener('click', () => handleFormatSelection('md'));
    txtBtn?.addEventListener('click', () => handleFormatSelection('txt'));
    cancelBtn?.addEventListener('click', () => handleFormatSelection(null));
    overlay.addEventListener('click', ev => {
      if (ev.target === overlay) {
        handleFormatSelection(null);
      }
    });
    overlay.addEventListener('keydown', handleKeyDown);

    function cleanup() {
      overlay.classList.remove('active');
      document.body.classList.remove('body-modal-open');
      mdBtn?.removeEventListener('click', () => handleFormatSelection('md'));
      txtBtn?.removeEventListener('click', () => handleFormatSelection('txt'));
      cancelBtn?.removeEventListener('click', () => handleFormatSelection(null));
      overlay.removeEventListener('click', () => handleFormatSelection(null));
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

async function handleSingleChapterExport(chapter) {
    const format = await showSingleChapterExportOptions(chapter);
    if (!format) return; // User cancelled

    const filenameBase = `${String(chapter.order).padStart(3, '0')}_${sanitizeFilename(chapter.title || `chapter-${chapter.order}`)}`;
    let contentToDownload = '';
    let mimeType = '';
    let fullFilename = '';

    if (format === 'md') {
        if (typeof TurndownService === 'undefined') {
            await showConfirm({ title: "Error", message: "Markdown conversion library (Turndown) is not available.", okText: "OK" });
            return;
        }
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
        contentToDownload = turndownService.turndown(chapter.contentHTML || '');
        mimeType = 'text/markdown;charset=utf-8';
        fullFilename = `${filenameBase}.md`;
    } else if (format === 'txt') {
        contentToDownload = htmlToPlainText(chapter.contentHTML || '');
        mimeType = 'text/plain;charset=utf-8';
        fullFilename = `${filenameBase}.txt`;
    } else {
        console.warn("Unknown format for single chapter export:", format);
        return;
    }

    const blob = new Blob([contentToDownload], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fullFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    updateSaveStatus(`Chapter exported as ${format.toUpperCase()}`, 'success');
    triggerHapticFeedback([40]);
}


// -------------------- TOUCH & GESTURE SETUP --------------------
function setupGestures() {
  const appEl = document.getElementById(APP_ELEMENT_ID);
  if (appEl && !hammerInstances.app) { 
    hammerInstances.app = new Hammer(appEl, { touchAction: 'pan-y' }); // Allow vertical scroll
    hammerInstances.app.on('swiperight', (ev) => {
      // Only trigger if swipe is primarily horizontal and starts near left edge
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) * 2 && ev.center.x < window.innerWidth * 0.25) {
        if (currentNovelId && window.innerWidth < 768 && !document.getElementById(CHAPTER_DRAWER_ID).classList.contains('open')) {
          triggerHapticFeedback([10]);
          openChapterDrawer();
        }
      }
    });
    hammerInstances.app.on('swipeleft', (ev) => {
      // Only trigger if swipe is primarily horizontal and starts within drawer area (if open)
      const drawer = document.getElementById(CHAPTER_DRAWER_ID);
      if (drawer && drawer.classList.contains('open') && ev.center.x < drawer.offsetWidth) {
        if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) * 2) {
            if (currentNovelId && window.innerWidth < 768) {
              triggerHapticFeedback([10]);
              closeChapterDrawer();
            }
        }
      }
    });
  }
}

function destroyEditorGestures() {
    if (hammerInstances.editor) {
        hammerInstances.editor.destroy();
        hammerInstances.editor = null;
    }
}


function setupEditorGestures(targetElement) {
    destroyEditorGestures(); 

    if (targetElement) {
        hammerInstances.editor = new Hammer(targetElement, { recognizers: [[Hammer.Pinch, { enable: true }]] });
        let initialScaleOnPinchStart = appSettings.editorScale;
        
        hammerInstances.editor.on('pinchstart', () => {
             initialScaleOnPinchStart = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-font-scale')) || 1;
        });
        hammerInstances.editor.on('pinch', ev => {
            let newScale = initialScaleOnPinchStart * ev.scale;
            applyEditorScale(newScale); // applyEditorScale also clamps and updates appSettings.editorScale
        });
        hammerInstances.editor.on('pinchend', () => {
           saveAppSettings(appSettings); // Save the new scale
        });
    }
}


function setupChapterListGestures() {
    const chapterListEl = document.getElementById(CHAPTER_LIST_ID);
    if (chapterListEl && !hammerInstances.chapterList) { 
        hammerInstances.chapterList = new Hammer(chapterListEl);
        hammerInstances.chapterList.get('press').set({ time: 500 }); // Standard press time
        hammerInstances.chapterList.on('press', async ev => {
            const li = ev.target.closest('li[data-chapter-id]');
            if (!li || !currentNovelId) return; 
            const chapId = li.dataset.chapterId;
            const novel = novels.find(n => n.id === currentNovelId);
            if (!novel) return;
            const chap = novel.chapters.find(c => c.id === chapId);
            if (!chap) return;
            closeActiveContextMenu(); 
            showChapterContextMenu(chap, ev.center.x, ev.center.y); 
        });
    } else if (!chapterListEl && hammerInstances.chapterList) { 
        hammerInstances.chapterList.destroy();
        hammerInstances.chapterList = null;
    }
}

// -------------------- CONTEXT MENU FOR CHAPTER --------------------
let activeContextMenu = null; 

function closeActiveContextMenu() {
    if (activeContextMenu) {
        const parent = activeContextMenu.parentNode;
        if (parent && parent.contains(activeContextMenu)) { 
            parent.removeChild(activeContextMenu);
        }
        activeContextMenu = null; 
    }
}

async function showChapterContextMenu(chapter, x, y) {
  closeActiveContextMenu(); 
  const novel = novels.find(n => n.id === currentNovelId);
  if (!novel) return;
  triggerHapticFeedback([10]); 

  activeContextMenu = document.createElement('div');
  activeContextMenu.id = 'chapterContextMenu'; 
  activeContextMenu.setAttribute('role', 'menu');
  activeContextMenu.setAttribute('aria-label', `Actions for chapter ${chapter.title}`);
  
  const sortedChapters = novel.chapters.slice().sort((a, b) => a.order - b.order);
  const chapterIndex = sortedChapters.findIndex(c => c.id === chapter.id);
  const isFirstChapter = chapterIndex === 0;
  const isLastChapter = chapterIndex === sortedChapters.length - 1;

  activeContextMenu.innerHTML = `
    <div class="menu-item" data-action="rename" role="menuitem" tabindex="0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>Rename
    </div>
     <div class="menu-item" data-action="exportSingle" role="menuitem" tabindex="0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>Export Chapter...
    </div>
    <div class="menu-item ${isFirstChapter ? 'menu-item-disabled' : ''}" data-action="moveUp" role="menuitem" tabindex="${isFirstChapter ? -1 : 0}" aria-disabled="${isFirstChapter}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" /></svg>Move Up
    </div>
    <div class="menu-item ${isLastChapter ? 'menu-item-disabled' : ''}" data-action="moveDown" role="menuitem" tabindex="${isLastChapter ? -1 : 0}" aria-disabled="${isLastChapter}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" /></svg>Move Down
    </div>
    <div class="menu-item menu-item-delete" data-action="delete" role="menuitem" tabindex="0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom text-color-error" aria-hidden="true"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75H4.5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 0-1.5H14A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.531.096 2.182.275a.75.75 0 0 0 .541-.941A4.527 4.527 0 0 0 10 3c-.84 0-1.531.096-2.182.275a.75.75 0 0 0 .541.941A4.527 4.527 0 0 0 10 4ZM4.5 6.5A.75.75 0 0 0 3.75 7.25v7.5A2.75 2.75 0 0 0 6.5 17.5h7a2.75 2.75 0 0 0 2.75-2.75v-7.5A.75.75 0 0 0 15.5 6.5h-11Z" clip-rule="evenodd" /></svg>Delete
    </div>
  `;
  document.body.appendChild(activeContextMenu);

  activeContextMenu.style.left = `${Math.min(x, window.innerWidth - activeContextMenu.offsetWidth - 10)}px`;
  activeContextMenu.style.top = `${Math.min(y, window.innerHeight - activeContextMenu.offsetHeight - 10)}px`;
  
  const firstFocusableItem = activeContextMenu.querySelector('[role="menuitem"][tabindex="0"]');
  firstFocusableItem?.focus(); 

  const handleMenuAction = async (action) => {
    triggerHapticFeedback([10]); 
    const currentSortedChapters = novel.chapters.slice().sort((a, b) => a.order - b.order);
    const idxInSorted = currentSortedChapters.findIndex(c => c.id === chapter.id);
    // Find actual index in novel.chapters (unsorted by render, but sort key is `order`)
    const actualIdx = novel.chapters.findIndex(c => c.id === chapter.id);


    let chapterToFocusAfterMove = null; 

    switch (action) {
      case 'rename':
        const newTitle = await showPrompt({ title: 'Rename Chapter', initialValue: chapter.title, placeholder: 'Enter new chapter title...' });
        if (newTitle !== null && newTitle.trim() !== chapter.title) { 
          chapter.title = newTitle.trim() || 'Untitled Chapter';
          chapter.updatedAt = new Date().toISOString();
          touchNovel(novel.id);
          saveNovels(novels);
          updateSaveStatus("Chapter renamed", "success");
          triggerHapticFeedback([20]);
          renderChapterList(novel); 
          if (currentChapterId === chapter.id && document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID)) {
            document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID).textContent = chapter.title; 
          }
        }
        break;
      case 'exportSingle':
        await handleSingleChapterExport(chapter);
        break;
      case 'delete':
        const confirmed = await showConfirm({ title: 'Delete Chapter', message: `Are you sure you want to delete chapter “${chapter.title || 'Untitled Chapter'}”?`, okText: 'Delete' });
        if (confirmed) {
          triggerHapticFeedback([40]);
          const chapterWasActive = currentChapterId === chapter.id;
          if(chapterWasActive) isEditorDirty = false; 
          novel.chapters.splice(actualIdx, 1); 
          renumberChapters(novel.chapters); 
          touchNovel(novel.id);
          saveNovels(novels);
          updateSaveStatus("Chapter deleted", "success");
          renderChapterList(novel); 
          handlePostChapterDeletionFocus(); 
          if (chapterWasActive) { 
            currentChapterId = novel.chapters.sort((a,b) => a.order - b.order)[0]?.id || null;
            updateURL(novel.id, currentChapterId);
            if (currentChapterId) {
              await loadChapterIntoEditor(novel.chapters.find(c => c.id === currentChapterId));
            } else {
              clearEditorPlaceholder();
            }
          }
        }
        break;
      case 'moveUp':
        if (actualIdx > 0 && chapter.order > 1) { 
          triggerHapticFeedback([20,30,20]);
          const chapterToSwapWithOrder = novel.chapters[actualIdx].order - 1;
          const swapIdx = novel.chapters.findIndex(c => c.order === chapterToSwapWithOrder);
          if (swapIdx !== -1) {
            [novel.chapters[actualIdx].order, novel.chapters[swapIdx].order] = [novel.chapters[swapIdx].order, novel.chapters[actualIdx].order];
            touchNovel(novel.id);
            saveNovels(novels);
            renderChapterList(novel);
            chapterToFocusAfterMove = chapter.id;
          }
        }
        break;
      case 'moveDown':
         if (actualIdx < novel.chapters.length - 1 && chapter.order < novel.chapters.length) { 
          triggerHapticFeedback([20,30,20]);
          const chapterToSwapWithOrder = novel.chapters[actualIdx].order + 1;
          const swapIdx = novel.chapters.findIndex(c => c.order === chapterToSwapWithOrder);
           if (swapIdx !== -1) {
            [novel.chapters[actualIdx].order, novel.chapters[swapIdx].order] = [novel.chapters[swapIdx].order, novel.chapters[actualIdx].order];
            touchNovel(novel.id);
            saveNovels(novels);
            renderChapterList(novel);
            chapterToFocusAfterMove = chapter.id;
          }
        }
        break;
    }
    closeActiveContextMenu(); 
    if (chapterToFocusAfterMove) { 
        const listEl = document.getElementById(CHAPTER_LIST_ID);
        const movedLi = listEl?.querySelector(`li[data-chapter-id="${chapterToFocusAfterMove}"]`);
        if (movedLi) movedLi.focus();
    }
  };
  
  activeContextMenu.addEventListener('click', ev => {
      const targetItem = ev.target.closest('.menu-item');
      if (targetItem && !targetItem.classList.contains('menu-item-disabled')) { 
          handleMenuAction(targetItem.dataset.action);
      }
  });
  activeContextMenu.addEventListener('keydown', ev => { 
      const targetItem = ev.target.closest('.menu-item');
      if (targetItem && (ev.key === 'Enter' || ev.key === ' ') && !targetItem.classList.contains('menu-item-disabled')) {
          ev.preventDefault(); 
          handleMenuAction(targetItem.dataset.action);
      } else if (ev.key === 'Escape') {
          closeActiveContextMenu();
          // Optionally return focus to the chapter list item that triggered the menu
          const originalTrigger = document.querySelector(`#${CHAPTER_LIST_ID} li[data-chapter-id="${chapter.id}"]`);
          originalTrigger?.focus();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const items = Array.from(activeContextMenu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')); 
          let currentFocusIndex = items.indexOf(document.activeElement);
          if (ev.key === 'ArrowDown') {
              currentFocusIndex = (currentFocusIndex + 1) % items.length;
          } else { 
              currentFocusIndex = (currentFocusIndex - 1 + items.length) % items.length;
          }
          if(items[currentFocusIndex]) items[currentFocusIndex].focus();
      }
  });

  const clickOutsideListener = (ev) => {
    if (activeContextMenu && !activeContextMenu.contains(ev.target)) { 
      closeActiveContextMenu();
      document.removeEventListener('click', clickOutsideListener, true); 
    }
  };
  setTimeout(() => document.addEventListener('click', clickOutsideListener, true), 0); 
}

function handlePostChapterDeletionFocus() {
    const drawer = document.getElementById(CHAPTER_DRAWER_ID);
    if (drawer?.offsetParent === null) return; // Drawer not visible, don't shift focus

    if (currentChapterId) {
        const listEl = document.getElementById(CHAPTER_LIST_ID);
        const activeChapterLi = listEl?.querySelector(`li[data-chapter-id="${currentChapterId}"]`);
        if (activeChapterLi) {
            activeChapterLi.tabIndex = 0; // Ensure it's focusable
            activeChapterLi.focus();
            return; 
        }
    }
    // If no current chapter, or active chapter not found (e.g., list is empty after delete)
    const addChapterFabEl = document.getElementById(ADD_CHAPTER_FAB_ID);
    if (addChapterFabEl && addChapterFabEl.offsetParent !== null && !addChapterFabEl.classList.contains('hidden')) {
        addChapterFabEl.focus();
    } else {
        const chapterSearchInput = document.getElementById(CHAPTER_SEARCH_INPUT_ID);
        if (chapterSearchInput && chapterSearchInput.offsetParent !== null) {
            chapterSearchInput.focus();
        } else {
            drawer?.focus(); // Last resort
        }
    }
}