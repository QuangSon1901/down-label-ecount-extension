// THG Label Downloader Extension
console.log('[THG Label Downloader] Extension loaded');

// Kiểm tra JSZip đã load chưa
if (!window.JSZip) {
    console.error('[THG Label Downloader] JSZip is not loaded!');
    alert('❌ Extension lỗi: Thiếu thư viện JSZip!\n\nVui lòng liên hệ developer.');
} else {
    console.log('[THG Label Downloader] JSZip loaded successfully');
}

// ============================================
// LOADING OVERLAY
// ============================================

class LoadingOverlay {
    constructor() {
        this.overlay = null;
        this.progressBar = null;
        this.textElement = null;
        this.subtextElement = null;
        this.progressElement = null;
    }

    show(text = 'Đang xử lý...', subtext = '') {
        this.hide();

        this.overlay = document.createElement('div');
        this.overlay.className = 'label-loading-overlay';
        
        this.overlay.innerHTML = `
            <div class="label-loading-content">
                <div class="label-loading-spinner"></div>
                <div class="label-loading-text">${text}</div>
                <div class="label-loading-subtext">${subtext}</div>
                <div class="label-loading-progress-bar">
                    <div class="label-loading-progress-fill" style="width: 0%"></div>
                </div>
                <div class="label-loading-progress">0 / 0</div>
            </div>
        `;

        document.body.appendChild(this.overlay);

        this.textElement = this.overlay.querySelector('.label-loading-text');
        this.subtextElement = this.overlay.querySelector('.label-loading-subtext');
        this.progressElement = this.overlay.querySelector('.label-loading-progress');
        this.progressBar = this.overlay.querySelector('.label-loading-progress-fill');

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                e.stopPropagation();
            }
        });
    }

    updateText(text) {
        if (this.textElement) {
            this.textElement.textContent = text;
        }
    }

    updateSubtext(subtext) {
        if (this.subtextElement) {
            this.subtextElement.textContent = subtext;
        }
    }

    updateProgress(current, total) {
        if (this.progressElement) {
            this.progressElement.textContent = `${current} / ${total}`;
        }
        
        if (this.progressBar) {
            const percentage = total > 0 ? (current / total * 100) : 0;
            this.progressBar.style.width = `${percentage}%`;
        }
    }

    hide() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

const loadingOverlay = new LoadingOverlay();

// ============================================
// LABEL LINK RENDERER CLASS
// ============================================

class LabelLinkRenderer {
    constructor() {
        this.shippingLabelColumnIndex = -1;
        this.currentLabels = new Set();
        this.renderedCells = new Set();
        this.isProcessing = false;
        this.observer = null;
        this.debounceTimer = null;
    }

    /**
     * Tìm index của cột "Shipping label"
     */
    findShippingLabelColumnIndex() {
        const thead = document.querySelector('.wrapper-frame-body thead');
        if (!thead) return -1;

        const headers = thead.querySelectorAll('th');
        for (let i = 0; i < headers.length; i++) {
            const text = headers[i].innerText.trim();
            if (text === 'Shipping label') {
                return i;
            }
        }
        return -1;
    }

    /**
     * Lấy tất cả cells có shipping label
     */
    getShippingLabelCells() {
        if (this.shippingLabelColumnIndex === -1) {
            this.shippingLabelColumnIndex = this.findShippingLabelColumnIndex();
            if (this.shippingLabelColumnIndex === -1) {
                return [];
            }
        }

        const tbody = document.querySelector('.wrapper-frame-body tbody');
        if (!tbody) return [];

        const rows = tbody.querySelectorAll('tr[data-row-sid]');
        const cells = [];

        rows.forEach((row, rowIndex) => {
            const rowCells = row.querySelectorAll('td');
            if (rowCells.length > this.shippingLabelColumnIndex) {
                const cell = rowCells[this.shippingLabelColumnIndex];
                const labelText = cell.innerText.trim();
                
                // Chỉ lấy cells có label (không rỗng)
                if (labelText && labelText !== '' && labelText !== '\u00A0') {
                    cells.push({
                        cell: cell,
                        labelUrl: labelText,
                        rowIndex: rowIndex,
                        cellId: `label_${rowIndex}_${labelText.substring(0, 20)}`
                    });
                }
            }
        });

        return cells;
    }

