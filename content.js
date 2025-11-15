// THG Label Printer Extension - OPTIMIZED VERSION
console.log('[THG Label Printer] Extension loaded - Optimized version');

// Kiểm tra PDF.js đã load chưa
if (!window.pdfjsLib) {
    console.error('[THG Label Printer] PDF.js is not loaded!');
} else {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
    console.log('[THG Label Printer] PDF.js loaded successfully');
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

    isCellAlreadyRendered(cell) {
        const existingLink = cell.querySelector('a[data-label-link]');
        return existingLink !== null;
    }

    renderLabelLink(cellData) {
        const { cell, labelUrl } = cellData;

        if (this.isCellAlreadyRendered(cell)) {
            return false;
        }

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

        link.addEventListener('mouseenter', () => {
            link.style.textDecoration = 'underline';
        });
        link.addEventListener('mouseleave', () => {
            link.style.textDecoration = 'none';
        });

        cell.innerHTML = '';
        cell.appendChild(link);
        
        cell.style.maxWidth = '300px';
        cell.style.overflow = 'hidden';
        cell.style.textOverflow = 'ellipsis';

        return true;
    }

    processLabels() {
        if (this.isProcessing) {
            return;
        }

        try {
            this.isProcessing = true;

            const cellsData = this.getShippingLabelCells();
            
            if (cellsData.length === 0) {
                return;
            }

            const hasChanged = this.hasLabelsChanged(cellsData);
            
            if (!hasChanged) {
                let updatedCount = 0;
                cellsData.forEach(cellData => {
                    if (this.renderLabelLink(cellData)) {
                        updatedCount++;
                    }
                });
                return;
            }

            this.currentLabels = new Set(cellsData.map(c => c.cellId));
            this.renderedCells.clear();

            let renderedCount = 0;
            cellsData.forEach(cellData => {
                if (this.renderLabelLink(cellData)) {
                    this.renderedCells.add(cellData.cellId);
                    renderedCount++;
                }
            });

        } catch (error) {
            console.error('[THG Label Printer] Error processing labels:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    startObserving() {
        this.stopObserving();

        this.observer = new MutationObserver((mutations) => {
            const hasImportantChange = mutations.some(mutation => {
                if (mutation.target.tagName === 'TBODY') return true;
                if (mutation.target.closest && mutation.target.closest('tbody')) return true;
                
                const hasNewRows = Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeType !== 1) return false;
                    return node.tagName === 'TR' || (node.closest && node.closest('tbody'));
                });
                
                if (hasNewRows) return true;

                const hasRemovedRows = Array.from(mutation.removedNodes).some(node => {
                    if (node.nodeType !== 1) return false;
                    return node.tagName === 'TR' || (node.closest && node.closest('tbody'));
                });

                return hasRemovedRows;
            });

            if (hasImportantChange) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.processLabels();
                }, 1000);
            }
        });

        const frameBody = document.querySelector('.wrapper-frame-body');
        if (frameBody) {
            this.observer.observe(frameBody, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });

            setTimeout(() => this.processLabels(), 1500);
        }
    }

    stopObserving() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        clearTimeout(this.debounceTimer);
    }

    reset() {
        this.stopObserving();
        this.currentLabels.clear();
        this.renderedCells.clear();
        this.shippingLabelColumnIndex = -1;
        this.isProcessing = false;
    }
}

const labelLinkRenderer = new LabelLinkRenderer();

// ============================================
// LABEL PRINTER CLASS - OPTIMIZED V2
// ============================================

class LabelPrinter {
    constructor() {
        this.shippingLabelColumnIndex = -1;
        this.codeColumnIndex = -1;
        this.processing = false;
        this.BATCH_SIZE = 10;
        this.RENDER_SCALE = 4;
    }

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

    findCodeColumnIndex() {
        const thead = document.querySelector('.wrapper-frame-body thead');
        if (!thead) return -1;

        const headers = thead.querySelectorAll('th');
        for (let i = 0; i < headers.length; i++) {
            const text = headers[i].innerText.trim();
            if (text === 'Code-THG') {
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
                return i;
            }
        }
        return -1;
    }

