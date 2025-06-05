const { ipcRenderer } = require('electron');
const path = require('path');
const { shell } = require('electron');

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
    
    // Set background colors immediately
    if (isDarkMode) {
        document.documentElement.style.backgroundColor = '#121212';
        document.body.style.backgroundColor = '#121212';
    } else {
        document.documentElement.style.backgroundColor = '#f9f9f9';
        document.body.style.backgroundColor = '#f9f9f9';
    }
    
    return isDarkMode;
}

// Call immediately, before any other code
initTheme();

// Base model normalization functionality (shared with main script)
const baseModelNormalization = (() => {
    function getNormalizedBaseModel(baseModel) {
        if (!baseModel) return '';
        
        // This is a simplified version for the details page
        // In a full implementation, we would share the normalization data
        // For now, we'll just handle the most common case
        const lowerCase = baseModel.toLowerCase();
        
        // Common normalizations based on frequency
        const commonNormalizations = {
            'illustrious': 'Illustrious',
            'sdxl 1.0': 'SDXL 1.0',
            'sd 1.5': 'SD 1.5',
            'pony': 'Pony'
        };
        
        return commonNormalizations[lowerCase] || baseModel;
    }    function getBaseModelFromModel(model) {
        const modelData = model.modelVersion || model;
        const baseModel = modelData.baseModel || modelData.trainingDetails?.baseModel || '';
        return getNormalizedBaseModel(baseModel);
    }

    return {
        getNormalizedBaseModel,
        getBaseModelFromModel
    };
})();

