





import { loadNovels, saveNovels, sanitizeFilename, fileToDataURL, showPrompt, showConfirm, debounce, formatRelativeTime, formatSimpleTime, loadAppSettings, saveAppSettings, htmlToPlainText, triggerHapticFeedback } from './utils.js';

let novels = [];
let currentNovelId = null;
let currentChapterId = null;
let editorInstance = null;
let chapterSortable = null;
let hammerInstances = { app: null, editor: null, chapterList: null };
let isEditorDirty = false;
let lastSuccessfulSaveTimestamp = null;

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
const ADD_CHAPTER_BTN_ID = 'addChapterBtn';
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
let appSettings = loadAppSettings();
let currentNovelSearchTerm = '';
let currentChapterSearchTerm = '';
let novelSearchInputEl, novelSearchClearBtnEl;
let chapterSearchInputEl, chapterSearchClearBtnEl;


// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  appSettings = loadAppSettings(); // Load settings first
  applyTheme(appSettings.theme); // Apply theme immediately

  novels = loadNovels().map(novel => ({
    ...novel,
    createdAt: novel.createdAt || new Date(0).toISOString(),
    updatedAt: novel.updatedAt || novel.createdAt || new Date(0).toISOString(),
    language: novel.language || 'en-US',
    chapters: novel.chapters ? novel.chapters.map(chapter => ({
        ...chapter,
        createdAt: chapter.createdAt || new Date(0).toISOString(),
        updatedAt: chapter.updatedAt || chapter.createdAt || new Date(0).toISOString(),
    })) : []
  }));

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
  // Removed dynamic CSS var setting for RGB, handled by variables.css now
});

function applyTheme(theme) {
    const htmlEl = document.documentElement;
    const sunIcon = document.getElementById(THEME_ICON_SUN_ID);
    const moonIcon = document.getElementById(THEME_ICON_MOON_ID);

    if (theme === 'light') {
        htmlEl.classList.remove('dark');
        if (sunIcon) sunIcon.classList.remove('hidden');
        if (moonIcon) moonIcon.classList.add('hidden');
    } else { // 'dark' or any other case defaults to dark
        htmlEl.classList.add('dark');
        if (sunIcon) sunIcon.classList.add('hidden');
        if (moonIcon) moonIcon.classList.remove('hidden');
    }
    appSettings.theme = theme; // Update current appSettings object
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
        updateSaveStatus('', 'clear');
        updateLastSavedDisplay();
    }
    window.history.pushState({ novelId, chapterId }, '', url);
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
    // Base classes are now set in HTML, just manage color and transform here.
    // Remove previous color classes
    statusEl.classList.remove('text-color-text-secondary', 'text-[var(--secondary)]', 'text-color-error', 'text-yellow-400' /* warning color example */);
    statusEl.classList.remove('scale-100', 'scale-105'); // Reset scale
    statusEl.setAttribute('aria-live', 'polite');


    if (message) {
        statusEl.classList.remove('opacity-0');
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
                statusEl.classList.add('text-[var(--secondary)]', 'scale-105'); // Use CSS var for secondary for success
                 statusEl.setAttribute('aria-live', 'assertive');
                if(lastSavedEl) updateLastSavedDisplay();
                break;
            case 'error':
                statusEl.classList.add('text-color-error', 'scale-100'); // Use CSS var for error
                statusEl.setAttribute('aria-live', 'assertive');
                if(lastSavedEl) updateLastSavedDisplay();
                break;
            case 'warning':
                statusEl.classList.add('text-yellow-400', 'scale-100'); // Tailwind yellow for warning
                isPersistent = true;
                if(lastSavedEl) updateLastSavedDisplay();
                break;
            default: // info
                statusEl.classList.add('text-color-text-secondary', 'scale-100');
                if(lastSavedEl) updateLastSavedDisplay();
                break;
        }

        if (!isPersistent && type !== 'clear') {
            saveStatusTimeout = setTimeout(() => {
                statusEl.classList.remove('opacity-100', 'scale-105');
                statusEl.classList.add('opacity-0'); // Fade out
                statusEl.setAttribute('aria-live', 'off');
                if(lastSavedEl) updateLastSavedDisplay();
            }, autoClearDelay);
        } else if (type === 'clear') {
             statusEl.classList.add('opacity-0');
             statusEl.setAttribute('aria-live', 'off');
             if(lastSavedEl) updateLastSavedDisplay();
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
    return true;
}


function setupGlobalEventListeners() {
    const menuBtn = document.getElementById(MENU_BTN_ID);
    menuBtn.addEventListener('click', toggleChapterDrawer);
    menuBtn.setAttribute('aria-controls', CHAPTER_DRAWER_ID);

    const themeToggleBtn = document.getElementById(THEME_TOGGLE_BTN_ID);
    themeToggleBtn.addEventListener('click', toggleTheme);


    document.getElementById(EXPORT_BTN_ID).addEventListener('click', openExportModal);
    document.getElementById(BACK_TO_LIBRARY_BTN_ID).addEventListener('click', async () => {
        if (!(await confirmDiscardChanges())) return;
        await saveCurrentChapterData();
        currentNovelId = null;
        currentChapterId = null;
        isEditorDirty = false;
        renderLibraryView();
    });
     window.addEventListener('resize', debounce(() => {
        if (currentNovelId && window.innerWidth >= 768) {
            const currentAppSettings = loadAppSettings(); // Re-load to get latest
            if (currentAppSettings.autoOpenDrawerDesktop) {
                openChapterDrawer();
            }
        }
    }, 200));

    window.addEventListener('beforeunload', (event) => {
        if (currentNovelId && isEditorDirty) {
            event.preventDefault();
            event.returnValue = ''; // Standard for most browsers
        }
    });
}