    getSelectedLabelLinks() {
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
        if (!tbody) return [];

        const selectedRows = tbody.querySelectorAll('tr[data-row-sid].active');
        const links = [];

        selectedRows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');
            
            if (cells.length <= this.shippingLabelColumnIndex) {
                return;
            }

            const labelCell = cells[this.shippingLabelColumnIndex];
            
            const linkElement = labelCell.querySelector('a[data-label-link]');
            const linkText = linkElement ? linkElement.href : labelCell.innerText.trim();
            
            if (!linkText || linkText === '' || linkText === '\u00A0') {
                return;
            }

            let orderCode = `order_${index + 1}`;
            let orderID = '';
            
            if (this.codeColumnIndex !== -1 && cells.length > this.codeColumnIndex) {
                const codeCell = cells[this.codeColumnIndex];
                const codeSpan = codeCell.querySelector('span:not([data-status-code])');
                const code = codeSpan ? codeSpan.innerText.trim() : codeCell.innerText.trim();
                if (code && code !== '' && code !== '\u00A0') {
                    orderCode = code.replace(/[\/\\:*?"<>|]/g, '_');
                }
            }

            if (orderIDColumnIndex !== -1 && cells.length > orderIDColumnIndex) {
                const codeCell = cells[orderIDColumnIndex];
                const code = codeCell.innerText.trim();
                if (code && code !== '' && code !== '\u00A0') {
                    orderID = code.replace(/[\/\\:*?"<>|]/g, '_');
                }
            }
            
            links.push({
                url: linkText,
                filename: `${orderID}--${orderCode}.pdf`,
                orderCode: orderCode,
                orderID: orderID,
                rowIndex: index
            });
        });

        return links;
    }

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
                        const blob = this.base64ToBlob(response.blob, 'application/pdf');
                        resolve(blob);
                    } else {
                        reject(new Error(response.error));
                    }
                }
            );
        });
    }

    base64ToBlob(base64, contentType = '') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: contentType });
    }

    async loadPDFPages(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            pages.push(page);
        }
        
        return pages;
    }

    async renderPageToCanvas(page) {
        const viewport = page.getViewport({ scale: this.RENDER_SCALE });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { 
            alpha: false,
            willReadFrequently: false,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;
        
        return canvas;
    }

    async processBatch(links, startIndex, batchSize, allCanvases, errors) {
        const batch = links.slice(startIndex, startIndex + batchSize);
        const promises = batch.map(async (link, batchIndex) => {
            const globalIndex = startIndex + batchIndex;
            
            try {
                const blob = await this.fetchFileViaBackground(link.url);
                const pages = await this.loadPDFPages(blob);
                
                const canvases = [];
                for (const page of pages) {
                    const canvas = await this.renderPageToCanvas(page);
                    canvases.push({
                        canvas: canvas,
                        orderCode: link.orderCode,
                        orderID: link.orderID,
                        index: globalIndex
                    });
                }
                
                return { success: true, canvases: canvases, link: link };
                
            } catch (error) {
                errors.push({
                    orderCode: link.orderCode,
                    filename: link.filename,
                    error: error.message
                });
                console.error(`[THG Label Printer] ❌ Failed: ${link.filename}`, error);
                return { success: false, link: link };
            }
        });

        const results = await Promise.all(promises);
        
        results.forEach(result => {
            if (result.success && result.canvases) {
                allCanvases.push(...result.canvases);
            }
        });

        return results.filter(r => r.success).length;
    }

    // TẠO HTML TEMPLATE CHO PRINT PAGE
    createPrintPageHTML() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Shipping Labels - ${new Date().toLocaleDateString('vi-VN')}</title>
                <style>
                    @page {
                        size: A4;
                        margin: 0;
                    }
                    
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    
                    body {
                        margin: 0;
                        padding: 0;
                        background: white;
                    }
                    
                    .page-container {
                        page-break-after: always;
                        page-break-inside: avoid;
                        position: relative;
                        width: 210mm;
                        min-height: 297mm;
                        margin: 0 auto;
                        background: white;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .page-container:last-child {
                        page-break-after: auto;
                    }
                    
                    .label-info {
                        text-align: center;
                        margin-bottom: 5mm;
                        font-family: Arial, sans-serif;
                        font-size: 12pt;
                        font-weight: bold;
                        color: #333;
                    }
                    
                    .label-canvas {
                        max-width: 100%;
                        width: 80%;
                        height: auto;
                        display: block;
                        margin: 0 auto;
                    }
                    
                    @media print {
                        body {
                            margin: 0 !important;
                            padding: 0 !important;
                        }
                        
                        .page-container {
                            margin: 0;
                        }
                    }
                    
                    .loading {
                        text-align: center;
                        padding: 50px;
                        font-family: Arial, sans-serif;
                        font-size: 18pt;
                    }
                    
                    .spinner {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #667eea;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin: 20px auto;
                    }
                    
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div id="print-content"></div>
            </body>
            </html>
        `;
    }

    async printAllLabels(links) {
        if (!window.pdfjsLib) {
            alert('❌ Thư viện PDF.js chưa được tải!\n\nVui lòng reload extension và thử lại.');
            return;
        }

        if (this.processing) {
            alert('⚠️ Đang xử lý, vui lòng đợi...');
            return;
        }

        this.processing = true;
        
        loadingOverlay.show(
            'Đang tải shipping labels',
            `Tổng cộng ${links.length} file - Xử lý ${this.BATCH_SIZE} file cùng lúc`
        );

        const startTime = Date.now();

        try {
            let successCount = 0;
            const errors = [];
            const allCanvases = [];

            // ===================================
            // BƯỚC 1: XỬ LÝ TẤT CẢ TRONG TAB HIỆN TẠI
            // ===================================
            const totalBatches = Math.ceil(links.length / this.BATCH_SIZE);
            
            for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
                const startIndex = batchNum * this.BATCH_SIZE;
                
                loadingOverlay.updateText('Đang tải shipping labels');
                loadingOverlay.updateSubtext(`Batch ${batchNum + 1}/${totalBatches} - ${this.BATCH_SIZE} files cùng lúc`);
                loadingOverlay.updateProgress(startIndex, links.length);

                const batchSuccess = await this.processBatch(
                    links, 
                    startIndex, 
                    this.BATCH_SIZE, 
                    allCanvases, 
                    errors
                );
                
                successCount += batchSuccess;
                
                const processed = Math.min(startIndex + this.BATCH_SIZE, links.length);
                loadingOverlay.updateProgress(processed, links.length);
            }

            const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[THG Label Printer] ⚡ Processed ${successCount} files in ${processingTime}s`);

            if (allCanvases.length > 0) {
                loadingOverlay.updateText('Đang chuẩn bị HTML...');
                loadingOverlay.updateSubtext(`Đã xử lý ${successCount}/${links.length} file trong ${processingTime}s`);

                // Sắp xếp lại theo thứ tự gốc
                allCanvases.sort((a, b) => a.index - b.index);

                // ===================================
                // BƯỚC 2: TẠO HTML CONTENT TRƯỚC
                // ===================================
                let htmlContent = '';
                
                for (let i = 0; i < allCanvases.length; i++) {
                    const { canvas, orderCode, orderID } = allCanvases[i];
                    
                    // Convert canvas to base64 TRƯỚC KHI mở tab mới
                    const imageData = canvas.toDataURL('image/png', 0.95);
                    
                    htmlContent += `
                        <div class="page-container">
                            <img class="label-canvas" src="${imageData}" />
                        </div>
                    `;
                    
                    // Update progress
                    if (i % 10 === 0) {
                        loadingOverlay.updateSubtext(`Chuẩn bị HTML: ${i + 1}/${allCanvases.length}`);
                    }
                }

                loadingOverlay.updateText('Mở cửa sổ in...');
                
                // ===================================
                // BƯỚC 3: MỞ TAB MỚI VÀ GHI HTML ĐÃ CHUẨN BỊ
                // ===================================
                const printWindow = window.open('', '_blank');
                
                if (!printWindow) {
                    throw new Error('Không thể mở cửa sổ mới. Vui lòng cho phép popup!');
                }

                // Ghi HTML đã chuẩn bị sẵn
                printWindow.document.write(this.createPrintPageHTML());
                printWindow.document.close();

                // Thêm content
                const contentDiv = printWindow.document.getElementById('print-content');
                contentDiv.innerHTML = htmlContent;

                // Đợi images load
                await new Promise(resolve => setTimeout(resolve, 500));

                loadingOverlay.hide();

                // Show result
                if (errors.length > 0) {
                    let message = '';
                    message += `❌ Thất bại: ${errors.length} file\n\n`;
                    const showErrors = errors.slice(0, 5);
                    message += `Chi tiết lỗi:\n`;
                    showErrors.forEach(err => {
                        message += `  • ${err.orderCode}: ${err.error}\n`;
                    });
                    if (errors.length > 5) {
                        message += `  ... và ${errors.length - 5} lỗi khác\n`;
                    }
                    message += '\n';
                    alert(message);
                } else {
                    printWindow.focus();
                    setTimeout(() => {
                        printWindow.print();
                    }, 300);
                }
            } else {
                loadingOverlay.hide();
                
                let message = '❌ Không tải được file nào!\n\n';
                message += 'Chi tiết lỗi:\n';
                errors.slice(0, 10).forEach(err => {
                    message += `• ${err.orderCode}: ${err.error}\n`;
                });
                
                alert(message);
            }

        } catch (error) {
            console.error('[THG Label Printer] Fatal error:', error);
            alert('❌ Có lỗi xảy ra:\n\n' + error.message);
        } finally {
            loadingOverlay.hide();
            this.processing = false;
        }
    }

    async handlePrint() {
        console.log('[THG Label Printer] Print button clicked');

        const links = this.getSelectedLabelLinks();

        if (links.length === 0) {
            alert('⚠️ Không tìm thấy shipping label nào!\n\n' +
                  'Vui lòng kiểm tra:\n' +
                  '• Đã chọn các đơn hàng (checkbox hoặc click row)\n' +
                  '• Các đơn hàng đã có shipping label\n' +
                  '• Cột "Shipping label" có chứa link');
            return;
        }

        console.log('[THG Label Printer] Found', links.length, 'labels to print');

        let confirmMessage = `🖨️ Bạn muốn in ${links.length} shipping label(s)?\n\n`;
        
        if (links.length > 50) {
            confirmMessage += `⚡ Chế độ xử lý nhanh: ${this.BATCH_SIZE} files song song\n`;
            confirmMessage += `⏱️ Dự kiến: ~${Math.ceil(links.length / this.BATCH_SIZE * 2)}s\n\n`;
        }
        
        confirmMessage += 'Danh sách:\n';
        links.slice(0, 10).forEach((link, i) => {
            confirmMessage += `${i + 1}. ${link.orderID || link.orderCode}\n`;
        });
        if (links.length > 10) {
            confirmMessage += `... và ${links.length - 10} đơn hàng khác\n`;
        }

        const confirmed = confirm(confirmMessage);
        if (!confirmed) {
            console.log('[THG Label Printer] Print cancelled by user');
            return;
        }

        await this.printAllLabels(links);
    }
}

