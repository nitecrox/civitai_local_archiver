const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Initialize config with default values
let config = {};

// Function to create default config if it doesn't exist
async function initializeConfig() {
    const configPath = path.join(__dirname, 'config.json');
    
    try {
        // Try to read existing config
        const configContent = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(configContent);
        console.log('Loaded existing config.json');
    } catch (error) {
        // Create default config if file doesn't exist
        const defaultConfig = {
            "metadata_output_dir": "./metadata",
            "theme": "dark",
            "auto_generate_metadata": true,
            "standalone_files": [],
            "watched_folders": [],
            "previously_deleted": [],
            "failed_to_generate": []
        };
        
        config = defaultConfig;
        
        // Write default config to file
        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log('Created default config.json');
    }
}

// Function to save current config to file
async function saveConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log('Config saved successfully');
    } catch (error) {
        console.error('Failed to save config:', error);
        throw error;
    }
}

const app = express();

app.use(express.json());

// Ensure images folder exists
const IMAGES_FOLDER = path.join(__dirname, 'images');
fs.mkdir(IMAGES_FOLDER, { recursive: true }).catch(console.error);

// Hash cache system for model info
const HASH_CACHE_FILE = path.join(__dirname, 'model_hash_info.json');
let modelHashCache = {};

// Load hash cache from file
async function loadHashCache() {
    try {
        const cacheContent = await fs.readFile(HASH_CACHE_FILE, 'utf8');
        modelHashCache = JSON.parse(cacheContent);
        console.log(`Loaded ${Object.keys(modelHashCache).length} cached hash entries`);
    } catch (error) {
        // File doesn't exist or is corrupted, start with empty cache
        modelHashCache = {};
        console.log('Starting with empty hash cache');
    }
}

// Save hash cache to file
async function saveHashCache() {
    try {
        await fs.writeFile(HASH_CACHE_FILE, JSON.stringify(modelHashCache, null, 2));
        console.log('Hash cache saved');
    } catch (error) {
        console.error('Failed to save hash cache:', error);
    }
}

