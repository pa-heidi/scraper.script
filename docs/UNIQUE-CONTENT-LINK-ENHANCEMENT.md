# Unique Content Link Enhancement

## Overview
Enhanced the content link extraction to ensure unique, relevant content links by improving the LLM prompt for `contentLinkSelector` generation and adding intelligent filtering in the PlaywrightExecutor.

## Problem Identified
The previous implementation had several issues:

1. **Multiple links per content card** - Content items often have multiple links (image, title, "Read more", "Share", etc.)
2. **Pagination links in same container** - Pagination links might be within the same container as content links
3. **No uniqueness guarantee** - Could extract multiple links pointing to the same content or auxiliary links
4. **Generic selectors** - Selectors like `.event-item a` would pick up ALL links, not just the main content link

## Solution Implemented

### 1. Enhanced LLM Prompt for Precise Selector Generation

**Updated the prompt to emphasize:**
- Target the **PRIMARY/MAIN link** of each content item (usually title link)
- Avoid selectors that pick up multiple links per content item
- Exclude pagination, navigation, and auxiliary links
- Ensure uniqueness by targeting specific link types (e.g., title links, header links)

**Example guidance added:**
```
VALID SELECTOR EXAMPLES FOR UNIQUE CONTENT LINKS:
- If content links are in ".event-item" divs with title links: use ".event-item h2 a"
- If content links are in "article" tags with header links: use "article header a"
- If content links are in ".teaserblock_xs" with specific link class: use ".teaserblock_xs .main-link"

AVOID:
- ".event-item a" (too broad - picks up image links, button links, etc.)
```

### 2. Intelligent Link Filtering in PlaywrightExecutor

Added `isContentLink()` method that filters out:

**URL Patterns:**
- Pagination: `/page/`, `/seite/`, `?page=`, `/next`, `/prev`, `/weiter`, `/zurück`
- Actions: `/search`, `/filter`, `/sort`, `/login`, `/share`, `/edit`, `/delete`
- System pages: `/imprint`, `/privacy`, `/contact`, `/datenschutz`

**Link Text Patterns:**
- Navigation: "next", "previous", "weiter", "zurück", "more", "alle"
- Actions: "share", "teilen", "edit", "bearbeiten", "delete", "print"
- Symbols: `>>`, `<<`, `>`, `<`, `→`, `←`, `...`
- Very short non-descriptive text (< 3 characters without numbers)

### 3. Enhanced Usage Pattern Documentation

**Clarified the usage pattern:**
```
The contentLinkSelector will be used as: container.querySelectorAll(contentLinkSelector)
This means it should work within the siblingContainerSelector scope to find the main link of each content item.
```

**Provided concrete examples:**
- Container: `.events-list` (holds all items)
- Content Link Selector: `.event-item h2 a` (gets primary link from each item)

## Implementation Details

### LLM Prompt Enhancements
```typescript
// Updated prompt sections:
"contentLinkSelector": "CSS selector that matches the PRIMARY/MAIN link from each content item (ONE unique link per item, usually title link or main link)"

CRITICAL REQUIREMENTS:
- contentLinkSelector should select the PRIMARY/MAIN link from each content item (ONE per item)
- Avoid selectors that return multiple links per content item
- Ensure contentLinkSelector excludes pagination links even if they're in the same container
```

### Intelligent Filtering
```typescript
// Applied to both primary and fallback methods:
if (this.isContentLink(absoluteUrl, await linkElement.textContent())) {
  // Process the link
} else {
  logger.debug(`🚫 Filtered out non-content link: ${absoluteUrl}`);
}
```

## Benefits

1. **Unique Links Only** - Each content item contributes exactly one link
2. **Relevant Content** - Filters out pagination, navigation, and auxiliary links
3. **Better Precision** - More specific selectors target the main content link
4. **Reduced Noise** - Eliminates duplicate and irrelevant URLs
5. **Improved Performance** - Fewer unnecessary content page visits
6. **Better User Experience** - More accurate content extraction

## Example Impact

### Before (Problematic)
```html
<div class="events-list">
  <article class="event-item">
    <img src="image.jpg" />                    <!-- Could be picked up -->
    <h2><a href="/event/123">Event Title</a></h2>  <!-- Main content -->
    <a href="/share/123">Share</a>             <!-- Could be picked up -->
    <a href="/edit/123">Edit</a>               <!-- Could be picked up -->
  </article>
</div>
```
**Old behavior**: Might extract 3-4 links per item, including auxiliary links

### After (Precise)
```html
<div class="events-list">
  <article class="event-item">
    <img src="image.jpg" />                    <!-- ❌ Ignored -->
    <h2><a href="/event/123">Event Title</a></h2>  <!-- ✅ Extracted -->
    <a href="/share/123">Share</a>             <!-- ❌ Filtered out -->
    <a href="/edit/123">Edit</a>               <!-- ❌ Filtered out -->
  </article>
</div>
```
**New behavior**: Extracts exactly 1 relevant link per item using `.event-item h2 a`

## Performance Impact

- **Faster Execution** - Fewer URLs to process
- **Higher Accuracy** - Only relevant content pages are scraped
- **Reduced Bandwidth** - No unnecessary requests to auxiliary pages
- **Better Results** - More focused content extraction

## Files Modified

- `src/services/sibling-link-discovery.service.ts` - Enhanced LLM prompt for better selector generation
- `src/services/playwright-executor.service.ts` - Added intelligent link filtering with `isContentLink()` method
- `docs/UNIQUE-CONTENT-LINK-ENHANCEMENT.md` - This documentation

## Testing Recommendations

1. Test with content that has multiple links per item (image, title, buttons)
2. Verify pagination links are filtered out
3. Confirm auxiliary links (share, edit, etc.) are ignored
4. Check that only one unique link per content item is extracted
5. Validate that the main/primary content link is consistently selected

This enhancement significantly improves the precision and reliability of content link extraction, ensuring that only the most relevant content URLs are processed while eliminating noise from auxiliary and navigation links.