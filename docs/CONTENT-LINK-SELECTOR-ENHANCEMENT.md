# Content Link Selector Enhancement

## Overview
Enhanced the content URL extraction in `PlaywrightExecutor` to use precise `contentLinkSelector` from the plan metadata, similar to how sibling link discovery works, instead of just grabbing any link within list items.

## Problem
The previous implementation in `extractContentUrls` was too simplistic:
- It looked for any `a[href]` within each list item
- This could result in duplicate links or irrelevant links (navigation, images, buttons, etc.)
- No deduplication of URLs
- Could pick up non-content links like "Read more", "Share", "Edit", etc.

## Solution
Implemented a two-tier approach:

### 1. Primary Method: Use `contentLinkSelector`
- If the plan has a `contentLinkSelector` (from sibling link discovery), use it directly
- This selector specifically targets the main content links, not auxiliary links
- Provides precise extraction of only relevant content URLs
- Includes automatic deduplication

### 2. Fallback Method: List Item Approach
- If no `contentLinkSelector` is available, fall back to the original method
- Still includes deduplication to avoid duplicate URLs
- Takes the first link found in each list item

## Implementation Details

### Interface Changes
```typescript
export interface ScrapingPlan {
  // ... existing fields
  contentLinkSelector?: string; // NEW: Specific selector for content links within list items
  // ... rest of fields
}
```

### Plan Creation Enhancement
```typescript
// Extract contentLinkSelector from sibling results during plan creation
const contentLinkSelector = siblingResults.length > 0
  ? siblingResults.find((r: any) => r.metadata?.contentLinkSelector)?.metadata?.contentLinkSelector
  : undefined;

const scrapingPlan: ScrapingPlan = {
  // ... other fields
  contentLinkSelector: contentLinkSelector, // Store for execution
  // ... rest of fields
};
```

### Enhanced URL Extraction
```typescript
// Primary method: Use contentLinkSelector if available
if (plan.contentLinkSelector) {
  const contentLinks = await page.$$(plan.contentLinkSelector);
  // Extract URLs with deduplication

} else {
  // Fallback: Use list item approach with deduplication
  await this.extractUrlsFromListItems(itemsToProcess, contentUrls, page);
}
```

## Benefits

1. **Precise Link Extraction** - Only extracts actual content links, not auxiliary links
2. **Deduplication** - Automatically removes duplicate URLs
3. **Better Performance** - More efficient selector usage
4. **Consistent with Sibling Discovery** - Uses the same proven selectors
5. **Graceful Fallback** - Still works for plans without contentLinkSelector
6. **Improved Logging** - Better visibility into which method is being used

## Example Scenarios

### Before (Problematic)
```html
<article class="event-item">
  <img src="image.jpg" />
  <h2><a href="/event/123">Event Title</a></h2>
  <p>Description...</p>
  <a href="/share/123">Share</a>
  <a href="/edit/123">Edit</a>
</article>
```
**Old behavior**: Could pick any of the 3 links, potentially duplicating or getting wrong links

### After (Precise)
```html
<!-- With contentLinkSelector: ".event-item h2 a" -->
<article class="event-item">
  <img src="image.jpg" />
  <h2><a href="/event/123">Event Title</a></h2>  <!-- ✅ Only this link -->
  <p>Description...</p>
  <a href="/share/123">Share</a>                 <!-- ❌ Ignored -->
  <a href="/edit/123">Edit</a>                   <!-- ❌ Ignored -->
</article>
```
**New behavior**: Precisely extracts only the main content link

## Performance Impact

- **Faster Execution** - More precise selectors are faster than iterating through list items
- **Fewer Duplicates** - Reduces unnecessary content page visits
- **Better Accuracy** - Higher chance of extracting the correct content URLs

## Backward Compatibility

- Plans without `contentLinkSelector` continue to work with the fallback method
- No breaking changes to existing functionality
- Enhanced plans automatically benefit from the new precision

## Files Modified

- `src/interfaces/core.ts` - Added `contentLinkSelector` to ScrapingPlan
- `src/services/mcp-orchestrator.service.ts` - Store contentLinkSelector during plan creation
- `src/services/playwright-executor.service.ts` - Enhanced extractContentUrls method
- `docs/CONTENT-LINK-SELECTOR-ENHANCEMENT.md` - This documentation

## Testing Recommendations

1. Test with plans that have `contentLinkSelector` (from sibling discovery)
2. Test with plans that don't have `contentLinkSelector` (fallback method)
3. Verify deduplication works correctly
4. Confirm only relevant content links are extracted
5. Check that auxiliary links (share, edit, etc.) are ignored

This enhancement significantly improves the precision and reliability of content URL extraction while maintaining full backward compatibility.