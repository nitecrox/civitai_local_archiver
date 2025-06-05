const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const express = require('express');
const server = require('./server');

// COMPREHENSIVE CACHE AND ERROR ELIMINATION
// Core cache disabling
app.commandLine.appendSwitch('--disable-gpu-disk-cache');
app.commandLine.appendSwitch('--disable-disk-cache');
app.commandLine.appendSwitch('--disable-http-cache');
app.commandLine.appendSwitch('--disable-application-cache');
app.commandLine.appendSwitch('--disable-offline-web-application-cache');
app.commandLine.appendSwitch('--disable-background-networking');

// Force zero cache sizes
app.commandLine.appendSwitch('--disk-cache-size', '0');
app.commandLine.appendSwitch('--media-cache-size', '0');
app.commandLine.appendSwitch('--max_old_space_size', '512');

// Disable problematic subsystems
app.commandLine.appendSwitch('--disable-extensions');
app.commandLine.appendSwitch('--disable-plugins');
app.commandLine.appendSwitch('--disable-sync');
app.commandLine.appendSwitch('--disable-default-apps');
app.commandLine.appendSwitch('--disable-background-mode');
app.commandLine.appendSwitch('--disable-databases');
app.commandLine.appendSwitch('--disable-local-storage');
app.commandLine.appendSwitch('--disable-session-storage');

// GPU and renderer stability
app.commandLine.appendSwitch('--no-sandbox');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--disable-software-rasterizer');
app.commandLine.appendSwitch('--disable-gpu-memory-buffer-compositor-resources');
app.commandLine.appendSwitch('--disable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('--disable-gpu-process-crash-limit');

// Background process optimization
app.commandLine.appendSwitch('--disable-background-timer-throttling');
app.commandLine.appendSwitch('--disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('--disable-renderer-backgrounding');

// Advanced renderer fixes
app.commandLine.appendSwitch('--disable-renderer-code-integrity');
app.commandLine.appendSwitch('--disable-site-isolation-trials');
app.commandLine.appendSwitch('--disable-web-security');
app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor,UseSkiaRenderer,AudioServiceOutOfProcess');
app.commandLine.appendSwitch('--enable-features', 'ElectronSerialChooser');

// Network and security optimizations
app.commandLine.appendSwitch('--disable-domain-reliability');
app.commandLine.appendSwitch('--disable-component-extensions-with-background-pages');
app.commandLine.appendSwitch('--disable-ipc-flooding-protection');

// Additional stability switches
app.commandLine.appendSwitch('--disable-dev-shm-usage');
app.commandLine.appendSwitch('--disable-background-media-suspend');
app.commandLine.appendSwitch('--no-first-run');
app.commandLine.appendSwitch('--no-default-browser-check');

// Force disable all caching mechanisms
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
process.env.ELECTRON_ENABLE_LOGGING = 'false';

// Favorites storage management
class FavoritesStorage {
    constructor() {
        this.dataPath = path.join(app.getPath('userData'), 'favorites.json');
        this.backupPath = path.join(app.getPath('userData'), 'favorites.backup.json');
    }

    async loadFavorites() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist yet, return empty array
                return [];
            }
            
            // Try backup if main file is corrupted
            try {
                console.log('Main favorites file corrupted, trying backup...');
                const backup = await fs.readFile(this.backupPath, 'utf8');
                return JSON.parse(backup);
            } catch (backupError) {
                console.log('No valid favorites file found, starting fresh');
                return [];
            }
        }
    }

    async saveFavorites(favorites) {
        try {
            // Create backup of current file before saving new one
            try {
                await fs.copyFile(this.dataPath, this.backupPath);
            } catch (error) {
                // Ignore if original doesn't exist
            }
            
            // Save new favorites with metadata
            const favoritesData = {
                lastUpdated: new Date().toISOString(),
                count: favorites.length,
                favorites: favorites
            };
            
            await fs.writeFile(this.dataPath, JSON.stringify(favoritesData, null, 2));
            return true;
        } catch (error) {
            console.error('Failed to save favorites:', error);
            return false;
        }
    }

    async getFavoritesPath() {
        return this.dataPath;
    }
}

// Initialize favorites storage
const favoritesStorage = new FavoritesStorage();

let mainWindow;