// -------------------- SETTINGS MODAL --------------------
function openSettingsModal() {
    triggerHapticFeedback([10]);
    const currentSettings = loadAppSettings(); // Load fresh settings
    const triggeringElement = document.activeElement;

    const overlay = document.createElement('div');
    overlay.id = 'settingsModalOverlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);

    overlay.innerHTML = `
        <div class="modal" role="dialog" aria-labelledby="settingsModalTitle" aria-modal="true">
            <h2 id="settingsModalTitle">Application Settings</h2>

            <div class="mb-4">
                <label for="settingDefaultAuthor" class="block text-sm font-medium text-color-onSurface mb-1">Default Author Name</label>
                <input type="text" id="settingDefaultAuthor" value="${currentSettings.defaultAuthor || ''}" placeholder="Your Pen Name" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface">
            </div>

            <div class="mb-6">
                <div class="flex items-center">
                    <input type="checkbox" id="settingAutoOpenDrawerDesktop" class="h-4 w-4 text-color-accent bg-gray-700 border-gray-600 rounded focus:ring-color-accent focus:ring-2" ${currentSettings.autoOpenDrawerDesktop ? 'checked' : ''}>
                    <label for="settingAutoOpenDrawerDesktop" class="ml-2 block text-sm text-color-onSurface select-none">
                        Automatically open chapter drawer on desktop when a novel is loaded
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

    defaultAuthorInput.focus();
    defaultAuthorInput.select();

    const focusableElements = Array.from(modalElement.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null);
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements[focusableElements.length - 1];

    const handleSaveSettings = () => {
        triggerHapticFeedback([20]);
        // Create a new settings object based on current appSettings, then update
        const newSettings = {
            ...appSettings, // Preserve existing settings like theme
            defaultAuthor: defaultAuthorInput.value.trim(),
            autoOpenDrawerDesktop: autoOpenDrawerCheckbox.checked,
        };
        saveAppSettings(newSettings);
        appSettings = newSettings; // Update global appSettings
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
             handleSaveSettings();
        } else if (ev.key === 'Escape') {
            handleCancelSettings();
        } else if (ev.key === 'Tab') {
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

    saveBtn.addEventListener('click', handleSaveSettings);
    cancelBtn.addEventListener('click', handleCancelSettings);
    overlay.addEventListener('click', ev => {
        if (ev.target === overlay) handleCancelSettings();
    });
    overlay.addEventListener('keydown', handleKeyDown);

    function cleanupSettingsModal() {
        overlay.classList.remove('active');
        document.body.classList.remove('body-modal-open');
        saveBtn.removeEventListener('click', handleSaveSettings);
        cancelBtn.removeEventListener('click', handleCancelSettings);
        overlay.removeEventListener('click', handleCancelSettings);
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
}

// -------------------- RENDER LIBRARY VIEW --------------------

function setupNovelSearch() {
    novelSearchInputEl = document.getElementById(NOVEL_SEARCH_INPUT_ID);
    novelSearchClearBtnEl = document.getElementById(NOVEL_SEARCH_CLEAR_BTN_ID);

    if (novelSearchInputEl) {
        novelSearchInputEl.value = currentNovelSearchTerm;
        novelSearchInputEl.addEventListener('input', () => {
            currentNovelSearchTerm = novelSearchInputEl.value.trim().toLowerCase();
            if (novelSearchClearBtnEl) novelSearchClearBtnEl.classList.toggle('hidden', !currentNovelSearchTerm);
            renderLibraryView(); // This re-renders, so event listeners might need to be re-attached if not careful
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
            if (novelSearchInputEl) novelSearchInputEl.focus();
        });
    }
}


function renderLibraryView() {
  updateURL(null, null);
  destroyEditorInstance();
  isEditorDirty = false;
  lastSuccessfulSaveTimestamp = null;
  updateLastSavedDisplay();

  document.getElementById(PAGE_TITLE_ID).innerText = 'My Novels';
  document.getElementById(EXPORT_BTN_ID).classList.add('hidden');
  const menuBtn = document.getElementById(MENU_BTN_ID);
  menuBtn.classList.add('md:hidden', 'hidden'); // Hide on library view
  menuBtn.setAttribute('aria-expanded', 'false');
  document.getElementById(CHAPTER_DRAWER_ID).classList.remove('open', 'translate-x-0');
  document.getElementById(CHAPTER_DRAWER_ID).classList.add('md:hidden', '-translate-x-full'); // Ensure drawer is hidden on library view
  document.getElementById(BACK_TO_LIBRARY_BTN_ID).classList.add('hidden');
  document.getElementById(EDIT_NOVEL_TITLE_BTN_ID).classList.add('hidden');
  const settingsBtn = document.getElementById(SETTINGS_BTN_ID);
  settingsBtn.classList.remove('hidden');
  settingsBtn.onclick = openSettingsModal;
  document.getElementById(THEME_TOGGLE_BTN_ID).classList.remove('hidden'); // Theme toggle always visible


  const contentArea = document.getElementById(CONTENT_AREA_ID);

  const novelSearchHTML = `
    <div class="relative w-full sm:max-w-xs">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg class="w-4 h-4 text-gray-500 dark:text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
        </div>
        <input type="text" id="${NOVEL_SEARCH_INPUT_ID}" placeholder="Search novels..." class="block w-full pl-10 pr-8 py-2.5 border border-color-border rounded-md bg-color-input-bg text-color-onSurface placeholder-color-text-secondary focus:ring-color-accent focus:border-color-accent sm:text-sm">
        <div class="absolute inset-y-0 right-0 pr-3 flex items-center">
            <button id="${NOVEL_SEARCH_CLEAR_BTN_ID}" class="text-gray-500 dark:text-gray-400 hover:text-color-onSurface hidden" aria-label="Clear novel search">
                 <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
    </div>`;

  const headerActionsHTML = `
    <button id="restoreNovelsBtn" title="Restore Novels" class="bg-gray-600 dark:bg-gray-700 text-white px-3 py-2.5 rounded-md hover:bg-gray-500 dark:hover:bg-gray-600 transition-opacity text-xs font-medium flex items-center gap-x-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.002 0A4.5 4.5 0 0117.25 18H6.75z" /> <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25A2.25 2.25 0 0017.25 12a2.25 2.25 0 00-2.25 2.25m4.5 0v6.75a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25v-6.75a2.25 2.25 0 012.25-2.25h10.5a2.25 2.25 0 012.25 2.25z" /></svg>Restore
    </button>
    <input type="file" id="restoreFileInput" class="hidden" accept=".json">
    <button id="backupNovelsBtn" title="Backup All Novels" class="bg-gray-600 dark:bg-gray-700 text-white px-3 py-2.5 rounded-md hover:bg-gray-500 dark:hover:bg-gray-600 transition-opacity text-xs font-medium flex items-center gap-x-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.002 0A4.5 4.5 0 0117.25 15H6.75z" /></svg>Backup All
    </button>
    <button id="newNovelBtn" class="bg-color-accent text-white px-4 py-2.5 rounded-md hover:opacity-80 transition-opacity text-sm font-medium flex items-center justify-center gap-x-1.5 sm:gap-x-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>New Novel
    </button>`;


  const filteredNovels = novels.filter(novel => {
      if (!currentNovelSearchTerm) return true;
      return (novel.title && novel.title.toLowerCase().includes(currentNovelSearchTerm)) ||
             (novel.author && novel.author.toLowerCase().includes(currentNovelSearchTerm));
  });


  if (novels.length === 0) {
    contentArea.innerHTML = `
        <div class="max-w-3xl mx-auto py-6 sm:py-8 flex flex-col items-center justify-center text-center h-full px-4">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-20 h-20 text-gray-500 dark:text-gray-400 mb-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6-2.292m0 0V12m0-3.75V6.042M12 12a2.25 2.25 0 0 0-2.25 2.25M12 12a2.25 2.25 0 0 1 2.25 2.25M12 12V9.75M12 9.75A2.25 2.25 0 0 1 9.75 7.5M12 9.75A2.25 2.25 0 0 0 14.25 7.5M12 15v2.25A2.25 2.25 0 0 0 14.25 19.5M12 15v2.25A2.25 2.25 0 0 1 9.75 19.5" />
            </svg>
            <h2 class="text-2xl font-semibold text-color-onBackground mb-3">Your Bookshelf Awaits</h2>
            <p class="text-color-text-secondary mb-8 max-w-md">Ready to bring your stories to life? Every great novel starts with a single word. Let's begin yours.</p>
            <button id="createFirstNovelBtnInPlaceholder" class="bg-color-accent text-white px-6 py-3 rounded-md hover:opacity-80 transition-opacity text-base font-medium flex items-center justify-center gap-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>Create Your First Novel
            </button>
            <div class="mt-12 flex items-center gap-x-2">
                ${headerActionsHTML.replace(/<button id="newNovelBtn".*?<\/button>/, '')}
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
          <ul id="novelList" class="space-y-3 px-4 sm:px-0">
          </ul>
        </div>
      `;
      const listEl = document.getElementById('novelList');

      if (filteredNovels.length === 0 && currentNovelSearchTerm) {
        const noResultsLi = document.createElement('li');
        noResultsLi.className = 'text-center text-color-text-secondary py-8';
        noResultsLi.innerHTML = `<p>No novels match "<strong>${currentNovelSearchTerm}</strong>".</p><p class="text-xs mt-1">Try a different search term or clear the search.</p>`;
        listEl.appendChild(noResultsLi);
      } else {
        filteredNovels.sort((a,b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).forEach(novel => {
          const li = document.createElement('li');
          li.className = 'bg-color-surface p-4 rounded-lg shadow hover:shadow-md transition-shadow flex justify-between items-center cursor-pointer group';
          li.setAttribute('aria-label', `Open novel: ${novel.title || 'Untitled Novel'}`);
          li.setAttribute('role', 'button');
          li.tabIndex = 0;

          const lastUpdatedTimestamp = novel.updatedAt || novel.createdAt;
          const relativeTime = formatRelativeTime(lastUpdatedTimestamp);
          const timePrefix = (lastUpdatedTimestamp === novel.createdAt && novel.updatedAt === novel.createdAt) || !novel.updatedAt ? 'Created' : 'Updated';

          const coverImageHTML = novel.coverDataURL
            ? `<img src="${novel.coverDataURL}" alt="Cover for ${novel.title || 'Untitled Novel'}" class="w-10 h-14 object-cover rounded-sm mr-3 flex-shrink-0">`
            : `<div class="w-10 h-14 bg-gray-200 dark:bg-gray-700 rounded-sm mr-3 flex items-center justify-center text-gray-400 dark:text-gray-500 flex-shrink-0">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6-2.292m0 0A9.043 9.043 0 0 0 9 7.5a9.043 9.043 0 0 0-3 1.5m0 0c0 1.657 1.343 3 3 3s3-1.343 3-3m0 0c0-1.657-1.343-3-3-3s-3 1.343-3 3m0 0-2.08.69A8.966 8.966 0 0 0 3 13.5v2.25m18 0v-2.25c0-.871-.239-1.683-.666-2.411l-2.08-.69M12 15V6.042" /></svg>
               </div>`;

          li.innerHTML = `
            <div class="flex items-center min-w-0">
                ${coverImageHTML}
                <div class="truncate">
                  <h3 class="font-semibold text-color-onSurface text-lg truncate pointer-events-none">${novel.title || 'Untitled Novel'}</h3>
                  <p class="text-xs text-color-text-secondary pointer-events-none">Chapters: ${novel.chapters.length} | ${timePrefix}: ${relativeTime || new Date(lastUpdatedTimestamp).toLocaleDateString()}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0 ml-2">
                <button data-action="open" aria-label="Open ${novel.title || 'Untitled Novel'}" class="text-sm bg-color-accent/80 text-white px-3 py-1.5 rounded group-hover:bg-color-accent group-focus-within:bg-color-accent transition-colors">Open</button>
                <button data-action="delete" title="Delete Novel" aria-label="Delete ${novel.title || 'Untitled Novel'}" class="text-color-error p-1.5 rounded-full hover:bg-color-error/20 group-focus-within:bg-color-error/20 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 pointer-events-none"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75H4.5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 0-1.5H14A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.531.096 2.182.275a.75.75 0 0 0 .541-.941A4.527 4.527 0 0 0 10 3c-.84 0-1.531.096-2.182.275a.75.75 0 0 0 .541.941A4.527 4.527 0 0 0 10 4ZM4.5 6.5A.75.75 0 0 0 3.75 7.25v7.5A2.75 2.75 0 0 0 6.5 17.5h7a2.75 2.75 0 0 0 2.75-2.75v-7.5A.75.75 0 0 0 15.5 6.5h-11Z" clip-rule="evenodd" /></svg>
                </button>
            </div>
          `;
          const openNovelAction = async () => {
            triggerHapticFeedback([10]);
            currentNovelId = novel.id;
            renderEditorView();
          };

          li.querySelector('button[data-action="open"]').addEventListener('click', (e) => {
            e.stopPropagation();
            openNovelAction();
          });
          li.querySelector('button[data-action="delete"]').addEventListener('click', async (e) => {
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
                renderLibraryView(); // Re-render the list
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

      if (listEl.children.length > 0 && !listEl.dataset.keyboardNavAttached && filteredNovels.length > 0) {
          listEl.dataset.keyboardNavAttached = 'true'; // Mark as attached
          listEl.addEventListener('keydown', (e) => { // Add new listener
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
                  items[currentIndex].focus();
              }
          });
      } else if (listEl.children.length === 0 || filteredNovels.length === 0) {
           delete listEl.dataset.keyboardNavAttached; // Clean up if no items
      }
      const newNovelBtn = document.getElementById('newNovelBtn');
      if (newNovelBtn) { // Ensure button exists before adding listener
        newNovelBtn.addEventListener('click', handleNewNovelClick);
      }
  }

  const backupBtn = document.getElementById('backupNovelsBtn');
  const restoreBtn = document.getElementById('restoreNovelsBtn');
  const restoreFileInput = document.getElementById('restoreFileInput');

  if(backupBtn) { // Check if element exists
    backupBtn.addEventListener('click', () => {
        triggerHapticFeedback([20]);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `novels_backup_${timestamp}.json`;
        const dataStr = JSON.stringify(novels, null, 2);
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

  if(restoreBtn && restoreFileInput) { // Check if elements exist
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
            // Basic validation, can be more thorough
            if (!Array.isArray(importedData) || !importedData.every(n => n && n.id && n.title !== undefined && Array.isArray(n.chapters) && n.chapters.every(c => c && c.id && c.title !== undefined && c.order !== undefined && c.contentHTML !== undefined))) {
                updateSaveStatus("Restore failed: Invalid backup file format.", 'error', 4000);
                restoreFileInput.value = ''; // Reset file input
                return;
            }
            const confirmed = await showConfirm({
                title: "Restore Novels",
                message: "Restoring will overwrite all current novels and their chapters. This action cannot be undone. Are you sure you want to continue?",
                okText: "Restore",
                cancelText: "Cancel"
            });
            if (confirmed) {
                triggerHapticFeedback([40]);
                novels = importedData.map(novel => ({ // Ensure all necessary fields are present or defaulted
                    ...novel,
                    language: novel.language || 'en-US', // Add default if missing
                    createdAt: novel.createdAt || new Date(0).toISOString(),
                    updatedAt: novel.updatedAt || novel.createdAt || new Date(0).toISOString(),
                    chapters: novel.chapters.map(chapter => ({
                        ...chapter,
                        createdAt: chapter.createdAt || new Date(0).toISOString(),
                        updatedAt: chapter.updatedAt || chapter.createdAt || new Date(0).toISOString(),
                    }))
                }));
                saveNovels(novels);
                currentNovelSearchTerm = ''; // Reset search term
                renderLibraryView();
                updateSaveStatus("Novels restored successfully!", "success");
            }
        } catch (e) {
            console.error("Restore error:", e);
            updateSaveStatus("Restore failed: Could not parse backup file.", 'error', 4000);
        }
        restoreFileInput.value = ''; // Reset file input
    });
  }
  setupNovelSearch(); // Call this after contentArea is populated

  // Focus logic
  if (filteredNovels.length > 0) {
    const firstLibraryItem = document.querySelector('#novelList li[tabindex="0"]');
    if (firstLibraryItem && (!document.activeElement || document.activeElement === document.body || document.activeElement === contentArea)) { // Check if focus is not already managed
      firstLibraryItem.focus();
    }
  } else if (novels.length === 0) { // No novels at all
    const createFirstBtn = document.getElementById('createFirstNovelBtnInPlaceholder');
    if (createFirstBtn && (!document.activeElement || document.activeElement === document.body)) {
      createFirstBtn.focus();
    }
  } else if (currentNovelSearchTerm && filteredNovels.length === 0) { // Search yielded no results
    if (novelSearchInputEl && (!document.activeElement || document.activeElement === document.body)) {
      novelSearchInputEl.focus();
    }
  }
}


async function handleNewNovelClick() {
    const title = await showPrompt({ title: 'New Novel Title', placeholder: 'Enter novel title…' });
    if (title === null) return; // User cancelled
    triggerHapticFeedback([40]);
    const currentSettings = loadAppSettings(); // Get latest settings
    const now = new Date().toISOString();
    const newNovel = {
      id: crypto.randomUUID(),
      title: title || "Untitled Novel",
      author: currentSettings.defaultAuthor || '',
      createdAt: now,
      updatedAt: now,
      coverDataURL: null,
      language: 'en-US', // Default language
      chapters: []
    };
    novels.push(newNovel);
    saveNovels(novels);
    currentNovelId = newNovel.id;
    renderEditorView();
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
            renderChapterList(novel); // Re-render chapter list with filter
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
            if(chapterSearchInputEl) chapterSearchInputEl.focus();
        });
    }
}

async function renderEditorView() {
  const novel = novels.find(n => n.id === currentNovelId);
  if (!novel) return renderLibraryView(); // Should not happen if called correctly

  appSettings = loadAppSettings(); // Load current settings
  currentNovelSearchTerm = ''; // Clear novel search when entering editor
  if (novelSearchInputEl) novelSearchInputEl.value = '';
  if (novelSearchClearBtnEl) novelSearchClearBtnEl.classList.add('hidden');


  updateURL(novel.id, currentChapterId);
  isEditorDirty = false; // Reset dirty flag for new view

  document.getElementById(PAGE_TITLE_ID).innerText = novel.title || 'Untitled Novel';
  document.getElementById(EXPORT_BTN_ID).classList.remove('hidden');
  const menuBtn = document.getElementById(MENU_BTN_ID);
  menuBtn.classList.remove('hidden', 'md:hidden'); // Show menu button on all screen sizes for editor
  document.getElementById(CHAPTER_DRAWER_ID).classList.remove('md:hidden'); // Drawer is potentially visible
  document.getElementById(BACK_TO_LIBRARY_BTN_ID).classList.remove('hidden');
  document.getElementById(EDIT_NOVEL_TITLE_BTN_ID).classList.remove('hidden');
  document.getElementById(SETTINGS_BTN_ID).classList.add('hidden'); // Hide app settings btn in editor
  document.getElementById(THEME_TOGGLE_BTN_ID).classList.remove('hidden'); // Theme toggle always visible


  if (window.innerWidth >= 768 && appSettings.autoOpenDrawerDesktop) {
    openChapterDrawer();
  } else {
    closeChapterDrawer(); // Ensure closed on mobile initially
  }

  renderChapterList(novel); // This also sets up chapter search

  const contentArea = document.getElementById(CONTENT_AREA_ID);
  contentArea.innerHTML = `
    <h3 id="${ACTIVE_CHAPTER_TITLE_DISPLAY_ID}" class="text-lg font-semibold mb-3 text-color-onSurface truncate px-1"></h3>
    <div class="flex flex-col h-[calc(100%-2.5rem)]"> <!-- Adjust height if title takes more space -->
      <div id="${EDITOR_CONTAINER_ID}" class="outline-none" tabindex="-1"></div> <!-- Placeholder for CKEditor -->
      <div id="${EDITOR_STATUS_BAR_ID}" class="flex-shrink-0 p-2 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)] flex justify-end items-center gap-x-3">
        <span id="${CHARACTER_COUNT_DISPLAY_ID}">Chars: 0</span>
        <span class="text-gray-600 dark:text-gray-400">|</span>
        <span id="${CHARACTER_COUNT_WITH_SPACES_DISPLAY_ID}">Chars (incl. spaces): 0</span>
        <span class="text-gray-600 dark:text-gray-400">|</span>
        <span id="${WORD_COUNT_DISPLAY_ID}">Words: 0</span>
      </div>
    </div>
  `;

  if (!novel.chapters.length) {
    currentChapterId = null; // No chapter to select
    clearEditorPlaceholder();
  } else {
    let chapterToLoad;
    if (currentChapterId && novel.chapters.some(c => c.id === currentChapterId)) {
      chapterToLoad = novel.chapters.find(c => c.id === currentChapterId);
    } else { // No current chapter or invalid ID, load first
      chapterToLoad = novel.chapters.sort((a,b) => a.order - b.order)[0];
      currentChapterId = chapterToLoad.id;
      updateURL(novel.id, currentChapterId); // Update URL if we selected first chapter
    }
    await loadChapterIntoEditor(chapterToLoad);
  }
}

// -------------------- RENDER CHAPTER LIST --------------------
function renderChapterList(novel) {
  const novelTitleDisplay = document.getElementById(NOVEL_TITLE_DISPLAY_ID);
  novelTitleDisplay.innerText = novel.title || 'Untitled Novel';

  const editNovelTitleBtn = document.getElementById(EDIT_NOVEL_TITLE_BTN_ID);
  editNovelTitleBtn.onclick = async () => {
      const newTitle = await showPrompt({
          title: 'Edit Novel Title',
          initialValue: novel.title,
          placeholder: 'Enter novel title...'
      });
      if (newTitle !== null && newTitle !== novel.title) {
          novel.title = newTitle || 'Untitled Novel';
          touchNovel(novel.id);
          saveNovels(novels);
          updateSaveStatus("Novel title updated", "success");
          triggerHapticFeedback([20]);
          document.getElementById(PAGE_TITLE_ID).innerText = novel.title; // Update header
          novelTitleDisplay.innerText = novel.title; // Update drawer title
      }
  };

  const listEl = document.getElementById(CHAPTER_LIST_ID);
  listEl.innerHTML = ''; // Clear previous items
  delete listEl.dataset.keyboardNavAttached; // Reset keyboard nav flag

  // Chapter Search Input - now part of chapter drawer's static HTML or added dynamically if not.
  // For simplicity, let's assume a placeholder div for search exists in the drawer HTML or add it here.
  // This example assumes it's part of the drawer's persistent structure or added by `renderEditorView`.
  // If not, you'd inject the search HTML here before the list.
  // This function now only renders the `ul` content.

  const chaptersToDisplay = novel.chapters.filter(ch => {
      if (!currentChapterSearchTerm) return true;
      return ch.title.toLowerCase().includes(currentChapterSearchTerm);
  }).sort((a, b) => a.order - b.order);


  if (novel.chapters.length === 0) {
    const emptyStateDiv = document.createElement('div');
    emptyStateDiv.className = 'flex flex-col items-center justify-center text-center p-6 h-full text-color-text-secondary';
    emptyStateDiv.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 text-gray-500 dark:text-gray-400 mb-3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m9.75 0A2.25 2.25 0 0 0 19.5 2.25m0 0A2.25 2.25 0 0 0 21.75 0M4.5 6.375A2.25 2.25 0 0 1 2.25 4.5m0 0A2.25 2.25 0 0 1 0 2.25m5.625 17.25a2.25 2.25 0 0 1-2.25-2.25V6.375c0-.621.504-1.125 1.125-1.125h12.75c.621 0 1.125.504 1.125 1.125V19.5a2.25 2.25 0 0 1-2.25-2.25M10.5 18.75h3" />
        </svg>
        <p class="text-base font-medium text-color-onSurface mb-1">No Chapters Here</p>
        <p class="text-xs">Tap the "+ New Chapter" button below to add your first one.</p>
    `;
    listEl.appendChild(emptyStateDiv);
    if (chapterSortable) { // Destroy sortable if no chapters
        chapterSortable.destroy();
        chapterSortable = null;
    }
  } else if (chaptersToDisplay.length === 0 && currentChapterSearchTerm) {
    const noResultsLi = document.createElement('li');
    noResultsLi.className = 'text-center text-color-text-secondary py-8 px-2';
    noResultsLi.innerHTML = `<p>No chapters match "<strong>${currentChapterSearchTerm}</strong>".</p><p class="text-xs mt-1">Try a different search term or clear the search.</p>`;
    listEl.appendChild(noResultsLi);
    if (chapterSortable) { // Destroy sortable if search yields no results
        chapterSortable.destroy();
        chapterSortable = null;
    }
  } else {
    let activeLi = null; // To scroll into view
    chaptersToDisplay.forEach(ch => {
      const li = document.createElement('li');
      li.dataset.chapterId = ch.id;
      // Removed bg-accent/15 from base, apply only if active
      li.className = `flex justify-between items-center p-2.5 rounded-md cursor-pointer group hover:bg-color-accent/10`;
      li.setAttribute('role', 'button');
      li.tabIndex = 0; // Make it focusable
      li.setAttribute('aria-label', `Open chapter: ${ch.order}. ${ch.title || 'Untitled Chapter'}`);

      li.innerHTML = `
        <span class="chapter-title truncate flex-1 text-sm flex items-center">
            <svg viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="drag-handle-icon w-4 h-4 mr-2 text-gray-500 dark:text-gray-400 group-hover:text-color-accent group-[.active-chapter]:text-color-accent transition-colors flex-shrink-0">
                <circle cx="2" cy="2" r="1.5"/> <circle cx="8" cy="2" r="1.5"/>
                <circle cx="2" cy="8" r="1.5"/> <circle cx="8" cy="8" r="1.5"/>
                <circle cx="2" cy="14" r="1.5"/> <circle cx="8" cy="14" r="1.5"/>
            </svg>
            ${ch.order}. ${ch.title || 'Untitled Chapter'}
        </span>
        <button data-action="delete" title="Delete Chapter" aria-label="Delete chapter ${ch.title || 'Untitled Chapter'}" class="delete-chapter-btn p-1 rounded-full hover:bg-color-error/20 group-focus-within:bg-color-error/20 opacity-60 hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 pointer-events-none text-color-error">
            <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75H4.5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 0-1.5H14A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.531.096 2.182.275a.75.75 0 0 0 .541-.941A4.527 4.527 0 0 0 10 3c-.84 0-1.531.096-2.182.275a.75.75 0 0 0 .541.941A4.527 4.527 0 0 0 10 4ZM4.5 6.5A.75.75 0 0 0 3.75 7.25v7.5A2.75 2.75 0 0 0 6.5 17.5h7a2.75 2.75 0 0 0 2.75-2.75v-7.5A.75.75 0 0 0 15.5 6.5h-11Z" clip-rule="evenodd" />
          </svg>
        </button>
      `;
      listEl.appendChild(li);

      if (ch.id === currentChapterId) {
        activeLi = li; // Store ref to active li
        li.classList.add('active-chapter', 'bg-color-accent/15'); // Add active specific classes
      }

      const loadThisChapter = async () => {
        if (!(await confirmDiscardChanges())) return;
        if (currentChapterId !== ch.id) { // Only proceed if different chapter
          triggerHapticFeedback([10]);
          await saveCurrentChapterData(); // Save previous before loading new
          currentChapterId = ch.id;
          updateURL(novel.id, ch.id);
          await loadChapterIntoEditor(ch); // Load new content
          // Update active classes
          listEl.querySelectorAll('li.active-chapter').forEach(item => item.classList.remove('active-chapter', 'bg-color-accent/15'));
          li.classList.add('active-chapter', 'bg-color-accent/15');
        }
        closeChapterDrawerOnMobile();
      };

      li.addEventListener('click', (event) => {
        // Prevent click on delete button from triggering chapter load
        if (event.target.closest('button[data-action="delete"]')) return;
        loadThisChapter();
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (document.activeElement === li) { // Ensure the keydown is on the focused item
                 loadThisChapter();
            }
        }
      });


      li.querySelector('[data-action="delete"]').addEventListener('click', async ev => {
        ev.stopPropagation(); // Prevent li click event
        const confirmed = await showConfirm({
          title: 'Delete Chapter',
          message: `Are you sure you want to delete chapter “${ch.title || 'Untitled Chapter'}”? This cannot be undone.`,
          okText: 'Delete',
          cancelText: 'Cancel'
        });
        if (!confirmed) return;
        triggerHapticFeedback([40]);
        const chapterWasActive = currentChapterId === ch.id;
        if(chapterWasActive) isEditorDirty = false; // Reset dirty flag if active chapter is deleted

        novel.chapters = novel.chapters.filter(c => c.id !== ch.id);
        renumberChapters(novel.chapters);
        touchNovel(novel.id);
        saveNovels(novels);
        updateSaveStatus("Chapter deleted", 'success', 1500);
        renderChapterList(novel); // Re-render to update list and sortable
        handlePostChapterDeletionFocus(); // Set focus appropriately after deletion

        if (chapterWasActive) { // If the deleted chapter was active
          currentChapterId = novel.chapters.sort((a,b) => a.order - b.order)[0]?.id || null; // Select first or null
          updateURL(novel.id, currentChapterId);
          if (currentChapterId) {
            await loadChapterIntoEditor(novel.chapters.find(c => c.id === currentChapterId));
          } else {
            clearEditorPlaceholder(); // No chapters left to edit
          }
        }
      });
    });

    // Scroll active chapter into view
    if (activeLi && typeof activeLi.scrollIntoView === 'function') {
        requestAnimationFrame(() => activeLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }

    // Keyboard navigation for chapter list items
    if (listEl.children.length > 0 && !listEl.dataset.keyboardNavAttached) {
        listEl.dataset.keyboardNavAttached = 'true';
        listEl.addEventListener('keydown', (e) => {
            const items = Array.from(listEl.querySelectorAll('li[tabindex="0"]'));
            if (!items.length) return;
            let currentFocusedIndex = items.findIndex(item => item === document.activeElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                if (currentFocusedIndex === -1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { // If no item is focused, focus the first
                    items[0].focus(); return;
                }
                if (e.key === 'ArrowDown') currentFocusedIndex = (currentFocusedIndex + 1) % items.length;
                else if (e.key === 'ArrowUp') currentFocusedIndex = (currentFocusedIndex - 1 + items.length) % items.length;
                else if (e.key === 'Home') currentFocusedIndex = 0;
                else if (e.key === 'End') currentFocusedIndex = items.length - 1;
                if (items[currentFocusedIndex]) items[currentFocusedIndex].focus();
            }
        });
    }


    // Initialize or re-initialize SortableJS
    if (chapterSortable) chapterSortable.destroy();
    chapterSortable = Sortable.create(listEl, {
      animation: 150,
      ghostClass: 'sortable-ghost', // Defined in chapterDrawer.css
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      handle: '.chapter-title', // Drag using the title span
      onEnd: evt => {
        triggerHapticFeedback([20,30,20]);
        // Update chapter order in the novel.chapters array
        const movedChapter = novel.chapters.splice(evt.oldDraggableIndex, 1)[0];
        novel.chapters.splice(evt.newDraggableIndex, 0, movedChapter);
        renumberChapters(novel.chapters); // Update 'order' property
        touchNovel(novel.id);
        saveNovels(novels);
        updateSaveStatus("Order saved", 'success', 1500);
        // Flash effect and re-render to ensure UI consistency
        listEl.classList.add('list-reordered-flash');
        setTimeout(() => {
            listEl.classList.remove('list-reordered-flash');
            renderChapterList(novel); // Re-render to solidify new order and active states
        }, 700); // Match animation duration
      }
    });
  }

  // Add Chapter Button
  document.getElementById(ADD_CHAPTER_BTN_ID).onclick = async () => {
    if (!(await confirmDiscardChanges())) return;
    const nextOrder = novel.chapters.length + 1;
    const title = await showPrompt({
      title: `New Chapter Title`,
      placeholder: `Chapter ${nextOrder}`
    });
    if (title === null) return; // User cancelled
    triggerHapticFeedback([40]);
    const now = new Date().toISOString();
    const newChapter = {
      id: crypto.randomUUID(),
      title: title || `Chapter ${nextOrder}`,
      order: nextOrder,
      contentHTML: '<p></p>', // Default empty content
      createdAt: now,
      updatedAt: now,
    };
    novel.chapters.push(newChapter);
    touchNovel(novel.id);
    saveNovels(novels);
    updateSaveStatus("Chapter created", 'success', 1500);

    const previousCurrentChapterId = currentChapterId; // Store before changing
    currentChapterId = newChapter.id; // Set new chapter as current
    updateURL(novel.id, currentChapterId);

    renderChapterList(novel); // Re-render list to include new chapter and mark active

    // Save previous chapter's data if it was a different chapter
    if (previousCurrentChapterId !== newChapter.id && previousCurrentChapterId !== null) {
        await saveCurrentChapterData(); // Ensures data from old chapter is saved
    }
    await loadChapterIntoEditor(newChapter); // Load new chapter into editor
    closeChapterDrawerOnMobile();
  };
   setupChapterListGestures(); // Re-setup gestures if list recreated
   setupChapterSearch(novel); // Ensure search is (re)initialized for this novel's chapter list
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
  drawer.classList.add('open', 'translate-x-0');
  drawer.classList.remove('-translate-x-full');
  menuBtn.setAttribute('aria-expanded', 'true');

  // Focus management when drawer opens
  setTimeout(() => { // Timeout to allow transition
    const chapterSearchInput = document.getElementById(CHAPTER_SEARCH_INPUT_ID);
    const editNovelTitleBtn = document.getElementById(EDIT_NOVEL_TITLE_BTN_ID);
    const backToLibraryBtn = document.getElementById(BACK_TO_LIBRARY_BTN_ID);
    const firstChapterItem = document.querySelector(`#${CHAPTER_LIST_ID} li[tabindex="0"]`);
    const addChapterBtn = document.getElementById(ADD_CHAPTER_BTN_ID);


    // Prioritize focus: search, then first interactive element
    if (chapterSearchInput && getComputedStyle(chapterSearchInput).display !== 'none' && chapterSearchInput.offsetParent !== null) { // Check visibility
        chapterSearchInput.focus();
    } else if (editNovelTitleBtn && getComputedStyle(editNovelTitleBtn).display !== 'none' && editNovelTitleBtn.offsetParent !== null) {
      editNovelTitleBtn.focus();
    } else if (backToLibraryBtn && getComputedStyle(backToLibraryBtn).display !== 'none' && backToLibraryBtn.offsetParent !== null) {
      backToLibraryBtn.focus();
    } else if (firstChapterItem) { // Ensure chapter item exists and is focusable
        firstChapterItem.focus();
    } else if (addChapterBtn && getComputedStyle(addChapterBtn).display !== 'none' && addChapterBtn.offsetParent !== null) {
      addChapterBtn.focus();
    }
  }, 100); // Small delay for transition
}

