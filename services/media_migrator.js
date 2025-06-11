// services/media_migrator.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch'); // or axios
const FormData = require('form-data');
const mime = require('mime-types');

class MediaMigrator {
    /**
     * @param {Object}   options
     * @param {import('@notionhq/client').Client} options.notion    – Proxy-wrapped Notion client
     * @param {string}   options.tmpDir   – Local directory for downloads/uploads
     * @param {Object}   options.logger   – logger instance
     * @param {number}   options.maxParallel – concurrency limit
     * @param {number}   options.chunkSizeMB – for multi-part uploads
     */
    constructor({ notion, tmpDir, logger, maxParallel = 10, chunkSizeMB = 19 }) {
        this.notion = notion;
        this.tmpDir = tmpDir;
        this.logger = logger;
        this.maxParallel = maxParallel;
        this.chunkSizeBytes = chunkSizeMB * 1024 * 1024;

        this.downloadCache = new Map(); // sourceUrl → { path, size, sha256 }
        this.uploadCache   = new Map(); // sha256 → { id, size, uploadedAt }

        this.manifestPath = path.join(tmpDir, 'media_manifest.json');
        this.manifest = { downloads: {}, uploads: {} };
    }

    /** Prepare temp dir and load existing manifest if present */
    async init() {
        if (!fs.existsSync(this.tmpDir)) {
            fs.mkdirSync(this.tmpDir, { recursive: true });
            this.logger.info(`Created temp directory: ${this.tmpDir}`);
        }
        if (fs.existsSync(this.manifestPath)) {
            this.manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
            Object.assign(this.downloadCache, this.manifest.downloads);
            Object.assign(this.uploadCache, this.manifest.uploads);
            this.logger.info(`Loaded media manifest with ${Object.keys(this.manifest.downloads).length} downloads, `
                + `${Object.keys(this.manifest.uploads).length} uploads`);
        }
    }

    /** Main entrypoint: for a given pageId and its files array, returns Notion file_upload references */
    async processFiles(pageId, filesArray) {
        this.logger.info(`📄 Starting media processing for page ${pageId} (${filesArray.length} file(s))`);
        const results = [];
        for (const fileObj of filesArray) {
            try {
                const localInfo = await this._downloadFile(pageId, fileObj);
                if (!localInfo) {
                    continue;
                }
                const uploadInfo = await this._uploadFile(localInfo);
                results.push({
                    type: 'file_upload',
                    file_upload: { id: uploadInfo.id },
                    name: path.basename(localInfo.path)
                });
            } catch (err) {
                this.logger.error(`❌ MediaMigrator failed on page ${pageId}, file ${fileObj.external?.url || fileObj.file?.url}:`, err);
            }
        }
        this.logger.info(`✅ Finished processing media for page ${pageId}`);
        return results;
    }

    /** Persist manifest back to disk */
    async flush() {
        fs.writeFileSync(this.manifestPath, JSON.stringify({
            downloads: Object.fromEntries(this.downloadCache),
            uploads:   Object.fromEntries(this.uploadCache),
        }, null, 2));
        this.logger.info(`🗂 Persisted media manifest: ${Object.keys(this.downloadCache).length} downloads, ${Object.keys(this.uploadCache).length} uploads`);
    }

    /** Return simple stats */
    stats() {
        return {
            downloaded: this.downloadCache.size,
            uploaded:   this.uploadCache.size
        };
    }

    // ─── Private Helpers ───────────────────────────────────────────────────────

    /** Download an external or Notion-hosted file, cache by URL */
    async _downloadFile(pageId, fileObj) {
        const sourceUrl = (fileObj.type === 'external')
            ? fileObj.external.url
            : fileObj.file.url;
        if (!sourceUrl) {
            this.logger.warn(`⚠️  Skipping file on page ${pageId}: missing valid URL`);
            return null;
        }
        if (this.downloadCache.has(sourceUrl)) {
            this.logger.info(`🔄 Cache hit for URL: ${sourceUrl}`);
            return this.downloadCache.get(sourceUrl);
        }

        // sanitize filename
        const filename = path.basename(new URL(sourceUrl).pathname);
        const localPath = path.join(this.tmpDir, `${Date.now()}_${filename}`);

        this.logger.info(`⬇️  Downloading → ${localPath}`);
        let res;
        try {
            res = await fetch(sourceUrl);
            if (!res.ok) throw new Error(`Failed to download ${sourceUrl}: ${res.status}`);
        } catch (err) {
            this.logger.error(`❌ Error fetching ${sourceUrl}: ${err.message}`);
            throw err;
        }
        const buffer = await res.buffer();
        fs.writeFileSync(localPath, buffer);
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

        const info = {
            path: localPath,
            size: buffer.length,
            sha256
        };
        this.downloadCache.set(sourceUrl, info);
        this.manifest.downloads[sourceUrl] = info;
        this.logger.info(`✅ Downloaded & hashed (sha256=${sha256}, ${buffer.length} bytes)`);
        return info;
    }