    /**
     * Kiểm tra xem danh sách labels có thay đổi không
     */
    hasLabelsChanged(newCells) {
        const newLabelSet = new Set(newCells.map(c => c.cellId));
        
        if (newLabelSet.size !== this.currentLabels.size) {
            return true;
        }

        for (const id of newLabelSet) {
            if (!this.currentLabels.has(id)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Kiểm tra cell đã được render chưa
     */
    isCellAlreadyRendered(cell) {
        const existingLink = cell.querySelector('a[data-label-link]');
        return existingLink !== null;
    }

    /**
     * Render link trong cell
     */
    renderLabelLink(cellData) {
        const { cell, labelUrl } = cellData;

        // Kiểm tra đã render chưa
        if (this.isCellAlreadyRendered(cell)) {
            return false;
        }

        // Tạo link element
        const link = document.createElement('a');
        link.setAttribute('data-label-link', 'true');
        link.href = labelUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = labelUrl;
        link.style.cssText = `
            color: #2196f3;
            text-decoration: none;
            word-break: break-all;
            display: inline-block;
            max-width: 100%;
        `;

        // Hover effect
        link.addEventListener('mouseenter', () => {
            link.style.textDecoration = 'underline';
        });
        link.addEventListener('mouseleave', () => {
            link.style.textDecoration = 'none';
        });

        // Clear cell và thêm link
        cell.innerHTML = '';
        cell.appendChild(link);
        
        // Set cell style
        cell.style.maxWidth = '300px';
        cell.style.overflow = 'hidden';
        cell.style.textOverflow = 'ellipsis';

        return true;
    }

    /**
     * Process và render tất cả label links
     */
    processLabels() {
        if (this.isProcessing) {
            console.log('[THG Label Downloader] Already processing labels, skip...');
            return;
        }

        try {
            this.isProcessing = true;

            // Lấy cells từ table
            const cellsData = this.getShippingLabelCells();
            
            if (cellsData.length === 0) {
                console.log('[THG Label Downloader] No shipping labels found in table');
                return;
            }

            // Kiểm tra xem có thay đổi không
            const hasChanged = this.hasLabelsChanged(cellsData);
            
            if (!hasChanged) {
                console.log('[THG Label Downloader] Labels unchanged, checking if UI needs update...');
                // Kiểm tra xem có cell nào cần re-render không
                let updatedCount = 0;
                cellsData.forEach(cellData => {
                    if (this.renderLabelLink(cellData)) {
                        updatedCount++;
                    }
                });
                if (updatedCount > 0) {
                    console.log('[THG Label Downloader] ✅ Re-rendered', updatedCount, 'labels');
                }
                return;
            }

            console.log('[THG Label Downloader] Labels changed, rendering', cellsData.length, 'links');

            // Update current labels
            this.currentLabels = new Set(cellsData.map(c => c.cellId));

            // Reset rendered cells
            this.renderedCells.clear();

            // Render tất cả links
            let renderedCount = 0;
            cellsData.forEach(cellData => {
                if (this.renderLabelLink(cellData)) {
                    this.renderedCells.add(cellData.cellId);
                    renderedCount++;
                }
            });

            if (renderedCount > 0) {
                console.log('[THG Label Downloader] ✅ Rendered', renderedCount, 'label links');
            }

        } catch (error) {
            console.error('[THG Label Downloader] Error processing labels:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Bắt đầu observe table changes
     */
    startObserving() {
        // Dừng observer cũ nếu có
        this.stopObserving();

        // Tạo observer mới
        this.observer = new MutationObserver((mutations) => {
            // Kiểm tra xem có thay đổi quan trọng không
            const hasImportantChange = mutations.some(mutation => {
                // Chỉ quan tâm thay đổi trong tbody
                if (mutation.target.tagName === 'TBODY') return true;
                if (mutation.target.closest && mutation.target.closest('tbody')) return true;
                
                // Kiểm tra added nodes
                const hasNewRows = Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeType !== 1) return false;
                    return node.tagName === 'TR' || (node.closest && node.closest('tbody'));
                });
                
                if (hasNewRows) return true;

                // Kiểm tra removed nodes
                const hasRemovedRows = Array.from(mutation.removedNodes).some(node => {
                    if (node.nodeType !== 1) return false;
                    return node.tagName === 'TR' || (node.closest && node.closest('tbody'));
                });

                return hasRemovedRows;
            });

            if (hasImportantChange) {
                console.log('[THG Label Downloader] Important table change detected');
                
                // Debounce: chờ 1000ms sau thay đổi cuối cùng
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.processLabels();
                }, 1000);
            }
        });

        // Observe wrapper-frame-body
        const frameBody = document.querySelector('.wrapper-frame-body');
        if (frameBody) {
            this.observer.observe(frameBody, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });
            console.log('[THG Label Downloader] Started observing table changes');

            // Process ngay lần đầu
            setTimeout(() => this.processLabels(), 1500);
        }
    }