const labelPrinter = new LabelPrinter();

// ============================================
// BUTTON INJECTION
// ============================================

function injectPrintButton(targetElement) {
    if (document.querySelector('.print-label-btn')) {
        return;
    }

    const button = document.createElement('button');
    button.className = 'download-label-btn print-label-btn';
    button.innerHTML = '🖨️ In label';
    button.title = 'In shipping labels đã chọn';

    button.onclick = async () => {
        button.disabled = true;
        try {
            await labelPrinter.handlePrint();
        } catch (error) {
            console.error('[THG Label Printer] Button click error:', error);
            alert('❌ Có lỗi xảy ra: ' + error.message);
        } finally {
            button.disabled = false;
        }
    };

    targetElement.parentElement.appendChild(button);
    console.log('[THG Label Printer] Print button injected');
}

// ============================================
// PAGE DETECTION & INJECTION
// ============================================

function tryInjectButton() {
    const header = document.querySelector('.wrapper-frame-body #btn-header-bookmark[data-item-key="menu_name_header_data_model"]');
    if (!header) {
        return;
    }

    const text = header.innerText.normalize('NFC').trim();
    if (text !== "Danh sách đơn bán hàng") {
        return;
    }

    const newButtons = document.querySelectorAll('#footer_toolbar_toolbar_item_new button');
    if (!newButtons.length) {
        return;
    }

    newButtons.forEach((btn) => {
        if (btn.parentElement.querySelector('.print-label-btn')) {
            return;
        }
        injectPrintButton(btn);
    });
}

function checkAndStartLabelLinkRendering() {
    const header = document.querySelector('.wrapper-frame-body #btn-header-bookmark[data-item-key="menu_name_header_data_model"]');
    if (!header) {
        labelLinkRenderer.stopObserving();
        return;
    }

    const text = header.innerText.normalize('NFC').trim();
    if (text === "Danh sách đơn bán hàng") {
        setTimeout(() => {
            const columnIndex = labelLinkRenderer.findShippingLabelColumnIndex();
            if (columnIndex !== -1) {
                console.log('[THG Label Printer] Found "Shipping label" column, starting link rendering...');
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

const observer = new MutationObserver(() => {
    tryInjectButton();
    checkAndStartLabelLinkRendering();
});

observer.observe(document.body, { 
    childList: true, 
    subtree: true 
});

setTimeout(() => {
    tryInjectButton();
    checkAndStartLabelLinkRendering();
}, 1000);

console.log('[THG Label Printer] Initialized - OPTIMIZED VERSION with parallel processing');