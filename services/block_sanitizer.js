/****
 * block_sanitizer.js
 * Utilities to clean up and sanitize Notion blocks before writing
 */

const { sanitizeFileObject } = require('../services/file_handler');

function sanitizeBlocks(blocks) {
  function sanitizeBlock(block) {
    // Deep clone to avoid mutating original
    const b = { ...block };

    // Recursively sanitize any nested children first
    if (Array.isArray(b.children)) {
      b.children = sanitizeBlocks(b.children);
    }

    // Apply block-level sanitizers
    if (!removeUnsupported(b)) return null;
    fixCalloutIcon(b);
    const afterDataUrl = stripDataUrlImages(b);
    const afterMentions = sanitizeRichTextMentions(afterDataUrl);
    const afterFiles = normalizeFileObjects(afterMentions);
    const finalBlock = stripInvalidFileBlocks(afterFiles);

    return finalBlock;
  }

  return blocks
    .map(sanitizeBlock)
    .filter(Boolean);
}
function normalizeFileObjects(block) {
  const fileTypes = ['image', 'file', 'pdf', 'video'];

  if (fileTypes.includes(block.type)) {
    const fileContainer = block[block.type];
    if (fileContainer?.external || fileContainer?.file_upload) {
      block[block.type] = sanitizeFileObject({
        type: fileContainer.external ? 'external' : 'file',
        name: block.name || '',
        external: fileContainer.external,
        file_upload: fileContainer.file_upload
      });
    }
  }

  return block;
}

// Removes blocks with type === "unsupported"
function removeUnsupported(block) {
  if (block.type === 'unsupported') return false;
  return true;
}

// Ensures callout.icon is either undefined or a valid object, not null
function fixCalloutIcon(block) {
  if (block.type === 'callout') {
    const icon = block.callout.icon;
    if (icon === null) {
      delete block.callout.icon;
    }
  }
  return block;
}

// Removes image blocks with data URIs (which are not allowed for uploads)
function stripDataUrlImages(block) {
  if (block.type === 'image' && block.image?.type === 'external') {
    const url = block.image.external.url;
    if (url && url.startsWith('data:')) {
      return null; // drop the block entirely
    }
  }
  return block;
}

function sanitizeRichTextMentions(block) {
  const validMentionTypes = new Set([
    'user', 'date', 'page', 'database', 'template_mention', 'custom_emoji'
  ]);

  const container = block[block.type];
  if (container?.rich_text?.length) {
    container.rich_text = container.rich_text.map(item => {
      if (item.type === 'mention' && !validMentionTypes.has(item.mention?.type)) {
        return {
          type: 'text',
          text: {
            content: item.plain_text || '[unsupported mention]',
            link: item.href ? { url: item.href } : null
          },
          annotations: item.annotations || {},
          plain_text: item.plain_text || '',
          href: item.href || null
        };
      }
      return item;
    });
  }
  return block;
}

// Removes image or file blocks missing both external and file_upload sources
function stripInvalidFileBlocks(block) {
  if (
    block.type === 'image' &&
    !(
      block.image?.external?.url ||
      block.image?.file?.url ||
      block.image?.file_upload?.id
    )
  ) {
    return null;
  }
  if (
    block.type === 'file' &&
    !(
      block.file?.external?.url ||
      block.file?.file_upload?.id
    )
  ) {
    return null;
  }
  return block;
}

module.exports = sanitizeBlocks;