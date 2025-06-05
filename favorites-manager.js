/**
 * Hybrid Favorites Storage Manager
 * Combines JSON file persistence with localStorage performance
 */

class FavoritesManager {
    constructor() {
        this.favorites = new Set();
        this.isInitialized = false;
        this.saveTimeout = null;
        this.saveDelay = 500; // Debounce saves by 500ms
        this.hasElectronAPI = typeof window !== 'undefined' && window.electronAPI;
        
        // Start initialization immediately but don't block
        this.initializeAsync();
    }

    /**
     * Start async initialization without blocking
     */
    async initializeAsync() {
        try {
            await this.initialize();
        } catch (error) {
            console.error('Failed to initialize favorites manager:', error);
            // Continue with empty state rather than blocking
            this.favorites = new Set();
            this.isInitialized = true;
        }
    }

    /**
     * Initialize the favorites manager
     * Loads from file storage and migrates localStorage data if needed
     */
    async initialize() {
        try {
            let fileData = [];
            let localData = [];

            // Load from file storage if electron API is available
            if (this.hasElectronAPI) {
                try {
                    fileData = await window.electronAPI.favoritesLoad() || [];
                } catch (error) {
                    console.warn('Could not load favorites from file:', error);
                }
            }

            // Load from localStorage as fallback/migration source
            try {
                const localStorageData = localStorage.getItem('favoriteModels');
                if (localStorageData) {
                    localData = JSON.parse(localStorageData);
                }
            } catch (error) {
                console.warn('Could not parse localStorage favorites:', error);
            }

            // Merge data sources (file takes precedence, but migrate localStorage if file is empty)
            let finalData = fileData;
            if (fileData.length === 0 && localData.length > 0) {
                console.log('Migrating favorites from localStorage to file storage');
                finalData = localData;
                // Save the migrated data to file
                if (this.hasElectronAPI) {
                    await this.saveToFile(finalData);
                }
            }

            // Populate the Set with favorites
            this.favorites = new Set(finalData);

            // Update localStorage to match file data
            localStorage.setItem('favoriteModels', JSON.stringify(finalData));

            this.isInitialized = true;
            console.log(`Favorites initialized: ${this.favorites.size} favorites loaded`);
            
            // Dispatch event for UI to update
            window.dispatchEvent(new CustomEvent('favoritesInitialized', {
                detail: { count: this.favorites.size }
            }));

        } catch (error) {
            console.error('Error initializing favorites:', error);
            // Fallback to localStorage only
            this.initializeFromLocalStorage();
        }
    }

    /**
     * Fallback initialization from localStorage only
     */
    initializeFromLocalStorage() {
        try {
            const localData = JSON.parse(localStorage.getItem('favoriteModels') || '[]');
            this.favorites = new Set(localData);
            this.isInitialized = true;
            console.log('Favorites initialized from localStorage fallback');
        } catch (error) {
            console.error('Error in localStorage fallback:', error);
            this.favorites = new Set();
            this.isInitialized = true;
        }
    }    /**
     * Wait for initialization to complete with timeout
     */
    async waitForInitialization(timeoutMs = 2000) {
        if (this.isInitialized) return;
        
        return new Promise((resolve) => {
            let timeoutId;
            
            const checkInit = () => {
                if (this.isInitialized) {
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve();
                } else {
                    setTimeout(checkInit, 10);
                }
            };
            
            // Set timeout to prevent indefinite waiting
            timeoutId = setTimeout(() => {
                console.warn('Favorites initialization timed out, continuing with empty state');
                this.favorites = new Set();
                this.isInitialized = true;
                resolve();
            }, timeoutMs);
            
            checkInit();
        });
    }

    /**
     * Check if a model is favorited
     */
    isFavorite(modelKey) {
        return this.favorites.has(modelKey);
    }

    /**
     * Add a model to favorites
     */
    async addFavorite(modelKey) {
        if (!modelKey) return false;
        
        await this.waitForInitialization();
        
        if (this.favorites.has(modelKey)) {
            return false; // Already favorited
        }

        this.favorites.add(modelKey);
        this.updateLocalStorage();
        this.debouncedSave();
        
        // Dispatch event for UI updates
        window.dispatchEvent(new CustomEvent('favoriteAdded', {
            detail: { modelKey }
        }));

        return true;
    }

    /**
     * Remove a model from favorites
     */
    async removeFavorite(modelKey) {
        if (!modelKey) return false;
        
        await this.waitForInitialization();
        
        if (!this.favorites.has(modelKey)) {
            return false; // Not favorited
        }

        this.favorites.delete(modelKey);
        this.updateLocalStorage();
        this.debouncedSave();
        
        // Dispatch event for UI updates
        window.dispatchEvent(new CustomEvent('favoriteRemoved', {
            detail: { modelKey }
        }));

        return true;
    }

