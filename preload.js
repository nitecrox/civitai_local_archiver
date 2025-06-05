// Apply theme immediately when DOM is available
function applyThemeImmediately() {
    try {
        // Ensure we have basic DOM elements
        if (typeof document === 'undefined' || !document.documentElement) {
            // If DOM isn't ready, retry with requestAnimationFrame
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(applyThemeImmediately);
            } else {
                setTimeout(applyThemeImmediately, 1);
            }
            return;
        }
        
        // Safely get theme from localStorage
        let isDarkMode = false;
        try {
            isDarkMode = localStorage.getItem('darkMode') === 'true';
        } catch (e) {
            // localStorage might not be available yet
            isDarkMode = false;
        }
        
        // Apply theme to document root immediately
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
        
        // Inject critical CSS to prevent flash
        const style = document.createElement('style');
        style.id = 'preload-theme-style';
        style.textContent = `
            html, body {
                background-color: ${isDarkMode ? '#121212' : '#f9f9f9'} !important;
                color: ${isDarkMode ? '#e0e0e0' : '#333333'} !important;
                transition: none !important;
            }
            * {
                transition: none !important;
            }
        `;
        
        // Ensure head exists and hasn't already been injected
        if (document.head && !document.getElementById('preload-theme-style')) {
            document.head.appendChild(style);
            
            // Remove the no-transition style after minimal delay
            setTimeout(() => {
                if (style.parentNode) {
                    style.remove();
                }
            }, 50); // Reduced from 100ms to 50ms
        }
    } catch (error) {
        // Silently handle errors in preload
        console.debug('Preload theme error:', error);
    }
}

// Start applying theme immediately
applyThemeImmediately();

// Electron API for secure IPC communication
const { ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
window.electronAPI = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, func) => {
        const validChannels = ['favorites-updated', 'app-closing'];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
    
    // Favorites-specific methods for secure access
    favoritesLoad: () => ipcRenderer.invoke('favorites-load'),
    favoritesSave: (favorites) => ipcRenderer.invoke('favorites-save', favorites),
    favoritesGetPath: () => ipcRenderer.invoke('favorites-get-path')
};

// Polyfill for requestIdleCallback for better performance
if (!window.requestIdleCallback) {
    window.requestIdleCallback = function(callback, options = {}) {
        const timeout = options.timeout || 5000;
        const startTime = performance.now();
        
        return setTimeout(() => {
            callback({
                didTimeout: performance.now() - startTime >= timeout,
                timeRemaining() {
                    return Math.max(0, 50 - (performance.now() - startTime));
                }
            });
        }, 1);
    };
    
    window.cancelIdleCallback = function(id) {
        clearTimeout(id);
    };
}

// Suppress common console errors for cleaner output
const originalConsoleError = console.error;
console.error = function(...args) {
    const message = args.join(' ');
      // Comprehensive filtering of Electron development noise
    const suppressedErrors = [
        'Electron sandboxed_renderer.bundle.js',
        'Autofill.enable',
        'Autofill.setAddresses',
        'devtools://devtools',
        'protocol_client.js',
        'HTTP/1.1 4',
        'disk_cache',
        'gpu_disk_cache',
        'http_cache',
        'Unable to move the cache',
        'Gpu Cache Creation failed',
        'Failed to create GPU cache',
        'Cache directory',
        'Cache creation failed',
        'sandbox',
        'WebGL',
        'GPU process',
        'deprecated',
        'console-message',
        'extension',
        'plugin'
    ];
    
    if (!suppressedErrors.some(error => message.includes(error))) {
        originalConsoleError.apply(console, args);
    }
};

window.addEventListener('DOMContentLoaded', () => {
    console.log('Preload script: DOMContentLoaded fired');
});