    /**
     * Dừng observe
     */
    stopObserving() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        clearTimeout(this.debounceTimer);
    }

    /**
     * Reset renderer
     */
    reset() {
        this.stopObserving();
        this.currentLabels.clear();
        this.renderedCells.clear();
        this.shippingLabelColumnIndex = -1;
        this.isProcessing = false;
    }
}

// Global instance
const labelLinkRenderer = new LabelLinkRenderer();

// ============================================
// LABEL DOWNLOADER CLASS
// ============================================

class LabelDownloader {
    constructor() {
        this.shippingLabelColumnIndex = -1;
        this.codeColumnIndex = -1;
        this.downloading = false;
    }

    /**
     * Tìm index của cột "Shipping label"
     */
    findShippingLabelColumnIndex() {
        const thead = document.querySelector('.wrapper-frame-body thead');
        if (!thead) {
            console.warn('[THG Label Downloader] Table header not found');
            return -1;
        }

        const headers = thead.querySelectorAll('th');
        for (let i = 0; i < headers.length; i++) {
            const text = headers[i].innerText.trim();
            if (text === 'Shipping label') {
                console.log('[THG Label Downloader] Found "Shipping label" column at index:', i);
                return i;
            }
        }
        
        console.warn('[THG Label Downloader] "Shipping label" column not found');
        return -1;
    }

    /**
     * Tìm index của cột "Code-THG"
     */
    findCodeColumnIndex() {
        const thead = document.querySelector('.wrapper-frame-body thead');
        if (!thead) return -1;

        const headers = thead.querySelectorAll('th');
        for (let i = 0; i < headers.length; i++) {
            const text = headers[i].innerText.trim();
            if (text === 'Code-THG') {
                console.log('[THG Label Downloader] Found "Code-THG" column at index:', i);
                return i;
            }
        }
        
        return -1;
    }

    findOrderIDColumnIndex() {
        const thead = document.querySelector('.wrapper-frame-body thead');
        if (!thead) return -1;

        const headers = thead.querySelectorAll('th');
        for (let i = 0; i < headers.length; i++) {
            const text = headers[i].innerText.trim();
            if (text === 'OrderID' || text === 'Order ID') {
                console.log('[THG Label Downloader] Found "OrderID" column at index:', i);
                return i;
            }
        }
        
        return -1;
    }