document.addEventListener('DOMContentLoaded', async function() {
    const elements = {
        themeToggle: document.getElementById('themeToggle'),
        backBtn: document.getElementById('backBtn'),
        largeImage: document.getElementById('largeImage'),
        modal: document.getElementById('imageModal'),
        modalImage: document.getElementById('modalImage'),
        closeModal: document.querySelector('.close'),
        prevImageBtn: document.getElementById('prevImage'),
        nextImageBtn: document.getElementById('nextImage'),
        statusBar: document.getElementById('statusBar'),
        safetensorsPath: document.getElementById('safetensorsPath')
    };    // Add at the top of the DOMContentLoaded function
    const imageCache = new Map();

    // Hash info cache for model resources
    let hashInfoCache = new Map();

    // Load hash cache from server
    async function loadHashInfoCache() {
        try {
            const response = await fetch('/get-hash-info-cache');
            if (response.ok) {
                const cacheData = await response.json();
                hashInfoCache = new Map(Object.entries(cacheData));
                console.log(`Loaded ${hashInfoCache.size} hash cache entries`);
            }
        } catch (error) {
            console.error('Failed to load hash info cache:', error);
        }
    }

    // Save hash cache to server
    async function saveHashInfoCache() {
        try {
            const cacheObject = Object.fromEntries(hashInfoCache);
            const response = await fetch('/save-hash-info-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cacheObject)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to save hash info cache:', error);
        }
    }

    // Fetch model info from CivitAI API through server
    async function fetchModelInfoByHash(hash) {
        try {
            // Check cache first
            if (hashInfoCache.has(hash)) {
                return hashInfoCache.get(hash);
            }

            console.log(`Fetching model info for hash: ${hash}`);
            const response = await fetch('/fetch-resource-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resources: [{ hash }] })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.resources.length > 0) {
                    const resourceInfo = data.resources[0];                    const modelInfo = {
                        name: resourceInfo.name,
                        type: resourceInfo.type,
                        versionName: resourceInfo.versionName,
                        modelId: resourceInfo.modelId
                    };
                    
                    // Cache the result
                    hashInfoCache.set(hash, modelInfo);
                    return modelInfo;
                }
            }
            
            throw new Error(`Failed to fetch from API`);
        } catch (error) {
            console.error(`Failed to fetch model info for hash ${hash}:`, error.message);
              // Return fallback info and cache it to avoid repeated failures
            const fallbackInfo = {
                name: 'Unknown Model',
                type: 'Unknown Type',
                versionName: 'Unknown Version',
                modelId: null
            };
            
            hashInfoCache.set(hash, fallbackInfo);
            return fallbackInfo;
        }
    }    // Function to open URL in default browser
    function openInBrowser(url) {
        fetch('/open-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        }).catch(error => {
            console.error('Failed to open URL:', error);
        });
    }

    // Initialize hash cache on page load
    await loadHashInfoCache();

    // Verify all elements exist
    for (const [name, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`Missing DOM element: ${name}`);
            return;
        }
    }

    // State variables
    let currentModel = null;
    let currentImageIndex = 0;    // Get model data from localStorage
    const modelData = JSON.parse(localStorage.getItem('currentModelDetails'));
    if (!modelData) {
        console.error('No model data found');
        window.location.href = 'index.html';
        return;
    }
    
    // Set current model for image navigation
    currentModel = modelData;
    console.log('Current model set:', currentModel);
    
    // Display model details
    await showModelDetails(modelData);
      // Initialize theme UI elements
    function updateThemeUI() {
        const isDarkMode = localStorage.getItem('darkMode') === 'true';
        elements.themeToggle.innerHTML = isDarkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    }
    
    // Initialize theme toggle button
    updateThemeUI();

    function formatFileSize(kb) {
        if (!kb) return 'Unknown size';
        return kb < 1024 ? `${kb.toFixed(2)} KB` : `${(kb / 1024).toFixed(2)} MB`;
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
    }

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

            // If it's already a local path, return it directly
            if (imageUrl.startsWith('/images/')) {
                return imageUrl;
            }

            // Check cache first
            if (imageCache.has(imageUrl)) {
                return imageCache.get(imageUrl);
            }

            const filename = await generateFilename(imageUrl);
            const localPath = `/images/${filename}`;

            // Check if file exists locally first without logging
            const checkResponse = await fetch(`/check-image?path=${encodeURIComponent(localPath)}`);
            if (checkResponse.ok) {
                imageCache.set(imageUrl, localPath);
                return localPath;
            }

            // If not found locally and it's a remote URL, download silently
            if (imageUrl.startsWith('https://')) {
                const response = await fetch(`/get-image?url=${encodeURIComponent(imageUrl)}`);
                if (response.ok) {
                    imageCache.set(imageUrl, localPath);
                    return localPath;
                }
            }

            return null;
        } catch (error) {
            console.error('Image processing error:', error);
            return null;
        }
    }

    async function generateFilename(url) {
        const encoder = new TextEncoder();
        const data = encoder.encode(url);
        return crypto.subtle.digest('SHA-256', data)
            .then(hash => {
                const hashArray = Array.from(new Uint8Array(hash));
                const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                return `${hashHex}.webp`;
            });
    }

    async function showModelDetails(model) {
        currentModel = model;
        console.log('Received model data:', model);

        // Get the file path - check all possible locations
        const filePath = model.safetensorsPath || model.filePath || 
                        model.modelVersion?.safetensorsPath || 
                        model.modelVersion?.filePath;
        
        console.log('File path found:', filePath);

        const modelData = model.modelVersion || model;
        const modelInfo = model.model || {};        document.getElementById('modelName').textContent = modelInfo.name || modelData.name;
        document.getElementById('downloadCount').textContent = modelData.stats?.downloadCount || 0;
        document.getElementById('thumbsUpCount').textContent = modelData.stats?.thumbsUpCount || 0;
        document.getElementById('creatorName').textContent = modelInfo.creator?.username || 'Unknown';
        
        // Set base model information
        const baseModel = baseModelNormalization.getBaseModelFromModel(modelData);
        document.getElementById('baseModelName').textContent = baseModel;

        // Add Civitai link
        const modelId = modelData.modelId || modelInfo.id;
        if (modelId) {
            const civitaiLink = document.createElement('a');
            civitaiLink.href = '#';
            civitaiLink.className = 'civitai-link';
            civitaiLink.innerHTML = '<i class="fas fa-external-link-alt"></i> View on Civitai';
            civitaiLink.addEventListener('click', (e) => {
                e.preventDefault();
                shell.openExternal(`https://civitai.com/models/${modelId}`);
            });
            document.getElementById('civitaiLinkContainer').appendChild(civitaiLink);
        }

        document.getElementById('modelDescription').innerHTML = modelInfo.description || '<p>No description provided.</p>';
        document.getElementById('versionName').textContent = modelData.name;

        // Update trained words
        const trainedWordsEl = document.getElementById('trainedWords');
        trainedWordsEl.innerHTML = '';
        if (modelData.trainedWords?.length) {
            modelData.trainedWords.forEach(word => {
                if (word.trim()) {
                    const span = document.createElement('span');
                    span.textContent = word.trim();
                    trainedWordsEl.appendChild(span);
                }
            });
        } else {
            trainedWordsEl.innerHTML = '<p>No trained words provided.</p>';
        }

        // Update files list
        const filesListEl = document.getElementById('filesList');
        filesListEl.innerHTML = '';
        if (modelData.files?.length) {
            modelData.files.forEach(file => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <div class="file-info">
                        <strong>${file.name}</strong>
                        <div class="file-type">${file.type || 'Model'}</div>
                    </div>
                    <div class="file-size">${formatFileSize(file.sizeKB)}</div>
                `;
                filesListEl.appendChild(li);
            });
        } else {
            filesListEl.innerHTML = '<li>No files available</li>';
        }        // Update training details
        const trainingDetailsEl = document.getElementById('trainingDetails');
        if (modelData.trainingDetails) {
            const normalizedTrainingBaseModel = baseModelNormalization.getNormalizedBaseModel(modelData.trainingDetails.baseModel);
            trainingDetailsEl.innerHTML = `
                <p><strong>Base Model:</strong> ${normalizedTrainingBaseModel || 'N/A'}</p>
                <p><strong>Type:</strong> ${modelData.trainingDetails.type || 'N/A'}</p>
                ${modelData.trainingDetails.params ? `
                    <div class="training-params">
                        <h4>Parameters</h4>
                        <pre>${JSON.stringify(modelData.trainingDetails.params, null, 2)}</pre>
                    </div>
                ` : ''}
            `;
        } else {
            trainingDetailsEl.innerHTML = '<p>No training details available.</p>';
        }

        // Update gallery
        const galleryContainer = document.getElementById('galleryContainer');
        galleryContainer.innerHTML = '';        if (modelData.images?.length) {
            elements.statusBar.textContent = 'Loading example images...';
            let processedCount = 0;            for (const image of modelData.images) {
                try {
                    const originalUrl = image.originalUrl || image.url;
                    if (!originalUrl) continue;
                    
                    // Skip video content
                    if (isVideoContent(image)) {
                        console.log('Skipping video content in gallery:', originalUrl);
                        continue;
                    }

                    const galleryItem = document.createElement('div');
                    galleryItem.className = 'gallery-item loading';
                    galleryContainer.appendChild(galleryItem);

                    const imageUrl = await processImage(originalUrl, image);
                    if (imageUrl) {
                        image.url = imageUrl;
                        image.originalUrl = image.originalUrl || originalUrl;

                        galleryItem.classList.remove('loading');
                        galleryItem.innerHTML = `
                            <img src="${imageUrl}" 
                                 alt="Example ${processedCount + 1}"
                                 loading="lazy"
                                 style="width: 100%; height: 100%; object-fit: cover;">
                        `;                        galleryItem.addEventListener('click', () => {
                            // Find the correct index in the images array
                            const imageIndex = modelData.images.findIndex(img => {
                                const imgUrl = img.url || img.originalUrl;
                                const targetUrl = image.url || image.originalUrl;
                                const imgOriginalUrl = img.originalUrl;
                                const targetOriginalUrl = image.originalUrl;
                                
                                // Match on either URL or originalUrl
                                return imgUrl === targetUrl || 
                                       imgUrl === targetOriginalUrl || 
                                       imgOriginalUrl === targetUrl ||
                                       imgOriginalUrl === targetOriginalUrl;
                            });
                            currentImageIndex = imageIndex >= 0 ? imageIndex : 0;
                            console.log('Gallery item clicked, setting index to:', currentImageIndex);
                            showImageDetails(image);
                            
                            // Update large image with processed URL
                            const largeImageEl = document.getElementById('largeImage');
                            largeImageEl.src = imageUrl;
                            
                            // Ensure the image is clickable by adding proper data
                            if (!currentModel.images) {
                                currentModel.images = modelData.images;
                            }
                        });
                    }                    processedCount++;
                    elements.statusBar.textContent = `Loading example images (${processedCount}/${modelData.images.length})...`;
                } catch (error) {
                    console.error('Failed to process gallery image:', error);
                }
            }            if (processedCount > 0) {
                currentImageIndex = 0;
                const firstImage = getFirstValidImage(modelData.images);
                
                console.log('Setting up first image:', firstImage);
                
                // Ensure the image URL is processed
                const imageUrl = firstImage.url || firstImage.originalUrl;
                const processedUrl = await processImage(imageUrl, firstImage);
                
                if (processedUrl) {
                    firstImage.url = processedUrl;
                    elements.largeImage.src = processedUrl;
                } else {
                    elements.largeImage.src = imageUrl;
                }
                
                showImageDetails(firstImage);
                
                console.log('Large image initialized with:', elements.largeImage.src);
            }            elements.statusBar.textContent = `Loaded ${processedCount} example images`;
        } else {
            galleryContainer.innerHTML = '<p>No example images available.</p>';
            document.getElementById('imageDetails').style.display = 'none';
        }

        // Update the file path section
        if (filePath) {
            elements.safetensorsPath.textContent = filePath;
            elements.safetensorsPath.onclick = async (e) => {
                e.preventDefault();
                try {
                    await fetch('/open-file-location', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath })
                    });
                } catch (error) {
                    console.error('Failed to open file location:', error);
                }
            };
        } else {
            console.error('No file path found in model data');
            elements.safetensorsPath.textContent = 'File path not available';
            elements.safetensorsPath.onclick = null;
        }
    }

    function showImageDetails(image) {
        const imageMetaEl = document.getElementById('imageMeta');
        const positivePromptEl = document.getElementById('positivePrompt');
        const negativePromptEl = document.getElementById('negativePrompt');
        const resourcesListEl = document.getElementById('resourcesList');
        
        let metaHTML = '';
        if (image.meta) {
            metaHTML = `
                <p><strong>Model:</strong> ${image.meta.Model || 'N/A'}</p>
                <p><strong>Steps:</strong> ${image.meta.steps || 'N/A'}</p>
                <p><strong>Sampler:</strong> ${image.meta.sampler || 'N/A'}</p>
                <p><strong>CFG Scale:</strong> ${image.meta.cfgScale || 'N/A'}</p>
                <p><strong>Seed:</strong> ${image.meta.seed || 'N/A'}</p>
            `;
        } else {
            metaHTML = '<p>No metadata available for this image.</p>';
        }
        
        imageMetaEl.innerHTML = `
            <p><strong>Dimensions:</strong> ${image.width} × ${image.height}</p>
            ${metaHTML}
        `;
        
        positivePromptEl.textContent = image.meta?.prompt || 'No prompt available';
        negativePromptEl.textContent = image.meta?.negativePrompt || 'No negative prompt available';
        
        // Display resources used
        displayResourcesForImage(image);
        
        document.getElementById('imageDetails').style.display = 'block';
    }

    async function displayResourcesForImage(image) {
        const resourcesListEl = document.getElementById('resourcesList');
        
        if (!image.meta?.resources || !Array.isArray(image.meta.resources)) {
            resourcesListEl.innerHTML = '<p>No resources information available.</p>';
            return;
        }

        resourcesListEl.innerHTML = '<p>Loading resources...</p>';

        try {
            const resources = image.meta.resources;
            let resourcesHTML = '<div class="resources-container">';
            
            for (const resource of resources) {
                if (!resource.hash) {
                    // Handle resources without hash (use name if available)
                    resourcesHTML += `
                        <div class="resource-item">
                            <div class="resource-name">${resource.name || 'Unknown Model'}</div>
                            <div class="resource-details">
                                <span class="resource-type">${resource.type || 'Unknown'}</span>
                                ${resource.weight ? `<span class="resource-weight">Weight: ${resource.weight}</span>` : ''}
                            </div>
                        </div>
                    `;
                    continue;
                }

                // Check cache first
                let modelInfo = hashInfoCache.get(resource.hash);
                
                if (!modelInfo) {
                    // Fetch from CivitAI API
                    modelInfo = await fetchModelInfoByHash(resource.hash);
                }                resourcesHTML += `
                    <div class="resource-item" ${modelInfo.modelId ? `onclick="openInBrowser('https://civitai.com/models/${modelInfo.modelId}')" style="cursor: pointer;" title="Open on CivitAI"` : ''}>
                        <div class="resource-name">${modelInfo.name}</div>
                        <div class="resource-details">
                            <span class="resource-type">${modelInfo.type}</span>
                            ${resource.weight ? `<span class="resource-weight">Weight: ${resource.weight}</span>` : ''}
                        </div>
                        <div class="resource-hash">${resource.hash}</div>
                    </div>
                `;
            }
            
            resourcesHTML += '</div>';
            resourcesListEl.innerHTML = resourcesHTML;
            
            // Save cache after all fetches
            await saveHashInfoCache();
            
        } catch (error) {
            console.error('Error displaying resources:', error);
            resourcesListEl.innerHTML = '<p>Error loading resources information.</p>';
        }
    }

    function navigateImage(direction) {
        console.log('Navigating image:', { direction, currentImageIndex, totalImages: currentModel?.images?.length });
        
        if (!currentModel?.images && !currentModel?.modelVersion?.images) {
            console.error('No images available for navigation');
            return;
        }
        
        // Support both image locations for flexibility
        const images = currentModel.images || currentModel.modelVersion?.images || [];
        if (images.length === 0) {
            console.error('No images in array');
            return;
        }
        
        // Calculate new index with wraparound
        const newIndex = (currentImageIndex + direction + images.length) % images.length;
        currentImageIndex = newIndex;
        
        console.log('New image index:', currentImageIndex);
        
        const currentImage = images[newIndex];
        if (!currentImage) {
            console.error('No image found at index:', currentImageIndex);
            return;
        }
        
        const imageUrl = currentImage.url || currentImage.originalUrl;
        if (!imageUrl) {
            console.error('No URL found for current image:', currentImage);
            return;
        }
        
        // Update modal image
        elements.modalImage.src = imageUrl;
        
        // Update large image in details panel
        elements.largeImage.src = imageUrl;
          // Update image details
        showImageDetails(currentImage);
        
        console.log('Updated to image:', imageUrl);
    }

    // Event Listeners
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
        elements.themeToggle.innerHTML = !isDarkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    });

    // Add home link functionality (navigate back to index and clear filters)
    const homeLink = document.getElementById('homeLink');
    if (homeLink) {
        homeLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Clear any stored page state to reset to page 1
            localStorage.removeItem('currentPage');
            // Clear scroll position to prevent restoration
            localStorage.removeItem('scrollPosition');
            // Set a flag to indicate home link was used (for the next page load)
            localStorage.setItem('homeLinkClicked', 'true');
            // Navigate back to index.html which will clear all filters by default
            window.location.href = 'index.html';
        });
    }

    elements.prevImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateImage(-1);
    });    elements.nextImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateImage(1);
    });    // Back button navigation with page restoration and performance optimization
    elements.backBtn.addEventListener('click', () => {
        console.log('Back button clicked, preparing fast return');
        
        // Save current page to localStorage for restoration
        const savedPage = localStorage.getItem('currentPage');
        
        // Save scroll position for smooth restoration
        const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
        localStorage.setItem('scrollPosition', scrollPosition.toString());
        
        // Mark that we're returning from details view (for optimization)
        localStorage.setItem('returningFromDetails', 'true');
        
        // Save additional state for ultra-fast restoration
        const currentState = {
            timestamp: Date.now(),
            scrollPosition: scrollPosition,
            page: savedPage
        };
        localStorage.setItem('fastReturnState', JSON.stringify(currentState));
        
        // Add transition class for smoother navigation
        document.body.style.transition = 'opacity 0.15s ease';
        document.body.style.opacity = '0.85';
        
        // Navigate with optimized loading parameters
        if (savedPage) {
            window.location.href = `index.html?page=${savedPage}&fast=1&cache=1`;
        } else {
            window.location.href = 'index.html?fast=1&cache=1';
        }
    });

    // Enhanced large image click handler with debugging
    elements.largeImage.addEventListener('click', (e) => {
        console.log('Large image clicked', { currentModel, currentImageIndex });
        
        // Prevent any potential event propagation issues
        e.preventDefault();
        e.stopPropagation();
        
        if (!currentModel) {
            console.error('No current model available');
            return;
        }
        
        const modelImages = currentModel.modelVersion?.images || currentModel.images || [];
        console.log('Available images:', modelImages.length);
        
        if (modelImages.length === 0) {
            console.error('No images available');
            return;
        }
          if (currentImageIndex < 0 || currentImageIndex >= modelImages.length) {
            console.log(`Image index ${currentImageIndex} out of bounds (0-${modelImages.length-1}), resetting to 0`);
            currentImageIndex = 0; // Reset to first image
        }
        
        const currentImage = modelImages[currentImageIndex];
        if (!currentImage) {
            console.error('No current image found at index:', currentImageIndex);
            return;
        }
        
        const imageUrl = currentImage.url || currentImage.originalUrl;
        if (!imageUrl) {
            console.error('No image URL found:', currentImage);
            return;
        }
        
        console.log('Opening modal with image:', imageUrl);
        elements.modalImage.src = imageUrl;
        elements.modal.style.display = 'block';
        
        // Set focus to modal for keyboard navigation
        elements.modal.focus();
    });    elements.closeModal.addEventListener('click', () => {
        elements.modal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === elements.modal) {
            elements.modal.style.display = 'none';
        }
    });
});