function createWindow() {
    // Create the browser window with ultra-optimized settings for instant startup
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false, // Don't show until ready to prevent flickering
        backgroundColor: '#1e1e1e', // Default to dark, will be overridden by preload
        icon: path.join(__dirname, 'assets/icon.png'), // Optional app icon
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false, // Disable web security for local development
            allowRunningInsecureContent: true,            
            backgroundThrottling: false, // Prevent background throttling for better performance
            partition: null, // Use default partition to avoid cache creation
            enableRemoteModule: false,
            // Ultra-optimized cache and performance settings
            cache: false,
            enableWebSQL: false,
            experimentalFeatures: false,
            disableDialogs: true,
            offscreen: false,
            // Additional renderer stability and performance fixes
            additionalArguments: [
                '--disable-renderer-backgrounding', 
                '--disable-background-timer-throttling',
                '--disable-ipc-flooding-protection',
                '--disable-dev-shm-usage',
                '--disable-background-media-suspend'
            ],
            // Memory optimization
            v8CacheOptions: 'none',
            spellcheck: false,
            autoplayPolicy: 'no-user-gesture-required'
        },
        paintWhenInitiallyHidden: false,
        titleBarStyle: 'default',
        frame: true,
        resizable: true,
        minimizable: true,
        maximizable: true,
        closable: true
    });    // Enhanced error handling for renderer process stability
    mainWindow.webContents.on('crashed', (event, killed) => {
        console.error('Renderer process crashed:', { killed });
        // Attempt to reload after a short delay
        setTimeout(() => {
            if (!mainWindow.isDestroyed()) {
                try {
                    mainWindow.reload();
                } catch (error) {
                    console.error('Failed to reload after crash:', error);
                }
            }
        }, 1000);
    });

    // Handle render process gone with detailed logging
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('Render process gone:', details);
        if (details.reason === 'crashed' || details.reason === 'killed') {
            setTimeout(() => {
                if (!mainWindow.isDestroyed()) {
                    try {
                        mainWindow.reload();
                    } catch (error) {
                        console.error('Failed to reload after process gone:', error);
                    }
                }
            }, 1500);
        }
    });

    // Handle renderer unresponsive
    mainWindow.webContents.on('unresponsive', () => {
        console.warn('Renderer became unresponsive');
    });

    mainWindow.webContents.on('responsive', () => {
        console.log('Renderer became responsive again');
    });

    // Optimize page load sequence
    mainWindow.webContents.once('dom-ready', () => {
        console.log('DOM ready, showing window');
        mainWindow.show();
        
        // Focus the window after showing
        setTimeout(() => {
            if (!mainWindow.isDestroyed()) {
                mainWindow.focus();
            }
        }, 100);
    });

    // Handle navigation errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', { errorCode, errorDescription, validatedURL });
    });      // Direct server startup and immediate loading of main application
    const port = 3000;
    
    // Show window immediately
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });
    
    // Start server and load main app directly
    server.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
        console.log('Loading main application...');
        
        // Load main application directly without any loading screen
        mainWindow.loadURL(`http://localhost:${port}`).catch(error => {
            console.error('Failed to load main app:', error);
            // Fallback: retry once more after brief delay
            setTimeout(() => {
                if (!mainWindow.isDestroyed()) {
                    mainWindow.loadURL(`http://localhost:${port}`);
                }
            }, 1000);
        });
    });
    
    // Optional DevTools for development (only open manually with Ctrl+Shift+I)
    // Remove automatic DevTools opening to improve startup performance    // Suppress common DevTools errors with updated API
    mainWindow.webContents.on('console-message', (event) => {
        const { level, message, line, sourceId } = event;        // Essential cache-related error suppression only
        const suppressedMessages = [
            'disk_cache',
            'gpu_disk_cache',
            'http_cache',
            'Unable to move the cache',
            'Gpu Cache Creation failed',
            'Failed to create GPU cache',
            'Cache directory',
            'Cache creation failed',
            'Failed to read DawnCache'
        ];
        
        if (suppressedMessages.some(msg => message.includes(msg))) {
            return; // Don't log these messages
        }
        
        // Log other console messages normally
        console.log(`[Renderer] ${message}`);    });// Add keyboard shortcut to toggle DevTools
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {  // Ctrl+Shift+I
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    // Open DevTools on startup for development
    mainWindow.webContents.openDevTools();

    // Disable DevTools context menu to reduce errors
    mainWindow.webContents.on('context-menu', (event, params) => {
        // Prevent right-click inspect element in production
        if (process.env.NODE_ENV !== 'development') {
            event.preventDefault();
        }
    });    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Handle file selection
ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Safetensors', extensions: ['safetensors'] }
        ]
    });
    
    if (!result.canceled) {
        return result.filePaths;
    }
    return [];
});

// Add this with your other IPC handlers
ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Safetensors', extensions: ['safetensors'] }
        ]
    });
    return result;
});

// Add folder selection dialog handler
ipcMain.handle('open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Folder to Watch'
    });
    return result;
});

// Favorites IPC handlers
ipcMain.handle('favorites-load', async () => {
    try {
        const data = await favoritesStorage.loadFavorites();
        // Handle both old format (array) and new format (object with metadata)
        if (Array.isArray(data)) {
            return data; // Old format - just return the array
        } else if (data && Array.isArray(data.favorites)) {
            return data.favorites; // New format - return the favorites array
        } else {
            return []; // Invalid data
        }
    } catch (error) {
        console.error('Error loading favorites:', error);
        return [];
    }
});

ipcMain.handle('favorites-save', async (event, favorites) => {
    return await favoritesStorage.saveFavorites(favorites);
});

ipcMain.handle('favorites-get-path', async () => {
    return await favoritesStorage.getFavoritesPath();
});