    /**
     * Toggle favorite status of a model
     */
    async toggleFavorite(modelKey) {
        if (!modelKey) return false;
        
        await this.waitForInitialization();
        
        if (this.favorites.has(modelKey)) {
            return await this.removeFavorite(modelKey);
        } else {
            return await this.addFavorite(modelKey);
        }
    }

    /**
     * Get all favorites as an array
     */
    getFavorites() {
        return Array.from(this.favorites);
    }

    /**
     * Get favorites count
     */
    getCount() {
        return this.favorites.size;
    }

    /**
     * Clear all favorites
     */
    async clearAll() {
        await this.waitForInitialization();
        
        this.favorites.clear();
        this.updateLocalStorage();
        this.debouncedSave();
        
        // Dispatch event for UI updates
        window.dispatchEvent(new CustomEvent('favoritesCleared'));
    }

    /**
     * Add multiple favorites at once
     */
    async addBulk(modelKeys) {
        if (!Array.isArray(modelKeys) || modelKeys.length === 0) return 0;
        
        await this.waitForInitialization();
        
        let addedCount = 0;
        modelKeys.forEach(modelKey => {
            if (modelKey && !this.favorites.has(modelKey)) {
                this.favorites.add(modelKey);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            this.updateLocalStorage();
            this.debouncedSave();
            
            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('favoritesBulkAdded', {
                detail: { count: addedCount, modelKeys }
            }));
        }

        return addedCount;
    }

    /**
     * Remove multiple favorites at once
     */
    async removeBulk(modelKeys) {
        if (!Array.isArray(modelKeys) || modelKeys.length === 0) return 0;
        
        await this.waitForInitialization();
        
        let removedCount = 0;
        modelKeys.forEach(modelKey => {
            if (modelKey && this.favorites.has(modelKey)) {
                this.favorites.delete(modelKey);
                removedCount++;
            }
        });

        if (removedCount > 0) {
            this.updateLocalStorage();
            this.debouncedSave();
            
            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('favoritesBulkRemoved', {
                detail: { count: removedCount, modelKeys }
            }));
        }

        return removedCount;
    }

    /**
     * Export favorites for backup
     */
    async exportFavorites() {
        await this.waitForInitialization();
        
        const exportData = {
            version: '1.0',
            exported: new Date().toISOString(),
            favorites: this.getFavorites(),
            count: this.getCount()
        };

        return exportData;
    }

    /**
     * Import favorites from backup
     */
    async importFavorites(importData, merge = false) {
        if (!importData || !Array.isArray(importData.favorites)) {
            throw new Error('Invalid import data format');
        }

        await this.waitForInitialization();
        
        if (!merge) {
            this.favorites.clear();
        }

        let importedCount = 0;
        importData.favorites.forEach(modelKey => {
            if (modelKey && !this.favorites.has(modelKey)) {
                this.favorites.add(modelKey);
                importedCount++;
            }
        });

        this.updateLocalStorage();
        this.debouncedSave();
        
        // Dispatch event for UI updates
        window.dispatchEvent(new CustomEvent('favoritesImported', {
            detail: { count: importedCount, total: this.getCount() }
        }));

        return importedCount;
    }

    /**
     * Get favorites file path (if available)
     */
    async getFavoritesPath() {
        if (!this.hasElectronAPI) return null;
        
        try {
            return await window.electronAPI.favoritesGetPath();
        } catch (error) {
            console.warn('Could not get favorites path:', error);
            return null;
        }
    }

    /**
     * Update localStorage with current favorites
     */
    updateLocalStorage() {
        try {
            localStorage.setItem('favoriteModels', JSON.stringify(this.getFavorites()));
        } catch (error) {
            console.warn('Could not update localStorage:', error);
        }
    }

    /**
     * Debounced save to file storage
     */
    debouncedSave() {
        if (!this.hasElectronAPI) return;
        
        // Clear existing timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        // Set new timeout
        this.saveTimeout = setTimeout(() => {
            this.saveToFile(this.getFavorites());
        }, this.saveDelay);
    }

    /**
     * Save favorites to file storage
     */
    async saveToFile(favoritesArray) {
        if (!this.hasElectronAPI) return;
        
        try {
            await window.electronAPI.favoritesSave(favoritesArray);
            console.log('Favorites saved to file');
        } catch (error) {
            console.warn('Could not save favorites to file:', error);
        }
    }

    /**
     * Get statistics about favorites
     */
    getStatistics() {
        return {
            total: this.getCount(),
            hasElectronAPI: this.hasElectronAPI,
            isInitialized: this.isInitialized,
            storageType: this.hasElectronAPI ? 'hybrid' : 'localStorage-only'
        };
    }
}

// Create global instance
const favoritesManager = new FavoritesManager();

// Export for module systems if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FavoritesManager;
}