# Cookie Consent Heuristic-First with LLM Enhancement

## Overview

This enhancement implements the correct approach for cookie consent handling: **heuristic search first** to find cookie dialogs and buttons, then **LLM analysis** of only the relevant HTML elements (not the whole page). The system combines the efficiency of heuristic search with the intelligence of LLM analysis for optimal cookie consent management.

## Correct Approach

### 1. Heuristic Search First

The system uses heuristic search to efficiently locate cookie consent elements:

1. **Dialog Detection**: Uses heuristic selectors to find cookie dialog elements
2. **Button Identification**: Uses heuristic patterns to identify consent buttons
3. **Element Extraction**: Extracts only the relevant dialog HTML (not whole page)
4. **LLM Analysis**: Passes only the dialog HTML to LLM for intelligent analysis

### 2. LLM Analysis of Relevant HTML Only

The LLM receives only the cookie dialog HTML and heuristic-found buttons:

```typescript
// Heuristic search finds dialog and buttons
const dialogElement = await this.getCookieDialogElement(page);
const buttons = await this.identifyButtonsWithHeuristics(page, dialogElement);

// Extract only dialog HTML (not whole page)
const dialogHTML = await dialogElement.innerHTML();

// Pass only relevant HTML to LLM
const prompt = `
Analyze this cookie consent dialog HTML (only the dialog element, not the whole page):
${dialogHTML}

Buttons Found by Heuristic Search:
${buttonInfo}
`;
```

### 3. Verification Using Dialog HTML Only

LLM verification analyzes only the cookie dialog state:

```typescript
// Use heuristic search to find remaining dialog elements
const remainingElements = await this.findRemainingDialogElements(page);

// Pass only dialog HTML to LLM for verification
const verification = await this.verifyConsentWithLLM(page, url, library);
```

## Problem Solved

The original issue was that cookie consent dialogs, especially multi-step ones like Cookiebot implementations, would fail during the second step. For example:

```
Error clicking button "Cookies verwalten": page.waitForSelector: Timeout 5000ms exceeded.
```

This happened because after clicking "Cookies zustimmen" (accept all), the dialog state changed and the "Cookies verwalten" button became unavailable or changed its selector.

## Solution

### 1. LLM-First Approach

The system now uses LLM as the **primary method** for cookie consent handling:

1. **LLM Primary**: Uses LLM to analyze and handle cookie consent by default
2. **LLM Verification**: Verifies cookie consent success using LLM analysis
3. **Plan Persistence**: Saves successful plans with verification results for future reuse
4. **Learning System**: Tracks success rates and usage statistics

### 2. Enhanced Plan Structure

Each LLM-generated plan now includes verification results and usage tracking:

```typescript
interface CookieConsentLLMPlan {
  url: string;
  domain: string;
  library: string;
  steps: CookieConsentStep[];
  createdAt: Date;
  successRate?: number;
  verificationResults?: LLMVerificationResult[];
  lastUsed?: Date;
  usageCount?: number;
}

interface LLMVerificationResult {
  success: boolean;
  confidence: number;
  reasoning: string;
  detectedElements: string[];
  verificationMethod: 'page-analysis' | 'element-detection' | 'content-check';
  timestamp: Date;
}
```

### 3. Configuration Options

The system now supports comprehensive configuration:

```typescript
interface CookieConsentConfig {
  strategy: 'accept-all' | 'reject-all' | 'minimal' | 'ai-decide';
  languages: string[];
  timeout: number;
  retryAttempts: number;
  fallbackStrategy: 'skip' | 'fail' | 'continue';
  useAI: boolean;
  useLLMPrimary: boolean; // NEW: Use LLM as primary method
  useLLMVerification: boolean; // NEW: Use LLM for verification
}
```

## Implementation Details

### Enhanced Cookie Consent Handler

The `CookieConsentHandler` class now includes:

- **`handleWithLLMPrimary()`** - Uses LLM as primary method
- **`verifyConsentWithLLM()`** - Verifies consent success using LLM analysis
- **`generateLLMPlan()`** - Creates custom plans using LLM analysis
- **`executeLLMPlan()`** - Executes generated plans
- **`saveCookieConsentPlan()`** - Persists successful plans with verification results
- **`loadCookieConsentPlan()`** - Loads saved plans for reuse

