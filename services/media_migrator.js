// services/media_migrator.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch'); // or axios
const FormData = require('form-data');

class MediaMigrator {
    /**
     * @param {Object}   options
     * @param {import('@notionhq/client').Client} options.notion    – Proxy-wrapped Notion client
     * @param {string}   options.tmpDir   – Local directory for downloads/uploads
     * @param {Object}   options.logger   – logger instance
     * @param {number}   options.maxParallel – concurrency limit
     * @param {number}   options.chunkSizeMB – for multi-part uploads
     */
    constructor({ notion, tmpDir, logger, maxParallel = 3, chunkSizeMB = 10 }) {
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
        const results = [];
        for (const fileObj of filesArray) {
            try {
                const localInfo = await this._downloadFile(pageId, fileObj);
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
        return results;
    }

    /** Persist manifest back to disk */
    async flush() {
        fs.writeFileSync(this.manifestPath, JSON.stringify({
            downloads: Object.fromEntries(this.downloadCache),
            uploads:   Object.fromEntries(this.uploadCache),
        }, null, 2));
        this.logger.info(`Persisted media manifest to ${this.manifestPath}`);
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
        if (this.downloadCache.has(sourceUrl)) {
            this.logger.info(`🔄 Cache hit for URL: ${sourceUrl}`);
            return this.downloadCache.get(sourceUrl);
        }

        // sanitize filename
        const filename = path.basename(new URL(sourceUrl).pathname);
        const localPath = path.join(this.tmpDir, `${Date.now()}_${filename}`);

        this.logger.info(`⬇️  Downloading ${sourceUrl} → ${localPath}`);
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(`Failed to download ${sourceUrl}: ${res.status}`);
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

        // 2) send file bytes
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        await fetch(`https://api.notion.com/v1/file_uploads/${uploadId}/send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
                'Notion-Version': this.notion.__version
            },
            body: form
        });

        return { id: uploadId, size: fs.statSync(filePath).size, sha256: create.upload_url /* included for timeline */ };
    }

    /** Multi-part upload for large files */
    async _multiPartUpload(filePath, size) {
        // ... implement chunk calculation, create with mode="multi_part",
        // upload each chunk with retry, complete upload.
        throw new Error('Multi-part upload not implemented yet');
    }
}

module.exports = { MediaMigrator };