    /**
     * Lấy danh sách links từ các rows đã chọn
     */
    getSelectedLabelLinks() {
        // Tìm cột nếu chưa có
        if (this.shippingLabelColumnIndex === -1) {
            this.shippingLabelColumnIndex = this.findShippingLabelColumnIndex();
            if (this.shippingLabelColumnIndex === -1) {
                return [];
            }
        }

        if (this.codeColumnIndex === -1) {
            this.codeColumnIndex = this.findCodeColumnIndex();
        }

        const orderIDColumnIndex = this.findOrderIDColumnIndex();

        const tbody = document.querySelector('.wrapper-frame-body tbody');
        if (!tbody) {
            console.warn('[THG Label Downloader] Table body not found');
            return [];
        }

        // Lấy các rows đã được chọn (có class active)
        const selectedRows = tbody.querySelectorAll('tr[data-row-sid].active');
        console.log('[THG Label Downloader] Found', selectedRows.length, 'selected rows');

        const links = [];

        selectedRows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');
            
            if (cells.length <= this.shippingLabelColumnIndex) {
                console.warn('[THG Label Downloader] Row', index, 'does not have enough cells');
                return;
            }

            const labelCell = cells[this.shippingLabelColumnIndex];
            
            // Lấy URL từ link element nếu có, nếu không thì lấy text
            const linkElement = labelCell.querySelector('a[data-label-link]');
            const linkText = linkElement ? linkElement.href : labelCell.innerText.trim();
            
            // Kiểm tra xem có link không (bỏ qua ô trống hoặc nbsp)
            if (!linkText || linkText === '' || linkText === '\u00A0') {
                console.log('[THG Label Downloader] Row', index, 'has no shipping label link');
                return;
            }

            // Lấy mã đơn hàng
            let orderCode = `order_${index + 1}`;
            let orderID = '';
            
            // Thử lấy từ cột Code-THG
            if (this.codeColumnIndex !== -1 && cells.length > this.codeColumnIndex) {
                const codeCell = cells[this.codeColumnIndex];
                const codeSpan = codeCell.querySelector('span:not([data-status-code])');
                const code = codeSpan ? codeSpan.innerText.trim() : codeCell.innerText.trim();
                if (code && code !== '' && code !== '\u00A0') {
                    orderCode = code.replace(/[\/\\:*?"<>|]/g, '_'); // Sanitize filename
                }
            }

            if (orderIDColumnIndex !== -1 && cells.length > orderIDColumnIndex) {
                const codeCell = cells[orderIDColumnIndex];
                const code = codeCell.innerText.trim();
                if (code && code !== '' && code !== '\u00A0') {
                    orderID = code.replace(/[\/\\:*?"<>|]/g, '_'); // Sanitize filename
                }
            }
            
            console.log('[THG Label Downloader] Row', index, '- Order:', orderCode, '- Link:', linkText);
            
            links.push({
                url: linkText,
                filename: `${orderID}--${orderCode}.pdf`,
                orderCode: orderCode,
                rowIndex: index
            });
        });

        return links;
    }

    /**
     * Tải file qua background script
     */
    async fetchFileViaBackground(url) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: 'downloadFile', url: url },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    
                    if (response.success) {
                        // Convert base64 back to blob
                        const blob = this.base64ToBlob(response.blob, 'application/pdf');
                        resolve(blob);
                    } else {
                        reject(new Error(response.error));
                    }
                }
            );
        });
    }

    /**
     * Convert Base64 to Blob
     */
    base64ToBlob(base64, contentType = '') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: contentType });
    }

    /**
     * Tải và nén tất cả labels
     */
    async downloadAndZipLabels(links) {
        if (!window.JSZip) {
            alert('❌ Thư viện JSZip chưa được tải!\n\nVui lòng reload extension và thử lại.');
            return;
        }

        if (this.downloading) {
            alert('⚠️ Đang tải xuống, vui lòng đợi...');
            return;
        }

        this.downloading = true;
        
        loadingOverlay.show(
            'Đang tải xuống shipping labels',
            `Tổng cộng ${links.length} file`
        );

        try {
            const zip = new JSZip();
            let successCount = 0;
            let failedCount = 0;
            const errors = [];

            // Tải từng file
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                
                loadingOverlay.updateText('Đang tải xuống shipping labels');
                loadingOverlay.updateSubtext(`Đang tải ${link.filename}...`);
                loadingOverlay.updateProgress(i, links.length);

                try {
                    // Sử dụng background script để download
                    const blob = await this.fetchFileViaBackground(link.url);
                    
                    // Thêm vào ZIP
                    zip.file(link.filename, blob);
                    
                    successCount++;
                    console.log(`[THG Label Downloader] ✅ Downloaded: ${link.filename} (${blob.size} bytes)`);
                    
                } catch (error) {
                    failedCount++;
                    errors.push({
                        orderCode: link.orderCode,
                        filename: link.filename,
                        error: error.message
                    });
                    console.error(`[THG Label Downloader] ❌ Failed: ${link.filename}`, error);
                }

                // Delay nhỏ giữa các request để tránh rate limit
                if (i < links.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            // Cập nhật progress cuối cùng
            loadingOverlay.updateProgress(links.length, links.length);

            // Tạo ZIP file
            if (successCount > 0) {
                loadingOverlay.updateText('Đang nén file...');
                loadingOverlay.updateSubtext('Vui lòng đợi, đây có thể mất vài giây...');

                const zipBlob = await zip.generateAsync({
                    type: 'blob',
                    compression: 'DEFLATE',
                    compressionOptions: {
                        level: 6
                    }
                }, (metadata) => {
                    // Progress callback
                    const percent = metadata.percent.toFixed(0);
                    loadingOverlay.updateSubtext(`Đang nén... ${percent}%`);
                });

                console.log('[THG Label Downloader] ZIP file created, size:', zipBlob.size, 'bytes');

                // Tạo tên file với timestamp
                const now = new Date();
                const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
                const filename = `shipping_labels_${timestamp}.zip`;

                loadingOverlay.updateText('✅ Hoàn thành!');
                loadingOverlay.updateSubtext(`Đã tải ${successCount}/${links.length} file thành công`);

                // Download ZIP
                this.downloadBlob(zipBlob, filename);

                // Show result
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                let message = `✅ Tải xuống thành công!\n\n`;
                message += `📦 File: ${filename}\n`;
                message += `📊 Kết quả:\n`;
                message += `  • Thành công: ${successCount} file\n`;
                
                if (failedCount > 0) {
                    message += `  • Thất bại: ${failedCount} file\n\n`;
                    message += `❌ Chi tiết lỗi:\n`;
                    errors.forEach(err => {
                        message += `  • ${err.orderCode}: ${err.error}\n`;
                    });
                }

                alert(message);

            } else {
                loadingOverlay.updateText('❌ Thất bại');
                loadingOverlay.updateSubtext('Không tải được file nào');
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                let message = '❌ Không tải được file nào!\n\n';
                message += 'Chi tiết lỗi:\n';
                errors.forEach(err => {
                    message += `• ${err.orderCode}: ${err.error}\n`;
                });
                
                alert(message);
            }

        } catch (error) {
            console.error('[THG Label Downloader] Fatal error:', error);
            alert('❌ Có lỗi xảy ra:\n\n' + error.message);
        } finally {
            loadingOverlay.hide();
            this.downloading = false;
        }
    }

    /**
     * Download blob as file
     */
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        console.log('[THG Label Downloader] File download triggered:', filename);
    }

    /**
     * Xử lý click button
     */
    async handleDownload() {
        console.log('[THG Label Downloader] Download button clicked');

        // Lấy danh sách links
        const links = this.getSelectedLabelLinks();

        if (links.length === 0) {
            alert('⚠️ Không tìm thấy shipping label nào!\n\n' +
                  'Vui lòng kiểm tra:\n' +
                  '• Đã chọn các đơn hàng (checkbox hoặc click row)\n' +
                  '• Các đơn hàng đã có shipping label\n' +
                  '• Cột "Shipping label" có chứa link');
            return;
        }

        console.log('[THG Label Downloader] Found', links.length, 'labels to download');

        // Hiển thị danh sách
        let confirmMessage = `📽 Bạn muốn tải xuống ${links.length} shipping label(s)?\n\n`;
        confirmMessage += 'Danh sách:\n';
        links.slice(0, 10).forEach((link, i) => {
            confirmMessage += `${i + 1}. ${link.orderCode}\n`;
        });
        if (links.length > 10) {
            confirmMessage += `... và ${links.length - 10} đơn hàng khác\n`;
        }

        const confirmed = confirm(confirmMessage);
        if (!confirmed) {
            console.log('[THG Label Downloader] Download cancelled by user');
            return;
        }

        // Tải và nén
        await this.downloadAndZipLabels(links);
    }
}

