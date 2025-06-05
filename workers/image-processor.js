// Helper function to check if a URL or type indicates a video
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

self.addEventListener('message', async (e) => {
    const { images, baseUrl } = e.data;
    let processedCount = 0;
    const totalImages = images.length;

    for (const image of images) {
        try {
            // Skip video content
            if (isVideoContent(image)) {
                console.log('Skipping video content in worker:', image.url || image.originalUrl);
                processedCount++;
                continue;
            }

            // Skip if we already have a valid local URL and no Civitai URL
            if (image.url?.startsWith('/images/') && !image.originalUrl?.startsWith('https://')) {
                processedCount++;
                continue;
            }

            // If we have a Civitai URL, use it
            const civitaiUrl = image.originalUrl?.startsWith('https://') ? 
                image.originalUrl : 
                (image.url?.startsWith('https://') ? image.url : null);

            if (civitaiUrl) {
                // Send progress update
                self.postMessage({
                    type: 'progress',
                    current: processedCount,
                    total: totalImages,
                    url: civitaiUrl
                });

                // Request image processing from main thread
                self.postMessage({
                    type: 'process',
                    url: civitaiUrl,
                    imageData: image
                });

                processedCount++;
            }
        } catch (error) {
            self.postMessage({
                type: 'error',
                error: error.message,
                url: image.url
            });
        }
    }

    self.postMessage({
        type: 'complete',
        processedCount,
        totalImages
    });
});