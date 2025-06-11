

/**
 * block_sanitizer.js
 * Utilities to clean up and sanitize Notion blocks before writing
 */

function sanitizeBlocks(blocks) {
  return blocks
    .map(block => ({ ...block }))
    .filter(removeUnsupported)
    .map(fixCalloutIcon)
    .map(stripDataUrlImages)
    .filter(Boolean);
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

module.exports = sanitizeBlocks;