// Global instance
const labelDownloader = new LabelDownloader();

// ============================================
// BUTTON INJECTION
// ============================================

function injectDownloadButton(targetElement) {
    // Kiểm tra đã có button chưa
    if (document.querySelector('.download-label-btn')) {
        return;
    }

    const button = document.createElement('button');
    button.className = 'download-label-btn';
    button.innerHTML = '📥 Tải label';
    button.title = 'Tải xuống shipping labels đã chọn';

    button.onclick = async () => {
        button.disabled = true;
        try {
            await labelDownloader.handleDownload();
        } catch (error) {
            console.error('[THG Label Downloader] Button click error:', error);
            alert('❌ Có lỗi xảy ra: ' + error.message);
        } finally {
            button.disabled = false;
        }
    };

    targetElement.parentElement.appendChild(button);
    console.log('[THG Label Downloader] Download button injected');
}

// ============================================
// PAGE DETECTION & INJECTION
// ============================================

function tryInjectButton() {
    // Kiểm tra xem có đang ở trang "Danh sách đơn bán hàng" không
    const header = document.querySelector('.wrapper-frame-body #btn-header-bookmark[data-item-key="menu_name_header_data_model"]');
    if (!header) {
        return;
    }

    const text = header.innerText.normalize('NFC').trim();
    if (text !== "Danh sách đơn bán hàng") {
        return;
    }

    console.log('[THG Label Downloader] Detected "Danh sách đơn bán hàng" page');

    // Tìm nút "Thêm mới" ở footer để inject button
    const newButtons = document.querySelectorAll('#footer_toolbar_toolbar_item_new button');
    if (!newButtons.length) {
        console.log('[THG Label Downloader] Footer buttons not found yet');
        return;
    }

    newButtons.forEach((btn) => {
        if (btn.parentElement.querySelector('.download-label-btn')) {
            return;
        }
        injectDownloadButton(btn);
    });
}

