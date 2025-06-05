const IMAGES_FOLDER = 'images';
const { ipcRenderer } = require('electron');
const path = require('path'); // Add this line
const { shell } = require('electron'); // Add this line

// Enhanced cache management for fast returns
const fastReturnCache = {
    models: null,
    filters: null,
    searchTerm: '',
    currentPage: 1,
    viewMode: 'grid',
    timestamp: 0,    save() {
        // Safety check: ensure models variable exists and is defined
        if (typeof models === 'undefined' || !models) {
            console.warn('FastReturnCache: models is not defined, skipping save');
            return;
        }
        
        if (!models || models.length === 0) {
            console.warn('FastReturnCache: models is empty, skipping save');
            return;
        }
        
        // Safety check: ensure other variables are defined
        if (typeof activeFilters === 'undefined') {
            console.warn('FastReturnCache: activeFilters is not defined, skipping save');
            return;
        }
        
        this.models = [...models];
        this.filters = { ...activeFilters };
        this.searchTerm = searchTerm || '';
        this.currentPage = currentPage || 1;
        this.viewMode = viewMode || 'grid';
        this.timestamp = Date.now();
        
        console.log('FastReturnCache: Saving state', {
            models: this.models.length,
            filters: this.filters,
            searchTerm: this.searchTerm,
            currentPage: this.currentPage,
            viewMode: this.viewMode
        });
        
        try {
            localStorage.setItem('fastReturnCache', JSON.stringify({
                models: this.models,
                filters: this.filters,
                searchTerm: this.searchTerm,
                currentPage: this.currentPage,
                viewMode: this.viewMode,
                timestamp: this.timestamp
            }));
            console.log('FastReturnCache: State saved successfully');
        } catch (error) {
            console.warn('Failed to save fast return cache:', error);
        }
    },
    
    load() {
        try {
            const cached = localStorage.getItem('fastReturnCache');
            if (!cached) return false;
            
            const data = JSON.parse(cached);
            
            // Check if cache is less than 2 minutes old
            if (Date.now() - data.timestamp > 2 * 60 * 1000) {
                return false;
            }
            
            this.models = data.models;
            this.filters = data.filters;
            this.searchTerm = data.searchTerm;
            this.currentPage = data.currentPage;
            this.viewMode = data.viewMode;
            this.timestamp = data.timestamp;
            
            return true;
        } catch (error) {
            console.warn('Failed to load fast return cache:', error);
            return false;
        }
    },    restore() {
        if (!this.models || this.models.length === 0) {
            console.warn('FastReturnCache: No models to restore');
            return false;
        }
          console.log('FastReturnCache: Restoring state', {
            models: this.models.length,
            filters: this.filters,
            searchTerm: this.searchTerm,
            currentPage: this.currentPage,
            viewMode: this.viewMode
        });
        
        // Restore models
        models = [...this.models];
        
        // Restore filters and search state with safety checks
        activeFilters = { ...this.filters };
        searchTerm = this.searchTerm;
        currentPage = this.currentPage;
        viewMode = this.viewMode;
        
        // Also save to localStorage for persistence
        localStorage.setItem('currentPage', currentPage.toString());
        localStorage.setItem('searchTerm', searchTerm);
        localStorage.setItem('activeFilters', JSON.stringify(activeFilters));
        localStorage.setItem('currentSort', currentSort);
        localStorage.setItem('viewMode', viewMode);
        
        // Update UI elements if they exist
        if (typeof elements !== 'undefined' && elements && elements.searchInput) {
            elements.searchInput.value = this.searchTerm;
            elements.creatorFilter.value = this.filters.creator || '';
            elements.baseModelFilter.value = this.filters.baseModel || '';
            elements.modelTypeFilter.value = this.filters.modelType || '';
            elements.favoritesFilterBtn.classList.toggle('active', this.filters.favoritesOnly);
            elements.gridViewBtn.classList.toggle('active', this.viewMode === 'grid');
            elements.listViewBtn.classList.toggle('active', this.viewMode === 'list');
            elements.modelGrid.classList.toggle('list-view', this.viewMode === 'list');
        }
        
        console.log('FastReturnCache: State restoration complete');
        return true;
    },
    
    clear() {
        this.models = null;
        this.filters = null;
        this.searchTerm = '';
        this.currentPage = 1;
        this.viewMode = 'grid';
        this.timestamp = 0;
        localStorage.removeItem('fastReturnCache');
    }
};

// Move theme initialization to the very top, before DOMContentLoaded
async function initTheme() {
    // First check localStorage for immediate theme application (fallback)
    let isDarkMode = localStorage.getItem('darkMode') === 'true';
    
    try {
        // Try to load theme from config
        const configResponse = await fetch('/config');
        const config = await configResponse.json();
        
        if (config.theme) {
            isDarkMode = config.theme === 'dark';
            // Update localStorage to match config
            localStorage.setItem('darkMode', isDarkMode);
        }
    } catch (error) {
        console.log('Could not load theme from config, using localStorage fallback');
        // Keep using localStorage value
    }
    
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    
    // Set background colors immediately to prevent flash
    if (isDarkMode) {
        document.documentElement.style.backgroundColor = '#121212';
        document.body.style.backgroundColor = '#121212';
    } else {
        document.documentElement.style.backgroundColor = '#f9f9f9';
        document.body.style.backgroundColor = '#f9f9f9';
    }
    
    // Update theme toggle button icon if it exists
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.querySelector('i').className = isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
    }
    
    return isDarkMode;
}

// Add requestIdleCallback polyfill for older browsers
if (!window.requestIdleCallback) {
    window.requestIdleCallback = function(callback) {
        const start = Date.now();
        return setTimeout(function() {
            callback({
                didTimeout: false,
                timeRemaining: function() {
                    return Math.max(0, 50 - (Date.now() - start));
                }
            });
        }, 1);
    };
}

// Call immediately, before any other code
initTheme();

// Helper function to create fallback elements if DOM isn't ready
function createFallbackElement(tagName) {
    const element = document.createElement(tagName);
    element.style.display = 'none';
    return element;
}

// Base model normalization functionality
const baseModelNormalization = (() => {
    let normalizedBaseModels = new Map(); // lowercase -> canonical form
    let initialized = false;

    function initializeNormalization(modelsArray) {
        if (initialized || !modelsArray) return;
        
        const baseModelCounts = new Map(); // lowercase -> {canonical: string, count: number}
        
        // Count all base model variations
        modelsArray.forEach(model => {
            const modelData = model.modelVersion || model;
            const baseModel = modelData.trainingDetails?.baseModel || modelData.baseModel || '';
            
            if (baseModel) {
                const lowerCase = baseModel.toLowerCase();
                
                if (!baseModelCounts.has(lowerCase)) {
                    baseModelCounts.set(lowerCase, { canonical: baseModel, count: 1 });
                } else {
                    const existing = baseModelCounts.get(lowerCase);
                    existing.count++;
                    
                    // Use the most frequent capitalization, or if tied, prefer the first one
                    // This handles cases where we have both "Illustrious" and "illustrious"
                    baseModelCounts.set(lowerCase, existing);
                }
            }
        });
        
        // Create normalized mapping (lowercase -> most frequent capitalization)
        normalizedBaseModels.clear();
        baseModelCounts.forEach((data, lowerCase) => {
            normalizedBaseModels.set(lowerCase, data.canonical);
        });
          initialized = true;
        console.log('Base model normalization initialized with', normalizedBaseModels.size, 'unique base models');
        console.log('Base model normalization mapping:', Object.fromEntries(normalizedBaseModels));
    }

    function getNormalizedBaseModel(baseModel, modelsArray) {
        if (!baseModel) return '';
        
        if (!initialized && modelsArray) {
            initializeNormalization(modelsArray);
        }
        
        const lowerCase = baseModel.toLowerCase();
        return normalizedBaseModels.get(lowerCase) || baseModel;
    }    function getBaseModelFromModel(model, modelsArray) {
        const modelData = model.modelVersion || model;
        const baseModel = modelData.baseModel || modelData.trainingDetails?.baseModel || '';
        return getNormalizedBaseModel(baseModel, modelsArray);
    }

    return {
        initializeNormalization,
        getNormalizedBaseModel,
        getBaseModelFromModel,
        reinitialize: (modelsArray) => {
            initialized = false;
            initializeNormalization(modelsArray);
        }
    };
})();