    /** Upload a local file via Notion direct or multi-part upload */
    async _uploadFile(localInfo) {
        const { sha256, size, path: filePath } = localInfo;
        if (this.uploadCache.has(sha256)) {
            this.logger.info(`🔄 Upload cache hit for file ${filePath}`);
            return this.uploadCache.get(sha256);
        }

        if (size > this.chunkSizeBytes) {
            this.logger.warn(`⚠️  File ${filePath} exceeds chunk size (${size} bytes). Attempting multi-part upload.`);
        }

        let uploadResult;
        if (size <= this.chunkSizeBytes) {
            uploadResult = await this._directUpload(filePath);
        } else {
            uploadResult = await this._multiPartUpload(filePath, size);
        }

        this.uploadCache.set(sha256, uploadResult);
        this.manifest.uploads[sha256] = uploadResult;
        this.logger.info(`✅ Uploaded file_upload.id=${uploadResult.id}`);
        return uploadResult;
    }

    /** Direct single-request upload (≤20MB) */
    async _directUpload(filePath) {
        // 1) create upload object
        const create = await this.notion.request({
            path: 'file_uploads',
            method: 'POST',
            body: {}
        });
        const uploadId = create.id;

        // 2) send file bytes with explicit filename and content type
        const form = new FormData();
        const stream = fs.createReadStream(filePath);
        const filename = path.basename(filePath);
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';

        form.append('file', stream, {
            filename,
            contentType: mimeType
        });

        const uploadRes = await fetch(`https://api.notion.com/v1/file_uploads/${uploadId}/send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
                'Notion-Version': '2022-06-28'
            },
            body: form
        });

        const uploadText = await uploadRes.text();
        // this.logger.info(`📬 Upload response for ${uploadId}: status=${uploadRes.status}, body=${uploadText}`);

        await this._waitUntilUploaded(uploadId);

        return { id: uploadId, size: fs.statSync(filePath).size, sha256: create.upload_url /* included for timeline */ };
    }

    /** Poll until upload status is "uploaded" */
    async _waitUntilUploaded(uploadId) {
        const maxAttempts = 15;
        const delayMs = 3000;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const statusCheck = await this.notion.request({
                path: `file_uploads/${uploadId}`,
                method: 'GET'
            });
            // console.log("statusCheck", statusCheck);
            const status = statusCheck.status;
            if (status === 'uploaded') {
                this.logger.info(`📤 Upload ${uploadId} confirmed as uploaded`);
                return;
            }
            if (status === 'expired' || status === 'failed') {
                throw new Error(`Upload ${uploadId} failed with status ${status}`);
            }
            if (attempt % 10 === 0) {
                this.logger.warn(`⏳ Still waiting for upload ${uploadId} (elapsed: ${(attempt * delayMs / 1000)}s)`);
            }
            this.logger.info(`⏳ Waiting for upload ${uploadId} (attempt ${attempt}, status: ${status})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        throw new Error(`Upload ${uploadId} did not complete within expected time`);
    }

    /** Multi-part upload for large files */
    async _multiPartUpload(filePath, size) {
        // 1. Compute part size and total parts
        const partSize = this.chunkSizeBytes;
        const totalParts = Math.ceil(size / partSize);
        this.logger.info(`📦 Preparing multi-part upload: size=${size}, partSize=${partSize}, totalParts=${totalParts}`);
        const filename = path.basename(filePath);
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';

        // 2. Create upload object with multi_part mode
        const create = await this.notion.request({
            path: 'file_uploads',
            method: 'POST',
            body: {
                mode: 'multi_part',
                number_of_parts: totalParts,
                filename
            }
        });
        const uploadId = create.id;
        const upload_url = create.upload_url;
        this.logger.info(`🆕 Created multi-part upload object: id=${uploadId}, upload_url=${upload_url}`);

        // 3. Upload each part in batches of up to this.maxParallel
        const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
        for (let i = 0; i < partNumbers.length; i += this.maxParallel) {
            const batch = partNumbers.slice(i, i + this.maxParallel);
            this.logger.info(`📤 Uploading part batch: [${batch.join(', ')}]`);
            // Run uploads in parallel
            await Promise.all(batch.map(async (partNumber) => {
                const start = (partNumber - 1) * partSize;
                // The end byte is inclusive for fs.createReadStream, so subtract 1
                const end = Math.min(start + partSize, size) - 1;
                const form = new FormData();
                // Note: end is inclusive in createReadStream
                const stream = fs.createReadStream(filePath, { start, end });
                form.append('file', stream, {
                    filename,
                    contentType: mimeType
                });
                form.append('part_number', String(partNumber));
                const res = await fetch(`${upload_url}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
                        'Notion-Version': '2022-06-28'
                        // form-data sets its own Content-Type header
                    },
                    body: form
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`Failed to upload part ${partNumber} of ${filename}: ${res.status} ${text}`);
                }
                this.logger.info(`✅ Uploaded part ${partNumber} of ${filename}`);
            }));
        }

        this.logger.info(`🧩 All parts uploaded. Sending complete request for uploadId=${uploadId}`);

        // 4. Complete the upload
        await this.notion.request({
            path: `file_uploads/${uploadId}/complete`,
            method: 'POST',
            body: {}
        });

        this.logger.info(`📬 Complete request sent. Verifying final status for uploadId=${uploadId}`);

        // 5. Wait until uploaded
        await this._waitUntilUploaded(uploadId);

        this.logger.info(`🎉 Multi-part upload complete for ${filename} with id=${uploadId}`);

        // 6. Return upload info (sha256 is set to uploadId for timeline)
        return { id: uploadId, size, sha256: uploadId };
    }
}

module.exports = { MediaMigrator };