// ============================================
// CHECK AND START LABEL LINK RENDERING
// ============================================

function checkAndStartLabelLinkRendering() {
    const header = document.querySelector('.wrapper-frame-body #btn-header-bookmark[data-item-key="menu_name_header_data_model"]');
    if (!header) {
        labelLinkRenderer.stopObserving();
        return;
    }

    const text = header.innerText.normalize('NFC').trim();
    if (text === "Danh sách đơn bán hàng") {
        // Đợi table load xong
        setTimeout(() => {
            const columnIndex = labelLinkRenderer.findShippingLabelColumnIndex();
            if (columnIndex !== -1) {
                console.log('[THG Label Downloader] Found "Shipping label" column, starting link rendering...');
                labelLinkRenderer.startObserving();
            }
        }, 500);
    } else {
        labelLinkRenderer.stopObserving();
    }
}

// ============================================
// OBSERVER & INITIALIZATION
// ============================================

// Observer để theo dõi thay đổi DOM
const observer = new MutationObserver(() => {
    tryInjectButton();
    checkAndStartLabelLinkRendering();
});

// Start observing
observer.observe(document.body, { 
    childList: true, 
    subtree: true 
});

// Thử inject ngay khi load
setTimeout(() => {
    tryInjectButton();
    checkAndStartLabelLinkRendering();
}, 1000);

console.log('[THG Label Downloader] Initialized successfully with link rendering');