// Sorting functionality
function sortModels(modelsToSort, sortBy = currentSort) {
    if (!modelsToSort || modelsToSort.length === 0) return [];
    
    // Create a copy to avoid mutating original array
    let sorted = [...modelsToSort];
    
    // Helper function to check if model has JSON metadata
    function hasMetadata(model) {
        return model.model || model.modelVersion;
    }
    
    // Helper function to get model type priority (Checkpoint > Lora > Locon > Embedding > Others)
    function getModelTypePriority(model) {
        const modelInfo = model.model || {};
        const modelData = model.modelVersion || model;
        const type = (modelInfo.type || modelData.model?.type || '').toLowerCase();
        
        const priorities = {
            'checkpoint': 1,
            'lora': 2,
            'locon': 3,
            'embedding': 4,
            'textualinversion': 4, // Alternative name for embedding
            'hypernetwork': 5,
            'vae': 6
        };
        
        return priorities[type] || 999; // Unknown types go to end
    }
    
    // Helper function to get file size in bytes for comparison
    function getFileSizeBytes(model) {
        const modelData = model.modelVersion || model;
        const files = modelData.files || [];
        if (files.length > 0) {
            return files[0].sizeKB * 1024; // Convert KB to bytes
        }
        return 0;
    }
    
    // Enhanced comparison function that always puts models without metadata last
    function compareWithMetadataPriority(a, b, primaryComparison) {
        const aHasMetadata = hasMetadata(a);
        const bHasMetadata = hasMetadata(b);
        
        // If one has metadata and the other doesn't, prioritize the one with metadata
        if (aHasMetadata && !bHasMetadata) return -1;
        if (!aHasMetadata && bHasMetadata) return 1;
        
        // If both have same metadata status, use the primary comparison
        return primaryComparison(a, b);
    }
    
    // Main sorting logic
    switch (sortBy) {
        case 'name':
            sorted.sort((a, b) => compareWithMetadataPriority(a, b, (a, b) => {
                const nameA = (a.model?.name || a.modelVersion?.name || a.name || '').toLowerCase();
                const nameB = (b.model?.name || b.modelVersion?.name || b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }));
            break;
            
        case 'nameReverse':
            sorted.sort((a, b) => compareWithMetadataPriority(a, b, (a, b) => {
                const nameA = (a.model?.name || a.modelVersion?.name || a.name || '').toLowerCase();
                const nameB = (b.model?.name || b.modelVersion?.name || b.name || '').toLowerCase();
                return nameB.localeCompare(nameA); // Reverse order
            }));
            break;
        
        case 'modelType':
            sorted.sort((a, b) => compareWithMetadataPriority(a, b, (a, b) => {
                const priorityA = getModelTypePriority(a);
                const priorityB = getModelTypePriority(b);
                
                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                
                // Within same type, sort alphabetically
                const nameA = (a.model?.name || a.modelVersion?.name || a.name || '').toLowerCase();
                const nameB = (b.model?.name || b.modelVersion?.name || b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }));
            break;
            
        case 'baseModel':
            sorted.sort((a, b) => compareWithMetadataPriority(a, b, (a, b) => {
                const baseModelA = baseModelNormalization.getBaseModelFromModel(a, modelsToSort);
                const baseModelB = baseModelNormalization.getBaseModelFromModel(b, modelsToSort);
                
                if (baseModelA !== baseModelB) {
                    return baseModelA.localeCompare(baseModelB);
                }
                
                // Within same base model, sort alphabetically
                const nameA = (a.model?.name || a.modelVersion?.name || a.name || '').toLowerCase();
                const nameB = (b.model?.name || b.modelVersion?.name || b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }));
            break;
            
        case 'fileSize':
            sorted.sort((a, b) => compareWithMetadataPriority(a, b, (a, b) => {
                const sizeA = getFileSizeBytes(a);
                const sizeB = getFileSizeBytes(b);
                
                if (sizeA !== sizeB) {
                    return sizeB - sizeA; // Largest first
                }
                
                // Same file size, sort alphabetically
                const nameA = (a.model?.name || a.modelVersion?.name || a.name || '').toLowerCase();
                const nameB = (b.model?.name || b.modelVersion?.name || b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }));
            break;
            
        case 'downloads':
            sorted.sort((a, b) => compareWithMetadataPriority(a, b, (a, b) => {
                const downloadsA = (a.modelVersion?.stats?.downloadCount || 0);
                const downloadsB = (b.modelVersion?.stats?.downloadCount || 0);
                
                if (downloadsA !== downloadsB) {
                    return downloadsB - downloadsA; // Most downloads first
                }
                
                // Same downloads, sort alphabetically
                const nameA = (a.model?.name || a.modelVersion?.name || a.name || '').toLowerCase();
                const nameB = (b.model?.name || b.modelVersion?.name || b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }));
            break;
            
        default:
            // Default to name sorting
            sorted.sort((a, b) => compareWithMetadataPriority(a, b, (a, b) => {
                const nameA = (a.model?.name || a.modelVersion?.name || a.name || '').toLowerCase();
                const nameB = (b.model?.name || b.modelVersion?.name || b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }));
    }
    
    return sorted;
}

// Flag to prevent scroll restoration when home link is clicked
let preventScrollRestoration = false;

document.addEventListener('DOMContentLoaded', async function() {    // Check if we're returning from details view - try to restore state first
    const returningFromDetails = localStorage.getItem('returningFromDetails') === 'true';
    const homeLinkClicked = localStorage.getItem('homeLinkClicked') === 'true';
    let stateRestored = false;
    
    if (returningFromDetails) {
        // Try to restore from fast return cache when coming back from details
        console.log('Returning from model details, attempting to restore state...');
        stateRestored = fastReturnCache.load() && fastReturnCache.restore();
        if (stateRestored) {
            console.log('Successfully restored previous state from fast return cache');
        }
        localStorage.removeItem('returningFromDetails');
    } else if (homeLinkClicked) {
        // Home link was clicked - clear filters and prevent scroll restoration
        console.log('Home link was clicked, will clear all filters after models load');
        // Note: Don't remove the flag yet - clearAllFilters() will be called after models are loaded
    }
    
    // Initialize with default config immediately - don't block UI
    let config = {
        standalone_files: [],
        watched_folders: []
    };
    
    // Start config loading and favorites initialization in parallel, non-blocking
    const configPromise = fetch('/config').then(res => res.json()).catch(error => {
        console.error('Failed to load config:', error);
        return config; // Return default config on error
    });
    
    const favoritesPromise = favoritesManager.waitForInitialization().catch(error => {
        console.warn('Favorites initialization failed:', error);
        // Continue without favorites if it fails
    });    // Log favorites status non-blocking
    favoritesPromise.then(() => {
        console.log('Favorites manager initialized with', favoritesManager.getCount(), 'favorites');
    });    // Listen for favorites manager events
    window.addEventListener('favoriteAdded', (event) => {
        console.log('Favorite added:', event.detail.modelKey);
        // Refresh display to update UI while preserving current page
        applySearchAndFilters(false, true); // preservePage = true
    });

    window.addEventListener('favoriteRemoved', (event) => {
        console.log('Favorite removed:', event.detail.modelKey);
        // Refresh display to update UI while preserving current page
        applySearchAndFilters(false, true); // preservePage = true
    });

    window.addEventListener('favoritesCleared', () => {
        console.log('All favorites cleared');
        // Refresh display to update UI while preserving current page
        applySearchAndFilters(false, true); // preservePage = true
    });// Add at the top of the DOMContentLoaded function, after config initialization
    const imageCache = new Map();
    
    // Rate limiting for image downloads
    let concurrentDownloads = 0;
    const MAX_CONCURRENT_DOWNLOADS = 3;
    
    // DOM Elements - Get all elements immediately without blocking
    const elements = {
        fileInput: document.getElementById('fileInput') || createFallbackElement('input'),
        uploadBox: document.getElementById('uploadBox') || createFallbackElement('div'),
        loadBtn: document.getElementById('loadBtn') || createFallbackElement('button'),
        statusBar: document.getElementById('statusBar') || createFallbackElement('div'),
        modelGrid: document.getElementById('modelGrid') || createFallbackElement('div'),
        themeToggle: document.getElementById('themeToggle') || createFallbackElement('button'),        folderPathInput: document.getElementById('folderPathInput') || createFallbackElement('input'),
        addFolderBtn: document.getElementById('addFolderBtn') || createFallbackElement('button'),
        browseFolderBtn: document.getElementById('browseFolderBtn') || createFallbackElement('button'),
        showFoldersBtn: document.getElementById('showFoldersBtn') || createFallbackElement('button'),
        watchedFoldersList: document.getElementById('watchedFoldersList') || createFallbackElement('div'),        prevPage: document.getElementById('prevPage') || createFallbackElement('button'),
        nextPage: document.getElementById('nextPage') || createFallbackElement('button'),
        pageInfo: document.getElementById('pageInfo') || createFallbackElement('span'),
        paginationControls: document.querySelector('.pagination-controls') || createFallbackElement('div'),
        // Top pagination elements
        topPaginationControls: document.getElementById('topPaginationControls') || createFallbackElement('div'),
        topPrevPage: document.getElementById('topPrevPage') || createFallbackElement('button'),
        topNextPage: document.getElementById('topNextPage') || createFallbackElement('button'),
        topPageInfo: document.getElementById('topPageInfo') || createFallbackElement('span'),
        // Search and filter elements
        searchFilterContainer: document.getElementById('searchFilterContainer') || createFallbackElement('div'),
        searchInput: document.getElementById('searchInput') || createFallbackElement('input'),
        clearSearch: document.getElementById('clearSearch') || createFallbackElement('button'),
        searchStats: document.getElementById('searchStats') || createFallbackElement('div'),
        creatorFilter: document.getElementById('creatorFilter') || createFallbackElement('select'),
        baseModelFilter: document.getElementById('baseModelFilter') || createFallbackElement('select'),
        modelTypeFilter: document.getElementById('modelTypeFilter') || createFallbackElement('select'),
        clearFilters: document.getElementById('clearFilters') || createFallbackElement('button'),
        sortSelect: document.getElementById('sortSelect') || createFallbackElement('select'),
        // Enhanced controls elements
        enhancedControls: document.getElementById('enhancedControls') || createFallbackElement('div'),
        gridViewBtn: document.getElementById('gridViewBtn') || createFallbackElement('button'),
        listViewBtn: document.getElementById('listViewBtn') || createFallbackElement('button'),
        favoritesFilterBtn: document.getElementById('favoritesFilterBtn') || createFallbackElement('button'),
        refreshCacheBtn: document.getElementById('refreshCacheBtn') || createFallbackElement('button'),
        selectionControls: document.getElementById('selectionControls') || createFallbackElement('div'),
        selectionCount: document.getElementById('selectionCount') || createFallbackElement('span'),
        selectAllBtn: document.getElementById('selectAllBtn') || createFallbackElement('button'),
        deselectAllBtn: document.getElementById('deselectAllBtn') || createFallbackElement('button'),
        deleteSelectedBtn: document.getElementById('deleteSelectedBtn') || createFallbackElement('button'),
        addToFavoritesBtn: document.getElementById('addToFavoritesBtn') || createFallbackElement('button'),
        exportSelectedBtn: document.getElementById('exportSelectedBtn') || createFallbackElement('button'),
        // Context menu elements
        contextMenu: document.getElementById('contextMenu') || createFallbackElement('div'),
        contextOpenDetails: document.getElementById('contextOpenDetails') || createFallbackElement('button'),
        contextToggleFavorite: document.getElementById('contextToggleFavorite') || createFallbackElement('button'),
        favoriteText: document.getElementById('favoriteText') || createFallbackElement('span'),
        contextCopyPath: document.getElementById('contextCopyPath') || createFallbackElement('button'),
        contextRevealExplorer: document.getElementById('contextRevealExplorer') || createFallbackElement('button'),
        contextDelete: document.getElementById('contextDelete') || createFallbackElement('button')
    };

    // Show UI immediately without waiting for anything
    console.log('DOM elements ready, showing UI immediately');
    
    // Update the config from promise when it resolves
    configPromise.then(loadedConfig => {
        config = loadedConfig;
        console.log('Config loaded:', config);
        // Update watched folders display after config loads
        if (config.watched_folders && config.watched_folders.length > 0) {
            showWatchedFolders();
        }
    });

    // Initialize app immediately with empty state

    // Keyboard shortcuts setup
    let keyboardFocusIndex = -1; // Index of currently keyboard-focused model card
    
    // Keyboard event handler
    document.addEventListener('keydown', function(event) {
        // Don't interfere if user is typing in an input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            if (event.key === 'Escape') {
                event.target.blur(); // Remove focus from input
                return;
            }
            return;
        }

        switch (event.key) {
            case 'f':
            case 'F':
                if (event.ctrlKey) {
                    event.preventDefault();
                    elements.searchInput.focus();
                    elements.searchInput.select();
                }
                break;
                
            case 'Escape':
                event.preventDefault();
                // Clear context menu
                hideContextMenu();
                // Clear search if focused
                if (document.activeElement === elements.searchInput) {
                    elements.searchInput.blur();
                }
                // Clear keyboard focus
                clearKeyboardFocus();
                break;
                
            case 'Delete':
                event.preventDefault();
                if (selectedModels.size > 0) {
                    deleteSelectedModels();
                } else if (keyboardFocusIndex !== -1) {
                    const models = getDisplayModels();
                    const startIndex = (currentPage - 1) * itemsPerPage;
                    const modelIndex = startIndex + keyboardFocusIndex;
                    if (modelIndex < models.length) {
                        deleteModel(models[modelIndex]);
                    }
                }
                break;
                
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                event.preventDefault();
                handleArrowNavigation(event.key);
                break;
                
            case 'Enter':
                event.preventDefault();
                if (keyboardFocusIndex !== -1) {
                    const models = getDisplayModels();
                    const startIndex = (currentPage - 1) * itemsPerPage;
                    const modelIndex = startIndex + keyboardFocusIndex;
                    if (modelIndex < models.length) {
                        openModelDetails(models[modelIndex]);
                    }
                }
                break;
                
            case ' ': // Spacebar for selection
                event.preventDefault();
                if (keyboardFocusIndex !== -1) {
                    const models = getDisplayModels();
                    const startIndex = (currentPage - 1) * itemsPerPage;
                    const modelIndex = startIndex + keyboardFocusIndex;
                    if (modelIndex < models.length) {
                        toggleModelSelection(models[modelIndex]);                    }
                }
                break;
        }
    });

    // Utility functions for enhanced features
    
    // Keyboard navigation helper functions
    function handleArrowNavigation(key) {
        const models = getDisplayModels();
        const currentModels = models.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
        const gridCols = viewMode === 'grid' ? 5 : 1; // 5 columns in grid, 1 in list
        
        if (currentModels.length === 0) return;
        
        // Initialize focus if not set
        if (keyboardFocusIndex === -1) {
            keyboardFocusIndex = 0;
        } else {
            // Calculate new index based on arrow direction
            switch (key) {
                case 'ArrowLeft':
                    keyboardFocusIndex = Math.max(0, keyboardFocusIndex - 1);
                    break;
                case 'ArrowRight':
                    keyboardFocusIndex = Math.min(currentModels.length - 1, keyboardFocusIndex + 1);
                    break;
                case 'ArrowUp':
                    keyboardFocusIndex = Math.max(0, keyboardFocusIndex - gridCols);
                    break;
                case 'ArrowDown':
                    keyboardFocusIndex = Math.min(currentModels.length - 1, keyboardFocusIndex + gridCols);
                    break;
            }
        }
        
        updateKeyboardFocus();
    }
    
    function updateKeyboardFocus() {
        // Clear previous focus
        document.querySelectorAll('.model-card.keyboard-focus').forEach(card => {
            card.classList.remove('keyboard-focus');
        });
        
        // Add focus to current card
        if (keyboardFocusIndex !== -1) {
            const cards = document.querySelectorAll('.model-card');
            if (cards[keyboardFocusIndex]) {
                cards[keyboardFocusIndex].classList.add('keyboard-focus');
                // Scroll card into view
                cards[keyboardFocusIndex].scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'nearest' 
                });
            }
        }
    }
    
    function clearKeyboardFocus() {
        keyboardFocusIndex = -1;
        document.querySelectorAll('.model-card.keyboard-focus').forEach(card => {
            card.classList.remove('keyboard-focus');
        });    }
    
    // Enhanced model functions
    function getModelKey(model) {
        const modelData = model.modelVersion || model;
        
        // If we have proper CivitAI metadata, use the standard format
        if (modelData.modelId && modelData.id) {
            return `${modelData.modelId}_${modelData.id}`;
        }
        
        // For models without metadata, use the filename as a unique identifier
        // This ensures each .safetensors file gets a unique key
        if (model.safetensorsPath) {
            // Extract filename from path and use it as identifier
            const filename = model.safetensorsPath.split(/[/\\]/).pop();
            return `local_${filename}`;
        }
        
        // Final fallback using model name
        return `local_${model.name || 'unknown'}`;
    }
      function toggleModelSelection(model) {
        console.log('toggleModelSelection called with:', model);
        const modelKey = getModelKey(model);
        console.log('Model key:', modelKey);
        
        if (selectedModels.has(modelKey)) {
            selectedModels.delete(modelKey);
            console.log('Removed from selection');
        } else {
            selectedModels.add(modelKey);
            console.log('Added to selection');
        }
        
        console.log('Current selected models:', selectedModels);
        updateSelectionUI();
        updateModelCardSelection(model);
    }
    
    function updateSelectionUI() {
        const count = selectedModels.size;
        elements.selectionCount.textContent = `${count} selected`;
        elements.selectionControls.style.display = count > 0 ? 'flex' : 'none';
        
        // Update select all button state
        const currentModels = getDisplayModels().slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
        const allSelected = currentModels.every(model => selectedModels.has(getModelKey(model)));
        elements.selectAllBtn.innerHTML = allSelected && currentModels.length > 0
            ? '<i class="fas fa-square"></i> Deselect All'
            : '<i class="fas fa-check-square"></i> Select All';
    }
    
    function updateModelCardSelection(model) {
        const modelKey = getModelKey(model);
        const isSelected = selectedModels.has(modelKey);
        
        // Find the card and update its visual state
        const cards = document.querySelectorAll('.model-card');
        cards.forEach((card, index) => {
            const currentModels = getDisplayModels().slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
            if (index < currentModels.length && getModelKey(currentModels[index]) === modelKey) {
                const checkbox = card.querySelector('.model-select-checkbox input');
                if (checkbox) {
                    checkbox.checked = isSelected;
                }
                if (isSelected) {
                    card.classList.add('selected');
                } else {
                    card.classList.remove('selected');
                }
            }
        });
    }
      function isFavorite(model) {
        const modelKey = getModelKey(model);
        return favoritesManager.isFavorite(modelKey);
    }
      async function toggleFavorite(model) {
        const modelKey = getModelKey(model);
        await favoritesManager.toggleFavorite(modelKey);
        // Update the card's favorite indicator
        updateModelCardFavorite(model);
    }    function updateModelCardFavorite(model) {
        const modelKey = getModelKey(model);
        const isFav = favoritesManager.isFavorite(modelKey);
        
        // Find the card and update its visual state
        const cards = document.querySelectorAll('.model-card');
        cards.forEach((card, index) => {
            const currentModels = getDisplayModels().slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
            if (index < currentModels.length && getModelKey(currentModels[index]) === modelKey) {
                const favoriteBtn = card.querySelector('.model-favorite-btn');
                if (favoriteBtn) {
                    if (isFav) {
                        card.classList.add('favorite');
                        favoriteBtn.classList.add('active');
                    } else {
                        card.classList.remove('favorite');
                        favoriteBtn.classList.remove('active');
                    }
                }
            }
        });
    }    function openModelDetails(model) {
        // Save current state to fast return cache before navigating (with safety check)
        try {
            if (typeof models !== 'undefined' && models && models.length > 0) {
                fastReturnCache.save();
            } else {
                console.log('Models not ready for fast return cache, skipping save');
            }
        } catch (error) {
            console.warn('Error saving fast return cache:', error);
        }
        
        // Store complete model data including safetensors path
        const modelDetails = {
            ...model,
            safetensorsPath: model.safetensorsPath,
            modelVersion: {
                ...model.modelVersion,
                files: model.modelVersion?.files || [],
                images: model.modelVersion?.images || [],
                trainedWords: model.modelVersion?.trainedWords || []
            },
            model: {
                ...model.model,
                name: model.model?.name || model.name,
                creator: model.model?.creator || {}
            }
        };        localStorage.setItem('currentModelDetails', JSON.stringify(modelDetails));
        localStorage.setItem('currentPage', currentPage.toString());
        localStorage.setItem('scrollPosition', window.scrollY.toString());
        console.log(`Saving currentPage to localStorage: ${currentPage}`);
        window.location.href = 'model-details.html';
    }
    
    // Context menu functions
    function showContextMenu(event, model) {
        event.preventDefault();
        event.stopPropagation();
        
        selectedModelForContextMenu = model;        const modelKey = getModelKey(model);
        const isFav = favoritesManager.isFavorite(modelKey);
        
        // Update favorite text
        elements.favoriteText.textContent = isFav ? 'Remove from Favorites' : 'Add to Favorites';
        
        // Position and show context menu
        elements.contextMenu.style.left = event.pageX + 'px';
        elements.contextMenu.style.top = event.pageY + 'px';
        elements.contextMenu.style.display = 'block';
        contextMenuOpen = true;
        
        // Close context menu when clicking elsewhere
        setTimeout(() => {
            document.addEventListener('click', hideContextMenu, { once: true });
        }, 0);
    }
      function hideContextMenu() {
        elements.contextMenu.style.display = 'none';
        contextMenuOpen = false;
        selectedModelForContextMenu = null;
    }
    
    // Bulk operations functions
    function selectAllCurrentPage() {
        const currentModels = getDisplayModels().slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
        const allSelected = currentModels.every(model => selectedModels.has(getModelKey(model)));
        
        if (allSelected) {
            // Deselect all on current page
            currentModels.forEach(model => {
                selectedModels.delete(getModelKey(model));
                updateModelCardSelection(model);
            });
        } else {
            // Select all on current page
            currentModels.forEach(model => {
                selectedModels.add(getModelKey(model));
                updateModelCardSelection(model);
            });
        }
        
        updateSelectionUI();
    }
    
    function clearAllSelections() {
        // Clear all selections across all pages
        const allModels = getDisplayModels();
        allModels.forEach(model => {
            selectedModels.delete(getModelKey(model));
            updateModelCardSelection(model);
        });
        
        selectedModels.clear();
        updateSelectionUI();
    }    async function deleteSelectedModels() {
        console.log('deleteSelectedModels called');
        console.log('selectedModels.size:', selectedModels.size);
        
        if (selectedModels.size === 0) {
            console.log('No models selected, returning early');
            return;
        }
          const count = selectedModels.size;
        const message = `Are you sure you want to remove ${count} selected model${count > 1 ? 's' : ''} from the application?\n\n` +
                       `This will:\n` +
                       `• Remove them from the app's library\n` +
                       `• NOT delete the actual .safetensors files from your disk\n` +
                       `• Prevent them from loading again until manually re-added\n\n` +
                       `Click OK to continue or Cancel to abort.`;
        
        console.log('About to show confirm dialog with message:', message);
        const confirmResult = await showCustomConfirm('Confirm Deletion', message);
        console.log('Confirm dialog result:', confirmResult);
        
        if (!confirmResult) {
            console.log('User cancelled delete operation');
            return;
        }
        
        console.log('User confirmed delete operation, proceeding...');
          // Get paths of selected models before removing them
        const selectedKeys = Array.from(selectedModels);
        const selectedModelPaths = models
            .filter(model => selectedKeys.includes(getModelKey(model)))
            .map(model => model.safetensorsPath || model.filePath)
            .filter(path => path); // Remove undefined/null paths
        
        // Remove selected models from the models array
        models = models.filter(model => !selectedKeys.includes(getModelKey(model)));
        
        // Add to previously_deleted list on server
        if (selectedModelPaths.length > 0) {
            try {
                await fetch('/add-to-deleted', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePaths: selectedModelPaths })
                });
                console.log(`Added ${selectedModelPaths.length} models to previously_deleted list`);
            } catch (error) {
                console.error('Failed to add models to deleted list:', error);
            }
        }
        
        // Clear selections
        selectedModels.clear();
          // Save to localStorage
        saveModelsToLocalStorage();
        
        // Update display while preserving current page
        applySearchAndFilters(false, true); // preservePage = true
        updateSelectionUI();
        
        elements.statusBar.textContent = `Deleted ${count} models from library`;
        elements.statusBar.className = 'status-bar success';
    }
      async function addSelectedToFavorites() {
        if (selectedModels.size === 0) return;
        
        const modelKeysArray = Array.from(selectedModels);
        const addedCount = await favoritesManager.addBulk(modelKeysArray);
        
        // Update visual indicators for all affected models
        const allModels = getDisplayModels();
        allModels.forEach(model => {
            if (selectedModels.has(getModelKey(model))) {
                updateModelCardFavorite(model);
            }
        });
        
        elements.statusBar.textContent = `Added ${addedCount} models to favorites`;
        elements.statusBar.className = 'status-bar success';
    }
    
    async function exportSelectedModels() {
        if (selectedModels.size === 0) return;
        
        const selectedModelsList = models.filter(model => selectedModels.has(getModelKey(model)));
        
        // Create export data
        const exportData = {
            exportDate: new Date().toISOString(),
            count: selectedModelsList.length,
            models: selectedModelsList.map(model => ({
                name: model.model?.name || model.modelVersion?.name || 'Unknown',
                creator: model.model?.creator?.username || 'Unknown',
                modelId: model.modelVersion?.modelId || model.modelId,
                versionId: model.modelVersion?.id || model.id,
                filePath: model.safetensorsPath || model.filePath,
                downloadUrl: `https://civitai.com/models/${model.modelVersion?.modelId || model.modelId}`,
                tags: customTags[getModelKey(model)] || [],
                stats: model.modelVersion?.stats || {}
            }))
        };
        
        // Create and download JSON file
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `civitai_models_export_${new Date().toISOString().split('T')[0]}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        elements.statusBar.textContent = `Exported ${selectedModelsList.length} models to JSON file`;
        elements.statusBar.className = 'status-bar success';
    }    async function deleteModel(model) {
        const modelName = model.model?.name || model.modelVersion?.name || model.name || 'Unknown Model';
        const message = `Are you sure you want to remove "${modelName}" from the application?\n\n` +
                       `This will:\n` +
                       `• Remove it from the app's library\n` +
                       `• NOT delete the actual .safetensors file from your disk\n` +
                       `• Prevent it from loading again until manually re-added\n\n` +
                       `Click OK to continue or Cancel to abort.`;
        
        const confirmResult = await showCustomConfirm('Confirm Deletion', message);
        if (!confirmResult) {
            return;
        }
        
        const modelKey = getModelKey(model);
          // Remove from models array
        models = models.filter(m => getModelKey(m) !== modelKey);
        
        // Add to previously_deleted list on server
        const modelPath = model.safetensorsPath || model.filePath;
        if (modelPath) {
            try {
                await fetch('/add-to-deleted', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePaths: [modelPath] })
                });
                console.log(`Added ${modelPath} to previously_deleted list`);
            } catch (error) {
                console.error('Failed to add model to deleted list:', error);
            }
        }
        
        // Remove from selections and favorites
        selectedModels.delete(modelKey);
        await favoritesManager.removeFavorite(modelKey);
        
        // Remove custom tags
        delete customTags[modelKey];
        localStorage.setItem('customTags', JSON.stringify(customTags));
          // Save and refresh while preserving current page
        saveModelsToLocalStorage();
        applySearchAndFilters(false, true); // preservePage = true
        updateSelectionUI();
        
        elements.statusBar.textContent = `Deleted "${modelName}" from library`;
        elements.statusBar.className = 'status-bar success';
    }
    
    async function copyModelPath(model) {
        const filePath = model.safetensorsPath || model.filePath || 'Path not available';
        
        try {
            await navigator.clipboard.writeText(filePath);
            elements.statusBar.textContent = 'File path copied to clipboard';
            elements.statusBar.className = 'status-bar success';
        } catch (err) {
            console.error('Failed to copy path:', err);
            elements.statusBar.textContent = 'Failed to copy file path';
            elements.statusBar.className = 'status-bar error';
        }
    }
    
    function revealInExplorer(model) {
        const filePath = model.safetensorsPath || model.filePath;
        if (!filePath) {
            elements.statusBar.textContent = 'File path not available';
            elements.statusBar.className = 'status-bar error';
            return;
        }
        
        // Use shell.showItemInFolder to reveal the file in explorer
        shell.showItemInFolder(filePath);
        elements.statusBar.textContent = 'File revealed in explorer';
        elements.statusBar.className = 'status-bar success';
    }      // View mode and grid size functions
    async function switchViewMode(mode) {
        viewMode = mode;
        localStorage.setItem('viewMode', viewMode);
        
        // Update button states
        elements.gridViewBtn.classList.toggle('active', mode === 'grid');
        elements.listViewBtn.classList.toggle('active', mode === 'list');
        
        // Update grid classes
        elements.modelGrid.classList.toggle('list-view', mode === 'list');
        
        // Clear keyboard focus when switching modes
        clearKeyboardFocus();
          // Regenerate the grid with new view mode
        await displayModelGrid();
        updateSearchStats();
        
        elements.statusBar.textContent = `Switched to ${mode} view`;
        elements.statusBar.className = 'status-bar success';
    }
    // File size calculation function
    function calculateFileSize(model) {
        // Try to get file size from safetensors file info if available
        const files = model.modelVersion?.files || [];
        const safetensorsFile = files.find(f => f.name?.endsWith('.safetensors') || f.type === 'Model');
        
        if (safetensorsFile && safetensorsFile.sizeKB) {
            return formatFileSize(safetensorsFile.sizeKB);
        }
        
        // Fallback to default size estimation
        return 'Unknown size';
    }// App State
    let models = JSON.parse(localStorage.getItem('civitaiModels')) || [];
    let filteredModels = []; // For search/filter results
    let selectedFiles = [];
    let currentModel = null;
    let currentImageIndex = 0;    let watchedFolders = JSON.parse(localStorage.getItem('watchedFolders')) || [];
    let currentPage = parseInt(localStorage.getItem('currentPage')) || 1;
    console.log(`Initialized currentPage from localStorage: ${currentPage}`);
    const itemsPerPage = 30; // 5 columns * 6 rows
      // Enhanced state management for new features
    let selectedModels = new Set(); // For multi-select functionality
    // favoriteModels is now managed by favoritesManager - use getFavoriteModels() function
    function getFavoriteModels() {
        return favoritesManager.getFavorites();
    }
    let customTags = JSON.parse(localStorage.getItem('customTags')) || {}; // modelKey -> [tags]let collections = JSON.parse(localStorage.getItem('collections')) || {}; // collectionName -> [modelKeys]
    let viewMode = localStorage.getItem('viewMode') || 'grid'; // 'grid' or 'list'
    let selectedModelForContextMenu = null;
    let contextMenuOpen = false;    // Search and filter state - start fresh (clear all filters on app start)
    let searchTerm = '';
    let activeFilters = {
        creator: '',
        baseModel: '',
        modelType: '',
        favoritesOnly: false
    };
    let currentSort = 'name'; // Default sort by name
    let sortedModels = []; // Cache for sorted models
    
    // Clear filter-related localStorage values on app start to ensure fresh state
    localStorage.removeItem('searchTerm');
    localStorage.removeItem('activeFilters');
    localStorage.removeItem('currentSort');
    
    // Reset all filter UI elements to default values on app start
    // Wait a moment for DOM elements to be ready, then reset them
    setTimeout(() => {
        // Reset search input
        if (elements.searchInput) {
            elements.searchInput.value = '';
        }
        
        // Reset filter dropdowns to default "All" options
        if (elements.creatorFilter) {
            elements.creatorFilter.value = '';
        }
        if (elements.baseModelFilter) {
            elements.baseModelFilter.value = '';
        }
        if (elements.modelTypeFilter) {
            elements.modelTypeFilter.value = '';
        }
        if (elements.sortSelect) {
            elements.sortSelect.value = 'name';
        }
        
        // Reset favorites filter button to inactive state
        if (elements.favoritesFilterBtn) {
            elements.favoritesFilterBtn.classList.remove('active');
        }
        
        console.log('All filter UI elements reset to default values on app start');
    }, 100); // Small delay to ensure DOM elements are ready

    // Custom confirmation dialog function
    function showCustomConfirm(title, message) {
        return new Promise((resolve) => {
            const dialog = document.getElementById('confirmDialog');
            const titleEl = document.getElementById('confirmTitle');
            const messageEl = document.getElementById('confirmMessage');
            const cancelBtn = document.getElementById('confirmCancel');
            const okBtn = document.getElementById('confirmOk');
            
            titleEl.textContent = title;
            messageEl.textContent = message;
            dialog.style.display = 'block';
            
            function cleanup() {
                dialog.style.display = 'none';
                cancelBtn.removeEventListener('click', handleCancel);
                okBtn.removeEventListener('click', handleOk);
            }
            
            function handleCancel() {
                cleanup();
                resolve(false);
            }
            
            function handleOk() {
                cleanup();
                resolve(true);
            }
            
            cancelBtn.addEventListener('click', handleCancel);
            okBtn.addEventListener('click', handleOk);
            
            // Focus the OK button by default
            okBtn.focus();
        });
    }

    // Keyboard navigation helper functions
    function getModelKey(model) {
        const modelData = model.modelVersion || model;
        
        // If we have proper CivitAI metadata, use the standard format
        if (modelData.modelId && modelData.id) {
            return `${modelData.modelId}_${modelData.id}`;
        }
        
        // For models without metadata, use the filename as a unique identifier
        // This ensures each .safetensors file gets a unique key
        if (model.safetensorsPath) {
            // Extract filename from path and use it as identifier
            const filename = model.safetensorsPath.split(/[/\\]/).pop();
            return `local_${filename}`;
        }
        
        // Final fallback using model name
        return `local_${model.name || 'unknown'}`;
    }

    // Check if model is already loaded
    function isModelLoaded(model) {
        const key = getModelKey(model);
        return models.some(m => getModelKey(m) === key);
    }

    // Helper function to generate consistent filename
    async function generateFilename(url) {
        const encoder = new TextEncoder();
        const data = encoder.encode(url);
        return crypto.subtle.digest('SHA-256', data)
            .then(hash => {
                const hashArray = Array.from(new Uint8Array(hash));
                const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                return `${hashHex}.webp`;  // Make sure extension is .webp
            });
    }    // Helper function to check if a URL or type indicates a video
    function isVideoContent(imageData) {
        if (!imageData) return false;
        
        // Check if the type field explicitly says it's a video
        if (imageData.type === 'video') {
            return true;
        }
        
        // Check URL for video file extensions
        const url = imageData.url || imageData.originalUrl || '';
        const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.gif'];
        const lowerUrl = url.toLowerCase();
        
        return videoExtensions.some(ext => lowerUrl.includes(ext));
    }
    
    // Helper function to find the first valid (non-video) image
    function getFirstValidImage(images) {
        if (!Array.isArray(images) || images.length === 0) {
            return null;
        }
        
        // Find the first image that is not a video
        for (const image of images) {
            if (!isVideoContent(image)) {
                return image;
            }
        }
        
        // If all images are videos, return null
        return null;
    }    // Update the processImage function
    async function processImage(imageUrl, imageData = null) {
        try {
            if (!imageUrl) return null;
            
            // Check if this is video content and skip if so
            if (imageData && isVideoContent(imageData)) {
                console.log('Skipping video content:', imageUrl);
                return null;
            }
            
            // Also check URL-based video detection for safety
            if (isVideoContent({ url: imageUrl })) {
                console.log('Skipping video URL:', imageUrl);
                return null;
            }

            // Check cache first
            if (imageCache.has(imageUrl)) {
                return imageCache.get(imageUrl);
            }

            const filename = await generateFilename(imageUrl);
            const localPath = `/images/${filename}`;

            // Check if file exists locally first
            try {
                const checkResponse = await fetch(`/check-image?path=${encodeURIComponent(localPath)}`);
                if (checkResponse.ok) {
                    imageCache.set(imageUrl, localPath);
                    return localPath;
                }
            } catch (checkError) {
                console.warn('Error checking local image:', checkError);
            }            // If not found locally and it's a remote URL, download it
            if (imageUrl.startsWith('https://')) {
                // Wait if too many concurrent downloads
                while (concurrentDownloads >= MAX_CONCURRENT_DOWNLOADS) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                concurrentDownloads++;
                console.log('Downloading image:', imageUrl, `(${concurrentDownloads}/${MAX_CONCURRENT_DOWNLOADS})`);
                
                try {
                    const response = await fetch(`/get-image?url=${encodeURIComponent(imageUrl)}`);
                    if (response.ok) {
                        console.log('Successfully downloaded:', localPath);
                        imageCache.set(imageUrl, localPath);
                        return localPath;
                    } else {
                        console.error('Failed to download image:', response.status, response.statusText);
                    }
                } catch (downloadError) {
                    console.error('Download error:', downloadError);
                } finally {
                    concurrentDownloads--;
                }
            }

            return null;
        } catch (error) {
            console.error('Image processing error for', imageUrl, ':', error);
            return null;
        }
    }    // Update the reprocessStoredModelImages function
    async function reprocessStoredModelImages() {
        if (!models.length) return;

        console.log('Starting background image reprocessing...');
        
        // Create a worker
        const worker = new Worker('workers/image-processor.js');
        
        // Collect all images that need processing
        const imagesToProcess = [];
        for (const model of models) {
            const modelData = model.modelVersion || model;
            if (modelData.images?.length) {
                imagesToProcess.push(...modelData.images);
            }
        }

        // Handle worker messages
        worker.addEventListener('message', async (e) => {
            const { type, ...data } = e.data;
            
            switch (type) {
                case 'progress':
                    // Update status without blocking UI
                    elements.statusBar.textContent = 
                        `Processing images in background: ${data.current}/${data.total}`;
                    break;                case 'process':
                    // Process single image
                    try {
                        const newUrl = await processImage(data.url, data.imageData);
                        if (newUrl) {
                            // Update image URL in models array
                            const image = data.imageData;
                            image.url = newUrl;
                        }
                    } catch (error) {
                        console.error('Failed to process image:', error);
                    }
                    break;

                case 'error':
                    console.error('Image processing error:', data.error);
                    break;

                case 'complete':
                    console.log(`Background processing complete: ${data.processedCount}/${data.totalImages} images processed`);
                    elements.statusBar.textContent = 'Image processing complete';
                    worker.terminate();
                    saveModelsToLocalStorage();
                    break;
            }
        });

        // Start processing
        worker.postMessage({ 
            images: imagesToProcess,
            baseUrl: window.location.origin 
        });

        // Return immediately to not block UI
        return true;
    }

    // Load JSON files from a folder
    async function loadJSONFilesFromFolder(folderPath) {
        try {            elements.statusBar.textContent = `Scanning folder: ${folderPath}`;
            elements.statusBar.className = 'status-bar processing';
            
            const response = await fetch('/scan-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath })
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || 'Failed to scan folder');
            }
            
            const { files } = await response.json();
            let newModelsLoaded = 0;
            
            for (const file of files) {
                try {
                    const fileResponse = await fetch(`/get-file?path=${encodeURIComponent(file)}`);
                    if (!fileResponse.ok) continue;
                    
                    const modelData = await fileResponse.json();
                    const modelKey = getModelKey(modelData);
                    
                    // Skip if model is already loaded
                    if (isModelLoaded(modelData)) continue;
                      // Process all images in the model
                    const modelVersion = modelData.modelVersion || modelData;
                    if (modelVersion.images?.length) {
                        for (const image of modelVersion.images) {
                            // Skip video content during initial loading
                            if (isVideoContent(image)) {
                                console.log('Skipping video content during model load:', image.url);
                                continue;
                            }
                            
                            // IMPORTANT: Save the Civitai URL from the JSON first
                            image.originalUrl = image.url;  // The URL in the JSON is the Civitai URL
                            image.url = undefined;  // Clear the URL to force reprocessing
                            
                            // Process image immediately
                            if (image.originalUrl?.startsWith('https://')) {
                                try {
                                    image.url = await processImage(image.originalUrl, image);
                                } catch (imgError) {
                                    console.error('Failed to process image during load:', imgError);
                                }
                            }
                        }
                    }
                    
                    // Store file path and add to models array
                    modelData.filePath = file;
                    models.push(modelData);
                    newModelsLoaded++;
                    
                    // Update status
                    elements.statusBar.textContent = `Processing model ${newModelsLoaded}...`;
                } catch (error) {
                    console.error(`Error processing file ${file}:`, error);
                }
            }            if (newModelsLoaded > 0) {                displayModelGrid(models);
                saveModelsToLocalStorage();
                populateFilterOptions(); // Update filter options with new models
                
                // Refresh cache and localStorage after loading from folder
                await refreshAfterAddingModels();
                
                elements.statusBar.textContent = `Loaded ${newModelsLoaded} models from ${folderPath}`;
                elements.statusBar.className = 'status-bar success';} else {
                elements.statusBar.textContent = `No new models found in ${folderPath}`;
                elements.statusBar.className = 'status-bar warning';
            }
        } catch (error) {
            console.error('Error loading folder:', error);
            elements.statusBar.textContent = `Error: ${error.message}`;
            elements.statusBar.className = 'status-bar error';
        }
    }

    // Save models to localStorage
    function saveModelsToLocalStorage() {
        try {
            const modelsToSave = models.map(model => {
                const modelCopy = JSON.parse(JSON.stringify(model));
                if (modelCopy.modelVersion?.images) {
                    modelCopy.modelVersion.images = modelCopy.modelVersion.images.map(image => {
                        // Ensure we have both URLs
                        if (!image.originalUrl && image.url?.startsWith('https://')) {
                            image.originalUrl = image.url;
                        }
                        
                        return {
                            ...image,
                            originalUrl: image.originalUrl,  // Keep the Civitai URL
                            url: image.url,  // Keep the local path
                            width: image.width,
                            height: image.height,
                            hash: image.hash,
                            nsfwLevel: image.nsfwLevel,
                            meta: image.meta
                        };
                    });
                }
                return modelCopy;
            });
            
            localStorage.setItem('civitaiModels', JSON.stringify(modelsToSave));
        } catch (error) {
            console.error('Failed to save models to localStorage:', error);
        }
    }

    // Save config
    async function saveConfig() {
        try {
            await fetch('/save-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    standalone_files: config.standalone_files,
                    watched_folders: config.watched_folders
                })
            });
        } catch (error) {
            console.error('Failed to save config:', error);
        }
    }

    // Render folder list
    function renderFolderList() {
        elements.watchedFoldersList.innerHTML = '';
        watchedFolders.forEach((folder, index) => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            folderItem.innerHTML = `
                <span>${folder}</span>
                <button class="remove-folder" data-index="${index}">
                    <i class="fas fa-times"></i>
                </button>
            `;
            elements.watchedFoldersList.appendChild(folderItem);
        });
        
        // Add event listeners to remove buttons
        document.querySelectorAll('.remove-folder').forEach(button => {
            button.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.getAttribute('data-index'));
                watchedFolders.splice(index, 1);
                localStorage.setItem('watchedFolders', JSON.stringify(watchedFolders));
                renderFolderList();
                
                // Remove models from this folder
                models = models.filter(model => {
                    const modelPath = model.filePath || '';
                    return !modelPath.startsWith(watchedFolders[index]);
                });
                
                saveModelsToLocalStorage();
                displayModelGrid(models);
            });
        });
    }

    // Update file handling function
    async function handleFiles(files) {
        try {            if (!files || files.length === 0) {
                elements.statusBar.textContent = 'No files selected';
                elements.statusBar.className = 'status-bar error';
                elements.loadBtn.disabled = true;
                return;
            }

            // Convert files to our format with full paths
            selectedFiles = Array.from(files).map(file => ({
                name: file.name || path.basename(file.path),
                fullPath: file.path // This will be the full path
            }));

            console.log('Selected files:', selectedFiles);            elements.statusBar.textContent = `Selected ${selectedFiles.length} model file(s)`;
            elements.statusBar.className = 'status-bar success';
            elements.loadBtn.disabled = false;

        } catch (error) {
            console.error('Error handling files:', error);            elements.statusBar.textContent = 'Error handling files';
            elements.statusBar.className = 'status-bar error';
        }
    }

    // Add this function to handle image loading
    async function loadModelImage(imageUrl, originalUrl) {
        try {
            if (!imageUrl) return null;
            
            // If it's already a local path, verify it exists
            if (imageUrl.startsWith('/images/')) {
                try {
                    const checkResponse = await fetch(`/check-image?path=${encodeURIComponent(imageUrl)}`);
                    if (checkResponse.ok) {
                        return imageUrl; // Local file exists
                    }
                    // Local file doesn't exist, fall through to redownload
                } catch (error) {
                    console.warn('Error checking local image:', error);
                }
            }

            // At this point, either the local file doesn't exist or we have a Civitai URL
            const urlToDownload = originalUrl || imageUrl;
            if (!urlToDownload.startsWith('https://')) {
                console.error('No valid URL to download from');
                return null;
            }

            console.log('Downloading image from:', urlToDownload);
            const response = await fetch(`/get-image?url=${encodeURIComponent(urlToDownload)}`);
            
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.status}`);
            }

            // Return the local path that the server would have saved it to
            const filename = await generateFilename(urlToDownload);
            return `/images/${filename}`;
        } catch (error) {
            console.error('Error loading image:', error);
            return null;
        }
    }    // Enhanced displayModelGrid function with all new features
    let displayGridRunning = false; // Prevent concurrent display operations
      async function displayModelGrid(preserveStatus = false) {
        // Prevent concurrent display operations
        if (displayGridRunning) {
            console.log('Display grid already running, skipping...');
            return;
        }
        
        displayGridRunning = true;
        
        try {
            const displayModels = getDisplayModels();
            
            // Always show the UI elements immediately
            elements.searchFilterContainer.style.display = 'block';
            elements.enhancedControls.style.display = 'flex';
              if (!displayModels || displayModels.length === 0) {
                // Show empty state but keep UI visible
                elements.modelGrid.innerHTML = '<div class="empty-state">No models found. Load some models to get started.</div>';
                elements.statusBar.textContent = 'No models found matching your criteria.';
                elements.statusBar.className = 'status-bar warning';
                document.querySelector('.pagination-controls').style.display = 'none';
                elements.topPaginationControls.style.display = 'flex'; // Always show top pagination
                // Set top pagination for empty state
                elements.topPrevPage.disabled = true;
                elements.topNextPage.disabled = true;
                elements.topPageInfo.textContent = 'Page 1 of 1';
                return;
            }

            const totalPages = Math.ceil(displayModels.length / itemsPerPage);
            currentPage = Math.min(currentPage, totalPages); // Ensure current page is valid            // Update both pagination controls - always show top pagination, bottom only when needed
            const showBottomPagination = totalPages > 1;
            document.querySelector('.pagination-controls').style.display = showBottomPagination ? 'flex' : 'none';
            elements.topPaginationControls.style.display = 'flex'; // Always show top pagination
            
            // Update pagination info and button states
            const pageText = `Page ${currentPage} of ${Math.max(1, totalPages)}`;            // Update bottom pagination (when visible)
            if (showBottomPagination) {
                document.getElementById('prevPage').disabled = currentPage === 1;
                document.getElementById('nextPage').disabled = currentPage === totalPages;
                document.getElementById('pageInfo').textContent = pageText;
            } else {
                // Even when bottom pagination is hidden, ensure buttons are in correct state
                document.getElementById('prevPage').disabled = true;
                document.getElementById('nextPage').disabled = true;
            }
            
            // Always update top pagination
            elements.topPrevPage.disabled = currentPage === 1;
            elements.topNextPage.disabled = currentPage === totalPages;
            elements.topPageInfo.textContent = pageText;

            // Calculate slice indexes
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, displayModels.length);
            const currentModels = displayModels.slice(startIndex, endIndex);
            
            // Force clear the grid completely
            elements.modelGrid.innerHTML = '';
            
            // Force a reflow to ensure the innerHTML clear has taken effect
            elements.modelGrid.offsetHeight;
            
            // Double-check that grid is actually empty before proceeding
            if (elements.modelGrid.children.length > 0) {
                console.warn('Grid not properly cleared, forcing manual clear');
                while (elements.modelGrid.firstChild) {
                    elements.modelGrid.removeChild(elements.modelGrid.firstChild);
                }
            }
        
        // Set display style based on view mode
        if (viewMode === 'list') {
            elements.modelGrid.style.display = 'flex';
        } else {
            elements.modelGrid.style.display = 'grid';
        }
        
        // Apply view mode classes
        elements.modelGrid.classList.toggle('list-view', viewMode === 'list');        let loadedImages = 0;
        const totalImages = currentModels.length;
        
        // Only update status if not preserving it (during scanning)
        if (!preserveStatus) {
            elements.statusBar.textContent = `Loading example images (0/${totalImages})...`;
            elements.statusBar.className = 'status-bar processing';
        }for (const model of currentModels) {            const modelData = model.modelVersion || model;
            const modelInfo = model.model || {};
            const firstImage = getFirstValidImage(modelData.images);
            const modelType = modelInfo.type || modelData.model?.type || 'Unknown';
            const baseModel = baseModelNormalization.getBaseModelFromModel(model, models);
            const modelKey = getModelKey(model);
            const isSelected = selectedModels.has(modelKey);
            const isFav = favoritesManager.isFavorite(modelKey);
            const fileSize = calculateFileSize(model);
            const hasMetadataError = model.metadataFailed;

            const card = document.createElement('div');
            card.className = `model-card ${isSelected ? 'selected' : ''} ${isFav ? 'favorite' : ''} ${hasMetadataError ? 'metadata-error' : ''}`;

            // Generate different HTML based on view mode
            if (viewMode === 'list') {
                // List view layout - horizontal layout with different badge positioning
                card.innerHTML = `
                    <div class="model-select-checkbox">
                        <input type="checkbox" ${isSelected ? 'checked' : ''}>
                    </div>
                    <div class="model-list-image loading">
                        <div style="background: var(--secondary-color); width: 80px; height: 80px;"></div>
                    </div>
                    <div class="model-list-info">
                        <div class="model-list-main">
                            <h3>${modelInfo.name || modelData.name}</h3>
                            <div class="model-list-meta">
                                <span class="creator-name">${modelInfo.creator?.username || 'Unknown Creator'}</span>
                                <span class="model-list-stats">
                                    <i class="fas fa-download"></i> ${modelData.stats?.downloadCount || 0}
                                    <i class="fas fa-thumbs-up"></i> ${modelData.stats?.thumbsUpCount || 0}
                                </span>
                            </div>
                        </div>                        <div class="model-list-badges">
                            ${hasMetadataError ? `<span class="list-badge error" title="Failed to load metadata from CivitAI">Failed</span>` : `<span class="list-badge model-type">${modelType}</span>`}
                            ${baseModel && !hasMetadataError ? `<span class="list-badge base-model">${baseModel}</span>` : ''}
                            ${fileSize ? `<span class="list-badge file-size">${fileSize}</span>` : ''}
                        </div>
                    </div>
                    <div class="model-list-actions">
                        <div class="model-favorite-btn ${isFav ? 'active' : ''}">
                            <i class="fas fa-heart"></i>
                        </div>
                    </div>
                `;
            } else {
                // Grid view layout - original card layout
                card.innerHTML = `
                    <div class="model-select-checkbox">
                        <input type="checkbox" ${isSelected ? 'checked' : ''}>
                    </div>                    <div class="model-card-image loading">
                        <div style="background: var(--secondary-color); height: 100%;"></div>
                        ${hasMetadataError ? `<div class="metadata-error-badge" title="Failed to load metadata from CivitAI"><i class="fas fa-times"></i></div>` : `<div class="model-type-badge">${modelType}</div>`}
                        ${modelInfo.creator?.username && !hasMetadataError ? `<div class="creator-badge">${modelInfo.creator.username}</div>` : ''}
                        ${baseModel && !hasMetadataError ? `<div class="base-model-badge">${baseModel}</div>` : ''}
                        ${fileSize ? `<div class="file-size-badge">${fileSize}</div>` : ''}
                    </div>
                    <div class="model-card-info">
                        <h3>${modelInfo.name || modelData.name}</h3>
                        <div class="model-card-stats">
                            <span title="Downloads"><i class="fas fa-download"></i> ${modelData.stats?.downloadCount || 0}</span>
                            <span title="Likes"><i class="fas fa-thumbs-up"></i> ${modelData.stats?.thumbsUpCount || 0}</span>
                        </div>
                    </div>
                    <div class="model-favorite-btn ${isFav ? 'active' : ''}">
                        <i class="fas fa-heart"></i>
                    </div>
                `;
            }            // Add checkbox event listener
            const checkbox = card.querySelector('.model-select-checkbox input');
            if (checkbox) {
                checkbox.addEventListener('click', (e) => {
                    console.log('Checkbox clicked!', model);
                    e.stopPropagation();
                    toggleModelSelection(model);
                });
            } else {
                console.warn('Checkbox not found in card for model:', model);
            }// Add favorite button event listener
            const favoriteBtn = card.querySelector('.model-favorite-btn');
            favoriteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await toggleFavorite(model);
            });

            // Add context menu event listener
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e, model);
            });

            // Add main click event listener for opening details
            card.addEventListener('click', (e) => {
                // Don't open details if clicking on checkbox or favorite button
                if (e.target.closest('.model-select-checkbox') || e.target.closest('.model-favorite-btn')) {
                    return;
                }
                
                openModelDetails(model);
            });            elements.modelGrid.appendChild(card);

            // Skip image processing when returning from details to improve performance
            const returningFromDetails = localStorage.getItem('returningFromDetails') === 'true';
            
            // Process image silently in the background WITHOUT blocking (only if not returning from details)
            if (firstImage && !hasMetadataError && !returningFromDetails) {
                const originalUrl = firstImage.originalUrl || firstImage.url;
                
                // Don't await - let it process in the background
                processImage(originalUrl, firstImage).then(imageUrl => {
                    if (imageUrl) {
                        if (viewMode === 'list') {
                            // List view image processing using regular images
                            const imgContainer = card.querySelector('.model-list-image');
                            if (imgContainer) {
                                imgContainer.classList.remove('loading');
                                imgContainer.innerHTML = `
                                    <img src="${imageUrl}" 
                                         alt="${modelData.name}"
                                         loading="lazy"
                                         style="width: 80px; height: 80px; object-fit: cover; border-radius: 6px;">
                                `;
                            }
                        } else {
                            // Grid view image processing (original)
                            const imgContainer = card.querySelector('.model-card-image');
                            if (imgContainer) {
                                imgContainer.classList.remove('loading');
                                imgContainer.innerHTML = `
                                    <div class="model-card-image-wrapper">
                                        <img src="${imageUrl}" 
                                             alt="${modelData.name}"
                                             loading="lazy"
                                             style="width: 100%; height: 100%; object-fit: cover;">
                                    </div>
                                    ${hasMetadataError ? `<div class="metadata-error-badge" title="Failed to load metadata from CivitAI"><i class="fas fa-times"></i></div>` : `<div class="model-type-badge">${modelType}</div>`}
                                    ${modelInfo.creator?.username && !hasMetadataError ? `<div class="creator-badge">${modelInfo.creator.username}</div>` : ''}
                                    ${baseModel && !hasMetadataError ? `<div class="base-model-badge">${baseModel}</div>` : ''}
                                    ${fileSize ? `<div class="file-size-badge">${fileSize}</div>` : ''}
                                `;
                            }
                        }
                        
                        loadedImages++;
                        
                        // Only update status if not preserving it (during scanning)
                        if (!preserveStatus) {
                            elements.statusBar.textContent = `Loading example images (${loadedImages}/${totalImages})...`;
                        }
                    }                }).catch(error => {
                    console.error('Background image processing failed:', error);
                });
            } else if (firstImage && !hasMetadataError && returningFromDetails) {
                // Use existing processed image when returning from details for performance
                const existingImageUrl = firstImage.url || firstImage.originalUrl;
                if (existingImageUrl) {
                    if (viewMode === 'list') {
                        // List view using existing image
                        const imgContainer = card.querySelector('.model-list-image');
                        if (imgContainer) {
                            imgContainer.classList.remove('loading');
                            imgContainer.innerHTML = `
                                <img src="${existingImageUrl}" 
                                     alt="${modelData.name}"
                                     loading="lazy"
                                     style="width: 80px; height: 80px; object-fit: cover; border-radius: 6px;">
                            `;
                        }
                    } else {
                        // Grid view using existing image
                        const imgContainer = card.querySelector('.model-card-image');
                        if (imgContainer) {
                            imgContainer.classList.remove('loading');
                            imgContainer.innerHTML = `
                                <div class="model-card-image-wrapper">
                                    <img src="${existingImageUrl}" 
                                         alt="${modelData.name}"
                                         loading="lazy"
                                         style="width: 100%; height: 100%; object-fit: cover;">
                                </div>
                                ${hasMetadataError ? `<div class="metadata-error-badge" title="Failed to load metadata from CivitAI"><i class="fas fa-times"></i></div>` : `<div class="model-type-badge">${modelType}</div>`}
                                ${modelInfo.creator?.username && !hasMetadataError ? `<div class="creator-badge">${modelInfo.creator.username}</div>` : ''}
                                ${baseModel && !hasMetadataError ? `<div class="base-model-badge">${baseModel}</div>` : ''}
                                ${fileSize ? `<div class="file-size-badge">${fileSize}</div>` : ''}
                            `;
                        }
                    }
                }
            }else if (hasMetadataError) {
                // Show placeholder for failed metadata models
                if (viewMode === 'list') {
                    const imgContainer = card.querySelector('.model-list-image');
                    if (imgContainer) {
                        imgContainer.classList.remove('loading');
                        imgContainer.innerHTML = `
                            <div style="width: 80px; height: 80px; background: var(--secondary-color); display: flex; align-items: center; justify-content: center; border-radius: 6px;">
                                <i class="fas fa-exclamation-triangle" style="color: #e74c3c; font-size: 1.5rem;"></i>
                            </div>
                        `;
                    }
                } else {                    const imgContainer = card.querySelector('.model-card-image');
                    if (imgContainer) {
                        imgContainer.classList.remove('loading');
                        imgContainer.innerHTML = `
                            <div style="width: 100%; height: 100%; background: var(--secondary-color); display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-exclamation-triangle" style="color: #e74c3c; font-size: 3rem;"></i>
                            </div>
                            <div class="metadata-error-badge" title="Failed to load metadata from CivitAI"><i class="fas fa-times"></i></div>
                            ${modelInfo.creator?.username ? `<div class="creator-badge">${modelInfo.creator.username}</div>` : ''}
                            ${fileSize ? `<div class="file-size-badge">${fileSize}</div>` : ''}
                        `;
                    }
                }
            }
        }        // Update selection UI
        updateSelectionUI();
        
        // Clear keyboard focus when grid is re-rendered
        clearKeyboardFocus();

        // Update status (images will continue loading in background)
        if (!preserveStatus) {
            elements.statusBar.textContent = `${currentModels.length} models displayed, images loading...`;
            elements.statusBar.className = 'status-bar processing';
        }
        } finally {
            displayGridRunning = false;
    }
    }

    function formatFileSize(kb) {
        if (!kb) return 'Unknown size';
        return kb < 1024 ? `${kb.toFixed(2)} KB` : `${(kb / 1024).toFixed(2)} MB`;
    }

    // Add theme toggle functionality
    elements.themeToggle.addEventListener('click', async () => {
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
        const newTheme = isDarkMode ? 'light' : 'dark';
        
        // Update theme
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('darkMode', !isDarkMode);
        
        // Save theme to config.json
        try {
            await fetch('/save-theme', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ theme: newTheme })
            });
        } catch (error) {
            console.error('Failed to save theme to config:', error);
        }
          
        // Update background immediately
        document.documentElement.style.backgroundColor = !isDarkMode ? '#121212' : '#f9f9f9';
        document.body.style.backgroundColor = !isDarkMode ? '#121212' : '#f9f9f9';
          // Update button icon
        elements.themeToggle.querySelector('i').className = 
            !isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
    });
      // Add home link functionality (clear filters on index.html)
    const homeLink = document.getElementById('homeLink');
    if (homeLink) {
        homeLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Clear any stored scroll position to prevent restoration
            localStorage.removeItem('scrollPosition');
            // Clear all filters and go to page 1
            clearAllFilters();
            // Scroll to top of page
            window.scrollTo(0, 0);
        });
    }// Update loadSafetensorsFromFolder function
    async function loadSafetensorsFromFolder(folderPath) {
        try {
            const response = await fetch('/scan-safetensors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const totalFiles = data.files.length;
            let processedFiles = 0;
            
            for (const filePath of data.files) {
                try {
                    const fileName = path.basename(filePath, '.safetensors');
                    
                    // Update status to show which file is being scanned
                    elements.statusBar.textContent = `Scanning ${fileName} (${processedFiles + 1}/${totalFiles})`;
                    elements.statusBar.className = 'status-bar processing';
                    
                    console.log('Processing file:', filePath);
                    const response = await fetch('/upload-model', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            filePath: filePath,
                            fileName: path.basename(filePath)
                        })
                    });                    if (response.ok) {
                        // Update status to show JSON generation
                        elements.statusBar.textContent = `Generating JSON for ${fileName} (${processedFiles + 1}/${totalFiles})`;
                        elements.statusBar.className = 'status-bar processing';
                        
                        // Add a small delay to ensure the status message is visible
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        const modelData = await response.json();
                        modelData.safetensorsPath = filePath;
                        
                        // Add model to array immediately for live updates
                        models.push(modelData);
                        
                        // Save to localStorage immediately for cache updates
                        saveModelsToLocalStorage();                        // Trigger live UI update - refresh the grid to show new model
                        try {
                            // Store current status to restore it after grid update
                            const currentStatusText = elements.statusBar.textContent;
                            const currentStatusClass = elements.statusBar.className;
                            
                            // Check if we're currently scanning/generating JSON
                            const isScanning = currentStatusText.includes('Generating JSON') || currentStatusText.includes('Scanning');
                            
                            // Refresh displayed models and filters
                            applySearchAndFilters(isScanning);
                            
                            // Only refresh grid if we're on the current/affected page
                            const displayModels = getDisplayModels();
                            const totalPages = Math.ceil(displayModels.length / itemsPerPage);
                            const modelPageIndex = Math.floor((displayModels.length - 1) / itemsPerPage) + 1;
                              // If the new model appears on the current page or we need to adjust pagination
                            if (modelPageIndex === currentPage || totalPages !== Math.ceil((displayModels.length - 1) / itemsPerPage)) {
                                // The grid was already updated by applySearchAndFilters, but we need to ensure
                                // pagination controls are updated if needed
                                if (!isScanning) {
                                    // If not scanning, allow normal grid update for pagination
                                    await displayModelGrid(false);
                                }
                            }
                        } catch (displayError) {
                            console.error('Error updating display during live scan:', displayError);
                        }
                    }
                    
                    processedFiles++;
                } catch (error) {
                    console.error(`Failed to process file ${filePath}:`, error);
                    processedFiles++;                }
            }
              // Show completion status after all files are processed
            if (totalFiles > 0) {
                elements.statusBar.textContent = `Completed scanning ${totalFiles} files from folder`;
                elements.statusBar.className = 'status-bar success';
                
                // Final grid update without preserving status to show final state
                applySearchAndFilters();
                displayModelGrid(); // Normal display update to show final counts
                
                // Refresh cache and localStorage after scanning folder
                await refreshAfterAddingModels();
            }
        } catch (error) {
            console.error('Error scanning folder:', error);
            elements.statusBar.textContent = `Error scanning folder: ${error.message}`;
            elements.statusBar.className = 'status-bar error';
        }
    }

    async function showWatchedFolders() {
        const contentEl = document.getElementById('watchedFoldersContent');
        contentEl.innerHTML = '';

        if (!config.watched_folders || config.watched_folders.length === 0) {
            contentEl.innerHTML = '<p>No folders being watched</p>';
            return;
        }

        for (const folder of config.watched_folders) {
            const item = document.createElement('div');
            item.className = 'watched-folder-item';
            item.innerHTML = `
                <span>${folder}</span>
                <button class="remove-btn" data-path="${folder}">
                    <i class="fas fa-trash"></i>
                </button>
            `;

            item.querySelector('.remove-btn').addEventListener('click', async () => {
                const index = config.watched_folders.indexOf(folder);
                if (index > -1) {
                    config.watched_folders.splice(index, 1);
                    await saveConfig();
                    showWatchedFolders();
                }
            });

            contentEl.appendChild(item);
        }
    }

    // Event listeners
    elements.fileInput.addEventListener('change', async (e) => {
        handleFiles(e.target.files);
    });

    // Add/update these event listeners after elements initialization
    elements.uploadBox.addEventListener('click', async () => {
        // Instead of clicking the hidden file input, send a message to main process
        const result = await ipcRenderer.invoke('open-file-dialog');
        if (result.filePaths && result.filePaths.length > 0) {
            // Convert the file paths to File-like objects
            const files = result.filePaths.map(filePath => ({
                name: path.basename(filePath),
                path: filePath
            }));
            handleFiles(files);
        }
    });

    elements.uploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        elements.uploadBox.classList.add('drag-over');
    });

    elements.uploadBox.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        elements.uploadBox.classList.remove('drag-over');
    });

    elements.uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        elements.uploadBox.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(files);
        }
    });

    // Update load button handler
    elements.loadBtn.addEventListener('click', async function() {
        if (selectedFiles.length === 0) return;
          elements.statusBar.textContent = `Processing ${selectedFiles.length} models...`;
        elements.statusBar.className = 'status-bar processing';
        elements.loadBtn.disabled = true;
        
        let filesProcessed = 0;
        let newModelsLoaded = 0;
        
        for (const file of selectedFiles) {
            try {
                console.log('Processing file:', file);
                
                // Use the full path directly
                const filePath = file.fullPath || file.name;
                
                // Skip if already processed or in standalone files
                if (models.some(m => m.filePath === filePath) || 
                    config.standalone_files.includes(filePath)) {
                    console.log(`Skipping already loaded model: ${filePath}`);
                    continue;
                }

                // Upload with the full path
                const response = await fetch('/upload-model', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        filePath,
                        fileName: file.name 
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    console.error(`Failed to process file: ${file.name}`, errorData);
                    continue;
                }

                const modelData = await response.json();
                
                // Read the generated JSON file
                const jsonResponse = await fetch(`/get-file?path=${encodeURIComponent(modelData.jsonPath)}`);
                if (!jsonResponse.ok) {
                    console.error(`Failed to load JSON for ${file.name}`);
                    continue;
                }

                const modelJson = await jsonResponse.json();
                modelJson.filePath = filePath; // Add file path to model data
                
                // Add new model to the array
                models.push(modelJson);
                  // Add to standalone files if not already there
                if (!config.standalone_files.includes(filePath)) {
                    config.standalone_files.push(filePath);
                    
                    // Remove from previously_deleted list if it was there
                    try {
                        await fetch('/remove-from-deleted', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filePaths: [filePath] })
                        });
                        console.log(`Removed ${filePath} from previously_deleted list`);
                    } catch (error) {
                        console.error('Failed to remove from deleted list:', error);
                    }
                    
                    // Save updated config to server
                    await fetch('/save-config', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(config)
                    });
                }
                
                filesProcessed++;
                newModelsLoaded++;
                elements.statusBar.textContent = `Processed ${filesProcessed} of ${selectedFiles.length} files...`;
                
            } catch (error) {
                console.error('Error processing file:', error);                elements.statusBar.textContent = `Error processing file: ${error.message}`;
                elements.statusBar.className = 'status-bar error';
            }
        }        // After processing all files
        if (newModelsLoaded > 0) {
            await displayModelGrid();            populateFilterOptions(); // Update filter options with new models
            
            // Refresh cache and localStorage after adding new models
            await refreshAfterAddingModels();
            
            elements.statusBar.textContent = `Successfully loaded ${newModelsLoaded} new models`;
            elements.statusBar.className = 'status-bar success';} else {
            elements.statusBar.textContent = 'No new models were loaded';
            elements.statusBar.className = 'status-bar warning';
        }
        
        elements.loadBtn.disabled = false;
        selectedFiles = []; // Clear selected files
    });    elements.addFolderBtn.addEventListener('click', async () => {
        const folderPath = elements.folderPathInput.value.trim();
        if (!folderPath) return;

        try {
            // Add folder to watched_folders immediately
            if (!config.watched_folders.includes(folderPath)) {
                config.watched_folders.push(folderPath);
                await saveConfig();
                await showWatchedFolders(); // Update the UI immediately
                
                elements.statusBar.textContent = `Added "${folderPath}" to watched folders. Scanning in background...`;
                elements.statusBar.className = 'status-bar success';
            } else {
                elements.statusBar.textContent = `Folder "${folderPath}" is already being watched`;
                elements.statusBar.className = 'status-bar warning';
                elements.folderPathInput.value = '';
                return;
            }
            
            // Clear the input field immediately
            elements.folderPathInput.value = '';
            
            // Start background scanning (non-blocking)
            setTimeout(async () => {
                try {
                    elements.statusBar.textContent = `Scanning folder: ${folderPath}...`;
                    elements.statusBar.className = 'status-bar processing';
                    
                    await loadSafetensorsFromFolder(folderPath);
                    
                    // Remove all .safetensors files in this folder from previously_deleted list
                    try {
                        const scanResponse = await fetch('/scan-safetensors', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ folderPath })
                        });
                        
                        if (scanResponse.ok) {
                            const { files } = await scanResponse.json();
                            if (files && files.length > 0) {
                                await fetch('/remove-from-deleted', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ filePaths: files })
                                });
                                console.log(`Removed ${files.length} files from previously_deleted list when adding watched folder`);
                            }
                        }
                    } catch (error) {
                        console.error('Failed to remove folder files from deleted list:', error);
                    }
                    
                    elements.statusBar.textContent = `Finished scanning folder: ${path.basename(folderPath)}`;
                    elements.statusBar.className = 'status-bar success';
                    
                    // Clear success message after a few seconds
                    setTimeout(() => {
                        if (elements.statusBar.textContent.includes('Finished scanning')) {
                            elements.statusBar.textContent = 'Ready';
                            elements.statusBar.className = 'status-bar';
                        }
                    }, 3000);
                    
                } catch (error) {
                    console.error('Error scanning folder in background:', error);
                    elements.statusBar.textContent = `Error scanning folder: ${error.message}`;
                    elements.statusBar.className = 'status-bar error';
                }
            }, 100); // Small delay to ensure UI updates first
            
        } catch (error) {
            console.error('Error adding folder:', error);
            elements.statusBar.textContent = `Error adding folder: ${error.message}`;
            elements.statusBar.className = 'status-bar error';
        }
    });

    // Add browse folder button event listener
    elements.browseFolderBtn.addEventListener('click', async () => {
        try {
            // Open folder selection dialog
            const result = await ipcRenderer.invoke('open-folder-dialog');
            
            if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
                // Set the selected folder path in the input field
                elements.folderPathInput.value = result.filePaths[0];
                
                // Show feedback
                elements.statusBar.textContent = 'Folder selected. Click "Add Folder" to watch it.';
                elements.statusBar.className = 'status-bar success';
            }
        } catch (error) {
            console.error('Error opening folder dialog:', error);
            elements.statusBar.textContent = 'Failed to open folder selection dialog';
            elements.statusBar.className = 'status-bar error';
        }
    });

    // Update model card
    function updateModelCard(card, modelData) {
        const name = modelData.filePath 
            ? path.basename(modelData.filePath, '.json')
            : modelData.name;

        card.querySelector('h3').textContent = name;
    }

    // Update file input accept attribute
    elements.fileInput.accept = '.safetensors';    // Update the loadModels function with force refresh parameter
    async function loadModels(forceRefresh = false) {
        try {
            // Only clear existing data if force refresh is requested
            if (forceRefresh) {
                console.log('Force refresh requested - clearing all cached data');
                models = [];
                filteredModels = [];
                selectedModels.clear();
                localStorage.removeItem('civitaiModels');
            } else {
                console.log('Normal model loading - preserving cache if possible');
                // Just clear the runtime arrays but don't remove localStorage
                models = [];
                filteredModels = [];
                selectedModels.clear();
            }
            
            // Get all models from the optimized server endpoint
            const response = await fetch('/get-models');
            if (!response.ok) {
                throw new Error('Failed to get models from server');
            }
            
            const data = await response.json();
            if (data.success) {
                // Handle different response types from optimized endpoint
                if (data.loading) {
                    // Background scan in progress, show loading state
                    console.log('Models are loading in background...');
                    elements.statusBar.textContent = 'Loading models in background...';
                    elements.statusBar.className = 'status-bar processing';
                    
                    // Start polling for updates every 2 seconds
                    const pollInterval = setInterval(async () => {
                        const updateComplete = await checkModelUpdates();
                        if (updateComplete) {
                            clearInterval(pollInterval);
                        }
                    }, 2000);
                    
                    return false;
                }
                
                if (Array.isArray(data.models)) {
                    // Clear any existing models again to be absolutely sure
                    models = [];
                    
                    models = data.models.map(model => ({
                        ...model,
                        safetensorsPath: model.safetensorsPath || model.filePath
                    }));
                    
                    const cacheType = data.cached ? 'cache' : data.fresh ? 'fresh scan' : 'server';
                    console.log(`Loaded ${models.length} models from ${cacheType}`);
                    
                    if (models.length > 0) {
                        saveModelsToLocalStorage();
                        return true;
                    }
                }
            }

            // Fallback to loading individually if server response is empty
            console.log('No models from optimized endpoint, trying fallback...');
            const processedPaths = new Set();

            // Load watched folders
            for (const folder of config.watched_folders) {
                const scanResponse = await fetch('/scan-safetensors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: folder })
                });

                if (scanResponse.ok) {
                    const { files } = await scanResponse.json();
                    for (const filePath of files) {
                        if (processedPaths.has(filePath)) continue;
                        processedPaths.add(filePath);

                        // Just store the basic model info, we'll load details on demand
                        models.push({
                            safetensorsPath: filePath,
                            name: path.basename(filePath, '.safetensors'),
                            type: 'Model'
                        });
                    }
                }
            }

            // Load standalone files
            for (const filePath of config.standalone_files) {
                if (processedPaths.has(filePath)) continue;
                processedPaths.add(filePath);

                models.push({
                    safetensorsPath: filePath,
                    name: path.basename(filePath, '.safetensors'),
                    type: 'Model'
                });
            }

            if (models.length > 0) {
                saveModelsToLocalStorage();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to load models:', error);
            return false;
        }
    }    // Update the initApp function for instant UI with background loading
    async function initApp() {
        try {
            console.log('Initializing app...');
            
            // Initialize theme immediately for instant UI
            initTheme();
            
            // Show the UI structure immediately (without waiting for anything)
            elements.statusBar.textContent = 'Initializing...';
            elements.statusBar.className = 'status-bar processing';            // Show the UI structure immediately (without waiting for anything)
            elements.statusBar.textContent = 'Initializing...';
            elements.statusBar.className = 'status-bar processing';
              
            console.log('UI ready immediately - starting background operations');                // Use setTimeout to ensure UI renders before starting background work
                setTimeout(async () => {
                    try {                        // Restore current page from URL parameters or localStorage
                        const urlParams = new URLSearchParams(window.location.search);
                        const pageParam = urlParams.get('page');
                        if (pageParam) {
                            currentPage = parseInt(pageParam, 10) || 1;
                            console.log(`Restored currentPage from URL parameter: ${currentPage}`);
                            // Update localStorage to maintain consistency
                            localStorage.setItem('currentPage', currentPage.toString());
                            // Clear the URL parameter to keep URL clean
                            window.history.replaceState({}, document.title, window.location.pathname);
                        } else {
                            console.log(`No URL page parameter, using current page: ${currentPage}`);
                        }
                        
                        // Load config in background
                        const configResponse = await fetch('/config');
                        config = await configResponse.json();
                        
                        // Show watched folders after config is loaded
                        await showWatchedFolders();
                        
                        // Check if we have cached models to avoid unnecessary reload
                        if (models.length > 0) {
                            console.log(`Using cached models: ${models.length} models already loaded from localStorage`);
                            elements.statusBar.textContent = `Loaded ${models.length} models from cache`;
                            elements.statusBar.className = 'status-bar success';
                            
                            // Restore UI controls to match saved state
                            if (elements.searchInput) {
                                elements.searchInput.value = searchTerm;
                            }
                            if (elements.creatorFilter) {
                                elements.creatorFilter.value = activeFilters.creator || '';
                            }
                            if (elements.baseModelFilter) {
                                elements.baseModelFilter.value = activeFilters.baseModel || '';
                            }
                            if (elements.modelTypeFilter) {
                                elements.modelTypeFilter.value = activeFilters.modelType || '';
                            }
                            if (elements.favoritesFilterBtn) {
                                elements.favoritesFilterBtn.classList.toggle('active', activeFilters.favoritesOnly);
                            }
                            if (elements.sortSelect) {
                                elements.sortSelect.value = currentSort;
                            }
                              // Apply existing filters and display models immediately
                            applySearchAndFilters(false, true); // preserve page when restoring from cache
                            await displayModelGrid();
                            updateSearchStats();
                            populateFilterOptions();
                            baseModelNormalization.reinitialize();
                            
                            console.log(`App ready with cached models - no reprocessing needed. Current page: ${currentPage}`);
                            return; // Skip server loading entirely
                        }
                        
                        // Skip model loading if we successfully restored from fast return cache
                        if (stateRestored && models.length > 0) {
                            console.log('Fast return cache restored with models, skipping reload for performance');
                            elements.statusBar.textContent = `Restored ${models.length} models from cache`;
                            elements.statusBar.className = 'status-bar success';                            // Apply restored filters and update display
                            applySearchAndFilters(false, true); // preserve page when restoring from fast return cache
                            await displayModelGrid();
                            updateSearchStats();
                            
                            console.log(`Fast return cache restored, current page: ${currentPage}`);
                            
                            // Skip background image processing for fast return cache to improve performance
                            requestIdleCallback(() => {
                                console.log('Skipping image reprocessing - restored from fast return cache');
                                populateFilterOptions();
                            });
                            
                            // Initialize base model normalization
                            baseModelNormalization.reinitialize();
                            return; // Skip the model loading entirely
                        }
                        
                        // Only load from server if no cached models are available
                        console.log('No cached models found, loading from server...');
                        elements.statusBar.textContent = 'Loading models from server...';
                        elements.statusBar.className = 'status-bar processing';
                        
                        const modelsLoaded = await loadModels();
                      if (modelsLoaded) {
                        elements.statusBar.textContent = `Loaded ${models.length} models`;
                        elements.statusBar.className = 'status-bar success';                        // Check if we need to clear filters due to home link click
                        if (localStorage.getItem('homeLinkClicked') === 'true') {
                            console.log('Home link was clicked, clearing all filters');
                            await clearAllFilters();
                            localStorage.removeItem('homeLinkClicked');                        } else if (stateRestored) {
                            // If we restored state from fast return cache, apply filters
                            console.log('Applying restored filters and search');
                            applySearchAndFilters(false, true); // preserve page when restoring state
                        }// Update the model grid with loaded models
                        await displayModelGrid();
                        updateSearchStats();
                        
                        // Start background image processing when browser is idle
                        requestIdleCallback(() => {
                            if (models.length > 0) {
                                console.log('Starting background image reprocessing for fresh models');
                                reprocessStoredModelImages();
                            }
                            populateFilterOptions();
                        });
                        
                        // Initialize base model normalization
                        baseModelNormalization.reinitialize();
                    } else {
                        // Models are loading in background or none found
                        if (models.length === 0) {
                            elements.statusBar.textContent = 'Loading models in background...';
                            elements.statusBar.className = 'status-bar processing';
                        } else {
                            elements.statusBar.textContent = 'No models were loaded';
                            elements.statusBar.className = 'status-bar warning';
                        }
                    }
                } catch (error) {
                    console.error('Error in background loading:', error);
                    elements.statusBar.textContent = 'Error loading models';
                    elements.statusBar.className = 'status-bar error';
                }
            }, 0); // Use 0ms timeout to yield to the event loop
            
            console.log('App initialization complete - UI ready immediately');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            elements.statusBar.textContent = 'Failed to initialize app';
            elements.statusBar.className = 'status-bar error';
        }
    }    // Add helper function to check for background loading updates
    async function checkModelUpdates() {
        try {
            const response = await fetch('/get-models');
            if (response.ok) {
                const data = await response.json();
                  if (data.success && !data.loading && Array.isArray(data.models) && data.models.length > 0) {
                    // Check if we're returning from details and already have models loaded
                    // In this case, skip the model reloading to improve performance
                    const returningFromDetails = localStorage.getItem('returningFromDetails') === 'true';
                    if (returningFromDetails && models.length > 0) {
                        console.log('Returning from details with existing models, skipping background reload for performance');
                        return true; // Stop checking but don't reload
                    }
                    
                    // Models finished loading in background
                    // Clear existing models completely before setting new ones
                    models = [];
                    filteredModels = [];
                    selectedModels.clear();
                    
                    models = data.models.map(model => ({
                        ...model,
                        safetensorsPath: model.safetensorsPath || model.filePath
                    }));                    console.log(`Background loading complete: ${models.length} models`);
                    elements.statusBar.textContent = `Loaded ${models.length} models`;
                    elements.statusBar.className = 'status-bar success';
                    
                    // Check if we need to clear filters due to home link click
                    if (localStorage.getItem('homeLinkClicked') === 'true') {
                        console.log('Home link was clicked, clearing all filters');
                        await clearAllFilters();
                        localStorage.removeItem('homeLinkClicked');                    } else if (stateRestored) {
                        // If we restored state from fast return cache, apply filters
                        console.log('Applying restored filters and search to background loaded models');
                        applySearchAndFilters(false, true); // preserve page when restoring state
                    }// Update display
                    await displayModelGrid();
                    updateSearchStats();
                    
                    saveModelsToLocalStorage();
                    
                    // Skip background image processing when returning from details for performance
                    if (models.length > 0 && localStorage.getItem('returningFromDetails') !== 'true') {
                        console.log('Starting background image reprocessing for background loaded models');
                        reprocessStoredModelImages();
                    } else if (localStorage.getItem('returningFromDetails') === 'true') {
                        console.log('Skipping image reprocessing - returning from details');
                    }
                    
                    // Reinitialize base model normalization
                    baseModelNormalization.reinitialize();
                    
                    return true; // Stop checking
                }
            }
        } catch (error) {
            console.error('Error checking model updates:', error);
        }
        
        return false; // Continue checking
    }// Search and filter functions
    function applySearchAndFilters(preserveStatus = false, preservePage = false) {
        let results = models;
        
        // Apply search term
        if (searchTerm.trim()) {
            const search = searchTerm.toLowerCase().trim();
            results = results.filter(model => {
                const modelData = model.modelVersion || model;
                const modelInfo = model.model || {};
                
                // Search in model name
                const modelName = (modelInfo.name || modelData.name || '').toLowerCase();
                if (modelName.includes(search)) return true;
                
                // Search in creator name
                const creatorName = (modelInfo.creator?.username || '').toLowerCase();
                if (creatorName.includes(search)) return true;
                
                // Search in local filename
                const filename = (model.safetensorsPath || model.filePath || '').toLowerCase();
                if (filename.includes(search)) return true;
                
                return false;
            });
        }
        
        // Apply creator filter
        if (activeFilters.creator) {
            results = results.filter(model => {
                const modelInfo = model.model || {};
                const creatorName = modelInfo.creator?.username || '';
                return creatorName === activeFilters.creator;
            });
        }
          // Apply base model filter
        if (activeFilters.baseModel) {
            results = results.filter(model => {
                const baseModel = baseModelNormalization.getBaseModelFromModel(model, models);
                return baseModel === activeFilters.baseModel;
            });
        }
        
        // Apply model type filter
        if (activeFilters.modelType) {
            results = results.filter(model => {
                const modelInfo = model.model || {};
                const modelData = model.modelVersion || model;
                const modelType = modelInfo.type || modelData.model?.type || '';
                return modelType === activeFilters.modelType;
            });
        }
        
        // Apply favorites filter
        if (activeFilters.favoritesOnly) {
            results = results.filter(model => {
                return isFavorite(model);
            });
        }
          filteredModels = results;
        if (!preservePage) {
            currentPage = 1; // Reset to first page when filters change
        }
        updateSearchStats();
        displayModelGrid(preserveStatus);// Pass preserveStatus parameter
    }
      function updateSearchStats() {
        const total = models.length;
        const filtered = filteredModels.length;
        
        if (searchTerm || activeFilters.creator || activeFilters.baseModel || activeFilters.modelType || activeFilters.favoritesOnly) {
            elements.searchStats.textContent = `Showing ${filtered} of ${total} models`;
        } else {
            elements.searchStats.textContent = `${total} models total`;
        }
    }
      function populateFilterOptions() {
        // Initialize normalization with current models
        baseModelNormalization.initializeNormalization(models);
        
        // Get unique creators
        const creators = [...new Set(models.map(model => {
            const modelInfo = model.model || {};
            return modelInfo.creator?.username || 'Unknown';
        }).filter(creator => creator !== 'Unknown'))].sort();
        
        // Get unique base models
        const baseModels = [...new Set(models.map(model => {
            return baseModelNormalization.getBaseModelFromModel(model, models);
        }).filter(baseModel => baseModel))].sort();
        
        // Get unique model types
        const modelTypes = [...new Set(models.map(model => {
            const modelInfo = model.model || {};
            const modelData = model.modelVersion || model;
            return modelInfo.type || modelData.model?.type || '';
        }).filter(type => type))].sort();
        
        // Populate creator filter
        elements.creatorFilter.innerHTML = '<option value="">All Creators</option>';
        creators.forEach(creator => {
            const option = document.createElement('option');
            option.value = creator;
            option.textContent = creator;
            elements.creatorFilter.appendChild(option);
        });
        
        // Populate base model filter
        elements.baseModelFilter.innerHTML = '<option value="">All Base Models</option>';
        baseModels.forEach(baseModel => {
            const option = document.createElement('option');
            option.value = baseModel;
            option.textContent = baseModel;
            elements.baseModelFilter.appendChild(option);
        });
        
        // Populate model type filter
        elements.modelTypeFilter.innerHTML = '<option value="">All Types</option>';
        modelTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            elements.modelTypeFilter.appendChild(option);
        });
    }    async function clearAllFilters() {
        searchTerm = '';
        activeFilters = {
            creator: '',
            baseModel: '',
            modelType: '',
            favoritesOnly: false
        };
        currentSort = 'name'; // Reset sort to default
        
        elements.searchInput.value = '';
        elements.creatorFilter.value = '';
        elements.baseModelFilter.value = '';
        elements.modelTypeFilter.value = '';
        elements.sortSelect.value = 'name';
        elements.favoritesFilterBtn.classList.remove('active');
          filteredModels = models;
        currentPage = 1;
        updateSearchStats();
        await displayModelGrid();
    }

    function getDisplayModels() {
        // Check if any filters are active
        const hasActiveFilters = searchTerm || activeFilters.creator || activeFilters.baseModel || activeFilters.modelType || activeFilters.favoritesOnly;
        
        // Get the base models to work with
        const baseModels = hasActiveFilters ? filteredModels : models;
        
        // Apply sorting
        return sortModels(baseModels, currentSort);
    }

    await initApp();

    // Add these event listeners with your other initialization code
    elements.showFoldersBtn.addEventListener('click', () => {
        const list = document.getElementById('watchedFoldersList');
        const isHidden = list.style.display === 'none';
        list.style.display = isHidden ? 'block' : 'none';
        elements.showFoldersBtn.querySelector('i').className = 
            isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
        if (isHidden) {
            showWatchedFolders();
        }
    });

    // Add search and filter event listeners
    elements.searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        applySearchAndFilters();
    });

    elements.clearSearch.addEventListener('click', () => {
        searchTerm = '';
        elements.searchInput.value = '';
        applySearchAndFilters();
    });

    elements.creatorFilter.addEventListener('change', (e) => {
        activeFilters.creator = e.target.value;
        applySearchAndFilters();
    });

    elements.baseModelFilter.addEventListener('change', (e) => {
        activeFilters.baseModel = e.target.value;
        applySearchAndFilters();
    });

    elements.modelTypeFilter.addEventListener('change', (e) => {
        activeFilters.modelType = e.target.value;
        applySearchAndFilters();
    });
    
    elements.sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        applySearchAndFilters(); // Re-apply filters and sorting
    });

    elements.clearFilters.addEventListener('click', () => {
        clearAllFilters();
    });

    // Populate filter options after models are loaded
    populateFilterOptions();
    
    // Initialize filtered models and apply initial filters
    filteredModels = models;
    applySearchAndFilters();

    // Enhanced controls event listeners
      // View mode controls
    elements.gridViewBtn.addEventListener('click', async () => {
        await switchViewMode('grid');
    });    elements.listViewBtn.addEventListener('click', async () => {
        await switchViewMode('list');
    });    // Favorites filter control
    elements.favoritesFilterBtn.addEventListener('click', () => {
        activeFilters.favoritesOnly = !activeFilters.favoritesOnly;
        elements.favoritesFilterBtn.classList.toggle('active', activeFilters.favoritesOnly);
        applySearchAndFilters(false, true); // preservePage = true
    });// Cache refresh control
    elements.refreshCacheBtn.addEventListener('click', async () => {
        // Prevent multiple concurrent cache refresh operations
        if (elements.refreshCacheBtn.disabled) {
            console.log('Cache refresh already in progress, ignoring click');
            return;
        }
        
        elements.refreshCacheBtn.disabled = true;
        elements.refreshCacheBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
        elements.statusBar.textContent = 'Refreshing cache and reloading models...';
        elements.statusBar.className = 'status-bar processing';
          try {
            // Clear the model grid immediately and thoroughly to prevent visual duplicates
            elements.modelGrid.innerHTML = '';
            
            // Force a reflow to ensure clearing has taken effect
            elements.modelGrid.offsetHeight;
            
            // Clear ALL data completely to ensure fresh start
            models = [];
            filteredModels = [];
            selectedModels.clear();
            updateSelectionUI();
            
            // Clear localStorage to prevent interference
            localStorage.removeItem('civitaiModels');
            // Clear fast return cache to ensure fresh load
            localStorage.removeItem('fastReturnCache');
            
            const response = await fetch('/refresh-cache', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
              if (response.ok) {
                const result = await response.json();
                console.log('Cache refresh result:', result);
                
                // Reload models from the refreshed cache with force refresh
                const modelsLoaded = await loadModels(true); // Force refresh for cache reload
                if (modelsLoaded) {
                    // Reset pagination to first page
                    currentPage = 1;
                    localStorage.setItem('currentPage', currentPage.toString());
                    
                    // Clear selections before reinitializing
                    selectedModels.clear();
                    updateSelectionUI();
                    
                    // Reinitialize filtered models after reload
                    filteredModels = [...models]; // Create a proper copy
                    applySearchAndFilters();
                    
                    await displayModelGrid();
                    populateFilterOptions();
                    updateSearchStats();
                    
                    // Start image reprocessing for refreshed models
                    if (models.length > 0) {
                        console.log('Starting image reprocessing after cache refresh');
                        requestIdleCallback(() => {
                            reprocessStoredModelImages();
                        });
                    }
                    
                    elements.statusBar.textContent = `Cache refreshed - loaded ${models.length} models`;
                    elements.statusBar.className = 'status-bar success';
                } else {
                    elements.statusBar.textContent = 'Cache refreshed but no models loaded';
                    elements.statusBar.className = 'status-bar warning';
                }
            } else {
                throw new Error(`Cache refresh failed: ${response.status}`);
            }
        } catch (error) {
            console.error('Error refreshing cache:', error);
            elements.statusBar.textContent = `Error refreshing cache: ${error.message}`;
            elements.statusBar.className = 'status-bar error';
        } finally {
            elements.refreshCacheBtn.disabled = false;
            elements.refreshCacheBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Cache';
        }
    });

    // Selection controls
    elements.selectAllBtn.addEventListener('click', () => {
        selectAllCurrentPage();
    });

    elements.deselectAllBtn.addEventListener('click', () => {
        clearAllSelections();
    });    elements.deleteSelectedBtn.addEventListener('click', () => {
        console.log('Delete button clicked!');
        console.log('Selected models:', selectedModels);
        console.log('Selected models size:', selectedModels.size);
        deleteSelectedModels();
    });elements.addToFavoritesBtn.addEventListener('click', async () => {
        await addSelectedToFavorites();
    });    elements.exportSelectedBtn.addEventListener('click', async () => {
        await exportSelectedModels();
    });

    // Context menu event listeners
    elements.contextOpenDetails.addEventListener('click', () => {
        if (selectedModelForContextMenu) {
            openModelDetails(selectedModelForContextMenu);
        }
        hideContextMenu();
    });    elements.contextToggleFavorite.addEventListener('click', async () => {
        if (selectedModelForContextMenu) {
            await toggleFavorite(selectedModelForContextMenu);
        }
        hideContextMenu();
    });

    elements.contextCopyPath.addEventListener('click', () => {
        if (selectedModelForContextMenu) {
            copyModelPath(selectedModelForContextMenu);
        }
        hideContextMenu();
    });

    elements.contextRevealExplorer.addEventListener('click', () => {
        if (selectedModelForContextMenu) {
            revealInExplorer(selectedModelForContextMenu);        }
        hideContextMenu();
    });

    elements.contextDelete.addEventListener('click', async () => {
        if (selectedModelForContextMenu) {
            await deleteModel(selectedModelForContextMenu);
        }
        hideContextMenu();
    });    // Hide context menu when clicking outside
    document.addEventListener('click', (e) => {
        if (contextMenuOpen && !elements.contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });    // Pagination event listeners with localStorage persistence
    document.getElementById('prevPage').addEventListener('click', async () => {
        if (currentPage > 1) {
            // Save current scroll position
            const scrollPosition = window.scrollY;
            
            currentPage--;
            localStorage.setItem('currentPage', currentPage.toString());
            await displayModelGrid();
            
            // Restore scroll position after grid is updated
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollPosition);
            });
        }
    });

    document.getElementById('nextPage').addEventListener('click', async () => {
        const totalPages = Math.ceil(getDisplayModels().length / itemsPerPage);
        if (currentPage < totalPages) {
            // Save current scroll position
            const scrollPosition = window.scrollY;
            
            currentPage++;
            localStorage.setItem('currentPage', currentPage.toString());
            await displayModelGrid();
            
            // Restore scroll position after grid is updated
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollPosition);
            });
        }
    });

    document.getElementById('topPrevPage').addEventListener('click', async () => {
        if (currentPage > 1) {
            // Save current scroll position
            const scrollPosition = window.scrollY;
            
            currentPage--;
            localStorage.setItem('currentPage', currentPage.toString());
            await displayModelGrid();
            
            // Restore scroll position after grid is updated
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollPosition);
            });
        }
    });

    document.getElementById('topNextPage').addEventListener('click', async () => {
        const totalPages = Math.ceil(getDisplayModels().length / itemsPerPage);
        if (currentPage < totalPages) {
            // Save current scroll position
            const scrollPosition = window.scrollY;
            
            currentPage++;
            localStorage.setItem('currentPage', currentPage.toString());
            await displayModelGrid();
            
            // Restore scroll position after grid is updated
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollPosition);
            });
        }
    });

    // Search and filter event listeners with localStorage persistence
    elements.searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        localStorage.setItem('searchTerm', searchTerm);
        currentPage = 1; // Reset to first page when search changes
        localStorage.setItem('currentPage', currentPage.toString());
        applySearchAndFilters();
    });

    elements.clearSearch.addEventListener('click', () => {
        searchTerm = '';
        elements.searchInput.value = '';
        localStorage.removeItem('searchTerm');
        currentPage = 1; // Reset to first page when search is cleared
        localStorage.setItem('currentPage', currentPage.toString());
        applySearchAndFilters();
    });

    elements.creatorFilter.addEventListener('change', (e) => {
        activeFilters.creator = e.target.value;
        localStorage.setItem('activeFilters', JSON.stringify(activeFilters));
        currentPage = 1; // Reset to first page when filter changes
        localStorage.setItem('currentPage', currentPage.toString());
        applySearchAndFilters();
    });

    elements.baseModelFilter.addEventListener('change', (e) => {
        activeFilters.baseModel = e.target.value;
        localStorage.setItem('activeFilters', JSON.stringify(activeFilters));
        currentPage = 1; // Reset to first page when filter changes
        localStorage.setItem('currentPage', currentPage.toString());
        applySearchAndFilters();
    });

    elements.modelTypeFilter.addEventListener('change', (e) => {
        activeFilters.modelType = e.target.value;
        localStorage.setItem('activeFilters', JSON.stringify(activeFilters));
        currentPage = 1; // Reset to first page when filter changes
        localStorage.setItem('currentPage', currentPage.toString());
        applySearchAndFilters();
    });

    elements.sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        localStorage.setItem('currentSort', currentSort);
        // Don't reset page when sorting changes - keep current page
        applySearchAndFilters();
    });    elements.favoritesFilterBtn.addEventListener('click', () => {
        activeFilters.favoritesOnly = !activeFilters.favoritesOnly;
        elements.favoritesFilterBtn.classList.toggle('active', activeFilters.favoritesOnly);
        localStorage.setItem('activeFilters', JSON.stringify(activeFilters));
        // Don't reset page when toggling favorites filter - keep current page
        applySearchAndFilters(false, true); // preservePage = true
    });

    elements.clearFilters.addEventListener('click', () => {
        clearAllFilters();
    });

    // View mode controls with localStorage persistence
    elements.gridViewBtn.addEventListener('click', async () => {
        await switchViewMode('grid');
    });

    elements.listViewBtn.addEventListener('click', async () => {
        await switchViewMode('list');
    });

    // Initialize filter options after models are loaded
    if (models.length > 0) {
        populateFilterOptions();
        filteredModels = models;
        applySearchAndFilters();
    }

    // Set initial view mode button states
    elements.gridViewBtn.classList.toggle('active', viewMode === 'grid');
    elements.listViewBtn.classList.toggle('active', viewMode === 'list');
});

// Helper function to refresh cache and localStorage after adding new models
async function refreshAfterAddingModels() {
    try {
        console.log('Refreshing cache and localStorage after adding new models...');
        
        // Clear localStorage cache to force fresh load
        localStorage.removeItem('civitaiModels');
        localStorage.removeItem('fastReturnCache');
        
        // Save current models to localStorage
        saveModelsToLocalStorage();
        
        // Trigger cache refresh on server
        const response = await fetch('/refresh-cache', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('Cache refresh after adding models successful:', result);
            
            // Update models from refreshed cache
            if (result.models && Array.isArray(result.models)) {
                models = result.models.map(model => ({
                    ...model,
                    safetensorsPath: model.safetensorsPath || model.filePath
                }));
                
                // Save refreshed models to localStorage
                saveModelsToLocalStorage();
                
                // Update display
                filteredModels = [...models];
                applySearchAndFilters();
                await displayModelGrid();
                populateFilterOptions();
                updateSearchStats();
                
                console.log(`Models refreshed after adding: ${models.length} total models`);
            }
        } else {
            console.warn('Cache refresh failed but models were added locally');
        }
    } catch (error) {
        console.error('Error refreshing cache after adding models:', error);
        // Even if refresh fails, ensure local changes are saved
        saveModelsToLocalStorage();
    }
}