// Fetch model info from CivitAI API
async function fetchModelInfoByHash(hash) {
    try {
        // Check cache first
        if (modelHashCache[hash]) {
            return modelHashCache[hash];
        }

        console.log(`Fetching model info for hash: ${hash}`);
        const response = await axios.get(`https://civitai.com/api/v1/model-versions/by-hash/${hash}`, {
            timeout: 10000 // 10 second timeout
        });        if (response.status === 200) {
            const data = response.data;
            const modelInfo = {
                name: data.model?.name || 'Unknown Model',
                type: data.model?.type || 'Unknown Type',
                versionName: data.name || 'Unknown Version',
                modelId: data.modelId || null
            };

            // Cache the result
            modelHashCache[hash] = modelInfo;
            
            // Save cache periodically (every 10 new entries)
            if (Object.keys(modelHashCache).length % 10 === 0) {
                await saveHashCache();
            }

            return modelInfo;
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.error(`Failed to fetch model info for hash ${hash}:`, error.message);
          // Return fallback info and cache it to avoid repeated failures
        const fallbackInfo = {
            name: 'Unknown Model',
            type: 'Unknown Type',
            versionName: 'Unknown Version',
            modelId: null
        };
        
        modelHashCache[hash] = fallbackInfo;
        return fallbackInfo;
    }
}

// Initialize hash cache on startup
loadHashCache();

// Function to cache all resources from all JSON files
async function cacheAllResources() {
    console.log('Starting comprehensive resource caching...');
    let totalResourcesCached = 0;
    let totalFilesProcessed = 0;
    
    try {
        // Get all JSON files from metadata directory
        const metadataDir = path.join(__dirname, 'metadata');
        
        async function processDirectory(dir) {
            const items = await fs.readdir(dir, { withFileTypes: true });
            
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                
                if (item.isDirectory()) {
                    await processDirectory(fullPath);
                } else if (item.isFile() && item.name.endsWith('.json')) {
                    try {
                        const jsonContent = await fs.readFile(fullPath, 'utf8');
                        const modelData = JSON.parse(jsonContent);
                        totalFilesProcessed++;
                        
                        // Extract resources from all images in this model
                        if (modelData.images && Array.isArray(modelData.images)) {
                            for (const image of modelData.images) {
                                if (image.meta && image.meta.resources && Array.isArray(image.meta.resources)) {
                                    for (const resource of image.meta.resources) {
                                        if (resource.hash && !modelHashCache[resource.hash]) {
                                            // Cache this resource
                                            await fetchModelInfoByHash(resource.hash);
                                            totalResourcesCached++;
                                            
                                            // Log progress every 10 resources
                                            if (totalResourcesCached % 10 === 0) {
                                                console.log(`Cached ${totalResourcesCached} resources so far...`);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Also check modelVersion.images for compatibility
                        if (modelData.modelVersion && modelData.modelVersion.images && Array.isArray(modelData.modelVersion.images)) {
                            for (const image of modelData.modelVersion.images) {
                                if (image.meta && image.meta.resources && Array.isArray(image.meta.resources)) {
                                    for (const resource of image.meta.resources) {
                                        if (resource.hash && !modelHashCache[resource.hash]) {
                                            // Cache this resource
                                            await fetchModelInfoByHash(resource.hash);
                                            totalResourcesCached++;
                                            
                                            // Log progress every 10 resources
                                            if (totalResourcesCached % 10 === 0) {
                                                console.log(`Cached ${totalResourcesCached} resources so far...`);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing JSON file ${fullPath}:`, error.message);
                    }
                }
            }
        }
        
        await processDirectory(metadataDir);
        
        // Save the updated cache
        await saveHashCache();
        
        console.log(`Resource caching complete! Processed ${totalFilesProcessed} JSON files and cached ${totalResourcesCached} new resources.`);
        return { filesProcessed: totalFilesProcessed, resourcesCached: totalResourcesCached };
        
    } catch (error) {
        console.error('Error during comprehensive resource caching:', error);
        throw error;
    }
}

// Enhanced caching system with persistence
let modelsCache = null;
let lastCacheUpdate = 0;
const CACHE_LIFETIME = 5 * 60 * 1000; // 5 minutes
const CACHE_FILE = path.join(__dirname, 'models-cache.json');
const FOLDER_STATS_FILE = path.join(__dirname, 'folder-stats.json');
let folderStats = new Map(); // Track folder modification times
let backgroundScanInProgress = false;

// Helper functions for persistent caching and change detection
async function loadCacheFromDisk() {
    try {
        const cacheData = await fs.readFile(CACHE_FILE, 'utf8');
        const cache = JSON.parse(cacheData);
        if (cache.models && cache.timestamp) {
            modelsCache = cache.models;
            lastCacheUpdate = cache.timestamp;
            console.log(`Loaded ${modelsCache.length} models from persistent cache`);
            return true;
        }
    } catch (error) {
        console.log('No persistent cache found, will build fresh cache');
    }
    return false;
}

async function saveCacheToDisk() {
    try {
        const cacheData = {
            models: modelsCache,
            timestamp: lastCacheUpdate
        };
        await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
        console.log('Saved models cache to disk');
    } catch (error) {
        console.error('Failed to save cache to disk:', error);
    }
}

// Check if any JSON metadata files are newer than the cache
async function hasNewerMetadataFiles() {
    if (!lastCacheUpdate) {
        return true; // No cache timestamp, consider files as newer
    }
    
    try {
        // Check metadata directory for JSON files
        const metadataDir = config.metadata_output_dir;
        if (!await fs.access(metadataDir).then(() => true).catch(() => false)) {
            return false; // Metadata directory doesn't exist
        }
        
        const files = await fs.readdir(metadataDir);
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        
        for (const jsonFile of jsonFiles) {
            try {
                const jsonPath = path.join(metadataDir, jsonFile);
                const stats = await fs.stat(jsonPath);
                
                // If any JSON file is newer than the cache, invalidate
                if (stats.mtime.getTime() > lastCacheUpdate) {
                    console.log(`Found newer metadata file: ${jsonFile} (${stats.mtime.toISOString()}) newer than cache (${new Date(lastCacheUpdate).toISOString()})`);
                    return true;
                }
            } catch (error) {
                // Skip files that can't be accessed
                console.warn(`Could not check file ${jsonFile}:`, error.message);
            }
        }
        
        return false; // No newer files found
    } catch (error) {
        console.error('Error checking for newer metadata files:', error);
        return false;
    }
}

async function loadFolderStats() {
    try {
        const statsData = await fs.readFile(FOLDER_STATS_FILE, 'utf8');
        const stats = JSON.parse(statsData);
        folderStats = new Map(Object.entries(stats));
        console.log('Loaded folder stats from disk');
    } catch (error) {
        console.log('No folder stats found, will track changes from now');
        folderStats = new Map();
    }
}

async function saveFolderStats() {
    try {
        const statsObj = Object.fromEntries(folderStats);
        await fs.writeFile(FOLDER_STATS_FILE, JSON.stringify(statsObj, null, 2));
    } catch (error) {
        console.error('Failed to save folder stats:', error);
    }
}

async function checkFolderChanges() {
    let hasChanges = false;
    
    for (const folder of config.watched_folders) {
        try {
            const stats = await fs.stat(folder);
            const lastModified = stats.mtime.getTime();
            const previousModified = folderStats.get(folder);
            
            if (!previousModified || lastModified > previousModified) {
                console.log(`Folder ${folder} has changes`);
                folderStats.set(folder, lastModified);
                hasChanges = true;
            }
        } catch (error) {
            console.error(`Error checking folder ${folder}:`, error);
        }
    }
    
    if (hasChanges) {
        await saveFolderStats();
    }
    
    return hasChanges;
}

async function scanModelsInBackground() {
    if (backgroundScanInProgress) {
        console.log('Background scan already in progress');
        return;
    }
    
    backgroundScanInProgress = true;
    console.log('Starting background model scan...');
    console.log('Config watched folders:', config.watched_folders);
    console.log('Config standalone files count:', config.standalone_files?.length || 0);
      try {
        const models = [];
        const processedPaths = new Set();
        
        // Get previously deleted files list
        const previouslyDeleted = config.previously_deleted || [];
        console.log('Previously deleted count:', previouslyDeleted.length);
        
        // Get list of models that failed to generate JSON files
        const failedToGenerate = config.failed_to_generate || [];
        console.log('Failed to generate count:', failedToGenerate.length);

        // Process watched folders
        for (const folder of config.watched_folders) {
            try {
                console.log('Background scanning folder:', folder);
                const files = await scanDir(folder);
                console.log(`Found ${files.length} safetensors files in folder: ${folder}`);
                
                for (const filePath of files) {
                    if (processedPaths.has(filePath) || previouslyDeleted.includes(filePath)) {
                        console.log(`Skipping duplicate/previously deleted file: ${filePath}`);
                        continue;
                    }
                    
                    try {
                        const jsonFileName = path.basename(filePath, '.safetensors') + '.json';
                        const jsonPath = path.join(config.metadata_output_dir, jsonFileName);
                        
                        // Basic model info
                        const modelInfo = {
                            safetensorsPath: filePath,
                            name: path.basename(filePath, '.safetensors'),
                            type: 'Model'
                        };                        // Try to read JSON if it exists
                        try {
                            const content = await fs.readFile(jsonPath, 'utf8');
                            const jsonData = JSON.parse(content);
                            Object.assign(modelInfo, jsonData);
                        } catch (error) {
                            // No JSON found - check if model is in failed_to_generate list
                            if (failedToGenerate.includes(filePath)) {
                                console.log(`Skipping metadata generation for ${filePath} - in failed_to_generate list`);
                                modelInfo.metadataFailed = true;
                                modelInfo.failureReason = 'Previously failed to generate metadata';
                            } else if (config.auto_generate_metadata) {
                                console.log(`Attempting to generate metadata for: ${filePath}`);
                                try {
                                    const result = await generateModelJSON(filePath);
                                    if (result.success) {
                                        // Successfully generated JSON, read and use it
                                        const content = await fs.readFile(jsonPath, 'utf8');
                                        const jsonData = JSON.parse(content);
                                        Object.assign(modelInfo, jsonData);
                                        console.log(`Successfully generated metadata for: ${path.basename(filePath)}`);
                                    } else {
                                        // Generation failed, mark as failed metadata and add to failed list
                                        modelInfo.metadataFailed = true;
                                        modelInfo.failureReason = `Metadata generation failed: ${result.error}`;
                                        console.error(`Failed to generate metadata for ${filePath}: ${result.error}`);
                                        
                                        // Add to failed_to_generate list and save config
                                        if (!config.failed_to_generate) {
                                            config.failed_to_generate = [];
                                        }
                                        if (!config.failed_to_generate.includes(filePath)) {
                                            config.failed_to_generate.push(filePath);
                                            await saveConfig();
                                            console.log(`Added ${filePath} to failed_to_generate list`);
                                        }
                                    }
                                } catch (genError) {
                                    // Generation threw an exception, mark as failed metadata and add to failed list
                                    modelInfo.metadataFailed = true;
                                    modelInfo.failureReason = `Metadata generation error: ${genError.message}`;
                                    console.error(`Error generating metadata for ${filePath}:`, genError);
                                    
                                    // Add to failed_to_generate list and save config
                                    if (!config.failed_to_generate) {
                                        config.failed_to_generate = [];
                                    }
                                    if (!config.failed_to_generate.includes(filePath)) {
                                        config.failed_to_generate.push(filePath);
                                        await saveConfig();
                                        console.log(`Added ${filePath} to failed_to_generate list`);
                                    }
                                }
                            } else {
                                // Automatic generation disabled, mark as failed metadata
                                modelInfo.metadataFailed = true;
                                modelInfo.failureReason = 'Metadata not found or invalid';
                            }
                        }models.push(modelInfo);
                        processedPaths.add(filePath);
                        console.log(`Added model from folder: ${path.basename(filePath)}`);
                    } catch (error) {
                        console.error(`Error processing ${filePath}:`, error);
                    }
                }
            } catch (error) {
                console.error(`Error processing folder ${folder}:`, error);
            }
        }        
        
        console.log(`Processed ${models.length} models from watched folders`);
        
        // Process standalone files
        for (const filePath of config.standalone_files) {
            if (processedPaths.has(filePath) || previouslyDeleted.includes(filePath)) {
                console.log(`Skipping duplicate/previously deleted standalone file: ${filePath}`);
                continue;
            }
            
            try {
                const modelInfo = {
                    safetensorsPath: filePath,
                    name: path.basename(filePath, '.safetensors'),
                    type: 'Model'
                };

                const jsonFileName = path.basename(filePath, '.safetensors') + '.json';
                const jsonPath = path.join(config.metadata_output_dir, jsonFileName);                  try {
                    const content = await fs.readFile(jsonPath, 'utf8');
                    const jsonData = JSON.parse(content);
                    Object.assign(modelInfo, jsonData);
                } catch (error) {
                    // No JSON found - check if model is in failed_to_generate list
                    if (failedToGenerate.includes(filePath)) {
                        console.log(`Skipping metadata generation for standalone file ${filePath} - in failed_to_generate list`);
                        modelInfo.metadataFailed = true;
                        modelInfo.failureReason = 'Previously failed to generate metadata';
                    } else if (config.auto_generate_metadata) {
                        console.log(`Attempting to generate metadata for standalone file: ${filePath}`);
                        try {
                            const result = await generateModelJSON(filePath);
                            if (result.success) {
                                // Successfully generated JSON, read and use it
                                const content = await fs.readFile(jsonPath, 'utf8');
                                const jsonData = JSON.parse(content);
                                Object.assign(modelInfo, jsonData);
                                console.log(`Successfully generated metadata for standalone file: ${path.basename(filePath)}`);
                            } else {
                                // Generation failed, mark as failed metadata and add to failed list
                                modelInfo.metadataFailed = true;
                                modelInfo.failureReason = `Metadata generation failed: ${result.error}`;
                                console.error(`Failed to generate metadata for standalone file ${filePath}: ${result.error}`);
                                
                                // Add to failed_to_generate list and save config
                                if (!config.failed_to_generate) {
                                    config.failed_to_generate = [];
                                }
                                if (!config.failed_to_generate.includes(filePath)) {
                                    config.failed_to_generate.push(filePath);
                                    await saveConfig();
                                    console.log(`Added standalone file ${filePath} to failed_to_generate list`);
                                }
                            }
                        } catch (genError) {
                            // Generation threw an exception, mark as failed metadata and add to failed list
                            modelInfo.metadataFailed = true;
                            modelInfo.failureReason = `Metadata generation error: ${genError.message}`;
                            console.error(`Error generating metadata for standalone file ${filePath}:`, genError);
                            
                            // Add to failed_to_generate list and save config
                            if (!config.failed_to_generate) {
                                config.failed_to_generate = [];
                            }
                            if (!config.failed_to_generate.includes(filePath)) {
                                config.failed_to_generate.push(filePath);
                                await saveConfig();
                                console.log(`Added standalone file ${filePath} to failed_to_generate list`);
                            }
                        }
                    } else {
                        // Automatic generation disabled, mark as failed metadata
                        modelInfo.metadataFailed = true;
                        modelInfo.failureReason = 'Metadata not found or invalid';
                    }
                }models.push(modelInfo);
                processedPaths.add(filePath);
                console.log(`Added standalone model: ${path.basename(filePath)}`);
            } catch (error) {
                console.error(`Error processing standalone file ${filePath}:`, error);
            }
        }

        console.log(`Total models found: ${models.length}`);
        
        // Update cache
        modelsCache = models;
        lastCacheUpdate = Date.now();
        await saveCacheToDisk();

        console.log(`Background scan complete: ${models.length} models cached`);
    } catch (error) {
        console.error('Background scan error:', error);
    } finally {
        backgroundScanInProgress = false;
    }
}

// Add this helper function at the top of the file with other helpers
async function scanDir(dir, extension = '.safetensors') {
    try {
        console.log(`Scanning directory: ${dir}`);
        const files = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        console.log(`Found ${entries.length} entries in: ${dir}`);
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                console.log(`Entering subdirectory: ${entry.name}`);
                files.push(...await scanDir(fullPath, extension));
            } else if (entry.name.endsWith(extension)) {
                console.log(`Found safetensors file: ${entry.name}`);
                files.push(fullPath);
            }
        }
        
        console.log(`Total safetensors files found in ${dir}: ${files.length}`);
        return files;
    } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error);
        return [];
    }
}

// Helper function to check if a URL indicates video content
function isVideoContent(url) {
    if (!url) return false;
    
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.gif'];
    const lowerUrl = url.toLowerCase();
    
    return videoExtensions.some(ext => lowerUrl.includes(ext));
}

// API Endpoints
app.get('/get-image', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).send('URL parameter is required');
        }

        // Check if this is video content and reject it
        if (isVideoContent(url)) {
            console.log('Rejecting video content:', url);
            return res.status(400).send('Video content not supported for image processing');
        }

        // If it's a local path, just serve the file
        if (url.startsWith('/images/')) {
            const localPath = path.join(__dirname, url);
            try {
                await fs.access(localPath);
                return res.sendFile(localPath);
            } catch (error) {
                return res.status(404).send('Image not found');
            }
        }

        // For remote URLs, download and cache
        const urlHash = crypto.createHash('sha256').update(url).digest('hex');
        const filename = `${urlHash}.webp`;
        const outputPath = path.join(__dirname, 'images', filename);

        // Check if file already exists
        try {
            await fs.access(outputPath);
            return res.sendFile(outputPath);
        } catch (error) {
            // File doesn't exist, download it
            console.log('Downloading image from:', url);
            const response = await axios.get(url, { 
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            if (response.status !== 200) {
                throw new Error(`Failed to download image: ${response.status}`);
            }            // Convert to WebP without resizing to preserve original resolution
            const webpBuffer = await sharp(response.data)
                .webp({ 
                    quality: 90,
                    effort: 6,      // More processing for better quality
                    smartSubsample: false // Better quality for text/sharp edges
                })
                .toBuffer();

            await fs.writeFile(outputPath, webpBuffer);
            console.log('Saved image to:', outputPath);

            res.type('image/webp').send(webpBuffer);
        }
    } catch (error) {
        console.error('Get image error:', error);
        res.status(500).send('Failed to process image');
    }
});

// Add this endpoint
app.get('/check-image', async (req, res) => {
    try {
        const imagePath = req.query.path?.replace(/^\/+/, '');
        if (!imagePath) {
            return res.status(400).json({ error: 'No path provided' });
        }

        const fullPath = path.join(__dirname, imagePath);
        
        try {
            await fs.access(fullPath);
            res.json({ exists: true });
        } catch (error) {
            res.status(404).json({ error: 'Image not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });    }
});


// Save downloaded image
app.post('/save-image', async (req, res) => {
    try {
        const imagePath = path.join(__dirname, req.body.path);
        await fs.writeFile(imagePath, req.file.buffer);
        res.send({ success: true });
    } catch (error) {
        console.error('Error saving image:', error);
        res.status(500).send({ error: 'Failed to save image' });
    }
});

// Add endpoint to scan folders for JSON files
app.post('/scan-folder', express.json(), async (req, res) => {
    try {
        const { folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ error: 'No folder path provided' });
        }

        // Check if folder exists
        try {
            await fs.access(folderPath);
        } catch (error) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        // Recursively scan for JSON files
        async function scanDir(dir) {
            const files = [];
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    files.push(...await scanDir(fullPath));
                } else if (entry.name.endsWith('.json')) {
                    files.push(fullPath);
                }
            }
            
            return files;
        }

        const files = await scanDir(folderPath);
        res.json({ files });

    } catch (error) {
        console.error('Error scanning folder:', error);
        res.status(500).json({ error: 'Failed to scan folder' });
    }
});

// Add endpoint to get file contents
app.get('/get-file', async (req, res) => {
    try {
        const filePath = decodeURIComponent(req.query.path);
        if (!filePath) {
            return res.status(400).json({ error: 'No file path provided' });
        }

        // Verify file exists
        try {
            await fs.access(filePath);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Read and send file
        const content = await fs.readFile(filePath, 'utf8');
        res.json(JSON.parse(content));

    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ error: 'Failed to read file' });
    }
});

// Update the upload-model endpoint
app.post('/upload-model', express.json(), async (req, res) => {
    try {
        const { filePath, fileName } = req.body;
        
        // Validate input
        if (!filePath || !fileName) {
            return res.status(400).json({ error: 'Missing file path or name' });
        }

        console.log('Processing model:', { filePath, fileName });

        // Ensure metadata directory exists
        await fs.mkdir(config.metadata_output_dir, { recursive: true });

        // Check if file exists and is accessible
        try {
            await fs.access(filePath);
            console.log('File exists and is accessible');
        } catch (error) {
            console.error('File access error:', error);
            return res.status(404).json({ error: 'File not found or not accessible' });
        }

        try {
            // Generate JSON metadata
            console.log('Attempting to generate JSON...');
            const result = await generateModelJSON(filePath);
            
            if (!result.success) {
                console.error('JSON generation failed:', result.error);
                throw new Error(result.error || 'Failed to generate model JSON');
            }

            // Get the JSON path and read its contents
            const jsonFileName = path.basename(filePath, '.safetensors') + '.json';
            const jsonPath = path.join(config.metadata_output_dir, jsonFileName);
            const jsonContent = await fs.readFile(jsonPath, 'utf8');
            const modelData = JSON.parse(jsonContent);

            // Add the safetensors path to the model data
            modelData.safetensorsPath = filePath;

            console.log('JSON generated successfully:', jsonPath);
            console.log('Added safetensors path:', filePath);

            res.json({ 
                success: true,
                ...modelData, // Include all model data
                safetensorsPath: filePath, // Ensure path is included
                message: 'Model processed successfully',
                jsonPath
            });

        } catch (error) {
            console.error('Error generating JSON:', error);
            res.status(500).json({ 
                error: 'Failed to generate model JSON',
                ignored: true,
                filePath,
                details: error.message 
            });
        }

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to process model',
            details: error.stack
        });
    }
});

// Update the generateModelJSON function to check for existing JSON first
async function generateModelJSON(filePath) {
    try {
        console.log('Checking/Generating JSON for:', filePath);
        
        // Generate expected JSON path
        const jsonFileName = path.basename(filePath, '.safetensors') + '.json';
        const jsonPath = path.join(config.metadata_output_dir, jsonFileName);

        // Check if JSON already exists
        try {
            await fs.access(jsonPath);
            console.log('Found existing JSON file:', jsonPath);
            
            // Verify the JSON is valid
            const content = await fs.readFile(jsonPath, 'utf8');
            JSON.parse(content); // This will throw if JSON is invalid
            
            return { 
                success: true,
                jsonPath,
                existing: true
            };
        } catch (error) {
            console.log('No valid existing JSON found, generating new one...');
        }

        // Run Python script to generate new JSON
        const pythonProcess = spawn('python', [
            'civitai_model_metadata_download.py',
            filePath,
            config.metadata_output_dir
        ]);

        let pythonOutput = '';
        let pythonError = '';

        pythonProcess.stdout.on('data', (data) => {
            pythonOutput += data.toString();
            console.log('Python output:', data.toString());
        });

        pythonProcess.stderr.on('data', (data) => {
            pythonError += data.toString();
            console.error('Python error:', data.toString());
        });

        await new Promise((resolve, reject) => {
            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Python script failed with code ${code}: ${pythonError}`));
                }
            });
        });        return { 
            success: true,
            jsonPath,
            existing: false
        };
    } catch (error) {
        console.error('Error in generateModelJSON:', error);
        return { 
            success: false, 
            error: error.message,
            details: error.stack
        };
    }
}

// Function to cache resources from model data
async function cacheResourcesFromModel(modelData) {
    try {
        if (!modelData || !modelData.modelVersion || !modelData.modelVersion.images) {
            return;
        }

        const images = modelData.modelVersion.images;
        const resourcesToCache = new Set();

        // Collect all unique resources from all images
        for (const image of images) {
            if (image.meta && image.meta.resources && Array.isArray(image.meta.resources)) {
                for (const resource of image.meta.resources) {
                    if (resource.hash) {
                        resourcesToCache.add(resource.hash);
                    }
                }
            }
        }

        if (resourcesToCache.size === 0) {
            console.log('No resources found to cache');
            return;
        }

        console.log(`Caching ${resourcesToCache.size} unique resources...`);

        // Cache each resource
        for (const hash of resourcesToCache) {
            try {
                // Only fetch if not already cached
                if (!modelHashCache[hash]) {
                    await fetchModelInfoByHash(hash);
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            } catch (error) {
                console.error(`Failed to cache resource ${hash}:`, error.message);
            }
        }

        // Save cache after caching all resources
        await saveHashCache();
        console.log('Resource caching completed');

    } catch (error) {
        console.error('Error caching resources:', error);
    }
}

// Update the loadModels function to prevent duplicates
async function loadModels() {
    try {
        // Clear existing models
        let models = [];
        const processedPaths = new Set(); // Track processed paths        // Get ignored files and previously deleted files list first
        const ignoredFiles = config.ignored_files || [];
        const previouslyDeleted = config.previously_deleted || [];
        
        // Process watched folders first
        for (const folder of config.watched_folders) {
            console.log('Processing watched folder:', folder);
            const files = await scanDir(folder);
            
            for (const filePath of files) {
                // Skip if already processed, ignored, or previously deleted
                if (processedPaths.has(filePath) || ignoredFiles.includes(filePath) || previouslyDeleted.includes(filePath)) {
                    console.log(`Skipping duplicate/ignored/previously deleted file: ${filePath}`);
                    continue;
                }                try {
                    const result = await generateModelJSON(filePath);
                    if (result.success) {
                        // Read the JSON content
                        const jsonFileName = path.basename(filePath, '.safetensors') + '.json';
                        const jsonPath = path.join(config.metadata_output_dir, jsonFileName);
                        const jsonContent = await fs.readFile(jsonPath, 'utf8');
                        const modelData = JSON.parse(jsonContent);

                        // Add the safetensors path
                        modelData.safetensorsPath = filePath;
                        
                        // Cache resources from example images if this is a new JSON file
                        if (!result.existing) {
                            console.log(`Caching resources for newly generated model: ${path.basename(filePath)}`);
                            await cacheResourcesFromModel(modelData);
                        }
                        
                        // Add to models array
                        models.push(modelData);
                        processedPaths.add(filePath);
                        
                        console.log(`Loaded model: ${path.basename(filePath)}`);
                    }
                } catch (error) {
                    console.error(`Failed to process ${filePath}:`, error);
                }
            }
        }        // Process standalone files
        for (const filePath of config.standalone_files) {
            if (processedPaths.has(filePath) || ignoredFiles.includes(filePath) || previouslyDeleted.includes(filePath)) {
                console.log(`Skipping duplicate/ignored/previously deleted standalone file: ${filePath}`);
                continue;
            }            try {
                const result = await generateModelJSON(filePath);
                if (result.success) {
                    // Read the JSON content
                    const jsonFileName = path.basename(filePath, '.safetensors') + '.json';
                    const jsonPath = path.join(config.metadata_output_dir, jsonFileName);
                    const jsonContent = await fs.readFile(jsonPath, 'utf8');
                    const modelData = JSON.parse(jsonContent);

                    // Add the safetensors path
                    modelData.safetensorsPath = filePath;
                    
                    // Cache resources from example images if this is a new JSON file
                    if (!result.existing) {
                        console.log(`Caching resources for newly generated standalone model: ${path.basename(filePath)}`);
                        await cacheResourcesFromModel(modelData);
                    }
                    
                    // Add to models array
                    models.push(modelData);
                    processedPaths.add(filePath);
                    
                    console.log(`Loaded standalone model: ${path.basename(filePath)}`);
                }
            } catch (error) {
                console.error(`Failed to process standalone file ${filePath}:`, error);
            }
        }

        // Save models to localStorage equivalent on server side
        global.loadedModels = models;
        
        return models;
    } catch (error) {
        console.error('Error loading models:', error);
        return [];
    }
}

// Update the get-models endpoint
// Optimized get-models endpoint with instant response and background updates
app.get('/get-models', async (req, res) => {
    try {
        // Always return cached models immediately if available
        if (modelsCache) {
            // Trigger background scan if cache is stale, folders changed, or metadata files are newer
            const now = Date.now();
            const cacheIsStale = (now - lastCacheUpdate) > CACHE_LIFETIME;
            const foldersChanged = await checkFolderChanges();
            const hasNewerFiles = await hasNewerMetadataFiles();
            
            if (cacheIsStale || foldersChanged || hasNewerFiles) {
                const reasons = [];
                if (cacheIsStale) reasons.push('cache is stale');
                if (foldersChanged) reasons.push('folders changed');
                if (hasNewerFiles) reasons.push('newer metadata files found');
                
                console.log(`Triggering background update: ${reasons.join(', ')}`);
                setTimeout(() => scanModelsInBackground(), 100);
            }
            
            // Filter out previously deleted models
            const previouslyDeleted = config.previously_deleted || [];
            const filteredModels = modelsCache.filter(model => {
                const modelPath = model.safetensorsPath || model.filePath;
                return !previouslyDeleted.includes(modelPath);
            });
            
            return res.json({ 
                success: true, 
                models: filteredModels,
                cached: true,
                lastUpdate: lastCacheUpdate
            });
        }
        
        // No cache available - check if background scan is in progress
        if (backgroundScanInProgress) {
            return res.json({ 
                success: true, 
                models: [],
                loading: true,
                message: 'Models are being loaded in the background...'
            });
        }
          // No cache and no scan in progress - start immediate scan
        console.log('No cache available, starting immediate scan');
        await scanModelsInBackground();
        
        // Filter out previously deleted models for fresh scan too
        const previouslyDeleted = config.previously_deleted || [];
        const filteredModels = (modelsCache || []).filter(model => {
            const modelPath = model.safetensorsPath || model.filePath;
            return !previouslyDeleted.includes(modelPath);
        });
        
        return res.json({ 
            success: true, 
            models: filteredModels,
            fresh: true
        });
        
    } catch (error) {        console.error('Error getting models:', error);
        res.status(500).json({ 
            error: 'Failed to get models',
            details: error.message
        });
    }
});

// Cache refresh endpoint to force immediate cache invalidation and rebuild
app.post('/refresh-cache', async (req, res) => {
    try {
        console.log('Manual cache refresh requested');
        
        // Clear the failed_to_generate list to give all models a fresh attempt
        if (config.failed_to_generate && config.failed_to_generate.length > 0) {
            console.log(`Clearing failed_to_generate list with ${config.failed_to_generate.length} entries`);
            config.failed_to_generate = [];
            await saveConfig();
        }
        
        // Force cache invalidation by clearing current cache
        modelsCache = null;
        lastCacheUpdate = 0;
        
        // Trigger immediate background scan
        if (!backgroundScanInProgress) {
            await scanModelsInBackground();
        }
        
        // Start comprehensive resource caching
        console.log('Starting comprehensive resource caching...');
        let resourceCacheResults = { filesProcessed: 0, resourcesCached: 0 };
        
        try {
            resourceCacheResults = await cacheAllResources();
        } catch (error) {
            console.error('Resource caching failed:', error);
        }
        
        // Return updated models
        const previouslyDeleted = config.previously_deleted || [];
        const filteredModels = (modelsCache || []).filter(model => {
            const modelPath = model.safetensorsPath || model.filePath;
            return !previouslyDeleted.includes(modelPath);
        });
          res.json({ 
            success: true,
            message: 'Cache refreshed successfully',
            models: filteredModels,
            count: filteredModels.length,
            refreshed: true,
            resourceCache: {
                filesProcessed: resourceCacheResults.filesProcessed,
                resourcesCached: resourceCacheResults.resourcesCached
            }
        });
    } catch (error) {
        console.error('Error refreshing cache:', error);
        res.status(500).json({ 
            error: 'Failed to refresh cache',
            details: error.message
        });
    }
});

// Update the save-config endpoint
app.post('/save-config', express.json(), async (req, res) => {
    try {
        const newConfig = req.body;
        
        // Basic validation
        if (!newConfig || !Array.isArray(newConfig.standalone_files)) {
            return res.status(400).json({ error: 'Invalid config format' });
        }        // Ensure all required properties exist (remove ignored_files)
        const updatedConfig = {
            metadata_output_dir: newConfig.metadata_output_dir || config.metadata_output_dir,
            theme: newConfig.theme || config.theme || 'dark',
            auto_generate_metadata: newConfig.auto_generate_metadata !== undefined ? newConfig.auto_generate_metadata : (config.auto_generate_metadata !== undefined ? config.auto_generate_metadata : true),
            standalone_files: newConfig.standalone_files || [],
            watched_folders: newConfig.watched_folders || config.watched_folders || [],
            previously_deleted: newConfig.previously_deleted || config.previously_deleted || [],
            failed_to_generate: newConfig.failed_to_generate || config.failed_to_generate || []
        };
        
        // Update config object
        Object.assign(config, updatedConfig);
        
        // Save to file
        await fs.writeFile(
            path.join(__dirname, 'config.json'), 
            JSON.stringify(config, null, 2)
        );
        
        res.json({ 
            success: true,
            config: config
        });
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).json({ 
            error: 'Failed to save config',
            details: error.message 
        });
    }
});

// Add endpoint to open file location in explorer
app.post('/open-file-location', async (req, res) => {
    try {
        const { filePath } = req.body;
        spawn('explorer', ['/select,', filePath]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to open file location' });
    }
});

// Hash cache API endpoints
app.get('/get-hash-info-cache', async (req, res) => {
    try {
        res.json(modelHashCache);
    } catch (error) {
        console.error('Error getting hash info cache:', error);
        res.status(500).json({ error: 'Failed to get hash info cache' });
    }
});

app.post('/save-hash-info-cache', express.json(), async (req, res) => {
    try {
        modelHashCache = req.body || {};
        await saveHashCache();
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving hash info cache:', error);
        res.status(500).json({ error: 'Failed to save hash info cache' });
    }
});

// Endpoint to open URL in default browser
app.post('/open-url', express.json(), async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        // Use shell.openExternal equivalent for server-side
        const { exec } = require('child_process');
        const command = process.platform === 'win32' ? `start "${url}"` : 
                       process.platform === 'darwin' ? `open "${url}"` : 
                       `xdg-open "${url}"`;
        
        exec(command, (error) => {
            if (error) {
                console.error('Failed to open URL:', error);
                return res.status(500).json({ error: 'Failed to open URL' });
            }
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Error opening URL:', error);
        res.status(500).json({ error: 'Failed to open URL' });
    }
});

app.post('/fetch-resource-info', express.json(), async (req, res) => {
    try {
        const { resources } = req.body;
        
        if (!resources || !Array.isArray(resources)) {
            return res.status(400).json({ error: 'Resources array is required' });
        }

        const resourceInfo = [];
        
        for (const resource of resources) {
            if (resource.hash) {
                const info = await fetchModelInfoByHash(resource.hash);                resourceInfo.push({
                    hash: resource.hash,
                    weight: resource.weight || 1.0,
                    name: info.name,
                    type: info.type,
                    versionName: info.versionName,
                    modelId: info.modelId
                });
            }
        }

        res.json({ success: true, resources: resourceInfo });
    } catch (error) {
        console.error('Error fetching resource info:', error);
        res.status(500).json({ 
            error: 'Failed to fetch resource info',
            details: error.message 
        });
    }
});

// Add config endpoint with faster response
app.get('/config', async (req, res) => {
    try {
        // Return basic config immediately if available in memory
        if (config && Object.keys(config).length > 0) {
            return res.json(config);
        }
        
        const configPath = path.join(__dirname, 'config.json');
        
        // Check if config exists
        try {
            await fs.access(configPath);          } catch (error) {            // Create default config if it doesn't exist
            const defaultConfig = {
                "metadata_output_dir": "./metadata",
                "theme": "dark",
                "auto_generate_metadata": true,
                "standalone_files": [],
                "watched_folders": [],
                "previously_deleted": [],
                "failed_to_generate": []
            };
            
            // Update global config
            Object.assign(config, defaultConfig);
            
            await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
            return res.json(defaultConfig);
        }

        // Read and send existing config
        const configContent = await fs.readFile(configPath, 'utf8');
        const loadedConfig = JSON.parse(configContent);
        
        // Update global config
        Object.assign(config, loadedConfig);
        
        res.json(loadedConfig);
    } catch (error) {
        console.error('Error loading config:', error);        // Return minimal working config on error
        const fallbackConfig = {
            "metadata_output_dir": "./metadata",
            "theme": "dark",
            "auto_generate_metadata": true,
            "standalone_files": [],
            "watched_folders": [],
            "previously_deleted": [],
            "failed_to_generate": []
        };
        
        res.json(fallbackConfig);
    }
});

// Add theme-specific endpoint for quick theme updates
app.post('/save-theme', express.json(), async (req, res) => {
    try {
        const { theme } = req.body;
        
        // Validate theme value
        if (!theme || !['light', 'dark'].includes(theme)) {
            return res.status(400).json({ error: 'Invalid theme value. Must be "light" or "dark".' });
        }

        // Update config object
        config.theme = theme;
        
        // Save to file
        await fs.writeFile(
            path.join(__dirname, 'config.json'), 
            JSON.stringify(config, null, 2)
        );
        
        res.json({ 
            success: true,
            theme: theme
        });
    } catch (error) {
        console.error('Error saving theme:', error);
        res.status(500).json({ 
            error: 'Failed to save theme',
            details: error.message 
        });
    }
});

// Update the get-file-path endpoint
app.post('/get-file-path', express.json(), async (req, res) => {
    try {
        const { fileName } = req.body;
        if (!fileName) {
            return res.status(400).json({ error: 'No file name provided' });
        }

        // First check if it matches any standalone file
        const matchingStandalone = config.standalone_files.find(file => 
            path.basename(file) === fileName
        );

        if (matchingStandalone) {
            try {
                await fs.access(matchingStandalone);
                return res.json({ fullPath: matchingStandalone });
            } catch (error) {
                console.log(`Standalone file not found: ${matchingStandalone}`);
            }
        }

        // Then check in watched folders
        for (const folder of config.watched_folders) {
            const fullPath = path.join(folder, fileName);
            try {
                await fs.access(fullPath);
                return res.json({ fullPath });
            } catch (error) {
                // Continue searching in next folder
                continue;
            }
        }

        // If we get here, file wasn't found
        console.log(`File not found: ${fileName}`);
        console.log('Searched standalone files:', config.standalone_files);
        console.log('Searched folders:', config.watched_folders);
        
        res.status(404).json({ 
            error: 'File not found',
            fileName,
            searchedStandalone: config.standalone_files,
            searchedFolders: config.watched_folders 
        });
    } catch (error) {
        console.error('Error resolving file path:', error);
        res.status(500).json({ error: 'Server error resolving file path' });
    }
});

app.post('/scan-safetensors', express.json(), async (req, res) => {
    try {
        const { folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ error: 'No folder path provided' });
        }

        // Check if folder exists
        try {
            await fs.access(folderPath);
        } catch (error) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        // Recursively scan for safetensors files
        async function scanDir(dir) {
            const files = [];
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    files.push(...await scanDir(fullPath));
                } else if (entry.name.endsWith('.safetensors')) {
                    files.push(fullPath);
                }
            }
            
            return files;
        }

        const files = await scanDir(folderPath);
        res.json({ files });

    } catch (error) {
        console.error('Error scanning for safetensors:', error);
        res.status(500).json({ error: 'Failed to scan folder' });
    }
});

// Add endpoint to handle deletion tracking
app.post('/add-to-deleted', express.json(), async (req, res) => {
    try {
        const { filePaths } = req.body;
        
        if (!filePaths || !Array.isArray(filePaths)) {
            return res.status(400).json({ error: 'filePaths must be an array' });
        }
        
        // Get current previously_deleted list
        const previouslyDeleted = config.previously_deleted || [];
        
        // Add new paths to previously_deleted (avoid duplicates)
        const newPaths = filePaths.filter(path => !previouslyDeleted.includes(path));
        const updatedPreviouslyDeleted = [...previouslyDeleted, ...newPaths];
        
        // Remove deleted model paths from standalone_files
        const updatedStandaloneFiles = config.standalone_files.filter(path => !filePaths.includes(path));
        const removedFromStandalone = config.standalone_files.length - updatedStandaloneFiles.length;
        
        // Update config
        config.previously_deleted = updatedPreviouslyDeleted;
        config.standalone_files = updatedStandaloneFiles;
        
        // Save to file
        await fs.writeFile(
            path.join(__dirname, 'config.json'), 
            JSON.stringify(config, null, 2)
        );
        
        console.log(`Added ${newPaths.length} models to previously_deleted list`);
        if (removedFromStandalone > 0) {
            console.log(`Removed ${removedFromStandalone} models from standalone_files list`);
        }
        
        res.json({ 
            success: true,
            added: newPaths.length,
            removedFromStandalone: removedFromStandalone,
            total: updatedPreviouslyDeleted.length
        });
    } catch (error) {
        console.error('Error adding to deleted list:', error);
        res.status(500).json({ 
            error: 'Failed to add to deleted list',
            details: error.message 
        });
    }
});

// Add endpoint to remove from previously_deleted when re-adding
app.post('/remove-from-deleted', express.json(), async (req, res) => {
    try {
        const { filePaths } = req.body;
        
        if (!filePaths || !Array.isArray(filePaths)) {
            return res.status(400).json({ error: 'filePaths must be an array' });
        }
        
        // Get current previously_deleted list
        const previouslyDeleted = config.previously_deleted || [];
        
        // Remove paths from previously_deleted
        const updatedPreviouslyDeleted = previouslyDeleted.filter(path => !filePaths.includes(path));
        
        // Update config
        config.previously_deleted = updatedPreviouslyDeleted;
        
        // Save to file
        await fs.writeFile(
            path.join(__dirname, 'config.json'), 
            JSON.stringify(config, null, 2)
        );
        
        const removedCount = previouslyDeleted.length - updatedPreviouslyDeleted.length;
        console.log(`Removed ${removedCount} models from previously_deleted list`);
        
        res.json({ 
            success: true,
            removed: removedCount,
            total: updatedPreviouslyDeleted.length
        });
    } catch (error) {
        console.error('Error removing from deleted list:', error);
        res.status(500).json({ 
            error: 'Failed to remove from deleted list',
            details: error.message 
        });
    }
});

// Add static file serving for the images folder
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.static(__dirname));

// Initialize caches on startup with immediate server response
(async function initializeServer() {
    console.log('Initializing server...');
    
    // Initialize config first
    await initializeConfig();
    
    // Initialize hash cache
    await initializeHashCache();
    
    // Load folder stats immediately (lightweight operation)
    await loadFolderStats();
    
    // Load cache in background to avoid blocking server startup
    setImmediate(async () => {
        try {
            const cacheLoaded = await loadCacheFromDisk();
            if (cacheLoaded) {
                console.log(`Background: Loaded ${modelsCache ? modelsCache.length : 0} models from persistent cache`);
                
                // Check for folder changes after cache load
                setTimeout(async () => {
                    const hasChanges = await checkFolderChanges();
                    if (hasChanges) {
                        console.log('Folder changes detected, triggering background scan');
                        scanModelsInBackground();
                    }
                }, 2000); // Reduced to 2 seconds for faster response
            } else {
                // No cache found, start background scan
                console.log('No cache found, starting background model scan');
                setTimeout(() => scanModelsInBackground(), 1000); // Reduced to 1 second
            }
        } catch (error) {
            console.error('Error during background cache initialization:', error);
            // Fallback: start background scan
            setTimeout(() => scanModelsInBackground(), 1000);
        }
    });
})();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;