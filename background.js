// Background Service Worker - Xử lý download files
console.log('[THG Background] Service worker started');

// Lắng nghe messages từ content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadFile') {
        downloadFile(request.url)
            .then(blob => {
                sendResponse({ success: true, blob: blob });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        
        // Return true để giữ message channel mở cho async response
        return true;
    }
    
    if (request.action === 'downloadFiles') {
        downloadMultipleFiles(request.urls)
            .then(results => {
                sendResponse({ success: true, results: results });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        
        return true;
    }
});

/**
 * Download một file từ URL
 */
async function downloadFile(url) {
    try {
        console.log('[THG Background] Downloading:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'omit'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        console.log('[THG Background] Downloaded:', blob.size, 'bytes');
        
        // Convert blob to base64 để gửi qua message
        return blobToBase64(blob);

    } catch (error) {
        console.error('[THG Background] Download error:', error);
        throw error;
    }
}

/**
 * Download nhiều files
 */
async function downloadMultipleFiles(urls) {
    const results = [];
    
    for (const urlData of urls) {
        try {
            const base64 = await downloadFile(urlData.url);
            results.push({
                success: true,
                filename: urlData.filename,
                orderCode: urlData.orderCode,
                data: base64
            });
        } catch (error) {
            results.push({
                success: false,
                filename: urlData.filename,
                orderCode: urlData.orderCode,
                error: error.message
            });
        }
    }
    
    return results;
}

/**
 * Convert Blob to Base64
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // Remove data URL prefix
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}