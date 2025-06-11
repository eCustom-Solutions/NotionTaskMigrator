// services/file_handler.js

const path = require('path');
const mime = require('mime-types');

/**
 * Max filename length allowed by Notion for file properties
 */
const MAX_NAME_LENGTH = 100;

/**
 * Sanitize a file object by trimming its name to comply with Notion's constraints
 * For external files, truncate the display name but keep the full URL
 * Returns a new file object with safe `.name` and original `.url`
 */
function sanitizeFileObject(file) {
    if (file.type === 'external' && file.external?.url) {
        const url = file.external.url;
        const name = url;
        const safeName = name.slice(0, MAX_NAME_LENGTH);
        return {
            type: 'external',
            name: safeName,
            external: { url }
        };
    }

    if (file.type === 'file' && file.file_upload?.id) {
        const name = file.name || 'notion_file';
        const safeName = name.slice(0, MAX_NAME_LENGTH);
        return {
            type: 'file',
            name: safeName,
            file_upload: { id: file.file_upload.id }
        };
    }

    // Default: return original if structure is unknown
    return file;
}

/**
 * Handle a file-type property (e.g., Final Video Content, Review Link)
 * - Migrates Notion-hosted files via mediaMigrator
 * - Passes through external links
 * - Applies name sanitization
 */
async function handleFileProperty(files, mediaMigrator, logger, propertyName = 'Unnamed Property') {
    const notionFiles = [];
    const externalFiles = [];

    for (const file of Array.isArray(files) ? files : []) {
        if (file.type === 'file') {
            notionFiles.push(file);
        } else if (file.type === 'external') {
            externalFiles.push(file);
        }
    }

    logger.info(`➡️ Processing ${propertyName}: ${files.length} file(s)`);
    logger.info(`📤 Notion-hosted files: ${notionFiles.length}`);
    logger.info(`🔗 External-only links: ${externalFiles.length}`);

    const uploaded = await mediaMigrator.processFiles(null, notionFiles);
    logger.info(`✅ ${propertyName} migrated: ${uploaded.length} file_upload(s)`);

    const sanitizedExternal = externalFiles.map(sanitizeFileObject);
    const sanitizedUploaded = uploaded.map(sanitizeFileObject);

    return { files: [...sanitizedUploaded, ...sanitizedExternal] };
}

module.exports = {
    sanitizeFileObject,
    handleFileProperty
};