function closeChapterDrawer() {
  const drawer = document.getElementById(CHAPTER_DRAWER_ID);
  const menuBtn = document.getElementById(MENU_BTN_ID);
  const originallyFocusedElement = document.activeElement; // Store focused element before closing

  drawer.classList.remove('open', 'translate-x-0');
  drawer.classList.add('-translate-x-full');
  menuBtn.setAttribute('aria-expanded', 'false');

  // Return focus to the menu button if it was the trigger or if focus was inside drawer
  if (menuBtn && getComputedStyle(menuBtn).display !== 'none' && menuBtn.offsetParent !== null) { // If menuBtn is visible
    if (drawer.contains(originallyFocusedElement) || originallyFocusedElement === drawer || originallyFocusedElement === menuBtn) {
        menuBtn.focus();
    }
  }
}

function toggleChapterDrawer() {
    triggerHapticFeedback([10]);
    const drawer = document.getElementById(CHAPTER_DRAWER_ID);
    // Check based on class that indicates it's visually open
    if (drawer.classList.contains('translate-x-0') || drawer.classList.contains('open')) {
        closeChapterDrawer();
    } else {
        openChapterDrawer();
    }
}

function closeChapterDrawerOnMobile() {
  if (window.innerWidth < 768) { // Tailwind 'md' breakpoint
    closeChapterDrawer();
  }
}

