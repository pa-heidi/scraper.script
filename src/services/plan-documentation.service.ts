import { ScrapingPlan } from "../interfaces/core";

export class PlanDocumentationService {
    public generateHumanReadableDoc(
        plan: ScrapingPlan,
        siblingResults: any[],
        contentAnalysis: any
    ): string {
        const cookieConsentSection = plan.metadata.cookieConsent
            ? `
## Cookie Consent Configuration
- **Detected**: ${plan.metadata.cookieConsent.detected ? "✅ Yes" : "❌ No"}
- **Strategy**: ${plan.metadata.cookieConsent.strategy}
- **Library**: ${plan.metadata.cookieConsent.library}
- **Handled Successfully**: ${plan.metadata.cookieConsent.handledSuccessfully ? "✅ Yes" : "❌ No"}

### Cookie Consent Selectors
${plan.metadata.cookieConsent.acceptButtonSelector ? `- **Accept Button**: \`${plan.metadata.cookieConsent.acceptButtonSelector}\`` : ""}
${plan.metadata.cookieConsent.rejectButtonSelector ? `- **Reject Button**: \`${plan.metadata.cookieConsent.rejectButtonSelector}\`` : ""}
${plan.metadata.cookieConsent.settingsButtonSelector ? `- **Settings Button**: \`${plan.metadata.cookieConsent.settingsButtonSelector}\`` : ""}
${plan.metadata.cookieConsent.bannerSelector ? `- **Banner**: \`${plan.metadata.cookieConsent.bannerSelector}\`` : ""}
${plan.metadata.cookieConsent.modalSelector ? `- **Modal**: \`${plan.metadata.cookieConsent.modalSelector}\`` : ""}

### All Detected Selectors
${plan.metadata.cookieConsent.selectors ? Object.entries(plan.metadata.cookieConsent.selectors)
    .filter(([key, value]) => value && (value as string).trim() !== '')
    .map(([key, value]) => `- **${key}**: \`${value}\``)
    .join('\n') : 'No additional selectors detected'}

**Usage Note**: These selectors can be used by the scraping executor to automatically handle cookie consent in future scraping sessions, ensuring compliance and avoiding blocking.
`
            : `
## Cookie Consent Configuration
- **Detected**: ❌ No cookie consent detected
`;

        const doc = `
# Scraping Plan: ${plan.planId}

## Overview
This scraping plan was generated using workflow analysis combining sibling link discovery and content pattern analysis.

## Plan Configuration
- **Entry URLs**: ${plan.entryUrls.join(", ")}
- **List Selector**: \`${plan.listSelector}\`
- **Content Link Selector**: ${plan.contentLinkSelector ? `\`${plan.contentLinkSelector}\`` : "None (will use fallback method)"}
- **Pagination Selector**: ${plan.paginationSelector ? `\`${plan.paginationSelector}\`` : "None"}
- **Rate Limit**: ${plan.rateLimitMs}ms between requests
${cookieConsentSection}
## Detail Selectors
${Object.entries(plan.detailSelectors)
    .map(([field, selector]) => {
        const isRichContent = plan.richContentFields?.includes(field);
        const contentType = isRichContent ? " (Rich HTML Content)" : " (Text Content)";
        return `- **${field}**${contentType}: \`${selector}\``;
    })
    .join("\n")}

${plan.richContentFields && plan.richContentFields.length > 0 ? `
### Rich Content Fields
The following fields extract HTML content (innerHTML) for WYSIWYG display:
${plan.richContentFields.map((field: string) => `- **${field}**: Preserves HTML formatting, links, images, and other rich content`).join("\n")}
` : ""}

## Analysis Results
### Sibling Discovery
- **Method**: ${siblingResults[0]?.discoveryMethod || "None"}
- **Confidence**: ${siblingResults[0]?.confidence || 0}
- **Links Found**: ${siblingResults.reduce((sum: number, r: any) => sum + r.siblingLinks.length, 0)}
- **Content Link Selector**: ${siblingResults[0]?.metadata?.contentLinkSelector ? `\`${siblingResults[0].metadata.contentLinkSelector}\`` : "Not detected"}
- **Container Signature**: ${siblingResults[0]?.metadata?.containerSignature ? `\`${siblingResults[0].metadata.containerSignature}\`` : "Not detected"}

### Content Analysis
- **Confidence**: ${contentAnalysis.confidence || 0}
- **Selectors Extracted**: ${Object.keys(contentAnalysis.detailSelectors || {}).length}
- **Reasoning**: ${contentAnalysis.reasoning || "N/A"}

## Generated At
${new Date().toISOString()}
        `.trim();

        return doc;
    }
}

export default PlanDocumentationService;