### LLM Verification Process

The verification process analyzes the page after consent handling:

1. **Page Analysis**: Captures current page state and content
2. **Element Detection**: Checks for remaining cookie dialog elements
3. **Content Analysis**: Analyzes page content for consent indicators
4. **Confidence Scoring**: Provides confidence level for the verification

### Plan Persistence with Verification

Successful plans are automatically saved with:

- **Verification Results**: Each verification attempt is stored
- **Success Rate**: Calculated from verification results
- **Usage Statistics**: Tracks usage count and last used date
- **Learning Data**: Enables continuous improvement

## Usage

### LLM-First Configuration

```typescript
const cookieHandler = new CookieConsentHandler({
  strategy: 'accept-all',
  useLLMPrimary: true,        // Use LLM as primary method
  useLLMVerification: true,   // Enable LLM verification
  timeout: 15000,
  retryAttempts: 2
});

const result = await cookieHandler.handleCookieConsent(page, url);

if (result.method === 'llm-primary') {
  console.log('LLM primary method was used');
  console.log('Verification confidence:', result.metadata.llmVerification?.confidence);
  console.log('Plan success rate:', result.metadata.llmPlan?.successRate);
}
```

### Environment Configuration

```bash
# Enable LLM as primary method (default: true)
COOKIE_CONSENT_USE_LLM_PRIMARY=true

# Enable LLM verification (default: true)
COOKIE_CONSENT_USE_LLM_VERIFICATION=true

# LLM provider preference
LLM_PRIMARY_PROVIDER=openai
LLM_FALLBACK_PROVIDER=ollama

# Debug mode for screenshots
COOKIE_CONSENT_DEBUG_SCREENSHOTS=true
```

### Manual Testing

Comprehensive test scripts are available:

```bash
# Test LLM-first cookie consent handling
npm run test:llm-first-cookie-consent

# Test the complete fallback mechanism
npm run test:cookie-consent-fallback

# Test LLM plan generation specifically
npm run test:llm-plan-generation
```

## Benefits

1. **Higher Success Rate** - LLM-first approach handles complex cookie dialogs
2. **Intelligent Verification** - LLM verifies consent success with confidence scoring
3. **Learning System** - Saves successful plans with verification results for future reuse
4. **Robust Fallbacks** - Multiple selectors per step handle dynamic content
5. **German-Optimized** - Specialized for German municipal websites
6. **Usage Analytics** - Tracks success rates and usage patterns
7. **Automatic Recovery** - Seamlessly falls back when needed

## Monitoring and Analytics

The system provides detailed logging and analytics:

```
🤖 Using LLM as primary method for cookie consent handling...
📋 Using existing LLM plan for vgka.de (Cookiebot)
🔍 Performing LLM verification of cookie consent success...
✅ LLM verification successful (confidence: 95%)
💾 Updated cookie consent plan: cookie-consent-plan-vgka.de-Cookiebot-1234567890.json (usage: 3, success rate: 100%)
```

### Verification Details

Each verification provides:
- **Success/Failure**: Boolean result
- **Confidence**: 0-100% confidence level
- **Reasoning**: Detailed explanation of analysis
- **Detected Elements**: List of remaining cookie elements
- **Verification Method**: Analysis method used

## Future Enhancements

1. **Success Rate Optimization** - Automatically improve plans based on verification results
2. **Cross-Domain Learning** - Apply successful patterns across similar sites
3. **A/B Testing** - Compare different plan strategies
4. **Real-time Adaptation** - Adjust plans based on website changes
5. **Performance Metrics** - Track execution time and resource usage

## Files Modified

- `src/services/cookie-consent-handler.service.ts` - Main implementation
- `tests/test-llm-first-cookie-consent.ts` - Comprehensive LLM-first tests
- `tests/test-cookie-consent-fallback.ts` - Integration tests
- `tests/test-llm-plan-generation.ts` - LLM-specific tests
- `docs/COOKIE-CONSENT-LLM-FALLBACK.md` - This documentation