// -------------------- CKEDITOR: LOAD & SAVE --------------------
function calculateWordCount(htmlString) {
  if (!htmlString) return 0;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;
  const text = tempDiv.textContent || tempDiv.innerText || "";
  const words = text.match(/\b[\w'-]+\b/g); // Improved regex for words
  return words ? words.length : 0;
}

function calculateCharacterCount(htmlString, excludeSpaces = true) {
    if (!htmlString) return 0;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    let text = tempDiv.textContent || tempDiv.innerText || "";
    if (excludeSpaces) {
        text = text.replace(/\s/g, '');
    }
    return text.length;
}

const debouncedUpdateWordCount = debounce(() => {
  if (editorInstance) {
    const htmlContent = editorInstance.getData();
    const count = calculateWordCount(htmlContent);
    const displayEl = document.getElementById(WORD_COUNT_DISPLAY_ID);
    if (displayEl) displayEl.textContent = `Words: ${count}`;
  }
}, 300);

const debouncedUpdateCharacterCount = debounce(() => {
    if (editorInstance) {
        const htmlContent = editorInstance.getData();
        const count = calculateCharacterCount(htmlContent); // Default excludes spaces
        const displayEl = document.getElementById(CHARACTER_COUNT_DISPLAY_ID);
        if (displayEl) displayEl.textContent = `Chars: ${count}`;
    }
}, 300);

const debouncedUpdateCharacterCountWithSpaces = debounce(() => {
    if (editorInstance) {
        const htmlContent = editorInstance.getData();
        const count = calculateCharacterCount(htmlContent, false); // Include spaces
        const displayEl = document.getElementById(CHARACTER_COUNT_WITH_SPACES_DISPLAY_ID);
        if (displayEl) displayEl.textContent = `Chars (incl. spaces): ${count}`;
    }
}, 300);

async function saveChapterContentInternal() {
    if (!editorInstance || !currentChapterId || !currentNovelId) {
        // console.warn("Save conditions not met:", { editorInstance, currentChapterId, currentNovelId });
        return false; // Indicate save did not proceed
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
        touchNovel(novel.id); // Update novel's updatedAt timestamp
        saveNovels(novels); // Save all novels data
        updateSaveStatus("Saved ✓", 'success');
        triggerHapticFeedback([20]);
        isEditorDirty = false; // Reset dirty flag
        lastSuccessfulSaveTimestamp = new Date(); // Update last saved time
        updateLastSavedDisplay(); // Update UI for last saved
        return true; // Indicate success
    } else {
        updateSaveStatus("Save failed: chapter not found", 'error');
        isEditorDirty = true; // Remain dirty if save failed due to chapter not found
        return false; // Indicate failure
    }
}

const debouncedSave = debounce(saveChapterContentInternal, 1000);

async function loadChapterIntoEditor(chapter) {
  const editorPlaceholderEl = document.getElementById(EDITOR_CONTAINER_ID);
  const activeChapterTitleDisplayEl = document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID);

  // Initial loading state
  if (editorPlaceholderEl) {
    editorPlaceholderEl.innerHTML = `
        <div class="flex items-center justify-center h-full text-color-text-secondary p-8 text-center">
            <svg class="animate-spin w-5 h-5 mr-2 text-color-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>Loading chapter...
        </div>`;
  }
  if (activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = 'Loading...';

  // Reset counts and dirty flag
  const wordCountEl = document.getElementById(WORD_COUNT_DISPLAY_ID);
  if(wordCountEl) wordCountEl.textContent = "Words: 0";
  const charCountEl = document.getElementById(CHARACTER_COUNT_DISPLAY_ID);
  if(charCountEl) charCountEl.textContent = "Chars: 0";
  const charCountWithSpacesEl = document.getElementById(CHARACTER_COUNT_WITH_SPACES_DISPLAY_ID);
  if(charCountWithSpacesEl) charCountWithSpacesEl.textContent = "Chars (incl. spaces): 0";
  isEditorDirty = false;

  if (!chapter) {
    clearEditorPlaceholder(); // Handle case where no chapter is provided
    return;
  }
  await destroyEditorInstance(); // Clean up previous editor if any

  if (!editorPlaceholderEl) { // Should not happen if HTML structure is correct
    console.error("Editor placeholder element not found after potential destroy");
    if (activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = 'Error loading chapter';
    return;
  }

  // Update chapter title display
  if (activeChapterTitleDisplayEl) {
      activeChapterTitleDisplayEl.textContent = chapter.title || 'Untitled Chapter';
  }

  try {
    editorInstance = await ClassicEditor.create(editorPlaceholderEl, { // ClassicEditor replaces the placeholder
      toolbar: [
        'heading', '|', 'bold', 'italic', 'underline', 'strikethrough', '|',
        'link', 'blockQuote', 'insertTable', 'codeBlock', '|',
        'bulletedList', 'numberedList', '|', 'undo', 'redo', '|', 'findAndReplace'
      ],
      table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
      codeBlock: {
        languages: [ // Common languages for code blocks
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

    // Apply layout classes to the editor's root element (created by ClassicEditor)
    if (editorInstance && editorInstance.ui && editorInstance.ui.element) {
        editorInstance.ui.element.classList.add('flex-grow', 'min-h-0', 'flex', 'flex-col');
    }
    
    editorInstance.setData(chapter.contentHTML || '<p></p>'); // Set initial content
    isEditorDirty = false; // Not dirty on load

    // Focus the editor
    if (editorInstance.editing && typeof editorInstance.editing.view.focus === 'function') {
        editorInstance.editing.view.focus();
    }
     // Setup gestures on the new editor's editable area
    if (editorInstance.ui.view.editable.element) {
        setupEditorGestures(editorInstance.ui.view.editable.element);
    }


    // Initial counts
    const initialContent = editorInstance.getData();
    const initialWordCount = calculateWordCount(initialContent);
    if(wordCountEl) wordCountEl.textContent = `Words: ${initialWordCount}`;
    const initialCharCount = calculateCharacterCount(initialContent);
    if(charCountEl) charCountEl.textContent = `Chars: ${initialCharCount}`;
    const initialCharCountWithSpaces = calculateCharacterCount(initialContent, false);
    if(charCountWithSpacesEl) charCountWithSpacesEl.textContent = `Chars (incl. spaces): ${initialCharCountWithSpaces}`;

    lastSuccessfulSaveTimestamp = new Date(chapter.updatedAt); // Use chapter's last update time
    updateLastSavedDisplay();

    // Listen for changes to save and update counts
    editorInstance.model.document.on('change:data', () => {
        isEditorDirty = true;
        updateSaveStatus("Unsaved changes", 'warning'); // Show unsaved changes warning
        debouncedSave(); // Debounce save operation
        debouncedUpdateWordCount();
        debouncedUpdateCharacterCount();
        debouncedUpdateCharacterCountWithSpaces();
    });
    updateSaveStatus('', 'clear'); // Clear any previous save status

    // Scroll to top of editor on load
    if (editorInstance?.ui?.view?.editable?.element) {
        requestAnimationFrame(() => { // Ensure element is rendered
            if (editorInstance?.ui?.view?.editable?.element) { // Check again inside rAF
                 editorInstance.ui.view.editable.element.scrollTop = 0;
            }
        });
    }

  } catch (error) {
    console.error('CKEditor initialization error:', error);
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
    // If a debounced save is pending, clear it and save immediately
    clearTimeout(debouncedSave._timeoutId); // Access internal timeout ID
    return await saveChapterContentInternal(); // Perform immediate save
  }
  return false; // Indicate save was not attempted or failed pre-condition
}

async function destroyEditorInstance() {
    // Save if dirty before destroying
    if (isEditorDirty) {
      await saveCurrentChapterData(); // This will attempt an immediate save
    }
    destroyEditorGestures(); // Clean up Hammer.js instance for editor
    if (editorInstance) {
        try {
            await editorInstance.destroy();
        } catch (error) {
            console.error("Error destroying editor instance:", error);
        }
        editorInstance = null;
    }
    isEditorDirty = false; // Reset dirty flag after destruction
}

function clearEditorPlaceholder() {
  const activeChapterTitleDisplayEl = document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID);
  destroyEditorInstance().then(() => { // Ensure previous editor is gone
    const editorContainer = document.getElementById(EDITOR_CONTAINER_ID);
    if (editorContainer) {
        editorContainer.classList.add('flex-grow', 'min-h-0'); // Ensure placeholder fills space
        const novel = novels.find(n => n.id === currentNovelId);
        if (novel && novel.chapters.length === 0) { // No chapters in current novel
            if(activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = "Write Your First Chapter";
            editorContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-center p-4 text-color-text-secondary">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-16 h-16 text-gray-500 dark:text-gray-400 mb-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <h3 class="text-xl font-semibold text-color-onSurface mb-2">Let's begin your story!</h3>
                    <p class="mb-4 max-w-xs">Every great novel starts with a single chapter. What will yours be about?</p>
                    <button id="createFirstChapterBtnInPlaceholder" class="bg-color-accent text-white px-6 py-2.5 rounded-md hover:opacity-80 transition-opacity font-medium flex items-center gap-2">
                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        Create Your First Chapter
                    </button>
                </div>
            `;
            const createFirstChapterBtn = document.getElementById('createFirstChapterBtnInPlaceholder');
            if (createFirstChapterBtn) { // Attach click handler to the main add chapter button's logic
                createFirstChapterBtn.onclick = document.getElementById(ADD_CHAPTER_BTN_ID).onclick;
                createFirstChapterBtn.focus(); // Focus the button
            }
        } else { // Chapters exist, but none selected (or general placeholder)
            if(activeChapterTitleDisplayEl) activeChapterTitleDisplayEl.textContent = 'No Chapter Selected';
            editorContainer.innerHTML = '<div class="flex items-center justify-center h-full text-color-text-secondary p-8 text-center"><p>Select a chapter to start editing, or create a new one.</p></div>';
        }
    }
    // Reset counts and status
    const wordCountEl = document.getElementById(WORD_COUNT_DISPLAY_ID);
    if(wordCountEl) wordCountEl.textContent = "Words: 0";
    const charCountEl = document.getElementById(CHARACTER_COUNT_DISPLAY_ID);
    if(charCountEl) charCountEl.textContent = "Chars: 0";
    const charCountWithSpacesEl = document.getElementById(CHARACTER_COUNT_WITH_SPACES_DISPLAY_ID);
    if(charCountWithSpacesEl) charCountWithSpacesEl.textContent = "Chars (incl. spaces): 0";
    updateSaveStatus('', 'clear'); // Clear save status
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
    return `body { font-family: sans-serif; margin: 5%; line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.2; text-align:left; }
p { margin-top: 0.5em; margin-bottom: 0.5em; text-align:justify; }
img { max-width: 100%; height: auto; display:block; margin: 1em auto; }
div.cover-image-container { width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; margin:0; padding:0; }
div.cover-image-container img { max-width: 100%; max-height: 100vh; object-fit: contain; }
`;
}

function generateCoverXHTML(coverFilename, language) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>Cover</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
  <div class="cover-image-container">
    <img src="images/${coverFilename}" alt="Cover Image"/>
  </div>
</body>
</html>`;
}


function generateContentOPF(novel, exportTitle, exportAuthor, exportLanguage, chapters, coverMeta) {
    const chapterItemsManifest = chapters.map(ch =>
        `<item id="chapter-${ch.id}" href="${sanitizeFilename(`chapter-${ch.order}_${ch.title || 'chapter-' + ch.order}`)}.xhtml" media-type="application/xhtml+xml"/>`
    ).join('\n        ');

    const chapterItemsSpine = chapters.map(ch =>
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
        coverMetaTag = `<meta name="cover" content="cover-image"/>`;
        coverSpineItem = `<itemref idref="cover-page" linear="yes"/>`; // Cover page is usually linear
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
    <dc:date>${(novel.updatedAt || novel.createdAt || new Date()).toISOString().split('T')[0]}</dc:date>
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

function generateTocNCX(novel, exportTitle, chapters) {
    const navPoints = chapters.map(ch => `
    <navPoint id="navpoint-${ch.order}" playOrder="${ch.order}">
      <navLabel><text>${ch.title || `Chapter ${ch.order}`}</text></navLabel>
      <content src="${sanitizeFilename(`chapter-${ch.order}_${ch.title || 'chapter-' + ch.order}`)}.xhtml"/>
    </navPoint>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${novel.id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${exportTitle}</text></docTitle>
  <navMap>${navPoints}
  </navMap>
</ncx>`;
}

function generateChapterXHTML(chapter, language) {
    const title = chapter.title || `Chapter ${chapter.order}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
  <h2>${title}</h2>
  ${chapter.contentHTML || '<p></p>'}
</body>
</html>`;
}

// -------------------- EXPORT MODAL --------------------
async function openExportModal() {
    if (!currentNovelId) return;
    await saveCurrentChapterData(); // Ensure latest data is saved
    const novel = novels.find(n => n.id === currentNovelId);
    if (!novel) return;

    if (novel.chapters.length === 0) {
        await showConfirm({title: "Export Error", message: "Please add at least one chapter to your novel before exporting.", okText: "OK"});
        return;
    }
    triggerHapticFeedback([10]);
    const triggeringElement = document.activeElement;
    let overlay = document.getElementById('exportModalOverlay');
    if (overlay) overlay.remove(); // Remove if already exists

    overlay = document.createElement('div');
    overlay.id = 'exportModalOverlay';
    overlay.className = 'modal-overlay';

    const currentSettings = loadAppSettings(); // For default author
    const languageOptions = [
        { value: 'en-US', text: 'English (US)' }, { value: 'en-GB', text: 'English (UK)' },
        { value: 'es-ES', text: 'Spanish (Spain)' }, { value: 'es-MX', text: 'Spanish (Mexico)' },
        { value: 'fr-FR', text: 'French (France)' }, { value: 'de-DE', text: 'German' },
        { value: 'it-IT', text: 'Italian' }, { value: 'pt-PT', text: 'Portuguese (Portugal)' },
        { value: 'pt-BR', text: 'Portuguese (Brazil)' }, { value: 'ja-JP', text: 'Japanese' },
        { value: 'zh-CN', text: 'Chinese (Simplified)' }, { value: 'other', text: 'Other (Specify)' }
    ];
    
    let initialLanguageIsOther = false;
    let initialOtherLanguageValue = '';
    // Check if current novel language is not in the predefined list (excluding 'other')
    if (novel.language && !languageOptions.some(opt => opt.value === novel.language && opt.value !== 'other')) {
        initialLanguageIsOther = true;
        initialOtherLanguageValue = novel.language;
    }

    const languageSelectHTML = languageOptions.map(opt =>
        // Select 'other' if initialLanguageIsOther, or select the specific language if it matches
        `<option value="${opt.value}" ${ (initialLanguageIsOther && opt.value === 'other') || (!initialLanguageIsOther && novel.language === opt.value) ? 'selected' : ''}>${opt.text}</option>`
    ).join('');


    overlay.innerHTML = `
        <div class="modal" role="dialog" aria-labelledby="exportModalTitle" aria-modal="true" style="max-width: 500px;">
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
                <label for="exportLanguageInput" class="block text-sm font-medium text-color-onSurface mb-1">Language</label>
                <select id="exportLanguageInput" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface">
                    ${languageSelectHTML}
                </select>
                <input type="text" id="exportLanguageOtherInput" placeholder="e.g., fr-CA, pt-PT" value="${initialLanguageIsOther ? initialOtherLanguageValue : ''}" class="w-full p-2 bg-color-input-bg border border-color-border rounded text-color-onSurface mt-2 ${initialLanguageIsOther ? '' : 'hidden'}">
            </div>

            <div class="mb-4">
                <label for="coverInput" class="block text-sm font-medium text-color-onSurface mb-1">Cover Image (PNG, JPG, max 2MB)</label>
                <div id="coverPreviewContainer" class="mb-2"> <!-- Themed in modals.css -->
                    <img id="coverPreviewImage" src="#" alt="Cover Preview" class="hidden">
                    <div id="coverPreviewPlaceholder">No cover selected.</div>
                </div>
                <input type="file" id="coverInput" accept="image/png, image/jpeg" class="w-full text-sm file:mr-2 file:py-1 file:px-2 file:rounded-md file:border file:border-color-border file:text-sm file:font-semibold file:bg-color-input-bg file:text-color-accent hover:file:bg-color-accent/10">
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
                    <button id="saveNovelDetailsBtn" class="btn btn-secondary w-full">Save Details</button>
                    <button id="closeExportBtn" class="btn btn-secondary w-full">Close</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('body-modal-open'); // Prevent body scroll
    requestAnimationFrame(() => overlay.classList.add('active')); // Animate in

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

    let currentCoverDataURL = novel.coverDataURL; // Use current novel's cover as starting point

    const updateCoverPreview = (dataURL) => {
        if (dataURL && !dataURL.startsWith('data:image/svg+xml')) { // Handle non-SVG images
            coverPreviewImageEl.src = dataURL;
            coverPreviewImageEl.classList.remove('hidden');
            coverPreviewPlaceholderEl.classList.add('hidden');
            removeCoverBtnEl.classList.remove('hidden');
        } else if (dataURL && dataURL.startsWith('data:image/svg+xml')) { // Handle SVGs (no direct preview)
            coverPreviewImageEl.classList.add('hidden'); // Hide img tag for SVG
            coverPreviewPlaceholderEl.textContent = 'SVG cover selected (preview not available).';
            coverPreviewPlaceholderEl.classList.remove('hidden');
            removeCoverBtnEl.classList.remove('hidden');
        } else { // No cover
            coverPreviewImageEl.src = '#'; // Reset src
            coverPreviewImageEl.classList.add('hidden');
            coverPreviewPlaceholderEl.textContent = 'No cover selected.';
            coverPreviewPlaceholderEl.classList.remove('hidden');
            removeCoverBtnEl.classList.add('hidden');
            if (coverFileNameDisplayEl) { // Clear filename display
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
            languageOtherInputEl.value = ''; // Clear if not 'other'
        }
    });
    // Initial state for 'Other' language input (already handled by class in HTML based on initialLanguageIsOther)
    if (languageInputEl.value === 'other') {
        languageOtherInputEl.classList.remove('hidden');
    }


    updateCoverPreview(currentCoverDataURL); // Show initial cover

    coverInputEl.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        coverFileNameDisplayEl.textContent = ''; // Reset filename display
        coverFileNameDisplayEl.classList.add('hidden');

        if (file) {
            if (file.size > 2 * 1024 * 1024) { // 2MB limit
                await showConfirm({title: "File Too Large", message: "Cover image must be less than 2MB.", okText:"OK"});
                coverInputEl.value = ''; // Reset file input
                return;
            }
            coverFileNameDisplayEl.textContent = file.name;
            coverFileNameDisplayEl.classList.remove('hidden');
            coverPreviewPlaceholderEl.textContent = "Processing image..."; // Loading state
            coverPreviewPlaceholderEl.classList.remove('hidden');
            coverPreviewImageEl.classList.add('hidden');
            try {
                currentCoverDataURL = await fileToDataURL(file); // Convert to DataURL
                updateCoverPreview(currentCoverDataURL);
            } catch (err) {
                console.error("Cover processing error:", err);
                currentCoverDataURL = novel.coverDataURL; // Revert to original if error
                updateCoverPreview(currentCoverDataURL);
                await showConfirm({title: "Image Error", message: "Could not process the selected image.", okText:"OK"});
                coverFileNameDisplayEl.textContent = ''; // Clear filename on error
                coverFileNameDisplayEl.classList.add('hidden');
            }
        } else { // No file selected (e.g., user cancelled file dialog)
            currentCoverDataURL = novel.coverDataURL; // Revert to novel's current cover
            updateCoverPreview(currentCoverDataURL);
        }
    });

    removeCoverBtnEl.addEventListener('click', () => {
        triggerHapticFeedback([10]);
        currentCoverDataURL = null; // Clear the stored DataURL
        coverInputEl.value = ''; // Reset file input
        updateCoverPreview(null); // Update UI
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
            if (!newLanguage) newLanguage = novel.language || 'en-US'; // Default back if empty
        }
        if (newLanguage !== novel.language) {
            novel.language = newLanguage;
            changed = true;
        }

        // Compare the currentCoverDataURL (from modal state) with novel.coverDataURL
        if (currentCoverDataURL !== novel.coverDataURL) {
            novel.coverDataURL = currentCoverDataURL;
            changed = true;
        }

        if (changed) {
            touchNovel(novel.id); // Mark novel as updated
            saveNovels(novels); // Save all novels
            // Update UI elements if they are visible
            document.getElementById(PAGE_TITLE_ID).innerText = novel.title;
            if (document.getElementById(NOVEL_TITLE_DISPLAY_ID)) { // Check if drawer title is rendered
                 document.getElementById(NOVEL_TITLE_DISPLAY_ID).innerText = novel.title;
            }
        }
        return changed; // Return true if any detail changed
    };

    saveDetailsBtn.addEventListener('click', async () => {
        const detailsChanged = await handleNovelMetadataUpdate();
        if (detailsChanged) {
            triggerHapticFeedback([20]);
            updateSaveStatus("Novel details saved ✓", "success");
        } else {
            updateSaveStatus("No changes to save.", "info", 1500); // Inform if no changes
        }
    });


    overlay.querySelector('#downloadEPUBBtn').addEventListener('click', async () => {
        await handleNovelMetadataUpdate(); // Save details before export
        const exportTitle = novel.title || 'Untitled Novel';
        const exportAuthor = novel.author || currentSettings.defaultAuthor || 'Unknown Author';
        let exportLanguage = novel.language || 'en-US';
        if (exportLanguage.includes(',')) exportLanguage = exportLanguage.split(',')[0].trim(); // Take first if multiple

        const finalCoverDataURL = novel.coverDataURL;

        try {
            if (typeof JSZip === 'undefined') {
                throw new Error("JSZip library is not loaded.");
            }
            const zip = new JSZip();

            // 1. mimetype file (must be first and uncompressed)
            zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

            // 2. META-INF/container.xml
            const oebpsFolder = zip.folder("OEBPS");
            zip.folder("META-INF").file("container.xml", generateContainerXML());
            
            // 3. CSS
            const cssFolder = oebpsFolder.folder("css");
            cssFolder.file("style.css", generateStyleCSS());

            // 4. Cover Image and XHTML
            let coverMetaInfo = null;
            if (finalCoverDataURL && !finalCoverDataURL.startsWith('data:image/svg+xml')) { // SVGs are problematic for EPUB2 covers
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
            } else if (finalCoverDataURL && finalCoverDataURL.startsWith('data:image/svg+xml')) {
                console.warn("SVG covers are not reliably supported in EPUB2 and will be skipped.");
                await showConfirm({title: "Cover Warning", message: "SVG cover images are not reliably supported for EPUB export and will be skipped.", okText: "OK"});
            }


            // 5. Chapters (XHTML)
            const sortedChapters = novel.chapters.slice().sort((a, b) => a.order - b.order);
            sortedChapters.forEach(ch => {
                const chapterFilename = sanitizeFilename(`chapter-${ch.order}_${ch.title || 'chapter-' + ch.order}`) + ".xhtml";
                oebpsFolder.file(chapterFilename, generateChapterXHTML(ch, exportLanguage));
            });

            // 6. OPF (content.opf)
            oebpsFolder.file("content.opf", generateContentOPF(novel, exportTitle, exportAuthor, exportLanguage, sortedChapters, coverMetaInfo));

            // 7. NCX (toc.ncx)
            oebpsFolder.file("toc.ncx", generateTocNCX(novel, exportTitle, sortedChapters));

            const epubBlob = await zip.generateAsync({ type: 'blob', mimeType: "application/epub+zip" });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(epubBlob);
            link.download = `${sanitizeFilename(exportTitle)}.epub`;
            link.click();
            URL.revokeObjectURL(link.href);
            updateSaveStatus("EPUB exported successfully!", "success");
            triggerHapticFeedback([40]);

        } catch (error) {
            console.error("EPUB Generation Error:", error);
            await showConfirm({title: "EPUB Export Failed", message: `Could not generate EPUB. ${error.message}. Please check console for details.`, okText:"OK"});
        }
    });

    overlay.querySelector('#downloadZIPBtn').addEventListener('click', async () => {
        await handleNovelMetadataUpdate(); // Save details first
        const exportTitle = novel.title || 'Untitled Novel';
        const exportAuthor = novel.author || currentSettings.defaultAuthor || 'Unknown Author';
        const exportLanguage = novel.language || 'en-US';

        try {
            if (typeof JSZip === 'undefined' || typeof TurndownService === 'undefined') { // Check libraries
                throw new Error("JSZip or TurndownService library is not loaded.");
            }
            const zip = new JSZip();
            const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }); // Turndown options

            // Add metadata file
            const createdDate = novel.createdAt ? new Date(novel.createdAt).toLocaleDateString() : 'N/A';
            const updatedDate = novel.updatedAt ? new Date(novel.updatedAt).toLocaleDateString() : 'N/A';
            const metadataContent = `
# ${exportTitle}
**Author:** ${exportAuthor}
**Language:** ${exportLanguage}
**Created:** ${createdDate}
**Last Updated:** ${updatedDate}
**Total Chapters:** ${novel.chapters.length}
---
            `;
            zip.file('novel_metadata.md', metadataContent.trim());


            // Add chapters as Markdown files
            novel.chapters.sort((a,b) => a.order - b.order).forEach((ch) => {
                const base = `${String(ch.order).padStart(2,'0')}_${sanitizeFilename(ch.title || `chapter-${ch.order}`)}`;
                const md = turndownService.turndown(ch.contentHTML || ''); // Convert HTML to Markdown
                zip.file(`${base}.md`, md);
            });
            const blob = await zip.generateAsync({ type: 'blob' }); // Generate ZIP
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${sanitizeFilename(exportTitle)}.zip`;
            link.click();
            URL.revokeObjectURL(link.href); // Clean up
            updateSaveStatus("ZIP (MD) exported successfully!", "success");
            triggerHapticFeedback([40]);
        } catch (error) {
             console.error("ZIP Generation Error:", error);
            await showConfirm({title: "ZIP Export Failed", message: `Could not generate ZIP archive. ${error.message}. Please check console for details.`, okText:"OK"});
        }
    });

    overlay.querySelector('#downloadTXTZipBtn').addEventListener('click', async () => {
        await handleNovelMetadataUpdate(); // Save details first
        const exportTitle = novel.title || 'Untitled Novel';
        const exportAuthor = novel.author || currentSettings.defaultAuthor || 'Unknown Author';
        const exportLanguage = novel.language || 'en-US';

        try {
            if (typeof JSZip === 'undefined') {
                throw new Error("JSZip library is not loaded.");
            }
            const zip = new JSZip();
            
            // Add plain text metadata file
            const createdDate = novel.createdAt ? new Date(novel.createdAt).toLocaleDateString() : 'N/A';
            const updatedDate = novel.updatedAt ? new Date(novel.updatedAt).toLocaleDateString() : 'N/A';
            const metadataContent = `Title: ${exportTitle}\nAuthor: ${exportAuthor}\nLanguage: ${exportLanguage}\nCreated: ${createdDate}\nLast Updated: ${updatedDate}\nTotal Chapters: ${novel.chapters.length}\n---\n`;
            zip.file('novel_metadata.txt', metadataContent);

            // Add chapters as TXT files
            novel.chapters.sort((a,b) => a.order - b.order).forEach((ch) => {
                const base = `${String(ch.order).padStart(2,'0')}_${sanitizeFilename(ch.title || `chapter-${ch.order}`)}`;
                const txt = htmlToPlainText(ch.contentHTML || ''); // Convert HTML to Plain Text
                zip.file(`${base}.txt`, txt);
            });

            const blob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${sanitizeFilename(exportTitle)}_txt.zip`; // Distinguish filename
            link.click();
            URL.revokeObjectURL(link.href);
            updateSaveStatus("ZIP (TXT) exported successfully!", "success");
            triggerHapticFeedback([40]);

        } catch (error) {
            console.error("TXT ZIP Generation Error:", error);
            await showConfirm({title: "TXT ZIP Export Failed", message: `Could not generate TXT ZIP archive. ${error.message}. Please check console for details.`, okText:"OK"});
        }
    });


    // Modal focus and close logic
    const modalElement = overlay.querySelector('.modal');
    const focusableElements = Array.from(modalElement.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null); // Visible focusable elements
    const firstFocusableElement = focusableElements[0] || titleInputEl; // Default to title input
    const lastFocusableElement = focusableElements[focusableElements.length - 1];
    
    if(firstFocusableElement) firstFocusableElement.focus(); // Focus first element


    const closeBtn = overlay.querySelector('#closeExportBtn');
    const handleClose = () => {
        triggerHapticFeedback([10]);
        overlay.classList.remove('active'); // Animate out
        document.body.classList.remove('body-modal-open');
        setTimeout(() => {
            if (document.body.contains(overlay)) { // Check if still in DOM
                 document.body.removeChild(overlay);
            }
            if (triggeringElement && typeof triggeringElement.focus === 'function') { // Return focus
                triggeringElement.focus();
            }
        }, 200); // Match transition duration
    };

    const handleKeyDown = (ev) => {
        if (ev.key === 'Escape') {
            handleClose();
        } else if (ev.key === 'Tab') { // Trap focus
            if (ev.shiftKey) { // Shift + Tab
                if (document.activeElement === firstFocusableElement) {
                    ev.preventDefault();
                    lastFocusableElement.focus();
                }
            } else { // Tab
                if (document.activeElement === lastFocusableElement) {
                    ev.preventDefault();
                    firstFocusableElement.focus();
                }
            }
        }
    };

    closeBtn.addEventListener('click', handleClose);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) handleClose(); }); // Click outside to close
    overlay.addEventListener('keydown', handleKeyDown); // Keyboard controls
}


// -------------------- TOUCH & GESTURE SETUP --------------------
function setupGestures() {
  const appEl = document.getElementById(APP_ELEMENT_ID);
  if (appEl && !hammerInstances.app) { // Initialize only once
    hammerInstances.app = new Hammer(appEl);
    // Swipe right to open drawer on mobile (if in editor view and drawer closed)
    hammerInstances.app.on('swiperight', () => {
      if (currentNovelId && window.innerWidth < 768 && !document.getElementById(CHAPTER_DRAWER_ID).classList.contains('open')) {
        triggerHapticFeedback([10]);
        openChapterDrawer();
      }
    });
    // Swipe left to close drawer on mobile (if in editor view and drawer open)
    hammerInstances.app.on('swipeleft', () => {
      if (currentNovelId && window.innerWidth < 768 && document.getElementById(CHAPTER_DRAWER_ID).classList.contains('open')) {
        triggerHapticFeedback([10]);
        closeChapterDrawer();
      }
    });
  }
}

function destroyEditorGestures() {
    if (hammerInstances.editor) {
        hammerInstances.editor.destroy();
        hammerInstances.editor = null;
    }
    // Resetting font scale can be done here if desired, or let it persist per session
    // document.documentElement.style.setProperty('--editor-font-scale', 1);
}


function setupEditorGestures(targetElement) {
    destroyEditorGestures(); // Clean up any existing instance

    if (targetElement) {
        hammerInstances.editor = new Hammer(targetElement, { recognizers: [[Hammer.Pinch, { enable: true }]] });
        let currentScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-font-scale')) || 1;
        
        hammerInstances.editor.on('pinchstart', () => {
             // Get current scale at the start of pinch, could have changed by other means
             currentScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-font-scale')) || 1;
        });
        hammerInstances.editor.on('pinch', ev => {
            let newScale = currentScale * ev.scale;
            newScale = Math.min(2, Math.max(0.75, newScale)); // Clamp scale
            document.documentElement.style.setProperty('--editor-font-scale', newScale);
        });
        // Optional: Save scale to appSettings on pinchend if persistence is needed across sessions
        // hammerInstances.editor.on('pinchend', () => {
        //    appSettings.editorScale = parseFloat(document.documentElement.style.getPropertyValue('--editor-font-scale'));
        //    saveAppSettings(appSettings);
        // });
    }
}


function setupChapterListGestures() {
    const chapterListEl = document.getElementById(CHAPTER_LIST_ID);
    if (chapterListEl && !hammerInstances.chapterList) { // Initialize only if not already
        hammerInstances.chapterList = new Hammer(chapterListEl);
        hammerInstances.chapterList.get('press').set({ time: 600 }); // Adjust press time if needed
        hammerInstances.chapterList.on('press', async ev => {
            const li = ev.target.closest('li[data-chapter-id]');
            if (!li || !currentNovelId) return; // Ensure a chapter item was pressed in context
            const chapId = li.dataset.chapterId;
            const novel = novels.find(n => n.id === currentNovelId);
            if (!novel) return;
            const chap = novel.chapters.find(c => c.id === chapId);
            if (!chap) return;
            closeActiveContextMenu(); // Close any existing context menu
            showChapterContextMenu(chap, ev.center.x, ev.center.y); // Show new one
        });
    } else if (!chapterListEl && hammerInstances.chapterList) { // List removed, destroy instance
        hammerInstances.chapterList.destroy();
        hammerInstances.chapterList = null;
    }
}

// -------------------- CONTEXT MENU FOR CHAPTER --------------------
let activeContextMenu = null; // Singleton for context menu

function closeActiveContextMenu() {
    if (activeContextMenu) {
        if (document.body.contains(activeContextMenu)) { // Check if still in DOM
            document.body.removeChild(activeContextMenu);
        }
        activeContextMenu = null; // Clear reference
    }
}

async function showChapterContextMenu(chapter, x, y) {
  closeActiveContextMenu(); // Ensure only one is open
  const novel = novels.find(n => n.id === currentNovelId);
  if (!novel) return;
  triggerHapticFeedback([10]); // Haptic for opening menu

  activeContextMenu = document.createElement('div');
  activeContextMenu.id = 'chapterContextMenu'; // Style with this ID
  activeContextMenu.setAttribute('role', 'menu');
  activeContextMenu.setAttribute('aria-label', `Actions for chapter ${chapter.title}`);
  
  const chapterIndex = novel.chapters.findIndex(c => c.id === chapter.id);
  const isFirstChapter = chapterIndex === 0;
  const isLastChapter = chapterIndex === novel.chapters.length - 1;

  activeContextMenu.innerHTML = `
    <div class="menu-item" data-action="rename" role="menuitem" tabindex="0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>Rename
    </div>
    <div class="menu-item ${isFirstChapter ? 'menu-item-disabled' : ''}" data-action="moveUp" role="menuitem" tabindex="${isFirstChapter ? -1 : 0}" aria-disabled="${isFirstChapter}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" /></svg>Move Up
    </div>
    <div class="menu-item ${isLastChapter ? 'menu-item-disabled' : ''}" data-action="moveDown" role="menuitem" tabindex="${isLastChapter ? -1 : 0}" aria-disabled="${isLastChapter}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" /></svg>Move Down
    </div>
    <div class="menu-item menu-item-delete" data-action="delete" role="menuitem" tabindex="0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mr-2 inline-block align-text-bottom text-color-error"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75H4.5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 0-1.5H14A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.531.096 2.182.275a.75.75 0 0 0 .541-.941A4.527 4.527 0 0 0 10 3c-.84 0-1.531.096-2.182.275a.75.75 0 0 0 .541.941A4.527 4.527 0 0 0 10 4ZM4.5 6.5A.75.75 0 0 0 3.75 7.25v7.5A2.75 2.75 0 0 0 6.5 17.5h7a2.75 2.75 0 0 0 2.75-2.75v-7.5A.75.75 0 0 0 15.5 6.5h-11Z" clip-rule="evenodd" /></svg>Delete
    </div>
  `;
  document.body.appendChild(activeContextMenu);

  // Position menu carefully, ensuring it's within viewport
  activeContextMenu.style.left = `${Math.min(x, window.innerWidth - activeContextMenu.offsetWidth - 10)}px`;
  activeContextMenu.style.top = `${Math.min(y, window.innerHeight - activeContextMenu.offsetHeight - 10)}px`;
  
  const firstFocusableItem = activeContextMenu.querySelector('[role="menuitem"][tabindex="0"]');
  if (firstFocusableItem) firstFocusableItem.focus(); // Focus first enabled item

  const handleMenuAction = async (action) => {
    triggerHapticFeedback([10]); // Haptic for menu item activation
    const idx = novel.chapters.findIndex(c => c.id === chapter.id);
    let chapterToFocusAfterMove = null; // For focusing after reorder

    switch (action) {
      case 'rename':
        const newTitle = await showPrompt({ title: 'Rename Chapter', initialValue: chapter.title, placeholder: 'Enter new chapter title...' });
        if (newTitle !== null && newTitle !== chapter.title) { // Check if changed and not cancelled
          chapter.title = newTitle || 'Untitled Chapter';
          chapter.updatedAt = new Date().toISOString();
          touchNovel(novel.id);
          saveNovels(novels);
          updateSaveStatus("Chapter renamed", "success");
          triggerHapticFeedback([20]);
          renderChapterList(novel); // Re-render list
          if (currentChapterId === chapter.id && document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID)) {
            document.getElementById(ACTIVE_CHAPTER_TITLE_DISPLAY_ID).textContent = chapter.title; // Update editor title if active
          }
        }
        break;
      case 'delete':
        const confirmed = await showConfirm({ title: 'Delete Chapter', message: `Are you sure you want to delete chapter “${chapter.title || 'Untitled Chapter'}”?`, okText: 'Delete' });
        if (confirmed) {
          triggerHapticFeedback([40]);
          const chapterWasActive = currentChapterId === chapter.id;
          if(chapterWasActive) isEditorDirty = false; // Reset dirty state if active chapter deleted
          novel.chapters.splice(idx, 1); // Remove chapter
          renumberChapters(novel.chapters); // Re-order remaining
          touchNovel(novel.id);
          saveNovels(novels);
          updateSaveStatus("Chapter deleted", "success");
          renderChapterList(novel); // Re-render
          handlePostChapterDeletionFocus(); // Focus management
          if (chapterWasActive) { // If deleted chapter was active, load new one or clear editor
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
        if (idx > 0) { // Can move up
          triggerHapticFeedback([20,30,20]);
          [novel.chapters[idx - 1], novel.chapters[idx]] = [novel.chapters[idx], novel.chapters[idx - 1]]; // Swap
          renumberChapters(novel.chapters);
          touchNovel(novel.id);
          saveNovels(novels);
          renderChapterList(novel);
          chapterToFocusAfterMove = chapter.id; // Store ID to focus its new LI
        }
        break;
      case 'moveDown':
        if (idx < novel.chapters.length - 1) { // Can move down
          triggerHapticFeedback([20,30,20]);
          [novel.chapters[idx + 1], novel.chapters[idx]] = [novel.chapters[idx], novel.chapters[idx + 1]]; // Swap
          renumberChapters(novel.chapters);
          touchNovel(novel.id);
          saveNovels(novels);
          renderChapterList(novel);
          chapterToFocusAfterMove = chapter.id; // Store ID to focus its new LI
        }
        break;
    }
    closeActiveContextMenu(); // Close menu after action
    if (chapterToFocusAfterMove) { // If a chapter was moved, re-focus its LI element
        const movedLi = document.querySelector(`#${CHAPTER_LIST_ID} li[data-chapter-id="${chapterToFocusAfterMove}"]`);
        if (movedLi) movedLi.focus();
    }
  };
  
  activeContextMenu.addEventListener('click', ev => {
      const targetItem = ev.target.closest('.menu-item');
      if (targetItem && !targetItem.classList.contains('menu-item-disabled')) { // Check not disabled
          handleMenuAction(targetItem.dataset.action);
      }
  });
  activeContextMenu.addEventListener('keydown', ev => { // Keyboard interaction for menu
      const targetItem = ev.target.closest('.menu-item');
      if (targetItem && (ev.key === 'Enter' || ev.key === ' ') && !targetItem.classList.contains('menu-item-disabled')) {
          ev.preventDefault(); // Prevent page scroll on Space
          handleMenuAction(targetItem.dataset.action);
      } else if (ev.key === 'Escape') {
          closeActiveContextMenu();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const items = Array.from(activeContextMenu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')); // Only enabled items
          let currentFocusIndex = items.indexOf(document.activeElement);
          if (ev.key === 'ArrowDown') {
              currentFocusIndex = (currentFocusIndex + 1) % items.length;
          } else { // ArrowUp
              currentFocusIndex = (currentFocusIndex - 1 + items.length) % items.length;
          }
          if(items[currentFocusIndex]) items[currentFocusIndex].focus();
      }
  });

  // Close menu if clicked outside
  const clickOutsideListener = (ev) => {
    if (activeContextMenu && !activeContextMenu.contains(ev.target)) { // If click is outside menu
      closeActiveContextMenu();
      document.removeEventListener('click', clickOutsideListener, true); // Clean up listener
    }
  };
  setTimeout(() => document.addEventListener('click', clickOutsideListener, true), 0); // Add listener after current event cycle
}

function handlePostChapterDeletionFocus() {
    const drawer = document.getElementById(CHAPTER_DRAWER_ID);
    // Only manage focus if drawer is visible (i.e., not on a tiny screen where it might be auto-hidden)
    if (drawer.offsetParent === null) return; // Drawer is not visible (e.g. display:none)

    // Try to focus the currently active chapter's list item if it exists
    if (currentChapterId) {
        const activeChapterLi = document.querySelector(`#${CHAPTER_LIST_ID} li[data-chapter-id="${currentChapterId}"]`);
        if (activeChapterLi) {
            activeChapterLi.focus();
            return; // Focus set
        }
    }
    // Fallback: if no current chapter (e.g., last chapter deleted), focus "Add Chapter" button
    const addChapterBtnEl = document.getElementById(ADD_CHAPTER_BTN_ID);
    if (addChapterBtnEl) {
        addChapterBtnEl.focus();
    }
}